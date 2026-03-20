import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    // Monthly aggregated sales data for charts
    const monthlyQuery = `
      SELECT 
        TO_CHAR(purchase_date, 'YYYY-MM') as month,
        COUNT(*) as total_orders,
        COALESCE(SUM(item_price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(quantity), 0) as total_units
      FROM orders
      WHERE purchase_date IS NOT NULL
      GROUP BY TO_CHAR(purchase_date, 'YYYY-MM')
      ORDER BY month ASC
    `;
    const monthlyResult = await pool.query(monthlyQuery);

    // SKU-wise summary
    const skuQuery = `
      SELECT 
        sku,
        COUNT(*) as total_orders,
        COALESCE(SUM(item_price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(quantity), 0) as total_units
      FROM orders
      WHERE purchase_date IS NOT NULL
      GROUP BY sku
      ORDER BY total_revenue DESC
      LIMIT 20
    `;
    const skuResult = await pool.query(skuQuery);

    // Daily sales for the last 30 days
    const dailyQuery = `
      SELECT 
        TO_CHAR(purchase_date, 'YYYY-MM-DD') as date,
        COUNT(*) as total_orders,
        COALESCE(SUM(item_price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit
      FROM orders
      WHERE purchase_date >= NOW() - INTERVAL '30 days'
      GROUP BY TO_CHAR(purchase_date, 'YYYY-MM-DD')
      ORDER BY date ASC
    `;
    const dailyResult = await pool.query(dailyQuery);

    // Available filters data
    const filtersQuery = `
      SELECT DISTINCT sku FROM orders WHERE sku IS NOT NULL ORDER BY sku
    `;
    const filtersResult = await pool.query(filtersQuery);

    const yearsQuery = `
      SELECT DISTINCT EXTRACT(YEAR FROM purchase_date) as year 
      FROM orders 
      WHERE purchase_date IS NOT NULL 
      ORDER BY year DESC
    `;
    const yearsResult = await pool.query(yearsQuery);

    return NextResponse.json({
      monthly: monthlyResult.rows,
      bySku: skuResult.rows,
      daily: dailyResult.rows,
      filters: {
        skus: filtersResult.rows.map((r: { sku: string }) => r.sku),
        years: yearsResult.rows.map((r: { year: number }) => r.year),
      },
    });
  } catch (error) {
    console.error("Sales summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sales summary" },
      { status: 500 }
    );
  }
}
