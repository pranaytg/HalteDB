"use client";

import { useEffect, useState, useCallback } from "react";

const CARRIERS = [
  { key: "amazon", label: "Amazon FBA", color: "#ff9900" },
  { key: "delhivery", label: "Delhivery", color: "#e23744" },
  { key: "bluedart", label: "BlueDart", color: "#0066cc" },
  { key: "dtdc", label: "DTDC", color: "#d42027" },
  { key: "xpressbees", label: "XpressBees", color: "#f5a623" },
  { key: "ekart", label: "Ekart", color: "#2874f0" },
];

interface ShipmentEstimate {
  amazon_order_id: string;
  sku: string;
  destination_pincode: string;
  destination_city: string;
  destination_state: string;
  actual_weight_kg: number | null;
  volumetric_weight_kg: number | null;
  chargeable_weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  amazon_shipping_cost: number;
  delhivery_cost: number | null;
  bluedart_cost: number | null;
  dtdc_cost: number | null;
  xpressbees_cost: number | null;
  ekart_cost: number | null;
  cheapest_provider: string;
  cheapest_cost: number;
  delhivery_etd: string;
  bluedart_etd: string;
  dtdc_etd: string;
  xpressbees_etd: string;
  ekart_etd: string;
  estimated_at: string;
  rate_source: string | null;
  item_price: number;
  purchase_date: string;
  product_name: string;
}

interface Summary {
  total_estimates: number;
  avg_amazon_cost: number;
  avg_cheapest_cost: number;
  avg_delhivery_cost: number;
  avg_bluedart_cost: number;
  avg_dtdc_cost: number;
  avg_xpressbees_cost: number;
  avg_ekart_cost: number;
  total_potential_savings: number;
}

const fmt = (n: number | null | undefined) => {
  if (n == null) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtDecimal = (n: number | null | undefined) => {
  if (n == null) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtWeight = (n: number | null | undefined) => {
  if (n == null) return "—";
  return `${Number(n).toFixed(2)} kg`;
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

export default function ShipmentPage() {
  const [estimates, setEstimates] = useState<ShipmentEstimate[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [providerWins, setProviderWins] = useState<{ provider: string; wins: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>("purchase_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shipment?limit=100");
      if (res.ok) {
        const data = await res.json();
        setEstimates(data.estimates || []);
        setSummary(data.summary || null);
        setProviderWins(data.providerWins || []);
      }
    } catch (e) {
      console.error("Failed to fetch shipment data", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const triggerEstimate = async () => {
    setEstimating(true);
    setToast(null);
    try {
      const res = await fetch("/api/shipment/estimate", { method: "POST" });
      const data = await res.json();
      setToast(data.message || "Estimation complete");
      await fetchData();
    } catch {
      setToast("Failed to estimate rates");
    }
    setEstimating(false);
    setTimeout(() => setToast(null), 5000);
  };

  const sorted = [...estimates].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    // Handle date strings
    if (sortField === "purchase_date") {
      const aDate = aVal ? new Date(aVal as string).getTime() : 0;
      const bDate = bVal ? new Date(bVal as string).getTime() : 0;
      return sortDir === "asc" ? aDate - bDate : bDate - aDate;
    }
    const aNum = Number(aVal) || 0;
    const bNum = Number(bVal) || 0;
    return sortDir === "asc" ? aNum - bNum : bNum - aNum;
  });

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "purchase_date" ? "desc" : "asc");
    }
  };

  const totalWins = providerWins.reduce((s, p) => s + p.wins, 0) || 1;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1500 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>🚚 Shipment Rate Comparison</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
            Compare shipping costs across carriers · Origin: Chandigarh (160012) · Destination from SP-API orders
          </p>
        </div>
        <button
          onClick={triggerEstimate}
          disabled={estimating}
          className="btn btn-primary"
          style={{ fontSize: 14, padding: "10px 24px", gap: 8, display: "flex", alignItems: "center" }}
        >
          {estimating ? (
            <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Estimating...</>
          ) : (
            "⚡ Estimate New Orders"
          )}
        </button>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
          <KPICard title="AVG AMAZON COST" value={fmtDecimal(summary.avg_amazon_cost)} icon="📦" color="#ff9900" />
          <KPICard title="AVG CHEAPEST ALT" value={fmtDecimal(summary.avg_cheapest_cost)} icon="💰" color="#22c55e" />
          <KPICard title="AVG DELHIVERY" value={fmtDecimal(summary.avg_delhivery_cost)} icon="🔴" color="#e23744" />
          <KPICard title="AVG BLUEDART" value={fmtDecimal(summary.avg_bluedart_cost)} icon="🔵" color="#0066cc" />
          <KPICard
            title="POTENTIAL SAVINGS"
            value={fmt(summary.total_potential_savings)}
            icon="🎯" color="#a855f7"
            subtitle={`Across ${summary.total_estimates} orders`}
          />
        </div>
      )}

      {/* Provider Wins + Avg Rates Chart */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Provider Wins */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>🏆 Who Wins Most Often?</h3>
          {providerWins.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data yet — click &quot;Estimate New Orders&quot;</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {providerWins.map((p) => {
                const carrier = CARRIERS.find(c =>
                  c.label.toLowerCase().includes(p.provider.toLowerCase()) || p.provider.toLowerCase().includes(c.key)
                );
                const pct = Math.round((p.wins / totalWins) * 100);
                return (
                  <div key={p.provider}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{p.provider}</span>
                      <span style={{ color: "var(--text-muted)" }}>{p.wins} wins ({pct}%)</span>
                    </div>
                    <div style={{ background: "var(--bg-tertiary)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                      <div style={{
                        width: `${pct}%`, height: "100%",
                        background: carrier?.color || "#888",
                        borderRadius: 6, transition: "width 0.5s ease",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Avg Rate Comparison Chart */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>📊 Average Rate by Carrier</h3>
          {!summary ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data yet</p>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: 180, paddingTop: 10 }}>
              {CARRIERS.map((c) => {
                const val = summary[`avg_${c.key}_cost` as keyof Summary] as number || 0;
                const maxVal = Math.max(
                  ...(CARRIERS.map(cc => (summary[`avg_${cc.key}_cost` as keyof Summary] as number) || 0))
                );
                const heightPct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                return (
                  <div key={c.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: c.color }}>{val > 0 ? `₹${val}` : "—"}</span>
                    <div style={{
                      width: "100%",
                      height: `${Math.max(heightPct, 5)}%`,
                      background: `linear-gradient(180deg, ${c.color}, ${c.color}88)`,
                      borderRadius: "6px 6px 0 0", minHeight: 4,
                      transition: "height 0.5s ease",
                    }} />
                    <span style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center" }}>{c.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Rate Comparison Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📋 Order-wise Rate Comparison</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {estimates.length} orders · Sorted by latest first · Click headers to sort
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-muted)" }}>Loading estimates...</p>
          </div>
        ) : estimates.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 48, margin: "0 0 12px" }}>📦</p>
            <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>No shipment estimates yet</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Click <strong>&quot;Estimate New Orders&quot;</strong> to compute shipping costs for your recent orders.
              <br />Make sure your orders have postal codes (run a sync first).
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-tertiary)" }}>
                  <SortTh field="purchase_date" label="Date" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#888" />
                  <th style={th}>Order ID</th>
                  <th style={th}>SKU</th>
                  <th style={th}>Destination</th>
                  <th style={{ ...th, cursor: "pointer", textAlign: "center" }} onClick={() => handleSort("chargeable_weight_kg")}>
                    Weights {sortField === "chargeable_weight_kg" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </th>
                  <th style={{ ...th, textAlign: "center", fontSize: 10, color: "var(--text-muted)" }}>Source</th>
                  <SortTh field="amazon_shipping_cost" label="Amazon" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#ff9900" />
                  <SortTh field="delhivery_cost" label="Delhivery" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#e23744" />
                  <SortTh field="bluedart_cost" label="BlueDart" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#0066cc" />
                  <SortTh field="dtdc_cost" label="DTDC" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#d42027" />
                  <SortTh field="xpressbees_cost" label="XpressBees" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#f5a623" />
                  <SortTh field="ekart_cost" label="Ekart" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#2874f0" />
                  <SortTh field="cheapest_cost" label="Best" sortField={sortField} sortDir={sortDir} onClick={handleSort} color="#22c55e" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((e) => {
                  const rowKey = `${e.amazon_order_id}-${e.sku}`;
                  const costs = {
                    delhivery: e.delhivery_cost,
                    bluedart: e.bluedart_cost,
                    dtdc: e.dtdc_cost,
                    xpressbees: e.xpressbees_cost,
                    ekart: e.ekart_cost,
                  };
                  const validCosts = Object.values(costs).filter(Boolean) as number[];
                  const minCost = validCosts.length > 0 ? Math.min(...validCosts) : null;
                  const hasEstimates = e.delhivery_cost != null || e.bluedart_cost != null || e.cheapest_provider != null;
                  const isExpanded = expandedRow === rowKey;

                  return (
                    <tr key={rowKey} style={{ borderBottom: "1px solid var(--border)" }}>
                      {/* Date */}
                      <td style={{ ...td, fontSize: 11, color: "var(--text-muted)" }}>
                        {fmtDate(e.purchase_date)}
                      </td>

                      {/* Order ID */}
                      <td style={td}>
                        <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                          {e.amazon_order_id?.slice(-8)}
                        </span>
                      </td>

                      {/* SKU */}
                      <td style={td}>
                        <span style={{ maxWidth: 100, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {e.sku}
                        </span>
                      </td>

                      {/* Destination */}
                      <td style={td}>
                        <div style={{ fontSize: 12 }}>{e.destination_city || "—"}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          {e.destination_state ? `${e.destination_state} · ` : ""}{e.destination_pincode}
                        </div>
                      </td>

                      {/* Weights — clickable to expand */}
                      <td
                        style={{ ...td, textAlign: "center", cursor: "pointer", position: "relative" }}
                        onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                      >
                        <div style={{ fontWeight: 600, fontSize: 12 }}>
                          {e.chargeable_weight_kg ? `${Number(e.chargeable_weight_kg).toFixed(2)}` : "0.50"}
                          <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 2 }}>kg</span>
                        </div>
                        <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                          {e.actual_weight_kg != null || e.volumetric_weight_kg != null ? "▾ details" : "default"}
                        </div>
                        {isExpanded && (
                          <div style={{
                            position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                            background: "var(--bg-secondary)", border: "1px solid var(--border)",
                            borderRadius: 8, padding: "10px 14px", zIndex: 20, minWidth: 200,
                            boxShadow: "0 4px 16px rgba(0,0,0,0.3)", textAlign: "left",
                          }}>
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>
                              Weight Breakdown
                            </div>
                            <div style={{ fontSize: 11, lineHeight: 1.8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-muted)" }}>Actual Weight:</span>
                                <span style={{ fontWeight: 600 }}>{fmtWeight(e.actual_weight_kg)}</span>
                              </div>
                              {(e.length_cm != null && e.width_cm != null && e.height_cm != null) && (
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "var(--text-muted)" }}>Dimensions:</span>
                                  <span style={{ fontWeight: 600 }}>
                                    {Number(e.length_cm).toFixed(1)}×{Number(e.width_cm).toFixed(1)}×{Number(e.height_cm).toFixed(1)} cm
                                  </span>
                                </div>
                              )}
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-muted)" }}>Volumetric:</span>
                                <span style={{ fontWeight: 600 }}>{fmtWeight(e.volumetric_weight_kg)}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-muted)" }}>Formula:</span>
                                <span style={{ fontWeight: 600, fontSize: 10 }}>L×W×H ÷ 5000</span>
                              </div>
                              <div style={{
                                borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4,
                                display: "flex", justifyContent: "space-between",
                              }}>
                                <span style={{ color: "#22c55e", fontWeight: 700 }}>Chargeable:</span>
                                <span style={{ fontWeight: 800, color: "#22c55e" }}>
                                  {fmtWeight(e.chargeable_weight_kg)}
                                </span>
                              </div>
                              <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>
                                = max(actual, volumetric)
                              </div>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Rate Source Badge */}
                      <td style={{ ...td, textAlign: "center" }}>
                        {e.rate_source ? (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                            background: e.rate_source === "shiprocket"
                              ? "rgba(34,197,94,0.15)" : "rgba(251,191,36,0.15)",
                            color: e.rate_source === "shiprocket" ? "#22c55e" : "#f59e0b",
                            textTransform: "uppercase", letterSpacing: 0.5,
                          }}>
                            {e.rate_source === "shiprocket" ? "LIVE" : "EST"}
                          </span>
                        ) : (
                          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>

                      {/* Amazon cost */}
                      <CostCell cost={e.amazon_shipping_cost} isMin={false} etd="" />

                      {/* Carrier costs or Calculate button */}
                      {!hasEstimates ? (
                        <td colSpan={6} style={{ textAlign: "center", padding: "8px" }}>
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ padding: "4px 12px", fontSize: 11 }}
                            onClick={async () => {
                              setToast("Calculating rate...");
                              try {
                                const r = await fetch("/api/shipment/estimate-single", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ amazon_order_id: e.amazon_order_id, sku: e.sku })
                                });
                                const data = await r.json();
                                if (r.ok) {
                                  setToast(`Rate calculated (${data.rate_source || "done"})`);
                                  fetchData();
                                } else {
                                  setToast("Failed to calculate rate");
                                }
                              } catch {
                                setToast("Error calculating rate");
                              }
                              setTimeout(() => setToast(null), 4000);
                            }}
                          >
                            ⚡ Calculate Cost
                          </button>
                        </td>
                      ) : (
                        <>
                          <CostCell cost={e.delhivery_cost} isMin={e.delhivery_cost === minCost} etd={e.delhivery_etd} />
                          <CostCell cost={e.bluedart_cost} isMin={e.bluedart_cost === minCost} etd={e.bluedart_etd} />
                          <CostCell cost={e.dtdc_cost} isMin={e.dtdc_cost === minCost} etd={e.dtdc_etd} />
                          <CostCell cost={e.xpressbees_cost} isMin={e.xpressbees_cost === minCost} etd={e.xpressbees_etd} />
                          <CostCell cost={e.ekart_cost} isMin={e.ekart_cost === minCost} etd={e.ekart_etd} />
                          <td style={{ ...td, textAlign: "center" }}>
                            <div style={{
                              background: "rgba(34, 197, 94, 0.15)", color: "#22c55e",
                              borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 700,
                            }}>
                              {e.cheapest_provider}
                              <div style={{ fontSize: 11, fontWeight: 600 }}>{fmt(e.cheapest_cost)}</div>
                            </div>
                          </td>
                        </>
                      )}
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
        💡 Rates marked <strong style={{ color: "#22c55e" }}>LIVE</strong> come from Shiprocket API.
        Rates marked <strong style={{ color: "#f59e0b" }}>EST</strong> use zone-based Indian carrier rate cards as fallback.
        Click on the weight column to see the full weight breakdown (actual, volumetric, chargeable).
      </div>

      {/* Toast */}
      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

/* ─── Sub-components ─── */

const th: React.CSSProperties = {
  padding: "10px 12px", textAlign: "left", fontSize: 12,
  fontWeight: 600, whiteSpace: "nowrap", color: "var(--text-muted)",
};

const td: React.CSSProperties = {
  padding: "10px 12px", whiteSpace: "nowrap",
};

function KPICard({ title, value, icon, color, subtitle }: {
  title: string; value: string; icon: string; color: string; subtitle?: string;
}) {
  return (
    <div className="card" style={{ padding: "16px 20px", borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5, marginBottom: 4 }}>
            {title}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
          {subtitle && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        <span style={{ fontSize: 28, opacity: 0.6 }}>{icon}</span>
      </div>
    </div>
  );
}

function SortTh({ field, label, sortField, sortDir, onClick, color }: {
  field: string; label: string; sortField: string; sortDir: "asc" | "desc";
  onClick: (f: string) => void; color: string;
}) {
  const active = sortField === field;
  return (
    <th
      style={{ ...th, cursor: "pointer", color: active ? color : "var(--text-muted)", textAlign: "center" }}
      onClick={() => onClick(field)}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );
}

function CostCell({ cost, isMin, etd }: { cost: number | null; isMin: boolean; etd: string }) {
  if (cost == null) return <td style={{ ...td, textAlign: "center", color: "var(--text-muted)" }}>—</td>;
  return (
    <td style={{
      ...td, textAlign: "center",
      fontWeight: isMin ? 700 : 400,
      color: isMin ? "#22c55e" : undefined,
      background: isMin ? "rgba(34, 197, 94, 0.08)" : undefined,
    }}>
      <div>{fmt(cost)}</div>
      {etd && <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>{etd}</div>}
    </td>
  );
}
