/**
 * Application factory + boot. NO business logic here — wiring only.
 * Tables are NEVER created at startup; migrations run as a deploy step.
 */
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import { loadSettings, settingsFingerprint, type Settings } from "./settings.js";
import { getDb, closeDb } from "./shared/db/client.js";
import { SystemClock } from "./shared/clock.js";
import { SystemRandomSource } from "./shared/random.js";
import { problemDetails } from "./shared/http/problem-details.js";
import { createAuthGuards } from "./shared/http/middleware.js";
import { createTokenService } from "./modules/identity/application/token-service.js";
import { registerIdentityRoutes } from "./modules/identity/api/routes.js";
import { registerCatalogRoutes } from "./modules/catalog/api/routes.js";
import { registerPricingRoutes } from "./modules/pricing/api/routes.js";
import { registerCollectionRoutes } from "./modules/collection/api/routes.js";
import { registerTraceabilityRoutes } from "./modules/traceability/api/routes.js";
import { registerLogisticsRoutes } from "./modules/logistics/api/routes.js";
import { registerFinanceRoutes } from "./modules/finance/api/routes.js";
import { registerAdministrationRoutes } from "./modules/administration/api/routes.js";
import { registerDashboardRoutes } from "./modules/dashboards/api/routes.js";
import { registerHealthRoutes } from "./shared/http/health.js";
import { registerSpa } from "./shared/http/spa.js";
import { sql } from "drizzle-orm";

export interface AppContext {
  settings: Settings;
  app: FastifyInstance;
}

export async function createApp(overrides?: { settings?: Settings }): Promise<AppContext> {
  const settings = overrides?.settings ?? loadSettings();
  const app = Fastify({
    logger: {
      level: settings.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
      timestamp: () => `,"time":"${new Date().toISOString()}"`
    },
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "request_id",
    bodyLimit: 1_048_576
  });

  // ── Plugins ──────────────────────────────────────────────────────────
  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'"]
      }
    },
    hsts: settings.env === "production" ? { maxAge: 31_536_000 } : false
  });
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      type: "https://waste-platform/errors/rate_limited",
      title: "خطأ في الطلب",
      status: 429,
      code: "rate_limited",
      detail: "عدد كبير من المحاولات، حاول بعد قليل"
    })
  });
  if (settings.corsOrigins.length > 0) {
    await app.register(fastifyCors, {
      origin: settings.corsOrigins,
      credentials: true
    });
  }
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Waste Platform API",
        description: "منصة إدارة النفايات الصلبة وإعادة التدوير — REST API",
        version: "1.0.0"
      },
      servers: [{ url: "/api/v1" }],
      tags: [
        { name: "auth" }, { name: "admin" }, { name: "public" },
        { name: "requests" }, { name: "logistics" }, { name: "finance" },
        { name: "dashboards" }, { name: "health" }
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
        }
      }
    }
  });

  // ── Error handling (RFC 7807, Arabic messages) ───────────────────────
  app.setErrorHandler((err, req, reply) => problemDetails(req, reply, err));

  // ── Request decoration ───────────────────────────────────────────────
  app.decorateRequest("authUser", null);

  // ── Wiring ───────────────────────────────────────────────────────────
  const db = getDb(settings.databaseUrl);
  const clock = new SystemClock();
  const random = new SystemRandomSource();
  const tokens = createTokenService({
    secret: settings.jwtSecret,
    keyId: settings.jwtKeyId,
    ttlSeconds: settings.accessTokenTtlSeconds,
    issuer: "waste-platform",
    audience: "waste-web"
  });
  const guards = createAuthGuards(tokens);
  const identityDeps = { db, settings, clock, random, tokens };

  // ── API v1 ───────────────────────────────────────────────────────────
  await app.register(
    async (api) => {
      registerHealthRoutes(api, db);
      registerIdentityRoutes(api, identityDeps, guards);
      registerCatalogRoutes(api, db, guards);
      registerPricingRoutes(api, db, guards);
      registerCollectionRoutes(api, { db, clock }, guards);
      registerTraceabilityRoutes(api, db, guards);
      registerLogisticsRoutes(api, { db, clock }, guards);
      registerFinanceRoutes(api, { db, clock }, guards);
      registerAdministrationRoutes(api, db, guards);
      registerDashboardRoutes(api, db, guards);
    },
    { prefix: "/api/v1" }
  );

  // ── SPA (production: serves web/dist from the same service) ──────────
  if (settings.env === "production") {
    await registerSpa(app);
  }

  app.log.info(
    { fingerprint: settingsFingerprint(settings), env: settings.env },
    "application wired"
  );

  return { settings, app };
}

export async function boot(): Promise<void> {
  const ctx = await createApp();
  await ctx.app.listen({ port: ctx.settings.port, host: "0.0.0.0" });
  const shutdown = async (signal: string) => {
    ctx.app.log.info({ signal }, "shutting down");
    await ctx.app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// DB readiness probe helper (used by health routes).
export async function pingDb(db: ReturnType<typeof getDb>): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

// ── Entry point ─────────────────────────────────────────────────────────
const isMain =
  process.argv[1]?.endsWith("main.ts") === true ||
  process.argv[1]?.endsWith("main.js") === true;
if (isMain) {
  void boot();
}
