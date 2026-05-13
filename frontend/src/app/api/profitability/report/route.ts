import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import pool from "@/lib/db";

export const runtime = "nodejs";

function jsonSheet(rows: Record<string, unknown>[], header?: string[]) {
  return XLSX.utils.json_to_sheet(rows, header ? { header } : undefined);
}

function filenamePart(value: string) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";
    const brand = searchParams.get("brand") || "";
    const category = searchParams.get("category") || "";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    const status = searchParams.get("status") || "";

    const conditions: string[] = ["o.item_price > 0"];
    const params: (string | number)[] = [];
    let pIdx = 1;

    if (sku) {
      conditions.push(`o.sku ILIKE $${pIdx++}`);
      params.push(`%${sku}%`);
    }
    if (brand) {
      conditions.push(`ec.brand ILIKE $${pIdx++}`);
      params.push(`%${brand}%`);
    }
    if (category) {
      conditions.push(`ec.category ILIKE $${pIdx++}`);
      params.push(`%${category}%`);
    }
    if (startDate) {
      conditions.push(`o.purchase_date >= ($${pIdx++}::date AT TIME ZONE 'Asia/Kolkata')`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`o.purchase_date < (($${pIdx++}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata')`);
      params.push(endDate);
    }
    if (status) {
      conditions.push(`o.order_status ILIKE $${pIdx++}`);
      params.push(`%${status}%`);
    }

    const where = conditions.join(" AND ");

    const shippingExpr = `
      CASE
        WHEN LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
          OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
        THEN COALESCE(
          NULLIF(o.shipping_price, 0),
          CASE WHEN se.rate_source = 'sp_api_finance' THEN NULLIF(se.amazon_shipping_cost, 0) END,
          0
        )
        ELSE COALESCE(
          NULLIF(o.shipping_price, 0),
          CASE WHEN se.rate_source = 'shiprocket' THEN NULLIF(se.cheapest_cost, 0) END,
          0
        )
      END
    `;

    const amazonFeeExpr = `
      CASE
        WHEN o.amazon_fee IS NOT NULL AND o.amazon_fee > 0
        THEN o.amazon_fee
        ELSE NULL
      END
    `;

    const amazonFeeSourceExpr = `
      CASE
        WHEN o.amazon_fee IS NOT NULL AND o.amazon_fee > 0 THEN 'actual'
        ELSE 'pending'
      END
    `;

    const marketingPercentExpr = `CASE WHEN ec.sku IS NULL THEN 0 ELSE COALESCE(ec.marketing_cost, 2) END`;
    const marketingExpr = `(o.item_price * (${marketingPercentExpr}) / 100)`;
    const profitExpr = `
      CASE
        WHEN o.order_status IN ('Cancelled', 'Returned') THEN
          -2 * (${shippingExpr})
        ELSE
          o.item_price
          - COALESCE(ec.final_price, 0)
          - COALESCE((${amazonFeeExpr}), 0)
          - (${shippingExpr})
          - (${marketingExpr})
      END
    `;
    const marginExpr = `
      CASE
        WHEN o.order_status IN ('Cancelled', 'Returned') OR o.item_price = 0 THEN NULL
        ELSE ROUND((
          (o.item_price
           - COALESCE(ec.final_price, 0)
           - COALESCE((${amazonFeeExpr}), 0)
           - (${shippingExpr})
           - (${marketingExpr})
          ) / NULLIF(o.item_price, 0) * 100
        )::numeric, 1)
      END
    `;

    const fromClause = `
      FROM orders o
      LEFT JOIN estimated_cogs ec ON LOWER(
        CASE
          WHEN o.sku ~ E' \\d+$' THEN REGEXP_REPLACE(o.sku, E' \\d+$', '')
          WHEN o.sku ~ E'-[A-Za-z]$' THEN REGEXP_REPLACE(o.sku, E'-[A-Za-z]$', '')
          WHEN o.sku ~ E'-\\d+$' THEN REGEXP_REPLACE(o.sku, E'-\\d+$', '')
          WHEN o.sku ~ E'x\\d+$' THEN REGEXP_REPLACE(o.sku, E'x\\d+$', '')
          WHEN o.sku ~ E'\\.\\d+x?$' THEN REGEXP_REPLACE(o.sku, E'\\.\\d+x?$', '')
          ELSE o.sku
        END
      ) = LOWER(ec.sku)
      LEFT JOIN shipment_estimates se ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
    `;

    const [summaryRes, monthlyRes, skuRes, ordersRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COUNT(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN 1 END) AS active_orders,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS total_revenue,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE(ec.final_price,0) ELSE 0 END)::numeric, 2) AS total_cogs,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE((${amazonFeeExpr}), 0) ELSE 0 END)::numeric, 2) AS total_amazon_fees,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN (${shippingExpr}) ELSE 0 END)::numeric, 2) AS total_shipping,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN (${marketingExpr}) ELSE 0 END)::numeric, 2) AS total_marketing,
          ROUND(SUM(${profitExpr})::numeric, 2) AS total_profit,
          ROUND(AVG(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') AND o.item_price > 0
            THEN (
              o.item_price
              - COALESCE(ec.final_price,0)
              - COALESCE((${amazonFeeExpr}), 0)
              - (${shippingExpr})
              - (${marketingExpr})
            ) / o.item_price * 100
            ELSE NULL END)::numeric, 1) AS avg_profit_margin,
          COUNT(CASE WHEN ${profitExpr} > 0 THEN 1 END) AS profitable_orders,
          COUNT(CASE WHEN ${profitExpr} <= 0 AND o.order_status NOT IN ('Cancelled','Returned') THEN 1 END) AS loss_orders,
          COUNT(CASE WHEN o.amazon_fee IS NOT NULL AND o.amazon_fee > 0 THEN 1 END) AS actual_amazon_fee_orders,
          COUNT(CASE WHEN (o.amazon_fee IS NULL OR o.amazon_fee <= 0) AND o.order_status NOT IN ('Cancelled','Returned') THEN 1 END) AS pending_amazon_fee_orders,
          COUNT(ec.sku) AS orders_with_cogs
        ${fromClause}
        WHERE ${where}
      `, params),
      pool.query(`
        SELECT
          TO_CHAR(o.purchase_date, 'YYYY-MM') AS month,
          COUNT(*) AS orders,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS revenue,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE(ec.final_price,0) ELSE 0 END)::numeric, 2) AS cogs,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE((${amazonFeeExpr}), 0) ELSE 0 END)::numeric, 2) AS amazon_fees,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN (${shippingExpr}) ELSE 0 END)::numeric, 2) AS shipping,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN (${marketingExpr}) ELSE 0 END)::numeric, 2) AS marketing,
          ROUND(SUM(${profitExpr})::numeric, 2) AS profit
        ${fromClause}
        WHERE ${where} AND o.purchase_date IS NOT NULL
        GROUP BY TO_CHAR(o.purchase_date, 'YYYY-MM')
        ORDER BY month ASC
      `, params),
      pool.query(`
        SELECT
          o.sku,
          MAX(ec.brand) AS brand,
          MAX(ec.category) AS category,
          COUNT(*) AS orders,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS revenue,
          ROUND(AVG(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE NULL END)::numeric, 2) AS avg_selling_price,
          ROUND(MAX(ec.final_price)::numeric, 2) AS cogs_per_unit,
          ROUND(MAX(ec.amazon_fee_percent)::numeric, 1) AS amazon_fee_pct,
          ROUND(MAX(${marketingPercentExpr})::numeric, 1) AS marketing_pct,
          ROUND(AVG(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN (${marketingExpr}) ELSE NULL END)::numeric, 2) AS marketing_per_unit,
          ROUND(MAX(ec.margin1_amount)::numeric, 2) AS margin1,
          ROUND(MAX(ec.margin2_amount)::numeric, 2) AS margin2,
          ROUND(SUM(${profitExpr})::numeric, 2) AS total_profit,
          ROUND(AVG(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') AND o.item_price > 0
            THEN (
              o.item_price
              - COALESCE(ec.final_price,0)
              - COALESCE((${amazonFeeExpr}), 0)
              - (${shippingExpr})
              - (${marketingExpr})
            ) / o.item_price * 100
            ELSE NULL END)::numeric, 1) AS avg_margin_pct
        ${fromClause}
        WHERE ${where}
        GROUP BY o.sku
        ORDER BY total_profit DESC
      `, params),
      pool.query(`
        SELECT
          o.amazon_order_id,
          o.sku,
          o.asin,
          o.purchase_date,
          o.order_status,
          o.fulfillment_channel,
          o.quantity,
          o.item_price,
          ec.brand,
          ec.category,
          ec.final_price AS cogs_estimate,
          ec.margin1_amount,
          ec.margin2_amount,
          ec.amazon_fee_percent,
          ec.marketing_cost AS marketing_percent,
          ROUND((${marketingExpr})::numeric, 2) AS marketing_cost,
          ${amazonFeeSourceExpr} AS amazon_fee_source,
          ROUND((${amazonFeeExpr})::numeric, 2) AS amazon_fee,
          ROUND((${shippingExpr})::numeric, 2) AS shipping_price,
          ROUND(${profitExpr}::numeric, 2) AS net_profit,
          ${marginExpr} AS profit_margin_pct
        ${fromClause}
        WHERE ${where}
        ORDER BY o.purchase_date DESC NULLS LAST
      `, params),
    ]);

    const workbook = XLSX.utils.book_new();
    const summary = summaryRes.rows[0] || {};

    XLSX.utils.book_append_sheet(
      workbook,
      jsonSheet([
        {
          "Total Orders": Number(summary.total_orders || 0),
          "Active Orders": Number(summary.active_orders || 0),
          "Total Revenue": Number(summary.total_revenue || 0),
          "Total COGS": Number(summary.total_cogs || 0),
          "Amazon Fees": Number(summary.total_amazon_fees || 0),
          Shipping: Number(summary.total_shipping || 0),
          Marketing: Number(summary.total_marketing || 0),
          "Net Profit": Number(summary.total_profit || 0),
          "Avg Margin %": summary.avg_profit_margin == null ? null : Number(summary.avg_profit_margin),
          "Profitable Orders": Number(summary.profitable_orders || 0),
          "Loss Orders": Number(summary.loss_orders || 0),
          "Actual Amazon Fee Orders": Number(summary.actual_amazon_fee_orders || 0),
          "Pending Amazon Fee Orders": Number(summary.pending_amazon_fee_orders || 0),
          "Orders With COGS": Number(summary.orders_with_cogs || 0),
        },
      ]),
      "Summary",
    );

    XLSX.utils.book_append_sheet(
      workbook,
      jsonSheet(monthlyRes.rows.map((row) => ({
        Month: row.month,
        Orders: Number(row.orders || 0),
        Revenue: Number(row.revenue || 0),
        COGS: Number(row.cogs || 0),
        "Amazon Fees": Number(row.amazon_fees || 0),
        Shipping: Number(row.shipping || 0),
        Marketing: Number(row.marketing || 0),
        "Net Profit": Number(row.profit || 0),
      }))),
      "Monthly",
    );

    XLSX.utils.book_append_sheet(
      workbook,
      jsonSheet(skuRes.rows.map((row) => ({
        SKU: row.sku,
        Brand: row.brand,
        Category: row.category,
        Orders: Number(row.orders || 0),
        Revenue: Number(row.revenue || 0),
        "Avg Selling Price": Number(row.avg_selling_price || 0),
        "COGS / Unit": row.cogs_per_unit == null ? null : Number(row.cogs_per_unit),
        "Amazon Fee %": row.amazon_fee_pct == null ? null : Number(row.amazon_fee_pct),
        "Marketing %": row.marketing_pct == null ? null : Number(row.marketing_pct),
        "Marketing / Unit": row.marketing_per_unit == null ? null : Number(row.marketing_per_unit),
        "Margin 1": row.margin1 == null ? null : Number(row.margin1),
        "Margin 2": row.margin2 == null ? null : Number(row.margin2),
        "Total Profit": Number(row.total_profit || 0),
        "Avg Margin %": row.avg_margin_pct == null ? null : Number(row.avg_margin_pct),
      }))),
      "By SKU",
    );

    XLSX.utils.book_append_sheet(
      workbook,
      jsonSheet(ordersRes.rows.map((row) => ({
        "Order ID": row.amazon_order_id,
        SKU: row.sku,
        ASIN: row.asin,
        Date: row.purchase_date,
        Status: row.order_status,
        Fulfillment: row.fulfillment_channel,
        Quantity: Number(row.quantity || 0),
        "Selling Price": Number(row.item_price || 0),
        Brand: row.brand,
        Category: row.category,
        COGS: row.cogs_estimate == null ? null : Number(row.cogs_estimate),
        "Amazon Fee": row.amazon_fee == null ? null : Number(row.amazon_fee),
        "Amazon Fee Source": row.amazon_fee_source,
        Shipping: Number(row.shipping_price || 0),
        "Marketing %": row.marketing_percent == null ? null : Number(row.marketing_percent),
        Marketing: row.marketing_cost == null ? null : Number(row.marketing_cost),
        "Margin 1": row.margin1_amount == null ? null : Number(row.margin1_amount),
        "Margin 2": row.margin2_amount == null ? null : Number(row.margin2_amount),
        "Net Profit": Number(row.net_profit || 0),
        "Profit Margin %": row.profit_margin_pct == null ? null : Number(row.profit_margin_pct),
      }))),
      "Orders",
    );

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = [sku, brand, status].map(filenamePart).filter(Boolean).join("_");
    const filename = `haltedb_profitability${suffix ? `_${suffix}` : ""}_${dateStr}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Profitability report error:", error);
    return NextResponse.json(
      { error: "Failed to generate profitability report" },
      { status: 500 },
    );
  }
}
