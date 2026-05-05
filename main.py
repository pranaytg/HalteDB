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
from uuid import uuid4
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, UploadFile, File
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from datetime import datetime, timezone, date

from pydantic import BaseModel

from sp_api import (
    run_full_sync,
    run_inventory_sync_job,
    run_incremental_orders_sync,
    run_product_specs_sync,
    run_invoice_sync,
    get_powerbi_sales_sync_status,
    run_shipment_sync_full,
    recalculate_profitability_all,
    run_inbound_shipments_sync,
)
from shiprocket import get_shipping_rates_with_source
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
    poolclass=NullPool,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4().hex}__",
    },
)
SessionLocal = async_sessionmaker(
    autocommit=False, autoflush=False, bind=engine, class_=AsyncSession
)


# Track if a full sync is currently running to prevent overlapping jobs.
_sync_running = False


async def _run_full_sync_job(source: str, already_reserved: bool = False) -> bool:
    global _sync_running

    if _sync_running and not already_reserved:
        logger.info("Skipping %s full sync because another sync is already running.", source)
        return False

    if not already_reserved:
        _sync_running = True

    try:
        async with SessionLocal() as session:
            await run_full_sync(session)
        return True
    except Exception:
        logger.exception("%s full sync failed", source.capitalize())
        return False
    finally:
        _sync_running = False


# ============================================
# Background Scheduler (replaces Render cron)
# ============================================
async def _scheduled_sync_loop():
    """Runs a full sync every SYNC_INTERVAL seconds. Starts after a 60s delay."""
    await asyncio.sleep(60)  # Wait for server to fully boot
    while True:
        logger.info(f"⏰ Scheduled sync triggered (every {SYNC_INTERVAL}s)")
        await _run_full_sync_job("scheduled")
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

    _sync_running = True
    background_tasks.add_task(_run_full_sync_job, "manual", True)
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


@app.post("/sync-inbound-shipments")
async def trigger_inbound_shipments_sync(
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
):
    """Triggers FBA inbound-shipments sync (active shipments in transit / receiving)."""
    async def _run():
        try:
            async with SessionLocal() as sync_session:
                await run_inbound_shipments_sync(sync_session)
        except Exception as e:
            logger.error(f"Inbound shipments sync failed: {e}")

    background_tasks.add_task(_run)
    return {"status": "accepted", "message": "Inbound shipments sync started."}


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


# Shared state for the Amazon Finance manual sync job.
_finance_sync_running: bool = False
_finance_sync_last_result: dict[str, object] | None = None


async def _run_amazon_finance_backfill(days: int, delay: float) -> None:
    """Run tasks.backfill_amazon_finance_actuals.main, then recalc profitability so
    orders.profit reflects the new fee/shipping values."""
    global _finance_sync_running, _finance_sync_last_result
    try:
        from tasks.backfill_amazon_finance_actuals import main as run_backfill

        summary = await run_backfill(days=days, delay=delay, limit=None)

        # Recalc profitability so Sales page + reports reflect the new actuals.
        recalc_count = 0
        if (summary or {}).get("fee_updates", 0) or (summary or {}).get("shipping_updates", 0):
            async with SessionLocal() as recalc_session:
                recalc_count = await recalculate_profitability_all(recalc_session)
            logger.info(f"Profitability recalc after Finance sync: {recalc_count} rows")

        _finance_sync_last_result = {
            "status": "completed",
            "days": days,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "profit_recalc_rows": recalc_count,
            **(summary or {}),
        }
        logger.info(f"Amazon Finance sync done: {summary}")
    except Exception as exc:
        logger.exception("Amazon Finance sync failed")
        _finance_sync_last_result = {
            "status": "failed",
            "days": days,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }
    finally:
        _finance_sync_running = False


@app.post("/sync-amazon-finance")
async def trigger_amazon_finance_sync(background_tasks: BackgroundTasks, days: int = 15):
    """Pulls SP-API Finance actuals (referral + shipping) for the last `days` days,
    overwriting rate-card estimates. Runs in background because each API call has a
    ~2s rate-limit delay; typical 15-day run takes a few minutes."""
    global _finance_sync_running
    if _finance_sync_running:
        return {"status": "skipped", "message": "An Amazon Finance sync is already running."}

    days = max(1, min(days, 365))
    _finance_sync_running = True
    background_tasks.add_task(_run_amazon_finance_backfill, days, 2.1)
    return {
        "status": "accepted",
        "message": f"Amazon Finance sync started for the last {days} day(s).",
        "days": days,
    }


@app.get("/sync-amazon-finance/status")
async def amazon_finance_sync_status():
    return {
        "running": _finance_sync_running,
        "last_result": _finance_sync_last_result,
    }


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


class ShippingRateRequest(BaseModel):
    origin_pin: str
    dest_pin: str
    weight_kg: float
    length_cm: float | None = None
    width_cm: float | None = None
    height_cm: float | None = None


@app.post("/shipping-rates")
async def fetch_shipping_rates(req: ShippingRateRequest):
    """Returns Shiprocket carrier quotes for a single origin→destination pair.

    Centralised here so the Next.js frontend doesn't authenticate with
    Shiprocket independently — Shiprocket invalidates a token whenever the
    same account logs in elsewhere, so dual-side auth produces a constant
    flap. With this endpoint the backend is the only token holder.
    """
    dims: dict[str, float] | None = None
    if req.length_cm or req.width_cm or req.height_cm:
        dims = {}
        if req.length_cm:
            dims["length"] = req.length_cm
        if req.width_cm:
            dims["breadth"] = req.width_cm
        if req.height_cm:
            dims["height"] = req.height_cm

    rates, source = await get_shipping_rates_with_source(
        req.origin_pin, req.dest_pin, req.weight_kg, dims
    )
    return {"rates": rates, "source": source}


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


class InvoiceSyncRequest(BaseModel):
    startDate: date | None = None
    endDate: date | None = None


@app.post("/sync-invoices")
async def trigger_invoice_sync(
    payload: InvoiceSyncRequest | None = None,
    session: AsyncSession = Depends(get_db),
):
    """Fetches Amazon GST invoice reports and syncs PowerBISales.

    When ``startDate`` and ``endDate`` are both provided, that explicit window
    is used. Otherwise the rolling lookback / latest-in-db logic applies.
    """
    start = payload.startDate if payload else None
    end = payload.endDate if payload else None
    try:
        return await run_invoice_sync(session, start_date=start, end_date=end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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


# ============================================
# Invoice PDF Upload (ZIP / Folder) — Background
# ============================================

_invoice_upload_status: dict = {
    "state": "idle",        # idle | processing | completed | error
    "message": "",
    "totalPdfs": 0,
    "extracted": 0,
    "inserted": 0,
    "skipped": 0,
    "errors": 0,
    "errorDetails": [],
}


def _reset_upload_status():
    _invoice_upload_status.update({
        "state": "processing",
        "message": "Starting extraction…",
        "totalPdfs": 0,
        "extracted": 0,
        "inserted": 0,
        "skipped": 0,
        "errors": 0,
        "errorDetails": [],
    })


MAX_ZIP_SIZE_MB = 200


async def _process_invoice_rows(raw_rows: list[dict], extraction_errors: list[dict]):
    """Shared logic: build PowerBI rows from extracted invoice data, deduplicate, insert."""
    from invoice_extractor import build_powerbi_row
    from sp_api import (
        _ensure_powerbi_sales_table,
        POWERBI_SALES_INSERT_SQL,
        _load_invoice_sku_meta,
    )
    from sqlalchemy import text as sa_text

    async with SessionLocal() as session:
        await _ensure_powerbi_sales_table(session)
        sku_meta = await _load_invoice_sku_meta(session)

        existing_result = await session.execute(sa_text("""
            SELECT "Invoice Number", "Sku"
            FROM "PowerBISales"
            WHERE "Invoice Number" IS NOT NULL
        """))
        existing_keys: set[tuple[str, str]] = {
            (str(row[0] or ""), str(row[1] or ""))
            for row in existing_result.all()
        }

        inserted = 0
        skipped = 0
        batch: list[dict[str, object]] = []

        for raw in raw_rows:
            pb_row = build_powerbi_row(raw, sku_meta)

            dedupe_key = (str(pb_row.get("invoice_number") or ""), str(pb_row.get("sku") or ""))
            if dedupe_key[0] and dedupe_key in existing_keys:
                skipped += 1
                continue
            existing_keys.add(dedupe_key)

            batch.append(pb_row)
            inserted += 1

            if len(batch) >= 500:
                await session.execute(sa_text(POWERBI_SALES_INSERT_SQL), batch)
                batch = []

        if batch:
            await session.execute(sa_text(POWERBI_SALES_INSERT_SQL), batch)

        await session.commit()

    return inserted, skipped


async def _run_invoice_upload_from_zip(zip_bytes: bytes):
    """Background task: extract invoice PDFs from a ZIP and insert into PowerBISales."""
    from invoice_extractor import extract_invoices_from_zip

    try:
        _invoice_upload_status["message"] = "Extracting PDFs from ZIP…"
        raw_rows, extraction_errors = extract_invoices_from_zip(zip_bytes)

        _invoice_upload_status["extracted"] = len(raw_rows)
        _invoice_upload_status["errors"] = len(extraction_errors)
        _invoice_upload_status["errorDetails"] = extraction_errors[:20]
        _invoice_upload_status["totalPdfs"] = len(raw_rows) + len(extraction_errors)

        if not raw_rows:
            _invoice_upload_status["state"] = "error"
            _invoice_upload_status["message"] = (
                f"All {len(extraction_errors)} PDFs failed. "
                + (f"First error: {extraction_errors[0]['error']}" if extraction_errors else "No PDFs found in ZIP.")
            )
            return

        _invoice_upload_status["message"] = f"Inserting {len(raw_rows)} rows into database…"
        inserted, skipped = await _process_invoice_rows(raw_rows, extraction_errors)

        _invoice_upload_status["inserted"] = inserted
        _invoice_upload_status["skipped"] = skipped
        _invoice_upload_status["state"] = "completed"
        _invoice_upload_status["message"] = (
            f"Processed {len(raw_rows)} PDFs: {inserted} inserted, {skipped} duplicates skipped."
        )
        logger.info(
            "Invoice ZIP upload complete: %d inserted, %d skipped, %d errors",
            inserted, skipped, len(extraction_errors),
        )

    except Exception as exc:
        logger.exception("Invoice ZIP upload failed")
        _invoice_upload_status["state"] = "error"
        _invoice_upload_status["message"] = f"Upload failed: {exc}"


async def _run_invoice_upload_from_folder(folder_path: str):
    """Background task: extract invoice PDFs from a local folder and insert into PowerBISales."""
    from invoice_extractor import extract_invoices_from_folder

    try:
        _invoice_upload_status["message"] = f"Extracting PDFs from {folder_path}…"
        raw_rows, extraction_errors = extract_invoices_from_folder(folder_path)

        _invoice_upload_status["extracted"] = len(raw_rows)
        _invoice_upload_status["errors"] = len(extraction_errors)
        _invoice_upload_status["errorDetails"] = extraction_errors[:20]
        _invoice_upload_status["totalPdfs"] = len(raw_rows) + len(extraction_errors)

        if not raw_rows:
            _invoice_upload_status["state"] = "error"
            _invoice_upload_status["message"] = (
                f"No valid PDFs extracted from {folder_path}. "
                + (f"First error: {extraction_errors[0]['error']}" if extraction_errors else "No PDF files found.")
            )
            return

        _invoice_upload_status["message"] = f"Inserting {len(raw_rows)} rows into database…"
        inserted, skipped = await _process_invoice_rows(raw_rows, extraction_errors)

        _invoice_upload_status["inserted"] = inserted
        _invoice_upload_status["skipped"] = skipped
        _invoice_upload_status["state"] = "completed"
        _invoice_upload_status["message"] = (
            f"Processed {len(raw_rows)} PDFs from folder: {inserted} inserted, {skipped} duplicates skipped."
        )
        logger.info(
            "Invoice folder upload complete: %d inserted, %d skipped, %d errors from %s",
            inserted, skipped, len(extraction_errors), folder_path,
        )

    except Exception as exc:
        logger.exception("Invoice folder upload failed")
        _invoice_upload_status["state"] = "error"
        _invoice_upload_status["message"] = f"Folder upload failed: {exc}"


@app.post("/upload-invoices")
async def upload_invoices(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """Accept a ZIP file containing Amazon invoice PDFs.
    Starts extraction and DB insertion in the background. Poll /upload-invoices/status for progress.
    """
    if _invoice_upload_status["state"] == "processing":
        raise HTTPException(status_code=409, detail="An upload is already in progress. Check /upload-invoices/status.")

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted")

    try:
        zip_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {exc}")

    if len(zip_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    size_mb = len(zip_bytes) / (1024 * 1024)
    if size_mb > MAX_ZIP_SIZE_MB:
        raise HTTPException(status_code=400, detail=f"File too large ({size_mb:.0f} MB). Maximum is {MAX_ZIP_SIZE_MB} MB.")

    _reset_upload_status()
    _invoice_upload_status["message"] = f"Upload received ({size_mb:.1f} MB). Starting extraction…"

    background_tasks.add_task(_run_invoice_upload_from_zip, zip_bytes)
    return {"status": "accepted", "message": f"Upload received. Processing {file.filename} in background."}


class FolderUploadRequest(BaseModel):
    folderPath: str


@app.post("/upload-invoices-folder")
async def upload_invoices_from_folder(
    payload: FolderUploadRequest,
    background_tasks: BackgroundTasks,
):
    """Accept a local folder path containing Amazon invoice PDFs.
    This endpoint only works when the backend runs locally (not on Render/cloud).
    Starts extraction in the background. Poll /upload-invoices/status for progress.
    """
    if _invoice_upload_status["state"] == "processing":
        raise HTTPException(status_code=409, detail="An upload is already in progress. Check /upload-invoices/status.")

    import os
    folder_path = payload.folderPath.strip()
    if not folder_path or not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail=f"Folder not found: {folder_path}")

    _reset_upload_status()
    _invoice_upload_status["message"] = f"Starting extraction from {folder_path}…"

    background_tasks.add_task(_run_invoice_upload_from_folder, folder_path)
    return {"status": "accepted", "message": f"Processing folder in background: {folder_path}"}


@app.get("/upload-invoices/status")
async def upload_invoices_status():
    """Returns the current status of the invoice upload/extraction background task."""
    return _invoice_upload_status

