import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getCityTier } from "@/lib/cityTiers";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const sku = searchParams.get("sku");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const month = searchParams.get("month"); // YYYY-MM
    const year = searchParams.get("year");
    const city = searchParams.get("city");
    const state = searchParams.get("state");
    const tier = searchParams.get("tier");

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (sku) {
      conditions.push(`o.sku = $${paramIdx++}`);
      params.push(sku);
    }
    if (startDate) {
      conditions.push(`o.purchase_date >= $${paramIdx++}::timestamptz`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`o.purchase_date <= $${paramIdx++}::timestamptz`);
      params.push(endDate);
    }
    if (month) {
      conditions.push(`TO_CHAR(o.purchase_date, 'YYYY-MM') = $${paramIdx++}`);
      params.push(month);
    }
    if (year) {
      conditions.push(`EXTRACT(YEAR FROM o.purchase_date) = $${paramIdx++}`);
      params.push(parseInt(year));
    }
    if (city) {
      conditions.push(`LOWER(o.ship_city) = LOWER($${paramIdx++})`);
      params.push(city);
    }
    if (state) {
      conditions.push(`LOWER(o.ship_state) = LOWER($${paramIdx++})`);
      params.push(state);
    }

    /* ── Tier filter: resolve tier → city list ── */
    if (tier) {
      const allCitiesRes = await pool.query(
        "SELECT DISTINCT ship_city FROM orders WHERE ship_city IS NOT NULL AND ship_city != ''"
      );
      const tierCities = allCitiesRes.rows
        .map((r: { ship_city: string }) => r.ship_city)
        .filter((c: string) => getCityTier(c) === tier);

      if (tierCities.length === 0) {
        return NextResponse.json({
          orders: [],
          summary: { total_orders: 0, total_revenue: 0, total_profit: 0, total_units: 0, avg_profit_per_order: 0 },
          pagination: { total: 0, limit, offset },
        });
      }

      const placeholders = tierCities.map((_: string) => `$${paramIdx++}`).join(",");
      conditions.push(`o.ship_city IN (${placeholders})`);
      params.push(...tierCities);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let query = `
      SELECT o.id, o.amazon_order_id, o.purchase_date, o.order_status,
             o.fulfillment_channel, o.sales_channel, o.sku, o.asin,
             o.quantity, o.currency, o.item_price, o.item_tax,
             o.cogs_price, o.profit, o.ship_city, o.ship_state
      FROM orders o
      ${where}
    `;

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${where}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY o.purchase_date DESC NULLS LAST LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Summary metrics (using same filters)
    const summaryParams = params.slice(0, params.length - 2); // exclude limit/offset
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(item_price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(quantity), 0) as total_units,
        COALESCE(AVG(profit), 0) as avg_profit_per_order
      FROM orders o
      ${where}
    `;
    const summaryResult = await pool.query(summaryQuery, summaryParams);

    return NextResponse.json({
      orders: result.rows,
      summary: summaryResult.rows[0],
      pagination: { total, limit, offset },
    });
  } catch (error) {
    console.error("Sales API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sales data" },
      { status: 500 }
    );
  }
}
