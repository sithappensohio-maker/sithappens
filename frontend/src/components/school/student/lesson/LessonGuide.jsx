/* Client School — the guided lesson sequence.
 *
 * A lesson is a progression, not a menu of eight equally-clickable rows:
 * learn the material, get ready, train, watch for the common mistakes, know
 * what success looks like — then practise with the dog, check your knowledge,
 * and move on. The client should always be able to see what they have
 * finished, where they are, what is next, and what is locked and why.
 *
 * This module MAPS what a trainer already authored onto that sequence — it
 * does not duplicate curriculum, add fields, or change Program Studio.
 *
 * There are TWO authored shapes and both must map, because the real Sit
 * Happens curriculum uses the newer one:
 *
 *   • Course Builder `content_blocks` — every lesson in the enhanced
 *     curriculum carries ten or eleven of them (text, checklist, steps, quiz,
 *     trainer_tip, warning, practice, and an optional checkpoint).
 *   • The legacy structured fields (client_overview, equipment_needed, …)
 *     still used by older programs.
 *
 * A section with no authored content simply does not appear. Nothing authored
 * is ever dropped: a block that matches no rule still lands in a visible step.
 *
 * WHERE PROGRESSION IS DECIDED: on the server. `school_lesson_guide.py` runs
 * the same rules and the portal endpoints enforce them, so the Practice lock
 * is real rather than a disabled button. The functions below stay exported
 * because the client still needs them to render when it has no server payload
 * yet, and because they are the mirror the backend is written against.
 */
import { useState } from "react";
import LessonContentBlocks from "../LessonContentBlocks";

/* The eight-step sequence from the design handoff. `kind` marks which steps
   are instructional — those are the ones that gate Practice. */
export const GUIDE_SECTIONS = [
  { key: "learn", n: 1, label: "Learn", icon: "fa-lightbulb", blurb: "Understand the goal", kind: "instructional" },
  { key: "get_ready", n: 2, label: "Get Ready", icon: "fa-clipboard-check", blurb: "Set up for success", kind: "instructional" },
  { key: "train", n: 3, label: "Train", icon: "fa-shoe-prints", blurb: "Step-by-step instructions", kind: "instructional" },
  { key: "watch_for", n: 4, label: "Watch For This", icon: "fa-eye", blurb: "Common mistakes to avoid", kind: "instructional" },
  { key: "know_got_it", n: 5, label: "Know When You've Got It", icon: "fa-star", blurb: "Key signs of success", kind: "instructional" },
  { key: "practice", n: 6, label: "Practice", icon: "fa-paw", blurb: "Work with your dog", kind: "practice" },
  { key: "quick_check", n: 7, label: "Quick Check", icon: "fa-circle-question", blurb: "Check your knowledge", kind: "quick_check" },
  { key: "next_step", n: 8, label: "Next Step", icon: "fa-arrow-right", blurb: "What's coming next", kind: "next_step" },
];

/* A lesson presents the sequence as soon as it has this many steps carrying
   content of their own.

   This is 1 deliberately. At 2, a lesson with exactly one authored
   instructional step rendered flat — no Continue action — and so could not
   be gated, leaving an exemption to reason about every time the gate moved.
   At 1 the only ungated shape is a lesson with no instructional content at
   all, where there is nothing to complete in the first place.

   `school_lesson_guide.py` holds the same number and a test asserts they
   agree: if this rendered flat while the server gated, Practice would be
   locked with no control on screen to unlock it. */
export const GUIDE_MIN_CONTENT_STEPS = 1;

const text = (v) => (typeof v === "string" ? v.trim() : "");

/* --------------------------------------------------------------- blocks --- */

/** Where a content block belongs in the guided sequence.
 *
 *  Block TYPE decides it wherever type is unambiguous. Only the plain `text`
 *  blocks need a hint, because the curriculum authors three of them per lesson
 *  ("what a good repetition looks like", "common mistakes to avoid", "if it is
 *  not working") and their type alone cannot tell them apart. The hint reads
 *  the authored title, and ANY text block that matches nothing falls through
 *  to a visible step rather than being discarded.
 */
export function classifyBlock(block, { seenSteps }) {
  const t = block?.type;
  if (t === "checklist") return "get_ready";
  if (t === "steps") return "train";
  if (t === "quiz") return "quick_check";
  if (t === "practice") return "practice";
  if (t === "trainer_tip") return "train";
  if (t === "warning") return "safety";
  // The checkpoint block is presentation of something CheckpointPanel already
  // owns end to end; showing it here would state the rules twice.
  if (t === "checkpoint") return null;
  if (t === "video" || t === "image" || t === "download") return seenSteps ? "train" : "learn";
  if (t === "timer" || t === "rep_counter") return "train";

  const title = text(block?.title).toLowerCase();
  if (/not working|troubleshoot|if it/.test(title)) return "troubleshooting";
  if (/mistake|avoid|watch/.test(title)) return "watch_for";
  if (/good rep|success|got it|looks like|criteria/.test(title)) return "know_got_it";
  // Text before the first steps block is introductory; after it, it is
  // commentary on the work just described.
  return seenSteps ? "watch_for" : "learn";
}

/** Split active content blocks into the guided sections, in authored order. */
export function groupBlocks(blocks) {
  const buckets = {};
  let seenSteps = false;
  const active = [...(blocks || [])]
    .filter((b) => b && b.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const b of active) {
    const key = classifyBlock(b, { seenSteps });
    if (b.type === "steps") seenSteps = true;
    if (!key) continue;
    (buckets[key] = buckets[key] || []).push(b);
  }
  return buckets;
}

/* --------------------------------------------------------------- legacy --- */

/** Which legacy authored field feeds each section. */
function legacyBodies(lesson) {
  const l = lesson || {};
  return {
    learn: [text(l.client_overview), text(l.why_it_matters)].filter(Boolean).join("\n\n"),
    get_ready: text(l.equipment_needed),
    train: text(l.client_instructions),
    watch_for: text(l.common_mistakes),
    know_got_it: text(l.success_criteria),
  };
}

/* ---------------------------------------------------------------- build --- */

/** The sections this lesson actually has, in sequence order.
 *
 *  Each returned section carries EITHER `blocks` (Course Builder) or `body`
 *  (legacy text), plus `ready` for the two steps that are pure hand-offs to
 *  the existing Practice and Quick Check machinery.
 */
export function buildGuide(lesson, { hasPractice, hasQuiz } = {}) {
  const blocks = groupBlocks(lesson?.content_blocks);
  const usingBlocks = Object.keys(blocks).length > 0;
  const bodies = usingBlocks ? {} : legacyBodies(lesson);

  const has = (key) => (usingBlocks ? (blocks[key] || []).length > 0 : !!bodies[key]);
  const out = [];
  for (const s of GUIDE_SECTIONS) {
    if (s.key === "practice") {
      if (hasPractice || has("practice")) out.push({ ...s, ready: true, blocks: blocks.practice || [] });
      continue;
    }
    if (s.key === "quick_check") {
      if (hasQuiz || has("quick_check")) out.push({ ...s, ready: !has("quick_check"), blocks: blocks.quick_check || [] });
      continue;
    }
    if (s.key === "next_step") { out.push({ ...s, ready: true }); continue; }
    if (!has(s.key)) continue;
    out.push({ ...s, blocks: blocks[s.key] || [], body: bodies[s.key] || "" });
  }
  // Renumber so the client sees "Step 2 of 6", never a gap where an unauthored
  // section used to be.
  return out.map((s, i) => ({ ...s, n: i + 1 }));
}

/** Blocks that ride along inside the Train step rather than owning a step of
 *  their own: troubleshooting and safety, both collapsed by default so they
 *  can never bury the instructions. */
export function asideBlocks(lesson) {
  const g = groupBlocks(lesson?.content_blocks);
  return { troubleshooting: g.troubleshooting || [], safety: g.safety || [] };
}

/** Split step-by-step instructions into numbered steps when the trainer
 *  authored them as a list. Falls back to one block of prose — never
 *  fabricates structure that isn't there. */
export function splitSteps(body) {
  const lines = String(body || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const numbered = lines.filter(x => /^(\d+[.)]\s+|[-*•]\s+)/.test(x));
  if (numbered.length >= 2 && numbered.length === lines.length) {
    return lines.map(x => x.replace(/^(\d+[.)]\s+|[-*•]\s+)/, "").trim());
  }
  return null;
}

/** Instructional step keys — the ones that must be finished before Practice. */
export function instructionalKeys(sections) {
  return (sections || []).filter(s => (s.kind || "instructional") === "instructional").map(s => s.key);
}

/* ------------------------------------------------------------- progress --- */

/** What the client should see for one row of the tracker.
 *
 *  Returned as a word, never as a colour alone — the row renders an icon and
 *  a label too, so the state survives greyscale and a screen reader.
 */
export function stepState(section, ctx) {
  const { completed = [], practiceUnlocked, quickCheckUnlocked, practiced, currentKey } = ctx || {};
  const kind = section.kind || "instructional";
  const done = new Set(completed);

  if (kind === "instructional") {
    if (done.has(section.key)) return "completed";
    return section.key === currentKey ? "current" : "available";
  }
  if (kind === "practice") {
    if (practiced) return "completed";
    if (!practiceUnlocked) return "locked";
    return section.key === currentKey ? "current" : "available";
  }
  if (kind === "quick_check") {
    if (!quickCheckUnlocked) return "locked";
    return section.key === currentKey ? "current" : "available";
  }
  // next_step is a signpost; it opens once nothing earlier is outstanding.
  if (!practiceUnlocked || !quickCheckUnlocked) return "locked";
  return section.key === currentKey ? "current" : "available";
}

/** The step the client is on: the first instructional step they have not
 *  finished, else Practice, else Quick Check, else Next Step. */
export function currentStepKey(sections, ctx) {
  const { completed = [], practiceUnlocked, quickCheckUnlocked, practiced } = ctx || {};
  const done = new Set(completed);
  const nextInstructional = (sections || []).find(
    s => (s.kind || "instructional") === "instructional" && !done.has(s.key));
  if (nextInstructional) return nextInstructional.key;
  const practice = (sections || []).find(s => s.kind === "practice");
  if (practice && practiceUnlocked && !practiced) return practice.key;
  const quick = (sections || []).find(s => s.kind === "quick_check");
  if (quick && quickCheckUnlocked) return quick.key;
  const next = (sections || []).find(s => s.kind === "next_step");
  return next ? next.key : null;
}

/** Why a row is locked, in words the client can act on. */
export function lockReason(section, ctx) {
  const kind = section.kind || "instructional";
  if (kind === "practice") return ctx?.practiceLockedReason || "Finish the lesson material to unlock Practice.";
  if (kind === "quick_check") return "Complete your Practice to unlock Quick Check.";
  return "Finish the earlier steps to unlock this.";
}

/* --------------------------------------------------------------- render --- */

export function CollapsibleNote({ icon, title, children, testid, tone = "muted" }) {
  const [open, setOpen] = useState(false);
  if (!children) return null;
  const accent = tone === "warn" ? "text-red-300" : "text-shSecondary";
  return (
    <div className={`rounded-xl border overflow-hidden ${tone === "warn" ? "border-red-400/25 bg-red-500/[0.04]" : "border-shBorder/50 bg-black/10"}`} data-testid={testid}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              className="w-full px-4 py-3.5 flex items-center gap-2.5 text-left min-h-[52px]">
        <i className={`fas ${icon} ${accent} text-[13px]`} aria-hidden="true" />
        <span className="flex-1 min-w-0 text-[16px] font-black text-shText">{title}</span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[11px] text-shTextMuted`} aria-hidden="true" />
      </button>
      {open && <div className="px-4 pb-4 -mt-1">{children}</div>}
    </div>
  );
}

/** "How this lesson works" — a first-time client should not have to guess
 *  what the page means. Concise and always present rather than a dismissible
 *  onboarding subsystem: it costs four lines and helps every visit. */
export function LessonHowItWorks({ hasPractice, testid = "lesson-how-it-works" }) {
  const chain = hasPractice
    ? ["Learn", "Practice", "Quick Check", "Move On"]
    : ["Learn", "Quick Check", "Move On"];
  return (
    <section className="rounded-2xl border border-shSecondary/25 bg-shSecondary/[0.05] p-4 sm:p-5" data-testid={testid}>
      <h2 className="text-[13px] font-black uppercase tracking-[0.16em] text-shSecondary">How this lesson works</h2>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] sm:text-[18px] font-black text-shText">
        {chain.map((word, i) => (
          <span key={word} className="inline-flex items-center gap-2">
            {word}
            {i < chain.length - 1 && <i className="fas fa-arrow-right text-[11px] text-shSecondary" aria-hidden="true" />}
          </span>
        ))}
      </p>
      <p className="mt-2 text-[15px] sm:text-[16px] text-shTextMuted leading-relaxed">
        Work through the sections in order. {hasPractice
          ? "Once you've finished the lesson material, Practice unlocks so you can work with your dog."
          : "Finish the lesson material, then complete the lesson to move on."}
      </p>
    </section>
  );
}

/** The lesson progress tracker.
 *
 *  Not a menu: every row states whether it is done, current, or locked — and
 *  a locked row says what would unlock it, because "disabled with no reason"
 *  is the thing this replaced.
 */
export default function LessonGuide({
  lesson, hasPractice, hasQuiz, sections: sectionsProp, activeKey, onSelectSection,
  completed = [], practiceUnlocked = true, practiceLockedReason, quickCheckUnlocked = true,
  practiced = false, testid = "lesson-guide",
}) {
  const sections = sectionsProp || buildGuide(lesson, { hasPractice, hasQuiz });
  if (sections.length === 0) return null;

  const ctx = { completed, practiceUnlocked, practiceLockedReason, quickCheckUnlocked, practiced };
  const cur = currentStepKey(sections, ctx);
  const instructional = instructionalKeys(sections);
  const doneCount = instructional.filter(k => completed.includes(k)).length;

  return (
    <div className="space-y-3" data-testid={testid}>
      {/* Lesson-level progress — real counts, never a percentage that a
          waiting-for-review or optional step would make untrue. */}
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="text-[13px] font-black uppercase tracking-[0.16em] text-shSecondary">Lesson progress</h2>
        <p className="text-[15px] font-black text-shText" data-testid={`${testid}-progress`}>
          {doneCount} of {instructional.length} step{instructional.length === 1 ? "" : "s"} complete
        </p>
      </div>

      <ol className="rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] overflow-hidden divide-y divide-shBorder/30">
        {sections.map((s) => {
          const state = stepState(s, { ...ctx, currentKey: cur });
          const active = activeKey === s.key;
          const locked = state === "locked";
          const done = state === "completed";
          const isCurrent = state === "current";
          const reason = locked ? lockReason(s, ctx) : "";

          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => { if (!locked) onSelectSection?.(s.key); }}
                disabled={locked}
                aria-disabled={locked || undefined}
                aria-current={isCurrent ? "step" : undefined}
                data-testid={`${testid}-section-${s.key}`}
                data-state={state}
                data-active={active ? "true" : "false"}
                className={[
                  "w-full text-left px-4 py-4 flex items-start gap-3.5 min-h-[64px] transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-inset",
                  locked ? "opacity-60 cursor-not-allowed"
                    : isCurrent || active ? "bg-shPrimary/[0.09] border-l-[3px] border-l-shPrimary"
                    : "hover:bg-white/[0.03]",
                ].join(" ")}
              >
                {/* Status marker — icon AND text, so state never rides on colour alone. */}
                <span
                  className={[
                    "w-8 h-8 rounded-full grid place-items-center shrink-0 text-[12px] font-black border mt-0.5",
                    done ? "border-shPrimary/60 bg-shPrimary/15 text-shPrimary"
                      : isCurrent ? "border-shPrimary bg-shPrimary text-bgHeader"
                      : locked ? "border-shBorder text-shTextMuted"
                      : "border-shBorder text-shTextMuted",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {done ? <i className="fas fa-check" /> : locked ? <i className="fas fa-lock" /> : s.n}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`text-[18px] sm:text-[19px] font-black leading-snug ${isCurrent ? "text-shPrimary" : "text-shText"}`}>
                      {s.label}
                    </span>
                    {done && (
                      <span className="text-[11px] font-black uppercase tracking-widest text-shPrimary">Complete</span>
                    )}
                    {isCurrent && (
                      <span className="text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-shPrimary text-bgHeader">Current</span>
                    )}
                    {locked && (
                      <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Locked</span>
                    )}
                  </span>
                  <span className="block text-[15px] sm:text-[16px] text-shTextMuted mt-1 leading-relaxed">
                    {locked ? reason : s.blurb}
                  </span>
                </span>

                {!locked && <i className="fas fa-chevron-right text-[11px] text-shTextMuted shrink-0 mt-2.5" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The moment Practice opens.
 *
 *  The brief is explicit that a disabled row must not quietly become an
 *  enabled one — finishing the material is an achievement and should read
 *  like the application phase of the lesson starting.
 */
export function PracticeUnlockedCard({ dogName, onStartPractice, busy, testid = "lesson-practice-unlocked" }) {
  return (
    <section className="rounded-2xl border border-shPrimary/45 bg-shPrimary/[0.07] p-5 sm:p-6" data-testid={testid}>
      <p className="text-[13px] font-black uppercase tracking-[0.16em] text-shPrimary">
        <i className="fas fa-lock-open mr-2" aria-hidden="true" />You&apos;re ready to practice
      </p>
      <h3 className="text-[22px] sm:text-[26px] font-black text-shText mt-1.5 leading-tight">
        Now it&apos;s time to work with {dogName || "your dog"}.
      </h3>
      <p className="text-[16px] sm:text-[17px] text-shTextMuted mt-2 leading-relaxed">
        You&apos;ve finished the lesson instructions. Practice is where the training actually happens.
      </p>
      <button type="button" onClick={onStartPractice} disabled={busy} data-testid={`${testid}-cta`}
              className="mt-4 w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[15px] font-black uppercase tracking-widest disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
        <i className="fas fa-paw mr-2" aria-hidden="true" />Start Practice
      </button>
    </section>
  );
}

/** One section's content, ending in the action that completes it.
 *
 *  Course Builder blocks are handed to the SAME renderer that drew them
 *  before, so authored media, checklists, step lists and the knowledge check
 *  behave exactly as they did; only how much is on screen at once changed.
 *
 *  Reaching the end of the step is not inferred from a timer or a scroll
 *  heuristic — the Continue action sits AFTER the content, so pressing it is
 *  itself the evidence that the client got to the bottom of it.
 */
export function LessonSectionBody({
  lesson, sectionKey, sections, enrollmentId, onComplete, completed = false,
  busy = false, nextLabel, isLastInstructional = false, testid = "lesson-section",
}) {
  const all = sections || buildGuide(lesson, { hasPractice: true, hasQuiz: true });
  const section = all.find(s => s.key === sectionKey);
  if (!section) return null;

  const blocks = section.blocks || [];
  const steps = section.key === "train" && section.body ? splitSteps(section.body) : null;
  const asides = section.key === "train" ? asideBlocks(lesson) : { troubleshooting: [], safety: [] };
  const legacyTrouble = section.key === "train" ? text(lesson?.troubleshooting) : "";
  const legacySafety = section.key === "train" ? text(lesson?.safety_notes) : "";
  const instructional = (section.kind || "instructional") === "instructional";
  if (!blocks.length && !section.body) return null;

  const continueLabel = isLastInstructional
    ? "Finish lesson material"
    : nextLabel ? `Continue to ${nextLabel}` : "Continue";

  return (
    <section className="space-y-3" data-testid={`${testid}-${section.key}`}>
      <div className="rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] p-5 sm:p-6 space-y-4">
        <div>
          <p className="text-[13px] font-black uppercase tracking-[0.16em] text-shSecondary">
            Step {section.n} of {all.length}
          </p>
          {/* The heading for what the client is reading right now. */}
          <h2 className="text-[26px] sm:text-[30px] font-black text-shText mt-1 leading-tight text-balance">
            {section.label}
          </h2>
        </div>

        {blocks.length > 0 && <LessonContentBlocks blocks={blocks} enrollmentId={enrollmentId} />}

        {!blocks.length && steps && (
          <ol className="space-y-3" data-testid={`${testid}-steps`}>
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3.5 rounded-xl border border-shBorder/40 bg-black/10 p-4">
                <span className="w-8 h-8 rounded-full grid place-items-center shrink-0 border border-shSecondary/40 bg-shSecondary/10 text-shSecondary text-[13px] font-black">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-[17px] sm:text-[18px] text-shText leading-[1.55]">{step}</span>
              </li>
            ))}
          </ol>
        )}

        {!blocks.length && !steps && section.body && (
          <p className="text-[17px] sm:text-[18px] text-shText/90 whitespace-pre-wrap leading-[1.55]">{section.body}</p>
        )}
      </div>

      {/* Troubleshooting and safety sit UNDER the instructions, collapsed.
          Both are long in the real curriculum and neither is what the client
          needs first while a dog is waiting. */}
      {section.key === "train" && (asides.troubleshooting.length > 0 || legacyTrouble) && (
        <CollapsibleNote icon="fa-screwdriver-wrench" title="If it is not working" testid={`${testid}-troubleshooting`}>
          {asides.troubleshooting.length > 0
            ? <LessonContentBlocks blocks={asides.troubleshooting} enrollmentId={enrollmentId} hideTitles />
            : <p className="text-[16px] text-shTextMuted whitespace-pre-wrap leading-relaxed">{legacyTrouble}</p>}
        </CollapsibleNote>
      )}
      {section.key === "train" && (asides.safety.length > 0 || legacySafety) && (
        <CollapsibleNote icon="fa-shield-halved" title="Safety &amp; welfare" tone="warn" testid={`${testid}-safety`}>
          {asides.safety.length > 0
            ? <LessonContentBlocks blocks={asides.safety} enrollmentId={enrollmentId} hideTitles />
            : <p className="text-[16px] text-shTextMuted whitespace-pre-wrap leading-relaxed">{legacySafety}</p>}
        </CollapsibleNote>
      )}

      {/* The primary continuation. Impossible to miss, and the evidence that
          the client reached the end of this step. */}
      {instructional && onComplete && !completed && (
        <button type="button" onClick={() => onComplete(section.key)} disabled={busy}
                data-testid={`${testid}-continue-${section.key}`}
                className="w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[15px] font-black uppercase tracking-widest disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
          {busy ? "Saving…" : <>{continueLabel} <i className="fas fa-arrow-right ml-1.5 text-[12px]" aria-hidden="true" /></>}
        </button>
      )}
      {instructional && completed && (
        <p className="text-[15px] font-black text-shPrimary text-center py-2" data-testid={`${testid}-done-${section.key}`}>
          <i className="fas fa-circle-check mr-2" aria-hidden="true" />You&apos;ve completed this step
        </p>
      )}
    </section>
  );
}
