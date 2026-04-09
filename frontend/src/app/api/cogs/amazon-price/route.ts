import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * POST /api/cogs/amazon-price
 * Triggers background Amazon price fetch on the Python backend.
 * The backend fetches prices from SP-API and saves directly to the cogs table.
 * We poll for completion, then return the result.
 */
export async function POST() {
  try {
    // Trigger the background fetch
    const triggerRes = await fetch(`${BACKEND_URL}/amazon-prices`, {
      method: "POST",
      cache: "no-store",
    });

    if (!triggerRes.ok) {
      const err = await triggerRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.detail || "Failed to start Amazon price fetch" },
        { status: triggerRes.status }
      );
    }

    const triggerData = await triggerRes.json();

    // Poll for completion (check every 5 seconds, max 15 minutes)
    const maxWaitMs = 15 * 60 * 1000;
    const pollInterval = 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const statusRes = await fetch(`${BACKEND_URL}/amazon-prices/status`, {
        cache: "no-store",
      });

      if (!statusRes.ok) continue;

      const status = await statusRes.json();

      if (status.done) {
        return NextResponse.json({
          message: `Amazon prices updated: ${status.fetched} SKU(s) saved. (${status.progress}% complete)`,
          fetched: status.fetched,
          total: status.total,
        });
      }
    }

    // If we reach here, it took too long but it's still running in the background
    return NextResponse.json({
      message: `Price fetch still running in background (${triggerData.progress || 0}% done). Prices will save as they're fetched. Refresh the page later.`,
      fetched: triggerData.fetched || 0,
      total: triggerData.total || 0,
    });
  } catch (error) {
    console.error("Amazon price update error:", error);
    return NextResponse.json(
      { error: "Failed to update Amazon prices" },
      { status: 500 }
    );
  }
}
