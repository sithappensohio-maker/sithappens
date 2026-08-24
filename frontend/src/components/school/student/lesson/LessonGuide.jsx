/* School lesson delivery wrapper.
 *
 * Keep the proven curriculum mapper/renderer intact in LessonGuideBase.jsx and
 * layer beginner-facing language + coaching over it. This lets every existing
 * Course Builder package and legacy structured lesson keep the same authored
 * data, IDs, locks and progression while the client gets much clearer direction.
 */
import { useState } from "react";
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
} from "./LessonGuideBase";

export const GUIDE_SECTIONS = [
  { key: "learn", n: 1, label: "Read This First", icon: "fa-lightbulb", blurb: "Learn what you are teaching before you start", kind: "instructional" },
  { key: "get_ready", n: 2, label: "Get Your Stuff Ready", icon: "fa-clipboard-check", blurb: "Gather what you need and set up your training space", kind: "instructional" },
  { key: "train", n: 3, label: "Do This With Your Dog", icon: "fa-shoe-prints", blurb: "Follow the directions in order, one step at a time", kind: "instructional" },
  { key: "watch_for", n: 4, label: "If This Happens, Do This", icon: "fa-eye", blurb: "Know the common mistakes and what to change", kind: "instructional" },
  { key: "know_got_it", n: 5, label: "How You'll Know It's Working", icon: "fa-star", blurb: "Look for these signs before moving on", kind: "instructional" },
  { key: "practice", n: 6, label: "Do Your Practice", icon: "fa-paw", blurb: "Now work with your dog using what you just learned", kind: "practice" },
  { key: "quick_check", n: 7, label: "Make Sure It Makes Sense", icon: "fa-circle-question", blurb: "Do a quick check before you move on", kind: "quick_check" },
  { key: "next_step", n: 8, label: "You're Done — What's Next?", icon: "fa-arrow-right", blurb: "School will tell you exactly what to do next", kind: "next_step" },
];

export const GUIDE_MIN_CONTENT_STEPS = BASE_GUIDE_MIN_CONTENT_STEPS;

const META = Object.fromEntries(GUIDE_SECTIONS.map((s) => [s.key, s]));
const remap = (sections) => (sections || []).map((s, i) => ({
  ...s,
  ...(META[s.key] || {}),
  n: i + 1,
}));

/* The base mapper is still the compatibility contract. We only replace the
   human-facing metadata after it has mapped the trainer-authored content. */
export function buildGuide(lesson, opts = {}) {
  return remap(baseBuildGuide(lesson, opts));
}

export { classifyBlock, groupBlocks, asideBlocks, splitSteps, instructionalKeys, stepState, currentStepKey, lockReason, CollapsibleNote };

export function LessonHowItWorks({ hasPractice, testid = "lesson-how-it-works" }) {
  const chain = hasPractice ? ["Read", "Do", "Practice", "Next"] : ["Read", "Do", "Finish", "Next"];
  return (
    <section className="rounded-2xl border border-shSecondary/25 bg-shSecondary/[0.05] p-4 sm:p-5" data-testid={testid}>
      <h2 className="text-[13px] font-black uppercase tracking-[0.16em] text-shSecondary">You do not have to figure this lesson out</h2>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] sm:text-[18px] font-black text-shText">
        {chain.map((word, i) => (
          <span key={word} className="inline-flex items-center gap-2">
            {word}{i < chain.length - 1 && <i className="fas fa-arrow-right text-[11px] text-shSecondary" aria-hidden="true" />}
          </span>
        ))}
      </p>
      <p className="mt-2 text-[15px] sm:text-[16px] text-shTextMuted leading-relaxed">
        Open the current part, do exactly what it says, then use the big button at the bottom. School saves your place and chooses the next part for you. Finished parts stay available if you want to read them again.
      </p>
    </section>
  );
}

export function PracticeUnlockedCard({ dogName, onStartPractice, busy, testid = "lesson-practice-unlocked" }) {
  return (
    <section className="rounded-2xl border border-shPrimary/45 bg-shPrimary/[0.07] p-5 sm:p-6" data-testid={testid}>
      <p className="text-[13px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-lock-open mr-2" aria-hidden="true" />You&apos;re ready to practice</p>
      <h3 className="text-[22px] sm:text-[26px] font-black text-shText mt-1.5 leading-tight">Now get {dogName || "your dog"} and do the exercise.</h3>
      <p className="text-[16px] sm:text-[17px] text-shTextMuted mt-2 leading-relaxed">
        Get the supplies from this lesson and tap Start Practice. Practice will tell you what to work on; you do not need to invent a training session or guess what comes next.
      </p>
      <button type="button" onClick={onStartPractice} disabled={busy} data-testid={`${testid}-cta`}
              className="mt-4 w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[15px] font-black uppercase tracking-widest disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
        <i className="fas fa-paw mr-2" aria-hidden="true" />Start Practice
      </button>
    </section>
  );
}

const STEP_COACH = {
  learn: { title: "Your job right now", body: "Do not start training yet. Read this first so you know what you are teaching and what the exercise is supposed to accomplish.", button: "I READ THIS — NEXT" },
  get_ready: { title: "Your job right now", body: "Actually get your supplies, your dog, and your training area ready now. Do not tap Next until you are set up to follow the lesson.", button: "I'M READY — NEXT" },
  train: { title: "Your job right now", body: "Have your dog with you. Follow these directions in order and keep the session short. If something goes wrong, use the help below instead of guessing.", button: "I DID THESE STEPS — NEXT" },
  watch_for: { title: "Before your next repetitions", body: "Read these common problems now. If one happens, make the listed change instead of repeating the same thing harder or faster.", button: "I KNOW WHAT TO WATCH FOR — NEXT" },
  know_got_it: { title: "Before you move on", body: "Compare your dog to these signs. You are looking for understanding and repeatable success — not perfection in one lucky repetition.", button: "I KNOW WHAT SUCCESS LOOKS LIKE" },
};

function revealSelector(selector, attempts = 12) {
  if (typeof document === "undefined") return;
  const target = document.querySelector(selector);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (attempts <= 0 || typeof setTimeout !== "function") return;
  setTimeout(() => revealSelector(selector, attempts - 1), 60);
}

function revealStepOrAction(key) {
  if (!key) return;
  if (["practice", "quick_check", "next_step"].includes(key)) {
    revealSelector('[data-testid="lesson-actions"]');
    return;
  }
  revealSelector(`[data-testid="lesson-section-guided-${key}"]`);
}

function startedStorageKey(lesson) {
  return `sh_school_lesson_started_${lesson?.id || lesson?.name || "lesson"}`;
}

function wasLessonStarted(lesson) {
  if (typeof window === "undefined") return false;
  try { return window.sessionStorage.getItem(startedStorageKey(lesson)) === "1"; }
  catch { return false; }
}

function FreshLessonStart({ lesson, sections, hasPractice, onStart }) {
  const minutes = Number(lesson?.estimated_minutes || 0) || null;
  return (
    <div className="fixed inset-0 z-[75] bg-black/85 backdrop-blur-sm p-3 sm:p-6 grid place-items-center" role="dialog" aria-modal="true" aria-labelledby="fresh-lesson-title" data-testid="fresh-lesson-start">
      <section className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-shPrimary/40 bg-[var(--sh-card-base)] shadow-2xl p-5 sm:p-8">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-shPrimary">New lesson · Start here</p>
        <h1 id="fresh-lesson-title" className="text-[27px] sm:text-[36px] font-black text-shText mt-1 leading-tight text-balance">{lesson?.name || "Your next lesson"}</h1>
        <p className="text-[15px] sm:text-[17px] text-shTextMuted mt-3 leading-relaxed">
          You have not started this lesson yet. When you tap the button below, School will open Part 1 and guide you one part at a time.
        </p>
        <div className="grid gap-2 sm:grid-cols-3 mt-5">
          <div className="rounded-2xl border border-shBorder/55 bg-black/15 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-shSecondary">Lesson journey</p>
            <p className="text-[18px] font-black text-shText mt-1">{sections.length} part{sections.length === 1 ? "" : "s"}</p>
            <p className="text-[11.5px] text-shTextMuted mt-1">School opens them in the right order.</p>
          </div>
          <div className="rounded-2xl border border-shBorder/55 bg-black/15 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-shSecondary">Your job</p>
            <p className="text-[18px] font-black text-shText mt-1">One thing at a time</p>
            <p className="text-[11.5px] text-shTextMuted mt-1">Read it, do it, then use the big Next button.</p>
          </div>
          <div className="rounded-2xl border border-shBorder/55 bg-black/15 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-shSecondary">What happens later</p>
            <p className="text-[18px] font-black text-shText mt-1">{hasPractice ? "Guided Practice" : "Finish & continue"}</p>
            <p className="text-[11.5px] text-shTextMuted mt-1">{minutes ? `Plan on about ${minutes} minutes for the lesson.` : "School will tell you when you are finished."}</p>
          </div>
        </div>
        <button type="button" onClick={onStart} autoFocus data-testid="fresh-lesson-start-button"
                className="mt-6 w-full min-h-[60px] rounded-xl bg-shPrimary text-bgHeader text-[15px] sm:text-[16px] font-black uppercase tracking-widest hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
          Start Lesson — Show Me Part 1 <i className="fas fa-arrow-right ml-1.5" aria-hidden="true" />
        </button>
        <p className="text-[11.5px] text-shTextMuted text-center mt-2">Starting does not lock anything. You can leave and come back, and finished lessons stay available forever.</p>
      </section>
    </div>
  );
}

export function LessonSectionBody(props) {
  const { lesson, sectionKey, enrollmentId, onComplete, completed = false, busy = false, testid = "lesson-section" } = props;
  const sections = props.sections || buildGuide(lesson, { hasPractice: true, hasQuiz: true });
  const section = sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const instructional = (section.kind || "instructional") === "instructional";
  const coach = STEP_COACH[section.key] || null;

  const finishAndRevealNext = async () => {
    if (!onComplete || busy) return;
    const index = sections.findIndex((s) => s.key === section.key);
    const next = index >= 0 ? sections[index + 1] : null;
    const result = await Promise.resolve(onComplete(section.key));
    if (result?.ok === false) return;
    const destination = result?.next_instructional_step || (result?.practice_unlocked ? "practice" : next?.key);
    if (destination) revealStepOrAction(destination);
  };

  return (
    <div className="space-y-3" data-testid={`${testid}-guided-${section.key}`}>
      {coach && (
        <div className="rounded-xl border border-shPrimary/30 bg-shPrimary/[0.07] p-4" data-testid={`${testid}-coach-${section.key}`}>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary">{coach.title}</p>
          <p className="text-[16px] sm:text-[17px] text-shText mt-1.5 leading-relaxed">{coach.body}</p>
        </div>
      )}
      <BaseLessonSectionBody {...props} sections={sections} onComplete={null} testid={testid} />
      {instructional && onComplete && !completed && (
        <button type="button" onClick={finishAndRevealNext} disabled={busy}
                data-testid={`${testid}-continue-${section.key}`}
                className="w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[15px] font-black uppercase tracking-widest disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
          {busy ? "Saving…" : <>{coach?.button || "I'M DONE — NEXT"} <i className="fas fa-arrow-right ml-1.5 text-[12px]" aria-hidden="true" /></>}
        </button>
      )}
    </div>
  );
}

export default function LessonGuide(props) {
  const sections = props.sections || buildGuide(props.lesson, { hasPractice: props.hasPractice, hasQuiz: props.hasQuiz });
  const firstInstructional = instructionalKeys(sections)[0] || null;
  const [started, setStarted] = useState(() => wasLessonStarted(props.lesson));
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
  const current = currentStepKey(sections, baseCtx);
  const visibleKey = props.activeKey || current;
  const partIndex = Math.max(0, sections.findIndex((s) => s.key === visibleKey));
  const baseTestid = props.testid || "lesson-guide";

  const begin = () => {
    try { window.sessionStorage.setItem(startedStorageKey(props.lesson), "1"); } catch { /* storage can be disabled */ }
    setStarted(true);
    props.onSelectSection?.(firstInstructional);
    setTimeout(() => revealStepOrAction(firstInstructional), 60);
  };

  return (
    <>
      {fresh && <FreshLessonStart lesson={props.lesson} sections={sections} hasPractice={props.hasPractice} onStart={begin} />}
      <style>{`[data-testid="${baseTestid}"] > div:first-child{display:none!important;}`}</style>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-shSecondary/25 bg-shSecondary/[0.045] px-3.5 py-2.5" data-testid="lesson-journey-position">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-shSecondary">Lesson journey</span>
        <span className="text-[14px] sm:text-[15px] font-black text-shText">Part {partIndex + 1} of {sections.length}</span>
      </div>
      <BaseLessonGuide {...props} sections={sections} onSelectSection={selectAndReveal} />
    </>
  );
}
