/**
 * Collection module — HTTP surface.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuthGuards, AuthUser } from "../../../shared/http/middleware.js";
import { parsePageParams } from "../../../shared/http/pagination.js";
import { DomainError } from "../../../shared/errors.js";
import { getServiceAreaForUser } from "../../identity/infrastructure/users-repo.js";
import { createRequest, getRequestDetail } from "../application/create-request.js";
import { transitionRequest } from "../application/transition-request.js";
import { assertCanSeeRequest, collectorSchedule } from "../application/visibility.js";
import { listVisibleRequests, getRequest } from "../infrastructure/requests-repo.js";
import { visibilityFor, REQUEST_STATUSES } from "../domain/lifecycle.js";
import { loadChain } from "../../traceability/infrastructure/chain-repo.js";
import { verifyChain } from "../../traceability/domain/chain.js";

const PageQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  status: Type.Optional(Type.String({ maxLength: 32 }))
});

const CreateRequestBody = Type.Object({
  notes: Type.Optional(Type.String({ maxLength: 500 })),
  lines: Type.Array(
    Type.Object({
      wasteTypeCode: Type.String({ minLength: 2, maxLength: 32 }),
      quantity: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d{1,3})?$" })),
      weightKg: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d{1,3})?$" })),
      selectedAddons: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 10 }))
    }),
    { minItems: 1, maxItems: 50 }
  )
});

const TransitionBody = Type.Object({
  target: Type.Union(REQUEST_STATUSES.map((s) => Type.Literal(s))),
  expectedVersion: Type.Integer({ minimum: 1 }),
  barcode: Type.Optional(Type.String({ maxLength: 200 })),
  collectorUserId: Type.Optional(Type.String({ format: "uuid" })),
  scheduledDay: Type.Optional(Type.String({ maxLength: 20 })),
  scheduledHour: Type.Optional(Type.String({ maxLength: 10 })),
  reason: Type.Optional(Type.String({ minLength: 3, maxLength: 300 }))
});

async function actorContext(db: Db, user: AuthUser) {
  const serviceAreaId = await getServiceAreaForUser(db, user.id);
  return { role: user.role, userId: user.id, serviceAreaId };
}

export function registerCollectionRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
  guards: AuthGuards
): void {
  app.post(
    "/requests",
    { preHandler: guards.requirePermission("request:create"), schema: { body: CreateRequestBody } },
    async (req) => {
      const body = req.body as Static<typeof CreateRequestBody>;
      if (req.authUser!.role !== "citizen" && req.authUser!.role !== "manager") {
        throw new DomainError("forbidden", "only citizens create requests", 403);
      }
      return createRequest(deps, {
        citizenUserId: req.authUser!.id,
        notes: body.notes ?? null,
        lines: body.lines
      });
    }
  );

  app.get("/requests", { preHandler: guards.requirePermission("request:read"), schema: { querystring: PageQuery } }, async (req) => {
    const p = parsePageParams(req.query as Record<string, unknown>);
    const q = req.query as Record<string, unknown>;
    const status = typeof q["status"] === "string" && (REQUEST_STATUSES as readonly string[]).includes(q["status"])
      ? (q["status"] as never)
      : undefined;
    const actor = await actorContext(deps.db, req.authUser!);
    const result = await listVisibleRequests(
      deps.db,
      visibilityFor(actor),
      { limit: p.pageSize, offset: p.offset },
      { status }
    );
    return {
      items: result.items.map(({ request, citizenName }) => ({
        id: request.id,
        requestNumber: request.requestNumber,
        status: request.status,
        version: request.version,
        citizenName,
        scheduledDay: request.scheduledDay,
        scheduledHour: request.scheduledHour,
        combinedHash: request.combinedHash,
        createdAt: request.createdAt,
        collectedAt: request.collectedAt
      })),
      page: p.page,
      pageSize: p.pageSize,
      total: result.total
    };
  });

  app.get("/requests/:id", { preHandler: guards.requirePermission("request:read") }, async (req) => {
    const { id } = req.params as { id: string };
    const actor = await actorContext(deps.db, req.authUser!);
    const request = await getRequest(deps.db, id);
    if (!request) throw new DomainError("not_found", "request not found", 404);
    assertCanSeeRequest(actor, request);
    const detail = await getRequestDetail(deps, id);
    const chain = await loadChain(deps.db, "request", id);
    const verification = verifyChain(chain);
    return {
      request: detail.request,
      items: detail.items,
      bags: detail.bags.map((b) => ({
        id: b.id,
        bagCode: b.bagCode,
        status: b.status,
        wasteTypeCode: b.wasteTypeCode,
        shipmentId: b.shipmentId,
        finalWeightKg: b.finalWeightKg,
        weighedAt: b.weighedAt
      })),
      chain: {
        valid: verification.valid,
        events: chain.map((e) => ({
          seq: e.seq,
          statusCode: e.statusCode,
          occurredAt: e.occurredAt,
          actorRole: e.actorRole,
          eventHash: e.eventHash
        }))
      }
    };
  });

  app.post(
    "/requests/:id/transitions",
    { preHandler: guards.requirePermission("request:transition"), schema: { body: TransitionBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Static<typeof TransitionBody>;
      const actor = await actorContext(deps.db, req.authUser!);
      // IDOR: actor must be able to SEE the request before transitioning.
      const request = await getRequest(deps.db, id);
      if (!request) throw new DomainError("not_found", "request not found", 404);
      assertCanSeeRequest(actor, request);
      return transitionRequest(deps, {
        requestId: id,
        target: body.target,
        actor: { userId: req.authUser!.id, role: req.authUser!.role },
        expectedVersion: body.expectedVersion,
        barcode: body.barcode ?? null,
        collectorUserId: body.collectorUserId ?? null,
        scheduledDay: body.scheduledDay ?? null,
        scheduledHour: body.scheduledHour ?? null,
        reason: body.reason ?? null
      });
    }
  );

  app.get("/collector/schedule", { preHandler: guards.requirePermission("schedule:read") }, async (req) => {
    return collectorSchedule(deps.db, req.authUser!.id);
  });
}
