import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("./client.js");

/** Fake backend: /auth/refresh hands out "fresh"; data routes accept only "fresh". */
function installBackend(opts: { refreshOk?: boolean; fresh401?: boolean } = {}) {
  const refreshOk = opts.refreshOk ?? true;
  const calls = { refresh: 0, data: 0, retriedBodies: [] as string[] };
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const isReq = typeof input === "object" && input !== null && "url" in input && "headers" in input;
    const req = isReq ? (input as Request) : new Request(new URL(String(input), "http://localhost"), init);
    const url = new URL(req.url);
    if (url.pathname === "/api/v1/auth/refresh") {
      calls.refresh++;
      await new Promise((r) => setTimeout(r, 15)); // keep the refresh in flight
      return refreshOk
        ? new Response(JSON.stringify({ accessToken: "fresh" }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    calls.data++;
    const ok = req.headers.get("authorization") === "Bearer fresh" && !opts.fresh401;
    if (ok && req.method !== "GET") calls.retriedBodies.push(await req.text());
    return ok ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : new Response("{}", { status: 401 });
  });
  return { fake, calls };
}

async function load(fake: ReturnType<typeof installBackend>["fake"]) {
  vi.resetModules();
  vi.stubGlobal("fetch", fake);
  // openapi-fetch builds `new Request(relativeUrl)`, which Node rejects: resolve against localhost.
  const Native = globalThis.Request;
  vi.stubGlobal(
    "Request",
    class extends Native {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, "http://localhost").href : input, init);
      }
    }
  );
  const client: Client = await import("./client.js");
  let token: string | null = "stale";
  const session = {
    getAccessToken: () => token,
    setAccessToken: vi.fn((t: string | null) => {
      token = t;
    })
  };
  client.bindSession(session);
  return { client, session };
}

describe("api client — refresh discipline", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it("ten simultaneous 401s trigger exactly ONE refresh (single-flight)", async () => {
    const { fake, calls } = installBackend();
    const { client, session } = await load(fake);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => client.authFetch("/api/v1/auth/me"))
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(calls.refresh).toBe(1);
    expect(session.setAccessToken).toHaveBeenCalledWith("fresh");
  });

  it("typed-client requests also share the single refresh", async () => {
    const { fake, calls } = installBackend();
    const { client } = await load(fake);
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => client.api.GET("/catalog" as never))
    );
    expect(rs.every((r) => r.response.status === 200)).toBe(true);
    expect(calls.refresh).toBe(1);
  });

  it("a POST with a body is retried intact after refresh", async () => {
    const { fake, calls } = installBackend();
    const { client } = await load(fake);
    const r = await client.api.POST("/requests" as never, { body: { hello: "world" } } as never);
    expect(r.response.status).toBe(200);
    expect(calls.retriedBodies).toEqual([JSON.stringify({ hello: "world" })]);
  });

  it("when refresh fails the session is ended (guards can redirect to /login)", async () => {
    const { fake } = installBackend({ refreshOk: false });
    const { client, session } = await load(fake);
    const r = await client.authFetch("/api/v1/auth/me");
    expect(r.status).toBe(401);
    expect(session.setAccessToken).toHaveBeenCalledWith(null);
  });

  it("a fresh token that is STILL refused (disabled / revoked) also ends the session", async () => {
    const { fake } = installBackend({ fresh401: true });
    const { client, session } = await load(fake);
    const r = await client.authFetch("/api/v1/auth/me");
    expect(r.status).toBe(401);
    expect(session.setAccessToken).toHaveBeenLastCalledWith(null);
  });

  it("a later 401 starts a NEW refresh (the in-flight slot is released)", async () => {
    const { fake, calls } = installBackend();
    const { client } = await load(fake);
    await client.refreshAccessToken();
    await client.refreshAccessToken();
    expect(calls.refresh).toBe(2);
  });
});
