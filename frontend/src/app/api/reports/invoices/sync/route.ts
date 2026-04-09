import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/sync-invoices/status`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || data.detail || "Failed to load invoice sync status" },
        { status: res.status || 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Invoice sync status proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend invoice sync endpoint" },
      { status: 502 },
    );
  }
}

export async function POST() {
  try {
    const res = await fetch(`${BACKEND_URL}/sync-invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || data.detail || "Failed to sync invoices" },
        { status: res.status || 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Invoice sync proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend invoice sync endpoint" },
      { status: 502 },
    );
  }
}
