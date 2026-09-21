/**
 * Typed API client — generated from the committed OpenAPI contract.
 * Access token lives in MEMORY ONLY; refresh travels in an HttpOnly cookie
 * (same origin). On 401 we transparently refresh once and retry.
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

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/auth/refresh", { method: "POST" });
    if (!res.ok) return null;
    const body = (await res.json()) as { accessToken?: string };
    return body.accessToken ?? null;
  } catch {
    return null;
  }
}

const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = sessionRef?.getAccessToken();
    if (token) {
      request.headers.set("authorization", `Bearer ${token}`);
    }
    return request;
  },
  onResponse({ request, response }) {
    // Transparent single retry after refresh on 401 (only for API calls).
    if (response.status === 401 && !request.headers.has("x-retried")) {
      return (async () => {
        const token = await refreshAccessToken();
        if (!token) return response;
        sessionRef?.setAccessToken(token);
        const retry = request.clone();
        retry.headers.set("authorization", `Bearer ${token}`);
        retry.headers.set("x-retried", "1");
        return fetch(retry);
      })();
    }
    return undefined;
  }
};

export const api = createClient<paths>({ baseUrl: "/api/v1" });
api.use(authMiddleware);

export function apiFetch(): typeof fetch {
  return globalThis.fetch;
}
