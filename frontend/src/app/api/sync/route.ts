import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * POST /api/sync
 * Triggers the backend full sync.
 * Shipment cost estimation now runs inside the Python sync itself.
 */
export async function POST() {
  try {
    const res = await fetch(`${BACKEND_URL}/sync-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const syncData = await res.json();

    return NextResponse.json({
      ...syncData,
      shipment_estimation: "included_in_backend_sync",
    });
  } catch (error) {
    console.error("Sync proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend sync endpoint" },
      { status: 502 },
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/sync-status`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Sync status proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend" },
      { status: 502 },
    );
  }
}
