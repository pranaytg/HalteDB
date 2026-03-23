import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");
    const year = searchParams.get("year");
    const month = searchParams.get("month"); // YYYY-MM
    const state = searchParams.get("state");
    const city = searchParams.get("city");
    const tier = searchParams.get("tier");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    /* ── Build dynamic WHERE ── */
    const conditions: string[] = ["purchase_date IS NOT NULL"];
    const params: (string | number)[] = [];
    let idx = 1;

    if (sku) { conditions.push(`sku = $${idx++}`); params.push(sku); }
    if (year) { conditions.push(`EXTRACT(YEAR FROM purchase_date) = $${idx++}`); params.push(parseInt(year)); }
    if (month) { conditions.push(`TO_CHAR(purchase_date, 'YYYY-MM') = $${idx++}`); params.push(month); }
    if (state) { conditions.push(`LOWER(ship_state) = LOWER($${idx++})`); params.push(state); }
    if (city) { conditions.push(`LOWER(ship_city) = LOWER($${idx++})`); params.push(city); }
    if (startDate) { conditions.push(`purchase_date >= $${idx++}::timestamp`); params.push(startDate); }
    if (endDate) { conditions.push(`purchase_date <= $${idx++}::timestamp`); params.push(endDate); }

    // Tier is handled client-side for geography, not needed here for summary

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Monthly aggregated
    const monthlyResult = await pool.query(`
      SELECT TO_CHAR(purchase_date, 'YYYY-MM') as month,
             COUNT(*) as total_orders,
             COALESCE(SUM(item_price), 0) as total_revenue,
             COALESCE(SUM(profit), 0) as total_profit,
             COALESCE(SUM(quantity), 0) as total_units
      FROM orders ${where}
      GROUP BY TO_CHAR(purchase_date, 'YYYY-MM')
      ORDER BY month ASC
    `, params);

    // SKU-wise summary
    const skuResult = await pool.query(`
      SELECT sku,
             COUNT(*) as total_orders,
             COALESCE(SUM(item_price), 0) as total_revenue,
             COALESCE(SUM(profit), 0) as total_profit,
             COALESCE(SUM(quantity), 0) as total_units
      FROM orders ${where}
      GROUP BY sku
      ORDER BY total_revenue DESC
      LIMIT 20
    `, params);

    // Daily sales for the last 30 days (also filtered)
    const dailyResult = await pool.query(`
      SELECT TO_CHAR(purchase_date, 'YYYY-MM-DD') as date,
             COUNT(*) as total_orders,
             COALESCE(SUM(item_price), 0) as total_revenue,
             COALESCE(SUM(profit), 0) as total_profit
      FROM orders ${where}
      ${conditions.length > 0 ? "AND" : "WHERE"} purchase_date >= NOW() - INTERVAL '30 days'
      GROUP BY TO_CHAR(purchase_date, 'YYYY-MM-DD')
      ORDER BY date ASC
    `, params);

    // Available filter options (unfiltered so user can always access all choices)
    const [filtersResult, yearsResult] = await Promise.all([
      pool.query(`SELECT DISTINCT sku FROM orders WHERE sku IS NOT NULL ORDER BY sku`),
      pool.query(`SELECT DISTINCT EXTRACT(YEAR FROM purchase_date) as year FROM orders WHERE purchase_date IS NOT NULL ORDER BY year DESC`),
    ]);

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
    return NextResponse.json({ error: "Failed to fetch sales summary" }, { status: 500 });
  }
}
