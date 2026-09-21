/* eslint-disable no-console */
/**
 * CLI — the ONLY way to seed / create the first admin / verify chains /
 * export OpenAPI. No public seed endpoints exist (§5.17, Appendix D).
 *
 * Commands:
 *   create-admin <email> <password> [displayName]
 *   seed                  (reference data: types, addons, areas — idempotent)
 *   seed:demo             (DEVELOPMENT ONLY: demo users + settings)
 *   verify-chain <type> <id>
 *   export-openapi [outPath]
 */
import { writeFileSync } from "node:fs";
import { loadSettings } from "./settings.js";
import { getDb, closeDb } from "./shared/db/client.js";
import { createApp } from "./main.js";
import { verifyAggregateChain } from "./modules/traceability/application/verify-chain.js";
import { seedReferenceData, seedDemoData } from "./modules/seeds/seed.js";

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd) {
    console.log(`Usage:
  tsx src/cli.ts create-admin <email> <password> [displayName]
  tsx src/cli.ts seed
  tsx src/cli.ts seed:demo
  tsx src/cli.ts verify-chain <request|shipment|bag> <aggregateId>
  tsx src/cli.ts export-openapi [outPath]`);
    process.exit(0);
  }

  const settings = loadSettings();
  const db = getDb(settings.databaseUrl);

  try {
    switch (cmd) {
      case "create-admin": {
        const { createAdmin } = await import("./modules/seeds/create-admin.js");
        const email = args[0];
        const password = args[1];
        const displayName = args[2] ?? "مدير المنصة";
        if (!email || !password) {
          throw new Error("create-admin requires <email> <password>");
        }
        const result = await createAdmin(db, settings, { email, password, displayName });
        console.log(JSON.stringify({ ok: true, userId: result.userId }, null, 2));
        break;
      }
      case "seed": {
        const result = await seedReferenceData(db);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "seed:demo": {
        if (settings.env !== "development" && settings.env !== "test") {
          throw new Error("seed:demo is DEVELOPMENT/TEST ONLY (APP_ENV must be development|test)");
        }
        const result = await seedDemoData(db, settings);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "verify-chain": {
        const [type, id] = args;
        if (!type || !id || !["request", "shipment", "bag"].includes(type)) {
          throw new Error("verify-chain requires <request|shipment|bag> <aggregateId>");
        }
        const result = await verifyAggregateChain(db, type as "request", id);
        console.log(JSON.stringify(result, null, 2));
        if (!result.valid) process.exitCode = 2;
        break;
      }
      case "export-openapi": {
        const outPath = args[0] ?? "../openapi.json";
        const { app } = await createApp({ settings });
        await app.ready();
        const spec = app.swagger();
        writeFileSync(outPath, JSON.stringify(spec, null, 2), "utf8");
        console.log(JSON.stringify({ ok: true, path: outPath, paths: Object.keys(spec.paths ?? {}).length }));
        await app.close();
        break;
      }
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(`[cli] ${String(err instanceof Error ? err.message : err)}`);
  process.exit(1);
});
