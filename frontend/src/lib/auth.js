import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatErr } from "./api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = guest, obj = logged-in
  const [permissions, setPermissions] = useState(null); // dict of permission key → bool
  const [error, setError] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState(null);

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

  // Permission-bug checkpoint — keep `permissions` (and `user.staff_role`)
  // fresh while a session stays open, so a live permission change (an owner
  // editing the role matrix, or reassigning someone's staff_role) reaches
  // the UI without requiring the affected user to log out and back in.
  useEffect(() => {
    if (!user) return;
    const h = setInterval(loadMe, 60000);
    return () => clearInterval(h);
  }, [user, loadMe]);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.mfa_required) {
        setMfaChallenge(data.challenge_token);
        return false;
      }
      localStorage.setItem("sh_token", data.token);
      setMfaChallenge(null);
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

  const verifyMfa = async (code) => {
    if (!mfaChallenge) return false;
    setError("");
    try {
      const { data } = await api.post("/auth/mfa/verify-login", { challenge_token: mfaChallenge, code });
      localStorage.setItem("sh_token", data.token);
      setMfaChallenge(null);
      setUser(data.user);
      try {
        const { data: p } = await api.get("/me/permissions");
        setPermissions(p.permissions || null);
      } catch { setPermissions(null); }
      return true;
    } catch (e) {
      setError(formatErr(e.response?.data?.detail) || "MFA verification failed");
      return false;
    }
  };

  const cancelMfa = () => { setMfaChallenge(null); setError(""); };

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
    setMfaChallenge(null);
  };

  // Sprint 110ex — Phase 7: easy "can()" predicate for UI gating.
  // Mirrors backend `_perms_for()` exactly (server.py): the ONLY accounts that
  // bypass the permission matrix are a true owner — either an `admin`-role user
  // with no `staff_role` at all (legacy implicit owner, e.g. the originally
  // seeded admin@sithappens.com) or one explicitly tagged `staff_role: "owner"`.
  // Every other staff_role (manager, trainer, daycare_staff, boarding_staff,
  // front_desk, read_only) must defer to the `/me/permissions` response — the
  // backend is the sole source of truth for what those roles can do. If the
  // permissions dict hasn't loaded yet (or failed to load), this fails closed
  // (false) rather than granting temporary access.
  const isOwner = (u) => {
    if (!u || (u.role || "").toLowerCase() !== "admin") return false;
    const sr = (u.staff_role || "").toLowerCase();
    return !sr || sr === "owner";
  };

  const can = (key) => {
    if (!user) return false;
    if (isOwner(user)) return true;
    if (!permissions) return false;       // not yet loaded / restricted staff — fail closed
    return !!permissions[key];
  };

  return (
    <AuthCtx.Provider value={{ user, permissions, can, isOwner: () => isOwner(user), login, verifyMfa, cancelMfa, mfaChallenge, register, logout, error, setError, reloadUser: loadMe }}>
      {children}
    </AuthCtx.Provider>
  );
}
