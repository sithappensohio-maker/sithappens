// Training UI Phase 4 — restrained achievement/milestone card. Sources from
// the SAME existing /portal/trophies award data TrophyWall already renders
// (no fabricated milestones, no confetti/leaderboards/fake currency) —
// just a compact, professional list-row presentation for Progress.
function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return ""; }
}

export default function AchievementCard({ icon = "fa-trophy", name, date, description, testid }) {
  return (
    <div className="flex items-start gap-3 bg-black/20 border border-shBorder rounded-lg p-3" data-testid={testid}>
      <div className="shrink-0 w-9 h-9 rounded-full bg-shAccent/10 border border-shAccent/30 grid place-items-center">
        <i className={`fas ${icon} text-shAccent text-[14px]`}/>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-black text-shText">{name}</p>
          {date && <span className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">{fmtDate(date)}</span>}
        </div>
        {description && <p className="text-[12px] text-shTextMuted mt-0.5">{description}</p>}
      </div>
    </div>
  );
}
