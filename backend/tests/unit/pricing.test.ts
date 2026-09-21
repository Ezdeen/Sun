import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { Money } from "../../src/shared/money.js";
import {
  priceCart,
  DEFAULT_PRICING_CONFIG,
  type AddonRef,
  type CartLineInput,
  type WasteTypeRef
} from "../../src/modules/pricing/domain/pricing.js";

const PET_2L: WasteTypeRef = {
  code: "PET_2L",
  category: "plastic",
  unit: "bottle",
  pricePerUnit: Money.fromMajor("0.55"),
  capacityWeightKg: new Decimal("0.04"),
  minWeightKg: null,
  isBulkOnly: false
};

const HDPE: WasteTypeRef = {
  code: "HDPE",
  category: "plastic",
  unit: "kg",
  pricePerUnit: Money.fromMajor("2.00"),
  capacityWeightKg: null,
  minWeightKg: null,
  isBulkOnly: false
};

const PAPER: WasteTypeRef = {
  code: "OFFICE_PAPER",
  category: "paper",
  unit: "kg",
  pricePerUnit: Money.fromMajor("0.60"),
  capacityWeightKg: null,
  minWeightKg: new Decimal("5"),
  isBulkOnly: false
};

const BULK: WasteTypeRef = {
  code: "PROHIBITED_PAPER",
  category: "paper",
  unit: "kg",
  pricePerUnit: Money.fromMajor("0"),
  capacityWeightKg: null,
  minWeightKg: null,
  isBulkOnly: true
};

const WASHED: AddonRef = {
  code: "WASHED",
  bonusPercent: new Decimal("10"),
  appliesTo: ["PET_2L"]
};
const CAP_REMOVED: AddonRef = {
  code: "CAP_REMOVED",
  bonusPercent: new Decimal("8"),
  appliesTo: ["PET_2L"]
};
const LABEL_REMOVED: AddonRef = {
  code: "LABEL_REMOVED",
  bonusPercent: new Decimal("7"),
  appliesTo: ["PET_2L"]
};

const types = new Map<string, WasteTypeRef>([
  ["PET_2L", PET_2L],
  ["HDPE", HDPE],
  ["OFFICE_PAPER", PAPER],
  ["PROHIBITED_PAPER", BULK]
]);
const addons = new Map<string, AddonRef>([
  ["WASHED", WASHED],
  ["CAP_REMOVED", CAP_REMOVED],
  ["LABEL_REMOVED", LABEL_REMOVED]
]);

function line(code: string, qty?: string, weight?: string, selected?: string[]): CartLineInput {
  return {
    wasteTypeCode: code,
    quantity: new Decimal(qty ?? "1"),
    weightKg: weight ? new Decimal(weight) : null,
    selectedAddons: selected ?? []
  };
}

describe("pricing engine (§6.1) — table-driven rules", () => {
  it("R1: bottle unit price = price × quantity", () => {
    const r = priceCart([line("PET_2L", "10")], types, addons, DEFAULT_PRICING_CONFIG);
    expect(r.lines[0]!.price.toString()).toBe("5.50");
    expect(r.totalPrice.toString()).toBe("5.50");
  });

  it("R1: kg unit price = price × weight", () => {
    const r = priceCart([line("HDPE", "1", "3.5")], types, addons, DEFAULT_PRICING_CONFIG);
    expect(r.lines[0]!.price.toString()).toBe("7.00");
  });

  it("R2: bonuses sum and multiply, capped at 25%", () => {
    // 10 + 8 = 18% → 5.50 × 1.18 = 6.49
    const r18 = priceCart([line("PET_2L", "10", undefined, ["WASHED", "CAP_REMOVED"])], types, addons, DEFAULT_PRICING_CONFIG);
    expect(r18.lines[0]!.bonusPercent.toString()).toBe("18");
    expect(r18.lines[0]!.price.toString()).toBe("6.49");

    // 10 + 8 + 7 = 25 → exactly at the cap, allowed
    const r25 = priceCart(
      [line("PET_2L", "10", undefined, ["WASHED", "CAP_REMOVED", "LABEL_REMOVED"])],
      types,
      addons,
      DEFAULT_PRICING_CONFIG
    );
    expect(r25.lines[0]!.bonusPercent.toString()).toBe("25");
    expect(r25.lines[0]!.price.toString()).toBe("6.88");
  });

  it("R3: bulk_only → price 0 + warning", () => {
    const r = priceCart([line("PROHIBITED_PAPER", "1", "7")], types, addons, DEFAULT_PRICING_CONFIG);
    expect(r.lines[0]!.price.toString()).toBe("0.00");
    expect(r.lines[0]!.warnings.some((w) => w.code === "bulk_only")).toBe(true);
  });

  it("R4: paper below min weight → half price + warning; AT min weight → full price", () => {
    const below = priceCart([line("OFFICE_PAPER", "1", "4.999")], types, addons, DEFAULT_PRICING_CONFIG);
    expect(below.lines[0]!.price.toString()).toBe("1.50"); // 3.00 × 0.5
    expect(below.lines[0]!.warnings.some((w) => w.code === "paper_underweight")).toBe(true);

    const exact = priceCart([line("OFFICE_PAPER", "1", "5")], types, addons, DEFAULT_PRICING_CONFIG);
    expect(exact.lines[0]!.price.toString()).toBe("3.00");
    expect(exact.lines[0]!.warnings.length).toBe(0);
  });

  it("R5: quantity below 1 → half price + warning", () => {
    const r = priceCart([line("PET_2L", "0.5")], types, addons, DEFAULT_PRICING_CONFIG);
    expect(r.lines[0]!.price.toString()).toBe("0.14"); // 0.275 base × 0.5 = 0.1375 → 0.14
    expect(r.lines[0]!.warnings.some((w) => w.code === "under_unit_quantity")).toBe(true);
  });

  it("R6: estimated weight = qty × capacity for counted types", () => {
    const r = priceCart([line("PET_2L", "100")], types, addons, DEFAULT_PRICING_CONFIG);
    expect(r.lines[0]!.estimatedWeightKg.toString()).toBe("4");
    expect(r.totalEstimatedWeightKg.toFixed(3)).toBe("4.000");
  });

  it("R4+R5 combine multiplicatively", () => {
    const r = priceCart([line("OFFICE_PAPER", "0.5", "2")], types, addons, DEFAULT_PRICING_CONFIG);
    // base 1.20 → ×0.5 (paper) ×0.5 (qty) = 0.30
    expect(r.lines[0]!.price.toString()).toBe("0.30");
  });

  it("rejects unknown types and non-applicable addons", () => {
    expect(() => priceCart([line("NOPE")], types, addons, DEFAULT_PRICING_CONFIG)).toThrow();
    expect(() =>
      priceCart([line("HDPE", "1", "1", ["WASHED"])], types, addons, DEFAULT_PRICING_CONFIG)
    ).toThrow(); // WASHED not applicable to HDPE in this map
  });

  it("empty cart → total 0", () => {
    const r = priceCart([], types, addons, DEFAULT_PRICING_CONFIG);
    expect(r.totalPrice.toString()).toBe("0.00");
  });
});
