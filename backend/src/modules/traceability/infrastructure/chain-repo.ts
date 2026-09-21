/**
 * Chain repository — append-only tracking events with per-aggregate
 * sequences. Callers MUST hold the aggregate row lock (SELECT … FOR UPDATE)
 * before appending (see use cases) — the UNIQUE(aggregate, seq) constraint
 * is the final guard against branching.
 */
import { asc, eq, and, desc } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import { trackingEvents, type TrackingEventRow } from "../../../shared/db/schema.js";
import {
  buildEvent,
  genesisHash,
  type AggregateType,
  type StoredChainEvent
} from "../domain/chain.js";

function toDomain(row: TrackingEventRow): StoredChainEvent {
  return {
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    seq: row.seq,
    statusCode: row.statusCode,
    actorRole: row.actorRole,
    actorRef: row.actorRef,
    payload: row.payload,
    occurredAt: row.occurredAt,
    prevHash: row.prevHash,
    schemaVersion: row.schemaVersion,
    eventHash: row.eventHash
  };
}

export async function loadChain(
  db: DbOrTx,
  aggregateType: AggregateType,
  aggregateId: string
): Promise<StoredChainEvent[]> {
  const rows = await db
    .select()
    .from(trackingEvents)
    .where(and(eq(trackingEvents.aggregateType, aggregateType), eq(trackingEvents.aggregateId, aggregateId)))
    .orderBy(asc(trackingEvents.seq));
  return rows.map(toDomain);
}

export async function lastEvent(
  db: DbOrTx,
  aggregateType: AggregateType,
  aggregateId: string
): Promise<StoredChainEvent | null> {
  const rows = await db
    .select()
    .from(trackingEvents)
    .where(and(eq(trackingEvents.aggregateType, aggregateType), eq(trackingEvents.aggregateId, aggregateId)))
    .orderBy(desc(trackingEvents.seq))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/**
 * Append the next event for an aggregate. Requires the caller to hold the
 * aggregate row lock (unit-of-work). Computes seq/prevHash/hash inside.
 */
export type ChainActorRole =
  | "citizen"
  | "collector"
  | "authority"
  | "sorter"
  | "finance"
  | "manager"
  | "system";

export async function appendEvent(
  db: DbOrTx,
  input: {
    aggregateType: AggregateType;
    aggregateId: string;
    statusCode: string;
    actorRole: ChainActorRole | null;
    actorRef: string | null;
    payload?: Record<string, unknown>;
    occurredAt: Date;
  }
): Promise<StoredChainEvent> {
  const last = await lastEvent(db, input.aggregateType, input.aggregateId);
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.eventHash ?? genesisHash(input.aggregateId);

  const stored = buildEvent({
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    seq,
    statusCode: input.statusCode,
    actorRole: input.actorRole,
    actorRef: input.actorRef,
    payload: input.payload,
    occurredAt: input.occurredAt,
    prevHash
  });

  await db.insert(trackingEvents).values({
    id: crypto.randomUUID(),
    aggregateType: stored.aggregateType,
    aggregateId: stored.aggregateId,
    seq: stored.seq,
    statusCode: stored.statusCode,
    actorRole: stored.actorRole,
    actorRef: stored.actorRef,
    payload: stored.payload,
    occurredAt: stored.occurredAt,
    prevHash: stored.prevHash,
    eventHash: stored.eventHash,
    schemaVersion: stored.schemaVersion
  });

  return stored;
}
