import { useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import SetPasswordForm from "./SetPasswordForm";

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
      await api.put("/portal/me", { ...form, email: em });
      onSaved?.();
      onClose();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="portal-profile-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 md:p-8 shadow-2xl animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">My Profile</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl" /></button>
        </div>

        {user?.needs_password && !passwordJustSet && (
          <div className="bg-shBlue/10 border border-shBlue/40 rounded-xl p-4 mb-4" data-testid="pp-needs-password">
            <p className="text-[13px] font-black uppercase tracking-widest text-shBlue mb-1">
              <i className="fas fa-key mr-1.5"/>You don't have a password yet
            </p>
            <p className="text-[12px] text-gray-300 leading-relaxed mb-3">
              You signed in with a Meet &amp; Greet link. Set a password so you can log back in directly next time.
            </p>
            {!showPasswordForm ? (
              <button onClick={() => setShowPasswordForm(true)} data-testid="pp-open-set-password"
                      className="bg-shBlue text-white px-4 py-2 rounded font-black text-[12px] uppercase tracking-widest hover:bg-shBlue/90 transition">
                Set Password
              </button>
            ) : (
              <SetPasswordForm submitLabel="Save Password" onSuccess={() => { reloadUser(); setPasswordJustSet(true); setShowPasswordForm(false); }} />
            )}
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
              <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">{f.label}</label>
              <input value={form[f.k]} onChange={(e)=>setForm({...form, [f.k]: e.target.value})} placeholder={f.placeholder}
                     type={f.type || "text"} autoComplete={f.k === "email" ? "email" : "off"}
                     data-testid={`pp-${f.k}`}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shGreen outline-none" />
              {f.k === "email" && (
                <p className="text-[11px] text-gray-500 mt-1">Used for receipts, low-credit reminders & studio updates.</p>
              )}
            </div>
          ))}

          {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
            <button onClick={save} disabled={saving} data-testid="pp-submit"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving ? "Saving…" : "Save Profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
