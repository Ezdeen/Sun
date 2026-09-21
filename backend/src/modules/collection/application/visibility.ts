/**
 * Request visibility enforcement (IDOR protection) + schedule query.
 */
import { and, eq, inArray, isNull, or, sql, desc } from "drizzle-orm";
import type { Db } from "../../../shared/db/client.js";
import { DomainError } from "../../../shared/errors.js";
import { collectionRequests, users as usersTable, type CollectionRequestRow } from "../../../shared/db/schema.js";
import { visibilityFor, type ActorContext } from "../domain/lifecycle.js";

export function assertCanSeeRequest(actor: ActorContext, request: CollectionRequestRow): void {
  const filter = visibilityFor(actor);
  const ok = (() => {
    switch (filter.kind) {
      case "own":
        return request.citizenUserId === filter.citizenUserId;
      case "collector": {
        const mine = request.collectorUserId === filter.collectorUserId;
        const openQueue =
          (request.status === "sent_to_collector" || request.status === "on_the_way" || request.status === "arrived") &&
          (!request.collectorUserId || request.collectorUserId === filter.collectorUserId) &&
          (!filter.serviceAreaId || request.serviceAreaId === filter.serviceAreaId);
        return mine || openQueue;
      }
      case "area":
        return request.serviceAreaId === filter.serviceAreaId;
      case "all":
        return true;
    }
  })();
  if (!ok) {
    // 404 (not 403) — existence itself must not leak (IDOR).
    throw new DomainError("not_found", "request not found", 404);
  }
}

export async function collectorSchedule(db: Db, collectorUserId: string) {
  // Collector's area
  const areaRows = await db.execute(
    sql`SELECT service_area_id FROM app.collectors WHERE user_id = ${collectorUserId} LIMIT 1`
  );
  const area = (areaRows.rows as { service_area_id: string | null }[])[0];
  const serviceAreaId = area?.service_area_id ?? null;

  const rows = await db
    .select({
      request: collectionRequests,
      citizenName: usersTable.displayName,
      citizenPhone: usersTable.phone
    })
    .from(collectionRequests)
    .leftJoin(usersTable, eq(usersTable.id, collectionRequests.citizenUserId))
    .where(
      or(
        eq(collectionRequests.collectorUserId, collectorUserId),
        and(
          inArray(collectionRequests.status, ["sent_to_collector", "on_the_way", "arrived"]),
          isNull(collectionRequests.collectorUserId),
          serviceAreaId ? eq(collectionRequests.serviceAreaId, serviceAreaId) : sql`true`
        )
      )
    )
    .orderBy(desc(collectionRequests.createdAt))
    .limit(200);

  const today = new Date().toISOString().slice(0, 10);
  const active = rows.filter((r) =>
    ["sent_to_collector", "on_the_way", "arrived", "collected"].includes(r.request.status)
  );
  return {
    serviceAreaId,
    date: today,
    queue: rows.map((r) => ({
      id: r.request.id,
      requestNumber: r.request.requestNumber,
      status: r.request.status,
      version: r.request.version,
      scheduledDay: r.request.scheduledDay,
      scheduledHour: r.request.scheduledHour,
      citizenName: r.citizenName,
      citizenPhone: r.citizenPhone,
      combinedHash: r.request.combinedHash,
      qrPayload: r.request.qrPayload,
      createdAt: r.request.createdAt
    })),
    activeCount: active.length
  };
}
