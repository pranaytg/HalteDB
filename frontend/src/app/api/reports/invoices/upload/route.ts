import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const runtime = "nodejs";
export const maxDuration = 60; // seconds — just for the upload, processing is background

// Increase body size limit for ZIP uploads (default is 4MB)
export const config = {
  api: { bodyParser: { sizeLimit: "200mb" } },
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file provided. Please upload a .zip or .pdf file." },
        { status: 400 },
      );
    }

    // Forward the file to the backend as multipart/form-data
    const backendForm = new FormData();
    backendForm.append("file", file);

    const res = await fetch(`${BACKEND_URL}/upload-invoices`, {
      method: "POST",
      body: backendForm,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "Failed to upload invoices" },
        { status: res.status || 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Invoice upload proxy error:", error);
    return NextResponse.json(
      { error: "Failed to reach backend upload endpoint" },
      { status: 502 },
    );
  }
}
