import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import * as api from '../api';
import type { LoginUser } from '../api';

// Token storage: localStorage if "remember me" was checked, sessionStorage otherwise — same
// convention app/index.html already used (fms_token key), kept identical so the mental model
// carries over for anyone who used the old app.
const TOKEN_KEY = 'fms_token';

interface AuthState {
  token: string | null;
  user: LoginUser | null;
  loading: boolean;
  login: (username: string, password: string, rememberMe: boolean) => Promise<{ ok: boolean; message: string }>;
  logout: () => Promise<void>;
  markPasswordChanged: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function readStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<LoginUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) { setLoading(false); return; }
    api.me(stored).then((res) => {
      if (res.ok) { setToken(stored); setUser(res.data); }
      else { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); }
    }).finally(() => setLoading(false));
  }, []);

  const doLogin = useCallback(async (username: string, password: string, rememberMe: boolean) => {
    const res = await api.login(username, password);
    if (!res.ok) return { ok: false, message: res.message };
    const store = rememberMe ? localStorage : sessionStorage;
    store.setItem(TOKEN_KEY, res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return { ok: true, message: res.message };
  }, []);

  const doLogout = useCallback(async () => {
    if (token) await api.logout(token).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  // Called right after a successful changePassword call — updates the in-memory user so the
  // forced-change screen (see ChangePasswordScreen) knows to let the user through without
  // needing a full re-login.
  const markPasswordChanged = useCallback(() => {
    setUser((u) => (u ? { ...u, mustChangePassword: false } : u));
  }, []);

  // Re-fetches the session's user record — called after My Account profile edits so the topbar
  // name/avatar update immediately without needing a full re-login.
  const refreshUser = useCallback(async () => {
    if (!token) return;
    const res = await api.me(token);
    if (res.ok) setUser(res.data);
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, user, loading, login: doLogin, logout: doLogout, markPasswordChanged, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
