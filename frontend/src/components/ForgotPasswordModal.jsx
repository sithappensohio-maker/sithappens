import { useState } from "react";
import { api, formatErr } from "../lib/api";

/**
 * Lightweight modal for "Forgot Password" — collects an email, calls the
 * public /auth/forgot-password endpoint, then shows a generic success message
 * regardless of whether the email is actually registered (we deliberately
 * never confirm/deny so attackers can't probe for valid accounts).
 *
 * Works for both admins and clients since the backend looks up the user by
 * email and tailors the claim token accordingly.
 */
export default function ForgotPasswordModal({ open, onClose, initialEmail = "" }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("/auth/forgot-password", { email });
      setDone(true);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't send reset link. Try again.");
    }
    setBusy(false);
  };

  const close = () => {
    setDone(false); setErr(""); setEmail(initialEmail);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={close} data-testid="forgot-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-8 shadow-2xl animate-slide-in" onClick={(e)=>e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-key text-shGreen mr-2"/>Reset Password
          </h3>
          <button onClick={close} data-testid="forgot-close" className="text-gray-400 hover:text-white text-xl"><i className="fas fa-times"/></button>
        </div>

        {done ? (
          <div className="space-y-4" data-testid="forgot-success">
            <div className="bg-shGreen/10 border border-shGreen/30 rounded-lg p-4">
              <p className="text-shGreen font-black uppercase tracking-widest text-sm mb-2">
                <i className="fas fa-envelope mr-2"/>Check your inbox
              </p>
              <p className="text-[14px] text-gray-300 leading-relaxed">
                If <span className="text-white font-black">{email}</span> is registered, you'll get a reset link within a minute.
                It expires in 7 days. Don't forget to check your spam folder.
              </p>
            </div>
            <button onClick={close} data-testid="forgot-done" className="w-full bg-shBlue text-white py-3 rounded font-black text-sm uppercase tracking-widest">
              Got it
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-[14px] text-gray-400 leading-relaxed">
              Enter your email below. We'll send you a one-time link to set a new password.
            </p>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Email</label>
              <input
                type="email" required autoFocus
                value={email}
                onChange={(e)=>setEmail(e.target.value)}
                data-testid="forgot-email-input"
                className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shGreen outline-none"
              />
            </div>
            {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black" data-testid="forgot-error">{err}</div>}
            <button type="submit" disabled={busy || !email} data-testid="forgot-submit"
                    className="w-full bg-shGreen text-bgHeader py-3 rounded font-black text-sm uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Sending…" : "Send Reset Link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
