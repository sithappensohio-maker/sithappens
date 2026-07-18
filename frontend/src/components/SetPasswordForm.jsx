import { useState } from "react";
import { api, formatErr } from "../lib/api";

/**
 * Lets a client who's currently passwordless (needs_password=true) set a
 * real password via PATCH /auth/set-password. Used both in the portal's
 * dismissible reminder card and in the profile modal.
 */
export default function SetPasswordForm({ onSuccess, submitLabel = "Set Password" }) {
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirmPw) { setErr("Passwords don't match."); return; }
    setSaving(true);
    try {
      const { data } = await api.patch("/auth/set-password", { password });
      if (data?.token) localStorage.setItem("sh_token", data.token);
      setPassword(""); setConfirmPw("");
      onSuccess?.();
    } catch (e2) {
      setErr(formatErr(e2.response?.data?.detail) || "Couldn't set password. Try again.");
    }
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="set-password-form">
      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">New Password</label>
        <input
          type="password" value={password} onChange={(e)=>setPassword(e.target.value)}
          required minLength={8} autoFocus
          data-testid="set-password-input"
          placeholder="At least 8 characters"
          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none"
        />
      </div>
      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Confirm Password</label>
        <input
          type="password" value={confirmPw} onChange={(e)=>setConfirmPw(e.target.value)}
          required minLength={8}
          data-testid="set-password-confirm-input"
          placeholder="Type it again"
          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none"
        />
      </div>
      {err && (
        <div data-testid="set-password-error" className="text-[13px] text-red-400 bg-red-500/10 rounded p-2.5 uppercase font-black">
          {err}
        </div>
      )}
      <button
        type="submit" disabled={saving} data-testid="set-password-submit"
        className="w-full bg-shGreen text-bgHeader py-2.5 rounded font-black text-[13px] uppercase tracking-widest shadow-lg disabled:opacity-50"
      >
        {saving ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
