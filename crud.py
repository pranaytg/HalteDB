from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from models import Inventory
from models import Order

async def upsert_inventory_batch(session: AsyncSession, batch: list[dict]):
    """
    Takes a batch of dictionary records and upserts them into the Inventory table.
    """
    if not batch:
        return

    # 1. Create the base insert statement
    stmt = insert(Inventory).values(batch)

    # 2. Define what happens if the SKU + FC + Condition already exists (Update it)
    update_dict = {
        "fulfillable_quantity": stmt.excluded.fulfillable_quantity,
        "unfulfillable_quantity": stmt.excluded.unfulfillable_quantity,
        "reserved_quantity": stmt.excluded.reserved_quantity,
        "last_updated": stmt.excluded.last_updated 
    }

    # 3. Apply the ON CONFLICT DO UPDATE clause
    upsert_stmt = stmt.on_conflict_do_update(
        index_elements=['sku', 'fulfillment_center_id', 'condition'], 
        set_=update_dict
    )

    # 4. Execute and commit to the database
    await session.execute(upsert_stmt)
    await session.commit()



async def upsert_orders_batch(session: AsyncSession, batch: list[dict]):
    if not batch:
        return

    # --- THE FIX: Deduplicate within the batch ---
    unique_records = {}
    for row in batch:
        key = (row["amazon_order_id"], row["sku"])
        # As we loop, later rows overwrite earlier ones. 
        # This naturally keeps the most recent status from the report!
        unique_records[key] = row
    
    clean_batch = list(unique_records.values())
    # ---------------------------------------------

    # Use clean_batch here instead of the raw batch
    stmt = insert(Order).values(clean_batch)

    update_dict = {
        "last_updated_date": stmt.excluded.last_updated_date,
        "order_status": stmt.excluded.order_status,
        "item_status": stmt.excluded.item_status,
        "quantity": stmt.excluded.quantity,
        "item_price": stmt.excluded.item_price,
        "item_tax": stmt.excluded.item_tax,
    }

    upsert_stmt = stmt.on_conflict_do_update(
        index_elements=['amazon_order_id', 'sku'], 
        set_=update_dict
    )

    await session.execute(upsert_stmt)
    await session.commit()