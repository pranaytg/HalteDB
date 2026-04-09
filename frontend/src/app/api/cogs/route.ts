import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const query = `
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
    `;
    const result = await pool.query(query);
    return NextResponse.json({ cogs: result.rows });
  } catch (error) {
    console.error("COGS GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch COGS data" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sku, cogs_price } = await req.json();

    if (!sku || cogs_price === undefined || cogs_price === null) {
      return NextResponse.json(
        { error: "SKU and COGS price are required" },
        { status: 400 }
      );
    }

    // Check if SKU already exists
    const existsResult = await pool.query(
      "SELECT id FROM cogs WHERE sku = $1",
      [sku]
    );
    if (existsResult.rowCount && existsResult.rowCount > 0) {
      return NextResponse.json(
        { error: "SKU already exists in COGS table. Use edit instead." },
        { status: 409 }
      );
    }

    // Insert new COGS entry
    const insertQuery = `
      INSERT INTO cogs (sku, cogs_price) VALUES ($1, $2) RETURNING *
    `;
    const insertResult = await pool.query(insertQuery, [sku, cogs_price]);

    // Recalculate profit for any existing orders with this SKU
    // Uses estimated_cogs data if available for amazon fee and marketing
    const shippingExpr = `
      CASE
        WHEN LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
          OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
        THEN COALESCE(
          NULLIF(o.shipping_price, 0),
          NULLIF((
            SELECT se.amazon_shipping_cost
            FROM shipment_estimates se
            WHERE se.amazon_order_id = o.amazon_order_id AND se.sku = o.sku
            LIMIT 1
          ), 0),
          0
        )
        ELSE COALESCE(o.shipping_price, 0)
      END
    `;
    const recalcQuery = `
      UPDATE orders o SET cogs_price = $1,
        profit = CASE
          WHEN o.order_status IN ('Cancelled', 'Returned') THEN
            -2 * (${shippingExpr})
          ELSE
            o.item_price - $1
            - (o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100)
            - (${shippingExpr})
            - COALESCE(ec.marketing_cost, 0)
        END
      FROM (SELECT amazon_fee_percent, marketing_cost FROM estimated_cogs WHERE sku = $2 OR sku LIKE $2 || ' %' OR sku LIKE $2 || '-%' LIMIT 1) ec
      WHERE o.sku = $2 OR o.sku LIKE $2 || ' %' OR o.sku LIKE $2 || '-%'
    `;
    const recalcResult = await pool.query(recalcQuery, [cogs_price, sku]);

    return NextResponse.json({
      created: insertResult.rows[0],
      ordersRecalculated: recalcResult.rowCount,
    });
  } catch (error) {
    console.error("COGS POST error:", error);
    return NextResponse.json(
      { error: "Failed to create COGS entry" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { sku, cogs_price } = await req.json();

    if (!sku || cogs_price === undefined || cogs_price === null) {
      return NextResponse.json(
        { error: "SKU and cogs_price are required" },
        { status: 400 }
      );
    }

    // Update COGS
    const updateCogsQuery = `
      UPDATE cogs SET cogs_price = $1, last_updated = NOW() WHERE sku = $2
      RETURNING *
    `;
    const cogsResult = await pool.query(updateCogsQuery, [cogs_price, sku]);

    if (cogsResult.rowCount === 0) {
      return NextResponse.json(
        { error: "SKU not found in COGS table" },
        { status: 404 }
      );
    }

    // Recalculate profit for all orders with this SKU
    const shippingExpr = `
      CASE
        WHEN LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%'
          OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%'
        THEN COALESCE(
          NULLIF(o.shipping_price, 0),
          NULLIF((
            SELECT se.amazon_shipping_cost
            FROM shipment_estimates se
            WHERE se.amazon_order_id = o.amazon_order_id AND se.sku = o.sku
            LIMIT 1
          ), 0),
          0
        )
        ELSE COALESCE(o.shipping_price, 0)
      END
    `;
    const recalcQuery = `
      UPDATE orders o SET cogs_price = $1,
        profit = CASE
          WHEN o.order_status IN ('Cancelled', 'Returned') THEN
            -2 * (${shippingExpr})
          ELSE
            o.item_price - $1
            - (o.item_price * COALESCE(ec.amazon_fee_percent, 15) / 100)
            - (${shippingExpr})
            - COALESCE(ec.marketing_cost, 0)
        END
      FROM (SELECT amazon_fee_percent, marketing_cost FROM estimated_cogs WHERE sku = $2 OR sku LIKE $2 || ' %' OR sku LIKE $2 || '-%' LIMIT 1) ec
      WHERE o.sku = $2 OR o.sku LIKE $2 || ' %' OR o.sku LIKE $2 || '-%'
    `;
    const recalcResult = await pool.query(recalcQuery, [cogs_price, sku]);

    return NextResponse.json({
      updated: cogsResult.rows[0],
      ordersRecalculated: recalcResult.rowCount,
    });
  } catch (error) {
    console.error("COGS PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update COGS" },
      { status: 500 }
    );
  }
}
