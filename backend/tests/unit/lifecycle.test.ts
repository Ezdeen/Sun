import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  evaluateTransition,
  REQUEST_STATUSES,
  TRANSITIONS,
  visibilityFor,
  type RequestStatus,
  type Role
} from "../../src/modules/collection/domain/lifecycle.js";

const ROLES: Role[] = ["citizen", "collector", "authority", "sorter", "finance", "manager"];

describe("lifecycle state machine (§6.2)", () => {
  it("legal path walks all statuses in order", () => {
    let current: RequestStatus = "received";
    const walked: RequestStatus[] = [current];
    for (const next of ["sent_to_collector", "on_the_way", "arrived", "collected", "sorted"]) {
      const d = evaluateTransition({ current, target: next as RequestStatus, role: "manager" });
      expect(d.ok).toBe(true);
      current = next as RequestStatus;
      walked.push(current);
    }
    expect(walked).toEqual(REQUEST_STATUSES.slice(0, 6));
  });

  it("matrix: every (current × role) decision matches the transition table", () => {
    for (const current of REQUEST_STATUSES) {
      const spec = TRANSITIONS[current];
      const next = spec.to;
      for (const role of ROLES) {
        const d = evaluateTransition({ current, target: next ?? "sold", role });
        if (next === null) {
          expect(d.ok).toBe(false); // terminal status — nothing legal anymore
        } else if (spec.systemOnly) {
          expect(d.ok).toBe(false); // sold is system-only for EVERYONE
        } else if (role === "manager") {
          expect(d.ok).toBe(true);
        } else {
          expect(d.ok).toBe(spec.roles.includes(role));
        }
      }
    }
  });

  it("no jumping steps and no going back", () => {
    expect(evaluateTransition({ current: "received", target: "arrived", role: "authority" }).ok).toBe(false);
    expect(evaluateTransition({ current: "on_the_way", target: "received", role: "collector" }).ok).toBe(false);
    expect(evaluateTransition({ current: "sorted", target: "collected", role: "manager" }).ok).toBe(false);
    expect(evaluateTransition({ current: "sold", target: "sold", role: "manager" }).ok).toBe(false);
    expect(evaluateTransition({ current: "received", target: "sold", role: "manager" }).ok).toBe(false);
  });

  it("guards: barcode required at collected; weights at sorted; assignment at on_the_way", () => {
    expect(TRANSITIONS.arrived?.requiresBarcode).toBe(true);
    expect(TRANSITIONS.collected?.requiresWeighedBags).toBe(true);
    expect(TRANSITIONS.sent_to_collector?.assignsCollector).toBe(true);
  });

  it("citizen/finance can never transition", () => {
    for (const current of REQUEST_STATUSES.slice(0, 6)) {
      const next = TRANSITIONS[current]!.to!;
      expect(evaluateTransition({ current, target: next, role: "citizen" }).ok).toBe(false);
      expect(evaluateTransition({ current, target: next, role: "finance" }).ok).toBe(false);
    }
  });

  it("manager acts are flagged as override when a reason is provided", () => {
    const withReason = evaluateTransition({
      current: "received",
      target: "sent_to_collector",
      role: "manager",
      overrideReason: "غياب هيئة محلية"
    });
    expect(withReason.ok && withReason.isOverride).toBe(true);
    const without = evaluateTransition({ current: "received", target: "sent_to_collector", role: "manager" });
    expect(without.ok && !without.isOverride).toBe(true);
  });
});

/** PROPERTY (§6.2): random attempts never reach `sold` except via the legal path. */
describe("lifecycle property: sold is unreachable through the API", () => {
  const statusArb = fc.constantFrom(...REQUEST_STATUSES) as fc.Arbitrary<RequestStatus>;
  const roleArb = fc.constantFrom(...ROLES);

  it("no random (current, target, role) combination yields `sold`", () => {
    fc.assert(
      fc.property(statusArb, statusArb, roleArb, (current, target, role) => {
        const d = evaluateTransition({ current, target, role });
        if (d.ok) {
          expect(d.next).not.toBe("sold");
        }
      }),
      { numRuns: 500 }
    );
  });

  it("random role sequences on a real request never pass through an illegal step", () => {
    fc.assert(
      fc.property(
        fc.array(roleArb, { minLength: 0, maxLength: 20 }),
        fc.array(statusArb, { minLength: 0, maxLength: 20 }),
        (roles, targets) => {
          let current: RequestStatus = "received";
          for (let i = 0; i < roles.length; i++) {
            const d = evaluateTransition({
              current,
              target: targets[i] ?? "sold",
              role: roles[i]!
            });
            if (d.ok) current = d.next;
          }
          // sold unreachable because it is system-only
          expect(current).not.toBe("sold");
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe("visibility policy", () => {
  it("citizen sees own only; collector area+assigned; authority area; others all", () => {
    expect(visibilityFor({ role: "citizen", userId: "u1" })).toEqual({ kind: "own", citizenUserId: "u1" });
    expect(visibilityFor({ role: "collector", userId: "c1", serviceAreaId: "a1" })).toEqual({
      kind: "collector",
      collectorUserId: "c1",
      serviceAreaId: "a1"
    });
    expect(visibilityFor({ role: "authority", userId: "x", serviceAreaId: "a2" })).toEqual({
      kind: "area",
      serviceAreaId: "a2"
    });
    for (const role of ["sorter", "finance", "manager"] as const) {
      expect(visibilityFor({ role, userId: "y" })).toEqual({ kind: "all" });
    }
  });
});
