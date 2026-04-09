import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const state = searchParams.get("state") || "";
    const city = searchParams.get("city") || "";

    // Build filter conditions
    const conditions: string[] = [];
    const params: string[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(LOWER(c.name) LIKE LOWER($${idx}) OR LOWER(c.customer_id) LIKE LOWER($${idx}) OR c.phone LIKE $${idx} OR LOWER(c.email) LIKE LOWER($${idx}))`);
      params.push(`%${search}%`);
      idx++;
    }
    if (state) {
      conditions.push(`LOWER(c.state) = LOWER($${idx})`);
      params.push(state);
      idx++;
    }
    if (city) {
      conditions.push(`LOWER(c.city) = LOWER($${idx})`);
      params.push(city);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Check if customers table exists and has data
    let hasCustomerTable = false;
    try {
      const check = await pool.query(`SELECT COUNT(*) FROM customers`);
      hasCustomerTable = Number(check.rows[0].count) > 0;
    } catch {
      hasCustomerTable = false;
    }

    if (hasCustomerTable) {
      // Fetch customers from table
      const customersResult = await pool.query(
        `SELECT * FROM customers c ${where} ORDER BY c.total_spent DESC LIMIT 200`,
        params
      );

      // KPI from customer table
      const kpiResult = await pool.query(`
        SELECT
          COUNT(*) AS total_customers,
          COUNT(DISTINCT state) AS unique_states,
          COUNT(DISTINCT city) AS unique_cities,
          COALESCE(SUM(total_spent), 0) AS total_revenue,
          COALESCE(SUM(total_orders), 0) AS total_orders,
          COALESCE(AVG(total_spent), 0) AS avg_spent
        FROM customers
      `);

      // States list for filter
      const statesResult = await pool.query(
        `SELECT DISTINCT state FROM customers WHERE state IS NOT NULL ORDER BY state`
      );
      const citiesResult = await pool.query(
        `SELECT DISTINCT city FROM customers WHERE city IS NOT NULL ORDER BY city`
      );

      // Order-based analytics (keep existing analytics)
      const topPostalResult = await pool.query(`
        SELECT ship_postal_code AS postal_code, MAX(ship_city) AS city, MAX(ship_state) AS state,
               COUNT(DISTINCT amazon_order_id) AS order_count, COALESCE(SUM(item_price), 0) AS total_revenue
        FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
        GROUP BY ship_postal_code ORDER BY order_count DESC LIMIT 30
      `);

      const byStateResult = await pool.query(`
        SELECT ship_state AS state, COUNT(DISTINCT amazon_order_id) AS order_count,
               COALESCE(SUM(item_price), 0) AS total_revenue, COUNT(DISTINCT ship_postal_code) AS unique_postal_codes
        FROM orders WHERE ship_state IS NOT NULL AND ship_state != ''
        GROUP BY ship_state ORDER BY total_revenue DESC LIMIT 20
      `);

      const repeatResult = await pool.query(`
        SELECT ship_postal_code AS postal_code, MAX(ship_city) AS city, MAX(ship_state) AS state,
               COUNT(DISTINCT amazon_order_id) AS order_count, COALESCE(SUM(item_price), 0) AS total_revenue
        FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
        GROUP BY ship_postal_code HAVING COUNT(DISTINCT amazon_order_id) > 1
        ORDER BY order_count DESC LIMIT 30
      `);

      const newLocationsTrendResult = await pool.query(`
        WITH first_order AS (
          SELECT ship_postal_code, MIN(purchase_date) AS first_order_date
          FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != '' AND purchase_date IS NOT NULL
          GROUP BY ship_postal_code
        )
        SELECT TO_CHAR(first_order_date, 'YYYY-MM') AS month, COUNT(*) AS new_locations
        FROM first_order GROUP BY TO_CHAR(first_order_date, 'YYYY-MM') ORDER BY month ASC
      `);

      return NextResponse.json({
        customers: customersResult.rows,
        kpi: kpiResult.rows[0],
        topPostalCodes: topPostalResult.rows,
        byState: byStateResult.rows,
        repeatLocations: repeatResult.rows,
        newLocationsTrend: newLocationsTrendResult.rows,
        filters: {
          states: statesResult.rows.map((r: { state: string }) => r.state),
          cities: citiesResult.rows.map((r: { city: string }) => r.city),
        },
      });
    }

    // Fallback: order-based analytics only (no customer table)
    const kpiResult = await pool.query(`
      SELECT COUNT(DISTINCT ship_postal_code) AS unique_postal_codes, COUNT(DISTINCT ship_city) AS unique_cities,
             COUNT(DISTINCT ship_state) AS unique_states, COALESCE(SUM(item_price), 0) AS total_revenue,
             COUNT(DISTINCT amazon_order_id) AS total_orders
      FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
    `);

    const topPostalResult = await pool.query(`
      SELECT ship_postal_code AS postal_code, MAX(ship_city) AS city, MAX(ship_state) AS state,
             COUNT(DISTINCT amazon_order_id) AS order_count, COALESCE(SUM(item_price), 0) AS total_revenue
      FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
      GROUP BY ship_postal_code ORDER BY order_count DESC LIMIT 50
    `);

    const byStateResult = await pool.query(`
      SELECT ship_state AS state, COUNT(DISTINCT amazon_order_id) AS order_count,
             COALESCE(SUM(item_price), 0) AS total_revenue, COUNT(DISTINCT ship_postal_code) AS unique_postal_codes
      FROM orders WHERE ship_state IS NOT NULL AND ship_state != ''
      GROUP BY ship_state ORDER BY total_revenue DESC LIMIT 20
    `);

    const repeatResult = await pool.query(`
      SELECT ship_postal_code AS postal_code, MAX(ship_city) AS city, MAX(ship_state) AS state,
             COUNT(DISTINCT amazon_order_id) AS order_count, COALESCE(SUM(item_price), 0) AS total_revenue
      FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != ''
      GROUP BY ship_postal_code HAVING COUNT(DISTINCT amazon_order_id) > 1
      ORDER BY order_count DESC LIMIT 30
    `);

    const newLocationsTrendResult = await pool.query(`
      WITH first_order AS (
        SELECT ship_postal_code, MIN(purchase_date) AS first_order_date
        FROM orders WHERE ship_postal_code IS NOT NULL AND ship_postal_code != '' AND purchase_date IS NOT NULL
        GROUP BY ship_postal_code
      )
      SELECT TO_CHAR(first_order_date, 'YYYY-MM') AS month, COUNT(*) AS new_locations
      FROM first_order GROUP BY TO_CHAR(first_order_date, 'YYYY-MM') ORDER BY month ASC
    `);

    return NextResponse.json({
      customers: [],
      kpi: { ...kpiResult.rows[0], total_customers: 0 },
      topPostalCodes: topPostalResult.rows,
      byState: byStateResult.rows,
      repeatLocations: repeatResult.rows,
      newLocationsTrend: newLocationsTrendResult.rows,
      filters: { states: [], cities: [] },
    });
  } catch (error) {
    console.error("Customers API error:", error);
    return NextResponse.json({ error: "Failed to fetch customer data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, phone, email, address, city, state, pincode, notes } = body;

    if (!name) {
      return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    }

    // Generate customer ID
    const countResult = await pool.query(`SELECT COUNT(*) FROM customers`);
    const nextId = Number(countResult.rows[0].count) + 1;
    const customerId = `CUST-${String(nextId).padStart(4, "0")}`;

    const result = await pool.query(
      `INSERT INTO customers (customer_id, name, phone, email, address, city, state, pincode, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [customerId, name, phone || null, email || null, address || null, city || null, state || null, pincode || null, notes || null]
    );

    return NextResponse.json({ customer: result.rows[0] });
  } catch (error) {
    console.error("Customer POST error:", error);
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { customer_id, name, phone, email, address, city, state, pincode, notes } = body;

    if (!customer_id) {
      return NextResponse.json({ error: "Customer ID is required" }, { status: 400 });
    }

    const result = await pool.query(
      `UPDATE customers SET name=$2, phone=$3, email=$4, address=$5, city=$6, state=$7, pincode=$8, notes=$9, updated_at=NOW()
       WHERE customer_id=$1 RETURNING *`,
      [customer_id, name, phone || null, email || null, address || null, city || null, state || null, pincode || null, notes || null]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ customer: result.rows[0] });
  } catch (error) {
    console.error("Customer PUT error:", error);
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { customer_id } = await req.json();
    if (!customer_id) {
      return NextResponse.json({ error: "Customer ID is required" }, { status: 400 });
    }

    await pool.query(`DELETE FROM customers WHERE customer_id = $1`, [customer_id]);
    return NextResponse.json({ deleted: customer_id });
  } catch (error) {
    console.error("Customer DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete customer" }, { status: 500 });
  }
}
