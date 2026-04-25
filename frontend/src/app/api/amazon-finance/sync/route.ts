import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * POST /api/amazon-finance/sync?days=15
 * Triggers the backend Amazon Finance backfill for the last N days.
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = searchParams.get("days") || "15";
    const res = await fetch(`${BACKEND_URL}/sync-amazon-finance?days=${encodeURIComponent(days)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Amazon Finance sync proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend" },
      { status: 502 },
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/sync-amazon-finance/status`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Amazon Finance sync status proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend" },
      { status: 502 },
    );
  }
}
