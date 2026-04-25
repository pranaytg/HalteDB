"""Backfill Amazon Finance shipping/referral actuals using PgBouncer-safe asyncpg writes.

Defaults to recent history because a full historical run can take a long time.

Usage:
  python tasks/backfill_amazon_finance_actuals.py
  python tasks/backfill_amazon_finance_actuals.py --days 90 --delay 2.1
  python tasks/backfill_amazon_finance_actuals.py --days 365 --limit 500
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


SELECT_ORDERS_SQL = """
SELECT o.amazon_order_id, o.sku
FROM orders o
LEFT JOIN shipment_estimates se
  ON se.amazon_order_id = o.amazon_order_id AND se.sku = o.sku
WHERE o.item_price > 0
  AND (
    LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
    OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
  )
  AND o.purchase_date >= NOW() - ($1::int * INTERVAL '1 day')
  AND (
    COALESCE(o.amazon_fee, 0) <= 0
    OR COALESCE(o.shipping_price, 0) <= 0
    OR COALESCE(se.rate_source, '') <> 'sp_api_finance'
  )
ORDER BY o.purchase_date ASC NULLS LAST
"""


async def main(days: int, delay: float, limit: int | None) -> dict[str, int]:
    load_dotenv()
    database_url = os.getenv("SUPABASE_URL")
    if not database_url:
        raise RuntimeError("Missing SUPABASE_URL in environment variables")

    conn = await asyncpg.connect(
        database_url.replace("postgresql+asyncpg://", "postgresql://"),
        statement_cache_size=0,
    )

    try:
        rows = await conn.fetch(SELECT_ORDERS_SQL, days)

        order_map: dict[str, list[str]] = defaultdict(list)
        for row in rows:
            order_map[str(row["amazon_order_id"])].append(str(row["sku"]))

        order_ids = list(order_map.keys())
        if limit is not None:
            order_ids = order_ids[:limit]
            order_map = {order_id: order_map[order_id] for order_id in order_ids}
        print(f"Amazon orders queued for Finance backfill: {len(order_ids)} (rows: {len(rows)})")
        if not order_ids:
            return {"orders_scanned": 0, "shipping_updates": 0, "fee_updates": 0, "no_data_orders": 0}

        access_token = await get_amazon_access_token()
        shipping_updates = 0
        fee_updates = 0
        no_data = 0

        async with httpx.AsyncClient(timeout=30) as client:
            for index, order_id in enumerate(order_ids):
                breakdown = await fetch_amazon_order_financial_breakdown(client, access_token, order_id)
                had_any_data = False

                for sku in order_map[order_id]:
                    entry = breakdown.get(sku, {})
                    shipping = float(entry.get("shipping") or 0.0)
                    referral = float(entry.get("referral") or 0.0)

                    if shipping > 0:
                        had_any_data = True
                        await conn.execute(
                            """
                            UPDATE orders
                            SET shipping_price = $1
                            WHERE amazon_order_id = $2 AND sku = $3
                            """,
                            shipping,
                            order_id,
                            sku,
                        )
                        await conn.execute(
                            """
                            UPDATE shipment_estimates
                            SET amazon_shipping_cost = $1, rate_source = 'sp_api_finance', estimated_at = NOW()
                            WHERE amazon_order_id = $2 AND sku = $3
                            """,
                            shipping,
                            order_id,
                            sku,
                        )
                        shipping_updates += 1

                    if referral > 0:
                        had_any_data = True
                        await conn.execute(
                            """
                            UPDATE orders
                            SET amazon_fee = $1
                            WHERE amazon_order_id = $2 AND sku = $3
                            """,
                            referral,
                            order_id,
                            sku,
                        )
                        fee_updates += 1

                if not had_any_data:
                    no_data += 1

                if (index + 1) % 50 == 0 or index == len(order_ids) - 1:
                    print(
                        f"[{index + 1}/{len(order_ids)}] shipping_updates={shipping_updates} "
                        f"fee_updates={fee_updates} no_data_orders={no_data}"
                    )

                if index < len(order_ids) - 1 and delay > 0:
                    await asyncio.sleep(delay)

        return {
            "orders_scanned": len(order_ids),
            "shipping_updates": shipping_updates,
            "fee_updates": fee_updates,
            "no_data_orders": no_data,
        }
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=15, help="Backfill orders from the last N days.")
    parser.add_argument("--delay", type=float, default=2.1, help="Delay between Finance API requests.")
    parser.add_argument("--limit", type=int, default=None, help="Optional max distinct Amazon order IDs.")
    args = parser.parse_args()
    asyncio.run(main(days=args.days, delay=args.delay, limit=args.limit))
