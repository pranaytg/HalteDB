import type { PoolClient } from "pg";
import * as XLSX from "xlsx";

export type BillCarrier = "bluedart" | "delhivery";

type BillRow = Record<string, unknown>;
type Queryable = Pick<PoolClient, "query">;

export interface NormalizedCarrierBillLine {
  carrier: BillCarrier;
  invoice_number: string | null;
  invoice_date: string | null;
  ship_date: string | null;
  awb_number: string | null;
  order_ref: string | null;
  origin_area: string | null;
  destination_area: string | null;
  destination_pincode: string | null;
  service_type: string | null;
  commodity: string | null;
  actual_weight_kg: number | null;
  charged_weight_kg: number | null;
  pieces: number | null;
  freight_amount: number | null;
  fuel_surcharge: number | null;
  other_charges: number | null;
  tax_amount: number | null;
  declared_value: number | null;
  actual_billed_amount: number;
  raw_row_json: BillRow;
}

export const BILL_STATUSES = [
  "overcharged",
  "missing_proposed",
  "unmatched",
  "undercharged",
  "ok",
] as const;

export function normalizeCarrier(value: string | null | undefined): BillCarrier | null {
  const carrier = String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (carrier.includes("blue")) return "bluedart";
  if (carrier.includes("delhivery")) return "delhivery";
  return null;
}

export function carrierLabel(carrier: BillCarrier | string | null | undefined) {
  if (carrier === "bluedart") return "BlueDart";
  if (carrier === "delhivery") return "Delhivery";
  return carrier || "";
}

export async function ensureCarrierBillAuditTables(db: Queryable) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS carrier_bill_uploads (
      id SERIAL PRIMARY KEY,
      carrier TEXT NOT NULL,
      invoice_number TEXT,
      invoice_date DATE,
      billing_period TEXT,
      file_name TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0,
      overcharged_count INTEGER NOT NULL DEFAULT 0,
      total_actual NUMERIC(14, 2) NOT NULL DEFAULT 0,
      total_proposed NUMERIC(14, 2) NOT NULL DEFAULT 0,
      total_variance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS order_shipment_refs (
      id SERIAL PRIMARY KEY,
      amazon_order_id TEXT NOT NULL,
      sku TEXT,
      carrier TEXT,
      awb_number TEXT,
      order_ref TEXT,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (carrier, awb_number)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS carrier_bill_lines (
      id BIGSERIAL PRIMARY KEY,
      upload_id INTEGER NOT NULL REFERENCES carrier_bill_uploads(id) ON DELETE CASCADE,
      carrier TEXT NOT NULL,
      invoice_number TEXT,
      invoice_date DATE,
      ship_date DATE,
      awb_number TEXT,
      order_ref TEXT,
      origin_area TEXT,
      destination_area TEXT,
      destination_pincode TEXT,
      service_type TEXT,
      commodity TEXT,
      actual_weight_kg NUMERIC(10, 3),
      charged_weight_kg NUMERIC(10, 3),
      pieces INTEGER,
      freight_amount NUMERIC(14, 2),
      fuel_surcharge NUMERIC(14, 2),
      other_charges NUMERIC(14, 2),
      tax_amount NUMERIC(14, 2),
      declared_value NUMERIC(14, 2),
      actual_billed_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      raw_row_json JSONB,
      matched_amazon_order_id TEXT,
      matched_sku TEXT,
      match_confidence NUMERIC(5, 2),
      match_method TEXT,
      proposed_amount NUMERIC(14, 2),
      variance_amount NUMERIC(14, 2),
      variance_percent NUMERIC(8, 2),
      audit_status TEXT NOT NULL DEFAULT 'unmatched',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS ix_carrier_bill_uploads_created ON carrier_bill_uploads (created_at DESC)");
  await db.query("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_upload ON carrier_bill_lines (upload_id)");
  await db.query("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_carrier_status ON carrier_bill_lines (carrier, audit_status)");
  await db.query("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_awb ON carrier_bill_lines (awb_number)");
  await db.query("CREATE INDEX IF NOT EXISTS ix_carrier_bill_lines_order_ref ON carrier_bill_lines (order_ref)");
  await db.query("CREATE INDEX IF NOT EXISTS ix_order_shipment_refs_order ON order_shipment_refs (amazon_order_id, sku)");
}

export function parseCarrierBillRows(fileName: string, buffer: Buffer): BillRow[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    cellText: true,
    dateNF: "yyyy-mm-dd",
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<BillRow>(sheet, {
    defval: null,
    raw: false,
    blankrows: false,
  }).filter((row) => Object.values(row).some((value) => cleanText(value) != null));
}

export function normalizeCarrierBillRows(carrier: BillCarrier, rows: BillRow[]) {
  return rows
    .map((row) => normalizeCarrierBillRow(carrier, row))
    .filter((line): line is NormalizedCarrierBillLine => {
      if (!line) return false;
      return line.actual_billed_amount > 0 || line.awb_number != null || line.order_ref != null;
    });
}

function normalizeCarrierBillRow(carrier: BillCarrier, row: BillRow): NormalizedCarrierBillLine | null {
  if (carrier === "bluedart") return normalizeBlueDartRow(row);
  return normalizeDelhiveryRow(row);
}

function normalizeBlueDartRow(row: BillRow): NormalizedCarrierBillLine {
  const freight = numberFrom(row, ["NFREIGHT", "Freight"]);
  const fuel = numberFrom(row, ["NFSAMT", "Fuel Surcharge", "Fuel"]);
  const total = numberFrom(row, ["NTOTAMOUNT", "Total Amount", "Bill Amount"]) ?? 0;
  const serviceParts = [
    textFrom(row, ["CPRODCODE", "Product Code"]),
    textFrom(row, ["CPRODTYPE", "Product Type"]),
  ].filter(Boolean);

  return {
    carrier: "bluedart",
    invoice_number: textFrom(row, ["CINVOICENBR", "Invoice Number"]),
    invoice_date: dateFrom(row, ["DINVDATE", "Invoice Date"]),
    ship_date: dateFrom(row, ["DBATCHDT", "Batch Date", "Ship Date"]),
    awb_number: textFrom(row, ["CAWBNO", "AWB", "AWB No", "Waybill"]),
    order_ref: textFrom(row, ["CCRCRDREF", "Reference", "Order Ref", "Order Id"]),
    origin_area: textFrom(row, ["CORGAREA", "Origin"]),
    destination_area: textFrom(row, ["CDSTAREA", "Destination"]),
    destination_pincode: normalizePincode(textFrom(row, ["DESTPINCODE", "Destination Pincode"])),
    service_type: serviceParts.length ? serviceParts.join(" / ") : null,
    commodity: textFrom(row, ["COMMODITY", "Commodity"]),
    actual_weight_kg: numberFrom(row, ["NACTWGT", "Actual Weight"]),
    charged_weight_kg: numberFrom(row, ["NCHRGWT", "Charged Weight", "Chargeable Weight"]),
    pieces: integerFrom(row, ["NPCS", "Pieces", "Pcs"]),
    freight_amount: freight,
    fuel_surcharge: fuel,
    other_charges: sumBlueDartOtherCharges(row),
    tax_amount: null,
    declared_value: numberFrom(row, ["NDECLVAL", "Declared Value"]),
    actual_billed_amount: roundMoney(total),
    raw_row_json: row,
  };
}

function normalizeDelhiveryRow(row: BillRow): NormalizedCarrierBillLine {
  const freight = numberFrom(row, [
    "Freight",
    "Freight Charge",
    "Forward Charges",
    "Shipping Charge",
    "Base Freight",
  ]);
  const fuel = numberFrom(row, ["Fuel Surcharge", "FSC", "Fuel"]);
  const tax = numberFrom(row, ["GST", "IGST", "CGST+SGST", "Tax Amount", "Total Tax"]);
  const total = numberFrom(row, [
    "Total Amount",
    "Total Charge",
    "Charged Amount",
    "Billing Amount",
    "Bill Amount",
    "Net Amount",
    "Invoice Amount",
    "Amount",
  ]);
  const otherCharges = genericOtherChargeSum(row);
  const fallbackTotal = (freight ?? 0) + (fuel ?? 0) + (tax ?? 0) + (otherCharges ?? 0);

  return {
    carrier: "delhivery",
    invoice_number: textFrom(row, ["Invoice Number", "Invoice No", "Bill Number"]),
    invoice_date: dateFrom(row, ["Invoice Date", "Bill Date"]),
    ship_date: dateFrom(row, ["Ship Date", "Pickup Date", "Dispatch Date", "Manifest Date", "Date"]),
    awb_number: textFrom(row, ["AWB", "AWB No", "Waybill", "Waybill No", "LRN", "Tracking Number"]),
    order_ref: textFrom(row, ["Order Id", "Order ID", "Reference", "Client Reference", "Seller Reference", "Ref No"]),
    origin_area: textFrom(row, ["Origin", "Origin City", "Pickup City"]),
    destination_area: textFrom(row, ["Destination", "Destination City", "Consignee City", "Drop City"]),
    destination_pincode: normalizePincode(textFrom(row, ["Destination Pincode", "Dest Pincode", "Pincode", "Pin Code"])),
    service_type: textFrom(row, ["Service", "Service Type", "Product Type", "Mode"]),
    commodity: textFrom(row, ["Commodity", "Item", "Product"]),
    actual_weight_kg: numberFrom(row, ["Actual Weight", "Dead Weight", "Weight"]),
    charged_weight_kg: numberFrom(row, ["Charged Weight", "Chargeable Weight", "Billing Weight"]),
    pieces: integerFrom(row, ["Pieces", "Pcs", "Quantity"]),
    freight_amount: freight,
    fuel_surcharge: fuel,
    other_charges: otherCharges,
    tax_amount: tax,
    declared_value: numberFrom(row, ["Declared Value", "Invoice Value", "Shipment Value"]),
    actual_billed_amount: roundMoney(total ?? fallbackTotal),
    raw_row_json: row,
  };
}

const BLUE_DART_OTHER_CHARGE_COLUMNS = [
  "NCAFAMT",
  "NADDISRCHG",
  "NAWBFEES",
  "NCOMVAL",
  "NDCCHRG",
  "NDGRCHGS",
  "NDICHARGE",
  "NDLCHARGE",
  "NDLRETCHRG",
  "NDOCCHRG",
  "NDODAMT",
  "NDVCHARGE",
  "NECCCHGS",
  "NELRSKCHGS",
  "NFODCHRG",
  "NGOGREENCHGS",
  "NHVPCCHGS",
  "NIDCCHGS",
  "NMISCCHG1",
  "NNEWRAS",
  "NODACHRG",
  "NOHSCHGS",
  "NOWSPCHGS",
  "NPCKCANCHG",
  "NPKGCHARGE",
  "NRESTDSTCHGS",
  "NRISKHCHGS",
  "NTDDCHRG",
  "NVALCHGS",
  "NTOPAYAMT",
  "DBA_CHARGE",
  "INTLVAS",
  "OTP_CHARGE",
  "DEMAND_CHARGE",
];

function sumBlueDartOtherCharges(row: BillRow) {
  const total = BLUE_DART_OTHER_CHARGE_COLUMNS.reduce((sum, key) => {
    return sum + (numberFrom(row, [key]) ?? 0);
  }, 0);
  return total > 0 ? roundMoney(total) : null;
}

function genericOtherChargeSum(row: BillRow) {
  const aliases = [
    "COD Charge",
    "RTO Charge",
    "ODA Charge",
    "Handling Charge",
    "Docket Charge",
    "VAS Charge",
    "Other Charge",
    "Other Charges",
    "Misc Charge",
    "Surcharge",
  ];
  const total = aliases.reduce((sum, alias) => sum + (numberFrom(row, [alias]) ?? 0), 0);
  return total > 0 ? roundMoney(total) : null;
}

function textFrom(row: BillRow, aliases: string[]) {
  return cleanText(valueFrom(row, aliases));
}

function numberFrom(row: BillRow, aliases: string[]) {
  return parseNumber(valueFrom(row, aliases));
}

function integerFrom(row: BillRow, aliases: string[]) {
  const value = numberFrom(row, aliases);
  return value == null ? null : Math.round(value);
}

function dateFrom(row: BillRow, aliases: string[]) {
  return parseDate(valueFrom(row, aliases));
}

function valueFrom(row: BillRow, aliases: string[]) {
  const entries = Object.entries(row);
  const normalizedEntries = entries.map(([key, value]) => [normalizeKey(key), value] as const);
  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    const exact = normalizedEntries.find(([key]) => key === normalizedAlias);
    if (exact) return exact[1];
  }
  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    if (normalizedAlias.length < 5) continue;
    const partial = normalizedEntries.find(([key]) => key.includes(normalizedAlias));
    if (partial) return partial[1];
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = typeof value === "number" && Number.isInteger(value)
    ? String(value)
    : String(value).trim();
  if (!text || text.toLowerCase() === "null" || text === "-") return null;
  return text.replace(/\.0$/, "");
}

function normalizePincode(value: string | null) {
  const pin = String(value ?? "").replace(/\D/g, "").slice(0, 6);
  return pin.length === 6 ? pin : null;
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value)
    .replace(/,/g, "")
    .replace(/[₹\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .trim();
  if (!text || text === "-") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const slashDate = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (slashDate) {
    const first = Number(slashDate[1]);
    const second = Number(slashDate[2]);
    const year = slashDate[3].length === 2 ? `20${slashDate[3]}` : slashDate[3];
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export const BILL_LINE_INSERT_COLUMNS = [
  "upload_id",
  "carrier",
  "invoice_number",
  "invoice_date",
  "ship_date",
  "awb_number",
  "order_ref",
  "origin_area",
  "destination_area",
  "destination_pincode",
  "service_type",
  "commodity",
  "actual_weight_kg",
  "charged_weight_kg",
  "pieces",
  "freight_amount",
  "fuel_surcharge",
  "other_charges",
  "tax_amount",
  "declared_value",
  "actual_billed_amount",
  "raw_row_json",
] as const;

export function billLineInsertValues(uploadId: number, line: NormalizedCarrierBillLine) {
  return [
    uploadId,
    line.carrier,
    line.invoice_number,
    line.invoice_date,
    line.ship_date,
    line.awb_number,
    line.order_ref,
    line.origin_area,
    line.destination_area,
    line.destination_pincode,
    line.service_type,
    line.commodity,
    line.actual_weight_kg,
    line.charged_weight_kg,
    line.pieces,
    line.freight_amount,
    line.fuel_surcharge,
    line.other_charges,
    line.tax_amount,
    line.declared_value,
    line.actual_billed_amount,
    JSON.stringify(line.raw_row_json),
  ];
}

export async function recomputeCarrierBillAudit(db: Queryable, uploadId: number, toleranceAmount: number) {
  await db.query(`
    UPDATE carrier_bill_lines
    SET
      matched_amazon_order_id = NULL,
      matched_sku = NULL,
      match_confidence = NULL,
      match_method = NULL,
      proposed_amount = NULL,
      variance_amount = NULL,
      variance_percent = NULL,
      audit_status = 'unmatched',
      notes = NULL
    WHERE upload_id = $1
  `, [uploadId]);

  await db.query(`
    WITH candidates AS (
      SELECT
        l.id,
        r.amazon_order_id,
        r.sku,
        ROW_NUMBER() OVER (
          PARTITION BY l.id
          ORDER BY CASE WHEN r.sku IS NULL THEN 1 ELSE 0 END, r.created_at DESC
        ) AS rn
      FROM carrier_bill_lines l
      JOIN order_shipment_refs r
        ON r.carrier = l.carrier
       AND l.awb_number IS NOT NULL
       AND regexp_replace(lower(COALESCE(r.awb_number, '')), '[^a-z0-9]', '', 'g')
         = regexp_replace(lower(COALESCE(l.awb_number, '')), '[^a-z0-9]', '', 'g')
      WHERE l.upload_id = $1
    )
    UPDATE carrier_bill_lines l
    SET
      matched_amazon_order_id = c.amazon_order_id,
      matched_sku = c.sku,
      match_confidence = 1.00,
      match_method = 'awb',
      notes = 'Matched through saved AWB reference'
    FROM candidates c
    WHERE l.id = c.id AND c.rn = 1
  `, [uploadId]);

  await db.query(`
    WITH bill_refs AS (
      SELECT
        id,
        regexp_replace(lower(COALESCE(order_ref, '')), '[^a-z0-9]', '', 'g') AS normalized_ref
      FROM carrier_bill_lines
      WHERE upload_id = $1
        AND matched_amazon_order_id IS NULL
        AND order_ref IS NOT NULL
    ),
    candidates AS (
      SELECT
        l.id,
        o.amazon_order_id,
        o.sku,
        COUNT(*) OVER (PARTITION BY l.id) AS candidate_count,
        ROW_NUMBER() OVER (
          PARTITION BY l.id
          ORDER BY
            CASE WHEN regexp_replace(COALESCE(o.ship_postal_code, ''), '\\D', '', 'g') = COALESCE(bl.destination_pincode, '') THEN 0 ELSE 1 END,
            ABS(EXTRACT(EPOCH FROM (COALESCE(o.purchase_date, NOW()) - COALESCE(bl.ship_date::timestamp, COALESCE(o.purchase_date, NOW()))))),
            o.purchase_date DESC NULLS LAST
        ) AS rn
      FROM bill_refs l
      JOIN carrier_bill_lines bl ON bl.id = l.id
      JOIN orders o
        ON l.normalized_ref <> ''
       AND (
          l.normalized_ref = regexp_replace(lower(COALESCE(o.amazon_order_id, '')), '[^a-z0-9]', '', 'g')
          OR (
            length(l.normalized_ref) >= 8
            AND (
              l.normalized_ref LIKE '%' || regexp_replace(lower(COALESCE(o.amazon_order_id, '')), '[^a-z0-9]', '', 'g') || '%'
              OR regexp_replace(lower(COALESCE(o.amazon_order_id, '')), '[^a-z0-9]', '', 'g') LIKE '%' || l.normalized_ref || '%'
            )
          )
       )
    )
    UPDATE carrier_bill_lines l
    SET
      matched_amazon_order_id = c.amazon_order_id,
      matched_sku = c.sku,
      match_confidence = CASE WHEN c.candidate_count = 1 THEN 0.95 ELSE 0.80 END,
      match_method = 'order_ref',
      notes = CASE
        WHEN c.candidate_count = 1 THEN 'Matched by bill reference'
        ELSE 'Matched by bill reference; multiple order rows existed'
      END
    FROM candidates c
    WHERE l.id = c.id AND c.rn = 1
  `, [uploadId]);

  await db.query(`
    WITH candidates AS (
      SELECT
        l.id,
        o.amazon_order_id,
        o.sku,
        COUNT(*) OVER (PARTITION BY l.id) AS candidate_count,
        ROW_NUMBER() OVER (
          PARTITION BY l.id
          ORDER BY
            ABS(EXTRACT(EPOCH FROM (COALESCE(o.purchase_date, NOW()) - COALESCE(l.ship_date::timestamp, COALESCE(o.purchase_date, NOW()))))),
            ABS(COALESCE(l.charged_weight_kg, se.chargeable_weight_kg, 0) - COALESCE(se.chargeable_weight_kg, l.charged_weight_kg, 0)),
            o.purchase_date DESC NULLS LAST
        ) AS rn
      FROM carrier_bill_lines l
      JOIN orders o
        ON regexp_replace(COALESCE(o.ship_postal_code, ''), '\\D', '', 'g') = COALESCE(l.destination_pincode, '')
      LEFT JOIN shipment_estimates se
        ON se.amazon_order_id = o.amazon_order_id AND se.sku = o.sku
      WHERE l.upload_id = $1
        AND l.matched_amazon_order_id IS NULL
        AND l.destination_pincode IS NOT NULL
        AND l.ship_date IS NOT NULL
        AND o.purchase_date IS NOT NULL
        AND (o.purchase_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN l.ship_date - INTERVAL '14 days' AND l.ship_date + INTERVAL '14 days'
        AND CASE
          WHEN l.carrier = 'delhivery' THEN COALESCE(se.delhivery_cost, 0)
          WHEN l.carrier = 'bluedart' THEN COALESCE(se.bluedart_cost, 0)
          ELSE 0
        END > 0
        AND (
          l.charged_weight_kg IS NULL
          OR se.chargeable_weight_kg IS NULL
          OR ABS(l.charged_weight_kg - se.chargeable_weight_kg) <= GREATEST(0.25, se.chargeable_weight_kg * 0.35)
        )
    )
    UPDATE carrier_bill_lines l
    SET
      matched_amazon_order_id = c.amazon_order_id,
      matched_sku = c.sku,
      match_confidence = 0.55,
      match_method = 'pincode_date_weight',
      notes = 'Low-confidence unique match by pincode, date and weight'
    FROM candidates c
    WHERE l.id = c.id AND c.rn = 1 AND c.candidate_count = 1
  `, [uploadId]);

  await db.query(`
    WITH proposed_candidates AS (
      SELECT
        l.id,
        CASE
          WHEN l.carrier = 'delhivery' THEN se.delhivery_cost
          WHEN l.carrier = 'bluedart' THEN se.bluedart_cost
          ELSE NULL
        END AS proposed_amount,
        ROW_NUMBER() OVER (
          PARTITION BY l.id
          ORDER BY CASE WHEN se.sku = l.matched_sku THEN 0 ELSE 1 END, se.estimated_at DESC NULLS LAST
        ) AS rn
      FROM carrier_bill_lines l
      LEFT JOIN shipment_estimates se
        ON se.amazon_order_id = l.matched_amazon_order_id
       AND (l.matched_sku IS NULL OR se.sku = l.matched_sku)
      WHERE l.upload_id = $1
    )
    UPDATE carrier_bill_lines l
    SET proposed_amount = ROUND(p.proposed_amount::numeric, 2)
    FROM proposed_candidates p
    WHERE l.id = p.id AND p.rn = 1
  `, [uploadId]);

  await db.query(`
    UPDATE carrier_bill_lines
    SET
      variance_amount = CASE
        WHEN proposed_amount IS NOT NULL AND proposed_amount > 0
        THEN ROUND((actual_billed_amount - proposed_amount)::numeric, 2)
        ELSE NULL
      END,
      variance_percent = CASE
        WHEN proposed_amount IS NOT NULL AND proposed_amount > 0
        THEN ROUND(((actual_billed_amount - proposed_amount) / NULLIF(proposed_amount, 0) * 100)::numeric, 2)
        ELSE NULL
      END,
      audit_status = CASE
        WHEN matched_amazon_order_id IS NULL THEN 'unmatched'
        WHEN proposed_amount IS NULL OR proposed_amount <= 0 THEN 'missing_proposed'
        WHEN actual_billed_amount - proposed_amount > $2 THEN 'overcharged'
        WHEN proposed_amount - actual_billed_amount > $2 THEN 'undercharged'
        ELSE 'ok'
      END,
      notes = CASE
        WHEN matched_amazon_order_id IS NULL THEN 'No confident order match found'
        WHEN proposed_amount IS NULL OR proposed_amount <= 0 THEN 'Matched, but proposed carrier quote is missing'
        WHEN actual_billed_amount - proposed_amount > $2 THEN 'Actual bill is higher than proposed quote'
        WHEN proposed_amount - actual_billed_amount > $2 THEN 'Actual bill is lower than proposed quote'
        ELSE COALESCE(notes, 'Within tolerance')
      END
    WHERE upload_id = $1
  `, [uploadId, toleranceAmount]);

  await refreshUploadSummary(db, uploadId);
}

export async function refreshUploadSummary(db: Queryable, uploadId: number) {
  await db.query(`
    WITH summary AS (
      SELECT
        upload_id,
        COUNT(*)::integer AS row_count,
        COUNT(*) FILTER (WHERE matched_amazon_order_id IS NOT NULL)::integer AS matched_count,
        COUNT(*) FILTER (WHERE audit_status = 'overcharged')::integer AS overcharged_count,
        COALESCE(SUM(actual_billed_amount), 0)::numeric AS total_actual,
        COALESCE(SUM(proposed_amount), 0)::numeric AS total_proposed,
        COALESCE(SUM(variance_amount), 0)::numeric AS total_variance
      FROM carrier_bill_lines
      WHERE upload_id = $1
      GROUP BY upload_id
    )
    UPDATE carrier_bill_uploads u
    SET
      row_count = s.row_count,
      matched_count = s.matched_count,
      overcharged_count = s.overcharged_count,
      total_actual = ROUND(s.total_actual, 2),
      total_proposed = ROUND(s.total_proposed, 2),
      total_variance = ROUND(s.total_variance, 2)
    FROM summary s
    WHERE u.id = s.upload_id
  `, [uploadId]);
}

export async function getBillAuditSummary(db: Queryable, filters: {
  uploadId?: number;
  carrier?: BillCarrier;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.uploadId) {
    conditions.push(`upload_id = $${idx++}`);
    params.push(filters.uploadId);
  }
  if (filters.carrier) {
    conditions.push(`carrier = $${idx++}`);
    params.push(filters.carrier);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query(`
    SELECT
      COUNT(*)::integer AS total_lines,
      COUNT(*) FILTER (WHERE matched_amazon_order_id IS NOT NULL)::integer AS matched_lines,
      COUNT(*) FILTER (WHERE audit_status = 'overcharged')::integer AS overcharged_lines,
      COUNT(*) FILTER (WHERE audit_status = 'missing_proposed')::integer AS missing_proposed_lines,
      COUNT(*) FILTER (WHERE audit_status = 'unmatched')::integer AS unmatched_lines,
      COUNT(*) FILTER (WHERE audit_status = 'undercharged')::integer AS undercharged_lines,
      COUNT(*) FILTER (WHERE audit_status = 'ok')::integer AS ok_lines,
      COALESCE(ROUND(SUM(actual_billed_amount)::numeric, 2), 0) AS total_actual,
      COALESCE(ROUND(SUM(proposed_amount)::numeric, 2), 0) AS total_proposed,
      COALESCE(ROUND(SUM(GREATEST(COALESCE(variance_amount, 0), 0))::numeric, 2), 0) AS total_overcharge,
      COALESCE(ROUND(SUM(variance_amount)::numeric, 2), 0) AS net_variance
    FROM carrier_bill_lines
    ${where}
  `, params);
  return result.rows[0] ?? {};
}
