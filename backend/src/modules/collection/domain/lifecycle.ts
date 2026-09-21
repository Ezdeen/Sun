/**
 * REQUEST LIFECYCLE ENGINE (§6.2) — explicit state machine.
 * The transition table is DATA, not scattered if-conditions.
 */
export type Role = "citizen" | "collector" | "authority" | "sorter" | "finance" | "manager";

export const REQUEST_STATUSES = [
  "received",
  "sent_to_collector",
  "on_the_way",
  "arrived",
  "collected",
  "sorted",
  "sold"
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface TransitionSpec {
  /** Single legal successor — no jumping, no going back. */
  to: RequestStatus | null;
  /** Natural operator roles (from the old system's rules, §6.2 table). */
  roles: Role[];
  /** Transition produced only by the system (invoice creation). */
  systemOnly?: boolean;
  /** Collector assignment happens here. */
  assignsCollector?: boolean;
  /** Barcode match against citizen QR is mandatory here. */
  requiresBarcode?: boolean;
  /** All request bags must be weighed & attached to a shipment here. */
  requiresWeighedBags?: boolean;
}

export const TRANSITIONS: Readonly<Record<RequestStatus, TransitionSpec>> = {
  received: { to: "sent_to_collector", roles: ["authority", "manager"] },
  sent_to_collector: { to: "on_the_way", roles: ["collector", "manager"], assignsCollector: true },
  on_the_way: { to: "arrived", roles: ["collector", "manager"] },
  arrived: { to: "collected", roles: ["collector", "manager"], requiresBarcode: true },
  collected: { to: "sorted", roles: ["sorter", "manager"], requiresWeighedBags: true },
  sorted: { to: "sold", roles: [], systemOnly: true },
  sold: { to: null, roles: [] }
};

export type TransitionFailureCode =
  | "invalid_transition"
  | "role_not_allowed"
  | "override_reason_required"
  | "system_only_transition";

export interface TransitionInput {
  current: RequestStatus;
  target: RequestStatus;
  role: Role;
  /** Manager override audit reason (mandatory for manager actions outside
   *  natural scope; always recorded as an override event when present). */
  overrideReason?: string | null;
}

export type TransitionDecision =
  | { ok: true; next: RequestStatus; isOverride: boolean }
  | { ok: false; code: TransitionFailureCode };

export function evaluateTransition(input: TransitionInput): TransitionDecision {
  const spec = TRANSITIONS[input.current];
  const next = spec?.to ?? null;

  if (next === null || input.target !== next) {
    return { ok: false, code: "invalid_transition" };
  }

  if (spec.systemOnly) {
    return { ok: false, code: "system_only_transition" };
  }

  if (input.role === "manager") {
    // Manager may operate every human transition; a provided reason is
    // always recorded as an audited override event (never bypasses money
    // guards or barcode matching — see use case guards).
    return { ok: true, next, isOverride: Boolean(input.overrideReason) };
  }

  if (!spec.roles.includes(input.role)) {
    return { ok: false, code: "role_not_allowed" };
  }

  return { ok: true, next, isOverride: false };
}

/** Guards required by a given transition (checked by the use case). */
export function guardsFor(current: RequestStatus): TransitionSpec {
  return TRANSITIONS[current];
}

// ── Visibility policy (§6.2) ─────────────────────────────────────────────
export interface ActorContext {
  role: Role;
  userId: string;
  /** Collector/authority service area (null for platform-wide roles). */
  serviceAreaId?: string | null;
}

export type VisibilityFilter =
  | { kind: "own"; citizenUserId: string }
  | { kind: "collector"; collectorUserId: string; serviceAreaId: string | null }
  | { kind: "area"; serviceAreaId: string }
  | { kind: "all" };

export function visibilityFor(actor: ActorContext): VisibilityFilter {
  switch (actor.role) {
    case "citizen":
      return { kind: "own", citizenUserId: actor.userId };
    case "collector":
      return {
        kind: "collector",
        collectorUserId: actor.userId,
        serviceAreaId: actor.serviceAreaId ?? null
      };
    case "authority":
      return { kind: "area", serviceAreaId: actor.serviceAreaId ?? "" };
    case "sorter":
    case "finance":
    case "manager":
      return { kind: "all" };
  }
}

export const STATUS_LABELS_AR: Record<RequestStatus, string> = {
  received: "مستلم",
  sent_to_collector: "مُرسل للجامع",
  on_the_way: "في الطريق",
  arrived: "وصل الجامع",
  collected: "تم الجمع",
  sorted: "تم الفرز",
  sold: "تم البيع"
};
