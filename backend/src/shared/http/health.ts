/**
 * Health endpoints — /health/live (process) and /health/ready (DB).
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get("/health/live", async () => ({ status: "ok", uptime: process.uptime() }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: "ok", database: "up" };
    } catch {
      void reply.status(503);
      return { status: "degraded", database: "down" };
    }
  });
}
