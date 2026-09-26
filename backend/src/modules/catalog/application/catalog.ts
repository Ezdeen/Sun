/**
 * Public catalog read + manager catalog management.
 */
import { DomainError } from "../../../shared/errors.js";
import { uuidv7 } from "../../../shared/ids.js";
import { wasteTypes, type ServiceAreaRow } from "../../../shared/db/schema.js";
import type { Db } from "../../../shared/db/client.js";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import {
  listActiveWasteTypes,
  listActiveAddonsWithTargets,
  listActiveServiceAreas,
  listAllServiceAreas,
  getServiceAreaById,
  insertServiceArea,
  updateServiceArea,
  deleteServiceAreaById,
  updateWasteType,
  insertAddon,
  setAddonTargets,
  listAllAddonsWithTargets
} from "../infrastructure/catalog-repo.js";
import {
  findUserById,
  updateAuthorityServiceArea,
  listAuthoritiesForServiceAreas
} from "../../identity/infrastructure/users-repo.js";

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

// ── Service areas (manager CRUD + authority linking) ─────────────────────

export interface ServiceAreaInput {
  code: string;
  nameAr: string;
  nameEn: string;
  zone: string;
  households?: number;
  active?: boolean;
}

export interface ServiceAreaWithAuthorities extends ServiceAreaRow {
  authorities: { userId: string; displayName: string; email: string }[];
}

async function attachAuthorities(
  db: DbOrTx,
  areas: ServiceAreaRow[]
): Promise<ServiceAreaWithAuthorities[]> {
  const links = await listAuthoritiesForServiceAreas(db, areas.map((a) => a.id));
  return areas.map((a) => ({
    ...a,
    authorities: links
      .filter((l) => l.serviceAreaId === a.id)
      .map((l) => ({ userId: l.userId, displayName: l.displayName, email: l.email }))
  }));
}

/** Manager: list every service area (active + inactive) with its linked authority account(s). */
export async function listServiceAreasForManager(db: Db): Promise<ServiceAreaWithAuthorities[]> {
  const areas = await listAllServiceAreas(db);
  return attachAuthorities(db, areas);
}

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = "23505";
/** Postgres foreign-key-violation error code. */
const FK_VIOLATION = "23503";

export async function createServiceArea(
  db: Db,
  input: ServiceAreaInput
): Promise<ServiceAreaWithAuthorities> {
  const row = await insertServiceArea(db, {
    id: uuidv7(),
    code: input.code,
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    zone: input.zone,
    households: input.households ?? 0,
    active: input.active ?? true
  });
  if (!row) throw new DomainError("duplicate_catalog_code", `service area ${input.code} exists`, 409);
  return { ...row, authorities: [] };
}

export async function patchServiceArea(
  db: Db,
  id: string,
  patch: Partial<ServiceAreaInput>
): Promise<ServiceAreaWithAuthorities> {
  let row;
  try {
    row = await updateServiceArea(db, id, patch);
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === UNIQUE_VIOLATION) {
      throw new DomainError("duplicate_catalog_code", `service area ${patch.code} exists`, 409);
    }
    throw err;
  }
  if (!row) throw new DomainError("not_found", "service area not found", 404);
  const [withAuthorities] = await attachAuthorities(db, [row]);
  return withAuthorities!;
}

/** Manager: delete a service area (blocked if it still has linked accounts/requests). */
export async function deleteServiceArea(db: Db, id: string): Promise<void> {
  try {
    const ok = await deleteServiceAreaById(db, id);
    if (!ok) throw new DomainError("not_found", "service area not found", 404);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    const pgErr = err as { code?: string };
    if (pgErr?.code === FK_VIOLATION) {
      throw new DomainError(
        "conflict",
        "cannot delete: area has linked accounts or requests — disable it instead",
        409
      );
    }
    throw err;
  }
}

/**
 * Manager: link a service area to an existing authority account (re-points
 * that authority's assigned area). An authority is always assigned exactly
 * one area, so "linking" here means "assigning/reassigning" — there is no
 * unlinked state for an authority account.
 */
export async function linkServiceAreaAuthority(
  db: Db,
  areaId: string,
  authorityUserId: string
): Promise<ServiceAreaWithAuthorities> {
  const area = await getServiceAreaById(db, areaId);
  if (!area) throw new DomainError("not_found", "service area not found", 404);

  const user = await findUserById(db, authorityUserId);
  if (!user || user.role !== "authority") {
    throw new DomainError("validation_error", "account is not an authority account", 400, {
      field: "authorityUserId"
    });
  }

  const ok = await updateAuthorityServiceArea(db, authorityUserId, areaId);
  if (!ok) throw new DomainError("not_found", "authority profile not found", 404);

  const [withAuthorities] = await attachAuthorities(db, [area]);
  return withAuthorities!;
}
