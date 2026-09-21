/**
 * Refresh use case — single-use rotation with reuse detection.
 * A replayed (revoked) token revokes ALL of the user's sessions.
 */
import { DomainError } from "../../../shared/errors.js";
import { sha256Hex } from "../domain/identity-hash.js";
import { uuidv7 } from "../../../shared/ids.js";
import { permissionsForRole } from "../domain/permissions.js";
import {
  findActiveRefreshToken,
  rotateRefreshToken,
  revokeAllUserRefreshTokens,
  recordAuthEvent
} from "../infrastructure/sessions-repo.js";
import { findUserById } from "../infrastructure/users-repo.js";
import type { IdentityDeps } from "./deps.js";

export interface RefreshOutput {
  accessToken: string;
  refreshToken: string;
}

export async function refresh(
  deps: IdentityDeps,
  input: { refreshToken: string; ip?: string | null; userAgent?: string | null }
): Promise<RefreshOutput> {
  const { db, clock, random, tokens } = deps;
  const tokenHash = sha256Hex(input.refreshToken);
  const row = await findActiveRefreshToken(db, tokenHash);

  if (!row) {
    throw new DomainError("unauthorized", "unknown refresh token", 401);
  }

  if (row.revokedAt !== null) {
    // REUSE DETECTED — revoke every session of this user.
    await revokeAllUserRefreshTokens(db, row.userId, "reuse_detected");
    await recordAuthEvent(db, {
      id: uuidv7(),
      userId: row.userId,
      eventType: "refresh_reuse_detected",
      ip: input.ip,
      userAgent: input.userAgent,
      details: { reusedTokenId: row.id }
    });
    throw new DomainError("refresh_reuse_detected", "refresh token reuse detected", 401);
  }

  if (row.expiresAt.getTime() <= clock.now().getTime()) {
    throw new DomainError("unauthorized", "refresh token expired", 401);
  }

  const user = await findUserById(db, row.userId);
  if (!user || user.status !== "active") {
    throw new DomainError("unauthorized", "user is not active", 401);
  }

  // Rotate: old token becomes revoked (replacedBy), new token issued.
  const newRefreshToken = random.urlToken(32);
  const newId = uuidv7();
  const expiresAt = new Date(
    clock.now().getTime() + deps.settings.refreshTokenTtlDays * 86_400_000
  );
  await rotateRefreshToken(db, {
    oldId: row.id,
    userId: row.userId,
    newId,
    newTokenHash: sha256Hex(newRefreshToken),
    expiresAt,
    ip: input.ip,
    userAgent: input.userAgent
  });
  await recordAuthEvent(db, {
    id: uuidv7(),
    userId: row.userId,
    eventType: "refresh_rotated",
    ip: input.ip,
    userAgent: input.userAgent
  });

  const accessToken = await tokens.issueAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: newId
  });

  void permissionsForRole; // permissions travel inside the access token role
  return { accessToken, refreshToken: newRefreshToken };
}
