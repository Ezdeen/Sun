/**
 * PostgreSQL pool + Drizzle instance.
 * Tuned for Supabase pooler / Render: small pool, statement timeouts.
 */
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Db | undefined;

export function getPool(connectionString: string): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString,
    max: Number.parseInt(process.env.DB_POOL_MAX ?? "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "waste-platform"
  });
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[db] idle client error:", err.message);
  });
  return pool;
}

export function getDb(connectionString: string): Db {
  if (db) return db;
  db = drizzle(getPool(connectionString), { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
