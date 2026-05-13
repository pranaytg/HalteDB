import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const runtime = "nodejs";
export const maxDuration = 30; // single PDF — should be fast

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file provided. Please upload a .pdf file." },
        { status: 400 },
      );
    }

    // Forward the single PDF to the backend
    const backendForm = new FormData();
    backendForm.append("file", file);

    const res = await fetch(`${BACKEND_URL}/upload-invoice-single`, {
      method: "POST",
      body: backendForm,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "Failed to process invoice" },
        { status: res.status || 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Single invoice upload proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend upload endpoint" },
      { status: 502 },
    );
  }
}
