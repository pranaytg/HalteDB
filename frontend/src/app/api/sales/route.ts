import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

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

    let query = `
      SELECT o.id, o.amazon_order_id, o.purchase_date, o.order_status,
             o.fulfillment_channel, o.sales_channel, o.sku, o.asin,
             o.quantity, o.currency, o.item_price, o.item_tax,
             o.cogs_price, o.profit, o.ship_city, o.ship_state
      FROM orders o
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (sku) {
      query += ` AND o.sku = $${paramIdx++}`;
      params.push(sku);
    }
    if (startDate) {
      query += ` AND o.purchase_date >= $${paramIdx++}::timestamptz`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND o.purchase_date <= $${paramIdx++}::timestamptz`;
      params.push(endDate);
    }
    if (month) {
      query += ` AND TO_CHAR(o.purchase_date, 'YYYY-MM') = $${paramIdx++}`;
      params.push(month);
    }
    if (year) {
      query += ` AND EXTRACT(YEAR FROM o.purchase_date) = $${paramIdx++}`;
      params.push(parseInt(year));
    }
    if (city) {
      query += ` AND LOWER(o.ship_city) = LOWER($${paramIdx++})`;
      params.push(city);
    }
    if (state) {
      query += ` AND LOWER(o.ship_state) = LOWER($${paramIdx++})`;
      params.push(state);
    }

    // Get total count
    const countQuery = query.replace(
      /SELECT .* FROM/,
      "SELECT COUNT(*) as total FROM"
    );
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY o.purchase_date DESC NULLS LAST LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Summary metrics
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(item_price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(quantity), 0) as total_units,
        COALESCE(AVG(profit), 0) as avg_profit_per_order
      FROM orders o
      WHERE 1=1
      ${sku ? `AND o.sku = '${sku}'` : ""}
      ${startDate ? `AND o.purchase_date >= '${startDate}'::timestamptz` : ""}
      ${endDate ? `AND o.purchase_date <= '${endDate}'::timestamptz` : ""}
      ${month ? `AND TO_CHAR(o.purchase_date, 'YYYY-MM') = '${month}'` : ""}
      ${year ? `AND EXTRACT(YEAR FROM o.purchase_date) = ${parseInt(year)}` : ""}
    `;
    const summaryResult = await pool.query(summaryQuery);

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
