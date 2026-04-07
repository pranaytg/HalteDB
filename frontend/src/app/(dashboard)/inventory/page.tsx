"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface WarehouseSummary {
  warehouse: string;
  total_skus: string;
  total_fulfillable: string;
  total_unfulfillable: string;
  total_reserved: string;
}

interface SkuInventory {
  sku: string;
  asin: string;
  fnsku: string;
  total_fulfillable: string;
  total_unfulfillable: string;
  total_reserved: string;
  total_inbound_working: string;
  total_inbound_shipped: string;
  total_inbound_receiving: string;
  warehouse_count: string;
  last_updated: string;
}

interface GrandTotal {
  total_skus: string;
  total_fulfillable: string;
  total_unfulfillable: string;
  total_reserved: string;
  total_warehouses: string;
}



const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"];

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "warehouse">("overview");
  const [overall, setOverall] = useState<SkuInventory[]>([]);
  const [warehouseSummary, setWarehouseSummary] = useState<WarehouseSummary[]>([]);
  const [warehouseBreakdown, setWarehouseBreakdown] = useState<any[]>([]);
  const [grandTotal, setGrandTotal] = useState<GrandTotal | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/inventory").then((r) => r.json())
      .then((inv) => {
        setOverall(inv.overall || []);
        setWarehouseSummary(inv.warehouseSummary || []);
        setWarehouseBreakdown(inv.warehouseBreakdown || []);
        setGrandTotal(inv.grandTotal || null);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredOverall = overall.filter((item) =>
    item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.asin || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const warehouseChartData = warehouseSummary.map((w) => ({
    warehouse: w.warehouse,
    fulfillable: parseInt(w.total_fulfillable),
    unfulfillable: parseInt(w.total_unfulfillable),
    reserved: parseInt(w.total_reserved),
  }));

  /* ── Pivot: build SKU × Warehouse matrix ── */
  const warehouseList = [...new Set(warehouseBreakdown.map((r: any) => r.warehouse))].sort();

  const pivotData: Record<string, { sku: string; asin: string; total: number; warehouses: Record<string, number> }> = {};
  warehouseBreakdown.forEach((r: any) => {
    if (!pivotData[r.sku]) {
      pivotData[r.sku] = { sku: r.sku, asin: r.asin || "", total: 0, warehouses: {} };
    }
    const qty = parseInt(r.fulfillable_quantity) || 0;
    pivotData[r.sku].warehouses[r.warehouse] = qty;
    pivotData[r.sku].total += qty;
  });

  const pivotRows = Object.values(pivotData)
    .filter(r => r.sku.toLowerCase().includes(searchTerm.toLowerCase()) || r.asin.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => b.total - a.total);

  // Find max per warehouse for color scaling
  const maxPerWarehouse: Record<string, number> = {};
  warehouseList.forEach(w => {
    maxPerWarehouse[w] = Math.max(...Object.values(pivotData).map(r => r.warehouses[w] || 0), 1);
  });

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading inventory data...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Inventory Intelligence</h1>
        <p className="page-subtitle">Stock levels, warehouse distribution &amp; restock predictions</p>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
          Overview
        </button>
        <button className={`tab ${activeTab === "warehouse" ? "active" : ""}`} onClick={() => setActiveTab("warehouse")}>
          Warehouse Matrix
        </button>
      </div>

      {/* Metrics */}
      {grandTotal && (
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Total SKUs</div>
            <div className="metric-value">{parseInt(grandTotal.total_skus).toLocaleString()}</div>
          </div>
          <div className="metric-card accent-green">
            <div className="metric-label">Fulfillable</div>
            <div className="metric-value positive">{parseInt(grandTotal.total_fulfillable).toLocaleString()}</div>
          </div>
          <div className="metric-card accent-orange">
            <div className="metric-label">Unfulfillable</div>
            <div className="metric-value">{parseInt(grandTotal.total_unfulfillable).toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Warehouses</div>
            <div className="metric-value">{parseInt(grandTotal.total_warehouses).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* ═══════════════════ OVERVIEW TAB ═══════════════════ */}
      {activeTab === "overview" && (
        <>
          <div className="charts-grid">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Stock by Warehouse</div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={warehouseChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                    paddingAngle={3} dataKey="fulfillable" nameKey="warehouse">
                    {warehouseChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Warehouse Breakdown</div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={warehouseChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="warehouse" />
                  <YAxis />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="fulfillable" fill="#10b981" name="Fulfillable" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="reserved" fill="#f59e0b" name="Reserved" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="unfulfillable" fill="#ef4444" name="Unfulfillable" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* SKU Inventory Table */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">SKU Inventory</div>
              <input className="filter-input search-input" type="text" placeholder="Search SKU or ASIN..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="table-container" style={{ maxHeight: 500, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>ASIN</th><th>Fulfillable</th><th>Reserved</th>
                    <th>Unfulfillable</th><th>Inbound</th><th>Warehouses</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOverall.map((item, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: "var(--accent-hover)" }}>{item.sku}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{item.asin || "\u2014"}</td>
                      <td><span className="badge badge-success">{parseInt(item.total_fulfillable).toLocaleString()}</span></td>
                      <td>{parseInt(item.total_reserved).toLocaleString()}</td>
                      <td>{parseInt(item.total_unfulfillable).toLocaleString()}</td>
                      <td>{(parseInt(item.total_inbound_working) + parseInt(item.total_inbound_shipped) + parseInt(item.total_inbound_receiving)).toLocaleString()}</td>
                      <td>{item.warehouse_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════ WAREHOUSE MATRIX TAB ═══════════════════ */}
      {activeTab === "warehouse" && (
        <>
          {/* Warehouse summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
            {warehouseSummary.map((w, i) => (
              <div key={w.warehouse} className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Warehouse</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: COLORS[i % COLORS.length], marginBottom: 8 }}>{w.warehouse}</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--text-muted)" }}>SKUs</span>
                  <span style={{ fontWeight: 600 }}>{parseInt(w.total_skus)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--text-muted)" }}>Fulfillable</span>
                  <span style={{ fontWeight: 600, color: "#10b981" }}>{parseInt(w.total_fulfillable).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--text-muted)" }}>Reserved</span>
                  <span style={{ fontWeight: 600 }}>{parseInt(w.total_reserved).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Pivot Table: SKU × Warehouse */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">SKU × Warehouse Matrix</div>
                <div className="card-subtitle">{pivotRows.length} SKUs across {warehouseList.length} warehouses · Cell color = stock intensity</div>
              </div>
              <input className="filter-input search-input" type="text" placeholder="Search SKU or ASIN..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="table-container" style={{ maxHeight: 600, overflowY: "auto", overflowX: "auto" }}>
              <table style={{ minWidth: warehouseList.length * 85 + 250 }}>
                <thead>
                  <tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 10, background: "#0f172a", minWidth: 100 }}>SKU</th>
                    <th style={{ position: "sticky", left: 100, zIndex: 10, background: "#0f172a", minWidth: 80 }}>ASIN</th>
                    <th style={{ minWidth: 60, fontWeight: 700, color: "#10b981" }}>Total</th>
                    {warehouseList.map((w, i) => (
                      <th key={w} style={{ minWidth: 75, fontSize: 10, fontWeight: 600, color: COLORS[i % COLORS.length], whiteSpace: "nowrap" }}>
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.map((row) => (
                    <tr key={row.sku}>
                      <td style={{ fontWeight: 600, color: "var(--accent-hover)", position: "sticky", left: 0, background: "#0f172a", zIndex: 5 }}>
                        {row.sku}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 10, position: "sticky", left: 100, background: "#0f172a", zIndex: 5, color: "var(--text-muted)" }}>
                        {row.asin?.slice(0, 10) || "\u2014"}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        <span className="badge badge-success">{row.total.toLocaleString()}</span>
                      </td>
                      {warehouseList.map((w) => {
                        const qty = row.warehouses[w] || 0;
                        const intensity = maxPerWarehouse[w] > 0 ? qty / maxPerWarehouse[w] : 0;
                        const bgColor = qty === 0
                          ? "transparent"
                          : `rgba(99, 102, 241, ${(0.1 + intensity * 0.5).toFixed(2)})`;
                        return (
                          <td key={w} style={{
                            textAlign: "center",
                            fontWeight: qty > 0 ? 600 : 400,
                            color: qty === 0 ? "var(--text-muted)" : "#e2e8f0",
                            background: bgColor,
                            fontSize: 12,
                            borderLeft: "1px solid rgba(255,255,255,0.04)",
                          }}>
                            {qty > 0 ? qty.toLocaleString() : "\u2014"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr style={{ borderTop: "2px solid rgba(255,255,255,0.15)", fontWeight: 700 }}>
                    <td style={{ position: "sticky", left: 0, background: "#0f172a", zIndex: 5, color: "#a5b4fc" }}>TOTAL</td>
                    <td style={{ position: "sticky", left: 100, background: "#0f172a", zIndex: 5 }} />
                    <td><span className="badge badge-success">{pivotRows.reduce((a, r) => a + r.total, 0).toLocaleString()}</span></td>
                    {warehouseList.map(w => (
                      <td key={w} style={{ textAlign: "center", color: "#a5b4fc", fontSize: 12, borderLeft: "1px solid rgba(255,255,255,0.04)" }}>
                        {pivotRows.reduce((a, r) => a + (r.warehouses[w] || 0), 0).toLocaleString()}
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
