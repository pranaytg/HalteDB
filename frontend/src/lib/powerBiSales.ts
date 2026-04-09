export const POWER_BI_SALES_COLUMNS = [
  "Date",
  "Year",
  "Month_Num",
  "Month_Name",
  "Month_Year",
  "Quarter",
  "Quarter_Name",
  "Business",
  "Invoice Number",
  "Invoice Date",
  "Transaction Type",
  "Order Id",
  "Quantity",
  "BRAND",
  "Item Description",
  "Asin",
  "Sku",
  "Category",
  "Segment",
  "Ship To City",
  "Ship To State",
  "Ship To Country",
  "Ship To Postal Code",
  "Invoice Amount",
  "Principal Amount",
  "Warehouse Id",
  "Customer Bill To Gstid",
  "Buyer Name",
  "Source",
  "Channel",
] as const;

export type PowerBiSalesColumn = (typeof POWER_BI_SALES_COLUMNS)[number];
export type PowerBiSalesRow = Record<PowerBiSalesColumn, string | number | null>;

const INTEGER_COLUMNS = new Set<PowerBiSalesColumn>(["Year", "Month_Num", "Quarter"]);
const NUMERIC_COLUMNS = new Set<PowerBiSalesColumn>([
  "Quantity",
  "Invoice Amount",
  "Principal Amount",
]);
const DATE_COLUMNS = new Set<PowerBiSalesColumn>(["Date"]);
const TIMESTAMP_COLUMNS = new Set<PowerBiSalesColumn>(["Invoice Date"]);
const TEXT_COLUMNS = new Set<PowerBiSalesColumn>(
  POWER_BI_SALES_COLUMNS.filter(
    (column) =>
      !INTEGER_COLUMNS.has(column) &&
      !NUMERIC_COLUMNS.has(column) &&
      !DATE_COLUMNS.has(column) &&
      !TIMESTAMP_COLUMNS.has(column),
  ),
);

function asNullableText(value: unknown) {
  if (value == null) return null;
  const text = String(value);
  return text.trim() === "" ? null : text;
}

function asNullableInteger(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function asNullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateValue(value: unknown) {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

function formatTimestampValue(value: unknown) {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`,
      `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`,
    ].join(" ");
  }

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) {
    return text.replace("T", " ").replace(/Z$/, "").slice(0, 19);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;

  return [
    `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`,
    `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}:${pad2(parsed.getSeconds())}`,
  ].join(" ");
}

function normalizeValue(column: PowerBiSalesColumn, value: unknown) {
  if (INTEGER_COLUMNS.has(column)) return asNullableInteger(value);
  if (NUMERIC_COLUMNS.has(column)) return asNullableNumber(value);
  if (DATE_COLUMNS.has(column)) return formatDateValue(value);
  if (TIMESTAMP_COLUMNS.has(column)) return formatTimestampValue(value);
  if (TEXT_COLUMNS.has(column)) return asNullableText(value);
  return value == null ? null : String(value);
}

export function formatPowerBiSalesRowForExport(row: Partial<Record<PowerBiSalesColumn, unknown>>) {
  const formatted = {} as PowerBiSalesRow;
  for (const column of POWER_BI_SALES_COLUMNS) {
    formatted[column] = normalizeValue(column, row[column]);
  }
  return formatted;
}
