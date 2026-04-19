"""Check for duplicate (amazon_order_id, sku) rows in orders and report counts."""
import asyncio
import os

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

load_dotenv()
engine = create_async_engine(
    os.environ["SUPABASE_URL"],
    echo=False,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)
SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)


async def main():
    async with SessionLocal() as s:
        total = (await s.execute(text("SELECT COUNT(*) FROM orders"))).scalar()
        dup_groups = (await s.execute(text("""
            SELECT COUNT(*) FROM (
                SELECT amazon_order_id, sku, COUNT(*) c
                FROM orders
                GROUP BY amazon_order_id, sku
                HAVING COUNT(*) > 1
            ) x
        """))).scalar()
        dup_rows = (await s.execute(text("""
            SELECT COALESCE(SUM(c - 1), 0) FROM (
                SELECT COUNT(*) c
                FROM orders
                GROUP BY amazon_order_id, sku
                HAVING COUNT(*) > 1
            ) x
        """))).scalar()
        has_constraint = (await s.execute(text("""
            SELECT COUNT(*) FROM pg_constraint
            WHERE conname = 'uq_order_sku'
        """))).scalar()
        print(f"total rows            : {total:,}")
        print(f"duplicate key groups  : {dup_groups:,}")
        print(f"excess duplicate rows : {dup_rows:,}")
        print(f"uq_order_sku exists   : {bool(has_constraint)}")


if __name__ == "__main__":
    asyncio.run(main())
