/**
 * Logout / logout-all use cases.
 */
import { sha256Hex } from "../domain/identity-hash.js";
import { uuidv7 } from "../../../shared/ids.js";
import {
  revokeAllUserRefreshTokens,
  revokeRefreshToken,
  recordAuthEvent
} from "../infrastructure/sessions-repo.js";
import type { IdentityDeps } from "./deps.js";

export async function logout(
  deps: IdentityDeps,
  input: { refreshToken: string | null; userId: string; ip?: string | null }
): Promise<void> {
  if (input.refreshToken) {
    await revokeRefreshToken(deps.db, sha256Hex(input.refreshToken), "logout");
  }
  await recordAuthEvent(deps.db, {
    id: uuidv7(),
    userId: input.userId,
    eventType: "logout",
    ip: input.ip
  });
}

export async function logoutAll(
  deps: IdentityDeps,
  input: { userId: string; ip?: string | null }
): Promise<number> {
  const revoked = await revokeAllUserRefreshTokens(deps.db, input.userId, "logout_all");
  await recordAuthEvent(deps.db, {
    id: uuidv7(),
    userId: input.userId,
    eventType: "logout_all",
    ip: input.ip
  });
  return revoked;
}
