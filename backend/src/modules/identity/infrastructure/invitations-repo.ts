/**
 * Invitations repository — one-time tokens, hashed at rest, expiring.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import { invitations, type InvitationRow } from "../../../shared/db/schema.js";
import type { Role } from "../domain/permissions.js";

export async function insertInvitation(
  db: DbOrTx,
  input: {
    id: string;
    email: string;
    role: Role;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
    serviceAreaId?: string | null;
  }
): Promise<InvitationRow> {
  const [row] = await db
    .insert(invitations)
    .values({
      id: input.id,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: input.tokenHash,
      invitedBy: input.invitedBy,
      expiresAt: input.expiresAt,
      serviceAreaId: input.serviceAreaId ?? null
    })
    .returning();
  return row!;
}

export async function findInvitationByTokenHash(db: DbOrTx, tokenHash: string) {
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function acceptInvitation(
  db: DbOrTx,
  input: { invitationId: string; userId: string }
): Promise<void> {
  await db
    .update(invitations)
    .set({ status: "accepted", acceptedAt: new Date(), acceptedUserId: input.userId })
    .where(and(eq(invitations.id, input.invitationId), eq(invitations.status, "pending")));
}

export async function listInvitations(
  db: DbOrTx,
  filter: { status?: "pending" | "accepted" | "expired" | "revoked"; page: number; pageSize: number }
) {
  const where = filter.status ? eq(invitations.status, filter.status) : undefined;
  const items = await db
    .select()
    .from(invitations)
    .where(where)
    .orderBy(sql`${invitations.createdAt} desc`)
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invitations)
    .where(where);
  return { items, total: countRow?.count ?? 0 };
}

export async function revokeInvitation(db: DbOrTx, invitationId: string): Promise<boolean> {
  const res = await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")))
    .returning({ id: invitations.id });
  return res.length > 0;
}
