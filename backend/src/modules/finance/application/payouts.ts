/**
 * Payout transitions: calculated → approved → paid | calculated/approved → void.
 * Finance & manager only (payout:transition), always audited in the ledger.
 */
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import { DomainError } from "../../../shared/errors.js";
import { uuidv7 } from "../../../shared/ids.js";
import {
  lockPayout,
  updatePayout,
  insertLedgerEntries,
  nextLedgerEntryNumbers
} from "../infrastructure/finance-repo.js";

export type PayoutTarget = "approved" | "paid" | "void";

export async function transitionPayout(
  deps: { db: Db; clock: Clock },
  input: {
    payoutId: string;
    target: PayoutTarget;
    actor: { userId: string; role: "finance" | "manager" };
    reason?: string | null; // mandatory for void
  }
) {
  const { db, clock } = deps;
  const now = clock.now();

  if (input.target === "void" && (!input.reason || input.reason.trim().length < 3)) {
    throw new DomainError("validation_error", "void requires a reason", 400);
  }

  return db.transaction(async (tx) => {
    const payout = await lockPayout(tx, input.payoutId);
    if (!payout) throw new DomainError("not_found", "payout not found", 404);

    const legal =
      (payout.status === "calculated" && (input.target === "approved" || input.target === "void")) ||
      (payout.status === "approved" && (input.target === "paid" || input.target === "void"));
    if (!legal) {
      throw new DomainError(
        "payout_transition_invalid",
        `cannot move payout ${payout.status} → ${input.target}`,
        409,
        { currentStatus: payout.status }
      );
    }

    const patch: Parameters<typeof updatePayout>[2] = {};
    if (input.target === "approved") {
      patch.status = "approved";
      patch.approvedBy = input.actor.userId;
      patch.approvedAt = now;
    } else if (input.target === "paid") {
      patch.status = "paid";
      patch.paidAt = now;
    } else {
      patch.status = "void";
      patch.voidReason = input.reason ?? null;
    }

    const updated = await updatePayout(tx, payout.id, patch);
    if (!updated) throw new DomainError("internal_error", "update failed", 500);

    // Ledger line for the transition (append-only).
    const [entryNumber] = await nextLedgerEntryNumbers(tx, 1);
    await insertLedgerEntries(tx, [
      {
        id: uuidv7(),
        entryNumber: entryNumber!,
        entryType:
          input.target === "approved"
            ? "payout_approved"
            : input.target === "paid"
              ? "payout_paid"
              : "payout_voided",
        invoiceId: payout.invoiceId,
        payoutId: payout.id,
        amount: payout.amount,
        reason:
          input.target === "void"
            ? `إلغاء مستحق: ${input.reason}`
            : `تحديث مستحق (${payout.beneficiaryType})`,
        createdBy: input.actor.userId,
        createdAt: now
      }
    ]);

    return {
      id: updated.id,
      status: updated.status,
      amount: updated.amount,
      beneficiaryType: updated.beneficiaryType,
      approvedAt: updated.approvedAt,
      paidAt: updated.paidAt,
      voidReason: updated.voidReason
    };
  });
}
