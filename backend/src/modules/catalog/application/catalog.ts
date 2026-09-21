/**
 * Public catalog read + manager catalog management.
 */
import { DomainError } from "../../../shared/errors.js";
import { wasteTypes } from "../../../shared/db/schema.js";
import type { Db } from "../../../shared/db/client.js";
import {
  listActiveWasteTypes,
  listActiveAddonsWithTargets,
  listActiveServiceAreas,
  updateWasteType,
  insertAddon,
  setAddonTargets,
  listAllAddonsWithTargets
} from "../infrastructure/catalog-repo.js";

export async function readPublicCatalog(db: Db) {
  const [types, addons, areas] = await Promise.all([
    listActiveWasteTypes(db),
    listActiveAddonsWithTargets(db),
    listActiveServiceAreas(db)
  ]);
  return {
    wasteTypes: types.map((t) => ({
      code: t.code,
      category: t.category,
      nameAr: t.nameAr,
      nameEn: t.nameEn,
      unit: t.unit,
      pricePerUnit: t.pricePerUnit,
      capacityWeightKg: t.capacityWeightKg,
      minWeightKg: t.minWeightKg,
      isBulkOnly: t.isBulkOnly,
      referencePricePerTon: t.referencePricePerTon,
      displayOrder: t.displayOrder
    })),
    addons: addons.map((a) => ({
      code: a.code,
      nameAr: a.nameAr,
      nameEn: a.nameEn,
      bonusPercent: a.bonusPercent,
      appliesTo: a.appliesTo
    })),
    serviceAreas: areas.map((a) => ({
      id: a.id,
      code: a.code,
      nameAr: a.nameAr,
      zone: a.zone
    }))
  };
}

export interface WasteTypeInput {
  code: string;
  category: string;
  nameAr: string;
  nameEn: string;
  unit: "bottle" | "liter" | "kg";
  pricePerUnit: string;
  capacityWeightKg?: string | null;
  minWeightKg?: string | null;
  isBulkOnly?: boolean;
  displayOrder?: number;
  referencePricePerTon?: string | null;
}

export async function createWasteType(db: Db, input: WasteTypeInput) {
  const [row] = await db
    .insert(wasteTypes)
    .values({
      code: input.code,
      category: input.category,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      unit: input.unit,
      pricePerUnit: input.pricePerUnit,
      capacityWeightKg: input.capacityWeightKg ?? null,
      minWeightKg: input.minWeightKg ?? null,
      isBulkOnly: input.isBulkOnly ?? false,
      displayOrder: input.displayOrder ?? 100,
      referencePricePerTon: input.referencePricePerTon ?? null
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new DomainError("duplicate_catalog_code", `code ${input.code} exists`, 409);
  return row;
}

export async function patchWasteType(
  db: Db,
  code: string,
  patch: Partial<Omit<WasteTypeInput, "code">> & { active?: boolean }
) {
  const row = await updateWasteType(db, code, patch as never);
  if (!row) throw new DomainError("not_found", `waste type ${code} not found`, 404);
  return row;
}

export async function createAddon(
  db: Db,
  input: { code: string; nameAr: string; nameEn: string; bonusPercent: string; appliesTo: string[] }
) {
  let row;
  try {
    row = await insertAddon(db, {
      addon: {
        code: input.code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        bonusPercent: input.bonusPercent
      },
      appliesTo: input.appliesTo
    });
  } catch {
    throw new DomainError("duplicate_catalog_code", `addon ${input.code} exists`, 409);
  }
  return row;
}

export async function updateAddonTargets(db: Db, addonCode: string, codes: string[]) {
  const addons = await listAllAddonsWithTargets(db);
  const found = addons.find((a) => a.code === addonCode);
  if (!found) throw new DomainError("not_found", `addon ${addonCode} not found`, 404);
  await setAddonTargets(db, addonCode, codes);
}
