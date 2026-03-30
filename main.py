"""
HalteDB Backend — Production FastAPI Server
============================================
Endpoints:
  GET  /health              → Health check (Render monitoring)
  GET  /sync-status         → Last sync timestamps
  POST /sync-all            → Trigger full sync (inventory + incremental orders)
  POST /sync-inventory      → Trigger inventory-only sync
  POST /sync-orders         → Trigger incremental orders sync

Self-schedules an hourly sync (no external cron needed).
"""
import os
import asyncio
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from datetime import datetime, timezone

from sp_api import run_full_sync, run_inventory_sync_job, run_incremental_orders_sync, run_product_specs_sync
from crud import get_sync_meta

# ============================================
# Configuration
# ============================================
load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")
if not DATABASE_URL:
    raise ValueError("Missing SUPABASE_URL in environment variables")

# Sync interval in seconds (default: 1 hour)
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL_SECONDS", "3600"))

# Configure logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("haltedb")

# SQLAlchemy engine — production settings
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
)
SessionLocal = async_sessionmaker(
    autocommit=False, autoflush=False, bind=engine, class_=AsyncSession
)


# ============================================
# Background Scheduler (replaces Render cron)
# ============================================
async def _scheduled_sync_loop():
    """Runs a full sync every SYNC_INTERVAL seconds. Starts after a 60s delay."""
    await asyncio.sleep(60)  # Wait for server to fully boot
    while True:
        logger.info(f"⏰ Scheduled sync triggered (every {SYNC_INTERVAL}s)")
        try:
            async with SessionLocal() as session:
                await run_full_sync(session)
        except Exception as e:
            logger.error(f"Scheduled sync failed: {e}")
        await asyncio.sleep(SYNC_INTERVAL)


# ============================================
# App Lifecycle
# ============================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("HalteDB backend starting up...")
    # Start the hourly sync loop in the background
    sync_task = asyncio.create_task(_scheduled_sync_loop())
    logger.info(f"Hourly sync scheduler started (interval: {SYNC_INTERVAL}s)")
    yield
    # Cancel the background task on shutdown
    sync_task.cancel()
    logger.info("HalteDB backend shutting down...")
    await engine.dispose()


app = FastAPI(
    title="HalteDB Backend",
    description="Amazon SP-API Sales Intelligence Pipeline",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend origins
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# Dependency
# ============================================
async def get_db():
    async with SessionLocal() as session:
        yield session


# ============================================
# Health Check (Render monitors this)
# ============================================
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "haltedb-backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/")
async def root():
    return {
        "service": "HalteDB Backend",
        "version": "2.0.0",
        "docs": "/docs",
    }


# ============================================
# Sync Status
# ============================================
@app.get("/sync-status")
async def sync_status(session: AsyncSession = Depends(get_db)):
    """Returns the timestamps of the last successful syncs."""
    meta = await get_sync_meta(session)
    return {
        "last_orders_sync": meta.last_orders_sync.isoformat() if meta.last_orders_sync else None,
        "last_inventory_sync": meta.last_inventory_sync.isoformat() if meta.last_inventory_sync else None,
    }


# ============================================
# Sync Triggers
# ============================================

# Track if a sync is currently running to prevent overlapping syncs
_sync_running = False


@app.post("/sync-all")
async def trigger_full_sync(
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
):
    """
    Triggers a full sync: inventory + incremental orders.
    Called by Render's hourly cron job and the frontend Sync button.
    """
    global _sync_running
    if _sync_running:
        return {"status": "skipped", "message": "A sync is already running."}

    async def _run_sync():
        global _sync_running
        _sync_running = True
        try:
            async with SessionLocal() as sync_session:
                await run_full_sync(sync_session)
        except Exception as e:
            logger.error(f"Full sync failed: {e}")
        finally:
            _sync_running = False

    background_tasks.add_task(_run_sync)
    return {
        "status": "accepted",
        "message": "Full sync (inventory + orders) started in background.",
    }


@app.post("/sync-inventory")
async def trigger_inventory_sync(
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
):
    """Triggers inventory-only sync."""
    async def _run():
        try:
            async with SessionLocal() as sync_session:
                await run_inventory_sync_job(sync_session)
        except Exception as e:
            logger.error(f"Inventory sync failed: {e}")

    background_tasks.add_task(_run)
    return {"status": "accepted", "message": "Inventory sync started."}


@app.post("/sync-orders")
async def trigger_orders_sync(
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
):
    """Triggers incremental orders sync (since last sync)."""
    async def _run():
        try:
            async with SessionLocal() as sync_session:
                await run_incremental_orders_sync(sync_session)
        except Exception as e:
            logger.error(f"Orders sync failed: {e}")

    background_tasks.add_task(_run)
    return {"status": "accepted", "message": "Incremental orders sync started."}


@app.post("/sync-product-specs")
async def trigger_product_specs_sync(
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
):
    """Triggers product specifications sync (fetches dimensions/weights from SP-API)."""
    async def _run():
        try:
            async with SessionLocal() as sync_session:
                await run_product_specs_sync(sync_session)
        except Exception as e:
            logger.error(f"Product specs sync failed: {e}")

    background_tasks.add_task(_run)
    return {"status": "accepted", "message": "Product specifications sync started."}


# ============================================
# Product Specifications
# ============================================

from sqlalchemy import text

@app.get("/product-specs")
async def get_product_specs(session: AsyncSession = Depends(get_db)):
    """Returns all product specifications (weights, dimensions)."""
    result = await session.execute(text("""
        SELECT sku, asin, product_name, weight_kg, length_cm, width_cm, height_cm,
               volumetric_weight_kg, chargeable_weight_kg, last_updated
        FROM product_specifications
        ORDER BY sku
    """))
    rows = result.mappings().all()
    return {"specs": [dict(r) for r in rows], "total": len(rows)}


@app.get("/product-specs/{sku}")
async def get_product_spec_by_sku(sku: str, session: AsyncSession = Depends(get_db)):
    """Returns product specification for a specific SKU."""
    result = await session.execute(text("""
        SELECT sku, asin, product_name, weight_kg, length_cm, width_cm, height_cm,
               volumetric_weight_kg, chargeable_weight_kg, last_updated
        FROM product_specifications
        WHERE sku = :sku
    """), {"sku": sku})
    row = result.mappings().first()
    if not row:
        return {"error": "SKU not found", "sku": sku}
    return dict(row)