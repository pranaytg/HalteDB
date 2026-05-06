import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  BILL_LINE_INSERT_COLUMNS,
  billLineInsertValues,
  ensureCarrierBillAuditTables,
  getBillAuditSummary,
  normalizeCarrier,
  normalizeCarrierBillRows,
  parseCarrierBillRows,
  recomputeCarrierBillAudit,
} from "@/lib/shipmentBillAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringFormValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberFormValue(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(stringFormValue(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const carrier = normalizeCarrier(stringFormValue(form.get("carrier")));
  const filePart = form.get("file");
  const toleranceAmount = numberFormValue(form.get("tolerance"), 5);

  if (!carrier) {
    return NextResponse.json({ error: "Choose BlueDart or Delhivery before uploading." }, { status: 400 });
  }
  if (!filePart || typeof filePart === "string" || typeof filePart.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Upload a carrier bill file." }, { status: 400 });
  }

  const fileName = "name" in filePart ? String(filePart.name || "carrier-bill") : "carrier-bill";
  const buffer = Buffer.from(await filePart.arrayBuffer());
  const rawRows = parseCarrierBillRows(fileName, buffer);
  const parsedLines = normalizeCarrierBillRows(carrier, rawRows);

  if (parsedLines.length === 0) {
    return NextResponse.json(
      { error: "No shipment bill rows were found in the uploaded file." },
      { status: 400 },
    );
  }

  const invoiceNumber = stringFormValue(form.get("invoiceNumber"))
    ?? parsedLines.find((line) => line.invoice_number)?.invoice_number
    ?? null;
  const invoiceDate = stringFormValue(form.get("invoiceDate"))
    ?? parsedLines.find((line) => line.invoice_date)?.invoice_date
    ?? null;
  const billingPeriod = stringFormValue(form.get("billingPeriod"));

  const lines = parsedLines.map((line) => ({
    ...line,
    invoice_number: line.invoice_number ?? invoiceNumber,
    invoice_date: line.invoice_date ?? invoiceDate,
  }));

  const client = await pool.connect();
  try {
    await ensureCarrierBillAuditTables(client);
    await client.query("BEGIN");

    const uploadResult = await client.query<{ id: number }>(`
      INSERT INTO carrier_bill_uploads (
        carrier, invoice_number, invoice_date, billing_period, file_name, row_count
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [carrier, invoiceNumber, invoiceDate, billingPeriod, fileName, lines.length]);
    const uploadId = uploadResult.rows[0].id;

    const placeholders = BILL_LINE_INSERT_COLUMNS.map((_, index) => `$${index + 1}`).join(", ");
    const columns = BILL_LINE_INSERT_COLUMNS.join(", ");
    for (const line of lines) {
      await client.query(
        `INSERT INTO carrier_bill_lines (${columns}) VALUES (${placeholders})`,
        billLineInsertValues(uploadId, line),
      );
    }

    await recomputeCarrierBillAudit(client, uploadId, toleranceAmount);
    await client.query("COMMIT");

    const upload = await client.query(`
      SELECT *
      FROM carrier_bill_uploads
      WHERE id = $1
    `, [uploadId]);
    const summary = await getBillAuditSummary(client, { uploadId, carrier });

    return NextResponse.json({
      message: `Imported ${lines.length} ${carrier} bill row(s).`,
      upload: upload.rows[0],
      summary,
      parsedRows: rawRows.length,
      importedLines: lines.length,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Carrier bill upload error:", error);
    return NextResponse.json({ error: "Failed to import carrier bill." }, { status: 500 });
  } finally {
    client.release();
  }
}
