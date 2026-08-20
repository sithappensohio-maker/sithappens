/* Client School — the checkpoint experience.
 *
 * Phase 4 of the client redesign. A checkpoint is the milestone the whole
 * module builds towards, so it reads as one: what you're about to show, which
 * skills it covers, what your trainer scores, and what happens next.
 *
 * EVERYTHING here is presentation over data the server already publishes.
 * The rubric arrives through _client_safe_checkpoint_rubric, which strips the
 * trainer-only grading guidance (pass_readiness_guidance and the per-criterion
 * "what separates a 1 from a 5" notes) — so the client sees criterion NAMES,
 * never the mark scheme. Scores come from the persisted handler_overall /
 * dog_overall and are never derived, defaulted or invented here: a legacy row
 * with no resolvable score shows an em dash, not a zero.
 *
 * Nothing in this file decides an outcome, an advancement or a permission.
 */
import { useEffect, useState } from "react";
import ScorePair from "../ScorePair";
import PremiumButton from "../../../premium/PremiumButton";
import NeonEdge from "../../../premium/NeonEdge";

/* ------------------------------------------------------------- state --- */

/** Which checkpoint experience this client is in right now.
 *
 *  Derived ONLY from the canonical checkpoint status plus the delivery mode
 *  the server assigned. Returning a single name keeps every branch — and
 *  every test — honest about which states can coexist.
 */
export function checkpointState({ status, practiced, deliveryMode } = {}) {
  // B6: an in-person / trainer-led student never submits a checkpoint. The
  // server rejects it with a 409, and the client must never offer the action.
  const trainerAssessed = deliveryMode === "in_person" || deliveryMode === "trainer_led";
  const ta = status?.trainer_assist;

  if (status?.on_hold && ta) return "trainer_assist";
  if (!status?.on_hold && ta?.status === "completed" && status?.status === "graded"
      && status?.outcome !== "advance") return "assist_complete";
  if (status?.status === "awaiting_review") return "awaiting_review";
  if (status?.status === "graded") {
    if (status.outcome === "advance") return "passed";
    if (status.outcome === "prescribe_practice") return "more_practice";
    if (status.outcome === "trainer_assist_recommended") return "trainer_assist";
  }
  if (trainerAssessed) return "in_person";
  if (!practiced) return "not_ready";
  return "ready";
}

/** A checkpoint state is terminal-for-now when the client cannot submit. Used
 *  to guarantee no submit control is rendered alongside these. */
export const NON_SUBMITTING_STATES = ["awaiting_review", "passed", "trainer_assist", "in_person", "not_ready"];

/** What passing this checkpoint actually opens up, read from the roadmap the
 *  server already sent. The next lesson inside the same module when there is
 *  one; otherwise the next module by name. Returns null when the roadmap
 *  cannot say — the caller then states the fact generically rather than
 *  inventing a destination.
 *
 *  Deliberately describes COURSE progress only. Passing a checkpoint unlocks
 *  the next lesson; it is never a statement about what a dog is now allowed to
 *  do off-leash or in public, and this must not become one.
 */
export function nextStepAfter(roadmap) {
  const mods = roadmap?.modules || [];
  const curLesson = roadmap?.current_lesson_id;
  const curModule = roadmap?.current_module_id;
  for (let mi = 0; mi < mods.length; mi += 1) {
    const lessons = mods[mi].lessons || [];
    const li = lessons.findIndex((l) => l.id === curLesson);
    if (li === -1) continue;
    if (lessons[li + 1]) return { kind: "lesson", name: lessons[li + 1].name };
    const nextMod = mods[mi + 1];
    return nextMod ? { kind: "module", name: nextMod.name } : null;
  }
  const mi = mods.findIndex((m) => m.id === curModule);
  if (mi >= 0 && mods[mi + 1]) return { kind: "module", name: mods[mi + 1].name };
  return null;
}

/* ------------------------------------------------------------ pieces --- */

export function CheckpointHero({ rubric, moduleName, dogName, tone = "cyan", eyebrow, title, blurb, icon = "fa-flag-checkered" }) {
  const isFinal = rubric?.assessment_type === "final_assessment";
  const accent = tone === "lime" ? "text-shPrimary" : tone === "orange" ? "text-shAccent"
    : tone === "purple" ? "text-purple-300" : "text-shSecondary";
  const ring = tone === "lime" ? "border-shPrimary/30 bg-shPrimary/10" : tone === "orange" ? "border-shAccent/30 bg-shAccent/10"
    : tone === "purple" ? "border-purple-400/30 bg-purple-400/10" : "border-shSecondary/30 bg-shSecondary/10";
  return (
    <div className="flex items-start gap-3.5">
      <span className={`w-12 h-12 rounded-2xl grid place-items-center shrink-0 border ${ring}`}>
        <i className={`fas ${icon} ${accent} text-[16px]`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${accent}`}>
          {eyebrow || (isFinal ? "Final assessment" : "Checkpoint")}
          {moduleName ? <span className="text-shTextMuted"> · {moduleName}</span> : null}
        </p>
        <h3 className="text-[19px] sm:text-[21px] font-black text-shText mt-1 leading-tight text-balance">
          {title || rubric?.title || "Trainer checkpoint"}
        </h3>
        {blurb && <p className="text-[13px] text-shTextMuted mt-1.5 leading-relaxed">{blurb}</p>}
        {dogName && !blurb && <p className="text-[13px] text-shTextMuted mt-1.5">You&apos;ve practised it — now let&apos;s see {dogName} do it.</p>}
      </div>
    </div>
  );
}

/** What the trainer scores. Criterion NAMES only — the guidance behind each
 *  one is the trainer's mark scheme and never reaches this payload. */
export function ScoredCriteria({ rubric, testid = "checkpoint-criteria" }) {
  const h = rubric?.handler_criteria || [];
  const d = rubric?.dog_criteria || [];
  if (!h.length && !d.length) return null;
  const col = (label, help, items, tone) => items.length ? (
    <div className="min-w-0">
      <p className={`text-[9.5px] font-black uppercase tracking-[0.16em] ${tone}`}>{label}</p>
      <p className="text-[11px] text-shTextMuted mt-0.5 leading-snug">{help}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((c) => (
          <li key={c.id || c.name} className="flex items-start gap-2 text-[12.5px] text-shText leading-snug">
            <i className="fas fa-circle text-[4px] mt-1.5 opacity-50 shrink-0" />
            <span className="min-w-0">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
  return (
    <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3.5" data-testid={testid}>
      <p className="text-[9.5px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2.5">What your trainer scores</p>
      <div className="grid sm:grid-cols-2 gap-4">
        {col("Handler Skills", "How you're performing the technique.", h, "text-shSecondary")}
        {col("Dog Performance", "How consistently your dog does it.", d, "text-shPrimary")}
      </div>
    </div>
  );
}

/** The skills this checkpoint covers, as the trainer named them. */
export function SkillsCovered({ skills, testid = "checkpoint-skills" }) {
  if (!skills?.length) return null;
  return (
    <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3.5" data-testid={testid}>
      <p className="text-[9.5px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2">What you&apos;ll demonstrate</p>
      <div className="flex flex-wrap gap-1.5">
        {skills.map((s) => (
          <span key={s.id || s.name} className="text-[12px] font-black text-shText rounded-lg border border-shSecondary/25 bg-shSecondary/[0.06] px-2.5 py-1.5">
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Authored filming / submission copy, in full.
 *
 *  Deliberately NOT clamped or summarised: the advanced curricula carry real
 *  safety constraints in this text ("use a secure fenced area or attached long
 *  line; never stage unsafe off-leash work for a video"), and truncating a
 *  safety instruction to make a card tidier is not a trade this UI may make.
 */
export function SubmissionRequirements({ rubric, testid = "checkpoint-requirements" }) {
  const instructions = (rubric?.submission_instructions || "").trim();
  const requirements = (rubric?.submission_requirements || "").trim();
  if (!instructions && !requirements) return null;
  return (
    <div className="rounded-xl border border-shSecondary/25 bg-shSecondary/[0.05] p-3.5 space-y-2.5" data-testid={testid}>
      <p className="text-[9.5px] font-black uppercase tracking-[0.16em] text-shSecondary">
        <i className="fas fa-circle-info mr-1.5" />What to show
      </p>
      {instructions && <p className="text-[13px] text-shText/90 whitespace-pre-wrap leading-relaxed">{instructions}</p>}
      {requirements && <p className="text-[13px] text-shText/90 whitespace-pre-wrap leading-relaxed">{requirements}</p>}
    </div>
  );
}

/** What happens after submitting — the app's own workflow, stated plainly.
 *  No response time is promised, because nothing in the system stores one. */
export function WhatHappensNext({ items, testid = "checkpoint-next" }) {
  return (
    <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3.5" data-testid={testid}>
      <p className="text-[9.5px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2">What happens next</p>
      <ol className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-shTextMuted leading-snug">
            <span className="w-5 h-5 rounded-full grid place-items-center shrink-0 border border-shBorder text-[9px] font-black text-shTextMuted">{i + 1}</span>
            <span className="min-w-0">{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* --------------------------------------------------------- celebration --- */

/** Milestone flourish for a passed checkpoint.
 *
 *  Honours prefers-reduced-motion: the same celebration renders, it simply
 *  doesn't move. Purely decorative and aria-hidden, so nothing here is the
 *  only way the result is communicated — the word PASSED and the scores are.
 */
export function PassCelebration({ testid = "checkpoint-celebration" }) {
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setMotion(!(mq?.matches));
  }, []);
  const pieces = [8, 22, 36, 50, 64, 78, 92];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true"
         data-testid={testid} data-motion={motion ? "on" : "reduced"}>
      {pieces.map((left, i) => (
        <span key={left}
              className={`absolute top-0 w-1.5 h-3 rounded-sm ${i % 3 === 0 ? "bg-shPrimary" : i % 3 === 1 ? "bg-shSecondary" : "bg-white/70"} ${motion ? "animate-bounce" : ""}`}
              style={{ left: `${left}%`, opacity: 0.55, animationDelay: `${i * 120}ms`, animationDuration: "2.4s" }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ result --- */

/** Trainer's written feedback. Rendered only when a trainer actually wrote
 *  something — never a placeholder quote. */
export function TrainerFeedback({ text, trainerName, tone = "lime", testid = "checkpoint-trainer-feedback" }) {
  const body = (text || "").trim();
  if (!body) return null;
  const border = tone === "orange" ? "border-shAccent/30" : tone === "purple" ? "border-purple-400/30" : "border-shPrimary/30";
  const accent = tone === "orange" ? "text-shAccent" : tone === "purple" ? "text-purple-300" : "text-shPrimary";
  return (
    <div className={`rounded-xl border ${border} bg-black/20 p-3.5`} data-testid={testid}>
      <p className={`text-[9.5px] font-black uppercase tracking-[0.16em] ${accent} mb-1.5`}>
        <i className="fas fa-comment-dots mr-1.5" />From {trainerName || "your trainer"}
      </p>
      <p className="text-[13px] text-shText/90 leading-relaxed whitespace-pre-wrap">{body}</p>
    </div>
  );
}

/** Per-criterion scores, when the trainer's grade recorded them.
 *  A criterion with no recorded score is skipped rather than shown as zero. */
export function RubricBreakdown({ rubric, handlerScores, dogScores, testid = "checkpoint-breakdown" }) {
  const rows = (items, scores) => (items || [])
    .map((c) => ({ name: c.name, score: scores?.[c.id] }))
    .filter((r) => Number.isFinite(Number(r.score)));
  const h = rows(rubric?.handler_criteria, handlerScores);
  const d = rows(rubric?.dog_criteria, dogScores);
  if (!h.length && !d.length) return null;
  const group = (label, items, tone) => items.length ? (
    <div className="min-w-0">
      <p className={`text-[9.5px] font-black uppercase tracking-[0.16em] ${tone}`}>{label}</p>
      <div className="mt-2 space-y-2">
        {items.map((r) => (
          <div key={r.name}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[12.5px] text-shText min-w-0">{r.name}</p>
              <p className="text-[12.5px] font-black text-shText shrink-0">{r.score}/5</p>
            </div>
            <div className="mt-1 h-1 rounded-full bg-shBorder/60 overflow-hidden">
              <div className="h-full rounded-full bg-shPrimary" style={{ width: `${(Number(r.score) / 5) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;
  return (
    <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3.5" data-testid={testid}>
      <p className="text-[9.5px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2.5">Scored on</p>
      <div className="grid sm:grid-cols-2 gap-4">
        {group("Handler Skills", h, "text-shSecondary")}
        {group("Dog Performance", d, "text-shPrimary")}
      </div>
    </div>
  );
}

/** Overall handler/dog result. Uses the PERSISTED overalls; a legacy row whose
 *  overalls resolve to null renders an em dash through ScorePair rather than a
 *  manufactured number, and the surrounding label says so. */
export function CheckpointScores({ handler, dog, testid = "checkpoint-scores" }) {
  const missing = handler == null && dog == null;
  return (
    <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3.5" data-testid={testid} data-scored={missing ? "false" : "true"}>
      <ScorePair handler={handler} dog={dog} />
      {missing && (
        <p className="text-[11.5px] text-shTextMuted mt-2.5 leading-snug" data-testid={`${testid}-unavailable`}>
          Scores weren&apos;t recorded for this checkpoint. Your trainer&apos;s notes below are the record of how it went.
        </p>
      )}
    </div>
  );
}

export { NeonEdge, PremiumButton };

/* ------------------------------------------------------- result panel --- */

/** The durable checkpoint RESULT, shown wherever a graded checkpoint is
 *  revisited.
 *
 *  Passing a checkpoint auto-advances the enrolment server-side, which is
 *  correct — but it also means the live checkpoint status is gone by the time
 *  the client looks. This reads the persisted record from checkpoint-history
 *  instead, so the milestone stays visible on the lesson it belongs to rather
 *  than vanishing the moment it is earned.
 */
export function CheckpointResultPanel({ entry, rubric, dogName, onContinue, continueLabel, testid = "checkpoint-result" }) {
  if (!entry) return null;
  const outcome = entry.outcome;
  const passed = outcome === "advance";
  const assist = outcome === "trainer_assist_recommended";
  const tone = passed ? "lime" : assist ? "purple" : "orange";
  const accentRgb = passed ? "140,198,63" : assist ? "168,85,247" : "242,101,34";
  const meta = passed
    ? { eyebrow: "Passed", icon: "fa-award", title: entry.lesson_name || "Checkpoint passed",
        blurb: dogName ? `You and ${dogName} showed it. Your trainer signed this one off.` : "Your trainer signed this one off." }
    : assist
    ? { eyebrow: "Trainer Assist", icon: "fa-handshake", title: entry.lesson_name || "Checkpoint reviewed",
        blurb: "Your trainer wanted to work through this one with you." }
    : { eyebrow: "More practice", icon: "fa-clipboard-list", title: entry.lesson_name || "Checkpoint reviewed",
        blurb: "Close — your trainer asked for a bit more consistency first." };

  return (
    <NeonEdge accentRgb={accentRgb} intensity={passed ? "strong" : "standard"}
              className="relative overflow-hidden p-5 space-y-4" data-testid={testid} data-outcome={outcome || "reviewed"}>
      {passed && <PassCelebration />}
      <div className="relative">
        <CheckpointHero rubric={rubric} moduleName={entry.module_name} tone={tone} icon={meta.icon}
                        eyebrow={meta.eyebrow} title={meta.title} blurb={meta.blurb} />
      </div>
      <CheckpointScores handler={entry.handler_overall} dog={entry.dog_overall} testid={`${testid}-scores`} />
      <TrainerFeedback text={entry.trainer_feedback} trainerName={entry.trainer_name} tone={tone}
                       testid={`${testid}-feedback`} />
      <RubricBreakdown rubric={entry.rubric_snapshot || rubric}
                       handlerScores={entry.handler_scores} dogScores={entry.dog_scores}
                       testid={`${testid}-breakdown`} />
      {onContinue && (
        <PremiumButton onClick={onContinue} data-testid={`${testid}-continue`} className="w-full justify-center min-h-[52px]">
          {continueLabel || "Continue training"} <i className="fas fa-arrow-right text-[11px]" />
        </PremiumButton>
      )}
    </NeonEdge>
  );
}
