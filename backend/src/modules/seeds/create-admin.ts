/**
 * First manager account — the ONLY bootstrap path to manager access.
 * CLI-only; no default passwords anywhere (§5.6).
 */
import { hash } from "@node-rs/argon2";
import type { Db } from "../../shared/db/client.js";
import type { Settings } from "../../settings.js";
import { isStrongPassword } from "../../modules/identity/domain/password.js";
import { DomainError } from "../../shared/errors.js";
import { uuidv7 } from "../../shared/ids.js";
import {
  insertUser,
  upsertCredential,
  attachStaffProfile,
  findUserByIdentifier
} from "../../modules/identity/infrastructure/users-repo.js";

export async function createAdmin(
  db: Db,
  settings: Settings,
  input: { email: string; password: string; displayName: string }
): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new DomainError("validation_error", "invalid email", 400);
  }
  if (!isStrongPassword(input.password)) {
    throw new DomainError("weak_password", "password does not meet policy", 400);
  }
  const existing = await findUserByIdentifier(db, email);
  if (existing) {
    throw new DomainError("conflict", "email already exists", 409);
  }
  void settings;

  const userId = uuidv7();
  const passwordHash = await hash(input.password, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2
  });

  await db.transaction(async (tx) => {
    await insertUser(tx, {
      id: userId,
      role: "manager",
      displayName: input.displayName,
      email,
      status: "active"
    });
    await upsertCredential(tx, { userId, passwordHash });
    await attachStaffProfile(tx, { userId, title: "مدير المنصة" });
  });

  return { userId };
}
