import { useState } from "react";
import EmptyState from "../../training/EmptyState";
import HuskyDogImage from "../../brand/HuskyDogImage";
import ModuleIconTile from "../ModuleIconTile";
import { moduleHue } from "../../../lib/moduleIcons";

/* Program Welcome — the orientation page for a School program: what this
 * program covers, how School works, and a full read-only index of every
 * module and lesson from day one.
 *
 * Content comes from detail.welcome (see _school_welcome_payload): the index
 * is the enrollment's own frozen snapshot reduced to names/minutes/quiz
 * counts, deliberately with NO lock state and NO lesson ids — nothing here
 * opens a lesson directly, so the roadmap keeps sole ownership of every
 * lock and progression decision. A first-time client lands here (see
 * SchoolApp's welcome redirect); afterwards the course hero's "About this
 * program" link reopens it. */

function minutesLabel(mins) {
  const m = Number(mins || 0);
  if (!m) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
}

function IndexModule({ module: m, position, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const meta = [
    `${m.lesson_count} lesson${m.lesson_count === 1 ? "" : "s"}`,
    minutesLabel(m.total_minutes),
  ].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-shBorder/50 first:border-t-0" data-testid={`welcome-index-module-${position}`}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition">
        <ModuleIconTile module={m} hue={moduleHue(position)} size={38} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-black text-shText leading-snug">{m.name}</span>
          {m.description && <span className="block text-[11.5px] text-shTextMuted mt-0.5 line-clamp-2">{m.description}</span>}
        </span>
        <span className="text-[10px] font-black uppercase tracking-widest text-shTextMuted whitespace-nowrap shrink-0">{meta}</span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[10px] text-shTextMuted shrink-0`} />
      </button>
      {open && (
        <div className="px-4 pb-3" data-testid={`welcome-index-lessons-${position}`}>
          <ol className="space-y-1.5">
            {(m.lessons || []).map((l, i) => (
              <li key={i} className="flex items-baseline gap-2.5 text-[12.5px] text-shText">
                <span className="text-[10px] font-black text-shTextMuted min-w-[16px] tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 leading-snug">{l.name}</span>
                {l.estimated_minutes ? <span className="text-[10.5px] text-shTextMuted whitespace-nowrap tabular-nums">{l.estimated_minutes} min</span> : null}
              </li>
            ))}
          </ol>
          {m.quiz_question_count > 0 && (
            <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary mt-2.5">
              <i className="fas fa-circle-check mr-1.5" />Module quiz · {m.quiz_question_count} question{m.quiz_question_count === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProgramWelcome({ detail, progress, onStart, onViewCourse }) {
  if (!detail) {
    return (
      <div className="space-y-3" data-testid="program-welcome-loading">
        <div className="h-56 rounded-2xl bg-shBorder/30 animate-pulse" />
        <div className="h-32 rounded-2xl bg-shBorder/20 animate-pulse" />
        <div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" />
      </div>
    );
  }
  if (detail.access_state === "revoked" || !detail.welcome) {
    return <EmptyState icon="fa-lock" message="This course's content isn't available right now. Contact us if you believe this is a mistake." testid="program-welcome-unavailable" />;
  }

  const w = detail.welcome;
  const totals = w.totals || {};
  const outcomes = w.outcomes || [];
  const syllabus = w.syllabus || [];
  const dogName = detail.dog_name || "your dog";
  const completed = detail.status === "completed";
  const started = (progress?.lessons_completed ?? 0) > 0 || completed;
  const inPerson = detail.delivery_mode === "in_person";

  const chips = [
    detail.dog_name || null,
    totals.modules ? `${totals.modules} module${totals.modules === 1 ? "" : "s"}` : null,
    totals.lessons ? `${totals.lessons} lesson${totals.lessons === 1 ? "" : "s"}` : null,
    w.estimated_weeks ? `~${w.estimated_weeks} week${w.estimated_weeks === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4" data-testid="program-welcome">
      {/* ------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-shPrimary/40 bg-gradient-to-br from-shPrimary/[0.11] via-black/18 to-shSecondary/[0.055]">
        <div className="flex items-stretch">
          <div className="min-w-0 flex-1 p-5 sm:p-7">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-shPrimary"><i className="fas fa-paw mr-1.5" />Welcome to your program</p>
            <h1 className="text-[25px] sm:text-[32px] font-black text-shText leading-tight mt-2 text-balance" data-testid="welcome-program-name">
              {detail.program_name || "Your program"}
            </h1>
            {w.focus && <p className="text-[13.5px] sm:text-[14.5px] text-shTextMuted mt-2 leading-relaxed">{w.focus}</p>}
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3.5">
                {chips.map((c, i) => (
                  <span key={c} className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full border ${i === 0 && detail.dog_name ? "text-shPrimary border-shPrimary/40 bg-shPrimary/10" : "text-shTextMuted border-shBorder bg-black/20"}`}>
                    {c}
                  </span>
                ))}
              </div>
            )}
            <button type="button" onClick={completed ? onViewCourse : onStart} data-testid="welcome-start"
                    className="mt-5 w-full sm:w-auto sm:px-8 min-h-[54px] rounded-xl bg-shPrimary text-[#071018] font-black text-[14px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_12px_34px_-12px_rgba(140,198,63,0.8)]">
              {completed ? "Review your course" : started ? "Continue training" : "Start Lesson 1"}<i className="fas fa-arrow-right text-[11px]" />
            </button>
            {!completed && (
              <button type="button" onClick={onViewCourse} data-testid="welcome-skip-to-course"
                      className="mt-2 w-full sm:w-auto sm:px-6 sm:ml-2 min-h-[44px] rounded-xl border border-shBorder bg-black/15 text-shTextMuted font-black text-[11px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:border-shPrimary/40 hover:text-shText transition">
                Skip to all lessons
              </button>
            )}
          </div>
          <div className="w-24 sm:w-36 shrink-0 relative hidden xs:block sm:block">
            <HuskyDogImage src={detail.dog_photo} name={detail.dog_name} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--sh-card-base)] via-transparent to-transparent" />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- What's covered */}
      {(w.description || outcomes.length > 0) && (
        <section className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="welcome-covered">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">What this program covers</p>
          {w.description && <p className="text-[13.5px] text-shTextMuted mt-2 leading-relaxed">{w.description}</p>}
          {outcomes.length > 0 && (
            <ul className="mt-3 space-y-2" data-testid="welcome-outcomes">
              {outcomes.map((o) => (
                <li key={o} className="flex items-start gap-2.5 text-[13px] text-shText leading-relaxed">
                  <span className="w-[18px] h-[18px] rounded-md grid place-items-center shrink-0 mt-0.5 border border-shPrimary/40 bg-shPrimary/10 text-shPrimary text-[9px]">
                    <i className="fas fa-check" />
                  </span>
                  <span className="min-w-0">{o}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ------------------------------------------------------ How it works */}
      <section className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="welcome-how-it-works">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">How it works</p>
        <div className="mt-3 space-y-3">
          {[
            { t: "Watch the lesson", s: "Short videos and exact steps — most lessons take under 15 minutes." },
            { t: `Practice with ${dogName}`, s: "Each lesson gives you a practice plan. Log your practice so your trainer can see how it's going." },
            inPerson
              ? { t: "Train with your trainer", s: "Your trainer advances your lessons during your in-person sessions and keeps your plan on track." }
              : { t: "Your trainer checks in", s: "Send videos, ask questions, and pass each module's check before the next one unlocks." },
          ].map((step, i) => (
            <div key={step.t} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full grid place-items-center shrink-0 border border-shSecondary/45 bg-shSecondary/10 text-shSecondary text-[11px] font-black">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[13px] font-black text-shText leading-snug">{step.t}</p>
                <p className="text-[12px] text-shTextMuted leading-relaxed mt-0.5">{step.s}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- Program index */}
      <section className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] overflow-hidden" data-testid="welcome-index">
        <div className="px-4 pt-4 pb-3 sm:px-5">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">Program index</p>
        </div>
        {syllabus.length === 0 ? (
          <p className="text-[12px] text-shTextMuted italic px-4 pb-4">This program's curriculum is being prepared.</p>
        ) : (
          <>
            <div>
              {syllabus.map((m, i) => (
                <IndexModule key={`${m.name}-${i}`} module={m} position={i + 1} defaultOpen={i === 0} />
              ))}
            </div>
            <p className="px-4 py-3 border-t border-shBorder/50 bg-black/20 text-[11px] text-shTextMuted leading-relaxed">
              Every module and lesson is listed here from day one — the index shows the whole journey, including parts that unlock later.
            </p>
          </>
        )}
      </section>

      {/* -------------------------------------------------- Trainer promise */}
      <section className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4 sm:p-5 flex items-center gap-3.5" data-testid="welcome-trainer-promise">
        <span className="w-11 h-11 rounded-full grid place-items-center shrink-0 bg-gradient-to-br from-shSecondary to-shPrimary text-[#071018]">
          <i className="fas fa-hand-holding-heart text-[15px]" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-black text-shText leading-snug">Your trainer is with you the whole way</p>
          <p className="text-[11.5px] text-shTextMuted leading-relaxed mt-0.5">Questions, video feedback, and graduation — a real person reviews your work, not an algorithm.</p>
        </div>
      </section>
    </div>
  );
}
