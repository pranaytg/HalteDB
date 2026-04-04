import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT sku, asin, product_name, weight_kg, length_cm, width_cm, height_cm,
             volumetric_weight_kg, chargeable_weight_kg, last_updated
      FROM product_specifications
      ORDER BY sku
    `);
    
    return NextResponse.json({
      specs: result.rows,
      total: result.rowCount
    });
  } catch (error) {
    console.error("Product specs API error:", error);
    return NextResponse.json({ error: "Failed to fetch product specifications" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { sku, weight_kg, length_cm, width_cm, height_cm } = body;

    if (!sku) {
      return NextResponse.json({ error: "Missing SKU" }, { status: 400 });
    }

    // Calculate volumetric and chargeable weights
    let volumetric_weight_kg = null;
    if (length_cm && width_cm && height_cm) {
      volumetric_weight_kg = Math.round((length_cm * width_cm * height_cm) / 5000.0 * 1000) / 1000;
    }

    let chargeable_weight_kg = null;
    if (weight_kg || volumetric_weight_kg) {
      chargeable_weight_kg = Math.max(weight_kg || 0, volumetric_weight_kg || 0);
    }

    const result = await pool.query(`
      UPDATE product_specifications 
      SET weight_kg = $1, 
          length_cm = $2, 
          width_cm = $3, 
          height_cm = $4,
          volumetric_weight_kg = $5,
          chargeable_weight_kg = $6,
          last_updated = NOW()
      WHERE sku = $7
      RETURNING *
    `, [
      weight_kg === "" ? null : weight_kg, 
      length_cm === "" ? null : length_cm, 
      width_cm === "" ? null : width_cm, 
      height_cm === "" ? null : height_cm, 
      volumetric_weight_kg, 
      chargeable_weight_kg, 
      sku
    ]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: "success",
      message: "Specification updated",
      spec: result.rows[0]
    });
  } catch (error) {
    console.error("Single update error:", error);
    return NextResponse.json({ error: "Failed to update specification" }, { status: 500 });
  }
}
