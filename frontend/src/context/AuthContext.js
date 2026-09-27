import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    // `me` is called with quiet: true (see api.js) so cold-start 401s
    // return null instead of throwing — keeps the DevTools console
    // quiet for unauthenticated users. A 200 with `user: null` would
    // also work but we don't have an /api/auth/status endpoint; the
    // route returns 401 when no cookie is set, so we use the throw.
    const u = await api.me();
    if (u) {
      setUser(u);
    } else {
      // No session yet — start an anonymous guest session so work
      // persists and auto-migrates to the Google account on sign-in.
      try {
        const { user: guest } = await api.guest();
        setUser(guest);
      } catch {
        setUser(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch {}
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, checkAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
