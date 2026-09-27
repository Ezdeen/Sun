/**
 * BAG LIFECYCLE ENGINE — explicit state machine for a single physical bag,
 * mirroring the request lifecycle's design (§6.2). The transition table is
 * DATA, not scattered if-conditions, so the sorting pipeline can be reasoned
 * about and tested exactly like the request state machine.
 *
 *   pending_collection → collected → arrived → weighed → attached
 *
 * - `collected`: the collector physically picked up the bag (set in bulk
 *   when the request transitions to `collected`, see transition-request.ts).
 * - `arrived`: the bag was scanned in at the sorting facility — the
 *   arrival check-in the sorter performs before anything else happens to
 *   the bag. This is what makes "matching arriving bags" itself a tracked
 *   event, independent of later weighing/placement decisions.
 * - `weighed`: the sorter confirmed the waste type and recorded the final
 *   weight from the scale (locked-in reading, §5.11 recipe).
 * - `attached`: the bag was placed into its destination shipment/batch —
 *   now the terminal state, reachable only from `weighed` (a bag must be
 *   weighed before it can be sorted into a batch — see ASSUMPTIONS A-011).
 *
 * No jumping, no going back — same invariant as the request lifecycle.
 */
export const BAG_STATUSES = ["pending_collection", "collected", "arrived", "weighed", "attached"] as const;

export type BagStatus = (typeof BAG_STATUSES)[number];

export interface BagTransitionSpec {
  /** Single legal successor — no jumping, no going back. */
  to: BagStatus | null;
  /** Human-readable guard description, surfaced in error hints. */
  requires: string;
}

export const BAG_TRANSITIONS: Readonly<Record<BagStatus, BagTransitionSpec>> = {
  pending_collection: { to: "collected", requires: "collector must confirm citizen barcode match" },
  collected: { to: "arrived", requires: "sorter must scan the bag QR at the sorting facility" },
  arrived: { to: "weighed", requires: "sorter must confirm waste type and record a locked-in weight" },
  weighed: { to: "attached", requires: "sorter must place the bag into an open shipment/batch" },
  attached: { to: null, requires: "terminal — bag is placed, only a new invoice can move its shipment" }
};

export type BagTransitionFailureCode = "invalid_bag_transition";

export interface BagTransitionDecision {
  ok: boolean;
  next?: BagStatus;
  code?: BagTransitionFailureCode;
  requires?: string;
}

/** Evaluate whether `current → target` is a legal single step. */
export function evaluateBagTransition(current: BagStatus, target: BagStatus): BagTransitionDecision {
  const spec = BAG_TRANSITIONS[current];
  if (spec.to === null || spec.to !== target) {
    return { ok: false, code: "invalid_bag_transition", requires: spec.requires };
  }
  return { ok: true, next: spec.to };
}

/** Guard description for the step *out of* `current` — used in error hints. */
export function bagGuardFor(current: BagStatus): BagTransitionSpec {
  return BAG_TRANSITIONS[current];
}

/** A bag is fully processed for sorting purposes once it is `attached`
 *  (implies weighed AND bound — §6.2 "sorted requires all bags weighed and bound"). */
export function isBagFullyProcessed(status: BagStatus): boolean {
  return status === "attached";
}

export const BAG_STATUS_LABELS_AR: Record<BagStatus, string> = {
  pending_collection: "بانتظار الجمع",
  collected: "تم الجمع (بالطريق للفرز)",
  arrived: "وصل للفرز (بانتظار الوزن)",
  weighed: "موزون (بانتظار وضعه بالصفقة)",
  attached: "مربوط بصفقة"
};
