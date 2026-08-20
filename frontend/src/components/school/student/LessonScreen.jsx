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
  currentStepKey, instructionalKeys, GUIDE_MIN_CONTENT_STEPS,
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
  useEffect(() => { setData(null); load(); }, [load]);

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

  /* Finishing one instructional step. The client pressed the action at the
     END of the step's content, which is what "reached the end and continued"
     means here — no timer, no scroll heuristic. The write is idempotent
     server-side, and `busy` stops a double-tap firing twice. */
  const [stepBusy, setStepBusy] = useState(false);
  const completeStep = async (stepKey) => {
    if (stepBusy) return;
    setStepBusy(true); setActionErr("");
    try {
      await api.post(`/portal/school/${enrollmentId}/lessons/${lessonId}/steps/${stepKey}/complete`);
      await load();
      onStateChanged?.();
    } catch (e) {
      setActionErr(e.response?.data?.detail?.message || e.response?.data?.detail
        || "Couldn't save your progress — try again.");
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
  // The guided sequence only replaces the flat renderer when the lesson
  // actually populates at least two steps of its own — a one-field lesson
  // reads better as plain content than as a one-item checklist. Steps that are
  // pure hand-offs to Practice / Quick Check / Next Step don't count towards
  // that, since they carry no lesson content themselves.
  const guideSections = buildGuide(lesson, { hasPractice, hasQuiz: quizAvailable });
  const hasGuide = guideSections.filter(sx => !sx.ready).length >= GUIDE_MIN_CONTENT_STEPS;
  /* Progression state comes from the SERVER — the same computation the portal
     endpoints enforce, so what the tracker shows and what the API allows can
     never disagree. Older payloads (absent fields) fall back to "open", which
     is exactly how the lesson behaved before this existed. */
  const stepsCompleted = data.steps_completed || [];
  const instructionalStepKeys = data.instructional_steps || instructionalKeys(guideSections);
  const practiceUnlocked = data.practice_unlocked !== false;
  const quickCheckUnlocked = data.quick_check_unlocked !== false;
  const guideCtx = {
    completed: stepsCompleted, practiceUnlocked, quickCheckUnlocked,
    practiceLockedReason: data.practice_locked_reason, practiced: !!data.practiced,
  };
  const currentKey = currentStepKey(guideSections, guideCtx);
  const openKey = guideKey || currentKey;
  const openSection = guideSections.find(sx => sx.key === openKey);
  const remainingInstructional = instructionalStepKeys.filter(k => !stepsCompleted.includes(k));
  const isLastInstructional = remainingInstructional.length === 1
    && remainingInstructional[0] === openKey;
  const nextSection = guideSections[guideSections.findIndex(sx => sx.key === openKey) + 1];
  // The unlock moment: material just finished, practice open, not yet started.
  const showUnlockMoment = hasGuide && hasPractice && practiceUnlocked
    && !data.practiced && instructionalStepKeys.length > 0
    && instructionalStepKeys.every(k => stepsCompleted.includes(k));
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

      {/* The durable result for a checkpoint lesson the client has already
          finished — ABOVE the lesson content, because on a checkpoint lesson
          the result is the thing they came back for. The live CheckpointPanel
          further down owns the CURRENT lesson. */}
      {!isCurrent && cpResult && (
        <CheckpointResultPanel entry={cpResult} dogName={dogName}
                               onContinue={onBackToCourse} continueLabel="Back to my course" />
      )}

      {completedReview && !cpResult && (
        <p className="text-[12.5px] text-shTextMuted rounded-xl border border-shBorder bg-[var(--sh-card-base)] px-3.5 py-2.5" data-testid="lesson-review-note">
          <i className="fas fa-book-open mr-1.5 text-shSecondary" />You've completed this lesson — it stays open for review any time.
        </p>
      )}

      {/* The guided sequence is the lesson. Whether a trainer authored Course
          Builder blocks or the legacy structured fields, buildGuide maps what
          exists onto the eight steps and selecting one reveals just that
          step's content — so the client reads a single thing at a time while
          handling a dog instead of scrolling five phone screens of continuous
          copy.

          Blocks are still drawn by LessonContentBlocks, so authored media,
          checklists, step lists and the knowledge check behave exactly as
          before; only how much is on screen at once has changed. No authored
          content is lost — a block matching no rule still lands in a visible
          step, and a section with nothing authored is omitted rather than
          shown empty.

          A lesson too thin to fill two steps keeps the flat renderer. */}
      {hasGuide ? (
          <div className="space-y-4" data-testid="lesson-guided">
            {/* A first-time client should not have to guess what this page is. */}
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

      {/* ── Action area — driven entirely by backend state ── */}
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
          {/* The unlock moment — finishing the material is an achievement, so
              a locked row must not just quietly become an enabled one. */}
          {showUnlockMoment && !prescribedRemediation && (
            <PracticeUnlockedCard dogName={dogName} busy={busy}
                                  onStartPractice={() => onStartPractice(lessonId)} />
          )}

          {/* Practice-bearing lesson: Start Practice IS the learn boundary.
              Locked until the lesson material is done — and the server refuses
              the same call, so this is a signpost, not the security. */}
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
              deliveryMode={deliveryMode}
              practiced={data.practiced}
              rubric={roadmap.checkpoint_rubric}
              status={roadmap.checkpoint_status}
              onSubmit={submitCheckpoint}
              onStartPrescribedPractice={onStartPrescribedPractice}
              onGoToRefresher={(rid) => onStateChanged?.({ openLessonId: rid })}
              busy={busy}
              /* Context the checkpoint needs to read as a milestone rather
                 than a form. All of it is already on this screen's payload —
                 no extra request, no new field. */
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
