// Training UI Phase 5 — Program Studio's draft/publish state + pre-publish
// summary + cascade-impact preview. Reuses the EXISTING GET
// /programs/{id}/publish-impact + POST /programs/{id}/publish endpoints
// exactly as before (see ProgramStudio.jsx's publish()) — this component
// only changes HOW the choice is presented: publishing "future enrollments
// only" and "publish + update active enrollments" are two separate,
// clearly labeled buttons shown together with the impact numbers already
// visible, instead of one Publish button that reveals the cascade choice
// only inside a native confirm() dialog after the click. Cascade is never
// bundled into an ambiguous single action.
export default function PublishReadinessPanel({ isNew, draftMeta, validation, impact, loadingImpact, onPublish, saving, testid }) {
  if (isNew) return null;

  const stateBadges = [];
  if (draftMeta) stateBadges.push({ label: "Unpublished Changes", cls: "bg-shAccent/15 text-shAccent border-shAccent/40" });
  else stateBadges.push({ label: "Published", cls: "bg-shPrimary/15 text-shPrimary border-shPrimary/40" });
  if (validation && !validation.valid) stateBadges.push({ label: `${validation.errors.length} Blocking Error(s)`, cls: "bg-red-500/15 text-red-400 border-red-500/40" });
  else if (validation && validation.warnings?.length > 0) stateBadges.push({ label: `${validation.warnings.length} Warning(s)`, cls: "bg-shAccent/15 text-shAccent border-shAccent/40" });
  if (impact && impact.enrollments_affected > 0) stateBadges.push({ label: `${impact.enrollments_affected} Active Enrollment(s) Affected`, cls: "bg-shSecondary/15 text-shSecondary border-shSecondary/40" });

  const blocked = !!(validation && !validation.valid);

  return (
    <div className="space-y-3" data-testid={testid}>
      <div className="flex flex-wrap gap-1.5" data-testid={testid ? `${testid}-badges` : undefined}>
        {stateBadges.map(b => (
          <span key={b.label} className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border ${b.cls}`}>{b.label}</span>
        ))}
      </div>

      {!draftMeta && (
        <p className="text-[12px] text-shTextMuted italic">No draft in progress — this program is live as published.</p>
      )}

      {draftMeta && (
        <>
          {loadingImpact && <p className="text-[12px] text-shTextMuted"><i className="fas fa-spinner fa-spin mr-1.5"/>Checking publish readiness…</p>}
          {impact && (
            <div className="bg-black/20 border border-shBorder rounded p-3 space-y-1.5" data-testid={testid ? `${testid}-impact` : undefined}>
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Pre-Publish Summary</p>
              <p className="text-[12px] text-shText">Skills added: <b>{impact.skills_added}</b> · Skills removed: <b>{impact.skills_removed}</b></p>
              {impact.enrollments_affected > 0 ? (
                <>
                  <p className="text-[12px] text-shText">
                    <b>{impact.enrollments_affected}</b> active enrollment(s) would be affected if cascaded.
                  </p>
                  <p className="text-[12px] text-shTextMuted">
                    {impact.progress_entries_preserved} progress entries preserved
                    {impact.progress_entries_orphaned > 0 && `, ${impact.progress_entries_orphaned} would be dropped (skill no longer in curriculum)`}.
                  </p>
                </>
              ) : (
                <p className="text-[12px] text-shTextMuted">No active enrollments on this program — publishing only affects future enrollments.</p>
              )}
              <p className="text-[12px] text-shTextMuted">Future enrollments always get the newly published curriculum.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => onPublish(false)} disabled={saving || blocked} data-testid={testid ? `${testid}-publish` : undefined}
                    className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
              <i className="fas fa-rocket mr-1.5"/>Publish (Future Enrollments Only)
            </button>
            {impact && impact.enrollments_affected > 0 && (
              <button onClick={() => onPublish(true)} disabled={saving || blocked} data-testid={testid ? `${testid}-publish-cascade` : undefined}
                      className="bg-shSecondary/15 text-shSecondary border border-shSecondary/50 px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
                <i className="fas fa-arrows-rotate mr-1.5"/>Publish &amp; Update {impact.enrollments_affected} Active Enrollment(s)
              </button>
            )}
          </div>
          {blocked && <p className="text-[12px] text-red-400">Fix the blocking errors in the Validation tab before publishing.</p>}
        </>
      )}
    </div>
  );
}
