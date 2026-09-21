/**
 * Session context — access token in memory only (never localStorage).
 * On boot, attempts silent refresh to restore the session.
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const setAccessToken = useCallback((t: string | null) => {
    tokenRef.current = t;
    if (t === null) setUser(null);
  }, []);

  const getAccessToken = useCallback(() => tokenRef.current, []);

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

  const logout = useCallback(async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: tokenRef.current ? { authorization: `Bearer ${tokenRef.current}` } : {}
      });
    } catch {
      // best-effort — cookie cleared server-side; ignore network errors
    }
    tokenRef.current = null;
    setUser(null);
  }, []);

  // Silent session restore on boot (refresh cookie → access token → /auth/me).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/auth/refresh", { method: "POST" });
        if (res.ok) {
          const body = (await res.json()) as { accessToken?: string };
          if (body.accessToken && !cancelled) {
            tokenRef.current = body.accessToken;
            const me = await fetch("/api/v1/auth/me", {
              headers: { authorization: `Bearer ${body.accessToken}` }
            });
            if (me.ok) {
              const meBody = (await me.json()) as { id: string; role: Role; permissions: string[] };
              if (!cancelled) {
                setUser({ id: meBody.id, role: meBody.role, permissions: meBody.permissions });
              }
            }
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
