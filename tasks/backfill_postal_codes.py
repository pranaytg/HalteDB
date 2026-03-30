"""
Backfill ship_postal_code for existing orders using SP-API Orders API.
Only updates the pincode — city and state are left untouched (already normalized).
"""
import asyncio
import os
import sys
import logging
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text
from sp_api import get_amazon_access_token

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backfill_postal")

API_ENDPOINT = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com")

db_url = os.getenv("SUPABASE_URL", "")
db_url = db_url.replace("+asyncpg", "")
if not db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgres://", "postgresql://")

engine = create_engine(db_url)


async def fetch_postal_code(client: httpx.AsyncClient, order_id: str, token: str) -> str | None:
    """Fetch only the postal code for an order from SP-API."""
    # Try address endpoint first
    for endpoint in [
        f"{API_ENDPOINT}/orders/v0/orders/{order_id}/address",
        f"{API_ENDPOINT}/orders/v0/orders/{order_id}",
    ]:
        headers = {"x-amz-access-token": token, "Content-Type": "application/json"}
        try:
            resp = await client.get(endpoint, headers=headers)
            if resp.status_code == 429:
                logger.warning(f"Rate limited on {order_id}, sleeping 3s...")
                await asyncio.sleep(3)
                resp = await client.get(endpoint, headers=headers)
            if resp.status_code == 403:
                continue  # PII restricted, try next endpoint
            if resp.status_code != 200:
                continue
            data = resp.json()
            # Address endpoint returns under payload.ShippingAddress
            # Order endpoint returns under payload.ShippingAddress too
            addr = data.get("payload", {})
            if "ShippingAddress" in addr:
                addr = addr["ShippingAddress"]
            postal = addr.get("PostalCode", "")
            if postal and postal.strip():
                return postal.strip()
        except Exception as e:
            logger.error(f"Error fetching {order_id}: {e}")
    return None


async def run_backfill():
    logger.info("Starting postal code backfill (pincode only, city/state untouched)...")

    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT DISTINCT amazon_order_id 
            FROM orders 
            WHERE (ship_postal_code IS NULL OR ship_postal_code = '')
            ORDER BY amazon_order_id DESC
            LIMIT 200
        """))
        order_ids = [r[0] for r in result.all()]

    logger.info(f"Found {len(order_ids)} orders missing postal codes")

    if not order_ids:
        logger.info("Nothing to backfill!")
        return

    token = await get_amazon_access_token()
    updated = 0
    failed = 0

    async with httpx.AsyncClient(timeout=30) as client:
        for i, order_id in enumerate(order_ids):
            if i > 0 and i % 50 == 0:
                logger.info(f"Progress: {i}/{len(order_ids)} processed, {updated} updated")
                token = await get_amazon_access_token()

            postal = await fetch_postal_code(client, order_id, token)

            if postal:
                with engine.connect() as conn:
                    conn.execute(text("""
                        UPDATE orders 
                        SET ship_postal_code = :postal
                        WHERE amazon_order_id = :order_id
                          AND (ship_postal_code IS NULL OR ship_postal_code = '')
                    """), {"postal": postal, "order_id": order_id})
                    conn.commit()
                updated += 1
            else:
                failed += 1

            # Rate limiting
            await asyncio.sleep(0.3)

    logger.info(f"Backfill complete! Updated: {updated}, Failed: {failed}, Total: {len(order_ids)}")


if __name__ == "__main__":
    asyncio.run(run_backfill())
