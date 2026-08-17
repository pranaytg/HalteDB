import os
import logging
from datetime import datetime, timezone
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from crud import upsert_orders_batch, update_website_orders_sync_time, assign_cogs_to_orders

logger = logging.getLogger("haltedb")

async def run_website_orders_sync(session: AsyncSession, sync_all: bool = False):
    logger.info(f"Starting Website Orders Sync (sync_all={sync_all})")
    
    api_url = os.getenv("HALTE_NEXT_API_URL", "https://halte.in")
    api_key = os.getenv("HALTE_NEXT_API_KEY") or os.getenv("DASHBOARD_API_KEY")
    lookback_days = os.getenv("WEBSITE_ORDERS_SYNC_LOOKBACK_DAYS", "30")
    
    if not api_key:
        logger.error("Missing HALTE_NEXT_API_KEY or DASHBOARD_API_KEY")
        return False
        
    try:
        url = f"{api_url.rstrip('/')}/api/haltedb/orders"
        params = {"sync_all": "true" if sync_all else "false", "lookback_days": lookback_days}
        headers = {"x-api-key": api_key}
        
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, params=params, headers=headers, timeout=30.0)
            resp.raise_for_status()
            website_orders = resp.json()
            
        if not website_orders:
            logger.info("No website orders found to sync.")
            await update_website_orders_sync_time(session, datetime.now(timezone.utc))
            return True
            
        batch = []
        for o in website_orders:
            try:
                # Calculate total line price
                item_price = float(o.get("price_at_purchase") or 0) * int(o.get("quantity") or 1)
                
                batch.append({
                    "amazon_order_id": f"HN-{o['order_id']}",
                    "purchase_date": datetime.fromisoformat(o["order_time"].replace("Z", "+00:00")),
                    "last_updated_date": datetime.fromisoformat(o["order_time"].replace("Z", "+00:00")),
                    "order_status": o.get("order_state"),
                    "fulfillment_channel": "Halte Website",
                    "sales_channel": "halte.in",
                    "sku": o.get("sku"),
                    "item_status": o.get("order_state"),
                    "quantity": o.get("quantity") or 0,
                    "currency": "INR",
                    "item_price": item_price,
                    "ship_city": o.get("ship_city"),
                    "ship_state": o.get("ship_state"),
                    "ship_postal_code": o.get("ship_postal_code"),
                })
            except Exception as e:
                logger.error(f"Error processing website order {o.get('order_id')}: {e}")
            
        if batch:
            await upsert_orders_batch(session, batch)
            await assign_cogs_to_orders(session)
            await update_website_orders_sync_time(session, datetime.now(timezone.utc))
            logger.info(f"Successfully synced {len(batch)} website order items.")
        return True
        
    except Exception as e:
        logger.error(f"Failed to sync website orders: {e}", exc_info=True)
        return False
