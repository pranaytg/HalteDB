"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const fmtCur = (v: number) => `Rs. ${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtNum = (v: number) => Number(v).toLocaleString("en-IN");

const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

interface RFMCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  email?: string;
  state?: string;
  days_since_order?: number;
  purchase_frequency: number;
  total_spent: number;
  rfm_score: number;
  segment: string;
}

interface CLVCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  email?: string;
  total_orders: number;
  total_spent: number;
  avg_order_value: number;
  predicted_clv: number;
  retention_rate?: number;
  days_since_last_order?: number | null;
  tier: string;
}

interface ChurnCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  email?: string;
  total_orders: number;
  total_spent: number;
  days_since_order: number;
  churn_risk_score: number;
  churn_category: string;
}

interface LoyaltyCustomer {
  customer_id: string;
  name: string;
  phone?: string;
  email?: string;
  total_orders: number;
  total_spent: number;
  loyalty_tier: string;
}

export default function CustomerInsightsPage() {
  const [activeTab, setActiveTab] = useState<"rfm" | "clv" | "churn" | "loyalty">("rfm");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/analytics?metric=${activeTab}`);
      const d = await res.json();
      if (d.error) setError(d.error);
      else setData(d);
    } catch (err) {
      setError("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading customer insights...
      </div>
    );
  }

  if (error) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--danger)" }}>{error}</div>;
  }

  const recencyMissing = data && data.recencyAvailable === false;
  const RecencyWarning = () => (
    <div
      style={{
        padding: 12,
        marginBottom: 16,
        borderRadius: 6,
        background: "rgba(245,158,11,0.1)",
        border: "1px solid rgba(245,158,11,0.4)",
        color: "var(--warning, #f59e0b)",
        fontSize: 12,
      }}
    >
      <strong>No recency data found.</strong> The <code>last_order_date</code> column is empty for all
      customers — recency-based metrics (churn, RFM recency) cannot be computed. Re-run{" "}
      <code>python import_customer_data.py</code> with the updated importer to populate it.
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Customer Insights</h1>
        <p className="page-subtitle">Advanced analytics: RFM, CLV, Churn Risk & Loyalty</p>
      </div>

      {/* Tabs */}
      <div className="tabs-bar" style={{ marginBottom: 16 }}>
        <button className={`tab-btn ${activeTab === "rfm" ? "active" : ""}`} onClick={() => setActiveTab("rfm")}>
          RFM Analysis
        </button>
        <button className={`tab-btn ${activeTab === "clv" ? "active" : ""}`} onClick={() => setActiveTab("clv")}>
          Customer Lifetime Value
        </button>
        <button className={`tab-btn ${activeTab === "churn" ? "active" : ""}`} onClick={() => setActiveTab("churn")}>
          Churn Risk
        </button>
        <button className={`tab-btn ${activeTab === "loyalty" ? "active" : ""}`} onClick={() => setActiveTab("loyalty")}>
          Loyalty Analysis
        </button>
      </div>

      {/* RFM Analysis */}
      {activeTab === "rfm" && (
        <>
          {recencyMissing && <RecencyWarning />}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
            {Object.entries(data?.segmentCounts || {}).map(([segment, count]: any) => (
              <div key={segment} className="card" style={{ padding: "16px", borderLeft: `4px solid ${COLORS[Object.keys(data?.segmentCounts || {}).indexOf(segment) % COLORS.length]}` }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{segment}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtNum(count)}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">RFM Customer Segments</div>
              <div className="card-subtitle">Ranked by RFM Score</div>
            </div>
            <input
              className="filter-input search-input"
              type="text"
              placeholder="Search customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div className="table-container" style={{ maxHeight: 600, overflowY: "auto" }}>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Segment</th>
                    <th>Recency (days)</th>
                    <th>Frequency</th>
                    <th>Spent</th>
                    <th>RFM Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customers || [])
                    .filter((c: RFMCustomer) => !search || c.name?.toLowerCase().includes(search.toLowerCase()))
                    .map((c: RFMCustomer) => (
                      <tr key={c.customer_id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td>
                          <span
                            style={{
                              background:
                                c.segment === "Champions"
                                  ? "rgba(34,197,94,0.2)"
                                  : c.segment === "At Risk"
                                  ? "rgba(239,68,68,0.2)"
                                  : "rgba(107,114,128,0.2)",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {c.segment}
                          </span>
                        </td>
                        <td style={{ color: "var(--text-muted)" }}>{c.days_since_order || "-"}</td>
                        <td style={{ fontWeight: 600 }}>{c.purchase_frequency}</td>
                        <td style={{ color: "var(--success)" }}>{fmtCur(c.total_spent)}</td>
                        <td style={{ fontWeight: 700, color: "var(--accent)" }}>{Math.round(c.rfm_score)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* CLV Analysis */}
      {activeTab === "clv" && (
        <>
          {recencyMissing && <RecencyWarning />}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Average CLV</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>{fmtCur(data?.avgCLV || 0)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Expected 2-year customer value</div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Total Customers</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtNum(data?.totalCustomers || 0)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Analyzed for CLV</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Customer Lifetime Value (Top 50)</div>
              <div className="card-subtitle">
                Historic spend + AOV × expected future orders × retention × 2yr horizon
              </div>
            </div>
            <div className="table-container" style={{ maxHeight: 600, overflowY: "auto" }}>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Tier</th>
                    <th>Orders</th>
                    <th>Total Spent</th>
                    <th>Avg Order</th>
                    <th>Retention</th>
                    <th>Predicted CLV</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customers || []).slice(0, 50).map((c: CLVCustomer) => (
                    <tr key={c.customer_id}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td>
                        <span
                          style={{
                            background:
                              c.tier === "Platinum"
                                ? "rgba(168,85,247,0.2)"
                                : c.tier === "Gold"
                                ? "rgba(245,158,11,0.2)"
                                : c.tier === "Silver"
                                ? "rgba(148,163,184,0.2)"
                                : c.tier === "Bronze"
                                ? "rgba(180,83,9,0.2)"
                                : "rgba(107,114,128,0.2)",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {c.tier}
                        </span>
                      </td>
                      <td>{c.total_orders}</td>
                      <td style={{ color: "var(--success)" }}>{fmtCur(c.total_spent)}</td>
                      <td>{fmtCur(Number(c.avg_order_value || 0))}</td>
                      <td style={{ color: "var(--text-muted)" }}>
                        {c.retention_rate != null ? `${Math.round(Number(c.retention_rate) * 100)}%` : "-"}
                      </td>
                      <td style={{ fontWeight: 700, color: "var(--accent)" }}>{fmtCur(c.predicted_clv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Churn Risk */}
      {activeTab === "churn" && (
        <>
          {recencyMissing && <RecencyWarning />}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="card" style={{ padding: 20, borderLeft: "4px solid var(--danger)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>At-Risk Customers</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--danger)" }}>{data?.atRiskCount || 0}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                {data?.atRiskPercentage || 0}% of total customers
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Churn Risk Categories</div>
              {["Critical", "High", "Medium", "Low", "Safe"].map((cat) => {
                const count = (data?.customers || []).filter((c: ChurnCustomer) => c.churn_category === cat).length;
                return (
                  <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
                    <span>{cat}</span>
                    <span style={{ fontWeight: 600 }}>{fmtNum(count)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">High-Risk Customers (Score &gt; 60)</div>
              <div className="card-subtitle">Focus retention efforts here</div>
            </div>
            <input
              className="filter-input search-input"
              type="text"
              placeholder="Search customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div className="table-container" style={{ maxHeight: 600, overflowY: "auto" }}>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Days Inactive</th>
                    <th>Category</th>
                    <th>Risk Score</th>
                    <th>Total Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customers || [])
                    .filter((c: ChurnCustomer) => c.churn_risk_score >= 60 && (!search || c.name?.toLowerCase().includes(search.toLowerCase())))
                    .map((c: ChurnCustomer) => (
                      <tr key={c.customer_id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td style={{ color: "var(--text-muted)" }}>{c.days_since_order} days</td>
                        <td>
                          <span
                            style={{
                              background:
                                c.churn_category === "Critical"
                                  ? "rgba(239,68,68,0.2)"
                                  : c.churn_category === "High"
                                  ? "rgba(245,158,11,0.2)"
                                  : "rgba(107,114,128,0.2)",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {c.churn_category}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700, color: "var(--danger)" }}>{c.churn_risk_score}</td>
                        <td style={{ color: "var(--success)" }}>{fmtCur(c.total_spent)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Loyalty Analysis */}
      {activeTab === "loyalty" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
            {[
              { label: "VIP Loyal", color: "#10b981", key: "VIP Loyal" },
              { label: "Regular Loyal", color: "#f59e0b", key: "Regular Loyal" },
              { label: "Occasional Repeat", color: "#6366f1", key: "Occasional Repeat" },
              { label: "Returning", color: "#06b6d4", key: "Returning" },
              { label: "One-Time", color: "#64748b", key: "One-Time" },
            ].map((t) => (
              <div key={t.key} className="card" style={{ padding: 16, borderLeft: `4px solid ${t.color}` }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: t.color }}>
                  {fmtNum(data?.tierCounts?.[t.key] || 0)}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">All Customers by Order Count</div>
              <div className="card-subtitle">
                {fmtNum(data?.totalCustomers || 0)} customers, sorted by total orders
              </div>
            </div>
            <input
              className="filter-input search-input"
              type="text"
              placeholder="Search customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div className="table-container" style={{ maxHeight: 600, overflowY: "auto" }}>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Loyalty Tier</th>
                    <th>Orders</th>
                    <th>Total Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customers || [])
                    .filter((c: LoyaltyCustomer) => !search || c.name?.toLowerCase().includes(search.toLowerCase()))
                    .map((c: LoyaltyCustomer) => (
                      <tr key={c.customer_id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td>
                          <span
                            style={{
                              background:
                                c.loyalty_tier === "VIP Loyal"
                                  ? "rgba(16,185,129,0.2)"
                                  : c.loyalty_tier === "Regular Loyal"
                                  ? "rgba(245,158,11,0.2)"
                                  : c.loyalty_tier === "Occasional Repeat"
                                  ? "rgba(99,102,241,0.2)"
                                  : c.loyalty_tier === "Returning"
                                  ? "rgba(6,182,212,0.2)"
                                  : "rgba(107,114,128,0.2)",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {c.loyalty_tier}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{c.total_orders}</td>
                        <td style={{ color: "var(--success)" }}>{fmtCur(c.total_spent)}</td>
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
