// Module Quiz — the native student quiz experience. Server-authoritative
// end to end: questions arrive sanitized (no correct answers), grading and
// advancement happen in POST .../quiz/submit, and this panel only renders
// what the server returns. Unlimited retries, no cooldown, no payment.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../../../lib/api";
import PremiumButton from "../../premium/PremiumButton";
import { useImmersiveWorkflow } from "../../../lib/immersiveWorkflow";

const newIdempotencyKey = () =>
  (window.crypto?.randomUUID ? window.crypto.randomUUID() : `qk-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function ResultQuestion({ r, onReviewLesson }) {
  const good = !!r.correct;
  return (
    <div className={`rounded-xl border p-3 ${good ? "border-shPrimary/30 bg-shPrimary/[0.05]" : "border-shAccent/30 bg-shAccent/[0.05]"}`}
         data-testid={`quiz-result-${r.question_id}`}>
      <p className="text-[16px] font-black text-shText leading-snug">{r.question}</p>
      <p className={`text-[15px] mt-1.5 ${good ? "text-shPrimary" : "text-shAccent"}`}>
        <i className={`fas ${good ? "fa-check" : "fa-xmark"} mr-1.5`} />Your answer: {r.selected_answer || "—"}
      </p>
      {!good && (
        <p className="text-[15px] text-shPrimary mt-1"><i className="fas fa-circle-check mr-1.5" />Correct answer: {r.correct_answer}</p>
      )}
      {r.explanation && <p className="text-[15px] text-shTextMuted mt-2 leading-relaxed border-l-2 border-shSecondary/30 pl-2">{r.explanation}</p>}
      {!good && r.review_lesson_id && (
        <button type="button" onClick={() => onReviewLesson?.(r.review_lesson_id)} data-testid={`quiz-review-lesson-${r.question_id}`}
                className="mt-2 min-h-[40px] px-3 rounded-xl border border-shSecondary/35 text-shSecondary text-[14px] font-black uppercase tracking-widest hover:bg-shSecondary/[0.06]">
          <i className="fas fa-book-open mr-1.5" />Review {r.review_lesson_name || "the lesson"}
        </button>
      )}
    </div>
  );
}

export default function ModuleQuizPanel({ enrollmentId, moduleId, checkpointPassed = false, onClose, onAdvanced, onReviewLesson }) {
  useImmersiveWorkflow(true);
  const [quiz, setQuiz] = useState(null);      // GET payload
  const [loadErr, setLoadErr] = useState("");
  const [stage, setStage] = useState("intro"); // intro | taking | result
  const [answers, setAnswers] = useState({});  // question_id -> option_id
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [result, setResult] = useState(null);
  // One question at a time: the brief asks the quiz to feel like part of the
  // lesson rather than an exam paper. Grading is unchanged — every answer is
  // still submitted together, and the server remains authoritative.
  const [qIndex, setQIndex] = useState(0);

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const { data } = await api.get(`/portal/school/${enrollmentId}/modules/${moduleId}/quiz`);
      setQuiz(data);
    } catch (e) {
      setLoadErr(formatErr(e.response?.data?.detail) || "Couldn't load the quiz — try again.");
    }
  }, [enrollmentId, moduleId]);
  useEffect(() => { load(); }, [load]);

  const questions = useMemo(() => quiz?.questions || [], [quiz]);
  const unanswered = useMemo(() => questions.filter((q) => !answers[q.id]).length, [questions, answers]);

  const submit = async () => {
    if (busy) return;
    if (unanswered > 0) {
      setSubmitErr(`Answer every question first — ${unanswered} still unanswered.`);
      return;
    }
    setBusy(true); setSubmitErr("");
    try {
      const { data } = await api.post(`/portal/school/${enrollmentId}/modules/${moduleId}/quiz/submit`, {
        answers: questions.map((q) => ({ question_id: q.id, selected_option_id: answers[q.id] })),
        idempotency_key: idemKey,
      });
      setResult(data);
      setStage("result");
    } catch (e) {
      const d = e.response?.data?.detail;
      setSubmitErr((d && d.message) || formatErr(d) || "Couldn't submit the quiz — try again.");
    } finally { setBusy(false); }
  };

  const retry = async () => {
    setAnswers({});
    setQIndex(0);   // a retake starts at question one, not wherever the last attempt ended
    setResult(null);
    setSubmitErr("");
    setIdemKey(newIdempotencyKey());
    await load();
    setStage("taking");
  };

  const continueOn = () => {
    // Server already advanced during the passing submit — this only routes.
    onAdvanced?.(result);
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4 lg:p-6" data-testid="module-quiz-panel">
      <div className="relative bg-[var(--sh-card-base)] border border-shBorder/70 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0 overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,0.7)]">
        <div className="px-4 sm:px-5 py-3.5 border-b border-shBorder/55 bg-bgHeader/90 backdrop-blur-xl flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary">Module Quiz</p>
            <h3 className="text-[19px] sm:text-[21px] font-black text-shText truncate mt-0.5">{quiz?.title || "Module Quiz"}</h3>
            {quiz?.module_name && <p className="text-[14px] text-shTextMuted truncate">{quiz.module_name}</p>}
          </div>
          <button onClick={onClose} data-testid="module-quiz-close" className="w-10 h-10 rounded-xl border border-shBorder/55 bg-black/15 text-shTextMuted hover:text-shText grid place-items-center shrink-0"><i className="fas fa-times" /></button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-4 sm:px-5 py-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {loadErr && <p className="text-shDanger text-[16px] font-bold" data-testid="module-quiz-load-error">{loadErr}</p>}
          {!quiz && !loadErr && <div className="h-32 rounded-2xl bg-shBorder/20 animate-pulse" />}

          {quiz && stage === "intro" && (
            <div className="space-y-4" data-testid="module-quiz-intro">
              {checkpointPassed && (
                <div className="rounded-xl border border-shPrimary/30 bg-shPrimary/[0.06] p-3" data-testid="module-quiz-checkpoint-passed">
                  <p className="text-[15px] font-black text-shPrimary"><i className="fas fa-circle-check mr-1.5" />Trainer Checkpoint Passed</p>
                  <p className="text-[15px] text-shTextMuted mt-0.5">Next step: Module Quiz</p>
                </div>
              )}
              <div className="rounded-2xl border border-shBorder bg-black/15 p-4">
                <p className="text-[17px] font-black text-shText">Before moving on, make sure the important pieces make sense.</p>
                {quiz.instructions && <p className="text-[16px] text-shTextMuted mt-2 leading-relaxed whitespace-pre-wrap">{quiz.instructions}</p>}
                <p className="text-[15px] text-shTextMuted mt-3 font-bold" data-testid="module-quiz-meta">
                  {quiz.question_count} question{quiz.question_count === 1 ? "" : "s"} · Passing score {quiz.passing_score}%
                  {quiz.attempt_count > 0 && ` · ${quiz.attempt_count} previous attempt${quiz.attempt_count === 1 ? "" : "s"}`}
                </p>
                {quiz.status === "passed" ? (
                  <p className="text-[16px] font-black text-shPrimary mt-3" data-testid="module-quiz-already-passed">
                    <i className="fas fa-circle-check mr-1.5" />Passed{quiz.best_score != null ? ` — ${Math.round(quiz.best_score)}%` : ""}
                  </p>
                ) : quiz.status !== "available" ? (
                  <p className="text-[15px] text-shTextMuted mt-3" data-testid="module-quiz-locked">
                    <i className="fas fa-lock mr-1.5" />This quiz unlocks after you finish this module&apos;s lessons{" "}
                    (including any trainer checkpoint).
                  </p>
                ) : (
                  <PremiumButton onClick={() => { setQIndex(0); setStage("taking"); }} data-testid="module-quiz-start" className="mt-4 w-full justify-center min-h-[50px]">
                    <i className="fas fa-list-check text-[14px]" />Take Module Quiz
                  </PremiumButton>
                )}
              </div>
            </div>
          )}

          {quiz && stage === "taking" && (() => {
            const i = Math.min(qIndex, Math.max(0, questions.length - 1));
            const q = questions[i];
            if (!q) return null;
            const chosen = answers[q.id];
            const isLast = i >= questions.length - 1;
            return (
              <div className="space-y-4" data-testid="module-quiz-questions" data-question-index={i}>
                {/* Progress first: the client should always know where they are
                    and that the end is in sight. */}
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary" data-testid="module-quiz-progress">
                      Question {i + 1} of {questions.length}
                    </p>
                    {unanswered > 0 && <p className="text-[13px] text-shTextMuted">{unanswered} left</p>}
                  </div>
                  <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mt-2">
                    <div className="h-full rounded-full bg-shSecondary transition-all"
                         style={{ width: `${((i + 1) / Math.max(1, questions.length)) * 100}%` }} />
                  </div>
                </div>

                <div className="rounded-2xl border border-shBorder bg-black/12 p-4" data-testid={`module-quiz-q-${i}`}>
                  <p className="text-[19px] sm:text-[20px] font-black text-shText leading-snug">{q.question}</p>
                  <div className="grid gap-2.5 mt-4">
                    {(q.options || []).map((o) => {
                      const on = chosen === o.id;
                      return (
                        <button key={o.id} type="button" data-testid={`module-quiz-option-${o.id}`} data-selected={on ? "true" : "false"}
                                onClick={() => setAnswers((s) => ({ ...s, [q.id]: o.id }))}
                                className={`w-full text-left rounded-xl border p-3.5 flex items-start gap-3 text-[16px] min-h-[56px] transition ${
                                  on ? "border-shPrimary/60 bg-shPrimary/[0.09] text-shText"
                                     : "border-shBorder bg-black/10 text-shText hover:border-shSecondary/35"}`}>
                          <span className={`w-6 h-6 rounded-full grid place-items-center shrink-0 border text-[13px] mt-0.5 ${
                            on ? "border-shPrimary bg-shPrimary text-[#071018]" : "border-shBorder text-transparent"}`}>
                            <i className="fas fa-check" />
                          </span>
                          <span className="leading-relaxed break-words min-w-0 flex-1">{o.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {submitErr && <p className="text-shAccent text-[16px] font-bold" data-testid="module-quiz-submit-error"><i className="fas fa-circle-info mr-1.5" />{submitErr}</p>}

                <div className="sticky bottom-0 pt-3 pb-1 bg-gradient-to-t from-[var(--sh-card-base)] via-[var(--sh-card-base)]/95 to-transparent space-y-2">
                  {isLast ? (
                    <PremiumButton onClick={submit} disabled={busy} data-testid="module-quiz-submit" className="w-full justify-center min-h-[52px]">
                      {busy ? <><i className="fas fa-spinner fa-spin" />Grading…</> : <><i className="fas fa-check text-[13px]" />Submit quiz</>}
                    </PremiumButton>
                  ) : (
                    <PremiumButton onClick={() => setQIndex(i + 1)} disabled={!chosen} data-testid="module-quiz-next"
                                   className="w-full justify-center min-h-[52px]">
                      Next question <i className="fas fa-arrow-right text-[13px]" />
                    </PremiumButton>
                  )}
                  {i > 0 && (
                    <button type="button" onClick={() => setQIndex(i - 1)} data-testid="module-quiz-back"
                            className="w-full min-h-[44px] rounded-xl border border-shBorder text-[15px] font-black text-shTextMuted hover:text-shText">
                      <i className="fas fa-arrow-left mr-1.5 text-[13px]" />Previous question
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {result && stage === "result" && (
            <div className="space-y-4" data-testid="module-quiz-result">
              {result.passed ? (
                <div className="rounded-2xl border border-shPrimary/35 bg-shPrimary/[0.07] p-4" data-testid="module-quiz-passed">
                  <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary">Passed — {Math.round(result.score_percent)}%</p>
                  <p className="text-[18px] font-black text-shText mt-1">You got {result.correct_count} of {result.question_count} correct.</p>
                  <p className="text-[16px] text-shTextMuted mt-1">{result.course_completed ? "Course complete — amazing work!" : "The next module is unlocked."}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-shAccent/35 bg-shAccent/[0.06] p-4" data-testid="module-quiz-retry">
                  <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shAccent">Almost There — {Math.round(result.score_percent)}%</p>
                  <p className="text-[18px] font-black text-shText mt-1">You got {result.correct_count} of {result.question_count} correct.</p>
                  <p className="text-[16px] text-shTextMuted mt-1">Review these concepts and try again — retakes are always free.</p>
                </div>
              )}

              <div className="space-y-2">
                {(result.results || [])
                  .filter((r) => (result.passed ? true : true))
                  .map((r) => <ResultQuestion key={r.question_id} r={r} onReviewLesson={onReviewLesson} />)}
              </div>

              {result.passed ? (
                <PremiumButton onClick={continueOn} data-testid="module-quiz-continue" className="w-full justify-center min-h-[50px]">
                  {result.course_completed ? <>See your journey <i className="fas fa-graduation-cap text-[14px]" /></> : <>Continue <i className="fas fa-arrow-right text-[14px]" /></>}
                </PremiumButton>
              ) : (
                <PremiumButton onClick={retry} disabled={busy} data-testid="module-quiz-try-again" className="w-full justify-center min-h-[50px]">
                  <i className="fas fa-rotate-left text-[14px]" />Try Quiz Again
                </PremiumButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
