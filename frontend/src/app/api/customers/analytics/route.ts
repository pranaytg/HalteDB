import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const metric = searchParams.get("metric") || "rfm";
    const channel = searchParams.get("channel") || "all";

    if (metric === "rfm") return await getRFM(channel);
    if (metric === "clv") return await getCLV(channel);
    if (metric === "churn") return await getChurn(channel);
    if (metric === "loyalty") return await getLoyalty(channel);

    return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
  } catch (error) {
    console.error("Analytics API error:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}

/**
 * Analytics derive from the `customers` table aggregates
 * (total_orders, total_spent, last_order_date) populated from the real CSVs.
 * No FK exists from orders→customers, so no JOIN.
 */

// Shared: does the dataset have usable recency? If not, recency-dependent
// metrics (churn, RFM recency) should be flagged rather than fabricated.
async function hasRecency(): Promise<boolean> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM customers WHERE last_order_date IS NOT NULL`
  );
  return Number(r.rows[0]?.n || 0) > 0;
}

// Returns [sqlClause, params] fragment to filter by channel. "all" → no filter.
function channelFilter(channel: string, startIdx = 1): { clause: string; params: string[] } {
  if (!channel || channel === "all") return { clause: "", params: [] };
  return { clause: ` AND channel = $${startIdx}`, params: [channel] };
}

async function getRFM(channel: string) {
  const recencyAvailable = await hasRecency();
  const f = channelFilter(channel);

  // Standard 11-segment RFM (Kumar / Putler model).
  // Scores are NTILE quintiles (1..5). With ~1500 customers this spreads well.
  const result = await pool.query(`
    WITH base AS (
      SELECT
        customer_id, name, phone, email, state, channel,
        total_orders, total_spent, last_order_date,
        CASE WHEN last_order_date IS NOT NULL
             THEN EXTRACT(DAY FROM NOW() - last_order_date)::int
             ELSE NULL END AS days_since_order
      FROM customers
      WHERE total_orders > 0 AND total_spent > 0${f.clause}
    ),
    scored AS (
      SELECT
        *,
        CASE WHEN days_since_order IS NULL THEN NULL
             ELSE NTILE(5) OVER (PARTITION BY (days_since_order IS NULL) ORDER BY days_since_order ASC)
        END AS r,
        NTILE(5) OVER (ORDER BY total_orders ASC, total_spent ASC) AS f,
        NTILE(5) OVER (ORDER BY total_spent ASC)                   AS m
      FROM base
    )
    SELECT
      customer_id, name, phone, email, state, channel,
      days_since_order,
      total_orders AS purchase_frequency,
      total_spent,
      COALESCE(r, 0) AS recency_score,
      f AS frequency_score,
      m AS monetary_score,
      (COALESCE(r,0) * 100 + f * 10 + m) AS rfm_score,
      CASE
        WHEN r IS NULL THEN 'Unknown Recency'
        WHEN r >= 4 AND f >= 4 AND m >= 4                 THEN 'Champions'
        WHEN r >= 4 AND f <= 2                             THEN 'New Customers'
        WHEN r = 5  AND f <= 3                             THEN 'Promising'
        WHEN r >= 3 AND f >= 3 AND m >= 3                  THEN 'Loyal Customers'
        WHEN r = 3  AND f >= 3                             THEN 'Potential Loyalists'
        WHEN r = 3  AND f <= 2                             THEN 'Needs Attention'
        WHEN r = 2  AND f >= 3 AND m >= 3                  THEN 'At Risk'
        WHEN r = 1  AND m >= 4                             THEN 'Cannot Lose Them'
        WHEN r = 2  AND f <= 2                             THEN 'About to Sleep'
        WHEN r = 1  AND f <= 2                             THEN 'Lost'
        ELSE 'Hibernating'
      END AS segment
    FROM scored
    ORDER BY rfm_score DESC, total_spent DESC
  `, f.params);

  const customers = result.rows;
  const segmentCounts: Record<string, number> = {};
  customers.forEach((c: any) => {
    segmentCounts[c.segment] = (segmentCounts[c.segment] || 0) + 1;
  });

  return NextResponse.json({
    customers,
    segmentCounts,
    totalCustomers: customers.length,
    recencyAvailable,
  });
}

async function getCLV(channel: string) {
  const recencyAvailable = await hasRecency();
  const f = channelFilter(channel);

  // CLV forecast using:
  //   AOV        = total_spent / total_orders
  //   retention  = f(days_since_order)  — fresher → higher
  //   horizon    = 2 years
  //   expected future orders = total_orders * retention * horizon_factor
  //   predicted_clv = total_spent (historic) + AOV * expected_future_orders
  // Tiers derived by NTILE(5) on predicted_clv, not fixed spend bands, so
  // they always reflect the actual customer mix.
  const result = await pool.query(`
    WITH base AS (
      SELECT
        customer_id, name, phone, email, state, channel,
        total_orders, total_spent, last_order_date,
        CASE WHEN total_orders > 0 THEN total_spent / total_orders ELSE 0 END AS avg_order_value,
        CASE WHEN last_order_date IS NOT NULL
             THEN EXTRACT(DAY FROM NOW() - last_order_date)::int
             ELSE NULL END AS days_since_last_order
      FROM customers
      WHERE total_orders > 0 AND total_spent > 0${f.clause}
    ),
    modeled AS (
      SELECT
        *,
        CASE
          WHEN days_since_last_order IS NULL      THEN 0.30
          WHEN days_since_last_order <= 30        THEN 0.85
          WHEN days_since_last_order <= 90        THEN 0.65
          WHEN days_since_last_order <= 180       THEN 0.40
          WHEN days_since_last_order <= 365       THEN 0.15
          ELSE 0.05
        END AS retention_rate
      FROM base
    ),
    scored AS (
      SELECT
        *,
        ROUND(
          total_spent
          + avg_order_value
            * GREATEST(total_orders, 1)
            * retention_rate
            * 2.0
        ) AS predicted_clv
      FROM modeled
    )
    SELECT
      customer_id, name, phone, email, state, channel,
      total_orders, total_spent, avg_order_value,
      last_order_date, days_since_last_order,
      retention_rate,
      predicted_clv,
      CASE NTILE(5) OVER (ORDER BY predicted_clv ASC)
        WHEN 5 THEN 'Platinum'
        WHEN 4 THEN 'Gold'
        WHEN 3 THEN 'Silver'
        WHEN 2 THEN 'Bronze'
        ELSE         'Standard'
      END AS tier
    FROM scored
    ORDER BY predicted_clv DESC
    LIMIT 500
  `, f.params);

  const customers = result.rows;
  const avgCLV =
    customers.reduce((s: number, c: any) => s + Number(c.predicted_clv || 0), 0) /
    Math.max(1, customers.length);

  // Tier distribution for summary
  const tierCounts: Record<string, number> = {};
  customers.forEach((c: any) => {
    tierCounts[c.tier] = (tierCounts[c.tier] || 0) + 1;
  });

  return NextResponse.json({
    customers,
    avgCLV: Math.round(avgCLV),
    totalCustomers: customers.length,
    tierCounts,
    recencyAvailable,
  });
}

async function getChurn(channel: string) {
  const recencyAvailable = await hasRecency();
  const f = channelFilter(channel);

  // Churn is meaningless without recency data. Return empty set + flag
  // so the UI can instruct the user to re-import.
  if (!recencyAvailable) {
    return NextResponse.json({
      customers: [],
      atRiskCount: 0,
      atRiskPercentage: 0,
      recencyAvailable: false,
    });
  }

  const result = await pool.query(`
    WITH base AS (
      SELECT
        customer_id, name, phone, email, state, channel,
        total_orders, total_spent, last_order_date,
        EXTRACT(DAY FROM NOW() - last_order_date)::int AS days_since_order
      FROM customers
      WHERE total_orders > 0 AND last_order_date IS NOT NULL${f.clause}
    )
    SELECT
      *,
      CASE
        WHEN days_since_order > 540 THEN 95
        WHEN days_since_order > 365 THEN 85
        WHEN days_since_order > 180 THEN 70
        WHEN days_since_order > 90  THEN 50
        WHEN days_since_order > 60  THEN 30
        WHEN days_since_order > 30  THEN 15
        ELSE 5
      END AS churn_risk_score,
      CASE
        WHEN days_since_order > 365 THEN 'Critical'
        WHEN days_since_order > 180 THEN 'High'
        WHEN days_since_order > 90  THEN 'Medium'
        WHEN days_since_order > 30  THEN 'Low'
        ELSE 'Safe'
      END AS churn_category
    FROM base
    ORDER BY churn_risk_score DESC, total_spent DESC
  `, f.params);

  const customers = result.rows;
  const atRiskCount = customers.filter(
    (c: any) => Number(c.churn_risk_score) >= 60
  ).length;

  return NextResponse.json({
    customers,
    atRiskCount,
    atRiskPercentage: Math.round((atRiskCount / Math.max(1, customers.length)) * 100),
    recencyAvailable: true,
  });
}

async function getLoyalty(channel: string) {
  const f = channelFilter(channel);
  const result = await pool.query(`
    SELECT
      customer_id, name, phone, email, state, channel,
      total_orders, total_spent, last_order_date,
      CASE
        WHEN total_orders >= 10 THEN 'VIP Loyal'
        WHEN total_orders >= 5  THEN 'Regular Loyal'
        WHEN total_orders >= 3  THEN 'Occasional Repeat'
        WHEN total_orders = 2   THEN 'Returning'
        ELSE 'One-Time'
      END AS loyalty_tier
    FROM customers
    WHERE total_orders > 0${f.clause}
    ORDER BY total_orders DESC, total_spent DESC
  `, f.params);

  const customers = result.rows;
  const tierCounts: Record<string, number> = {
    "VIP Loyal": 0,
    "Regular Loyal": 0,
    "Occasional Repeat": 0,
    Returning: 0,
    "One-Time": 0,
  };
  customers.forEach((c: any) => {
    tierCounts[c.loyalty_tier] = (tierCounts[c.loyalty_tier] || 0) + 1;
  });

  return NextResponse.json({
    customers,
    tierCounts,
    totalCustomers: customers.length,
  });
}
