/**
 * Dashboard endpoints — one per role, role-guarded (wrong role → 403).
 * Served by read-model queries only (§10).
 */
import type { FastifyInstance } from "fastify";
import type { Db } from "../../../shared/db/client.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";
import {
  citizenDashboard,
  collectorDashboard,
  authorityDashboard,
  sorterDashboard,
  managerDashboard,
  financeDashboardData
} from "../../collection/application/dashboards.js";
import { getServiceAreaForUser } from "../../identity/infrastructure/users-repo.js";

export function registerDashboardRoutes(
  app: FastifyInstance,
  db: Db,
  guards: AuthGuards
): void {
  app.get("/citizen/dashboard", { onRequest: guards.requireRole("citizen") }, async (req) =>
    citizenDashboard(db, req.authUser!.id)
  );

  app.get("/collector/dashboard", { onRequest: guards.requireRole("collector") }, async (req) =>
    collectorDashboard(db, req.authUser!.id)
  );

  app.get("/authority/dashboard", { onRequest: guards.requireRole("authority") }, async (req) => {
    const serviceAreaId = await getServiceAreaForUser(db, req.authUser!.id);
    return authorityDashboard(db, serviceAreaId);
  });

  app.get("/sorter/dashboard", { onRequest: guards.requireRole("sorter") }, async () =>
    sorterDashboard(db)
  );

  app.get("/finance/dashboard", { onRequest: guards.requireRole("finance") }, async () =>
    financeDashboardData(db)
  );

  app.get("/manager/dashboard", { onRequest: guards.requireRole("manager") }, async () =>
    managerDashboard(db)
  );
}
