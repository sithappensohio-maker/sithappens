/**
 * Sprint 110b — Homework Client Incentives panel for the client portal.
 *
 * Bundle:
 *   1. Streak ladder (3/7/14/30/60/100 days) — fire-emoji tier display
 *   2. Trophies progress for the homework category (locked vs earned, % to next)
 *   3. Shareable certificates carousel — every completed plan with a cert,
 *      one tap to mint a public share link and copy it to clipboard.
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TIER_RING = {
  bronze:   "ring-[#cd7f32] bg-[#3a2412]/40",
  silver:   "ring-[#bfc7cf] bg-[#1e2a33]/40",
  gold:     "ring-[#f5c037] bg-[#3a2a08]/40",
  platinum: "ring-[#7ee0ff] bg-[#0c2a36]/40",
  diamond:  "ring-[#a78bfa] bg-[#1a1330]/40",
};
const TIER_TEXT = {
  bronze: "text-[#f0c89c]", silver: "text-[#dde6ee]", gold: "text-[#ffe7a3]",
  platinum: "text-[#bff0ff]", diamond: "text-[#e2d6ff]",
};

export default function HomeworkIncentivesPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [shareBusy, setShareBusy] = useState(null);
  const [copiedFor, setCopiedFor] = useState(null);

  const load = async () => {
    try { const r = await api.get("/portal/incentives"); setData(r.data); setErr(""); }
    catch (e) { setErr(e.response?.data?.detail || "Couldn't load incentives"); }
  };
  useEffect(() => { load(); }, []);

  const share = async (cert) => {
    setShareBusy(cert.homework_id);
    try {
      const r = await api.post(`/homework/${cert.homework_id}/share-link`);
      const url = `${window.location.origin}/share/cert/${r.data.share_token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      setCopiedFor(cert.homework_id);
      setTimeout(() => setCopiedFor(null), 2500);
      await load();
    } catch (e) { setErr(e.response?.data?.detail || "Couldn't generate share link"); }
    finally { setShareBusy(null); }
  };

  if (err) return null;
  if (!data) return null;

  const earnedTrophies = (data.trophy_progress || []).filter(t => t.earned);
  const upcomingTrophies = (data.trophy_progress || []).filter(t => !t.earned).slice(0, 4);
  const current = data.current_milestone;
  const next = data.next_milestone;
  const ladder = data.streak_ladder || [];

  // Hide entirely if the client has zero homework activity AND no achievements
  if (data.streak_days === 0 && data.completed_plans === 0 && earnedTrophies.length === 0) return null;

  return (
    <div className="rounded-xl border border-bgHover bg-bgPanel p-4 mb-4 shadow-lg" data-testid="incentives-panel">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-[14px] font-black uppercase tracking-widest text-white">
          <i className="fas fa-trophy text-shGreen mr-2"/>Your achievements
        </p>
        <p className="text-[12px] font-black uppercase tracking-widest text-gray-500">
          {earnedTrophies.length} earned · {(data.trophy_progress || []).length - earnedTrophies.length} to unlock
        </p>
      </div>

      {/* Streak tier — the headline */}
      <div className="bg-bgBase rounded-lg p-4 mb-4 border border-bgHover" data-testid="incentives-streak">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Current streak</p>
            <p className="text-4xl font-black text-shOrange mt-1" data-testid="incentives-streak-days">
              {data.streak_days} <span className="text-base text-gray-400 font-bold normal-case">day{data.streak_days === 1 ? "" : "s"}</span>
            </p>
            {current && (
              <p className="text-[13px] text-shGreen font-black mt-1" data-testid="incentives-current-milestone">
                <span className="mr-1">{current.emoji}</span>{current.label}
              </p>
            )}
          </div>
          {next && (
            <div className="text-right">
              <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Next milestone</p>
              <p className="text-[13px] text-white font-black" data-testid="incentives-next-milestone">
                <span className="mr-1">{next.emoji}</span>{next.label}
              </p>
              <p className="text-[12px] text-shBlue font-black">
                {next.days_to_go} day{next.days_to_go === 1 ? "" : "s"} to go
              </p>
            </div>
          )}
        </div>
        {/* Ladder rungs visual */}
        <div className="grid grid-cols-6 gap-1 mt-3" data-testid="incentives-ladder">
          {ladder.map((rung) => {
            const reached = data.streak_days >= rung.threshold;
            return (
              <div key={rung.threshold}
                   className={`text-center py-2 rounded transition ${reached ? "bg-shOrange/20 ring-1 ring-shOrange" : "bg-bgHover/40"}`}
                   title={`${rung.label} · ${rung.threshold} days`}>
                <div className={`text-lg ${reached ? "" : "grayscale opacity-40"}`}>{rung.emoji}</div>
                <div className={`text-[10px] font-black uppercase tracking-widest ${reached ? "text-shOrange" : "text-gray-600"}`}>
                  {rung.threshold}d
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Earned trophies row */}
      {earnedTrophies.length > 0 && (
        <div className="mb-4" data-testid="incentives-earned">
          <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-2">Earned</p>
          <div className="flex flex-wrap gap-2">
            {earnedTrophies.map(t => (
              <div key={t.code}
                   data-testid={`incentives-trophy-${t.code}`}
                   className={`flex items-center gap-2 px-3 py-2 rounded-lg ring-2 ${TIER_RING[t.tier] || TIER_RING.bronze}`}>
                <i className={`fas ${t.icon || "fa-trophy"} text-lg ${TIER_TEXT[t.tier] || ""}`}/>
                <div>
                  <p className={`text-[13px] font-black leading-tight ${TIER_TEXT[t.tier] || "text-white"}`}>{t.name}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">{t.tier}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Up next trophies with progress bars */}
      {upcomingTrophies.length > 0 && (
        <div className="mb-4" data-testid="incentives-upcoming">
          <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-2">Up next</p>
          <div className="space-y-2">
            {upcomingTrophies.map(t => (
              <div key={t.code} data-testid={`incentives-upcoming-${t.code}`}
                   className="bg-bgBase rounded-lg p-3 border border-bgHover">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <i className={`fas ${t.icon || "fa-medal"} ${TIER_TEXT[t.tier] || "text-gray-400"}`}/>
                    <p className={`text-[13px] font-black truncate ${TIER_TEXT[t.tier] || "text-white"}`}>{t.name}</p>
                  </div>
                  <p className="text-[12px] font-black text-gray-400 shrink-0 ml-2">
                    {t.current}/{t.threshold}
                  </p>
                </div>
                <div className="h-1.5 bg-bgHover rounded overflow-hidden">
                  <div className="h-full bg-shGreen rounded transition-all"
                       style={{ width: `${t.pct}%` }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shareable certificates */}
      {(data.certificates || []).length > 0 && (
        <div data-testid="incentives-certificates">
          <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-2">
            <i className="fas fa-certificate text-shGreen mr-1"/>Shareable certificates
          </p>
          <div className="space-y-2">
            {data.certificates.map(c => (
              <div key={c.homework_id}
                   data-testid={`incentives-cert-${c.homework_id}`}
                   className="bg-bgBase rounded-lg p-3 border border-bgHover flex items-center gap-3 flex-wrap">
                <i className="fas fa-graduation-cap text-shGreen text-xl"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-black text-white truncate">{c.title || "Training Plan"}</p>
                  <p className="text-[12px] text-gray-500 truncate">
                    {c.dog_name} {c.completed_at ? `· ${new Date(c.completed_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <button onClick={() => share(c)}
                        disabled={shareBusy === c.homework_id}
                        data-testid={`incentives-cert-share-${c.homework_id}`}
                        className="bg-shBlue text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:opacity-90 disabled:opacity-50">
                  <i className={`fas ${shareBusy === c.homework_id ? "fa-spinner fa-spin" : copiedFor === c.homework_id ? "fa-check" : "fa-share-nodes"} mr-1`}/>
                  {copiedFor === c.homework_id ? "Copied!" : "Share"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
