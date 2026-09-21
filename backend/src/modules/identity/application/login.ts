/**
 * Login use case — email or phone + password → access token (in-memory) +
 * refresh token (HttpOnly cookie value returned once for cookie setting).
 * Lockout after MAX_FAILED_ATTEMPTS with LOCKOUT_MINUTES window.
 */
import { verify } from "@node-rs/argon2";
import { DomainError } from "../../../shared/errors.js";
import { sha256Hex } from "../domain/identity-hash.js";
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES } from "../domain/password.js";
import { permissionsForRole, type Role } from "../domain/permissions.js";
import { uuidv7 } from "../../../shared/ids.js";
import {
  findUserByIdentifier,
  getCredential,
  resetLoginFailures,
  recordFailedLogin
} from "../infrastructure/users-repo.js";
import { insertRefreshToken, recordAuthEvent } from "../infrastructure/sessions-repo.js";
import { DUMMY_ARGON2_HASH, type IdentityDeps } from "./deps.js";

export interface LoginInput {
  identifier: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginOutput {
  accessToken: string;
  refreshToken: string; // set as HttpOnly cookie by the API layer
  user: {
    id: string;
    role: Role;
    displayName: string;
    permissions: string[];
  };
}

export async function login(deps: IdentityDeps, input: LoginInput): Promise<LoginOutput> {
  const { db, clock, random, tokens } = deps;
  const user = await findUserByIdentifier(db, input.identifier.trim().toLowerCase());

  if (!user) {
    // Constant-time-ish: verify against a dummy hash anyway.
    await verify(DUMMY_ARGON2_HASH, input.password);
    throw new DomainError("invalid_credentials", "invalid identifier or password", 401);
  }

  const cred = await getCredential(db, user.id);
  if (!cred) {
    await verify(DUMMY_ARGON2_HASH, input.password);
    throw new DomainError("invalid_credentials", "no credential for user", 401);
  }

  // Lockout check BEFORE verifying (locked accounts reject even valid passwords).
  if (cred.lockedUntil && cred.lockedUntil.getTime() > clock.now().getTime()) {
    await recordAuthEvent(db, {
      id: uuidv7(),
      userId: user.id,
      eventType: "login_locked",
      ip: input.ip,
      userAgent: input.userAgent
    });
    throw new DomainError("account_locked", "account is locked", 423);
  }

  const ok = await verify(cred.passwordHash, input.password);
  if (!ok) {
    await recordFailedLogin(db, user.id, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES);
    await recordAuthEvent(db, {
      id: uuidv7(),
      userId: user.id,
      eventType: "login_failed",
      ip: input.ip,
      userAgent: input.userAgent
    });
    throw new DomainError("invalid_credentials", "wrong password", 401);
  }

  if (user.status === "disabled") {
    throw new DomainError("account_disabled", "account disabled", 403);
  }
  if (user.status === "pending") {
    throw new DomainError("account_disabled", "account not activated", 403);
  }

  await resetLoginFailures(db, user.id);

  // Issue session
  const refreshToken = random.urlToken(32);
  const sessionId = uuidv7();
  const expiresAt = new Date(
    clock.now().getTime() + deps.settings.refreshTokenTtlDays * 86_400_000
  );
  await insertRefreshToken(db, {
    id: sessionId,
    userId: user.id,
    tokenHash: sha256Hex(refreshToken),
    expiresAt,
    ip: input.ip,
    userAgent: input.userAgent
  });
  await recordAuthEvent(db, {
    id: uuidv7(),
    userId: user.id,
    eventType: "login_success",
    ip: input.ip,
    userAgent: input.userAgent
  });

  const accessToken = await tokens.issueAccessToken({
    userId: user.id,
    role: user.role,
    sessionId
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      role: user.role,
      displayName: user.displayName,
      permissions: [...permissionsForRole(user.role)]
    }
  };
}
