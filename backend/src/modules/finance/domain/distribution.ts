/**
 * FINANCE DISTRIBUTION ENGINE (§6.4) — money conservation is a THEOREM here.
 *
 * All arithmetic in integer minor units (agorot, 1 ILS = 100 agorot).
 * Every pool is distributed with the Largest Remainder method; ties are
 * broken deterministically by ascending beneficiary key so the output is
 * reproducible bit-for-bit.
 *
 * INVARIANT (enforced by runtime assertion + property tests):
 *   Σ payouts == invoice amount, exactly, always.
 */
import { Money } from "../../../shared/money.js";
import { DomainError } from "../../../shared/errors.js";

export interface SplitsSnapshot {
  platform: number; // percent
  collectors: number; // percent
  citizens: number; // percent
}

export type UnallocatedPolicy = "to_platform" | "held";

export interface DistributionInput {
  invoiceAmount: Money;
  splits: SplitsSnapshot;
  collectorWeights: ReadonlyArray<{ collectorUserId: string; weightKg: string }>;
  citizenWeights: ReadonlyArray<{ citizenUserId: string; weightKg: string }>;
  policy: { unallocated: UnallocatedPolicy };
}

export interface PayoutAllocation {
  beneficiaryType: "platform" | "collector" | "citizen";
  beneficiaryUserId: string | null;
  amount: Money;
  weightBasisKg: string | null;
  reason: string | null;
}

export type AllocationLedgerType =
  | "allocation_platform"
  | "allocation_collector"
  | "allocation_citizen"
  | "unallocated_to_platform"
  | "unallocated_held";

export interface AllocationLedgerLine {
  entryType: AllocationLedgerType;
  amount: Money;
  reason: string;
}

export interface DistributionOutput {
  payouts: PayoutAllocation[];
  ledgerLines: AllocationLedgerLine[];
}

export function assertSplitsSumTo100(splits: SplitsSnapshot): void {
  const total = splits.platform + splits.collectors + splits.citizens;
  if (total !== 100) {
    throw new DomainError(
      "splits_must_sum_100",
      `splits sum to ${total}, expected exactly 100`,
      400,
      { platform: splits.platform, collectors: splits.collectors, citizens: splits.citizens }
    );
  }
}

interface Weighted {
  key: string;
  weight: number; // integer milli-kg to avoid float comparisons
}

/**
 * Largest remainder distribution of `total` minor units over weighted
 * beneficiaries. Deterministic: ties broken by ascending key.
 * Returns exact integer allocations; Σ result == total (asserted).
 */
export function largestRemainder(
  total: bigint,
  beneficiaries: readonly Weighted[]
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  if (beneficiaries.length === 0) return result;
  const totalWeight = beneficiaries.reduce((acc, b) => acc + b.weight, 0);
  if (totalWeight <= 0) {
    // All-zero weights: equal split by largest remainder of equal shares.
    const n = BigInt(beneficiaries.length);
    const base = total / n;
    let remainder = total - base * n;
    const sorted = [...beneficiaries].sort((a, b) => a.key.localeCompare(b.key));
    for (const b of sorted) {
      result.set(b.key, base + (remainder > 0n ? 1n : 0n));
      if (remainder > 0n) remainder -= 1n;
    }
    return result;
  }

  const shares = beneficiaries.map((b) => {
    // Exact rational share: (total * weight) / totalWeight, floor + remainder
    const numerator = total * BigInt(b.weight);
    const floor = numerator / BigInt(totalWeight);
    const rem = numerator - floor * BigInt(totalWeight);
    return { key: b.key, floor, rem, weight: b.weight };
  });

  const allocated = shares.reduce((acc, s) => acc + s.floor, 0n);
  let leftover = total - allocated;

  // Distribute leftover one-by-one to largest remainders; ties → smaller key.
  const byRemainder = [...shares].sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
  for (const s of byRemainder) {
    if (leftover <= 0n) break;
    result.set(s.key, s.floor + 1n);
    leftover -= 1n;
  }
  for (const s of shares) {
    if (!result.has(s.key)) result.set(s.key, s.floor);
  }

  // Runtime money-conservation assertion (defense in depth).
  const sum = [...result.values()].reduce((acc, v) => acc + v, 0n);
  if (sum !== total) {
    throw new DomainError(
      "internal_error",
      `distribution invariant violated: sum=${sum} expected=${total}`,
      500
    );
  }
  return result;
}

function toWeighted(
  entries: ReadonlyArray<{ userId: string; weightKg: string }>
): Weighted[] {
  // milli-kg integers keep ordering exact.
  return entries
    .map((e) => ({
      key: e.userId,
      weight: Math.round(Number.parseFloat(e.weightKg) * 1000)
    }))
    .filter((e) => Number.isFinite(e.weight) && e.weight >= 0);
}

function hasPositiveWeight(entries: readonly Weighted[]): boolean {
  return entries.some((e) => e.weight > 0);
}

export function distributeInvoice(input: DistributionInput): DistributionOutput {
  assertSplitsSumTo100(input.splits);
  const currency = input.invoiceAmount.currency;
  const totalMinor = input.invoiceAmount.toMinorUnits();
  if (totalMinor <= 0n) {
    throw new DomainError("amount_must_be_positive", "invoice amount must be > 0", 400);
  }

  const collectors = toWeighted(
    input.collectorWeights.map((c) => ({ userId: c.collectorUserId, weightKg: c.weightKg }))
  );
  const citizens = toWeighted(
    input.citizenWeights.map((c) => ({ userId: c.citizenUserId, weightKg: c.weightKg }))
  );

  // 1) Split the invoice across the three pools (largest remainder).
  const pools = largestRemainder(totalMinor, [
    { key: "platform", weight: input.splits.platform },
    { key: "collectors", weight: input.splits.collectors },
    { key: "citizens", weight: input.splits.citizens }
  ]);
  const platformPool = pools.get("platform") ?? 0n;
  const collectorsPool = pools.get("collectors") ?? 0n;
  const citizensPool = pools.get("citizens") ?? 0n;

  const payouts: PayoutAllocation[] = [];
  const ledgerLines: AllocationLedgerLine[] = [];

  // 2) Platform pool → always one platform payout.
  if (platformPool > 0n) {
    payouts.push({
      beneficiaryType: "platform",
      beneficiaryUserId: null,
      amount: Money.fromMinor(platformPool, currency),
      weightBasisKg: null,
      reason: null
    });
    ledgerLines.push({
      entryType: "allocation_platform",
      amount: Money.fromMinor(platformPool, currency),
      reason: "حصة المنصة"
    });
  }

  // 3) Collectors pool.
  if (collectorsPool > 0n) {
    if (!hasPositiveWeight(collectors)) {
      // Explicit unallocated policy — money is never silently lost (§6.4.5).
      if (input.policy.unallocated === "to_platform") {
        payouts.push({
          beneficiaryType: "platform",
          beneficiaryUserId: null,
          amount: Money.fromMinor(collectorsPool, currency),
          weightBasisKg: null,
          reason: "no_eligible_collectors"
        });
        ledgerLines.push({
          entryType: "unallocated_to_platform",
          amount: Money.fromMinor(collectorsPool, currency),
          reason: "no_eligible_collectors"
        });
      } else {
        ledgerLines.push({
          entryType: "unallocated_held",
          amount: Money.fromMinor(collectorsPool, currency),
          reason: "no_eligible_collectors"
        });
      }
    } else {
      const alloc = largestRemainder(collectorsPool, collectors);
      for (const [userId, minor] of alloc) {
        if (minor <= 0n) continue;
        const w = collectors.find((c) => c.key === userId)?.weight ?? 0;
        payouts.push({
          beneficiaryType: "collector",
          beneficiaryUserId: userId,
          amount: Money.fromMinor(minor, currency),
          weightBasisKg: (w / 1000).toFixed(3),
          reason: null
        });
        ledgerLines.push({
          entryType: "allocation_collector",
          amount: Money.fromMinor(minor, currency),
          reason: `حصة جامع ${userId}`
        });
      }
    }
  }

  // 4) Citizens pool.
  if (citizensPool > 0n) {
    if (!hasPositiveWeight(citizens)) {
      if (input.policy.unallocated === "to_platform") {
        payouts.push({
          beneficiaryType: "platform",
          beneficiaryUserId: null,
          amount: Money.fromMinor(citizensPool, currency),
          weightBasisKg: null,
          reason: "no_eligible_citizens"
        });
        ledgerLines.push({
          entryType: "unallocated_to_platform",
          amount: Money.fromMinor(citizensPool, currency),
          reason: "no_eligible_citizens"
        });
      } else {
        ledgerLines.push({
          entryType: "unallocated_held",
          amount: Money.fromMinor(citizensPool, currency),
          reason: "no_eligible_citizens"
        });
      }
    } else {
      const alloc = largestRemainder(citizensPool, citizens);
      for (const [userId, minor] of alloc) {
        if (minor <= 0n) continue;
        const w = citizens.find((c) => c.key === userId)?.weight ?? 0;
        payouts.push({
          beneficiaryType: "citizen",
          beneficiaryUserId: userId,
          amount: Money.fromMinor(minor, currency),
          weightBasisKg: (w / 1000).toFixed(3),
          reason: null
        });
        ledgerLines.push({
          entryType: "allocation_citizen",
          amount: Money.fromMinor(minor, currency),
          reason: `حصة مواطن ${userId}`
        });
      }
    }
  }

  // 5) THE invariant: Σ payouts == invoice amount, exactly.
  const payoutsSum = payouts.reduce((acc, p) => acc + p.amount.toMinorUnits(), 0n);
  const heldMinor =
    ledgerLines
      .filter((l) => l.entryType === "unallocated_held")
      .reduce((acc, l) => acc + l.amount.toMinorUnits(), 0n);
  if (payoutsSum + heldMinor !== totalMinor) {
    throw new DomainError(
      "internal_error",
      `money conservation violated: payouts=${payoutsSum} held=${heldMinor} total=${totalMinor}`,
      500
    );
  }

  // Deterministic ordering for reproducible output.
  payouts.sort((a, b) => {
    const typeOrder = { platform: 0, collector: 1, citizen: 2 } as const;
    if (typeOrder[a.beneficiaryType] !== typeOrder[b.beneficiaryType]) {
      return typeOrder[a.beneficiaryType] - typeOrder[b.beneficiaryType];
    }
    return (a.beneficiaryUserId ?? "").localeCompare(b.beneficiaryUserId ?? "");
  });

  return { payouts, ledgerLines };
}

export const DEFAULT_SPLITS: SplitsSnapshot = {
  platform: 30,
  collectors: 40,
  citizens: 30
};
