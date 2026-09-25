/**
 * Catalog HTTP surface — public read + manager management.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { Db } from "../../../shared/db/client.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";
import {
  readPublicCatalog,
  readManagedWasteTypes,
  createWasteType,
  patchWasteType,
  deleteWasteType,
  createAddon,
  patchAddon,
  deleteAddon
} from "../application/catalog.js";

const WasteTypeBody = Type.Object({
  code: Type.String({ minLength: 2, maxLength: 32, pattern: "^[A-Z0-9_]+$" }),
  category: Type.String({ minLength: 2, maxLength: 32 }),
  nameAr: Type.String({ minLength: 2, maxLength: 80 }),
  nameEn: Type.String({ minLength: 2, maxLength: 80 }),
  unit: Type.Union([Type.Literal("bottle"), Type.Literal("liter"), Type.Literal("kg")]),
  pricePerUnit: Type.String({ pattern: "^\\d+(\\.\\d{1,2})?$" }),
  capacityWeightKg: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d{1,3})?$" })),
  minWeightKg: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d{1,3})?$" })),
  isBulkOnly: Type.Optional(Type.Boolean()),
  displayOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 999 })),
  referencePricePerTon: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d{1,2})?$" }))
});

const AddonBody = Type.Object({
  code: Type.String({ minLength: 2, maxLength: 32, pattern: "^[A-Z_]+$" }),
  nameAr: Type.String({ minLength: 2, maxLength: 80 }),
  nameEn: Type.String({ minLength: 2, maxLength: 80 }),
  bonusPercent: Type.String({ pattern: "^\\d+(\\.\\d{1,2})?$" }),
  appliesTo: Type.Array(Type.String({ maxLength: 32 }), { minItems: 1, maxItems: 50 })
});

const AddonPatchBody = Type.Object({
  nameAr: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
  nameEn: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
  bonusPercent: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d{1,2})?$" })),
  appliesTo: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { minItems: 1, maxItems: 50 }))
}, { additionalProperties: false });

export function registerCatalogRoutes(
  app: FastifyInstance,
  db: Db,
  guards: AuthGuards
): void {
  app.get("/catalog", async () => readPublicCatalog(db));

  app.get(
    "/admin/waste-types",
    { preHandler: guards.requirePermission("catalog:manage") },
    async () => readManagedWasteTypes(db)
  );

  app.post(
    "/admin/waste-types",
    { preHandler: guards.requirePermission("catalog:manage"), schema: { body: WasteTypeBody } },
    async (req) => {
      const b = req.body as Static<typeof WasteTypeBody>;
      return createWasteType(db, b);
    }
  );

  app.patch(
    "/admin/waste-types/:code",
    {
      preHandler: guards.requirePermission("catalog:manage"),
      schema: {
        body: Type.Partial(WasteTypeBody, { additionalProperties: false })
      }
    },
    async (req) => {
      const { code } = req.params as { code: string };
      const b = req.body as Static<typeof WasteTypeBody>;
      return patchWasteType(db, code, b);
    }
  );

  app.delete(
    "/admin/waste-types/:code",
    { preHandler: guards.requirePermission("catalog:manage") },
    async (req) => {
      const { code } = req.params as { code: string };
      return deleteWasteType(db, code);
    }
  );

  app.post(
    "/admin/addons",
    { preHandler: guards.requirePermission("catalog:manage"), schema: { body: AddonBody } },
    async (req) => {
      const b = req.body as Static<typeof AddonBody>;
      return createAddon(db, b);
    }
  );

  app.patch(
    "/admin/addons/:code",
    {
      preHandler: guards.requirePermission("catalog:manage"),
      schema: {
        body: AddonPatchBody
      }
    },
    async (req) => {
      const { code } = req.params as { code: string };
      const b = req.body as Static<typeof AddonPatchBody>;
      return patchAddon(db, code, b);
    }
  );

  app.delete(
    "/admin/addons/:code",
    { preHandler: guards.requirePermission("catalog:manage") },
    async (req) => {
      const { code } = req.params as { code: string };
      return deleteAddon(db, code);
    }
  );
}
