/* Sprint 110di-33 — Client portal "Need Help?" card + modal.

Tiny support channel that lets the client send a free-text message to
the operator without touching the messaging system (no thread state,
no replies, no SLAs). Posts to /api/portal/help-requests. Gated by
client_portal_controls.sections.help_button. */
import { useState } from "react";
import { api, formatErr } from "../lib/api";
import NeonEdge from "./premium/NeonEdge";
import PremiumButton from "./premium/PremiumButton";
import { accentRgb } from "./premium/tokens";

const TYPES = [
  { key: "feedback", label: "Send Feedback",     icon: "fa-comment-dots" },
  { key: "problem",  label: "Report a Problem",  icon: "fa-triangle-exclamation" },
  { key: "feature",  label: "Suggest a Feature", icon: "fa-lightbulb" },
  { key: "booking",  label: "Booking Help",      icon: "fa-calendar-question" },
  { key: "other",    label: "Other",             icon: "fa-circle-question" },
];

export default function NeedHelpCard() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("feedback");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  const reset = () => { setType("feedback"); setSubject(""); setMessage(""); setErr(""); setSent(false); };

  const submit = async () => {
    setErr("");
    if (!subject.trim() || !message.trim()) {
      setErr("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/portal/help-requests", { type, subject, message });
      setSent(true);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Submit failed");
    } finally { setBusy(false); }
  };

  return (
    <>
      <NeonEdge accentRgb={accentRgb("cyan")} intensity="subtle" className="p-4" data-testid="portal-need-help-card">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-[13px] font-bold text-shSecondary uppercase tracking-widest">
            <i className="fas fa-life-ring mr-2"/>Need Help?
          </p>
        </div>
        <p className="text-[12px] text-shTextMuted mb-3 leading-snug">
          Question, bug, or idea? Send a quick note to the team — we'll get back to you.
        </p>
        <PremiumButton variant="cyan" onClick={() => { reset(); setOpen(true); }} data-testid="portal-need-help-open" className="w-full justify-center">
          <i className="fas fa-paper-plane mr-2"/>Contact Support
        </PremiumButton>
      </NeonEdge>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
             onClick={() => !busy && setOpen(false)} data-testid="portal-need-help-modal">
          <div onClick={(e)=>e.stopPropagation()}
               className="border border-shBorder rounded-2xl w-full sm:max-w-md shadow-sh p-5 space-y-3" style={{ background: "var(--sh-card-base)" }}>
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-black text-shSecondary uppercase tracking-widest">
                <i className="fas fa-life-ring mr-2"/>Contact Support
              </p>
              <button onClick={() => setOpen(false)} disabled={busy}
                      className="text-shTextMuted hover:text-shText" data-testid="portal-need-help-close">
                <i className="fas fa-times"/>
              </button>
            </div>

            {sent ? (
              <div className="text-center py-6 space-y-3" data-testid="portal-need-help-sent">
                <div className="mx-auto w-12 h-12 rounded-full bg-shPrimary/20 flex items-center justify-center">
                  <i className="fas fa-circle-check text-shPrimary text-2xl"/>
                </div>
                <p className="text-shText font-bold uppercase tracking-widest text-sm">Message sent!</p>
                <p className="text-[12px] text-shTextMuted">We'll review and reach out as soon as we can.</p>
                <PremiumButton variant="primary" onClick={() => setOpen(false)} data-testid="portal-need-help-done">
                  Done
                </PremiumButton>
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="text-[11px] text-shTextMuted font-black uppercase tracking-widest">Type</span>
                  <select value={type} onChange={(e)=>setType(e.target.value)} data-testid="portal-need-help-type"
                          style={{ background: "var(--sh-card-base)" }}
                          className="w-full mt-1 border border-shBorder rounded p-2 text-[13px] text-shText focus:outline-none focus:border-shSecondary/60">
                    {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-shTextMuted font-black uppercase tracking-widest">Subject</span>
                  <input value={subject} onChange={(e)=>setSubject(e.target.value)} maxLength={140}
                         data-testid="portal-need-help-subject"
                         style={{ background: "var(--sh-card-base)" }}
                         className="w-full mt-1 border border-shBorder rounded p-2 text-[13px] text-shText focus:outline-none focus:border-shSecondary/60"
                         placeholder="Short summary…"/>
                </label>
                <label className="block">
                  <span className="text-[11px] text-shTextMuted font-black uppercase tracking-widest">Message</span>
                  <textarea value={message} onChange={(e)=>setMessage(e.target.value)} maxLength={4000} rows={5}
                            data-testid="portal-need-help-message"
                            style={{ background: "var(--sh-card-base)" }}
                            className="w-full mt-1 border border-shBorder rounded p-2 text-[13px] text-shText focus:outline-none focus:border-shSecondary/60"
                            placeholder="Tell us what's going on…"/>
                </label>
                {err && <div className="text-[13px] font-bold p-2 rounded bg-shDanger/15 text-shDanger text-center">{err}</div>}
                <div className="flex justify-end gap-2 pt-1">
                  <PremiumButton variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                  </PremiumButton>
                  <PremiumButton variant="cyan" onClick={submit} disabled={busy} data-testid="portal-need-help-submit">
                    <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-paper-plane"} mr-2`}/>{busy ? "Sending..." : "Submit"}
                  </PremiumButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
