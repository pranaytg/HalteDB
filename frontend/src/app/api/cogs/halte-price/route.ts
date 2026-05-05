import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import pool from "@/lib/db";

export const runtime = "nodejs";

type IncomingPrice = {
  sku: string;
  price: number;
};

function getColumnValue(row: Record<string, unknown>, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const entry = Object.entries(row).find(([key]) =>
    wanted.has(key.trim().toLowerCase()),
  );

  return entry?.[1];
}

function parsePrice(value: unknown) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;

  const price = Number.parseFloat(cleaned);
  if (!Number.isFinite(price) || price < 0) return null;

  return Math.round(price * 100) / 100;
}

function readHaltePrices(buffer: ArrayBuffer) {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Workbook has no sheets");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
    { defval: "" },
  );
  const prices = new Map<string, number>();
  let validRows = 0;
  let invalidRows = 0;

  for (const row of rows) {
    const sku = String(getColumnValue(row, ["id", "sku"]) || "").trim();
    const price = parsePrice(getColumnValue(row, ["price"]));

    if (!sku || price === null) {
      invalidRows++;
      continue;
    }

    validRows++;
    prices.set(sku, price);
  }

  return {
    rows: rows.length,
    validRows,
    invalidRows,
    duplicateRows: validRows - prices.size,
    prices: [...prices.entries()].map(([sku, price]) => ({ sku, price })),
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const upload = formData.get("file");

    if (!upload || typeof upload === "string") {
      return NextResponse.json(
        { error: "Excel file is required" },
        { status: 400 },
      );
    }

    const parsed = readHaltePrices(await upload.arrayBuffer());
    if (parsed.prices.length === 0) {
      return NextResponse.json(
        { error: "No valid rows found. Expected columns: id and price." },
        { status: 400 },
      );
    }

    await pool.query("BEGIN");
    await pool.query(
      "ALTER TABLE cogs ADD COLUMN IF NOT EXISTS halte_price DOUBLE PRECISION",
    );

    const result = await pool.query(
      `
        WITH incoming AS (
          SELECT sku, price
          FROM jsonb_to_recordset($1::jsonb) AS row(sku text, price double precision)
        ),
        matched AS (
          SELECT incoming.sku
          FROM incoming
          JOIN cogs ON cogs.sku = incoming.sku
        ),
        updated AS (
          UPDATE cogs
          SET halte_price = incoming.price,
              last_updated = NOW()
          FROM incoming
          WHERE cogs.sku = incoming.sku
            AND cogs.halte_price IS DISTINCT FROM incoming.price
          RETURNING cogs.sku
        )
        SELECT
          (SELECT COUNT(1) FROM incoming)::int AS incoming,
          (SELECT COUNT(1) FROM matched)::int AS matched,
          (SELECT COUNT(1) FROM updated)::int AS updated
      `,
      [JSON.stringify(parsed.prices)],
    );

    await pool.query("COMMIT");

    const stats = result.rows[0] || { incoming: 0, matched: 0, updated: 0 };
    return NextResponse.json({
      totalRows: parsed.rows,
      validRows: parsed.validRows,
      invalidRows: parsed.invalidRows,
      duplicateRows: parsed.duplicateRows,
      uniquePrices: parsed.prices.length,
      matched: Number(stats.matched || 0),
      updated: Number(stats.updated || 0),
      unmatched: parsed.prices.length - Number(stats.matched || 0),
    });
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error("Halte price upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update Halte prices",
      },
      { status: 500 },
    );
  }
}
