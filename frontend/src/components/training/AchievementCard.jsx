// Training UI Phase 4 — restrained achievement/milestone card. Sources from
// the SAME existing /portal/trophies award data TrophyWall already renders.
function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return ""; }
}

export default function AchievementCard({ icon = "fa-trophy", name, date, description, testid }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-shAccent/25 bg-gradient-to-br from-shAccent/[0.08] via-black/25 to-black/35 p-4 hover:border-shAccent/45 transition" data-testid={testid}>
      <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-shAccent/10 blur-2xl"/>
      <div className="relative flex items-start gap-3.5">
        <div className="shrink-0 w-12 h-12 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center shadow-[0_0_22px_rgba(242,101,34,0.10)]">
          <i className={`fas ${icon} text-shAccent text-[17px]`}/>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shAccent/80 mb-0.5">Achievement earned</p>
          <p className="text-[14px] font-black text-shText leading-tight">{name}</p>
          {description && <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed">{description}</p>}
          {date && <p className="text-[10px] font-bold text-shTextMuted mt-2"><i className="far fa-calendar mr-1.5"/>{fmtDate(date)}</p>}
        </div>
      </div>
    </div>
  );
}
