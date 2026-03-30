import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// Reuse Shiprocket auth + rate card logic from the bulk estimate route
// (Inline here to keep single-file simplicity)

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getShiprocketToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) return null;

  try {
    const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.token) return null;
    cachedToken = data.token;
    tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
    return cachedToken;
  } catch {
    return null;
  }
}

const CARRIER_PATTERNS: Record<string, string> = {
  delhivery: "delhivery", bluedart: "blue dart", dtdc: "dtdc",
  xpressbees: "xpressbees", ekart: "ekart",
};

async function fetchShiprocketRates(originPin: string, destPin: string, weightKg: number) {
  const token = await getShiprocketToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({
      pickup_postcode: originPin, delivery_postcode: destPin,
      weight: String(weightKg), cod: "0",
    });
    const res = await fetch(
      `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rates: Record<string, { cost: number; etd: string }> = {};
    for (const courier of data?.data?.available_courier_companies || []) {
      const name = (courier.courier_name || "").toLowerCase();
      for (const [key, pattern] of Object.entries(CARRIER_PATTERNS)) {
        if (name.includes(pattern)) {
          const cost = parseFloat(courier.rate || "0");
          const etd = courier.estimated_delivery_days || "";
          if (!rates[key] || cost < rates[key].cost) {
            rates[key] = { cost: Math.round(cost * 100) / 100, etd: etd ? `${etd} days` : "N/A" };
          }
        }
      }
    }
    return Object.keys(rates).length > 0 ? { rates, source: "shiprocket" as const } : null;
  } catch {
    return null;
  }
}

// Fallback rate cards
const ZONE_MAP: Record<string, string> = {
  "11": "North", "12": "North", "13": "North", "14": "North", "15": "North",
  "16": "North", "17": "North", "18": "North", "19": "North",
  "20": "North", "21": "North", "22": "North", "23": "North",
  "24": "North", "25": "North", "26": "North", "27": "North", "28": "North",
  "30": "South", "31": "South", "32": "South", "33": "South", "34": "South", "35": "South",
  "36": "West", "37": "South", "38": "West", "39": "West",
  "40": "West", "41": "West", "42": "West", "43": "West", "44": "West",
  "45": "Central", "46": "Central", "47": "Central", "48": "Central", "49": "Central",
  "50": "South", "51": "South", "52": "South", "53": "South",
  "56": "South", "57": "South", "58": "South", "59": "South",
  "60": "South", "61": "South", "62": "South", "63": "South", "64": "South",
  "67": "South", "68": "South", "69": "South",
  "70": "East", "71": "East", "72": "East", "73": "East", "74": "East",
  "75": "East", "76": "East", "77": "East", "78": "NorthEast", "79": "NorthEast",
  "80": "East", "81": "East", "82": "East", "83": "East", "84": "East", "85": "East",
};
const RATE_CARDS: Record<string, Record<string, [number, number]>> = {
  delhivery:  { local: [28, 16], intra_zone: [35, 20], same_zone: [45, 25], adjacent: [60, 30], national: [75, 38] },
  bluedart:   { local: [45, 25], intra_zone: [55, 30], same_zone: [70, 35], adjacent: [90, 42], national: [110, 50] },
  dtdc:       { local: [30, 18], intra_zone: [38, 22], same_zone: [50, 28], adjacent: [65, 33], national: [82, 40] },
  xpressbees: { local: [25, 15], intra_zone: [32, 18], same_zone: [42, 24], adjacent: [55, 28], national: [70, 35] },
  ekart:      { local: [30, 17], intra_zone: [38, 21], same_zone: [48, 26], adjacent: [62, 31], national: [78, 38] },
};
const ETD_CARDS: Record<string, Record<string, string>> = {
  delhivery:  { local: "1-2", intra_zone: "2-3", same_zone: "3-4", adjacent: "4-5", national: "5-7" },
  bluedart:   { local: "1", intra_zone: "1-2", same_zone: "2-3", adjacent: "3-4", national: "4-5" },
  dtdc:       { local: "2-3", intra_zone: "3-4", same_zone: "4-5", adjacent: "5-6", national: "6-8" },
  xpressbees: { local: "1-2", intra_zone: "2-3", same_zone: "3-5", adjacent: "4-6", national: "5-7" },
  ekart:      { local: "2-3", intra_zone: "3-4", same_zone: "4-5", adjacent: "5-6", national: "6-8" },
};

function getDistance(originPin: string, destPin: string): string {
  if (originPin.substring(0, 3) === destPin.substring(0, 3)) return "local";
  if (originPin.substring(0, 2) === destPin.substring(0, 2)) return "intra_zone";
  const oz = ZONE_MAP[originPin.substring(0, 2)] || "National";
  const dz = ZONE_MAP[destPin.substring(0, 2)] || "National";
  if (oz === dz) return "same_zone";
  const adj = new Set(["North-Central","Central-North","North-West","West-North","Central-West","West-Central","South-West","West-South","East-Central","Central-East"]);
  if (adj.has(`${oz}-${dz}`)) return "adjacent";
  return "national";
}

function getFallbackRates(originPin: string, destPin: string, weightKg: number) {
  const rates: Record<string, { cost: number; etd: string }> = {};
  for (const carrier of Object.keys(RATE_CARDS)) {
    const dist = getDistance(originPin, destPin);
    const [base, increment] = RATE_CARDS[carrier]?.[dist] || [75, 38];
    let cost = base;
    if (weightKg > 0.5) cost += Math.ceil((weightKg - 0.5) / 0.5) * increment;
    cost = Math.round(cost * 1.18 * 100) / 100;
    const etd = ETD_CARDS[carrier]?.[dist] || "5-7";
    rates[carrier] = { cost, etd: `${etd} days` };
  }
  return { rates, source: "fallback" as const };
}

const ORIGIN_PIN = process.env.ORIGIN_PINCODE || "160012";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { amazon_order_id, sku } = body;

    if (!amazon_order_id || !sku) {
      return NextResponse.json({ error: "Missing amazon_order_id or sku" }, { status: 400 });
    }

    // Fetch order + product specs
    const orderResult = await pool.query(`
      SELECT o.amazon_order_id, o.sku,
             o.ship_postal_code as destination_pincode,
             o.ship_city as destination_city,
             o.ship_state as destination_state,
             o.shipping_price as amazon_shipping_cost,
             ps.weight_kg, ps.volumetric_weight_kg, ps.chargeable_weight_kg
      FROM orders o
      LEFT JOIN product_specifications ps ON o.sku = ps.sku
      WHERE o.amazon_order_id = $1 AND o.sku = $2
    `, [amazon_order_id, sku]);

    const order = orderResult.rows[0];
    if (!order || !order.destination_pincode) {
      return NextResponse.json({ error: "Order not found or missing postal code" }, { status: 404 });
    }

    const actualWeight = parseFloat(order.weight_kg) || 0.5;
    const volumetricWeight = order.volumetric_weight_kg ? parseFloat(order.volumetric_weight_kg) : null;
    const chargeableWeight = parseFloat(order.chargeable_weight_kg) || actualWeight;

    // Try Shiprocket, then fallback
    const result = await fetchShiprocketRates(ORIGIN_PIN, order.destination_pincode, chargeableWeight)
      || getFallbackRates(ORIGIN_PIN, order.destination_pincode, chargeableWeight);

    const { rates, source } = result;

    // Find cheapest
    const amazonCost = parseFloat(order.amazon_shipping_cost || "0");
    const allCosts: Record<string, number> = {};
    if (amazonCost > 0) allCosts["Amazon"] = amazonCost;
    for (const [carrier, info] of Object.entries(rates)) {
      if (info.cost > 0) {
        const label = carrier === "bluedart" ? "BlueDart"
          : carrier === "xpressbees" ? "XpressBees"
          : carrier.charAt(0).toUpperCase() + carrier.slice(1);
        allCosts[label] = info.cost;
      }
    }

    let cheapestProvider = "";
    let cheapestCost = Infinity;
    for (const [provider, cost] of Object.entries(allCosts)) {
      if (cost < cheapestCost) { cheapestCost = cost; cheapestProvider = provider; }
    }

    // Upsert
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW()
      )
      ON CONFLICT (amazon_order_id, sku) DO UPDATE SET
        destination_pincode=EXCLUDED.destination_pincode, destination_city=EXCLUDED.destination_city,
        destination_state=EXCLUDED.destination_state, package_weight_kg=EXCLUDED.package_weight_kg,
        volumetric_weight_kg=EXCLUDED.volumetric_weight_kg, chargeable_weight_kg=EXCLUDED.chargeable_weight_kg,
        amazon_shipping_cost=EXCLUDED.amazon_shipping_cost,
        delhivery_cost=EXCLUDED.delhivery_cost, bluedart_cost=EXCLUDED.bluedart_cost,
        dtdc_cost=EXCLUDED.dtdc_cost, xpressbees_cost=EXCLUDED.xpressbees_cost,
        ekart_cost=EXCLUDED.ekart_cost,
        delhivery_etd=EXCLUDED.delhivery_etd, bluedart_etd=EXCLUDED.bluedart_etd,
        dtdc_etd=EXCLUDED.dtdc_etd, xpressbees_etd=EXCLUDED.xpressbees_etd,
        ekart_etd=EXCLUDED.ekart_etd,
        cheapest_provider=EXCLUDED.cheapest_provider, cheapest_cost=EXCLUDED.cheapest_cost,
        rate_source=EXCLUDED.rate_source, estimated_at=NOW()
    `, [
      amazon_order_id, sku, ORIGIN_PIN,
      order.destination_pincode, order.destination_city, order.destination_state,
      actualWeight, volumetricWeight, chargeableWeight,
      amazonCost || 0,
      rates.delhivery?.cost ?? null, rates.bluedart?.cost ?? null,
      rates.dtdc?.cost ?? null, rates.xpressbees?.cost ?? null, rates.ekart?.cost ?? null,
      rates.delhivery?.etd ?? null, rates.bluedart?.etd ?? null,
      rates.dtdc?.etd ?? null, rates.xpressbees?.etd ?? null, rates.ekart?.etd ?? null,
      cheapestProvider, cheapestCost === Infinity ? null : cheapestCost, source,
    ]);

    return NextResponse.json({
      status: "success",
      message: `Rate estimated (${source})`,
      cheapest_provider: cheapestProvider,
      rate_source: source,
    });
  } catch (error) {
    console.error("Single estimate error:", error);
    return NextResponse.json({ error: "Failed to estimate rate" }, { status: 500 });
  }
}
