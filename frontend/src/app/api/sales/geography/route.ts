import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/* ──────────────────────────────────────────────────────────
   Indian City Tier Classification
   ────────────────────────────────────────────────────────── */

const TIER_1_CITIES = new Set([
  "Mumbai", "Delhi", "New Delhi", "Bangalore", "Bengaluru",
  "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Pune",
]);

const TIER_2_CITIES = new Set([
  "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Bhopal",
  "Visakhapatnam", "Patna", "Vadodara", "Coimbatore", "Ludhiana",
  "Agra", "Madurai", "Nashik", "Vijayawada", "Meerut", "Rajkot",
  "Varanasi", "Srinagar", "Aurangabad", "Chhatrapati Sambhajinagar",
  "Dhanbad", "Amritsar", "Allahabad", "Prayagraj", "Ranchi",
  "Gwalior", "Jabalpur", "Jodhpur", "Raipur", "Kota", "Chandigarh",
  "Guwahati", "Surat", "Thiruvananthapuram", "Trivandrum", "Mysore",
  "Mysuru", "Noida", "Greater Noida", "Gurgaon", "Gurugram",
  "Faridabad", "Ghaziabad", "Thane", "Navi Mumbai", "Dehradun",
  "Bhubaneswar", "Mangalore", "Mangaluru", "Tiruchirappalli",
  "Trichy", "Hubli", "Salem", "Warangal", "Guntur", "Udaipur",
  "Belgaum", "Belagavi", "Jammu",
]);

function getCityTier(city: string | null): string {
  if (!city) return "Unknown";
  // Normalize: title-case for comparison
  const normalized = city.trim().split(/\s+/).map(
    w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
  if (TIER_1_CITIES.has(normalized)) return "Tier 1";
  if (TIER_2_CITIES.has(normalized)) return "Tier 2";
  return "Tier 3";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const state = searchParams.get("state");
    const city = searchParams.get("city");
    const tier = searchParams.get("tier"); // "Tier 1", "Tier 2", "Tier 3"
    const sku = searchParams.get("sku");
    const year = searchParams.get("year");
    const month = searchParams.get("month"); // YYYY-MM
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    /* ── Build WHERE clause ── */
    let where = "WHERE ship_city IS NOT NULL AND ship_city != ''";
    const params: (string | number)[] = [];
    let idx = 1;

    if (state) {
      where += ` AND LOWER(ship_state) = LOWER($${idx++})`;
      params.push(state);
    }
    if (city) {
      where += ` AND LOWER(ship_city) = LOWER($${idx++})`;
      params.push(city);
    }
    if (sku) {
      where += ` AND sku = $${idx++}`;
      params.push(sku);
    }
    if (year) {
      where += ` AND EXTRACT(YEAR FROM purchase_date) = $${idx++}`;
      params.push(parseInt(year));
    }
    if (month) {
      where += ` AND TO_CHAR(purchase_date, 'YYYY-MM') = $${idx++}`;
      params.push(month);
    }
    if (startDate) {
      where += ` AND purchase_date >= $${idx++}::timestamp`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND purchase_date <= $${idx++}::timestamp`;
      params.push(endDate);
    }

    /* ── By State ── */
    const byStateQuery = `
      SELECT ship_state as state,
             COUNT(*) as total_orders,
             COALESCE(SUM(item_price), 0) as total_revenue,
             COALESCE(SUM(profit), 0) as total_profit,
             COALESCE(SUM(quantity), 0) as total_units
      FROM orders ${where}
      AND ship_state IS NOT NULL AND ship_state != ''
      GROUP BY ship_state
      ORDER BY total_revenue DESC
      LIMIT 25
    `;
    const byStateResult = await pool.query(byStateQuery, params);

    /* ── By City ── */
    const byCityQuery = `
      SELECT ship_city as city, ship_state as state,
             COUNT(*) as total_orders,
             COALESCE(SUM(item_price), 0) as total_revenue,
             COALESCE(SUM(profit), 0) as total_profit,
             COALESCE(SUM(quantity), 0) as total_units
      FROM orders ${where}
      GROUP BY ship_city, ship_state
      ORDER BY total_revenue DESC
      LIMIT 25
    `;
    const byCityResult = await pool.query(byCityQuery, params);

    /* ── Attach tier labels and filter by tier ── */
    const citiesWithTier = byCityResult.rows.map((r: Record<string, unknown>) => ({
      ...r,
      tier: getCityTier(r.city as string),
    }));

    const statesData = byStateResult.rows;
    let citiesData = citiesWithTier;

    if (tier) {
      citiesData = citiesData.filter((c: Record<string, unknown>) => c.tier === tier);
    }

    /* ── By Tier (aggregated) ── */
    const allCitiesQuery = `
      SELECT ship_city as city,
             COUNT(*) as total_orders,
             COALESCE(SUM(item_price), 0) as total_revenue,
             COALESCE(SUM(profit), 0) as total_profit,
             COALESCE(SUM(quantity), 0) as total_units
      FROM orders ${where}
      GROUP BY ship_city
    `;
    const allCitiesResult = await pool.query(allCitiesQuery, params);

    const tierAgg: Record<string, { orders: number; revenue: number; profit: number; units: number }> = {
      "Tier 1": { orders: 0, revenue: 0, profit: 0, units: 0 },
      "Tier 2": { orders: 0, revenue: 0, profit: 0, units: 0 },
      "Tier 3": { orders: 0, revenue: 0, profit: 0, units: 0 },
    };

    for (const row of allCitiesResult.rows) {
      const t = getCityTier(row.city);
      if (tierAgg[t]) {
        tierAgg[t].orders += parseInt(row.total_orders);
        tierAgg[t].revenue += parseFloat(row.total_revenue);
        tierAgg[t].profit += parseFloat(row.total_profit);
        tierAgg[t].units += parseInt(row.total_units);
      }
    }

    const byTier = Object.entries(tierAgg).map(([name, data]) => ({
      tier: name,
      total_orders: data.orders,
      total_revenue: data.revenue,
      total_profit: data.profit,
      total_units: data.units,
    }));

    /* ── Filter Lists ── */
    const statesListQuery = `
      SELECT DISTINCT ship_state as state FROM orders 
      WHERE ship_state IS NOT NULL AND ship_state != ''
      ORDER BY ship_state
    `;
    const citiesListQuery = `
      SELECT DISTINCT ship_city as city FROM orders 
      WHERE ship_city IS NOT NULL AND ship_city != ''
      ORDER BY ship_city
    `;
    const [statesList, citiesList] = await Promise.all([
      pool.query(statesListQuery),
      pool.query(citiesListQuery),
    ]);

    return NextResponse.json({
      byState: statesData,
      byCity: citiesData,
      byTier,
      filters: {
        states: statesList.rows.map((r: { state: string }) => r.state),
        cities: citiesList.rows.map((r: { city: string }) => r.city),
      },
    });
  } catch (error) {
    console.error("Geography API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch geography data" },
      { status: 500 }
    );
  }
}
