import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatErr } from "./api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = guest, obj = logged-in
  const [error, setError] = useState("");

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("sh_token");
    if (!token) { setUser(false); return; }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      localStorage.removeItem("sh_token");
      setUser(false);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("sh_token", data.token);
      setUser(data.user);
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
  };

  return (
    <AuthCtx.Provider value={{ user, login, register, logout, error, setError, reloadUser: loadMe }}>
      {children}
    </AuthCtx.Provider>
  );
}
