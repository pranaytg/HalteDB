import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

type ProductSpecPayload = {
  sku?: string;
  asin?: string | null;
  product_name?: string | null;
  weight_kg?: number | string | null;
  length_cm?: number | string | null;
  width_cm?: number | string | null;
  height_cm?: number | string | null;
};

function nullableNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function calculatedWeights({
  weight_kg,
  length_cm,
  width_cm,
  height_cm,
}: {
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
}) {
  const volumetric_weight_kg =
    length_cm != null && width_cm != null && height_cm != null
      ? Math.round((length_cm * width_cm * height_cm) / 5000.0 * 1000) / 1000
      : null;

  const chargeable_weight_kg =
    weight_kg != null || volumetric_weight_kg != null
      ? Math.max(weight_kg ?? 0, volumetric_weight_kg ?? 0)
      : null;

  return { volumetric_weight_kg, chargeable_weight_kg };
}

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ProductSpecPayload;
    const sku = cleanText(body.sku)?.toUpperCase();

    if (!sku) {
      return NextResponse.json({ error: "Missing SKU" }, { status: 400 });
    }

    const weight_kg = nullableNumber(body.weight_kg);
    const length_cm = nullableNumber(body.length_cm);
    const width_cm = nullableNumber(body.width_cm);
    const height_cm = nullableNumber(body.height_cm);
    const { volumetric_weight_kg, chargeable_weight_kg } = calculatedWeights({
      weight_kg,
      length_cm,
      width_cm,
      height_cm,
    });

    const result = await pool.query(`
      INSERT INTO product_specifications (
        sku, asin, product_name, weight_kg, length_cm, width_cm, height_cm,
        volumetric_weight_kg, chargeable_weight_kg, last_updated
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `, [
      sku,
      cleanText(body.asin),
      cleanText(body.product_name),
      weight_kg,
      length_cm,
      width_cm,
      height_cm,
      volumetric_weight_kg,
      chargeable_weight_kg,
    ]);

    return NextResponse.json({
      status: "success",
      message: "Specification added",
      spec: result.rows[0],
    }, { status: 201 });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    }

    console.error("Product spec create error:", error);
    return NextResponse.json({ error: "Failed to add specification" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as ProductSpecPayload;
    const sku = cleanText(body.sku);

    if (!sku) {
      return NextResponse.json({ error: "Missing SKU" }, { status: 400 });
    }

    const weight_kg = nullableNumber(body.weight_kg);
    const length_cm = nullableNumber(body.length_cm);
    const width_cm = nullableNumber(body.width_cm);
    const height_cm = nullableNumber(body.height_cm);
    const { volumetric_weight_kg, chargeable_weight_kg } = calculatedWeights({
      weight_kg,
      length_cm,
      width_cm,
      height_cm,
    });

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
      weight_kg,
      length_cm,
      width_cm,
      height_cm,
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
