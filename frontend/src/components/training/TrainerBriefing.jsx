/* Stage 6 — Trainer 60-second briefing.
 *
 * Shown inside the existing Training Session Workspace modal BEFORE the
 * working lesson interface. Pure presentation of `overview.briefing`, which
 * the draft bootstrap already returns (no extra fetch): what we are working
 * on today, what happened last time, whether the client practised, what the
 * client told us, and what to focus on. The primary action is the existing
 * canonical draft: the server get-or-create already happened, so "Start" /
 * "Resume" only reveals the workspace — it can never create a second
 * session.
 */
import DogIdentityHeader from "./DogIdentityHeader";

const MODE_LABEL = { in_person: "Trainer-Led", hybrid: "Hybrid", online: "Online" };

const PRACTICE_TONE = {
  completed: "text-shPrimary", partial: "text-shText", none: "text-shAccent", needs_redo: "text-shAccent",
  not_assigned: "text-shTextMuted", optional_incomplete: "text-shTextMuted",
};
const PRACTICE_ICON = {
  completed: "fa-circle-check", partial: "fa-circle-half-stroke", none: "fa-circle-xmark", needs_redo: "fa-rotate-left",
  not_assigned: "fa-minus", optional_incomplete: "fa-minus",
};
const CHECKPOINT_TONE = {
  ready: "border-shSecondary/40 bg-shSecondary/[0.06] text-shSecondary",
  submitted: "border-shAccent/50 bg-shAccent/[0.08] text-shAccent",
  more_practice: "border-shAccent/50 bg-shAccent/[0.08] text-shAccent",
  trainer_assist: "border-purple-400/40 bg-purple-500/[0.08] text-purple-300",
  passed: "border-shPrimary/40 bg-shPrimary/[0.08] text-shPrimary",
  graded: "border-shBorder bg-black/15 text-shTextMuted",
};

function Section({ label, icon, tone = "text-shTextMuted", children, testid }) {
  return (
    <section className="rounded-2xl border border-shBorder/60 bg-black/15 px-4 py-3.5" data-testid={testid}>
      <p className={`text-[11px] font-black uppercase tracking-[0.16em] ${tone}`}><i className={`fas ${icon} mr-1.5`} aria-hidden="true" />{label}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function Quote({ text, source, unanswered }) {
  return (
    <div className="border-l-2 border-shSecondary/40 pl-3">
      <p className="text-[15px] text-shText leading-relaxed">“{text}”</p>
      <p className="text-[12px] text-shTextMuted mt-0.5">{source}{unanswered ? <span className="text-shAccent font-bold"> · unanswered</span> : null}</p>
    </div>
  );
}

export function primaryActionFor(briefing, draft) {
  const status = draft?.status || briefing?.session?.status;
  if (status === "completed" || status === "completing") return { key: "view", label: "Open Session Record" };
  if (briefing?.session?.has_recorded_work) return { key: "resume", label: "Resume Lesson" };
  return { key: "start", label: "Start Lesson" };
}

export default function TrainerBriefing({ briefing, dog, draft, onStart, onReviewCheckpoint, onClose, embedded = false }) {
  if (!briefing) return null;
  const today = briefing.today || {};
  const last = briefing.last_session;
  const practice = briefing.practice || {};
  const reports = briefing.client_reports || [];
  const focus = briefing.focus || {};
  const cp = briefing.checkpoint;
  const attention = briefing.attention || [];
  const action = primaryActionFor(briefing, draft);
  const modeLabel = MODE_LABEL[today.training_mode] || null;
  const lessonPos = today.lesson_number && today.lesson_count ? `Lesson ${today.lesson_number} of ${today.lesson_count}` : null;
  const crumbs = [today.program_name, modeLabel, today.module_name].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col min-h-0 flex-1" data-testid="trainer-briefing" data-primary-action={action.key}>
      {/* Header — omitted when the workspace shell already shows the dog +
          phase navigation above the briefing (Stage 7). */}
      {!embedded && <div className="sh-school-splash overflow-hidden px-4 sm:px-6 py-4 border-b border-shPrimary/30 shrink-0 bg-gradient-to-r from-shPrimary/[0.16] via-shSecondary/[0.10] to-transparent rounded-t-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shPrimary"><i className="fas fa-bolt mr-1.5" aria-hidden="true" />60-second briefing</p>
            <div className="mt-2"><DogIdentityHeader dogName={dog?.name} dogPhoto={dog?.photo} breadcrumb={crumbs} testid="briefing-dog-header" /></div>
          </div>
          <button type="button" onClick={onClose} data-testid="briefing-close" aria-label="Close" className="text-shTextMuted hover:text-shText text-xl px-2 min-h-[44px]"><i className="fas fa-times" aria-hidden="true" /></button>
        </div>
      </div>}

      <div className="overflow-y-auto flex-1 min-h-0 px-4 sm:px-6 py-4 space-y-3">
        {/* TODAY */}
        <section className="rounded-2xl border border-shPrimary/35 bg-shPrimary/[0.06] px-4 py-4" data-testid="briefing-today">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-calendar-day mr-1.5" aria-hidden="true" />{cp ? "Today's checkpoint" : "Today"}</p>
          <h2 className="text-[24px] sm:text-[28px] font-black text-shText leading-tight mt-1">{today.lesson_name || "No current lesson"}</h2>
          <p className="text-[14px] text-shTextMuted mt-1">
            {[lessonPos, today.program_name, modeLabel].filter(Boolean).join(" · ")}
            {today.is_final_lesson ? " · Final lesson" : ""}
          </p>
          {!today.lesson_name && (
            <p className="text-[14px] text-shAccent mt-2">This program has no current lesson set. Fix the program position before running a session.</p>
          )}
          {cp && (
            <div className={`mt-3 rounded-xl border px-3 py-2.5 ${CHECKPOINT_TONE[cp.state] || CHECKPOINT_TONE.graded}`} data-testid="briefing-checkpoint" data-state={cp.state}>
              <p className="text-[13px] font-black uppercase tracking-widest"><i className="fas fa-flag-checkered mr-1.5" aria-hidden="true" />{cp.label}</p>
              <p className="text-[14px] text-shText mt-1 leading-relaxed">{cp.detail}</p>
              {cp.trainer_feedback && cp.state !== "ready" && <p className="text-[13px] text-shTextMuted mt-1">Your feedback: “{cp.trainer_feedback}”</p>}
              {cp.action === "review" && (
                onReviewCheckpoint ? (
                  <button type="button" onClick={() => onReviewCheckpoint(cp)} data-testid="briefing-review-checkpoint"
                          className="mt-2 min-h-[44px] px-4 rounded-xl bg-shAccent text-[#071018] text-[13px] font-black uppercase tracking-widest inline-flex items-center gap-2">
                    Review Checkpoint <i className="fas fa-arrow-right text-[11px]" aria-hidden="true" />
                  </button>
                ) : (
                  <p className="text-[13px] text-shTextMuted mt-1" data-testid="briefing-review-checkpoint-hint">Review it from Training → Checkpoints.</p>
                )
              )}
            </div>
          )}
        </section>

        {/* NEEDS ATTENTION — only when something genuinely does */}
        {attention.length > 0 && (
          <Section label="Needs attention" icon="fa-hand-point-right" tone="text-shAccent" testid="briefing-attention">
            <ul className="space-y-1">
              {attention.map((a) => (
                <li key={a.kind} className="text-[14px] text-shText flex gap-2" data-testid={`briefing-attention-${a.kind}`}>
                  <i className="fas fa-circle text-[6px] mt-2 text-shAccent shrink-0" aria-hidden="true" />{a.text}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* LAST TIME */}
        <Section label="Last time" icon="fa-clock-rotate-left" tone="text-shSecondary" testid="briefing-last">
          {!last && <p className="text-[14px] text-shTextMuted">No trainer session on this program yet. This is the first lesson.</p>}
          {last && (
            <>
              <p className="text-[16px] font-black text-shText">{last.lesson_name || "Training session"}</p>
              <p className="text-[13px] text-shTextMuted -mt-1">{last.summary_line}</p>
              {last.skills?.length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="briefing-last-skills">
                  {last.skills.map((sk) => (
                    <li key={sk.name} className="text-[14px] text-shText">
                      <span className="font-bold">{sk.name}</span>
                      {sk.score != null && <span className="text-shSecondary font-black"> {sk.score}/5</span>}
                      {sk.assessment && <span className="text-shTextMuted"> · {sk.assessment}</span>}
                      {sk.mastery && <span className="text-shPrimary"> · {sk.mastery}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {last.what_went_well && <p className="text-[15px] text-shText"><span className="text-shPrimary font-black">Went well · </span>{last.what_went_well}</p>}
              {last.needs_work && <p className="text-[15px] text-shText"><span className="text-shAccent font-black">Needs work · </span>{last.needs_work}</p>}
              {last.next_lesson_focus && <p className="text-[15px] text-shText"><span className="text-shSecondary font-black">Next focus you wrote · </span>{last.next_lesson_focus}</p>}
              {last.legacy && <p className="text-[13px] text-shTextMuted">No written summary was recorded for that session.</p>}
            </>
          )}
        </Section>

        {/* HOME PRACTICE */}
        <Section label="Home Practice" icon="fa-bullseye" tone={PRACTICE_TONE[practice.state] || "text-shTextMuted"} testid="briefing-practice">
          <p className={`text-[16px] font-black ${PRACTICE_TONE[practice.state] || "text-shText"}`} data-state={practice.state}>
            <i className={`fas ${PRACTICE_ICON[practice.state] || "fa-minus"} mr-1.5`} aria-hidden="true" />{practice.headline}
          </p>
          {practice.last_practiced_label && <p className="text-[14px] text-shTextMuted -mt-1">Last practised: {practice.last_practiced_label}</p>}
          {practice.detail && <p className="text-[14px] text-shText border-l-2 border-shAccent/40 pl-3">Your note: “{practice.detail}”</p>}
          {practice.quality?.length > 0 && (
            <ul className="text-[14px] text-shText space-y-0.5" data-testid="briefing-practice-quality">
              {practice.quality.map((q) => <li key={q}>· {q}</li>)}
            </ul>
          )}
          {practice.items?.length > 1 && (
            <ul className="text-[13px] text-shTextMuted space-y-0.5">
              {practice.items.map((it) => <li key={it.title}>{it.title}{it.line ? ` · ${it.line}` : ""}</li>)}
            </ul>
          )}
        </Section>

        {/* CLIENT REPORTED — omitted when nothing relevant exists */}
        {reports.length > 0 && (
          <Section label="Client reported" icon="fa-comment-dots" tone="text-shSecondary" testid="briefing-client-reported">
            {reports.map((r, i) => <Quote key={i} text={r.text} source={r.source} unanswered={r.unanswered} />)}
          </Section>
        )}

        {/* TODAY'S FOCUS */}
        <Section label="Today's focus" icon="fa-crosshairs" tone="text-shPrimary" testid="briefing-focus">
          {focus.conflict ? (
            <div className="space-y-2" data-testid="briefing-focus-conflict">
              <p className="text-[13px] text-shTextMuted">The lesson moved on since you wrote your last focus — pick what today needs.</p>
              <p className="text-[15px] text-shText"><span className="text-shSecondary font-black">Previous trainer focus{focus.conflict.previous_lesson ? ` (${focus.conflict.previous_lesson})` : ""} · </span>{focus.conflict.previous}</p>
              <p className="text-[15px] text-shText"><span className="text-shPrimary font-black">Current lesson objective · </span>{focus.conflict.current_objective}</p>
            </div>
          ) : focus.text ? (
            <>
              <p className="text-[18px] font-black text-shText leading-snug">{focus.text}</p>
              {focus.source_label && <p className="text-[12px] text-shTextMuted -mt-1">{focus.source_label}</p>}
              {focus.goal && <p className="text-[15px] text-shText"><span className="text-shPrimary font-black">Goal · </span>{focus.goal}</p>}
            </>
          ) : (
            <p className="text-[14px] text-shTextMuted">No focus recorded yet — the lesson plan below is your starting point.</p>
          )}
          {focus.purpose && <p className="text-[13px] text-shTextMuted">Why this lesson: {focus.purpose}</p>}
        </Section>
      </div>

      {/* Primary action — always reachable, thumb-height on phones */}
      <div className="shrink-0 border-t border-shBorder/60 px-4 sm:px-6 py-3 bg-[var(--sh-card-base)] rounded-b-2xl sticky bottom-0">
        <button type="button" onClick={() => onStart?.(action.key)} data-testid="briefing-primary-action"
                className="w-full min-h-[56px] rounded-2xl bg-shPrimary text-[#071018] text-[16px] font-black uppercase tracking-[0.14em] inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
          <i className={`fas ${action.key === "resume" ? "fa-play" : action.key === "view" ? "fa-eye" : "fa-flag"}`} aria-hidden="true" />{action.label}
        </button>
        {action.key === "resume" && briefing.session && (
          <p className="text-[12px] text-shTextMuted text-center mt-1.5" data-testid="briefing-resume-note">
            {briefing.session.recorded_skills > 0 ? `${briefing.session.recorded_skills} skill${briefing.session.recorded_skills === 1 ? "" : "s"} already recorded today` : "Notes already started today"}
            {briefing.session.created_by_name ? ` · opened by ${briefing.session.created_by_name}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
