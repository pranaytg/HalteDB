"""
HalteDB Backend — Production FastAPI Server
============================================
Endpoints:
  GET  /health              → Health check (Render monitoring)
  GET  /sync-status         → Last sync timestamps
  POST /sync-all            → Trigger full sync (inventory + incremental orders)
  POST /sync-inventory      → Trigger inventory-only sync
  POST /sync-orders         → Trigger incremental orders sync
"""
import os
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from datetime import datetime, timezone

from sp_api import run_full_sync, run_inventory_sync_job, run_incremental_orders_sync
from crud import get_sync_meta

# ============================================
# Configuration
# ============================================
load_dotenv()

DATABASE_URL = os.getenv("SUPABASE_URL")
if not DATABASE_URL:
    raise ValueError("Missing SUPABASE_URL in environment variables")

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
    echo=False,  # Disable SQL logging in production
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,  # Recycle connections every 30 min
)
SessionLocal = async_sessionmaker(
    autocommit=False, autoflush=False, bind=engine, class_=AsyncSession
)


# ============================================
# App Lifecycle
# ============================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("HalteDB backend starting up...")
    yield
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