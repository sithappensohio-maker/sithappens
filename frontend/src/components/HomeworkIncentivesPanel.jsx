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

function timeAgo(iso) {
  if (!iso) return "recently";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "recently";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

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

  // Show the panel as long as the client has ANY of: streak activity, completed
  // plans, or earned badges. (Sprint 110n — referral check removed.)
  if (data.streak_days === 0 && data.completed_plans === 0 && earnedTrophies.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-shGreen/40 bg-gradient-to-br from-shGreen/10 via-bgPanel to-shOrange/10 p-5 shadow-2xl"
         data-testid="incentives-panel">
      {/* Sprint 110aa — Achievements panel gets the same glow-and-eyebrow
          treatment as the rest of the polished portal. */}
      <div className="absolute inset-0 pointer-events-none opacity-25"
           style={{ background: "radial-gradient(circle at 0% 0%, rgba(140,198,63,0.5) 0%, transparent 45%), radial-gradient(circle at 100% 100%, rgba(242,101,34,0.45) 0%, transparent 50%)" }}/>
      <div className="relative">
        <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-1">
              <i className="fas fa-medal mr-1.5"/>{earnedTrophies.length} earned · {(data.trophy_progress || []).length - earnedTrophies.length} to unlock
            </p>
            <h2 className="text-2xl font-black text-white uppercase italic tracking-tight pr-1">Your Achievements.</h2>
          </div>
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

      {/* Sprint 110n — Referral feed removed; client uses an external referral system. */}
      </div>
    </div>
  );
}


function ReferralCard({ referral }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/?ref=${referral.code}`;
  const text = `${referral.share_text} ${link}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2200); }
    catch { /* clipboard blocked */ }
  };
  const nativeShare = () => {
    if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
    else copy();
  };
  return (
    <div className="mt-4 pt-4 border-t border-bgHover" data-testid="incentives-referral">
      <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-2">
        <i className="fas fa-user-plus text-shOrange mr-1"/>Refer a friend, both get a trophy
      </p>
      <div className="bg-gradient-to-br from-shOrange/10 to-shBlue/10 rounded-lg p-4 border border-shOrange/30">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Your code</p>
            <p className="text-3xl font-black text-shOrange tracking-widest font-mono" data-testid="incentives-referral-code">{referral.code}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Friends joined</p>
            <p className="text-3xl font-black text-shGreen" data-testid="incentives-referral-count">{referral.successful_count}</p>
            {referral.current_milestone && (
              <p className="text-[12px] text-shOrange font-black">
                <span className="mr-1">{referral.current_milestone.emoji}</span>{referral.current_milestone.label}
              </p>
            )}
          </div>
        </div>

        {/* Mini ladder */}
        <div className="grid grid-cols-3 gap-2 mb-3" data-testid="incentives-referral-ladder">
          {(referral.ladder || []).map(rung => {
            const reached = referral.successful_count >= rung.threshold;
            return (
              <div key={rung.threshold}
                   className={`text-center py-2 rounded transition ${reached ? "bg-shOrange/20 ring-1 ring-shOrange" : "bg-bgHover/40"}`}>
                <div className={`text-lg ${reached ? "" : "grayscale opacity-40"}`}>{rung.emoji}</div>
                <div className={`text-[10px] font-black uppercase tracking-widest mt-0.5 ${reached ? "text-shOrange" : "text-gray-600"}`}>
                  {rung.threshold} ref{rung.threshold === 1 ? "" : "s"}
                </div>
                <div className={`text-[10px] ${reached ? "text-white" : "text-gray-600"}`}>{rung.label}</div>
              </div>
            );
          })}
        </div>

        {referral.next_milestone && (
          <p className="text-[12px] text-gray-400 mb-3 text-center">
            <span className="mr-1">{referral.next_milestone.emoji}</span>
            <span className="text-shBlue font-black">{referral.next_milestone.left} more</span> to unlock <span className="text-white font-black">{referral.next_milestone.label}</span>
          </p>
        )}

        <p className="text-[12px] text-gray-300 italic mb-3">"{referral.share_text}"</p>

        {(referral.recent || []).length > 0 && (
          <div className="mb-3" data-testid="incentives-referral-recent">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-1">
              <i className="fas fa-users text-shGreen mr-1"/>Friends you've brought in
            </p>
            <div className="space-y-1">
              {referral.recent.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[12px]" data-testid={`incentives-referral-recent-${i}`}>
                  <span className="text-white font-black truncate">
                    <i className="fas fa-paw text-shOrange mr-1"/>{r.first_name}
                  </span>
                  <span className="text-gray-500 shrink-0">joined {timeAgo(r.joined_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={copy}
                  data-testid="incentives-referral-copy"
                  className="flex-1 bg-shBlue text-bgHeader px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:opacity-90">
            <i className={`fas ${copied ? "fa-check" : "fa-clipboard"} mr-1`}/>{copied ? "Copied!" : "Copy link"}
          </button>
          <button onClick={nativeShare}
                  data-testid="incentives-referral-share"
                  className="flex-1 bg-shOrange text-bgHeader px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:opacity-90">
            <i className="fas fa-share-nodes mr-1"/>Share now
          </button>
        </div>
      </div>
    </div>
  );
}
