import { useState } from "react";
import { api, formatErr } from "../lib/api";

export default function WaiverModal({ waiverText, version, dogNames, onSigned, onClose, allowClose=false }) {
  const [typedName, setTypedName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const sign = async () => {
    setErr("");
    if (!accepted) { setErr("You must agree to the terms"); return; }
    if (typedName.trim().length < 2) { setErr("Please type your full name to sign"); return; }
    setSaving(true);
    try {
      await api.post("/waivers/sign", { typed_name: typedName.trim(), accepted: true, dog_names: dogNames || "" });
      onSigned();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Sign failed"); }
    setSaving(false);
  };

  // Render bold markdown-ish (**bold**) as <strong>
  const renderText = (text) => {
    return text.split(/\n\n+/).map((para, idx) => {
      const parts = para.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={idx} className="mb-4 text-sm text-gray-300 leading-relaxed">
          {parts.map((p, i) =>
            p.startsWith("**") && p.endsWith("**")
              ? <strong key={i} className="text-shGreen block mt-1 mb-1 text-[11px] uppercase tracking-widest font-black">{p.slice(2,-2)}</strong>
              : <span key={i}>{p}</span>
          )}
        </p>
      );
    });
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50" data-testid="waiver-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-3xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-2xl font-black text-white uppercase italic tracking-tight">Client Waiver</h3>
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mt-1">Sit Happens Dog Training · Version {version}</p>
          </div>
          {allowClose && <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl" /></button>}
        </div>

        <div className="bg-bgBase border border-bgHover rounded p-5 mb-6 max-h-80 overflow-y-auto" data-testid="waiver-text">
          {renderText(waiverText)}
        </div>

        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={(e)=>setAccepted(e.target.checked)} data-testid="waiver-accept" className="mt-1 w-5 h-5 accent-shGreen" />
            <span className="text-xs text-gray-300">
              I have read, understood, and agree to all terms above. I am signing electronically and acknowledge that this typed signature has the same legal effect as a handwritten signature.
            </span>
          </label>

          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Type your full name to sign</label>
            <input value={typedName} onChange={(e)=>setTypedName(e.target.value)} placeholder="e.g., Sarah Mitchell" data-testid="waiver-signature"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-lg italic font-serif focus:border-shGreen outline-none" />
          </div>

          {err && <div className="text-[11px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

          <button onClick={sign} disabled={saving} data-testid="waiver-sign-button"
                  className="w-full bg-shGreen text-bgHeader py-4 rounded font-black uppercase text-[11px] tracking-widest shadow-xl hover:bg-shGreen/90 disabled:opacity-50">
            {saving?"Signing…":"Sign & Submit Waiver"}
          </button>
        </div>
      </div>
    </div>
  );
}
