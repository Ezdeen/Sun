/**
 * Platform settings repository — versioned key/value rows (jsonb).
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import { platformSettings } from "../../../shared/db/schema.js";

export async function readSetting(db: DbOrTx, key: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function upsertSetting(
  db: DbOrTx,
  input: { key: string; value: Record<string, unknown>; updatedBy?: string | null }
): Promise<{ version: number }> {
  const [row] = await db
    .insert(platformSettings)
    .values({
      id: crypto.randomUUID(),
      key: input.key,
      value: input.value,
      updatedBy: input.updatedBy ?? null,
      version: 1
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: input.value,
        version: sqlIncrement(),
        updatedBy: input.updatedBy ?? null,
        updatedAt: new Date()
      }
    })
    .returning({ version: platformSettings.version });
  return { version: row?.version ?? 1 };
}

import { sql } from "drizzle-orm";
function sqlIncrement() {
  return sql`${platformSettings.version} + 1`;
}

export async function readAllSettings(db: DbOrTx) {
  return db.select().from(platformSettings).orderBy(platformSettings.key);
}
