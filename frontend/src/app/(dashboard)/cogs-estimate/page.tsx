"use client";

import { useState, useEffect, useCallback } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface EstItem {
  id: number;
  sku: string;
  article_number: string | null;
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
  amazon_selling_price: number;
  profitability: number;
  last_updated: string;
}

const EDITABLE_FIELDS = [
  { key: "article_number", label: "Article #", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "import_price", label: "Import Price", type: "number" },
  { key: "import_currency", label: "Currency", type: "select", options: ["USD", "EUR", "GBP", "CNY"] },
  { key: "custom_duty", label: "Custom Duty (₹)", type: "number" },
  { key: "conversion_rate", label: "Conv. Rate", type: "number" },
  { key: "gst_percent", label: "GST %", type: "number" },
  { key: "shipping_cost", label: "Shipping (₹)", type: "number" },
  { key: "margin1_percent", label: "Margin 1 %", type: "number" },
  { key: "marketing_cost", label: "Marketing (₹)", type: "number" },
  { key: "margin2_percent", label: "Margin 2 %", type: "number" },
] as const;

const fmtCur = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export default function CogsEstimatePage() {
  const [items, setItems] = useState<EstItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, any>>({
    sku: "", article_number: "", category: "", import_price: 0, import_currency: "USD",
    custom_duty: 0, conversion_rate: 83, gst_percent: 18, shipping_cost: 0,
    margin1_percent: 0, marketing_cost: 0, margin2_percent: 0,
  });

  // Edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  // Mass currency
  const [showCurrency, setShowCurrency] = useState(false);
  const [massCurrency, setMassCurrency] = useState("USD");
  const [massRate, setMassRate] = useState("83");

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

  useEffect(() => { fetchItems(); }, [fetchItems]);

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
      setAddForm({ sku: "", article_number: "", category: "", import_price: 0, import_currency: "USD", custom_duty: 0, conversion_rate: 83, gst_percent: 18, shipping_cost: 0, margin1_percent: 0, marketing_cost: 0, margin2_percent: 0 });
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

  /* ── Sync to COGS ── */
  const handleSyncCogs = async () => {
    if (!confirm("This will update the COGS table (cost_price_halte → cogs_price) and recalculate profit on all orders. Continue?")) return;
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

  const filtered = items.filter(i =>
    i.sku.toLowerCase().includes(search.toLowerCase()) ||
    (i.article_number || "").toLowerCase().includes(search.toLowerCase()) ||
    (i.category || "").toLowerCase().includes(search.toLowerCase())
  );

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
        <button className="btn btn-success" onClick={handleSyncCogs} disabled={syncing || items.length === 0}>
          {syncing ? "Syncing..." : "🔄 Sync to COGS"}
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
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CNY">CNY (¥)</option>
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
        <div className="card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div className="card-title">Estimated COGS ({filtered.length})</div>
          </div>
          <input className="filter-input search-input" type="text" placeholder="Search SKU / Article / Category..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="table-container" style={{ maxHeight: 600, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ minWidth: 1800, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 2 }}>SKU</th>
                <th>Article #</th>
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
                <th>Marketing</th>
                <th>M2 %</th>
                <th>M2 (₹)</th>
                <th>Selling ₹</th>
                <th>MSP+GST</th>
                <th>Halte SP</th>
                <th>Amazon SP</th>
                <th>Profit/Unit</th>
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
                    <td>{isEditing ? <input className="filter-input" style={{ width: 80 }} value={editForm.category || ""} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} /> : row.category || "—"}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.01" style={{ width: 80 }} value={editForm.import_price} onChange={e => setEditForm(f => ({ ...f, import_price: e.target.value }))} /> : row.import_price?.toFixed(2)}</td>
                    <td>{isEditing ? (
                      <select className="filter-select" style={{ width: 70 }} value={editForm.import_currency} onChange={e => setEditForm(f => ({ ...f, import_currency: e.target.value }))}>
                        <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="CNY">CNY</option>
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
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.01" style={{ width: 70 }} value={editForm.marketing_cost} onChange={e => setEditForm(f => ({ ...f, marketing_cost: e.target.value }))} /> : fmtCur(row.marketing_cost || 0)}</td>
                    <td>{isEditing ? <input className="filter-input" type="number" step="0.1" style={{ width: 60 }} value={editForm.margin2_percent} onChange={e => setEditForm(f => ({ ...f, margin2_percent: e.target.value }))} /> : `${row.margin2_percent}%`}</td>
                    <td>{fmtCur(row.margin2_amount || 0)}</td>
                    <td style={{ fontWeight: 600 }}>{fmtCur(row.selling_price || 0)}</td>
                    <td>{fmtCur(row.msp_with_gst || 0)}</td>
                    <td style={{ color: "#8b5cf6", fontWeight: 600 }}>{fmtCur(row.halte_selling_price || 0)}</td>
                    <td style={{ color: "#f59e0b", fontWeight: 600 }}>{fmtCur(row.amazon_selling_price || 0)}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: (row.profitability || 0) >= 0 ? "var(--success)" : "var(--danger)" }}>
                        {fmtCur(row.profitability || 0)}
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
                <tr><td colSpan={24} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  No COGS estimates yet. Click "Add SKU" to get started.
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
          <div><strong>Import Price (₹)</strong> = Import Price × Conversion Rate</div>
          <div><strong>GST Amount</strong> = (Import Price ₹ + Custom Duty) × GST%</div>
          <div><strong>Final Price</strong> = Import Price ₹ + Custom Duty + GST Amount + Shipping</div>
          <div><strong>Cost Price Halte</strong> = Final Price + Margin 1 Amount</div>
          <div><strong>Selling Price</strong> = Cost Price Halte + Marketing + Margin 2 Amount</div>
          <div><strong>MSP (with GST)</strong> = Selling Price × (1 + GST%)</div>
          <div><strong>Halte Selling Price</strong> = MSP × 1.05 (+5%)</div>
          <div><strong>Amazon Selling Price</strong> = MSP × 1.20 (+20%)</div>
          <div><strong>Profitability (per unit)</strong> = Margin 1 + Margin 2</div>
          <div style={{ marginTop: 12, color: "var(--accent)" }}>
            <strong>🔄 Sync to COGS</strong> → Sets COGS price = Cost Price Halte, then recalculates order profit as: Invoice Amount − COGS − Shipping (FBA: from report, Self-fulfilled: ₹100)
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (<div className={`toast toast-${toast.type}`}>{toast.msg}</div>)}
    </div>
  );
}
