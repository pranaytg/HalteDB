"""Database Audit Script — checks for duplicates, orphans, data quality issues."""
import asyncio
import os
import json
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")
engine = create_async_engine(DATABASE_URL)
Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def audit():
    async with Session() as session:
        results = {}

        # 1. Table row counts
        tables = ["orders", "inventory", "cogs", "estimated_cogs", "sync_meta",
                   "product_specifications", "shipment_estimates", "customers"]
        counts = {}
        for t in tables:
            try:
                r = await session.execute(text(f'SELECT COUNT(*) FROM "{t}"'))
                counts[t] = r.scalar()
            except Exception as e:
                counts[t] = f"ERROR: {e}"
        results["table_counts"] = counts

        # Also check PowerBISales
        try:
            r = await session.execute(text('SELECT COUNT(*) FROM "PowerBISales"'))
            results["table_counts"]["PowerBISales"] = r.scalar()
        except:
            results["table_counts"]["PowerBISales"] = "TABLE NOT FOUND"

        # 2. Duplicate orders (same amazon_order_id + sku)
        r = await session.execute(text("""
            SELECT amazon_order_id, sku, COUNT(*) as cnt
            FROM orders
            GROUP BY amazon_order_id, sku
            HAVING COUNT(*) > 1
            LIMIT 20
        """))
        dupes = [dict(row._mapping) for row in r.all()]
        results["duplicate_orders"] = {"count": len(dupes), "samples": dupes}

        # 3. Duplicate inventory (same sku + fc + condition)
        r = await session.execute(text("""
            SELECT sku, fulfillment_center_id, condition, COUNT(*) as cnt
            FROM inventory
            GROUP BY sku, fulfillment_center_id, condition
            HAVING COUNT(*) > 1
            LIMIT 20
        """))
        dupes = [dict(row._mapping) for row in r.all()]
        results["duplicate_inventory"] = {"count": len(dupes), "samples": dupes}

        # 4. Duplicate COGS (same sku)
        r = await session.execute(text("""
            SELECT sku, COUNT(*) as cnt
            FROM cogs
            GROUP BY sku
            HAVING COUNT(*) > 1
            LIMIT 20
        """))
        dupes = [dict(row._mapping) for row in r.all()]
        results["duplicate_cogs"] = {"count": len(dupes), "samples": dupes}

        # 5. Duplicate estimated_cogs (same sku)
        r = await session.execute(text("""
            SELECT sku, COUNT(*) as cnt
            FROM estimated_cogs
            GROUP BY sku
            HAVING COUNT(*) > 1
            LIMIT 20
        """))
        dupes = [dict(row._mapping) for row in r.all()]
        results["duplicate_estimated_cogs"] = {"count": len(dupes), "samples": dupes}

        # 6. Duplicate product_specifications (same sku)
        r = await session.execute(text("""
            SELECT sku, COUNT(*) as cnt
            FROM product_specifications
            GROUP BY sku
            HAVING COUNT(*) > 1
            LIMIT 20
        """))
        dupes = [dict(row._mapping) for row in r.all()]
        results["duplicate_product_specs"] = {"count": len(dupes), "samples": dupes}

        # 7. Duplicate shipment_estimates (same order_id + sku)
        r = await session.execute(text("""
            SELECT amazon_order_id, sku, COUNT(*) as cnt
            FROM shipment_estimates
            GROUP BY amazon_order_id, sku
            HAVING COUNT(*) > 1
            LIMIT 20
        """))
        dupes = [dict(row._mapping) for row in r.all()]
        results["duplicate_shipment_estimates"] = {"count": len(dupes), "samples": dupes}

        # 8. Orders with NULL or empty SKU
        r = await session.execute(text("""
            SELECT COUNT(*) FROM orders WHERE sku IS NULL OR sku = ''
        """))
        results["orders_null_sku"] = r.scalar()

        # 9. Orders with NULL purchase_date
        r = await session.execute(text("""
            SELECT COUNT(*) FROM orders WHERE purchase_date IS NULL
        """))
        results["orders_null_purchase_date"] = r.scalar()

        # 10. Orders with zero/null item_price
        r = await session.execute(text("""
            SELECT COUNT(*) FROM orders WHERE item_price IS NULL OR item_price = 0
        """))
        results["orders_zero_price"] = r.scalar()

        # 11. Orders missing COGS
        r = await session.execute(text("""
            SELECT COUNT(*) FROM orders WHERE cogs_price IS NULL
        """))
        results["orders_missing_cogs"] = r.scalar()

        # 12. Orders missing profit
        r = await session.execute(text("""
            SELECT COUNT(*) FROM orders WHERE profit IS NULL
        """))
        results["orders_missing_profit"] = r.scalar()

        # 13. Distinct order statuses
        r = await session.execute(text("""
            SELECT order_status, COUNT(*) as cnt
            FROM orders
            GROUP BY order_status
            ORDER BY cnt DESC
        """))
        results["order_status_distribution"] = [dict(row._mapping) for row in r.all()]

        # 14. Orders with dirty ship_state (non-normalized)
        r = await session.execute(text("""
            SELECT ship_state, COUNT(*) as cnt
            FROM orders
            WHERE ship_state IS NOT NULL
            GROUP BY ship_state
            ORDER BY cnt DESC
            LIMIT 40
        """))
        results["ship_state_distribution"] = [dict(row._mapping) for row in r.all()]

        # 15. SKUs in orders but not in cogs or estimated_cogs
        r = await session.execute(text("""
            SELECT DISTINCT o.sku
            FROM orders o
            LEFT JOIN cogs c ON o.sku = c.sku
            LEFT JOIN estimated_cogs ec ON o.sku = ec.sku
            WHERE c.sku IS NULL AND ec.sku IS NULL
            LIMIT 50
        """))
        results["skus_without_any_cogs"] = [row[0] for row in r.all()]

        # 16. Check for constraint existence
        r = await session.execute(text("""
            SELECT constraint_name, table_name
            FROM information_schema.table_constraints
            WHERE constraint_type = 'UNIQUE'
            AND table_schema = 'public'
            ORDER BY table_name
        """))
        results["unique_constraints"] = [dict(row._mapping) for row in r.all()]

        # 17. Check indexes
        r = await session.execute(text("""
            SELECT indexname, tablename
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname
        """))
        results["indexes"] = [dict(row._mapping) for row in r.all()]

        # 18. Duplicate customers
        try:
            r = await session.execute(text("""
                SELECT customer_id, COUNT(*) as cnt
                FROM customers
                GROUP BY customer_id
                HAVING COUNT(*) > 1
                LIMIT 20
            """))
            dupes = [dict(row._mapping) for row in r.all()]
            results["duplicate_customers"] = {"count": len(dupes), "samples": dupes}
        except:
            results["duplicate_customers"] = "TABLE NOT FOUND"

        # Print results
        def default_serializer(obj):
            if hasattr(obj, 'isoformat'):
                return obj.isoformat()
            return str(obj)

        print(json.dumps(results, indent=2, default=default_serializer))

    await engine.dispose()


asyncio.run(audit())
