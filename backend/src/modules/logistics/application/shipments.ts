/**
 * Logistics use cases — create shipment, register bag arrival, weigh bag,
 * attach bag (explicit!). All are single-transaction with row locks and
 * chain events.
 *
 * Sorting pipeline (§5.11 / ASSUMPTIONS A-011), in order:
 *   1) registerBagArrival — scan the bag QR at the sorting facility,
 *      matching it against an expected (collected) bag. This is the
 *      "أكياس واصلة" check-in, tracked independently of any shipment.
 *   2) weighBag — confirm the waste type and record a locked-in weight
 *      from the scale.
 *   3) attachBag — place the now-weighed bag into its destination
 *      shipment/batch.
 */
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import { DomainError } from "../../../shared/errors.js";
import { createHash } from "node:crypto";
import { uuidv7 } from "../../../shared/ids.js";
import { evaluateBagTransition, bagGuardFor, type BagStatus } from "../domain/bag-lifecycle.js";
import {
  lockShipment,
  lockBagByCode,
  nextShipmentNumber,
  insertShipment,
  attachBagToShipment,
  recordBagArrival,
  recordBagWeight,
  getBagByCode
} from "../infrastructure/shipments-repo.js";
import { appendEvent } from "../../traceability/infrastructure/chain-repo.js";

const ACTOR_PREFIX = { sorter: "SRT", manager: "MGR", finance: "FIN" } as const;

function actorRefFor(role: "sorter" | "manager" | "finance", userId: string): string {
  const sha = createHash("sha256").update(userId, "utf8").digest("hex");
  return `${ACTOR_PREFIX[role]}-${sha.slice(0, 48)}`;
}

export async function createShipment(
  deps: { db: Db; clock: Clock },
  input: { createdBy: string; role: "sorter" | "manager"; buyerName?: string | null; notes?: string | null }
) {
  const { db, clock } = deps;
  const now = clock.now();
  const id = uuidv7();

  return db.transaction(async (tx) => {
    const number = await nextShipmentNumber(tx);
    const row = await insertShipment(tx, {
      id,
      shipmentNumber: number,
      status: "open",
      createdBy: input.createdBy,
      buyerName: input.buyerName ?? null,
      notes: input.notes ?? null,
      openedAt: now
    });
    await appendEvent(tx, {
      aggregateType: "shipment",
      aggregateId: id,
      statusCode: "open",
      actorRole: input.role,
      actorRef: actorRefFor(input.role, input.createdBy),
      payload: { shipment_number: number },
      occurredAt: now
    });
    return { id: row.id, shipmentNumber: row.shipmentNumber, status: row.status, openedAt: row.openedAt };
  });
}

/** Step 1 — arrival check-in at the sorting facility (§5.11). Reads the bag
 *  QR and matches it against an expected (already-collected) bag; this is
 *  what turns "أكياس واصلة" into a tracked, auditable event on its own,
 *  independent from weighing or shipment placement. */
export async function registerBagArrival(
  deps: { db: Db; clock: Clock },
  input: { bagCode: string; actor: { userId: string; role: "sorter" | "manager" } }
) {
  const { db, clock } = deps;
  const now = clock.now();

  return db.transaction(async (tx) => {
    const bag = await lockBagByCode(tx, input.bagCode);
    if (!bag) throw new DomainError("not_found", "bag not found", 404);

    const decision = evaluateBagTransition(bag.status as BagStatus, "arrived");
    if (!decision.ok) {
      throw new DomainError(
        "bag_state_invalid",
        bag.status === "arrived"
          ? "bag already checked in as arrived"
          : `bag is ${bag.status}; ${bagGuardFor(bag.status as BagStatus).requires}`,
        409,
        { bagStatus: bag.status }
      );
    }

    await recordBagArrival(tx, { bagId: bag.id, arrivedBy: input.actor.userId });
    await appendEvent(tx, {
      aggregateType: "bag",
      aggregateId: bag.id,
      statusCode: "arrived",
      actorRole: input.actor.role,
      actorRef: actorRefFor(input.actor.role, input.actor.userId),
      payload: { request_id: bag.requestId, waste_type_code: bag.wasteTypeCode },
      occurredAt: now
    });
    return {
      bagId: bag.id,
      bagCode: bag.bagCode,
      requestId: bag.requestId,
      wasteTypeCode: bag.wasteTypeCode,
      status: "arrived"
    };
  });
}

/**
 * Step 2 — weigh a bag. Verify FIRST, then mutate (§5.11):
 *   1. bag must already be checked in (`arrived`) — cannot weigh a bag
 *      that hasn't been scanned in at sorting, and cannot re-weigh one
 *      already weighed.
 *   2. the sorter confirms the waste type against what the scale/eye
 *      observes; a mismatch is recorded for traceability/audit only —
 *      it never re-prices the citizen's original estimate.
 *   3. the weight itself is the value the caller has already locked in
 *      client-side (UI requires an explicit "confirm" tap after the
 *      scale reading appears, before this call is ever made).
 */
export async function weighBag(
  deps: { db: Db; clock: Clock },
  input: {
    bagCode: string;
    finalWeightKg: string;
    /** Waste type as physically confirmed by the sorter. Defaults to the
     *  bag's declared type (simple confirmation, no mismatch). */
    observedWasteTypeCode?: string | null;
    mismatchNote?: string | null;
    actor: { userId: string; role: "sorter" | "manager" };
  }
) {
  const { db, clock } = deps;
  const now = clock.now();
  const weight = Number.parseFloat(input.finalWeightKg);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 10_000) {
    throw new DomainError("validation_error", "final weight must be in (0, 10000] kg", 400);
  }

  return db.transaction(async (tx) => {
    const bag = await lockBagByCode(tx, input.bagCode);
    if (!bag) throw new DomainError("not_found", "bag not found", 404);

    const decision = evaluateBagTransition(bag.status as BagStatus, "weighed");
    if (!decision.ok) {
      throw new DomainError(
        "bag_state_invalid",
        bag.status === "weighed"
          ? "bag already weighed"
          : `bag is ${bag.status}; ${bagGuardFor(bag.status as BagStatus).requires}`,
        409,
        { bagStatus: bag.status }
      );
    }

    const observedWasteTypeCode = input.observedWasteTypeCode?.trim() || bag.wasteTypeCode;
    const wasteTypeMismatch = observedWasteTypeCode !== bag.wasteTypeCode;

    await recordBagWeight(tx, {
      bagId: bag.id,
      finalWeightKg: weight.toFixed(3),
      weighedBy: input.actor.userId,
      observedWasteTypeCode,
      wasteTypeMismatch,
      mismatchNote: wasteTypeMismatch ? (input.mismatchNote?.trim() || null) : null
    });
    await appendEvent(tx, {
      aggregateType: "bag",
      aggregateId: bag.id,
      statusCode: "weighed",
      actorRole: input.actor.role,
      actorRef: actorRefFor(input.actor.role, input.actor.userId),
      payload: {
        final_weight_kg: weight.toFixed(3),
        declared_waste_type_code: bag.wasteTypeCode,
        observed_waste_type_code: observedWasteTypeCode,
        waste_type_mismatch: wasteTypeMismatch,
        ...(wasteTypeMismatch && input.mismatchNote ? { mismatch_note: input.mismatchNote.trim() } : {})
      },
      occurredAt: now
    });
    return {
      bagId: bag.id,
      bagCode: bag.bagCode,
      finalWeightKg: weight.toFixed(3),
      observedWasteTypeCode,
      wasteTypeMismatch,
      status: "weighed"
    };
  });
}

/** Step 3 — explicit bag→shipment binding. NO implicit "last open shipment"
 *  magic (§5.11). Only a weighed bag may be placed into its batch. */
export async function attachBag(
  deps: { db: Db; clock: Clock },
  input: { shipmentId: string; bagCode: string; actor: { userId: string; role: "sorter" | "manager" } }
) {
  const { db, clock } = deps;
  const now = clock.now();

  return db.transaction(async (tx) => {
    const shipment = await lockShipment(tx, input.shipmentId);
    if (!shipment) throw new DomainError("not_found", "shipment not found", 404);
    if (shipment.status !== "open") {
      throw new DomainError("bag_state_invalid", `shipment is ${shipment.status}, must be open`, 409);
    }

    const bag = await lockBagByCode(tx, input.bagCode);
    if (!bag) throw new DomainError("not_found", "bag not found", 404);

    const decision = evaluateBagTransition(bag.status as BagStatus, "attached");
    if (!decision.ok) {
      throw new DomainError(
        "bag_state_invalid",
        bag.status === "attached"
          ? "bag already attached to a shipment"
          : `bag is ${bag.status}; ${bagGuardFor(bag.status as BagStatus).requires}`,
        409,
        { bagStatus: bag.status }
      );
    }
    if (bag.shipmentId) {
      throw new DomainError("bag_state_invalid", "bag already attached to a shipment", 409);
    }

    await attachBagToShipment(tx, { bagId: bag.id, shipmentId: shipment.id });
    await appendEvent(tx, {
      aggregateType: "bag",
      aggregateId: bag.id,
      statusCode: "attached",
      actorRole: input.actor.role,
      actorRef: actorRefFor(input.actor.role, input.actor.userId),
      payload: { shipment_id: shipment.id, shipment_number: shipment.shipmentNumber },
      occurredAt: now
    });
    return { bagId: bag.id, bagCode: bag.bagCode, shipmentId: shipment.id, status: "attached" };
  });
}

export async function findBag(db: Db, code: string) {
  const bag = await getBagByCode(db, code);
  if (!bag) throw new DomainError("not_found", "bag not found", 404);
  return bag;
}
