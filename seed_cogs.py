"""
Seed COGS Table & Backfill Profit
=================================
1. Fetches distinct SKUs from the inventory table
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
engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession)


async def seed_cogs():
    async with SessionLocal() as session:
        # 1. Get distinct SKUs from inventory
        result = await session.execute(text("SELECT DISTINCT sku FROM inventory"))
        skus = [row[0] for row in result.fetchall()]
        print(f"Found {len(skus)} distinct SKUs in inventory.")

        if not skus:
            # Fallback: get SKUs from orders if inventory is empty
            result = await session.execute(text("SELECT DISTINCT sku FROM orders"))
            skus = [row[0] for row in result.fetchall()]
            print(f"Fallback: Found {len(skus)} distinct SKUs in orders.")

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
        print(f"Seeded {inserted} COGS entries.")

        # 3. Backfill profit on recent 1000 orders
        await session.execute(text("""
            UPDATE orders o
            SET cogs_price = c.cogs_price,
                profit = o.item_price - c.cogs_price
            FROM cogs c
            WHERE o.sku = c.sku
            AND o.id IN (
                SELECT id FROM orders ORDER BY purchase_date DESC NULLS LAST LIMIT 1000
            )
        """))
        await session.commit()
        print("Backfilled profit on recent 1000 orders.")


if __name__ == "__main__":
    asyncio.run(seed_cogs())
