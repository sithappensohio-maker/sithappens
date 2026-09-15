/* Stage 9 — the TRAINER's reading of the one canonical lesson.
 *
 * Renders overview.current_lesson_guide (built server-side by
 * _trainer_lesson_guide from the same snapshot lesson the client roadmap
 * uses) as a teaching guide: Goal → How to teach it → Watch for → Success
 * looks like → Skills to record → Practice to send home → Checkpoint, with
 * everything longer one tap away under "View full lesson guide" (including
 * the lesson's authored content blocks and images, rendered through the SAME
 * LessonContentBlocks renderer the client uses). No authoring controls here:
 * this is the workspace, not Program Studio. Empty sections are omitted, so a
 * legacy lesson shows only what it has. */
import ExpandableSection from "./ExpandableSection";
import VideoDemoCard from "./VideoDemoCard";
import EquipmentChips from "./EquipmentChips";
import LessonContentBlocks from "../school/student/LessonContentBlocks";

const CP_STATE_LABEL = {
  ready: "Not yet assessed", submitted: "Client submission waiting for your review", passed: "Passed",
  more_practice: "More Practice required before a retry", trainer_assist: "Trainer Assist recommended", graded: "Reviewed",
};

/** Legacy fallback: build the same shape from the first skill activity of a
 *  plan when the bootstrap carries no guide (older payloads). */
export function guideFromActivities(activities = [], briefing = null, overview = null) {
  const lesson = activities.find((a) => a && a.source === "skill") || activities[0];
  if (!lesson) return null;
  const skills = activities.filter((a) => a && a.source === "skill").map((a) => ({
    id: a.skill_id || a.id, name: a.name, objective: a.objective || null, pass_criteria: a.pass_criteria || null,
    starting_criteria: a.starting_difficulty || null, reset_criteria: a.reset_criteria || null, targets: {},
  }));
  return {
    lesson_name: briefing?.today?.lesson_name || null,
    goal: briefing?.today?.objective || lesson.objective || null,
    how_to_teach: lesson.trainer_instructions || null,
    watch_for: [lesson.common_mistakes, lesson.troubleshooting].filter(Boolean).join(" ") || null,
    success_looks_like: lesson.pass_criteria || lesson.progression_instructions || null,
    safety_notes: lesson.safety_notes || null, setup: lesson.setup || null, equipment: lesson.equipment || null,
    why_it_matters: lesson.why_it_matters || null, client_instructions: lesson.client_coaching_points || null,
    demo_video_url: lesson.demo_video_url || null, skills, practice: overview?.current_lesson_practice?.configured ? overview.current_lesson_practice : null,
    checkpoint: null, content_blocks: [],
  };
}

function Row({ label, value, testid }) {
  if (!value) return null;
  return <p className="text-[14px] text-shText leading-relaxed" data-testid={testid}><span className="text-shSecondary font-black">{label} · </span>{value}</p>;
}

export default function TrainerLessonGuide({ guide, checkpointState = null, compact = false }) {
  if (!guide) return null;
  const skills = guide.skills || [];
  const cp = guide.checkpoint || null;
  const core = [guide.goal, guide.how_to_teach, guide.watch_for, guide.success_looks_like].some(Boolean);
  const hasFull = !!(guide.why_it_matters || guide.setup || guide.equipment || guide.client_overview || guide.client_instructions || guide.advancement_criteria
    || guide.demo_video_url || (guide.content_blocks || []).length || skills.some((s) => s.starting_criteria || s.reset_criteria || s.trainer_only_guidance || s.client_explanation));
  if (!core && !skills.length && !cp && !hasFull) return null;

  return (
    <section className="rounded-2xl border border-shBorder/60 bg-black/15 p-3.5 space-y-2.5" data-testid="train-lesson-guide" data-legacy={core ? undefined : "1"}>
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted"><i className="fas fa-book-open mr-1.5" aria-hidden="true" />Lesson guide{guide.lesson_name && compact ? ` · ${guide.lesson_name}` : ""}</p>
      {!core && <p className="text-[13px] text-shTextMuted" data-testid="train-lesson-guide-legacy">This lesson has no written teaching notes yet. The skills below are what to record.</p>}
      <Row label="Goal" value={guide.goal} testid="guide-goal" />
      <Row label="How to teach it" value={guide.how_to_teach} testid="guide-how" />
      <Row label="Watch for" value={guide.watch_for} testid="guide-watch" />
      <Row label="Success looks like" value={guide.success_looks_like} testid="guide-success" />
      {guide.safety_notes && <p className="text-[13px] text-red-300 rounded-lg border border-red-400/30 bg-red-500/[0.06] px-2.5 py-1.5" data-testid="guide-safety"><i className="fas fa-triangle-exclamation mr-1.5" aria-hidden="true" />{guide.safety_notes}</p>}

      {skills.length > 0 && (
        <div data-testid="guide-skills">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-shTextMuted mt-1">Skills to record</p>
          <ul className="mt-1 space-y-1">
            {skills.map((sk) => (
              <li key={sk.id || sk.name} className="text-[14px] text-shText" data-testid={`guide-skill-${sk.id || sk.name}`}>
                <span className="font-black">{sk.name}</span>
                {sk.pass_criteria ? <span className="text-shTextMuted"> · pass when {sk.pass_criteria}</span> : sk.objective ? <span className="text-shTextMuted"> · {sk.objective}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {guide.practice && (
        <div className="rounded-xl border border-shSecondary/30 bg-shSecondary/[0.05] px-3 py-2" data-testid="guide-practice">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-shSecondary">Practice to send home</p>
          <p className="text-[14px] text-shText font-bold mt-0.5">{guide.practice.title || "Lesson Practice"}</p>
          {guide.practice.description && <p className="text-[13px] text-shTextMuted">{guide.practice.description}</p>}
          {guide.practice.available === false && <p className="text-[13px] text-shAccent">The configured recipe no longer exists — fix it in Program Studio.</p>}
        </div>
      )}

      {cp && (
        <div className="rounded-xl border border-shAccent/40 bg-shAccent/[0.06] px-3 py-2.5 space-y-1.5" data-testid="guide-checkpoint" data-state={checkpointState?.state || "ready"}>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-shAccent"><i className="fas fa-flag-checkered mr-1.5" aria-hidden="true" />{cp.assessment_type === "final_assessment" ? "Final assessment" : "Checkpoint"} · {cp.title}</p>
          <p className="text-[13px] text-shText"><span className="text-shTextMuted">State · </span>{checkpointState?.detail || CP_STATE_LABEL[checkpointState?.state] || CP_STATE_LABEL.ready}</p>
          {cp.pass_readiness_guidance && <p className="text-[14px] text-shText" data-testid="guide-checkpoint-readiness"><span className="text-shAccent font-black">Pass when · </span>{cp.pass_readiness_guidance}</p>}
          {(cp.handler_criteria?.length > 0 || cp.dog_criteria?.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
              {[["Handler", cp.handler_criteria], ["Dog", cp.dog_criteria]].map(([who, list]) => list?.length > 0 && (
                <ul key={who} className="space-y-0.5" data-testid={`guide-checkpoint-${who.toLowerCase()}`}>
                  <li className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">{who} · scored 0–5</li>
                  {list.map((c) => <li key={c.id || c.name} className="text-shText"><span className="font-bold">{c.name}</span>{c.guidance ? <span className="text-shTextMuted"> — {c.guidance}</span> : null}</li>)}
                </ul>
              ))}
            </div>
          )}
          {cp.submission_requirements && <p className="text-[12px] text-shTextMuted">Client films: {cp.submission_requirements}</p>}
        </div>
      )}

      {hasFull && (
        <ExpandableSection title="View full lesson guide" icon="fa-book" testid="train-lesson-guide-full">
          <div className="space-y-3 text-[13px]">
            <VideoDemoCard videoUrl={guide.demo_video_url} testid="train-lesson-video" />
            <EquipmentChips equipment={guide.equipment} testid="train-lesson-equipment" />
            {[["Why it matters", guide.why_it_matters], ["Setup / prep", guide.setup], ["Advancement criteria", guide.advancement_criteria],
              ["What the client reads", guide.client_overview], ["Client instructions", guide.client_instructions]].map(([label, val]) => val && (
              <p key={label}><span className="text-shTextMuted font-black uppercase text-[11px] tracking-widest">{label}: </span><span className="text-shText">{val}</span></p>
            ))}
            {skills.filter((sk) => sk.starting_criteria || sk.reset_criteria || sk.trainer_only_guidance || sk.client_explanation).map((sk) => (
              <div key={sk.id || sk.name} className="rounded-lg border border-shBorder/50 p-2">
                <p className="text-[12px] font-black text-shText">{sk.name}</p>
                {sk.starting_criteria && <p><span className="text-shTextMuted">Start at: </span>{sk.starting_criteria}</p>}
                {sk.reset_criteria && <p><span className="text-shTextMuted">Reset if: </span>{sk.reset_criteria}</p>}
                {sk.trainer_only_guidance && <p><span className="text-shTextMuted">Trainer guidance: </span>{sk.trainer_only_guidance}</p>}
                {sk.client_explanation && <p><span className="text-shTextMuted">Client hears: </span>{sk.client_explanation}</p>}
              </div>
            ))}
            {(guide.content_blocks || []).length > 0 && (
              <div data-testid="train-lesson-blocks">
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Lesson material (what the client sees)</p>
                <LessonContentBlocks blocks={guide.content_blocks} previewMode readOnly />
              </div>
            )}
          </div>
        </ExpandableSection>
      )}
    </section>
  );
}
