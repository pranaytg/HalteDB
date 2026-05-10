import type { PoolClient } from "pg";
import * as XLSX from "xlsx";

type Queryable = Pick<PoolClient, "query">;
type WorkbookCell = string | number | boolean | Date | null | undefined;
type WorkbookRow = WorkbookCell[];

export interface LogicInventoryColumn {
  key: string;
  label: string;
  index: number;
}

export interface LogicInventorySheetMeta {
  name: string;
  sheetIndex: number;
  columns: LogicInventoryColumn[];
  headerRowCount: number;
  rowCount: number;
}

export interface ParsedLogicInventoryRow {
  sheetName: string;
  sheetIndex: number;
  rowIndex: number;
  rowData: Record<string, string>;
}

export interface ParsedLogicInventoryWorkbook {
  sheets: LogicInventorySheetMeta[];
  rows: ParsedLogicInventoryRow[];
}

export async function ensureLogicInventoryTables(db: Queryable) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS logic_inventory_uploads (
      id SERIAL PRIMARY KEY,
      file_name TEXT NOT NULL,
      inventory_month TEXT,
      sheet_count INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      sheets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS logic_inventory_rows (
      id BIGSERIAL PRIMARY KEY,
      upload_id INTEGER NOT NULL REFERENCES logic_inventory_uploads(id) ON DELETE CASCADE,
      sheet_name TEXT NOT NULL,
      sheet_index INTEGER NOT NULL DEFAULT 0,
      row_index INTEGER NOT NULL DEFAULT 0,
      row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS ix_logic_inventory_uploads_created ON logic_inventory_uploads (created_at DESC)");
  await db.query("CREATE INDEX IF NOT EXISTS ix_logic_inventory_rows_upload ON logic_inventory_rows (upload_id, sheet_index, row_index)");
  await db.query("CREATE INDEX IF NOT EXISTS ix_logic_inventory_rows_sheet ON logic_inventory_rows (upload_id, sheet_name)");
}

export function parseLogicInventoryWorkbook(buffer: Buffer): ParsedLogicInventoryWorkbook {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    cellText: true,
    dateNF: "yyyy-mm-dd",
  });

  const sheets: LogicInventorySheetMeta[] = [];
  const parsedRows: ParsedLogicInventoryRow[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false,
      blankrows: false,
    }) as WorkbookRow[];

    const rows = rawRows.filter(rowHasValue);
    if (rows.length === 0) return;

    const headerRowCount = detectHeaderRowCount(rows);
    const dataRows = rows.slice(headerRowCount);
    const columnIndexes = activeColumnIndexes(rows, dataRows, headerRowCount);
    if (columnIndexes.length === 0) return;

    const columns = buildColumns(rows, headerRowCount, columnIndexes);
    const sheetRows = dataRows
      .filter(rowHasValue)
      .map((row, dataIndex) => ({
        sheetName,
        sheetIndex,
        rowIndex: dataIndex + 1,
        rowData: buildRowData(row, columns),
      }));

    sheets.push({
      name: sheetName,
      sheetIndex,
      columns,
      headerRowCount,
      rowCount: sheetRows.length,
    });
    parsedRows.push(...sheetRows);
  });

  return { sheets, rows: parsedRows };
}

function activeColumnIndexes(rows: WorkbookRow[], dataRows: WorkbookRow[], headerRowCount: number) {
  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  const headerRows = rows.slice(0, headerRowCount);
  const indexes: number[] = [];

  for (let index = 0; index < columnCount; index += 1) {
    const headerHasValue = headerRows.some((row) => cleanCell(row[index]) !== "");
    const dataHasValue = dataRows.some((row) => cleanCell(row[index]) !== "");
    if (headerHasValue || dataHasValue) indexes.push(index);
  }

  return indexes;
}

function buildColumns(rows: WorkbookRow[], headerRowCount: number, columnIndexes: number[]): LogicInventoryColumn[] {
  const firstHeader = rows[0] ?? [];
  const secondHeader = rows[1] ?? [];
  const duplicateTopLabels = duplicateLabels(firstHeader);
  const periodByIndex = buildPeriodMap(secondHeader, columnIndexes);
  const usedLabels = new Map<string, number>();

  return columnIndexes.map((index) => {
    const top = cleanCell(firstHeader[index]);
    const second = headerRowCount > 1 ? cleanCell(secondHeader[index]) : "";
    const topKey = normalizeHeaderLabel(top);
    const period = topKey && duplicateTopLabels.has(topKey) ? periodByIndex.get(index) ?? "" : "";

    let label = "";
    if (top && period && normalizeHeaderLabel(top) !== normalizeHeaderLabel(period)) {
      label = `${top} / ${period}`;
    } else if (top) {
      label = top;
    } else if (second) {
      label = second;
    } else {
      label = columnLabel(index);
    }

    const count = usedLabels.get(label) ?? 0;
    usedLabels.set(label, count + 1);

    return {
      key: `col_${index}`,
      label: count > 0 ? `${label} (${count + 1})` : label,
      index,
    };
  });
}

function buildRowData(row: WorkbookRow, columns: LogicInventoryColumn[]) {
  return columns.reduce<Record<string, string>>((acc, column) => {
    acc[column.key] = cleanCell(row[column.index]);
    return acc;
  }, {});
}

function detectHeaderRowCount(rows: WorkbookRow[]) {
  if (rows.length < 2) return 1;

  const firstHeader = rows[0] ?? [];
  const secondHeader = rows[1] ?? [];
  const firstDuplicates = duplicateLabels(firstHeader).size;
  const secondHasPeriod = secondHeader.some((cell) => isPeriodLabel(cleanCell(cell)));

  return firstDuplicates >= 2 && secondHasPeriod ? 2 : 1;
}

function buildPeriodMap(row: WorkbookRow, columnIndexes: number[]) {
  const result = new Map<number, string>();
  let currentPeriod = "";

  for (const index of columnIndexes) {
    const value = cleanCell(row[index]);
    if (isPeriodLabel(value)) currentPeriod = value;
    if (currentPeriod) result.set(index, currentPeriod);
  }

  return result;
}

function duplicateLabels(row: WorkbookRow) {
  const counts = new Map<string, number>();
  row.forEach((cell) => {
    const label = normalizeHeaderLabel(cleanCell(cell));
    if (!label) return;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([label]) => label),
  );
}

function rowHasValue(row: WorkbookRow) {
  return row.some((cell) => cleanCell(cell) !== "");
}

function cleanCell(value: WorkbookCell) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.0$/, "");
}

function normalizeHeaderLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPeriodLabel(value: string) {
  return /\bto\b/i.test(value) && /\d/.test(value);
}

function columnLabel(index: number) {
  let label = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return `Column ${label}`;
}
