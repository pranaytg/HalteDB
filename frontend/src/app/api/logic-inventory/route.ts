import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ensureLogicInventoryTables,
  type LogicInventorySheetMeta,
  parseLogicInventoryWorkbook,
  withDerivedConsolidatedCountDate,
  withDerivedConsolidatedCountDateForStoredRows,
} from "@/lib/logicInventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringFormValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type UploadWithSheets = {
  id: number;
  file_name: string;
  inventory_month: string | null;
  sheet_count: number;
  row_count: number;
  sheets_json: unknown;
  created_at: string;
  updated_at: string;
};

type StoredLogicInventoryRow = {
  id: number;
  upload_id: number;
  sheet_name: string;
  sheet_index: number;
  row_index: number;
  row_data: Record<string, string>;
  updated_at: string;
};

function normalizeSheetsJson(value: unknown) {
  if (typeof value === "string") return JSON.parse(value);
  return value ?? [];
}

function sheetsWithLiveCounts(value: unknown, rows: { sheet_name: string }[]): LogicInventorySheetMeta[] {
  const parsedSheets = normalizeSheetsJson(value);
  const sheets = Array.isArray(parsedSheets)
    ? parsedSheets as LogicInventorySheetMeta[]
    : [];
  const rowCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.sheet_name] = (acc[row.sheet_name] ?? 0) + 1;
    return acc;
  }, {});

  return sheets.map((sheet) => ({
    ...sheet,
    rowCount: rowCounts[sheet.name] ?? 0,
  }));
}

function normalizeRowData(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value as Record<string, string> : {};
}

export async function GET(req: NextRequest) {
  const uploadIdParam = req.nextUrl.searchParams.get("uploadId");
  const uploadId = uploadIdParam ? Number(uploadIdParam) : null;

  const client = await pool.connect();
  try {
    await ensureLogicInventoryTables(client);

    const uploadsResult = await client.query(`
      SELECT id, file_name, inventory_month, sheet_count, row_count, created_at, updated_at
      FROM logic_inventory_uploads
      ORDER BY created_at DESC
    `);

    if (uploadsResult.rows.length === 0) {
      return NextResponse.json({
        uploads: [],
        upload: null,
        sheets: [],
        rows: [],
      });
    }

    const selectedUpload = uploadId && Number.isFinite(uploadId)
      ? uploadId
      : uploadsResult.rows[0].id;

    const uploadResult = await client.query(`
      SELECT id, file_name, inventory_month, sheet_count, row_count, sheets_json, created_at, updated_at
      FROM logic_inventory_uploads
      WHERE id = $1
    `, [selectedUpload]);

    if (uploadResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Logic inventory upload not found" },
        { status: 404 },
      );
    }

    const rowsResult = await client.query(`
      SELECT id, upload_id, sheet_name, sheet_index, row_index, row_data, updated_at
      FROM logic_inventory_rows
      WHERE upload_id = $1
      ORDER BY sheet_index ASC, row_index ASC, id ASC
    `, [selectedUpload]);

    const upload = uploadResult.rows[0] as UploadWithSheets;
    const storedRows = rowsResult.rows.map((row) => ({
      ...row,
      row_data: normalizeRowData(row.row_data),
    })) as StoredLogicInventoryRow[];
    const derived = withDerivedConsolidatedCountDateForStoredRows(
      sheetsWithLiveCounts(upload.sheets_json, storedRows),
      storedRows,
      {
        inventoryMonth: upload.inventory_month,
        referenceDate: upload.created_at,
      },
    );

    return NextResponse.json({
      uploads: uploadsResult.rows,
      upload: {
        id: upload.id,
        file_name: upload.file_name,
        inventory_month: upload.inventory_month,
        sheet_count: upload.sheet_count,
        row_count: rowsResult.rows.length,
        created_at: upload.created_at,
        updated_at: upload.updated_at,
      },
      sheets: derived.sheets,
      rows: derived.rows,
    });
  } catch (error) {
    console.error("Logic inventory GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Logic Inventory data" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const filePart = form.get("file");
  const inventoryMonth = stringFormValue(form.get("inventoryMonth"));

  if (!filePart || typeof filePart === "string" || typeof filePart.arrayBuffer !== "function") {
    return NextResponse.json(
      { error: "Upload a Logic Inventory Excel file." },
      { status: 400 },
    );
  }

  const fileName = "name" in filePart ? String(filePart.name || "logic-inventory.xlsx") : "logic-inventory.xlsx";
  if (!/\.(xlsx|xls)$/i.test(fileName)) {
    return NextResponse.json(
      { error: "Logic Inventory upload must be an .xlsx or .xls file." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await filePart.arrayBuffer());
  const parsed = withDerivedConsolidatedCountDate(
    parseLogicInventoryWorkbook(buffer),
    {
      inventoryMonth,
      referenceDate: new Date(),
    },
  );

  if (parsed.rows.length === 0 || parsed.sheets.length === 0) {
    return NextResponse.json(
      { error: "No inventory rows were found in the uploaded workbook." },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await ensureLogicInventoryTables(client);
    await client.query("BEGIN");

    const uploadResult = await client.query<{ id: number }>(`
      INSERT INTO logic_inventory_uploads (
        file_name, inventory_month, sheet_count, row_count, sheets_json
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id
    `, [
      fileName,
      inventoryMonth,
      parsed.sheets.length,
      parsed.rows.length,
      JSON.stringify(parsed.sheets),
    ]);

    const uploadId = uploadResult.rows[0].id;

    for (const row of parsed.rows) {
      await client.query(`
        INSERT INTO logic_inventory_rows (
          upload_id, sheet_name, sheet_index, row_index, row_data
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `, [
        uploadId,
        row.sheetName,
        row.sheetIndex,
        row.rowIndex,
        JSON.stringify(row.rowData),
      ]);
    }

    await client.query("COMMIT");

    const upload = await client.query(`
      SELECT id, file_name, inventory_month, sheet_count, row_count, created_at, updated_at
      FROM logic_inventory_uploads
      WHERE id = $1
    `, [uploadId]);

    return NextResponse.json({
      message: `Imported ${parsed.rows.length} Logic Inventory row(s).`,
      upload: upload.rows[0],
      sheets: parsed.sheets,
      importedRows: parsed.rows.length,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Logic inventory upload error:", error);
    return NextResponse.json(
      { error: "Failed to import Logic Inventory workbook." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
