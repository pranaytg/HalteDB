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
import httpx
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from datetime import datetime, timezone

from sp_api import (
    run_full_sync,
    run_inventory_sync_job,
    run_incremental_orders_sync,
    run_product_specs_sync,
    run_invoice_sync,
    get_powerbi_sales_sync_status,
    run_shipment_sync_full,
    recalculate_profitability_all,
)
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
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
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


@app.post("/recalculate-profitability")
async def trigger_profitability_recalc(background_tasks: BackgroundTasks):
    """Recomputes orders.profit for ALL orders using the current formula (includes
    rate-card shipping fallback). Runs in background because it updates every row."""
    async def _run():
        try:
            async with SessionLocal() as sync_session:
                count = await recalculate_profitability_all(sync_session)
                logger.info(f"Full profitability recalc done: {count} rows updated")
        except Exception as e:
            logger.error(f"Profitability recalc failed: {e}")

    background_tasks.add_task(_run)
    return {"status": "accepted", "message": "Profitability recalc started for all orders."}


@app.post("/sync-shipments-full")
async def trigger_shipment_full_sync(background_tasks: BackgroundTasks):
    """Backfills shipment_estimates for every order lacking one by looping the
    regular shipment sync until no eligible orders remain."""
    async def _run():
        try:
            async with SessionLocal() as sync_session:
                added = await run_shipment_sync_full(sync_session)
                logger.info(f"Shipment full sync done: +{added} rows")
                async with SessionLocal() as recalc_session:
                    await recalculate_profitability_all(recalc_session)
        except Exception as e:
            logger.error(f"Shipment full sync failed: {e}")

    background_tasks.add_task(_run)
    return {"status": "accepted", "message": "Shipment full sync + profitability recalc started."}


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


@app.get("/sync-invoices/status")
async def invoice_sync_status(session: AsyncSession = Depends(get_db)):
    """Returns PowerBISales invoice sync status."""
    return await get_powerbi_sales_sync_status(session)


@app.post("/sync-invoices")
async def trigger_invoice_sync(session: AsyncSession = Depends(get_db)):
    """Fetches Amazon GST invoice reports and syncs PowerBISales."""
    try:
        return await run_invoice_sync(session)
    except Exception as e:
        logger.error(f"Invoice sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e) or "Invoice sync failed")


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


# ============================================
# Amazon Price Fetch (Background Task)
# ============================================

_price_fetch_status = {"running": False, "total": 0, "fetched": 0, "progress": 0, "done": False}


async def _fetch_and_save_amazon_prices():
    """Background task: fetch prices from SP-API one ASIN at a time, save each to DB."""
    global _price_fetch_status
    from sp_api import get_amazon_access_token, _extract_price_from_product

    _price_fetch_status = {"running": True, "total": 0, "fetched": 0, "progress": 0, "done": False}

    try:
        async with SessionLocal() as session:
            # 1. Get all COGS SKUs
            cogs_result = await session.execute(text("SELECT sku FROM cogs ORDER BY sku"))
            cogs_skus = [row[0] for row in cogs_result.all()]
            if not cogs_skus:
                _price_fetch_status = {"running": False, "total": 0, "fetched": 0, "progress": 100, "done": True}
                return

            # 2. Build SKU → ASIN mapping
            sku_to_asin: dict[str, str] = {}
            for query in [
                "SELECT sku, asin FROM product_specifications WHERE sku IS NOT NULL AND asin IS NOT NULL",
                "SELECT DISTINCT sku, asin FROM inventory WHERE sku IS NOT NULL AND asin IS NOT NULL",
                "SELECT sku, MAX(asin) as asin FROM orders WHERE sku IS NOT NULL AND asin IS NOT NULL GROUP BY sku",
            ]:
                result = await session.execute(text(query))
                for row in result.all():
                    sku_to_asin.setdefault(row[0], row[1])

            # 3. Build ASIN → [SKUs] reverse map
            asin_to_skus: dict[str, list[str]] = {}
            for sku in cogs_skus:
                asin = sku_to_asin.get(sku)
                if asin:
                    asin_to_skus.setdefault(asin, []).append(sku)

            unique_asins = list(asin_to_skus.keys())
            _price_fetch_status["total"] = len(cogs_skus)
            logger.info(f"Amazon prices: fetching {len(unique_asins)} unique ASINs for {len(cogs_skus)} SKUs")

            # 4. Fetch prices one ASIN at a time, save to DB immediately
            endpoint = os.getenv("SP_API_ENDPOINT", "https://sellingpartnerapi-eu.amazon.com").strip('"').strip("'")
            marketplace_id = os.getenv("SP_API_MARKETPLACE_ID", "A21TJRUUN4KGV")
            access_token = await get_amazon_access_token()
            fetched = 0

            async with httpx.AsyncClient(timeout=30) as client:
                headers = {"x-amz-access-token": access_token}

                for idx, asin in enumerate(unique_asins):
                    price = None

                    for attempt in range(3):
                        try:
                            resp = await client.get(
                                f"{endpoint}/products/pricing/v0/price",
                                params={"MarketplaceId": marketplace_id, "ItemType": "Asin", "Asins": asin},
                                headers=headers,
                            )

                            if resp.status_code == 429:
                                wait = min(5 * (attempt + 1), 15)
                                logger.warning(f"Rate limit on ASIN {asin}, sleeping {wait}s...")
                                await asyncio.sleep(wait)
                                continue

                            if resp.status_code == 403:
                                access_token = await get_amazon_access_token()
                                headers = {"x-amz-access-token": access_token}
                                continue

                            if resp.status_code >= 400:
                                break

                            payload = resp.json().get("payload", [])
                            if payload and payload[0].get("status") == "Success":
                                product = payload[0].get("Product", {})
                                price = _extract_price_from_product(product)
                            break

                        except Exception as exc:
                            logger.warning(f"Pricing error for {asin}: {exc}")

                    # Save to DB for all SKUs with this ASIN
                    if price is not None:
                        skus_for_asin = asin_to_skus.get(asin, [])
                        for sku in skus_for_asin:
                            await session.execute(
                                text("UPDATE cogs SET amazon_price = :price, last_updated = NOW() WHERE sku = :sku"),
                                {"price": price, "sku": sku}
                            )
                            fetched += 1
                        await session.commit()

                    _price_fetch_status["fetched"] = fetched
                    _price_fetch_status["progress"] = int((idx + 1) / len(unique_asins) * 100)

                    # Rate limiting
                    if idx < len(unique_asins) - 1:
                        await asyncio.sleep(2.0)

                    if (idx + 1) % 50 == 0:
                        logger.info(f"  Pricing progress: {idx + 1}/{len(unique_asins)} ASINs, {fetched} prices saved")

            logger.info(f"Amazon prices complete: {fetched} prices saved for {len(cogs_skus)} SKUs")

    except Exception as exc:
        logger.error(f"Amazon price fetch failed: {exc}")
    finally:
        _price_fetch_status["running"] = False
        _price_fetch_status["done"] = True


@app.post("/amazon-prices")
async def trigger_amazon_prices(background_tasks: BackgroundTasks):
    """Starts background fetch of Amazon prices. Returns immediately."""
    global _price_fetch_status
    if _price_fetch_status.get("running"):
        return {
            "status": "already_running",
            "message": f"Price fetch already in progress ({_price_fetch_status.get('progress', 0)}% done)",
            **_price_fetch_status,
        }

    background_tasks.add_task(_fetch_and_save_amazon_prices)
    return {"status": "started", "message": "Amazon price fetch started in background"}


@app.get("/amazon-prices/status")
async def amazon_prices_status():
    """Returns the current status of the background price fetch."""
    return _price_fetch_status
