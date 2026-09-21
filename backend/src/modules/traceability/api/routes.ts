/**
 * Traceability HTTP surface — public rate-limited track + manager verify.
 */
import type { FastifyInstance } from "fastify";
import type { Db } from "../../../shared/db/client.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";
import { publicTrack } from "../application/track.js";
import { verifyAggregateChain } from "../application/verify-chain.js";
import { DomainError } from "../../../shared/errors.js";

export function registerTraceabilityRoutes(
  app: FastifyInstance,
  db: Db,
  guards: AuthGuards
): void {
  // Public tracking — rate limited, sanitized (§6.3).
  app.get(
    "/track/:hash",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { hash } = req.params as { hash: string };
      return publicTrack(db, hash);
    }
  );

  app.get(
    "/admin/traceability/verify/:aggregateType/:aggregateId",
    { preHandler: guards.requirePermission("traceability:verify") },
    async (req) => {
      const { aggregateType, aggregateId } = req.params as {
        aggregateType: string;
        aggregateId: string;
      };
      if (!["request", "shipment", "bag"].includes(aggregateType)) {
        throw new DomainError("validation_error", "aggregate type must be request|shipment|bag", 400);
      }
      return verifyAggregateChain(db, aggregateType as "request" | "shipment" | "bag", aggregateId);
    }
  );
}
