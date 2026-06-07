import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Sprint 110by — 🔥 Homework Completion Streak tile.
 *
 * Lives on the client portal home and gives owners a quick dopamine hit for
 * staying consistent with their homework. Pairs naturally with Dog Trivia
 * streaks already running elsewhere in the app.
 *
 * Backend: GET /api/portal/homework-streak →
 *   { current_streak, longest_streak, last_completed_date, next_milestone,
 *     days_to_next_milestone, completed_today }
 */
export default function HomeworkStreakTile() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get("/portal/homework-streak")
      .then(r => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  if (err || !data) return null;
  // Don't bother rendering until there's at least one completion — keeps the
  // portal clean for brand-new clients who haven't done anything yet.
  if (data.current_streak === 0 && data.longest_streak === 0) return null;

  const cur = data.current_streak;
  const longest = data.longest_streak;
  const nextMile = data.next_milestone;
  const toGo = data.days_to_next_milestone;
  const completedToday = data.completed_today;

  // Flame escalates with streak length — a tiny visual reward.
  const flames = cur >= 30 ? "🔥🔥🔥" : cur >= 7 ? "🔥🔥" : cur >= 1 ? "🔥" : "";

  return (
    <div
      data-testid="portal-homework-streak"
      className="relative overflow-hidden bg-gradient-to-br from-orange-500/20 via-bgPanel to-red-500/15 border border-orange-500/40 rounded-2xl p-5 shadow-2xl"
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{ background: "radial-gradient(circle at 0% 0%, rgba(249,115,22,0.55) 0%, transparent 45%), radial-gradient(circle at 100% 100%, rgba(239,68,68,0.4) 0%, transparent 50%)" }}
      />
      <div className="relative">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-orange-400 mb-1">
          <i className="fas fa-fire mr-1.5"/>Homework streak
        </p>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            data-testid="streak-current"
            className="text-5xl font-black text-white tracking-tight leading-none"
          >
            {cur}
          </span>
          <span className="text-2xl">{flames}</span>
          <span className="text-base font-bold text-white/80">
            day{cur === 1 ? "" : "s"} in a row
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/70">
          {longest > cur && (
            <span data-testid="streak-longest">
              <i className="fas fa-trophy text-yellow-400 mr-1.5"/>
              Best: <strong className="text-white">{longest} days</strong>
            </span>
          )}
          {nextMile && toGo !== null && toGo !== undefined && (
            <span data-testid="streak-next-milestone">
              <i className="fas fa-flag text-shGreen mr-1.5"/>
              {toGo} day{toGo === 1 ? "" : "s"} to <strong className="text-white">{nextMile}-day milestone</strong>
            </span>
          )}
        </div>

        {!completedToday && cur > 0 && (
          <div className="mt-3 inline-block bg-black/30 border border-orange-500/50 rounded-lg px-3 py-1.5 text-xs font-bold text-orange-200">
            <i className="fas fa-clock mr-1.5"/>
            Log today&apos;s homework to keep the streak alive
          </div>
        )}
        {completedToday && (
          <div className="mt-3 inline-block bg-black/30 border border-shGreen/50 rounded-lg px-3 py-1.5 text-xs font-bold text-shGreen">
            <i className="fas fa-check-circle mr-1.5"/>
            Today&apos;s homework is logged · streak safe
          </div>
        )}
      </div>
    </div>
  );
}
