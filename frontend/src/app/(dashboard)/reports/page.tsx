"use client";

import { useState } from "react";

interface ReportConfig {
  type: "sales" | "inventory" | "cogs" | "profit";
  period?: "weekly" | "monthly" | "yearly";
  startDate?: string;
  endDate?: string;
  sku?: string;
  brand?: string;
}

interface ReportCard {
  type: ReportConfig["type"];
  title: string;
  icon: string;
  description: string;
  hasPeriod: boolean;
  hasDateRange: boolean;
  sheets: string[];
}

const REPORT_CARDS: ReportCard[] = [
  {
    type: "sales",
    title: "Sales Report",
    icon: "📊",
    description: "Complete sales data by period, SKU, and state. Includes raw order-level detail.",
    hasPeriod: true,
    hasDateRange: true,
    sheets: ["Sales by Period", "By SKU", "By State", "Raw Orders"],
  },
  {
    type: "inventory",
    title: "Inventory Report",
    icon: "📦",
    description: "Current FBA stock levels and replenishment recommendations based on 90-day velocity.",
    hasPeriod: false,
    hasDateRange: false,
    sheets: ["Current Inventory", "Inventory Needed"],
  },
  {
    type: "cogs",
    title: "COGS & Product Specs",
    icon: "💰",
    description: "All SKU costs including product dimensions, volumetric and chargeable weights.",
    hasPeriod: false,
    hasDateRange: false,
    sheets: ["COGS & Product Specs"],
  },
  {
    type: "profit",
    title: "P&L Report",
    icon: "📈",
    description: "Profit & Loss breakdown by month and brand with margin percentages.",
    hasPeriod: false,
    hasDateRange: true,
    sheets: ["P&L Monthly", "P&L by Brand"],
  },
];

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, ReportConfig>>({
    sales: { type: "sales", period: "monthly", startDate: "", endDate: "" },
    inventory: { type: "inventory" },
    cogs: { type: "cogs" },
    profit: { type: "profit", startDate: "", endDate: "" },
  });
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const updateConfig = (type: string, key: string, value: string) => {
    setConfigs(prev => ({
      ...prev,
      [type]: { ...prev[type], [key]: value },
    }));
  };

  const handleDownload = async (card: ReportCard) => {
    const cfg = configs[card.type];
    setDownloading(card.type);

    try {
      const params = new URLSearchParams({ type: card.type });
      if (cfg.period) params.set("period", cfg.period);
      if (cfg.startDate) params.set("startDate", cfg.startDate);
      if (cfg.endDate) params.set("endDate", cfg.endDate);

      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Failed to generate report", "error");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      a.download = filenameMatch?.[1] || `report_${card.type}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`${card.title} downloaded successfully`, "success");
    } catch {
      showToast("Network error — could not download report", "error");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">
          Export your data to Excel — sales, inventory, COGS, and P&amp;L
        </p>
      </div>

      {/* Info banner */}
      <div className="card" style={{ marginBottom: 24, padding: "14px 20px", background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
          <span style={{ fontSize: 16 }}>ℹ️</span>
          <span>
            All reports are generated from your live database and downloaded as <strong style={{ color: "var(--text)" }}>.xlsx</strong> files
            compatible with Excel, Google Sheets, and Numbers.
          </span>
        </div>
      </div>

      {/* Report cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 20 }}>
        {REPORT_CARDS.map((card) => {
          const cfg = configs[card.type];
          const isDownloading = downloading === card.type;

          return (
            <div key={card.type} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Card header */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, flexShrink: 0,
                }}>
                  {card.icon}
                </div>
                <div>
                  <div className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>{card.title}</div>
                  <div className="card-subtitle" style={{ fontSize: 12 }}>{card.description}</div>
                </div>
              </div>

              {/* Sheets preview */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {card.sheets.map(s => (
                  <span key={s} style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                    background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)",
                    color: "var(--success)",
                  }}>
                    📋 {s}
                  </span>
                ))}
              </div>

              {/* Filters */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                {card.hasPeriod && (
                  <div className="filter-group" style={{ minWidth: 140 }}>
                    <label className="filter-label">Grouping Period</label>
                    <select
                      className="filter-select"
                      value={cfg.period || "monthly"}
                      onChange={e => updateConfig(card.type, "period", e.target.value)}
                    >
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                )}
                {card.hasDateRange && (
                  <>
                    <div className="filter-group">
                      <label className="filter-label">From</label>
                      <input
                        className="filter-input"
                        type="date"
                        value={cfg.startDate || ""}
                        onChange={e => updateConfig(card.type, "startDate", e.target.value)}
                        style={{ width: 140 }}
                      />
                    </div>
                    <div className="filter-group">
                      <label className="filter-label">To</label>
                      <input
                        className="filter-input"
                        type="date"
                        value={cfg.endDate || ""}
                        onChange={e => updateConfig(card.type, "endDate", e.target.value)}
                        style={{ width: 140 }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Download button */}
              <button
                className="btn btn-primary"
                onClick={() => handleDownload(card)}
                disabled={isDownloading}
                style={{ alignSelf: "flex-start", minWidth: 180 }}
              >
                {isDownloading ? (
                  <>
                    <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    Generating...
                  </>
                ) : (
                  `⬇ Download ${card.title}`
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Quick export presets */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div className="card-title">Quick Export Presets</div>
          <div className="card-subtitle">Common report combinations with one click</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "4px 0" }}>
          {[
            { label: "This Month Sales", type: "sales" as const, period: "monthly" as const, thisMonth: true },
            { label: "This Year Sales", type: "sales" as const, period: "yearly" as const, thisYear: true },
            { label: "Last 7 Days Sales", type: "sales" as const, period: "weekly" as const, last7: true },
            { label: "Last 30 Days Sales", type: "sales" as const, period: "monthly" as const, last30: true },
          ].map((preset) => {
            const isDownloading = downloading === `preset_${preset.label}`;
            return (
              <button
                key={preset.label}
                className="btn btn-ghost btn-sm"
                disabled={!!downloading}
                onClick={async () => {
                  setDownloading(`preset_${preset.label}`);
                  try {
                    const params = new URLSearchParams({ type: preset.type, period: preset.period });
                    const today = new Date();
                    if ("thisMonth" in preset) {
                      const y = today.getFullYear(), m = String(today.getMonth() + 1).padStart(2, "0");
                      params.set("startDate", `${y}-${m}-01`);
                      params.set("endDate", today.toISOString().slice(0, 10));
                    } else if ("thisYear" in preset) {
                      params.set("startDate", `${today.getFullYear()}-01-01`);
                      params.set("endDate", today.toISOString().slice(0, 10));
                    } else if ("last7" in preset) {
                      const d = new Date(today); d.setDate(d.getDate() - 7);
                      params.set("startDate", d.toISOString().slice(0, 10));
                      params.set("endDate", today.toISOString().slice(0, 10));
                    } else if ("last30" in preset) {
                      const d = new Date(today); d.setDate(d.getDate() - 30);
                      params.set("startDate", d.toISOString().slice(0, 10));
                      params.set("endDate", today.toISOString().slice(0, 10));
                    }

                    const res = await fetch(`/api/reports?${params}`);
                    if (!res.ok) { showToast("Failed to generate report", "error"); return; }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    const disp = res.headers.get("Content-Disposition") || "";
                    const fn = disp.match(/filename="([^"]+)"/)?.[1] || `${preset.label.replace(/ /g, "_")}.xlsx`;
                    a.download = fn;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showToast(`${preset.label} downloaded`, "success");
                  } catch {
                    showToast("Network error", "error");
                  } finally {
                    setDownloading(null);
                  }
                }}
              >
                {isDownloading ? "⏳" : "⬇"} {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
