"""Retry the 5 failed backfill chunks (2024-04-03 to 2024-08-31)."""
import asyncio
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine, AsyncSession

from sp_api import fetch_orders_date_range

load_dotenv()
logging.basicConfig(level="INFO", format="%(asctime)s | %(levelname)-8s | %(message)s")
logger = logging.getLogger("retry")

DATABASE_URL = os.getenv("SUPABASE_URL")
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_timeout=60,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, autocommit=False, autoflush=False)

CHUNKS = [
    ("2024-04-03", "2024-05-03"),
    ("2024-05-03", "2024-06-02"),
    ("2024-06-02", "2024-07-02"),
    ("2024-07-02", "2024-08-01"),
    ("2024-08-01", "2024-08-31"),
]


async def main():
    for i, (start, end) in enumerate(CHUNKS, 1):
        s = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
        e = datetime.fromisoformat(end).replace(tzinfo=timezone.utc)
        logger.info(f"--- Retry chunk {i}/5: {start} -> {end} ---")
        try:
            async with SessionLocal() as session:
                await fetch_orders_date_range(session, s, e)
            logger.info(f"Chunk {i} complete!")
        except Exception as exc:
            logger.error(f"Chunk {i} failed again: {exc}")
        if i < len(CHUNKS):
            await asyncio.sleep(10)
    await engine.dispose()
    logger.info("=== RETRY COMPLETE ===")


if __name__ == "__main__":
    asyncio.run(main())
