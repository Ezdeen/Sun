/**
 * Identity module — HTTP surface (auth, invitations, accounts, audit).
 * Thin: validation (TypeBox) + permission guard + use-case call. No logic.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { login } from "../application/login.js";
import { refresh } from "../application/refresh.js";
import { logout, logoutAll } from "../application/logout.js";
import { changePassword } from "../application/change-password.js";
import { registerCitizen } from "../application/register-citizen.js";
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitationById
} from "../application/invitations.js";
import { acceptInvitationAndCreateUser } from "../application/accept-invitation.js";
import {
  createAccountByManager,
  updateAccountByManager,
  deleteAccountByManager
} from "../application/manage-accounts.js";
import { listUsers, updateUserStatus } from "../infrastructure/users-repo.js";
import {
  findActiveRefreshToken,
  listAuthEvents,
  recordAuthEvent,
  revokeAllUserRefreshTokens
} from "../infrastructure/sessions-repo.js";
import { sha256Hex } from "../domain/identity-hash.js";
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, type IdentityDeps } from "../application/deps.js";
import type { AuthGuards } from "../../../shared/http/middleware.js";
import { parsePageParams } from "../../../shared/http/pagination.js";
import { DomainError } from "../../../shared/errors.js";

const PageQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  role: Type.Optional(
    Type.Union([
      Type.Literal("citizen"), Type.Literal("collector"), Type.Literal("authority"),
      Type.Literal("sorter"), Type.Literal("finance"), Type.Literal("manager")
    ])
  )
});

const LoginBody = Type.Object({
  identifier: Type.String({ minLength: 3, maxLength: 120 }),
  password: Type.String({ minLength: 1, maxLength: 128 })
});

const ChangePasswordBody = Type.Object({
  currentPassword: Type.String({ minLength: 1, maxLength: 128 }),
  newPassword: Type.String({ minLength: 8, maxLength: 128 })
});

const RegisterCitizenBody = Type.Object({
  displayName: Type.String({ minLength: 2, maxLength: 80 }),
  email: Type.String({ format: "email", maxLength: 120 }),
  phone: Type.String({ minLength: 9, maxLength: 15 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
  idNumber: Type.String({ minLength: 9, maxLength: 9 }),
  serviceAreaId: Type.String({ format: "uuid" }),
  addressHint: Type.Optional(Type.String({ maxLength: 160 }))
});

const InvitationBody = Type.Object({
  email: Type.String({ format: "email", maxLength: 120 }),
  role: Type.Union([
    Type.Literal("collector"),
    Type.Literal("authority"),
    Type.Literal("sorter"),
    Type.Literal("finance"),
    Type.Literal("manager")
  ]),
  serviceAreaId: Type.Optional(Type.String({ format: "uuid" }))
});

const AcceptInvitationBody = Type.Object({
  token: Type.String({ minLength: 20, maxLength: 128 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
  displayName: Type.String({ minLength: 2, maxLength: 80 }),
  phone: Type.Optional(Type.String({ minLength: 9, maxLength: 15 }))
});

/** Manager creates ANY account directly — no invitation round-trip. */
const CreateAccountBody = Type.Object({
  displayName: Type.String({ minLength: 2, maxLength: 80 }),
  email: Type.String({ format: "email", maxLength: 120 }),
  phone: Type.Optional(Type.String({ minLength: 9, maxLength: 15 })),
  password: Type.String({ minLength: 8, maxLength: 128 }),
  role: Type.Union([
    Type.Literal("citizen"),
    Type.Literal("collector"),
    Type.Literal("authority"),
    Type.Literal("sorter"),
    Type.Literal("finance"),
    Type.Literal("manager")
  ]),
  serviceAreaId: Type.Optional(Type.String({ format: "uuid" }))
});

/** Manager edits an existing account's basic profile fields. */
const UpdateAccountBody = Type.Object({
  displayName: Type.Optional(Type.String({ minLength: 2, maxLength: 80 })),
  email: Type.Optional(Type.String({ format: "email", maxLength: 120 })),
  phone: Type.Optional(Type.String({ minLength: 9, maxLength: 15 })),
  password: Type.Optional(Type.String({ minLength: 8, maxLength: 128 }))
});

type LoginBodyT = Static<typeof LoginBody>;

export function registerIdentityRoutes(
  app: FastifyInstance,
  deps: IdentityDeps,
  guards: AuthGuards
): void {
  const cookieOpts = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: deps.settings.env === "production",
    path: REFRESH_COOKIE_PATH
  };

  const strict = (max = deps.settings.authRateLimitMax) => ({
    rateLimit: { max, timeWindow: "1 minute" }
  });

  app.post("/auth/login", { config: strict(), schema: { body: LoginBody } }, async (req, reply) => {
    const body = req.body as LoginBodyT;
    const result = await login(deps, {
      identifier: body.identifier,
      password: body.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null
    });
    void reply.setCookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      ...cookieOpts,
      maxAge: deps.settings.refreshTokenTtlDays * 86_400
    });
    return { accessToken: result.accessToken, user: result.user };
  });

  // Boot + several tabs call this; generous but still bounded.
  app.post("/auth/refresh", { config: strict(deps.settings.authRateLimitMax * 6) }, async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE_NAME];
    if (!raw) throw new DomainError("unauthorized", "refresh cookie missing", 401);
    const result = await refresh(deps, {
      refreshToken: raw,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null
    });
    void reply.setCookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      ...cookieOpts,
      maxAge: deps.settings.refreshTokenTtlDays * 86_400
    });
    return { accessToken: result.accessToken };
  });

  // Logout must work with the refresh cookie ALONE: by the time a user clicks
  // it the 15-min access token has often expired, and a logout that 401s
  // would leave the refresh token alive server-side.
  app.post("/auth/logout", async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE_NAME] ?? null;
    if (raw) {
      const row = await findActiveRefreshToken(deps.db, sha256Hex(raw));
      if (row) await logout(deps, { refreshToken: raw, userId: row.userId, ip: req.ip });
    }
    void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return { ok: true };
  });

  app.post("/auth/logout-all", { onRequest: guards.requireAuth }, async (req, reply) => {
    const revoked = await logoutAll(deps, { userId: req.authUser!.id, ip: req.ip });
    void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return { ok: true, revokedSessions: revoked };
  });

  app.get("/auth/me", { onRequest: guards.requireAuth }, async (req) => {
    const u = req.authUser!;
    return { id: u.id, role: u.role, displayName: u.displayName, permissions: [...u.permissions] };
  });

  app.post(
    "/auth/change-password",
    { onRequest: guards.requireAuth, config: strict(), schema: { body: ChangePasswordBody } },
    async (req, reply) => {
      const body = req.body as Static<typeof ChangePasswordBody>;
      await changePassword(deps, {
        userId: req.authUser!.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword
      });
      void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return { ok: true };
    }
  );

  app.post(
    "/auth/invitations/accept",
    { config: strict(), schema: { body: AcceptInvitationBody } },
    async (req) => {
      const body = req.body as Static<typeof AcceptInvitationBody>;
      const result = await acceptInvitationAndCreateUser(deps, {
        token: body.token,
        password: body.password,
        displayName: body.displayName,
        phone: body.phone ?? null
      });
      return { userId: result.userId };
    }
  );

  app.post("/citizens/register", { config: strict(), schema: { body: RegisterCitizenBody } }, async (req) => {
    const body = req.body as Static<typeof RegisterCitizenBody>;
    const result = await registerCitizen(deps, {
      displayName: body.displayName,
      email: body.email,
      phone: body.phone,
      password: body.password,
      idNumber: body.idNumber,
      serviceAreaId: body.serviceAreaId,
      addressHint: body.addressHint ?? null
    });
    return { userId: result.userId };
  });

  // ── Manager-only surface ───────────────────────────────────────────
  app.post(
    "/admin/invitations",
    { onRequest: guards.requirePermission("account:manage"), schema: { body: InvitationBody } },
    async (req) => {
      const body = req.body as Static<typeof InvitationBody>;
      return createInvitation(deps, {
        email: body.email,
        role: body.role,
        invitedBy: req.authUser!.id,
        serviceAreaId: body.serviceAreaId ?? null
      });
    }
  );

  app.get(
    "/admin/invitations",
    { onRequest: guards.requirePermission("account:manage"), schema: { querystring: PageQuery } },
    async (req) => {
      const p = parsePageParams(req.query as Record<string, unknown>);
      const result = await listPendingInvitations(deps, p.page, p.pageSize);
      return {
        items: result.items.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          status: i.status,
          expiresAt: i.expiresAt,
          createdAt: i.createdAt
        })),
        page: p.page,
        pageSize: p.pageSize,
        total: result.total
      };
    }
  );

  app.delete(
    "/admin/invitations/:id",
    { onRequest: guards.requirePermission("account:manage") },
    async (req) => {
      const { id } = req.params as { id: string };
      await revokeInvitationById(deps, id);
      return { ok: true };
    }
  );

  app.get(
    "/admin/accounts",
    { onRequest: guards.requirePermission("account:manage"), schema: { querystring: PageQuery } },
    async (req) => {
      const q = req.query as Record<string, unknown>;
      const p = parsePageParams(q);
      const role = typeof q["role"] === "string" ? (q["role"] as never) : undefined;
      const result = await listUsers(deps.db, { role, page: p.page, pageSize: p.pageSize });
      return {
        items: result.items.map((u) => ({
          id: u.id,
          role: u.role,
          displayName: u.displayName,
          email: u.email,
          phone: u.phone,
          status: u.status,
          createdAt: u.createdAt
        })),
        page: p.page,
        pageSize: p.pageSize,
        total: result.total
      };
    }
  );

  /** Manager: create an account directly (any role), no invitation needed. */
  app.post(
    "/admin/accounts",
    { onRequest: guards.requirePermission("account:manage"), schema: { body: CreateAccountBody } },
    async (req, reply) => {
      const b = req.body as Static<typeof CreateAccountBody>;
      const result = await createAccountByManager(deps, {
        displayName: b.displayName,
        email: b.email,
        phone: b.phone ?? null,
        password: b.password,
        role: b.role,
        serviceAreaId: b.serviceAreaId ?? null,
        createdBy: req.authUser!.id
      });
      void reply.status(201);
      return result;
    }
  );

  /** Manager: edit an existing account's display name / email / phone / password. */
  app.patch(
    "/admin/accounts/:id",
    { onRequest: guards.requirePermission("account:manage"), schema: { body: UpdateAccountBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const b = req.body as Static<typeof UpdateAccountBody>;
      const updated = await updateAccountByManager(
        deps,
        id,
        { displayName: b.displayName, email: b.email, phone: b.phone, password: b.password },
        req.authUser!.id
      );
      return {
        id: updated.id,
        role: updated.role,
        displayName: updated.displayName,
        email: updated.email,
        phone: updated.phone,
        status: updated.status
      };
    }
  );

  /** Manager: permanently delete an account (blocked if it has business history). */
  app.delete(
    "/admin/accounts/:id",
    { onRequest: guards.requirePermission("account:manage") },
    async (req) => {
      const { id } = req.params as { id: string };
      await deleteAccountByManager(deps, id, req.authUser!.id);
      return { ok: true };
    }
  );

  app.patch(
    "/admin/accounts/:id/status",
    {
      onRequest: guards.requirePermission("account:manage"),
      schema: {
        body: Type.Object({
          status: Type.Union([Type.Literal("active"), Type.Literal("disabled")])
        })
      }
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as { status: "active" | "disabled" };
      if (id === req.authUser!.id) {
        throw new DomainError("conflict", "cannot change own account status", 409);
      }
      const updated = await updateUserStatus(deps.db, id, body.status);
      if (!updated) throw new DomainError("not_found", "user not found", 404);
      if (body.status === "disabled") {
        await revokeAllUserRefreshTokens(deps.db, id, "account_disabled");
      }
      await recordAuthEvent(deps.db, {
        id: randomUUID(),
        userId: id,
        eventType: "account_status_changed",
        details: { newStatus: body.status, by: req.authUser!.id }
      });
      return { id: updated.id, status: updated.status };
    }
  );

  app.get(
    "/admin/audit",
    { onRequest: guards.requirePermission("account:manage"), schema: { querystring: PageQuery } },
    async (req) => {
      const p = parsePageParams(req.query as Record<string, unknown>);
      const result = await listAuthEvents(deps.db, {
        page: p.page,
        pageSize: p.pageSize
      });
      return {
        items: result.items,
        page: p.page,
        pageSize: p.pageSize,
        total: result.total
      };
    }
  );
}
