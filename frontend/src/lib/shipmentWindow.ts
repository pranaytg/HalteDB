export const SHIPMENT_MONTH_OPTIONS = [1, 3, 6] as const;

export type ShipmentMonthWindow = (typeof SHIPMENT_MONTH_OPTIONS)[number];

export function parseShipmentMonthWindow(value: string | null | undefined): ShipmentMonthWindow {
  const parsed = Number(value);
  if (SHIPMENT_MONTH_OPTIONS.includes(parsed as ShipmentMonthWindow)) {
    return parsed as ShipmentMonthWindow;
  }
  return 1;
}

export function getShipmentWindowStart(months: ShipmentMonthWindow) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

export function getShipmentWindowLabel(months: ShipmentMonthWindow) {
  return `Last ${months} month${months === 1 ? "" : "s"}`;
}

export function sanitizeShipmentFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function formatShipmentTimestamp(value: string | Date | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toISOString().replace("T", " ").slice(0, 19);
}
