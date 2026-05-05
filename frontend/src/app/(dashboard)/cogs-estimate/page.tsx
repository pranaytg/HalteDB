"use client";

import { useState, useEffect, useCallback } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface EstItem {
  id: number;
  sku: string;
  article_number: string | null;
  brand: string | null;
  category: string | null;
  import_price: number;
  import_currency: string;
  custom_duty: number;
  conversion_rate: number;
  import_price_inr: number;
  gst_percent: number;
  gst_amount: number;
  shipping_cost: number;
  final_price: number;
  margin1_percent: number;
  margin1_amount: number;
  cost_price_halte: number;
  marketing_cost: number;
  margin2_percent: number;
  margin2_amount: number;
  selling_price: number;
  msp_with_gst: number;
  halte_selling_price: number;
  amazon_markup_percent: number;
  amazon_selling_price: number;
  amazon_fee_percent: number;
  profitability: number;
  profit_percent: number;
  last_updated: string;
}

const EDITABLE_FIELDS = [
  { key: "article_number", label: "Article #", type: "text" },
  { key: "brand", label: "Brand", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "import_price", label: "Import Price", type: "number" },
  { key: "import_currency", label: "Currency", type: "select", options: ["USD", "EUR", "GBP", "CNY", "INR"] },
  { key: "custom_duty", label: "Custom Duty (₹)", type: "number" },
  { key: "conversion_rate", label: "Conv. Rate", type: "number" },
  { key: "gst_percent", label: "GST %", type: "number" },
  { key: "shipping_cost", label: "Shipping (₹)", type: "number" },
  { key: "margin1_percent", label: "Margin 1 %", type: "number" },
  { key: "marketing_cost", label: "Marketing %", type: "number" },
  { key: "margin2_percent", label: "Margin 2 %", type: "number" },
  { key: "amazon_markup_percent", label: "Amazon Markup %", type: "number" },
  { key: "amazon_fee_percent", label: "Amazon Fee %", type: "number" },
] as const;

const fmtCur = (v: number) => `₹${Math.round(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtPct = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;

export default function CogsEstimatePage() {
  const [items, setItems] = useState<EstItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Security
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, any>>({
    sku: "", article_number: "", brand: "", category: "", import_price: 0, import_currency: "USD",
    custom_duty: 0, conversion_rate: 83, gst_percent: 18, shipping_cost: 0,
    margin1_percent: 0, marketing_cost: 2, margin2_percent: 0, amazon_markup_percent: 15, amazon_fee_percent: 15,
  });

  // Edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  // Mass currency
  const [showCurrency, setShowCurrency] = useState(false);
  const [massCurrency, setMassCurrency] = useState("USD");
  const [massRate, setMassRate] = useState("83");

  // Mass update with filters
  const [showMassUpdate, setShowMassUpdate] = useState(false);
  const [muBrand, setMuBrand] = useState("");
  const [muCategory, setMuCategory] = useState("");
  const [muCurrency, setMuCurrency] = useState("");
  const [muSkuContains, setMuSkuContains] = useState("");
  const [muField, setMuField] = useState("margin1_percent");
  const [muValue, setMuValue] = useState("");
  const [muPreview, setMuPreview] = useState<{ count: number; skus: string[] } | null>(null);
  const [muPreviewing, setMuPreviewing] = useState(false);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/cogs-estimate");
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      showToast("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { 
    if (isAuthorized) {
      fetchItems(); 
    }
  }, [fetchItems, isAuthorized]);

  /* ── Add ── */
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.sku?.trim()) { showToast("SKU required", "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/cogs-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error || "Failed", "error"); return; }
      showToast(`Added ${addForm.sku}`, "success");
      setShowAdd(false);
      setAddForm({ sku: "", article_number: "", brand: "", category: "", import_price: 0, import_currency: "USD", custom_duty: 0, conversion_rate: 83, gst_percent: 18, shipping_cost: 0, margin1_percent: 0, marketing_cost: 2, margin2_percent: 0, amazon_markup_percent: 15, amazon_fee_percent: 15 });
      await fetchItems();
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  };

  /* ── Edit ── */
  const startEdit = (item: EstItem) => {
    setEditId(item.id);
    setEditForm({ ...item });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/cogs-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error || "Failed", "error"); return; }
      showToast(`Updated ${editForm.sku}`, "success");
      setEditId(null);
      await fetchItems();
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  };

  /* ── Delete ── */
  const handleDelete = async (sku: string) => {
    if (!confirm(`Delete ${sku}?`)) return;
    try {
      await fetch("/api/cogs-estimate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku }),
      });
      showToast(`Deleted ${sku}`, "success");
      await fetchItems();
    } catch { showToast("Failed to delete", "error"); }
  };

  /* ── Mass Currency Update ── */
  const handleMassCurrency = async () => {
    const rate = parseFloat(massRate);
    if (!rate || rate <= 0) { showToast("Enter a valid rate", "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/cogs-estimate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mass_currency_update", currency: massCurrency, conversion_rate: rate }),
      });
      const data = await res.json();
      if (res.ok) { showToast(data.message, "success"); setShowCurrency(false); await fetchItems(); }
      else showToast(data.error || "Failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  };

  /* ── Mass Update with filters ── */
  const MASS_UPDATE_FIELDS = [
    { key: "margin1_percent", label: "Margin 1 %" },
    { key: "margin2_percent", label: "Margin 2 %" },
    { key: "gst_percent", label: "GST %" },
    { key: "amazon_fee_percent", label: "Amazon Fee %" },
    { key: "amazon_markup_percent", label: "Amazon Markup %" },
    { key: "custom_duty", label: "Custom Duty (₹)" },
    { key: "shipping_cost", label: "Shipping (₹)" },
    { key: "marketing_cost", label: "Marketing %" },
    { key: "conversion_rate", label: "Conversion Rate (skips INR)" },
    { key: "import_price", label: "Import Price" },
  ];

  const buildMassUpdateBody = (dryRun: boolean) => ({
    action: "mass_update",
    field: muField,
    value: dryRun ? undefined : parseFloat(muValue),
    dry_run: dryRun,
    filters: {
      brand: muBrand || undefined,
      category: muCategory || undefined,
      currency: muCurrency || undefined,
      sku_contains: muSkuContains.trim() || undefined,
    },
  });

  const validateMassUpdate = () => {
    const v = parseFloat(muValue);
    if (muValue === "" || !Number.isFinite(v)) { showToast("Enter a valid numeric value", "error"); return false; }
    if (v < 0) { showToast("Value cannot be negative", "error"); return false; }
    return true;
  };

  const handleMassPreview = async () => {
    setMuPreviewing(true);
    setMuPreview(null);
    try {
      const res = await fetch("/api/cogs-estimate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMassUpdateBody(true)),
      });
      const data = await res.json();
      if (res.ok) setMuPreview({ count: data.matched ?? 0, skus: data.skus || [] });
      else showToast(data.error || "Preview failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setMuPreviewing(false); }
  };

  const handleMassUpdate = async () => {
    if (!validateMassUpdate()) return;
    const fieldLabel = MASS_UPDATE_FIELDS.find(f => f.key === muField)?.label || muField;
    const filterDesc = [
      muBrand && `Brand=${muBrand}`,
      muCategory && `Category=${muCategory}`,
      muCurrency && `Currency=${muCurrency}`,
      muSkuContains && `SKU contains "${muSkuContains}"`,
    ].filter(Boolean).join(", ") || "ALL SKUs";
    if (!confirm(`Set ${fieldLabel} = ${muValue} for ${filterDesc}?\n\nThis will recalculate all derived fields.`)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/cogs-estimate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMassUpdateBody(false)),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "success");
        setMuPreview(null);
        setMuValue("");
        await fetchItems();
      } else showToast(data.error || "Failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  };

  /* ── Sync to COGS ── */
  const handleSyncCogs = async () => {
    if (!confirm("This will sync Halte SP & Amazon SP from COGS Estimate to the COGS table. Continue?")) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/cogs-estimate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_cogs" }),
      });
      const data = await res.json();
      if (res.ok) showToast(data.message, "success");
      else showToast(data.error || "Sync failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSyncing(false); }
  };

  /* ── Recalculate All ── */
  const handleRecalcAll = async () => {
    if (!confirm("This will recalculate all derived fields for every SKU using the corrected formulas. Continue?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/cogs-estimate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recalc_all" }),
      });
      const data = await res.json();
      if (res.ok) { showToast(data.message, "success"); await fetchItems(); }
      else showToast(data.error || "Failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSaving(false); }
  };

  const handleDownloadExcel = async () => {
    setDownloadingReport(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (brandFilter) params.set("brand", brandFilter);
      if (categoryFilter) params.set("category", categoryFilter);

      const query = params.toString();
      const res = await fetch(`/api/cogs-estimate/report${query ? `?${query}` : ""}`);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Failed to download Excel", "error");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename=\"([^\"]+)\"/);
      link.download = filenameMatch?.[1] || "haltedb_cogs_estimate.xlsx";

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`Downloaded Excel report for ${filtered.length} SKU${filtered.length === 1 ? "" : "s"}`, "success");
    } catch {
      showToast("Network error", "error");
    } finally {
      setDownloadingReport(false);
    }
  };

  const uniqueBrands = Array.from(new Set(items.map(i => i.brand).filter(Boolean) as string[])).sort();
  const uniqueCategories = Array.from(new Set(items.map(i => i.category).filter(Boolean) as string[])).sort();
  const uniqueCurrencies = Array.from(new Set(items.map(i => i.import_currency).filter(Boolean) as string[])).sort();

  const filtered = items.filter(i => {
    const matchesBrand = !brandFilter || i.brand === brandFilter;
    const matchesCategory = !categoryFilter || i.category === categoryFilter;
    const matchesSearch = !search || i.sku.toLowerCase().includes(search.toLowerCase());
    return matchesBrand && matchesCategory && matchesSearch;
  });

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
            } else {
              showToast("Incorrect password", "error");
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
          </form>
        </div>
        {toast && (<div className={`toast toast-${toast.type}`}>{toast.msg}</div>)}
      </div>
    );
  }

  if (loading) {
    return (<div className="loading-spinner"><div className="spinner" />Loading COGS estimates...</div>);
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">COGS Estimate</h1>
        <p className="page-subtitle">Import pricing, duties, margins &amp; selling price calculator</p>
      </div>

      {/* Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total SKUs</div>
          <div className="metric-value">{items.length}</div>
        </div>
        <div className="metric-card accent-green">
          <div className="metric-label">Avg Cost Price</div>
          <div className="metric-value">
            {items.length > 0 ? fmtCur(items.reduce((a, b) => a + (b.cost_price_halte || 0), 0) / items.length) : "₹0"}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg Selling Price</div>
          <div className="metric-value">
            {items.length > 0 ? fmtCur(items.reduce((a, b) => a + (b.selling_price || 0), 0) / items.length) : "₹0"}
          </div>
        </div>
        <div className="metric-card accent-orange">
          <div className="metric-label">Avg Profitability</div>
          <div className="metric-value">
            {items.length > 0 ? fmtCur(items.reduce((a, b) => a + (b.profitability || 0), 0) / items.length) : "₹0"}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "✕ Close" : "➕ Add SKU"}
        </button>
        <button className="btn btn-primary" style={{ background: "var(--warning)" }} onClick={() => setShowCurrency(!showCurrency)}>
          💱 Mass Currency Update
        </button>
        <button className="btn btn-primary" style={{ background: "#0ea5e9" }} onClick={() => setShowMassUpdate(!showMassUpdate)}>
          {showMassUpdate ? "✕ Close Mass Update" : "🛠 Mass Update"}
        </button>
        <button className="btn btn-success" onClick={handleSyncCogs} disabled={syncing || items.length === 0}>
          {syncing ? "Syncing..." : "Sync to COGS"}
        </button>
        <button className="btn btn-primary" style={{ background: "#8b5cf6" }} onClick={handleRecalcAll} disabled={saving || items.length === 0}>
          {saving ? "Recalculating..." : "Recalculate All"}
        </button>
        <button
          className="btn btn-primary"
          style={{ background: "#166534" }}
          onClick={handleDownloadExcel}
          disabled={downloadingReport || filtered.length === 0}
        >
          {downloadingReport ? "Preparing Excel..." : "Download Excel"}
        </button>
      </div>

      {/* Mass Currency Update Panel */}
      {showCurrency && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">💱 Mass Currency Update</div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", padding: "0 0 16px" }}>
            <div className="filter-group">
              <span className="filter-label">Currency</span>
              <select className="filter-select" value={massCurrency} onChange={e => setMassCurrency(e.target.value)}>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (&euro;)</option>
                <option value="GBP">GBP (&pound;)</option>
                <option value="CNY">CNY (&yen;)</option>
                <option value="INR">INR (&rupee;)</option>
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">1 {massCurrency} = ₹</span>
              <input className="filter-input" type="number" step="0.01" value={massRate} onChange={e => setMassRate(e.target.value)} style={{ width: 120 }} />
            </div>
            <button className="btn btn-primary" onClick={handleMassCurrency} disabled={saving}>
              {saving ? "Updating..." : "Update All SKUs"}
            </button>
          </div>
        </div>
      )}

      {/* Mass Update Panel */}
      {showMassUpdate && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">🛠 Mass Update with Filters</div>
          </div>
          <div style={{ padding: "0 0 16px", fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
            Pick filters to narrow which SKUs are affected, choose a field, and set a value. Leave a filter empty to ignore it. Click <strong>Preview</strong> to see how many SKUs will match before applying.
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", paddingBottom: 12 }}>
            <div className="filter-group">
              <span className="filter-label">Brand</span>
              <select className="filter-select" value={muBrand} onChange={e => { setMuBrand(e.target.value); setMuPreview(null); }} style={{ minWidth: 140 }}>
                <option value="">Any brand</option>
                {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Category</span>
              <select className="filter-select" value={muCategory} onChange={e => { setMuCategory(e.target.value); setMuPreview(null); }} style={{ minWidth: 140 }}>
                <option value="">Any category</option>
                {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Currency</span>
              <select className="filter-select" value={muCurrency} onChange={e => { setMuCurrency(e.target.value); setMuPreview(null); }} style={{ minWidth: 100 }}>
                <option value="">Any</option>
                {uniqueCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">SKU contains</span>
              <input className="filter-input" type="text" value={muSkuContains}
                onChange={e => { setMuSkuContains(e.target.value); setMuPreview(null); }}
                placeholder="(optional)" style={{ width: 160 }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", paddingBottom: 12 }}>
            <div className="filter-group">
              <span className="filter-label">Field to update</span>
              <select className="filter-select" value={muField} onChange={e => { setMuField(e.target.value); setMuPreview(null); }} style={{ minWidth: 200 }}>
                {MASS_UPDATE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">New value</span>
              <input className="filter-input" type="number" step="0.01" value={muValue}
                onChange={e => { setMuValue(e.target.value); setMuPreview(null); }}
                placeholder="e.g. 20" style={{ width: 120 }} />
            </div>
            <button className="btn btn-ghost" onClick={handleMassPreview} disabled={muPreviewing || saving}>
              {muPreviewing ? "Checking..." : "🔍 Preview match"}
            </button>
            <button className="btn btn-primary" onClick={handleMassUpdate} disabled={saving || muPreviewing}>
              {saving ? "Applying..." : "✓ Apply Mass Update"}
            </button>
            {muPreview !== null && (
              <span style={{ fontSize: 13, fontWeight: 600, color: muPreview.count > 0 ? "var(--success)" : "var(--danger)" }}>
                {muPreview.count} SKU{muPreview.count === 1 ? "" : "s"} match
              </span>
            )}
          </div>
          {muPreview !== null && muPreview.count > 0 && (
            <div style={{
              border: "1px solid var(--border)", borderRadius: 6, padding: 10,
              maxHeight: 180, overflowY: "auto", fontSize: 12, fontFamily: "monospace",
              background: "var(--bg-secondary, rgba(0,0,0,0.03))", marginBottom: 8,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontFamily: "inherit" }}>
                SKUs that will be updated:
              </div>
              {muPreview.skus.map(s => (
                <div key={s} style={{ padding: "1px 0" }}>{s}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">Add New SKU</div></div>
          <form onSubmit={handleAdd} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="filter-group">
              <span className="filter-label">SKU *</span>
              <input className="filter-input" value={addForm.sku} onChange={e => setAddForm(f => ({ ...f, sku: e.target.value }))} required style={{ minWidth: 160 }} />
            </div>
            {EDITABLE_FIELDS.map(f => (
              <div className="filter-group" key={f.key}>
                <span className="filter-label">{f.label}</span>
                {f.type === "select" ? (
                  <select className="filter-select" value={addForm[f.key] || ""} onChange={e => setAddForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                    {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="filter-input" type={f.type} step={f.type === "number" ? "0.01" : undefined}
                    value={addForm[f.key] ?? ""} onChange={e => setAddForm(prev => ({ ...prev, [f.key]: f.type === "number" ? e.target.value : e.target.value }))}
                    style={{ width: f.type === "number" ? 100 : 140 }}
                  />
                )}
              </div>
            ))}
            <button type="submit" className="btn btn-success" disabled={saving}>{saving ? "Saving..." : "💾 Save"}</button>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div className="card-title">Estimated COGS ({filtered.length})</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <select className="filter-select" value={brandFilter} onChange={e => setBrandFilter(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">All Brands</option>
              {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select className="filter-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ minWidth: 160 }}>
              <option value="">All Categories</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="filter-input search-input" type="text" placeholder="Search by SKU..."
              value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
          </div>
        </div>
        <div className="table-container" style={{ maxHeight: 600, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ minWidth: 1800, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 2 }}>SKU</th>
                <th>Article #</th>
                <th>Brand</th>
                <th>Category</th>
                <th>Import Price</th>
                <th>Currency</th>
                <th>Duty (₹)</th>
                <th>Conv. Rate</th>
                <th>Import (₹)</th>
                <th>GST %</th>
                <th>GST (₹)</th>
                <th>Shipping</th>
                <th>Final Price</th>
                <th>M1 %</th>
                <th>M1 (₹)</th>
                <th>Cost Halte</th>
                <th>Marketing %</th>
                <th>M2 %</th>
                <th>M2 (₹)</th>
                <th>Selling ₹</th>
                <th>Halte SP</th>
                <th>Markup %</th>
                <th>Amazon SP</th>
                <th>Profit/Unit</th>
                <th>Profit %</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isEditing = editId === item.id;
                const row = isEditing ? editForm : item;
                return (
                  <tr key={item.id}>
                    <td style={{ position: "sticky", left: 0, background: "var(--bg-card)", fontWeight: 600, color: "var(--accent-hover)", zIndex: 1 }}>
                      {item.sku}
                    </td>
                    <td>{isEditing ? <input className="filter-input" style={{ width: 80 }} value={editForm.article_number || ""} onChange={e => setEditForm(f => ({ ...f, article_number: e.target.value }))} /> : row.article_number || "—"}</td>
                    <td>{isEditing ? <input className="filter-input" style={{ width: 80 }} value={editForm.brand || ""} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))} /> : row.brand || "—"}</td>
                    <td>{isEditing ? <input className="filter-input" style={{ width: 80 }} value={editForm.category || ""} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} /> : row.category || "—"}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.01" style={{ width: 80 }} value={editForm.import_price} onChange={e => setEditForm(f => ({ ...f, import_price: e.target.value }))} /> : row.import_price?.toFixed(2)}</td>
                    <td>{isEditing ? (
                      <select className="filter-select" style={{ width: 70 }} value={editForm.import_currency} onChange={e => setEditForm(f => ({ ...f, import_currency: e.target.value }))}>
                        <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="CNY">CNY</option><option value="INR">INR</option>
                      </select>
                    ) : row.import_currency}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.01" style={{ width: 70 }} value={editForm.custom_duty} onChange={e => setEditForm(f => ({ ...f, custom_duty: e.target.value }))} /> : fmtCur(row.custom_duty || 0)}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.01" style={{ width: 70 }} value={editForm.conversion_rate} onChange={e => setEditForm(f => ({ ...f, conversion_rate: e.target.value }))} /> : row.conversion_rate}</td>
                    <td style={{ fontWeight: 600 }}>{fmtCur(row.import_price_inr || 0)}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.1" style={{ width: 60 }} value={editForm.gst_percent} onChange={e => setEditForm(f => ({ ...f, gst_percent: e.target.value }))} /> : `${row.gst_percent}%`}</td>
                    <td>{fmtCur(row.gst_amount || 0)}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.01" style={{ width: 70 }} value={editForm.shipping_cost} onChange={e => setEditForm(f => ({ ...f, shipping_cost: e.target.value }))} /> : fmtCur(row.shipping_cost || 0)}</td>
                    <td style={{ fontWeight: 600 }}>{fmtCur(row.final_price || 0)}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.1" style={{ width: 60 }} value={editForm.margin1_percent} onChange={e => setEditForm(f => ({ ...f, margin1_percent: e.target.value }))} /> : `${row.margin1_percent}%`}</td>
                    <td>{fmtCur(row.margin1_amount || 0)}</td>
                    <td style={{ fontWeight: 700, color: "var(--accent)" }}>{fmtCur(row.cost_price_halte || 0)}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.1" style={{ width: 70 }} value={editForm.marketing_cost} onChange={e => setEditForm(f => ({ ...f, marketing_cost: e.target.value }))} /> : fmtPct(row.marketing_cost ?? 2)}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.1" style={{ width: 60 }} value={editForm.margin2_percent} onChange={e => setEditForm(f => ({ ...f, margin2_percent: e.target.value }))} /> : `${row.margin2_percent}%`}</td>
                    <td>{fmtCur(row.margin2_amount || 0)}</td>
                    <td style={{ fontWeight: 600 }}>{fmtCur(row.selling_price || 0)}</td>
                    <td style={{ color: "#8b5cf6", fontWeight: 600 }}>{fmtCur(row.halte_selling_price || 0)}</td>
                    <td>
                      {isEditing ? (
                        <input className="filter-input" type="number" step="0.1" style={{ width: 70 }}
                          value={editForm.amazon_markup_percent ?? ""}
                          onChange={e => setEditForm(f => ({ ...f, amazon_markup_percent: e.target.value }))}
                          placeholder="15" />
                      ) : `${row.amazon_markup_percent ?? 15}%`}
                    </td>
                    <td style={{ color: "#f59e0b", fontWeight: 600 }}>{fmtCur(row.amazon_selling_price || 0)}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: (row.profitability || 0) >= 0 ? "var(--success)" : "var(--danger)" }}>
                        {fmtCur(row.profitability || 0)}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: (row.profit_percent || 0) >= 0 ? "var(--success)" : "var(--danger)" }}>
                        {fmtPct(row.profit_percent || 0)}
                      </span>
                    </td>
                    <td>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-success btn-sm" onClick={saveEdit} disabled={saving}>{saving ? "..." : "✓"}</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => startEdit(item)}>✏</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => handleDelete(item.sku)}>🗑</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={25} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  No COGS estimates yet. Click &quot;Add SKU&quot; to get started.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Card */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header"><div className="card-title">📋 Formula Reference</div></div>
        <div style={{ padding: "0 0 16px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8 }}>
          <div><strong>Import Price (₹)</strong> = Import Price × Conversion Rate (INR items use rate=1)</div>
          <div><strong>GST Amount</strong> = (Import Price ₹ + Custom Duty) × GST%</div>
          <div><strong>Final Price</strong> = Import Price ₹ + Custom Duty + GST Amount + Shipping</div>
          <div><strong>Cost Price Halte</strong> = Final Price + Margin 1 Amount</div>
          <div><strong>Selling Price</strong> = Cost Price Halte + Margin 2 Amount</div>
          <div><strong>MSP</strong> = Selling Price</div>
          <div><strong>Halte Selling Price</strong> = Selling Price × 1.05 (+5%)</div>
          <div><strong>Amazon Selling Price</strong> = Halte SP × (1 + Amazon Markup % / 100). Edit Markup % to change Amazon SP — default 15%.</div>
          <div><strong>Profitability (per unit)</strong> = Amazon SP − COGS − Amazon Fee − Shipping − Marketing (Amazon SP × Marketing %)</div>
          <div><strong>Profit %</strong> = Profitability ÷ Amazon SP × 100</div>
          <div style={{ marginTop: 12, color: "var(--accent)" }}>
            <strong>🔄 Sync to COGS</strong> → Sets COGS price = Final Price (actual COGS), then recalculates order profit as: Selling Price − COGS − Amazon Fee − Shipping − Marketing %. Returns: −2 × Shipping.
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (<div className={`toast toast-${toast.type}`}>{toast.msg}</div>)}
    </div>
  );
}
