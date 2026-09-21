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
  weighBag,
  findBag
} from "../application/shipments.js";
import { listShipments, getShipment, bagsOfShipment } from "../infrastructure/shipments-repo.js";
import { DomainError } from "../../../shared/errors.js";

const PageQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("sold"), Type.Literal("void")]))
});

const CreateShipmentBody = Type.Object({
  buyerName: Type.Optional(Type.String({ maxLength: 120 })),
  notes: Type.Optional(Type.String({ maxLength: 500 }))
});

const AttachBagBody = Type.Object({
  bagCode: Type.String({ minLength: 4, maxLength: 120 })
});

const WeighBody = Type.Object({
  finalWeightKg: Type.String({ pattern: "^\\d+(\\.\\d{1,3})?$" })
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
    return {
      items: result.items.map((s) => ({
        id: s.id,
        shipmentNumber: s.shipmentNumber,
        status: s.status,
        buyerName: s.buyerName,
        openedAt: s.openedAt,
        soldAt: s.soldAt
      })),
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
    return {
      shipment,
      bags: bags.map(({ bag, collectorUserId }) => ({
        id: bag.id,
        bagCode: bag.bagCode,
        status: bag.status,
        wasteTypeCode: bag.wasteTypeCode,
        citizenUserId: bag.citizenUserId,
        collectorUserId,
        requestId: bag.requestId,
        finalWeightKg: bag.finalWeightKg,
        weighedAt: bag.weighedAt
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
      status: bag.status,
      wasteTypeCode: bag.wasteTypeCode,
      requestId: bag.requestId,
      shipmentId: bag.shipmentId,
      finalWeightKg: bag.finalWeightKg,
      weighedAt: bag.weighedAt,
      citizenUserId: bag.citizenUserId
    };
  });

  app.post(
    "/bags/:qr/weigh",
    { preHandler: guards.requirePermission("bag:weigh"), schema: { body: WeighBody } },
    async (req) => {
      const { qr } = req.params as { qr: string };
      const b = req.body as Static<typeof WeighBody>;
      return weighBag(deps, {
        bagCode: qr,
        finalWeightKg: b.finalWeightKg,
        actor: {
          userId: req.authUser!.id,
          role: req.authUser!.role === "manager" ? "manager" : "sorter"
        }
      });
    }
  );
}
