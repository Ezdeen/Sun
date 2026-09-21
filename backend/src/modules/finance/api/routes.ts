/**
 * Finance HTTP surface.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { Db } from "../../../shared/db/client.js";
import type { Clock } from "../../../shared/clock.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";
import { parsePageParams } from "../../../shared/http/pagination.js";
import { DomainError } from "../../../shared/errors.js";
import { createInvoice } from "../application/create-invoice.js";
import { transitionPayout } from "../application/payouts.js";
import {
  getInvoice,
  listInvoices,
  payoutsOfInvoice,
  listPayouts,
  listLedger
} from "../infrastructure/finance-repo.js";

const PageQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  status: Type.Optional(Type.String({ maxLength: 16 }))
});

const CreateInvoiceBody = Type.Object({
  shipmentId: Type.String({ format: "uuid" }),
  amount: Type.String({ pattern: "^\\d+(\\.\\d{1,2})?$" }),
  buyerName: Type.Optional(Type.String({ maxLength: 120 }))
});

const PayoutTransitionBody = Type.Object({
  target: Type.Union([Type.Literal("approved"), Type.Literal("paid"), Type.Literal("void")]),
  reason: Type.Optional(Type.String({ minLength: 3, maxLength: 300 }))
});

export function registerFinanceRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock },
  guards: AuthGuards
): void {
  app.post(
    "/invoices",
    {
      preHandler: guards.requirePermission("invoice:create"),
      schema: {
        body: CreateInvoiceBody,
        headers: Type.Object({
          "idempotency-key": Type.Optional(Type.String({ minLength: 8, maxLength: 128 }))
        })
      }
    },
    async (req, reply) => {
      const b = req.body as Static<typeof CreateInvoiceBody>;
      const idem = req.headers["idempotency-key"];
      const result = await createInvoice(deps, {
        shipmentId: b.shipmentId,
        amount: b.amount,
        buyerName: b.buyerName ?? null,
        createdBy: req.authUser!.id,
        idempotencyKey: typeof idem === "string" && idem.length > 0 ? idem : null
      });
      void reply.status(201);
      return result;
    }
  );

  app.get("/invoices", { preHandler: guards.requirePermission("ledger:read"), schema: { querystring: PageQuery } }, async (req) => {
    const p = parsePageParams(req.query as Record<string, unknown>);
    const q = req.query as Record<string, unknown>;
    const status = q["status"] === "active" || q["status"] === "void" ? (q["status"] as "active" | "void") : undefined;
    const result = await listInvoices(deps.db, { limit: p.pageSize, offset: p.offset }, { status });
    return {
      items: result.items.map(({ invoice, shipmentNumber }) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        shipmentId: invoice.shipmentId,
        shipmentNumber,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
        createdAt: invoice.createdAt
      })),
      page: p.page,
      pageSize: p.pageSize,
      total: result.total
    };
  });

  app.get("/invoices/:id", { preHandler: guards.requirePermission("ledger:read") }, async (req) => {
    const { id } = req.params as { id: string };
    const invoice = await getInvoice(deps.db, id);
    if (!invoice) throw new DomainError("not_found", "invoice not found", 404);
    const payouts = await payoutsOfInvoice(deps.db, id);
    return {
      invoice,
      payouts: payouts.map((p) => ({
        id: p.id,
        beneficiaryType: p.beneficiaryType,
        beneficiaryUserId: p.beneficiaryUserId,
        amount: p.amount,
        weightBasisKg: p.weightBasisKg,
        status: p.status,
        reason: p.reason
      }))
    };
  });

  app.get("/finance/ledger", { preHandler: guards.requirePermission("ledger:read"), schema: { querystring: PageQuery } }, async (req) => {
    const p = parsePageParams(req.query as Record<string, unknown>);
    const result = await listLedger(deps.db, { limit: p.pageSize, offset: p.offset });
    return {
      items: result.items,
      page: p.page,
      pageSize: p.pageSize,
      total: result.total
    };
  });

  app.get("/payouts", { preHandler: guards.requirePermission("payout:transition"), schema: { querystring: PageQuery } }, async (req) => {
    const p = parsePageParams(req.query as Record<string, unknown>);
    const q = req.query as Record<string, unknown>;
    const status =
      q["status"] === "calculated" || q["status"] === "approved" || q["status"] === "paid" || q["status"] === "void"
        ? (q["status"] as "calculated" | "approved" | "paid" | "void")
        : undefined;
    const result = await listPayouts(deps.db, { limit: p.pageSize, offset: p.offset }, { status });
    return {
      items: result.items.map(({ payout, invoiceNumber }) => ({
        id: payout.id,
        invoiceId: payout.invoiceId,
        invoiceNumber,
        beneficiaryType: payout.beneficiaryType,
        beneficiaryUserId: payout.beneficiaryUserId,
        amount: payout.amount,
        weightBasisKg: payout.weightBasisKg,
        status: payout.status,
        reason: payout.reason,
        calculatedAt: payout.calculatedAt,
        approvedAt: payout.approvedAt,
        paidAt: payout.paidAt
      })),
      page: p.page,
      pageSize: p.pageSize,
      total: result.total
    };
  });

  app.get("/me/payouts", { preHandler: guards.requirePermission("payout:read:own"), schema: { querystring: PageQuery } }, async (req) => {
    const p = parsePageParams(req.query as Record<string, unknown>);
    const result = await listPayouts(deps.db, { limit: p.pageSize, offset: p.offset }, {
      beneficiaryUserId: req.authUser!.id
    });
    return {
      items: result.items.map(({ payout, invoiceNumber }) => ({
        id: payout.id,
        invoiceNumber,
        amount: payout.amount,
        weightBasisKg: payout.weightBasisKg,
        status: payout.status,
        calculatedAt: payout.calculatedAt,
        paidAt: payout.paidAt
      })),
      page: p.page,
      pageSize: p.pageSize,
      total: result.total
    };
  });

  app.post(
    "/payouts/:id/transitions",
    { preHandler: guards.requirePermission("payout:transition"), schema: { body: PayoutTransitionBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const b = req.body as Static<typeof PayoutTransitionBody>;
      return transitionPayout(deps, {
        payoutId: id,
        target: b.target,
        actor: { userId: req.authUser!.id, role: req.authUser!.role === "manager" ? "manager" : "finance" },
        reason: b.reason ?? null
      });
    }
  );
}
