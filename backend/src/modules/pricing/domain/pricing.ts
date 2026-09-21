/**
 * PRICING ENGINE (§6.1) — pure, composable rules. No framework imports,
 * no clock, no randomness. All monetary math via Money (decimal.js).
 *
 * Documented decision (see docs/ASSUMPTIONS.md #A-001):
 *   final price = base × reduction factor (paper min-weight / under-unit)
 *   × (1 + capped bonus percent / 100).
 *   Reductions apply to the base first; the bonus multiplier is independent.
 */
import { Money } from "../../../shared/money.js";
import { Decimal } from "decimal.js";

export type WasteUnit = "bottle" | "liter" | "kg";

export interface WasteTypeRef {
  code: string;
  category: string;
  unit: WasteUnit;
  pricePerUnit: Money;
  /** Unit weight for counted types (bottle/liter). */
  capacityWeightKg?: Decimal | null;
  /** Minimum acceptable weight for weight-priced types (paper). */
  minWeightKg?: Decimal | null;
  isBulkOnly: boolean;
}

export interface AddonRef {
  code: string;
  bonusPercent: Decimal;
  /** Waste type codes this addon applies to. */
  appliesTo: string[];
}

export interface CartLineInput {
  wasteTypeCode: string;
  quantity: Decimal;
  weightKg?: Decimal | null;
  selectedAddons: string[];
}

export interface PricingConfig {
  bonusCapPercent: Decimal;
  paperMinWeightKg: Decimal;
  paperUnderweightFactor: Decimal;
  underUnitFactor: Decimal;
}

export interface LineWarning {
  code: string;
  message: string;
}

export interface AppliedAddon {
  code: string;
  percent: Decimal;
}

export interface PricedLine {
  wasteTypeCode: string;
  quantity: Decimal;
  weightKg: Decimal | null;
  basePrice: Money;
  bonusPercent: Decimal;
  appliedAddons: AppliedAddon[];
  price: Money;
  estimatedWeightKg: Decimal;
  warnings: LineWarning[];
}

export interface PricingResult {
  lines: PricedLine[];
  totalPrice: Money;
  totalEstimatedWeightKg: Decimal;
  warnings: LineWarning[];
}

export class UnknownWasteTypeError extends Error {
  constructor(readonly code: string) {
    super(`Unknown waste type: ${code}`);
  }
}

export class UnknownAddonError extends Error {
  constructor(readonly code: string) {
    super(`Unknown addon: ${code}`);
  }
}

export class AddonNotApplicableError extends Error {
  constructor(readonly addonCode: string, readonly wasteTypeCode: string) {
    super(`Addon ${addonCode} does not apply to ${wasteTypeCode}`);
  }
}

/** Rule 1 + 6: unit pricing and estimated weight. */
function basePriceAndWeight(line: CartLineInput, type: WasteTypeRef): { base: Money; weight: Decimal } {
  if (type.unit === "kg") {
    const weight = line.weightKg ?? new Decimal(0);
    return { base: type.pricePerUnit.mul(weight), weight };
  }
  const estWeight = type.capacityWeightKg
    ? new Decimal(line.quantity).mul(type.capacityWeightKg)
    : new Decimal(0);
  return { base: type.pricePerUnit.mul(line.quantity), weight: estWeight };
}

/** Rule 3: bulk-only types are collected in a separate bag — price is 0. */
function bulkOnlyRule(line: PricedLine): void {
  line.price = Money.zero();
  line.warnings.push({
    code: "bulk_only",
    message: "هذا النوع يُجمع بكيس منفصل ولا يُسعَّر"
  });
}

/** Rule 4: weight-priced type below its minimum weight → reduced price. */
function minWeightRule(
  line: PricedLine,
  type: WasteTypeRef,
  cfg: PricingConfig
): { factor: Decimal; triggered: boolean } {
  const min = type.minWeightKg ?? cfg.paperMinWeightKg;
  const weight = line.weightKg ?? null;
  const hasOwnMin = type.minWeightKg !== null && type.minWeightKg !== undefined;
  if (!hasOwnMin || weight === null) {
    return { factor: new Decimal(1), triggered: false };
  }
  if (weight.lessThan(min)) {
    line.warnings.push({
      code: "paper_underweight",
      message: `الوزن أقل من الحد الأدنى (${min} كجم) — خُفِّض السعر إلى ${cfg.paperUnderweightFactor.mul(100)}%`
    });
    return { factor: cfg.paperUnderweightFactor, triggered: true };
  }
  return { factor: new Decimal(1), triggered: false };
}

/** Rule 5: quantity below one unit → estimated-initial price. */
function underUnitRule(line: PricedLine, cfg: PricingConfig): { factor: Decimal; triggered: boolean } {
  if (line.quantity.lessThan(1)) {
    line.warnings.push({
      code: "under_unit_quantity",
      message: "الكمية أقل من وحدة واحدة — سعر تقديري مبدئي"
    });
    return { factor: cfg.underUnitFactor, triggered: true };
  }
  return { factor: new Decimal(1), triggered: false };
}

/** Rule 2: bonus addons, capped at bonusCapPercent. Never negative. */
function bonusRule(
  line: CartLineInput,
  type: WasteTypeRef,
  addons: Map<string, AddonRef>
): { percent: Decimal; applied: AppliedAddon[] } {
  const applied: AppliedAddon[] = [];
  for (const code of line.selectedAddons) {
    const addon = addons.get(code);
    if (!addon) throw new UnknownAddonError(code);
    if (!addon.appliesTo.includes(type.code)) {
      throw new AddonNotApplicableError(code, type.code);
    }
    applied.push({ code, percent: addon.bonusPercent });
  }
  const summed = applied.reduce((acc, a) => acc.plus(a.percent), new Decimal(0));
  return { percent: summed, applied };
}

export function priceCart(
  lines: readonly CartLineInput[],
  types: Map<string, WasteTypeRef>,
  addons: Map<string, AddonRef>,
  cfg: PricingConfig
): PricingResult {
  const priced: PricedLine[] = [];
  const allWarnings: LineWarning[] = [];

  for (const line of lines) {
    const type = types.get(line.wasteTypeCode);
    if (!type) throw new UnknownWasteTypeError(line.wasteTypeCode);

    const { base, weight } = basePriceAndWeight(line, type);

    const pricedLine: PricedLine = {
      wasteTypeCode: type.code,
      quantity: new Decimal(line.quantity),
      weightKg: line.weightKg ? new Decimal(line.weightKg) : null,
      basePrice: base,
      bonusPercent: new Decimal(0),
      appliedAddons: [],
      price: base,
      estimatedWeightKg: weight,
      warnings: []
    };

    if (type.isBulkOnly) {
      bulkOnlyRule(pricedLine);
      priced.push(pricedLine);
      allWarnings.push(...pricedLine.warnings);
      continue;
    }

    const paperFactor = minWeightRule(pricedLine, type, cfg);
    const underUnit = underUnitRule(pricedLine, cfg);
    const reduction = paperFactor.factor.mul(underUnit.factor);
    const reducedBase = base.mul(reduction);

    const cappedPercent = (p: import("decimal.js").Decimal, cap: import("decimal.js").Decimal) =>
      p.greaterThan(cap) ? cap : p;

    const bonus = bonusRule(line, type, addons);
    const percent = cappedPercent(bonus.percent, cfg.bonusCapPercent);
    pricedLine.bonusPercent = percent;
    pricedLine.appliedAddons = bonus.applied;
    pricedLine.price = reducedBase.mul(new Decimal(1).plus(percent.div(100)));

    priced.push(pricedLine);
    allWarnings.push(...pricedLine.warnings);
  }

  const totalPrice = Money.sum(priced.map((l) => l.price));
  const totalWeight = priced.reduce(
    (acc, l) => acc.plus(l.estimatedWeightKg),
    new Decimal(0)
  );

  return {
    lines: priced,
    totalPrice,
    totalEstimatedWeightKg: totalWeight,
    warnings: allWarnings
  };
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  bonusCapPercent: new Decimal(25),
  paperMinWeightKg: new Decimal(5),
  paperUnderweightFactor: new Decimal("0.5"),
  underUnitFactor: new Decimal("0.5")
};
