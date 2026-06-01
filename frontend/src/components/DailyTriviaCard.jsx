// Sprint 110bi — Dog Trivia of the Day card (portal home).
//
// Wordle-style: every client sees the same multiple-choice question per day,
// answers it once, and watches their streak grow. Built-in "Quiz me more"
// expander + family leaderboard.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { todayISO } from "../lib/date";

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
      <div className="relative p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shBlue">
            <i className="fas fa-puzzle-piece mr-2"/>Dog Trivia of the Day
          </p>
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest">
            <span className={`px-2 py-0.5 rounded border ${diffClass(q.difficulty)}`} data-testid="trivia-difficulty">{q.difficulty}</span>
            {data.current_streak > 0 && (
              <span className="bg-shOrange/15 text-shOrange border border-shOrange/30 px-2 py-0.5 rounded" data-testid="trivia-streak">
                <i className="fas fa-fire mr-1"/>{data.current_streak}d streak
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
            <p className={`text-base font-black ${result.correct ? "text-shGreen" : "text-shOrange"}`}>
              <i className={`fas ${result.correct ? "fa-check-circle" : "fa-circle-info"} mr-2`}/>
              {result.correct ? "Correct! 🐾" : "Not quite — keep your streak going tomorrow!"}
            </p>
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
              <button onClick={()=>setView(view==="quiz"?"daily":"quiz")}
                      data-testid="trivia-quiz-btn"
                      className="bg-bgBase border border-bgHover text-gray-200 hover:border-shGreen px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-dice mr-1 text-shGreen"/>Quiz me more
              </button>
            </div>
          </div>
        )}

        {view === "leaderboard" && <LeaderboardPanel/>}
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
  return (
    <div className="mt-4 bg-bgBase rounded-lg border border-bgHover p-3" data-testid="trivia-leaderboard">
      <p className="text-[11px] font-black uppercase tracking-widest text-shOrange mb-2">
        <i className="fas fa-trophy mr-1"/>Top streaks
      </p>
      {data.top.length === 0 ? (
        <p className="text-gray-500 text-sm">Be the first to play! 🐾</p>
      ) : (
        <div className="space-y-1">
          {data.top.map(r => (
            <div key={r.client_id} className={`flex items-center gap-2 text-[13px] ${r.is_me ? "bg-shBlue/10 border border-shBlue/40 rounded px-2 py-1" : "px-2 py-1"}`}
                 data-testid={`trivia-lb-row-${r.rank}`}>
              <span className="text-gray-400 w-6 font-black">#{r.rank}</span>
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
    return (
      <div className="mt-4 bg-bgBase rounded-lg border border-shGreen/40 p-4 text-center" data-testid="trivia-quiz-done">
        <p className="text-[11px] font-black uppercase tracking-widest text-shGreen mb-2">Quiz complete</p>
        <p className="text-white text-3xl font-black">{score.right} / {questions.length}</p>
        <p className="text-[12px] text-gray-400 mt-1">{score.right === questions.length ? "Perfect score! 🐶" : score.right >= Math.ceil(questions.length / 2) ? "Nice work — go again?" : "Keep going — practice makes perfect!"}</p>
        <button onClick={reload} data-testid="trivia-quiz-restart"
                className="mt-3 bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest">
          <i className="fas fa-rotate-right mr-1"/>Play again
        </button>
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
