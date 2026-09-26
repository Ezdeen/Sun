/**
 * Users & credentials repository (Drizzle). Only place that touches the
 * users/credentials tables.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../../../shared/db/unit-of-work.js";
import { users, credentials, citizens, collectors, authorities, staffProfiles, type UserRow } from "../../../shared/db/schema.js";
import type { Role } from "../domain/permissions.js";

export async function findUserByIdentifier(
  db: DbOrTx,
  identifier: string
): Promise<UserRow | undefined> {
  const email = identifier.trim().toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(or(eq(users.email, email), eq(users.phone, identifier.trim())))
    .limit(1);
  return rows[0];
}

export async function findUserById(db: DbOrTx, id: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function insertUser(
  db: DbOrTx,
  input: {
    id: string;
    role: Role;
    displayName: string;
    email: string;
    phone?: string | null;
    status: "pending" | "active" | "disabled";
    identityHash?: string | null;
    identityLast4?: string | null;
  }
): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({
      id: input.id,
      role: input.role,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      phone: input.phone ?? null,
      status: input.status,
      identityHash: input.identityHash ?? null,
      identityLast4: input.identityLast4 ?? null
    })
    .returning();
  return row!;
}

export async function updateUserStatus(
  db: DbOrTx,
  userId: string,
  status: "active" | "disabled"
): Promise<UserRow | undefined> {
  const [row] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return row;
}

/**
 * Edit a user's basic profile fields (manager account management).
 * Does NOT touch role, status, or identity hash — those go through their
 * own dedicated flows.
 */
export async function updateUserProfile(
  db: DbOrTx,
  userId: string,
  patch: { displayName?: string; email?: string; phone?: string | null }
): Promise<UserRow | undefined> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) set["displayName"] = patch.displayName;
  if (patch.email !== undefined) set["email"] = patch.email.trim().toLowerCase();
  if (patch.phone !== undefined) set["phone"] = patch.phone;
  const [row] = await db
    .update(users)
    .set(set as never)
    .where(eq(users.id, userId))
    .returning();
  return row;
}

/**
 * Hard-delete a user account (manager account management). Role profile
 * tables (citizens/collectors/authorities/staff_profiles/credentials) cascade
 * automatically; tables that hold business history (requests, shipments,
 * invoices…) restrict the delete — callers should catch the FK violation
 * and offer disabling the account instead.
 */
export async function deleteUserById(db: DbOrTx, userId: string): Promise<boolean> {
  const res = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return res.length > 0;
}

export async function listUsers(
  db: DbOrTx,
  filter: { role?: Role; page: number; pageSize: number }
): Promise<{ items: UserRow[]; total: number }> {
  const where = filter.role ? eq(users.role, filter.role) : undefined;
  const items = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(sql`${users.createdAt} desc`)
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  return { items, total: countRow?.count ?? 0 };
}

// ── Credentials ──────────────────────────────────────────────────────────
export async function upsertCredential(
  db: DbOrTx,
  input: { userId: string; passwordHash: string }
): Promise<void> {
  const now = new Date();
  await db
    .insert(credentials)
    .values({
      userId: input.userId,
      passwordHash: input.passwordHash,
      passwordChangedAt: now,
      failedAttempts: 0,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: {
        passwordHash: input.passwordHash,
        passwordChangedAt: now,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: now
      }
    });
}

export async function getCredential(db: DbOrTx, userId: string) {
  const rows = await db.select().from(credentials).where(eq(credentials.userId, userId)).limit(1);
  return rows[0];
}

export async function recordFailedLogin(db: DbOrTx, userId: string, maxAttempts: number, lockMinutes: number): Promise<void> {
  await db
    .update(credentials)
    .set({
      failedAttempts: sql`${credentials.failedAttempts} + 1`,
      lockedUntil: sql`CASE WHEN ${credentials.failedAttempts} + 1 >= ${maxAttempts}
                        THEN now() + (${lockMinutes} || ' minutes')::interval ELSE ${credentials.lockedUntil} END`,
      updatedAt: new Date()
    })
    .where(eq(credentials.userId, userId));
}

export async function resetLoginFailures(db: DbOrTx, userId: string): Promise<void> {
  await db
    .update(credentials)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(credentials.userId, userId));
}

// ── Role profiles ────────────────────────────────────────────────────────
export async function attachCitizenProfile(
  db: DbOrTx,
  input: { userId: string; serviceAreaId: string; addressHint?: string | null }
): Promise<void> {
  await db.insert(citizens).values({
    userId: input.userId,
    serviceAreaId: input.serviceAreaId,
    addressHint: input.addressHint ?? null
  });
}

export async function attachCollectorProfile(
  db: DbOrTx,
  input: { userId: string; serviceAreaId: string; vehicleHint?: string | null }
): Promise<void> {
  await db.insert(collectors).values({
    userId: input.userId,
    serviceAreaId: input.serviceAreaId,
    vehicleHint: input.vehicleHint ?? null
  });
}

export async function attachAuthorityProfile(
  db: DbOrTx,
  input: { userId: string; serviceAreaId: string; jurisdictionNote?: string | null }
): Promise<void> {
  await db.insert(authorities).values({
    userId: input.userId,
    serviceAreaId: input.serviceAreaId,
    jurisdictionNote: input.jurisdictionNote ?? null
  });
}

export async function attachStaffProfile(
  db: DbOrTx,
  input: { userId: string; title?: string | null }
): Promise<void> {
  await db.insert(staffProfiles).values({ userId: input.userId, title: input.title ?? null });
}

export async function getServiceAreaForUser(
  db: DbOrTx,
  userId: string
): Promise<string | null> {
  const rows = await db
    .select({ areaId: citizens.serviceAreaId })
    .from(citizens)
    .where(eq(citizens.userId, userId))
    .limit(1);
  if (rows[0]) return rows[0].areaId;
  const cRows = await db
    .select({ areaId: collectors.serviceAreaId })
    .from(collectors)
    .where(eq(collectors.userId, userId))
    .limit(1);
  if (cRows[0]) return cRows[0].areaId;
  const aRows = await db
    .select({ areaId: authorities.serviceAreaId })
    .from(authorities)
    .where(eq(authorities.userId, userId))
    .limit(1);
  return aRows[0]?.areaId ?? null;
}

/**
 * Re-point an existing authority account at a different service area
 * (used by manager service-area management to "link" an area to an
 * authority account). Returns false if no authority profile exists for
 * that user id.
 */
export async function updateAuthorityServiceArea(
  db: DbOrTx,
  authorityUserId: string,
  serviceAreaId: string
): Promise<boolean> {
  const res = await db
    .update(authorities)
    .set({ serviceAreaId })
    .where(eq(authorities.userId, authorityUserId))
    .returning({ userId: authorities.userId });
  return res.length > 0;
}

/** All authority accounts currently linked to any of the given service areas. */
export async function listAuthoritiesForServiceAreas(
  db: DbOrTx,
  serviceAreaIds: string[]
): Promise<{ userId: string; serviceAreaId: string; displayName: string; email: string }[]> {
  if (serviceAreaIds.length === 0) return [];
  return db
    .select({
      userId: authorities.userId,
      serviceAreaId: authorities.serviceAreaId,
      displayName: users.displayName,
      email: users.email
    })
    .from(authorities)
    .innerJoin(users, eq(users.id, authorities.userId))
    .where(inArray(authorities.serviceAreaId, serviceAreaIds));
}

export async function countActiveUsersByRole(db: DbOrTx, role: Role): Promise<number> {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, role), eq(users.status, "active")));
  return countRow?.count ?? 0;
}
