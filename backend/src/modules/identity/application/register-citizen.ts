/**
 * Citizen self-registration — behind ALLOW_CITIZEN_SELF_REGISTRATION flag.
 * Identity number stored ONLY as HMAC(pepper) + last 4 digits.
 */
import { DomainError } from "../../../shared/errors.js";
import { uuidv7 } from "../../../shared/ids.js";
import { hash } from "@node-rs/argon2";
import { citizenHash, isValidIdNumber, last4Of } from "../domain/identity-hash.js";
import { isStrongPassword } from "../domain/password.js";
import {
  findUserByIdentifier,
  insertUser,
  upsertCredential,
  attachCitizenProfile
} from "../infrastructure/users-repo.js";
import type { IdentityDeps } from "./deps.js";

export interface RegisterCitizenInput {
  displayName: string;
  email: string;
  phone: string;
  password: string;
  idNumber: string;
  serviceAreaId: string;
  addressHint?: string | null;
}

export async function registerCitizen(
  deps: IdentityDeps,
  input: RegisterCitizenInput
): Promise<{ userId: string }> {
  if (!deps.settings.allowCitizenSelfRegistration) {
    throw new DomainError("self_registration_disabled", "self registration disabled", 403);
  }
  if (!isStrongPassword(input.password)) {
    throw new DomainError("weak_password", "password does not meet policy", 400);
  }
  if (!isValidIdNumber(input.idNumber)) {
    throw new DomainError("validation_error", "id number must be 9 digits", 400);
  }

  const existing = await findUserByIdentifier(deps.db, input.email);
  if (existing) {
    throw new DomainError("conflict", "email already registered", 409, { field: "email" });
  }
  const existingPhone = await findUserByIdentifier(deps.db, input.phone);
  if (existingPhone) {
    throw new DomainError("conflict", "phone already registered", 409, { field: "phone" });
  }

  const cHash = citizenHash(deps.settings.identityPepper, input.idNumber);
  const userId = uuidv7();
  const passwordHash = await hash(input.password, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2
  });

  await deps.db.transaction(async (tx) => {
    await insertUser(tx, {
      id: userId,
      role: "citizen",
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
      status: "active",
      identityHash: cHash,
      identityLast4: last4Of(input.idNumber)
    });
    await upsertCredential(tx, { userId, passwordHash });
    await attachCitizenProfile(tx, {
      userId,
      serviceAreaId: input.serviceAreaId,
      addressHint: input.addressHint
    });
  });

  return { userId };
}
