/**
 * Identity hashing — HMAC-SHA256 with server-side pepper (§6.5).
 * The 9-digit ID number is NEVER stored; only its keyed hash + last 4 digits.
 * Pepper rotation supported via kid (settings).
 */
import { createHmac, createHash } from "node:crypto";

export function hmacIdentity(pepper: string, idNumber: string): string {
  return createHmac("sha256", pepper).update(idNumber, "utf8").digest("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** CIT-… reference (48 hex chars) — barcode-compatible with the old system. */
export function citizenHash(pepper: string, idNumber: string): string {
  return `CIT-${hmacIdentity(pepper, idNumber).slice(0, 48)}`;
}

export function last4Of(idNumber: string): string {
  return idNumber.slice(-4);
}

/** Validate a 9-digit identity number (Palestinian ID format). */
export function isValidIdNumber(idNumber: string): boolean {
  return /^[0-9]{9}$/.test(idNumber);
}
