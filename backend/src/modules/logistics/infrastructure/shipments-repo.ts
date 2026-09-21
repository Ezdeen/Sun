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

export async function recordBagWeight(
  tx: DbOrTx,
  input: { bagId: string; finalWeightKg: string; weighedBy: string }
): Promise<void> {
  await tx
    .update(shipmentBags)
    .set({
      finalWeightKg: input.finalWeightKg,
      weighedAt: new Date(),
      weighedBy: input.weighedBy,
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

export async function countOpenBagsByStatus(db: DbOrTx) {
  const rows = await db
    .select({ status: shipmentBags.status, count: sql<number>`count(*)::int` })
    .from(shipmentBags)
    .groupBy(shipmentBags.status);
  return rows;
}

export async function recentWeighs(db: DbOrTx, limit = 10) {
  return db
    .select()
    .from(shipmentBags)
    .where(eq(shipmentBags.status, "weighed"))
    .orderBy(desc(shipmentBags.weighedAt))
    .limit(limit);
}
