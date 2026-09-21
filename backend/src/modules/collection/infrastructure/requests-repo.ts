/**
 * Collection requests repository. Row locking helpers live here because
 * request transitions are concurrency-critical.
 */
import { and, eq, isNull, or, sql, inArray, desc } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import {
  collectionRequests,
  requestItems,
  shipmentBags,
  users,
  type CollectionRequestRow
} from "../../../shared/db/schema.js";
import type { VisibilityFilter } from "../domain/lifecycle.js";

/** Lock a request row FOR UPDATE — call inside a transaction only. */
export async function lockRequest(tx: DbOrTx, id: string): Promise<CollectionRequestRow | undefined> {
  const rows = await tx
    .select()
    .from(collectionRequests)
    .where(eq(collectionRequests.id, id))
    .for("update")
    .limit(1);
  return rows[0];
}

export async function getRequest(db: DbOrTx, id: string): Promise<CollectionRequestRow | undefined> {
  const rows = await db.select().from(collectionRequests).where(eq(collectionRequests.id, id)).limit(1);
  return rows[0];
}

export async function nextRequestNumber(tx: DbOrTx): Promise<number> {
  const res = await tx.execute(sql`SELECT nextval('app.request_number_seq') AS n`);
  return Number((res.rows[0] as { n: string }).n);
}

export async function insertRequest(
  tx: DbOrTx,
  input: typeof collectionRequests.$inferInsert
): Promise<CollectionRequestRow> {
  const [row] = await tx.insert(collectionRequests).values(input).returning();
  return row!;
}

export async function insertRequestItems(
  tx: DbOrTx,
  items: (typeof requestItems.$inferInsert)[]
): Promise<void> {
  await tx.insert(requestItems).values(items);
}

export async function insertBags(
  tx: DbOrTx,
  bags: (typeof shipmentBags.$inferInsert)[]
): Promise<void> {
  if (bags.length > 0) await tx.insert(shipmentBags).values(bags);
}

export async function getRequestItems(db: DbOrTx, requestId: string) {
  return db
    .select()
    .from(requestItems)
    .where(eq(requestItems.requestId, requestId))
    .orderBy(requestItems.displayOrder);
}

export async function getRequestBags(db: DbOrTx, requestId: string) {
  return db
    .select()
    .from(shipmentBags)
    .where(eq(shipmentBags.requestId, requestId))
    .orderBy(shipmentBags.createdAt);
}

export async function advanceRequestStatus(
  tx: DbOrTx,
  input: {
    id: string;
    status: CollectionRequestRow["status"];
    expectedVersion: number;
    collectorUserId?: string | null;
    scheduledDay?: string | null;
    scheduledHour?: string | null;
    timestampField?: "dispatchedAt" | "startedAt" | "arrivedAt" | "collectedAt" | "sortedAt" | "soldAt";
  }
): Promise<CollectionRequestRow> {
  const patch: Record<string, unknown> = {
    status: input.status,
    version: input.expectedVersion + 1,
    updatedAt: new Date()
  };
  if (input.timestampField) patch[input.timestampField] = new Date();
  if (input.collectorUserId !== undefined) patch["collectorUserId"] = input.collectorUserId;
  if (input.scheduledDay !== undefined) patch["scheduledDay"] = input.scheduledDay;
  if (input.scheduledHour !== undefined) patch["scheduledHour"] = input.scheduledHour;

  const [row] = await tx
    .update(collectionRequests)
    .set(patch as never)
    .where(and(eq(collectionRequests.id, input.id), eq(collectionRequests.version, input.expectedVersion)))
    .returning();
  if (!row) {
    // Either concurrent update or not found — distinguish by existence.
    const existing = await getRequest(tx, input.id);
    if (!existing) throw new (await import("../../../shared/errors.js")).DomainError("not_found", "request not found", 404);
    throw new (await import("../../../shared/errors.js")).DomainError(
      "concurrent_update",
      `version mismatch: expected ${input.expectedVersion}`,
      409
    );
  }
  return row;
}

export async function markBagsCollected(tx: DbOrTx, requestId: string): Promise<void> {
  await tx
    .update(shipmentBags)
    .set({ status: "collected", updatedAt: new Date() })
    .where(and(eq(shipmentBags.requestId, requestId), eq(shipmentBags.status, "pending_collection")));
}

export async function markRequestsSold(
  tx: DbOrTx,
  requestIds: string[]
): Promise<void> {
  if (requestIds.length === 0) return;
  await tx
    .update(collectionRequests)
    .set({ status: "sold", soldAt: new Date(), updatedAt: new Date(), version: sql`${collectionRequests.version} + 1` })
    .where(and(inArray(collectionRequests.id, requestIds), eq(collectionRequests.status, "sorted")));
}

/** Visibility-filtered list (VisibilityPolicy as data, not inline conditions). */
export async function listVisibleRequests(
  db: DbOrTx,
  filter: VisibilityFilter,
  page: { limit: number; offset: number },
  extra?: { status?: CollectionRequestRow["status"] }
) {
  const conditions = [];
  if (extra?.status) conditions.push(eq(collectionRequests.status, extra.status));
  switch (filter.kind) {
    case "own":
      conditions.push(eq(collectionRequests.citizenUserId, filter.citizenUserId));
      break;
    case "collector":
      conditions.push(
        or(
          and(
            inArray(collectionRequests.status, ["sent_to_collector", "on_the_way", "arrived"]),
            filter.serviceAreaId
              ? eq(collectionRequests.serviceAreaId, filter.serviceAreaId)
              : sql`true`,
            or(isNull(collectionRequests.collectorUserId), eq(collectionRequests.collectorUserId, filter.collectorUserId))
          ),
          eq(collectionRequests.collectorUserId, filter.collectorUserId)
        )
      );
      break;
    case "area":
      conditions.push(eq(collectionRequests.serviceAreaId, filter.serviceAreaId));
      break;
    case "all":
      break;
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const items = await db
    .select({
      request: collectionRequests,
      citizenName: users.displayName
    })
    .from(collectionRequests)
    .leftJoin(users, eq(users.id, collectionRequests.citizenUserId))
    .where(where)
    .orderBy(desc(collectionRequests.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(collectionRequests)
    .where(where);
  return { items, total: countRow?.count ?? 0 };
}
