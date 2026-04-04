import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "sales";
    const period = searchParams.get("period") || "monthly"; // weekly | monthly | yearly
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const sku = searchParams.get("sku");
    const brand = searchParams.get("brand");

    const workbook = XLSX.utils.book_new();

    if (type === "sales") {
      /* ── Build WHERE ── */
      const conditions: string[] = ["o.purchase_date IS NOT NULL"];
      const params: (string | number)[] = [];
      let idx = 1;

      if (startDate) { conditions.push(`o.purchase_date >= $${idx++}::timestamp`); params.push(startDate); }
      if (endDate) { conditions.push(`o.purchase_date <= $${idx++}::timestamp`); params.push(endDate); }
      if (sku) { conditions.push(`o.sku = $${idx++}`); params.push(sku); }
      if (brand) { conditions.push(`ec.brand = $${idx++}`); params.push(brand); }

      const where = `WHERE ${conditions.join(" AND ")}`;
      const from = `FROM orders o LEFT JOIN estimated_cogs ec ON o.sku = ec.sku`;

      // Determine grouping format
      const groupFormat =
        period === "weekly" ? "IYYY-IW"
        : period === "yearly" ? "YYYY"
        : "YYYY-MM";

      // Summary sheet by period
      const summaryRes = await pool.query(`
        SELECT
          TO_CHAR(o.purchase_date, '${groupFormat}') as period,
          COUNT(*) as orders,
          COALESCE(SUM(o.quantity), 0) as units,
          ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) as revenue,
          ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) as profit,
          ROUND(COALESCE(AVG(o.item_price), 0)::numeric, 2) as avg_order_value
        ${from} ${where}
        GROUP BY TO_CHAR(o.purchase_date, '${groupFormat}')
        ORDER BY period ASC
      `, params);

      const summarySheet = XLSX.utils.json_to_sheet(
        summaryRes.rows.map(r => ({
          Period: r.period,
          Orders: Number(r.orders),
          Units: Number(r.units),
          "Revenue (₹)": Number(r.revenue),
          "Profit (₹)": Number(r.profit),
          "Avg Order Value (₹)": Number(r.avg_order_value),
        }))
      );
      XLSX.utils.book_append_sheet(workbook, summarySheet, `Sales by ${period.charAt(0).toUpperCase() + period.slice(1)}`);

      // SKU-wise sheet
      const skuRes = await pool.query(`
        SELECT
          o.sku,
          ec.brand,
          COUNT(*) as orders,
          COALESCE(SUM(o.quantity), 0) as units,
          ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) as revenue,
          ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) as profit,
          ROUND(COALESCE(AVG(o.cogs_price), 0)::numeric, 2) as avg_cogs
        ${from} ${where}
        GROUP BY o.sku, ec.brand
        ORDER BY revenue DESC
      `, params);

      const skuSheet = XLSX.utils.json_to_sheet(
        skuRes.rows.map(r => ({
          SKU: r.sku,
          Brand: r.brand || "—",
          Orders: Number(r.orders),
          Units: Number(r.units),
          "Revenue (₹)": Number(r.revenue),
          "Profit (₹)": Number(r.profit),
          "Avg COGS (₹)": Number(r.avg_cogs),
        }))
      );
      XLSX.utils.book_append_sheet(workbook, skuSheet, "By SKU");

      // State-wise sheet
      const stateRes = await pool.query(`
        SELECT
          o.ship_state as state,
          COUNT(*) as orders,
          COALESCE(SUM(o.quantity), 0) as units,
          ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) as revenue,
          ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) as profit
        ${from} ${where}
        GROUP BY o.ship_state
        ORDER BY revenue DESC
      `, params);

      const stateSheet = XLSX.utils.json_to_sheet(
        stateRes.rows.map(r => ({
          State: r.state || "Unknown",
          Orders: Number(r.orders),
          Units: Number(r.units),
          "Revenue (₹)": Number(r.revenue),
          "Profit (₹)": Number(r.profit),
        }))
      );
      XLSX.utils.book_append_sheet(workbook, stateSheet, "By State");

      // Raw orders sheet
      const ordersRes = await pool.query(`
        SELECT
          o.amazon_order_id,
          TO_CHAR(o.purchase_date, 'YYYY-MM-DD') as purchase_date,
          o.order_status,
          o.fulfillment_channel,
          o.sku,
          o.asin,
          ec.brand,
          o.quantity,
          o.item_price,
          o.item_tax,
          o.cogs_price,
          o.profit,
          o.ship_city,
          o.ship_state
        ${from} ${where}
        ORDER BY o.purchase_date DESC
        LIMIT 10000
      `, params);

      const ordersSheet = XLSX.utils.json_to_sheet(
        ordersRes.rows.map(r => ({
          "Order ID": r.amazon_order_id,
          Date: r.purchase_date,
          Status: r.order_status,
          Channel: r.fulfillment_channel,
          SKU: r.sku,
          ASIN: r.asin,
          Brand: r.brand || "—",
          Quantity: Number(r.quantity || 0),
          "Item Price (₹)": Number(r.item_price || 0),
          "Item Tax (₹)": Number(r.item_tax || 0),
          "COGS (₹)": r.cogs_price ? Number(r.cogs_price) : "—",
          "Profit (₹)": r.profit != null ? Number(r.profit) : "—",
          City: r.ship_city || "—",
          State: r.ship_state || "—",
        }))
      );
      XLSX.utils.book_append_sheet(workbook, ordersSheet, "Raw Orders");

    } else if (type === "inventory") {
      const invRes = await pool.query(`
        SELECT
          sku,
          asin,
          fnsku,
          product_name,
          condition,
          available,
          pending_removal,
          total_units,
          last_updated
        FROM inventory
        ORDER BY sku
      `);

      const invSheet = XLSX.utils.json_to_sheet(
        invRes.rows.map(r => ({
          SKU: r.sku,
          ASIN: r.asin,
          FNSKU: r.fnsku,
          "Product Name": r.product_name,
          Condition: r.condition,
          Available: Number(r.available || 0),
          "Pending Removal": Number(r.pending_removal || 0),
          "Total Units": Number(r.total_units || 0),
          "Last Updated": r.last_updated ? new Date(r.last_updated).toLocaleDateString("en-IN") : "—",
        }))
      );
      XLSX.utils.book_append_sheet(workbook, invSheet, "Current Inventory");

      // Inventory needed: estimate based on 30-day sales velocity
      const neededRes = await pool.query(`
        WITH sales_velocity AS (
          SELECT
            sku,
            ROUND(SUM(quantity)::numeric / NULLIF(EXTRACT(DAY FROM (MAX(purchase_date) - MIN(purchase_date))), 0) * 30, 1) as monthly_velocity,
            SUM(quantity) as total_sold_90d
          FROM orders
          WHERE purchase_date >= NOW() - INTERVAL '90 days'
          GROUP BY sku
        )
        SELECT
          i.sku,
          i.product_name,
          i.available as current_stock,
          COALESCE(sv.monthly_velocity, 0) as monthly_velocity,
          GREATEST(0, ROUND(COALESCE(sv.monthly_velocity, 0) * 2 - i.available, 0)) as units_needed_2mo,
          CASE
            WHEN i.available = 0 THEN 'OUT OF STOCK'
            WHEN i.available < COALESCE(sv.monthly_velocity, 0) THEN 'LOW STOCK'
            WHEN i.available < COALESCE(sv.monthly_velocity, 0) * 2 THEN 'REORDER SOON'
            ELSE 'OK'
          END as stock_status
        FROM inventory i
        LEFT JOIN sales_velocity sv ON i.sku = sv.sku
        ORDER BY
          CASE
            WHEN i.available = 0 THEN 0
            WHEN i.available < COALESCE(sv.monthly_velocity, 0) THEN 1
            WHEN i.available < COALESCE(sv.monthly_velocity, 0) * 2 THEN 2
            ELSE 3
          END, i.sku
      `);

      const neededSheet = XLSX.utils.json_to_sheet(
        neededRes.rows.map(r => ({
          SKU: r.sku,
          "Product Name": r.product_name || "—",
          "Current Stock": Number(r.current_stock || 0),
          "Monthly Velocity (units/mo)": Number(r.monthly_velocity || 0),
          "Units Needed (2-month buffer)": Number(r.units_needed_2mo || 0),
          Status: r.stock_status,
        }))
      );
      XLSX.utils.book_append_sheet(workbook, neededSheet, "Inventory Needed");

    } else if (type === "cogs") {
      const cogsRes = await pool.query(`
        SELECT
          ec.sku,
          ec.brand,
          ec.cogs_price,
          ec.last_updated,
          ps.weight_kg,
          ps.length_cm,
          ps.width_cm,
          ps.height_cm,
          ps.volumetric_weight_kg,
          ps.chargeable_weight_kg
        FROM estimated_cogs ec
        LEFT JOIN product_specifications ps ON ec.sku = ps.sku
        ORDER BY ec.brand, ec.sku
      `);

      const cogsSheet = XLSX.utils.json_to_sheet(
        cogsRes.rows.map(r => ({
          SKU: r.sku,
          Brand: r.brand || "—",
          "COGS Price (₹)": Number(r.cogs_price || 0),
          "Last Updated": r.last_updated ? new Date(r.last_updated).toLocaleDateString("en-IN") : "—",
          "Weight (kg)": r.weight_kg ? Number(r.weight_kg) : "—",
          "Length (cm)": r.length_cm ? Number(r.length_cm) : "—",
          "Width (cm)": r.width_cm ? Number(r.width_cm) : "—",
          "Height (cm)": r.height_cm ? Number(r.height_cm) : "—",
          "Volumetric Weight (kg)": r.volumetric_weight_kg ? Number(r.volumetric_weight_kg) : "—",
          "Chargeable Weight (kg)": r.chargeable_weight_kg ? Number(r.chargeable_weight_kg) : "—",
        }))
      );
      XLSX.utils.book_append_sheet(workbook, cogsSheet, "COGS & Product Specs");

    } else if (type === "profit") {
      // P&L summary
      const conditions: string[] = ["o.purchase_date IS NOT NULL"];
      const params: (string | number)[] = [];
      let idx = 1;

      if (startDate) { conditions.push(`o.purchase_date >= $${idx++}::timestamp`); params.push(startDate); }
      if (endDate) { conditions.push(`o.purchase_date <= $${idx++}::timestamp`); params.push(endDate); }
      const where = `WHERE ${conditions.join(" AND ")}`;

      const plRes = await pool.query(`
        SELECT
          TO_CHAR(o.purchase_date, 'YYYY-MM') as month,
          COUNT(*) as orders,
          COALESCE(SUM(o.quantity), 0) as units,
          ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) as revenue,
          ROUND(COALESCE(SUM(o.item_tax), 0)::numeric, 2) as tax_collected,
          ROUND(COALESCE(SUM(o.cogs_price * o.quantity), 0)::numeric, 2) as total_cogs,
          ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) as gross_profit,
          ROUND(
            CASE WHEN COALESCE(SUM(o.item_price), 0) > 0
            THEN (COALESCE(SUM(o.profit), 0) / COALESCE(SUM(o.item_price), 0)) * 100
            ELSE 0 END::numeric, 2
          ) as profit_margin_pct
        FROM orders o ${where}
        GROUP BY TO_CHAR(o.purchase_date, 'YYYY-MM')
        ORDER BY month ASC
      `, params);

      const plSheet = XLSX.utils.json_to_sheet(
        plRes.rows.map(r => ({
          Month: r.month,
          Orders: Number(r.orders),
          Units: Number(r.units),
          "Revenue (₹)": Number(r.revenue),
          "Tax Collected (₹)": Number(r.tax_collected),
          "Total COGS (₹)": Number(r.total_cogs),
          "Gross Profit (₹)": Number(r.gross_profit),
          "Profit Margin (%)": Number(r.profit_margin_pct),
        }))
      );
      XLSX.utils.book_append_sheet(workbook, plSheet, "P&L Monthly");

      // Brand P&L
      const brandRes = await pool.query(`
        SELECT
          ec.brand,
          COUNT(*) as orders,
          COALESCE(SUM(o.quantity), 0) as units,
          ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) as revenue,
          ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) as profit,
          ROUND(
            CASE WHEN COALESCE(SUM(o.item_price), 0) > 0
            THEN (COALESCE(SUM(o.profit), 0) / COALESCE(SUM(o.item_price), 0)) * 100
            ELSE 0 END::numeric, 2
          ) as margin_pct
        FROM orders o ${where}
        LEFT JOIN estimated_cogs ec ON o.sku = ec.sku
        GROUP BY ec.brand
        ORDER BY revenue DESC
      `, params);

      const brandSheet = XLSX.utils.json_to_sheet(
        brandRes.rows.map(r => ({
          Brand: r.brand || "Unassigned",
          Orders: Number(r.orders),
          Units: Number(r.units),
          "Revenue (₹)": Number(r.revenue),
          "Profit (₹)": Number(r.profit),
          "Margin (%)": Number(r.margin_pct),
        }))
      );
      XLSX.utils.book_append_sheet(workbook, brandSheet, "P&L by Brand");
    }

    // Generate Excel buffer
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // Build filename
    const dateStr = new Date().toISOString().slice(0, 10);
    const periodStr = period ? `_${period}` : "";
    const filename = `haltedb_${type}${periodStr}_${dateStr}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Reports API error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
