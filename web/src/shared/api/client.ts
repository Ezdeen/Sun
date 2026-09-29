/**
 * Typed API client — generated from the committed OpenAPI contract.
 * Access token lives in MEMORY ONLY; refresh travels in an HttpOnly cookie
 * (same origin).
 *
 * Refresh discipline (matters for security, not just tidiness): the server
 * treats a second use of a rotated refresh token as THEFT and revokes every
 * session of the user. So the client must never have two refreshes in flight
 *   • in one tab  → single-flight promise shared by all callers, and
 *   • across tabs → Web Locks, so tabs refresh one after another.
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema.js";

export interface SessionApi {
  getAccessToken(): string | null;
  setAccessToken(token: string | null): void;
}

let sessionRef: SessionApi | null = null;

export function bindSession(session: SessionApi): void {
  sessionRef = session;
}

let inflight: Promise<string | null> | null = null;

async function callRefreshEndpoint(): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/auth/refresh", { method: "POST" });
    if (!res.ok) return null;
    const body = (await res.json()) as { accessToken?: string };
    return body.accessToken ?? null;
  } catch {
    return null;
  }
}

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return fn();
  return locks.request("waste-auth-refresh", fn) as Promise<T>;
}

/** Resolves to a fresh access token, or null when the session is gone. */
export function refreshAccessToken(): Promise<string | null> {
  inflight ??= exclusive(callRefreshEndpoint).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** The refresh failed: the session is over — drop it so guards redirect to /login. */
function expireSession(): void {
  sessionRef?.setAccessToken(null);
}

// A Request body can be read once; keep a pristine clone so a retry after
// refresh also works for POST/PATCH (otherwise: "Body is unusable").
const retryCopies = new WeakMap<Request, Request>();

const authMiddleware: Middleware = {
  onRequest({ request }) {
    retryCopies.set(request, request.clone());
    const token = sessionRef?.getAccessToken();
    if (token) request.headers.set("authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    const pristine = retryCopies.get(request);
    retryCopies.delete(request);
    if (response.status !== 401 || !pristine) return undefined;

    const token = await refreshAccessToken();
    if (!token) {
      expireSession();
      return response;
    }
    sessionRef?.setAccessToken(token);
    pristine.headers.set("authorization", `Bearer ${token}`);
    const retried = await fetch(pristine);
    if (retried.status === 401) expireSession(); // fresh token still refused → revoked/disabled
    return retried;
  }
};

export const api = createClient<paths>({ baseUrl: "/api/v1" });
api.use(authMiddleware);

/** fetch() with the same token + refresh-once behaviour, for endpoints outside the typed client. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const attempt = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  };
  const res = await attempt(sessionRef?.getAccessToken() ?? null);
  if (res.status !== 401) return res;
  const token = await refreshAccessToken();
  if (!token) {
    expireSession();
    return res;
  }
  sessionRef?.setAccessToken(token);
  const retried = await attempt(token);
  if (retried.status === 401) expireSession();
  return retried;
}

export function apiFetch(): typeof fetch {
  return globalThis.fetch;
}
