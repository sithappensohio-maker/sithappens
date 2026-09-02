// Training UI Phase 4 — restrained achievement/milestone card. Sources from
// the SAME existing /portal/trophies award data TrophyWall already renders.
//
// Artwork rule: whenever an award is shown anywhere, it must use the picture
// the admin uploaded on the trophy (Settings → Trophies). Awarded rows carry
// that upload as `trophy_custom_image` (snapshotted at award-time and kept in
// sync by the catalog PUT), so pass the full award row as `trophy` and this
// card renders it through TrophyBadge — same fit mode + focal point as the
// trophy wall and share cards. The Font Awesome icon tile is ONLY the
// fallback for trophies that have no upload.
import TrophyBadge from "../TrophyBadge";

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return ""; }
}

export function achievementImage(trophy) {
  if (!trophy) return "";
  return trophy.trophy_custom_image || trophy.custom_image || "";
}

export default function AchievementCard({ trophy, icon, name, date, description, testid }) {
  const t = trophy || {};
  const image = achievementImage(t);
  const resolvedIcon = icon || t.trophy_icon || t.icon || "fa-trophy";
  const resolvedName = name || t.trophy_name || t.name || "";
  const resolvedDate = date || t.awarded_at || "";
  const resolvedDescription = description || t.trophy_description || t.description || "";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-shAccent/25 bg-gradient-to-br from-shAccent/[0.08] via-black/25 to-black/35 p-4 hover:border-shAccent/45 transition" data-testid={testid}>
      <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-shAccent/10 blur-2xl"/>
      <div className="relative flex items-start gap-3.5">
        {image ? (
          <div className="shrink-0" data-testid={testid ? `${testid}-artwork` : undefined}>
            <TrophyBadge trophy={t} size="sm" data-testid={testid ? `${testid}-badge` : undefined}/>
          </div>
        ) : (
          <div className="shrink-0 w-12 h-12 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center shadow-[0_0_22px_rgba(242,101,34,0.10)]" data-testid={testid ? `${testid}-icon` : undefined}>
            <i className={`fas ${resolvedIcon} text-shAccent text-[17px]`}/>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shAccent/80 mb-0.5">Achievement earned</p>
          <p className="text-[14px] font-black text-shText leading-tight">{resolvedName}</p>
          {resolvedDescription && <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed">{resolvedDescription}</p>}
          {resolvedDate && <p className="text-[10px] font-bold text-shTextMuted mt-2"><i className="far fa-calendar mr-1.5"/>{fmtDate(resolvedDate)}</p>}
        </div>
      </div>
    </div>
  );
}
