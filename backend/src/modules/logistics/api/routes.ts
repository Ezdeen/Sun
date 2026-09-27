/**
 * Logistics HTTP surface.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";
import { parsePageParams } from "../../../shared/http/pagination.js";
import {
  createShipment,
  attachBag,
  registerBagArrival,
  weighBag,
  findBag
} from "../application/shipments.js";
import { listShipments, getShipment, bagsOfShipment, attachedWeightByShipment } from "../infrastructure/shipments-repo.js";
import { DomainError } from "../../../shared/errors.js";

const PageQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("sold"), Type.Literal("void")]))
});

const CreateShipmentBody = Type.Object({
  buyerName: Type.Optional(Type.String({ maxLength: 120 })),
  /** Material type collected in this batch — taken from the waste catalog. */
  wasteTypeCode: Type.String({ minLength: 2, maxLength: 32 }),
  /** Batch target weight in kg. Defaults to 1 ton (1000 kg) when omitted. */
  targetWeightKg: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d{1,3})?$" })),
  notes: Type.Optional(Type.String({ maxLength: 500 }))
});

const AttachBagBody = Type.Object({
  bagCode: Type.String({ minLength: 4, maxLength: 120 })
});

const WeighBody = Type.Object({
  finalWeightKg: Type.String({ pattern: "^\\d+(\\.\\d{1,3})?$" }),
  /** Waste type as physically confirmed by the sorter (defaults to the
   *  bag's declared type — plain confirmation, no mismatch recorded). */
  observedWasteTypeCode: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })),
  mismatchNote: Type.Optional(Type.String({ maxLength: 300 }))
});

export function registerLogisticsRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
  guards: AuthGuards
): void {
  app.post(
    "/shipments",
    { preHandler: guards.requirePermission("shipment:create"), schema: { body: CreateShipmentBody } },
    async (req) => {
      const b = req.body as Static<typeof CreateShipmentBody>;
      return createShipment(deps, {
        createdBy: req.authUser!.id,
        role: req.authUser!.role === "manager" ? "manager" : "sorter",
        buyerName: b.buyerName ?? null,
        wasteTypeCode: b.wasteTypeCode,
        targetWeightKg: b.targetWeightKg ?? null,
        notes: b.notes ?? null
      });
    }
  );

  app.get("/shipments", { preHandler: guards.requirePermission("shipment:read"), schema: { querystring: PageQuery } }, async (req) => {
    const p = parsePageParams(req.query as Record<string, unknown>);
    const q = req.query as Record<string, unknown>;
    const status =
      q["status"] === "open" || q["status"] === "sold" || q["status"] === "void"
        ? (q["status"] as "open" | "sold" | "void")
        : undefined;
    const result = await listShipments(deps.db, { limit: p.pageSize, offset: p.offset }, { status });
    const attachedByShipment = await attachedWeightByShipment(deps.db, result.items.map((s) => s.id));
    return {
      items: result.items.map((s) => {
        const attachedWeightKg = attachedByShipment.get(s.id) ?? "0";
        const remainingWeightKg = (Number.parseFloat(s.targetWeightKg) - Number.parseFloat(attachedWeightKg)).toFixed(3);
        return {
          id: s.id,
          shipmentNumber: s.shipmentNumber,
          status: s.status,
          buyerName: s.buyerName,
          wasteTypeCode: s.wasteTypeCode,
          targetWeightKg: s.targetWeightKg,
          attachedWeightKg,
          remainingWeightKg,
          openedAt: s.openedAt,
          soldAt: s.soldAt
        };
      }),
      page: p.page,
      pageSize: p.pageSize,
      total: result.total
    };
  });

  app.get("/shipments/:id", { preHandler: guards.requirePermission("shipment:read") }, async (req) => {
    const { id } = req.params as { id: string };
    const shipment = await getShipment(deps.db, id);
    if (!shipment) throw new DomainError("not_found", "shipment not found", 404);
    const bags = await bagsOfShipment(deps.db, id);
    const attachedWeightKg = await attachedWeightByShipment(deps.db, [id]).then((m) => m.get(id) ?? "0");
    const remainingWeightKg = (Number.parseFloat(shipment.targetWeightKg) - Number.parseFloat(attachedWeightKg)).toFixed(3);
    return {
      shipment: { ...shipment, attachedWeightKg, remainingWeightKg },
      bags: bags.map(({ bag, collectorUserId }) => ({
        id: bag.id,
        bagCode: bag.bagCode,
        status: bag.status,
        wasteTypeCode: bag.wasteTypeCode,
        citizenUserId: bag.citizenUserId,
        collectorUserId,
        requestId: bag.requestId,
        arrivedAt: bag.arrivedAt,
        finalWeightKg: bag.finalWeightKg,
        weighedAt: bag.weighedAt,
        observedWasteTypeCode: bag.observedWasteTypeCode,
        wasteTypeMismatch: bag.wasteTypeMismatch
      }))
    };
  });

  app.post(
    "/shipments/:id/bags",
    { preHandler: guards.requirePermission("bag:weigh"), schema: { body: AttachBagBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const b = req.body as Static<typeof AttachBagBody>;
      return attachBag(deps, {
        shipmentId: id,
        bagCode: b.bagCode,
        actor: {
          userId: req.authUser!.id,
          role: req.authUser!.role === "manager" ? "manager" : "sorter"
        }
      });
    }
  );

  app.get("/bags/:qr", { preHandler: guards.requirePermission("shipment:read") }, async (req) => {
    const { qr } = req.params as { qr: string };
    const bag = await findBag(deps.db, qr);
    return {
      id: bag.id,
      bagCode: bag.bagCode,
      qrPayload: bag.qrPayload,
      status: bag.status,
      wasteTypeCode: bag.wasteTypeCode,
      requestId: bag.requestId,
      shipmentId: bag.shipmentId,
      arrivedAt: bag.arrivedAt,
      finalWeightKg: bag.finalWeightKg,
      weighedAt: bag.weighedAt,
      observedWasteTypeCode: bag.observedWasteTypeCode,
      wasteTypeMismatch: bag.wasteTypeMismatch,
      citizenUserId: bag.citizenUserId
    };
  });

  // Step 1 of sorting (§5.11): scan the bag QR and register its arrival at
  // the sorting facility, matching it against an expected collected bag.
  app.post("/bags/:qr/arrive", { preHandler: guards.requirePermission("bag:weigh") }, async (req) => {
    const { qr } = req.params as { qr: string };
    return registerBagArrival(deps, {
      bagCode: qr,
      actor: {
        userId: req.authUser!.id,
        role: req.authUser!.role === "manager" ? "manager" : "sorter"
      }
    });
  });

  // Step 2 of sorting: confirm waste type + record the locked-in weight.
  app.post(
    "/bags/:qr/weigh",
    { preHandler: guards.requirePermission("bag:weigh"), schema: { body: WeighBody } },
    async (req) => {
      const { qr } = req.params as { qr: string };
      const b = req.body as Static<typeof WeighBody>;
      return weighBag(deps, {
        bagCode: qr,
        finalWeightKg: b.finalWeightKg,
        observedWasteTypeCode: b.observedWasteTypeCode ?? null,
        mismatchNote: b.mismatchNote ?? null,
        actor: {
          userId: req.authUser!.id,
          role: req.authUser!.role === "manager" ? "manager" : "sorter"
        }
      });
    }
  );
}
