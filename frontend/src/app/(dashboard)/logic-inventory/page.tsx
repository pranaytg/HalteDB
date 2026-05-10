"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Toast = { msg: string; type: "success" | "error" };

interface LogicInventoryColumn {
  key: string;
  label: string;
  index: number;
}

interface LogicInventorySheet {
  name: string;
  sheetIndex: number;
  columns: LogicInventoryColumn[];
  headerRowCount: number;
  rowCount: number;
}

interface LogicInventoryUpload {
  id: number;
  file_name: string;
  inventory_month: string | null;
  sheet_count: number;
  row_count: number;
  created_at: string;
  updated_at: string;
}

interface LogicInventoryRow {
  id: number;
  upload_id: number;
  sheet_name: string;
  sheet_index: number;
  row_index: number;
  row_data: Record<string, string>;
  updated_at: string;
}

interface LogicInventoryResponse {
  uploads: LogicInventoryUpload[];
  upload: LogicInventoryUpload | null;
  sheets: LogicInventorySheet[];
  rows: LogicInventoryRow[];
  error?: string;
}

function parseRowData(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value as Record<string, string> : {};
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function blankRowData(sheet: LogicInventorySheet) {
  return sheet.columns.reduce<Record<string, string>>((acc, column) => {
    acc[column.key] = "";
    return acc;
  }, {});
}

function normalizeColumnLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSkuColumn(column: LogicInventoryColumn) {
  const label = normalizeColumnLabel(column.label);
  return label.includes("sku") || label.includes("itemcode") || label.includes("itemskuname");
}

export default function LogicInventoryPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<LogicInventoryUpload[]>([]);
  const [activeUpload, setActiveUpload] = useState<LogicInventoryUpload | null>(null);
  const [sheets, setSheets] = useState<LogicInventorySheet[]>([]);
  const [rows, setRows] = useState<LogicInventoryRow[]>([]);
  const [activeSheetName, setActiveSheetName] = useState("");
  const [skuSearchTerm, setSkuSearchTerm] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [inventoryMonth, setInventoryMonth] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dirtyRows, setDirtyRows] = useState<Record<number, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [deletingRowId, setDeletingRowId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchLogicInventory = async (uploadId?: number) => {
    setLoading(true);
    try {
      const query = uploadId ? `?uploadId=${uploadId}` : "";
      const res = await fetch(`/api/logic-inventory${query}`);
      const data = await res.json() as LogicInventoryResponse;

      if (!res.ok) {
        showToast(data.error || "Failed to load Logic Inventory data", "error");
        return;
      }

      setUploads(data.uploads || []);
      setActiveUpload(data.upload || null);
      setSheets(data.sheets || []);
      setRows((data.rows || []).map((row) => ({
        ...row,
        row_data: parseRowData(row.row_data),
      })));
      setDirtyRows({});
    } catch {
      showToast("Failed to reach Logic Inventory API", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogicInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sheets.length === 0) {
      setActiveSheetName("");
      return;
    }
    if (!sheets.some((sheet) => sheet.name === activeSheetName)) {
      setActiveSheetName(sheets[0].name);
    }
  }, [activeSheetName, sheets]);

  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.name === activeSheetName) ?? sheets[0],
    [activeSheetName, sheets],
  );

  const sheetRows = useMemo(() => {
    if (!activeSheet) return [];
    return rows.filter((row) => row.sheet_name === activeSheet.name);
  }, [activeSheet, rows]);

  const skuColumnKeys = useMemo(() => (
    activeSheet?.columns.filter(isSkuColumn).map((column) => column.key) ?? []
  ), [activeSheet]);

  const filteredRows = useMemo(() => {
    const skuSearch = skuSearchTerm.trim().toLowerCase();
    const search = searchTerm.trim().toLowerCase();

    return sheetRows.filter((row) => (
      (!skuSearch || (
        skuColumnKeys.length > 0
          ? skuColumnKeys.some((key) => String(row.row_data[key] ?? "").toLowerCase().includes(skuSearch))
          : Object.values(row.row_data).some((value) => String(value ?? "").toLowerCase().includes(skuSearch))
      )) &&
      (!search || Object.values(row.row_data).some((value) => String(value ?? "").toLowerCase().includes(search)))
    ));
  }, [skuColumnKeys, searchTerm, sheetRows, skuSearchTerm]);

  const dirtyCount = Object.keys(dirtyRows).length;

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      showToast("Choose an Excel file before uploading.", "error");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("inventoryMonth", inventoryMonth);

      const res = await fetch("/api/logic-inventory", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to upload Logic Inventory file", "error");
        return;
      }

      showToast(data.message || "Logic Inventory imported.", "success");
      setSelectedFile(null);
      setInventoryMonth("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchLogicInventory(data.upload?.id);
    } catch {
      showToast("Network error while uploading Logic Inventory.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleUploadChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const uploadId = Number(event.target.value);
    if (Number.isFinite(uploadId)) {
      fetchLogicInventory(uploadId);
    }
  };

  const handleCellChange = (row: LogicInventoryRow, columnKey: string, value: string) => {
    const nextData = { ...row.row_data, [columnKey]: value };
    setRows((currentRows) => currentRows.map((currentRow) => (
      currentRow.id === row.id ? { ...currentRow, row_data: nextData } : currentRow
    )));
    setDirtyRows((currentDirty) => ({ ...currentDirty, [row.id]: nextData }));
  };

  const handleSaveChanges = async () => {
    const entries = Object.entries(dirtyRows);
    if (entries.length === 0) return;

    setSaving(true);
    try {
      const responses = await Promise.all(entries.map(([rowId, rowData]) => (
        fetch(`/api/logic-inventory/rows/${rowId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowData }),
        })
      )));

      const failed = responses.find((res) => !res.ok);
      if (failed) {
        const data = await failed.json().catch(() => ({}));
        showToast(data.error || "Some Logic Inventory changes were not saved.", "error");
        return;
      }

      showToast(`Saved ${entries.length} row update(s).`, "success");
      await fetchLogicInventory(activeUpload?.id);
    } catch {
      showToast("Network error while saving changes.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAddRow = async () => {
    if (!activeUpload || !activeSheet) return;

    setAddingRow(true);
    try {
      const res = await fetch("/api/logic-inventory/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: activeUpload.id,
          sheetName: activeSheet.name,
          sheetIndex: activeSheet.sheetIndex,
          rowData: blankRowData(activeSheet),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to add row.", "error");
        return;
      }

      showToast("Added a blank row.", "success");
      await fetchLogicInventory(activeUpload.id);
    } catch {
      showToast("Network error while adding row.", "error");
    } finally {
      setAddingRow(false);
    }
  };

  const handleDeleteRow = async (row: LogicInventoryRow) => {
    if (!window.confirm("Delete this Logic Inventory row?")) return;

    setDeletingRowId(row.id);
    try {
      const res = await fetch(`/api/logic-inventory/rows/${row.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showToast(data.error || "Failed to delete row.", "error");
        return;
      }

      setDirtyRows((currentDirty) => {
        const nextDirty = { ...currentDirty };
        delete nextDirty[row.id];
        return nextDirty;
      });
      showToast("Deleted row.", "success");
      await fetchLogicInventory(row.upload_id);
    } catch {
      showToast("Network error while deleting row.", "error");
    } finally {
      setDeletingRowId(null);
    }
  };

  if (loading && !activeUpload) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
        Loading Logic Inventory...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Logic Inventory</h1>
        <p className="page-subtitle">Upload monthly physical stock count workbooks, review sheets, and edit inventory cells manually.</p>
      </div>

      <div className="filters-bar">
        <form onSubmit={handleUpload} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="filter-group">
            <label className="filter-label">Excel File</label>
            <input
              ref={fileInputRef}
              className="filter-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              style={{ minWidth: 260 }}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label">Month / Label</label>
            <input
              className="filter-input"
              type="text"
              placeholder="May 2026"
              value={inventoryMonth}
              onChange={(event) => setInventoryMonth(event.target.value)}
              style={{ minWidth: 180 }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={uploading}>
            {uploading ? "Uploading..." : "Upload Workbook"}
          </button>
        </form>

        <div className="filter-group" style={{ marginLeft: "auto" }}>
          <label className="filter-label">Uploaded Files</label>
          <select
            className="filter-select"
            value={activeUpload?.id ?? ""}
            onChange={handleUploadChange}
            disabled={uploads.length === 0}
            style={{ minWidth: 260 }}
          >
            {uploads.length === 0 && <option value="">No uploads yet</option>}
            {uploads.map((upload) => (
              <option key={upload.id} value={upload.id}>
                {upload.inventory_month ? `${upload.inventory_month} - ` : ""}{upload.file_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Uploaded Files</div>
          <div className="metric-value">{uploads.length.toLocaleString()}</div>
        </div>
        <div className="metric-card accent-green">
          <div className="metric-label">Current Rows</div>
          <div className="metric-value">{(activeUpload?.row_count ?? 0).toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sheets</div>
          <div className="metric-value">{(activeUpload?.sheet_count ?? 0).toLocaleString()}</div>
        </div>
        <div className="metric-card accent-orange">
          <div className="metric-label">Last Updated</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{formatDate(activeUpload?.updated_at)}</div>
        </div>
      </div>

      {!activeUpload && (
        <div className="card empty-state">
          Upload the first Logic Inventory workbook to populate this tab.
        </div>
      )}

      {activeUpload && activeSheet && (
        <>
          <div className="tabs" style={{ maxWidth: "100%", overflowX: "auto" }}>
            {sheets.map((sheet) => (
              <button
                key={sheet.name}
                className={`tab ${activeSheet.name === sheet.name ? "active" : ""}`}
                onClick={() => setActiveSheetName(sheet.name)}
                type="button"
                title={`${sheet.rowCount} rows`}
              >
                {sheet.name}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="card-header" style={{ gap: 16, alignItems: "flex-start" }}>
              <div>
                <div className="card-title">{activeSheet.name}</div>
                <div className="card-subtitle">
                  {filteredRows.length.toLocaleString()} visible rows from {sheetRows.length.toLocaleString()} total rows in {activeUpload.file_name}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <input
                  className="filter-input search-input"
                  type="text"
                  placeholder="Search SKU / item code..."
                  value={skuSearchTerm}
                  onChange={(event) => setSkuSearchTerm(event.target.value)}
                />
                <input
                  className="filter-input search-input"
                  type="text"
                  placeholder="Search all cells..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                <button className="btn btn-ghost btn-sm" onClick={handleAddRow} disabled={addingRow}>
                  {addingRow ? "Adding..." : "Add Row"}
                </button>
                <button className="btn btn-success btn-sm" onClick={handleSaveChanges} disabled={dirtyCount === 0 || saving}>
                  {saving ? "Saving..." : `Save Changes (${dirtyCount})`}
                </button>
              </div>
            </div>

            <div className="table-container" style={{ maxHeight: 620, overflow: "auto" }}>
              <table style={{ minWidth: Math.max(900, activeSheet.columns.length * 170 + 120) }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 70 }}>#</th>
                    {activeSheet.columns.map((column) => (
                      <th key={column.key} style={{ minWidth: 160 }}>
                        {column.label}
                      </th>
                    ))}
                    <th style={{ minWidth: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ color: "var(--text-muted)", fontWeight: 600 }}>
                        {row.row_index}
                      </td>
                      {activeSheet.columns.map((column) => (
                        <td key={column.key} style={{ padding: 6, minWidth: 160 }}>
                          <input
                            type="text"
                            value={row.row_data[column.key] ?? ""}
                            onChange={(event) => handleCellChange(row, column.key, event.target.value)}
                            style={{
                              minWidth: 145,
                              padding: "7px 9px",
                              fontSize: 12,
                              borderColor: dirtyRows[row.id] ? "rgba(16, 185, 129, 0.45)" : "var(--border)",
                            }}
                          />
                        </td>
                      ))}
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDeleteRow(row)}
                          disabled={deletingRowId === row.id}
                        >
                          {deletingRowId === row.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={activeSheet.columns.length + 2} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                        No rows match the current search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
