/**
 * Logistics use cases — create shipment, attach bag (explicit!), weigh bag.
 * All are single-transaction with row locks and chain events.
 */
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import { DomainError } from "../../../shared/errors.js";
import { createHash } from "node:crypto";
import { uuidv7 } from "../../../shared/ids.js";
import {
  lockShipment,
  lockBagByCode,
  nextShipmentNumber,
  insertShipment,
  attachBagToShipment,
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

/** Explicit bag→shipment binding. NO implicit "last open shipment" magic (§5.11). */
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
    if (bag.status !== "collected") {
      throw new DomainError(
        "bag_state_invalid",
        `bag is ${bag.status}, must be collected`,
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

/** Weigh a bag — verify FIRST, then mutate (§5.11). */
export async function weighBag(
  deps: { db: Db; clock: Clock },
  input: {
    bagCode: string;
    finalWeightKg: string;
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
    if (bag.status === "pending_collection" || bag.status === "collected") {
      throw new DomainError(
        "bag_state_invalid",
        "bag must be attached to a shipment before weighing",
        409,
        { bagStatus: bag.status }
      );
    }
    if (bag.status === "weighed") {
      throw new DomainError("bag_state_invalid", "bag already weighed", 409);
    }
    if (!bag.shipmentId) {
      throw new DomainError("bag_state_invalid", "bag has no shipment", 409);
    }

    await recordBagWeight(tx, {
      bagId: bag.id,
      finalWeightKg: weight.toFixed(3),
      weighedBy: input.actor.userId
    });
    await appendEvent(tx, {
      aggregateType: "bag",
      aggregateId: bag.id,
      statusCode: "weighed",
      actorRole: input.actor.role,
      actorRef: actorRefFor(input.actor.role, input.actor.userId),
      payload: { final_weight_kg: weight.toFixed(3), shipment_id: bag.shipmentId },
      occurredAt: now
    });
    return {
      bagId: bag.id,
      bagCode: bag.bagCode,
      finalWeightKg: weight.toFixed(3),
      status: "weighed"
    };
  });
}

export async function findBag(db: Db, code: string) {
  const bag = await getBagByCode(db, code);
  if (!bag) throw new DomainError("not_found", "bag not found", 404);
  return bag;
}
