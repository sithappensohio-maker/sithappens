// Training UI Phase 4 — visual skill card, replacing a raw numeric row.
// Never shows `score: N` as the primary representation — SkillLevelIndicator
// is passed the backend's client-safe level_label instead.
import SkillLevelIndicator from "./SkillLevelIndicator";
import MeasurementChips from "./MeasurementChips";

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return ""; }
}

export default function SkillProgressCard({ skill, homeworkTitle, onReviewLesson, testid }) {
  const chips = [
    { key: "duration", icon: "fa-stopwatch", label: "Duration", value: skill.target_duration },
    { key: "distance", icon: "fa-ruler", label: "Distance", value: skill.target_distance },
    { key: "reps", icon: "fa-rotate", label: "Reps", value: skill.target_repetitions },
    { key: "distraction", icon: "fa-volume-high", label: "Distraction", value: skill.target_distraction_level },
    { key: "environment", icon: "fa-tree", label: "Environment", value: skill.target_environment },
  ];
  return (
    <div className="bg-black/20 border border-shBorder rounded-lg p-3" data-testid={testid}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-shPrimary/10 border border-shPrimary/30 grid place-items-center">
            <i className="fas fa-paw text-shPrimary text-[15px]"/>
          </div>
          <p className="text-[14px] font-black text-shText truncate">{skill.name}</p>
        </div>
        <SkillLevelIndicator score={skill.score} label={skill.level_label} testid={testid ? `${testid}-level` : undefined}/>
      </div>
      <MeasurementChips items={chips} testid={testid ? `${testid}-targets` : undefined}/>
      <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-shTextMuted">
        <div className="flex items-center gap-3 flex-wrap">
          {skill.last_updated && <span><i className="fas fa-clock mr-1"/>Updated {fmtDate(skill.last_updated)}</span>}
          {homeworkTitle && <span><i className="fas fa-graduation-cap mr-1"/>{homeworkTitle}</span>}
        </div>
        {onReviewLesson && (
          <button onClick={onReviewLesson} data-testid={testid ? `${testid}-review` : undefined}
                  className="text-shSecondary font-black uppercase tracking-widest text-[10px] shrink-0">
            Review Lesson
          </button>
        )}
      </div>
    </div>
  );
}
