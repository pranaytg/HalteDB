"use client";

import { useEffect, useRef, useState } from "react";

// Direct backend URL for large uploads (bypasses Vercel 4.5MB body limit).
// Set NEXT_PUBLIC_BACKEND_URL in Vercel env vars to your Render URL.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

interface ReportConfig {
  type: "sales" | "inventory" | "cogs" | "profit" | "amazonInvoices";
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

interface InvoiceStatus {
  tableExists: boolean;
  rowCount: number;
  sourceLabel: string | null;
  latestInvoiceDate: string | null;
  syncWindowDays?: number | null;
}

interface UploadResult {
  status: string;
  message: string;
  totalPdfs: number;
  extracted: number;
  inserted: number;
  skipped: number;
  errors: number;
  errorDetails?: { file: string; error: string }[];
}

const REPORT_CARDS: ReportCard[] = [
  {
    type: "sales",
    title: "Sales Report",
    icon: "📊",
    description: "Complete sales data by period, SKU, and state with raw order-level detail.",
    hasPeriod: true,
    hasDateRange: true,
    sheets: ["Sales by Period", "By SKU", "By State", "Raw Orders"],
  },
  {
    type: "inventory",
    title: "Inventory Report",
    icon: "📦",
    description: "Current inventory, warehouse breakdown, and restock forecasts aligned to the inventory dashboard.",
    hasPeriod: false,
    hasDateRange: false,
    sheets: ["SKU Inventory", "Warehouse Summary", "Warehouse Breakdown", "Restock Predictions", "Warehouse Forecast"],
  },
  {
    type: "cogs",
    title: "COGS & Product Specs",
    icon: "💰",
    description: "Current COGS, estimate metadata, and product dimensions in one export.",
    hasPeriod: false,
    hasDateRange: false,
    sheets: ["COGS & Product Specs"],
  },
  {
    type: "profit",
    title: "P&L Report",
    icon: "📈",
    description: "Monthly and brand-level profitability using the same formulas as the profitability page.",
    hasPeriod: false,
    hasDateRange: true,
    sheets: ["P&L Monthly", "P&L by Brand"],
  },
  {
    type: "amazonInvoices",
    title: "Amazon Sales Invoices",
    icon: "🧾",
    description: "Database-backed invoice export synced from Amazon GST reports into the PowerBISales schema.",
    hasPeriod: false,
    hasDateRange: false,
    sheets: ["Amazon Sales Invoices"],
  },
];

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [syncingInvoices, setSyncingInvoices] = useState(false);
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus | null>(null);
  const [configs, setConfigs] = useState<Record<string, ReportConfig>>({
    sales: { type: "sales", period: "monthly", startDate: "", endDate: "" },
    inventory: { type: "inventory" },
    cogs: { type: "cogs" },
    profit: { type: "profit", startDate: "", endDate: "" },
    amazonInvoices: { type: "amazonInvoices", startDate: "", endDate: "" },
  });
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [folderPath, setFolderPath] = useState("");

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchInvoiceStatus = async () => {
    try {
      const res = await fetch("/api/reports/invoices/sync", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setInvoiceStatus(data);
    } catch {
      // Leave status empty if the backend is unavailable.
    }
  };

  useEffect(() => {
    fetchInvoiceStatus();
  }, []);

  const updateConfig = (type: string, key: string, value: string) => {
    setConfigs((prev) => ({
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
      const link = document.createElement("a");
      link.href = url;
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      link.download = filenameMatch?.[1] || `report_${card.type}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`${card.title} downloaded successfully`, "success");
    } catch {
      showToast("Network error, could not download report", "error");
    } finally {
      setDownloading(null);
    }
  };

  const handleSyncInvoices = async () => {
    setSyncingInvoices(true);
    try {
      const cfg = configs.amazonInvoices;
      const body: { startDate?: string; endDate?: string } = {};
      if (cfg.startDate) body.startDate = cfg.startDate;
      if (cfg.endDate) body.endDate = cfg.endDate;
      if ((body.startDate && !body.endDate) || (!body.startDate && body.endDate)) {
        showToast("Provide both From and To dates, or leave both empty.", "error");
        setSyncingInvoices(false);
        return;
      }

      const res = await fetch("/api/reports/invoices/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showToast(data.error || "Failed to sync invoices", "error");
        return;
      }

      setInvoiceStatus({
        tableExists: !!data.tableExists,
        rowCount: Number(data.rowCount || 0),
        sourceLabel: data.sourceLabel || null,
        latestInvoiceDate: data.latestInvoiceDate || null,
        syncWindowDays: data.syncWindowDays == null ? null : Number(data.syncWindowDays),
      });
      showToast(data.message || "Invoices synced successfully", "success");
    } catch {
      showToast("Network error, could not sync invoices", "error");
    } finally {
      setSyncingInvoices(false);
    }
  };

  const pollUploadStatus = async () => {
    const statusUrl = BACKEND_URL
      ? `${BACKEND_URL}/upload-invoices/status`
      : "/api/reports/invoices/upload-status";
    const maxAttempts = 300; // 10 minutes max
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(statusUrl);
        const data = await res.json().catch(() => ({}));
        if (data.state === "completed") {
          setUploadResult(data as UploadResult);
          showToast(data.message || "Invoices processed successfully", "success");
          fetchInvoiceStatus();
          return;
        }
        if (data.state === "error") {
          showToast(data.message || "Upload processing failed", "error");
          if (data.extracted > 0) setUploadResult(data as UploadResult);
          return;
        }
        // Still processing — update message
        setUploadResult(data as UploadResult);
      } catch {
        // Ignore network blips during polling
      }
    }
    showToast("Upload timed out. Check status later.", "error");
  };

  const handleUploadFile = async (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".zip") && !name.endsWith(".pdf")) {
      showToast("Please upload a .zip or .pdf file containing invoice(s).", "error");
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      // Upload directly to the backend (bypasses Vercel 4.5MB limit)
      const uploadUrl = BACKEND_URL
        ? `${BACKEND_URL}/upload-invoices`
        : "/api/reports/invoices/upload";
      const res = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showToast(data.error || "Failed to upload invoices", "error");
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      showToast(data.message || "Upload started, processing in background…", "success");
      await pollUploadStatus();
    } catch {
      showToast("Network error, could not upload invoices", "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleFolderUpload = async () => {
    const path = folderPath.trim();
    if (!path) {
      showToast("Enter a folder path containing invoice PDFs.", "error");
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      const folderUrl = BACKEND_URL
        ? `${BACKEND_URL}/upload-invoices-folder`
        : "/api/reports/invoices/upload-folder";
      const res = await fetch(folderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: path }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showToast(data.error || "Failed to process folder", "error");
        setUploading(false);
        return;
      }

      showToast(data.message || "Processing started in background…", "success");
      await pollUploadStatus();
    } catch {
      showToast("Network error, could not process folder", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">
          Export live dashboard data and Amazon GST invoice data as Excel files.
        </p>
      </div>

      <div
        className="card"
        style={{
          marginBottom: 24,
          padding: "14px 20px",
          background: "rgba(99,102,241,0.08)",
          borderColor: "rgba(99,102,241,0.3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
          <span style={{ fontSize: 16 }}>ℹ️</span>
          <span>
            Inventory, COGS, and P&amp;L exports now pull from the same live tables and formulas as the rest of the app.
            Amazon invoices export from the <strong style={{ color: "var(--text)" }}>PowerBISales</strong> table after
            <strong style={{ color: "var(--text)" }}> Sync Invoices</strong> pulls the latest GST reports from SP-API.
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 20 }}>
        {REPORT_CARDS.map((card) => {
          const cfg = configs[card.type];
          const isDownloading = downloading === card.type;
          const isInvoiceCard = card.type === "amazonInvoices";
          const canDownloadInvoices = !isInvoiceCard || !!invoiceStatus?.tableExists;

          return (
            <div key={card.type} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: "rgba(99,102,241,0.15)",
                    border: "1px solid rgba(99,102,241,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    flexShrink: 0,
                  }}
                >
                  {card.icon}
                </div>
                <div>
                  <div className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>
                    {card.title}
                  </div>
                  <div className="card-subtitle" style={{ fontSize: 12 }}>
                    {card.description}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {card.sheets.map((sheet) => (
                  <span
                    key={sheet}
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.25)",
                      color: "var(--success)",
                    }}
                  >
                    📋 {sheet}
                  </span>
                ))}
              </div>

              {isInvoiceCard && (
                <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div className="filter-group">
                    <label className="filter-label">Sync from</label>
                    <input
                      className="filter-input"
                      type="date"
                      value={cfg.startDate || ""}
                      onChange={(e) => updateConfig(card.type, "startDate", e.target.value)}
                      style={{ width: 140 }}
                    />
                  </div>
                  <div className="filter-group">
                    <label className="filter-label">Sync to</label>
                    <input
                      className="filter-input"
                      type="date"
                      value={cfg.endDate || ""}
                      onChange={(e) => updateConfig(card.type, "endDate", e.target.value)}
                      style={{ width: 140 }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 240, lineHeight: 1.4 }}>
                    Leave empty to use the default rolling window. Both dates required for an explicit backfill.
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "rgba(15,23,42,0.45)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                >
                  <div>
                    <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Rows in PowerBISales</div>
                    <div style={{ fontWeight: 700 }}>{invoiceStatus ? invoiceStatus.rowCount.toLocaleString("en-IN") : "-"}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Sync source</div>
                    <div style={{ fontWeight: 700 }}>{invoiceStatus?.sourceLabel || "Amazon GST reports (SP-API)"}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Latest invoice date</div>
                    <div style={{ fontWeight: 700 }}>
                      {invoiceStatus?.latestInvoiceDate
                        ? new Date(invoiceStatus.latestInvoiceDate).toLocaleDateString("en-IN")
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Sync window</div>
                    <div style={{ fontWeight: 700 }}>
                      {invoiceStatus?.syncWindowDays ? `${invoiceStatus.syncWindowDays} days` : "Amazon-driven"}
                    </div>
                  </div>
                </div>

                {/* --- ZIP Upload Area --- */}
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? "rgba(99,102,241,0.8)" : "rgba(99,102,241,0.3)"}`,
                    borderRadius: 12,
                    padding: "20px 16px",
                    textAlign: "center",
                    cursor: uploading ? "wait" : "pointer",
                    background: dragOver ? "rgba(99,102,241,0.12)" : "rgba(15,23,42,0.3)",
                    transition: "all 0.2s ease",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.pdf"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadFile(f);
                    }}
                  />
                  {uploading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                      <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                        {(uploadResult as UploadResult & { message?: string })?.message || "Extracting invoices from PDFs\u2026"}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 28, marginBottom: 6 }}>📤</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        Drop a ZIP or PDF file here or click to upload
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        Upload a single invoice PDF or a ZIP containing multiple invoice PDFs. Data will be extracted and inserted into PowerBISales.
                      </div>
                    </>
                  )}
                </div>

                {/* --- OR Folder Path --- */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>OR enter folder path</span>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="filter-input"
                    type="text"
                    placeholder="e.g. C:\\Users\\prana\\...\\Dec 25"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    disabled={uploading}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleFolderUpload}
                    disabled={uploading || !folderPath.trim()}
                    style={{ whiteSpace: "nowrap", minWidth: 130 }}
                  >
                    {uploading ? (
                      <>
                        <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        Processing…
                      </>
                    ) : (
                      "📂 Process Folder"
                    )}
                  </button>
                </div>

                {/* --- Upload Result --- */}
                {uploadResult && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                      gap: 8,
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: uploadResult.errors > 0
                        ? "rgba(239,68,68,0.08)"
                        : "rgba(16,185,129,0.08)",
                      border: `1px solid ${uploadResult.errors > 0 ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)"}`,
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Total PDFs</div>
                      <div style={{ fontWeight: 700 }}>{uploadResult.totalPdfs}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Extracted</div>
                      <div style={{ fontWeight: 700 }}>{uploadResult.extracted}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Inserted</div>
                      <div style={{ fontWeight: 700, color: "var(--success)" }}>{uploadResult.inserted}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Duplicates</div>
                      <div style={{ fontWeight: 700, color: "var(--warning, #f59e0b)" }}>{uploadResult.skipped}</div>
                    </div>
                    {uploadResult.errors > 0 && (
                      <div>
                        <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Errors</div>
                        <div style={{ fontWeight: 700, color: "var(--error, #ef4444)" }}>{uploadResult.errors}</div>
                      </div>
                    )}
                  </div>
                )}
                </>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                {card.hasPeriod && (
                  <div className="filter-group" style={{ minWidth: 140 }}>
                    <label className="filter-label">Grouping Period</label>
                    <select
                      className="filter-select"
                      value={cfg.period || "monthly"}
                      onChange={(e) => updateConfig(card.type, "period", e.target.value)}
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
                        onChange={(e) => updateConfig(card.type, "startDate", e.target.value)}
                        style={{ width: 140 }}
                      />
                    </div>
                    <div className="filter-group">
                      <label className="filter-label">To</label>
                      <input
                        className="filter-input"
                        type="date"
                        value={cfg.endDate || ""}
                        onChange={(e) => updateConfig(card.type, "endDate", e.target.value)}
                        style={{ width: 140 }}
                      />
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleDownload(card)}
                  disabled={isDownloading || !canDownloadInvoices}
                  style={{ alignSelf: "flex-start", minWidth: 180 }}
                  title={!canDownloadInvoices ? "Sync invoices first to populate PowerBISales." : undefined}
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

                {isInvoiceCard && (
                  <button
                    className="btn btn-secondary"
                    onClick={handleSyncInvoices}
                    disabled={syncingInvoices}
                    style={{ minWidth: 170 }}
                  >
                    {syncingInvoices ? (
                      <>
                        <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        Syncing...
                      </>
                    ) : (
                      "↻ Sync Invoices"
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div className="card-title">Quick Export Presets</div>
          <div className="card-subtitle">Common sales report combinations with one click</div>
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
                      const year = today.getFullYear();
                      const month = String(today.getMonth() + 1).padStart(2, "0");
                      params.set("startDate", `${year}-${month}-01`);
                      params.set("endDate", today.toISOString().slice(0, 10));
                    } else if ("thisYear" in preset) {
                      params.set("startDate", `${today.getFullYear()}-01-01`);
                      params.set("endDate", today.toISOString().slice(0, 10));
                    } else if ("last7" in preset) {
                      const start = new Date(today);
                      start.setDate(start.getDate() - 7);
                      params.set("startDate", start.toISOString().slice(0, 10));
                      params.set("endDate", today.toISOString().slice(0, 10));
                    } else if ("last30" in preset) {
                      const start = new Date(today);
                      start.setDate(start.getDate() - 30);
                      params.set("startDate", start.toISOString().slice(0, 10));
                      params.set("endDate", today.toISOString().slice(0, 10));
                    }

                    const res = await fetch(`/api/reports?${params}`);
                    if (!res.ok) {
                      showToast("Failed to generate report", "error");
                      return;
                    }

                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    const disposition = res.headers.get("Content-Disposition") || "";
                    const filename =
                      disposition.match(/filename="([^"]+)"/)?.[1] ||
                      `${preset.label.replace(/ /g, "_")}.xlsx`;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
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

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
