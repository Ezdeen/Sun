/**
 * UUID v7 generator (time-ordered, index-friendly primary keys).
 * Pure Node crypto — no external dependency.
 */
import { randomBytes } from "node:crypto";

export function uuidv7(timestampMs: number = Date.now()): string {
  const buf = randomBytes(16);

  // 48-bit big-endian unix timestamp (milliseconds)
  const ts = BigInt(timestampMs);
  buf[0] = Number((ts >> 40n) & 0xffn);
  buf[1] = Number((ts >> 32n) & 0xffn);
  buf[2] = Number((ts >> 24n) & 0xffn);
  buf[3] = Number((ts >> 16n) & 0xffn);
  buf[4] = Number((ts >> 8n) & 0xffn);
  buf[5] = Number(ts & 0xffn);

  // version 7
  buf[6] = 0x70 | (buf[6]! & 0x0f);
  // variant 10xx
  buf[8] = 0x80 | (buf[8]! & 0x3f);

  const hex = buf.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}
