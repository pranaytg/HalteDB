import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ensureLogicInventoryTables } from "@/lib/logicInventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateRowBody = {
  rowData?: Record<string, string>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rowId = Number(id);
  const body = await req.json().catch(() => ({})) as UpdateRowBody;

  if (!Number.isFinite(rowId) || rowId <= 0 || !body.rowData || typeof body.rowData !== "object") {
    return NextResponse.json(
      { error: "A valid row id and rowData object are required." },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await ensureLogicInventoryTables(client);
    const result = await client.query(`
      UPDATE logic_inventory_rows
      SET row_data = $1::jsonb, updated_at = NOW()
      WHERE id = $2
      RETURNING id, upload_id, sheet_name, sheet_index, row_index, row_data, updated_at
    `, [JSON.stringify(body.rowData), rowId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Logic Inventory row not found." },
        { status: 404 },
      );
    }

    await client.query(`
      UPDATE logic_inventory_uploads
      SET updated_at = NOW()
      WHERE id = $1
    `, [result.rows[0].upload_id]);

    return NextResponse.json({ row: result.rows[0] });
  } catch (error) {
    console.error("Logic inventory row update error:", error);
    return NextResponse.json(
      { error: "Failed to update Logic Inventory row." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const rowId = Number(id);

  if (!Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json(
      { error: "A valid row id is required." },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await ensureLogicInventoryTables(client);
    await client.query("BEGIN");

    const deleted = await client.query<{ upload_id: number }>(`
      DELETE FROM logic_inventory_rows
      WHERE id = $1
      RETURNING upload_id
    `, [rowId]);

    if (deleted.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Logic Inventory row not found." },
        { status: 404 },
      );
    }

    await client.query(`
      UPDATE logic_inventory_uploads
      SET row_count = GREATEST(row_count - 1, 0), updated_at = NOW()
      WHERE id = $1
    `, [deleted.rows[0].upload_id]);

    await client.query("COMMIT");

    return NextResponse.json({ deleted: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Logic inventory row delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete Logic Inventory row." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
