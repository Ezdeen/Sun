/**
 * Create collection request (citizen) — one atomic transaction:
 * price snapshot + request + items + bags (with barcodes) + genesis chain event.
 */
import { Decimal } from "decimal.js";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client.js";
import { DomainError } from "../../../shared/errors.js";
import { Money } from "../../../shared/money.js";
import { uuidv7 } from "../../../shared/ids.js";
import type { Clock } from "../../../shared/clock.js";
import {
  requestItems as requestItemsTable,
  shipmentBags as shipmentBagsTable,
  citizens as citizensTable,
  users as usersTable
} from "../../../shared/db/schema.js";
import {
  listActiveWasteTypes,
  listActiveAddonsWithTargets
} from "../../catalog/infrastructure/catalog-repo.js";
import { readPricingConfig } from "../../administration/application/settings.js";
import {
  priceCart,
  UnknownWasteTypeError,
  UnknownAddonError,
  AddonNotApplicableError,
  type CartLineInput,
  type WasteTypeRef,
  type AddonRef
} from "../../pricing/domain/pricing.js";
import {
  combinedHashRef,
  qrPayloadFor,
  requestHashRef,
  bagHashRef
} from "../../traceability/domain/chain.js";
import { appendEvent } from "../../traceability/infrastructure/chain-repo.js";
import {
  insertRequest,
  insertRequestItems,
  insertBags,
  nextRequestNumber,
  getRequest,
  getRequestItems,
  getRequestBags
} from "../infrastructure/requests-repo.js";

export interface CreateRequestLine {
  wasteTypeCode: string;
  quantity?: string | null;
  weightKg?: string | null;
  selectedAddons?: string[];
}

export interface CreateRequestInput {
  citizenUserId: string;
  notes?: string | null;
  lines: CreateRequestLine[];
}

export async function createRequest(deps: { db: Db; clock: Clock }, input: CreateRequestInput) {
  const { db, clock } = deps;
  if (input.lines.length === 0 || input.lines.length > 50) {
    throw new DomainError("validation_error", "1..50 lines required", 400);
  }

  // Load citizen (with identity hash for the combined hash).
  const citizenRows = await db
    .select({
      id: usersTable.id,
      identityHash: usersTable.identityHash
    })
    .from(usersTable)
    .where(eq(usersTable.id, input.citizenUserId))
    .limit(1);
  const citizen = citizenRows[0];
  if (!citizen) throw new DomainError("not_found", "citizen not found", 404);

  const requestId = uuidv7();
  const requestHash = requestHashRef(createHash("sha256").update(requestId).digest("hex"));
  const citizenHashRefValue = citizen.identityHash ?? citizen.id;
  const combinedHash = combinedHashRef(citizenHashRefValue, requestId);
  const qrPayload = qrPayloadFor(combinedHash);

  const result = await db.transaction(async (tx) => {
    // 1) Price the cart INSIDE the transaction (consistent snapshot).
    const [types, addonsRaw, config] = await Promise.all([
      listActiveWasteTypes(tx),
      listActiveAddonsWithTargets(tx),
      readPricingConfig(tx)
    ]);
    const typeRefs = new Map<string, WasteTypeRef>(
      types.map((t) => [
        t.code,
        {
          code: t.code,
          category: t.category,
          unit: t.unit as "bottle" | "liter" | "kg",
          pricePerUnit: Money.fromMajor(t.pricePerUnit),
          capacityWeightKg: t.capacityWeightKg ? new Decimal(t.capacityWeightKg) : null,
          minWeightKg: t.minWeightKg ? new Decimal(t.minWeightKg) : null,
          isBulkOnly: t.isBulkOnly
        }
      ])
    );
    const addonRefs = new Map<string, AddonRef>(
      addonsRaw.map((a) => [
        a.code,
        { code: a.code, bonusPercent: new Decimal(a.bonusPercent), appliesTo: a.appliesTo }
      ])
    );

    const cartLines: CartLineInput[] = input.lines.map((l) => ({
      wasteTypeCode: l.wasteTypeCode,
      quantity: new Decimal(l.quantity ?? "1"),
      weightKg: l.weightKg ? new Decimal(l.weightKg) : null,
      selectedAddons: l.selectedAddons ?? []
    }));

    let priced;
    try {
      priced = priceCart(cartLines, typeRefs, addonRefs, config);
    } catch (err) {
      if (
        err instanceof UnknownWasteTypeError ||
        err instanceof UnknownAddonError ||
        err instanceof AddonNotApplicableError
      ) {
        throw new DomainError("unknown_waste_type", err.message, 400);
      }
      throw err;
    }

    // 2) Citizen's service area.
    const areaRows = await tx
      .select({ serviceAreaId: citizensTable.serviceAreaId })
      .from(citizensTable)
      .where(eq(citizensTable.userId, input.citizenUserId))
      .limit(1);
    const area = areaRows[0];
    if (!area) throw new DomainError("validation_error", "citizen has no service area", 400);

    // 3) Insert request.
    const requestNumber = await nextRequestNumber(tx);
    const now = clock.now();
    const requestRow = await insertRequest(tx, {
      id: requestId,
      requestNumber,
      citizenUserId: input.citizenUserId,
      serviceAreaId: area.serviceAreaId,
      status: "received",
      version: 1,
      combinedHash,
      requestHash,
      qrPayload,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    });

    // 4) Items + bags (one bag per line, barcode ready for the citizen).
    const items: (typeof requestItemsTable.$inferInsert)[] = [];
    const bags: (typeof shipmentBagsTable.$inferInsert)[] = [];
    priced.lines.forEach((line, idx) => {
      const itemId = uuidv7();
      items.push({
        id: itemId,
        requestId,
        wasteTypeCode: line.wasteTypeCode,
        quantity: line.quantity.toString(),
        weightKg: line.weightKg?.toString() ?? null,
        selectedAddons: line.appliedAddons.map((a) => a.code),
        unitPriceSnapshot: (typeRefs.get(line.wasteTypeCode)?.pricePerUnit ?? Money.zero()).toString(),
        estimatedPrice: line.price.toString(),
        warnings: line.warnings,
        displayOrder: idx
      });
      bags.push({
        id: uuidv7(),
        bagCode: bagHashRef(uuidv7()),
        qrPayload: qrPayloadFor(`${combinedHash}:${itemId}`),
        requestId,
        requestItemId: itemId,
        citizenUserId: input.citizenUserId,
        wasteTypeCode: line.wasteTypeCode,
        status: "pending_collection",
        createdAt: now,
        updatedAt: now
      });
    });
    await insertRequestItems(tx, items);
    await insertBags(tx, bags);

    // 5) Genesis chain event — same transaction.
    await appendEvent(tx, {
      aggregateType: "request",
      aggregateId: requestId,
      statusCode: "received",
      actorRole: "citizen",
      actorRef: citizenHashRefValue,
      payload: {
        request_number: requestNumber,
        lines: priced.lines.length,
        estimated_total: priced.totalPrice.toString()
      },
      occurredAt: now
    });

    return { requestRow, priced };
  });

  return {
    request: {
      id: result.requestRow.id,
      requestNumber: result.requestRow.requestNumber,
      status: result.requestRow.status,
      version: result.requestRow.version,
      combinedHash: result.requestRow.combinedHash,
      requestHash: result.requestRow.requestHash,
      qrPayload: result.requestRow.qrPayload,
      createdAt: result.requestRow.createdAt
    },
    estimate: {
      lines: result.priced.lines.map((l) => ({
        wasteTypeCode: l.wasteTypeCode,
        price: l.price.toString(),
        warnings: l.warnings
      })),
      totalPrice: result.priced.totalPrice.toString()
    }
  };
}

export async function getRequestDetail(deps: { db: Db }, requestId: string) {
  const request = await getRequest(deps.db, requestId);
  if (!request) throw new DomainError("not_found", "request not found", 404);
  const [items, bags] = await Promise.all([
    getRequestItems(deps.db, requestId),
    getRequestBags(deps.db, requestId)
  ]);
  return { request, items, bags };
}
