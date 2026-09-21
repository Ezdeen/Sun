import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Money } from "../../src/shared/money.js";
import {
  distributeInvoice,
  largestRemainder,
  assertSplitsSumTo100,
  DEFAULT_SPLITS
} from "../../src/modules/finance/domain/distribution.js";

describe("finance distribution engine (§6.4)", () => {
  it("rejects splits that do not sum to exactly 100", () => {
    expect(() =>
      assertSplitsSumTo100({ platform: 30, collectors: 40, citizens: 31 })
    ).toThrow();
    expect(() =>
      assertSplitsSumTo100({ platform: 30, collectors: 40, citizens: 29 })
    ).toThrow();
  });

  it("case: single collector & single citizen, exact splits", () => {
    const out = distributeInvoice({
      invoiceAmount: Money.fromMajor("100.00"),
      splits: DEFAULT_SPLITS,
      collectorWeights: [{ collectorUserId: "col1", weightKg: "10.000" }],
      citizenWeights: [{ citizenUserId: "cit1", weightKg: "10.000" }],
      policy: { unallocated: "to_platform" }
    });
    // platform 30, collector 40, citizen 30 — exact
    expect(out.payouts.map((p) => [p.beneficiaryType, p.amount.toString()])).toEqual([
      ["platform", "30.00"],
      ["collector", "40.00"],
      ["citizen", "30.00"]
    ]);
    const sum = out.payouts.reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
    expect(sum).toBe(10000n);
  });

  it("case: 0.01 invoice — largest remainder gives the collector the agora", () => {
    const out = distributeInvoice({
      invoiceAmount: Money.fromMajor("0.01"),
      splits: DEFAULT_SPLITS,
      collectorWeights: [{ collectorUserId: "col1", weightKg: "1.000" }],
      citizenWeights: [{ citizenUserId: "cit1", weightKg: "1.000" }],
      policy: { unallocated: "to_platform" }
    });
    const sum = out.payouts.reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
    expect(sum).toBe(1n);
    expect(out.payouts.length).toBe(1);
    expect(out.payouts[0]!.beneficiaryType).toBe("collector"); // 0.4 > 0.3 → collector wins
  });

  it("case: NO collectors → pool goes to platform with explicit reason (money never lost)", () => {
    const out = distributeInvoice({
      invoiceAmount: Money.fromMajor("100.00"),
      splits: DEFAULT_SPLITS,
      collectorWeights: [],
      citizenWeights: [{ citizenUserId: "cit1", weightKg: "10.000" }],
      policy: { unallocated: "to_platform" }
    });
    const platformTotal = out.payouts
      .filter((p) => p.beneficiaryType === "platform")
      .reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
    expect(platformTotal).toBe(7000n); // 30 + 40 (redirected)
    expect(out.payouts.some((p) => p.reason === "no_eligible_collectors")).toBe(true);
    expect(out.ledgerLines.some((l) => l.entryType === "unallocated_to_platform")).toBe(true);
    const sum = out.payouts.reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
    expect(sum).toBe(10000n);
  });

  it("case: NO citizens → held policy keeps money accounted", () => {
    const out = distributeInvoice({
      invoiceAmount: Money.fromMajor("100.00"),
      splits: DEFAULT_SPLITS,
      collectorWeights: [{ collectorUserId: "col1", weightKg: "5.000" }],
      citizenWeights: [],
      policy: { unallocated: "held" }
    });
    const payoutsSum = out.payouts.reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
    const held = out.ledgerLines
      .filter((l) => l.entryType === "unallocated_held")
      .reduce((a, l) => a + l.amount.toMinorUnits(), 0n);
    expect(payoutsSum).toBe(7000n);
    expect(held).toBe(3000n);
    expect(payoutsSum + held).toBe(10000n);
  });

  it("case: three beneficiaries, indivisible amount — deterministic largest remainder", () => {
    const out = distributeInvoice({
      invoiceAmount: Money.fromMajor("100.00"),
      splits: { platform: 10, collectors: 90, citizens: 0 },
      collectorWeights: [
        { collectorUserId: "colA", weightKg: "1.000" },
        { collectorUserId: "colB", weightKg: "1.000" },
        { collectorUserId: "colC", weightKg: "1.000" }
      ],
      citizenWeights: [],
      policy: { unallocated: "to_platform" }
    });
    // 9000 agorot / 3 = exactly 3000 each
    const collectorSum = out.payouts
      .filter((p) => p.beneficiaryType === "collector")
      .reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
    expect(collectorSum).toBe(9000n);
  });

  it("case: zero weights everywhere → everything flows to platform policy lines", () => {
    const out = distributeInvoice({
      invoiceAmount: Money.fromMajor("50.00"),
      splits: DEFAULT_SPLITS,
      collectorWeights: [{ collectorUserId: "col1", weightKg: "0.000" }],
      citizenWeights: [{ citizenUserId: "cit1", weightKg: "0.000" }],
      policy: { unallocated: "to_platform" }
    });
    const platformTotal = out.payouts
      .filter((p) => p.beneficiaryType === "platform")
      .reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
    expect(platformTotal).toBe(5000n);
  });

  it("case: bigger weight never earns less than smaller weight (monotonicity)", () => {
    const out = distributeInvoice({
      invoiceAmount: Money.fromMajor("1000.00"),
      splits: { platform: 10, collectors: 90, citizens: 0 },
      collectorWeights: [
        { collectorUserId: "colBig", weightKg: "300.000" },
        { collectorUserId: "colSmall", weightKg: "1.000" }
      ],
      citizenWeights: [],
      policy: { unallocated: "to_platform" }
    });
    const big = out.payouts.find((p) => p.beneficiaryUserId === "colBig")!;
    const small = out.payouts.find((p) => p.beneficiaryUserId === "colSmall")!;
    expect(big.amount.toMinorUnits()).toBeGreaterThan(small.amount.toMinorUnits());
  });

  it("output is deterministic (same input → identical output)", () => {
    const input = {
      invoiceAmount: Money.fromMajor("333.33"),
      splits: DEFAULT_SPLITS,
      collectorWeights: [
        { collectorUserId: "c1", weightKg: "2.500" },
        { collectorUserId: "c2", weightKg: "7.500" }
      ],
      citizenWeights: [{ citizenUserId: "z1", weightKg: "10.000" }],
      policy: { unallocated: "to_platform" as const }
    };
    const a = distributeInvoice(input);
    const b = distributeInvoice(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("largest remainder — direct unit tests", () => {
  it("conserves total exactly for indivisible cases", () => {
    // 100 minor units over 3 equal beneficiaries
    const alloc = largestRemainder(100n, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 1 }
    ]);
    const sum = [...alloc.values()].reduce((a, v) => a + v, 0n);
    expect(sum).toBe(100n);
    expect(alloc.get("a")).toBe(34n); // tie broken by key order
    expect(alloc.get("b")).toBe(33n);
    expect(alloc.get("c")).toBe(33n);
  });

  it("ties broken deterministically by ascending key", () => {
    const alloc1 = largestRemainder(10n, [
      { key: "z", weight: 1 },
      { key: "a", weight: 1 }
    ]);
    const alloc2 = largestRemainder(10n, [
      { key: "a", weight: 1 },
      { key: "z", weight: 1 }
    ]);
    expect(alloc1.get("a")).toBe(alloc2.get("a"));
    expect(alloc1.get("z")).toBe(alloc2.get("z"));
    expect([...alloc1.values()].reduce((x, y) => x + y, 0n)).toBe(10n);
  });
});

/** PROPERTY (§6.4): money conservation + non-negativity + determinism. */
describe("distribution properties", () => {
  const amountArb = fc.integer({ min: 1, max: 10_000_000 }).map((n) => Money.fromMinor(BigInt(n)));
  const weightsArb = fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 0, maxLength: 8 });

  it("Σ payouts (+held) == invoice amount, always; no negative shares; deterministic", () => {
    fc.assert(
      fc.property(amountArb, weightsArb, weightsArb, (amount, colW, citW) => {
        const input = {
          invoiceAmount: amount,
          splits: DEFAULT_SPLITS,
          collectorWeights: colW.map((w, i) => ({
            collectorUserId: `c${i}`,
            weightKg: (w / 1000).toFixed(3)
          })),
          citizenWeights: citW.map((w, i) => ({
            citizenUserId: `z${i}`,
            weightKg: (w / 1000).toFixed(3)
          })),
          policy: { unallocated: "to_platform" as const }
        };
        const out = distributeInvoice(input);
        const payoutsSum = out.payouts.reduce((a, p) => a + p.amount.toMinorUnits(), 0n);
        const held = out.ledgerLines
          .filter((l) => l.entryType === "unallocated_held")
          .reduce((a, l) => a + l.amount.toMinorUnits(), 0n);
        expect(payoutsSum + held).toBe(amount.toMinorUnits());
        for (const p of out.payouts) {
          expect(p.amount.toMinorUnits()).toBeGreaterThanOrEqual(0n);
        }
        const again = distributeInvoice(input);
        expect(JSON.stringify(again)).toBe(JSON.stringify(out));
      }),
      { numRuns: 500 }
    );
  });
});
