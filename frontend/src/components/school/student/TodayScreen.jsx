import { accentRgb } from "../../premium/tokens";
import { actionMeta, isCaughtUp } from "../../../lib/studentSchool";
import EmptyState from "../../training/EmptyState";
import SupportStatusCard from "./SupportStatusCard";

/* Today's Training (Phase 2B) — "what do I need to do right now?" One hero,
 * one obvious CTA, driven entirely by the server-derived current_action (the
 * Phase-2A decision tree is NOT recreated here), plus concise current-lesson
 * context below. Never duplicates the whole Lesson page. */

const HERO_COPY = {
  lesson:            { eyebrow: "Learn",              cta: "Start lesson" },
  practice:          { eyebrow: "Practice",           cta: "Start practice" },
  submit_checkpoint: { eyebrow: "Trainer checkpoint", cta: "Submit checkpoint" },
  remediation:       { eyebrow: "Your trainer's plan", cta: "Open practice plan" },
  trainer_assist:    { eyebrow: "Trainer Assist",     cta: "See details" },
  trainer_guided:    { eyebrow: "Trainer-led training", cta: "Review training plan" },
  awaiting_review:   { eyebrow: "Submitted",          cta: null },
  advance:           { eyebrow: "Nice work",          cta: "Continue to next lesson" },
  course_complete:   { eyebrow: "Course complete",    cta: "Review your course" },
  access_expired:    { eyebrow: "Course access",      cta: null },
  setup_required:    { eyebrow: "One moment",         cta: null },
  onboarding:        { eyebrow: "School setup",        cta: null },
  course_paused:     { eyebrow: "Training paused",     cta: null },
  start:             { eyebrow: "Welcome",            cta: "Start school" },
};

export default function TodayScreen({ home, loading, practiceJustCompleted, onAction, onAskTrainer }) {
  if (loading && !home) {
    return (
      <div className="space-y-4" data-testid="today-loading">
        <div className="h-52 rounded-2xl bg-shBorder/30 animate-pulse" />
        <div className="h-28 rounded-2xl bg-shBorder/20 animate-pulse" />
      </div>
    );
  }
  if (!home) {
    return <EmptyState icon="fa-bullseye" message="We couldn't load today's training — try again shortly." testid="today-error" />;
  }

  const action = home.current_action || {};
  const meta = actionMeta(action.type);
  const rgb = accentRgb(meta.accent);
  const copy = HERO_COPY[action.type] || { eyebrow: "Today", cta: action.label };
  const lesson = home.current_lesson;
  const dog = home.dog?.name || "your dog";
  const caughtUp = isCaughtUp(action.type);
  const equipment = Array.isArray(lesson?.equipment_needed)
    ? lesson.equipment_needed.filter(Boolean)
    : (typeof lesson?.equipment_needed === "string" && lesson.equipment_needed
        ? lesson.equipment_needed.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const minutes = lesson?.estimated_minutes;
  const showLessonContext = !!lesson && !["course_complete", "access_expired", "start"].includes(action.type);

  return (
    <div className="max-w-3xl mx-auto space-y-4" data-testid="today-screen">
      {practiceJustCompleted && (
        <div className="rounded-2xl border border-shPrimary/40 bg-shPrimary/10 p-4" data-testid="today-practice-complete">
          <p className="text-shPrimary font-black text-[15px]"><i className="fas fa-circle-check mr-2" />Practice complete — nice work.</p>
          <p className="text-[13px] text-shTextMuted mt-1">Here's what's next for {dog}.</p>
        </div>
      )}

      {/* Hero */}
      <section className="rounded-2xl border p-5 sm:p-6"
               style={{ borderColor: `rgba(${rgb},0.35)`, background: `linear-gradient(160deg, rgba(${rgb},0.10), var(--sh-card-base) 62%)` }}
               data-testid="today-hero">
        <p className="text-[11px] font-black uppercase tracking-[0.28em]" style={{ color: `rgb(${rgb})` }}>
          <i className={`fas ${meta.icon} mr-1.5`} />{copy.eyebrow}
        </p>
        <p className="text-[12px] text-shTextMuted mt-2 uppercase tracking-widest font-bold truncate">
          {home.program?.name}{home.current_module?.name ? ` · ${home.current_module.name}` : ""}
        </p>
        <h1 className="text-shText font-black text-[21px] sm:text-[25px] leading-tight mt-1 text-balance" data-testid="today-title">
          {caughtUp && action.type === "awaiting_review" ? "Your part is complete for now"
            : lesson?.name && !["course_complete", "access_expired", "setup_required", "start"].includes(action.type)
              ? `Today: ${lesson.name}` : action.label}
        </h1>
        {action.sublabel && (
          <p className="text-[14px] text-shTextMuted mt-2.5 leading-relaxed">{action.sublabel}</p>
        )}

        {(minutes || equipment.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            {minutes && (
              <span className="text-[12px] font-bold text-shTextMuted bg-[var(--sh-card-base)] border border-shBorder rounded-full px-3 py-1">
                <i className="fas fa-clock mr-1.5" />{minutes} min
              </span>
            )}
            {equipment.map((e) => (
              <span key={e} className="text-[12px] font-bold text-shTextMuted bg-[var(--sh-card-base)] border border-shBorder rounded-full px-3 py-1">{e}</span>
            ))}
          </div>
        )}

        {copy.cta ? (
          <button type="button" onClick={() => onAction(action)} data-testid="today-cta"
                  className="mt-5 w-full sm:w-auto inline-flex items-center justify-center gap-2 text-[14px] font-black uppercase tracking-widest px-6 py-3.5 rounded-xl transition active:scale-[0.99]"
                  style={{ background: `rgb(${rgb})`, color: "#0b0f14" }}>
            {copy.cta}<i className="fas fa-arrow-right" />
          </button>
        ) : (
          <p className="mt-5 text-[13px] font-bold text-shTextMuted" data-testid="today-no-cta">
            {action.type === "awaiting_review" ? "Your trainer will review your checkpoint — you'll get an email when it's ready."
              : action.type === "setup_required" ? "Your trainer needs to update this lesson before you can continue."
              : action.type === "onboarding" ? "Complete the School setup below before you begin training."
              : action.type === "course_paused" ? "Training is paused for now. Your completed work and feedback remain saved."
              : action.type === "access_expired" ? "Reach out to us to restore access to this course."
              : "Nothing needed from you right now."}
          </p>
        )}
      </section>

      <SupportStatusCard home={home} onAskTrainer={onAskTrainer} onStartPractice={action.type === "remediation" ? () => onAction(action) : null} />

      {!["access_expired", "setup_required", "course_complete"].includes(action.type) && (
        <button type="button" onClick={onAskTrainer} className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-shSecondary/30 text-shSecondary text-[11px] font-black uppercase tracking-widest hover:text-shText" data-testid="today-ask-trainer">
          <i className="fas fa-comment-dots mr-1.5" />Ask your trainer
        </button>
      )}

      {/* Concise supporting context from the current lesson — not the whole lesson page */}
      {showLessonContext && (lesson.client_overview || lesson.success_criteria) && (
        <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5 space-y-3" data-testid="today-context">
          {lesson.client_overview && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-shSecondary mb-1">Today's goal</p>
              <p className="text-[14px] text-shText leading-relaxed">{lesson.client_overview}</p>
            </div>
          )}
          {lesson.success_criteria && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-shPrimary mb-1"><i className="fas fa-flag-checkered mr-1" />Success looks like</p>
              <p className="text-[13px] text-shTextMuted leading-relaxed">{lesson.success_criteria}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
