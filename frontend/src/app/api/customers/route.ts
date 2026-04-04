import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    // 1. KPI summary
    const kpiResult = await pool.query(`
      SELECT
        COUNT(DISTINCT ship_postal_code)  AS unique_postal_codes,
        COUNT(DISTINCT ship_city)         AS unique_cities,
        COUNT(DISTINCT ship_state)        AS unique_states,
        COALESCE(SUM(item_price), 0)      AS total_revenue,
        COUNT(DISTINCT amazon_order_id)   AS total_orders
      FROM orders
      WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
    `);

    // 2. Top postal codes by order count
    const topPostalResult = await pool.query(`
      SELECT
        ship_postal_code                          AS postal_code,
        MAX(ship_city)                            AS city,
        MAX(ship_state)                           AS state,
        COUNT(DISTINCT amazon_order_id)           AS order_count,
        COALESCE(SUM(item_price), 0)              AS total_revenue,
        COALESCE(SUM(quantity), 0)                AS total_units
      FROM orders
      WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
      GROUP BY ship_postal_code
      ORDER BY order_count DESC
      LIMIT 50
    `);

    // 3. Customer concentration — cumulative revenue share across postal codes
    const concentrationResult = await pool.query(`
      WITH postal_rev AS (
        SELECT
          ship_postal_code,
          SUM(item_price) AS revenue
        FROM orders
        WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
        GROUP BY ship_postal_code
        ORDER BY revenue DESC
        LIMIT 100
      ),
      total AS (SELECT SUM(revenue) AS grand_total FROM postal_rev)
      SELECT
        p.ship_postal_code,
        p.revenue,
        t.grand_total,
        ROUND(100.0 * p.revenue / NULLIF(t.grand_total, 0), 2)                                              AS pct_of_total,
        ROUND(100.0 * SUM(p.revenue) OVER (ORDER BY p.revenue DESC) / NULLIF(t.grand_total, 0), 2)          AS cumulative_pct
      FROM postal_rev p, total t
      ORDER BY p.revenue DESC
    `);

    // 4. Repeat buyer locations (postal codes with more than 1 distinct order)
    const repeatResult = await pool.query(`
      SELECT
        ship_postal_code                AS postal_code,
        MAX(ship_city)                  AS city,
        MAX(ship_state)                 AS state,
        COUNT(DISTINCT amazon_order_id) AS order_count,
        COALESCE(SUM(item_price), 0)    AS total_revenue
      FROM orders
      WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
      GROUP BY ship_postal_code
      HAVING COUNT(DISTINCT amazon_order_id) > 1
      ORDER BY order_count DESC
      LIMIT 30
    `);

    // 5. Revenue by state
    const byStateResult = await pool.query(`
      SELECT
        ship_state                        AS state,
        COUNT(DISTINCT amazon_order_id)   AS order_count,
        COALESCE(SUM(item_price), 0)      AS total_revenue,
        COUNT(DISTINCT ship_postal_code)  AS unique_postal_codes
      FROM orders
      WHERE ship_state IS NOT NULL AND ship_state != ''
      GROUP BY ship_state
      ORDER BY total_revenue DESC
      LIMIT 20
    `);

    // 6. Monthly new locations trend (first order month per postal code)
    const newLocationsTrendResult = await pool.query(`
      WITH first_order AS (
        SELECT
          ship_postal_code,
          MIN(purchase_date) AS first_order_date
        FROM orders
        WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
          AND purchase_date IS NOT NULL
        GROUP BY ship_postal_code
      )
      SELECT
        TO_CHAR(first_order_date, 'YYYY-MM') AS month,
        COUNT(*)                             AS new_locations
      FROM first_order
      GROUP BY TO_CHAR(first_order_date, 'YYYY-MM')
      ORDER BY month ASC
    `);

    return NextResponse.json({
      kpi: kpiResult.rows[0],
      topPostalCodes: topPostalResult.rows,
      concentration: concentrationResult.rows,
      repeatLocations: repeatResult.rows,
      byState: byStateResult.rows,
      newLocationsTrend: newLocationsTrendResult.rows,
    });
  } catch (error) {
    console.error("Customers API error:", error);
    return NextResponse.json({ error: "Failed to fetch customer data" }, { status: 500 });
  }
}
