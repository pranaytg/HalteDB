import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { generateForecasts, generateAggregateForecasts } from "@/lib/forecasting";

export async function GET() {
  try {
    // Get monthly historical data by SKU
    const historicalQuery = `
      SELECT 
        TO_CHAR(purchase_date, 'YYYY-MM') as month,
        sku,
        COALESCE(SUM(quantity), 0) as total_quantity,
        COALESCE(SUM(item_price), 0) as total_revenue
      FROM orders
      WHERE purchase_date IS NOT NULL
      GROUP BY TO_CHAR(purchase_date, 'YYYY-MM'), sku
      ORDER BY month ASC
    `;
    const result = await pool.query(historicalQuery);

    const historicalData = result.rows.map((r: { month: string; sku: string; total_quantity: string; total_revenue: string }) => ({
      month: r.month,
      sku: r.sku,
      total_quantity: parseInt(r.total_quantity),
      total_revenue: parseFloat(r.total_revenue),
    }));

    // Generate SKU-level forecasts
    const skuForecasts = generateForecasts(historicalData, 6);

    // Generate aggregate forecasts
    const aggregateForecasts = generateAggregateForecasts(historicalData, 6);

    // Get historical monthly aggregate for chart continuity
    const monthlyAgg = new Map<string, { qty: number; rev: number }>();
    for (const dp of historicalData) {
      const existing = monthlyAgg.get(dp.month) || { qty: 0, rev: 0 };
      existing.qty += dp.total_quantity;
      existing.rev += dp.total_revenue;
      monthlyAgg.set(dp.month, existing);
    }

    const historicalMonthly = [...monthlyAgg.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        total_quantity: data.qty,
        total_revenue: Math.round(data.rev * 100) / 100,
        type: "actual",
      }));

    return NextResponse.json({
      historical: historicalMonthly,
      aggregateForecasts,
      skuForecasts: skuForecasts.slice(0, 100), // Top 100 SKU forecasts
      methodology: "Holt-Winters Triple Exponential Smoothing with additive seasonality (12-month cycle)",
    });
  } catch (error) {
    console.error("Predictions API error:", error);
    return NextResponse.json(
      { error: "Failed to generate predictions" },
      { status: 500 }
    );
  }
}
