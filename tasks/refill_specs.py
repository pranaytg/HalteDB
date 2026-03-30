"""Re-fetch ALL product specs from SP-API with CORRECT dimension extraction."""
import asyncio, os, sys, logging, httpx, json
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from sp_api import get_amazon_access_token

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("refill_specs")

DATABASE_URL = os.getenv("SUPABASE_URL")
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

ENDPOINT = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com").strip('"').strip("'")
MARKETPLACE = os.getenv("SP_API_MARKETPLACE_ID", "A21TJRUUN4KGV")


def to_kg(val, unit):
    if not val: return None
    u = (unit or "").lower()
    if u in ("kilograms", "kg"): return float(val)
    if u in ("grams", "g"): return float(val) / 1000.0
    if u in ("pounds", "lb", "lbs"): return float(val) * 0.453592
    if u in ("ounces", "oz"): return float(val) * 0.0283495
    return float(val)  # fallback: assume kg

def to_cm(val, unit):
    if not val: return None
    u = (unit or "").lower()
    if u in ("centimeters", "cm"): return float(val)
    if u in ("meters", "m"): return float(val) * 100
    if u in ("millimeters", "mm"): return float(val) / 10.0
    if u in ("inches", "in", "inch"): return float(val) * 2.54
    return float(val)  # fallback: assume cm


def extract_from_item(item: dict):
    """
    Extract weight and dimensions from SP-API Catalog Items response.
    
    The API returns data in TWO places:
    1. dimensions[0].package.{height,length,width,weight}  (preferred for shipping)
       dimensions[0].item.{height,length,width,weight}
    2. attributes.item_package_weight[0].{unit,value}
       attributes.item_package_dimensions[0].{length,width,height}
       attributes.item_weight[0].{unit,value}
       attributes.item_dimensions[0].{length,width,height}
    """
    weight_kg = None
    length_cm = None
    width_cm = None
    height_cm = None
    
    # --- Method 1: dimensions array (preferred) ---
    dims_list = item.get("dimensions", [])
    if dims_list:
        d = dims_list[0]
        # Prefer package dimensions for shipping
        pkg = d.get("package", {})
        itm = d.get("item", {})
        src = pkg if pkg else itm
        
        if src.get("weight"):
            weight_kg = to_kg(src["weight"].get("value"), src["weight"].get("unit"))
        if src.get("length"):
            length_cm = to_cm(src["length"].get("value"), src["length"].get("unit"))
        if src.get("width"):
            width_cm = to_cm(src["width"].get("value"), src["width"].get("unit"))
        if src.get("height"):
            height_cm = to_cm(src["height"].get("value"), src["height"].get("unit"))
        
        # If package didn't have all dims, try item as fallback
        if itm and (not length_cm or not width_cm or not height_cm):
            if not length_cm and itm.get("length"):
                length_cm = to_cm(itm["length"].get("value"), itm["length"].get("unit"))
            if not width_cm and itm.get("width"):
                width_cm = to_cm(itm["width"].get("value"), itm["width"].get("unit"))
            if not height_cm and itm.get("height"):
                height_cm = to_cm(itm["height"].get("value"), itm["height"].get("unit"))
        if not weight_kg and itm.get("weight"):
            weight_kg = to_kg(itm["weight"].get("value"), itm["weight"].get("unit"))
    
    # --- Method 2: attributes fallback ---
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
                d = vals[0]
                if not length_cm and d.get("length"):
                    length_cm = to_cm(d["length"].get("value"), d["length"].get("unit"))
                if not width_cm and d.get("width"):
                    width_cm = to_cm(d["width"].get("value"), d["width"].get("unit"))
                if not height_cm and d.get("height"):
                    height_cm = to_cm(d["height"].get("value"), d["height"].get("unit"))
    
    # Calculate volumetric and chargeable
    vol_wt = None
    if all([length_cm, width_cm, height_cm]):
        vol_wt = round(length_cm * width_cm * height_cm / 5000.0, 3)
    
    chargeable = None
    if weight_kg is not None or vol_wt is not None:
        chargeable = round(max(weight_kg or 0, vol_wt or 0), 3)
    
    # Product name from summaries
    product_name = None
    summaries = item.get("summaries", [])
    if summaries:
        product_name = summaries[0].get("itemName")
    
    return {
        "weight_kg": round(weight_kg, 3) if weight_kg else None,
        "length_cm": round(length_cm, 2) if length_cm else None,
        "width_cm": round(width_cm, 2) if width_cm else None,
        "height_cm": round(height_cm, 2) if height_cm else None,
        "volumetric_weight_kg": vol_wt,
        "chargeable_weight_kg": chargeable,
        "product_name": product_name,
    }


async def run():
    logger.info("Re-fetching ALL product specs from SP-API (fixed extraction)...")
    access_token = await get_amazon_access_token()

    async with AsyncSessionLocal() as session:
        result = await session.execute(text(
            "SELECT sku, MAX(asin) as asin FROM orders WHERE sku IS NOT NULL AND asin IS NOT NULL GROUP BY sku"
        ))
        sku_asin = {row[0]: row[1] for row in result.all()}
        logger.info(f"Found {len(sku_asin)} SKUs to fetch")

        all_skus = list(sku_asin.keys())
        batch_size = 20
        total_saved = 0
        total_with_weight = 0
        total_with_dims = 0

        for i in range(0, len(all_skus), batch_size):
            batch_skus = all_skus[i:i+batch_size]
            batch_asins = [sku_asin[s] for s in batch_skus]
            batch_num = i // batch_size + 1
            total_batches = (len(all_skus) + batch_size - 1) // batch_size

            params = {
                "marketplaceIds": MARKETPLACE,
                "identifiers": ",".join(batch_asins),
                "identifiersType": "ASIN",
                "includedData": "dimensions,summaries,attributes",
            }
            url = f"{ENDPOINT}/catalog/2022-04-01/items?{urlencode(params)}"

            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(url, headers={"x-amz-access-token": access_token})
                    if resp.status_code == 429:
                        logger.warning("Rate limit! Sleeping 5s...")
                        await asyncio.sleep(5)
                        resp = await client.get(url, headers={"x-amz-access-token": access_token})
                    if resp.status_code == 401:
                        logger.info("Token expired, refreshing...")
                        access_token = await get_amazon_access_token()
                        resp = await client.get(url, headers={"x-amz-access-token": access_token})
                    resp.raise_for_status()
                    items = resp.json().get("items", [])

                asin_to_sku = {sku_asin[s]: s for s in batch_skus}
                batch_saved = 0

                for item_data in items:
                    asin = item_data.get("asin")
                    if asin not in asin_to_sku:
                        continue
                    sku = asin_to_sku[asin]
                    
                    specs = extract_from_item(item_data)
                    
                    if specs["weight_kg"]: total_with_weight += 1
                    if specs["length_cm"]: total_with_dims += 1

                    await session.execute(text("""
                        INSERT INTO product_specifications
                            (sku, asin, product_name, weight_kg, length_cm, width_cm, height_cm, volumetric_weight_kg, chargeable_weight_kg)
                        VALUES (:sku, :asin, :name, :wt, :l, :w, :h, :vw, :cw)
                        ON CONFLICT (sku) DO UPDATE SET
                            asin=EXCLUDED.asin,
                            product_name=COALESCE(EXCLUDED.product_name, product_specifications.product_name),
                            weight_kg=EXCLUDED.weight_kg,
                            length_cm=EXCLUDED.length_cm,
                            width_cm=EXCLUDED.width_cm,
                            height_cm=EXCLUDED.height_cm,
                            volumetric_weight_kg=EXCLUDED.volumetric_weight_kg,
                            chargeable_weight_kg=EXCLUDED.chargeable_weight_kg,
                            last_updated=NOW()
                    """), {
                        "sku": sku, "asin": asin, "name": specs["product_name"],
                        "wt": specs["weight_kg"], "l": specs["length_cm"],
                        "w": specs["width_cm"], "h": specs["height_cm"],
                        "vw": specs["volumetric_weight_kg"], "cw": specs["chargeable_weight_kg"],
                    })
                    batch_saved += 1

                await session.commit()
                total_saved += batch_saved
                logger.info(f"Batch {batch_num}/{total_batches}: {len(items)} items, {batch_saved} saved")
                await asyncio.sleep(0.5)

            except Exception as e:
                logger.error(f"Batch {batch_num} error: {e}")
                import traceback
                traceback.print_exc()

        logger.info(f"=== DONE: {total_saved} specs saved, {total_with_weight} w/ weight, {total_with_dims} w/ dims ===")


if __name__ == "__main__":
    asyncio.run(run())
