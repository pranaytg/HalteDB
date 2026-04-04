"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, Legend,
} from "recharts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const fmtCur = (v: number) =>
  `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtNum = (v: number) => Number(v).toLocaleString("en-IN");
const fmtK = (v: number) =>
  v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v.toFixed(0)}`;

const COLORS = [
  "#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b",
  "#ef4444","#ec4899","#14b8a6","#a855f7","#f97316",
];

export default function CustomersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load customer data");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading customer analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--danger)" }}>
        {error}
      </div>
    );
  }

  const kpi = data?.kpi || {};
  const topPostal: any[] = data?.topPostalCodes || [];
  const concentration: any[] = data?.concentration || [];
  const repeatLocations: any[] = data?.repeatLocations || [];
  const byState: any[] = data?.byState || [];
  const newLocationsTrend: any[] = data?.newLocationsTrend || [];

  // How many postal codes cover 80% of revenue
  const top80 = concentration.filter((r: any) => Number(r.cumulative_pct) <= 80);
  const repeatPct = kpi.unique_postal_codes > 0
    ? ((repeatLocations.length / Number(kpi.unique_postal_codes)) * 100).toFixed(1)
    : "0";

  return (
    <div>
      {/* ═══════════════════ HEADER ═══════════════════ */}
      <div className="page-header">
        <h1 className="page-title">Customer Analytics</h1>
        <p className="page-subtitle">
          Buyer location intelligence · Amazon masks customer IDs — analysis based on shipping address data
        </p>
      </div>

      {/* ═══════════════════ KPI CARDS ═══════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Unique Buyer Locations", value: fmtNum(kpi.unique_postal_codes || 0), color: "#6366f1", icon: "📮" },
          { label: "Unique Cities", value: fmtNum(kpi.unique_cities || 0), color: "#8b5cf6", icon: "🏙️" },
          { label: "Unique States", value: fmtNum(kpi.unique_states || 0), color: "#06b6d4", icon: "🗺️" },
          { label: "Total Revenue", value: fmtCur(kpi.total_revenue || 0), color: "#10b981", icon: "💰" },
          { label: "Total Orders", value: fmtNum(kpi.total_orders || 0), color: "#f59e0b", icon: "🛒" },
        ].map((card) => (
          <div
            key={card.label}
            className="card"
            style={{ padding: "16px 20px", borderLeft: `4px solid ${card.color}`, position: "relative" }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div style={{ position: "absolute", top: 12, right: 16, fontSize: 22, opacity: 0.3 }}>{card.icon}</div>
          </div>
        ))}
      </div>

      {/* ═══════════════════ INSIGHT BANNERS ═══════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: "14px 20px", borderLeft: "4px solid #10b981", background: "rgba(16,185,129,0.05)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Pareto Insight</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {top80.length > 0
              ? `Top ${top80.length} postal code${top80.length > 1 ? "s" : ""} generate 80% of your revenue`
              : "Not enough data for concentration analysis"}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 20px", borderLeft: "4px solid #f59e0b", background: "rgba(245,158,11,0.05)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Repeat Locations</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {repeatLocations.length} locations ({repeatPct}%) have placed more than one order
          </div>
        </div>
      </div>

      {/* ═══════════════════ TOP TABLES — side by side ═══════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Top Buying Postal Codes */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Top Buying Locations</div>
            <div className="card-subtitle">By order count</div>
          </div>
          <div className="table-container" style={{ maxHeight: 380, overflowY: "auto" }}>
            <table style={{ fontSize: 12 }}>
              <thead>
                <tr><th>#</th><th>Pincode</th><th>City</th><th>State</th><th>Orders</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {topPostal.map((row: any, i: number) => (
                  <tr key={row.postal_code}>
                    <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>{row.postal_code}</td>
                    <td>{row.city || "—"}</td>
                    <td style={{ color: "var(--text-muted)" }}>{row.state || "—"}</td>
                    <td style={{ fontWeight: 700 }}>{fmtNum(row.order_count)}</td>
                    <td>{fmtCur(row.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Repeat Buyer Locations */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Repeat Buyer Locations</div>
            <div className="card-subtitle">Pincodes with more than 1 order</div>
          </div>
          <div className="table-container" style={{ maxHeight: 380, overflowY: "auto" }}>
            <table style={{ fontSize: 12 }}>
              <thead>
                <tr><th>Pincode</th><th>City</th><th>State</th><th>Orders</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {repeatLocations.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                      No repeat buyer locations found
                    </td>
                  </tr>
                ) : repeatLocations.map((row: any) => (
                  <tr key={row.postal_code}>
                    <td style={{ fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>{row.postal_code}</td>
                    <td>{row.city || "—"}</td>
                    <td style={{ color: "var(--text-muted)" }}>{row.state || "—"}</td>
                    <td style={{ fontWeight: 700, color: "#10b981" }}>{fmtNum(row.order_count)}</td>
                    <td>{fmtCur(row.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ═══════════════════ CHARTS — side by side ═══════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Revenue by State bar chart */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Revenue by State</div>
            <div className="card-subtitle">Top 15 states</div>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={byState.slice(0, 15)} layout="vertical" margin={{ left: 90 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="state" width={85} tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => fmtCur(Number(v))}
              />
              <Bar dataKey="total_revenue" radius={[0, 4, 4, 0]} name="Revenue">
                {byState.slice(0, 15).map((_: any, i: number) => (
                  <rect key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* New Locations Trend */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">New Buyer Locations Over Time</div>
            <div className="card-subtitle">First order per pincode by month</div>
          </div>
          {newLocationsTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={newLocationsTrend}>
                <defs>
                  <linearGradient id="gLocations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                />
                <Area
                  type="monotone" dataKey="new_locations" stroke="#6366f1" strokeWidth={2.5}
                  fill="url(#gLocations)" name="New Locations"
                />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
              No trend data available
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════ CONCENTRATION TABLE ═══════════════════ */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Customer Concentration (Pareto Analysis)</div>
          <div className="card-subtitle">
            Cumulative revenue share by pincode — green rows form the top 80%
          </div>
        </div>
        <div className="table-container" style={{ maxHeight: 380, overflowY: "auto" }}>
          <table style={{ fontSize: 12 }}>
            <thead>
              <tr><th>#</th><th>Pincode</th><th>Revenue</th><th>% of Total</th><th>Cumulative %</th><th>Share</th></tr>
            </thead>
            <tbody>
              {concentration.map((row: any, i: number) => {
                const inTop80 = Number(row.cumulative_pct) <= 80;
                return (
                  <tr key={row.ship_postal_code} style={{ background: inTop80 ? "rgba(16,185,129,0.04)" : undefined }}>
                    <td style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, fontFamily: "monospace", color: inTop80 ? "var(--success)" : undefined }}>
                      {row.ship_postal_code}
                    </td>
                    <td>{fmtCur(row.revenue)}</td>
                    <td>{row.pct_of_total}%</td>
                    <td style={{ color: inTop80 ? "var(--success)" : "var(--text-muted)", fontWeight: inTop80 ? 700 : 400 }}>
                      {row.cumulative_pct}%
                    </td>
                    <td style={{ width: 140 }}>
                      <div style={{ background: "var(--bg-glass)", borderRadius: 4, height: 6 }}>
                        <div style={{
                          background: inTop80 ? "#10b981" : "#6366f1",
                          borderRadius: 4,
                          height: "100%",
                          width: `${Math.min(100, Number(row.pct_of_total) * 8)}%`,
                        }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════════════════ STATE SUMMARY TABLE ═══════════════════ */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">State-wise Buyer Summary</div>
          <div className="card-subtitle">Unique pincodes per state = buyer spread</div>
        </div>
        <div className="table-container" style={{ maxHeight: 350, overflowY: "auto" }}>
          <table style={{ fontSize: 12 }}>
            <thead>
              <tr><th>State</th><th>Orders</th><th>Revenue</th><th>Unique Pincodes</th><th>Avg Revenue / Pincode</th></tr>
            </thead>
            <tbody>
              {byState.map((row: any) => (
                <tr key={row.state}>
                  <td style={{ fontWeight: 600 }}>{row.state}</td>
                  <td>{fmtNum(row.order_count)}</td>
                  <td>{fmtCur(row.total_revenue)}</td>
                  <td style={{ color: "var(--text-muted)" }}>{fmtNum(row.unique_postal_codes)}</td>
                  <td style={{ color: "var(--accent)" }}>
                    {fmtCur(Number(row.total_revenue) / Math.max(1, Number(row.unique_postal_codes)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
