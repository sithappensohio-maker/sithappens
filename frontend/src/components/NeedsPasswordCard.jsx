import { useState } from "react";
import { useAuth } from "../lib/auth";
import SetPasswordForm from "./SetPasswordForm";

const DISMISS_KEY = "sh_needs_password_dismissed_v1";

/**
 * Dismissible reminder shown to clients who logged in passwordless
 * (user.needs_password=true) — nudges them to set a real password so they
 * can log back in directly next time, without gating anything.
 */
export default function NeedsPasswordCard() {
  const { user, reloadUser } = useAuth();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [expanded, setExpanded] = useState(false);

  if (!user?.needs_password || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setDismissed(true);
  };

  return (
    <div className="relative bg-shBlue/10 border-2 border-shBlue/40 rounded-2xl p-4 sm:p-5 mb-6" data-testid="needs-password-card">
      <button onClick={dismiss} data-testid="needs-password-dismiss"
              className="absolute top-2 right-2 text-gray-400 hover:text-white text-lg p-2" aria-label="Dismiss">
        <i className="fas fa-xmark"/>
      </button>
      <p className="text-[12px] font-black uppercase tracking-widest text-shBlue mb-1 pr-8">
        <i className="fas fa-key mr-1.5"/>Secure your account
      </p>
      <p className="text-[13px] text-gray-300 leading-relaxed mb-3 max-w-xl">
        You signed in without a password. Set one now so you can log back in directly next time — or skip it and keep using your Meet &amp; Greet link.
      </p>
      {!expanded ? (
        <button onClick={() => setExpanded(true)} data-testid="needs-password-open"
                className="bg-shBlue text-white px-5 py-2.5 rounded font-black text-[12px] uppercase tracking-widest shadow-lg hover:bg-shBlue/90 transition">
          Set Password
        </button>
      ) : (
        <div className="max-w-sm">
          <SetPasswordForm submitLabel="Save Password" onSuccess={() => { reloadUser(); dismiss(); }} />
        </div>
      )}
    </div>
  );
}
