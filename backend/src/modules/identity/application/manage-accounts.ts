/**
 * Manager account management — direct create/edit/delete of user accounts
 * (in addition to the existing invitation flow). Manager-only
 * (`account:manage`). Every action is recorded as an audit event.
 */
import { hash } from "@node-rs/argon2";
import { DomainError } from "../../../shared/errors.js";
import { uuidv7 } from "../../../shared/ids.js";
import { isStrongPassword } from "../domain/password.js";
import type { Role } from "../domain/permissions.js";
import {
  findUserByIdentifier,
  insertUser,
  upsertCredential,
  updateUserProfile,
  deleteUserById,
  attachCitizenProfile,
  attachCollectorProfile,
  attachAuthorityProfile,
  attachStaffProfile,
  type UserRow
} from "../infrastructure/users-repo.js";
import { recordAuthEvent } from "../infrastructure/sessions-repo.js";
import type { IdentityDeps } from "./deps.js";

const AREA_ROLES: readonly Role[] = ["citizen", "collector", "authority"];

export interface CreateAccountInput {
  displayName: string;
  email: string;
  phone?: string | null;
  password: string;
  role: Role;
  serviceAreaId?: string | null;
  createdBy: string;
}

/** Manager creates ANY account directly (no invitation round-trip). */
export async function createAccountByManager(
  deps: IdentityDeps,
  input: CreateAccountInput
): Promise<{ userId: string }> {
  const { db } = deps;

  if (!isStrongPassword(input.password)) {
    throw new DomainError("weak_password", "password does not meet policy", 400);
  }

  const email = input.email.trim().toLowerCase();
  const existingByEmail = await findUserByIdentifier(db, email);
  if (existingByEmail) {
    throw new DomainError("conflict", "email already registered", 409, { field: "email" });
  }
  if (input.phone) {
    const existingByPhone = await findUserByIdentifier(db, input.phone);
    if (existingByPhone) {
      throw new DomainError("conflict", "phone already registered", 409, { field: "phone" });
    }
  }
  if (AREA_ROLES.includes(input.role) && !input.serviceAreaId) {
    throw new DomainError("validation_error", "serviceAreaId is required for this role", 400, {
      field: "serviceAreaId"
    });
  }

  const userId = uuidv7();
  const passwordHash = await hash(input.password, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2
  });

  await db.transaction(async (tx) => {
    await insertUser(tx, {
      id: userId,
      role: input.role,
      displayName: input.displayName,
      email,
      phone: input.phone ?? null,
      status: "active"
    });
    await upsertCredential(tx, { userId, passwordHash });

    switch (input.role) {
      case "citizen":
        await attachCitizenProfile(tx, { userId, serviceAreaId: input.serviceAreaId! });
        break;
      case "collector":
        await attachCollectorProfile(tx, { userId, serviceAreaId: input.serviceAreaId! });
        break;
      case "authority":
        await attachAuthorityProfile(tx, { userId, serviceAreaId: input.serviceAreaId! });
        break;
      case "sorter":
      case "finance":
      case "manager":
        await attachStaffProfile(tx, { userId, title: input.displayName });
        break;
    }

    await recordAuthEvent(tx, {
      id: uuidv7(),
      userId: input.createdBy,
      eventType: "account_status_changed",
      details: { action: "account_created", targetUserId: userId, role: input.role }
    });
  });

  return { userId };
}

export interface UpdateAccountInput {
  displayName?: string;
  email?: string;
  phone?: string | null;
}

export async function updateAccountByManager(
  deps: IdentityDeps,
  userId: string,
  patch: UpdateAccountInput,
  actorId: string
): Promise<UserRow> {
  const { db } = deps;

  if (patch.displayName === undefined && patch.email === undefined && patch.phone === undefined) {
    throw new DomainError("validation_error", "no fields to update", 400);
  }

  if (patch.email) {
    const email = patch.email.trim().toLowerCase();
    const existing = await findUserByIdentifier(db, email);
    if (existing && existing.id !== userId) {
      throw new DomainError("conflict", "email already registered", 409, { field: "email" });
    }
  }

  const updated = await updateUserProfile(db, userId, patch);
  if (!updated) throw new DomainError("not_found", "user not found", 404);

  await recordAuthEvent(db, {
    id: uuidv7(),
    userId: actorId,
    eventType: "account_status_changed",
    details: { action: "account_updated", targetUserId: userId, patch }
  });

  return updated;
}

/** Postgres foreign-key-violation error code. */
const FK_VIOLATION = "23503";

export async function deleteAccountByManager(
  deps: IdentityDeps,
  userId: string,
  actorId: string
): Promise<void> {
  const { db } = deps;

  if (userId === actorId) {
    throw new DomainError("conflict", "cannot delete own account", 409);
  }

  try {
    const ok = await deleteUserById(db, userId);
    if (!ok) throw new DomainError("not_found", "user not found", 404);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    const pgErr = err as { code?: string };
    if (pgErr?.code === FK_VIOLATION) {
      throw new DomainError(
        "conflict",
        "cannot delete: account has related records (requests, shipments, invoices…) — disable it instead",
        409
      );
    }
    throw err;
  }

  await recordAuthEvent(db, {
    id: uuidv7(),
    userId: actorId,
    eventType: "account_status_changed",
    details: { action: "account_deleted", targetUserId: userId }
  });
}
