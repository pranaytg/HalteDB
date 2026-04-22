"""
Bulk re-fetch shipping costs for all orders:
  - Amazon-fulfilled: SP-API Finance API
  - Merchant-fulfilled: Shiprocket live API (NO rate card fallback)

Processes in batches to avoid Supabase connection timeouts.
Skips orders already updated with sp_api_finance source.
"""
import argparse
import asyncio
import os
import re
import sys
from datetime import date, datetime
import httpx
from collections import defaultdict
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")
ORIGIN_PINCODE = os.getenv("ORIGIN_PINCODE", "160012")
SP_API_ENDPOINT = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com").strip('"').strip("'")
SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external"
FINANCE_DELAY = 1.0

SP_API_BATCH = 80
SHIPROCKET_BATCH = 50

CARRIER_MAP = {
    "delhivery": "delhivery", "bluedart": "bluedart", "blue dart": "bluedart",
    "dtdc": "dtdc", "xpressbees": "xpressbees", "expressbees": "xpressbees", "ekart": "ekart",
}
CARRIER_LABELS = {
    "delhivery": "Delhivery", "bluedart": "BlueDart",
    "dtdc": "DTDC", "xpressbees": "Xpressbees", "ekart": "Ekart",
}


def log(msg):
    print(msg, flush=True)


def create_engine():
    return create_async_engine(
        DATABASE_URL,
        pool_size=2,
        max_overflow=0,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    )


async def get_sp_api_token() -> str:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post("https://api.amazon.com/auth/o2/token", data={
            "grant_type": "refresh_token",
            "refresh_token": os.getenv("SP_API_REFRESH_TOKEN"),
            "client_id": os.getenv("SP_API_LWA_APP_ID"),
            "client_secret": os.getenv("SP_API_LWA_CLIENT_SECRET"),
        })
        return resp.json()["access_token"]


def _is_shipping_fee(fee_type: str) -> bool:
    lower = fee_type.lower()
    return any(k in lower for k in ("fbaperunitfulfillmentfee", "shipping", "fulfillment", "delivery", "weight handling"))


def _is_referral_fee(fee_type: str) -> bool:
    lower = fee_type.replace(" ", "").replace("_", "").lower()
    return any(k in lower for k in ("commission", "referral", "closing", "peritem", "variableclose", "fixedclose"))


def _money_amount(val) -> float:
    if isinstance(val, dict):
        return abs(float(val.get("CurrencyAmount") or val.get("currencyAmount") or 0))
    return abs(float(val or 0))


def _extract_breakdown(data: dict) -> dict:
    """Return {sku: {'shipping': X, 'referral': Y}} from a financialEvents payload."""
    payload = data.get("payload", {})
    events = payload.get("FinancialEvents", {})
    shipping = defaultdict(float)
    referral = defaultdict(float)
    for key in ("ShipmentEventList", "ShipmentSettleEventList"):
        for event in (events.get(key) or []):
            if not isinstance(event, dict):
                continue
            event_ship = 0.0
            event_ref = 0.0
            for fee in (event.get("FeeList") or []):
                ft = fee.get("FeeType") or fee.get("feeType") or ""
                amt = _money_amount(fee.get("FeeAmount") or fee.get("feeAmount"))
                if _is_shipping_fee(ft):
                    event_ship += amt
                elif _is_referral_fee(ft):
                    event_ref += amt
            item_skus = set()
            for item in (event.get("ShipmentItemList") or []) + (event.get("ShipmentItemAdjustmentList") or []):
                if not isinstance(item, dict):
                    continue
                sku = item.get("SellerSKU") or item.get("sellerSKU") or ""
                if not sku:
                    continue
                item_skus.add(sku)
                for fee in (item.get("ItemFeeList") or []):
                    ft = fee.get("FeeType") or fee.get("feeType") or ""
                    amt = _money_amount(fee.get("FeeAmount") or fee.get("feeAmount"))
                    if _is_shipping_fee(ft):
                        shipping[sku] += amt
                    elif _is_referral_fee(ft):
                        referral[sku] += amt
            if len(item_skus) == 1:
                sku_single = next(iter(item_skus))
                if event_ship > 0:
                    shipping[sku_single] += event_ship
                if event_ref > 0:
                    referral[sku_single] += event_ref
    result = {}
    for sku in set(shipping) | set(referral):
        result[sku] = {
            "shipping": round(shipping.get(sku, 0.0), 2),
            "referral": round(referral.get(sku, 0.0), 2),
        }
    return result


async def fetch_finance_breakdown(client, token, order_id):
    try:
        resp = await client.get(
            f"{SP_API_ENDPOINT}/finances/v0/orders/{order_id}/financialEvents",
            headers={"x-amz-access-token": token},
        )
        if resp.status_code == 429:
            await asyncio.sleep(3)
            resp = await client.get(
                f"{SP_API_ENDPOINT}/finances/v0/orders/{order_id}/financialEvents",
                headers={"x-amz-access-token": token},
            )
        if resp.status_code >= 400:
            return {}
        return _extract_breakdown(resp.json())
    except Exception:
        return {}


async def get_shiprocket_token() -> str | None:
    email = os.getenv("SHIPROCKET_EMAIL")
    password = os.getenv("SHIPROCKET_PASSWORD")
    if not email or not password:
        log("  Shiprocket login: SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD not set in env")
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{SHIPROCKET_BASE}/auth/login",
                json={"email": email, "password": password},
            )
            if resp.status_code != 200:
                log(f"  Shiprocket login HTTP {resp.status_code}: {resp.text[:200]}")
                return None
            token = resp.json().get("token")
            if not token:
                log(f"  Shiprocket login: no token in response")
                return None
            return token
    except Exception as e:
        log(f"  Shiprocket login error: {e}")
    return None


async def fetch_shiprocket_rates(client, token, origin_pin, dest_pin, weight_kg, dims=None):
    """Call Shiprocket serviceability API. Returns None on any failure.

    dims: optional {"length", "breadth", "height"} in cm. Passing dimensions
    materially increases carrier availability (some couriers reject quotes
    when dims are missing).
    """
    origin_pin = normalize_pincode(origin_pin)
    dest_pin = normalize_pincode(dest_pin)
    if len(origin_pin) != 6 or len(dest_pin) != 6:
        return None
    params = {
        "pickup_postcode": origin_pin,
        "delivery_postcode": dest_pin,
        "weight": max(float(weight_kg or 0.5), 0.1),
        "cod": 0,
        "declared_value": 500,
    }
    if dims:
        if dims.get("length"):
            params["length"] = int(round(float(dims["length"])))
        if dims.get("breadth"):
            params["breadth"] = int(round(float(dims["breadth"])))
        if dims.get("height"):
            params["height"] = int(round(float(dims["height"])))
    try:
        resp = await client.get(
            f"{SHIPROCKET_BASE}/courier/serviceability/",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            log(f"  Shiprocket HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        data = resp.json()
        api_status = data.get("status")
        if api_status is not None and str(api_status) not in ("200", "1"):
            log(f"  Shiprocket API status={api_status} msg={data.get('message')}")
            return None
        companies = data.get("data", {}).get("available_courier_companies", []) or []
        if not companies:
            return None
        rates = {}
        for courier in companies:
            name = str(courier.get("courier_name", "")).lower()
            carrier_key = None
            for pattern, key in CARRIER_MAP.items():
                if pattern in name:
                    carrier_key = key
                    break
            if not carrier_key:
                continue
            cost_raw = (
                courier.get("rate")
                or courier.get("freight_charge")
                or courier.get("total_charges")
                or 0
            )
            try:
                cost = float(cost_raw)
            except (TypeError, ValueError):
                cost = 0.0
            if cost <= 0:
                continue
            etd = courier.get("estimated_delivery_days") or courier.get("etd") or ""
            if carrier_key not in rates or cost < rates[carrier_key]["cost"]:
                rates[carrier_key] = {"cost": round(cost, 2), "etd": f"{etd} days" if etd else "N/A"}
        return rates if rates else None
    except Exception as e:
        log(f"  Shiprocket error: {e}")
        return None


def find_cheapest(rates):
    if not rates:
        return None, 0
    best = min(rates, key=lambda c: rates[c]["cost"])
    return best, rates[best]["cost"]


def normalize_pincode(pin):
    return re.sub(r"\D", "", str(pin or ""))[:6]


async def db_write(updates, query_template, max_retries=3):
    """Write updates to DB with a fresh engine per batch. Retries on transient connection drops."""
    last_err = None
    for attempt in range(1, max_retries + 1):
        eng = create_engine()
        try:
            async with eng.begin() as conn:
                for u in updates:
                    await conn.execute(text(query_template), u)
            return
        except Exception as e:
            last_err = e
            log(f"  db_write attempt {attempt}/{max_retries} failed: {type(e).__name__}: {e}")
            await asyncio.sleep(2 * attempt)
        finally:
            await eng.dispose()
    raise last_err


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", help="ISO date (YYYY-MM-DD); only refetch orders with purchase_date >= this", default=None)
    parser.add_argument("--force", action="store_true", help="Recalc rows even if already sp_api_finance")
    args = parser.parse_args()

    log("=" * 60)
    log("BULK SHIPPING COST RE-FETCH")
    log("=" * 60)
    if args.since:
        log(f"Date filter: purchase_date >= {args.since}")
    if args.force:
        log("Force mode: recalculating rows regardless of existing rate_source")

    where_extra = []
    sql_params = {}
    if args.since:
        where_extra.append("o.purchase_date >= :since_date")
        sql_params["since_date"] = datetime.strptime(args.since, "%Y-%m-%d").date()
    if not args.force:
        where_extra.append("se.rate_source != 'sp_api_finance'")
    extra_sql = (" AND " + " AND ".join(where_extra)) if where_extra else ""

    # Load orders
    eng = create_engine()
    try:
        async with eng.connect() as conn:
            result = await conn.execute(text(f"""
                SELECT
                    o.amazon_order_id, o.sku, o.fulfillment_channel,
                    o.shipping_price, o.ship_postal_code,
                    se.chargeable_weight_kg, se.package_weight_kg,
                    se.destination_pincode, se.rate_source as old_rate_source,
                    ps.length_cm, ps.width_cm, ps.height_cm
                FROM orders o
                JOIN shipment_estimates se ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
                LEFT JOIN product_specifications ps ON ps.sku = o.sku
                WHERE o.ship_postal_code IS NOT NULL AND o.ship_postal_code != ''
                  {extra_sql}
                ORDER BY o.purchase_date DESC NULLS LAST
            """), sql_params)
            orders = [dict(row._mapping) for row in result.fetchall()]

            # Also count already done
            done_result = await conn.execute(text("SELECT COUNT(*) FROM shipment_estimates WHERE rate_source = 'sp_api_finance'"))
            already_done = done_result.scalar()
    finally:
        await eng.dispose()

    log(f"\nOrders remaining to process: {len(orders)}")
    log(f"Already updated (sp_api_finance): {already_done}")

    amazon_orders = [o for o in orders if "amazon" in (o["fulfillment_channel"] or "").lower() or "afn" in (o["fulfillment_channel"] or "").lower()]
    merchant_orders = [o for o in orders if o not in amazon_orders]
    log(f"  Amazon-fulfilled (remaining): {len(amazon_orders)}")
    log(f"  Merchant-fulfilled: {len(merchant_orders)}")

    # ═══ PART 1: Amazon-fulfilled → SP-API Finance ═══
    log(f"\n{'='*60}")
    log("PART 1: SP-API Finance for Amazon-fulfilled orders")
    log(f"{'='*60}")

    sp_api_success = 0
    sp_api_no_data = 0
    sp_api_referral_success = 0

    order_id_list = list(dict.fromkeys(o["amazon_order_id"] for o in amazon_orders))
    order_map = defaultdict(list)
    for o in amazon_orders:
        order_map[o["amazon_order_id"]].append(o)

    log(f"Unique order IDs to query: {len(order_id_list)}")

    token = await get_sp_api_token()
    batch_updates = []
    fee_updates = []

    UPDATE_ORDER_SQL = """
        UPDATE orders SET shipping_price = :cost
        WHERE amazon_order_id = :oid AND sku = :sku AND (shipping_price IS NULL OR shipping_price = 0)
    """
    UPDATE_SE_SQL = """
        UPDATE shipment_estimates SET amazon_shipping_cost = :cost, rate_source = 'sp_api_finance'
        WHERE amazon_order_id = :oid AND sku = :sku
    """
    UPDATE_FEE_SQL = """
        UPDATE orders SET amazon_fee = :fee
        WHERE amazon_order_id = :oid AND sku = :sku
    """

    async with httpx.AsyncClient(timeout=30) as client:
        for i, order_id in enumerate(order_id_list):
            if i > 0 and i % 200 == 0:
                token = await get_sp_api_token()

            breakdown = await fetch_finance_breakdown(client, token, order_id)

            for o in order_map[order_id]:
                sku = o["sku"]
                entry = breakdown.get(sku, {})
                cost = float(entry.get("shipping") or 0.0)
                referral = float(entry.get("referral") or 0.0)
                if cost > 0:
                    sp_api_success += 1
                    batch_updates.append({"cost": cost, "oid": order_id, "sku": sku})
                else:
                    sp_api_no_data += 1
                if referral > 0:
                    sp_api_referral_success += 1
                    fee_updates.append({"fee": referral, "oid": order_id, "sku": sku})

            if len(batch_updates) >= SP_API_BATCH:
                # Write orders + shipment_estimates in two batches
                await db_write(batch_updates, UPDATE_ORDER_SQL)
                await db_write(batch_updates, UPDATE_SE_SQL)
                log(f"  [{i+1}/{len(order_id_list)}] Committed {len(batch_updates)} shipping updates (total success: {sp_api_success})")
                batch_updates = []

            if len(fee_updates) >= SP_API_BATCH:
                await db_write(fee_updates, UPDATE_FEE_SQL)
                log(f"  [{i+1}/{len(order_id_list)}] Committed {len(fee_updates)} referral-fee updates (total success: {sp_api_referral_success})")
                fee_updates = []

            if i < len(order_id_list) - 1:
                await asyncio.sleep(FINANCE_DELAY)

    if batch_updates:
        await db_write(batch_updates, UPDATE_ORDER_SQL)
        await db_write(batch_updates, UPDATE_SE_SQL)
        log(f"  Final shipping batch: {len(batch_updates)} updates")
    if fee_updates:
        await db_write(fee_updates, UPDATE_FEE_SQL)
        log(f"  Final referral-fee batch: {len(fee_updates)} updates")

    log(f"\n  SP-API results:")
    log(f"    Shipping successful:   {sp_api_success}")
    log(f"    Referral fee captured: {sp_api_referral_success}")
    log(f"    No data:    {sp_api_no_data}")
    log(f"    Previously done: {already_done}")
    log(f"    Total SP-API success: {sp_api_success + already_done}")

    # ═══ PART 2: Merchant-fulfilled → Shiprocket live ═══
    log(f"\n{'='*60}")
    log("PART 2: Shiprocket live rates for Merchant-fulfilled orders")
    log(f"{'='*60}")

    shiprocket_success = 0
    shiprocket_failed = 0

    sr_token = await get_shiprocket_token()
    if not sr_token:
        log("  ERROR: Could not login to Shiprocket!")
        shiprocket_failed = len(merchant_orders)
    else:
        batch_updates = []
        UPDATE_SR_SQL = """
            UPDATE shipment_estimates SET
                delhivery_cost = :delhivery_cost, bluedart_cost = :bluedart_cost,
                dtdc_cost = :dtdc_cost, xpressbees_cost = :xpressbees_cost, ekart_cost = :ekart_cost,
                delhivery_etd = :delhivery_etd, bluedart_etd = :bluedart_etd,
                dtdc_etd = :dtdc_etd, xpressbees_etd = :xpressbees_etd, ekart_etd = :ekart_etd,
                cheapest_provider = :cheapest_provider, cheapest_cost = :cheapest_cost,
                rate_source = 'shiprocket', estimated_at = NOW()
            WHERE amazon_order_id = :oid AND sku = :sku
        """

        async with httpx.AsyncClient(timeout=15) as client:
            for i, order in enumerate(merchant_orders):
                dest_pin = normalize_pincode(order["destination_pincode"] or order["ship_postal_code"])
                if len(dest_pin) != 6:
                    shiprocket_failed += 1
                    continue

                weight = float(order["chargeable_weight_kg"] or order["package_weight_kg"] or 0.5)
                dims = {}
                if order.get("length_cm"):
                    dims["length"] = order["length_cm"]
                if order.get("width_cm"):
                    dims["breadth"] = order["width_cm"]
                if order.get("height_cm"):
                    dims["height"] = order["height_cm"]
                rates = await fetch_shiprocket_rates(
                    client, sr_token, ORIGIN_PINCODE, dest_pin, weight, dims or None
                )

                if rates:
                    shiprocket_success += 1
                    cc, ccost = find_cheapest(rates)
                    batch_updates.append({
                        "delhivery_cost": (rates.get("delhivery") or {}).get("cost"),
                        "bluedart_cost": (rates.get("bluedart") or {}).get("cost"),
                        "dtdc_cost": (rates.get("dtdc") or {}).get("cost"),
                        "xpressbees_cost": (rates.get("xpressbees") or {}).get("cost"),
                        "ekart_cost": (rates.get("ekart") or {}).get("cost"),
                        "delhivery_etd": (rates.get("delhivery") or {}).get("etd"),
                        "bluedart_etd": (rates.get("bluedart") or {}).get("etd"),
                        "dtdc_etd": (rates.get("dtdc") or {}).get("etd"),
                        "xpressbees_etd": (rates.get("xpressbees") or {}).get("etd"),
                        "ekart_etd": (rates.get("ekart") or {}).get("etd"),
                        "cheapest_provider": CARRIER_LABELS.get(cc, cc),
                        "cheapest_cost": round(ccost, 2),
                        "oid": order["amazon_order_id"], "sku": order["sku"],
                    })
                else:
                    shiprocket_failed += 1

                if len(batch_updates) >= SHIPROCKET_BATCH:
                    await db_write(batch_updates, UPDATE_SR_SQL)
                    log(f"  [{i+1}/{len(merchant_orders)}] Committed {len(batch_updates)} (success: {shiprocket_success})")
                    batch_updates = []

                if i > 0 and i % 200 == 0:
                    sr_token = await get_shiprocket_token() or sr_token

        if batch_updates:
            await db_write(batch_updates, UPDATE_SR_SQL)

    log(f"\n  Shiprocket results:")
    log(f"    Successful: {shiprocket_success}")
    log(f"    Failed:     {shiprocket_failed}")

    # ═══ SUMMARY ═══
    log(f"\n{'='*60}")
    log("FINAL SUMMARY")
    log(f"{'='*60}")
    total_amz = len(amazon_orders) + already_done
    total_sp_success = sp_api_success + already_done
    log(f"Amazon-fulfilled (total {total_amz}):")
    log(f"  SP-API Finance success: {total_sp_success}")
    log(f"  No data (pending/unsettled): {sp_api_no_data}")
    log(f"")
    log(f"Merchant-fulfilled ({len(merchant_orders)}):")
    log(f"  Shiprocket live success: {shiprocket_success}")
    log(f"  Shiprocket failed:       {shiprocket_failed}")
    log(f"")
    total_success = total_sp_success + shiprocket_success
    total_all = total_amz + len(merchant_orders)
    log(f"Overall: {total_success}/{total_all} updated with real prices ({round(total_success/max(total_all,1)*100, 1)}%)")


if __name__ == "__main__":
    asyncio.run(main())
