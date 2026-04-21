"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ──────────────────────────────────────────────

interface ReplenishmentConfig {
  lead_time_days: number;
  coverage_days: number;
  safety_factor: number;
}

interface ReplenishmentSummary {
  total_skus_analyzed: number;
  critical_skus: number;
  urgent_skus: number;
  low_skus: number;
  healthy_skus: number;
  overstock_skus: number;
  total_reorder_units: number;
  total_reorder_value: number;
  avg_days_of_coverage: number;
}

interface SkuRecommendation {
  sku: string;
  article_number: string | null;
  asin: string | null;
  weighted_velocity: number;
  velocity_7d: number;
  velocity_14d: number;
  velocity_30d: number;
  velocity_90d: number;
  trend: "accelerating" | "stable" | "declining";
  lead_time_demand: number;
  target_stock_2m: number;
  current_stock: number;
  in_transit: number;
  reorder_qty: number;
  reorder_value: number;
  days_of_coverage: number;
  urgency: "CRITICAL" | "URGENT" | "LOW" | "HEALTHY" | "OVERSTOCK";
  warehouse_allocation: Record<string, number>;
}

interface WarehouseSummary {
  warehouse: string;
  total_current_stock: number;
  total_in_transit: number;
  total_reorder_needed: number;
  skus_critical: number;
  skus_urgent: number;
  skus_total: number;
}

// ── Constants ──────────────────────────────────────────

const URGENCY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  URGENT: "#f59e0b",
  LOW: "#3b82f6",
  HEALTHY: "#10b981",
  OVERSTOCK: "#6b7280",
};

const URGENCY_LABELS: Record<string, string> = {
  CRITICAL: "🔴 Critical",
  URGENT: "🟠 Urgent",
  LOW: "🟡 Low",
  HEALTHY: "🟢 Healthy",
  OVERSTOCK: "⚪ Overstock",
};

const TREND_ICONS: Record<string, string> = {
  accelerating: "📈",
  stable: "➡️",
  declining: "📉",
};

type VelocityWindow = "7d" | "14d" | "weighted" | "30d" | "90d";

const WINDOW_OPTIONS: { value: VelocityWindow; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "weighted", label: "Weighted" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

const WINDOW_DESCRIPTIONS: Record<VelocityWindow, string> = {
  "7d": "Most reactive — best for new SKUs or active campaigns",
  "14d": "Balances recency with short-term stability",
  "weighted": "Default — blends all windows, best for most SKUs",
  "30d": "Reliable for stable products, lags on sudden changes",
  "90d": "Conservative long-term baseline, misses recent trends",
};

const WH_COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"];

// ── Main Component ─────────────────────────────────────

export default function ReplenishmentPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "sku" | "warehouse">("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<ReplenishmentConfig | null>(null);
  const [summary, setSummary] = useState<ReplenishmentSummary | null>(null);
  const [skuRecs, setSkuRecs] = useState<SkuRecommendation[]>([]);
  const [warehouseSummary, setWarehouseSummary] = useState<WarehouseSummary[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string>("");

  const [searchTerm, setSearchTerm] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("ALL");
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>("urgency");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [velocityWindow, setVelocityWindow] = useState<VelocityWindow>("weighted");
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  // Close download menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/replenishment?window=${velocityWindow}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConfig(data.config);
      setSummary(data.summary);
      setSkuRecs(data.skuRecommendations || []);
      setWarehouseSummary(data.warehouseSummary || []);
      setGeneratedAt(data.generated_at || "");
    } catch (e: any) {
      setError(e.message || "Failed to load replenishment data");
    } finally {
      setLoading(false);
    }
  }, [velocityWindow]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Derived data ─────────────────────────────────────

  const urgencyOrder: Record<string, number> = {
    CRITICAL: 0, URGENT: 1, LOW: 2, HEALTHY: 3, OVERSTOCK: 4,
  };

  const filteredSkus = skuRecs
    .filter((r) => {
      const matchesSearch =
        r.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.asin || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.article_number || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchesUrgency = urgencyFilter === "ALL" || r.urgency === urgencyFilter;
      return matchesSearch && matchesUrgency;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "urgency":
          cmp = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
          break;
        case "velocity":
          cmp = b.weighted_velocity - a.weighted_velocity;
          break;
        case "reorder":
          cmp = b.reorder_qty - a.reorder_qty;
          break;
        case "coverage":
          cmp = a.days_of_coverage - b.days_of_coverage;
          break;
        case "stock":
          cmp = a.current_stock - b.current_stock;
          break;
        default:
          cmp = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

  const urgencyPieData = summary
    ? [
        { name: "Critical", value: summary.critical_skus, color: URGENCY_COLORS.CRITICAL },
        { name: "Urgent", value: summary.urgent_skus, color: URGENCY_COLORS.URGENT },
        { name: "Low", value: summary.low_skus, color: URGENCY_COLORS.LOW },
        { name: "Healthy", value: summary.healthy_skus, color: URGENCY_COLORS.HEALTHY },
        { name: "Overstock", value: summary.overstock_skus, color: URGENCY_COLORS.OVERSTOCK },
      ].filter((d) => d.value > 0)
    : [];

  // Warehouse chart data
  const whChartData = warehouseSummary.map((w) => ({
    warehouse: w.warehouse,
    current_stock: w.total_current_stock,
    in_transit: w.total_in_transit,
    reorder_needed: w.total_reorder_needed,
  }));

  // Top critical SKUs bar chart (top 15 by reorder qty)
  const topReorderSkus = skuRecs
    .filter((r) => r.reorder_qty > 0)
    .slice(0, 15)
    .map((r) => ({
      sku: r.sku.length > 12 ? r.sku.slice(0, 12) + "…" : r.sku,
      fullSku: r.sku,
      article_number: r.article_number,
      reorder: r.reorder_qty,
      current: r.current_stock,
      urgency: r.urgency,
      color: URGENCY_COLORS[r.urgency],
    }));

  // ── CSV Export (all filtered SKUs) ────────────────────

  const exportCSV = () => {
    const headers = [
      "SKU", "Article No", "ASIN", "Urgency", "Trend", "Daily Velocity",
      "7d Velocity", "14d Velocity", "30d Velocity", "90d Velocity",
      "Lead Time Demand (15d)", "Target Stock (2mo)",
      "Current Stock", "In Transit", "Reorder Qty", "Reorder Value (₹)",
      "Days of Coverage",
      ...warehouseSummary.map((w) => `WH: ${w.warehouse}`),
    ];

    const rows = filteredSkus.map((r) => [
      r.sku,
      r.article_number || "",
      r.asin || "",
      r.urgency,
      r.trend,
      r.weighted_velocity,
      r.velocity_7d,
      r.velocity_14d,
      r.velocity_30d,
      r.velocity_90d,
      r.lead_time_demand,
      r.target_stock_2m,
      r.current_stock,
      r.in_transit,
      r.reorder_qty,
      r.reorder_value,
      r.days_of_coverage,
      ...warehouseSummary.map((w) => r.warehouse_allocation[w.warehouse] || 0),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replenishment_plan_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Download Critical+Urgent report (dynamic, server-generated) ──

  const downloadReport = async (format: "xlsx" | "csv") => {
    setDownloadLoading(true);
    setShowDownloadMenu(false);
    try {
      const res = await fetch(`/api/inventory/replenishment/export?window=${velocityWindow}&format=${format}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `replenishment_critical_urgent_${dateStr}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setDownloadLoading(false);
    }
  };

  // ── Sort handler ─────────────────────────────────────

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortIcon = (field: string) => {
    if (sortField !== field) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  // ── Loading / Error states ───────────────────────────

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Calculating replenishment recommendations...
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Failed to load data</div>
        <div style={{ color: "var(--text-muted)", marginBottom: 24 }}>{error}</div>
        <button className="btn btn-primary" onClick={fetchData}>Retry</button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 className="page-title">Replenishment Planning</h1>
          <p className="page-subtitle">
            Lead-time-aware demand projection · {config?.lead_time_days}d lead time · {config?.coverage_days}d target coverage · {Math.round(((config?.safety_factor || 1.25) - 1) * 100)}% safety buffer
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{
              display: "inline-flex",
              background: "rgba(255,255,255,0.04)",
              borderRadius: 10,
              padding: 3,
              border: "1px solid rgba(255,255,255,0.08)",
            }}>
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVelocityWindow(opt.value)}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: velocityWindow === opt.value ? 600 : 400,
                    color: velocityWindow === opt.value ? "#fff" : "var(--text-muted)",
                    background: velocityWindow === opt.value
                      ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                      : "transparent",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {generatedAt && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Updated: {new Date(generatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button className="btn btn-primary" onClick={fetchData} style={{ fontSize: 13 }}>
              🔄 Refresh
            </button>
            <button className="btn" onClick={exportCSV} style={{ fontSize: 13, background: "rgba(99,102,241,0.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)" }}>
              📥 Export CSV
            </button>
            {/* Download Critical+Urgent Report */}
            <div ref={downloadMenuRef} style={{ position: "relative", display: "inline-block" }}>
              <button
                className="btn"
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                disabled={downloadLoading}
                style={{
                  fontSize: 13,
                  background: downloadLoading
                    ? "rgba(239,68,68,0.25)"
                    : "linear-gradient(135deg, rgba(239,68,68,0.2), rgba(245,158,11,0.2))",
                  color: downloadLoading ? "#fca5a5" : "#fbbf24",
                  border: "1px solid rgba(245,158,11,0.35)",
                  cursor: downloadLoading ? "wait" : "pointer",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {downloadLoading ? (
                  <>
                    <span style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(251,191,36,0.3)",
                      borderTopColor: "#fbbf24",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                      marginRight: 6,
                      verticalAlign: "middle",
                    }} />
                    Generating…
                  </>
                ) : (
                  "📊 Download Report"
                )}
              </button>
              {showDownloadMenu && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    background: "#1e293b",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 10,
                    padding: 6,
                    zIndex: 100,
                    minWidth: 200,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                    animation: "fadeIn 0.15s ease",
                  }}
                >
                  <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                    Critical & Urgent SKUs Report
                  </div>
                  <button
                    onClick={() => downloadReport("xlsx")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 12px",
                      background: "transparent",
                      border: "none",
                      borderRadius: 6,
                      color: "#e2e8f0",
                      fontSize: 13,
                      cursor: "pointer",
                      transition: "background 0.15s",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.15)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ fontSize: 18 }}>📗</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>Excel (.xlsx)</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Multi-sheet with warehouse breakdown</div>
                    </div>
                  </button>
                  <button
                    onClick={() => downloadReport("csv")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 12px",
                      background: "transparent",
                      border: "none",
                      borderRadius: 6,
                      color: "#e2e8f0",
                      fontSize: 13,
                      cursor: "pointer",
                      transition: "background 0.15s",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.15)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ fontSize: 18 }}>📄</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>CSV (.csv)</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Flat file for quick import</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", textAlign: "right" }}>
            {WINDOW_DESCRIPTIONS[velocityWindow]}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
          Overview
        </button>
        <button className={`tab ${activeTab === "sku" ? "active" : ""}`} onClick={() => setActiveTab("sku")}>
          SKU Recommendations
        </button>
        <button className={`tab ${activeTab === "warehouse" ? "active" : ""}`} onClick={() => setActiveTab("warehouse")}>
          Warehouse Plan
        </button>
      </div>

      {/* ═══════════════════ METRICS ═══════════════════ */}
      {summary && (
        <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          <div className="metric-card" style={{ borderLeft: "3px solid #ef4444" }}>
            <div className="metric-label">Critical SKUs</div>
            <div className="metric-value" style={{ color: "#ef4444" }}>{summary.critical_skus}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Stock out in &lt;15 days</div>
          </div>
          <div className="metric-card" style={{ borderLeft: "3px solid #f59e0b" }}>
            <div className="metric-label">Urgent SKUs</div>
            <div className="metric-value" style={{ color: "#f59e0b" }}>{summary.urgent_skus}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>&lt;30 days coverage</div>
          </div>
          <div className="metric-card" style={{ borderLeft: "3px solid #6366f1" }}>
            <div className="metric-label">Total Reorder</div>
            <div className="metric-value">{summary.total_reorder_units.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>units needed</div>
          </div>
          <div className="metric-card" style={{ borderLeft: "3px solid #8b5cf6" }}>
            <div className="metric-label">Reorder Value</div>
            <div className="metric-value">₹{summary.total_reorder_value.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>estimated at COGS</div>
          </div>
          <div className="metric-card" style={{ borderLeft: "3px solid #10b981" }}>
            <div className="metric-label">Avg Coverage</div>
            <div className="metric-value">{summary.avg_days_of_coverage}d</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>across active SKUs</div>
          </div>
          <div className="metric-card" style={{ borderLeft: "3px solid #06b6d4" }}>
            <div className="metric-label">SKUs Analyzed</div>
            <div className="metric-value">{summary.total_skus_analyzed}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>inventory + sales</div>
          </div>
        </div>
      )}

      {/* ═══════════════════ OVERVIEW TAB ═══════════════════ */}
      {activeTab === "overview" && (
        <>
          <div className="charts-grid">
            {/* Urgency Distribution */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Urgency Distribution</div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={urgencyPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {urgencyPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Warehouse Reorder Needs */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Warehouse Reorder Needs</div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={whChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="warehouse" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="current_stock" fill="#6366f1" name="Current Stock" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="in_transit" fill="#8b5cf6" name="In Transit" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="reorder_needed" fill="#ef4444" name="Reorder Needed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top SKUs Needing Reorder */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Top SKUs Needing Reorder</div>
                <div className="card-subtitle">Highest reorder quantity, colored by urgency</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(300, topReorderSkus.length * 28)}>
              <BarChart data={topReorderSkus} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis type="category" dataKey="sku" width={120} tick={{ fill: "#e2e8f0", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                  formatter={(value: any, name: any) => [value?.toLocaleString?.() ?? value, String(name ?? "")]}
                />
                <Legend />
                <Bar dataKey="current" fill="#334155" name="Current Stock" radius={[0, 4, 4, 0]} stackId="a" />
                <Bar dataKey="reorder" name="Reorder Qty" radius={[0, 4, 4, 0]} stackId="a">
                  {topReorderSkus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Lead Time Alert Summary */}
          {summary && summary.critical_skus > 0 && (
            <div className="card" style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.02))", borderLeft: "3px solid #ef4444" }}>
              <div className="card-header">
                <div>
                  <div className="card-title" style={{ color: "#fca5a5" }}>⚠️ Lead Time Stockout Alert</div>
                  <div className="card-subtitle">
                    {summary.critical_skus} SKU{summary.critical_skus > 1 ? "s" : ""} will stock out
                    within the 15-day lead time at current sales velocity
                  </div>
                </div>
              </div>
              <div className="table-container" style={{ maxHeight: 300, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Daily Velocity</th>
                      <th>Current Stock</th>
                      <th>Days Left</th>
                      <th>Lead Time Demand</th>
                      <th>Deficit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuRecs
                      .filter((r) => r.urgency === "CRITICAL")
                      .slice(0, 20)
                      .map((r) => (
                        <tr key={r.sku}>
                          <td style={{ fontWeight: 600, color: "#fca5a5" }}>
                            <div>{r.sku}</div>
                            {r.article_number && <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: "normal" }}>Art: {r.article_number}</div>}
                          </td>
                          <td>{r.weighted_velocity}/day</td>
                          <td>{r.current_stock.toLocaleString()}</td>
                          <td style={{ color: "#ef4444", fontWeight: 700 }}>{r.days_of_coverage}d</td>
                          <td>{r.lead_time_demand.toLocaleString()}</td>
                          <td style={{ color: "#ef4444", fontWeight: 700 }}>
                            {Math.max(0, r.lead_time_demand - r.current_stock - r.in_transit).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ SKU RECOMMENDATIONS TAB ═══════════════════ */}
      {activeTab === "sku" && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="card-title">SKU Replenishment Recommendations</div>
              <div className="card-subtitle">
                {filteredSkus.length} SKUs · Click a row to see warehouse allocation
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ position: "relative", width: 260 }}>
                <svg
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 16,
                    height: 16,
                    color: "var(--text-muted)",
                    pointerEvents: "none",
                  }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  className="filter-input search-input"
                  type="text"
                  placeholder="Search SKU or ASIN..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ width: "100%", paddingLeft: 34 }}
                />
              </div>
              <select
                className="filter-input"
                value={urgencyFilter}
                onChange={(e) => setUrgencyFilter(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              >
                <option value="ALL">All Urgencies</option>
                <option value="CRITICAL">🔴 Critical</option>
                <option value="URGENT">🟠 Urgent</option>
                <option value="LOW">🟡 Low</option>
                <option value="HEALTHY">🟢 Healthy</option>
                <option value="OVERSTOCK">⚪ Overstock</option>
              </select>
            </div>
          </div>
          <div className="table-container" style={{ maxHeight: 700, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ cursor: "pointer" }} onClick={() => handleSort("urgency")}>
                    Status {sortIcon("urgency")}
                  </th>
                  <th>SKU</th>
                  <th>Trend</th>
                  <th style={{ cursor: "pointer" }} onClick={() => handleSort("velocity")}>
                    Velocity/Day {sortIcon("velocity")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => handleSort("stock")}>
                    Current {sortIcon("stock")}
                  </th>
                  <th>In Transit</th>
                  <th>Lead Time Need</th>
                  <th>2M Target</th>
                  <th style={{ cursor: "pointer" }} onClick={() => handleSort("reorder")}>
                    Reorder Qty {sortIcon("reorder")}
                  </th>
                  <th>Reorder ₹</th>
                  <th style={{ cursor: "pointer" }} onClick={() => handleSort("coverage")}>
                    Coverage {sortIcon("coverage")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSkus.map((r) => (
                  <>
                    <tr
                      key={r.sku}
                      onClick={() => setExpandedSku(expandedSku === r.sku ? null : r.sku)}
                      style={{
                        cursor: "pointer",
                        borderLeft: `3px solid ${URGENCY_COLORS[r.urgency]}`,
                        transition: "background 0.15s",
                      }}
                    >
                      <td>
                        <span
                          className={`badge ${
                            r.urgency === "CRITICAL" ? "badge-danger" :
                            r.urgency === "URGENT" ? "badge-warning" :
                            r.urgency === "HEALTHY" ? "badge-success" : ""
                          }`}
                          style={
                            r.urgency === "LOW"
                              ? { background: "rgba(59,130,246,0.15)", color: "#60a5fa" }
                              : r.urgency === "OVERSTOCK"
                              ? { background: "rgba(107,114,128,0.15)", color: "#9ca3af" }
                              : undefined
                          }
                        >
                          {URGENCY_LABELS[r.urgency]}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: "var(--accent-hover)" }}>
                        <div>{r.sku}</div>
                        {r.article_number && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Art: {r.article_number}</div>}
                        {r.asin && <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{r.asin}</div>}
                      </td>
                      <td style={{ fontSize: 16, textAlign: "center" }} title={r.trend}>
                        {TREND_ICONS[r.trend]}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.weighted_velocity}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          7d: {r.velocity_7d} · 30d: {r.velocity_30d}
                        </div>
                      </td>
                      <td>
                        <span style={{ color: r.current_stock === 0 ? "#ef4444" : "inherit", fontWeight: r.current_stock === 0 ? 700 : 400 }}>
                          {r.current_stock.toLocaleString()}
                        </span>
                      </td>
                      <td style={{ color: r.in_transit > 0 ? "#8b5cf6" : "var(--text-muted)" }}>
                        {r.in_transit > 0 ? r.in_transit.toLocaleString() : "—"}
                      </td>
                      <td>{r.lead_time_demand.toLocaleString()}</td>
                      <td>{r.target_stock_2m.toLocaleString()}</td>
                      <td style={{
                        fontWeight: 700,
                        color: r.reorder_qty > 0 ? URGENCY_COLORS[r.urgency] : "#10b981",
                      }}>
                        {r.reorder_qty > 0 ? r.reorder_qty.toLocaleString() : "✓"}
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        {r.reorder_value > 0 ? `₹${r.reorder_value.toLocaleString()}` : "—"}
                      </td>
                      <td style={{
                        fontWeight: 600,
                        color: r.days_of_coverage < 15 ? "#ef4444" :
                              r.days_of_coverage < 30 ? "#f59e0b" :
                              r.days_of_coverage < 45 ? "#3b82f6" : "#10b981",
                      }}>
                        {r.days_of_coverage >= 999 ? "∞" : `${r.days_of_coverage}d`}
                      </td>
                    </tr>
                    {/* Expanded warehouse allocation row */}
                    {expandedSku === r.sku && Object.keys(r.warehouse_allocation).length > 0 && (
                      <tr key={`${r.sku}-wh`}>
                        <td colSpan={11} style={{ padding: "12px 16px", background: "rgba(99,102,241,0.05)" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#a5b4fc" }}>
                            📦 Warehouse Allocation for {r.sku}
                          </div>
                          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                            {Object.entries(r.warehouse_allocation)
                              .filter(([, qty]) => qty > 0)
                              .sort(([, a], [, b]) => b - a)
                              .map(([wh, qty], i) => (
                                <div
                                  key={wh}
                                  style={{
                                    padding: "8px 14px",
                                    background: "rgba(255,255,255,0.04)",
                                    borderRadius: 8,
                                    border: `1px solid ${WH_COLORS[i % WH_COLORS.length]}33`,
                                    minWidth: 100,
                                  }}
                                >
                                  <div style={{ fontSize: 11, color: WH_COLORS[i % WH_COLORS.length], fontWeight: 600 }}>
                                    {wh}
                                  </div>
                                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                                    {qty.toLocaleString()}
                                  </div>
                                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>units</div>
                                </div>
                              ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {filteredSkus.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>No SKUs match your search</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════ WAREHOUSE PLAN TAB ═══════════════════ */}
      {activeTab === "warehouse" && (
        <>
          {/* Warehouse Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
            {warehouseSummary.map((w, i) => (
              <div
                key={w.warehouse}
                className="card"
                style={{
                  padding: "16px 20px",
                  borderTop: `3px solid ${WH_COLORS[i % WH_COLORS.length]}`,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Warehouse</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: WH_COLORS[i % WH_COLORS.length], marginBottom: 12 }}>
                  {w.warehouse}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Current Stock</span>
                    <span style={{ fontWeight: 600 }}>{w.total_current_stock.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>In Transit</span>
                    <span style={{ fontWeight: 600, color: "#8b5cf6" }}>{w.total_in_transit.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Reorder Needed</span>
                    <span style={{ fontWeight: 700, color: w.total_reorder_needed > 0 ? "#ef4444" : "#10b981" }}>
                      {w.total_reorder_needed.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>SKUs</span>
                    <span style={{ fontWeight: 600 }}>{w.skus_total}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {w.skus_critical > 0 && (
                      <span className="badge badge-danger" style={{ fontSize: 10 }}>
                        {w.skus_critical} critical
                      </span>
                    )}
                    {w.skus_urgent > 0 && (
                      <span className="badge badge-warning" style={{ fontSize: 10 }}>
                        {w.skus_urgent} urgent
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Warehouse × SKU Reorder Matrix */}
          <div className="card">
            <div className="card-header" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <div className="card-title">Warehouse × SKU Reorder Matrix</div>
                <div className="card-subtitle">Units to send to each warehouse · Only showing SKUs that need reorder</div>
              </div>
              <div style={{ position: "relative", width: 260 }}>
                <svg
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 16,
                    height: 16,
                    color: "var(--text-muted)",
                    pointerEvents: "none",
                  }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  className="filter-input search-input"
                  type="text"
                  placeholder="Search SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ width: "100%", paddingLeft: 34 }}
                />
              </div>
            </div>
            <div className="table-container" style={{ maxHeight: 600, overflowY: "auto", overflowX: "auto" }}>
              <table style={{ minWidth: warehouseSummary.length * 100 + 350 }}>
                <thead>
                  <tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 10, background: "#0f172a", minWidth: 80 }}>Urgency</th>
                    <th style={{ position: "sticky", left: 80, zIndex: 10, background: "#0f172a", minWidth: 120 }}>SKU</th>
                    <th style={{ minWidth: 80, fontWeight: 700, color: "#ef4444" }}>Total Reorder</th>
                    {warehouseSummary.map((w, i) => (
                      <th key={w.warehouse} style={{
                        minWidth: 90,
                        fontSize: 11,
                        fontWeight: 600,
                        color: WH_COLORS[i % WH_COLORS.length],
                        whiteSpace: "nowrap",
                      }}>
                        {w.warehouse}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSkus
                    .filter((r) => r.reorder_qty > 0)
                    .map((r) => (
                      <tr key={r.sku} style={{ borderLeft: `3px solid ${URGENCY_COLORS[r.urgency]}` }}>
                        <td style={{ position: "sticky", left: 0, background: "#0f172a", zIndex: 5 }}>
                          <span
                            className={`badge ${
                              r.urgency === "CRITICAL" ? "badge-danger" :
                              r.urgency === "URGENT" ? "badge-warning" :
                              r.urgency === "HEALTHY" ? "badge-success" : ""
                            }`}
                            style={
                              r.urgency === "LOW"
                                ? { background: "rgba(59,130,246,0.15)", color: "#60a5fa", fontSize: 10 }
                                : r.urgency === "OVERSTOCK"
                                ? { background: "rgba(107,114,128,0.15)", color: "#9ca3af", fontSize: 10 }
                                : { fontSize: 10 }
                            }
                          >
                            {r.urgency}
                          </span>
                        </td>
                        <td style={{
                          fontWeight: 600,
                          color: "var(--accent-hover)",
                          position: "sticky",
                          left: 80,
                          background: "#0f172a",
                          zIndex: 5,
                        }}>
                          <div>{r.sku}</div>
                          {r.article_number && <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: "normal" }}>Art: {r.article_number}</div>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <span className="badge badge-danger">{r.reorder_qty.toLocaleString()}</span>
                        </td>
                        {warehouseSummary.map((w) => {
                          const qty = r.warehouse_allocation[w.warehouse] || 0;
                          return (
                            <td key={w.warehouse} style={{
                              textAlign: "center",
                              fontWeight: qty > 0 ? 600 : 400,
                              color: qty === 0 ? "var(--text-muted)" : "#e2e8f0",
                              background: qty > 0 ? "rgba(239,68,68,0.08)" : "transparent",
                              fontSize: 12,
                              borderLeft: "1px solid rgba(255,255,255,0.04)",
                            }}>
                              {qty > 0 ? qty.toLocaleString() : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  {/* Totals row */}
                  <tr style={{ borderTop: "2px solid rgba(255,255,255,0.15)", fontWeight: 700 }}>
                    <td style={{ position: "sticky", left: 0, background: "#0f172a", zIndex: 5, color: "#a5b4fc" }}>TOTAL</td>
                    <td style={{ position: "sticky", left: 80, background: "#0f172a", zIndex: 5 }} />
                    <td>
                      <span className="badge badge-danger">
                        {filteredSkus.filter(r => r.reorder_qty > 0).reduce((s, r) => s + r.reorder_qty, 0).toLocaleString()}
                      </span>
                    </td>
                    {warehouseSummary.map((w) => (
                      <td key={w.warehouse} style={{
                        textAlign: "center",
                        color: "#a5b4fc",
                        fontSize: 12,
                        borderLeft: "1px solid rgba(255,255,255,0.04)",
                      }}>
                        {filteredSkus
                          .filter(r => r.reorder_qty > 0)
                          .reduce((s, r) => s + (r.warehouse_allocation[w.warehouse] || 0), 0)
                          .toLocaleString()}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
