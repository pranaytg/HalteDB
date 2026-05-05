import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const folderPath = body.folderPath;

    if (!folderPath || typeof folderPath !== "string") {
      return NextResponse.json(
        { error: "No folderPath provided." },
        { status: 400 },
      );
    }

    const res = await fetch(`${BACKEND_URL}/upload-invoices-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "Failed to process folder" },
        { status: res.status || 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Invoice folder upload proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend folder upload endpoint" },
      { status: 502 },
    );
  }
}
