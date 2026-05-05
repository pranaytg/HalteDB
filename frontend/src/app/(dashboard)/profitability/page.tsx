"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Formatters ──────────────────────────────────────────────
const fmt = (v: number | null | undefined, decimals = 0) => {
  if (v == null || isNaN(v)) return "—";
  return `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: decimals })}`;
};
const fmtPct = (v: number | null | undefined) => {
  if (v == null || isNaN(v)) return "—";
  return `${Number(v).toFixed(1)}%`;
};
const fmtK = (v: number) => {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
  return `₹${v.toFixed(0)}`;
};
const fmtTooltipValue = (
  value: number | string | ReadonlyArray<number | string> | undefined,
  label = "",
): [string, string] => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const numericValue = rawValue == null || rawValue === "" ? undefined : Number(rawValue);
  return [fmt(Number.isNaN(numericValue ?? NaN) ? undefined : numericValue, 0), label];
};
const pctColor = (v: number | null | undefined) => {
  if (v == null) return "var(--text-muted)";
  if (v >= 20) return "#10b981";
  if (v >= 10) return "#f59e0b";
  if (v >= 0) return "#f97316";
  return "#ef4444";
};
const profitColor = (v: number | null | undefined) => {
  if (v == null) return "var(--text-muted)";
  return v >= 0 ? "#10b981" : "#ef4444";
};
const isReturnLike = (status: string) => ["Cancelled", "Returned"].includes(status);
const getShippingChargeForProfit = (row: Pick<OrderRow, "order_status" | "shipping_price">) => {
  const shipping = Number(row.shipping_price) || 0;
  return isReturnLike(row.order_status) ? shipping * 2 : shipping;
};
const getOrderRuleLabel = (row: Pick<OrderRow, "order_status">) =>
  isReturnLike(row.order_status)
    ? "Net profit = -2 x shipping"
    : "Revenue - COGS - Amazon fee - Shipping - Marketing";
const getAmazonFeeCaption = (row: Pick<OrderRow, "amazon_fee_source">) => {
  if (row.amazon_fee_source === "actual") return "SP API";
  return "pending";
};

const STATUS_COLORS: Record<string, string> = {
  Shipped: "#10b981", Pending: "#f59e0b", Cancelled: "#ef4444", Returned: "#ef4444",
};

const CHART_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

// ── Types ────────────────────────────────────────────────────
interface Summary {
  total_orders: number;
  active_orders: number;
  total_revenue: number;
  total_cogs: number;
  total_amazon_fees: number;
  total_shipping: number;
  total_marketing: number;
  total_profit: number;
  avg_profit_margin: number;
  profitable_orders: number;
  loss_orders: number;
  actual_amazon_fee_orders: number;
  pending_amazon_fee_orders: number;
  orders_with_cogs: number;
}

interface OrderRow {
  amazon_order_id: string;
  sku: string;
  asin: string | null;
  purchase_date: string;
  order_status: string;
  fulfillment_channel: string;
  quantity: number;
  item_price: number;
  shipping_price: number;
  brand: string | null;
  category: string | null;
  cogs_estimate: number | null;
  margin1_amount: number | null;
  margin2_amount: number | null;
  amazon_fee_percent: number | null;
  marketing_cost: number | null;
  marketing_percent: number | null;
  estimated_amazon_sp: number | null;
  amazon_fee_source: "actual" | "pending";
  amazon_fee: number | null;
  net_profit: number;
  profit_margin_pct: number | null;
}

interface SkuRow {
  sku: string;
  brand: string | null;
  category: string | null;
  orders: number;
  revenue: number;
  avg_selling_price: number;
  cogs_per_unit: number | null;
  amazon_fee_pct: number | null;
  marketing_pct: number | null;
  marketing_per_unit: number | null;
  margin1: number | null;
  margin2: number | null;
  total_profit: number;
  avg_margin_pct: number | null;
}

interface MonthlyRow {
  month: string;
  orders: number;
  revenue: number;
  cogs: number;
  amazon_fees: number;
  shipping: number;
  marketing: number;
  profit: number;
}

// ── Tooltip ──────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: "10px 14px", fontSize: 12, minWidth: 160 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: p.color }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{fmtK(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────
export default function ProfitabilityPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "orders" | "sku">("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [skuData, setSkuData] = useState<SkuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  // ── Filters ──
  const [skuFilter, setSkuFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // ── Expanded row ──
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── Security ──
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");

  // ── Amazon Finance manual sync ──
  const [financeSyncing, setFinanceSyncing] = useState(false);
  const [financeSyncMsg, setFinanceSyncMsg] = useState<string | null>(null);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (skuFilter) p.set("sku", skuFilter);
    if (brandFilter) p.set("brand", brandFilter);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    if (statusFilter) p.set("status", statusFilter);
    return p;
  }, [skuFilter, brandFilter, startDate, endDate, statusFilter]);

  const fetchOverview = useCallback(async () => {
    const p = buildParams();
    const [monthlyRes, summaryRes] = await Promise.all([
      fetch(`/api/profitability?view=monthly&${p}`),
      fetch(`/api/profitability?view=monthly&${p}`), // summary comes with monthly
    ]);
    if (monthlyRes.ok) {
      const data = await monthlyRes.json();
      setMonthly(data.monthly || []);
      setSummary(data.summary || null);
    }
    void summaryRes;
  }, [buildParams]);

  const fetchOrders = useCallback(async () => {
    const p = buildParams();
    p.set("page", String(page));
    p.set("limit", String(LIMIT));
    const res = await fetch(`/api/profitability?view=orders&${p}`);
    if (res.ok) {
      const data = await res.json();
      setOrders(data.orders || []);
      setTotal(data.total || 0);
      if (!summary) setSummary(data.summary || null);
    }
  }, [buildParams, page, summary]);

  const fetchSku = useCallback(async () => {
    const p = buildParams();
    const res = await fetch(`/api/profitability?view=sku&${p}`);
    if (res.ok) {
      const data = await res.json();
      setSkuData(data.bysku || []);
      if (!summary) setSummary(data.summary || null);
    }
  }, [buildParams, summary]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchOverview(), fetchOrders(), fetchSku()]);
    } finally {
      setLoading(false);
    }
  }, [fetchOverview, fetchOrders, fetchSku]);

  useEffect(() => { if (isAuthorized) fetchAll(); }, [isAuthorized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll sync status while a manual Amazon Finance sync is running.
  useEffect(() => {
    if (!financeSyncing) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/amazon-finance/sync`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.running === false) {
          setFinanceSyncing(false);
          const last = data.last_result;
          if (last?.status === "completed") {
            setFinanceSyncMsg(
              `Synced ${last.orders_scanned} orders · ${last.fee_updates} fees + ${last.shipping_updates} shipping updated`,
            );
            fetchAll();
          } else if (last?.status === "failed") {
            setFinanceSyncMsg(`Sync failed: ${last.error || "unknown error"}`);
          }
        }
      } catch { /* ignore transient errors */ }
    };
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [financeSyncing, fetchAll]);

  const triggerFinanceSync = async () => {
    if (financeSyncing) return;
    setFinanceSyncMsg(null);
    try {
      const res = await fetch(`/api/amazon-finance/sync?days=15`, { method: "POST" });
      const data = await res.json();
      if (data?.status === "accepted") {
        setFinanceSyncing(true);
        setFinanceSyncMsg(`Sync started for the last ${data.days} day(s) — this takes a few minutes.`);
      } else if (data?.status === "skipped") {
        setFinanceSyncing(true);
        setFinanceSyncMsg("A sync is already running — waiting for it to finish.");
      } else {
        setFinanceSyncMsg(data?.error || "Failed to start sync.");
      }
    } catch (e) {
      setFinanceSyncMsg(`Failed to reach backend: ${(e as Error).message}`);
    }
  };

  const applyFilters = () => {
    setPage(0);
    fetchAll();
  };

  const clearFilters = () => {
    setSkuFilter(""); setBrandFilter(""); setStartDate(""); setEndDate(""); setStatusFilter("");
    setPage(0);
    setTimeout(fetchAll, 50);
  };

  useEffect(() => {
    if (!loading) fetchOrders();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cost breakdown chart data (waterfall-style via stacked bar) ──
  const waterfallData = summary ? [
    {
      name: "Revenue",
      value: Number(summary.total_revenue) || 0,
      fill: "#6366f1",
    },
    {
      name: "COGS",
      value: Number(summary.total_cogs) || 0,
      fill: "#ef4444",
    },
    {
      name: "Amazon Fee",
      value: Number(summary.total_amazon_fees) || 0,
      fill: "#f97316",
    },
    {
      name: "Shipping",
      value: Number(summary.total_shipping) || 0,
      fill: "#f59e0b",
    },
    {
      name: "Marketing",
      value: Number(summary.total_marketing) || 0,
      fill: "#8b5cf6",
    },
    {
      name: "Net Profit",
      value: Number(summary.total_profit) || 0,
      fill: Number(summary.total_profit) >= 0 ? "#10b981" : "#ef4444",
    },
  ] : [];

  // ── Top 10 SKUs by profit (for bar chart) ──
  const topSkus = [...skuData].sort((a, b) => b.total_profit - a.total_profit).slice(0, 10);
  const recentOrderCalculations = orders.slice(0, 8);

  const totalPages = Math.ceil(total / LIMIT);

  if (!isAuthorized) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="card" style={{ padding: 40, textAlign: 'center', maxWidth: 400, width: '100%' }}>
          <h2 style={{ marginBottom: 20 }}>Security Check</h2>
          <p style={{ marginBottom: 20, color: 'var(--text-muted)' }}>This page requires a password.</p>
          <form onSubmit={e => {
            e.preventDefault();
            if (passwordInput === "OnlyForRamanSir") {
              setIsAuthorized(true);
              setAuthError("");
            } else {
              setAuthError("Incorrect password");
            }
          }}>
            <input
              type="password"
              className="filter-input"
              style={{ width: '100%', marginBottom: 16 }}
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              placeholder="Enter password..."
              autoFocus
            />
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Unlock Dashboard</button>
            {authError && <div style={{ marginTop: 12, color: 'var(--danger)' }}>{authError}</div>}
          </form>
        </div>
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading profitability data...
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Profitability</h1>
          <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: 13 }}>
            Per-order profit breakdown · Revenue − COGS − Amazon Fee − Shipping − Marketing
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {financeSyncMsg && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 320, textAlign: "right" }}>
              {financeSyncMsg}
            </span>
          )}
          <button
            className="btn btn-secondary"
            onClick={triggerFinanceSync}
            disabled={financeSyncing}
            title="Pull Amazon Finance referral fees + shipping actuals for the last 15 days"
          >
            {financeSyncing
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Syncing Amazon Finance...</>
              : "↻ Sync Amazon Finance (15d)"}
          </button>
          <button className="btn btn-secondary" onClick={fetchAll} disabled={loading}>
            {loading ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Refreshing...</> : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>SKU</label>
            <input className="input" style={{ width: 140 }} placeholder="Filter by SKU" value={skuFilter}
              onChange={e => setSkuFilter(e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Brand</label>
            <input className="input" style={{ width: 130 }} placeholder="Brand" value={brandFilter}
              onChange={e => setBrandFilter(e.target.value)} onKeyDown={e => e.key === "Enter" && applyFilters()} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Status</label>
            <select className="input" style={{ width: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="Shipped">Shipped</option>
              <option value="Pending">Pending</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Returned">Returned</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>From</label>
            <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>To</label>
            <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={applyFilters}>Apply</button>
          <button className="btn btn-secondary" onClick={clearFilters}>Clear</button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-label">Total Revenue</div>
            <div className="stat-value" style={{ color: "#6366f1" }}>{fmtK(Number(summary.total_revenue))}</div>
            <div className="stat-sub">{Number(summary.active_orders).toLocaleString()} active orders</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total COGS</div>
            <div className="stat-value" style={{ color: "#ef4444" }}>{fmtK(Number(summary.total_cogs))}</div>
            <div className="stat-sub">{Number(summary.orders_with_cogs).toLocaleString()} orders have cost data</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Amazon Fees</div>
            <div className="stat-value" style={{ color: "#f97316" }}>{fmtK(Number(summary.total_amazon_fees))}</div>
            <div className="stat-sub">
              {Number(summary.actual_amazon_fee_orders).toLocaleString()} SP API actual
              {summary.pending_amazon_fee_orders > 0 && (
                <span style={{ color: "var(--text-muted)" }}>
                  {" "}· {Number(summary.pending_amazon_fee_orders).toLocaleString()} pending
                </span>
              )}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Shipping</div>
            <div className="stat-value" style={{ color: "#f59e0b" }}>{fmtK(Number(summary.total_shipping))}</div>
            <div className="stat-sub">Fulfillment costs</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Marketing</div>
            <div className="stat-value" style={{ color: "#8b5cf6" }}>{fmtK(Number(summary.total_marketing))}</div>
            <div className="stat-sub">Estimated from COGS per SKU</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Net Profit</div>
            <div className="stat-value" style={{ color: profitColor(Number(summary.total_profit)) }}>
              {Number(summary.total_profit) < 0 ? "-" : ""}{fmtK(Math.abs(Number(summary.total_profit)))}
            </div>
            <div className="stat-sub" style={{ color: pctColor(Number(summary.avg_profit_margin)) }}>
              Avg margin: {fmtPct(Number(summary.avg_profit_margin))}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Profitable Orders</div>
            <div className="stat-value" style={{ color: "#10b981" }}>{Number(summary.profitable_orders).toLocaleString()}</div>
            <div className="stat-sub" style={{ color: "#ef4444" }}>
              {Number(summary.loss_orders).toLocaleString()} at a loss
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {(["overview", "orders", "sku"] as const).map(tab => (
          <button key={tab} className={`tab-btn ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}>
            {tab === "overview" ? "Overview" : tab === "orders" ? "Per Order" : "By SKU"}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB: Overview
      ══════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Cost Breakdown */}
          {summary && (
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Cost Breakdown (All Orders)</h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, marginTop: -8 }}>
                ℹ Amazon fees come from SP API Finance only — orders awaiting settlement show as pending and are excluded from the totals. Marketing is calculated from the COGS Estimate marketing percentage.
              </p>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={waterfallData} barSize={48}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value) => fmtTooltipValue(value)}
                      contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 8 }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {waterfallData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Breakdown Summary row */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                {waterfallData.map(item => (
                  <div key={item.name} style={{ flex: "1 0 100px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.name}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: item.fill }}>
                      {item.value < 0 ? "-" : ""}{fmtK(Math.abs(item.value))}
                    </div>
                    {summary && item.name !== "Revenue" && item.name !== "Net Profit" && (
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {fmtPct(item.value / (Number(summary.total_revenue) || 1) * 100)} of rev
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly Trend */}
          {monthly.length > 0 && (
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Monthly P&L Trend</h3>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthly}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" fill="url(#revGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cogs" name="COGS" stroke="#ef4444" fill="none" strokeWidth={2} strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="profit" name="Net Profit" stroke="#10b981" fill="url(#profitGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {recentOrderCalculations.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Per-Order Calculations</h3>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  Monthly stays as-is above. This section shows individual order-level profitability using the same formula as the API.
                </p>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>SKU</th>
                      <th>Status</th>
                      <th>Revenue</th>
                      <th>COGS</th>
                      <th>Amazon Fee</th>
                      <th>Shipping</th>
                      <th>Marketing</th>
                      <th>Net Profit</th>
                      <th>Rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrderCalculations.map(row => {
                      const isReturn = isReturnLike(row.order_status);
                      const shippingCharge = getShippingChargeForProfit(row);
                      return (
                        <tr key={`preview-${row.amazon_order_id}-${row.sku}`}>
                          <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.amazon_order_id}</td>
                          <td style={{ fontWeight: 600, fontSize: 12 }}>{row.sku}</td>
                          <td>{row.order_status}</td>
                          <td>{isReturn ? "—" : fmt(Number(row.item_price))}</td>
                          <td style={{ color: isReturn ? "var(--text-muted)" : "#ef4444" }}>
                            {isReturn ? "—" : (row.cogs_estimate != null ? fmt(Number(row.cogs_estimate)) : "No data")}
                          </td>
                          <td style={{ color: isReturn ? "var(--text-muted)" : "#f97316" }}>
                            {isReturn ? "—" : (row.amazon_fee != null ? fmt(Number(row.amazon_fee)) : "—")}
                            {!isReturn && (
                              <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                                ({getAmazonFeeCaption(row)})
                              </span>
                            )}
                          </td>
                          <td style={{ color: "#f59e0b" }}>
                            {fmt(shippingCharge)}
                            {isReturn && Number(row.shipping_price) > 0 && (
                              <span style={{ marginLeft: 4, fontSize: 10, color: "var(--text-muted)" }}>
                                (2 x {fmt(Number(row.shipping_price))})
                              </span>
                            )}
                          </td>
                          <td style={{ color: isReturn ? "var(--text-muted)" : "#8b5cf6" }}>
                            {isReturn ? "—" : (row.marketing_cost != null ? fmt(Number(row.marketing_cost)) : "—")}
                          </td>
                          <td style={{ fontWeight: 700, color: profitColor(Number(row.net_profit)) }}>
                            {Number(row.net_profit) < 0 ? "-" : ""}
                            {fmt(Math.abs(Number(row.net_profit)))}
                          </td>
                          <td style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 200 }}>
                            {getOrderRuleLabel(row)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly detail table */}
          {monthly.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Monthly Summary</h3>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Orders</th>
                      <th>Revenue</th>
                      <th>COGS</th>
                      <th>Amazon Fee</th>
                      <th>Shipping</th>
                      <th>Marketing</th>
                      <th>Net Profit</th>
                      <th>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map(row => {
                      const margin = Number(row.revenue) > 0
                        ? (Number(row.profit) / Number(row.revenue) * 100)
                        : null;
                      return (
                        <tr key={row.month}>
                          <td style={{ fontWeight: 600 }}>{row.month}</td>
                          <td>{Number(row.orders).toLocaleString()}</td>
                          <td>{fmt(Number(row.revenue))}</td>
                          <td style={{ color: "#ef4444" }}>{fmt(Number(row.cogs))}</td>
                          <td style={{ color: "#f97316" }}>{fmt(Number(row.amazon_fees))}</td>
                          <td style={{ color: "#f59e0b" }}>{fmt(Number(row.shipping))}</td>
                          <td style={{ color: "#8b5cf6" }}>{fmt(Number(row.marketing))}</td>
                          <td style={{ fontWeight: 700, color: profitColor(Number(row.profit)) }}>
                            {Number(row.profit) < 0 ? "-" : ""}
                            {fmt(Math.abs(Number(row.profit)))}
                          </td>
                          <td style={{ color: pctColor(margin) }}>{fmtPct(margin)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: By SKU
      ══════════════════════════════════════════════════════ */}
      {activeTab === "sku" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Top SKUs chart */}
          {topSkus.length > 0 && (
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Top 10 SKUs by Net Profit</h3>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topSkus} layout="vertical" barSize={18} margin={{ left: 100 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="sku" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip
                      formatter={(value) => fmtTooltipValue(value, "Net Profit")}
                      contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 8 }}
                    />
                    <Bar dataKey="total_profit" name="Net Profit" radius={[0, 4, 4, 0]}>
                      {topSkus.map((entry, i) => (
                        <Cell key={i} fill={Number(entry.total_profit) >= 0 ? CHART_COLORS[i % CHART_COLORS.length] : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* SKU table */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Profit by SKU ({skuData.length} SKUs)</h3>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Brand</th>
                    <th>Orders</th>
                    <th>Avg Selling Price</th>
                    <th>COGS / unit</th>
                    <th>Margin 1</th>
                    <th>Margin 2</th>
                    <th>Amazon Fee%</th>
                    <th>Marketing</th>
                    <th>Total Profit</th>
                    <th>Avg Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {skuData.map(row => (
                    <tr key={row.sku}>
                      <td style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 12 }}>{row.sku}</td>
                      <td>{row.brand || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td>{Number(row.orders).toLocaleString()}</td>
                      <td>{fmt(Number(row.avg_selling_price))}</td>
                      <td style={{ color: "#ef4444" }}>
                        {row.cogs_per_unit != null ? fmt(Number(row.cogs_per_unit)) : <span style={{ color: "var(--text-muted)" }}>No COGS</span>}
                      </td>
                      <td style={{ color: "#6366f1" }}>{row.margin1 != null ? fmt(Number(row.margin1)) : "—"}</td>
                      <td style={{ color: "#8b5cf6" }}>{row.margin2 != null ? fmt(Number(row.margin2)) : "—"}</td>
                      <td>{row.amazon_fee_pct != null ? `${Number(row.amazon_fee_pct).toFixed(0)}%` : "—"}</td>
                      <td style={{ color: "#f59e0b" }}>
                        {row.marketing_per_unit != null ? fmt(Number(row.marketing_per_unit)) : "—"}
                        {row.marketing_pct != null && (
                          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                            ({Number(row.marketing_pct).toFixed(1)}%)
                          </span>
                        )}
                      </td>
                      <td style={{ fontWeight: 700, color: profitColor(Number(row.total_profit)) }}>
                        {Number(row.total_profit) < 0 ? "-" : ""}
                        {fmt(Math.abs(Number(row.total_profit)))}
                      </td>
                      <td style={{ color: pctColor(Number(row.avg_margin_pct)) }}>
                        {fmtPct(Number(row.avg_margin_pct))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: Per Order
      ══════════════════════════════════════════════════════ */}
      {activeTab === "orders" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                Per-Order Calculations ({total.toLocaleString()} total)
              </h3>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
                Expand any row to see the exact order-level formula used for profit.
              </div>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Page {page + 1} of {totalPages}
            </span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Order ID</th>
                  <th>SKU</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Qty</th>
                  <th>Selling Price</th>
                  <th>COGS</th>
                  <th>Amazon Fee</th>
                  <th>Shipping</th>
                  <th>Marketing</th>
                  <th>Net Profit</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(row => {
                  const key = `${row.amazon_order_id}::${row.sku}`;
                  const isExpanded = expanded === key;
                  const isReturn = isReturnLike(row.order_status);
                  const shippingCharge = getShippingChargeForProfit(row);
                  return [
                    <tr
                      key={key}
                      style={{ cursor: "pointer", background: isExpanded ? "var(--hover-bg)" : undefined }}
                      onClick={() => setExpanded(isExpanded ? null : key)}
                    >
                      <td style={{ width: 24, color: "var(--text-muted)", fontSize: 11 }}>
                        {isExpanded ? "▼" : "▶"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.amazon_order_id}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{row.sku}</td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {row.purchase_date ? new Date(row.purchase_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                      </td>
                      <td>
                        <span className="badge" style={{
                          background: (STATUS_COLORS[row.order_status] || "#6b7280") + "22",
                          color: STATUS_COLORS[row.order_status] || "#6b7280",
                          padding: "2px 8px", borderRadius: 4, fontSize: 11,
                        }}>
                          {row.order_status}
                        </span>
                      </td>
                      <td>{row.quantity}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(Number(row.item_price))}</td>
                      <td style={{ color: row.cogs_estimate != null ? "#ef4444" : "var(--text-muted)" }}>
                        {row.cogs_estimate != null ? fmt(Number(row.cogs_estimate)) : "No data"}
                      </td>
                      <td style={{ color: "#f97316" }}>
                        {isReturn ? "—" : (row.amazon_fee != null ? fmt(Number(row.amazon_fee)) : "—")}
                        {!isReturn && (
                          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                            ({getAmazonFeeCaption(row)})
                          </span>
                        )}
                      </td>
                      <td style={{ color: "#f59e0b" }}>
                        {fmt(shippingCharge)}
                        {isReturn && Number(row.shipping_price) > 0 && (
                          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                            (2x)
                          </span>
                        )}
                      </td>
                      <td style={{ color: "#8b5cf6" }}>
                        {isReturn ? "—" : (row.marketing_cost != null ? fmt(Number(row.marketing_cost)) : "—")}
                      </td>
                      <td style={{ fontWeight: 700, color: profitColor(Number(row.net_profit)) }}>
                        {Number(row.net_profit) < 0 ? "-" : ""}
                        {fmt(Math.abs(Number(row.net_profit)))}
                      </td>
                      <td style={{ color: pctColor(Number(row.profit_margin_pct)) }}>
                        {isReturn ? "—" : fmtPct(Number(row.profit_margin_pct))}
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={key + "_expand"} style={{ background: "var(--hover-bg)" }}>
                        <td colSpan={13} style={{ padding: "12px 24px" }}>
                          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12 }}>
                            <div>
                              <div style={{ color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>Profit Breakdown</div>
                              {isReturn ? (
                                <>
                                  <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 16px" }}>
                                    <span style={{ color: "var(--text-muted)" }}>Calculation rule:</span>
                                    <span style={{ fontWeight: 600 }}>Cancelled/Returned order</span>
                                    <span style={{ color: "var(--text-muted)" }}>Shipping loss:</span>
                                    <span style={{ color: "#f59e0b" }}>
                                      −{fmt(shippingCharge)}
                                      {Number(row.shipping_price) > 0 && (
                                        <span style={{ marginLeft: 4, fontSize: 10, color: "var(--text-muted)" }}>
                                          (2 x {fmt(Number(row.shipping_price))})
                                        </span>
                                      )}
                                    </span>
                                    <span style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 4 }}>= Net Profit:</span>
                                    <span style={{ fontWeight: 700, color: profitColor(Number(row.net_profit)), borderTop: "1px solid var(--border)", paddingTop: 4 }}>
                                      {Number(row.net_profit) < 0 ? "-" : ""}{fmt(Math.abs(Number(row.net_profit)))}
                                    </span>
                                  </div>
                                  <div style={{ marginTop: 10, color: "var(--text-muted)", maxWidth: 420, lineHeight: 1.5 }}>
                                    For cancelled and returned orders, the current backend formula counts only a double-shipping loss.
                                    Revenue, COGS, Amazon fee, and marketing are not included in the net profit for these rows.
                                  </div>
                                </>
                              ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 16px" }}>
                                  <span style={{ color: "var(--text-muted)" }}>Selling price:</span>
                                  <span style={{ fontWeight: 600, color: "#6366f1" }}>{fmt(Number(row.item_price))}</span>
                                  <span style={{ color: "var(--text-muted)" }}>− COGS:</span>
                                  <span style={{ color: "#ef4444" }}>−{fmt(Number(row.cogs_estimate) || 0)}</span>
                                  {row.margin1_amount != null && (
                                    <>
                                      <span style={{ color: "var(--text-muted)", paddingLeft: 12 }}>↳ Margin 1 (dist.):</span>
                                      <span style={{ color: "#6366f1" }}>{fmt(Number(row.margin1_amount))}</span>
                                    </>
                                  )}
                                  {row.margin2_amount != null && (
                                    <>
                                      <span style={{ color: "var(--text-muted)", paddingLeft: 12 }}>↳ Margin 2 (retail):</span>
                                      <span style={{ color: "#8b5cf6" }}>{fmt(Number(row.margin2_amount))}</span>
                                    </>
                                  )}
                                  <span style={{ color: "var(--text-muted)" }}>
                                    − Amazon fee ({row.amazon_fee_source === "actual" ? "SP API actual" : "pending settlement"}):
                                  </span>
                                  <span style={{ color: "#f97316" }}>
                                    {row.amazon_fee != null ? `−${fmt(Number(row.amazon_fee))}` : "—"}
                                  </span>
                                  <span style={{ color: "var(--text-muted)" }}>− Shipping:</span>
                                  <span style={{ color: "#f59e0b" }}>−{fmt(Number(row.shipping_price))}</span>
                                  <span style={{ color: "var(--text-muted)" }}>− Marketing (COGS estimate):</span>
                                  <span style={{ color: "#8b5cf6" }}>
                                    −{fmt(Number(row.marketing_cost) || 0)}
                                    {row.marketing_percent != null && (
                                      <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                                        ({Number(row.marketing_percent).toFixed(1)}%)
                                      </span>
                                    )}
                                  </span>
                                  <span style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 4 }}>= Net Profit:</span>
                                  <span style={{ fontWeight: 700, color: profitColor(Number(row.net_profit)), borderTop: "1px solid var(--border)", paddingTop: 4 }}>
                                    {Number(row.net_profit) < 0 ? "-" : ""}{fmt(Math.abs(Number(row.net_profit)))}
                                    {row.profit_margin_pct != null && ` (${fmtPct(Number(row.profit_margin_pct))})`}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div>
                              <div style={{ color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>Order Details</div>
                              <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 16px" }}>
                                <span style={{ color: "var(--text-muted)" }}>ASIN:</span>
                                <span style={{ fontFamily: "monospace" }}>{row.asin || "—"}</span>
                                <span style={{ color: "var(--text-muted)" }}>Brand:</span>
                                <span>{row.brand || "—"}</span>
                                <span style={{ color: "var(--text-muted)" }}>Category:</span>
                                <span>{row.category || "—"}</span>
                                <span style={{ color: "var(--text-muted)" }}>Fulfillment:</span>
                                <span>{row.fulfillment_channel || "—"}</span>
                                <span style={{ color: "var(--text-muted)" }}>Est. Amazon SP:</span>
                                <span>{row.estimated_amazon_sp != null ? fmt(Number(row.estimated_amazon_sp)) : "—"}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
              <button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(0)}>«</button>
              <button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span style={{ fontSize: 13, color: "var(--text-muted)", padding: "0 8px" }}>
                Page {page + 1} / {totalPages}
              </span>
              <button className="btn btn-secondary" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
              <button className="btn btn-secondary" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
