/**
 * Settings use cases — runtime-changeable business parameters
 * (distribution splits, bonus cap, limits, unallocated policy).
 * NEVER hardcoded numbers in engines; always read through here.
 */
import { DomainError } from "../../../shared/errors.js";
import { Decimal } from "decimal.js";
import type { Db } from "../../../shared/db/client.js";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import { readSetting, upsertSetting, readAllSettings } from "../infrastructure/settings-repo.js";
import type { PricingConfig } from "../../pricing/domain/pricing.js";
import {
  assertSplitsSumTo100,
  DEFAULT_SPLITS,
  type SplitsSnapshot,
  type UnallocatedPolicy
} from "../../finance/domain/distribution.js";

export const SETTINGS_KEYS = {
  pricing: "pricing",
  distributionSplits: "distribution_splits",
  distributionPolicy: "distribution_policy"
} as const;

export const DEFAULT_PRICING: {
  bonusCapPercent: number;
  paperMinWeightKg: number;
  paperUnderweightFactor: number;
  underUnitFactor: number;
} = {
  bonusCapPercent: 25,
  paperMinWeightKg: 5,
  paperUnderweightFactor: 0.5,
  underUnitFactor: 0.5
};

const DEFAULT_POLICY: { unallocated: UnallocatedPolicy } = { unallocated: "to_platform" };

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Pricing configuration for the pricing engine (§6.1). */
export async function readPricingConfig(db: DbOrTx): Promise<PricingConfig> {
  const raw = await readSetting(db, SETTINGS_KEYS.pricing);
  const v = raw ?? {};
  return {
    bonusCapPercent: new Decimal(num(v["bonusCapPercent"], DEFAULT_PRICING.bonusCapPercent)),
    paperMinWeightKg: new Decimal(num(v["paperMinWeightKg"], DEFAULT_PRICING.paperMinWeightKg)),
    paperUnderweightFactor: new Decimal(
      num(v["paperUnderweightFactor"], DEFAULT_PRICING.paperUnderweightFactor)
    ),
    underUnitFactor: new Decimal(num(v["underUnitFactor"], DEFAULT_PRICING.underUnitFactor))
  };
}

/** Distribution splits snapshot source (§6.4). */
export async function readSplits(db: DbOrTx): Promise<SplitsSnapshot> {
  const raw = await readSetting(db, SETTINGS_KEYS.distributionSplits);
  if (!raw) return { ...DEFAULT_SPLITS };
  return {
    platform: num(raw["platform"], DEFAULT_SPLITS.platform),
    collectors: num(raw["collectors"], DEFAULT_SPLITS.collectors),
    citizens: num(raw["citizens"], DEFAULT_SPLITS.citizens)
  };
}

export async function readUnallocatedPolicy(db: DbOrTx): Promise<{ unallocated: UnallocatedPolicy }> {
  const raw = await readSetting(db, SETTINGS_KEYS.distributionPolicy);
  if (!raw) return { ...DEFAULT_POLICY };
  const v = raw["unallocated"];
  return { unallocated: v === "held" ? "held" : "to_platform" };
}

export interface UpdateSettingsInput {
  pricing?: {
    bonusCapPercent?: number;
    paperMinWeightKg?: number;
    paperUnderweightFactor?: number;
    underUnitFactor?: number;
  };
  distributionSplits?: { platform: number; collectors: number; citizens: number };
  distributionPolicy?: { unallocated: UnallocatedPolicy };
}

export async function updateSettings(
  db: Db,
  input: UpdateSettingsInput,
  updatedBy: string
): Promise<void> {
  if (input.distributionSplits) {
    assertSplitsSumTo100(input.distributionSplits);
    const pct = (n: unknown) => num(n, 0);
    void pct;
    if (
      input.distributionSplits.platform < 0 ||
      input.distributionSplits.collectors < 0 ||
      input.distributionSplits.citizens < 0
    ) {
      throw new DomainError("validation_error", "splits must be non-negative", 400);
    }
    await upsertSetting(db, {
      key: SETTINGS_KEYS.distributionSplits,
      value: input.distributionSplits,
      updatedBy
    });
  }
  if (input.pricing) {
    const current = await readSetting(db, SETTINGS_KEYS.pricing);
    const merged = { ...(current ?? DEFAULT_PRICING), ...input.pricing };
    if (num(merged["bonusCapPercent"], 25) < 0 || num(merged["bonusCapPercent"], 25) > 100) {
      throw new DomainError("validation_error", "bonus cap must be within 0..100", 400);
    }
    await upsertSetting(db, { key: SETTINGS_KEYS.pricing, value: merged, updatedBy });
  }
  if (input.distributionPolicy) {
    await upsertSetting(db, {
      key: SETTINGS_KEYS.distributionPolicy,
      value: input.distributionPolicy,
      updatedBy
    });
  }
}

export async function readSettingsForDisplay(db: Db) {
  const [pricing, splits, policy] = await Promise.all([
    readSetting(db, SETTINGS_KEYS.pricing),
    readSetting(db, SETTINGS_KEYS.distributionSplits),
    readSetting(db, SETTINGS_KEYS.distributionPolicy)
  ]);
  return {
    pricing: pricing ?? DEFAULT_PRICING,
    distributionSplits: splits ?? DEFAULT_SPLITS,
    distributionPolicy: policy ?? DEFAULT_POLICY
  };
}

export { readAllSettings };
