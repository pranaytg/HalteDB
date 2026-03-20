"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart,
  ComposedChart, Legend
} from "recharts";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface SalesFilters {
  sku: string;
  year: string;
  month: string;
  startDate: string;
  endDate: string;
}

interface SummaryData {
  monthly: Array<{
    month: string;
    total_orders: string;
    total_revenue: string;
    total_profit: string;
    total_units: string;
  }>;
  bySku: Array<{
    sku: string;
    total_orders: string;
    total_revenue: string;
    total_profit: string;
    total_units: string;
  }>;
  daily: Array<{
    date: string;
    total_orders: string;
    total_revenue: string;
    total_profit: string;
  }>;
  filters: {
    skus: string[];
    years: number[];
  };
}

interface PredictionData {
  historical: Array<{
    month: string;
    total_quantity: number;
    total_revenue: number;
    type: string;
  }>;
  aggregateForecasts: Array<{
    month: string;
    predicted_quantity: number;
    predicted_revenue: number;
    confidence_lower: number;
    confidence_upper: number;
  }>;
  methodology: string;
}

interface OrderData {
  orders: Array<Record<string, unknown>>;
  summary: {
    total_orders: string;
    total_revenue: string;
    total_profit: string;
    total_units: string;
    avg_profit_per_order: string;
  };
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"];

const formatCurrency = (val: number) => `₹${val.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const formatNumber = (val: number) => val.toLocaleString("en-IN");

export default function SalesPage() {
  const [filters, setFilters] = useState<SalesFilters>({
    sku: "", year: "", month: "", startDate: "", endDate: "",
  });
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [predictions, setPredictions] = useState<PredictionData | null>(null);
  const [orders, setOrders] = useState<OrderData | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "orders" | "predictions">("overview");

  // Fetch summary data for charts
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/summary");
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      console.error("Failed to fetch summary", err);
    }
  }, []);

  // Fetch orders with filters
  const fetchOrders = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("limit", "50");
    params.set("offset", String(page * 50));
    if (filters.sku) params.set("sku", filters.sku);
    if (filters.year) params.set("year", filters.year);
    if (filters.month) params.set("month", filters.month);
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);

    try {
      const res = await fetch(`/api/sales?${params}`);
      const data = await res.json();
      setOrders(data);
    } catch (err) {
      console.error("Failed to fetch orders", err);
    }
  }, [filters, page]);

  // Fetch predictions
  const fetchPredictions = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/predictions");
      const data = await res.json();
      setPredictions(data);
    } catch (err) {
      console.error("Failed to fetch predictions", err);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSummary(), fetchPredictions(), fetchOrders()]).finally(() =>
      setLoading(false)
    );
  }, [fetchSummary, fetchPredictions, fetchOrders]);

  // Power BI-style: clicking a chart segment filters everything
  const handleSkuClick = (sku: string) => {
    setFilters((f) => ({ ...f, sku: f.sku === sku ? "" : sku }));
    setPage(0);
  };

  const handleMonthClick = (month: string) => {
    setFilters((f) => ({ ...f, month: f.month === month ? "" : month }));
    setPage(0);
  };

  const handleReset = () => {
    setFilters({ sku: "", year: "", month: "", startDate: "", endDate: "" });
    setPage(0);
  };

  // Refetch orders when filters/page change
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Prepare chart data
  const monthlyData = summary?.monthly?.map((m) => ({
    month: m.month,
    revenue: parseFloat(m.total_revenue),
    profit: parseFloat(m.total_profit),
    orders: parseInt(m.total_orders),
  })) || [];

  const dailyData = summary?.daily?.map((d) => ({
    date: d.date.slice(5), // MM-DD
    revenue: parseFloat(d.total_revenue),
    profit: parseFloat(d.total_profit),
    orders: parseInt(d.total_orders),
  })) || [];

  const skuData = summary?.bySku?.slice(0, 8).map((s) => ({
    sku: s.sku.length > 15 ? s.sku.slice(0, 15) + "…" : s.sku,
    fullSku: s.sku,
    revenue: parseFloat(s.total_revenue),
    profit: parseFloat(s.total_profit),
  })) || [];

  // Forecast chart: historical + predicted
  const forecastChart = [
    ...(predictions?.historical?.slice(-12) || []).map((h) => ({
      month: h.month,
      actual_revenue: h.total_revenue,
      predicted_revenue: null as number | null,
      lower: null as number | null,
      upper: null as number | null,
    })),
    ...(predictions?.aggregateForecasts || []).map((f) => ({
      month: f.month,
      actual_revenue: null as number | null,
      predicted_revenue: f.predicted_revenue,
      lower: f.confidence_lower,
      upper: f.confidence_upper,
    })),
  ];

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading sales data...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Sales Dashboard</h1>
        <p className="page-subtitle">
          Revenue, profitability & predictive analytics
        </p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
          Overview
        </button>
        <button className={`tab ${activeTab === "orders" ? "active" : ""}`} onClick={() => setActiveTab("orders")}>
          Orders
        </button>
        <button className={`tab ${activeTab === "predictions" ? "active" : ""}`} onClick={() => setActiveTab("predictions")}>
          Predictions
        </button>
      </div>

      {/* Filters Bar */}
      <div className="filters-bar">
        <div className="filter-group">
          <span className="filter-label">SKU</span>
          <select
            className="filter-select"
            value={filters.sku}
            onChange={(e) => { setFilters((f) => ({ ...f, sku: e.target.value })); setPage(0); }}
          >
            <option value="">All SKUs</option>
            {summary?.filters?.skus?.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <span className="filter-label">Year</span>
          <select
            className="filter-select"
            value={filters.year}
            onChange={(e) => { setFilters((f) => ({ ...f, year: e.target.value })); setPage(0); }}
          >
            <option value="">All Years</option>
            {summary?.filters?.years?.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <span className="filter-label">Month</span>
          <input
            className="filter-input"
            type="month"
            value={filters.month}
            onChange={(e) => { setFilters((f) => ({ ...f, month: e.target.value })); setPage(0); }}
          />
        </div>

        <div className="filter-group">
          <span className="filter-label">Start Date</span>
          <input
            className="filter-input"
            type="date"
            value={filters.startDate}
            onChange={(e) => { setFilters((f) => ({ ...f, startDate: e.target.value })); setPage(0); }}
          />
        </div>

        <div className="filter-group">
          <span className="filter-label">End Date</span>
          <input
            className="filter-input"
            type="date"
            value={filters.endDate}
            onChange={(e) => { setFilters((f) => ({ ...f, endDate: e.target.value })); setPage(0); }}
          />
        </div>

        <button className="filter-btn filter-btn-reset" onClick={handleReset}>
          Reset
        </button>
      </div>

      {/* Metrics */}
      {orders?.summary && (
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Total Revenue</div>
            <div className="metric-value">{formatCurrency(parseFloat(orders.summary.total_revenue))}</div>
          </div>
          <div className="metric-card accent-green">
            <div className="metric-label">Total Profit</div>
            <div className={`metric-value ${parseFloat(orders.summary.total_profit) >= 0 ? "positive" : "negative"}`}>
              {formatCurrency(parseFloat(orders.summary.total_profit))}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Orders</div>
            <div className="metric-value">{formatNumber(parseInt(orders.summary.total_orders))}</div>
          </div>
          <div className="metric-card accent-orange">
            <div className="metric-label">Avg Profit/Order</div>
            <div className="metric-value">{formatCurrency(parseFloat(orders.summary.avg_profit_per_order))}</div>
          </div>
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <>
          <div className="charts-grid">
            {/* Monthly Revenue & Profit */}
            <div className="card chart-full-width">
              <div className="card-header">
                <div>
                  <div className="card-title">Monthly Revenue & Profit</div>
                  <div className="card-subtitle">Click a bar to filter by month</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    formatter={(value: any) => formatCurrency(Number(value))}
                  />
                  <Legend />
                  <Bar
                    dataKey="revenue"
                    fill="#6366f1"
                    name="Revenue"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(data: any) => handleMonthClick(data.month)}
                  />
                  <Line type="monotone" dataKey="profit" stroke="#10b981" name="Profit" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Daily Sales (Last 30 Days) */}
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Last 30 Days</div>
                  <div className="card-subtitle">Daily revenue trend</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    formatter={(value: any) => formatCurrency(Number(value))}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="rgba(99,102,241,0.15)" strokeWidth={2} />
                  <Area type="monotone" dataKey="profit" stroke="#10b981" fill="rgba(16,185,129,0.1)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Top SKUs by Revenue */}
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Top SKUs by Revenue</div>
                  <div className="card-subtitle">Click to filter by SKU</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={skuData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="revenue"
                    nameKey="sku"
                    cursor="pointer"
                    onClick={(data: any) => handleSkuClick(data.fullSku)}
                  >
                    {skuData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    formatter={(value: any) => formatCurrency(Number(value))}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* Orders Tab */}
      {activeTab === "orders" && orders && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Order Details</div>
            <div className="card-subtitle">{orders.pagination.total} total orders</div>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Date</th>
                  <th>SKU</th>
                  <th>Status</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>COGS</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                {orders.orders.map((o, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                      {String(o.amazon_order_id || "").slice(0, 15)}
                    </td>
                    <td>{o.purchase_date ? new Date(String(o.purchase_date)).toLocaleDateString("en-IN") : "—"}</td>
                    <td
                      style={{ cursor: "pointer", color: "var(--accent-hover)" }}
                      onClick={() => handleSkuClick(String(o.sku))}
                    >
                      {String(o.sku || "").slice(0, 20)}
                    </td>
                    <td>
                      <span className={`badge ${
                        o.order_status === "Shipped" ? "badge-success" :
                        o.order_status === "Pending" ? "badge-warning" :
                        o.order_status === "Cancelled" ? "badge-danger" :
                        "badge-info"
                      }`}>
                        {String(o.order_status || "Unknown")}
                      </span>
                    </td>
                    <td>{String(o.quantity || 0)}</td>
                    <td>{formatCurrency(Number(o.item_price || 0))}</td>
                    <td>{o.cogs_price != null ? formatCurrency(Number(o.cogs_price)) : "—"}</td>
                    <td>
                      <span style={{
                        color: Number(o.profit || 0) >= 0 ? "var(--success)" : "var(--danger)",
                        fontWeight: 600,
                      }}>
                        {o.profit != null ? formatCurrency(Number(o.profit)) : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              ← Previous
            </button>
            <span className="pagination-info">
              Page {page + 1} of {Math.ceil((orders.pagination.total || 1) / 50)}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * 50 >= orders.pagination.total}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Predictions Tab */}
      {activeTab === "predictions" && predictions && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Sales Forecast (6 Months)</div>
                <div className="card-subtitle">{predictions.methodology}</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={forecastChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                  formatter={(value: any) => value != null ? formatCurrency(Number(value)) : "—"}
                />
                <Legend />
                <Area type="monotone" dataKey="actual_revenue" stroke="#6366f1" fill="rgba(99,102,241,0.15)" name="Actual Revenue" strokeWidth={2} />
                <Line type="monotone" dataKey="predicted_revenue" stroke="#f59e0b" name="Predicted Revenue" strokeWidth={2} strokeDasharray="5 5" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Forecast Table */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Predicted Monthly Revenue</div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Predicted Revenue</th>
                    <th>Predicted Units</th>
                    <th>Confidence Range</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.aggregateForecasts.map((f, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{f.month}</td>
                      <td>{formatCurrency(f.predicted_revenue)}</td>
                      <td>{formatNumber(f.predicted_quantity)}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {formatNumber(f.confidence_lower)} – {formatNumber(f.confidence_upper)} units
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
