/**
 * Shared shipment calculation logic — used by both bulk and single estimate routes.
 *
 * Shiprocket quotes are fetched via the Python backend (POST /shipping-rates).
 * Authenticating from both sides with the same Shiprocket account caused
 * constant token invalidation (Shiprocket kicks out a token whenever the
 * same account logs in elsewhere), so the backend is now the single auth
 * source — the frontend never talks to Shiprocket directly.
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/** Canonical display name for each carrier key */
export const CARRIER_LABELS: Record<string, string> = {
  amazon: "Amazon",
  delhivery: "Delhivery",
  bluedart: "BlueDart",
  dtdc: "DTDC",
  xpressbees: "Xpressbees",
  ekart: "Ekart",
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
  const safeWeight = Math.max(weightKg || 0.5, 0.1);
  const sanitizedOriginPin = normalizePincode(originPin);
  const sanitizedDestPin = normalizePincode(destPin);
  if (sanitizedOriginPin.length !== 6 || sanitizedDestPin.length !== 6) {
    console.warn(`[Shiprocket] Invalid pincode(s): origin=${originPin} dest=${destPin}`);
    return null;
  }

  try {
    const body: Record<string, string | number> = {
      origin_pin: sanitizedOriginPin,
      dest_pin: sanitizedDestPin,
      weight_kg: safeWeight,
    };
    if (dims?.length) body.length_cm = dims.length;
    if (dims?.breadth) body.width_cm = dims.breadth;
    if (dims?.height) body.height_cm = dims.height;

    const res = await fetch(`${BACKEND_URL}/shipping-rates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[Shiprocket] Backend /shipping-rates failed: ${res.status}`);
      return null;
    }

    const data = await res.json() as {
      rates?: Record<string, { cost: number; etd: string }>;
      source?: string;
    };

    if (data.source !== "shiprocket" || !data.rates || Object.keys(data.rates).length === 0) {
      return null;
    }
    return { rates: data.rates, source: "shiprocket" };
  } catch (e) {
    console.warn("[Shiprocket] Backend rates error:", e);
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
