/**
 * Catalog repository — waste types, addons (+ applicability), service areas.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import {
  wasteTypes,
  priceAddons,
  priceAddonWasteTypes,
  serviceAreas
} from "../../../shared/db/schema.js";

export async function listActiveWasteTypes(db: DbOrTx) {
  return db
    .select()
    .from(wasteTypes)
    .where(eq(wasteTypes.active, true))
    .orderBy(asc(wasteTypes.displayOrder), asc(wasteTypes.code));
}

export async function listAllWasteTypes(db: DbOrTx) {
  return db.select().from(wasteTypes).orderBy(asc(wasteTypes.displayOrder), asc(wasteTypes.code));
}

export async function listActiveAddonsWithTargets(db: DbOrTx) {
  const addons = await db
    .select()
    .from(priceAddons)
    .where(eq(priceAddons.active, true))
    .orderBy(asc(priceAddons.code));
  const links = await db.select().from(priceAddonWasteTypes);
  return addons.map((a) => ({
    ...a,
    appliesTo: links.filter((l) => l.addonCode === a.code).map((l) => l.wasteTypeCode)
  }));
}

export async function listAllAddonsWithTargets(db: DbOrTx) {
  const addons = await db.select().from(priceAddons).orderBy(asc(priceAddons.code));
  const links = await db.select().from(priceAddonWasteTypes);
  return addons.map((a) => ({
    ...a,
    appliesTo: links.filter((l) => l.addonCode === a.code).map((l) => l.wasteTypeCode)
  }));
}

export async function listActiveServiceAreas(db: DbOrTx) {
  return db
    .select()
    .from(serviceAreas)
    .where(eq(serviceAreas.active, true))
    .orderBy(asc(serviceAreas.code));
}

export async function listAllServiceAreas(db: DbOrTx) {
  return db.select().from(serviceAreas).orderBy(asc(serviceAreas.code));
}

export async function getServiceAreaById(db: DbOrTx, id: string) {
  const rows = await db.select().from(serviceAreas).where(eq(serviceAreas.id, id)).limit(1);
  return rows[0];
}

export async function insertServiceArea(
  db: DbOrTx,
  input: typeof serviceAreas.$inferInsert
) {
  const [row] = await db.insert(serviceAreas).values(input).onConflictDoNothing().returning();
  return row;
}

export async function updateServiceArea(
  db: DbOrTx,
  id: string,
  patch: Partial<typeof serviceAreas.$inferInsert>
) {
  const [row] = await db.update(serviceAreas).set(patch).where(eq(serviceAreas.id, id)).returning();
  return row;
}

/**
 * Hard-delete a service area. Restricted by FK from citizens/collectors/
 * authorities/collection_requests — callers should catch the FK violation
 * and offer disabling (active=false) instead.
 */
export async function deleteServiceAreaById(db: DbOrTx, id: string): Promise<boolean> {
  const res = await db.delete(serviceAreas).where(eq(serviceAreas.id, id)).returning({ id: serviceAreas.id });
  return res.length > 0;
}

export async function getWasteType(db: DbOrTx, code: string) {
  const rows = await db.select().from(wasteTypes).where(eq(wasteTypes.code, code)).limit(1);
  return rows[0];
}

export async function insertWasteType(
  db: DbOrTx,
  input: typeof wasteTypes.$inferInsert
) {
  const [row] = await db.insert(wasteTypes).values(input).returning();
  return row!;
}

export async function updateWasteType(
  db: DbOrTx,
  code: string,
  patch: Partial<typeof wasteTypes.$inferInsert>
) {
  const [row] = await db
    .update(wasteTypes)
    .set(patch)
    .where(eq(wasteTypes.code, code))
    .returning();
  return row;
}

export async function insertAddon(
  db: DbOrTx,
  input: { addon: typeof priceAddons.$inferInsert; appliesTo: string[] }
) {
  const [row] = await db.insert(priceAddons).values(input.addon).returning();
  for (const code of input.appliesTo) {
    await db.insert(priceAddonWasteTypes).values({ addonCode: input.addon.code, wasteTypeCode: code });
  }
  return row!;
}

export async function setAddonTargets(db: DbOrTx, addonCode: string, codes: string[]) {
  await db.delete(priceAddonWasteTypes).where(eq(priceAddonWasteTypes.addonCode, addonCode));
  for (const code of codes) {
    await db
      .insert(priceAddonWasteTypes)
      .values({ addonCode, wasteTypeCode: code })
      .onConflictDoNothing();
  }
}

export async function updateAddon(
  db: DbOrTx,
  code: string,
  patch: Partial<typeof priceAddons.$inferInsert>
) {
  const [row] = await db.update(priceAddons).set(patch).where(eq(priceAddons.code, code)).returning();
  return row;
}

export async function countCatalogItems(db: DbOrTx) {
  const [t] = await db.select({ c: sql<number>`count(*)::int` }).from(wasteTypes);
  const [a] = await db.select({ c: sql<number>`count(*)::int` }).from(priceAddons);
  const [ar] = await db.select({ c: sql<number>`count(*)::int` }).from(serviceAreas);
  return { wasteTypes: t?.c ?? 0, addons: a?.c ?? 0, areas: ar?.c ?? 0 };
}
