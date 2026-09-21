#!/usr/bin/env node
/**
 * Generates sql/supabase_schema.sql — the standalone Supabase-compatible
 * script (schema + guards + RLS + reference seeds + gated demo users).
 * Assembled FROM the version-controlled migrations so it can never drift.
 *
 * Usage: node scripts/generate-supabase-sql.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function migration(name) {
  let sql = readFileSync(join(ROOT, "backend", "drizzle", `${name}.sql`), "utf8")
    .replaceAll("--> statement-breakpoint", "")
    .trim();

  // Idempotency transforms for the standalone script (the migration files
  // themselves stay drizzle-kit-native; drizzle tracks applied state).
  // 1) enums → DO block with duplicate_object guard
  sql = sql.replace(
    /CREATE TYPE "app"\."(\w+)" AS ENUM\(([^;]+)\);/g,
    (_m, name, values) =>
      `DO $$ BEGIN\n  CREATE TYPE "app"."${name}" AS ENUM(${values});\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`
  );
  // 2) tables → IF NOT EXISTS
  sql = sql.replace(/CREATE TABLE "app"/g, 'CREATE TABLE IF NOT EXISTS "app"');
  // 3) indexes → IF NOT EXISTS (drizzle emits unqualified index names)
  sql = sql.replace(
    /CREATE (UNIQUE )?INDEX "(\w+)" ON/g,
    (_m, uniq, name) => `CREATE ${uniq ?? ""}INDEX IF NOT EXISTS "${name}" ON`
  );
  // 4) ALTER TABLE ADD CONSTRAINT → DO block guard (quoted/unquoted, multi-line)
  sql = sql.replace(
    /ALTER TABLE (?:"app"\.|app\.)(?:"(\w+)"|(\w+))\s+ADD CONSTRAINT (?:"(\w+)"|(\w+)) ([^;]+);/g,
    (_m, quotedTable, plainTable, quotedConstraint, plainConstraint, rest) =>
      `DO $$ BEGIN\n  ALTER TABLE app."${quotedTable ?? plainTable}" ADD CONSTRAINT "${quotedConstraint ?? plainConstraint}" ${rest};\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`
  );
  return sql;
}

/** Must match backend/src/modules/seeds/seed.ts stableUuid(). */
function stableUuid(name) {
  const sha1 = createHash("sha1").update(`waste-seed:${name}`, "utf8").digest("hex");
  return [
    sha1.slice(0, 8),
    sha1.slice(8, 12),
    `5${sha1.slice(13, 16)}`,
    `a${sha1.slice(17, 20)}`,
    sha1.slice(20, 32)
  ].join("-");
}

function q(s) {
  return typeof s === "string" ? `'${s.replaceAll("'", "''")}'` : "NULL";
}

const areas = JSON.parse(
  readFileSync(join(ROOT, "backend", "src", "modules", "seeds", "data", "areas.json"), "utf8")
);
const areaRows = areas
  .map((a) => `  ('${stableUuid(`area:${a.code}`)}'::uuid, ${q(a.code)}, ${q(a.nameAr)}, ${q(a.nameEn)}, ${q(a.zone)}, ${a.households}, true)`)
  .join(",\n");

const header = `-- ═══════════════════════════════════════════════════════════════════════════
-- منصة إدارة النفايات الصلبة وإعادة التدوير — Full database script
-- Supabase / PostgreSQL 16+ compatible
--
-- USAGE (Supabase):
--   1. Open your project → SQL Editor → New query
--   2. Paste this ENTIRE file and Run
--   3. Create the first manager (production): use the backend CLI —
--      pnpm --filter @waste/backend cli create-admin <email> <password>
--      (For DEV databases only: uncomment the demo section at the bottom.)
--
-- Contents:
--   Part 1: schema "app" — enums + tables + indexes + FKs        (migration 0000)
--   Part 2: sequences, partial UNIQUE (1 active invoice/shipment),
--           append-only triggers, RLS deny-all                    (migration 0001)
--   Part 3: reference seed data (waste types, addons, areas, settings)
--   Part 4: DEMO users — DEVELOPMENT ONLY, gated by app.seed_environment
--
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- RLS is ENABLED with NO policies: client SDKs (anon/authenticated) get
-- NOTHING; your backend connects with the service/privileged connection.
-- Regenerate after migration changes: node scripts/generate-supabase-sql.mjs
-- ═══════════════════════════════════════════════════════════════════════════
`;

const part1 = `-- ─────────────────────────────────────────────────────────────────────────
-- PART 1: Schema (from migration 0000_init — DO NOT edit here; edit the
-- migration and regenerate this file)
-- ─────────────────────────────────────────────────────────────────────────
${migration("0000_init")}`;

const part2 = `-- ─────────────────────────────────────────────────────────────────────────
-- PART 2: Guards (from migration 0001_guards)
-- ─────────────────────────────────────────────────────────────────────────
${migration("0001_guards")}`;

const part3 = `-- ─────────────────────────────────────────────────────────────────────────
-- PART 3: Reference seed data (mirrors backend/src/modules/seeds/data/*.json)
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO app.service_areas (id, code, name_ar, name_en, zone, households, active) VALUES
${areaRows}
ON CONFLICT (id) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  zone = EXCLUDED.zone, households = EXCLUDED.households;

INSERT INTO app.waste_types (code, category, name_ar, name_en, unit, price_per_unit,
  capacity_weight_kg, reference_price_per_ton, min_weight_kg, is_bulk_only, display_order, active) VALUES
  ('PET_1L', 'plastic', 'قوارير بلاستيك 1 لتر', 'PET bottles 1L', 'bottle', 0.35, 0.03, 2000, NULL, false, 10, true),
  ('PET_15L', 'plastic', 'قوارير بلاستيك 1.5 لتر', 'PET bottles 1.5L', 'bottle', 0.45, 0.035, NULL, NULL, false, 11, true),
  ('PET_2L', 'plastic', 'قوارير بلاستيك 2 لتر', 'PET bottles 2L', 'bottle', 0.55, 0.04, NULL, NULL, false, 12, true),
  ('PET_3L_PLUS', 'plastic', 'قوارير بلاستيك 3 لتر وأكثر', 'PET bottles 3L+', 'bottle', 0.80, 0.07, NULL, NULL, false, 13, true),
  ('HDPE', 'plastic', 'بلاستيك HDPE (عبوات منظفات وشامبو وأنابيب)', 'HDPE containers and pipes', 'kg', 2.00, NULL, NULL, NULL, false, 20, true),
  ('LDPE', 'plastic', 'أكياس نايلون LDPE', 'LDPE nylon bags', 'kg', 2.00, NULL, NULL, NULL, false, 21, true),
  ('BOTTLE_CAP', 'plastic', 'غطاء القارورة (منفصلاً)', 'Bottle caps (separate)', 'kg', 2.00, NULL, NULL, NULL, false, 22, true),
  ('OFFICE_PAPER', 'paper', 'ورق مكتبي', 'Office paper', 'kg', 0.60, NULL, 600, 5, false, 30, true),
  ('CARDBOARD', 'paper', 'كرتون', 'Cardboard', 'kg', 0.60, NULL, 600, 5, false, 31, true),
  ('PROHIBITED_PAPER', 'paper', 'ورق ملوّث/شمعي/محارم/حراري — بكيس منفصل', 'Prohibited paper (bulk only)', 'kg', 0, NULL, NULL, NULL, true, 39, true),
  ('COOKING_OIL', 'oil', 'زيت القلي المستعمل', 'Used cooking oil', 'liter', 1.50, NULL, NULL, NULL, false, 40, true)
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  price_per_unit = EXCLUDED.price_per_unit, display_order = EXCLUDED.display_order;

INSERT INTO app.price_addons (code, name_ar, name_en, bonus_percent, active) VALUES
  ('WASHED', 'مغسول', 'Washed', 10, true),
  ('CAP_REMOVED', 'بدون غطاء', 'Cap removed', 8, true),
  ('LABEL_REMOVED', 'أُزيل الملصق', 'Label removed', 7, true),
  ('LDPE_WASHED', 'مغسولة وجافة', 'Washed and dry', 8, true),
  ('DRY_SEPARATED', 'جاف ومفصول', 'Dry and separated', 6, true),
  ('PAPER_CLEAN', 'نظيف وخالٍ من الأطعمة', 'Clean, food-free', 4, true)
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
  bonus_percent = EXCLUDED.bonus_percent;

INSERT INTO app.price_addon_waste_types (addon_code, waste_type_code) VALUES
  ('WASHED', 'PET_1L'), ('WASHED', 'PET_15L'), ('WASHED', 'PET_2L'), ('WASHED', 'PET_3L_PLUS'), ('WASHED', 'HDPE'),
  ('CAP_REMOVED', 'PET_1L'), ('CAP_REMOVED', 'PET_15L'), ('CAP_REMOVED', 'PET_2L'), ('CAP_REMOVED', 'PET_3L_PLUS'),
  ('LABEL_REMOVED', 'PET_1L'), ('LABEL_REMOVED', 'PET_15L'), ('LABEL_REMOVED', 'PET_2L'), ('LABEL_REMOVED', 'PET_3L_PLUS'), ('LABEL_REMOVED', 'HDPE'),
  ('LDPE_WASHED', 'LDPE'),
  ('DRY_SEPARATED', 'CARDBOARD'), ('DRY_SEPARATED', 'OFFICE_PAPER'),
  ('PAPER_CLEAN', 'OFFICE_PAPER')
ON CONFLICT DO NOTHING;

INSERT INTO app.platform_settings (id, key, value, version) VALUES
  ('093e03f7-845c-529e-aee2-d8ba45543666', 'pricing',
   '{"bonusCapPercent":25,"paperMinWeightKg":5,"paperUnderweightFactor":0.5,"underUnitFactor":0.5}'::jsonb, 1),
  ('4b1445dc-742a-537f-ac82-32d57fa9195f', 'distribution_splits',
   '{"platform":30,"collectors":40,"citizens":30}'::jsonb, 1),
  ('dd8990f0-b48e-51ed-ab65-eb6821d5da0b', 'distribution_policy',
   '{"unallocated":"to_platform"}'::jsonb, 1)
ON CONFLICT (key) DO NOTHING;`;

const part4 = `-- ─────────────────────────────────────────────────────────────────────────
-- PART 4: DEMO USERS — DEVELOPMENT / TEST ONLY (Appendix C)
-- Password for ALL demo accounts: Demo@12345!
-- Gated by app.seed_environment: uncomment BOTH the set_config line AND
-- remove the block comment /* ... */ around the transaction, then run.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT set_config('app.seed_environment', 'development', false);

/*
BEGIN;
DO $$
BEGIN
  IF current_setting('app.seed_environment', true) IS DISTINCT FROM 'development' THEN
    RAISE EXCEPTION 'Development-only seed. Set app.seed_environment=development first.';
  END IF;
END $$;

WITH demo_users AS (
  SELECT * FROM (VALUES
    ('10000000-0000-4000-8000-000000000001'::uuid, 'manager',   'مدير تجريبي',   'demo.manager@example.test'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'finance',   'مالية تجريبية', 'demo.finance@example.test'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'sorter',    'فرز تجريبي',    'demo.sorter@example.test'),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'authority', 'هيئة تجريبية',  'demo.authority@example.test'),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'collector', 'جامع تجريبي',   'demo.collector@example.test'),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'citizen',   'مواطن تجريبي',  'demo.citizen@example.test')
  ) AS t(id, role, display_name, email)
)
INSERT INTO app.users (id, role, display_name, email, status, created_at, updated_at)
SELECT id, role, display_name, email, 'active', NOW(), NOW()
FROM demo_users
ON CONFLICT (id) DO UPDATE
SET role = EXCLUDED.role, display_name = EXCLUDED.display_name,
    email = EXCLUDED.email, status = 'active', updated_at = NOW();

INSERT INTO app.credentials (user_id, password_hash, password_changed_at, failed_attempts, locked_until, created_at, updated_at)
SELECT id,
  '$argon2id$v=19$m=65536,t=3,p=2$bBprj/gB/j24HF0+3UiRJQ$/b704WrId/6ZNXLyd+5s0voVVjDAC8powvnLbj+F7hM',
  NOW(), 0, NULL, NOW(), NOW()
FROM (VALUES
  ('10000000-0000-4000-8000-000000000001'::uuid),
  ('10000000-0000-4000-8000-000000000002'::uuid),
  ('10000000-0000-4000-8000-000000000003'::uuid),
  ('10000000-0000-4000-8000-000000000004'::uuid),
  ('10000000-0000-4000-8000-000000000005'::uuid),
  ('10000000-0000-4000-8000-000000000006'::uuid)
) AS ids(id)
ON CONFLICT (user_id) DO UPDATE
SET password_hash = EXCLUDED.password_hash, failed_attempts = 0,
    locked_until = NULL, password_changed_at = NOW(), updated_at = NOW();

-- Role profiles (Al-Wadi default area)
INSERT INTO app.citizens    (user_id, service_area_id) VALUES ('10000000-0000-4000-8000-000000000006', 'cf6bab7e-23ee-5f71-a0d4-2fe3d1d19cc1') ON CONFLICT DO NOTHING;
INSERT INTO app.collectors  (user_id, service_area_id) VALUES ('10000000-0000-4000-8000-000000000005', 'cf6bab7e-23ee-5f71-a0d4-2fe3d1d19cc1') ON CONFLICT DO NOTHING;
INSERT INTO app.authorities (user_id, service_area_id) VALUES ('10000000-0000-4000-8000-000000000004', 'cf6bab7e-23ee-5f71-a0d4-2fe3d1d19cc1') ON CONFLICT DO NOTHING;
INSERT INTO app.staff_profiles (user_id, title) VALUES
  ('10000000-0000-4000-8000-000000000001', 'مدير تجريبي'),
  ('10000000-0000-4000-8000-000000000002', 'مالية تجريبية'),
  ('10000000-0000-4000-8000-000000000003', 'فرز تجريبي')
ON CONFLICT DO NOTHING;

COMMIT;
*/
-- ▲▲ END OF DEV-ONLY DEMO SECTION ▲▲

-- ── Verify installation ────────────────────────────────────────────────────
-- SELECT count(*) FROM app.waste_types;       -- 11
-- SELECT count(*) FROM app.price_addons;      -- 6
-- SELECT count(*) FROM app.service_areas;     -- 6
-- SELECT count(*) FROM app.platform_settings; -- 3
-- SELECT count(*) FROM pg_tables WHERE schemaname='app' AND rowsecurity; -- 24 (RLS on)`;

const sql = [header, part1, part2, part3, part4].join("\n\n") + "\n";
mkdirSync(join(ROOT, "sql"), { recursive: true });
writeFileSync(join(ROOT, "sql", "supabase_schema.sql"), sql, "utf8");
console.log(`written sql/supabase_schema.sql (${sql.split("\n").length} lines)`);
