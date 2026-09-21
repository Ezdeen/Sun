/**
 * Administration HTTP surface — settings (versioned) + manager dashboard.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { Db } from "../../../shared/db/client.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";
import {
  readSettingsForDisplay,
  updateSettings
} from "../application/settings.js";

const UpdateSettingsBody = Type.Object({
  pricing: Type.Optional(
    Type.Object({
      bonusCapPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
      paperMinWeightKg: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
      paperUnderweightFactor: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      underUnitFactor: Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
    })
  ),
  distributionSplits: Type.Optional(
    Type.Object({
      platform: Type.Number({ minimum: 0, maximum: 100 }),
      collectors: Type.Number({ minimum: 0, maximum: 100 }),
      citizens: Type.Number({ minimum: 0, maximum: 100 })
    })
  ),
  distributionPolicy: Type.Optional(
    Type.Object({
      unallocated: Type.Union([Type.Literal("to_platform"), Type.Literal("held")])
    })
  )
});

export function registerAdministrationRoutes(
  app: FastifyInstance,
  db: Db,
  guards: AuthGuards
): void {
  app.get(
    "/admin/settings",
    { preHandler: guards.requirePermission("settings:update") },
    async () => readSettingsForDisplay(db)
  );

  app.patch(
    "/admin/settings",
    { preHandler: guards.requirePermission("settings:update"), schema: { body: UpdateSettingsBody } },
    async (req) => {
      const b = req.body as Static<typeof UpdateSettingsBody>;
      await updateSettings(db, b, req.authUser!.id);
      return readSettingsForDisplay(db);
    }
  );
}
