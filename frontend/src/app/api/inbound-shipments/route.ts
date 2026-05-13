import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*)::int                                                       AS total,
        COUNT(*) FILTER (WHERE shipment_status = 'WORKING')::int            AS working,
        COUNT(*) FILTER (WHERE shipment_status = 'SHIPPED')::int            AS shipped,
        COUNT(*) FILTER (WHERE shipment_status = 'IN_TRANSIT')::int         AS in_transit,
        COUNT(*) FILTER (WHERE shipment_status = 'DELIVERED')::int          AS delivered,
        COUNT(*) FILTER (WHERE shipment_status = 'CHECKED_IN')::int         AS checked_in,
        COUNT(*) FILTER (WHERE shipment_status = 'RECEIVING')::int          AS receiving,
        MAX(booked_date)                                                    AS latest_booked,
        MIN(booked_date) FILTER (WHERE shipment_status IN ('WORKING','SHIPPED','IN_TRANSIT','RECEIVING'))
                                                                            AS earliest_active_booked,
        MAX(last_synced)                                                    AS last_synced
      FROM inbound_shipments
    `);

    let quantityLastSynced: string | null = null;
    let syncError: string | null = null;
    try {
      const meta = await pool.query(`
        SELECT last_inbound_shipments_sync, last_inbound_shipments_error
        FROM sync_meta
        WHERE id = 1
      `);
      quantityLastSynced = meta.rows[0]?.last_inbound_shipments_sync || null;
      syncError = meta.rows[0]?.last_inbound_shipments_error || null;
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : null;
      if (code !== "42703" && code !== "42P01") {
        throw error;
      }
      console.warn("Inbound sync metadata is unavailable; treating inbound quantities as stale.");
    }
    const quantityLastSyncedMs = quantityLastSynced ? new Date(quantityLastSynced).getTime() : Number.NaN;
    const isStale =
      !quantityLastSynced ||
      Number.isNaN(quantityLastSyncedMs) ||
      quantityLastSyncedMs < Date.now() - 24 * 60 * 60 * 1000 ||
      Boolean(syncError);

    const byStatus = await pool.query(`
      SELECT shipment_status, COUNT(*)::int AS count
      FROM inbound_shipments
      GROUP BY shipment_status
      ORDER BY count DESC
    `);

    const byFc = await pool.query(`
      SELECT destination_fc, COUNT(*)::int AS count
      FROM inbound_shipments
      GROUP BY destination_fc
      ORDER BY count DESC
    `);

    const shipments = await pool.query(`
      SELECT shipment_id, shipment_name, destination_fc, shipment_status,
             booked_date, ship_from_city, ship_from_state, last_synced
      FROM inbound_shipments
      ORDER BY booked_date DESC NULLS LAST, shipment_id
    `);

    return NextResponse.json({
      summary: summary.rows[0]
        ? {
            ...summary.rows[0],
            quantity_last_synced: quantityLastSynced,
            sync_error: syncError,
            is_stale: isStale,
          }
        : null,
      byStatus: byStatus.rows,
      byFc: byFc.rows,
      shipments: shipments.rows,
    });
  } catch (error) {
    console.error("Inbound shipments API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch inbound shipments" },
      { status: 500 }
    );
  }
}
