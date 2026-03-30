"use client";

import { useEffect, useState, useCallback } from "react";

interface ProductSpec {
  sku: string;
  asin: string;
  product_name: string;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  volumetric_weight_kg: number | null;
  chargeable_weight_kg: number | null;
  last_updated: string | null;
}

const fmtWeight = (n: number | null | undefined) => {
  if (n == null) return "—";
  return `${Number(n).toFixed(2)} kg`;
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

export default function ProductSpecsPage() {
  const [specs, setSpecs] = useState<ProductSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  
  // Sorting
  const [sortField, setSortField] = useState<string>("sku");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Editing state
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    weight_kg?: number | string;
    length_cm?: number | string;
    width_cm?: number | string;
    height_cm?: number | string;
  }>({});
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/product-specs");
      if (res.ok) {
        const data = await res.json();
        setSpecs(data.specs || []);
      }
    } catch (e) {
      console.error("Failed to fetch product specs", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sorted = [...specs].sort((a: any, b: any) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (aVal === bVal) return 0;
    
    // String comparison
    if (typeof aVal === "string" || typeof bVal === "string") {
      const strA = (aVal || "").toString().toLowerCase();
      const strB = (bVal || "").toString().toLowerCase();
      return sortDir === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
    }
    
    // Number comparison
    const numA = Number(aVal) || 0;
    const numB = Number(bVal) || 0;
    return sortDir === "asc" ? numA - numB : numB - numA;
  });

  const startEditing = (spec: ProductSpec) => {
    setEditingRow(spec.sku);
    setEditForm({
      weight_kg: spec.weight_kg ?? "",
      length_cm: spec.length_cm ?? "",
      width_cm: spec.width_cm ?? "",
      height_cm: spec.height_cm ?? "",
    });
  };

  const cancelEditing = () => {
    setEditingRow(null);
    setEditForm({});
  };

  const saveEditing = async (sku: string) => {
    setSaving(true);
    try {
      // Clean inputs
      const payload = {
        sku,
        weight_kg: editForm.weight_kg === "" ? null : Number(editForm.weight_kg),
        length_cm: editForm.length_cm === "" ? null : Number(editForm.length_cm),
        width_cm: editForm.width_cm === "" ? null : Number(editForm.width_cm),
        height_cm: editForm.height_cm === "" ? null : Number(editForm.height_cm),
      };

      const res = await fetch("/api/product-specs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setToast("Specification updated successfully");
        await fetchData(); // Refresh data from backend to show newly calculated volumetric weights
        setEditingRow(null);
      } else {
        const err = await res.json();
        setToast(`Error: ${err.error || "Failed to update"}`);
      }
    } catch (e) {
      setToast("Network error trying to save");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1500 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>📐 Product Specifications</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
            Manage weights and dimensions for all your SKUs.
          </p>
        </div>
      </div>

      {/* Specifications Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📋 SKU Catalog Dimensions</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {specs.length} items · Click headers to sort
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-muted)" }}>Loading specifications...</p>
          </div>
        ) : specs.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 48, margin: "0 0 12px" }}>📦</p>
            <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>No product specifications yet</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Run the SP-API product spec sync from the backend to fetch initially.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 250px)", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--bg-tertiary)", zIndex: 10, borderBottom: "1px solid var(--border)" }}>
                <tr>
                  <SortTh field="sku" label="SKU" sortField={sortField} sortDir={sortDir} onClick={handleSort} />
                  <SortTh field="product_name" label="Product Name" sortField={sortField} sortDir={sortDir} onClick={handleSort} />
                  <th style={th}>Dimensions (L × W × H) cm</th>
                  <SortTh field="weight_kg" label="Actual Wt" sortField={sortField} sortDir={sortDir} onClick={handleSort} align="center" />
                  <SortTh field="volumetric_weight_kg" label="Vol Wt" sortField={sortField} sortDir={sortDir} onClick={handleSort} align="center" />
                  <SortTh field="chargeable_weight_kg" label="Chargeable" sortField={sortField} sortDir={sortDir} onClick={handleSort} align="center" />
                  <SortTh field="last_updated" label="Last Updated" sortField={sortField} sortDir={sortDir} onClick={handleSort} />
                  <th style={{ ...th, textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const isEditing = editingRow === s.sku;

                  return (
                    <tr key={s.sku} style={{ borderBottom: "1px solid var(--border)", background: isEditing ? "rgba(99,102,241,0.05)" : "transparent" }}>
                      
                      {/* SKU */}
                      <td style={{ ...td, fontWeight: 600 }}>{s.sku}</td>

                      {/* Product Name */}
                      <td style={td}>
                        <div style={{ maxWidth: 200, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, lineHeight: "1.4" }} title={s.product_name}>
                          {s.product_name || "—"}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{s.asin}</div>
                      </td>

                      {/* Dimensions Edit Mode */}
                      {isEditing ? (
                        <>
                          <td style={td}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <input type="number" step="0.1" style={inputStyle} value={editForm.length_cm} onChange={(e) => setEditForm({...editForm, length_cm: e.target.value})} placeholder="L" />
                              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>×</span>
                              <input type="number" step="0.1" style={inputStyle} value={editForm.width_cm} onChange={(e) => setEditForm({...editForm, width_cm: e.target.value})} placeholder="W" />
                              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>×</span>
                              <input type="number" step="0.1" style={inputStyle} value={editForm.height_cm} onChange={(e) => setEditForm({...editForm, height_cm: e.target.value})} placeholder="H" />
                            </div>
                          </td>
                          <td style={{ ...td, textAlign: "center" }}>
                            <input type="number" step="0.01" style={{ ...inputStyle, width: 60 }} value={editForm.weight_kg} onChange={(e) => setEditForm({...editForm, weight_kg: e.target.value})} placeholder="kg" />
                          </td>
                          <td style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>
                            <em>Auto calc</em>
                          </td>
                          <td style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>
                            <em>Auto calc</em>
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Dimensions Read Mode */}
                          <td style={td}>
                            {s.length_cm != null && s.width_cm != null && s.height_cm != null ? (
                              <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                                {Number(s.length_cm).toFixed(1)} × {Number(s.width_cm).toFixed(1)} × {Number(s.height_cm).toFixed(1)}
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                          
                          {/* Weights Read Mode */}
                          <td style={{ ...td, textAlign: "center" }}>{fmtWeight(s.weight_kg)}</td>
                          <td style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>{fmtWeight(s.volumetric_weight_kg)}</td>
                          <td style={{ ...td, textAlign: "center", fontWeight: 700, color: "var(--text-primary)" }}>
                            {fmtWeight(s.chargeable_weight_kg)}
                          </td>
                        </>
                      )}

                      {/* Last Updated */}
                      <td style={{ ...td, fontSize: 11, color: "var(--text-muted)" }}>
                        {fmtDate(s.last_updated)}
                      </td>

                      {/* Actions */}
                      <td style={{ ...td, textAlign: "center" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ padding: "4px 10px", fontSize: 11 }}
                              disabled={saving}
                              onClick={() => saveEditing(s.sku)}
                            >
                              {saving ? "..." : "Save"}
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ padding: "4px 10px", fontSize: 11, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                              disabled={saving}
                              onClick={cancelEditing}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: "4px 10px", fontSize: 11, background: "rgba(99,102,241,0.08)", color: "var(--primary)", border: "none" }}
                            onClick={() => startEditing(s)}
                          >
                            ✎ Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div style={{
        marginTop: 16, padding: "12px 16px", borderRadius: 8,
        background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
        fontSize: 12, color: "var(--text-muted)",
      }}>
        💡 <strong>Note about Volumetric Weight:</strong> Formula is L × W × H (in cm) ÷ 5000. Chargeable weight is calculated automatically as the maximum of actual and volumetric weights. Updating dimensions recalculates volumetric and chargeable weights.
      </div>

      {/* Toast */}
      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

/* ─── Shared Components & Styles ─── */

const th: React.CSSProperties = {
  padding: "12px 16px", textAlign: "left", fontSize: 12,
  fontWeight: 600, color: "var(--text-muted)",
};

const td: React.CSSProperties = {
  padding: "12px 16px", whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  width: 50,
  padding: "4px 6px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  textAlign: "center",
};

function SortTh({ field, label, sortField, sortDir, onClick, align = "left" }: {
  field: string; label: string; sortField: string; sortDir: "asc" | "desc";
  onClick: (f: string) => void; align?: "left" | "center" | "right";
}) {
  const active = sortField === field;
  return (
    <th
      style={{ ...th, cursor: "pointer", color: active ? "var(--text-primary)" : "var(--text-muted)", textAlign: align }}
      onClick={() => onClick(field)}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start", gap: 4 }}>
        {label}
        <span style={{ fontSize: 10, opacity: active ? 1 : 0.2 }}>
          {active ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
        </span>
      </div>
    </th>
  );
}
