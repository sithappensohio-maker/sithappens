import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatErr } from "./api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = guest, obj = logged-in
  const [permissions, setPermissions] = useState(null); // dict of permission key → bool
  const [error, setError] = useState("");

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("sh_token");
    if (!token) { setUser(false); setPermissions(null); return; }
    try {
      // These endpoints are independent. Starting them together removes one
      // full network round trip from every app launch and lets the backend's
      // authenticated-user single-flight cache serve both with one DB read.
      const [meRes, permRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/me/permissions").catch(() => null),
      ]);
      setUser(meRes.data);
      setPermissions(permRes?.data?.permissions || null);
    } catch {
      localStorage.removeItem("sh_token");
      setUser(false);
      setPermissions(null);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("sh_token", data.token);
      setUser(data.user);
      // Sprint 110ex — also fetch permissions after login (separate endpoint
      // so the original /auth/login response stays unchanged).
      try {
        const { data: p } = await api.get("/me/permissions");
        setPermissions(p.permissions || null);
      } catch { setPermissions(null); }
      return true;
    } catch (e) {
      setError(formatErr(e.response?.data?.detail) || "Login failed");
      return false;
    }
  };

  const register = async (email, password, name, referredByCode) => {
    setError("");
    try {
      const payload = { email, password, name };
      if (referredByCode) payload.referred_by_code = referredByCode;
      const { data } = await api.post("/auth/register", payload);
      localStorage.setItem("sh_token", data.token);
      setUser(data.user);
      return true;
    } catch (e) {
      setError(formatErr(e.response?.data?.detail) || "Register failed");
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem("sh_token");
    setUser(false);
    setPermissions(null);
  };

  // Sprint 110ex — Phase 7: easy "can()" predicate for UI gating.
  // Admins (role=admin) and missing-permission-dict scenarios default to allow
  // so existing flows keep working while staff role assignments are rolled out.
  const can = (key) => {
    if (!user) return false;
    if ((user.role || "").toLowerCase() === "admin") return true;
    if (!permissions) return true;        // not yet loaded — let UI render
    return !!permissions[key];
  };

  return (
    <AuthCtx.Provider value={{ user, permissions, can, login, register, logout, error, setError, reloadUser: loadMe }}>
      {children}
    </AuthCtx.Provider>
  );
}
