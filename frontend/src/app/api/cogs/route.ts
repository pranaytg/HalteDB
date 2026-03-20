import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const query = `
      SELECT id, sku, cogs_price, last_updated
      FROM cogs
      ORDER BY sku ASC
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
    const recalcQuery = `
      UPDATE orders 
      SET cogs_price = $1, profit = item_price - $1
      WHERE sku = $2
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
