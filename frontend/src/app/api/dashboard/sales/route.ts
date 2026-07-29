import { NextRequest, NextResponse } from "next/server";

const DASHBOARD_SALES_URL =
  process.env.DASHBOARD_SALES_URL || "https://halte.in/api/dashboard/sales";

type DashboardSalesRow = {
  order_time: string | null;
  total_amount: string | number | null;
  order_state: "PAID" | "UNPAID" | string | null;
};

function buildUpstreamUrl(req: NextRequest) {
  const upstreamUrl = new URL(DASHBOARD_SALES_URL);
  const { searchParams } = new URL(req.url);
  const state = searchParams.get("state")?.trim().toUpperCase();

  if (state && ['PAID', 'UNPAID', 'SHIPPED', 'DELIVERED'].includes(state)) {
    upstreamUrl.searchParams.set("state", state);
  }

  return upstreamUrl;
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.DASHBOARD_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "DASHBOARD_API_KEY is not configured" },
      { status: 500 },
    );
  }

  try {
    const upstreamResponse = await fetch(buildUpstreamUrl(req), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const data = (await upstreamResponse.json()) as DashboardSalesRow[] | { error?: string };

    if (!upstreamResponse.ok) {
      return NextResponse.json(data, { status: upstreamResponse.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Dashboard sales proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard sales data" },
      { status: 500 },
    );
  }
}
