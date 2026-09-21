/**
 * Formatting helpers — money stays STRING end-to-end (never Number).
 */
const dateFmt = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  timeStyle: "short",
  calendar: "gregory",
  numberingSystem: "latn"
});

const dateOnlyFmt = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  calendar: "gregory",
  numberingSystem: "latn"
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return dateOnlyFmt.format(d);
}

/** Money strings from the API ("12.50") + currency label. */
export function formatMoney(value: string | null | undefined, currency = "₪"): string {
  if (value === null || value === undefined) return "—";
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return `${value} ${currency}`;
  return `${num.toFixed(2)} ${currency}`;
}

export function formatWeight(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return value;
  return `${num.toFixed(3)} كجم`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ar", { numberingSystem: "latn" }).format(value);
}

/** Short hash display: CMP-abcdef… */
export function shortHash(value: string | null | undefined, keep = 12): string {
  if (!value) return "—";
  if (value.length <= keep + 5) return value;
  return `${value.slice(0, keep)}…`;
}
