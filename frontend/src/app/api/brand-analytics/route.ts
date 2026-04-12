import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    // Get brand performance metrics
    const brandMetrics = await pool.query(`
      SELECT
        COALESCE(SUBSTRING(sku, 1, 2), 'Unknown') AS brand_code,
        COUNT(DISTINCT amazon_order_id) AS total_orders,
        COUNT(DISTINCT sku) AS unique_skus,
        COALESCE(SUM(quantity), 0) AS total_units_sold,
        COALESCE(SUM(item_price), 0) AS total_revenue,
        COALESCE(AVG(item_price), 0) AS avg_order_value,
        COALESCE(SUM(CASE WHEN order_status = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS successful_orders,
        COUNT(DISTINCT CASE WHEN order_status = 'DELIVERED' THEN ship_state END) AS geographic_spread,
        COUNT(DISTINCT CASE WHEN order_status = 'DELIVERED' THEN amazon_order_id END) FILTER (WHERE purchase_date >= NOW() - INTERVAL '30 days') AS orders_last_30_days,
        COUNT(DISTINCT CASE WHEN order_status = 'DELIVERED' THEN amazon_order_id END) FILTER (WHERE purchase_date >= NOW() - INTERVAL '90 days') AS orders_last_90_days
      FROM orders
      WHERE sku IS NOT NULL
      GROUP BY COALESCE(SUBSTRING(sku, 1, 2), 'Unknown')
      ORDER BY total_revenue DESC
    `);

    // Top performing products
    const topSkus = await pool.query(`
      SELECT
        sku,
        COUNT(DISTINCT amazon_order_id) AS order_count,
        COALESCE(SUM(quantity), 0) AS units_sold,
        COALESCE(SUM(item_price), 0) AS total_revenue,
        COALESCE(AVG(item_price), 0) AS avg_price,
        COALESCE(SUM(CASE WHEN order_status = 'DELIVERED' THEN 1 ELSE 0 END)::FLOAT /
                 NULLIF(COUNT(DISTINCT amazon_order_id)::FLOAT, 0) * 100, 0) AS delivery_success_rate,
        COUNT(DISTINCT ship_state) AS states_reached
      FROM orders
      WHERE sku IS NOT NULL
      GROUP BY sku
      ORDER BY total_revenue DESC
      LIMIT 50
    `);

    // Channel performance
    const channelMetrics = await pool.query(`
      SELECT
        sales_channel,
        COUNT(DISTINCT amazon_order_id) AS total_orders,
        COALESCE(SUM(item_price), 0) AS total_revenue,
        COALESCE(AVG(item_price), 0) AS avg_order_value,
        COUNT(DISTINCT sku) AS unique_products,
        COALESCE(SUM(CASE WHEN order_status = 'DELIVERED' THEN 1 ELSE 0 END)::FLOAT /
                 NULLIF(COUNT(DISTINCT amazon_order_id)::FLOAT, 0) * 100, 0) AS success_rate
      FROM orders
      WHERE sales_channel IS NOT NULL
      GROUP BY sales_channel
      ORDER BY total_revenue DESC
    `);

    // State-wise brand performance
    const statePerformance = await pool.query(`
      SELECT
        ship_state,
        COALESCE(SUBSTRING(sku, 1, 2), 'Unknown') AS brand_code,
        COUNT(DISTINCT amazon_order_id) AS order_count,
        COALESCE(SUM(item_price), 0) AS revenue,
        COUNT(DISTINCT sku) AS unique_products
      FROM orders
      WHERE ship_state IS NOT NULL
      GROUP BY ship_state, COALESCE(SUBSTRING(sku, 1, 2), 'Unknown')
      ORDER BY revenue DESC
      LIMIT 100
    `);

    // Calculate summary statistics
    const totalOrders = brandMetrics.rows.reduce((sum, r) => sum + Number(r.total_orders), 0);
    const totalRevenue = brandMetrics.rows.reduce((sum, r) => sum + Number(r.total_revenue), 0);
    const totalUnits = brandMetrics.rows.reduce((sum, r) => sum + Number(r.total_units_sold), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return NextResponse.json({
      summary: {
        totalOrders,
        totalRevenue,
        totalUnits,
        avgOrderValue,
        activeBrands: brandMetrics.rows.length,
      },
      brands: brandMetrics.rows,
      topProducts: topSkus.rows,
      channels: channelMetrics.rows,
      statePerformance: statePerformance.rows,
    });
  } catch (error) {
    console.error("Brand analytics error:", error);
    return NextResponse.json({ error: "Failed to fetch brand analytics" }, { status: 500 });
  }
}
