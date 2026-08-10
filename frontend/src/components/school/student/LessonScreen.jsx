import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import LessonDetailPanel from "../../training/LessonDetailPanel";
import LessonContentBlocks from "./LessonContentBlocks";
import EmptyState from "../../training/EmptyState";
import SectionCard from "../../premium/SectionCard";
import PremiumButton from "../../premium/PremiumButton";
import HuskyDogImage from "../../brand/HuskyDogImage";
import CheckpointPanel from "./CheckpointPanel";
import { practiceButtonLabel } from "../../../lib/onlineSchoolPolish";

/* Native School Lesson screen (Phase 2B). Presents existing lesson content via
 * the shared LessonDetailPanel and drives the Phase-2A Learn boundary:
 *   - lesson WITH practice  → START PRACTICE (the explicit learn-completion)
 *   - lesson WITHOUT practice → COMPLETE LESSON (complete-lesson endpoint)
 *   - checkpoint lessons → the shared CheckpointPanel (single implementation)
 *   - completed lessons → review-only (+ Practice Again; never re-complete,
 *     never touches the current enrollment pointer)
 * All progression state comes from the backend; nothing is derived here. */
export default function LessonScreen({
  enrollmentId, lessonId, detail, dogName, dogPhoto,
  onStartPractice, onStartPrescribedPractice, onAdvanced, onStateChanged, onBackToCourse, onAskTrainer, onTakeQuiz,
}) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);      // {status, message}
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const { data: d } = await api.get(`/portal/school/${enrollmentId}/lessons/${lessonId}`);
      setData(d);
    } catch (e) {
      setErr({ status: e.response?.status, message: e.response?.data?.detail || "This lesson isn't available right now." });
    }
  }, [enrollmentId, lessonId]);
  useEffect(() => { setData(null); load(); }, [load]);

  const roadmap = detail?.roadmap;
  const requiresCp = !!(data?.is_current && roadmap?.requires_checkpoint);

  const completeLesson = async () => {
    setBusy(true); setActionErr("");
    try {
      await api.post(`/portal/school/${enrollmentId}/lessons/${lessonId}/complete-lesson`);
      await load();
      onStateChanged?.();
    } catch (e) {
      setActionErr(e.response?.data?.detail || "Couldn't complete the lesson — try again.");
    } finally { setBusy(false); }
  };

  const advance = async () => {
    setBusy(true); setActionErr("");
    try {
      const { data: res } = await api.post(`/portal/school/${enrollmentId}/advance`);
      onAdvanced?.(res);
    } catch (e) {
      const d = e.response?.data?.detail;
      // Server-enforced Module Quiz gate — route into the quiz instead of
      // showing an error (the backend blocks regardless of UI state).
      if (d && typeof d === "object" && d.error_code === "module_quiz_required") {
        onTakeQuiz?.(d.module_id);
        return;
      }
      setActionErr(typeof d === "string" ? d : "Couldn't continue yet.");
    } finally { setBusy(false); }
  };

  const submitCheckpoint = async (lid, video, filename, note) => {
    setBusy(true); setActionErr("");
    try {
      await api.post(`/portal/school/${enrollmentId}/lessons/${lid}/checkpoint`, { video, filename, note });
      await load();
      onStateChanged?.();
    } catch (e) {
      setActionErr(e.response?.data?.detail || "Couldn't submit checkpoint.");
    } finally { setBusy(false); }
  };

  if (err) {
    return (
      <div className="max-w-xl mx-auto" data-testid="lesson-screen-error">
        <EmptyState icon={err.status === 403 ? "fa-lock" : "fa-circle-info"} message={err.message} testid="lesson-error-state" />
        <div className="text-center mt-4">
          <PremiumButton variant="secondary" onClick={onBackToCourse} data-testid="lesson-error-back">
            <i className="fas fa-arrow-left" /> Back to My Course
          </PremiumButton>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3" data-testid="lesson-screen-loading">
        <div className="h-16 rounded-2xl bg-shBorder/30 animate-pulse" />
        <div className="h-52 rounded-2xl bg-shBorder/20 animate-pulse" />
        <div className="h-32 rounded-2xl bg-shBorder/20 animate-pulse" />
      </div>
    );
  }

  const lesson = data.lesson;
  const isCurrent = !!data.is_current;
  const completedReview = data.status === "completed";
  const learnDone = !!data.learn_completed;
  const hasPractice = !!data.has_practice;
  // Legacy malformed config: checkpoint required but no practice configured —
  // submission is impossible. Safe support message; never the checkpoint panel.
  const setupRequired = requiresCp && !hasPractice;
  const prescribedRemediation = isCurrent && roadmap?.checkpoint_status?.status === "graded" && roadmap?.checkpoint_status?.outcome === "prescribe_practice";
  const isFinal = requiresCp && roadmap?.checkpoint_rubric?.assessment_type === "final_assessment";
  // Module Quiz gate — the server says this module's end-of-module quiz is
  // ready to take (all lesson/checkpoint work at the boundary is done).
  const quizAvailable = !!(isCurrent && roadmap?.module_quiz_available);
  const quizMeta = roadmap?.module_quiz || null;
  const checkpointPassedForQuiz = requiresCp && roadmap?.checkpoint_status?.outcome === "advance";

  return (
    <div className="max-w-3xl mx-auto space-y-4" data-testid="lesson-screen">
      {/* Context header — dog · module · lesson */}
      <header className="flex items-center gap-3">
        <span className="shrink-0 w-11 h-11 rounded-xl overflow-hidden border border-shSecondary/30 bg-black/25">
          <HuskyDogImage src={dogPhoto} name={dogName} className="w-full h-full object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-shSecondary truncate">{data.module_name}</p>
            {isCurrent && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-shPrimary/10 border border-shPrimary/25 text-shPrimary shrink-0">Current</span>}
            {completedReview && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-shBorder/40 text-shTextMuted shrink-0"><i className="fas fa-check mr-1" />Completed</span>}
          </div>
          <h1 className="text-shText font-black text-[19px] sm:text-[22px] leading-tight text-balance mt-0.5">
            {isFinal ? `${lesson.name} · Final Assessment` : lesson.name}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => onAskTrainer?.({ lesson: data, lessonId })} aria-label="Ask your trainer" data-testid="lesson-ask-trainer"
                  className="w-10 h-10 rounded-xl border border-shSecondary/30 bg-black/15 text-shSecondary hover:text-shText grid place-items-center">
            <i className="fas fa-comment-dots" />
          </button>
          <button type="button" onClick={onBackToCourse} aria-label="Back to My Course" data-testid="lesson-back"
                  className="w-10 h-10 rounded-xl border border-shBorder bg-black/15 text-shTextMuted hover:text-shText grid place-items-center">
            <i className="fas fa-route" />
          </button>
        </div>
      </header>

      {completedReview && (
        <p className="text-[12.5px] text-shTextMuted rounded-xl border border-shBorder bg-[var(--sh-card-base)] px-3.5 py-2.5" data-testid="lesson-review-note">
          <i className="fas fa-book-open mr-1.5 text-shSecondary" />You've completed this lesson — it stays open for review any time.
        </p>
      )}

      {/* Course Builder 2.0 blocks become the primary authored lesson when
          present. Legacy structured fields remain a complete fallback for every
          existing course, so no migration is required. */}
      {(lesson.content_blocks || []).some((b) => b?.active !== false)
        ? <LessonContentBlocks blocks={lesson.content_blocks} enrollmentId={enrollmentId} />
        : <LessonDetailPanel lesson={lesson} testid="lesson-detail" />}

      {data.skills?.length > 0 && (
        <SectionCard accent="cyan" intensity="subtle">
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shSecondary mb-2"><i className="fas fa-star mr-1.5" />Skills you&apos;re building</p>
          <div className="space-y-2">
            {data.skills.map((s) => (
              <div key={s.id} className="rounded-xl border border-shBorder/45 bg-black/10 p-3">
                <p className="text-[13px] font-black text-shText">{s.name}</p>
                {s.client_facing_explanation && <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed">{s.client_facing_explanation}</p>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {actionErr && <p className="text-shDanger text-[13px] font-bold" data-testid="lesson-action-error">{actionErr}</p>}

      {/* ── Action area — driven entirely by backend state ── */}
      {setupRequired ? (
        <SectionCard accent="cyan" intensity="subtle" data-testid="lesson-setup-required">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-shSecondary/10 border border-shSecondary/25 grid place-items-center shrink-0"><i className="fas fa-wrench text-shSecondary" /></span>
            <div>
              <p className="text-[14px] font-black text-shText">Training setup needs attention</p>
              <p className="text-[12.5px] text-shTextMuted mt-1">Your trainer needs to update this lesson before you can continue.</p>
            </div>
          </div>
        </SectionCard>
      ) : (
        <>
          {/* Practice-bearing lesson: Start Practice IS the learn boundary. */}
          {hasPractice && !prescribedRemediation && (
            <PremiumButton onClick={() => onStartPractice(lessonId)} disabled={busy} data-testid="lesson-start-practice"
                           className="w-full justify-center min-h-[52px] text-[13px] sm:text-[14px]">
              <i className="fas fa-paw text-[11px]" />{practiceButtonLabel(data.practiced)}
            </PremiumButton>
          )}

          {/* No-practice lesson: explicit Complete Lesson (never auto). */}
          {!hasPractice && isCurrent && !learnDone && (
            <PremiumButton onClick={completeLesson} disabled={busy} data-testid="lesson-complete"
                           className="w-full justify-center min-h-[52px] text-[13px] sm:text-[14px]">
              <i className="fas fa-check text-[11px]" />Complete lesson
            </PremiumButton>
          )}

          {/* Module Quiz gate — at the end of a quiz-gated module the quiz
              (not "continue") is the next step. Server enforces regardless. */}
          {quizAvailable && (
            <SectionCard accent="lime" intensity="subtle" data-testid="lesson-module-quiz-cta">
              {checkpointPassedForQuiz && (
                <p className="text-[12px] font-black text-shPrimary mb-1"><i className="fas fa-circle-check mr-1.5" />Trainer Checkpoint Passed</p>
              )}
              <p className="text-[14px] font-black text-shText">{quizMeta?.title || "Module Quiz"}</p>
              <p className="text-[12px] text-shTextMuted mt-1">
                Before moving on, make sure the important pieces make sense.
                {" "}{quizMeta?.question_count || 0} question{(quizMeta?.question_count || 0) === 1 ? "" : "s"} · Passing score {quizMeta?.passing_score || 80}%
              </p>
              <PremiumButton onClick={() => onTakeQuiz?.(quizMeta?.module_id)} disabled={busy} data-testid="lesson-take-module-quiz"
                             className="mt-3 w-full justify-center min-h-[50px]">
                <i className="fas fa-list-check text-[11px]" />Take Module Quiz
              </PremiumButton>
            </SectionCard>
          )}

          {/* Advance — only for the current, non-checkpoint lesson once the
              backend's requirements are met (it enforces regardless), and
              never while a Module Quiz is the required next step. */}
          {isCurrent && !requiresCp && !quizAvailable && (data.practiced || (learnDone && !hasPractice)) && (
            <PremiumButton variant="secondary" onClick={advance} disabled={busy} data-testid="lesson-advance"
                           className="w-full justify-center min-h-[48px]">
              Continue to next lesson <i className="fas fa-arrow-right text-[10px]" />
            </PremiumButton>
          )}

          {/* Checkpoint — the one shared panel (submit/awaiting/prescribed/hold). */}
          {isCurrent && requiresCp && hasPractice && (
            <CheckpointPanel
              lessonId={lessonId}
              practiced={data.practiced}
              rubric={roadmap.checkpoint_rubric}
              status={roadmap.checkpoint_status}
              onSubmit={submitCheckpoint}
              onStartPrescribedPractice={onStartPrescribedPractice}
              onGoToRefresher={(rid) => onStateChanged?.({ openLessonId: rid })}
              busy={busy}
            />
          )}
        </>
      )}
    </div>
  );
}
