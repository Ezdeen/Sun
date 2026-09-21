/**
 * Pricing estimate use case — public endpoint logic. Builds engine inputs
 * from the live catalog + settings, then calls the PURE engine.
 */
import { Decimal } from "decimal.js";
import { DomainError } from "../../../shared/errors.js";
import type { Db } from "../../../shared/db/client.js";
import {
  listActiveWasteTypes,
  listActiveAddonsWithTargets
} from "../../catalog/infrastructure/catalog-repo.js";
import { readPricingConfig } from "../../administration/application/settings.js";
import {
  priceCart,
  type AddonRef,
  type CartLineInput,
  type WasteTypeRef
} from "../domain/pricing.js";
import { Money } from "../../../shared/money.js";

export interface EstimateLineInput {
  wasteTypeCode: string;
  quantity?: string | null;
  weightKg?: string | null;
  selectedAddons?: string[];
}

export async function estimate(db: Db, lines: EstimateLineInput[]) {
  if (lines.length === 0) {
    throw new DomainError("validation_error", "cart must have at least one line", 400);
  }
  if (lines.length > 50) {
    throw new DomainError("validation_error", "cart too large (max 50 lines)", 400);
  }

  const [types, addonsRaw, config] = await Promise.all([
    listActiveWasteTypes(db),
    listActiveAddonsWithTargets(db),
    readPricingConfig(db)
  ]);

  const typeRefs = new Map<string, WasteTypeRef>(
    types.map((t) => [
      t.code,
      {
        code: t.code,
        category: t.category,
        unit: t.unit as "bottle" | "liter" | "kg",
        pricePerUnit: Money.fromMajor(t.pricePerUnit),
        capacityWeightKg: t.capacityWeightKg ? new Decimal(t.capacityWeightKg) : null,
        minWeightKg: t.minWeightKg ? new Decimal(t.minWeightKg) : null,
        isBulkOnly: t.isBulkOnly
      }
    ])
  );

  const addonRefs = new Map<string, AddonRef>(
    addonsRaw.map((a) => [
      a.code,
      {
        code: a.code,
        bonusPercent: new Decimal(a.bonusPercent),
        appliesTo: a.appliesTo
      }
    ])
  );

  const cartLines: CartLineInput[] = lines.map((l) => {
    const qty = l.quantity ? new Decimal(l.quantity) : new Decimal(1);
    if (qty.lessThanOrEqualTo(0)) {
      throw new DomainError("validation_error", `quantity must be > 0 for ${l.wasteTypeCode}`, 400);
    }
    if (l.weightKg !== undefined && l.weightKg !== null && Number.parseFloat(l.weightKg) < 0) {
      throw new DomainError("validation_error", `weight must be >= 0 for ${l.wasteTypeCode}`, 400);
    }
    return {
      wasteTypeCode: l.wasteTypeCode,
      quantity: qty,
      weightKg: l.weightKg ? new Decimal(l.weightKg) : null,
      selectedAddons: l.selectedAddons ?? []
    };
  });

  try {
    const result = priceCart(cartLines, typeRefs, addonRefs, config);
    return {
      lines: result.lines.map((line) => ({
        wasteTypeCode: line.wasteTypeCode,
        quantity: line.quantity.toString(),
        weightKg: line.weightKg?.toString() ?? null,
        basePrice: line.basePrice.toString(),
        bonusPercent: line.bonusPercent.toString(),
        appliedAddons: line.appliedAddons,
        price: line.price.toString(),
        estimatedWeightKg: line.estimatedWeightKg.toFixed(3),
        warnings: line.warnings
      })),
      totalPrice: result.totalPrice.toString(),
      totalEstimatedWeightKg: result.totalEstimatedWeightKg.toFixed(3),
      warnings: result.warnings
    };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "UnknownWasteTypeError" || err.name === "UnknownAddonError" || err.name === "AddonNotApplicableError")
    ) {
      throw new DomainError("unknown_waste_type", err.message, 400);
    }
    throw err;
  }
}
