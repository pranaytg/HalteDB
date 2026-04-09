import { NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  fetchShiprocketRates, getFallbackRates, findCheapest,
  normalizePincode, normalizeProviderName, ORIGIN_PIN,
  resolveAmazonShippingCost, ShiprocketDimensions,
} from "@/lib/shipment";

// ═══════════════════════════════════════════════════
// POST /api/shipment/estimate — estimate rates for new orders (bulk)
// ═══════════════════════════════════════════════════

export async function POST() {
  try {
    // Estimate new orders and refresh Amazon-fulfilled rows that still have no usable Amazon cost.
    const ordersResult = await pool.query(`
      SELECT DISTINCT ON (o.amazon_order_id, o.sku)
        o.amazon_order_id, o.sku, o.asin,
        o.fulfillment_channel,
        o.ship_postal_code, o.ship_city, o.ship_state,
        o.shipping_price as recorded_amazon_shipping_cost,
        se.amazon_shipping_cost as existing_estimated_amazon_cost,
        o.item_price, o.quantity, o.purchase_date
      FROM orders o
      LEFT JOIN shipment_estimates se ON o.amazon_order_id = se.amazon_order_id AND o.sku = se.sku
      WHERE o.ship_postal_code IS NOT NULL AND o.ship_postal_code != ''
        AND (
          se.id IS NULL
          OR (
            (LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%amazon%' OR LOWER(COALESCE(o.fulfillment_channel, '')) LIKE '%afn%')
            AND COALESCE(se.amazon_shipping_cost, 0) <= 0
          )
        )
      ORDER BY o.amazon_order_id DESC, o.sku
      LIMIT 200
    `);

    if (ordersResult.rows.length === 0) {
      return NextResponse.json({ message: "All eligible shipment rows are already estimated", estimated: 0 });
    }

    // Get product weights & dimensions
    const skus = [...new Set(ordersResult.rows.map((r: Record<string, unknown>) => r.sku))];
    const specsResult = await pool.query(
      `SELECT sku, weight_kg, length_cm, width_cm, height_cm,
              volumetric_weight_kg, chargeable_weight_kg
       FROM product_specifications WHERE sku = ANY($1)`,
      [skus]
    );
    const specsMap: Record<string, Record<string, number | null>> = {};
    for (const s of specsResult.rows) {
      specsMap[s.sku] = s;
    }

    let estimated = 0;
    let shiprocketCount = 0;
    let fallbackCount = 0;

    for (const order of ordersResult.rows) {
      const destPin = normalizePincode(order.ship_postal_code);
      if (destPin.length !== 6) continue;
      const spec = specsMap[order.sku];
      const actualWeight = (spec?.weight_kg as number) || 0.5;
      const volumetricWeight = (spec?.volumetric_weight_kg as number) || null;
      const chargeableWeight = (spec?.chargeable_weight_kg as number) || actualWeight;

      // Pass dimensions to Shiprocket when available (improves accuracy)
      const dims: ShiprocketDimensions = {};
      if ((spec?.length_cm as number) > 0) dims.length = spec.length_cm as number;
      if ((spec?.width_cm as number) > 0) dims.breadth = spec.width_cm as number;
      if ((spec?.height_cm as number) > 0) dims.height = spec.height_cm as number;

      // Try Shiprocket live rates first, fall back to rate cards
      const result = await fetchShiprocketRates(ORIGIN_PIN, destPin, chargeableWeight, dims)
        || getFallbackRates(ORIGIN_PIN, destPin, chargeableWeight);

      const { rates, source } = result;
      if (source === "shiprocket") shiprocketCount++;
      else fallbackCount++;

      const amazonCost = resolveAmazonShippingCost(
        order.recorded_amazon_shipping_cost,
        order.fulfillment_channel,
        rates,
      );
      const { cheapestProvider, cheapestCost } = findCheapest(rates, amazonCost);

      await pool.query(`
        INSERT INTO shipment_estimates (
          amazon_order_id, sku, origin_pincode,
          destination_pincode, destination_city, destination_state,
          package_weight_kg, volumetric_weight_kg, chargeable_weight_kg,
          amazon_shipping_cost,
          delhivery_cost, bluedart_cost, dtdc_cost, xpressbees_cost, ekart_cost,
          delhivery_etd, bluedart_etd, dtdc_etd, xpressbees_etd, ekart_etd,
          cheapest_provider, cheapest_cost, rate_source, estimated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, NOW()
        )
        ON CONFLICT (amazon_order_id, sku) DO UPDATE SET
          destination_pincode = EXCLUDED.destination_pincode,
          destination_city = EXCLUDED.destination_city,
          destination_state = EXCLUDED.destination_state,
          package_weight_kg = EXCLUDED.package_weight_kg,
          volumetric_weight_kg = EXCLUDED.volumetric_weight_kg,
          chargeable_weight_kg = EXCLUDED.chargeable_weight_kg,
          amazon_shipping_cost = EXCLUDED.amazon_shipping_cost,
          delhivery_cost = EXCLUDED.delhivery_cost,
          bluedart_cost = EXCLUDED.bluedart_cost,
          dtdc_cost = EXCLUDED.dtdc_cost,
          xpressbees_cost = EXCLUDED.xpressbees_cost,
          ekart_cost = EXCLUDED.ekart_cost,
          delhivery_etd = EXCLUDED.delhivery_etd,
          bluedart_etd = EXCLUDED.bluedart_etd,
          dtdc_etd = EXCLUDED.dtdc_etd,
          xpressbees_etd = EXCLUDED.xpressbees_etd,
          ekart_etd = EXCLUDED.ekart_etd,
          cheapest_provider = EXCLUDED.cheapest_provider,
          cheapest_cost = EXCLUDED.cheapest_cost,
          rate_source = EXCLUDED.rate_source,
          estimated_at = NOW()
      `, [
        order.amazon_order_id, order.sku, ORIGIN_PIN,
        destPin, order.ship_city, order.ship_state,
        actualWeight, volumetricWeight, chargeableWeight,
        amazonCost || 0,
        rates.delhivery?.cost ?? null, rates.bluedart?.cost ?? null,
        rates.dtdc?.cost ?? null, rates.xpressbees?.cost ?? null, rates.ekart?.cost ?? null,
        rates.delhivery?.etd ?? null, rates.bluedart?.etd ?? null,
        rates.dtdc?.etd ?? null, rates.xpressbees?.etd ?? null, rates.ekart?.etd ?? null,
        normalizeProviderName(cheapestProvider), cheapestCost === Infinity ? null : cheapestCost,
        source,
      ]);

        estimated++;
    }

    return NextResponse.json({
      message: `Estimated or refreshed ${estimated} orders (${shiprocketCount} Shiprocket live, ${fallbackCount} fallback)`,
      estimated,
      shiprocket: shiprocketCount,
      fallback: fallbackCount,
    });
  } catch (error) {
    console.error("Shipment estimate error:", error);
    return NextResponse.json({ error: "Failed to estimate rates" }, { status: 500 });
  }
}
