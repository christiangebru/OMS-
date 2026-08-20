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
import { apiJson, ApiError } from "@/lib/api";
import { AUTH_RESTORE_TIMEOUT_MS } from "@/lib/fetchTimeout.js";
import { planAuthRestore } from "@/lib/authRestore.js";
import type { AuthUser } from "@/lib/types";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  sessionError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: (message?: string) => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("token")));
  const [sessionError, setSessionError] = useState<string | null>(null);
  const restoreGen = useRef(0);

  const logout = useCallback((message?: string) => {
    restoreGen.current += 1;
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    setLoading(false);
    if (typeof message === "string" && message) setSessionError(message);
  }, []);

  const refreshMe = useCallback(async () => {
    const gen = ++restoreGen.current;
    const t = localStorage.getItem("token");
    if (!t) {
      const planned = planAuthRestore({ token: null });
      setUser(planned.user);
      setLoading(planned.loading);
      return;
    }
    try {
      const data = await apiJson<{ user: AuthUser }>("/api/auth/me", {
        timeoutMs: AUTH_RESTORE_TIMEOUT_MS,
        skipAuthRedirect: true
      });
      if (gen !== restoreGen.current) return;
      const planned = planAuthRestore({ token: t, result: { ok: true, user: data.user } });
      setUser(planned.user as AuthUser);
      setSessionError(planned.sessionError);
      setLoading(planned.loading);
    } catch (e) {
      if (gen !== restoreGen.current) return;
      const planned = planAuthRestore({
        token: t,
        result: { ok: false, error: e instanceof ApiError ? e : { status: 0, message: String(e) } }
      });
      if (planned.clearToken) localStorage.removeItem("token");
      setToken(planned.token);
      setUser(planned.user as AuthUser | null);
      setSessionError(planned.sessionError);
      setLoading(planned.loading);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiJson<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    restoreGen.current += 1;
    localStorage.setItem("token", data.token);
    setToken(data.token);
    setUser(data.user);
    setSessionError(null);
    setLoading(false);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, sessionError, login, logout, refreshMe }),
    [user, token, loading, sessionError, login, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
