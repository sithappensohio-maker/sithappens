/* School lesson delivery wrapper.
 *
 * Keep the proven curriculum mapper/renderer intact in LessonGuideBase.jsx and
 * layer beginner-facing language + coaching over it. This lets every existing
 * Course Builder package and legacy structured lesson keep the same authored
 * data, IDs, locks and progression while the client gets much clearer direction.
 *
 * The journey the customer sees is the NUMBERED instructional parts ("Part 3
 * of 5") followed by a plain "Then: Practice → Next lesson" chain. Practice,
 * the trainer check and the module quiz are real, server-owned steps and are
 * named in that chain; the lesson's optional knowledge check is NOT a
 * server-owned step, so it is not a numbered part — it rides inside the last
 * instructional part as reinforcement (see buildGuide). The full map of parts
 * stays available behind "Show all parts" for anyone who wants it; completed
 * parts stay reviewable there.
 *
 * Viewport: every scroll in this file goes through lib/schoolViewport, and
 * exactly one reveal owns each transition.
 */
import { useEffect, useRef, useState } from "react";
import BaseLessonGuide, {
  buildGuide as baseBuildGuide,
  classifyBlock,
  groupBlocks,
  asideBlocks,
  splitSteps,
  instructionalKeys,
  stepState,
  currentStepKey,
  lockReason,
  CollapsibleNote,
  GUIDE_MIN_CONTENT_STEPS as BASE_GUIDE_MIN_CONTENT_STEPS,
  LessonSectionBody as BaseLessonSectionBody,
  PracticeUnlockedCard as BasePracticeUnlockedCard,
} from "./LessonGuideBase";
import { revealInSchool, focusDialogTitle } from "../../../../lib/schoolViewport";
import { useImmersiveWorkflow } from "../../../../lib/immersiveWorkflow";

export const GUIDE_SECTIONS = [
  { key: "learn", n: 1, label: "Read This First", icon: "fa-lightbulb", blurb: "Learn what you are teaching before you start", kind: "instructional" },
  { key: "get_ready", n: 2, label: "Get Your Stuff Ready", icon: "fa-clipboard-check", blurb: "Gather what you need and set up your training space", kind: "instructional" },
  { key: "train", n: 3, label: "Do This With Your Dog", icon: "fa-shoe-prints", blurb: "Follow the directions in order, one step at a time", kind: "instructional" },
  { key: "watch_for", n: 4, label: "If This Happens, Do This", icon: "fa-eye", blurb: "Know the common mistakes and what to change", kind: "instructional" },
  { key: "know_got_it", n: 5, label: "How You'll Know It's Working", icon: "fa-star", blurb: "Look for these signs before moving on", kind: "instructional" },
  { key: "practice", n: null, label: "Do Your Practice", icon: "fa-paw", blurb: "Now work with your dog using what you just learned", kind: "practice" },
  { key: "next_step", n: null, label: "You're Done — What's Next?", icon: "fa-arrow-right", blurb: "School will tell you exactly what to do next", kind: "next_step" },
];

export const GUIDE_MIN_CONTENT_STEPS = BASE_GUIDE_MIN_CONTENT_STEPS;

const META = Object.fromEntries(GUIDE_SECTIONS.map((s) => [s.key, s]));
const isInstructional = (s) => (s?.kind || "instructional") === "instructional";

/* The base mapper is still the compatibility contract. We only replace the
   human-facing metadata after it has mapped the trainer-authored content,
   fold the non-gating knowledge check into the last instructional part, and
   number the instructional parts 1..N (Practice / Next carry no number). */
export function buildGuide(lesson, opts = {}) {
  const base = baseBuildGuide(lesson, opts);
  const quick = base.find((s) => s.key === "quick_check");
  const kept = base.filter((s) => s.key !== "quick_check");
  if (quick && (quick.blocks || []).length > 0) {
    let lastIdx = -1;
    kept.forEach((s, i) => { if (isInstructional(s) && (s.blocks || []).length > 0) lastIdx = i; });
    if (lastIdx >= 0) {
      kept[lastIdx] = {
        ...kept[lastIdx],
        blocks: [...kept[lastIdx].blocks, ...quick.blocks.map((b) => ({ ...b, reinforcement: true }))],
        reinforcement: true,
      };
    }
  }
  let n = 0;
  return kept.map((s) => {
    const instr = isInstructional(s);
    if (instr) n += 1;
    return { ...s, ...(META[s.key] || {}), n: instr ? n : null };
  });
}

/** Only the numbered parts — what "Part 3 of 5" counts. */
export function instructionalParts(sections) {
  return (sections || []).filter(isInstructional);
}

export { classifyBlock, groupBlocks, asideBlocks, splitSteps, instructionalKeys, stepState, currentStepKey, lockReason, CollapsibleNote };

/* The four-word journey used everywhere School explains itself. */
export function journeyWords(hasPractice) {
  return hasPractice ? ["Read", "Do", "Practice", "Next"] : ["Read", "Do", "Finish", "Next"];
}

export function LessonHowItWorks({ hasPractice, testid = "lesson-how-it-works" }) {
  const chain = journeyWords(hasPractice);
  return (
    <section className="rounded-2xl border border-shSecondary/25 bg-shSecondary/[0.05] p-4 sm:p-5" data-testid={testid}>
      <h2 className="text-[16px] font-black uppercase tracking-[0.16em] text-shSecondary">You do not have to figure this lesson out</h2>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[20px] sm:text-[21px] font-black text-shText">
        {chain.map((word, i) => (
          <span key={word} className="inline-flex items-center gap-2">
            {word}{i < chain.length - 1 && <i className="fas fa-arrow-right text-[14px] text-shSecondary" aria-hidden="true" />}
          </span>
        ))}
      </p>
      <p className="mt-2 text-[18px] sm:text-[19px] text-shTextMuted leading-relaxed">
        Open the current part, do exactly what it says, then use the big button at the bottom. School saves your place and chooses the next part for you. Finished parts stay available if you want to read them again.
      </p>
    </section>
  );
}

/** The moment Practice opens — one card, one button, and (on a checkpoint
 *  lesson) one short line about what comes after practice. No rubric here. */
export function PracticeUnlockedCard({ dogName, onStartPractice, busy, afterNote, testid = "lesson-practice-unlocked" }) {
  return (
    <section className="rounded-2xl border border-shPrimary/45 bg-shPrimary/[0.07] p-4 sm:p-6" data-testid={testid}>
      <p className="text-[15px] sm:text-[16px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-lock-open mr-2" aria-hidden="true" />You&apos;re ready to practice</p>
      <h3 className="text-[22px] sm:text-[26px] font-black text-shText mt-1.5 leading-tight">Now get {dogName || "your dog"} and do the exercise.</h3>
      <p className="text-[17px] sm:text-[20px] text-shTextMuted mt-2 leading-relaxed">
        Grab the supplies from this lesson. Practice Coach will walk you through it one rep at a time.
      </p>
      <button type="button" onClick={onStartPractice} disabled={busy} data-testid={`${testid}-cta`} data-school-primary="true"
              className="mt-4 w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[18px] font-black uppercase tracking-widest disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
        <i className="fas fa-paw mr-2" aria-hidden="true" />Start Practice
      </button>
      {afterNote && (
        <p className="text-[15px] sm:text-[16px] text-shTextMuted mt-3 leading-relaxed" data-testid={`${testid}-after`}>
          <i className="fas fa-arrow-turn-down mr-1.5 text-shSecondary" aria-hidden="true" />{afterNote}
        </p>
      )}
    </section>
  );
}
// Keep the base card importable for anything that still wants the original.
export { BasePracticeUnlockedCard };

const STEP_COACH = {
  learn: { title: "Your job right now", body: "Do not start training yet. Read this first so you know what you are teaching and what the exercise is supposed to accomplish.", button: "I READ THIS — NEXT" },
  get_ready: { title: "Your job right now", body: "Actually get your supplies, your dog, and your training area ready now. Do not tap Next until you are set up to follow the lesson.", button: "I'M READY — NEXT" },
  train: { title: "Your job right now", body: "Have your dog with you. Follow these directions in order and keep the session short. If something goes wrong, use the help below instead of guessing.", button: "I DID THESE STEPS — NEXT" },
  watch_for: { title: "Before your next repetitions", body: "Read these common problems now. If one happens, make the listed change instead of repeating the same thing harder or faster.", button: "I KNOW WHAT TO WATCH FOR — NEXT" },
  know_got_it: { title: "Before you move on", body: "Compare your dog to these signs. You are looking for understanding and repeatable success — not perfection in one lucky repetition.", button: "I KNOW WHAT SUCCESS LOOKS LIKE" },
};

/* ------------------------------------------------------------- reveals --- */

const ACTION_KEYS = new Set(["practice", "quick_check", "next_step"]);

/** The one element School reveals for a given step key. Instructional keys
 *  reveal the part's coaching card; action keys reveal the action card (the
 *  Practice-unlocked card when it exists, else the actions area) so that its
 *  primary button is on screen. */
export function revealStepOrAction(key, options = {}) {
  if (!key) return Promise.resolve(null);
  if (ACTION_KEYS.has(key)) {
    return revealInSchool(() => (typeof document === "undefined" ? null
      : document.querySelector('[data-testid="lesson-practice-unlocked"]')
        || document.querySelector('[data-testid="lesson-actions"]')),
      { align: "action", cta: "[data-school-primary]", ...options });
  }
  return revealInSchool(`[data-testid="lesson-section-guided-${key}"]`, { align: "start", ...options });
}

function startedStorageKey(lesson) {
  return `sh_school_lesson_started_${lesson?.id || lesson?.name || "lesson"}`;
}

function wasLessonStarted(lesson) {
  if (typeof window === "undefined") return false;
  try { return window.sessionStorage.getItem(startedStorageKey(lesson)) === "1"; }
  catch { return false; }
}

function FreshLessonStart({ lesson, parts, hasPractice, thenChain, onStart }) {
  const minutes = Number(lesson?.estimated_minutes || 0) || null;
  const titleRef = useRef(null);
  useImmersiveWorkflow(true);
  // Dialogs open at their title. Focusing the heading (not the button) keeps
  // the browser from scrolling a tall card down to its own bottom.
  useEffect(() => { focusDialogTitle(titleRef.current); }, []);
  const chain = journeyWords(hasPractice);
  return (
    <div className="fixed inset-0 z-[75] bg-black/85 backdrop-blur-sm p-3 sm:p-6 grid place-items-center" role="dialog" aria-modal="true" aria-labelledby="fresh-lesson-title" data-testid="fresh-lesson-start">
      <section className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-shPrimary/40 bg-[var(--sh-card-base)] shadow-2xl p-5 sm:p-8">
        <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary">New lesson · Start here</p>
        <h1 id="fresh-lesson-title" ref={titleRef} tabIndex={-1} className="text-[27px] sm:text-[36px] font-black text-shText mt-1 leading-tight text-balance focus:outline-none">{lesson?.name || "Your next lesson"}</h1>
        <p className="text-[18px] sm:text-[20px] text-shTextMuted mt-3 leading-relaxed">
          You have not started this lesson yet. When you tap the button below, School will open Part 1 and guide you one part at a time.
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[18px] sm:text-[20px] font-black text-shText" data-testid="fresh-lesson-journey">
          {chain.map((word, i) => (
            <span key={word} className="inline-flex items-center gap-2">
              {word}{i < chain.length - 1 && <i className="fas fa-arrow-right text-[13px] text-shSecondary" aria-hidden="true" />}
            </span>
          ))}
        </p>
        <div className="grid gap-2 sm:grid-cols-3 mt-4">
          <div className="rounded-2xl border border-shBorder/55 bg-black/15 p-3.5 sm:p-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">This lesson</p>
            <p className="text-[21px] font-black text-shText mt-1">{parts.length} part{parts.length === 1 ? "" : "s"}</p>
            <p className="text-[14px] text-shTextMuted mt-1">{thenChain?.length ? `Then: ${thenChain.join(" → ")}` : "School opens them in the right order."}</p>
          </div>
          <div className="rounded-2xl border border-shBorder/55 bg-black/15 p-3.5 sm:p-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">Your job</p>
            <p className="text-[21px] font-black text-shText mt-1">One thing at a time</p>
            <p className="text-[14px] text-shTextMuted mt-1">Read it, do it, then use the big Next button. School moves you to the next part.</p>
          </div>
          <div className="rounded-2xl border border-shBorder/55 bg-black/15 p-3.5 sm:p-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">What happens later</p>
            <p className="text-[21px] font-black text-shText mt-1">{hasPractice ? "Guided Practice" : "Finish & continue"}</p>
            <p className="text-[14px] text-shTextMuted mt-1">{minutes ? `Plan on about ${minutes} minutes for the lesson.` : "School will tell you when you are finished."}</p>
          </div>
        </div>
        <button type="button" onClick={onStart} data-testid="fresh-lesson-start-button"
                className="mt-5 w-full min-h-[60px] rounded-xl bg-shPrimary text-bgHeader text-[18px] sm:text-[19px] font-black uppercase tracking-widest hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
          Start Lesson — Show Me Part 1 <i className="fas fa-arrow-right ml-1.5" aria-hidden="true" />
        </button>
        <p className="text-[14px] text-shTextMuted text-center mt-2">Starting does not lock anything. You can leave and come back, and finished lessons stay available forever.</p>
      </section>
    </div>
  );
}

export function LessonSectionBody(props) {
  const { lesson, sectionKey, enrollmentId, onComplete, completed = false, busy = false, testid = "lesson-section" } = props;
  const sections = props.sections || buildGuide(lesson, { hasPractice: true, hasQuiz: true });
  const section = sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const instructional = isInstructional(section);
  const coach = STEP_COACH[section.key] || null;
  const parts = instructionalParts(sections);
  // Practice / Next are hand-offs owned by the actions area; they render no
  // body of their own (an empty wrapper would be a false reveal target).
  if (!instructional && !(section.blocks || []).length && !section.body) return null;

  const finishAndRevealNext = async () => {
    if (!onComplete || busy) return;
    const index = sections.findIndex((s) => s.key === section.key);
    const next = index >= 0 ? sections[index + 1] : null;
    const result = await Promise.resolve(onComplete(section.key));
    if (result?.ok === false) return;
    const destination = result?.next_instructional_step || (result?.practice_unlocked ? "practice" : next?.key);
    if (destination) revealStepOrAction(destination);
  };

  // Answering the knowledge check inserts feedback under the option list. The
  // Next button must not be pushed out of view without being brought back.
  const onQuizAnswered = () => {
    if (!instructional || completed) return;
    revealInSchool(`[data-testid="${testid}-continue-${section.key}"]`, { align: "end", ifNeeded: true });
  };

  return (
    <div className="space-y-3" data-testid={`${testid}-guided-${section.key}`}>
      {coach && !completed && (
        <div className="rounded-xl border border-shPrimary/30 bg-shPrimary/[0.07] p-4" data-testid={`${testid}-coach-${section.key}`}>
          <p className="text-[14px] font-black uppercase tracking-[0.16em] text-shPrimary">{coach.title}</p>
          <p className="text-[19px] sm:text-[20px] text-shText mt-1.5 leading-relaxed">{coach.body}</p>
        </div>
      )}
      {completed && instructional && (
        <p className="text-[15px] text-shTextMuted rounded-xl border border-shBorder bg-[var(--sh-card-base)] px-3.5 py-2.5" data-testid={`${testid}-review-${section.key}`}>
          <i className="fas fa-book-open mr-1.5 text-shSecondary" />You finished this part — it stays open for review.
        </p>
      )}
      <BaseLessonSectionBody {...props} sections={instructional ? parts : sections} onComplete={null} testid={testid}
                             onQuizAnswered={onQuizAnswered} />
      {instructional && onComplete && !completed && (
        <button type="button" onClick={finishAndRevealNext} disabled={busy}
                data-testid={`${testid}-continue-${section.key}`}
                className="w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[18px] font-black uppercase tracking-widest disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
          {busy ? "Saving…" : <>{coach?.button || "I'M DONE — NEXT"} <i className="fas fa-arrow-right ml-1.5 text-[15px]" aria-hidden="true" /></>}
        </button>
      )}
    </div>
  );
}

/** Where the customer is, in one line: "Part 3 of 5", then what follows. */
export function journeyPosition(sections, ctx) {
  const parts = instructionalParts(sections);
  const current = currentStepKey(sections, ctx);
  const idx = parts.findIndex((s) => s.key === current);
  const done = idx < 0 && parts.every((s) => (ctx?.completed || []).includes(s.key));
  return { total: parts.length, index: idx >= 0 ? idx + 1 : (done ? parts.length : 0), allDone: done && parts.length > 0 };
}

export default function LessonGuide(props) {
  const sections = props.sections || buildGuide(props.lesson, { hasPractice: props.hasPractice, hasQuiz: props.hasQuiz });
  const parts = instructionalParts(sections);
  const firstInstructional = parts[0]?.key || null;
  const [started, setStarted] = useState(() => wasLessonStarted(props.lesson));
  const [mapOpen, setMapOpen] = useState(false);
  const alreadyPastFreshStart = (props.completed || []).length > 0
    || !!props.practiced
    || (props.hasPractice && props.practiceUnlocked === true);
  const fresh = !started
    && !alreadyPastFreshStart
    && !!firstInstructional
    && (props.activeKey || firstInstructional) === firstInstructional;

  const selectAndReveal = (key) => {
    props.onSelectSection?.(key);
    revealStepOrAction(key);
  };

  const baseCtx = {
    completed: props.completed || [],
    practiceUnlocked: props.practiceUnlocked,
    practiceLockedReason: props.practiceLockedReason,
    quickCheckUnlocked: props.quickCheckUnlocked,
    practiced: props.practiced,
  };
  const pos = journeyPosition(sections, baseCtx);
  const viewing = props.activeKey ? parts.findIndex((s) => s.key === props.activeKey) + 1 : 0;
  const thenChain = props.thenChain || [];
  const baseTestid = props.testid || "lesson-guide";

  const begin = () => {
    try { window.sessionStorage.setItem(startedStorageKey(props.lesson), "1"); } catch { /* storage can be disabled */ }
    setStarted(true);
    props.onSelectSection?.(firstInstructional);
    revealStepOrAction(firstInstructional);
  };

  const positionLabel = pos.allDone
    ? `All ${pos.total} part${pos.total === 1 ? "" : "s"} done`
    : `Part ${pos.index || 1} of ${pos.total}`;
  const reviewing = viewing > 0 && !pos.allDone && viewing !== pos.index;

  return (
    <>
      {fresh && <FreshLessonStart lesson={props.lesson} parts={parts} hasPractice={props.hasPractice} thenChain={thenChain} onStart={begin} />}
      <div className="rounded-xl border border-shSecondary/25 bg-shSecondary/[0.045] px-3.5 py-2.5" data-testid="lesson-journey-position">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-black uppercase tracking-[0.16em] text-shSecondary">Lesson journey</span>
          <span className="text-[17px] sm:text-[18px] font-black text-shText" data-testid="lesson-journey-part">{positionLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className="text-[15px] text-shTextMuted min-w-0" data-testid="lesson-journey-then">
            {reviewing
              ? `Reviewing Part ${viewing}. Your current part is ${pos.index}.`
              : thenChain.length ? `Then: ${thenChain.join(" → ")}` : "Then: you're done with this lesson."}
          </p>
          <button type="button" onClick={() => setMapOpen((v) => !v)} aria-expanded={mapOpen} data-testid="lesson-journey-toggle"
                  className="shrink-0 min-h-[40px] px-2 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary rounded-lg">
            {mapOpen ? "Hide all parts" : "Show all parts"} <i className={`fas fa-chevron-${mapOpen ? "up" : "down"} ml-1 text-[11px]`} aria-hidden="true" />
          </button>
        </div>
      </div>
      {mapOpen && (
        <div data-testid="lesson-journey-map">
          <BaseLessonGuide {...props} sections={sections} onSelectSection={selectAndReveal} testid={baseTestid} />
        </div>
      )}
    </>
  );
}
