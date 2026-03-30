import os
import logging
import httpx
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
import zlib

from crud import (
    upsert_orders_batch,
    upsert_inventory_batch,
    get_sync_meta,
    update_orders_sync_time,
    update_inventory_sync_time,
)

logger = logging.getLogger("haltedb")


# ============================================
# Amazon Access Token
# ============================================

async def get_amazon_access_token() -> str:
    """
    Exchanges your permanent Refresh Token for a temporary 1-hour Access Token.
    """
    client_id = os.getenv("SP_API_LWA_APP_ID")
    client_secret = os.getenv("SP_API_LWA_CLIENT_SECRET")
    refresh_token = os.getenv("SP_API_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        raise ValueError("Missing Amazon LWA credentials in environment!")

    auth_url = "https://api.amazon.com/auth/o2/token"
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(auth_url, data=payload)
        if response.status_code != 200:
            logger.error(f"Amazon Auth Error: {response.text}")
            raise ValueError(f"Failed to authenticate with Amazon SP-API: {response.text}")
        data = response.json()
        return data["access_token"]


# ============================================
# Inventory Sync (Ledger Report)
# ============================================

async def run_inventory_sync_job(session: AsyncSession):
    endpoint = os.getenv("SP_API_ENDPOINT")
    if not endpoint:
        raise ValueError("Missing SP_API_ENDPOINT in environment")

    # Strip quotes if present (common .env issue)
    endpoint = endpoint.strip('"').strip("'")

    access_token = await get_amazon_access_token()
    headers = {"x-amz-access-token": access_token}

    report_type = "GET_LEDGER_SUMMARY_VIEW_DATA"

    end_time = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59, microsecond=0) - timedelta(days=1)
    start_time = end_time.replace(hour=0, minute=0, second=0, microsecond=0)

    async with httpx.AsyncClient(timeout=60.0) as client:
        logger.info("Requesting Ledger Inventory Report from Amazon...")

        create_payload = {
            "reportType": report_type,
            "marketplaceIds": [os.getenv("SP_API_MARKETPLACE_ID")],
            "dataStartTime": start_time.isoformat(),
            "dataEndTime": end_time.isoformat(),
            "reportOptions": {
                "aggregateByLocation": "FC",
                "aggregatedByTimePeriod": "DAILY"
            }
        }

        res = await client.post(f"{endpoint}/reports/2021-06-30/reports", headers=headers, json=create_payload)
        if res.status_code >= 400:
            logger.error(f"Amazon Inventory Report request rejected: {res.text}")
        res.raise_for_status()

        report_id = res.json()["reportId"]
        logger.info(f"Report requested! ID: {report_id}. Polling...")

        document_id = None
        while True:
            await asyncio.sleep(15)
            poll_res = await client.get(f"{endpoint}/reports/2021-06-30/reports/{report_id}", headers=headers)
            poll_res.raise_for_status()
            status_data = poll_res.json()
            status = status_data["processingStatus"]
            logger.info(f"  Polling inventory report: {status}")

            if status == "DONE":
                document_id = status_data["reportDocumentId"]
                break
            elif status in ["CANCELLED", "FATAL"]:
                logger.error("Report generation failed or was cancelled by Amazon.")
                return

        doc_res = await client.get(f"{endpoint}/reports/2021-06-30/documents/{document_id}", headers=headers)
        doc_res.raise_for_status()
        download_url = doc_res.json()["url"]

        logger.info("Downloading & parsing inventory ledger data...")
        async with client.stream("GET", download_url) as response:
            decompressor = zlib.decompressobj(zlib.MAX_WBITS | 16)
            buffer = ""
            batch = []
            headers_list = []
            is_first_line = True

            async for chunk in response.aiter_bytes():
                buffer += decompressor.decompress(chunk).decode('utf-8')

                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if not line:
                        continue

                    values = [v.strip().strip('"') for v in line.split('\t')]

                    if is_first_line:
                        headers_list = values
                        is_first_line = False
                        continue

                    row_data = dict(zip(headers_list, values))

                    fc_id = row_data.get("Location", "UNKNOWN")
                    disposition = row_data.get("Disposition", "SELLABLE")
                    qty_str = row_data.get("Ending Warehouse Balance", "0")
                    qty = int(qty_str) if qty_str.lstrip('-').isdigit() else 0

                    parsed_record = {
                        "sku": row_data.get("MSKU", "UNKNOWN"),
                        "fnsku": row_data.get("FNSKU"),
                        "asin": row_data.get("ASIN"),
                        "condition": disposition,
                        "fulfillment_center_id": fc_id,
                        "fulfillable_quantity": qty if disposition == "SELLABLE" else 0,
                        "unfulfillable_quantity": qty if disposition != "SELLABLE" else 0,
                        "reserved_quantity": 0
                    }
                    batch.append(parsed_record)

                    if len(batch) >= 1000:
                        await upsert_inventory_batch(session, batch)
                        batch.clear()

            final_data = decompressor.flush().decode('utf-8')
            if final_data:
                buffer += final_data

            if batch:
                await upsert_inventory_batch(session, batch)

    # Update sync timestamp
    await update_inventory_sync_time(session, datetime.now(timezone.utc))
    logger.info("Inventory sync complete!")


# ============================================
# State Normalization Map (Amazon sends abbreviations & variants)
# ============================================
STATE_NORMALIZATION_MAP = {
    # Two-letter abbreviations (title-cased because we .title() before lookup)
    "Ap": "Andhra Pradesh",
    "As": "Assam",
    "Br": "Bihar",
    "Ch": "Chandigarh",
    "Dl": "Delhi",
    "Ga": "Goa",
    "Gj": "Gujarat",
    "Hr": "Haryana",
    "Jk": "Jammu & Kashmir",
    "Ka": "Karnataka",
    "Kl": "Kerala",
    "Mh": "Maharashtra",
    "Mp": "Madhya Pradesh",
    "Pb": "Punjab",
    "Rj": "Rajasthan",
    "Tg": "Telangana",
    "Tn": "Tamil Nadu",
    "Up": "Uttar Pradesh",
    "Wb": "West Bengal",
    "Cg": "Chhattisgarh",
    "Jh": "Jharkhand",
    "Uk": "Uttarakhand",
    "Or": "Odisha",
    "Hp": "Himachal Pradesh",
    "Sk": "Sikkim",
    "Mn": "Manipur",
    "Ml": "Meghalaya",
    "Mz": "Mizoram",
    "Nl": "Nagaland",
    "Tr": "Tripura",
    "Ar": "Arunachal Pradesh",
    # Variant spellings
    "Tamilnadu": "Tamil Nadu",
    "Telangana State": "Telangana",
    "New Delhi": "Delhi",
    "Pondicherry": "Puducherry",
    "Jammu And Kashmir": "Jammu & Kashmir",
    "Chattisgarh": "Chhattisgarh",
    "Orissa": "Odisha",
}


def _normalize_state(raw: str | None) -> str | None:
    """Title-case, then fix abbreviations & variant spellings."""
    if not raw:
        return None
    titled = raw.strip().title()
    if not titled:
        return None
    # Handle compound entries like "Maharashtra, Dombivali"
    if "," in titled:
        titled = titled.split(",")[0].strip()
    return STATE_NORMALIZATION_MAP.get(titled, titled)


import re

# Canonical city name aliases — maps misspellings/variants to correct names
CITY_ALIAS_MAP = {
    "Bangalore": "Bengaluru", "Banglore": "Bengaluru", "Bengalore": "Bengaluru",
    "Bangaluru": "Bengaluru", "Bangalore North": "Bengaluru", "Bangalore South": "Bengaluru",
    "Bangalore Rural": "Bengaluru", "Bengaluru Rural": "Bengaluru", "Bengaluru Urban": "Bengaluru",
    "Bombay": "Mumbai", "Chennaichennai": "Chennai",
    "Trivandrum": "Thiruvananthapuram", "Thiruvanathapuram": "Thiruvananthapuram",
    "Thiruvanthapuram": "Thiruvananthapuram", "Thiruvananthapuramtrivandrum": "Thiruvananthapuram",
    "Gurgaon": "Gurugram", "Mangalore": "Mangaluru", "Manglore": "Mangaluru",
    "Mysore": "Mysuru", "Calcutta": "Kolkata", "Cochin": "Kochi",
    "Calicut": "Kozhikode", "Allahabad": "Prayagraj", "Banaras": "Varanasi",
    "Benaras": "Varanasi", "Pondicherry": "Puducherry", "Vizag": "Visakhapatnam",
    "Belgaum": "Belagavi", "Hubli": "Hubballi", "Tumkur": "Tumakuru",
    "Gulbarga": "Kalaburagi", "Shimoga": "Shivamogga", "Bellary": "Ballari",
    "Bijapur": "Vijayapura", "Trichur": "Thrissur", "Alleapy": "Alappuzha",
    "Trichy": "Tiruchirappalli", "Tirupur": "Tiruppur", "Palghat": "Palakkad",
    "Bhubaneshwar": "Bhubaneswar", "Raurkela": "Rourkela", "Samastipr": "Samastipur",
    "Azmgrh": "Azamgarh", "Dharamshala": "Dharmashala", "Dharmsala": "Dharmashala",
    "Behrampur": "Berhampur", "Samlkha": "Samalkha", "Rajsmand": "Rajsamand",
    "Sikandrabad": "Sikandarabad", "Jagatsinghapur": "Jagatsinghpur",
    "Kanchipuram": "Kancheepuram", "Kasargod": "Kasaragod",
    "Ahmadnagar": "Ahmednagar", "Jhunjhunun": "Jhunjhunu",
    "Mandyamandya": "Mandya", "Agraagra": "Agra", "Ahmedabada": "Ahmedabad",
    "Anantapuramu": "Anantapur", "Sultaanpur": "Sultanpur",
    "Bardhaman": "Burdwan", "Changanacherry": "Changanassery",
    "Nowshehra": "Nowshera", "Sulthan Bathery": "Sultan Bathery",
    "Sulthanbathery": "Sultan Bathery", "Thoothukudi": "Thoothukkudi",
    "Tuticorin": "Thoothukkudi", "Paradeep": "Paradip", "Paramakuti": "Paramakudi",
    "Ranagt": "Ranaghat", "Baleshwar": "Balasore", "Shilong": "Shillong",
    "Virajpete": "Virajpet", "Kanniyakumari": "Kanyakumari", "Alwaye": "Aluva",
    "Yamuna Nagar": "Yamunanagar", "Chengalpet": "Chengalpattu",
    "Sriganganagar": "Sri Ganganagar", "Hospet": "Hosapete",
    "Patna City": "Patna", "Pune City": "Pune",
}

def _normalize_city(raw: str | None) -> str | None:
    """Clean city names: strip numbers, commas, parentheses, colons, slashes; apply alias map."""
    if not raw:
        return None
    city = raw.strip()
    if not city:
        return None
    # Take first part before comma
    if "," in city:
        city = city.split(",")[0].strip()
    # Take first part before colon
    if ":" in city:
        city = city.split(":")[0].strip()
    # Take first part before slash
    if "/" in city:
        city = city.split("/")[0].strip()
    # Remove parenthetical suffixes like "(W)" or "(East)"
    city = re.sub(r'\([^)]*\)', '', city).strip()
    # Remove digits (phone numbers, postcodes)
    city = re.sub(r'[\d]+', '', city).strip()
    # Remove trailing/leading special chars
    city = re.sub(r'^[\s,;.\-:&]+|[\s,;.\-:&]+$', '', city).strip()
    # Collapse multiple spaces
    city = re.sub(r'\s+', ' ', city)
    if not city:
        return None
    city = city.title()
    # Apply canonical alias map
    return CITY_ALIAS_MAP.get(city, city)


# ============================================
# Orders Fetch (Date Range Report)
# ============================================

async def fetch_orders_date_range(session: AsyncSession, start_time: datetime, end_time: datetime):
    endpoint = os.getenv("SP_API_ENDPOINT")
    if not endpoint:
        raise ValueError("Missing SP_API_ENDPOINT in environment")
    endpoint = endpoint.strip('"').strip("'")

    access_token = await get_amazon_access_token()
    headers = {"x-amz-access-token": access_token}

    report_type = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL"

    async with httpx.AsyncClient(timeout=60.0) as client:
        logger.info(f"Requesting Orders from {start_time.strftime('%Y-%m-%d')} to {end_time.strftime('%Y-%m-%d')}...")

        create_payload = {
            "reportType": report_type,
            "marketplaceIds": [os.getenv("SP_API_MARKETPLACE_ID")],
            "dataStartTime": start_time.isoformat(),
            "dataEndTime": end_time.isoformat()
        }

        res = await client.post(f"{endpoint}/reports/2021-06-30/reports", headers=headers, json=create_payload)
        res.raise_for_status()
        report_id = res.json()["reportId"]

        document_id = None
        while True:
            await asyncio.sleep(15)
            poll_res = await client.get(f"{endpoint}/reports/2021-06-30/reports/{report_id}", headers=headers)
            poll_res.raise_for_status()
            status_data = poll_res.json()
            status = status_data["processingStatus"]
            logger.info(f"  Polling orders report: {status}")

            if status == "DONE":
                document_id = status_data["reportDocumentId"]
                break
            elif status in ["CANCELLED", "FATAL"]:
                raise ValueError(f"Order report failed with status: {status}")

        doc_res = await client.get(f"{endpoint}/reports/2021-06-30/documents/{document_id}", headers=headers)
        doc_res.raise_for_status()
        doc_data = doc_res.json()

        download_url = doc_data["url"]
        compression_algo = doc_data.get("compressionAlgorithm", "NONE")

        async with client.stream("GET", download_url) as response:
            decompressor = zlib.decompressobj(zlib.MAX_WBITS | 16) if compression_algo == "GZIP" else None

            buffer = ""
            batch = []
            headers_list = []
            is_first_line = True

            def safe_float(val):
                if not val: return 0.0
                try: return float(val.replace(',', '').strip())
                except ValueError: return 0.0

            def safe_datetime(val):
                if not val: return None
                try: return datetime.fromisoformat(val.replace('Z', '+00:00'))
                except ValueError: return None

            async for chunk in response.aiter_bytes():
                if decompressor:
                    buffer += decompressor.decompress(chunk).decode('utf-8', errors='replace')
                else:
                    buffer += chunk.decode('utf-8', errors='replace')

                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    if not line: continue

                    values = [v.strip().strip('"') for v in line.split('\t')]

                    if is_first_line:
                        headers_list = values
                        is_first_line = False
                        continue

                    row_data = dict(zip(headers_list, values))

                    amz_order_id = row_data.get("amazon-order-id")
                    sku = row_data.get("sku")

                    if amz_order_id and sku:
                        parsed_record = {
                            "amazon_order_id": amz_order_id,
                            "purchase_date": safe_datetime(row_data.get("purchase-date")),
                            "last_updated_date": safe_datetime(row_data.get("last-updated-date")),
                            "order_status": row_data.get("order-status", "UNKNOWN"),
                            "fulfillment_channel": row_data.get("fulfillment-channel"),
                            "sales_channel": row_data.get("sales-channel"),
                            "sku": sku,
                            "asin": row_data.get("asin"),
                            "item_status": row_data.get("item-status"),
                            "quantity": int(row_data.get("quantity", 0) or 0),
                            "currency": row_data.get("currency"),
                            "item_price": safe_float(row_data.get("item-price")),
                            "item_tax": safe_float(row_data.get("item-tax")),
                            "shipping_price": safe_float(row_data.get("shipping-price")),
                            "ship_city": _normalize_city(row_data.get("ship-city")),
                            "ship_state": _normalize_state(row_data.get("ship-state")),
                            "ship_postal_code": (row_data.get("ship-postal-code") or "").strip() or None,
                        }
                        batch.append(parsed_record)

                    if len(batch) >= 1000:
                        await upsert_orders_batch(session, batch)
                        batch.clear()

            if decompressor:
                buffer += decompressor.flush().decode('utf-8', errors='replace')

            if batch:
                await upsert_orders_batch(session, batch)

        logger.info(f"Orders synced up to {end_time.strftime('%Y-%m-%d')}!")


# ============================================
# Incremental Orders Sync (Since Last Sync)
# ============================================

async def run_incremental_orders_sync(session: AsyncSession):
    """
    Fetches orders since the last sync. If first run, fetches last 2 days.
    Updates sync_meta.last_orders_sync on success.
    """
    meta = await get_sync_meta(session)

    now = datetime.now(timezone.utc).replace(microsecond=0)

    if meta.last_orders_sync:
        # Fetch from last sync, with 1-hour overlap for safety
        start_time = meta.last_orders_sync - timedelta(hours=1)
    else:
        # First run: fetch last 2 days
        start_time = now - timedelta(days=2)

    logger.info(f"Incremental orders sync: {start_time.isoformat()} → {now.isoformat()}")

    await fetch_orders_date_range(session, start_time, now)

    # Update the sync timestamp
    await update_orders_sync_time(session, now)
    logger.info("Incremental orders sync complete!")


# ============================================
# Full Sync (Inventory + Incremental Orders)
# ============================================

async def run_product_specs_sync(session: AsyncSession):
    """
    Fetches product dimensions/weights from SP-API Catalog Items for any SKU
    that exists in orders but not in product_specifications.
    """
    from sqlalchemy import text as sa_text
    from urllib.parse import urlencode

    # Find SKUs missing specs
    result = await session.execute(sa_text("""
        SELECT o.sku, MAX(o.asin) as asin
        FROM orders o
        LEFT JOIN product_specifications ps ON o.sku = ps.sku
        WHERE o.sku IS NOT NULL AND o.asin IS NOT NULL AND ps.id IS NULL
        GROUP BY o.sku
    """))
    missing = {row[0]: row[1] for row in result.all()}

    if not missing:
        logger.info("All SKUs already have product specifications.")
        return

    logger.info(f"Fetching specs for {len(missing)} missing SKUs from SP-API Catalog...")

    endpoint = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com").strip('"').strip("'")
    marketplace_id = os.getenv("SP_API_MARKETPLACE_ID", "A21TJRUUN4KGV")
    access_token = await get_amazon_access_token()

    all_skus = list(missing.keys())
    batch_size = 20

    for i in range(0, len(all_skus), batch_size):
        sku_batch = all_skus[i:i+batch_size]
        asin_batch = [missing[s] for s in sku_batch]

        try:
            params = {
                "marketplaceIds": marketplace_id,
                "identifiers": ",".join(asin_batch),
                "identifiersType": "ASIN",
                "includedData": "dimensions",
            }
            url = f"{endpoint}/catalog/2022-04-01/items?{urlencode(params)}"

            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, headers={"x-amz-access-token": access_token})
                if resp.status_code == 429:
                    logger.warning("Rate limit hit, sleeping 5s...")
                    await asyncio.sleep(5)
                    continue
                resp.raise_for_status()
                items = resp.json().get("items", [])

            asin_to_sku = {missing[s]: s for s in sku_batch}

            for item in items:
                asin = item.get("asin")
                if asin not in asin_to_sku:
                    continue
                sku = asin_to_sku[asin]

                # Extract dimensions — SP-API structure:
                #   dimensions[0].package.{height,length,width,weight}
                #   dimensions[0].item.{height,length,width,weight}
                #   attributes.item_package_weight[0].{unit,value}
                #   attributes.item_package_dimensions[0].{length,width,height}
                dims_list = item.get("dimensions", [])
                weight_kg = None
                length_cm = None
                width_cm = None
                height_cm = None

                def to_kg(val, unit):
                    if not val: return None
                    u = (unit or "").lower()
                    if u in ("kilograms", "kg"): return float(val)
                    if u in ("grams", "g"): return float(val) / 1000.0
                    if u in ("pounds", "lb", "lbs"): return float(val) * 0.453592
                    if u in ("ounces", "oz"): return float(val) * 0.0283495
                    return float(val)

                def to_cm(val, unit):
                    if not val: return None
                    u = (unit or "").lower()
                    if u in ("centimeters", "cm"): return float(val)
                    if u in ("meters", "m"): return float(val) * 100
                    if u in ("millimeters", "mm"): return float(val) / 10.0
                    if u in ("inches", "in", "inch"): return float(val) * 2.54
                    return float(val)

                if dims_list:
                    d0 = dims_list[0]
                    pkg = d0.get("package", {})
                    itm_d = d0.get("item", {})
                    src = pkg if pkg else itm_d
                    if src.get("weight"):
                        weight_kg = to_kg(src["weight"].get("value"), src["weight"].get("unit"))
                    if src.get("length"):
                        length_cm = to_cm(src["length"].get("value"), src["length"].get("unit"))
                    if src.get("width"):
                        width_cm = to_cm(src["width"].get("value"), src["width"].get("unit"))
                    if src.get("height"):
                        height_cm = to_cm(src["height"].get("value"), src["height"].get("unit"))
                    # Fallback to item dims if package incomplete
                    if itm_d:
                        if not weight_kg and itm_d.get("weight"):
                            weight_kg = to_kg(itm_d["weight"].get("value"), itm_d["weight"].get("unit"))
                        if not length_cm and itm_d.get("length"):
                            length_cm = to_cm(itm_d["length"].get("value"), itm_d["length"].get("unit"))
                        if not width_cm and itm_d.get("width"):
                            width_cm = to_cm(itm_d["width"].get("value"), itm_d["width"].get("unit"))
                        if not height_cm and itm_d.get("height"):
                            height_cm = to_cm(itm_d["height"].get("value"), itm_d["height"].get("unit"))

                # Attributes fallback
                attrs = item.get("attributes", {})
                if not weight_kg:
                    for key in ["item_package_weight", "item_weight"]:
                        vals = attrs.get(key, [])
                        if vals and vals[0].get("value"):
                            weight_kg = to_kg(vals[0]["value"], vals[0].get("unit"))
                            break
                if not length_cm or not width_cm or not height_cm:
                    for key in ["item_package_dimensions", "item_dimensions"]:
                        vals = attrs.get(key, [])
                        if vals:
                            dd = vals[0]
                            if not length_cm and dd.get("length"):
                                length_cm = to_cm(dd["length"].get("value"), dd["length"].get("unit"))
                            if not width_cm and dd.get("width"):
                                width_cm = to_cm(dd["width"].get("value"), dd["width"].get("unit"))
                            if not height_cm and dd.get("height"):
                                height_cm = to_cm(dd["height"].get("value"), dd["height"].get("unit"))

                vol_wt = round(length_cm * width_cm * height_cm / 5000.0, 3) if all([length_cm, width_cm, height_cm]) else None
                chargeable = round(max(weight_kg or 0, vol_wt or 0), 3) if (weight_kg or vol_wt) else None

                product_name = None
                if item.get("summaries"):
                    product_name = item["summaries"][0].get("itemName")

                await session.execute(sa_text("""
                    INSERT INTO product_specifications (sku, asin, product_name, weight_kg, length_cm, width_cm, height_cm, volumetric_weight_kg, chargeable_weight_kg)
                    VALUES (:sku, :asin, :name, :wt, :l, :w, :h, :vw, :cw)
                    ON CONFLICT (sku) DO UPDATE SET
                        asin=EXCLUDED.asin, product_name=EXCLUDED.product_name,
                        weight_kg=EXCLUDED.weight_kg, length_cm=EXCLUDED.length_cm,
                        width_cm=EXCLUDED.width_cm, height_cm=EXCLUDED.height_cm,
                        volumetric_weight_kg=EXCLUDED.volumetric_weight_kg,
                        chargeable_weight_kg=EXCLUDED.chargeable_weight_kg,
                        last_updated=NOW()
                """), {
                    "sku": sku, "asin": asin, "name": product_name,
                    "wt": weight_kg, "l": length_cm, "w": width_cm, "h": height_cm,
                    "vw": vol_wt, "cw": chargeable,
                })

            await session.commit()
            logger.info(f"Specs batch {i//batch_size + 1}: saved {len(items)} items")
            await asyncio.sleep(0.5)

        except Exception as e:
            logger.error(f"Product specs batch error: {e}")

    logger.info("Product specifications sync complete.")


async def run_full_sync(session: AsyncSession):
    """
    Runs inventory sync, incremental orders sync, and product specs sync.
    Called by the hourly cron and the manual Sync button.
    """
    logger.info("=== STARTING FULL SYNC ===")

    try:
        logger.info("--- Phase 1: Inventory Sync ---")
        await run_inventory_sync_job(session)
    except Exception as e:
        logger.error(f"Inventory sync failed: {e}")

    try:
        logger.info("--- Phase 2: Incremental Orders Sync ---")
        await run_incremental_orders_sync(session)
    except Exception as e:
        logger.error(f"Orders sync failed: {e}")

    try:
        logger.info("--- Phase 3: Product Specifications Sync ---")
        await run_product_specs_sync(session)
    except Exception as e:
        logger.error(f"Product specs sync failed: {e}")

    logger.info("=== FULL SYNC COMPLETE ===")