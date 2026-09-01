import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export default function AskTrainerPanel({ open, context, onClose, onSent }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setText(""); setSent(false); setError("");
  }, [open, context?.school_lesson_id, context?.school_checkpoint_id]);

  if (!open) return null;
  const subjectBits = [context?.dog_name, context?.school_lesson_name || context?.school_program_name].filter(Boolean);
  const subject = subjectBits.length ? `School · ${subjectBits.join(" · ")}` : "School question";

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await api.post("/me/messages", {
        category: "training",
        subject,
        body: text.trim(),
        dog_id: context?.dog_id || null,
        school_enrollment_id: context?.school_enrollment_id || null,
        school_module_id: context?.school_module_id || null,
        school_lesson_id: context?.school_lesson_id || null,
        school_homework_id: context?.school_homework_id || null,
        school_checkpoint_id: context?.school_checkpoint_id || null,
      });
      setSent(true); setText(""); onSent?.();
    } catch (e) {
      setError(e.response?.data?.detail || "Couldn't send your question — try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={onClose} data-testid="school-ask-trainer-modal">
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-shBorder bg-[var(--sh-card-base)] p-5 sm:p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-black uppercase tracking-[0.22em] text-shSecondary">Sit Happens School</p>
            <h2 className="text-xl sm:text-2xl font-black text-shText mt-1">Ask Your Trainer</h2>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl border border-shBorder text-shTextMuted hover:text-shText" aria-label="Close" data-testid="school-ask-close"><i className="fas fa-times" /></button>
        </div>

        <div className="mt-4 rounded-xl border border-shSecondary/25 bg-shSecondary/[0.05] p-3" data-testid="school-ask-context">
          <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary">About</p>
          <p className="text-[17px] font-black text-shText mt-1">{context?.dog_name || "Your dog"} · {context?.school_program_name || "School"}</p>
          {(context?.school_module_name || context?.school_lesson_name) && (
            <p className="text-[15px] text-shTextMuted mt-0.5">{[context?.school_module_name, context?.school_lesson_name].filter(Boolean).join(" · ")}</p>
          )}
        </div>

        {sent ? (
          <div className="mt-5 rounded-2xl border border-shPrimary/35 bg-shPrimary/10 p-5 text-center" data-testid="school-ask-sent">
            <i className="fas fa-circle-check text-shPrimary text-2xl" />
            <p className="text-shText font-black mt-2">Question sent.</p>
            <p className="text-[16px] text-shTextMuted mt-1">Your trainer has the dog, course, and lesson context attached.</p>
            <button onClick={onClose} className="mt-4 px-5 py-2.5 rounded-xl bg-shPrimary text-bgHeader text-[15px] font-black uppercase tracking-widest">Done</button>
          </div>
        ) : (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} autoFocus placeholder="What are you stuck on?"
                      className="mt-4 w-full rounded-xl border border-shBorder bg-black/20 p-3 text-[17px] text-shText resize-y min-h-[130px]"
                      data-testid="school-ask-body" />
            {error && <p className="text-[15px] text-shDanger mt-2" data-testid="school-ask-error">{error}</p>}
            <button onClick={send} disabled={busy || !text.trim()} className="mt-3 w-full min-h-[50px] rounded-xl bg-shPrimary text-bgHeader text-[16px] font-black uppercase tracking-widest disabled:opacity-40" data-testid="school-ask-send">
              {busy ? <><i className="fas fa-spinner fa-spin mr-2" />Sending…</> : <><i className="fas fa-paper-plane mr-2" />Send question</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
