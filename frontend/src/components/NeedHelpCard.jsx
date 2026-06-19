/* Sprint 110di-33 — Client portal "Need Help?" card + modal.

Tiny support channel that lets the client send a free-text message to
the operator without touching the messaging system (no thread state,
no replies, no SLAs). Posts to /api/portal/help-requests. Gated by
client_portal_controls.sections.help_button. */
import { useState } from "react";
import { api, formatErr } from "../lib/api";

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
      <div className="bg-bgPanel card-pop rounded-2xl border border-bgHover shadow-2xl p-4" data-testid="portal-need-help-card">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-[13px] font-black text-shBlue uppercase tracking-widest">
            <i className="fas fa-life-ring mr-2"/>Need Help?
          </p>
        </div>
        <p className="text-[12px] text-gray-400 mb-3 leading-snug">
          Question, bug, or idea? Send a quick note to the team — we'll get back to you.
        </p>
        <button onClick={() => { reset(); setOpen(true); }} data-testid="portal-need-help-open"
                className="w-full bg-shBlue text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shBlue/90">
          <i className="fas fa-paper-plane mr-2"/>Contact Support
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
             onClick={() => !busy && setOpen(false)} data-testid="portal-need-help-modal">
          <div onClick={(e)=>e.stopPropagation()}
               className="bg-bgPanel border border-bgHover rounded-2xl w-full sm:max-w-md shadow-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-black text-shBlue uppercase tracking-widest">
                <i className="fas fa-life-ring mr-2"/>Contact Support
              </p>
              <button onClick={() => setOpen(false)} disabled={busy}
                      className="text-gray-500 hover:text-white" data-testid="portal-need-help-close">
                <i className="fas fa-times"/>
              </button>
            </div>

            {sent ? (
              <div className="text-center py-6 space-y-3" data-testid="portal-need-help-sent">
                <div className="mx-auto w-12 h-12 rounded-full bg-shGreen/20 flex items-center justify-center">
                  <i className="fas fa-circle-check text-shGreen text-2xl"/>
                </div>
                <p className="text-white font-black uppercase tracking-widest text-sm">Message sent!</p>
                <p className="text-[12px] text-gray-400">We'll review and reach out as soon as we can.</p>
                <button onClick={() => setOpen(false)} data-testid="portal-need-help-done"
                        className="bg-shGreen text-bgHeader px-6 py-2 rounded text-[13px] font-black uppercase tracking-widest">
                  Done
                </button>
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Type</span>
                  <select value={type} onChange={(e)=>setType(e.target.value)} data-testid="portal-need-help-type"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-[13px] text-white">
                    {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Subject</span>
                  <input value={subject} onChange={(e)=>setSubject(e.target.value)} maxLength={140}
                         data-testid="portal-need-help-subject"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-[13px] text-white"
                         placeholder="Short summary…"/>
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Message</span>
                  <textarea value={message} onChange={(e)=>setMessage(e.target.value)} maxLength={4000} rows={5}
                            data-testid="portal-need-help-message"
                            className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-[13px] text-white"
                            placeholder="Tell us what's going on…"/>
                </label>
                {err && <div className="text-[13px] font-black p-2 rounded bg-red-500/15 text-red-400 text-center">{err}</div>}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setOpen(false)} disabled={busy}
                          className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:border-shBlue">
                    Cancel
                  </button>
                  <button onClick={submit} disabled={busy} data-testid="portal-need-help-submit"
                          className="bg-shBlue text-bgHeader px-5 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
                    <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-paper-plane"} mr-2`}/>{busy ? "Sending..." : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
