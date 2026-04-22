"""Repair Amazon-fulfilled shipment rows that were incorrectly assigned estimated Amazon costs.

These rows should only carry an Amazon shipping cost when SP API Finance (or the synced
orders.shipping_price field) provides an actual value. Alternative carrier quotes are preserved.

Usage:
  python tasks/repair_amazon_estimated_shipping.py
  python tasks/repair_amazon_estimated_shipping.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import os

import asyncpg
from dotenv import load_dotenv


COUNT_SQL = """
SELECT COUNT(*)::int AS bad_rows
FROM shipment_estimates se
JOIN orders o
  ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
WHERE (
    LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
    OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
  )
  AND COALESCE(o.shipping_price, 0) <= 0
  AND se.rate_source IN ('shiprocket', 'fallback')
  AND COALESCE(se.amazon_shipping_cost, 0) > 0
"""

SAMPLE_SQL = """
SELECT
  o.amazon_order_id,
  o.sku,
  o.purchase_date,
  o.fulfillment_channel,
  o.shipping_price,
  se.amazon_shipping_cost,
  se.rate_source,
  se.cheapest_provider,
  se.cheapest_cost
FROM shipment_estimates se
JOIN orders o
  ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
WHERE (
    LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
    OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
  )
  AND COALESCE(o.shipping_price, 0) <= 0
  AND se.rate_source IN ('shiprocket', 'fallback')
  AND COALESCE(se.amazon_shipping_cost, 0) > 0
ORDER BY o.purchase_date DESC NULLS LAST
LIMIT 10
"""

REPAIR_SQL = """
WITH bad_rows AS (
  SELECT
    se.id,
    best.provider AS cheapest_provider,
    best.cost AS cheapest_cost
  FROM shipment_estimates se
  JOIN orders o
    ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
  LEFT JOIN LATERAL (
    SELECT provider, cost
    FROM (
      VALUES
        ('Delhivery', se.delhivery_cost),
        ('BlueDart', se.bluedart_cost),
        ('DTDC', se.dtdc_cost),
        ('Xpressbees', se.xpressbees_cost),
        ('Ekart', se.ekart_cost)
    ) AS carriers(provider, cost)
    WHERE cost IS NOT NULL AND cost > 0
    ORDER BY cost ASC, provider ASC
    LIMIT 1
  ) AS best ON TRUE
  WHERE (
      LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
      OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
    )
    AND COALESCE(o.shipping_price, 0) <= 0
    AND se.rate_source IN ('shiprocket', 'fallback')
    AND COALESCE(se.amazon_shipping_cost, 0) > 0
)
UPDATE shipment_estimates se
SET
  amazon_shipping_cost = 0,
  cheapest_provider = bad_rows.cheapest_provider,
  cheapest_cost = bad_rows.cheapest_cost,
  estimated_at = NOW()
FROM bad_rows
WHERE se.id = bad_rows.id
"""


async def main(apply_changes: bool) -> None:
    load_dotenv()
    database_url = os.getenv("SUPABASE_URL")
    if not database_url:
        raise RuntimeError("Missing SUPABASE_URL in environment variables")

    conn = await asyncpg.connect(database_url.replace("postgresql+asyncpg://", "postgresql://"), statement_cache_size=0)
    try:
        count_before = await conn.fetchval(COUNT_SQL)
        print(f"Bad Amazon-estimated rows before repair: {count_before}")

        sample_rows = await conn.fetch(SAMPLE_SQL)
        if sample_rows:
            print("Sample rows:")
            for row in sample_rows:
                print(
                    f"  {row['amazon_order_id']} | {row['sku']} | "
                    f"src={row['rate_source']} | amazon={row['amazon_shipping_cost']} | "
                    f"best={row['cheapest_provider']} {row['cheapest_cost']}"
                )

        if not apply_changes:
            print("Dry run only. Re-run with --apply to repair these rows.")
            return

        result = await conn.execute(REPAIR_SQL)
        updated = int(result.split()[-1]) if result.startswith("UPDATE ") else 0
        print(f"Rows updated: {updated}")

        count_after = await conn.fetchval(COUNT_SQL)
        print(f"Bad Amazon-estimated rows after repair: {count_after}")
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply the repair update.")
    args = parser.parse_args()
    asyncio.run(main(apply_changes=args.apply))
