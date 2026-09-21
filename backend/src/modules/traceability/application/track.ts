/**
 * Public tracking (no auth) — sanitized timeline by combined hash (CMP-…).
 * Reveals ONLY: status label (Arabic), timestamp, actor role label.
 * No names, no identities, no weights (§6.3).
 */
import { eq, asc, and } from "drizzle-orm";
import { DomainError } from "../../../shared/errors.js";
import type { Db } from "../../../shared/db/client.js";
import { collectionRequests, trackingEvents } from "../../../shared/db/schema.js";
import { STATUS_LABELS_AR } from "../../collection/domain/lifecycle.js";

const ROLE_LABELS_AR: Record<string, string> = {
  citizen: "مواطن",
  collector: "جامع",
  authority: "هيئة محلية",
  sorter: "منطقة فرز",
  finance: "الطبقة المالية",
  manager: "إدارة المنصة",
  system: "النظام"
};

export async function publicTrack(db: Db, combinedHash: string) {
  const rows = await db
    .select()
    .from(collectionRequests)
    .where(eq(collectionRequests.combinedHash, combinedHash))
    .limit(1);
  const request = rows[0];
  if (!request) {
    throw new DomainError("not_found", "tracking code not found", 404);
  }

  const events = await db
    .select()
    .from(trackingEvents)
    .where(and(eq(trackingEvents.aggregateType, "request"), eq(trackingEvents.aggregateId, request.id)))
    .orderBy(asc(trackingEvents.seq));

  const timeline = events.map((e) => ({
    statusCode: e.statusCode,
    statusLabel: STATUS_LABELS_AR[e.statusCode as keyof typeof STATUS_LABELS_AR] ?? e.statusCode,
    occurredAt: e.occurredAt,
    actorRoleLabel: e.actorRole ? ROLE_LABELS_AR[e.actorRole] ?? e.actorRole : null
  }));

  return {
    combinedHash: request.combinedHash,
    currentStatus: request.status,
    currentStatusLabel: STATUS_LABELS_AR[request.status],
    createdAt: request.createdAt,
    timeline
  };
}
