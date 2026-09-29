/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SECURITY SUITE — sessions, role separation, object-level isolation.
 * Runs in-process against a REAL PostgreSQL (needs DATABASE_URL + demo seed):
 *   pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo && pnpm test:security
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/main.js";
import { closeDb, getDb } from "../../src/shared/db/client.js";
import { loadSettings } from "../../src/settings.js";

const DEMO_PASSWORD = "Demo@12345!";
const STRONG = "Str0ng!Passw0rd";
const RUN = Date.now().toString(36);

let app: FastifyInstance;
let seq = 0;

interface Session {
  token: string;
  cookie: string;
  userId: string;
}

async function call(
  method: string,
  url: string,
  opts: { token?: string; cookie?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.cookie) headers["cookie"] = `waste_refresh=${opts.cookie}`;
  const res = await app.inject({
    method: method as never,
    url: `/api/v1${url}`,
    headers,
    payload: opts.body as never
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    /* empty body */
  }
  return {
    status: res.statusCode,
    json,
    cookie: res.cookies.find((c) => c.name === "waste_refresh")?.value
  };
}

async function login(identifier: string, password = DEMO_PASSWORD): Promise<Session> {
  const r = await call("POST", "/auth/login", { body: { identifier, password } });
  if (r.status !== 200) throw new Error(`login ${identifier} → ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.accessToken, cookie: r.cookie!, userId: r.json.user.id };
}

let manager: Session;

async function createUser(role: string, serviceAreaId?: string) {
  const email = `sec.${role}.${RUN}.${++seq}@example.test`;
  const r = await call("POST", "/admin/accounts", {
    token: manager.token,
    body: { displayName: `اختبار ${role}`, email, password: STRONG, role, serviceAreaId }
  });
  if (r.status !== 201) throw new Error(`createUser ${role} → ${r.status} ${JSON.stringify(r.json)}`);
  return { id: r.json.userId as string, email };
}

beforeAll(async () => {
  // High limit here: this suite logs in dozens of times from one address.
  // The limiter itself is exercised by dedicated apps in the last describe.
  ({ app } = await createApp({ settings: { ...loadSettings(), authRateLimitMax: 100_000 } }));
  await app.ready();
  manager = await login("demo.manager@example.test");
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

// ─────────────────────────────────────────────────────────────────────────
describe("sessions — revocation must take effect immediately", () => {
  it("a disabled account's live access token is rejected at once", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(200);

    const dis = await call("PATCH", `/admin/accounts/${u.id}/status`, {
      token: manager.token,
      body: { status: "disabled" }
    });
    expect(dis.status).toBe(200);

    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(401);
    expect((await call("GET", "/finance/ledger", { token: s.token })).status).toBe(401);
    expect((await call("POST", "/auth/refresh", { cookie: s.cookie })).status).toBe(401);
  });

  it("logout invalidates the access token, not only the refresh token", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    const out = await call("POST", "/auth/logout", { token: s.token, cookie: s.cookie });
    expect(out.status).toBe(200);
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(401);
    expect((await call("POST", "/auth/refresh", { cookie: s.cookie })).status).toBe(401);
  });

  it("logout still works when the access token already expired (cookie only)", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    const out = await call("POST", "/auth/logout", { cookie: s.cookie }); // no Authorization header
    expect(out.status).toBe(200);
    expect((await call("POST", "/auth/refresh", { cookie: s.cookie })).status).toBe(401);
  });

  it("logout-all kills every other session's access token", async () => {
    const u = await createUser("finance");
    const a = await login(u.email, STRONG);
    const b = await login(u.email, STRONG);
    expect((await call("POST", "/auth/logout-all", { token: a.token })).status).toBe(200);
    expect((await call("GET", "/auth/me", { token: b.token })).status).toBe(401);
    expect((await call("POST", "/auth/refresh", { cookie: b.cookie })).status).toBe(401);
  });

  it("changing the password kills existing access tokens", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    const other = await login(u.email, STRONG);
    const r = await call("POST", "/auth/change-password", {
      token: s.token,
      body: { currentPassword: STRONG, newPassword: "N3w!Passw0rd#x" }
    });
    expect(r.status).toBe(200);
    expect((await call("GET", "/auth/me", { token: other.token })).status).toBe(401);
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(401);
  });

  it("a manager resetting someone's password revokes that user's sessions", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    const r = await call("PATCH", `/admin/accounts/${u.id}`, {
      token: manager.token,
      body: { password: "Reset!Passw0rd#1" }
    });
    expect(r.status).toBe(200);
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(401);
    expect((await call("POST", "/auth/refresh", { cookie: s.cookie })).status).toBe(401);
    await expect(login(u.email, "Reset!Passw0rd#1")).resolves.toBeTruthy();
  });

  it("a role changed in the database is not honoured from a stale token", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    expect((await call("GET", "/finance/ledger", { token: s.token })).status).toBe(200);
    const db = getDb(loadSettings().databaseUrl);
    await db.execute(sql`UPDATE app.users SET role = 'citizen' WHERE id = ${u.id}`);
    expect((await call("GET", "/finance/ledger", { token: s.token })).status).toBe(401);
  });

  it("/auth/me reports fresh server-side state (name), not token contents", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    await call("PATCH", `/admin/accounts/${u.id}`, {
      token: manager.token,
      body: { displayName: "اسم جديد" }
    });
    const me = await call("GET", "/auth/me", { token: s.token });
    expect(me.status).toBe(200);
    expect(me.json.displayName).toBe("اسم جديد");
    expect(me.json.role).toBe("finance");
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("refresh tokens — atomic single-use rotation, strict reuse detection", () => {
  it("two concurrent refreshes with one cookie never produce two live descendants", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    const [r1, r2] = await Promise.all([
      call("POST", "/auth/refresh", { cookie: s.cookie }),
      call("POST", "/auth/refresh", { cookie: s.cookie })
    ]);
    // Fail safe: a second holder of one token is indistinguishable from theft.
    expect([r1, r2].filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    const db = getDb(loadSettings().databaseUrl);
    const live = await db.execute(
      sql`SELECT count(*)::int AS n FROM app.refresh_tokens
           WHERE user_id = ${u.id} AND revoked_at IS NULL`
    );
    expect((live.rows[0] as { n: number }).n).toBeLessThanOrEqual(1);
  });

  it("replaying a rotated token revokes ALL sessions of the user (theft signal)", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    const other = await login(u.email, STRONG);
    const rotated = await call("POST", "/auth/refresh", { cookie: s.cookie });
    expect(rotated.status).toBe(200);
    const replay = await call("POST", "/auth/refresh", { cookie: s.cookie });
    expect(replay.status).toBe(401);
    expect(replay.json.code).toBe("refresh_reuse_detected");
    expect((await call("POST", "/auth/refresh", { cookie: rotated.cookie })).status).toBe(401);
    expect((await call("POST", "/auth/refresh", { cookie: other.cookie })).status).toBe(401);
    expect((await call("GET", "/auth/me", { token: rotated.json.accessToken })).status).toBe(401);
  });

  it("replaying a LOGGED-OUT cookie is a plain 401 and does not sign out other devices", async () => {
    const u = await createUser("finance");
    const a = await login(u.email, STRONG);
    const b = await login(u.email, STRONG);
    await call("POST", "/auth/logout", { cookie: a.cookie });
    const stale = await call("POST", "/auth/refresh", { cookie: a.cookie });
    expect(stale.status).toBe(401);
    expect(stale.json.code).not.toBe("refresh_reuse_detected");
    expect((await call("GET", "/auth/me", { token: b.token })).status).toBe(200);
  });

  it("an old access token dies when its rotated chain is later logged out", async () => {
    const u = await createUser("finance");
    const s = await login(u.email, STRONG);
    const rotated = await call("POST", "/auth/refresh", { cookie: s.cookie });
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(200); // pre-rotation token still fine
    await call("POST", "/auth/logout", { cookie: rotated.cookie });
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(401); // …but not after logout
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("role separation — HTTP level (role × endpoint)", () => {
  const ROLES = ["citizen", "collector", "authority", "sorter", "finance", "manager"] as const;
  // Independent statement of intent — NOT derived from ROLE_PERMISSIONS.
  const MATRIX: Record<string, readonly (typeof ROLES)[number][]> = {
    "/admin/accounts": ["manager"],
    "/admin/audit": ["manager"],
    "/admin/settings": ["manager"],
    "/admin/service-areas": ["manager"],
    "/admin/waste-types": ["manager"],
    "/admin/invitations": ["manager"],
    "/shipments": ["sorter", "finance", "manager"],
    "/invoices": ["finance", "manager"],
    "/finance/ledger": ["finance", "manager"],
    "/payouts": ["finance", "manager"],
    "/me/payouts": ["citizen", "collector"],
    "/collector/schedule": ["collector", "manager"],
    "/requests": [...ROLES],
    "/citizen/dashboard": ["citizen"],
    "/collector/dashboard": ["collector"],
    "/authority/dashboard": ["authority"],
    "/sorter/dashboard": ["sorter"],
    "/finance/dashboard": ["finance"],
    "/manager/dashboard": ["manager"]
  };
  const sessions = new Map<string, Session>();

  beforeAll(async () => {
    for (const r of ROLES) sessions.set(r, await login(`demo.${r}@example.test`));
  });

  for (const [path, allowed] of Object.entries(MATRIX)) {
    it(`GET ${path}: anonymous→401, allowed=[${allowed.join(",")}], everyone else→403`, async () => {
      expect((await call("GET", path)).status).toBe(401);
      for (const role of ROLES) {
        const res = await call("GET", path, { token: sessions.get(role)!.token });
        if (allowed.includes(role)) {
          expect(res.status, `${role} should reach ${path}`).toBe(200);
        } else {
          expect(res.status, `${role} must NOT reach ${path}`).toBe(403);
        }
      }
    });
  }

  it("guards run BEFORE body validation: no schema details leak to the unauthorised", async () => {
    const anon = await call("POST", "/admin/waste-types", { body: {} });
    expect(anon.status).toBe(401);
    const citizen = await call("POST", "/admin/waste-types", {
      token: sessions.get("citizen")!.token,
      body: {}
    });
    expect(citizen.status).toBe(403);
    expect(JSON.stringify(citizen.json)).not.toMatch(/must have required|validation/i);
  });

  it("privileged writes are closed to non-managers", async () => {
    const attempts: [string, string, unknown][] = [
      ["POST", "/admin/accounts", { displayName: "x y", email: `a${RUN}@example.test`, password: STRONG, role: "manager" }],
      ["PATCH", "/admin/settings", {}],
      ["POST", "/admin/invitations", { email: `i${RUN}@example.test`, role: "manager" }],
      ["POST", "/admin/waste-types", {}]
    ];
    for (const role of ["citizen", "collector", "authority", "sorter", "finance"] as const) {
      for (const [m, p, b] of attempts) {
        const res = await call(m, p, { token: sessions.get(role)!.token, body: b });
        expect(res.status, `${role} ${m} ${p}`).toBe(403);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("object-level isolation (IDOR)", () => {
  let citizenA: Session;
  let requestId: string;
  let requestAreaId: string;
  let otherAreaId: string;

  beforeAll(async () => {
    citizenA = await login("demo.citizen@example.test");
    const created = await call("POST", "/requests", {
      token: citizenA.token,
      body: { lines: [{ wasteTypeCode: "PET_2L", quantity: "10" }] }
    });
    expect(created.status).toBe(200);
    requestId = created.json.requestId ?? created.json.id ?? created.json.request?.id;
    expect(requestId).toBeTruthy();

    const detail = await call("GET", `/requests/${requestId}`, { token: manager.token });
    requestAreaId = detail.json.request.serviceAreaId;
    const areas = await call("GET", "/admin/service-areas", { token: manager.token });
    otherAreaId = areas.json.items.find((a: any) => a.id !== requestAreaId).id;
  });

  it("another citizen cannot read or list someone else's request (404, not 403)", async () => {
    const u = await createUser("citizen", requestAreaId);
    const b = await login(u.email, STRONG);
    expect((await call("GET", `/requests/${requestId}`, { token: b.token })).status).toBe(404);
    const list = await call("GET", "/requests?page=1&pageSize=100", { token: b.token });
    expect(list.status).toBe(200);
    expect(list.json.items.map((i: any) => i.id)).not.toContain(requestId);
  });

  it("another citizen cannot transition someone else's request", async () => {
    const u = await createUser("citizen", requestAreaId);
    const b = await login(u.email, STRONG);
    const r = await call("POST", `/requests/${requestId}/transitions`, {
      token: b.token,
      body: { target: "sent_to_collector", expectedVersion: 1 }
    });
    expect([403, 404]).toContain(r.status);
  });

  it("an authority of ANOTHER area cannot see or act on the request", async () => {
    const u = await createUser("authority", otherAreaId);
    const a = await login(u.email, STRONG);
    expect((await call("GET", `/requests/${requestId}`, { token: a.token })).status).toBe(404);
    const t = await call("POST", `/requests/${requestId}/transitions`, {
      token: a.token,
      body: { target: "sent_to_collector", expectedVersion: 1 }
    });
    expect(t.status).toBe(404);
    const list = await call("GET", "/requests?page=1&pageSize=100", { token: a.token });
    expect(list.json.items.map((i: any) => i.id)).not.toContain(requestId);
  });

  it("a collector cannot see a request that is not in their queue", async () => {
    const u = await createUser("collector", otherAreaId);
    const c = await login(u.email, STRONG);
    expect((await call("GET", `/requests/${requestId}`, { token: c.token })).status).toBe(404);
  });

  it("anonymous callers get 401 on request detail", async () => {
    expect((await call("GET", `/requests/${requestId}`)).status).toBe(401);
  });

  it("the public tracking endpoint exposes no identities or money", async () => {
    const detail = await call("GET", `/requests/${requestId}`, { token: citizenA.token });
    const hash = detail.json.request.combinedHash;
    expect(hash).toBeTruthy();
    const t = await call("GET", `/track/${hash}`);
    expect(t.status).toBe(200);
    const blob = JSON.stringify(t.json);
    expect(blob).not.toMatch(/demo\.citizen|@example|phone|weight|amount|citizenUserId/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("transport & abuse controls", () => {
  it("authenticated API responses are never cacheable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${manager.token}` }
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    const bad = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(bad.headers["cache-control"]).toBe("no-store");
  });

  it("the refresh cookie is HttpOnly + SameSite=Strict, scoped to /api/v1/auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifier: "demo.citizen@example.test", password: DEMO_PASSWORD }
    });
    const c = String(res.headers["set-cookie"]);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\/api\/v1\/auth/);
  });

  it("login is rate-limited per client IP", async () => {
    const { app: limited } = await createApp({
      settings: { ...loadSettings(), authRateLimitMax: 3 }
    });
    await limited.ready();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await limited.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { identifier: `nobody${i}@example.test`, password: "x" }
      });
      codes.push(r.statusCode);
    }
    await limited.close();
    expect(codes.slice(0, 3).every((c) => c === 401)).toBe(true);
    expect(codes.slice(3).every((c) => c === 429)).toBe(true);
  });

  it("behind a trusted proxy each client IP gets its OWN rate-limit bucket", async () => {
    const { app: proxied } = await createApp({
      settings: { ...loadSettings(), authRateLimitMax: 2, trustProxyHops: 1 }
    });
    await proxied.ready();
    const hit = (ip: string) =>
      proxied.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "x-forwarded-for": ip },
        payload: { identifier: "nobody@example.test", password: "x" }
      });
    await hit("203.0.113.1");
    await hit("203.0.113.1");
    expect((await hit("203.0.113.1")).statusCode).toBe(429); // client 1 exhausted
    expect((await hit("203.0.113.2")).statusCode).toBe(401); // client 2 unaffected
    await proxied.close();
  });

  it("WITHOUT trusted hops a spoofed X-Forwarded-For cannot dodge the limit", async () => {
    const { app: direct } = await createApp({
      settings: { ...loadSettings(), authRateLimitMax: 2, trustProxyHops: 0 }
    });
    await direct.ready();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await direct.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "x-forwarded-for": `198.51.100.${i}` },
        payload: { identifier: "nobody@example.test", password: "x" }
      });
      codes.push(r.statusCode);
    }
    await direct.close();
    expect(codes.slice(2)).toEqual([429, 429]);
  });
});
