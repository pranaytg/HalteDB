import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ensureLogicInventoryTables } from "@/lib/logicInventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AddRowBody = {
  uploadId?: number;
  sheetName?: string;
  sheetIndex?: number;
  rowData?: Record<string, string>;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as AddRowBody;
  const uploadId = Number(body.uploadId);
  const sheetName = String(body.sheetName ?? "").trim();
  const sheetIndex = Number(body.sheetIndex);

  if (!Number.isFinite(uploadId) || uploadId <= 0 || !sheetName || !Number.isFinite(sheetIndex)) {
    return NextResponse.json(
      { error: "uploadId, sheetName and sheetIndex are required." },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await ensureLogicInventoryTables(client);
    await client.query("BEGIN");

    const nextIndexResult = await client.query<{ next_index: number }>(`
      SELECT COALESCE(MAX(row_index), 0) + 1 AS next_index
      FROM logic_inventory_rows
      WHERE upload_id = $1 AND sheet_name = $2
    `, [uploadId, sheetName]);

    const nextIndex = nextIndexResult.rows[0]?.next_index ?? 1;
    const insertResult = await client.query(`
      INSERT INTO logic_inventory_rows (
        upload_id, sheet_name, sheet_index, row_index, row_data
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id, upload_id, sheet_name, sheet_index, row_index, row_data, updated_at
    `, [
      uploadId,
      sheetName,
      sheetIndex,
      nextIndex,
      JSON.stringify(body.rowData ?? {}),
    ]);

    await client.query(`
      UPDATE logic_inventory_uploads
      SET row_count = row_count + 1, updated_at = NOW()
      WHERE id = $1
    `, [uploadId]);

    await client.query("COMMIT");

    return NextResponse.json({ row: insertResult.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Logic inventory add row error:", error);
    return NextResponse.json(
      { error: "Failed to add Logic Inventory row." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
