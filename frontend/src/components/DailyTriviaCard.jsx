// Sprint 110bi — Dog Trivia of the Day card (portal home).
//
// Wordle-style: every client sees the same multiple-choice question per day,
// answers it once, and watches their streak grow. Built-in "Quiz me more"
// expander + family leaderboard.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { todayISO } from "../lib/date";

// ─── Category badge mapping (Sprint 110bn) ──────────────────────────────────
// Real PNG assets cropped from the reference badge sheet the operator provided.
// Each trivia question carries a `tag` (breeds/training/health/anatomy/behavior/
// history/fun/myth); we map every tag to one of the 6 available badges.
const TAG_ICON = {
  breeds:   "/trivia-icons/breeds.png",
  history:  "/trivia-icons/breeds.png",
  training: "/trivia-icons/training.png",
  behavior: "/trivia-icons/training.png",
  health:   "/trivia-icons/health.png",
  anatomy:  "/trivia-icons/health.png",
  fun:      "/trivia-icons/score.png",
  myth:     "/trivia-icons/score.png",
};
const TAG_LABEL = {
  breeds: "Breeds", history: "History", training: "Training", behavior: "Behavior",
  health: "Health", anatomy: "Anatomy", fun: "Trivia", myth: "Myth-buster",
};
function iconForTag(tag) { return TAG_ICON[tag] || "/trivia-icons/score.png"; }
function labelForTag(tag) { return TAG_LABEL[tag] || "Trivia"; }

function CategoryBadge({ tag, size = 44, withLabel = false }) {
  // Glossy 3D badge. PNG to faithfully match the reference style.
  return (
    <span className="inline-flex items-center gap-2" data-testid={`trivia-cat-${tag || "unknown"}`}>
      <img src={iconForTag(tag)} alt={labelForTag(tag)}
           width={size} height={size}
           className="drop-shadow-[0_4px_10px_rgba(0,169,224,0.45)]"
           style={{ width: size, height: size, objectFit: "contain" }} />
      {withLabel && (
        <span className="text-[11px] font-black uppercase tracking-widest text-shGreen">
          {labelForTag(tag)}
        </span>
      )}
    </span>
  );
}

// ─── Inline SVG decorations (Sprint 110bm) ──────────────────────────────────
// Sticking with the Sit Happens shBlue / shOrange / shGreen palette. No image
// assets — everything is inline SVG so it's themable + zero network cost.

function PawIcon({ className = "", size = 14 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      {/* main pad */}
      <ellipse cx="16" cy="22" rx="7" ry="6" fill="currentColor"/>
      {/* four toe pads */}
      <ellipse cx="7"  cy="14" rx="3" ry="4" fill="currentColor"/>
      <ellipse cx="12" cy="8"  rx="3" ry="4" fill="currentColor"/>
      <ellipse cx="20" cy="8"  rx="3" ry="4" fill="currentColor"/>
      <ellipse cx="25" cy="14" rx="3" ry="4" fill="currentColor"/>
    </svg>
  );
}

function BoneIcon({ className = "", size = 14 }) {
  return (
    <svg viewBox="0 0 32 16" width={size} height={size * 0.5} className={className} aria-hidden="true">
      <path fill="currentColor"
            d="M5 3a3 3 0 1 1 1.6 5.6 3 3 0 1 1 0 -1.2A3 3 0 1 1 5 3zm22 0a3 3 0 1 0 -1.6 5.6 3 3 0 1 0 0 -1.2A3 3 0 1 0 27 3zM8 6h16v4H8z"/>
    </svg>
  );
}

function DogMascot({ mood = "happy", size = 56 }) {
  // Minimal Sit-Happens-style cartoon pup face. Mood swaps the mouth + eyes.
  const isHappy = mood === "happy";
  const isThinking = mood === "thinking";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {/* ears */}
      <path d="M10 18 q-4 10 4 22 q4 4 8 0 z" fill="#f26522"/>
      <path d="M54 18 q4 10 -4 22 q-4 4 -8 0 z" fill="#f26522"/>
      {/* face */}
      <circle cx="32" cy="34" r="20" fill="#fbbf77"/>
      {/* snout */}
      <ellipse cx="32" cy="42" rx="12" ry="9" fill="#fde6c4"/>
      {/* nose */}
      <ellipse cx="32" cy="37" rx="3" ry="2.2" fill="#1f2937"/>
      {/* eyes */}
      {isHappy ? (
        <>
          <path d="M22 30 q3 -4 6 0" stroke="#1f2937" strokeWidth="2" fill="none" strokeLinecap="round"/>
          <path d="M36 30 q3 -4 6 0" stroke="#1f2937" strokeWidth="2" fill="none" strokeLinecap="round"/>
        </>
      ) : isThinking ? (
        <>
          <circle cx="25" cy="30" r="2" fill="#1f2937"/>
          <circle cx="39" cy="30" r="2" fill="#1f2937"/>
        </>
      ) : (
        <>
          <line x1="22" y1="28" x2="28" y2="32" stroke="#1f2937" strokeWidth="2" strokeLinecap="round"/>
          <line x1="22" y1="32" x2="28" y2="28" stroke="#1f2937" strokeWidth="2" strokeLinecap="round"/>
          <line x1="36" y1="28" x2="42" y2="32" stroke="#1f2937" strokeWidth="2" strokeLinecap="round"/>
          <line x1="36" y1="32" x2="42" y2="28" stroke="#1f2937" strokeWidth="2" strokeLinecap="round"/>
        </>
      )}
      {/* mouth */}
      {isHappy ? (
        <path d="M26 44 q6 6 12 0" stroke="#1f2937" strokeWidth="2" fill="none" strokeLinecap="round"/>
      ) : isThinking ? (
        <line x1="28" y1="46" x2="36" y2="46" stroke="#1f2937" strokeWidth="2" strokeLinecap="round"/>
      ) : (
        <path d="M26 46 q6 -4 12 0" stroke="#1f2937" strokeWidth="2" fill="none" strokeLinecap="round"/>
      )}
      {/* tongue when happy */}
      {isHappy && <path d="M30 45 q2 4 4 0 z" fill="#ec4899"/>}
    </svg>
  );
}

function PawBackdrop() {
  // Decorative paw scatter behind the card content (very low opacity).
  const paws = [
    {x: 5,  y: 8,  size: 22, rot: -18, op: 0.06},
    {x: 88, y: 12, size: 18, rot: 22,  op: 0.05},
    {x: 76, y: 70, size: 26, rot: -8,  op: 0.05},
    {x: 18, y: 78, size: 16, rot: 14,  op: 0.06},
    {x: 50, y: 95, size: 14, rot: 0,   op: 0.04},
  ];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {paws.map((p, i) => (
        <div key={i}
             className="absolute text-shBlue"
             style={{ left: `${p.x}%`, top: `${p.y}%`, transform: `rotate(${p.rot}deg)`, opacity: p.op }}>
          <PawIcon size={p.size} />
        </div>
      ))}
    </div>
  );
}

function PawConfetti() {
  // Burst of paw-prints when the player gets the daily question correct.
  const palette = ["#8cc63f", "#f26522", "#00a9e0", "#fbbf24", "#ec4899"];
  const paws = Array.from({ length: 14 }, (_, i) => ({
    x: 50 + (Math.random() - 0.5) * 80,
    delay: i * 0.06,
    drift: (Math.random() - 0.5) * 120,
    rot: Math.floor(Math.random() * 360),
    color: palette[i % palette.length],
    size: 10 + Math.floor(Math.random() * 8),
  }));
  return (
    <div className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes paw-fall {
          0%   { transform: translate(0, -20px) rotate(0deg);   opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate(var(--drift), 220px) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
      {paws.map((p, i) => (
        <div key={i}
             className="absolute"
             style={{
               left: `${p.x}%`, top: 0,
               color: p.color,
               // CSS variables consumed by the keyframes above
               "--drift": `${p.drift}px`,
               "--rot": `${p.rot}deg`,
               animation: `paw-fall 1.6s cubic-bezier(.2,.7,.4,1) ${p.delay}s forwards`,
             }}>
          <PawIcon size={p.size} />
        </div>
      ))}
    </div>
  );
}

function DifficultyPaws({ d }) {
  const n = d === "hard" ? 3 : d === "medium" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${d} difficulty`}>
      {Array.from({ length: n }).map((_, i) => (
        <PawIcon key={i} size={10} />
      ))}
    </span>
  );
}

const DIFFICULTY_COLOR = {
  easy:   "text-shGreen bg-shGreen/15 border-shGreen/30",
  medium: "text-amber-300 bg-amber-500/15 border-amber-500/30",
  hard:   "text-shOrange bg-shOrange/15 border-shOrange/30",
};

function diffClass(d) { return DIFFICULTY_COLOR[d] || DIFFICULTY_COLOR.medium; }

export function DailyTriviaCard() {
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [result, setResult] = useState(null);  // {correct, correct_index, milestone, current_streak, ...}
  const [error, setError] = useState("");
  const [view, setView] = useState("daily");   // daily | leaderboard | quiz
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/portal/trivia/daily");
      setData(r.data);
      if (r.data.already_answered) {
        setChosen(r.data.chosen_index);
        setResult({
          correct: r.data.was_correct,
          correct_index: r.data.correct_index,
          current_streak: r.data.current_streak,
          best_streak: r.data.best_streak,
          total_correct: r.data.total_correct,
          milestone: null,
        });
      }
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load trivia");
    }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (chosen === null || submitting) return;
    setSubmitting(true);
    try {
      const r = await api.post("/portal/trivia/daily/answer", {
        question_id: data.question.id, chosen_index: chosen,
      });
      setResult(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || "Could not submit");
    } finally { setSubmitting(false); }
  };

  if (error && !data) {
    return (
      <div className="bg-bgPanel border border-bgHover rounded-2xl p-4 text-gray-400 text-sm" data-testid="trivia-error">
        <i className="fas fa-circle-info text-shOrange mr-2"/>{error}
      </div>
    );
  }
  if (!data) return null;

  const q = data.question;
  const answered = !!result;

  return (
    <div className="relative overflow-hidden bg-bgPanel card-pop rounded-2xl border border-bgHover shadow-2xl" data-testid="daily-trivia-card">
      <div className="absolute inset-0 pointer-events-none opacity-30"
           style={{ background: "radial-gradient(circle at 100% 0%, rgba(0,169,224,0.45) 0%, transparent 55%)" }}/>
      <PawBackdrop />
      {answered && result?.correct && <PawConfetti />}
      <div className="relative p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-3">
            <CategoryBadge tag={q.tag} size={48}/>
            <div className="flex flex-col">
              <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shBlue">
                Dog Trivia of the Day
              </p>
              <p className="text-[10px] font-black uppercase tracking-widest text-shGreen/80">
                {labelForTag(q.tag)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${diffClass(q.difficulty)}`} data-testid="trivia-difficulty">
              <DifficultyPaws d={q.difficulty}/>
              <span>{q.difficulty}</span>
            </span>
            {data.current_streak > 0 && (
              <span className="inline-flex items-center gap-1 bg-shOrange/15 text-shOrange border border-shOrange/30 px-2 py-0.5 rounded" data-testid="trivia-streak">
                <BoneIcon className="text-shOrange" size={12}/>
                <i className="fas fa-fire"/>{data.current_streak}d streak
              </span>
            )}
          </div>
        </div>

        <p className="text-white text-lg font-black leading-snug mb-4" data-testid="trivia-question">{q.question}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="trivia-choices">
          {q.choices.map((c, idx) => {
            let cls = "bg-bgBase border-bgHover text-gray-200 hover:border-shBlue hover:bg-shBlue/10";
            if (answered) {
              if (idx === result.correct_index) cls = "bg-shGreen/20 border-shGreen text-shGreen";
              else if (idx === chosen) cls = "bg-red-500/20 border-red-400 text-red-300";
              else cls = "bg-bgBase border-bgHover text-gray-500";
            } else if (chosen === idx) {
              cls = "bg-shBlue/20 border-shBlue text-white";
            }
            return (
              <button key={idx} onClick={()=> !answered && setChosen(idx)}
                      disabled={answered}
                      data-testid={`trivia-choice-${idx}`}
                      className={`${cls} border rounded-lg px-3 py-2 text-left text-sm font-bold transition-all`}>
                <span className="inline-block w-5 text-[11px] font-black opacity-60 mr-1">{["A","B","C","D"][idx]}</span>
                {c}
                {answered && idx === result.correct_index && <i className="fas fa-check ml-2"/>}
                {answered && idx === chosen && idx !== result.correct_index && <i className="fas fa-xmark ml-2"/>}
              </button>
            );
          })}
        </div>

        {!answered ? (
          <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
            <p className="text-[11px] text-gray-500 italic">Same question for everyone today — build your streak!</p>
            <button onClick={submit} disabled={chosen === null || submitting}
                    data-testid="trivia-submit"
                    className="bg-shBlue text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-40">
              {submitting ? "Submitting…" : <><i className="fas fa-paper-plane mr-1"/>Submit answer</>}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-2" data-testid="trivia-result">
            <div className="flex items-center gap-3">
              <DogMascot mood={result.correct ? "happy" : "sad"} size={48}/>
              <p className={`text-base font-black ${result.correct ? "text-shGreen" : "text-shOrange"}`}>
                {result.correct ? "Correct! 🐾" : "Not quite — keep your streak going tomorrow!"}
              </p>
            </div>
            {result.milestone && (
              <div className="bg-shGreen/10 border border-shGreen rounded p-2 text-sm text-shGreen font-bold" data-testid="trivia-milestone">
                {result.milestone.label}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Stat label="Current streak" value={`${result.current_streak} 🔥`} testId="trivia-stat-current"/>
              <Stat label="Best streak" value={result.best_streak} testId="trivia-stat-best"/>
              <Stat label="Total correct" value={result.total_correct} testId="trivia-stat-total"/>
            </div>
            <div className="flex gap-2 pt-2 flex-wrap">
              <button onClick={()=>setView(view==="leaderboard"?"daily":"leaderboard")}
                      data-testid="trivia-leaderboard-btn"
                      className="bg-bgBase border border-bgHover text-gray-200 hover:border-shBlue px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-trophy mr-1 text-shOrange"/>Leaderboard
              </button>
              <button onClick={()=>setView(view==="prizes"?"daily":"prizes")}
                      data-testid="trivia-prizes-btn"
                      className="bg-bgBase border border-bgHover text-gray-200 hover:border-shOrange px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-gift mr-1 text-shOrange"/>Prizes
              </button>
              <button onClick={()=>setView(view==="quiz"?"daily":"quiz")}
                      data-testid="trivia-quiz-btn"
                      className="bg-bgBase border border-bgHover text-gray-200 hover:border-shGreen px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-dice mr-1 text-shGreen"/>Quiz me more
              </button>
            </div>
          </div>
        )}

        {view === "leaderboard" && <LeaderboardPanel/>}
        {view === "prizes" && <PrizesPanel/>}
        {view === "quiz" && <QuizPanel/>}
      </div>
    </div>
  );
}

function Stat({ label, value, testId }) {
  return (
    <div className="bg-bgBase rounded-lg p-2 text-center border border-bgHover" data-testid={testId}>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="text-white text-lg font-black mt-0.5">{value}</p>
    </div>
  );
}

function LeaderboardPanel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try { const r = await api.get("/portal/trivia/leaderboard"); setData(r.data); } catch {}
    })();
  }, []);
  if (!data) return <p className="text-gray-500 text-sm mt-3">Loading leaderboard…</p>;
  const me = data.me;
  // Decide whether to show the separate "your rank" footer: only when the
  // user isn't already highlighted in the top-10 list above.
  const meAlreadyInTop = me && me.rank && data.top.some(r => r.is_me);
  return (
    <div className="mt-4 bg-bgBase rounded-lg border border-bgHover p-3" data-testid="trivia-leaderboard">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-shOrange">
          <i className="fas fa-trophy mr-1"/>Top streaks
        </p>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500" data-testid="trivia-lb-activity-hint">
          Active in last {data.inactive_after_days || 7}d · {data.total_players || 0} player{data.total_players === 1 ? "" : "s"}
        </p>
      </div>
      {data.top.length === 0 ? (
        <p className="text-gray-500 text-sm">Be the first to play! 🐾</p>
      ) : (
        <div className="space-y-1">
          {data.top.map(r => (
            <div key={r.client_id} className={`flex items-center gap-2 text-[13px] ${r.is_me ? "bg-shBlue/10 border border-shBlue/40 rounded px-2 py-1" : "px-2 py-1"}`}
                 data-testid={`trivia-lb-row-${r.rank}`}>
              <span className="text-gray-400 w-7 font-black flex items-center gap-0.5">
                <span>#{r.rank}</span>
                {r.rank <= 3 && <PawIcon className={r.rank === 1 ? "text-shOrange" : r.rank === 2 ? "text-shGreen" : "text-shBlue"} size={9}/>}
              </span>
              <span className={`flex-1 truncate ${r.is_me ? "text-white font-black" : "text-gray-300"}`}>
                {r.display_name}
                {r.dogs && r.dogs.length > 0 && (
                  <span className="text-gray-500 normal-case ml-1 text-[11px]"> · {r.dogs.join(", ")}</span>
                )}
                {r.is_me && <span className="ml-2 text-[10px] text-shBlue">YOU</span>}
              </span>
              <span className="text-shOrange font-black text-[12px]"><i className="fas fa-fire mr-1"/>{r.current_streak}d</span>
              <span className="text-gray-500 text-[11px] hidden sm:inline">best {r.best_streak}d</span>
              <span className="text-gray-400 text-[11px] w-12 text-right">{r.total_correct} ✓</span>
            </div>
          ))}
        </div>
      )}
      {/* Sprint 110cv — Your rank panel shows up when the user isn't already
          in the visible top-10 (rank is either >10 or null because they're
          inactive / never played). */}
      {me && !meAlreadyInTop && (
        <div className="mt-3 pt-3 border-t border-bgHover" data-testid="trivia-lb-me">
          <p className="text-[10px] font-black uppercase tracking-widest text-shBlue mb-1.5">Your rank</p>
          <div className="flex items-center gap-2 text-[13px] bg-shBlue/10 border border-shBlue/40 rounded px-2 py-1.5">
            <span className="text-gray-400 w-12 font-black">
              {me.rank ? `#${me.rank}` : <span className="text-gray-500 text-[11px]">—</span>}
            </span>
            <span className="flex-1 truncate text-white font-black">
              {me.display_name || "You"}
              <span className="ml-2 text-[10px] text-shBlue">YOU</span>
            </span>
            <span className="text-shOrange font-black text-[12px]"><i className="fas fa-fire mr-1"/>{me.current_streak}d</span>
            <span className="text-gray-500 text-[11px] hidden sm:inline">best {me.best_streak}d</span>
            <span className="text-gray-400 text-[11px] w-12 text-right">{me.total_correct} ✓</span>
          </div>
          {!me.rank && (
            <p className="text-[11px] text-gray-500 mt-1.5 italic">
              {me.current_streak > 0
                ? `Play today to climb the active board.`
                : `Answer today's question to claim your spot.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PrizesPanel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try { const r = await api.get("/portal/trivia/rewards-progress"); setData(r.data); } catch {}
    })();
  }, []);
  if (!data) return <p className="text-gray-500 text-sm mt-3">Loading prizes…</p>;
  const rewards = data.rewards || [];
  const cur = data.current_streak || 0;
  const earnedDays = new Set(data.earned_days || []);
  const next = data.next_milestone;
  return (
    <div className="mt-4 bg-bgBase rounded-lg border border-shOrange/40 p-3" data-testid="trivia-prizes">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-shOrange">
          <i className="fas fa-gift mr-1"/>How to win prizes
        </p>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
          🔥 {cur}-day streak
        </p>
      </div>
      <p className="text-[12px] text-gray-400 leading-relaxed mb-3">
        Answer today's trivia question correctly every day to build a streak. Hit any of the milestones below and you'll get the perk at your next pickup — we'll remember for you.
      </p>
      {next && (
        <div className="bg-shOrange/10 border border-shOrange/30 rounded px-3 py-2 mb-3" data-testid="trivia-next-milestone">
          <p className="text-[10px] font-black uppercase tracking-widest text-shOrange mb-0.5">Next reward</p>
          <p className="text-[13px] text-white font-black">{next.label}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            <span className="text-shGreen font-black">{next.days_remaining} more day{next.days_remaining === 1 ? "" : "s"}</span> to unlock (at {next.days}-day streak)
          </p>
        </div>
      )}
      {rewards.length === 0 ? (
        <p className="text-[12px] text-gray-500 italic">Your trainer hasn't set up trivia rewards yet — check back soon!</p>
      ) : (
        <div className="space-y-1.5" data-testid="trivia-prizes-ladder">
          {rewards.map(r => {
            const days = Number(r.days) || 0;
            const earned = earnedDays.has(days);
            const reached = cur >= days;
            return (
              <div key={days}
                   className={`flex items-start gap-2 px-2 py-1.5 rounded border ${earned ? "bg-shGreen/10 border-shGreen/40" : reached ? "bg-shBlue/10 border-shBlue/40" : "bg-transparent border-bgHover"}`}
                   data-testid={`trivia-prize-${days}`}>
                <span className={`text-[11px] font-black w-12 shrink-0 ${earned ? "text-shGreen" : reached ? "text-shBlue" : "text-gray-500"}`}>
                  {days}d
                </span>
                <span className={`flex-1 text-[12px] leading-snug ${earned ? "text-shGreen font-black" : reached ? "text-white" : "text-gray-300"}`}>
                  {r.label}
                </span>
                {earned ? (
                  <span className="text-[10px] font-black text-shGreen uppercase tracking-widest shrink-0">✓ Earned</span>
                ) : reached ? (
                  <span className="text-[10px] font-black text-shBlue uppercase tracking-widest shrink-0">Ready</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-gray-500 italic mt-3 leading-relaxed">
        Streak resets if you miss a day. Daily question shows up on your portal home every morning.
      </p>
    </div>
  );
}

function QuizPanel() {
  const [questions, setQuestions] = useState(null);
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState(null);
  const [results, setResults] = useState({});  // qid → {correct, correct_index}
  const [score, setScore] = useState({ right: 0, wrong: 0 });

  const reload = async () => {
    setIdx(0); setChosen(null); setResults({}); setScore({ right: 0, wrong: 0 });
    try { const r = await api.get("/portal/trivia/quiz", { params: { count: 5 } }); setQuestions(r.data.questions); }
    catch { setQuestions([]); }
  };
  useEffect(() => { reload(); }, []);

  const submit = async () => {
    if (chosen === null || !questions) return;
    const q = questions[idx];
    try {
      const r = await api.post("/portal/trivia/quiz/answer", {
        question_id: q.id, chosen_index: chosen,
      });
      const isRight = r.data.correct;
      setResults(prev => ({ ...prev, [q.id]: { correct: isRight, correct_index: r.data.correct_index, chosen } }));
      setScore(s => isRight ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 });
    } catch {}
  };

  const next = () => { setChosen(null); setIdx(i => i + 1); };

  if (!questions) return <p className="text-gray-500 text-sm mt-3">Loading quiz…</p>;
  if (questions.length === 0) return <p className="text-gray-500 text-sm mt-3">No quiz questions yet — admin needs to seed the pool.</p>;

  const done = idx >= questions.length;
  const cur = questions[idx];
  const curRes = cur && results[cur.id];

  if (done) {
    const perfect = score.right === questions.length;
    return (
      <div className="mt-4 bg-bgBase rounded-lg border border-shGreen/40 p-4 text-center relative overflow-hidden" data-testid="trivia-quiz-done">
        {perfect && <PawConfetti />}
        <div className="relative">
          <div className="flex justify-center mb-2">
            <DogMascot mood={perfect ? "happy" : score.right >= Math.ceil(questions.length / 2) ? "happy" : "thinking"} size={56}/>
          </div>
          <p className="text-[11px] font-black uppercase tracking-widest text-shGreen mb-2">Quiz complete</p>
          <p className="text-white text-3xl font-black">{score.right} / {questions.length}</p>
          <p className="text-[12px] text-gray-400 mt-1">{perfect ? "Perfect score! 🐶" : score.right >= Math.ceil(questions.length / 2) ? "Nice work — go again?" : "Keep going — practice makes perfect!"}</p>
          <button onClick={reload} data-testid="trivia-quiz-restart"
                  className="mt-3 bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest">
            <i className="fas fa-rotate-right mr-1"/>Play again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-bgBase rounded-lg border border-bgHover p-3" data-testid="trivia-quiz-panel">
      <div className="flex justify-between items-center mb-2 text-[11px] font-black uppercase tracking-widest">
        <span className="text-gray-500">Question {idx + 1} of {questions.length}</span>
        <span className={`px-2 py-0.5 rounded border ${diffClass(cur.difficulty)}`}>{cur.difficulty}</span>
        <span className="text-shGreen">{score.right} ✓</span>
      </div>
      <p className="text-white text-base font-bold mb-3">{cur.question}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {cur.choices.map((c, i) => {
          let cls = "bg-bgPanel border-bgHover text-gray-200 hover:border-shGreen";
          if (curRes) {
            if (i === curRes.correct_index) cls = "bg-shGreen/20 border-shGreen text-shGreen";
            else if (i === curRes.chosen) cls = "bg-red-500/20 border-red-400 text-red-300";
            else cls = "bg-bgPanel border-bgHover text-gray-500";
          } else if (chosen === i) cls = "bg-shGreen/15 border-shGreen text-white";
          return (
            <button key={i} onClick={()=> !curRes && setChosen(i)}
                    disabled={!!curRes} data-testid={`trivia-quiz-choice-${i}`}
                    className={`${cls} border rounded px-3 py-2 text-left text-[13px] font-bold`}>
              <span className="inline-block w-5 text-[10px] font-black opacity-60 mr-1">{["A","B","C","D"][i]}</span>{c}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end mt-3">
        {!curRes ? (
          <button onClick={submit} disabled={chosen === null} data-testid="trivia-quiz-submit"
                  className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
            <i className="fas fa-paper-plane mr-1"/>Submit
          </button>
        ) : (
          <button onClick={next} data-testid="trivia-quiz-next"
                  className="bg-shBlue text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest">
            {idx + 1 < questions.length ? <><i className="fas fa-arrow-right mr-1"/>Next</> : <><i className="fas fa-flag-checkered mr-1"/>See results</>}
          </button>
        )}
      </div>
    </div>
  );
}
