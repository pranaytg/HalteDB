import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Fetch orders with their shipment estimates + product specs (weight/dimensions)
    const estimatesResult = await pool.query(`
      SELECT
        o.amazon_order_id, o.sku, o.item_price, o.quantity, o.purchase_date,
        o.ship_postal_code as destination_pincode,
        o.ship_city as destination_city,
        o.ship_state as destination_state,
        o.fulfillment_channel,
        o.shipping_price as amazon_shipping_cost,
        se.delhivery_cost, se.bluedart_cost, se.dtdc_cost, se.xpressbees_cost, se.ekart_cost,
        se.cheapest_provider, se.cheapest_cost,
        se.delhivery_etd, se.bluedart_etd, se.dtdc_etd, se.xpressbees_etd, se.ekart_etd,
        se.estimated_at, se.rate_source,
        ps.product_name,
        ps.weight_kg as actual_weight_kg,
        ps.volumetric_weight_kg,
        ps.chargeable_weight_kg,
        ps.length_cm, ps.width_cm, ps.height_cm
      FROM orders o
      LEFT JOIN shipment_estimates se ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
      LEFT JOIN product_specifications ps ON o.sku = ps.sku
      WHERE o.ship_postal_code IS NOT NULL AND o.ship_postal_code != ''
      ORDER BY o.purchase_date DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // Total count
    const countResult = await pool.query(
      "SELECT COUNT(*) as total FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''"
    );
    const total = parseInt(countResult.rows[0].total);

    // Overall summary (single row)
    const overallResult = await pool.query(`
      SELECT
        COUNT(*) as total_estimates,
        ROUND(AVG(amazon_shipping_cost)::numeric, 2) as avg_amazon_cost,
        ROUND(AVG(cheapest_cost)::numeric, 2) as avg_cheapest_cost,
        ROUND(AVG(delhivery_cost)::numeric, 2) as avg_delhivery_cost,
        ROUND(AVG(bluedart_cost)::numeric, 2) as avg_bluedart_cost,
        ROUND(AVG(dtdc_cost)::numeric, 2) as avg_dtdc_cost,
        ROUND(AVG(xpressbees_cost)::numeric, 2) as avg_xpressbees_cost,
        ROUND(AVG(ekart_cost)::numeric, 2) as avg_ekart_cost,
        ROUND(SUM(GREATEST(COALESCE(amazon_shipping_cost,0) - COALESCE(cheapest_cost,0), 0))::numeric, 2) as total_potential_savings
      FROM shipment_estimates
    `);

    // Provider wins breakdown
    const winsResult = await pool.query(`
      SELECT cheapest_provider as provider, COUNT(*) as wins
      FROM shipment_estimates
      WHERE cheapest_provider IS NOT NULL AND cheapest_provider != ''
      GROUP BY cheapest_provider
      ORDER BY wins DESC
    `);

    const providerWins = winsResult.rows.map((r: Record<string, unknown>) => ({
      provider: r.provider,
      wins: parseInt(r.wins as string),
    }));

    return NextResponse.json({
      estimates: estimatesResult.rows,
      total,
      summary: overallResult.rows[0] || {},
      providerWins,
      pagination: { total, limit, offset },
    });
  } catch (error) {
    console.error("Shipment API error:", error);
    return NextResponse.json({ error: "Failed to fetch shipment data" }, { status: 500 });
  }
}
