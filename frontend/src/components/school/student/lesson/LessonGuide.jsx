/* Client School — the guided lesson sequence.
 *
 * The brief asks that a lesson stop being a wall of authored text and instead
 * read as a guided sequence the client can follow while actually handling a
 * dog. This module MAPS what a trainer already authored onto that sequence —
 * it does not duplicate curriculum, add fields, or change Program Studio.
 *
 * There are TWO authored shapes and both must map, because the real Sit
 * Happens curriculum uses the newer one:
 *
 *   • Course Builder `content_blocks` — every lesson in the enhanced
 *     curriculum carries ten or eleven of them (text, checklist, steps, quiz,
 *     trainer_tip, warning, practice, and an optional checkpoint). Rendered as
 *     a flat stack this is over five phone screens of continuous scroll for a
 *     thirteen-minute lesson, which is exactly what the redesign exists to
 *     stop.
 *   • The legacy structured fields (client_overview, equipment_needed, …)
 *     still used by older programs.
 *
 * A section with no authored content simply does not appear — the brief
 * forbids showing empty placeholders to a paying client. Nothing authored is
 * ever dropped: a block that matches no rule still lands in a visible step.
 *
 * The lesson's ACTIONS (start practice, advance, checkpoint, quiz) stay in
 * LessonScreen, driven by the canonical backend state machine. Nothing here
 * decides progression.
 */
import { useState } from "react";
import LessonContentBlocks from "../LessonContentBlocks";

/* The eight-step sequence from the design handoff. */
export const GUIDE_SECTIONS = [
  { key: "learn", n: 1, label: "Learn", icon: "fa-lightbulb", blurb: "Understand the goal" },
  { key: "get_ready", n: 2, label: "Get Ready", icon: "fa-clipboard-check", blurb: "Set up for success" },
  { key: "train", n: 3, label: "Train", icon: "fa-shoe-prints", blurb: "Step-by-step instructions" },
  { key: "watch_for", n: 4, label: "Watch For This", icon: "fa-eye", blurb: "Common mistakes to avoid" },
  { key: "know_got_it", n: 5, label: "Know When You've Got It", icon: "fa-star", blurb: "Key signs of success" },
  { key: "practice", n: 6, label: "Practice", icon: "fa-paw", blurb: "Apply and build skills" },
  { key: "quick_check", n: 7, label: "Quick Check", icon: "fa-circle-question", blurb: "Check your knowledge" },
  { key: "next_step", n: 8, label: "Next Step", icon: "fa-arrow-right", blurb: "What's coming next" },
];

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

/* --------------------------------------------------------------- render --- */

export function CollapsibleNote({ icon, title, children, testid, tone = "muted" }) {
  const [open, setOpen] = useState(false);
  if (!children) return null;
  const accent = tone === "warn" ? "text-red-300" : "text-shSecondary";
  return (
    <div className={`rounded-xl border overflow-hidden ${tone === "warn" ? "border-red-400/25 bg-red-500/[0.04]" : "border-shBorder/50 bg-black/10"}`} data-testid={testid}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              className="w-full px-3.5 py-3 flex items-center gap-2.5 text-left min-h-[48px]">
        <i className={`fas ${icon} ${accent} text-[12px]`} />
        <span className="flex-1 min-w-0 text-[13px] font-black text-shText">{title}</span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[10px] text-shTextMuted`} />
      </button>
      {open && <div className="px-3.5 pb-3.5 -mt-1">{children}</div>}
    </div>
  );
}

/** The step list. One tap reveals one step's content, so the client reads a
 *  single thing at a time while handling a dog. */
export default function LessonGuide({ lesson, hasPractice, hasQuiz, activeKey, onSelectSection, testid = "lesson-guide" }) {
  const sections = buildGuide(lesson, { hasPractice, hasQuiz });
  if (sections.length === 0) return null;

  return (
    <div className="space-y-3" data-testid={testid}>
      <ol className="rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] overflow-hidden divide-y divide-shBorder/30">
        {sections.map((s) => {
          const active = activeKey === s.key;
          return (
            <li key={s.key}>
              <button type="button" onClick={() => onSelectSection?.(s.key)}
                      data-testid={`${testid}-section-${s.key}`} data-active={active ? "true" : "false"}
                      className={`w-full text-left px-3.5 py-3 flex items-center gap-3 min-h-[56px] transition ${active ? "bg-shPrimary/[0.08]" : "hover:bg-white/[0.03]"}`}>
                <span className={`w-7 h-7 rounded-full grid place-items-center shrink-0 text-[11px] font-black border ${active ? "border-shPrimary/60 bg-shPrimary/15 text-shPrimary" : "border-shBorder text-shTextMuted"}`}>
                  {s.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] font-black leading-snug ${active ? "text-shPrimary" : "text-shText"}`}>{s.label}</span>
                  <span className="block text-[11px] text-shTextMuted mt-0.5">{s.blurb}</span>
                </span>
                <i className="fas fa-chevron-right text-[10px] text-shTextMuted shrink-0" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One section's content.
 *
 *  Course Builder blocks are handed to the SAME renderer that drew them
 *  before the redesign — the change is which blocks are on screen at once, not
 *  how a block looks — so authored media, checklists, step lists and the
 *  knowledge check keep their existing behaviour and analytics. Legacy prose
 *  becomes numbered steps only when the trainer actually wrote a list.
 */
export function LessonSectionBody({ lesson, sectionKey, sections, enrollmentId, testid = "lesson-section" }) {
  const all = sections || buildGuide(lesson, { hasPractice: true, hasQuiz: true });
  const section = all.find(s => s.key === sectionKey);
  if (!section) return null;

  const blocks = section.blocks || [];
  const steps = section.key === "train" && section.body ? splitSteps(section.body) : null;
  const asides = section.key === "train" ? asideBlocks(lesson) : { troubleshooting: [], safety: [] };
  const legacyTrouble = section.key === "train" ? text(lesson?.troubleshooting) : "";
  const legacySafety = section.key === "train" ? text(lesson?.safety_notes) : "";
  // The two hand-off steps are labels for machinery that lives in
  // LessonScreen; with nothing authored of their own there is no body to draw.
  if (!blocks.length && !section.body) return null;

  return (
    <section className="space-y-3" data-testid={`${testid}-${section.key}`}>
      <div className="rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] p-4 sm:p-5 space-y-3">
        <div>
          <p className="text-[9.5px] font-black uppercase tracking-[0.18em] text-shSecondary">Step {section.n} of {all.length}</p>
          <h3 className="text-[18px] font-black text-shText mt-1">{section.label}</h3>
        </div>

        {blocks.length > 0 && <LessonContentBlocks blocks={blocks} enrollmentId={enrollmentId} />}

        {!blocks.length && steps && (
          <ol className="space-y-2.5" data-testid={`${testid}-steps`}>
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl border border-shBorder/40 bg-black/10 p-3">
                <span className="w-7 h-7 rounded-full grid place-items-center shrink-0 border border-shSecondary/40 bg-shSecondary/10 text-shSecondary text-[11px] font-black">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] text-shText leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        )}

        {!blocks.length && !steps && section.body && (
          <p className="text-[13.5px] text-shText/90 whitespace-pre-wrap leading-relaxed">{section.body}</p>
        )}
      </div>

      {/* Troubleshooting and safety sit UNDER the instructions, collapsed.
          Both are long in the real curriculum and neither is what the client
          needs first while a dog is waiting. */}
      {section.key === "train" && (asides.troubleshooting.length > 0 || legacyTrouble) && (
        <CollapsibleNote icon="fa-screwdriver-wrench" title="If it is not working" testid={`${testid}-troubleshooting`}>
          {asides.troubleshooting.length > 0
            ? <LessonContentBlocks blocks={asides.troubleshooting} enrollmentId={enrollmentId} hideTitles />
            : <p className="text-[13px] text-shTextMuted whitespace-pre-wrap leading-relaxed">{legacyTrouble}</p>}
        </CollapsibleNote>
      )}
      {section.key === "train" && (asides.safety.length > 0 || legacySafety) && (
        <CollapsibleNote icon="fa-shield-halved" title="Safety &amp; welfare" tone="warn" testid={`${testid}-safety`}>
          {asides.safety.length > 0
            ? <LessonContentBlocks blocks={asides.safety} enrollmentId={enrollmentId} hideTitles />
            : <p className="text-[13px] text-shTextMuted whitespace-pre-wrap leading-relaxed">{legacySafety}</p>}
        </CollapsibleNote>
      )}
    </section>
  );
}
