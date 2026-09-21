/**
 * Canonical JSON: sorted keys (recursive), no insignificant whitespace, UTF-8.
 * Used for hash-chain inputs so that hashing is deterministic across
 * processes, restarts and PostgreSQL jsonb round-trips (jsonb re-orders keys,
 * canonicalization is order-independent by construction).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null"; // defensive: treat as null
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => serialize(v)).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue; // match JSON.stringify semantics: drop undefined
    parts.push(JSON.stringify(key) + ":" + serialize(v));
  }
  return "{" + parts.join(",") + "}";
}
