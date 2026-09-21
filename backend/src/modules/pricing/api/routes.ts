/**
 * Pricing + catalog HTTP surface.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { estimate } from "../application/estimate.js";
import type { Db } from "../../../shared/db/client.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";

const EstimateBody = Type.Object({
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

export function registerPricingRoutes(
  app: FastifyInstance,
  db: Db,
  guards: AuthGuards
): void {
  void guards;
  app.post(
    "/pricing/estimate",
    {
      schema: { body: EstimateBody },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
    },
    async (req) => {
      const body = req.body as Static<typeof EstimateBody>;
      return estimate(db, body.lines);
    }
  );
}
