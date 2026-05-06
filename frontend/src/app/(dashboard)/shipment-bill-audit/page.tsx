"use client";

import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";

type CarrierFilter = "" | "bluedart" | "delhivery";
type AuditStatus = "" | "overcharged" | "missing_proposed" | "unmatched" | "undercharged" | "ok";

interface AuditSummary {
  total_lines: number | string;
  matched_lines: number | string;
  overcharged_lines: number | string;
  missing_proposed_lines: number | string;
  unmatched_lines: number | string;
  undercharged_lines: number | string;
  ok_lines: number | string;
  total_actual: number | string;
  total_proposed: number | string;
  total_overcharge: number | string;
  net_variance: number | string;
}

interface AuditUpload {
  id: number;
  carrier: string;
  invoice_number: string | null;
  invoice_date: string | null;
  billing_period: string | null;
  file_name: string | null;
  row_count: number | string;
  matched_count: number | string;
  overcharged_count: number | string;
  total_actual: number | string;
  total_proposed: number | string;
  total_variance: number | string;
  created_at: string;
}

interface AuditLine {
  id: number;
  upload_id: number;
  carrier: string;
  invoice_number: string | null;
  ship_date: string | null;
  awb_number: string | null;
  order_ref: string | null;
  destination_area: string | null;
  destination_pincode: string | null;
  service_type: string | null;
  actual_weight_kg: number | string | null;
  charged_weight_kg: number | string | null;
  actual_billed_amount: number | string;
  matched_amazon_order_id: string | null;
  matched_sku: string | null;
  match_confidence: number | string | null;
  match_method: string | null;
  proposed_amount: number | string | null;
  variance_amount: number | string | null;
  variance_percent: number | string | null;
  audit_status: AuditStatus;
  notes: string | null;
  file_name: string | null;
  billing_period: string | null;
  ship_city: string | null;
  ship_state: string | null;
  delhivery_cost: number | string | null;
  bluedart_cost: number | string | null;
  proposed_weight_kg: number | string | null;
}

const PAGE_SIZE = 75;

const fmtMoney = (value: number | string | null | undefined) => {
  if (value == null || value === "") return "-";
  return `Rs.${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
};

const fmtInt = (value: number | string | null | undefined) => {
  if (value == null || value === "") return "0";
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
};

const fmtDate = (value: string | null | undefined) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

const fmtWeight = (value: number | string | null | undefined) => {
  if (value == null || value === "") return "-";
  return `${Number(value).toFixed(2)} kg`;
};

const carrierLabel = (carrier: string | null | undefined) => {
  if (carrier === "bluedart") return "BlueDart";
  if (carrier === "delhivery") return "Delhivery";
  return carrier || "-";
};

function statusMeta(status: AuditStatus | string) {
  switch (status) {
    case "overcharged":
      return { label: "Overcharged", color: "#f87171", bg: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.45)" };
    case "missing_proposed":
      return { label: "No Quote", color: "#fbbf24", bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.35)" };
    case "unmatched":
      return { label: "Unmatched", color: "#fbbf24", bg: "rgba(245,158,11,0.11)", border: "rgba(245,158,11,0.28)" };
    case "undercharged":
      return { label: "Under", color: "#34d399", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.32)" };
    default:
      return { label: "OK", color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.22)" };
  }
}

function rowStyle(status: AuditStatus | string): CSSProperties {
  if (status === "overcharged") {
    return { background: "rgba(239,68,68,0.10)", boxShadow: "inset 3px 0 0 #ef4444" };
  }
  if (status === "missing_proposed" || status === "unmatched") {
    return { background: "rgba(245,158,11,0.07)", boxShadow: "inset 3px 0 0 #f59e0b" };
  }
  if (status === "undercharged") {
    return { background: "rgba(16,185,129,0.06)", boxShadow: "inset 3px 0 0 #10b981" };
  }
  return {};
}

export default function ShipmentBillAuditPage() {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [uploads, setUploads] = useState<AuditUpload[]>([]);
  const [lines, setLines] = useState<AuditLine[]>([]);
  const [carrier, setCarrier] = useState<CarrierFilter>("");
  const [uploadCarrier, setUploadCarrier] = useState<Exclude<CarrierFilter, "">>("bluedart");
  const [status, setStatus] = useState<AuditStatus>("");
  const [uploadId, setUploadId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [billingPeriod, setBillingPeriod] = useState("");
  const [tolerance, setTolerance] = useState("5");
  const [toast, setToast] = useState<string | null>(null);

  const fetchAudit = useCallback(async (overrides?: {
    page?: number;
    carrier?: CarrierFilter;
    status?: AuditStatus;
    uploadId?: string;
    search?: string;
  }) => {
    const nextPage = overrides?.page ?? page;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(nextPage * PAGE_SIZE),
    });
    const nextCarrier = overrides?.carrier ?? carrier;
    const nextStatus = overrides?.status ?? status;
    const nextUploadId = overrides?.uploadId ?? uploadId;
    const nextSearch = overrides?.search ?? search;

    if (nextCarrier) params.set("carrier", nextCarrier);
    if (nextStatus) params.set("status", nextStatus);
    if (nextUploadId) params.set("uploadId", nextUploadId);
    if (nextSearch) params.set("search", nextSearch);

    setLoading(true);
    try {
      const res = await fetch(`/api/shipment/bill-audit?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setSummary(data.summary || null);
        setUploads(data.uploads || []);
        setLines(data.lines || []);
        setTotal(data.pagination?.total || 0);
      } else {
        setToast(data.error || "Failed to load bill audit");
      }
    } catch {
      setToast("Failed to load bill audit");
    } finally {
      setLoading(false);
    }
  }, [carrier, page, search, status, uploadId]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setToast("Choose a bill file first");
      setTimeout(() => setToast(null), 3500);
      return;
    }

    setUploading(true);
    setToast(null);
    const form = new FormData();
    form.append("carrier", uploadCarrier);
    form.append("file", selectedFile);
    form.append("invoiceNumber", invoiceNumber);
    form.append("invoiceDate", invoiceDate);
    form.append("billingPeriod", billingPeriod);
    form.append("tolerance", tolerance);

    try {
      const res = await fetch("/api/shipment/bill-audit/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        const nextUploadId = String(data.upload?.id || "");
        setToast(data.message || "Bill imported");
        setUploadId(nextUploadId);
        setCarrier("");
        setStatus("");
        setPage(0);
        setSelectedFile(null);
        setInvoiceNumber("");
        setInvoiceDate("");
        setBillingPeriod("");
        await fetchAudit({ page: 0, carrier: "", status: "", uploadId: nextUploadId });
      } else {
        setToast(data.error || "Upload failed");
      }
    } catch {
      setToast("Upload failed");
    } finally {
      setUploading(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const changeFilter = (next: {
    carrier?: CarrierFilter;
    status?: AuditStatus;
    uploadId?: string;
    search?: string;
  }) => {
    const nextCarrier = next.carrier ?? carrier;
    const nextStatus = next.status ?? status;
    const nextUploadId = next.uploadId ?? uploadId;
    const nextSearch = next.search ?? search;
    setCarrier(nextCarrier);
    setStatus(nextStatus);
    setUploadId(nextUploadId);
    setSearch(nextSearch);
    setPage(0);
    fetchAudit({ page: 0, carrier: nextCarrier, status: nextStatus, uploadId: nextUploadId, search: nextSearch });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1560 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Shipment Bill Audit</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
            Monthly BlueDart and Delhivery bill reconciliation
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(340px, 0.9fr) minmax(560px, 1.6fr)", gap: 16, marginBottom: 24 }}>
        <form className="card" onSubmit={submitUpload} style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Import Bill</h2>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {selectedFile?.name || "No file"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Carrier</span>
              <select className="filter-select" value={uploadCarrier} onChange={(e) => setUploadCarrier(e.target.value as Exclude<CarrierFilter, "">)}>
                <option value="bluedart">BlueDart</option>
                <option value="delhivery">Delhivery</option>
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Tolerance</span>
              <input type="number" min="0" step="0.5" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Invoice No</span>
              <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Invoice Date</span>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </label>
          </div>

          <label style={{ ...fieldStyle, marginTop: 12 }}>
            <span style={labelStyle}>Billing Period</span>
            <input type="text" placeholder="Mar 2026" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} />
          </label>

          <label style={{ ...fieldStyle, marginTop: 12 }}>
            <span style={labelStyle}>Bill File</span>
            <input
              key={selectedFile ? "file-selected" : "file-empty"}
              type="file"
              accept=".csv,.xlsx,.xls,.xlsb"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              style={{ padding: 8 }}
            />
          </label>

          <button className="btn btn-primary" disabled={uploading} style={{ width: "100%", justifyContent: "center", marginTop: 16 }}>
            {uploading ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                Importing...
              </>
            ) : "Import & Audit"}
          </button>
        </form>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: 12 }}>
          <Metric title="Bill Lines" value={fmtInt(summary?.total_lines)} color="#94a3b8" />
          <Metric title="Matched" value={fmtInt(summary?.matched_lines)} color="#60a5fa" />
          <Metric title="Overcharged" value={fmtInt(summary?.overcharged_lines)} color="#f87171" />
          <Metric title="Overcharge Rs." value={fmtMoney(summary?.total_overcharge)} color="#f87171" />
          <Metric title="Actual Bill" value={fmtMoney(summary?.total_actual)} color="#e5e7eb" />
          <Metric title="Proposed" value={fmtMoney(summary?.total_proposed)} color="#22c55e" />
          <Metric title="Net Variance" value={fmtMoney(summary?.net_variance)} color={Number(summary?.net_variance || 0) > 0 ? "#f87171" : "#34d399"} />
          <Metric title="Unmatched" value={fmtInt(summary?.unmatched_lines)} color="#fbbf24" />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="filter-select" value={uploadId} onChange={(e) => changeFilter({ uploadId: e.target.value })}>
              <option value="">All uploads</option>
              {uploads.map((upload) => (
                <option key={upload.id} value={upload.id}>
                  #{upload.id} {carrierLabel(upload.carrier)} {upload.invoice_number || upload.file_name || ""}
                </option>
              ))}
            </select>
            <select className="filter-select" value={carrier} onChange={(e) => changeFilter({ carrier: e.target.value as CarrierFilter })}>
              <option value="">All carriers</option>
              <option value="bluedart">BlueDart</option>
              <option value="delhivery">Delhivery</option>
            </select>
            <select className="filter-select" value={status} onChange={(e) => changeFilter({ status: e.target.value as AuditStatus })}>
              <option value="">All statuses</option>
              <option value="overcharged">Overcharged</option>
              <option value="missing_proposed">No quote</option>
              <option value="unmatched">Unmatched</option>
              <option value="undercharged">Under</option>
              <option value="ok">OK</option>
            </select>
            <input
              type="text"
              placeholder="Search AWB, order, SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") changeFilter({ search });
              }}
              style={{ width: 220 }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => changeFilter({ search })}>Search</button>
            <button className="btn btn-ghost btn-sm" onClick={() => changeFilter({ carrier: "", status: "", uploadId: "", search: "" })}>Reset</button>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, alignSelf: "center" }}>
            {fmtInt(total)} rows · Page {page + 1} of {totalPages}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 44, textAlign: "center" }}>
            <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-muted)" }}>Loading audit...</p>
          </div>
        ) : lines.length === 0 ? (
          <div style={{ padding: 44, textAlign: "center", color: "var(--text-muted)" }}>
            No bill rows found.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Status</th>
                  <th style={th}>Carrier</th>
                  <th style={th}>Ship Date</th>
                  <th style={th}>AWB / Ref</th>
                  <th style={th}>Destination</th>
                  <th style={th}>Weight</th>
                  <th style={th}>Matched Order</th>
                  <th style={{ ...th, textAlign: "right" }}>Actual</th>
                  <th style={{ ...th, textAlign: "right" }}>Proposed</th>
                  <th style={{ ...th, textAlign: "right" }}>Variance</th>
                  <th style={th}>Match</th>
                  <th style={th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const meta = statusMeta(line.audit_status);
                  return (
                    <tr key={line.id} style={rowStyle(line.audit_status)}>
                      <td style={td}>
                        <span style={{
                          display: "inline-block",
                          padding: "3px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 800,
                          color: meta.color,
                          background: meta.bg,
                          border: `1px solid ${meta.border}`,
                        }}>
                          {meta.label}
                        </span>
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{carrierLabel(line.carrier)}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{line.invoice_number || line.billing_period || `Upload #${line.upload_id}`}</div>
                      </td>
                      <td style={td}>{fmtDate(line.ship_date)}</td>
                      <td style={td}>
                        <div style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>{line.awb_number || "-"}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{line.order_ref || "-"}</div>
                      </td>
                      <td style={td}>
                        <div>{line.destination_area || line.ship_city || "-"}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                          {line.ship_state ? `${line.ship_state} · ` : ""}{line.destination_pincode || "-"}
                        </div>
                      </td>
                      <td style={td}>
                        <div>Charged {fmtWeight(line.charged_weight_kg)}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Proposed {fmtWeight(line.proposed_weight_kg)}</div>
                      </td>
                      <td style={td}>
                        <div style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>
                          {line.matched_amazon_order_id?.slice(-12) || "-"}
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {line.matched_sku || "-"}
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: "var(--text-primary)" }}>{fmtMoney(line.actual_billed_amount)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtMoney(line.proposed_amount)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: Number(line.variance_amount || 0) > 0 ? "#f87171" : "#34d399" }}>
                        {fmtMoney(line.variance_amount)}
                        {line.variance_percent != null && (
                          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{Number(line.variance_percent).toFixed(1)}%</div>
                        )}
                      </td>
                      <td style={td}>
                        <div>{line.match_method || "-"}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                          {line.match_confidence == null ? "-" : `${Math.round(Number(line.match_confidence) * 100)}%`}
                        </div>
                      </td>
                      <td style={{ ...td, color: "var(--text-muted)", maxWidth: 260, whiteSpace: "normal" }}>
                        {line.notes || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => {
                const nextPage = page - 1;
                setPage(nextPage);
                fetchAudit({ page: nextPage });
              }}>Prev</button>
              <button className="btn btn-ghost btn-sm" disabled={page >= totalPages - 1} onClick={() => {
                const nextPage = page + 1;
                setPage(nextPage);
                fetchAudit({ page: nextPage });
              }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
};

const th: CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
  color: "var(--text-muted)",
};

const td: CSSProperties = {
  padding: "11px 12px",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

function Metric({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px", minHeight: 92, borderLeft: `3px solid ${color}` }}>
      <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ color, fontSize: 22, fontWeight: 850, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}
