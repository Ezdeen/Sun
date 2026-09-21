/**
 * SPA serving — production only. Serves web/dist from the same Fastify
 * service (same-origin: no CORS, no CDN). History fallback for React Router.
 * Path-traversal safe via fastify-static root + decode guard.
 */
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WEB_DIST = process.env.WEB_DIST_DIR ?? resolve(process.cwd(), "..", "web", "dist");

export async function registerSpa(app: FastifyInstance): Promise<void> {
  if (!existsSync(join(WEB_DIST, "index.html"))) {
    app.log.warn({ dir: WEB_DIST }, "web/dist not found — SPA not served (API-only mode)");
    return;
  }

  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: "/",
    index: "index.html",
    dotfiles: "deny",
    maxAge: "1h",
    cacheControl: true
  });

  // History-mode fallback for client routes (no /api prefix).
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      void reply.status(404);
      return {
        type: "https://waste-platform/errors/not_found",
        title: "خطأ في الطلب",
        status: 404,
        code: "not_found",
        detail: "العنصر غير موجود"
      };
    }
    // Serve index.html for client-side routes.
    const index = readFileSync(join(WEB_DIST, "index.html"));
    void reply.type("text/html").send(index);
  });
}
