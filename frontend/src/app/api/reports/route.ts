import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import pool from "@/lib/db";
import { generateForecasts } from "@/lib/forecasting";
import {
  POWER_BI_SALES_COLUMNS,
  formatPowerBiSalesRowForExport,
} from "@/lib/powerBiSales";

export const runtime = "nodejs";

type ReportType = "sales" | "inventory" | "cogs" | "profit" | "amazonInvoices";

const SHIPPING_EXPR = `
  CASE
    WHEN LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
      OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
    THEN COALESCE(
      NULLIF(o.shipping_price, 0),
      NULLIF(se.amazon_shipping_cost, 0),
      NULLIF(se.cheapest_cost, 0),
      0
    )
    ELSE COALESCE(
      NULLIF(o.shipping_price, 0),
      NULLIF(se.cheapest_cost, 0),
      0
    )
  END
`;

const PROFIT_EXPR = `
  CASE
    WHEN o.order_status IN ('Cancelled', 'Returned') THEN
      -2 * (${SHIPPING_EXPR})
    ELSE
      o.item_price
      - COALESCE(ec.final_price, COALESCE(o.cogs_price, 0), 0)
      - (o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100)
      - (${SHIPPING_EXPR})
      - COALESCE(ec.marketing_cost, 0)
  END
`;

function addDateRangeConditions(
  conditions: string[],
  params: (string | number)[],
  startDate: string | null,
  endDate: string | null,
  column = "o.purchase_date",
) {
  let index = params.length + 1;

  if (startDate) {
    conditions.push(`${column} >= $${index++}::timestamp`);
    params.push(startDate);
  }

  if (endDate) {
    conditions.push(`${column} <= $${index++}::timestamp`);
    params.push(`${endDate} 23:59:59`);
  }
}

function jsonSheet(rows: Record<string, unknown>[], header?: string[]) {
  return XLSX.utils.json_to_sheet(rows, header ? { header } : undefined);
}

async function appendSalesReport(
  workbook: XLSX.WorkBook,
  period: string,
  startDate: string | null,
  endDate: string | null,
  sku: string | null,
  brand: string | null,
) {
  const conditions: string[] = ["o.purchase_date IS NOT NULL"];
  const params: (string | number)[] = [];

  addDateRangeConditions(conditions, params, startDate, endDate);

  if (sku) {
    conditions.push(`o.sku = $${params.length + 1}`);
    params.push(sku);
  }

  if (brand) {
    conditions.push(`LOWER(ec.brand) = LOWER($${params.length + 1})`);
    params.push(brand);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
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
  `;
  const groupFormat =
    period === "weekly" ? "IYYY-IW" : period === "yearly" ? "YYYY" : "YYYY-MM";

  const summaryRes = await pool.query(
    `
      SELECT
        TO_CHAR(o.purchase_date, '${groupFormat}') AS period,
        COUNT(*) AS orders,
        COALESCE(SUM(o.quantity), 0) AS units,
        ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) AS revenue,
        ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) AS profit,
        ROUND(COALESCE(AVG(o.item_price), 0)::numeric, 2) AS avg_order_value
      ${fromClause}
      ${where}
      GROUP BY TO_CHAR(o.purchase_date, '${groupFormat}')
      ORDER BY period ASC
    `,
    params,
  );

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      summaryRes.rows.map((row) => ({
        Period: row.period,
        Orders: Number(row.orders),
        Units: Number(row.units),
        "Revenue (INR)": Number(row.revenue),
        "Profit (INR)": Number(row.profit),
        "Avg Order Value (INR)": Number(row.avg_order_value),
      })),
    ),
    `Sales by ${period.charAt(0).toUpperCase() + period.slice(1)}`,
  );

  const skuRes = await pool.query(
    `
      SELECT
        o.sku,
        ec.brand,
        COUNT(*) AS orders,
        COALESCE(SUM(o.quantity), 0) AS units,
        ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) AS revenue,
        ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) AS profit,
        ROUND(COALESCE(AVG(o.cogs_price), 0)::numeric, 2) AS avg_cogs
      ${fromClause}
      ${where}
      GROUP BY o.sku, ec.brand
      ORDER BY revenue DESC
    `,
    params,
  );

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      skuRes.rows.map((row) => ({
        SKU: row.sku,
        Brand: row.brand || "-",
        Orders: Number(row.orders),
        Units: Number(row.units),
        "Revenue (INR)": Number(row.revenue),
        "Profit (INR)": Number(row.profit),
        "Avg COGS (INR)": Number(row.avg_cogs),
      })),
    ),
    "By SKU",
  );

  const stateRes = await pool.query(
    `
      SELECT
        o.ship_state AS state,
        COUNT(*) AS orders,
        COALESCE(SUM(o.quantity), 0) AS units,
        ROUND(COALESCE(SUM(o.item_price), 0)::numeric, 2) AS revenue,
        ROUND(COALESCE(SUM(o.profit), 0)::numeric, 2) AS profit
      ${fromClause}
      ${where}
      GROUP BY o.ship_state
      ORDER BY revenue DESC
    `,
    params,
  );

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      stateRes.rows.map((row) => ({
        State: row.state || "Unknown",
        Orders: Number(row.orders),
        Units: Number(row.units),
        "Revenue (INR)": Number(row.revenue),
        "Profit (INR)": Number(row.profit),
      })),
    ),
    "By State",
  );

  const ordersRes = await pool.query(
    `
      SELECT
        o.amazon_order_id,
        TO_CHAR(o.purchase_date, 'YYYY-MM-DD') AS purchase_date,
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
      ${fromClause}
      ${where}
      ORDER BY o.purchase_date DESC NULLS LAST
      LIMIT 10000
    `,
    params,
  );

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      ordersRes.rows.map((row) => ({
        "Order ID": row.amazon_order_id,
        Date: row.purchase_date,
        Status: row.order_status,
        Channel: row.fulfillment_channel,
        SKU: row.sku,
        ASIN: row.asin,
        Brand: row.brand || "-",
        Quantity: Number(row.quantity || 0),
        "Item Price (INR)": Number(row.item_price || 0),
        "Item Tax (INR)": Number(row.item_tax || 0),
        "COGS (INR)": row.cogs_price == null ? null : Number(row.cogs_price),
        "Profit (INR)": row.profit == null ? null : Number(row.profit),
        City: row.ship_city || "-",
        State: row.ship_state || "-",
      })),
    ),
    "Raw Orders",
  );
}

async function appendInventoryReport(workbook: XLSX.WorkBook) {
  const overallRes = await pool.query(`
    SELECT
      sku,
      asin,
      fnsku,
      SUM(fulfillable_quantity) AS total_fulfillable,
      SUM(unfulfillable_quantity) AS total_unfulfillable,
      SUM(reserved_quantity) AS total_reserved,
      SUM(inbound_working_quantity) AS total_inbound_working,
      SUM(inbound_shipped_quantity) AS total_inbound_shipped,
      SUM(inbound_receiving_quantity) AS total_inbound_receiving,
      COUNT(DISTINCT fulfillment_center_id) AS warehouse_count,
      MAX(last_updated) AS last_updated
    FROM inventory
    GROUP BY sku, asin, fnsku
    ORDER BY SUM(fulfillable_quantity) DESC, sku ASC
  `);

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      overallRes.rows.map((row) => ({
        SKU: row.sku,
        ASIN: row.asin || "-",
        FNSKU: row.fnsku || "-",
        Fulfillable: Number(row.total_fulfillable || 0),
        Reserved: Number(row.total_reserved || 0),
        Unfulfillable: Number(row.total_unfulfillable || 0),
        "Inbound Working": Number(row.total_inbound_working || 0),
        "Inbound Shipped": Number(row.total_inbound_shipped || 0),
        "Inbound Receiving": Number(row.total_inbound_receiving || 0),
        "Inbound Total":
          Number(row.total_inbound_working || 0) +
          Number(row.total_inbound_shipped || 0) +
          Number(row.total_inbound_receiving || 0),
        Warehouses: Number(row.warehouse_count || 0),
        "Last Updated": row.last_updated
          ? new Date(row.last_updated).toISOString().replace("T", " ").slice(0, 19)
          : null,
      })),
    ),
    "SKU Inventory",
  );

  const warehouseSummaryRes = await pool.query(`
    SELECT
      fulfillment_center_id AS warehouse,
      COUNT(DISTINCT sku) AS total_skus,
      SUM(fulfillable_quantity) AS total_fulfillable,
      SUM(unfulfillable_quantity) AS total_unfulfillable,
      SUM(reserved_quantity) AS total_reserved,
      SUM(inbound_working_quantity + inbound_shipped_quantity + inbound_receiving_quantity) AS total_inbound
    FROM inventory
    GROUP BY fulfillment_center_id
    ORDER BY total_fulfillable DESC, warehouse ASC
  `);

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      warehouseSummaryRes.rows.map((row) => ({
        Warehouse: row.warehouse,
        "Total SKUs": Number(row.total_skus || 0),
        Fulfillable: Number(row.total_fulfillable || 0),
        Reserved: Number(row.total_reserved || 0),
        Unfulfillable: Number(row.total_unfulfillable || 0),
        "Inbound Total": Number(row.total_inbound || 0),
      })),
    ),
    "Warehouse Summary",
  );

  const warehouseBreakdownRes = await pool.query(`
    SELECT
      fulfillment_center_id AS warehouse,
      sku,
      asin,
      fulfillable_quantity,
      reserved_quantity,
      unfulfillable_quantity,
      inbound_working_quantity,
      inbound_shipped_quantity,
      inbound_receiving_quantity,
      last_updated
    FROM inventory
    ORDER BY warehouse ASC, sku ASC
  `);

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      warehouseBreakdownRes.rows.map((row) => ({
        Warehouse: row.warehouse,
        SKU: row.sku,
        ASIN: row.asin || "-",
        Fulfillable: Number(row.fulfillable_quantity || 0),
        Reserved: Number(row.reserved_quantity || 0),
        Unfulfillable: Number(row.unfulfillable_quantity || 0),
        "Inbound Working": Number(row.inbound_working_quantity || 0),
        "Inbound Shipped": Number(row.inbound_shipped_quantity || 0),
        "Inbound Receiving": Number(row.inbound_receiving_quantity || 0),
        "Last Updated": row.last_updated
          ? new Date(row.last_updated).toISOString().replace("T", " ").slice(0, 19)
          : null,
      })),
    ),
    "Warehouse Breakdown",
  );

  const salesVelocityRes = await pool.query(`
    SELECT
      TO_CHAR(purchase_date, 'YYYY-MM') AS month,
      sku,
      COALESCE(SUM(quantity), 0) AS total_quantity,
      COALESCE(SUM(item_price), 0) AS total_revenue
    FROM orders
    WHERE purchase_date IS NOT NULL
    GROUP BY TO_CHAR(purchase_date, 'YYYY-MM'), sku
    ORDER BY month ASC
  `);

  const forecasts = generateForecasts(
    salesVelocityRes.rows.map((row) => ({
      month: row.month,
      sku: row.sku,
      total_quantity: Number(row.total_quantity || 0),
      total_revenue: Number(row.total_revenue || 0),
    })),
    3,
  );

  const currentStockRes = await pool.query(`
    SELECT
      sku,
      SUM(fulfillable_quantity) AS current_stock
    FROM inventory
    GROUP BY sku
  `);
  const currentStock = new Map<string, number>(
    currentStockRes.rows.map((row) => [row.sku as string, Number(row.current_stock || 0)]),
  );

  const warehouseStockRes = await pool.query(`
    SELECT
      fulfillment_center_id AS warehouse,
      sku,
      fulfillable_quantity AS current_stock
    FROM inventory
  `);

  const skuForecasts = new Map<string, number>();
  for (const forecast of forecasts) {
    skuForecasts.set(
      forecast.sku,
      (skuForecasts.get(forecast.sku) || 0) + Number(forecast.predicted_quantity || 0),
    );
  }

  const skuPredictions = [...skuForecasts.entries()]
    .map(([forecastSku, demand3m]) => {
      const stock = currentStock.get(forecastSku) || 0;
      const monthlyDemand = demand3m / 3;
      const monthsOfStock = monthlyDemand > 0 ? stock / monthlyDemand : 999;
      return {
        SKU: forecastSku,
        "Current Stock": stock,
        "Predicted Demand (3M)": demand3m,
        "Restock Needed": Math.max(0, demand3m - stock),
        "Months of Stock": Math.round(monthsOfStock * 10) / 10,
      };
    })
    .sort((left, right) => Number(right["Restock Needed"]) - Number(left["Restock Needed"]));

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(skuPredictions),
    "Restock Predictions",
  );

  const warehouseStockMap = new Map<string, Map<string, number>>();
  for (const row of warehouseStockRes.rows) {
    if (!warehouseStockMap.has(row.warehouse)) {
      warehouseStockMap.set(row.warehouse, new Map<string, number>());
    }
    warehouseStockMap.get(row.warehouse)?.set(row.sku, Number(row.current_stock || 0));
  }

  const warehouseForecastRows = [...warehouseStockMap.entries()]
    .map(([warehouse, skuMap]) => {
      let totalStock = 0;
      let totalDemand = 0;
      let totalRestock = 0;

      for (const [warehouseSku, stock] of skuMap.entries()) {
        totalStock += stock;
        const skuDemand = skuForecasts.get(warehouseSku) || 0;
        const totalSkuStock = currentStock.get(warehouseSku) || 1;
        const warehouseDemand = totalSkuStock > 0 ? Math.round(skuDemand * (stock / totalSkuStock)) : 0;
        totalDemand += warehouseDemand;
        totalRestock += Math.max(0, warehouseDemand - stock);
      }

      return {
        Warehouse: warehouse,
        "Current Stock": totalStock,
        "Predicted Demand (3M)": totalDemand,
        "Restock Needed": totalRestock,
      };
    })
    .sort((left, right) => Number(right["Restock Needed"]) - Number(left["Restock Needed"]));

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(warehouseForecastRows),
    "Warehouse Forecast",
  );
}

async function appendCogsReport(workbook: XLSX.WorkBook) {
  const cogsRes = await pool.query(`
    SELECT c.id, c.sku, c.cogs_price, c.amazon_price, c.last_updated,
           ec.halte_selling_price, ec.amazon_selling_price
    FROM cogs c
    LEFT JOIN LATERAL (
      SELECT halte_selling_price, amazon_selling_price
      FROM estimated_cogs
      WHERE estimated_cogs.sku = c.sku
         OR estimated_cogs.sku LIKE c.sku || ' %'
         OR estimated_cogs.sku LIKE c.sku || '-%'
      ORDER BY last_updated DESC
      LIMIT 1
    ) ec ON true
    ORDER BY c.sku ASC
  `);

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      cogsRes.rows.map((row) => ({
        SKU: row.sku,
        "COGS Price (INR)": row.cogs_price == null ? null : Number(row.cogs_price),
        "Halte Selling Price (INR)": row.halte_selling_price == null ? null : Number(row.halte_selling_price),
        "Amazon Selling Price (INR)": row.amazon_selling_price == null ? null : Number(row.amazon_selling_price),
        "Amazon Price (INR)": row.amazon_price == null ? null : Number(row.amazon_price),
        "Last Updated": row.last_updated
          ? new Date(row.last_updated).toISOString().replace("T", " ").slice(0, 19)
          : null,
      })),
    ),
    "COGS",
  );
}

async function appendProfitReport(
  workbook: XLSX.WorkBook,
  startDate: string | null,
  endDate: string | null,
) {
  const conditions: string[] = ["o.item_price > 0"];
  const params: (string | number)[] = [];
  addDateRangeConditions(conditions, params, startDate, endDate);

  const where = `WHERE ${conditions.join(" AND ")}`;
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

  const monthlyRes = await pool.query(
    `
      SELECT
        TO_CHAR(o.purchase_date, 'YYYY-MM') AS month,
        COUNT(*) AS orders,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS revenue,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN COALESCE(ec.final_price, COALESCE(o.cogs_price, 0), 0) ELSE 0 END)::numeric, 2) AS cogs,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100 ELSE 0 END)::numeric, 2) AS amazon_fees,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN (${SHIPPING_EXPR}) ELSE 0 END)::numeric, 2) AS shipping,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN COALESCE(ec.marketing_cost, 0) ELSE 0 END)::numeric, 2) AS marketing,
        ROUND(SUM(${PROFIT_EXPR})::numeric, 2) AS profit
      ${fromClause}
      ${where} AND o.purchase_date IS NOT NULL
      GROUP BY TO_CHAR(o.purchase_date, 'YYYY-MM')
      ORDER BY month ASC
    `,
    params,
  );

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      monthlyRes.rows.map((row) => ({
        Month: row.month,
        Orders: Number(row.orders),
        "Revenue (INR)": Number(row.revenue),
        "COGS (INR)": Number(row.cogs),
        "Amazon Fees (INR)": Number(row.amazon_fees),
        "Shipping (INR)": Number(row.shipping),
        "Marketing (INR)": Number(row.marketing),
        "Net Profit (INR)": Number(row.profit),
        "Margin (%)":
          Number(row.revenue) > 0
            ? Math.round((Number(row.profit) / Number(row.revenue)) * 10000) / 100
            : 0,
      })),
    ),
    "P&L Monthly",
  );

  const brandRes = await pool.query(
    `
      SELECT
        COALESCE(ec.brand, 'Unassigned') AS brand,
        COUNT(*) AS orders,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS revenue,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN COALESCE(ec.final_price, COALESCE(o.cogs_price, 0), 0) ELSE 0 END)::numeric, 2) AS cogs,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100 ELSE 0 END)::numeric, 2) AS amazon_fees,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN (${SHIPPING_EXPR}) ELSE 0 END)::numeric, 2) AS shipping,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled', 'Returned') THEN COALESCE(ec.marketing_cost, 0) ELSE 0 END)::numeric, 2) AS marketing,
        ROUND(SUM(${PROFIT_EXPR})::numeric, 2) AS profit
      ${fromClause}
      ${where}
      GROUP BY COALESCE(ec.brand, 'Unassigned')
      ORDER BY revenue DESC, brand ASC
    `,
    params,
  );

  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(
      brandRes.rows.map((row) => ({
        Brand: row.brand,
        Orders: Number(row.orders),
        "Revenue (INR)": Number(row.revenue),
        "COGS (INR)": Number(row.cogs),
        "Amazon Fees (INR)": Number(row.amazon_fees),
        "Shipping (INR)": Number(row.shipping),
        "Marketing (INR)": Number(row.marketing),
        "Net Profit (INR)": Number(row.profit),
        "Margin (%)":
          Number(row.revenue) > 0
            ? Math.round((Number(row.profit) / Number(row.revenue)) * 10000) / 100
            : 0,
      })),
    ),
    "P&L by Brand",
  );
}

async function appendAmazonInvoicesReport(workbook: XLSX.WorkBook) {
  const tableExistsRes = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'PowerBISales'
    ) AS exists
  `);

  if (!tableExistsRes.rows[0]?.exists) {
    XLSX.utils.book_append_sheet(
      workbook,
      jsonSheet([], [...POWER_BI_SALES_COLUMNS]),
      "Amazon Sales Invoices",
    );
    return;
  }

  const invoiceRowsRes = await pool.query(`
    SELECT ${POWER_BI_SALES_COLUMNS.map((column) => `"${column}"`).join(", ")}
    FROM "PowerBISales"
    ORDER BY "Invoice Date" DESC NULLS LAST, "Invoice Number" DESC NULLS LAST
  `);

  const rows = invoiceRowsRes.rows.map((row) => formatPowerBiSalesRowForExport(row));
  XLSX.utils.book_append_sheet(
    workbook,
    jsonSheet(rows, [...POWER_BI_SALES_COLUMNS]),
    "Amazon Sales Invoices",
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "sales") as ReportType;
    const period = searchParams.get("period") || "monthly";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const sku = searchParams.get("sku");
    const brand = searchParams.get("brand");
    const workbook = XLSX.utils.book_new();

    if (type === "sales") {
      await appendSalesReport(workbook, period, startDate, endDate, sku, brand);
    } else if (type === "inventory") {
      await appendInventoryReport(workbook);
    } else if (type === "cogs") {
      await appendCogsReport(workbook);
    } else if (type === "profit") {
      await appendProfitReport(workbook, startDate, endDate);
    } else if (type === "amazonInvoices") {
      await appendAmazonInvoicesReport(workbook);
    } else {
      return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
    }

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const periodStr = type === "sales" && period ? `_${period}` : "";
    const filename = `haltedb_${type}${periodStr}_${dateStr}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Reports API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate report",
      },
      { status: 500 },
    );
  }
}
