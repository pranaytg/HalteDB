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
