"""
Historical Orders Re-Sync — Backfill ship_city & ship_state
============================================================
Re-fetches all orders in 30-day chunks going back 6 months.
The upsert will update existing orders with the new city/state fields.

Usage:  uv run python backfill_orders.py
"""
import os
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from sp_api import fetch_orders_date_range

load_dotenv()

logging.basicConfig(
    level="INFO",
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill")

DATABASE_URL = os.getenv("SUPABASE_URL")
if not DATABASE_URL:
    raise ValueError("Missing SUPABASE_URL")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=3,
    max_overflow=5,
    pool_timeout=30,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
)
SessionLocal = async_sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=AsyncSession)

# How far back to sync (in days)
LOOKBACK_DAYS = 740   # ~2 years — covers all orders back to March 2024
CHUNK_DAYS = 30       # Amazon report max range per request


async def main():
    now = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59, microsecond=0)
    earliest = now - timedelta(days=LOOKBACK_DAYS)

    logger.info(f"=== HISTORICAL BACKFILL: {earliest.strftime('%Y-%m-%d')} → {now.strftime('%Y-%m-%d')} ===")
    logger.info(f"This will re-sync orders in {CHUNK_DAYS}-day chunks to backfill ship_city & ship_state.")

    chunk_start = earliest
    chunk_num = 0

    while chunk_start < now:
        chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS), now)
        chunk_num += 1

        logger.info(f"\n--- Chunk {chunk_num}: {chunk_start.strftime('%Y-%m-%d')} → {chunk_end.strftime('%Y-%m-%d')} ---")

        try:
            async with SessionLocal() as session:
                await fetch_orders_date_range(session, chunk_start, chunk_end)
            logger.info(f"Chunk {chunk_num} complete!")
        except Exception as e:
            logger.error(f"Chunk {chunk_num} failed: {e}")
            logger.info("Continuing to next chunk...")

        chunk_start = chunk_end

        # Rate limiting: wait between report requests to avoid SP-API throttling
        if chunk_start < now:
            logger.info("Waiting 10s before next chunk (rate limiting)...")
            await asyncio.sleep(10)

    logger.info("\n=== HISTORICAL BACKFILL COMPLETE ===")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
