import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getCityTier } from "@/lib/cityTiers";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");
    const brand = searchParams.get("brand");
    const year = searchParams.get("year");
    const month = searchParams.get("month"); // YYYY-MM
    const state = searchParams.get("state");
    const city = searchParams.get("city");
    const tier = searchParams.get("tier");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    /* ── Build dynamic WHERE ── */
    const conditions: string[] = ["orders.purchase_date IS NOT NULL"];
    const params: (string | number)[] = [];
    let idx = 1;

    if (sku) { conditions.push(`orders.sku = $${idx++}`); params.push(sku); }
    if (brand) { conditions.push(`ec.brand = $${idx++}`); params.push(brand); }
    if (year) { conditions.push(`EXTRACT(YEAR FROM orders.purchase_date) = $${idx++}`); params.push(parseInt(year)); }
    if (month) { conditions.push(`TO_CHAR(orders.purchase_date, 'YYYY-MM') = $${idx++}`); params.push(month); }
    if (state) { conditions.push(`LOWER(orders.ship_state) = LOWER($${idx++})`); params.push(state); }
    if (city) { conditions.push(`LOWER(orders.ship_city) = LOWER($${idx++})`); params.push(city); }
    if (startDate) { conditions.push(`orders.purchase_date >= $${idx++}::timestamp`); params.push(startDate); }
    if (endDate) { conditions.push(`orders.purchase_date <= $${idx++}::timestamp`); params.push(endDate); }

    /* ── Tier filter: resolve tier → city list ── */
    if (tier) {
      const allCitiesRes = await pool.query(
        "SELECT DISTINCT ship_city FROM orders WHERE ship_city IS NOT NULL AND ship_city != ''"
      );
      const tierCities = allCitiesRes.rows
        .map((r: { ship_city: string }) => r.ship_city)
        .filter((c: string) => getCityTier(c) === tier);

      if (tierCities.length === 0) {
        return NextResponse.json({
          monthly: [], bySku: [], daily: [],
          filters: { skus: [], years: [], brands: [] },
        });
      }

      const placeholders = tierCities.map(() => `$${idx++}`).join(",");
      conditions.push(`orders.ship_city IN (${placeholders})`);
      params.push(...tierCities);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const fromClause = `FROM orders LEFT JOIN estimated_cogs ec ON orders.sku = ec.sku`;

    // Monthly aggregated
    const monthlyResult = await pool.query(`
      SELECT TO_CHAR(orders.purchase_date, 'YYYY-MM') as month,
             COUNT(*) as total_orders,
             COALESCE(SUM(orders.item_price), 0) as total_revenue,
             COALESCE(SUM(orders.profit), 0) as total_profit,
             COALESCE(SUM(orders.quantity), 0) as total_units
      ${fromClause} ${where}
      GROUP BY TO_CHAR(orders.purchase_date, 'YYYY-MM')
      ORDER BY month ASC
    `, params);

    // SKU-wise summary
    const skuResult = await pool.query(`
      SELECT orders.sku,
             COUNT(*) as total_orders,
             COALESCE(SUM(orders.item_price), 0) as total_revenue,
             COALESCE(SUM(orders.profit), 0) as total_profit,
             COALESCE(SUM(orders.quantity), 0) as total_units
      ${fromClause} ${where}
      GROUP BY orders.sku
      ORDER BY total_revenue DESC
      LIMIT 20
    `, params);

    // Daily sales for the last 30 days (also filtered)
    const dailyResult = await pool.query(`
      SELECT TO_CHAR(orders.purchase_date, 'YYYY-MM-DD') as date,
             COUNT(*) as total_orders,
             COALESCE(SUM(orders.item_price), 0) as total_revenue,
             COALESCE(SUM(orders.profit), 0) as total_profit
      ${fromClause} ${where}
      ${conditions.length > 0 ? "AND" : "WHERE"} orders.purchase_date >= NOW() - INTERVAL '30 days'
      GROUP BY TO_CHAR(orders.purchase_date, 'YYYY-MM-DD')
      ORDER BY date ASC
    `, params);

    // Available filter options (unfiltered so user can always access all choices)
    const [filtersResult, yearsResult, brandsResult] = await Promise.all([
      pool.query(`SELECT DISTINCT sku FROM orders WHERE sku IS NOT NULL ORDER BY sku`),
      pool.query(`SELECT DISTINCT EXTRACT(YEAR FROM purchase_date) as year FROM orders WHERE purchase_date IS NOT NULL ORDER BY year DESC`),
      pool.query(`SELECT DISTINCT brand FROM estimated_cogs WHERE brand IS NOT NULL ORDER BY brand`),
    ]);

    return NextResponse.json({
      monthly: monthlyResult.rows,
      bySku: skuResult.rows,
      daily: dailyResult.rows,
      filters: {
        skus: filtersResult.rows.map((r: { sku: string }) => r.sku),
        years: yearsResult.rows.map((r: { year: number }) => r.year),
        brands: brandsResult.rows.map((r: { brand: string }) => r.brand),
      },
    });
  } catch (error) {
    console.error("Sales summary error:", error);
    return NextResponse.json({ error: "Failed to fetch sales summary" }, { status: 500 });
  }
}
