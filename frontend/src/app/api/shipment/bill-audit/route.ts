import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  BILL_STATUSES,
  BillCarrier,
  ensureCarrierBillAuditTables,
  getBillAuditSummary,
  normalizeCarrier,
} from "@/lib/shipmentBillAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parsePositiveInt(searchParams.get("limit"), 50), 200);
  const offset = parseNonNegativeInt(searchParams.get("offset"), 0);
  const uploadId = parsePositiveInt(searchParams.get("uploadId"), 0) || undefined;
  const carrier = normalizeCarrier(searchParams.get("carrier")) ?? undefined;
  const statusParam = searchParams.get("status") || "";
  const status = BILL_STATUSES.includes(statusParam as (typeof BILL_STATUSES)[number])
    ? statusParam
    : "";
  const search = (searchParams.get("search") || "").trim();

  const client = await pool.connect();
  try {
    await ensureCarrierBillAuditTables(client);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (uploadId) {
      conditions.push(`l.upload_id = $${idx++}`);
      params.push(uploadId);
    }
    if (carrier) {
      conditions.push(`l.carrier = $${idx++}`);
      params.push(carrier);
    }
    if (status) {
      conditions.push(`l.audit_status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(
        l.awb_number ILIKE $${idx}
        OR l.order_ref ILIKE $${idx}
        OR l.matched_amazon_order_id ILIKE $${idx}
        OR l.matched_sku ILIKE $${idx}
        OR l.destination_pincode ILIKE $${idx}
      )`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    const countResult = await client.query<{ total: string }>(`
      SELECT COUNT(*) AS total
      FROM carrier_bill_lines l
      ${where}
    `, countParams);

    params.push(limit, offset);
    const linesResult = await client.query(`
      SELECT
        l.id,
        l.upload_id,
        l.carrier,
        l.invoice_number,
        l.invoice_date,
        l.ship_date,
        l.awb_number,
        l.order_ref,
        l.origin_area,
        l.destination_area,
        l.destination_pincode,
        l.service_type,
        l.commodity,
        l.actual_weight_kg,
        l.charged_weight_kg,
        l.freight_amount,
        l.fuel_surcharge,
        l.other_charges,
        l.tax_amount,
        l.actual_billed_amount,
        l.matched_amazon_order_id,
        l.matched_sku,
        l.match_confidence,
        l.match_method,
        l.proposed_amount,
        l.variance_amount,
        l.variance_percent,
        l.audit_status,
        l.notes,
        u.file_name,
        u.billing_period,
        o.item_price,
        o.purchase_date,
        o.order_status,
        o.ship_city,
        o.ship_state,
        se.delhivery_cost,
        se.bluedart_cost,
        se.chargeable_weight_kg AS proposed_weight_kg
      FROM carrier_bill_lines l
      JOIN carrier_bill_uploads u ON u.id = l.upload_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM orders o_inner
        WHERE o_inner.amazon_order_id = l.matched_amazon_order_id
          AND (l.matched_sku IS NULL OR o_inner.sku = l.matched_sku)
        ORDER BY CASE WHEN o_inner.sku = l.matched_sku THEN 0 ELSE 1 END, o_inner.purchase_date DESC NULLS LAST
        LIMIT 1
      ) o ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM shipment_estimates se_inner
        WHERE se_inner.amazon_order_id = l.matched_amazon_order_id
          AND (l.matched_sku IS NULL OR se_inner.sku = l.matched_sku)
        ORDER BY CASE WHEN se_inner.sku = l.matched_sku THEN 0 ELSE 1 END, se_inner.estimated_at DESC NULLS LAST
        LIMIT 1
      ) se ON true
      ${where}
      ORDER BY
        CASE l.audit_status
          WHEN 'overcharged' THEN 0
          WHEN 'missing_proposed' THEN 1
          WHEN 'unmatched' THEN 2
          WHEN 'undercharged' THEN 3
          ELSE 4
        END,
        ABS(COALESCE(l.variance_amount, 0)) DESC,
        l.id DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);

    const uploadsResult = await client.query(`
      SELECT
        id,
        carrier,
        invoice_number,
        invoice_date,
        billing_period,
        file_name,
        row_count,
        matched_count,
        overcharged_count,
        total_actual,
        total_proposed,
        total_variance,
        created_at
      FROM carrier_bill_uploads
      ORDER BY created_at DESC
      LIMIT 30
    `);

    const summary = await getBillAuditSummary(client, {
      uploadId,
      carrier: carrier as BillCarrier | undefined,
    });

    return NextResponse.json({
      lines: linesResult.rows,
      uploads: uploadsResult.rows,
      summary,
      pagination: {
        total: Number(countResult.rows[0]?.total || 0),
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Carrier bill audit API error:", error);
    return NextResponse.json({ error: "Failed to fetch carrier bill audit." }, { status: 500 });
  } finally {
    client.release();
  }
}
