/**
 * Sales Forecasting Engine
 * ========================
 * Uses Triple Exponential Smoothing (Holt-Winters) for seasonal forecasting.
 * Handles monthly and seasonal variations at SKU level.
 *
 * This runs in the Next.js API route (server-side).
 */

interface SalesDataPoint {
  month: string; // YYYY-MM
  sku: string;
  total_quantity: number;
  total_revenue: number;
}

interface ForecastResult {
  month: string;
  sku: string;
  predicted_quantity: number;
  predicted_revenue: number;
  confidence_lower: number;
  confidence_upper: number;
}

/**
 * Simple Exponential Smoothing with Seasonality (Holt-Winters Additive)
 * Optimized for e-commerce SKU-level monthly sales.
 */
function holtWintersAdditive(
  data: number[],
  seasonLength: number = 12,
  forecastPeriods: number = 6,
  alpha: number = 0.3,  // level smoothing
  beta: number = 0.1,   // trend smoothing
  gamma: number = 0.3   // seasonal smoothing
): { forecast: number[]; lower: number[]; upper: number[] } {
  const n = data.length;

  if (n < 2) {
    // Not enough data — return simple average
    const avg = n > 0 ? data[0] : 0;
    return {
      forecast: Array(forecastPeriods).fill(Math.max(0, avg)),
      lower: Array(forecastPeriods).fill(0),
      upper: Array(forecastPeriods).fill(Math.max(0, avg * 2)),
    };
  }

  // If less than one full season, use simpler model
  if (n < seasonLength) {
    return simpleExponentialSmoothing(data, forecastPeriods, alpha);
  }

  // Initialize level and trend from first season
  let level = data.slice(0, seasonLength).reduce((a, b) => a + b, 0) / seasonLength;
  let trend = 0;
  if (n >= 2 * seasonLength) {
    const firstSeasonAvg = data.slice(0, seasonLength).reduce((a, b) => a + b, 0) / seasonLength;
    const secondSeasonAvg = data.slice(seasonLength, 2 * seasonLength).reduce((a, b) => a + b, 0) / seasonLength;
    trend = (secondSeasonAvg - firstSeasonAvg) / seasonLength;
  }

  // Initialize seasonal components
  const seasonal: number[] = [];
  for (let i = 0; i < seasonLength; i++) {
    seasonal.push(data[i] - level);
  }

  // Smooth through the data
  const errors: number[] = [];
  for (let i = 0; i < n; i++) {
    const seasonIdx = i % seasonLength;
    const predicted = level + trend + seasonal[seasonIdx];
    const error = data[i] - predicted;
    errors.push(Math.abs(error));

    const newLevel = alpha * (data[i] - seasonal[seasonIdx]) + (1 - alpha) * (level + trend);
    const newTrend = beta * (newLevel - level) + (1 - beta) * trend;
    seasonal[seasonIdx] = gamma * (data[i] - newLevel) + (1 - gamma) * seasonal[seasonIdx];

    level = newLevel;
    trend = newTrend;
  }

  // Calculate MAE for confidence intervals
  const mae = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;

  // Generate forecasts
  const forecast: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];

  for (let h = 1; h <= forecastPeriods; h++) {
    const seasonIdx = (n + h - 1) % seasonLength;
    const pred = Math.max(0, level + trend * h + seasonal[seasonIdx]);
    const ci = mae * Math.sqrt(h) * 1.96; // 95% confidence
    forecast.push(Math.round(pred));
    lower.push(Math.max(0, Math.round(pred - ci)));
    upper.push(Math.round(pred + ci));
  }

  return { forecast, lower, upper };
}

function simpleExponentialSmoothing(
  data: number[],
  forecastPeriods: number,
  alpha: number
): { forecast: number[]; lower: number[]; upper: number[] } {
  let level = data[0];
  let trend = data.length > 1 ? (data[data.length - 1] - data[0]) / (data.length - 1) : 0;
  const errors: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const pred = level + trend;
    errors.push(Math.abs(data[i] - pred));
    const newLevel = alpha * data[i] + (1 - alpha) * (level + trend);
    trend = 0.1 * (newLevel - level) + 0.9 * trend;
    level = newLevel;
  }

  const mae = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : level * 0.3;
  const forecast: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];

  for (let h = 1; h <= forecastPeriods; h++) {
    const pred = Math.max(0, level + trend * h);
    const ci = mae * Math.sqrt(h) * 1.96;
    forecast.push(Math.round(pred));
    lower.push(Math.max(0, Math.round(pred - ci)));
    upper.push(Math.round(pred + ci));
  }

  return { forecast, lower, upper };
}

/**
 * Generate future month strings from a start date
 */
function generateFutureMonths(startMonth: string, count: number): string[] {
  const [year, month] = startMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(year, month - 1 + i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

/**
 * Main forecasting function
 * Takes historical monthly sales data, returns forecasts per SKU
 */
export function generateForecasts(
  historicalData: SalesDataPoint[],
  forecastMonths: number = 6
): ForecastResult[] {
  // Group by SKU
  const skuData = new Map<string, Map<string, { qty: number; rev: number }>>();

  for (const dp of historicalData) {
    if (!skuData.has(dp.sku)) {
      skuData.set(dp.sku, new Map());
    }
    skuData.get(dp.sku)!.set(dp.month, {
      qty: dp.total_quantity,
      rev: dp.total_revenue,
    });
  }

  // Get all months sorted
  const allMonths = [...new Set(historicalData.map((d) => d.month))].sort();

  if (allMonths.length === 0) return [];

  const futureMonths = generateFutureMonths(
    allMonths[allMonths.length - 1],
    forecastMonths
  );

  const results: ForecastResult[] = [];

  for (const [sku, monthData] of skuData) {
    // Build time series (fill gaps with 0)
    const qtySeries = allMonths.map((m) => monthData.get(m)?.qty ?? 0);
    const revSeries = allMonths.map((m) => monthData.get(m)?.rev ?? 0);

    // Forecast
    const qtyForecast = holtWintersAdditive(qtySeries, 12, forecastMonths);
    const revForecast = holtWintersAdditive(revSeries, 12, forecastMonths);

    for (let i = 0; i < forecastMonths; i++) {
      results.push({
        month: futureMonths[i],
        sku,
        predicted_quantity: qtyForecast.forecast[i],
        predicted_revenue: Math.round(revForecast.forecast[i] * 100) / 100,
        confidence_lower: qtyForecast.lower[i],
        confidence_upper: qtyForecast.upper[i],
      });
    }
  }

  return results;
}

/**
 * Generate aggregate (all-SKU) forecasts
 */
export function generateAggregateForecasts(
  historicalData: SalesDataPoint[],
  forecastMonths: number = 6
): Omit<ForecastResult, "sku">[] {
  // Aggregate by month
  const monthlyAgg = new Map<string, { qty: number; rev: number }>();

  for (const dp of historicalData) {
    const existing = monthlyAgg.get(dp.month) || { qty: 0, rev: 0 };
    existing.qty += dp.total_quantity;
    existing.rev += dp.total_revenue;
    monthlyAgg.set(dp.month, existing);
  }

  const allMonths = [...monthlyAgg.keys()].sort();
  if (allMonths.length === 0) return [];

  const futureMonths = generateFutureMonths(
    allMonths[allMonths.length - 1],
    forecastMonths
  );

  const qtySeries = allMonths.map((m) => monthlyAgg.get(m)!.qty);
  const revSeries = allMonths.map((m) => monthlyAgg.get(m)!.rev);

  const qtyForecast = holtWintersAdditive(qtySeries, 12, forecastMonths);
  const revForecast = holtWintersAdditive(revSeries, 12, forecastMonths);

  return futureMonths.map((month, i) => ({
    month,
    predicted_quantity: qtyForecast.forecast[i],
    predicted_revenue: Math.round(revForecast.forecast[i] * 100) / 100,
    confidence_lower: qtyForecast.lower[i],
    confidence_upper: qtyForecast.upper[i],
  }));
}


// ============================================================
// REPLENISHMENT ENGINE — Lead-Time-Aware Demand Projection
// ============================================================
// Uses daily granularity with weighted recency for maximum accuracy.
// Designed for 15-day lead time with 2-month (60-day) stock coverage.

export interface DailySalesRow {
  sale_date: string;  // YYYY-MM-DD
  sku: string;
  daily_qty: number;
  daily_revenue: number;
}

export interface InventoryRow {
  sku: string;
  asin: string | null;
  fulfillment_center_id: string;
  fulfillable_quantity: number;
  inbound_working_quantity: number;
  inbound_shipped_quantity: number;
  inbound_receiving_quantity: number;
}

export interface ReplenishmentConfig {
  lead_time_days: number;     // Default: 15
  coverage_days: number;      // Default: 60 (2 months)
  safety_factor: number;      // Default: 1.25 (25% buffer)
}

export type UrgencyLevel = "CRITICAL" | "URGENT" | "LOW" | "HEALTHY" | "OVERSTOCK";
export type VelocityWindow = "7d" | "14d" | "weighted" | "30d" | "90d";
export type TrendDirection = "accelerating" | "stable" | "declining";

export interface SkuVelocity {
  sku: string;
  asin: string | null;
  velocity_7d: number;
  velocity_14d: number;
  velocity_30d: number;
  velocity_90d: number;
  weighted_velocity: number;
  trend: TrendDirection;
  data_days: number;  // how many days of sales data exist
}

export interface SkuReplenishment {
  sku: string;
  asin: string | null;
  weighted_velocity: number;
  velocity_7d: number;
  velocity_14d: number;
  velocity_30d: number;
  velocity_90d: number;
  trend: TrendDirection;
  lead_time_demand: number;
  target_stock_2m: number;
  current_stock: number;
  in_transit: number;
  reorder_qty: number;
  reorder_value: number;
  days_of_coverage: number;
  urgency: UrgencyLevel;
  warehouse_allocation: Record<string, number>;
}

export interface WarehouseReplenishmentSummary {
  warehouse: string;
  total_current_stock: number;
  total_in_transit: number;
  total_reorder_needed: number;
  skus_critical: number;
  skus_urgent: number;
  skus_total: number;
}

export interface ReplenishmentResult {
  generated_at: string;
  config: ReplenishmentConfig;
  summary: {
    total_skus_analyzed: number;
    critical_skus: number;
    urgent_skus: number;
    low_skus: number;
    healthy_skus: number;
    overstock_skus: number;
    total_reorder_units: number;
    total_reorder_value: number;
    avg_days_of_coverage: number;
  };
  skuRecommendations: SkuReplenishment[];
  warehouseSummary: WarehouseReplenishmentSummary[];
}

/**
 * Calculate daily average sales velocity for a SKU over a given window.
 */
function calcVelocity(
  dailySales: Map<string, number>,
  windowDays: number,
  today: Date
): number {
  let totalQty = 0;

  for (let d = 0; d < windowDays; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const key = date.toISOString().slice(0, 10);
    const qty = dailySales.get(key);
    if (qty !== undefined) {
      totalQty += qty;
    }
  }

  // Use actual window days as denominator (not just days with sales)
  // to avoid inflating velocity for SKUs that sell infrequently
  return windowDays > 0 ? totalQty / windowDays : 0;
}

/**
 * Determine trend direction by comparing short-term vs long-term velocity.
 */
function detectTrend(v7d: number, v30d: number, v90d: number): TrendDirection {
  // Use 30d as the baseline; compare 7d to it
  const baseline = v90d > 0 ? v90d : v30d;
  if (baseline === 0 && v7d === 0) return "stable";
  if (baseline === 0 && v7d > 0) return "accelerating";

  const ratio = v7d / baseline;
  if (ratio > 1.20) return "accelerating";  // 20%+ increase
  if (ratio < 0.80) return "declining";     // 20%+ decrease
  return "stable";
}

/**
 * Classify urgency based on days of coverage relative to lead time.
 */
function classifyUrgency(daysCoverage: number): UrgencyLevel {
  if (daysCoverage < 15) return "CRITICAL";     // Will stockout during lead time
  if (daysCoverage < 30) return "URGENT";        // Less than 1 month
  if (daysCoverage < 45) return "LOW";           // 1-1.5 months
  if (daysCoverage <= 90) return "HEALTHY";      // Good coverage
  return "OVERSTOCK";                            // Potential dead stock
}

/**
 * Main replenishment calculation engine.
 *
 * Takes raw daily sales and inventory data, returns actionable
 * replenishment recommendations per SKU and per warehouse.
 */
export function calculateReplenishment(
  dailySalesData: DailySalesRow[],
  inventoryData: InventoryRow[],
  cogsData: Map<string, number>,
  config: ReplenishmentConfig = {
    lead_time_days: 15,
    coverage_days: 60,
    safety_factor: 1.25,
  },
  window: VelocityWindow = "weighted"
): ReplenishmentResult {
  const today = new Date();

  // ── Step 1: Build daily sales map per SKU ──
  // Map<sku, Map<date_string, total_qty>>
  const skuDailySales = new Map<string, Map<string, number>>();

  for (const row of dailySalesData) {
    if (!skuDailySales.has(row.sku)) {
      skuDailySales.set(row.sku, new Map());
    }
    const dateMap = skuDailySales.get(row.sku)!;
    const existing = dateMap.get(row.sale_date) || 0;
    dateMap.set(row.sale_date, existing + row.daily_qty);
  }

  // ── Step 2: Build inventory aggregates ──
  // Per-SKU total stock and per-warehouse breakdown
  const skuStock = new Map<string, { fulfillable: number; inTransit: number; asin: string | null }>();
  const warehouseSkuStock = new Map<string, Map<string, { fulfillable: number; inTransit: number }>>();

  for (const row of inventoryData) {
    const inTransit = (row.inbound_working_quantity || 0)
      + (row.inbound_shipped_quantity || 0)
      + (row.inbound_receiving_quantity || 0);

    // SKU aggregate
    const existing = skuStock.get(row.sku) || { fulfillable: 0, inTransit: 0, asin: null };
    existing.fulfillable += row.fulfillable_quantity || 0;
    existing.inTransit += inTransit;
    if (row.asin) existing.asin = row.asin;
    skuStock.set(row.sku, existing);

    // Warehouse × SKU
    if (!warehouseSkuStock.has(row.fulfillment_center_id)) {
      warehouseSkuStock.set(row.fulfillment_center_id, new Map());
    }
    const whMap = warehouseSkuStock.get(row.fulfillment_center_id)!;
    const whExisting = whMap.get(row.sku) || { fulfillable: 0, inTransit: 0 };
    whExisting.fulfillable += row.fulfillable_quantity || 0;
    whExisting.inTransit += inTransit;
    whMap.set(row.sku, whExisting);
  }

  // ── Step 3: Get all unique SKUs (union of sales + inventory) ──
  const allSkus = new Set<string>();
  for (const sku of skuDailySales.keys()) allSkus.add(sku);
  for (const sku of skuStock.keys()) allSkus.add(sku);

  // ── Step 4: Calculate velocities & replenishment per SKU ──
  const skuRecommendations: SkuReplenishment[] = [];

  for (const sku of allSkus) {
    const dailySales = skuDailySales.get(sku) || new Map<string, number>();
    const stock = skuStock.get(sku) || { fulfillable: 0, inTransit: 0, asin: null };

    // Multi-window velocities
    const v7d = calcVelocity(dailySales, 7, today);
    const v14d = calcVelocity(dailySales, 14, today);
    const v30d = calcVelocity(dailySales, 30, today);
    const v90d = calcVelocity(dailySales, 90, today);

    // Weighted velocity — recent data weighted more heavily
    // Weights: 7d=3, 14d=2, 30d=1.5, 90d=1 → total weight = 7.5
    const weightedVelocity = (v7d * 3 + v14d * 2 + v30d * 1.5 + v90d * 1) / 7.5;

    // Select effective velocity based on window parameter
    const effectiveVelocity = window === "7d" ? v7d
      : window === "14d" ? v14d
      : window === "30d" ? v30d
      : window === "90d" ? v90d
      : weightedVelocity;

    const trend = detectTrend(v7d, v30d, v90d);

    // Demand projections
    const leadTimeDemand = Math.ceil(effectiveVelocity * config.lead_time_days * config.safety_factor);
    const targetStock = Math.ceil(effectiveVelocity * config.coverage_days * config.safety_factor);

    // Coverage calculation
    const availableStock = stock.fulfillable + stock.inTransit;
    const daysCoverage = effectiveVelocity > 0
      ? Math.round((availableStock / effectiveVelocity) * 10) / 10
      : availableStock > 0 ? 999 : 0;

    // Reorder quantity
    const reorderQty = Math.max(0, targetStock - availableStock);

    // Reorder value (using COGS if available)
    const unitCost = cogsData.get(sku) || 0;
    const reorderValue = Math.round(reorderQty * unitCost * 100) / 100;

    // Urgency
    const urgency = classifyUrgency(daysCoverage);

    // Per-warehouse allocation (proportional to current stock distribution)
    const warehouseAllocation: Record<string, number> = {};
    if (reorderQty > 0) {
      // Find all warehouses that carry this SKU
      const warehouseShares: { wh: string; share: number }[] = [];
      let totalWhStock = 0;

      for (const [wh, skuMap] of warehouseSkuStock) {
        const whStock = skuMap.get(sku);
        if (whStock) {
          warehouseShares.push({ wh, share: whStock.fulfillable });
          totalWhStock += whStock.fulfillable;
        }
      }

      if (warehouseShares.length === 0) {
        // SKU not in any warehouse yet — distribute evenly across all warehouses
        const warehouses = [...warehouseSkuStock.keys()];
        const perWh = Math.ceil(reorderQty / Math.max(warehouses.length, 1));
        for (const wh of warehouses) {
          warehouseAllocation[wh] = perWh;
        }
      } else if (totalWhStock === 0) {
        // Has warehouse presence but zero stock — distribute evenly among those warehouses
        const perWh = Math.ceil(reorderQty / warehouseShares.length);
        for (const ws of warehouseShares) {
          warehouseAllocation[ws.wh] = perWh;
        }
      } else {
        // Proportional allocation based on current stock distribution
        let allocated = 0;
        for (let i = 0; i < warehouseShares.length; i++) {
          const proportion = warehouseShares[i].share / totalWhStock;
          const alloc = i === warehouseShares.length - 1
            ? reorderQty - allocated  // last warehouse gets remainder
            : Math.round(reorderQty * proportion);
          warehouseAllocation[warehouseShares[i].wh] = Math.max(0, alloc);
          allocated += alloc;
        }
      }
    }

    skuRecommendations.push({
      sku,
      asin: stock.asin,
      weighted_velocity: Math.round(effectiveVelocity * 100) / 100,
      velocity_7d: Math.round(v7d * 100) / 100,
      velocity_14d: Math.round(v14d * 100) / 100,
      velocity_30d: Math.round(v30d * 100) / 100,
      velocity_90d: Math.round(v90d * 100) / 100,
      trend,
      lead_time_demand: leadTimeDemand,
      target_stock_2m: targetStock,
      current_stock: stock.fulfillable,
      in_transit: stock.inTransit,
      reorder_qty: reorderQty,
      reorder_value: reorderValue,
      days_of_coverage: daysCoverage,
      urgency,
      warehouse_allocation: warehouseAllocation,
    });
  }

  // Sort by urgency priority then by reorder qty descending
  const urgencyOrder: Record<UrgencyLevel, number> = {
    CRITICAL: 0, URGENT: 1, LOW: 2, HEALTHY: 3, OVERSTOCK: 4,
  };
  skuRecommendations.sort((a, b) => {
    const urgDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (urgDiff !== 0) return urgDiff;
    return b.reorder_qty - a.reorder_qty;
  });

  // ── Step 5: Warehouse summary ──
  const warehouseSummary: WarehouseReplenishmentSummary[] = [];

  for (const [wh, skuMap] of warehouseSkuStock) {
    let totalStock = 0;
    let totalInTransit = 0;
    let totalReorder = 0;
    let criticalCount = 0;
    let urgentCount = 0;
    let skuCount = 0;

    for (const [sku, stock] of skuMap) {
      totalStock += stock.fulfillable;
      totalInTransit += stock.inTransit;
      skuCount++;

      // Find this SKU's recommendation
      const rec = skuRecommendations.find(r => r.sku === sku);
      if (rec) {
        totalReorder += rec.warehouse_allocation[wh] || 0;
        if (rec.urgency === "CRITICAL") criticalCount++;
        if (rec.urgency === "URGENT") urgentCount++;
      }
    }

    warehouseSummary.push({
      warehouse: wh,
      total_current_stock: totalStock,
      total_in_transit: totalInTransit,
      total_reorder_needed: totalReorder,
      skus_critical: criticalCount,
      skus_urgent: urgentCount,
      skus_total: skuCount,
    });
  }

  warehouseSummary.sort((a, b) => b.total_reorder_needed - a.total_reorder_needed);

  // ── Step 6: Summary stats ──
  const criticalSkus = skuRecommendations.filter(r => r.urgency === "CRITICAL").length;
  const urgentSkus = skuRecommendations.filter(r => r.urgency === "URGENT").length;
  const lowSkus = skuRecommendations.filter(r => r.urgency === "LOW").length;
  const healthySkus = skuRecommendations.filter(r => r.urgency === "HEALTHY").length;
  const overstockSkus = skuRecommendations.filter(r => r.urgency === "OVERSTOCK").length;
  const totalReorderUnits = skuRecommendations.reduce((sum, r) => sum + r.reorder_qty, 0);
  const totalReorderValue = skuRecommendations.reduce((sum, r) => sum + r.reorder_value, 0);
  const skusWithVelocity = skuRecommendations.filter(r => r.weighted_velocity > 0);
  const avgCoverage = skusWithVelocity.length > 0
    ? Math.round(skusWithVelocity.reduce((sum, r) => sum + Math.min(r.days_of_coverage, 999), 0) / skusWithVelocity.length * 10) / 10
    : 0;

  return {
    generated_at: today.toISOString(),
    config,
    summary: {
      total_skus_analyzed: skuRecommendations.length,
      critical_skus: criticalSkus,
      urgent_skus: urgentSkus,
      low_skus: lowSkus,
      healthy_skus: healthySkus,
      overstock_skus: overstockSkus,
      total_reorder_units: totalReorderUnits,
      total_reorder_value: Math.round(totalReorderValue * 100) / 100,
      avg_days_of_coverage: avgCoverage,
    },
    skuRecommendations,
    warehouseSummary,
  };
}
