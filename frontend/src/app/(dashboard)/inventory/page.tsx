"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";

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

interface SkuPrediction {
  sku: string;
  current_stock: number;
  predicted_demand_3m: number;
  restock_needed: number;
  months_of_stock: number;
}

interface WarehousePrediction {
  warehouse: string;
  total_stock: number;
  total_predicted_demand: number;
  total_restock_needed: number;
}

const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"];

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "warehouse" | "predictions">("overview");
  const [overall, setOverall] = useState<SkuInventory[]>([]);
  const [warehouseSummary, setWarehouseSummary] = useState<WarehouseSummary[]>([]);
  const [grandTotal, setGrandTotal] = useState<GrandTotal | null>(null);
  const [skuPredictions, setSkuPredictions] = useState<SkuPrediction[]>([]);
  const [warehousePredictions, setWarehousePredictions] = useState<WarehousePrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/inventory").then((r) => r.json()),
      fetch("/api/inventory/predictions").then((r) => r.json()),
    ])
      .then(([inv, pred]) => {
        setOverall(inv.overall || []);
        setWarehouseSummary(inv.warehouseSummary || []);
        setGrandTotal(inv.grandTotal || null);
        setSkuPredictions(pred.skuPredictions || []);
        setWarehousePredictions(pred.warehousePredictions || []);
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
        <p className="page-subtitle">Stock levels, warehouse distribution & restock predictions</p>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
          Overview
        </button>
        <button className={`tab ${activeTab === "warehouse" ? "active" : ""}`} onClick={() => setActiveTab("warehouse")}>
          Warehouse View
        </button>
        <button className={`tab ${activeTab === "predictions" ? "active" : ""}`} onClick={() => setActiveTab("predictions")}>
          Restock Predictions
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

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <>
          <div className="charts-grid">
            {/* Warehouse Distribution Pie */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Stock by Warehouse</div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={warehouseChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="fulfillable"
                    nameKey="warehouse"
                  >
                    {warehouseChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Warehouse Bar */}
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
              <input
                className="filter-input search-input"
                type="text"
                placeholder="Search SKU or ASIN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="table-container" style={{ maxHeight: 500, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>ASIN</th>
                    <th>Fulfillable</th>
                    <th>Reserved</th>
                    <th>Unfulfillable</th>
                    <th>Inbound</th>
                    <th>Warehouses</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOverall.map((item, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: "var(--accent-hover)" }}>{item.sku}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{item.asin || "—"}</td>
                      <td>
                        <span className="badge badge-success">{parseInt(item.total_fulfillable).toLocaleString()}</span>
                      </td>
                      <td>{parseInt(item.total_reserved).toLocaleString()}</td>
                      <td>{parseInt(item.total_unfulfillable).toLocaleString()}</td>
                      <td>
                        {(parseInt(item.total_inbound_working) + parseInt(item.total_inbound_shipped) + parseInt(item.total_inbound_receiving)).toLocaleString()}
                      </td>
                      <td>{item.warehouse_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Warehouse Tab */}
      {activeTab === "warehouse" && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Warehouse Summary</div>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Warehouse</th>
                  <th>SKUs</th>
                  <th>Fulfillable</th>
                  <th>Reserved</th>
                  <th>Unfulfillable</th>
                </tr>
              </thead>
              <tbody>
                {warehouseSummary.map((w, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, color: "var(--accent-hover)" }}>{w.warehouse}</td>
                    <td>{parseInt(w.total_skus).toLocaleString()}</td>
                    <td>
                      <span className="badge badge-success">{parseInt(w.total_fulfillable).toLocaleString()}</span>
                    </td>
                    <td>{parseInt(w.total_reserved).toLocaleString()}</td>
                    <td>{parseInt(w.total_unfulfillable).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Predictions Tab */}
      {activeTab === "predictions" && (
        <>
          {/* Warehouse Predictions */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Warehouse Restock Predictions</div>
                <div className="card-subtitle">3-month forecast based on sales velocity</div>
              </div>
            </div>
            <div className="charts-grid" style={{ marginBottom: 0 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={warehousePredictions}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="warehouse" />
                    <YAxis />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                    <Legend />
                    <Bar dataKey="total_stock" fill="#6366f1" name="Current Stock" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total_predicted_demand" fill="#f59e0b" name="Predicted Demand (3M)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total_restock_needed" fill="#ef4444" name="Restock Needed" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* SKU Predictions Table */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">SKU Restock Predictions</div>
                <div className="card-subtitle">Sorted by urgency (highest restock need first)</div>
              </div>
            </div>
            <div className="table-container" style={{ maxHeight: 500, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Current Stock</th>
                    <th>Predicted Demand (3M)</th>
                    <th>Restock Needed</th>
                    <th>Months of Stock</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {skuPredictions.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{p.sku}</td>
                      <td>{p.current_stock.toLocaleString()}</td>
                      <td>{p.predicted_demand_3m.toLocaleString()}</td>
                      <td style={{ fontWeight: 600, color: p.restock_needed > 0 ? "var(--danger)" : "var(--success)" }}>
                        {p.restock_needed.toLocaleString()}
                      </td>
                      <td>{p.months_of_stock}</td>
                      <td>
                        <span className={`badge ${
                          p.months_of_stock < 1 ? "badge-danger" :
                          p.months_of_stock < 2 ? "badge-warning" :
                          "badge-success"
                        }`}>
                          {p.months_of_stock < 1 ? "Critical" :
                           p.months_of_stock < 2 ? "Low" :
                           "Healthy"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
