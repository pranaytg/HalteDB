"""Read-only audit: compare DB Amazon fee + shipping with SP-API Finance for recent orders.

Does NOT write to the database. Prints a per-order report and a summary so you can
see which rows are actually missing data vs. which are pending on Amazon's side.

Usage:
  python tasks/audit_recent_amazon_finance.py
  python tasks/audit_recent_amazon_finance.py --limit 170 --delay 2.1
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import os
import sys
from collections import defaultdict
from pathlib import Path

import asyncpg
import httpx
from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

spec = importlib.util.spec_from_file_location("local_sp_api", REPO_ROOT / "sp_api.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load local sp_api.py")
local_sp_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local_sp_api)
get_amazon_access_token = local_sp_api.get_amazon_access_token
fetch_amazon_order_financial_breakdown = local_sp_api.fetch_amazon_order_financial_breakdown


SELECT_RECENT_ORDERS_SQL = """
WITH recent AS (
  SELECT DISTINCT amazon_order_id, MAX(purchase_date) AS latest
  FROM orders
  WHERE item_price > 0
    AND (
      LOWER(COALESCE(fulfillment_channel, '')) LIKE '%amazon%'
      OR LOWER(COALESCE(fulfillment_channel, '')) LIKE '%afn%'
    )
  GROUP BY amazon_order_id
  ORDER BY latest DESC NULLS LAST
  LIMIT $1
)
SELECT
  o.amazon_order_id,
  o.sku,
  o.purchase_date,
  o.item_price,
  o.amazon_fee       AS db_fee,
  o.shipping_price   AS db_shipping,
  se.amazon_shipping_cost AS se_shipping,
  se.rate_source
FROM orders o
LEFT JOIN shipment_estimates se
  ON se.amazon_order_id = o.amazon_order_id AND se.sku = o.sku
WHERE o.amazon_order_id IN (SELECT amazon_order_id FROM recent)
ORDER BY o.purchase_date DESC NULLS LAST, o.amazon_order_id, o.sku
"""


def _fmt(v) -> str:
    if v is None:
        return "None"
    try:
        return f"{float(v):.2f}"
    except Exception:
        return str(v)


async def main(limit: int, delay: float) -> None:
    load_dotenv()
    database_url = os.getenv("SUPABASE_URL")
    if not database_url:
        raise RuntimeError("Missing SUPABASE_URL in environment variables")

    conn = await asyncpg.connect(
        database_url.replace("postgresql+asyncpg://", "postgresql://"),
        statement_cache_size=0,
    )

    try:
        rows = await conn.fetch(SELECT_RECENT_ORDERS_SQL, limit)
    finally:
        await conn.close()

    if not rows:
        print("No orders returned.")
        return

    print(f"Fetched {len(rows)} SKU rows across {len({r['amazon_order_id'] for r in rows})} distinct Amazon orders.")

    order_map: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        order_map[r["amazon_order_id"]].append(dict(r))

    order_ids = list(order_map.keys())
    access_token = await get_amazon_access_token()

    fee_missing_in_db = 0       # SP-API has referral > 0, DB fee <= 0 → we lost it
    fee_mismatch = 0            # Both have values but differ > ₹0.50
    fee_db_has_sp_empty = 0     # DB has fee, SP-API returned nothing (odd)
    fee_both_pending = 0        # Neither has data — Amazon hasn't settled
    fee_ok = 0

    ship_missing_in_db = 0
    ship_mismatch = 0
    ship_db_has_sp_empty = 0
    ship_both_pending = 0
    ship_ok = 0

    rate_source_counts: dict[str, int] = defaultdict(int)

    mismatches: list[str] = []

    async with httpx.AsyncClient(timeout=30) as client:
        for idx, order_id in enumerate(order_ids):
            breakdown = await fetch_amazon_order_financial_breakdown(client, access_token, order_id)

            for entry in order_map[order_id]:
                sku = entry["sku"]
                sp = breakdown.get(sku, {})
                sp_ship = float(sp.get("shipping") or 0.0)
                sp_ref = float(sp.get("referral") or 0.0)

                db_fee = float(entry["db_fee"] or 0.0)
                db_ship = float(entry["db_shipping"] or 0.0)
                se_ship = float(entry["se_shipping"] or 0.0)
                effective_db_ship = db_ship if db_ship > 0 else se_ship

                rate_source_counts[entry["rate_source"] or "NULL"] += 1

                # Fee comparison
                if sp_ref > 0 and db_fee <= 0:
                    fee_missing_in_db += 1
                    mismatches.append(
                        f"FEE_MISSING   {order_id} sku={sku} sp_ref={_fmt(sp_ref)} db_fee={_fmt(db_fee)}"
                    )
                elif sp_ref > 0 and db_fee > 0 and abs(sp_ref - db_fee) > 0.5:
                    fee_mismatch += 1
                    mismatches.append(
                        f"FEE_DIFFER    {order_id} sku={sku} sp_ref={_fmt(sp_ref)} db_fee={_fmt(db_fee)}"
                    )
                elif sp_ref == 0 and db_fee > 0:
                    fee_db_has_sp_empty += 1
                elif sp_ref == 0 and db_fee <= 0:
                    fee_both_pending += 1
                else:
                    fee_ok += 1

                # Shipping comparison (only meaningful for Amazon-fulfilled)
                if sp_ship > 0 and effective_db_ship <= 0:
                    ship_missing_in_db += 1
                    mismatches.append(
                        f"SHIP_MISSING  {order_id} sku={sku} sp_ship={_fmt(sp_ship)} "
                        f"db_ship={_fmt(db_ship)} se_ship={_fmt(se_ship)} rate_source={entry['rate_source']}"
                    )
                elif sp_ship > 0 and effective_db_ship > 0 and abs(sp_ship - effective_db_ship) > 0.5:
                    ship_mismatch += 1
                    mismatches.append(
                        f"SHIP_DIFFER   {order_id} sku={sku} sp_ship={_fmt(sp_ship)} "
                        f"effective_db={_fmt(effective_db_ship)} (db={_fmt(db_ship)}, se={_fmt(se_ship)})"
                    )
                elif sp_ship == 0 and effective_db_ship > 0:
                    ship_db_has_sp_empty += 1
                elif sp_ship == 0 and effective_db_ship <= 0:
                    ship_both_pending += 1
                else:
                    ship_ok += 1

            if (idx + 1) % 20 == 0 or idx == len(order_ids) - 1:
                print(f"[{idx + 1}/{len(order_ids)}] orders scanned")

            if idx < len(order_ids) - 1 and delay > 0:
                await asyncio.sleep(delay)

    print()
    print("=" * 70)
    print("DETAILED MISMATCHES (first 80)")
    print("=" * 70)
    for line in mismatches[:80]:
        print(line)
    if len(mismatches) > 80:
        print(f"... and {len(mismatches) - 80} more")

    total = sum([fee_missing_in_db, fee_mismatch, fee_db_has_sp_empty, fee_both_pending, fee_ok])
    print()
    print("=" * 70)
    print(f"SUMMARY  (total SKU rows audited: {total})")
    print("=" * 70)
    print("Amazon Fee (referral):")
    print(f"  DB missing but SP-API has it       : {fee_missing_in_db}")
    print(f"  Values differ > Rs.0.50            : {fee_mismatch}")
    print(f"  DB has fee, SP-API empty           : {fee_db_has_sp_empty}")
    print(f"  Both empty (Amazon not settled yet): {fee_both_pending}")
    print(f"  Match                              : {fee_ok}")
    print()
    print("Shipping (Amazon-fulfilled):")
    print(f"  DB missing but SP-API has it       : {ship_missing_in_db}")
    print(f"  Values differ > Rs.0.50            : {ship_mismatch}")
    print(f"  DB has shipping, SP-API empty      : {ship_db_has_sp_empty}")
    print(f"  Both empty (not settled yet)       : {ship_both_pending}")
    print(f"  Match                              : {ship_ok}")
    print()
    print("Rate source distribution in audited rows:")
    for source, cnt in sorted(rate_source_counts.items(), key=lambda x: -x[1]):
        print(f"  {source:20s}: {cnt}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=170, help="Most recent distinct Amazon orders to audit.")
    parser.add_argument("--delay", type=float, default=2.1, help="Delay between Finance API calls (seconds).")
    args = parser.parse_args()
    asyncio.run(main(limit=args.limit, delay=args.delay))
