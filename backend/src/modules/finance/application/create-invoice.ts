/**
 * CREATE INVOICE — the money-critical use case (§6.4.7).
 *
 * ONE atomic transaction:
 *   idempotency check → lock shipment → all-weights guard →
 *   distribution engine → invoice + payouts + ledger →
 *   shipment sold + chain events + requests sold → outbox anchor event.
 *
 * Duplicate invoices are impossible: row lock + partial UNIQUE
 * (shipment_id WHERE status='active') + Idempotency-Key replay handling.
 */
import { createHash } from "node:crypto";
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import { DomainError } from "../../../shared/errors.js";
import { Money } from "../../../shared/money.js";
import { uuidv7 } from "../../../shared/ids.js";
import { Decimal } from "decimal.js";
import { readSplits, readUnallocatedPolicy } from "../../administration/application/settings.js";
import { distributeInvoice, assertSplitsSumTo100 } from "../domain/distribution.js";
import { appendEvent } from "../../traceability/infrastructure/chain-repo.js";
import {
  nextInvoiceNumber,
  nextLedgerEntryNumbers,
  insertInvoice,
  insertPayouts,
  insertLedgerEntries,
  findIdempotencyKey,
  insertIdempotencyKey,
  insertOutboxEvent,
  distributionWeights
} from "../infrastructure/finance-repo.js";
import { lockShipment, markShipmentSold, bagsOfShipment, requestIdsOfShipmentBags, countBagsPerRequest } from "../../logistics/infrastructure/shipments-repo.js";
import { markRequestsSold } from "../../collection/infrastructure/requests-repo.js";

export interface CreateInvoiceInput {
  shipmentId: string;
  amount: string; // major units, e.g. "1250.00"
  buyerName?: string | null;
  createdBy: string;
  /** Raw Idempotency-Key header (hashed before storage). */
  idempotencyKey?: string | null;
}

function actorRefSystem(): string {
  return "SYS-" + createHash("sha256").update("system").digest("hex").slice(0, 48);
}

export async function createInvoice(deps: { db: Db; clock: Clock }, input: CreateInvoiceInput) {
  const { db, clock } = deps;
  const now = clock.now();

  const amount = Money.fromMajor(input.amount);
  if (!amount.isPositive()) {
    throw new DomainError("amount_must_be_positive", "invoice amount must be > 0", 400);
  }

  const keyHash = input.idempotencyKey
    ? createHash("sha256").update(input.idempotencyKey).digest("hex")
    : null;
  const requestHash = createHash("sha256").update(`${input.shipmentId}:${amount.toString()}`).digest("hex");

  // 0) Idempotency replay — outside the transaction (read-only check).
  if (keyHash) {
    const existing = await findIdempotencyKey(db, keyHash);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new DomainError("idempotency_conflict", "same key used with different payload", 409);
      }
      return existing.responseBody as Record<string, unknown>;
    }
  }

  const result = await db.transaction(async (tx) => {
    // 1) Lock the shipment row — serializes all invoicing of this shipment.
    const shipment = await lockShipment(tx, input.shipmentId);
    if (!shipment) throw new DomainError("not_found", "shipment not found", 404);
    if (shipment.status === "sold") {
      throw new DomainError("duplicate_invoice", "shipment already sold (invoiced)", 409);
    }
    if (shipment.status !== "open") {
      throw new DomainError("bag_state_invalid", `shipment is ${shipment.status}`, 409);
    }

    // 2) All bags must carry final weights (§6.4.4).
    const bags = await bagsOfShipment(tx, shipment.id);
    if (bags.length === 0) {
      throw new DomainError("weights_missing", "shipment has no bags", 409);
    }
    const unweighed = bags.filter((b) => b.bag.finalWeightKg === null || b.bag.status !== "weighed");
    if (unweighed.length > 0) {
      throw new DomainError(
        "weights_missing",
        `${unweighed.length} bag(s) without final weight`,
        409,
        { unweighed: unweighed.map((b) => b.bag.bagCode) }
      );
    }

    // 3) Frozen settings snapshot (inside the transaction).
    const splits = await readSplits(tx);
    assertSplitsSumTo100(splits);
    const policy = await readUnallocatedPolicy(tx);

    // 4) Weights per collector and per citizen.
    const weightRows = await distributionWeights(tx, shipment.id);
    const collectorMap = new Map<string, Decimal>();
    const citizenMap = new Map<string, Decimal>();
    for (const r of weightRows) {
      if (r.collector_user_id) {
        collectorMap.set(
          r.collector_user_id,
          (collectorMap.get(r.collector_user_id) ?? new Decimal(0)).plus(new Decimal(r.final_weight_kg))
        );
      }
      citizenMap.set(
        r.citizen_user_id,
        (citizenMap.get(r.citizen_user_id) ?? new Decimal(0)).plus(new Decimal(r.final_weight_kg))
      );
    }

    // 5) THE distribution (pure engine).
    const distribution = distributeInvoice({
      invoiceAmount: amount,
      splits,
      collectorWeights: [...collectorMap.entries()].map(([collectorUserId, weightKg]) => ({
        collectorUserId,
        weightKg: weightKg.toFixed(3)
      })),
      citizenWeights: [...citizenMap.entries()].map(([citizenUserId, weightKg]) => ({
        citizenUserId,
        weightKg: weightKg.toFixed(3)
      })),
      policy
    });

    // 6) Persist: invoice + payouts + ledger (append-only).
    const invoiceNumber = await nextInvoiceNumber(tx);
    const invoice = await insertInvoice(tx, {
      id: uuidv7(),
      invoiceNumber,
      shipmentId: shipment.id,
      amount: amount.toString(),
      currency: "ILS",
      splitsSnapshot: { ...splits },
      policySnapshot: { ...policy },
      status: "active",
      createdBy: input.createdBy,
      createdAt: now
    });

    const payoutRows = distribution.payouts.map((p) => ({
      id: uuidv7(),
      invoiceId: invoice.id,
      beneficiaryType: p.beneficiaryType,
      beneficiaryUserId: p.beneficiaryUserId,
      amount: p.amount.toString(),
      weightBasisKg: p.weightBasisKg,
      status: "calculated" as const,
      reason: p.reason,
      calculatedAt: now
    }));
    const insertedPayouts = await insertPayouts(tx, payoutRows);

    const ledgerLineCount = 1 + distribution.ledgerLines.length;
    const entryNumbers = await nextLedgerEntryNumbers(tx, ledgerLineCount);
    const ledgerRows = [
      {
        id: uuidv7(),
        entryNumber: entryNumbers[0]!,
        entryType: "invoice_issued" as const,
        invoiceId: invoice.id,
        payoutId: null,
        amount: amount.toString(),
        reason: `فاتورة بيع صفقة رقم ${shipment.shipmentNumber}`,
        createdBy: input.createdBy,
        createdAt: now
      },
      ...distribution.ledgerLines.map((l, i) => ({
        id: uuidv7(),
        entryNumber: entryNumbers[i + 1]!,
        entryType: l.entryType,
        invoiceId: invoice.id,
        payoutId: null,
        amount: l.amount.toString(),
        reason: l.reason,
        createdBy: input.createdBy,
        createdAt: now
      }))
    ];
    await insertLedgerEntries(tx, ledgerRows);

    // 7) Shipment → sold (+ chain event, same tx).
    await markShipmentSold(tx, shipment.id);
    await appendEvent(tx, {
      aggregateType: "shipment",
      aggregateId: shipment.id,
      statusCode: "sold",
      actorRole: "system",
      actorRef: actorRefSystem(),
      payload: {
        invoice_number: invoiceNumber,
        amount: amount.toString(),
        splits: { ...splits }
      },
      occurredAt: now
    });

    // 8) Requests → sold (only requests whose ALL bags are in this shipment —
    //    requests with bags in other shipments stay `sorted`, see ASSUMPTIONS).
    const requestIds = await requestIdsOfShipmentBags(tx, shipment.id);
    const bagsPerRequest = await countBagsPerRequest(tx, requestIds);
    const fullySoldRequestIds = requestIds.filter((rid) => {
      const info = bagsPerRequest.get(rid);
      return info !== undefined && info.total === (info.inShipment.get(shipment.id) ?? 0);
    });
    await markRequestsSold(tx, fullySoldRequestIds);
    for (const rid of fullySoldRequestIds) {
      await appendEvent(tx, {
        aggregateType: "request",
        aggregateId: rid,
        statusCode: "sold",
        actorRole: "system",
        actorRef: actorRefSystem(),
        payload: { invoice_number: invoiceNumber },
        occurredAt: now
      });
    }

    // 9) Invoice chain event + outbox anchor placeholder (AnchorPort design).
    await appendEvent(tx, {
      aggregateType: "shipment",
      aggregateId: shipment.id,
      statusCode: "invoiced",
      actorRole: "finance",
      actorRef: `FIN-${createHash("sha256").update(input.createdBy).digest("hex").slice(0, 48)}`,
      payload: { invoice_id: invoice.id, invoice_number: invoiceNumber },
      occurredAt: now
    });
    await insertOutboxEvent(tx, {
      aggregateType: "invoice",
      aggregateId: invoice.id,
      eventType: "invoice_created",
      payload: { invoice_number: invoiceNumber, amount: amount.toString() }
    });

    // 10) Final invariant re-check (defense in depth).
    const payoutSum = insertedPayouts.reduce((acc, p) => acc + Money.fromMajor(p.amount).toMinorUnits(), 0n);
    const heldSum = distribution.ledgerLines
      .filter((l) => l.entryType === "unallocated_held")
      .reduce((acc, l) => acc + l.amount.toMinorUnits(), 0n);
    if (payoutSum + heldSum !== amount.toMinorUnits()) {
      throw new DomainError("internal_error", "post-write money conservation check failed", 500);
    }

    const response = {
      invoiceId: invoice.id,
      invoiceNumber,
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      amount: amount.toString(),
      currency: invoice.currency,
      splitsSnapshot: invoice.splitsSnapshot,
      payouts: insertedPayouts.map((p) => ({
        id: p.id,
        beneficiaryType: p.beneficiaryType,
        beneficiaryUserId: p.beneficiaryUserId,
        amount: p.amount,
        weightBasisKg: p.weightBasisKg,
        status: p.status,
        reason: p.reason
      })),
      ledgerEntries: ledgerRows.map((l) => ({
        entryNumber: l.entryNumber,
        entryType: l.entryType,
        amount: l.amount,
        reason: l.reason
      }))
    };

    // 11) Store idempotency response (same tx).
    if (keyHash) {
      await insertIdempotencyKey(tx, {
        keyHash,
        userId: input.createdBy,
        endpoint: "/api/v1/invoices",
        requestHash,
        responseStatus: 201,
        responseBody: response,
        expiresAt: new Date(now.getTime() + 24 * 3600_000)
      });
    }

    return response;
  });

  return result;
}
