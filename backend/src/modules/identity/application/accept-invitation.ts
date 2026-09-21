/**
 * Accept invitation — creates the invited user with a chosen password.
 * Token is single-use, expiring, and consumed atomically with user creation.
 */
import { DomainError } from "../../../shared/errors.js";
import { hash } from "@node-rs/argon2";
import { uuidv7 } from "../../../shared/ids.js";
import { sha256Hex } from "../domain/identity-hash.js";
import { isStrongPassword } from "../domain/password.js";
import { findInvitationByTokenHash, acceptInvitation } from "../infrastructure/invitations-repo.js";
import {
  findUserByIdentifier,
  insertUser,
  upsertCredential,
  attachCollectorProfile,
  attachAuthorityProfile,
  attachStaffProfile
} from "../infrastructure/users-repo.js";
import { recordAuthEvent } from "../infrastructure/sessions-repo.js";
import type { IdentityDeps } from "./deps.js";

export interface AcceptInvitationInput {
  token: string;
  password: string;
  displayName: string;
  phone?: string | null;
}

export async function acceptInvitationAndCreateUser(
  deps: IdentityDeps,
  input: AcceptInvitationInput
): Promise<{ userId: string }> {
  const { db, clock } = deps;
  const tokenHash = sha256Hex(input.token);
  const invitation = await findInvitationByTokenHash(db, tokenHash);

  if (!invitation || invitation.status !== "pending") {
    throw new DomainError("invitation_invalid", "invitation invalid", 404);
  }
  if (invitation.expiresAt.getTime() <= clock.now().getTime()) {
    throw new DomainError("invitation_expired", "invitation expired", 410);
  }
  if (!isStrongPassword(input.password)) {
    throw new DomainError("weak_password", "password does not meet policy", 400);
  }
  const existing = await findUserByIdentifier(db, invitation.email);
  if (existing) {
    throw new DomainError("conflict", "email already registered", 409);
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
      role: invitation.role,
      displayName: input.displayName,
      email: invitation.email,
      phone: input.phone ?? null,
      status: "active"
    });
    await upsertCredential(tx, { userId, passwordHash });
    switch (invitation.role) {
      case "collector":
        await attachCollectorProfile(tx, {
          userId,
          serviceAreaId: invitation.serviceAreaId ?? await firstAreaId(tx)
        });
        break;
      case "authority":
        await attachAuthorityProfile(tx, {
          userId,
          serviceAreaId: invitation.serviceAreaId ?? await firstAreaId(tx)
        });
        break;
      case "sorter":
      case "finance":
      case "manager":
        await attachStaffProfile(tx, { userId });
        break;
      default:
        throw new DomainError("invitation_invalid", "role not invitable", 400);
    }
    await acceptInvitation(tx, { invitationId: invitation.id, userId });
    await recordAuthEvent(tx, {
      id: uuidv7(),
      userId,
      eventType: "invitation_accepted",
      details: { invitationId: invitation.id, role: invitation.role }
    });
  });

  return { userId };
}

import { sql } from "drizzle-orm";
import { serviceAreas } from "../../../shared/db/schema.js";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";

async function firstAreaId(tx: DbOrTx): Promise<string> {
  const rows = await tx
    .select({ id: serviceAreas.id })
    .from(serviceAreas)
    .where(sql`${serviceAreas.active} = true`)
    .orderBy(sql`${serviceAreas.code} asc`)
    .limit(1);
  if (!rows[0]) {
    throw new DomainError("internal_error", "no active service areas seeded", 500);
  }
  return rows[0].id;
}
