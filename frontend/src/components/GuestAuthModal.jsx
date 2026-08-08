import { useState } from "react";
import { useAuth } from "../lib/auth";

// Public no-account storefront — inline sign-in/register used from the
// guest Shop. Deliberately never navigates anywhere: it mounts inside the
// SAME ShopRouteGate tree the guest storefront itself is already in, so a
// successful login/register just flips AuthProvider's `user` from false to
// a real object, and the parent gate re-renders the authenticated branch
// at the exact same /shop URL — the safest possible way to "preserve the
// pending destination through login/registration", since the destination
// was never left in the first place.
export default function GuestAuthModal({ open, onClose }) {
  const { login, register, error, setError } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const ok = mode === "login" ? await login(email, password) : await register(email, password, name);
    setLoading(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="guest-auth-modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="border border-shBorder rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-sh sh-modal-surface" style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between">
          <p className="text-shText font-bold uppercase tracking-widest text-sm">{mode === "login" ? "Sign In" : "Create Account"}</p>
          <button onClick={onClose} data-testid="guest-auth-close" className="text-shTextMuted hover:text-shText">
            <i className="fas fa-xmark" />
          </button>
        </div>

        <div className="flex gap-2 rounded-lg p-1 border border-shBorder" style={{ background: "var(--sh-card-base)" }}>
          <button type="button" onClick={() => { setMode("login"); setError(""); }} data-testid="guest-auth-tab-login"
                  className={`flex-1 py-2 rounded text-[12px] font-black uppercase tracking-widest transition ${mode === "login" ? "bg-shPrimary text-bgHeader" : "text-shTextMuted hover:text-shText"}`}>
            Sign In
          </button>
          <button type="button" onClick={() => { setMode("register"); setError(""); }} data-testid="guest-auth-tab-register"
                  className={`flex-1 py-2 rounded text-[12px] font-black uppercase tracking-widest transition ${mode === "register" ? "bg-shPrimary text-bgHeader" : "text-shTextMuted hover:text-shText"}`}>
            Register
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {mode === "register" && (
            <div>
              <label className="text-[11px] font-black text-shTextMuted uppercase tracking-widest">Full Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required data-testid="guest-auth-name"
                     className="w-full mt-1 border border-shBorder rounded p-2.5 text-shText text-sm focus:outline-none focus:border-shPrimary/60"
                     style={{ background: "var(--sh-card-base)" }} />
            </div>
          )}
          <div>
            <label className="text-[11px] font-black text-shTextMuted uppercase tracking-widest">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="guest-auth-email"
                   className="w-full mt-1 border border-shBorder rounded p-2.5 text-shText text-sm focus:outline-none focus:border-shPrimary/60"
                   style={{ background: "var(--sh-card-base)" }} />
          </div>
          <div>
            <label className="text-[11px] font-black text-shTextMuted uppercase tracking-widest">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                   minLength={mode === "register" ? 8 : undefined}
                   autoComplete={mode === "register" ? "new-password" : "current-password"}
                   data-testid="guest-auth-password"
                   className="w-full mt-1 border border-shBorder rounded p-2.5 text-shText text-sm focus:outline-none focus:border-shPrimary/60"
                   style={{ background: "var(--sh-card-base)" }} />
            {mode === "register" && <p className="mt-1 text-[11px] text-shTextMuted">Use at least 8 characters.</p>}
          </div>
          {error && <div data-testid="guest-auth-error" className="text-[13px] text-shDanger bg-shDanger/10 rounded p-2.5">{error}</div>}
          <button type="submit" disabled={loading} data-testid="guest-auth-submit"
                  className="w-full py-3 rounded font-black text-[13px] uppercase tracking-widest bg-shPrimary text-bgHeader disabled:opacity-50 hover:brightness-110 transition">
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
