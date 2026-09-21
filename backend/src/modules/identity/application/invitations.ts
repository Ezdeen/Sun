/**
 * Invitations — manager issues one-time tokens for privileged roles
 * (collector, authority, sorter, finance, manager). Citizens register
 * themselves (behind a flag) or are created ad-hoc by the manager.
 */
import { DomainError } from "../../../shared/errors.js";
import { uuidv7 } from "../../../shared/ids.js";
import { sha256Hex } from "../domain/identity-hash.js";
import { INVITE_ONLY_ROLES, type Role } from "../domain/permissions.js";
import { insertInvitation, listInvitations, revokeInvitation } from "../infrastructure/invitations-repo.js";
import { recordAuthEvent } from "../infrastructure/sessions-repo.js";
import type { IdentityDeps } from "./deps.js";

export const INVITATION_TTL_DAYS = 7;

export async function createInvitation(
  deps: IdentityDeps,
  input: { email: string; role: Role; invitedBy: string; serviceAreaId?: string | null }
): Promise<{ invitationId: string; token: string; expiresAt: Date }> {
  const { db, clock, random } = deps;
  if (!INVITE_ONLY_ROLES.includes(input.role)) {
    throw new DomainError(
      "privileged_role_requires_invitation",
      "role cannot be invited (citizens self-register)",
      400
    );
  }
  const token = random.urlToken(32);
  const expiresAt = new Date(
    clock.now().getTime() + INVITATION_TTL_DAYS * 86_400_000
  );
  const id = uuidv7();
  await insertInvitation(db, {
    id,
    email: input.email,
    role: input.role,
    tokenHash: sha256Hex(token),
    invitedBy: input.invitedBy,
    expiresAt,
    serviceAreaId: input.serviceAreaId ?? null
  });
  await recordAuthEvent(db, {
    id: uuidv7(),
    userId: input.invitedBy,
    eventType: "invitation_created",
    details: { email: input.email, role: input.role, invitationId: id }
  });
  // The raw token is shown ONCE to the manager (delivery by email is out
  // of scope — documented in ASSUMPTIONS #A-003).
  return { invitationId: id, token, expiresAt };
}

export async function listPendingInvitations(deps: IdentityDeps, page: number, pageSize: number) {
  return listInvitations(deps.db, { status: "pending", page, pageSize });
}

export async function revokeInvitationById(deps: IdentityDeps, invitationId: string): Promise<void> {
  const ok = await revokeInvitation(deps.db, invitationId);
  if (!ok) throw new DomainError("not_found", "invitation not found or not pending", 404);
}
