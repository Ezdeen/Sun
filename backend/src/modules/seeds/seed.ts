/**
 * Seed runner — IDEMPOTENT, CLI-only, no startup seeding, no /seed endpoint.
 * Reference data (types/addons/areas) + default settings.
 * Demo data lives in a SEPARATE command (seed:demo, development only).
 */
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "../../shared/db/client.js";
import { loadJson } from "./load-json.js";
import {
  wasteTypes,
  priceAddons,
  priceAddonWasteTypes,
  serviceAreas,
  platformSettings,
  users,
  credentials,
  citizens,
  collectors,
  authorities,
  staffProfiles
} from "../../shared/db/schema.js";
import type { Settings } from "../../settings.js";

interface WasteTypeSeed {
  code: string;
  category: string;
  nameAr: string;
  nameEn: string;
  unit: string;
  pricePerUnit: string;
  capacityWeightKg?: string;
  referencePricePerTon?: string | null;
  minWeightKg?: string;
  isBulkOnly?: boolean;
  displayOrder: number;
}

interface AddonSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  bonusPercent: string;
  appliesTo: string[];
}

interface AreaSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  zone: string;
  households: number;
}

/** Deterministic UUID (v5-style) for stable seed ids → idempotency. */
function stableUuid(name: string): string {
  const sha1 = createHash("sha1").update(`waste-seed:${name}`, "utf8").digest("hex");
  return [
    sha1.slice(0, 8),
    sha1.slice(8, 12),
    `5${sha1.slice(13, 16)}`,
    `a${sha1.slice(17, 20)}`,
    sha1.slice(20, 32)
  ].join("-");
}

export async function seedReferenceData(db: Db) {
  const types = loadJson<WasteTypeSeed>("waste_types.json");
  const addons = loadJson<AddonSeed>("addons.json");
  const areas = loadJson<AreaSeed>("areas.json");

  return db.transaction(async (tx) => {
    // Service areas (stable UUIDs derived from code for idempotency).
    for (const a of areas) {
      const id = stableUuid(`area:${a.code}`);
      await tx
        .insert(serviceAreas)
        .values({ id, ...a, active: true })
        .onConflictDoUpdate({
          target: serviceAreas.id,
          set: { nameAr: a.nameAr, nameEn: a.nameEn, zone: a.zone, households: a.households }
        });
    }

    // Waste types.
    for (const t of types) {
      await tx
        .insert(wasteTypes)
        .values({
          code: t.code,
          category: t.category,
          nameAr: t.nameAr,
          nameEn: t.nameEn,
          unit: t.unit,
          pricePerUnit: t.pricePerUnit,
          capacityWeightKg: t.capacityWeightKg ?? null,
          referencePricePerTon: t.referencePricePerTon ?? null,
          minWeightKg: t.minWeightKg ?? null,
          isBulkOnly: t.isBulkOnly ?? false,
          displayOrder: t.displayOrder,
          active: true
        })
        .onConflictDoUpdate({
          target: wasteTypes.code,
          set: {
            nameAr: t.nameAr,
            nameEn: t.nameEn,
            pricePerUnit: t.pricePerUnit,
            displayOrder: t.displayOrder
          }
        });
    }

    // Addons + applicability links (declarative target lists).
    for (const a of addons) {
      await tx
        .insert(priceAddons)
        .values({
          code: a.code,
          nameAr: a.nameAr,
          nameEn: a.nameEn,
          bonusPercent: a.bonusPercent,
          active: true
        })
        .onConflictDoUpdate({
          target: priceAddons.code,
          set: { nameAr: a.nameAr, nameEn: a.nameEn, bonusPercent: a.bonusPercent }
        });
    }
    await tx.delete(priceAddonWasteTypes);
    for (const a of addons) {
      for (const code of a.appliesTo) {
        await tx
          .insert(priceAddonWasteTypes)
          .values({ addonCode: a.code, wasteTypeCode: code })
          .onConflictDoNothing();
      }
    }

    // Default settings (only if absent — never overwrite manager changes).
    const defaults: { key: string; value: Record<string, unknown> }[] = [
      {
        key: "pricing",
        value: {
          bonusCapPercent: 25,
          paperMinWeightKg: 5,
          paperUnderweightFactor: 0.5,
          underUnitFactor: 0.5
        }
      },
      { key: "distribution_splits", value: { platform: 30, collectors: 40, citizens: 30 } },
      { key: "distribution_policy", value: { unallocated: "to_platform" } }
    ];
    for (const d of defaults) {
      await tx
        .insert(platformSettings)
        .values({ id: stableUuid(`settings:${d.key}`), key: d.key, value: d.value, version: 1 })
        .onConflictDoNothing({ target: platformSettings.key });
    }

    const counts = await tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM app.waste_types) AS waste_types,
        (SELECT count(*)::int FROM app.price_addons) AS addons,
        (SELECT count(*)::int FROM app.service_areas) AS areas,
        (SELECT count(*)::int FROM app.platform_settings) AS settings
    `);
    return counts.rows[0];
  });
}

// ── Demo data (DEVELOPMENT/TEST ONLY — enforced by CLI, Appendix C) ──────
const DEMO_HASH =
  "$argon2id$v=19$m=65536,t=3,p=2$bBprj/gB/j24HF0+3UiRJQ$/b704WrId/6ZNXLyd+5s0voVVjDAC8powvnLbj+F7hM";

const DEMO_USERS: {
  id: string;
  role: "manager" | "finance" | "sorter" | "authority" | "collector" | "citizen";
  displayName: string;
  email: string;
}[] = [
  { id: "10000000-0000-4000-8000-000000000001", role: "manager", displayName: "مدير تجريبي", email: "demo.manager@example.test" },
  { id: "10000000-0000-4000-8000-000000000002", role: "finance", displayName: "مالية تجريبية", email: "demo.finance@example.test" },
  { id: "10000000-0000-4000-8000-000000000003", role: "sorter", displayName: "فرز تجريبي", email: "demo.sorter@example.test" },
  { id: "10000000-0000-4000-8000-000000000004", role: "authority", displayName: "هيئة تجريبية", email: "demo.authority@example.test" },
  { id: "10000000-0000-4000-8000-000000000005", role: "collector", displayName: "جامع تجريبي", email: "demo.collector@example.test" },
  { id: "10000000-0000-4000-8000-000000000006", role: "citizen", displayName: "مواطن تجريبي", email: "demo.citizen@example.test" }
];

export async function seedDemoData(db: Db, settings: Settings) {
  if (settings.env !== "development" && settings.env !== "test") {
    throw new Error("seed:demo is DEVELOPMENT/TEST ONLY");
  }
  // Reference data must exist first.
  await seedReferenceData(db);
  // Default demo service area: Al-Wadi (center).
  const defaultAreaId = stableUuid("area:AL-WADI");

  return db.transaction(async (tx) => {
    for (const u of DEMO_USERS) {
      await tx
        .insert(users)
        .values({
          id: u.id,
          role: u.role,
          displayName: u.displayName,
          email: u.email,
          status: "active"
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { role: u.role, displayName: u.displayName, email: u.email, status: "active" }
        });

      await tx
        .insert(credentials)
        .values({
          userId: u.id,
          passwordHash: DEMO_HASH,
          passwordChangedAt: new Date(),
          failedAttempts: 0
        })
        .onConflictDoUpdate({
          target: credentials.userId,
          set: { passwordHash: DEMO_HASH, failedAttempts: 0, lockedUntil: null }
        });

      switch (u.role) {
        case "citizen":
          await tx
            .insert(citizens)
            .values({ userId: u.id, serviceAreaId: defaultAreaId })
            .onConflictDoNothing();
          break;
        case "collector":
          await tx
            .insert(collectors)
            .values({ userId: u.id, serviceAreaId: defaultAreaId })
            .onConflictDoNothing();
          break;
        case "authority":
          await tx
            .insert(authorities)
            .values({ userId: u.id, serviceAreaId: defaultAreaId })
            .onConflictDoNothing();
          break;
        default:
          await tx
            .insert(staffProfiles)
            .values({ userId: u.id, title: u.displayName })
            .onConflictDoNothing();
      }
    }

    const counts = await tx.execute(sql`
      SELECT (SELECT count(*)::int FROM app.users) AS users,
             (SELECT count(*)::int FROM app.credentials) AS credentials
    `);
    return { demoUsers: DEMO_USERS.length, ...(counts.rows[0] as object), defaultAreaId };
  });
}
