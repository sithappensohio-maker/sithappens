import { useState } from "react";
import { api, formatErr } from "../lib/api";
import PremiumButton from "./premium/PremiumButton";

export default function WaiverModal({ waiverText, version, dogNames, onSigned, onClose, allowClose=false }) {
  const [typedName, setTypedName] = useState("");
  const [accepted, setAccepted] = useState(false);
  // Derived from the live waiver text, so the callout appears only when the
  // clause is genuinely there — an operator who rewrites the waiver without
  // tool authorisation should not see a warning about one.
  const mentionsTools = /prong|e-?collar|electronic collar|slip lead/i.test(waiverText || "");
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
        <p key={idx} className="mb-4 text-sm text-shTextMuted leading-relaxed">
          {parts.map((p, i) =>
            p.startsWith("**") && p.endsWith("**")
              ? <strong key={i} className="text-shPrimary block mt-1 mb-1 text-[15px] uppercase tracking-widest font-bold">{p.slice(2,-2)}</strong>
              : <span key={i}>{p}</span>
          )}
        </p>
      );
    });
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50" data-testid="waiver-modal">
      <div className="border border-shBorder rounded-2xl w-full max-w-3xl p-6 md:p-8 shadow-sh max-h-[calc(var(--app-height)_-_1rem)] overflow-y-auto animate-slide-in sh-modal-surface" style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-2xl font-bold text-shText tracking-tight">Client Waiver</h3>
            <p className="text-[14px] font-bold text-shTextMuted uppercase tracking-widest mt-1">Sit Happens Dog Training · Version {version}</p>
          </div>
          {allowClose && <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times text-xl" /></button>}
        </div>

        {/* The training-tools clause lives inside the scroll box below, where
            somebody can reasonably say they never saw it. It is called out
            here so it is read before it is agreed to. The waiver text itself
            is unchanged — this only points at a clause already in it. */}
        {mentionsTools && (
          <div className="border border-shAccent/50 bg-shAccent/10 rounded-xl p-4 mb-4" data-testid="waiver-tools-callout">
            <p className="text-[12px] font-black uppercase tracking-widest text-shAccent">
              <i className="fas fa-circle-exclamation mr-1.5"/>Please read this part in particular
            </p>
            <p className="text-[13px] text-shText mt-2 leading-relaxed">
              This waiver includes your authorisation for balanced training tools — which can
              include slip leads, prong collars and e-collars — to be used where our trainers
              judge them appropriate for your dog. The full wording is in the waiver below.
            </p>
            <p className="text-[12px] text-shTextMuted mt-2 leading-relaxed">
              If you would rather we didn&apos;t, talk to us before signing. We will tell you
              what we would use with your dog and why.
            </p>
          </div>
        )}

        <div className="border border-shBorder rounded p-5 mb-6 max-h-80 overflow-y-auto" style={{ background: "var(--sh-card-base)" }} data-testid="waiver-text">
          {renderText(waiverText)}
        </div>

        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={(e)=>setAccepted(e.target.checked)} data-testid="waiver-accept" className="mt-1 w-5 h-5 accent-shPrimary" />
            <span className="text-xs text-shTextMuted">
              I have read, understood, and agree to all terms above. I am signing electronically and acknowledge that this typed signature has the same legal effect as a handwritten signature.
            </span>
          </label>

          <div>
            <label className="text-[14px] font-bold text-shTextMuted uppercase tracking-widest">Type your full name to sign</label>
            <input value={typedName} onChange={(e)=>setTypedName(e.target.value)} placeholder="e.g., Sarah Mitchell" data-testid="waiver-signature"
                   style={{ background: "var(--sh-card-base)" }}
                   className="w-full mt-1 border border-shBorder rounded p-3 text-shText text-lg italic font-serif focus:outline-none focus:border-shPrimary/60" />
          </div>

          {err && <div className="text-[15px] text-shDanger bg-shDanger/10 rounded p-3 uppercase font-bold">{err}</div>}

          <PremiumButton variant="primary" onClick={sign} disabled={saving} data-testid="waiver-sign-button" className="w-full justify-center py-4">
            {saving?"Signing…":"Sign & Submit Waiver"}
          </PremiumButton>
        </div>
      </div>
    </div>
  );
}
