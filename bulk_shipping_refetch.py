"""
Bulk re-fetch shipping costs for all orders:
  - Amazon-fulfilled: SP-API Finance API
  - Merchant-fulfilled: Shiprocket live API (NO rate card fallback)

Processes in batches to avoid Supabase connection timeouts.
Skips orders already updated with sp_api_finance source.
"""
import asyncio
import os
import re
import sys
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
    return create_async_engine(DATABASE_URL, pool_size=2, max_overflow=0, pool_pre_ping=True)


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


def _money_amount(val) -> float:
    if isinstance(val, dict):
        return abs(float(val.get("CurrencyAmount") or val.get("currencyAmount") or 0))
    return abs(float(val or 0))


def _extract_shipping_costs(data: dict) -> dict:
    payload = data.get("payload", {})
    events = payload.get("FinancialEvents", {})
    sku_costs = defaultdict(float)
    for key in ("ShipmentEventList", "ShipmentSettleEventList"):
        for event in (events.get(key) or []):
            if not isinstance(event, dict):
                continue
            event_fee = 0
            for fee in (event.get("FeeList") or []):
                ft = fee.get("FeeType") or fee.get("feeType") or ""
                if _is_shipping_fee(ft):
                    event_fee += _money_amount(fee.get("FeeAmount") or fee.get("feeAmount"))
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
                    if _is_shipping_fee(ft):
                        sku_costs[sku] += _money_amount(fee.get("FeeAmount") or fee.get("feeAmount"))
            if event_fee > 0 and len(item_skus) == 1:
                sku_costs[next(iter(item_skus))] += event_fee
    return {sku: round(cost, 2) for sku, cost in sku_costs.items() if cost > 0}


async def fetch_finance_shipping(client, token, order_id):
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
        return _extract_shipping_costs(resp.json())
    except Exception:
        return {}


async def get_shiprocket_token() -> str | None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{SHIPROCKET_BASE}/auth/login", json={
                "email": os.getenv("SHIPROCKET_EMAIL"),
                "password": os.getenv("SHIPROCKET_PASSWORD"),
            })
            if resp.status_code == 200:
                return resp.json().get("token")
    except Exception as e:
        log(f"Shiprocket login error: {e}")
    return None


async def fetch_shiprocket_rates(client, token, origin_pin, dest_pin, weight_kg):
    try:
        resp = await client.get(
            f"{SHIPROCKET_BASE}/courier/serviceability/",
            params={"pickup_postcode": origin_pin, "delivery_postcode": dest_pin, "weight": max(weight_kg, 0.1), "cod": 0},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        rates = {}
        for courier in data.get("data", {}).get("available_courier_companies", []):
            name = courier.get("courier_name", "").lower()
            carrier_key = None
            for pattern, key in CARRIER_MAP.items():
                if pattern in name:
                    carrier_key = key
                    break
            if not carrier_key:
                continue
            cost = float(courier.get("rate", 0))
            etd = courier.get("estimated_delivery_days", "")
            if carrier_key not in rates or cost < rates[carrier_key]["cost"]:
                rates[carrier_key] = {"cost": round(cost, 2), "etd": f"{etd} days" if etd else "N/A"}
        return rates if rates else None
    except Exception:
        return None


def find_cheapest(rates):
    if not rates:
        return None, 0
    best = min(rates, key=lambda c: rates[c]["cost"])
    return best, rates[best]["cost"]


def normalize_pincode(pin):
    return re.sub(r"\D", "", str(pin or ""))[:6]


async def db_write(updates, query_template):
    """Write updates to DB with a fresh engine per batch."""
    eng = create_engine()
    try:
        async with eng.begin() as conn:
            for u in updates:
                await conn.execute(text(query_template), u)
    finally:
        await eng.dispose()


async def main():
    log("=" * 60)
    log("BULK SHIPPING COST RE-FETCH")
    log("=" * 60)

    # Load orders — skip already-updated sp_api_finance rows
    eng = create_engine()
    try:
        async with eng.connect() as conn:
            result = await conn.execute(text("""
                SELECT
                    o.amazon_order_id, o.sku, o.fulfillment_channel,
                    o.shipping_price, o.ship_postal_code,
                    se.chargeable_weight_kg, se.package_weight_kg,
                    se.destination_pincode, se.rate_source as old_rate_source
                FROM orders o
                JOIN shipment_estimates se ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
                WHERE o.ship_postal_code IS NOT NULL AND o.ship_postal_code != ''
                  AND se.rate_source != 'sp_api_finance'
                ORDER BY o.purchase_date DESC NULLS LAST
            """))
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

    order_id_list = list(dict.fromkeys(o["amazon_order_id"] for o in amazon_orders))
    order_map = defaultdict(list)
    for o in amazon_orders:
        order_map[o["amazon_order_id"]].append(o)

    log(f"Unique order IDs to query: {len(order_id_list)}")

    token = await get_sp_api_token()
    batch_updates = []

    UPDATE_ORDER_SQL = """
        UPDATE orders SET shipping_price = :cost
        WHERE amazon_order_id = :oid AND sku = :sku AND (shipping_price IS NULL OR shipping_price = 0)
    """
    UPDATE_SE_SQL = """
        UPDATE shipment_estimates SET amazon_shipping_cost = :cost, rate_source = 'sp_api_finance'
        WHERE amazon_order_id = :oid AND sku = :sku
    """

    async with httpx.AsyncClient(timeout=30) as client:
        for i, order_id in enumerate(order_id_list):
            if i > 0 and i % 200 == 0:
                token = await get_sp_api_token()

            costs = await fetch_finance_shipping(client, token, order_id)

            for o in order_map[order_id]:
                sku = o["sku"]
                cost = costs.get(sku, 0.0)
                if cost > 0:
                    sp_api_success += 1
                    batch_updates.append({"cost": cost, "oid": order_id, "sku": sku})
                else:
                    sp_api_no_data += 1

            if len(batch_updates) >= SP_API_BATCH:
                # Write orders + shipment_estimates in two batches
                await db_write(batch_updates, UPDATE_ORDER_SQL)
                await db_write(batch_updates, UPDATE_SE_SQL)
                log(f"  [{i+1}/{len(order_id_list)}] Committed {len(batch_updates)} updates (total success: {sp_api_success})")
                batch_updates = []

            if i < len(order_id_list) - 1:
                await asyncio.sleep(FINANCE_DELAY)

    if batch_updates:
        await db_write(batch_updates, UPDATE_ORDER_SQL)
        await db_write(batch_updates, UPDATE_SE_SQL)
        log(f"  Final batch: {len(batch_updates)} updates")

    log(f"\n  SP-API results:")
    log(f"    Successful: {sp_api_success}")
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
                rates = await fetch_shiprocket_rates(client, sr_token, ORIGIN_PINCODE, dest_pin, weight)

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
