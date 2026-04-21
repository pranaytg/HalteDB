import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import text, select
from models import Inventory, Order, SyncMeta
from datetime import datetime, timezone

logger = logging.getLogger("haltedb")


async def upsert_inventory_batch(session: AsyncSession, batch: list[dict]):
    """
    Takes a batch of dictionary records and upserts them into the Inventory table.
    """
    if not batch:
        return

    stmt = insert(Inventory).values(batch)

    update_dict = {
        "fulfillable_quantity": stmt.excluded.fulfillable_quantity,
        "unfulfillable_quantity": stmt.excluded.unfulfillable_quantity,
        "reserved_quantity": stmt.excluded.reserved_quantity,
        "last_updated": stmt.excluded.last_updated
    }

    upsert_stmt = stmt.on_conflict_do_update(
        index_elements=['sku', 'fulfillment_center_id', 'condition'],
        set_=update_dict
    )

    await session.execute(upsert_stmt)
    await session.commit()


async def upsert_inbound_quantities(session: AsyncSession, batch: list[dict]):
    """
    Takes a batch of dictionary records for inbound inventory and upserts them
    using fulfillment_center_id = 'INBOUND'.
    """
    if not batch:
        return

    stmt = insert(Inventory).values(batch)

    update_dict = {
        "inbound_working_quantity": stmt.excluded.inbound_working_quantity,
        "inbound_shipped_quantity": stmt.excluded.inbound_shipped_quantity,
        "inbound_receiving_quantity": stmt.excluded.inbound_receiving_quantity,
        "last_updated": stmt.excluded.last_updated
    }

    upsert_stmt = stmt.on_conflict_do_update(
        index_elements=['sku', 'fulfillment_center_id', 'condition'],
        set_=update_dict
    )

    await session.execute(upsert_stmt)
    await session.commit()



async def upsert_orders_batch(session: AsyncSession, batch: list[dict]):
    if not batch:
        return

    # Deduplicate within the batch
    unique_records = {}
    for row in batch:
        key = (row["amazon_order_id"], row["sku"])
        unique_records[key] = row

    clean_batch = list(unique_records.values())

    stmt = insert(Order).values(clean_batch)

    update_dict = {
        "last_updated_date": stmt.excluded.last_updated_date,
        "order_status": stmt.excluded.order_status,
        "item_status": stmt.excluded.item_status,
        "quantity": stmt.excluded.quantity,
        "item_price": stmt.excluded.item_price,
        "item_tax": stmt.excluded.item_tax,
        "shipping_price": stmt.excluded.shipping_price,
        "ship_city": stmt.excluded.ship_city,
        "ship_state": stmt.excluded.ship_state,
        "ship_postal_code": stmt.excluded.ship_postal_code,
    }

    upsert_stmt = stmt.on_conflict_do_update(
        index_elements=['amazon_order_id', 'sku'],
        set_=update_dict
    )

    await session.execute(upsert_stmt)
    await session.commit()

    # Auto-assign COGS & profit for orders that don't have them yet
    await assign_cogs_to_orders(session)


async def assign_cogs_to_orders(session: AsyncSession):
    """
    1. Auto-inserts any new base SKUs from orders into the cogs table (price 0).
    2. Fills in cogs_price and profit for any orders missing them.
    Profit = item_price - cogs - shipping_cost.
    Amazon-fulfilled rows use the best available Amazon shipping cost:
    actual order cost first, then shipment_estimates fallback.
    """
    # Step 1: Insert missing base SKUs into cogs (strip variant suffixes)
    insert_result = await session.execute(text("""
        INSERT INTO cogs (sku, cogs_price)
        SELECT DISTINCT base_sku, 0
        FROM (
            SELECT
                CASE
                    WHEN sku ~ E' \\d+$' THEN REGEXP_REPLACE(sku, E' \\d+$', '')
                    WHEN sku ~ E'-[A-Za-z]$' THEN REGEXP_REPLACE(sku, E'-[A-Za-z]$', '')
                    ELSE sku
                END AS base_sku
            FROM orders
        ) sub
        WHERE base_sku NOT IN (SELECT sku FROM cogs)
        ON CONFLICT (sku) DO NOTHING
    """))
    if insert_result.rowcount and insert_result.rowcount > 0:
        await session.commit()
        logger.info(f"Auto-inserted {insert_result.rowcount} new SKUs into cogs table")

    # Step 2: Assign COGS price and profit to orders
    result = await session.execute(text("""
        UPDATE orders o
        SET cogs_price = c.cogs_price,
            profit = o.item_price - c.cogs_price - CASE
                WHEN LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
                  OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
                THEN COALESCE(
                    NULLIF(o.shipping_price, 0),
                    NULLIF((
                        SELECT se.amazon_shipping_cost
                        FROM shipment_estimates se
                        WHERE se.amazon_order_id = o.amazon_order_id AND se.sku = o.sku
                        LIMIT 1
                    ), 0),
                    0
                )
                ELSE COALESCE(o.shipping_price, 0)
            END
        FROM cogs c
        WHERE (o.sku = c.sku OR o.sku LIKE c.sku || ' %' OR o.sku LIKE c.sku || '-%')
        AND (o.cogs_price IS NULL OR o.profit IS NULL)
    """))
    if result.rowcount and result.rowcount > 0:
        await session.commit()
        logger.info(f"Auto-assigned COGS/profit to {result.rowcount} orders")


# ============================================
# Sync Meta — tracks last successful sync
# ============================================

async def get_sync_meta(session: AsyncSession) -> SyncMeta:
    """Get or create the singleton sync_meta row."""
    result = await session.execute(select(SyncMeta).where(SyncMeta.id == 1))
    meta = result.scalar_one_or_none()
    if meta is None:
        meta = SyncMeta(id=1)
        session.add(meta)
        await session.commit()
        await session.refresh(meta)
    return meta


async def update_orders_sync_time(session: AsyncSession, sync_time: datetime):
    """Update the last_orders_sync timestamp."""
    await session.execute(
        text("UPDATE sync_meta SET last_orders_sync = :t WHERE id = 1"),
        {"t": sync_time}
    )
    await session.commit()


async def update_inventory_sync_time(session: AsyncSession, sync_time: datetime):
    """Update the last_inventory_sync timestamp."""
    await session.execute(
        text("UPDATE sync_meta SET last_inventory_sync = :t WHERE id = 1"),
        {"t": sync_time}
    )
    await session.commit()
