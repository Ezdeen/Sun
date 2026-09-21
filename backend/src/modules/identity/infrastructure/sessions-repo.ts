/**
 * Sessions (refresh tokens) + auth audit events repositories.
 * Refresh tokens: opaque random values, stored hashed, single-use with
 * rotation and reuse detection.
 */
import { and, eq, isNull, sql, gt } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import { refreshTokens, authEvents } from "../../../shared/db/schema.js";

export async function insertRefreshToken(
  db: DbOrTx,
  input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    rotatedFrom?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await db.insert(refreshTokens).values({
    id: input.id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    rotatedFrom: input.rotatedFrom ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null
  });
}

export async function findActiveRefreshToken(db: DbOrTx, tokenHash: string) {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function rotateRefreshToken(
  db: DbOrTx,
  input: {
    oldId: string;
    userId: string;
    newId: string;
    newTokenHash: string;
    expiresAt: Date;
    ip?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokedReason: "rotated", replacedBy: input.newId })
    .where(and(eq(refreshTokens.id, input.oldId), isNull(refreshTokens.revokedAt)));
  await db.insert(refreshTokens).values({
    id: input.newId,
    userId: input.userId,
    tokenHash: input.newTokenHash,
    expiresAt: input.expiresAt,
    rotatedFrom: input.oldId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null
  });
}

export async function revokeRefreshToken(db: DbOrTx, tokenHash: string, reason: string): Promise<boolean> {
  const res = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return res.length > 0;
}

export async function revokeAllUserRefreshTokens(db: DbOrTx, userId: string, reason: string): Promise<number> {
  const res = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return res.length;
}

export async function countActiveSessions(db: DbOrTx, userId: string): Promise<number> {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date())
      )
    );
  return countRow?.count ?? 0;
}

// ── Auth events (audit) ──────────────────────────────────────────────────
export async function recordAuthEvent(
  db: DbOrTx,
  input: {
    id: string;
    userId?: string | null;
    eventType:
      | "login_success"
      | "login_failed"
      | "login_locked"
      | "refresh_rotated"
      | "refresh_reuse_detected"
      | "logout"
      | "logout_all"
      | "invitation_created"
      | "invitation_accepted"
      | "password_changed"
      | "account_status_changed"
      | "override_executed";
    ip?: string | null;
    userAgent?: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  await db.insert(authEvents).values({
    id: input.id,
    userId: input.userId ?? null,
    eventType: input.eventType,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    details: input.details ?? {}
  });
}

export async function listAuthEvents(
  db: DbOrTx,
  filter: { userId?: string; page: number; pageSize: number }
) {
  const where = filter.userId ? eq(authEvents.userId, filter.userId) : undefined;
  const items = await db
    .select()
    .from(authEvents)
    .where(where)
    .orderBy(sql`${authEvents.occurredAt} desc`)
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authEvents)
    .where(where);
  return { items, total: countRow?.count ?? 0 };
}
