import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import pool from "@/lib/db";

export const runtime = "nodejs";

function jsonSheet(rows: Record<string, unknown>[], header?: string[]) {
  return XLSX.utils.json_to_sheet(rows, header ? { header } : undefined);
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function formatTimestamp(value: string | Date | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toISOString().replace("T", " ").slice(0, 19);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const brand = searchParams.get("brand")?.trim() || "";

    const conditions: string[] = [];
    const params: string[] = [];

    if (search) {
      conditions.push(`sku ILIKE $${params.length + 1}`);
      params.push(`%${search}%`);
    }

    if (brand) {
      conditions.push(`brand = $${params.length + 1}`);
      params.push(brand);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await pool.query(
      `
        SELECT
          sku,
          article_number,
          brand,
          category,
          import_price,
          import_currency,
          custom_duty,
          conversion_rate,
          import_price_inr,
          gst_percent,
          gst_amount,
          shipping_cost,
          final_price,
          margin1_percent,
          margin1_amount,
          cost_price_halte,
          marketing_cost,
          margin2_percent,
          margin2_amount,
          selling_price,
          msp_with_gst,
          halte_selling_price,
          amazon_selling_price,
          amazon_fee_percent,
          profitability,
          profit_percent,
          last_updated
        FROM estimated_cogs
        ${whereClause}
        ORDER BY sku ASC
      `,
      params,
    );

    const workbook = XLSX.utils.book_new();
    const rows = result.rows.map((row) => ({
      SKU: row.sku,
      "Article #": row.article_number || null,
      Brand: row.brand || null,
      Category: row.category || null,
      "Import Price": row.import_price == null ? null : Number(row.import_price),
      Currency: row.import_currency || null,
      "Custom Duty (INR)": row.custom_duty == null ? null : Number(row.custom_duty),
      "Conversion Rate": row.conversion_rate == null ? null : Number(row.conversion_rate),
      "Import Price (INR)": row.import_price_inr == null ? null : Number(row.import_price_inr),
      "GST %": row.gst_percent == null ? null : Number(row.gst_percent),
      "GST Amount (INR)": row.gst_amount == null ? null : Number(row.gst_amount),
      "Shipping Cost (INR)": row.shipping_cost == null ? null : Number(row.shipping_cost),
      "Final Price (INR)": row.final_price == null ? null : Number(row.final_price),
      "Margin 1 %": row.margin1_percent == null ? null : Number(row.margin1_percent),
      "Margin 1 Amount (INR)": row.margin1_amount == null ? null : Number(row.margin1_amount),
      "Cost Price Halte (INR)": row.cost_price_halte == null ? null : Number(row.cost_price_halte),
      "Marketing Cost (INR)": row.marketing_cost == null ? null : Number(row.marketing_cost),
      "Margin 2 %": row.margin2_percent == null ? null : Number(row.margin2_percent),
      "Margin 2 Amount (INR)": row.margin2_amount == null ? null : Number(row.margin2_amount),
      "Selling Price (INR)": row.selling_price == null ? null : Number(row.selling_price),
      "MSP (INR)": row.msp_with_gst == null ? null : Number(row.msp_with_gst),
      "Halte Selling Price (INR)": row.halte_selling_price == null ? null : Number(row.halte_selling_price),
      "Amazon Selling Price (INR)": row.amazon_selling_price == null ? null : Number(row.amazon_selling_price),
      "Amazon Fee %": row.amazon_fee_percent == null ? null : Number(row.amazon_fee_percent),
      "Profitability (INR)": row.profitability == null ? null : Number(row.profitability),
      "Profit %": row.profit_percent == null ? null : Number(row.profit_percent),
      "Last Updated": formatTimestamp(row.last_updated),
    }));

    XLSX.utils.book_append_sheet(
      workbook,
      jsonSheet(rows, [
        "SKU",
        "Article #",
        "Brand",
        "Category",
        "Import Price",
        "Currency",
        "Custom Duty (INR)",
        "Conversion Rate",
        "Import Price (INR)",
        "GST %",
        "GST Amount (INR)",
        "Shipping Cost (INR)",
        "Final Price (INR)",
        "Margin 1 %",
        "Margin 1 Amount (INR)",
        "Cost Price Halte (INR)",
        "Marketing Cost (INR)",
        "Margin 2 %",
        "Margin 2 Amount (INR)",
        "Selling Price (INR)",
        "MSP (INR)",
        "Halte Selling Price (INR)",
        "Amazon Selling Price (INR)",
        "Amazon Fee %",
        "Profitability (INR)",
        "Profit %",
        "Last Updated",
      ]),
      "COGS Estimate",
    );

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const filters = [
      brand ? `brand_${sanitizeFilenamePart(brand)}` : "",
      search ? `search_${sanitizeFilenamePart(search)}` : "",
    ].filter(Boolean);
    const suffix = filters.length ? `_${filters.join("_")}` : "";
    const filename = `haltedb_cogs_estimate${suffix}_${dateStr}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("COGS Estimate report error:", error);
    return NextResponse.json(
      { error: "Failed to generate COGS Estimate report" },
      { status: 500 },
    );
  }
}
