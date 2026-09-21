/** dependency-cruiser — layer boundary enforcement (CI fails on violations). */
const forbidden = [
  {
    name: "domain-must-not-import-frameworks",
    comment: "domain/ is pure: no fastify/drizzle/pg imports allowed",
    severity: "error",
    from: { path: "^src/modules/[^/]+/domain" },
    to: { path: "(fastify|drizzle-orm|node-postgres|^pg$)" }
  },
  {
    name: "domain-must-not-import-layers",
    comment: "domain/ may not import application/api/infrastructure",
    severity: "error",
    from: { path: "^src/modules/[^/]+/domain" },
    to: { path: "^src/modules/[^/]+/(api|application|infrastructure)" }
  },
  {
    name: "api-must-not-import-infrastructure-of-other-modules",
    comment: "cross-module access goes through public.ts / application only",
    severity: "error",
    from: { path: "^src/modules/([^/]+)/api" },
    to: { path: "^src/modules/(?!\\1)([^/]+)/infrastructure" }
  },
  {
    name: "no-cross-module-domain-imports",
    comment: "import another module's domain only via its public surface or shared",
    severity: "warn",
    from: { path: "^src/modules/([^/]+)/(application|infrastructure)" },
    to: { path: "^src/modules/(?!\\1|seeds)([^/]+)/domain" }
  }
];

module.exports = {
  forbidden,
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" }
  }
};
