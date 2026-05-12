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

type CountDateOptions = {
  inventoryMonth?: string | null;
  referenceDate?: string | Date | null;
};

type DateCandidate = {
  day: number;
  month: number;
  year: number;
  priority: number;
};

type RowDataCarrier<T> = {
  getSheetName: (row: T) => string;
  getRowData: (row: T) => Record<string, string>;
  withRowData: (row: T, rowData: Record<string, string>) => T;
};

const DERIVED_COUNT_DATE_KEY = "__logic_inventory_count_date";
const DERIVED_COUNT_DATE_LABEL = "Date";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

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

export function withDerivedConsolidatedCountDate(
  workbook: ParsedLogicInventoryWorkbook,
  options: CountDateOptions = {},
): ParsedLogicInventoryWorkbook {
  return withDerivedCountDateForRows(workbook.sheets, workbook.rows, options, {
    getSheetName: (row) => row.sheetName,
    getRowData: (row) => row.rowData,
    withRowData: (row, rowData) => ({ ...row, rowData }),
  });
}

export function withDerivedConsolidatedCountDateForStoredRows<T extends { sheet_name: string; row_data: Record<string, string> }>(
  sheets: LogicInventorySheetMeta[],
  rows: T[],
  options: CountDateOptions = {},
) {
  return withDerivedCountDateForRows(sheets, rows, options, {
    getSheetName: (row) => row.sheet_name,
    getRowData: (row) => row.row_data,
    withRowData: (row, rowData) => ({ ...row, row_data: rowData }),
  });
}

function withDerivedCountDateForRows<T>(
  sheets: LogicInventorySheetMeta[],
  rows: T[],
  options: CountDateOptions,
  carrier: RowDataCarrier<T>,
) {
  const consolidatedSheet = sheets.find((sheet) => isConsolidatedSheet(sheet.name));
  if (!consolidatedSheet) return { sheets, rows };

  const countDate = findLatestCountDate(sheets, rows, options, carrier);
  if (!countDate) return { sheets, rows };

  const existingDateColumn = consolidatedSheet.columns.find(isDateColumn);
  const dateColumn = existingDateColumn ?? {
    key: DERIVED_COUNT_DATE_KEY,
    label: DERIVED_COUNT_DATE_LABEL,
    index: Math.max(-1, ...consolidatedSheet.columns.map((column) => column.index)) + 1,
  };

  const nextSheets = sheets.map((sheet) => {
    if (sheet.name !== consolidatedSheet.name || existingDateColumn) return sheet;
    return {
      ...sheet,
      columns: [...sheet.columns, dateColumn],
    };
  });

  const nextRows = rows.map((row) => {
    if (carrier.getSheetName(row) !== consolidatedSheet.name) return row;
    const rowData = carrier.getRowData(row);
    const currentValue = cleanCell(rowData[dateColumn.key]);

    return carrier.withRowData(row, {
      ...rowData,
      [dateColumn.key]: currentValue || countDate,
    });
  });

  return { sheets: nextSheets, rows: nextRows };
}

function findLatestCountDate<T>(
  sheets: LogicInventorySheetMeta[],
  rows: T[],
  options: CountDateOptions,
  carrier: RowDataCarrier<T>,
) {
  const candidates: DateCandidate[] = [];

  for (const sheet of sheets) {
    for (const column of sheet.columns) {
      const label = column.label;
      const priority = isCountDateHeader(label) ? 3 : 0;
      if (priority > 0) {
        const candidate = extractDateCandidate(label, priority, options);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) {
    for (const sheet of sheets) {
      for (const column of sheet.columns) {
        if (isPeriodLabel(column.label)) continue;
        const candidate = extractDateCandidate(column.label, 2, options);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) {
    const dateColumnsBySheet = new Map<string, Set<string>>();
    for (const sheet of sheets) {
      const dateColumns = sheet.columns.filter(isDateColumn).map((column) => column.key);
      if (dateColumns.length > 0) dateColumnsBySheet.set(sheet.name, new Set(dateColumns));
    }

    for (const row of rows) {
      const keys = dateColumnsBySheet.get(carrier.getSheetName(row));
      if (!keys) continue;

      const rowData = carrier.getRowData(row);
      for (const key of keys) {
        const candidate = extractDateCandidate(rowData[key] ?? "", 1, options);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) return null;

  const selected = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return dateValue(b) - dateValue(a);
  })[0];

  return formatCountDate(selected);
}

function isConsolidatedSheet(name: string) {
  return normalizeHeaderLabel(name).includes("consolidated");
}

function isCountDateHeader(value: string) {
  return /(final\s*stock|latest\s*count|count\s*by|stock\s*by|as\s*(?:of|on))/i.test(value);
}

function isDateColumn(column: LogicInventoryColumn) {
  const label = normalizeHeaderLabel(column.label);
  return label === "date" || label === "countdate" || label === "latestcountdate" || label === "stockdate";
}

function extractDateCandidate(value: string, priority: number, options: CountDateOptions): DateCandidate | null {
  const text = cleanCell(value);
  if (!text) return null;

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const year = normalizeYear(Number(isoMatch[1]));
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return validDateCandidate(day, month, year, priority);
  }

  const numericMatch = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const year = normalizeYear(Number(numericMatch[3]));
    return validDateCandidate(day, month, year, priority);
  }

  const monthMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:[\s,]+(\d{2,4}))?\b/i);
  if (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = MONTHS[monthMatch[2].toLowerCase()];
    const year = monthMatch[3] ? normalizeYear(Number(monthMatch[3])) : inferYear(options);
    return validDateCandidate(day, month, year, priority);
  }

  return null;
}

function inferYear(options: CountDateOptions) {
  const inventoryYear = extractYear(options.inventoryMonth ?? "");
  if (inventoryYear) return inventoryYear;

  if (options.referenceDate) {
    const date = new Date(options.referenceDate);
    if (!Number.isNaN(date.getTime())) return date.getFullYear();
  }

  return new Date().getFullYear();
}

function extractYear(value: string) {
  const match = value.match(/\b(20\d{2}|19\d{2}|\d{2})\b/);
  if (!match) return null;
  return normalizeYear(Number(match[1]));
}

function normalizeYear(value: number) {
  return value < 100 ? 2000 + value : value;
}

function validDateCandidate(day: number, month: number, year: number, priority: number): DateCandidate | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return { day, month, year, priority };
}

function dateValue(candidate: DateCandidate) {
  return Date.UTC(candidate.year, candidate.month - 1, candidate.day);
}

function formatCountDate(candidate: DateCandidate) {
  const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day)));
  return `${candidate.day}${ordinalSuffix(candidate.day)} ${monthName} ${candidate.year}`;
}

function ordinalSuffix(day: number) {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
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
