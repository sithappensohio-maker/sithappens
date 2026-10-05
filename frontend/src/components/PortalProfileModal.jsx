import { useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import SetPasswordForm from "./SetPasswordForm";
import PremiumButton from "./premium/PremiumButton";

export default function PortalProfileModal({ client, onClose, onSaved }) {
  const { user, reloadUser } = useAuth();
  const [form, setForm] = useState({
    name: client?.name || "",
    email: client?.email || "",
    address: client?.address || "",
    phone: client?.phone || "",
    emerg: client?.emerg || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordJustSet, setPasswordJustSet] = useState(false);
  // Set once the new address is saved as pending: the change waits for the link sent to it.
  const [pendingEmail, setPendingEmail] = useState("");

  const save = async () => {
    setErr("");
    // Sprint 110di — all owner fields required.
    const fields = [
      { k: "name",    label: "Name" },
      { k: "email",   label: "Email" },
      { k: "address", label: "Address" },
      { k: "phone",   label: "Phone" },
      { k: "emerg",   label: "Emergency contact" },
    ];
    for (const f of fields) {
      if (!(form[f.k] || "").trim()) { setErr(`${f.label} is required`); return; }
    }
    const em = (form.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr("Enter a valid email address"); return;
    }
    setSaving(true);
    try {
      const { data } = await api.put("/portal/me", { ...form, email: em });
      onSaved?.();
      // The new address is used only after the family opens the link sent to it (audit #27).
      if (data?.email_change_pending) {
        setPendingEmail(em);
        setForm((f) => ({ ...f, email: client?.email || "" }));
        setSaving(false);
        return;
      }
      onClose();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="portal-profile-modal">
      <div className="border border-shBorder rounded-2xl w-full max-w-lg p-6 md:p-8 shadow-sh animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto sh-modal-surface" style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xl font-bold text-shText tracking-tight">My Profile</h4>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times text-xl" /></button>
        </div>

        {user?.needs_password && !passwordJustSet && (
          <div className="border border-shSecondary/40 rounded-xl p-4 mb-4" style={{ background: "rgba(0,169,224,0.08)" }} data-testid="pp-needs-password">
            <p className="text-[13px] font-bold uppercase tracking-widest text-shSecondary mb-1">
              <i className="fas fa-key mr-1.5"/>You don't have a password yet
            </p>
            <p className="text-[12px] text-shTextMuted leading-relaxed mb-3">
              You signed in with a Meet &amp; Greet link. Set a password so you can log back in directly next time.
            </p>
            {!showPasswordForm ? (
              <PremiumButton variant="cyan" onClick={() => setShowPasswordForm(true)} data-testid="pp-open-set-password">
                Set Password
              </PremiumButton>
            ) : (
              <SetPasswordForm submitLabel="Save Password" onSuccess={() => { reloadUser(); setPasswordJustSet(true); setShowPasswordForm(false); }} />
            )}
          </div>
        )}

        {pendingEmail && (
          <div className="border border-shSecondary/40 rounded-xl p-4 mb-4" style={{ background: "rgba(0,169,224,0.08)" }} data-testid="pp-email-pending">
            <p className="text-[13px] font-bold uppercase tracking-widest text-shSecondary mb-1">
              <i className="fas fa-envelope mr-1.5"/>Confirm your new email
            </p>
            <p className="text-[12px] text-shTextMuted leading-relaxed">
              We sent a link to <strong className="break-all">{pendingEmail}</strong>. Your email changes once you open that link.
              Your other details are saved, and sign-in and receipts use your current address until then.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {[
            { k: "name", label: "Full Name *", placeholder: "", type: "text" },
            { k: "email", label: "Email *", placeholder: "you@example.com", type: "email" },
            { k: "address", label: "Address *", placeholder: "123 Main St, City, State", type: "text" },
            { k: "phone", label: "Phone *", placeholder: "(555) 123-4567", type: "tel" },
            { k: "emerg", label: "Emergency Contact *", placeholder: "Jane Doe — (555) 555-5555", type: "text" },
          ].map(f => (
            <div key={f.k}>
              <label className="text-[15px] font-bold text-shTextMuted uppercase tracking-widest">{f.label}</label>
              <input value={form[f.k]} onChange={(e)=>setForm({...form, [f.k]: e.target.value})} placeholder={f.placeholder}
                     type={f.type || "text"} autoComplete={f.k === "email" ? "email" : "off"}
                     data-testid={`pp-${f.k}`}
                     style={{ background: "var(--sh-card-base)" }}
                     className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shPrimary/60" />
              {f.k === "email" && (
                <p className="text-[11px] text-shTextMuted mt-1">Used for receipts, low-credit reminders & studio updates.</p>
              )}
            </div>
          ))}

          {err && <div className="text-[14px] text-shDanger bg-shDanger/10 rounded p-3 uppercase font-bold">{err}</div>}

          <div className="flex justify-end gap-3 pt-2">
            {pendingEmail ? (
              <PremiumButton variant="primary" onClick={onClose} data-testid="pp-done">Done</PremiumButton>
            ) : (
              <>
                <PremiumButton variant="ghost" onClick={onClose}>Cancel</PremiumButton>
                <PremiumButton variant="primary" onClick={save} disabled={saving} data-testid="pp-submit">
                  {saving ? "Saving…" : "Save Profile"}
                </PremiumButton>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
