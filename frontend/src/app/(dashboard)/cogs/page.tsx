"use client";
//abc

import { useRef, useState, useEffect } from "react";

interface CogsEntry {
  id: number;
  sku: string;
  cogs_price: number;
  halte_price: number | null;
  amazon_price: number | null;
  last_updated: string;
  halte_selling_price: number | null;
  amazon_selling_price: number | null;
  brand: string | null;
}

const fmtCur = (v: number) =>
  `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export default function CogsPage() {
  const haltePriceInputRef = useRef<HTMLInputElement | null>(null);
  const [cogs, setCogs] = useState<CogsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [uploadingHaltePrices, setUploadingHaltePrices] = useState(false);

  // Add COGS form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [adding, setAdding] = useState(false);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchCogs = async () => {
    try {
      const res = await fetch("/api/cogs");
      const data = await res.json();
      setCogs(data.cogs || []);
    } catch {
      showToast("Failed to load COGS data", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshAmazonPrices = async () => {
    setRefreshingPrices(true);
    try {
      const res = await fetch("/api/cogs/amazon-price", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Amazon prices updated", "success");
        await fetchCogs();
      } else {
        showToast(data.error || "Failed to refresh Amazon prices", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setRefreshingPrices(false);
    }
  };

  const handleHaltePriceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingHaltePrices(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/cogs/halte-price", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to upload Halte prices", "error");
        return;
      }

      showToast(
        `Updated ${data.updated} Halte prices. ${data.matched} SKUs matched, ${data.unmatched} unmatched.`,
        "success"
      );
      await fetchCogs();
    } catch {
      showToast("Network error", "error");
    } finally {
      setUploadingHaltePrices(false);
      e.target.value = "";
    }
  };

  useEffect(() => {
    fetchCogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEdit = (sku: string, currentPrice: number) => {
    setEditingSku(sku);
    setEditValue(String(currentPrice));
  };

  const handleSave = async (sku: string) => {
    const price = parseFloat(editValue);
    if (isNaN(price) || price < 0) {
      showToast("Please enter a valid price", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/cogs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, cogs_price: price }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to update", "error");
        return;
      }

      showToast(
        `Updated ${sku} COGS to ₹${price}. ${data.ordersRecalculated} orders recalculated.`,
        "success"
      );
      setEditingSku(null);
      await fetchCogs();
    } catch {
      showToast("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingSku(null);
    setEditValue("");
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(newPrice);
    if (!newSku.trim()) {
      showToast("Please enter a SKU", "error");
      return;
    }
    if (isNaN(price) || price < 0) {
      showToast("Please enter a valid price", "error");
      return;
    }

    setAdding(true);
    try {
      const res = await fetch("/api/cogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: newSku.trim(), cogs_price: price }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to add COGS entry", "error");
        return;
      }

      showToast(
        `Added ${newSku.trim()} with COGS ₹${price}. ${data.ordersRecalculated || 0} orders updated.`,
        "success"
      );
      setNewSku("");
      setNewPrice("");
      setShowAddForm(false);
      await fetchCogs();
    } catch {
      showToast("Network error", "error");
    } finally {
      setAdding(false);
    }
  };

  const brandOptions = Array.from(
    new Set(cogs.map((c) => c.brand).filter((b): b is string => !!b && b.trim() !== ""))
  ).sort((a, b) => a.localeCompare(b));

  const filteredCogs = cogs.filter((c) => {
    const matchesSearch = c.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBrand = !brandFilter || (c.brand ?? "") === brandFilter;
    return matchesSearch && matchesBrand;
  });

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading COGS data...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Cost of Goods Sold</h1>
        <p className="page-subtitle">
          Manage COGS per SKU — editing auto-recalculates profit on all orders
        </p>
      </div>

      {/* Summary */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total SKUs</div>
          <div className="metric-value">{cogs.length}</div>
        </div>
        <div className="metric-card accent-green">
          <div className="metric-label">Avg COGS</div>
          <div className="metric-value">
            ₹{cogs.length > 0
              ? (cogs.reduce((a, b) => a + b.cogs_price, 0) / cogs.length).toFixed(2)
              : "0"}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Min COGS</div>
          <div className="metric-value">
            ₹{cogs.length > 0 ? Math.min(...cogs.map((c) => c.cogs_price)).toFixed(2) : "0"}
          </div>
        </div>
        <div className="metric-card accent-orange">
          <div className="metric-label">Max COGS</div>
          <div className="metric-value">
            ₹{cogs.length > 0 ? Math.max(...cogs.map((c) => c.cogs_price)).toFixed(2) : "0"}
          </div>
        </div>
      </div>

      {/* Add COGS Form */}
      {showAddForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">Add New COGS Entry</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddForm(false)}>
              ✕ Close
            </button>
          </div>
          <form onSubmit={handleAdd} style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="filter-group">
              <label className="filter-label">SKU</label>
              <input
                className="filter-input"
                type="text"
                placeholder="Enter SKU..."
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                required
                autoFocus
                style={{ minWidth: 200 }}
              />
            </div>
            <div className="filter-group">
              <label className="filter-label">COGS Price (₹)</label>
              <input
                className="filter-input"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                required
                style={{ minWidth: 150 }}
              />
            </div>
            <button type="submit" className="btn btn-success" disabled={adding}>
              {adding ? "Adding..." : "➕ Add COGS"}
            </button>
          </form>
        </div>
      )}

      {/* COGS Table */}
      <div className="card">
        <div className="card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div className="card-title">COGS Entries ({filteredCogs.length})</div>
            {!showAddForm && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(true)}>
                ➕ Add New
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleRefreshAmazonPrices}
              disabled={refreshingPrices}
              title="Fetch latest Amazon prices from SP-API and save to database"
            >
              {refreshingPrices ? "Fetching..." : "↻ Refresh Amazon Prices"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => haltePriceInputRef.current?.click()}
              disabled={uploadingHaltePrices}
              title="Upload an Excel feed with id and price columns"
            >
              {uploadingHaltePrices ? "Uploading..." : "Upload Halte Prices"}
            </button>
            <input
              ref={haltePriceInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleHaltePriceUpload}
              style={{ display: "none" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              className="filter-input"
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              title="Filter by brand"
            >
              <option value="">All Brands</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <input
              className="filter-input search-input"
              type="text"
              placeholder="Search SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="table-container" style={{ maxHeight: 600, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>SKU</th>
                <th style={{ color: "#8b5cf6" }}>Halte SP</th>
                <th style={{ color: "#8b5cf6" }}>Halte Price</th>
                <th style={{ color: "#f59e0b" }}>Amazon SP</th>
                <th style={{ color: "#10b981" }}>Amazon Price</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCogs.map((entry, i) => (
                <tr key={entry.id}>
                  <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                  <td style={{ fontWeight: 600, color: "var(--accent-hover)" }}>
                    {entry.sku}
                  </td>
                  <td style={{ fontWeight: 600, color: (() => {
                    if (entry.halte_selling_price == null || entry.halte_price == null) return "#8b5cf6";
                    const diff = Math.abs(entry.halte_price - entry.halte_selling_price);
                    const threshold = entry.halte_selling_price * 0.05;
                    if (entry.halte_price < entry.halte_selling_price && diff > threshold) return "#ef4444";
                    if (diff <= threshold) return "#eab308";
                    return "#10b981";
                  })() }}>
                    {entry.halte_selling_price != null ? fmtCur(entry.halte_selling_price) : "—"}
                  </td>
                  <td style={{ color: "#8b5cf6", fontWeight: 600 }}>
                    {entry.halte_price != null
                      ? fmtCur(entry.halte_price)
                      : <span style={{ color: "var(--text-muted)" }}>—</span>
                    }
                  </td>
                  <td style={{ fontWeight: 600, color: (() => {
                    if (entry.amazon_selling_price == null || entry.amazon_price == null) return "#f59e0b";
                    const diff = Math.abs(entry.amazon_price - entry.amazon_selling_price);
                    const threshold = entry.amazon_selling_price * 0.05;
                    if (entry.amazon_price < entry.amazon_selling_price && diff > threshold) return "#ef4444";
                    if (diff <= threshold) return "#eab308";
                    return "#10b981";
                  })() }}>
                    {entry.amazon_selling_price != null ? fmtCur(entry.amazon_selling_price) : "—"}
                  </td>
                  <td style={{ color: "#10b981", fontWeight: 600 }}>
                    {entry.amazon_price != null
                      ? fmtCur(entry.amazon_price)
                      : <span style={{ color: "var(--text-muted)" }}>—</span>
                    }
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {new Date(entry.last_updated).toLocaleDateString("en-IN")}
                  </td>
                  <td>
                    {editingSku === entry.sku ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleSave(entry.sku)}
                          disabled={saving}
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={handleCancel}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleEdit(entry.sku, entry.cogs_price)}
                      >
                        ✏ Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
