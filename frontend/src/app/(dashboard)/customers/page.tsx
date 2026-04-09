"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, Legend,
} from "recharts";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Customer {
  id: number;
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  total_orders: number;
  total_spent: number;
  last_order_date: string | null;
  notes: string | null;
}

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
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"customers" | "analytics">("customers");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Add/Edit customer
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", city: "", state: "", pincode: "", notes: "" });

  // Messaging
  const [messageCustomer, setMessageCustomer] = useState<Customer | null>(null);
  const [messageText, setMessageText] = useState("");

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/customers?${params}`);
      const d = await res.json();
      if (d.error) setError(d.error);
      else setData(d);
    } catch {
      setError("Failed to load customer data");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(fetchData, 300);
    return () => clearTimeout(timeout);
  }, [fetchData]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Name is required", "error"); return; }
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error || "Failed", "error"); return; }
      showToast("Customer added", "success");
      setShowAddForm(false);
      setForm({ name: "", phone: "", email: "", address: "", city: "", state: "", pincode: "", notes: "" });
      fetchData();
    } catch { showToast("Network error", "error"); }
  };

  const handleEditCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    try {
      const res = await fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: editingCustomer.customer_id, ...form }),
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error || "Failed", "error"); return; }
      showToast("Customer updated", "success");
      setEditingCustomer(null);
      fetchData();
    } catch { showToast("Network error", "error"); }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    if (!confirm(`Delete customer ${customerId}?`)) return;
    try {
      await fetch("/api/customers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId }),
      });
      showToast("Customer deleted", "success");
      fetchData();
    } catch { showToast("Failed to delete", "error"); }
  };

  const startEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({
      name: c.name || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      city: c.city || "",
      state: c.state || "",
      pincode: c.pincode || "",
      notes: c.notes || "",
    });
  };

  const openWhatsApp = (customer: Customer, message: string) => {
    if (!customer.phone) { showToast("No phone number", "error"); return; }
    const phone = customer.phone.replace(/[^0-9]/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message || `Hi ${customer.name}, this is Halte. How can we help you today?`)}`;
    window.open(url, "_blank");
  };

  const openEmail = (customer: Customer, message: string) => {
    if (!customer.email) { showToast("No email address", "error"); return; }
    const subject = encodeURIComponent("Message from Halte");
    const body = encodeURIComponent(message || `Hi ${customer.name},\n\nThank you for your purchase from Halte.\n\nBest regards,\nHalte Team`);
    window.open(`mailto:${customer.email}?subject=${subject}&body=${body}`, "_blank");
  };

  const openSMS = (customer: Customer, message: string) => {
    if (!customer.phone) { showToast("No phone number", "error"); return; }
    const phone = customer.phone.replace(/[^0-9]/g, "");
    window.open(`sms:+${phone}?body=${encodeURIComponent(message || `Hi ${customer.name}, this is Halte.`)}`, "_blank");
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading customer data...
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
  const customers: Customer[] = data?.customers || [];
  const topPostal: any[] = data?.topPostalCodes || [];
  const byState: any[] = data?.byState || [];
  const repeatLocations: any[] = data?.repeatLocations || [];
  const newLocationsTrend: any[] = data?.newLocationsTrend || [];

  const filteredCustomers = customers.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.customer_id?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase()) ||
    c.state?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Customers</h1>
        <p className="page-subtitle">
          Customer management, messaging, and location analytics
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Total Customers", value: fmtNum(kpi.total_customers || kpi.unique_postal_codes || 0), color: "#6366f1", icon: "P" },
          { label: "Total Orders", value: fmtNum(kpi.total_orders || 0), color: "#f59e0b", icon: "O" },
          { label: "Total Revenue", value: fmtCur(kpi.total_revenue || 0), color: "#10b981", icon: "R" },
          { label: "Unique Cities", value: fmtNum(kpi.unique_cities || 0), color: "#8b5cf6", icon: "C" },
          { label: "Unique States", value: fmtNum(kpi.unique_states || 0), color: "#06b6d4", icon: "S" },
        ].map((card) => (
          <div key={card.label} className="card" style={{ padding: "16px 20px", borderLeft: `4px solid ${card.color}`, position: "relative" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div style={{ position: "absolute", top: 12, right: 16, fontSize: 18, opacity: 0.15, fontWeight: 800 }}>{card.icon}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs-bar" style={{ marginBottom: 16 }}>
        <button className={`tab-btn ${activeTab === "customers" ? "active" : ""}`}
          onClick={() => setActiveTab("customers")}>Customer Directory</button>
        <button className={`tab-btn ${activeTab === "analytics" ? "active" : ""}`}
          onClick={() => setActiveTab("analytics")}>Location Analytics</button>
      </div>

      {/* ═══════ CUSTOMERS TAB ═══════ */}
      {activeTab === "customers" && (
        <>
          {/* Action bar */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={() => { setShowAddForm(!showAddForm); setEditingCustomer(null); }}>
              {showAddForm ? "Close" : "+ Add Customer"}
            </button>
            <input
              className="filter-input search-input"
              type="text"
              placeholder="Search by name, phone, email, city..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 250 }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Add/Edit Form */}
          {(showAddForm || editingCustomer) && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div className="card-title">{editingCustomer ? `Edit ${editingCustomer.customer_id}` : "Add New Customer"}</div>
              </div>
              <form onSubmit={editingCustomer ? handleEditCustomer : handleAddCustomer}
                style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                {[
                  { key: "name", label: "Name *", width: 180 },
                  { key: "phone", label: "Phone (with country code)", width: 170 },
                  { key: "email", label: "Email", width: 200 },
                  { key: "address", label: "Address", width: 250 },
                  { key: "city", label: "City", width: 130 },
                  { key: "state", label: "State", width: 140 },
                  { key: "pincode", label: "Pincode", width: 100 },
                  { key: "notes", label: "Notes", width: 200 },
                ].map(f => (
                  <div className="filter-group" key={f.key}>
                    <span className="filter-label">{f.label}</span>
                    <input className="filter-input" style={{ width: f.width }}
                      value={(form as any)[f.key]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      required={f.key === "name"}
                      placeholder={f.key === "phone" ? "919876543210" : ""}
                    />
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="btn btn-success">
                    {editingCustomer ? "Update" : "Save"}
                  </button>
                  <button type="button" className="btn btn-ghost"
                    onClick={() => { setShowAddForm(false); setEditingCustomer(null); }}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Messaging Modal */}
          {messageCustomer && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
              display: "flex", alignItems: "center", justifyContent: "center",
            }} onClick={() => setMessageCustomer(null)}>
              <div className="card" style={{ maxWidth: 500, width: "90%", padding: 24 }}
                onClick={e => e.stopPropagation()}>
                <h3 style={{ marginBottom: 4 }}>Send Message</h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
                  To: <strong>{messageCustomer.name}</strong>
                  {messageCustomer.phone && ` | ${messageCustomer.phone}`}
                  {messageCustomer.email && ` | ${messageCustomer.email}`}
                </p>
                <textarea
                  className="filter-input"
                  style={{ width: "100%", minHeight: 100, resize: "vertical", marginBottom: 16, fontFamily: "inherit" }}
                  placeholder="Type your message here..."
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-success" style={{ background: "#25D366" }}
                    onClick={() => { openWhatsApp(messageCustomer, messageText); setMessageCustomer(null); setMessageText(""); }}>
                    WhatsApp
                  </button>
                  <button className="btn btn-primary"
                    onClick={() => { openEmail(messageCustomer, messageText); setMessageCustomer(null); setMessageText(""); }}>
                    Email
                  </button>
                  <button className="btn btn-primary" style={{ background: "#06b6d4" }}
                    onClick={() => { openSMS(messageCustomer, messageText); setMessageCustomer(null); setMessageText(""); }}>
                    SMS
                  </button>
                  <button className="btn btn-ghost" style={{ marginLeft: "auto" }}
                    onClick={() => { setMessageCustomer(null); setMessageText(""); }}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Customer Table */}
          {filteredCustomers.length > 0 ? (
            <div className="card">
              <div className="table-container" style={{ maxHeight: 600, overflowY: "auto" }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Email</th>
                      <th>City</th>
                      <th>State</th>
                      <th>Pincode</th>
                      <th>Orders</th>
                      <th>Total Spent</th>
                      <th>Last Order</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map(c => (
                      <tr key={c.customer_id}>
                        <td style={{ fontFamily: "monospace", color: "var(--accent)", fontWeight: 600 }}>{c.customer_id}</td>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                          {c.phone ? (
                            <span style={{ cursor: "pointer", color: "#25D366" }}
                              onClick={() => openWhatsApp(c, "")} title="Open WhatsApp">
                              {c.phone}
                            </span>
                          ) : <span style={{ color: "var(--text-muted)" }}>--</span>}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {c.email ? (
                            <span style={{ cursor: "pointer", color: "var(--accent)" }}
                              onClick={() => openEmail(c, "")} title="Send Email">
                              {c.email}
                            </span>
                          ) : <span style={{ color: "var(--text-muted)" }}>--</span>}
                        </td>
                        <td>{c.city || "--"}</td>
                        <td style={{ color: "var(--text-muted)" }}>{c.state || "--"}</td>
                        <td style={{ fontFamily: "monospace" }}>{c.pincode || "--"}</td>
                        <td style={{ fontWeight: 700 }}>{c.total_orders || 0}</td>
                        <td style={{ fontWeight: 600, color: "var(--success)" }}>{fmtCur(c.total_spent || 0)}</td>
                        <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {c.last_order_date ? new Date(c.last_order_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "--"}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" title="Send Message"
                              onClick={() => setMessageCustomer(c)}
                              style={{ color: "#25D366" }}>
                              Msg
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => startEdit(c)} title="Edit">
                              Edit
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }}
                              onClick={() => handleDeleteCustomer(c.customer_id)} title="Delete">
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              No customers found. Add customers or run the seed script.
            </div>
          )}
        </>
      )}

      {/* ═══════ ANALYTICS TAB ═══════ */}
      {activeTab === "analytics" && (
        <>
          {/* Insight Banners */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: "14px 20px", borderLeft: "4px solid #10b981", background: "rgba(16,185,129,0.05)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Repeat Locations</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {repeatLocations.length} location{repeatLocations.length !== 1 ? "s" : ""} have placed more than one order
              </div>
            </div>
            <div className="card" style={{ padding: "14px 20px", borderLeft: "4px solid #f59e0b", background: "rgba(245,158,11,0.05)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Geographic Spread</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Orders from {fmtNum(kpi.unique_cities || 0)} cities across {fmtNum(kpi.unique_states || 0)} states
              </div>
            </div>
          </div>

          {/* Top Locations + Repeat — side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
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
                        <td>{row.city || "--"}</td>
                        <td style={{ color: "var(--text-muted)" }}>{row.state || "--"}</td>
                        <td style={{ fontWeight: 700 }}>{fmtNum(row.order_count)}</td>
                        <td>{fmtCur(row.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

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
                      <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                        No repeat buyer locations found
                      </td></tr>
                    ) : repeatLocations.map((row: any) => (
                      <tr key={row.postal_code}>
                        <td style={{ fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>{row.postal_code}</td>
                        <td>{row.city || "--"}</td>
                        <td style={{ color: "var(--text-muted)" }}>{row.state || "--"}</td>
                        <td style={{ fontWeight: 700, color: "#10b981" }}>{fmtNum(row.order_count)}</td>
                        <td>{fmtCur(row.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
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
                    <Area type="monotone" dataKey="new_locations" stroke="#6366f1" strokeWidth={2.5}
                      fill="url(#gLocations)" name="New Locations" />
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

          {/* State Summary Table */}
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
        </>
      )}

      {/* Toast */}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
