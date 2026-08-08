// Training UI Phase 5 — Program Studio's draft/publish state + pre-publish
// summary + cascade-impact preview. Reuses the EXISTING GET
// /programs/{id}/publish-impact + POST /programs/{id}/publish endpoints
// exactly as before. Cascade is never bundled into an ambiguous action.
export default function PublishReadinessPanel({ isNew, draftMeta, validation, impact, loadingImpact, onPublish, saving, testid }) {
  if (isNew) return (
    <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3" data-testid={testid}>
      <p className="text-[11px] font-black text-shText">Create the program first</p>
      <p className="text-[10px] text-shTextMuted mt-1">Draft publishing and impact checks become available after the program has an ID.</p>
    </div>
  );

  const stateBadges = [];
  if (draftMeta) stateBadges.push({ label: "Unpublished Changes", cls: "bg-shAccent/10 text-shAccent border-shAccent/30" });
  else stateBadges.push({ label: "Published", cls: "bg-shPrimary/10 text-shPrimary border-shPrimary/30" });
  if (validation && !validation.valid) stateBadges.push({ label: `${validation.errors.length} Blocking Error(s)`, cls: "bg-red-500/10 text-red-400 border-red-500/30" });
  else if (validation && validation.warnings?.length > 0) stateBadges.push({ label: `${validation.warnings.length} Warning(s)`, cls: "bg-shAccent/10 text-shAccent border-shAccent/30" });
  if (impact && impact.enrollments_affected > 0) stateBadges.push({ label: `${impact.enrollments_affected} Active Enrollment(s) Affected`, cls: "bg-shSecondary/10 text-shSecondary border-shSecondary/30" });

  const blocked = !!(validation && !validation.valid);

  return (
    <div className="space-y-3" data-testid={testid}>
      <div className="flex flex-wrap gap-1.5" data-testid={testid ? `${testid}-badges` : undefined}>
        {stateBadges.map(b => (
          <span key={b.label} className={`px-2 py-1 rounded-full text-[9px] font-black tracking-wide border ${b.cls}`}>{b.label}</span>
        ))}
      </div>

      {!draftMeta && (
        <div className="rounded-xl border border-shPrimary/10 bg-shPrimary/[0.03] px-3 py-2.5 flex items-start gap-2">
          <i className="fas fa-circle-check text-shPrimary text-[11px] mt-0.5"/>
          <p className="text-[10px] text-shTextMuted">No draft in progress — this program is live as published.</p>
        </div>
      )}

      {draftMeta && (
        <>
          {loadingImpact && <p className="text-[11px] text-shTextMuted"><i className="fas fa-spinner fa-spin mr-1.5"/>Checking publish readiness…</p>}
          {impact && (
            <div className="rounded-xl border border-shBorder/50 bg-black/20 p-3 space-y-2" data-testid={testid ? `${testid}-impact` : undefined}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black text-shText">Pre-publish impact</p>
                <span className="text-[9px] text-shTextMuted">Future enrollments always get the new curriculum</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-shBorder/40 bg-black/20 p-2"><p className="text-[16px] font-black text-shPrimary">+{impact.skills_added}</p><p className="text-[9px] text-shTextMuted">Skills added</p></div>
                <div className="rounded-lg border border-shBorder/40 bg-black/20 p-2"><p className={`text-[16px] font-black ${impact.skills_removed > 0 ? "text-shAccent" : "text-shText"}`}>{impact.skills_removed}</p><p className="text-[9px] text-shTextMuted">Skills removed</p></div>
              </div>
              {impact.enrollments_affected > 0 ? (
                <div className="rounded-lg border border-shSecondary/20 bg-shSecondary/[0.035] p-2.5">
                  <p className="text-[10px] text-shText"><b>{impact.enrollments_affected}</b> active enrollment(s) would be affected if cascaded.</p>
                  <p className="text-[9px] text-shTextMuted mt-1">{impact.progress_entries_preserved} progress entries preserved{impact.progress_entries_orphaned > 0 && ` · ${impact.progress_entries_orphaned} would be dropped because the skill no longer exists`}.</p>
                </div>
              ) : (
                <p className="text-[10px] text-shTextMuted">No active enrollments are affected.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2">
            <button onClick={() => onPublish(false)} disabled={saving || blocked} data-testid={testid ? `${testid}-publish` : undefined}
                    className="min-h-[46px] bg-shPrimary text-[#071018] px-3 py-2.5 rounded-lg font-black text-[10px] shadow-[0_8px_20px_-10px_rgba(140,198,63,0.9)] disabled:opacity-50">
              <i className="fas fa-rocket mr-1.5"/>Publish for Future Enrollments
            </button>
            {impact && impact.enrollments_affected > 0 && (
              <button onClick={() => onPublish(true)} disabled={saving || blocked} data-testid={testid ? `${testid}-publish-cascade` : undefined}
                      className="min-h-[46px] bg-shSecondary/[0.08] text-shSecondary border border-shSecondary/30 px-3 py-2.5 rounded-lg font-black text-[10px] disabled:opacity-50">
                <i className="fas fa-arrows-rotate mr-1.5"/>Publish &amp; Update {impact.enrollments_affected} Active Enrollment(s)
              </button>
            )}
          </div>
          {blocked && <p className="text-[10px] text-red-400"><i className="fas fa-triangle-exclamation mr-1"/>Fix blocking errors in Validate before publishing.</p>}
        </>
      )}
    </div>
  );
}
