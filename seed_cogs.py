"""
Seed COGS Table & Backfill Profit
=================================
1. Fetches distinct SKUs from BOTH inventory AND orders tables
2. Seeds the cogs table with random prices (₹50–₹500)
3. Backfills profit on the most recent 1000 orders: profit = item_price - cogs_price

Run: python seed_cogs.py
"""
import asyncio
import os
import random
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text

load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession)


async def seed_cogs():
    async with SessionLocal() as session:
        # 1. Get ALL distinct SKUs from both inventory AND orders
        result = await session.execute(text("""
            SELECT DISTINCT sku FROM (
                SELECT DISTINCT sku FROM inventory
                UNION
                SELECT DISTINCT sku FROM orders
            ) all_skus
            ORDER BY sku
        """))
        skus = [row[0] for row in result.fetchall()]
        print(f"Found {len(skus)} distinct SKUs across inventory + orders.")

        if not skus:
            print("No SKUs found in either table. Nothing to seed.")
            return

        # 2. Insert COGS with random prices (₹50 - ₹500)
        inserted = 0
        for sku in skus:
            cogs_price = round(random.uniform(50.0, 500.0), 2)
            await session.execute(
                text("""
                    INSERT INTO cogs (sku, cogs_price) 
                    VALUES (:sku, :cogs_price) 
                    ON CONFLICT (sku) DO NOTHING
                """),
                {"sku": sku, "cogs_price": cogs_price}
            )
            inserted += 1

        await session.commit()
        print(f"Seeded {inserted} COGS entries (skipped existing).")

        # 3. Backfill profit on ALL orders that have a matching COGS entry
        result = await session.execute(text("""
            UPDATE orders o
            SET cogs_price = c.cogs_price,
                profit = o.item_price - c.cogs_price
            FROM cogs c
            WHERE o.sku = c.sku
            AND (o.profit IS NULL OR o.cogs_price IS NULL)
        """))
        await session.commit()
        print(f"Backfilled profit on {result.rowcount} orders.")


if __name__ == "__main__":
    asyncio.run(seed_cogs())
