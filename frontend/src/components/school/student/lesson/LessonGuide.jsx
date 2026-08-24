/* School lesson delivery wrapper.
 *
 * Keep the proven curriculum mapper/renderer intact in LessonGuideBase.jsx and
 * layer beginner-facing language + coaching over it. This lets every existing
 * Course Builder package and legacy structured lesson keep the same authored
 * data, IDs, locks and progression while the client gets much clearer direction.
 */
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
        Open the current step, do exactly what it says, then use the big button at the bottom. School saves your place and chooses the next step for you. Completed steps stay available if you want to read them again.
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

export function LessonSectionBody(props) {
  const {
    lesson, sectionKey, enrollmentId, onComplete, completed = false,
    busy = false, testid = "lesson-section",
  } = props;
  const sections = props.sections || buildGuide(lesson, { hasPractice: true, hasQuiz: true });
  const section = sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const instructional = (section.kind || "instructional") === "instructional";
  const coach = STEP_COACH[section.key] || null;

  return (
    <div className="space-y-3" data-testid={`${testid}-guided-${section.key}`}>
      {coach && (
        <div className="rounded-xl border border-shPrimary/30 bg-shPrimary/[0.07] p-4" data-testid={`${testid}-coach-${section.key}`}>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary">{coach.title}</p>
          <p className="text-[16px] sm:text-[17px] text-shText mt-1.5 leading-relaxed">{coach.body}</p>
        </div>
      )}

      <BaseLessonSectionBody
        {...props}
        sections={sections}
        onComplete={null}
        testid={testid}
      />

      {instructional && onComplete && !completed && (
        <button type="button" onClick={() => onComplete(section.key)} disabled={busy}
                data-testid={`${testid}-continue-${section.key}`}
                className="w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[15px] font-black uppercase tracking-widest disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
          {busy ? "Saving…" : <>{coach?.button || "I'M DONE — NEXT"} <i className="fas fa-arrow-right ml-1.5 text-[12px]" aria-hidden="true" /></>}
        </button>
      )}
    </div>
  );
}

/* Selecting a step changes the content below the tracker. On a long lesson,
 * especially on a phone, leaving the viewport at the tracker makes it look as
 * if nothing happened. After React paints the selected section, take the
 * client directly to the instructions they asked to open. Practice / Quick
 * Check / What's Next are action-area signposts and LessonScreen already
 * scrolls those to the correct controls. */
function scrollToStepContent(key) {
  if (!key || ["practice", "quick_check", "next_step"].includes(key)) return;
  const scroll = () => {
    if (typeof document === "undefined") return;
    const target = document.querySelector(`[data-testid="lesson-section-guided-${key}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
  } else if (typeof setTimeout === "function") {
    setTimeout(scroll, 0);
  }
}

export default function LessonGuide(props) {
  const sections = props.sections || buildGuide(props.lesson, { hasPractice: props.hasPractice, hasQuiz: props.hasQuiz });
  const selectAndReveal = (key) => {
    props.onSelectSection?.(key);
    scrollToStepContent(key);
  };
  return <BaseLessonGuide {...props} sections={sections} onSelectSection={selectAndReveal} />;
}
