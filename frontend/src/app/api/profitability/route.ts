import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/*
   GET /api/profitability
   Returns per-order profit breakdown joining orders + estimated_cogs + shipment_estimates.

   Profit formula:
     net_profit = item_price
                  - cogs (final_price from estimated_cogs)
                  - amazon_fee (item_price × amazon_fee_percent / 100)
                  - shipping (Amazon actual first, then synced estimate fallback)
                  - marketing (estimated_cogs.marketing_cost)

   Query params:
     page, limit, sku, startDate, endDate, status, brand, category
     view: "orders" | "sku" | "monthly"  (default: "orders")
*/
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(0, parseInt(searchParams.get("page") || "0"));
    const limit = Math.min(200, parseInt(searchParams.get("limit") || "50"));
    const offset = page * limit;
    const view = searchParams.get("view") || "orders";
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
      conditions.push(`o.purchase_date >= $${pIdx++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`o.purchase_date <= $${pIdx++}`);
      params.push(`${endDate} 23:59:59`);
    }
    if (status) {
      conditions.push(`o.order_status ILIKE $${pIdx++}`);
      params.push(`%${status}%`);
    }

    const WHERE = conditions.join(" AND ");

    // Shipping cost resolution priority:
    //   Amazon-fulfilled: SP-API actual only (shipping_price or amazon_shipping_cost) → 0
    //   Merchant-fulfilled: seller-paid → Shiprocket cheapest → 0
    const SHIPPING_EXPR = `
      CASE
        WHEN LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
          OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
        THEN COALESCE(
          NULLIF(o.shipping_price, 0),
          NULLIF(se.amazon_shipping_cost, 0),
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
          - COALESCE(ec.final_price, 0)
          - (o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100)
          - (${SHIPPING_EXPR})
          - COALESCE(ec.marketing_cost, 0)
      END
    `;

    const MARGIN_EXPR = `
      CASE
        WHEN o.order_status IN ('Cancelled', 'Returned') OR o.item_price = 0 THEN NULL
        ELSE ROUND((
          (o.item_price
           - COALESCE(ec.final_price, 0)
           - (o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100)
           - (${SHIPPING_EXPR})
           - COALESCE(ec.marketing_cost, 0)
          ) / NULLIF(o.item_price, 0) * 100
        )::numeric, 1)
      END
    `;

    const FROM_CLAUSE = `
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

    const summaryResult = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COUNT(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN 1 END) AS active_orders,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS total_revenue,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE(ec.final_price,0) ELSE 0 END)::numeric, 2) AS total_cogs,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price * COALESCE(ec.amazon_fee_percent,15) / 100 ELSE 0 END)::numeric, 2) AS total_amazon_fees,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN (${SHIPPING_EXPR}) ELSE 0 END)::numeric, 2) AS total_shipping,
        ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE(ec.marketing_cost,0) ELSE 0 END)::numeric, 2) AS total_marketing,
        ROUND(SUM(${PROFIT_EXPR})::numeric, 2) AS total_profit,
        ROUND(AVG(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') AND o.item_price > 0
          THEN (
            o.item_price
            - COALESCE(ec.final_price,0)
            - o.item_price * COALESCE(ec.amazon_fee_percent,15) / 100
            - (${SHIPPING_EXPR})
            - COALESCE(ec.marketing_cost,0)
          ) / o.item_price * 100
          ELSE NULL END)::numeric, 1) AS avg_profit_margin,
        COUNT(CASE WHEN ${PROFIT_EXPR} > 0 THEN 1 END) AS profitable_orders,
        COUNT(CASE WHEN ${PROFIT_EXPR} <= 0 AND o.order_status NOT IN ('Cancelled','Returned') THEN 1 END) AS loss_orders,
        COUNT(ec.sku) AS orders_with_cogs
      ${FROM_CLAUSE}
      WHERE ${WHERE}
    `, params);

    if (view === "monthly") {
      const monthlyResult = await pool.query(`
        SELECT
          TO_CHAR(o.purchase_date, 'YYYY-MM') AS month,
          COUNT(*) AS orders,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS revenue,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE(ec.final_price,0) ELSE 0 END)::numeric, 2) AS cogs,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price * COALESCE(ec.amazon_fee_percent,15) / 100 ELSE 0 END)::numeric, 2) AS amazon_fees,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN (${SHIPPING_EXPR}) ELSE 0 END)::numeric, 2) AS shipping,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN COALESCE(ec.marketing_cost,0) ELSE 0 END)::numeric, 2) AS marketing,
          ROUND(SUM(${PROFIT_EXPR})::numeric, 2) AS profit
        ${FROM_CLAUSE}
        WHERE ${WHERE} AND o.purchase_date IS NOT NULL
        GROUP BY TO_CHAR(o.purchase_date, 'YYYY-MM')
        ORDER BY month ASC
      `, params);
      return NextResponse.json({ summary: summaryResult.rows[0], monthly: monthlyResult.rows });
    }

    if (view === "sku") {
      const skuResult = await pool.query(`
        SELECT
          o.sku,
          MAX(ec.brand) AS brand,
          MAX(ec.category) AS category,
          COUNT(*) AS orders,
          ROUND(SUM(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE 0 END)::numeric, 2) AS revenue,
          ROUND(AVG(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') THEN o.item_price ELSE NULL END)::numeric, 2) AS avg_selling_price,
          ROUND(MAX(ec.final_price)::numeric, 2) AS cogs_per_unit,
          ROUND(MAX(ec.amazon_fee_percent)::numeric, 1) AS amazon_fee_pct,
          ROUND(MAX(ec.marketing_cost)::numeric, 2) AS marketing_per_unit,
          ROUND(MAX(ec.margin1_amount)::numeric, 2) AS margin1,
          ROUND(MAX(ec.margin2_amount)::numeric, 2) AS margin2,
          ROUND(SUM(${PROFIT_EXPR})::numeric, 2) AS total_profit,
          ROUND(AVG(CASE WHEN o.order_status NOT IN ('Cancelled','Returned') AND o.item_price > 0
            THEN (
              o.item_price
              - COALESCE(ec.final_price,0)
              - o.item_price * COALESCE(ec.amazon_fee_percent,15) / 100
              - (${SHIPPING_EXPR})
              - COALESCE(ec.marketing_cost,0)
            ) / o.item_price * 100
            ELSE NULL END)::numeric, 1) AS avg_margin_pct
        ${FROM_CLAUSE}
        WHERE ${WHERE}
        GROUP BY o.sku
        ORDER BY total_profit DESC
      `, params);
      return NextResponse.json({ summary: summaryResult.rows[0], bysku: skuResult.rows });
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total ${FROM_CLAUSE} WHERE ${WHERE}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total);

    const paginatedParams = [...params, limit, offset];
    const ordersResult = await pool.query(`
      SELECT
        o.amazon_order_id,
        o.sku,
        o.asin,
        o.purchase_date,
        o.order_status,
        o.fulfillment_channel,
        o.quantity,
        ROUND((${SHIPPING_EXPR})::numeric, 2) AS shipping_price,
        o.item_price,
        ec.brand,
        ec.category,
        ec.final_price AS cogs_estimate,
        ec.margin1_amount,
        ec.margin2_amount,
        ec.amazon_fee_percent,
        ec.marketing_cost,
        ec.amazon_selling_price AS estimated_amazon_sp,
        ROUND((o.item_price * COALESCE(ec.amazon_fee_percent,15) / 100)::numeric, 2) AS amazon_fee,
        ROUND(${PROFIT_EXPR}::numeric, 2) AS net_profit,
        ${MARGIN_EXPR} AS profit_margin_pct
      ${FROM_CLAUSE}
      WHERE ${WHERE}
      ORDER BY o.purchase_date DESC NULLS LAST
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `, paginatedParams);

    return NextResponse.json({
      orders: ordersResult.rows,
      summary: summaryResult.rows[0],
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Profitability API error:", error);
    return NextResponse.json({ error: "Failed to fetch profitability data" }, { status: 500 });
  }
}
