import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from sp_api import get_amazon_access_token, run_inventory_sync_job
import asyncio
from datetime import datetime, timedelta, timezone


from sp_api import fetch_orders_date_range
from crud import upsert_inventory_batch

load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")

if not DATABASE_URL:
    raise ValueError("No DATABASE_URL found. Please check your .env file.")

engine = create_async_engine(DATABASE_URL, echo=True)
SessionLocal = async_sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=AsyncSession)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def get_db():
    async with SessionLocal() as session:
        yield session

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/test-db")
async def test_db_connection():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT 1"))
            if result.scalar() == 1:
                return {"status": "success", "message": "Connected to Supabase successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")

# --- NEW: The Test Endpoint ---
@app.post("/test-insert")
async def test_database_insert(session: AsyncSession = Depends(get_db)):
    """
    Simulates fetching data from Amazon SP-API and tests your database insert logic.
    """
    # Fake Amazon SP-API data
    dummy_amazon_data = [
        {
            "sku": "TEST-SKU-001",
            "fnsku": "X000TEST1",
            "asin": "B000TEST1",
            "condition": "NewItem",
            "fulfillment_center_id": "ABE2",
            "fulfillable_quantity": 150,
            "unfulfillable_quantity": 2,
            "reserved_quantity": 10
        },
        {
            "sku": "TEST-SKU-002",
            "fnsku": "X000TEST2",
            "asin": "B000TEST2",
            "condition": "NewItem",
            "fulfillment_center_id": "ABE2",
            "fulfillable_quantity": 45,
            "unfulfillable_quantity": 0,
            "reserved_quantity": 0
        }
    ]

    try:
        # Run the CRUD function
        await upsert_inventory_batch(session, dummy_amazon_data)
        return {"status": "success", "message": "Successfully inserted 2 dummy records!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/test-amazon-auth")
async def test_amazon_authentication():
    """
    Tests your LWA credentials to see if Amazon grants an access token.
    """
    try:
        # Call the function we just wrote
        token = await get_amazon_access_token()
        
        # We'll mask the token so we don't accidentally expose the whole thing, 
        # but seeing the first 10 characters proves it worked!
        masked_token = f"{token[:10]}...{token[-5:]}"
        
        return {
            "status": "success", 
            "message": "Successfully authenticated with Amazon SP-API!",
            "access_token_preview": masked_token
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    


@app.post("/sync-inventory")
async def trigger_inventory_sync(
    background_tasks: BackgroundTasks, 
    session: AsyncSession = Depends(get_db)
):
    """
    Triggers the Amazon SP-API sync in the background. 
    Returns immediately so your frontend doesn't hang.
    """
    # Hand the heavy lifting off to FastAPI's background worker
    background_tasks.add_task(run_inventory_sync_job, session)
    
    return {
        "status": "Accepted", 
        "message": "Inventory sync started in the background. Check your terminal for progress logs!"
    }



#historical order backfill logic
async def run_historical_order_backfill(session: AsyncSession):
    print("STARTING 2-YEAR HISTORICAL SALES BACKFILL...")
    
    # Precise to the second to avoid ISO format rejection from Amazon
    end_point = datetime.now(timezone.utc).replace(microsecond=0)
    start_point = end_point - timedelta(days=730)
    
    current_start = start_point
    
    # Walk forward in 30-day chunks
    while current_start < end_point:
        current_end = current_start + timedelta(days=30)
        if current_end > end_point:
            current_end = end_point
            
        try:
            await fetch_orders_date_range(session, current_start, current_end)
        except Exception as e:
            print(f"Failed chunk {current_start} to {current_end}: {str(e)}")
            
        current_start = current_end
        
        # Stop throttling before the next chunk
        if current_start < end_point:
            print("Resting for 30 seconds to respect Amazon rate limits...")
            await asyncio.sleep(30)
            
    print("HISTORICAL BACKFILL COMPLETE!")

@app.post("/sync-historical-orders")
async def trigger_historical_order_sync(
    background_tasks: BackgroundTasks, 
    session: AsyncSession = Depends(get_db)
):
    background_tasks.add_task(run_historical_order_backfill, session)
    return {
        "status": "Accepted", 
        "message": "2-Year Order Backfill initiated! Check your terminal."
    }