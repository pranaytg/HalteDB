# HalteDB — Sales Intelligence Platform

**Amazon Seller Analytics Dashboard** — Real-time sales tracking, profitability analysis, inventory intelligence, and demand forecasting.

## Architecture

```
┌──────────────────────┐          ┌──────────────────────┐
│   HalteDB Backend    │          │   Next.js Frontend   │
│   (Python/FastAPI)   │          │    (Fullstack App)    │
│                      │          │                      │
│  SP-API → Database   │          │  Database → Display  │
│  • Inventory sync    │          │  • Sales dashboard   │
│  • Order backfill    │          │  • Profitability     │
│  • Report streaming  │          │  • Forecasting       │
│                      │          │  • COGS management   │
└──────────┬───────────┘          └──────────┬───────────┘
           │                                 │
           └────────────┐   ┌────────────────┘
                        ▼   ▼
               ┌────────────────────┐
               │   Supabase (PG)    │
               │                    │
               │  • inventory       │
               │  • orders          │
               │  • cogs            │
               └────────────────────┘
```

**Two separate codebases:**
- **`/` (root)** — HalteDB Backend: Python FastAPI that syncs data from Amazon SP-API into the PostgreSQL database. Does NOT serve the frontend.
- **`/frontend`** — Next.js Fullstack App: Reads directly from the Supabase database and displays analytics, predictions, and management tools. Does NOT touch SP-API.

---

## What Changed (March 2026)

### Before
- Only two database tables: `inventory` (synced from SP-API) and `orders` (backfilled from SP-API)
- No COGS tracking, no profitability calculation
- No frontend dashboard — all analysis was manual
- No demand forecasting

### What Was Added

| Component | Change | Why |
|---|---|---|
| **`cogs` table** | New table with `sku` (unique), `cogs_price`, `last_updated` | Track cost of goods per SKU for profit calculation |
| **`orders.profit`** | New column: `item_price - cogs_price` | Enable per-order profitability tracking |
| **`orders.cogs_price`** | New column: locked COGS at time of order | Audit trail for historical cost |
| **`seed_cogs.py`** | Seeded 367 COGS entries from inventory SKUs | Bootstrap with random prices ₹50–₹500 |
| **Profit backfill** | Calculated profit on recent 1000 orders | Immediate profitability visibility |
| **Next.js frontend** | Complete dashboard with 4 pages | Admin-only analytics portal |
| **Forecasting engine** | Holt-Winters Triple Exponential Smoothing | Demand prediction with seasonality |

---

## Database Schema

### `inventory` table
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (PK) | Auto-increment |
| `sku` | STRING | Amazon SKU |
| `fnsku` | STRING | Fulfillment Network SKU |
| `asin` | STRING | Amazon Standard ID |
| `condition` | STRING | Item condition |
| `fulfillment_center_id` | STRING | Warehouse ID |
| `fulfillable_quantity` | INTEGER | Available stock |
| `unfulfillable_quantity` | INTEGER | Damaged/defective |
| `reserved_quantity` | INTEGER | Customer reserved |
| `inbound_*_quantity` | INTEGER | Inbound pipeline |
| `last_updated` | DATETIME | Audit timestamp |
| **Unique** | `(sku, fulfillment_center_id, condition)` | |

### `cogs` table (NEW)
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (PK) | Auto-increment |
| `sku` | STRING (UNIQUE) | Links to inventory & orders by SKU |
| `cogs_price` | FLOAT | Cost of goods in ₹ |
| `last_updated` | DATETIME | Last COGS update |

### `orders` table (MODIFIED)
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (PK) | Auto-increment |
| `amazon_order_id` | STRING | Amazon order reference |
| `purchase_date` | DATETIME | Order date |
| `sku` | STRING | Links to COGS & inventory |
| `item_price` | FLOAT | Selling price |
| `cogs_price` | FLOAT | **NEW** — Locked COGS at order time |
| `profit` | FLOAT | **NEW** — `item_price - cogs_price` |
| **Unique** | `(amazon_order_id, sku)` | |

### Relationships
```
inventory.sku ←→ cogs.sku ←→ orders.sku
```
All three tables are linked by `sku`. When COGS is updated, profit is recalculated on all matching orders.

---

## Frontend Pages

### Login (`/`)
- Admin-only authentication
- Credentials: `RamanSir` / `RamanSir1234@`
- JWT-based session (24h expiry, stored in localStorage)
- All other pages require authentication

### Sales Dashboard (`/sales`)
**Three tabs:**

1. **Overview** — Monthly revenue/profit bar chart, daily trend (30 days), top SKUs pie chart
2. **Orders** — Paginated order table with profit per order
3. **Predictions** — 6-month sales forecast with confidence intervals

**Power BI-style cross-filtering:**
- Click a month bar → filters all data to that month
- Click a SKU pie segment → filters all data to that SKU
- Filter bar: SKU dropdown, year, month picker, date range
- All filters affect metrics, charts, and tables simultaneously

### Inventory (`/inventory`)
**Three tabs:**

1. **Overview** — Stock by warehouse (pie + bar), searchable SKU table
2. **Warehouse View** — Per-warehouse summary table
3. **Restock Predictions** — 3-month demand forecast, restock urgency per SKU (Critical/Low/Healthy)

### COGS (`/cogs`)
- Searchable table of all 367 SKUs
- Inline editing — click "Edit", change price, hit Enter/Save
- Auto-recalculates profit on ALL orders for that SKU
- Summary metrics: Total SKUs, Avg/Min/Max COGS

---

## Forecasting Methodology

**Algorithm:** Holt-Winters Triple Exponential Smoothing (Additive)

### Why This Approach
After researching Prophet, ARIMA, statsforecast, and deep learning approaches:
- Prophet is overkill for this volume and has heavy install deps
- ARIMA requires manual parameter tuning per SKU (impractical for 367 SKUs)
- Holt-Winters is optimal: captures **trend + seasonality** with automatic smoothing

### How It Works
1. **Level smoothing** (α = 0.3) — tracks the baseline demand
2. **Trend smoothing** (β = 0.1) — captures growth/decline
3. **Seasonal smoothing** (γ = 0.3) — captures monthly patterns (12-month cycle)
4. Falls back to Simple Exponential Smoothing for sparse SKUs (< 12 months of data)
5. **95% confidence intervals** using MAE × √h × 1.96

### Outputs
- **Sales forecast**: 6 months ahead, aggregate and per-SKU
- **Inventory prediction**: 3 months ahead, calculates restock needs per-SKU and per-warehouse based on forecasted sales velocity vs. current stock

---

## API Routes (Next.js)

| Route | Method | Description |
|---|---|---|
| `/api/auth/login` | POST | Authenticate admin, returns JWT |
| `/api/sales` | GET | Orders with filters (sku, year, month, date range) |
| `/api/sales/summary` | GET | Monthly, daily, and SKU aggregations for charts |
| `/api/sales/predictions` | GET | Holt-Winters forecast (aggregate + SKU-level) |
| `/api/inventory` | GET | Stock levels (overall + warehouse-wise + grand total) |
| `/api/inventory/predictions` | GET | Restock predictions (SKU + warehouse level) |
| `/api/cogs` | GET | List all COGS entries |
| `/api/cogs` | PUT | Update COGS price, auto-recalculate profit |

---

## Setup

### Backend (HalteDB)
```bash
cd HalteDB
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r requirements.txt
# OR with uv:
uv sync

# Run migration
python -m alembic upgrade head

# Seed COGS (only need to run once)
python seed_cogs.py

# Start backend (SP-API sync server)
uvicorn main:app --reload
```

### Frontend (Next.js Dashboard)
```bash
cd frontend
npm install
npm run dev    # → http://localhost:3000
```

### Environment
The `.env` file in root contains all credentials:
- `SUPABASE_URL` — PostgreSQL connection string
- `SP_API_*` — Amazon SP-API credentials
- `APP_*` — App configuration

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy, Alembic |
| Frontend | Next.js 16, TypeScript, React |
| Charts | Recharts |
| Database | PostgreSQL (Supabase) |
| Auth | JWT (jose), hardcoded admin |
| Forecasting | Holt-Winters (pure TypeScript) |
| SP-API | httpx, zlib streaming |
