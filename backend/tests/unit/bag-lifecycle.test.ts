import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BAG_STATUSES,
  BAG_TRANSITIONS,
  evaluateBagTransition,
  isBagFullyProcessed,
  type BagStatus
} from "../../src/modules/logistics/domain/bag-lifecycle.js";

describe("bag lifecycle state machine", () => {
  it("legal path walks all statuses in order", () => {
    let current: BagStatus = "pending_collection";
    const walked: BagStatus[] = [current];
    for (const next of ["collected", "arrived", "weighed", "attached"] as const) {
      const d = evaluateBagTransition(current, next);
      expect(d.ok).toBe(true);
      current = next;
      walked.push(current);
    }
    expect(walked).toEqual(BAG_STATUSES);
  });

  it("no jumping steps and no going back", () => {
    expect(evaluateBagTransition("pending_collection", "arrived").ok).toBe(false);
    expect(evaluateBagTransition("collected", "weighed").ok).toBe(false);
    expect(evaluateBagTransition("weighed", "collected").ok).toBe(false);
    expect(evaluateBagTransition("attached", "attached").ok).toBe(false);
  });

  it("arrival must happen before weighing (cannot weigh a bag that hasn't arrived)", () => {
    expect(evaluateBagTransition("collected", "weighed").ok).toBe(false);
    expect(evaluateBagTransition("arrived", "weighed").ok).toBe(true);
  });

  it("a bag must be weighed before it can be placed in a shipment", () => {
    expect(evaluateBagTransition("arrived", "attached").ok).toBe(false);
    expect(evaluateBagTransition("weighed", "attached").ok).toBe(true);
  });

  it("attached is terminal", () => {
    expect(BAG_TRANSITIONS.attached.to).toBeNull();
    for (const target of BAG_STATUSES) {
      expect(evaluateBagTransition("attached", target).ok).toBe(false);
    }
  });

  it("isBagFullyProcessed is true only for attached (weighed AND bound, §6.2)", () => {
    for (const status of BAG_STATUSES) {
      expect(isBagFullyProcessed(status)).toBe(status === "attached");
    }
  });

  it("failed transitions carry a human-readable guard hint", () => {
    const d = evaluateBagTransition("collected", "weighed");
    expect(d.ok).toBe(false);
    expect(typeof d.requires).toBe("string");
    expect((d.requires ?? "").length).toBeGreaterThan(0);
  });
});

/** PROPERTY: random (current, target) pairs never skip a step or go backwards. */
describe("bag lifecycle property: only the single documented next step is ever legal", () => {
  const statusArb = fc.constantFrom(...BAG_STATUSES) as fc.Arbitrary<BagStatus>;

  it("evaluateBagTransition never approves anything but BAG_TRANSITIONS[current].to", () => {
    fc.assert(
      fc.property(statusArb, statusArb, (current, target) => {
        const d = evaluateBagTransition(current, target);
        const legalNext = BAG_TRANSITIONS[current].to;
        if (legalNext === null) {
          expect(d.ok).toBe(false);
        } else {
          expect(d.ok).toBe(target === legalNext);
        }
      }),
      { numRuns: 200 }
    );
  });
});
