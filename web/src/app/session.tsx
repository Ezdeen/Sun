/**
 * Session context — access token in memory only (never localStorage).
 * On boot, attempts silent refresh to restore the session.
 *
 * Live session: while signed in we re-read /auth/me every HEARTBEAT_MS (and
 * on tab focus / network return). The server answers from the database, so a
 * disabled account, a revoked session or a changed role is noticed within
 * seconds and the route guards react on their own — no manual reload.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { authFetch, bindSession, refreshAccessToken } from "../shared/api/client.js";

export type Role = "citizen" | "collector" | "authority" | "sorter" | "finance" | "manager";

export interface CurrentUser {
  id: string;
  role: Role;
  displayName?: string;
  permissions: string[];
}

interface SessionState {
  user: CurrentUser | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | null;
  setAccessToken: (t: string | null) => void;
}

const SessionContext = createContext<SessionState | null>(null);

const HEARTBEAT_MS = 30_000;
const CHANNEL = "waste-auth";

function sameUser(a: CurrentUser, b: CurrentUser): boolean {
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.displayName === b.displayName &&
    a.permissions.length === b.permissions.length &&
    a.permissions.every((p, i) => p === b.permissions[i])
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const setAccessToken = useCallback((t: string | null) => {
    tokenRef.current = t;
    if (t === null) setUser(null);
  }, []);

  const getAccessToken = useCallback(() => tokenRef.current, []);

  bindSession({ getAccessToken, setAccessToken });

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, password })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(body?.detail ?? "تعذر تسجيل الدخول");
    }
    const body = (await res.json()) as {
      accessToken: string;
      user: { id: string; role: Role; displayName: string; permissions: string[] };
    };
    tokenRef.current = body.accessToken;
    setUser({
      id: body.user.id,
      role: body.user.role,
      displayName: body.user.displayName,
      permissions: body.user.permissions
    });
  }, []);

  const channelRef = useRef<BroadcastChannel | null>(null);

  const logout = useCallback(async () => {
    try {
      // Cookie alone is enough server-side (works even with an expired token).
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // best-effort — cookie cleared server-side; ignore network errors
    }
    tokenRef.current = null;
    setUser(null);
    channelRef.current?.postMessage({ type: "logout" });
  }, []);

  // Sign the other tabs out too (their session was just revoked server-side).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === "logout") {
        tokenRef.current = null;
        setUser(null);
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // Silent session restore on boot (refresh cookie → access token → /auth/me).
  // refreshAccessToken() is single-flight, so React StrictMode's double
  // effect cannot fire two refreshes with one cookie (which the server would
  // read as token theft and answer by revoking every session).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await refreshAccessToken();
        if (token && !cancelled) {
          tokenRef.current = token;
          const me = await authFetch("/api/v1/auth/me");
          if (me.ok && !cancelled) {
            const b = (await me.json()) as CurrentUser;
            setUser({ id: b.id, role: b.role, displayName: b.displayName, permissions: b.permissions });
          }
        }
      } catch {
        // no session — fine
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Heartbeat: keep role / status / name in step with the server.
  const signedIn = user !== null;
  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    const check = async () => {
      if (stopped || !tokenRef.current || document.visibilityState === "hidden") return;
      try {
        const res = await authFetch("/api/v1/auth/me");
        if (!res.ok || stopped || !tokenRef.current) return; // 401 already ended the session
        const b = (await res.json()) as CurrentUser;
        const next: CurrentUser = {
          id: b.id,
          role: b.role,
          displayName: b.displayName,
          permissions: b.permissions
        };
        setUser((prev) => (prev && sameUser(prev, next) ? prev : next));
      } catch {
        // offline / transient — try again on the next beat
      }
    };
    const timer = setInterval(() => void check(), HEARTBEAT_MS);
    const wake = () => void check();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [signedIn]);

  const value = useMemo(
    () => ({ user, ready, login, logout, getAccessToken, setAccessToken }),
    [user, ready, login, logout, getAccessToken, setAccessToken]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
