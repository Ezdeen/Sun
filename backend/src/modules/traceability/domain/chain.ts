/**
 * TRACEABILITY ENGINE (§6.3) — per-aggregate hash chain.
 *
 * event_hash = SHA-256( canonical JSON of:
 *   { aggregate_type, aggregate_id, seq, status_code, actor_role, actor_ref,
 *     payload, occurred_at (ISO UTC), prev_hash, schema_version } )
 *
 * First event: prev_hash = "GENESIS:<aggregate_id>".
 * Canonical JSON sorts keys recursively → order-independent, so PostgreSQL
 * jsonb round-trips do not break verification (proven by integration tests).
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../shared/canonical-json.js";

export type AggregateType = "request" | "shipment" | "bag";

export type ChainRole =
  | "citizen"
  | "collector"
  | "authority"
  | "sorter"
  | "finance"
  | "manager"
  | "system";

export interface ChainEvent {
  aggregateType: AggregateType;
  aggregateId: string;
  seq: number; // 1-based, per aggregate, gap-free
  statusCode: string;
  actorRole: ChainRole | null;
  actorRef: string | null; // hashed actor reference, never PII
  payload: Record<string, unknown>;
  occurredAt: Date;
  prevHash: string;
  schemaVersion: number;
}

export interface StoredChainEvent extends ChainEvent {
  eventHash: string;
}

export function genesisHash(aggregateId: string): string {
  return `GENESIS:${aggregateId}`;
}

/** ISO-8601 UTC with millisecond precision — stable across engines. */
export function isoUtc(date: Date): string {
  return date.toISOString();
}

export function computeEventHash(event: ChainEvent): string {
  const material = {
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    seq: event.seq,
    status_code: event.statusCode,
    actor_role: event.actorRole,
    actor_ref: event.actorRef,
    payload: event.payload,
    occurred_at: isoUtc(event.occurredAt),
    prev_hash: event.prevHash,
    schema_version: event.schemaVersion
  };
  return createHash("sha256").update(canonicalJson(material), "utf8").digest("hex");
}

export function buildEvent(input: {
  aggregateType: AggregateType;
  aggregateId: string;
  seq: number;
  statusCode: string;
  actorRole: ChainRole | null;
  actorRef: string | null;
  payload?: Record<string, unknown>;
  occurredAt: Date;
  prevHash: string;
  schemaVersion?: number;
}): StoredChainEvent {
  const event: ChainEvent = {
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    seq: input.seq,
    statusCode: input.statusCode,
    actorRole: input.actorRole,
    actorRef: input.actorRef,
    payload: input.payload ?? {},
    occurredAt: input.occurredAt,
    prevHash: input.prevHash,
    schemaVersion: input.schemaVersion ?? 1
  };
  return { ...event, eventHash: computeEventHash(event) };
}

export interface BrokenEvent {
  seq: number;
  expectedHash?: string;
  actualHash?: string;
  reason: "hash_mismatch" | "prev_hash_mismatch" | "seq_gap";
}

export interface VerifyResult {
  valid: boolean;
  eventsChecked: number;
  firstBroken: BrokenEvent | null;
}

/**
 * Verify a full chain (events ordered by seq ascending).
 * Recomputes every hash and checks linkage.
 */
export function verifyChain(events: readonly StoredChainEvent[]): VerifyResult {
  let prevHash: string | null = null;
  let expectedSeq = 1;

  for (const ev of events) {
    if (ev.seq !== expectedSeq) {
      return {
        valid: false,
        eventsChecked: expectedSeq - 1,
        firstBroken: { seq: ev.seq, reason: "seq_gap" }
      };
    }
    const expectedPrev = prevHash ?? genesisHash(ev.aggregateId);
    if (ev.prevHash !== expectedPrev) {
      return {
        valid: false,
        eventsChecked: expectedSeq - 1,
        firstBroken: {
          seq: ev.seq,
          reason: "prev_hash_mismatch",
          expectedHash: expectedPrev,
          actualHash: ev.prevHash
        }
      };
    }
    const recomputed = computeEventHash(ev);
    if (recomputed !== ev.eventHash) {
      return {
        valid: false,
        eventsChecked: expectedSeq - 1,
        firstBroken: {
          seq: ev.seq,
          reason: "hash_mismatch",
          expectedHash: recomputed,
          actualHash: ev.eventHash
        }
      };
    }
    prevHash = ev.eventHash;
    expectedSeq += 1;
  }

  return { valid: true, eventsChecked: events.length, firstBroken: null };
}

// ── Hash reference formats (barcode compatibility with the old system) ──
export function shortHash(hex: string, len: number): string {
  return hex.slice(0, len);
}

export function citizenHashRef(hmacHex: string): string {
  return `CIT-${hmacHex.slice(0, 48)}`;
}

export function collectorHashRef(hmacHex: string): string {
  return `COL-${hmacHex.slice(0, 48)}`;
}

export function authorityHashRef(hmacHex: string): string {
  return `AUT-${hmacHex.slice(0, 48)}`;
}

export function managerHashRef(hmacHex: string): string {
  return `MGR-${hmacHex.slice(0, 48)}`;
}

export function requestHashRef(shaHex: string): string {
  return `REQ-${shaHex.slice(0, 48)}`;
}

export function combinedHashRef(citizenHash: string, requestId: string): string {
  const sha = createHash("sha256")
    .update(`${citizenHash}:${requestId}`, "utf8")
    .digest("hex");
  return `CMP-${sha.slice(0, 48)}`;
}

export function bagHashRef(bagId: string): string {
  const sha = createHash("sha256").update(`bag:${bagId}`, "utf8").digest("hex");
  return `BAG-${sha.slice(0, 24)}`;
}

export function qrPayloadFor(combinedHash: string): string {
  return `WASTE-QR:v1:${combinedHash}`;
}
