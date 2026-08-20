/* Client School — the guided lesson sequence.
 *
 * Phase 2 of the client redesign. The brief asks that a lesson stop being a
 * wall of authored text and instead read as a guided sequence the client can
 * follow while actually handling a dog.
 *
 * IMPORTANT: this MAPS existing authored fields onto that sequence. It does
 * not duplicate curriculum data, add fields, or change what a trainer writes
 * in Program Studio. A section that has no authored content simply does not
 * appear — the brief forbids showing empty placeholders (notably fake video
 * frames) to a paying client.
 *
 * The lesson's ACTIONS (start practice, advance, checkpoint, quiz) stay in
 * LessonScreen, driven by the canonical backend state machine. Nothing here
 * decides progression.
 */
import { useState } from "react";

/* The eight-step sequence from the design handoff, each mapped to the
   authored field that already carries that content. */
export const GUIDE_SECTIONS = [
  { key: "learn", n: 1, label: "Learn", icon: "fa-lightbulb", blurb: "Understand the goal" },
  { key: "get_ready", n: 2, label: "Get Ready", icon: "fa-clipboard-check", blurb: "Set up for success" },
  { key: "train", n: 3, label: "Train", icon: "fa-shoe-prints", blurb: "Step-by-step instructions" },
  { key: "watch_for", n: 4, label: "Watch For This", icon: "fa-eye", blurb: "What good progress looks like" },
  { key: "know_got_it", n: 5, label: "Know When You've Got It", icon: "fa-star", blurb: "Key signs of success" },
  { key: "practice", n: 6, label: "Practice", icon: "fa-paw", blurb: "Apply and build skills" },
  { key: "quick_check", n: 7, label: "Quick Check", icon: "fa-circle-question", blurb: "Check your knowledge" },
  { key: "next_step", n: 8, label: "Next Step", icon: "fa-arrow-right", blurb: "What's coming next" },
];

/** Which authored field feeds each section. Returns only sections that
 *  actually have content, so the sequence never shows an empty shell. */
export function buildGuide(lesson, { hasPractice, hasQuiz } = {}) {
  const l = lesson || {};
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const learn = [text(l.client_overview), text(l.why_it_matters)].filter(Boolean).join("\n\n");
  const map = {
    learn,
    get_ready: text(l.equipment_needed),
    train: text(l.client_instructions),
    watch_for: text(l.common_mistakes),
    know_got_it: text(l.success_criteria),
    practice: hasPractice ? "ready" : "",
    quick_check: hasQuiz ? "ready" : "",
    next_step: "ready",
  };
  return GUIDE_SECTIONS.filter(s => !!map[s.key]).map(s => ({ ...s, body: map[s.key] }));
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

function CollapsibleNote({ icon, title, body, testid }) {
  const [open, setOpen] = useState(false);
  if (!body) return null;
  return (
    <div className="rounded-xl border border-shBorder/50 bg-black/10 overflow-hidden" data-testid={testid}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              className="w-full px-3.5 py-3 flex items-center gap-2.5 text-left min-h-[48px]">
        <i className={`fas ${icon} text-shSecondary text-[12px]`} />
        <span className="flex-1 min-w-0 text-[13px] font-black text-shText">{title}</span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[10px] text-shTextMuted`} />
      </button>
      {open && <p className="px-3.5 pb-3.5 -mt-1 text-[13px] text-shTextMuted whitespace-pre-wrap leading-relaxed">{body}</p>}
    </div>
  );
}

/** The lesson read as a plan: what you're learning, how to do it, and what
 *  success looks like — with long safety/troubleshooting content collapsed so
 *  it never buries the steps. */
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

/** One section's content, rendered as large readable steps when the trainer
 *  authored a list. Troubleshooting and safety collapse by default. */
export function LessonSectionBody({ lesson, sectionKey, testid = "lesson-section" }) {
  const sections = buildGuide(lesson, { hasPractice: true, hasQuiz: true });
  const section = sections.find(s => s.key === sectionKey);
  if (!section || section.body === "ready") return null;
  const steps = section.key === "train" ? splitSteps(section.body) : null;

  return (
    <section className="rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] p-4 sm:p-5 space-y-3"
             data-testid={`${testid}-${section.key}`}>
      <div>
        <p className="text-[9.5px] font-black uppercase tracking-[0.18em] text-shSecondary">Step {section.n} of {sections.length}</p>
        <h3 className="text-[18px] font-black text-shText mt-1">{section.label}</h3>
      </div>

      {steps ? (
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
      ) : (
        <p className="text-[13.5px] text-shText/90 whitespace-pre-wrap leading-relaxed">{section.body}</p>
      )}

      {section.key === "train" && (
        <div className="space-y-2 pt-1">
          <CollapsibleNote icon="fa-screwdriver-wrench" title="Troubleshooting"
                           body={typeof lesson?.troubleshooting === "string" ? lesson.troubleshooting.trim() : ""}
                           testid={`${testid}-troubleshooting`} />
          <CollapsibleNote icon="fa-shield-halved" title="Safety notes"
                           body={typeof lesson?.safety_notes === "string" ? lesson.safety_notes.trim() : ""}
                           testid={`${testid}-safety`} />
        </div>
      )}
    </section>
  );
}
