/**
 * REQUEST REFERENCE PARSER — pure (no framework, no DB).
 * Classifies what a manager pasted into "verify chain" so the use case can
 * resolve it to a request: UUID, CMP-… (combined hash), REQ-… (request hash),
 * the QR payload (WASTE-QR:v1:CMP-…[:itemId]) or the human request number.
 */
export type RequestRef =
  | { kind: "id"; value: string }
  | { kind: "combined_hash"; value: string }
  | { kind: "request_hash"; value: string }
  | { kind: "request_number"; value: number }
  | { kind: "invalid" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CMP_RE = /^CMP-[0-9a-f]{48}$/i;
const REQ_RE = /^REQ-[0-9a-f]{48}$/i;
const NUMBER_RE = /^#?\d{1,15}$/;
const QR_PREFIX = "WASTE-QR:v1:";
const MAX_LENGTH = 200;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Arabic-Indic / Persian digits → ASCII digits. */
function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - "٠".charCodeAt(0)))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - "۰".charCodeAt(0)));
}

/** Stored hashes are `PREFIX-` (upper) + lowercase hex. */
function canonicalHash(value: string): string {
  return `${value.slice(0, 4).toUpperCase()}${value.slice(4).toLowerCase()}`;
}

export function classifyRequestRef(raw: string): RequestRef {
  let v = normalizeDigits(raw.trim());
  if (v === "" || v.length > MAX_LENGTH) return { kind: "invalid" };

  if (v.toUpperCase().startsWith(QR_PREFIX.toUpperCase())) v = v.slice(QR_PREFIX.length);
  // Bag QR payload = CMP-…:<itemId> → keep the combined-hash part only.
  const colon = v.indexOf(":");
  if (colon > 0) v = v.slice(0, colon);

  if (UUID_RE.test(v)) return { kind: "id", value: v.toLowerCase() };
  if (CMP_RE.test(v)) return { kind: "combined_hash", value: canonicalHash(v) };
  if (REQ_RE.test(v)) return { kind: "request_hash", value: canonicalHash(v) };
  if (NUMBER_RE.test(v)) {
    return { kind: "request_number", value: Number.parseInt(v.replace("#", ""), 10) };
  }
  return { kind: "invalid" };
}
