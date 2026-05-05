import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/upload-invoices/status`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || data.detail || "Failed to load upload status" },
        { status: res.status || 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Upload status proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend upload status endpoint" },
      { status: 502 },
    );
  }
}
