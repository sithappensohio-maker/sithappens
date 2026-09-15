/* Stage 10 — the one visual primitive for "what just happened / what
 * happens next". Renders a normalised handoff (lib/handoff.js):
 *
 *   [icon] EYEBROW (state word)          ← state is icon + words, never colour alone
 *   Title                                ← an actual heading; focus lands here
 *   summary
 *   NEXT  label / description
 *   [primary action]  [secondary]        ← only when the handoff carries one
 *
 * Testids default to `handoff-*`; a host can map them onto the ids its
 * existing tests already know (the Practice Coach keeps `practice-complete-*`). */
import { useEffect, useRef } from "react";
import { HANDOFF_STATE_META } from "../lib/handoff";

const TONE = {
  lime: { border: "border-shPrimary/45", bg: "bg-shPrimary/[0.08]", eyebrow: "text-shPrimary", icon: "bg-shPrimary/15 border-shPrimary/40 text-shPrimary" },
  cyan: { border: "border-shSecondary/40", bg: "bg-shSecondary/[0.06]", eyebrow: "text-shSecondary", icon: "bg-shSecondary/15 border-shSecondary/40 text-shSecondary" },
  red: { border: "border-red-400/40", bg: "bg-red-500/[0.06]", eyebrow: "text-red-300", icon: "bg-red-500/15 border-red-400/40 text-red-300" },
};

export default function HandoffPanel({ handoff, testid = "handoff", ids = {}, onAction, onSecondary, autoFocus = true, compact = false, status = null, className = "" }) {
  const titleRef = useRef(null);
  useEffect(() => {
    if (!autoFocus || !titleRef.current) return;
    try { titleRef.current.focus({ preventScroll: false }); } catch { /* ignore */ }
  }, [autoFocus, handoff?.title]);
  if (!handoff) return null;
  const meta = HANDOFF_STATE_META[handoff.state] || HANDOFF_STATE_META.complete;
  const tone = TONE[meta.tone] || TONE.lime;
  const id = (k, fallback) => ids[k] || fallback;
  const isError = handoff.state === "error";

  return (
    <section role={isError ? "alert" : "status"} aria-live="polite" data-testid={testid} data-state={handoff.state} data-status={status || undefined}
             className={`rounded-2xl border ${tone.border} ${tone.bg} ${compact ? "p-3.5" : "p-4 sm:p-5"} ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 border ${tone.icon}`} aria-hidden="true"><i className={`fas ${meta.icon} text-[16px]`} /></span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${tone.eyebrow}`} data-testid={id("eyebrow", `${testid}-eyebrow`)}>{meta.eyebrow}</p>
          <h2 ref={titleRef} tabIndex={-1} className="text-[20px] sm:text-[22px] font-black text-shText leading-tight mt-0.5 outline-none focus-visible:ring-2 focus-visible:ring-shPrimary rounded"
              data-testid={id("title", `${testid}-title`)}>{handoff.title}</h2>
          {handoff.summary && <p className="text-[15px] text-shText mt-1 leading-relaxed" data-testid={id("summary", `${testid}-summary`)}>{handoff.summary}</p>}
        </div>
      </div>

      {handoff.next && (
        <div className={`mt-3 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 ${compact ? "" : "sm:px-4 sm:py-3"}`} data-testid={id("next", `${testid}-next`)} data-status={status || undefined}>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-shTextMuted">Next</p>
          {handoff.next.label && <p className="text-[16px] font-black text-shText mt-0.5 leading-snug">{handoff.next.label}</p>}
          {handoff.next.description && <p className="text-[14px] text-shTextMuted mt-0.5 leading-relaxed">{handoff.next.description}</p>}
        </div>
      )}

      {(handoff.action || handoff.secondary) && (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
          {handoff.action && (
            <button type="button" onClick={() => onAction?.(handoff.action)} data-testid={id("action", `${testid}-action`)} data-primary-action="true"
                    className="min-h-[50px] px-5 rounded-xl bg-shPrimary text-bgHeader font-black text-[15px] uppercase tracking-widest shadow hover:brightness-110 transition inline-flex items-center justify-center gap-2">
              {handoff.action.label}<i className="fas fa-arrow-right text-[13px]" aria-hidden="true" />
            </button>
          )}
          {handoff.secondary && (
            <button type="button" onClick={() => onSecondary?.(handoff.secondary)} data-testid={id("secondary", `${testid}-secondary`)}
                    className="min-h-[44px] px-4 rounded-xl border border-shBorder text-shText font-black text-[13px] uppercase tracking-widest hover:border-shSecondary/45 transition">
              {handoff.secondary.label}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
