/**
 * Shared shipment calculation logic — used by both bulk and single estimate routes.
 */

// ═══════════════════════════════════════════════════
// Shiprocket Live API
// ═══════════════════════════════════════════════════

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getShiprocketToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) {
    console.warn("[Shiprocket] No credentials found in env");
    return null;
  }

  try {
    const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      console.warn(`[Shiprocket] Auth failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.token) return null;

    cachedToken = data.token;
    tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000; // 9 days
    console.log("[Shiprocket] Token acquired");
    return cachedToken;
  } catch (e) {
    console.warn("[Shiprocket] Auth error:", e);
    return null;
  }
}

// Canonical carrier keys used throughout the app
const CARRIER_PATTERNS: Record<string, string> = {
  delhivery: "delhivery",
  bluedart: "blue dart",
  dtdc: "dtdc",
  xpressbees: "xpressbees",
  ekart: "ekart",
};

/** Canonical display name for each carrier key */
export const CARRIER_LABELS: Record<string, string> = {
  amazon: "Amazon",
  delhivery: "Delhivery",
  bluedart: "BlueDart",
  dtdc: "DTDC",
  xpressbees: "Xpressbees",
  ekart: "Ekart",
};

// Multiple name patterns per carrier — handles Shiprocket API variants
const CARRIER_MULTI_PATTERNS: Record<string, string[]> = {
  amazon:      ["amazon shipping", "amazon prepaid", "amazon"],
  delhivery:  ["delhivery"],
  bluedart:   ["blue dart", "bluedart"],
  dtdc:       ["dtdc"],
  xpressbees: ["xpressbees", "expressbees"],
  ekart:      ["ekart", "e-kart"],
};

export interface ShiprocketDimensions {
  length?: number;  // cm
  breadth?: number; // cm
  height?: number;  // cm
}

function roundCost(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizePincode(pin: string | number | null | undefined): string {
  return String(pin ?? "").replace(/\D/g, "").slice(0, 6);
}

export function isAmazonFulfilled(fulfillmentChannel: string | null | undefined): boolean {
  const normalized = String(fulfillmentChannel ?? "").toLowerCase();
  return normalized.includes("amazon") || normalized.includes("afn");
}

export async function fetchShiprocketRates(
  originPin: string, destPin: string, weightKg: number,
  dims?: ShiprocketDimensions
): Promise<{ rates: Record<string, { cost: number; etd: string }>; source: "shiprocket" } | null> {
  const token = await getShiprocketToken();
  if (!token) {
    console.warn("[Shiprocket] Skipping rate fetch — no auth token");
    return null;
  }

  const safeWeight = Math.max(weightKg || 0.5, 0.1);
  const sanitizedOriginPin = normalizePincode(originPin);
  const sanitizedDestPin = normalizePincode(destPin);
  if (sanitizedOriginPin.length !== 6 || sanitizedDestPin.length !== 6) {
    console.warn(`[Shiprocket] Invalid pincode(s): origin=${originPin} dest=${destPin}`);
    return null;
  }

  try {
    const paramObj: Record<string, string> = {
      pickup_postcode: sanitizedOriginPin,
      delivery_postcode: sanitizedDestPin,
      weight: String(safeWeight),
      cod: "0",
      declared_value: "500",
    };
    // Pass dimensions when available — improves accuracy and avoids rejections
    if (dims?.length) paramObj.length = String(Math.ceil(dims.length));
    if (dims?.breadth) paramObj.breadth = String(Math.ceil(dims.breadth));
    if (dims?.height) paramObj.height = String(Math.ceil(dims.height));

    const params = new URLSearchParams(paramObj);
    const res = await fetch(
      `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[Shiprocket] Rates API failed: ${res.status} — ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();

    // Handle API-level errors (HTTP 200 but status field indicates error)
    if (data?.status && data.status !== 200 && data.status !== "200") {
      console.warn(`[Shiprocket] API returned non-success status: ${data.status} — ${data.message || ""}`);
      return null;
    }

    const companies: Record<string, unknown>[] = data?.data?.available_courier_companies || [];
    if (companies.length === 0) {
      console.warn(`[Shiprocket] No courier companies returned for ${originPin}→${destPin} weight=${safeWeight}`);
      return null;
    }

    const rates: Record<string, { cost: number; etd: string }> = {};

    for (const courier of companies) {
      const name = ((courier.courier_name as string) || "").toLowerCase().replace(/[^a-z\s]/g, "");
      for (const [key, patterns] of Object.entries(CARRIER_MULTI_PATTERNS)) {
        if (patterns.some(p => name.includes(p))) {
          // Try multiple field names for rate (API has changed over time)
          const cost = parseFloat(
            String(courier.rate || courier.freight_charge || courier.total_charges || "0")
          );
          const etd = String(courier.estimated_delivery_days || courier.etd || "");
          if (cost > 0 && (!rates[key] || cost < rates[key].cost)) {
            rates[key] = {
              cost: roundCost(cost),
              etd: etd ? `${etd} days` : "N/A",
            };
          }
        }
      }
    }

    if (Object.keys(rates).length === 0) {
      console.warn(`[Shiprocket] No matching carriers in response (got ${companies.length} total). Names: ${companies.slice(0,5).map(c => c.courier_name).join(", ")}`);
      return null;
    }

    return { rates, source: "shiprocket" };
  } catch (e) {
    console.warn("[Shiprocket] Rates error:", e);
    return null;
  }
}

export const ORIGIN_PIN = process.env.ORIGIN_PINCODE || "160012";

export function resolveAmazonShippingCost(
  actualAmazonCost: number | string | null | undefined,
  fulfillmentChannel: string | null | undefined,
  rates: Record<string, { cost: number; etd: string }>
): number {
  const actualCost = Number(actualAmazonCost) || 0;
  if (actualCost > 0) return roundCost(actualCost);
  if (!isAmazonFulfilled(fulfillmentChannel)) return 0;

  const liveAmazonCost = rates.amazon?.cost || 0;
  if (liveAmazonCost > 0) return roundCost(liveAmazonCost);

  // For Amazon-fulfilled orders, only use SP-API actual data.
  // Do NOT fall back to Shiprocket/rate-card estimates.
  return 0;
}

/**
 * Given rates from either Shiprocket or fallback plus Amazon's cost,
 * returns the cheapest provider & cost.
 */
export function findCheapest(
  rates: Record<string, { cost: number; etd: string }>,
  amazonCost: number
): { cheapestProvider: string; cheapestCost: number } {
  const allCosts: Record<string, number> = {};
  if (amazonCost > 0) allCosts["Amazon"] = amazonCost;
  for (const [carrier, info] of Object.entries(rates)) {
    if (carrier === "amazon") continue;
    if (info.cost > 0) {
      allCosts[CARRIER_LABELS[carrier] || carrier] = info.cost;
    }
  }

  let cheapestProvider = "";
  let cheapestCost = Infinity;
  for (const [provider, cost] of Object.entries(allCosts)) {
    if (cost < cheapestCost) {
      cheapestCost = cost;
      cheapestProvider = provider;
    }
  }
  return { cheapestProvider, cheapestCost };
}

/** Normalize various spellings of carrier names to our canonical forms */
export function normalizeProviderName(name: string): string {
  if (!name) return name;
  const lower = name.toLowerCase().replace(/[^a-z]/g, "");
  if (lower.includes("xpressbees") || lower.includes("expressbees")) return "Xpressbees";
  if (lower.includes("bluedart") || lower.includes("bluedartt")) return "BlueDart";
  if (lower.includes("delhivery")) return "Delhivery";
  if (lower.includes("dtdc")) return "DTDC";
  if (lower.includes("ekart")) return "Ekart";
  if (lower.includes("amazon")) return "Amazon";
  return name;
}
