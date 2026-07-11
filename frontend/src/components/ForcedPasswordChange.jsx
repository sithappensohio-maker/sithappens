import { useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function ForcedPasswordChange() {
  const { user, logout, reloadUser } = useAuth();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.next.length < 8) { setError("Use at least 8 characters for the new password."); return; }
    if (form.next !== form.confirm) { setError("The new passwords do not match."); return; }
    if (form.current === form.next) { setError("Choose a different password from the temporary one."); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/change-password", {
        current_password: form.current,
        new_password: form.next,
      });
      if (data?.token) localStorage.setItem("sh_token", data.token);
      await reloadUser();
    } catch (err) {
      setError(formatErr(err.response?.data?.detail) || "Password change failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bgBase flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-bgPanel border border-bgHover rounded-2xl p-6 shadow-2xl space-y-4" data-testid="forced-password-change">
        <div className="text-center">
          <img src="/logo.png" alt="Sit Happens" className="h-20 mx-auto mb-3" />
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">Secure your account</p>
          <h1 className="text-2xl font-black text-white mt-1">Change temporary password</h1>
          <p className="text-sm text-gray-400 mt-2">Hi {user?.name || "there"}. Your records are safe; only your login password is being changed.</p>
        </div>
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Temporary password</span>
          <input type="password" autoComplete="current-password" value={form.current}
                 onChange={(e)=>setForm({...form, current:e.target.value})}
                 className="mt-1 w-full bg-bgBase border border-bgHover rounded-lg p-3 text-white" required />
        </label>
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">New password</span>
          <input type="password" autoComplete="new-password" value={form.next}
                 onChange={(e)=>setForm({...form, next:e.target.value})}
                 className="mt-1 w-full bg-bgBase border border-bgHover rounded-lg p-3 text-white" required minLength={8} />
        </label>
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Confirm new password</span>
          <input type="password" autoComplete="new-password" value={form.confirm}
                 onChange={(e)=>setForm({...form, confirm:e.target.value})}
                 className="mt-1 w-full bg-bgBase border border-bgHover rounded-lg p-3 text-white" required minLength={8} />
        </label>
        {error && <p className="text-red-400 text-sm font-bold" role="alert">{error}</p>}
        <button type="submit" disabled={busy}
                className="w-full bg-shGreen text-bgDark rounded-lg py-3 font-black uppercase tracking-widest disabled:opacity-50">
          {busy ? "Saving…" : "Save secure password"}
        </button>
        <button type="button" onClick={logout} className="w-full text-gray-400 hover:text-white text-sm">Sign out instead</button>
      </form>
    </div>
  );
}
