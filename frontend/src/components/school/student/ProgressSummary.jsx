/* Compact progress summary for Home. Real counts only — no invented streaks or
 * trends. The headline % is course_pct: backend-derived CURRICULUM completion
 * (completed lessons / total lessons; checkpoints gate lessons rather than
 * carrying separate weight). Never mastered_pct — that's trainer-scored skill
 * mastery, a different measure. Links to the full Progress screen (2C). */
export default function ProgressSummary({ progress, onView }) {
  if (!progress) return null;
  const pct = Math.max(0, Math.min(100, progress.course_pct ?? 0));
  const stat = (value, label) => (
    <div className="min-w-0">
      <p className="text-[20px] font-black text-shText leading-none tabular-nums">{value}</p>
      <p className="text-[13px] text-shTextMuted uppercase tracking-wide mt-1 leading-tight">{label}</p>
    </div>
  );
  return (
    <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="progress-summary">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[14px] font-black uppercase tracking-[0.28em] text-shTextMuted">
          <i className="fas fa-chart-line mr-1.5 text-shPrimary" />Progress
        </p>
        <span className="text-[18px] font-black text-shPrimary tabular-nums">{pct}%</span>
      </div>

      <div className="h-2 rounded-full bg-shBorder/60 overflow-hidden">
        <div className="h-full rounded-full bg-shPrimary" style={{ width: `${pct}%` }} />
      </div>
      {progress.current_module_name && (
        <p className="text-[15px] text-shTextMuted mt-2 truncate">Current module: <span className="text-shText font-bold">{progress.current_module_name}</span></p>
      )}

      <div className="grid grid-cols-3 gap-3 mt-4">
        {stat(`${progress.lessons_completed}/${progress.lessons_total}`, "Lessons")}
        {stat(`${progress.modules_completed}/${progress.modules_total}`, "Modules")}
        {stat(progress.checkpoints_passed, "Checkpoints")}
      </div>

      <button type="button" onClick={onView}
              className="mt-4 text-[15px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText transition"
              data-testid="progress-view">
        See full progress <i className="fas fa-arrow-right ml-1" />
      </button>
    </section>
  );
}
