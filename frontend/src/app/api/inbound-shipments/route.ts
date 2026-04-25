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
      summary: summary.rows[0] || null,
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
