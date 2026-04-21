import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { calculateReplenishment } from "@/lib/forecasting";
import type { DailySalesRow, InventoryRow, VelocityWindow } from "@/lib/forecasting";
import * as XLSX from "xlsx";

/**
 * GET /api/inventory/replenishment/export
 *
 * Generates and returns a dynamic Excel (.xlsx) report with warehouse-wise
 * breakdown of CRITICAL and URGENT SKUs.
 *
 * Query params:
 *   - window: velocity window (7d | 14d | weighted | 30d | 90d), default "weighted"
 *   - format: "xlsx" | "csv", default "xlsx"
 *
 * The report is always recalculated from live DB data, so it reflects the
 * latest sales velocity and inventory levels at the time of download.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const windowParam = searchParams.get("window");
    const formatParam = searchParams.get("format") || "xlsx";
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

    // ── 2. Current inventory ──
    const inventoryQuery = `
      SELECT 
        sku, asin, fulfillment_center_id,
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

    // ── 3. COGS data ──
    const cogsQuery = `SELECT sku, cogs_price FROM cogs`;
    const cogsResult = await pool.query(cogsQuery);
    const cogsData = new Map<string, number>();
    for (const row of cogsResult.rows) {
      cogsData.set(row.sku, parseFloat(row.cogs_price) || 0);
    }

    // ── 4. Article numbers ──
    const articleQuery = `SELECT sku, article_number FROM estimated_cogs`;
    const articleResult = await pool.query(articleQuery);
    const articleMap = new Map<string, string>();
    for (const row of articleResult.rows) {
      if (row.article_number) articleMap.set(row.sku, row.article_number);
    }

    // ── 5. Run the replenishment engine ──
    const result = calculateReplenishment(dailySalesData, inventoryData, cogsData, {
      lead_time_days: 15,
      coverage_days: 60,
      safety_factor: 1.25,
    }, window);

    // ── 6. Filter only CRITICAL and URGENT SKUs ──
    const criticalUrgentSkus = result.skuRecommendations.filter(
      (r) => r.urgency === "CRITICAL" || r.urgency === "URGENT"
    );

    const warehouses = result.warehouseSummary.map((w) => w.warehouse);
    const reportDate = new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    // ── 7. Build the Excel workbook ──
    const wb = XLSX.utils.book_new();

    // --- Sheet 1: Summary + SKU Listings ---
    const criticalSkus = criticalUrgentSkus.filter(r => r.urgency === "CRITICAL");
    const urgentSkus = criticalUrgentSkus.filter(r => r.urgency === "URGENT");

    const summaryData: (string | number | null)[][] = [
      ["REPLENISHMENT PLANNING REPORT"],
      [`Generated: ${reportDate}`],
      [`Velocity Window: ${window}`],
      [`Lead Time: ${result.config.lead_time_days} days | Coverage Target: ${result.config.coverage_days} days | Safety Factor: ${Math.round((result.config.safety_factor - 1) * 100)}%`],
      [],
      ["═══ OVERVIEW ═══"],
      ["Metric", "Value"],
      ["Total SKUs Analyzed", result.summary.total_skus_analyzed],
      ["Critical SKUs (stockout in <15 days)", result.summary.critical_skus],
      ["Urgent SKUs (<30 days coverage)", result.summary.urgent_skus],
      ["Total Reorder Units (Critical+Urgent)", criticalUrgentSkus.reduce((s, r) => s + r.reorder_qty, 0)],
      ["Total Reorder Value ₹ (Critical+Urgent)", Math.round(criticalUrgentSkus.reduce((s, r) => s + r.reorder_value, 0))],
      [],

      // ── Critical SKUs listing ──
      ["═══ CRITICAL SKUs — Will stockout within 15-day lead time ═══"],
      ["#", "SKU", "Article Number", "ASIN", "Reorder Qty", "Days of Coverage", "Daily Velocity", "Current Stock"],
      ...criticalSkus.map((r, i) => [
        i + 1,
        r.sku,
        articleMap.get(r.sku) || "—",
        r.asin || "—",
        r.reorder_qty,
        r.days_of_coverage,
        r.weighted_velocity,
        r.current_stock,
      ]),
      ...(criticalSkus.length === 0 ? [["", "No critical SKUs at this time"]] : []),
      [],

      // ── Urgent SKUs listing ──
      ["═══ URGENT SKUs — Less than 30 days coverage ═══"],
      ["#", "SKU", "Article Number", "ASIN", "Reorder Qty", "Days of Coverage", "Daily Velocity", "Current Stock"],
      ...urgentSkus.map((r, i) => [
        i + 1,
        r.sku,
        articleMap.get(r.sku) || "—",
        r.asin || "—",
        r.reorder_qty,
        r.days_of_coverage,
        r.weighted_velocity,
        r.current_stock,
      ]),
      ...(urgentSkus.length === 0 ? [["", "No urgent SKUs at this time"]] : []),
      [],

      // ── Warehouse Summary ──
      ["═══ WAREHOUSE SUMMARY ═══"],
      ["Warehouse", "Current Stock", "In Transit", "Reorder Needed", "Critical SKUs", "Urgent SKUs"],
      ...result.warehouseSummary.map((w) => [
        w.warehouse,
        w.total_current_stock,
        w.total_in_transit,
        w.total_reorder_needed,
        w.skus_critical,
        w.skus_urgent,
      ]),
      [],

      // ── Per-warehouse SKU requirements ──
      ["═══ WAREHOUSE-WISE SKU REQUIREMENTS ═══"],
      ["(Which SKUs are needed at each warehouse)"],
      [],
    ];

    // For each warehouse, list the critical+urgent SKUs allocated to it
    for (const wh of warehouses) {
      const whSkus = criticalUrgentSkus
        .filter(r => (r.warehouse_allocation[wh] || 0) > 0)
        .sort((a, b) => {
          const urgOrd: Record<string, number> = { CRITICAL: 0, URGENT: 1 };
          const diff = (urgOrd[a.urgency] ?? 2) - (urgOrd[b.urgency] ?? 2);
          return diff !== 0 ? diff : b.reorder_qty - a.reorder_qty;
        });

      if (whSkus.length > 0) {
        summaryData.push([`── Warehouse: ${wh} (${whSkus.length} SKUs needed) ──`]);
        summaryData.push(["#", "SKU", "Article Number", "Urgency", "Units to Send", "Total Reorder Qty"]);
        whSkus.forEach((r, i) => {
          summaryData.push([
            i + 1,
            r.sku,
            articleMap.get(r.sku) || "—",
            r.urgency,
            r.warehouse_allocation[wh] || 0,
            r.reorder_qty,
          ]);
        });
        summaryData.push([]);
      }
    }

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);

    // Style: wider columns for summary
    summarySheet["!cols"] = [
      { wch: 6 },  // #
      { wch: 42 }, // SKU / Metric
      { wch: 18 }, // Article Number / Value
      { wch: 16 }, // ASIN / Urgency
      { wch: 14 }, // Reorder
      { wch: 16 }, // Coverage
      { wch: 14 }, // Velocity
      { wch: 14 }, // Stock
    ];

    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    // --- Sheet 2: SKU Detail — warehouse-wise breakdown ---
    const detailHeaders = [
      "SKU",
      "Article Number",
      "ASIN",
      "Urgency",
      "Trend",
      "Daily Velocity",
      "7d Velocity",
      "14d Velocity",
      "30d Velocity",
      "90d Velocity",
      "Lead Time Demand (15d)",
      "Target Stock (2mo)",
      "Current Stock",
      "In Transit",
      "Reorder Qty",
      "Reorder Value ₹",
      "Days of Coverage",
      ...warehouses.map((w) => `WH: ${w}`),
    ];

    const detailRows = criticalUrgentSkus.map((r) => [
      r.sku,
      articleMap.get(r.sku) || "",
      r.asin || "",
      r.urgency,
      r.trend,
      r.weighted_velocity,
      r.velocity_7d,
      r.velocity_14d,
      r.velocity_30d,
      r.velocity_90d,
      r.lead_time_demand,
      r.target_stock_2m,
      r.current_stock,
      r.in_transit,
      r.reorder_qty,
      r.reorder_value,
      r.days_of_coverage,
      ...warehouses.map((w) => r.warehouse_allocation[w] || 0),
    ]);

    const detailData = [detailHeaders, ...detailRows];
    const detailSheet = XLSX.utils.aoa_to_sheet(detailData);

    // Column widths
    detailSheet["!cols"] = [
      { wch: 22 }, // SKU
      { wch: 16 }, // Article
      { wch: 14 }, // ASIN
      { wch: 10 }, // Urgency
      { wch: 12 }, // Trend
      { wch: 14 }, // Velocity
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 18 }, // Lead time demand
      { wch: 16 }, // Target
      { wch: 14 }, // Current
      { wch: 12 }, // In Transit
      { wch: 12 }, // Reorder
      { wch: 14 }, // Reorder value
      { wch: 14 }, // Coverage
      ...warehouses.map(() => ({ wch: 14 })),
    ];

    XLSX.utils.book_append_sheet(wb, detailSheet, "Critical & Urgent SKUs");

    // --- Sheet 3: Warehouse-wise breakdown (pivoted) ---
    // One row per warehouse × SKU combination (only where reorder > 0)
    const whBreakdownHeaders = [
      "Warehouse",
      "SKU",
      "Article Number",
      "ASIN",
      "Urgency",
      "Daily Velocity",
      "Current Stock (Total)",
      "In Transit (Total)",
      "Total Reorder Qty",
      "Warehouse Allocation (units)",
      "Days of Coverage",
      "Trend",
    ];

    const whBreakdownRows: (string | number)[][] = [];
    for (const wh of warehouses) {
      for (const r of criticalUrgentSkus) {
        const alloc = r.warehouse_allocation[wh] || 0;
        if (alloc > 0) {
          whBreakdownRows.push([
            wh,
            r.sku,
            articleMap.get(r.sku) || "",
            r.asin || "",
            r.urgency,
            r.weighted_velocity,
            r.current_stock,
            r.in_transit,
            r.reorder_qty,
            alloc,
            r.days_of_coverage,
            r.trend,
          ]);
        }
      }
    }

    // Sort: warehouse → urgency (CRITICAL first) → allocation desc
    whBreakdownRows.sort((a, b) => {
      if (a[0] !== b[0]) return String(a[0]).localeCompare(String(b[0]));
      const urgOrd: Record<string, number> = { CRITICAL: 0, URGENT: 1 };
      const urgA = urgOrd[String(a[4])] ?? 2;
      const urgB = urgOrd[String(b[4])] ?? 2;
      if (urgA !== urgB) return urgA - urgB;
      return (Number(b[9]) || 0) - (Number(a[9]) || 0);
    });

    const whBreakdownData = [whBreakdownHeaders, ...whBreakdownRows];
    const whSheet = XLSX.utils.aoa_to_sheet(whBreakdownData);

    whSheet["!cols"] = [
      { wch: 16 }, // Warehouse
      { wch: 22 }, // SKU
      { wch: 16 }, // Article
      { wch: 14 }, // ASIN
      { wch: 10 }, // Urgency
      { wch: 14 }, // Velocity
      { wch: 16 }, // Stock
      { wch: 14 }, // In transit
      { wch: 14 }, // Reorder
      { wch: 22 }, // Allocation
      { wch: 14 }, // Coverage
      { wch: 12 }, // Trend
    ];

    XLSX.utils.book_append_sheet(wb, whSheet, "Warehouse Breakdown");

    // ── 8. Generate the file buffer ──
    const dateStr = new Date().toISOString().slice(0, 10);

    if (formatParam === "csv") {
      // For CSV, export just the main detail sheet
      const csv = XLSX.utils.sheet_to_csv(detailSheet);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="replenishment_critical_urgent_${dateStr}.csv"`,
        },
      });
    }

    // Default: xlsx
    // Use type: "array" which returns a Uint8Array-like buffer, 
    // and wrap it in a real Uint8Array for cross-environment NextResponse compatibility.
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="replenishment_critical_urgent_${dateStr}.xlsx"`,
        "Content-Length": buf.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("Replenishment export error:", error);
    return NextResponse.json(
      { error: "Failed to generate replenishment report" },
      { status: 500 }
    );
  }
}
