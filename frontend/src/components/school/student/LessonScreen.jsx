import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import LessonDetailPanel from "../../training/LessonDetailPanel";
import LessonContentBlocks from "./LessonContentBlocks";
import EmptyState from "../../training/EmptyState";
import SectionCard from "../../premium/SectionCard";
import PremiumButton from "../../premium/PremiumButton";
import HuskyDogImage from "../../brand/HuskyDogImage";
import CheckpointPanel from "./CheckpointPanel";
import LessonGuide, {
  LessonSectionBody, buildGuide, LessonHowItWorks, PracticeUnlockedCard,
  currentStepKey, instructionalKeys, stepState, GUIDE_MIN_CONTENT_STEPS,
} from "./lesson/LessonGuide";
import { CheckpointResultPanel } from "./checkpoint/CheckpointCards";
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
  enrollmentId, lessonId, detail, dogName, dogPhoto, deliveryMode,
  onStartPractice, onStartPrescribedPractice, onAdvanced, onStateChanged, onBackToCourse, onAskTrainer, onTakeQuiz,
}) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);      // {status, message}
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [guideKey, setGuideKey] = useState(null);
  // "Next Step" is a signpost, not content: tapping it takes the client to
  // the real actions this lesson offers rather than opening an empty panel.
  const actionsRef = useRef(null);

  // Monotonic request counter: on a hard refresh this screen briefly mounts
  // with enrollmentId=null (the enrollment list is still resolving), and a
  // stale 404 from that phantom request must never overwrite the real
  // lesson response that races past it.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!enrollmentId || !lessonId) return;
    const seq = ++loadSeq.current;
    setErr(null);
    try {
      const { data: d } = await api.get(`/portal/school/${enrollmentId}/lessons/${lessonId}`);
      if (seq === loadSeq.current) setData(d);
    } catch (e) {
      if (seq === loadSeq.current) setErr({ status: e.response?.status, message: e.response?.data?.detail || "This lesson isn't available right now." });
    }
  }, [enrollmentId, lessonId]);
  useEffect(() => {
    // Section selection is local UI state, not progression. Never carry a
    // selection from one lesson/enrollment into the next lesson.
    setGuideKey(null);
    setData(null);
    load();
  }, [load]);

  /* A PASSED checkpoint auto-advances the enrolment server-side, so the live
     checkpoint_status is already gone by the time the client looks at the
     lesson they earned it on. The persisted record in checkpoint-history is
     the canonical source, so the milestone is read back from there rather
     than being lost — or, worse, reconstructed from session data. */
  const [cpResult, setCpResult] = useState(null);
  useEffect(() => {
    if (!enrollmentId || !lessonId) return undefined;
    let live = true;
    setCpResult(null);
    api.get(`/portal/school/${enrollmentId}/checkpoint-history`)
      .then(({ data: rows }) => {
        if (!live) return;
        setCpResult((rows || []).find((r) => r.lesson_id === lessonId) || null);
      })
      .catch(() => { if (live) setCpResult(null); });
    return () => { live = false; };
  }, [enrollmentId, lessonId, detail]);

  // Practice happens in an overlay on TOP of this screen, so finishing it
  // routes back to the SAME lesson URL — no remount, no reload. The parent
  // refreshes `detail` (the roadmap) after every practice/checkpoint change;
  // ride that signal to resync this screen's own lesson data (data.practiced
  // gates the checkpoint submit form). Skip the initial render — the mount
  // effect above already loads.
  const detailRef = useRef(detail);
  useEffect(() => {
    if (detailRef.current === detail) return;
    detailRef.current = detail;
    load();
  }, [detail, load]);

  const roadmap = detail?.roadmap;
  const requiresCp = !!(data?.is_current && roadmap?.requires_checkpoint);

  /* Finishing one instructional step. The completion endpoint returns the
     authoritative next guided state. Apply that response immediately so the
     button advances on the same click; the follow-up GET only reconciles the
     rest of the lesson payload in the background. */
  const [stepBusy, setStepBusy] = useState(false);
  const completeStep = async (stepKey) => {
    if (stepBusy) return { ok: false, ignored: true };
    setStepBusy(true); setActionErr("");
    try {
      const { data: result } = await api.post(`/portal/school/${enrollmentId}/lessons/${lessonId}/steps/${stepKey}/complete`);
      setData((cur) => cur ? ({
        ...cur,
        steps_completed: result?.steps_completed ?? cur.steps_completed,
        practice_unlocked: result?.practice_unlocked ?? cur.practice_unlocked,
        practice_locked_reason: result?.practice_locked_reason ?? null,
        learn_completed: result?.learn_completed ?? cur.learn_completed,
      }) : cur);
      setGuideKey(result?.next_instructional_step || null);
      onStateChanged?.();
      load();
      return { ok: true, ...(result || {}) };
    } catch (e) {
      const message = e.response?.data?.detail?.message || e.response?.data?.detail
        || "Couldn't save your progress — try again.";
      setActionErr(typeof message === "string" ? message : "Couldn't save your progress — try again.");
      return { ok: false, message };
    } finally { setStepBusy(false); }
  };

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
  const setupRequired = requiresCp && !hasPractice;
  const prescribedRemediation = isCurrent && roadmap?.checkpoint_status?.status === "graded" && roadmap?.checkpoint_status?.outcome === "prescribe_practice";
  const isFinal = requiresCp && roadmap?.checkpoint_rubric?.assessment_type === "final_assessment";
  const quizAvailable = !!(isCurrent && roadmap?.module_quiz_available);
  const guideSections = buildGuide(lesson, { hasPractice, hasQuiz: quizAvailable });
  const hasGuide = guideSections.filter(sx => !sx.ready).length >= GUIDE_MIN_CONTENT_STEPS;
  const stepsCompleted = data.steps_completed || [];
  const instructionalStepKeys = data.instructional_steps || instructionalKeys(guideSections);
  const practiceUnlocked = data.practice_unlocked === true;
  const quickCheckUnlocked = data.quick_check_unlocked !== false;
  const guideCtx = {
    completed: stepsCompleted, practiceUnlocked, quickCheckUnlocked,
    practiceLockedReason: data.practice_locked_reason, practiced: !!data.practiced,
  };
  const currentKey = currentStepKey(guideSections, guideCtx);
  const requestedSection = guideSections.find(sx => sx.key === guideKey);
  const requestedState = requestedSection
    ? stepState(requestedSection, { ...guideCtx, currentKey }) : null;
  const openKey = guideKey && requestedState !== "locked" ? guideKey : currentKey;
  const openSection = guideSections.find(sx => sx.key === openKey);
  const remainingInstructional = instructionalStepKeys.filter(k => !stepsCompleted.includes(k));
  const isLastInstructional = remainingInstructional.length === 1
    && remainingInstructional[0] === openKey;
  const nextSection = guideSections[guideSections.findIndex(sx => sx.key === openKey) + 1];
  const showUnlockMoment = hasGuide && hasPractice && practiceUnlocked
    && !data.practiced && instructionalStepKeys.length > 0
    && instructionalStepKeys.every(k => stepsCompleted.includes(k));
  const quizMeta = roadmap?.module_quiz || null;
  const checkpointPassedForQuiz = requiresCp && roadmap?.checkpoint_status?.outcome === "advance";
  const checkpointAlreadyInFlight = requiresCp && roadmap?.checkpoint_status
    && roadmap.checkpoint_status.status !== "not_submitted";

  return (
    <div className="max-w-3xl mx-auto space-y-4" data-testid="lesson-screen">
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
          <h1 className="text-shText font-black text-[24px] sm:text-[32px] leading-[1.12] tracking-tight text-balance mt-1">
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

      {!isCurrent && cpResult && (
        <CheckpointResultPanel entry={cpResult} dogName={dogName}
                               onContinue={onBackToCourse} continueLabel="Back to my course" />
      )}

      {completedReview && !cpResult && (
        <p className="text-[12.5px] text-shTextMuted rounded-xl border border-shBorder bg-[var(--sh-card-base)] px-3.5 py-2.5" data-testid="lesson-review-note">
          <i className="fas fa-book-open mr-1.5 text-shSecondary" />You've completed this lesson — it stays open for review any time.
        </p>
      )}

      {hasGuide ? (
          <div className="space-y-4" data-testid="lesson-guided">
            {!completedReview && <LessonHowItWorks hasPractice={hasPractice} />}
            <LessonGuide lesson={lesson} hasPractice={hasPractice} hasQuiz={quizAvailable}
                         sections={guideSections} activeKey={openKey}
                         completed={stepsCompleted}
                         practiceUnlocked={practiceUnlocked}
                         practiceLockedReason={data.practice_locked_reason}
                         quickCheckUnlocked={quickCheckUnlocked}
                         practiced={!!data.practiced}
                         onSelectSection={(k) => {
                           if (k === "next_step" || k === "practice" || k === "quick_check") {
                             setGuideKey(null);
                             actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                             return;
                           }
                           setGuideKey(k === openKey ? null : k);
                         }} />
            {openSection && <LessonSectionBody lesson={lesson} sectionKey={openKey}
                                               sections={guideSections} enrollmentId={enrollmentId}
                                               onComplete={completeStep} busy={stepBusy}
                                               completed={stepsCompleted.includes(openKey)}
                                               nextLabel={nextSection?.label}
                                               isLastInstructional={isLastInstructional} />}
            {actionErr && (
              <p className="rounded-xl border border-red-400/35 bg-red-500/[0.07] px-4 py-3 text-[14px] font-bold text-red-300"
                 data-testid="lesson-step-error">
                <i className="fas fa-triangle-exclamation mr-2" aria-hidden="true" />{actionErr}
              </p>
            )}
          </div>
        )
        : (lesson.content_blocks || []).some((b) => b?.active !== false)
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

      <div ref={actionsRef} className="space-y-4" data-testid="lesson-actions">
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
          {showUnlockMoment && !prescribedRemediation && (
            <PracticeUnlockedCard dogName={dogName} busy={busy}
                                  onStartPractice={() => onStartPractice(lessonId)} />
          )}

          {hasPractice && !prescribedRemediation && !showUnlockMoment && (
            practiceUnlocked ? (
              <PremiumButton onClick={() => onStartPractice(lessonId)} disabled={busy} data-testid="lesson-start-practice"
                             className="w-full justify-center min-h-[52px] text-[13px] sm:text-[14px]">
                <i className="fas fa-paw text-[11px]" />{practiceButtonLabel(data.practiced)}
              </PremiumButton>
            ) : (
              <div className="rounded-xl border border-shBorder bg-black/15 p-4 text-center"
                   data-testid="lesson-practice-locked">
                <p className="text-[15px] font-black text-shTextMuted">
                  <i className="fas fa-lock mr-2" aria-hidden="true" />Practice is locked
                </p>
                <p className="text-[15px] text-shTextMuted mt-1.5 leading-relaxed">
                  {data.practice_locked_reason || "Finish the lesson material to unlock Practice."}
                </p>
              </div>
            )
          )}

          {!hasPractice && isCurrent && !learnDone && (!hasGuide || instructionalStepKeys.length === 0) && (
            <PremiumButton onClick={completeLesson} disabled={busy} data-testid="lesson-complete"
                           className="w-full justify-center min-h-[52px] text-[13px] sm:text-[14px]">
              <i className="fas fa-check text-[11px]" />Complete lesson
            </PremiumButton>
          )}

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

          {isCurrent && !requiresCp && !quizAvailable
            && ((hasPractice && practiceUnlocked && data.practiced) || (!hasPractice && learnDone)) && (
            <PremiumButton variant="secondary" onClick={advance} disabled={busy} data-testid="lesson-advance"
                           className="w-full justify-center min-h-[48px]">
              Continue to next lesson <i className="fas fa-arrow-right text-[10px]" />
            </PremiumButton>
          )}

          {isCurrent && requiresCp && hasPractice && !practiceUnlocked && !checkpointAlreadyInFlight && (
            <SectionCard accent="cyan" intensity="subtle" data-testid="lesson-checkpoint-locked-by-material">
              <p className="text-[14px] font-black text-shText"><i className="fas fa-lock mr-2 text-shSecondary" />Checkpoint locked</p>
              <p className="text-[12.5px] text-shTextMuted mt-1">Finish the lesson material and Practice before submitting your checkpoint.</p>
            </SectionCard>
          )}
          {isCurrent && requiresCp && hasPractice && (practiceUnlocked || checkpointAlreadyInFlight) && (
            <CheckpointPanel
              lessonId={lessonId}
              deliveryMode={deliveryMode}
              practiced={data.practiced}
              rubric={roadmap.checkpoint_rubric}
              status={roadmap.checkpoint_status}
              onSubmit={submitCheckpoint}
              onStartPrescribedPractice={onStartPrescribedPractice}
              onGoToRefresher={(rid) => onStateChanged?.({ openLessonId: rid })}
              busy={busy}
              moduleName={data.module_name}
              dogName={dogName}
              skills={data.skills}
              roadmap={roadmap}
              onContinue={advance}
            />
          )}
        </>
      )}
      </div>
    </div>
  );
}
