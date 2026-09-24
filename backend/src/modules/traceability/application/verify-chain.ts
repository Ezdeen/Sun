/**
 * Chain verification (manager + CLI) and public sanitized tracking.
 * For requests the reference may be a UUID, CMP-… (combined hash), REQ-…,
 * the QR payload or the human request number — resolved here, never in api/.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client.js";
import { DomainError } from "../../../shared/errors.js";
import { collectionRequests } from "../../../shared/db/schema.js";
import { loadChain } from "../infrastructure/chain-repo.js";
import { verifyChain, type AggregateType } from "../domain/chain.js";
import { classifyRequestRef, isUuid, type RequestRef } from "../domain/reference.js";

interface RequestSummary {
  id: string;
  requestNumber: number;
  combinedHash: string;
  status: string;
}

function conditionFor(ref: Exclude<RequestRef, { kind: "invalid" }>) {
  switch (ref.kind) {
    case "id":
      return eq(collectionRequests.id, ref.value);
    case "combined_hash":
      return eq(collectionRequests.combinedHash, ref.value);
    case "request_hash":
      return eq(collectionRequests.requestHash, ref.value);
    case "request_number":
      return eq(collectionRequests.requestNumber, ref.value);
  }
}

async function resolveRequest(db: Db, reference: string): Promise<RequestSummary> {
  const ref = classifyRequestRef(reference);
  if (ref.kind === "invalid") {
    throw new DomainError(
      "validation_error",
      "reference must be a UUID, CMP-…, REQ-…, QR payload or request number",
      400
    );
  }
  const rows = await db
    .select({
      id: collectionRequests.id,
      requestNumber: collectionRequests.requestNumber,
      combinedHash: collectionRequests.combinedHash,
      status: collectionRequests.status
    })
    .from(collectionRequests)
    .where(conditionFor(ref))
    .limit(1);
  const row = rows[0];
  if (!row) throw new DomainError("not_found", "request not found", 404);
  return row;
}

async function resolveTarget(
  db: Db,
  aggregateType: AggregateType,
  reference: string
): Promise<{ id: string; request: RequestSummary | null }> {
  if (aggregateType === "request") {
    const request = await resolveRequest(db, reference);
    return { id: request.id, request };
  }
  const id = reference.trim().toLowerCase();
  if (!isUuid(id)) {
    throw new DomainError("validation_error", "aggregate id must be a UUID", 400);
  }
  return { id, request: null };
}

export async function verifyAggregateChain(
  db: Db,
  aggregateType: AggregateType,
  aggregateRef: string
) {
  const target = await resolveTarget(db, aggregateType, aggregateRef);
  const events = await loadChain(db, aggregateType, target.id);
  const result = verifyChain(events);
  return {
    aggregateType,
    aggregateId: target.id,
    request: target.request,
    valid: result.valid,
    eventsChecked: result.eventsChecked,
    firstBroken: result.firstBroken,
    events: events.map((e) => ({
      seq: e.seq,
      statusCode: e.statusCode,
      actorRole: e.actorRole,
      occurredAt: e.occurredAt,
      eventHash: e.eventHash
    }))
  };
}
