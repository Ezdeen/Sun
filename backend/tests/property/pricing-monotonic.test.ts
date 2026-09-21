import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Decimal } from "decimal.js";
import { Money } from "../../src/shared/money.js";
import {
  priceCart,
  type AddonRef,
  type CartLineInput,
  type WasteTypeRef
} from "../../src/modules/pricing/domain/pricing.js";

/** PROPERTY (§6.1): adding an addon never decreases the price. */
describe("pricing property: addons are monotonic", () => {
  const typeArb: fc.Arbitrary<WasteTypeRef> = fc
    .record({
      code: fc.constantFrom("PET_X"),
      category: fc.constant("plastic"),
      unit: fc.constantFrom("bottle", "liter", "kg") as fc.Arbitrary<"bottle" | "liter" | "kg">,
      price: fc.integer({ min: 1, max: 500 }).map((c) => Money.fromMinor(BigInt(c))),
      capacity: fc.option(fc.integer({ min: 1, max: 500 }).map((n) => new Decimal(n).div(1000)), {
        nil: null
      }),
      minWeight: fc.option(fc.integer({ min: 1, max: 20 }).map((n) => new Decimal(n)), { nil: null }),
      bulk: fc.boolean()
    })
    .map((r) => ({
      code: r.code,
      category: r.category,
      unit: r.unit,
      pricePerUnit: r.price,
      capacityWeightKg: r.capacity,
      minWeightKg: r.minWeight,
      isBulkOnly: r.bulk
    }));

  const addonArb: fc.Arbitrary<AddonRef> = fc
    .record({
      code: fc.constantFrom("A1", "A2", "A3"),
      percent: fc.integer({ min: 0, max: 25 }).map((n) => new Decimal(n)),
      appliesTo: fc.constant(["PET_X"])
    })
    .map((r) => ({ code: r.code, bonusPercent: r.percent, appliesTo: r.appliesTo }));

  it("for any cart & any addon subset: price(with) >= price(without)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }).chain((count) =>
          fc.array(
            fc.record({
              qty: fc.integer({ min: 0, max: 1000 }).map((n) => new Decimal(n).div(10)),
              weight: fc.option(
                fc.integer({ min: 0, max: 50000 }).map((n) => new Decimal(n).div(1000)),
                { nil: null }
              )
            }),
            { minLength: count, maxLength: count }
          )
        ),
        typeArb,
        fc.array(addonArb, { minLength: 1, maxLength: 3 }),
        fc.nat(10),
        async (rawLines, type, addons, seed) => {
          const types = new Map([[type.code, type]]);
          const addonMap = new Map(addons.map((a) => [a.code, a]));
          const cfg = {
            bonusCapPercent: new Decimal("25"),
            paperMinWeightKg: new Decimal("5"),
            paperUnderweightFactor: new Decimal("0.5"),
            underUnitFactor: new Decimal("0.5")
          };

          const mk = (selected: string[]): CartLineInput[] =>
            rawLines.map((l) => ({
              wasteTypeCode: type.code,
              quantity: l.qty,
              weightKg: l.weight,
              selectedAddons: selected
            }));

          // Deterministic subsets of addon codes
          const codes = addons.map((a) => a.code);
          const subset = codes.filter((_, i) => (seed >> i) & 1);
          const without = priceCart(mk([]), types, addonMap, cfg);
          const withAddons = priceCart(mk(subset), types, addonMap, cfg);

          expect(withAddons.totalPrice.toMinorUnits()).toBeGreaterThanOrEqual(
            without.totalPrice.toMinorUnits()
          );
        }
      ),
      { numRuns: 300 }
    );
  });
});
