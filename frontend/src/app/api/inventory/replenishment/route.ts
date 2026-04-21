import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { calculateReplenishment } from "@/lib/forecasting";
import type { DailySalesRow, InventoryRow, VelocityWindow } from "@/lib/forecasting";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const windowParam = searchParams.get("window");
    const validWindows: VelocityWindow[] = ["7d", "14d", "weighted", "30d", "90d"];
    const window: VelocityWindow = validWindows.includes(windowParam as VelocityWindow)
      ? (windowParam as VelocityWindow)
      : "weighted";

    // ── 1. Daily sales for last 90 days (split combined pipe-separated SKUs) ──
    const dailySalesQuery = `
      WITH split_orders AS (
        SELECT
          purchase_date,
          TRIM(s.sku_part) as sku,
          quantity::float / GREATEST(array_length(regexp_split_to_array(sku, '\\s*\\|\\s*'), 1), 1) as quantity,
          item_price::float / GREATEST(array_length(regexp_split_to_array(sku, '\\s*\\|\\s*'), 1), 1) as item_price
        FROM orders,
        LATERAL regexp_split_to_table(sku, '\\s*\\|\\s*') AS s(sku_part)
        WHERE purchase_date IS NOT NULL
          AND purchase_date >= NOW() - INTERVAL '90 days'
          AND order_status NOT IN ('Cancelled', 'Returned')
      )
      SELECT 
        TO_CHAR(purchase_date, 'YYYY-MM-DD') as sale_date,
        sku,
        COALESCE(SUM(quantity), 0) as daily_qty,
        COALESCE(SUM(item_price), 0) as daily_revenue
      FROM split_orders
      GROUP BY TO_CHAR(purchase_date, 'YYYY-MM-DD'), sku
      ORDER BY sale_date ASC
    `;
    const salesResult = await pool.query(dailySalesQuery);

    const dailySalesData: DailySalesRow[] = salesResult.rows.map(
      (r: { sale_date: string; sku: string; daily_qty: string; daily_revenue: string }) => ({
        sale_date: r.sale_date,
        sku: r.sku,
        daily_qty: parseInt(r.daily_qty) || 0,
        daily_revenue: parseFloat(r.daily_revenue) || 0,
      })
    );

    // ── 2. Current inventory across all warehouses ──
    const inventoryQuery = `
      SELECT 
        sku,
        asin,
        fulfillment_center_id,
        COALESCE(fulfillable_quantity, 0) as fulfillable_quantity,
        COALESCE(inbound_working_quantity, 0) as inbound_working_quantity,
        COALESCE(inbound_shipped_quantity, 0) as inbound_shipped_quantity,
        COALESCE(inbound_receiving_quantity, 0) as inbound_receiving_quantity
      FROM inventory
    `;
    const inventoryResult = await pool.query(inventoryQuery);

    const inventoryData: InventoryRow[] = inventoryResult.rows.map(
      (r: {
        sku: string;
        asin: string | null;
        fulfillment_center_id: string;
        fulfillable_quantity: string;
        inbound_working_quantity: string;
        inbound_shipped_quantity: string;
        inbound_receiving_quantity: string;
      }) => ({
        sku: r.sku,
        asin: r.asin,
        fulfillment_center_id: r.fulfillment_center_id,
        fulfillable_quantity: parseInt(r.fulfillable_quantity) || 0,
        inbound_working_quantity: parseInt(r.inbound_working_quantity) || 0,
        inbound_shipped_quantity: parseInt(r.inbound_shipped_quantity) || 0,
        inbound_receiving_quantity: parseInt(r.inbound_receiving_quantity) || 0,
      })
    );

    // ── 3. COGS data for reorder value calculation ──
    const cogsQuery = `SELECT sku, cogs_price FROM cogs`;
    const cogsResult = await pool.query(cogsQuery);
    const cogsData = new Map<string, number>();
    for (const row of cogsResult.rows) {
      cogsData.set(row.sku, parseFloat(row.cogs_price) || 0);
    }

    // ── 4. Run the replenishment engine ──
    const result = calculateReplenishment(dailySalesData, inventoryData, cogsData, {
      lead_time_days: 15,
      coverage_days: 60,
      safety_factor: 1.25,
    }, window);

    // ── 5. Fetch article numbers from estimated_cogs ──
    const articleQuery = `SELECT sku, article_number FROM estimated_cogs`;
    const articleResult = await pool.query(articleQuery);
    const articleMap = new Map<string, string>();
    for (const row of articleResult.rows) {
      if (row.article_number) {
        articleMap.set(row.sku, row.article_number);
      }
    }

    // Attach article number to recommendations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result.skuRecommendations = result.skuRecommendations.map((rec: any) => ({
      ...rec,
      article_number: articleMap.get(rec.sku) || null,
    })) as typeof result.skuRecommendations;

    return NextResponse.json(result);
  } catch (error) {
    console.error("Replenishment API error:", error);
    return NextResponse.json(
      { error: "Failed to calculate replenishment recommendations" },
      { status: 500 }
    );
  }
}