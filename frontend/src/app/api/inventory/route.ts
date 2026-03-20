import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    // Overall inventory summary
    const overallQuery = `
      SELECT 
        sku, asin, fnsku,
        SUM(fulfillable_quantity) as total_fulfillable,
        SUM(unfulfillable_quantity) as total_unfulfillable,
        SUM(reserved_quantity) as total_reserved,
        SUM(inbound_working_quantity) as total_inbound_working,
        SUM(inbound_shipped_quantity) as total_inbound_shipped,
        SUM(inbound_receiving_quantity) as total_inbound_receiving,
        COUNT(DISTINCT fulfillment_center_id) as warehouse_count,
        MAX(last_updated) as last_updated
      FROM inventory
      GROUP BY sku, asin, fnsku
      ORDER BY total_fulfillable DESC
    `;
    const overallResult = await pool.query(overallQuery);

    // Warehouse-wise breakdown
    const warehouseQuery = `
      SELECT 
        fulfillment_center_id as warehouse,
        sku, asin,
        fulfillable_quantity,
        unfulfillable_quantity,
        reserved_quantity,
        inbound_working_quantity,
        inbound_shipped_quantity,
        inbound_receiving_quantity,
        last_updated
      FROM inventory
      ORDER BY fulfillment_center_id, sku
    `;
    const warehouseResult = await pool.query(warehouseQuery);

    // Warehouse summary
    const warehouseSummaryQuery = `
      SELECT 
        fulfillment_center_id as warehouse,
        COUNT(DISTINCT sku) as total_skus,
        SUM(fulfillable_quantity) as total_fulfillable,
        SUM(unfulfillable_quantity) as total_unfulfillable,
        SUM(reserved_quantity) as total_reserved
      FROM inventory
      GROUP BY fulfillment_center_id
      ORDER BY total_fulfillable DESC
    `;
    const warehouseSummaryResult = await pool.query(warehouseSummaryQuery);

    // Grand total
    const grandTotalQuery = `
      SELECT 
        COUNT(DISTINCT sku) as total_skus,
        SUM(fulfillable_quantity) as total_fulfillable,
        SUM(unfulfillable_quantity) as total_unfulfillable,
        SUM(reserved_quantity) as total_reserved,
        COUNT(DISTINCT fulfillment_center_id) as total_warehouses
      FROM inventory
    `;
    const grandTotalResult = await pool.query(grandTotalQuery);

    return NextResponse.json({
      overall: overallResult.rows,
      warehouseBreakdown: warehouseResult.rows,
      warehouseSummary: warehouseSummaryResult.rows,
      grandTotal: grandTotalResult.rows[0],
    });
  } catch (error) {
    console.error("Inventory API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory data" },
      { status: 500 }
    );
  }
}
