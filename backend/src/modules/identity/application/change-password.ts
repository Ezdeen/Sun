/**
 * Change password — revokes every session afterwards (defense in depth).
 */
import { hash, verify } from "@node-rs/argon2";
import { DomainError } from "../../../shared/errors.js";
import { uuidv7 } from "../../../shared/ids.js";
import { isStrongPassword } from "../domain/password.js";
import { getCredential, upsertCredential } from "../infrastructure/users-repo.js";
import { revokeAllUserRefreshTokens, recordAuthEvent } from "../infrastructure/sessions-repo.js";
import type { IdentityDeps } from "./deps.js";

export async function changePassword(
  deps: IdentityDeps,
  input: { userId: string; currentPassword: string; newPassword: string }
): Promise<void> {
  const { db } = deps;
  const cred = await getCredential(db, input.userId);
  if (!cred) throw new DomainError("unauthorized", "no credential", 401);

  const ok = await verify(cred.passwordHash, input.currentPassword);
  if (!ok) throw new DomainError("invalid_credentials", "current password wrong", 401);

  if (!isStrongPassword(input.newPassword)) {
    throw new DomainError("weak_password", "password does not meet policy", 400);
  }

  const newHash = await hash(input.newPassword, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2
  });
  await upsertCredential(db, { userId: input.userId, passwordHash: newHash });
  await revokeAllUserRefreshTokens(db, input.userId, "password_changed");
  await recordAuthEvent(db, {
    id: uuidv7(),
    userId: input.userId,
    eventType: "password_changed"
  });
}
