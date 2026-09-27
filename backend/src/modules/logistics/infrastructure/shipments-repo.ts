/**
 * Shipments & bags repository.
 */
import { eq, sql, desc, asc, inArray } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import {
  shipments,
  shipmentBags,
  collectionRequests,
  type ShipmentRow,
  type ShipmentBagRow
} from "../../../shared/db/schema.js";

export async function lockShipment(tx: DbOrTx, id: string): Promise<ShipmentRow | undefined> {
  const rows = await tx.select().from(shipments).where(eq(shipments.id, id)).for("update").limit(1);
  return rows[0];
}

export async function lockBagByCode(tx: DbOrTx, code: string): Promise<ShipmentBagRow | undefined> {
  const rows = await tx
    .select()
    .from(shipmentBags)
    .where(sql`${shipmentBags.bagCode} = ${code} OR ${shipmentBags.qrPayload} = ${code}`)
    .for("update")
    .limit(1);
  return rows[0];
}

export async function getBagByCode(db: DbOrTx, code: string): Promise<ShipmentBagRow | undefined> {
  const rows = await db
    .select()
    .from(shipmentBags)
    .where(sql`${shipmentBags.bagCode} = ${code} OR ${shipmentBags.qrPayload} = ${code}`)
    .limit(1);
  return rows[0];
}

export async function nextShipmentNumber(tx: DbOrTx): Promise<number> {
  const res = await tx.execute(sql`SELECT nextval('app.shipment_number_seq') AS n`);
  return Number((res.rows[0] as { n: string }).n);
}

export async function insertShipment(
  tx: DbOrTx,
  input: typeof shipments.$inferInsert
): Promise<ShipmentRow> {
  const [row] = await tx.insert(shipments).values(input).returning();
  return row!;
}

export async function attachBagToShipment(
  tx: DbOrTx,
  input: { bagId: string; shipmentId: string }
): Promise<void> {
  await tx
    .update(shipmentBags)
    .set({ shipmentId: input.shipmentId, status: "attached", updatedAt: new Date() })
    .where(eq(shipmentBags.id, input.bagId));
}

/** Sorting-facility arrival check-in — §5.11 sorter recipe, step 1. */
export async function recordBagArrival(
  tx: DbOrTx,
  input: { bagId: string; arrivedBy: string }
): Promise<void> {
  await tx
    .update(shipmentBags)
    .set({
      status: "arrived",
      arrivedAt: new Date(),
      arrivedBy: input.arrivedBy,
      updatedAt: new Date()
    })
    .where(eq(shipmentBags.id, input.bagId));
}

export async function recordBagWeight(
  tx: DbOrTx,
  input: {
    bagId: string;
    finalWeightKg: string;
    weighedBy: string;
    observedWasteTypeCode: string | null;
    wasteTypeMismatch: boolean;
    mismatchNote: string | null;
  }
): Promise<void> {
  await tx
    .update(shipmentBags)
    .set({
      finalWeightKg: input.finalWeightKg,
      weighedAt: new Date(),
      weighedBy: input.weighedBy,
      observedWasteTypeCode: input.observedWasteTypeCode,
      wasteTypeMismatch: input.wasteTypeMismatch,
      mismatchNote: input.mismatchNote,
      status: "weighed",
      updatedAt: new Date()
    })
    .where(eq(shipmentBags.id, input.bagId));
}

export async function markShipmentSold(tx: DbOrTx, shipmentId: string): Promise<void> {
  await tx
    .update(shipments)
    .set({ status: "sold", soldAt: new Date(), version: sql`${shipments.version} + 1` })
    .where(eq(shipments.id, shipmentId));
}

export async function getShipment(db: DbOrTx, id: string): Promise<ShipmentRow | undefined> {
  const rows = await db.select().from(shipments).where(eq(shipments.id, id)).limit(1);
  return rows[0];
}

export async function listShipments(
  db: DbOrTx,
  page: { limit: number; offset: number },
  filter?: { status?: "open" | "sold" | "void" }
) {
  const where = filter?.status ? eq(shipments.status, filter.status) : undefined;
  const items = await db
    .select()
    .from(shipments)
    .where(where)
    .orderBy(desc(shipments.openedAt))
    .limit(page.limit)
    .offset(page.offset);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shipments)
    .where(where);
  return { items, total: countRow?.count ?? 0 };
}

export async function bagsOfShipment(db: DbOrTx, shipmentId: string) {
  return db
    .select({
      bag: shipmentBags,
      collectorUserId: collectionRequests.collectorUserId
    })
    .from(shipmentBags)
    .leftJoin(collectionRequests, eq(collectionRequests.id, shipmentBags.requestId))
    .where(eq(shipmentBags.shipmentId, shipmentId))
    .orderBy(asc(shipmentBags.bagCode));
}

/** All bags grouped per request — used by invoice sale-marking logic. */
export async function requestIdsOfShipmentBags(db: DbOrTx, shipmentId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ requestId: shipmentBags.requestId })
    .from(shipmentBags)
    .where(eq(shipmentBags.shipmentId, shipmentId));
  return rows.map((r) => r.requestId);
}

export async function countBagsPerRequest(db: DbOrTx, requestIds: string[]) {
  if (requestIds.length === 0) return new Map<string, { total: number; inShipment: Map<string, number> }>();
  const rows = await db
    .select({ requestId: shipmentBags.requestId, shipmentId: shipmentBags.shipmentId, id: shipmentBags.id })
    .from(shipmentBags)
    .where(inArray(shipmentBags.requestId, requestIds));
  const map = new Map<string, { total: number; inShipment: Map<string, number> }>();
  for (const r of rows) {
    const entry = map.get(r.requestId) ?? { total: 0, inShipment: new Map<string, number>() };
    entry.total += 1;
    if (r.shipmentId) {
      entry.inShipment.set(r.shipmentId, (entry.inShipment.get(r.shipmentId) ?? 0) + 1);
    }
    map.set(r.requestId, entry);
  }
  return map;
}

/**
 * Which of these requests are now fully sold — EVERY bag of the request is
 * attached to a shipment that has been invoiced (`status = 'sold'`), not
 * merely bags within the ONE shipment just invoiced.
 *
 * A request's bags routinely spread across more than one shipment now that
 * shipments are homogeneous by material (§new capacity feature): a mixed
 * request (e.g. plastic + paper) always needs two shipments, invoiced on
 * their own schedules. Checking membership in just the currently-invoiced
 * shipment would (and did, before this fix) leave such requests stuck at
 * `sorted` forever, even after every one of their bags had actually been
 * sold — see ASSUMPTIONS A-018.
 */
export async function fullySoldRequestIds(db: DbOrTx, requestIds: string[]): Promise<string[]> {
  if (requestIds.length === 0) return [];
  const rows = await db
    .select({
      requestId: shipmentBags.requestId,
      shipmentId: shipmentBags.shipmentId,
      shipmentStatus: shipments.status
    })
    .from(shipmentBags)
    .leftJoin(shipments, eq(shipments.id, shipmentBags.shipmentId))
    .where(inArray(shipmentBags.requestId, requestIds));

  const byRequest = new Map<string, { shipmentId: string | null; shipmentStatus: string | null }[]>();
  for (const r of rows) {
    const arr = byRequest.get(r.requestId) ?? [];
    arr.push({ shipmentId: r.shipmentId, shipmentStatus: r.shipmentStatus ?? null });
    byRequest.set(r.requestId, arr);
  }

  const out: string[] = [];
  for (const [requestId, bags] of byRequest) {
    if (bags.length > 0 && bags.every((b) => b.shipmentId !== null && b.shipmentStatus === "sold")) {
      out.push(requestId);
    }
  }
  return out;
}

export async function countOpenBagsByStatus(db: DbOrTx) {
  const rows = await db
    .select({ status: shipmentBags.status, count: sql<number>`count(*)::int` })
    .from(shipmentBags)
    .groupBy(shipmentBags.status);
  return rows;
}

/** Recently weighed bags — regardless of whether they've since been placed
 *  into a shipment (`attached`), so the sorter's activity log doesn't empty
 *  out the moment a bag is filed into its batch. */
export async function recentWeighs(db: DbOrTx, limit = 10) {
  return db
    .select()
    .from(shipmentBags)
    .where(sql`${shipmentBags.weighedAt} IS NOT NULL`)
    .orderBy(desc(shipmentBags.weighedAt))
    .limit(limit);
}

/**
 * Sum of final weights already attached to each shipment — the "وزن داخل
 * الصفقة" the capacity guard and the sorter's dashboard both read.
 * Every bag with shipment_id set is `attached` by construction (see
 * ASSUMPTIONS A-011/A-018), so a plain SUM grouped by shipment_id is exact.
 */
export async function attachedWeightByShipment(
  db: DbOrTx,
  shipmentIds: string[]
): Promise<Map<string, string>> {
  if (shipmentIds.length === 0) return new Map();
  const rows = await db
    .select({
      shipmentId: shipmentBags.shipmentId,
      attachedKg: sql<string>`COALESCE(SUM(${shipmentBags.finalWeightKg}), 0)::text`
    })
    .from(shipmentBags)
    .where(inArray(shipmentBags.shipmentId, shipmentIds))
    .groupBy(shipmentBags.shipmentId);
  return new Map(rows.filter((r) => r.shipmentId !== null).map((r) => [r.shipmentId as string, r.attachedKg]));
}

export async function attachedWeightForShipment(db: DbOrTx, shipmentId: string): Promise<string> {
  const map = await attachedWeightByShipment(db, [shipmentId]);
  return map.get(shipmentId) ?? "0";
}
