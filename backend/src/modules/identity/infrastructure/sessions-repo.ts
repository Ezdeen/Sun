/**
 * Sessions (refresh tokens) + auth audit events repositories.
 * Refresh tokens: opaque random values, stored hashed, single-use with
 * rotation and reuse detection.
 */
import { and, eq, isNull, sql, gt } from "drizzle-orm";
import type { Db } from "../../../shared/db/client.js";
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

/**
 * Atomic single-use rotation. The UPDATE only matches a token that is still
 * un-revoked, so of two concurrent refreshes exactly ONE can win; the loser
 * gets `false` and must be treated as token reuse (never as a second valid
 * descendant — that would fork the chain and defeat reuse detection).
 */
export async function rotateRefreshToken(
  db: Db,
  input: {
    oldId: string;
    userId: string;
    newId: string;
    newTokenHash: string;
    expiresAt: Date;
    ip?: string | null;
    userAgent?: string | null;
  }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const won = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: "rotated", replacedBy: input.newId })
      .where(and(eq(refreshTokens.id, input.oldId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (won.length === 0) return false;
    await tx.insert(refreshTokens).values({
      id: input.newId,
      userId: input.userId,
      tokenHash: input.newTokenHash,
      expiresAt: input.expiresAt,
      rotatedFrom: input.oldId,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null
    });
    return true;
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

/**
 * Live state of the session an access token belongs to. `sid` is the id of
 * the refresh-token row current when the token was issued; rotation may have
 * moved the chain on since, so we walk `replaced_by` to the chain HEAD and
 * judge revocation there (logout / logout-all / password change / reuse
 * revoke the head). The user's status and role are read from the DB so a
 * disabled account or changed role takes effect immediately.
 */
export interface SessionState {
  userStatus: string;
  userRole: string;
  displayName: string;
  headRevoked: boolean;
}

export async function findSessionState(
  db: DbOrTx,
  userId: string,
  sessionId: string
): Promise<SessionState | null> {
  const res = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, replaced_by, revoked_at, 0 AS depth
        FROM app.refresh_tokens
       WHERE id = ${sessionId} AND user_id = ${userId}
      UNION ALL
      SELECT r.id, r.replaced_by, r.revoked_at, c.depth + 1
        FROM app.refresh_tokens r
        JOIN chain c ON r.id = c.replaced_by
       WHERE c.depth < 100
    )
    SELECT u.status AS user_status, u.role AS user_role, u.display_name,
           (SELECT (revoked_at IS NOT NULL) FROM chain ORDER BY depth DESC LIMIT 1) AS head_revoked,
           EXISTS (SELECT 1 FROM chain) AS has_session
      FROM app.users u
     WHERE u.id = ${userId}
  `);
  const row = (res.rows as {
    user_status: string;
    user_role: string;
    display_name: string;
    head_revoked: boolean | null;
    has_session: boolean;
  }[])[0];
  if (!row || !row.has_session) return null;
  return {
    userStatus: row.user_status,
    userRole: row.user_role,
    displayName: row.display_name,
    headRevoked: row.head_revoked === true
  };
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
