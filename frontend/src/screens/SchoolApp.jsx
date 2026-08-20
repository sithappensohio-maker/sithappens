import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import PremiumButton from "../components/premium/PremiumButton";
import EmptyState from "../components/premium/EmptyState";
import SchoolNav from "../components/school/student/SchoolNav";
import EnrollmentSelector from "../components/school/student/EnrollmentSelector";
import StudentHome from "../components/school/student/StudentHome";
import CourseRoadmap from "../components/school/student/CourseRoadmap";
import LessonScreen from "../components/school/student/LessonScreen";
import TodayScreen from "../components/school/student/TodayScreen";
import PracticePanel from "../components/training/PracticePanel";
import ModuleQuizPanel from "../components/school/student/ModuleQuizPanel";
import FeedbackScreen from "../components/school/student/FeedbackScreen";
import ProgressScreen from "../components/school/student/ProgressScreen";
import LessonHistoryScreen from "../components/school/student/LessonHistoryScreen";
import AskTrainerPanel from "../components/school/student/AskTrainerPanel";
import StudentWorkspaceExtras from "../components/school/student/StudentWorkspaceExtras";
import SchoolNotificationBell from "../components/school/student/SchoolNotificationBell";
import ResourcesScreen from "../components/school/student/ResourcesScreen";
import SearchScreen from "../components/school/student/SearchScreen";
import { parseSchoolPath, schoolPathFor, SELECTED_ENROLLMENT_KEY } from "../lib/studentSchool";

function AccessEndedState({ onHome, onExit }) {
  return (
    <div className="max-w-xl mx-auto rounded-2xl border border-shAccent/30 bg-shAccent/[0.05] p-5 sm:p-6" data-testid="school-access-ended">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-shAccent"><i className="fas fa-lock mr-1.5" />Course access</p>
      <h1 className="text-xl sm:text-2xl font-black text-shText mt-1">Course access ended</h1>
      <p className="text-[13px] text-shTextMuted mt-2 leading-relaxed">This course is still part of your School history, but the training content is not currently available. Contact Sit Happens if you believe access should be restored.</p>
      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={onHome} className="min-h-[44px] px-4 rounded-xl bg-shPrimary text-bgHeader text-[11px] font-black uppercase tracking-widest">School Home</button>
        <button onClick={onExit} className="min-h-[44px] px-4 rounded-xl border border-shBorder text-shText text-[11px] font-black uppercase tracking-widest">Back to Portal</button>
      </div>
    </div>
  );
}

/* Student School — the routed client area. Phase 2B: Home, My Course, Lesson,
 * Today's Training, Progress, Feedback, and contextual Ask Trainer are native.
 * Practice Coach is hosted here with full School context and returns to
 * /school/today without exposing generic Homework as a separate product. Progression/data all come
 * from the backend — no progression logic lives in this shell. */
export default function SchoolApp({ path, clientName, onNavigate, onExit }) {
  const parsed = parseSchoolPath(path);
  const [list, setList] = useState(null);          // enrollments; null = loading
  const [selectedId, setSelectedId] = useState(null);
  const [home, setHome] = useState(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [detail, setDetail] = useState(null);      // roadmap detail for the selected enrollment
  const [practice, setPractice] = useState(null);  // { homework } → PracticePanel hosted here
  const [practiceDone, setPracticeDone] = useState(false);
  const [askContext, setAskContext] = useState(null);
  const [quizFor, setQuizFor] = useState(null);    // { moduleId, checkpointPassed } → ModuleQuizPanel

  const loadList = useCallback(async () => {
    try { const { data } = await api.get("/portal/school"); setList(data || []); }
    catch { setList([]); }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  // Resolve selected enrollment: URL → sessionStorage → first active → first.
  useEffect(() => {
    if (!Array.isArray(list)) return;
    if (list.length === 0) { setSelectedId(null); return; }
    setSelectedId((cur) => {
      const has = (id) => id && list.some((e) => e.school_enrollment_id === id);
      if (has(parsed.enrollmentId) && parsed.enrollmentId !== cur) return parsed.enrollmentId;
      if (has(cur)) return cur;
      let stored = null; try { stored = sessionStorage.getItem(SELECTED_ENROLLMENT_KEY); } catch { /* ignore */ }
      if (has(stored)) return stored;
      const active = list.find((e) => e.status === "active" && e.access_state !== "revoked");
      return (active || list[0]).school_enrollment_id;
    });
  }, [list, parsed.enrollmentId]);

  useEffect(() => {
    if (selectedId) { try { sessionStorage.setItem(SELECTED_ENROLLMENT_KEY, selectedId); } catch { /* ignore */ } }
  }, [selectedId]);

  const loadHome = useCallback(async () => {
    if (!selectedId) return;
    try { const { data } = await api.get(`/portal/school/${selectedId}/home`); setHome(data); }
    catch { setHome(null); }
    finally { setHomeLoading(false); }
  }, [selectedId]);
  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    try { const { data } = await api.get(`/portal/school/${selectedId}`); setDetail(data); }
    catch { setDetail(null); }
  }, [selectedId]);

  useEffect(() => { setHomeLoading(true); setHome(null); setDetail(null); loadHome(); loadDetail(); }, [loadHome, loadDetail]);
  useLiveRefresh(loadHome, { intervalMs: 45000 });

  const refreshAll = useCallback(() => { loadHome(); loadDetail(); }, [loadHome, loadDetail]);

  const go = useCallback((view, lessonId) => {
    onNavigate(schoolPathFor(view, selectedId, lessonId));
  }, [onNavigate, selectedId]);

  const selectEnrollment = useCallback((id) => {
    setSelectedId(id);
    // Keep the current screen where it's enrollment-scoped; lesson routes
    // belong to the previous dog, so fall back to the new dog's course.
    if (parsed.view === "course" || parsed.view === "lesson") onNavigate(schoolPathFor("course", id));
    else onNavigate(schoolPathFor(parsed.view === "lesson" ? "course" : parsed.view, id));
  }, [onNavigate, parsed.view]);

  const selectedEntry = Array.isArray(list) ? list.find((e) => e.school_enrollment_id === selectedId) : null;

  // ── Practice Coach hosting (engine reused as-is, School context kept) ──
  const openHomework = useCallback(async (homeworkId) => {
    const { data: hw } = await api.get(`/homework/${homeworkId}`);
    setPractice({ homework: hw });
  }, []);

  const openPractice = useCallback(async (lessonId) => {
    setPracticeDone(false);
    try {
      const { data } = await api.post(`/portal/school/${selectedId}/lessons/${lessonId}/start-practice`);
      await openHomework(data.homework_id);
      refreshAll(); // Start-Practice completed the Learn step server-side
    } catch (e) {
      const msg = e.response?.data?.detail || "Couldn't start practice — try again.";
      window.alert(typeof msg === "string" ? msg : "Couldn't start practice — try again.");
    }
  }, [selectedId, refreshAll, openHomework]);

  const openPrescribedPractice = useCallback(async () => {
    setPracticeDone(false);
    try {
      const { data } = await api.post(`/portal/school/${selectedId}/remediation/start`);
      await openHomework(data.homework_id);
      refreshAll();
    } catch (e) {
      const msg = e.response?.data?.detail || "Couldn't open your trainer's practice plan — try again.";
      window.alert(typeof msg === "string" ? msg : "Couldn't open your trainer's practice plan — try again.");
    }
  }, [selectedId, refreshAll, openHomework]);

  const closePractice = useCallback(() => {
    setPractice(null);
    refreshAll();
    go("today");
  }, [refreshAll, go]);

  const practiceLogged = useCallback(() => {
    setPracticeDone(true);
    refreshAll();
  }, [refreshAll]);

  // Finish Practice must LEAD somewhere. After the panel's brief completion
  // transition, ask the backend what the client's next logical action is
  // (the SAME current_action ladder that drives Home/Today — practice /
  // checkpoint / quiz / advance / completed) and route there. Never a
  // frontend "current lesson + 1" guess, and never an auto-advance: an
  // "advance"-state lands on Today, whose primary CTA is the explicit
  // Continue action the progression state machine expects.
  const practiceCompleted = useCallback(async () => {
    setPractice(null);
    let act = null;
    try {
      const { data: freshHome } = await api.get(`/portal/school/${selectedId}/home`);
      setHome(freshHome);
      loadDetail();
      act = freshHome?.current_action || null;
    } catch { /* fall through to Today */ }
    const t = act?.type;
    const lessonId = act?.target?.lesson_id;
    if (t === "practice" && lessonId) { openPractice(lessonId); return; }
    if (t === "remediation") { openPrescribedPractice(); return; }
    if (t === "submit_checkpoint" && lessonId) { go("lesson", lessonId); return; }
    if (t === "module_quiz") {
      const moduleId = act?.target?.module_id;
      if (moduleId) { setQuizFor({ moduleId, checkpointPassed: false }); return; }
    }
    if (t === "course_complete") { go("progress"); return; }
    // advance / awaiting_review / everything else → Today's Training with the
    // completed state and the next step as its primary CTA.
    go("today");
  }, [selectedId, loadDetail, openPractice, openPrescribedPractice, go]);

  // ── One router for every school action (Home CTA, Today CTA) ──
  const runAction = useCallback(async (action) => {
    const t = action?.type;
    const lessonId = action?.target?.lesson_id || home?.current_lesson?.id;
    setPracticeDone(false);
    if (t === "practice" && lessonId) { openPractice(lessonId); return; }
    if (t === "remediation") { openPrescribedPractice(); return; }
    if ((t === "lesson" || t === "submit_checkpoint") && lessonId) { go("lesson", lessonId); return; }
    if (t === "module_quiz") {
      const moduleId = action?.target?.module_id || home?.current_module?.id || detail?.roadmap?.module_quiz?.module_id;
      if (moduleId) {
        setQuizFor({ moduleId, checkpointPassed: detail?.roadmap?.checkpoint_status?.outcome === "advance" });
        return;
      }
    }
    if (t === "advance") {
      // The existing advancement action — backend moves the pointer exactly
      // once (CAS-guarded); we just refresh and stay on Today for the new task.
      try { await api.post(`/portal/school/${selectedId}/advance`); } catch { /* backend gate holds */ }
      refreshAll(); go("today"); return;
    }
    if (t === "course_complete") { go("progress"); return; }
    if (t === "start") { go("course"); return; }
    if (t === "trainer_assist") { go("feedback"); return; }
    if (t === "trainer_guided") { go("course"); return; }
    if (t === "onboarding") { requestAnimationFrame(() => document.querySelector('[data-testid="school-onboarding"]')?.scrollIntoView({ behavior: "smooth", block: "start" })); return; }
    if (t === "course_paused") { go("home"); return; }
    go("today");
  }, [home, detail, go, openPractice, openPrescribedPractice, selectedId, refreshAll]);

  const goView = useCallback((view) => {
    setPracticeDone(false);
    go(view === "course" ? "course" : view);
  }, [go]);

  const openAsk = useCallback((extra = {}) => {
    const checkpoint = extra.checkpoint || null;
    const lessonPayload = extra.lesson?.lesson || extra.lesson || null;
    const lessonId = checkpoint?.lesson_id || extra.lessonId || lessonPayload?.id || home?.current_lesson?.id || null;
    setAskContext({
      school_enrollment_id: selectedId,
      dog_id: home?.dog?.id || selectedEntry?.dog_id || null,
      dog_name: home?.dog?.name || selectedEntry?.dog_name || null,
      school_program_name: home?.program?.name || selectedEntry?.program_name || null,
      school_module_id: lessonId === home?.current_lesson?.id ? home?.current_module?.id || null : null,
      school_module_name: checkpoint?.module_name || (lessonId === home?.current_lesson?.id ? home?.current_module?.name : null),
      school_lesson_id: lessonId,
      school_lesson_name: checkpoint?.lesson_name || lessonPayload?.name || (lessonId === home?.current_lesson?.id ? home?.current_lesson?.name : null),
      school_homework_id: extra.homeworkId || null,
      school_checkpoint_id: checkpoint?.id || extra.checkpointId || home?.checkpoint_status?.id || null,
    });
  }, [selectedId, home, selectedEntry]);



  const navigateFromNotification = useCallback((view, dl = {}) => {
    const targetId = dl.school_enrollment_id && Array.isArray(list) && list.some((e) => e.school_enrollment_id === dl.school_enrollment_id)
      ? dl.school_enrollment_id : selectedId;
    if (targetId && targetId !== selectedId) {
      setSelectedId(targetId);
      try { sessionStorage.setItem(SELECTED_ENROLLMENT_KEY, targetId); } catch { /* ignore */ }
    }
    const targetView = view || "feedback";
    if (targetView === "lesson" && dl.lesson_id && targetId) { onNavigate(schoolPathFor("lesson", targetId, dl.lesson_id)); return; }
    if (targetView === "course" && targetId) { onNavigate(schoolPathFor("course", targetId)); return; }
    onNavigate(schoolPathFor(targetView, targetId));
  }, [list, selectedId, onNavigate]);

  const header = (
    <header className="shrink-0 border-b border-shBorder flex items-center justify-between gap-2 px-3 sm:px-6 py-3" style={{ background: "var(--sh-card-base)" }}>
      <PremiumButton variant="secondary" onClick={onExit} data-testid="school-back-button">
        <i className="fas fa-arrow-left" /><span className="hidden sm:inline">Portal</span>
      </PremiumButton>
      <div className="flex items-center gap-2 text-shText font-black uppercase tracking-widest text-[13px]">
        <i className="fas fa-graduation-cap text-shPrimary" />School
      </div>
      <div className="flex items-center gap-2"><button type="button" onClick={()=>go("search")} aria-label="Search School" title="Search School" className="w-10 h-10 rounded-xl border border-shBorder text-shTextMuted hover:text-shSecondary"><i className="fas fa-search"/></button><SchoolNotificationBell onNavigate={navigateFromNotification} /><img src="/logo.png" alt="Sit Happens" className="h-8 sm:h-10 shrink-0" /></div>
    </header>
  );

  let body;
  if (list === null) {
    body = <div className="p-6"><StudentHome loading /></div>;
  } else if (list.length === 0) {
    body = (
      <div className="p-6 max-w-md mx-auto">
        <EmptyState icon="fa-graduation-cap" accent="lime" title="No School program yet"
                    description="When a Sit Happens training program is assigned to you, your in-person, online, or hybrid training home will appear here."
                    ctaLabel="Back to Portal" onClick={onExit} />
      </div>
    );
  } else {
    let screen;
    // A revoked enrollment keeps a safe School Home/history shell, but its
    // protected course/feedback/progress endpoints intentionally 403. Catch
    // that lifecycle state here so direct/refreshed School URLs never flash a
    // raw API error or empty screen.
    if (home?.current_action?.type === "access_expired" && parsed.view !== "home") {
      screen = <AccessEndedState onHome={() => go("home")} onExit={onExit} />;
    } else if (parsed.view === "course") {
      screen = (
        <CourseRoadmap detail={detail} loading={!detail}
                       onOpenLesson={(lid) => go("lesson", lid)}
                       onResume={() => home?.current_action ? runAction(home.current_action) : go("today")} />
      );
    } else if (parsed.view === "lesson" && parsed.lessonId) {
      screen = (
        <LessonScreen
          enrollmentId={selectedId} lessonId={parsed.lessonId} detail={detail}
          dogName={selectedEntry?.dog_name} dogPhoto={selectedEntry?.dog_photo}
          deliveryMode={selectedEntry?.delivery_mode}
          onStartPractice={openPractice}
          onStartPrescribedPractice={openPrescribedPractice}
          onAdvanced={() => { refreshAll(); go("today"); }}
          onStateChanged={(opts) => { refreshAll(); if (opts?.openLessonId) go("lesson", opts.openLessonId); }}
          onBackToCourse={() => go("course")}
          onAskTrainer={(ctx) => openAsk(ctx)}
          onTakeQuiz={(mid) => setQuizFor({
            moduleId: mid || detail?.roadmap?.module_quiz?.module_id,
            checkpointPassed: detail?.roadmap?.checkpoint_status?.outcome === "advance",
          })}
        />
      );
    } else if (parsed.view === "today") {
      screen = (
        <div className="space-y-4">
          <TodayScreen home={home} loading={homeLoading}
                       practiceJustCompleted={practiceDone} onAction={runAction}
                       onAskTrainer={() => openAsk()} />
          <StudentWorkspaceExtras enrollmentId={selectedId} home={home} mode="today" onChanged={refreshAll}
                                  onOpenLesson={(lid) => go("lesson", lid)} onOpenHomework={openHomework} />
        </div>
      );
    } else if (parsed.view === "feedback") {
      screen = <FeedbackScreen enrollmentId={selectedId} onAsk={openAsk} onChanged={refreshAll} />;
    } else if (parsed.view === "progress") {
      screen = <ProgressScreen enrollmentId={selectedId} home={home} detail={detail} onOpenHistory={() => go("lesson_history")} />;
    } else if (parsed.view === "lesson_history") {
      // Per-ATTEMPT training history. selectedId is this School enrollment,
      // so Repeat Program attempts never show each other's lessons.
      screen = <LessonHistoryScreen enrollmentId={selectedId} dogName={selectedEntry?.dog_name} />;
    } else if (parsed.view === "resources") {
      screen = <ResourcesScreen enrollmentId={selectedId} />;
    } else if (parsed.view === "search") {
      screen = <SearchScreen enrollmentId={selectedId} onOpenLesson={(lid)=>go("lesson",lid)} onFeedback={()=>go("feedback")} />;
    } else {
      screen = (
        <div className="space-y-4">
          <StudentHome
            home={home} loading={homeLoading} clientName={clientName}
            onPrimaryAction={() => runAction(home?.current_action)}
            onAsk={() => openAsk()}
            onViewFeedback={() => goView("feedback")}
            onViewProgress={() => goView("progress")}
            onViewCourse={() => goView("course")}
            onOpenPractice={(hw) => openHomework(hw?.id || hw)}
          />
          <StudentWorkspaceExtras enrollmentId={selectedId} home={home} mode="home" onChanged={refreshAll}
                                  onOpenLesson={(lid) => go("lesson", lid)} onOpenHomework={openHomework} />
        </div>
      );
    }
    body = (
      <div className="max-w-5xl mx-auto w-full px-3 sm:px-6 py-4 sm:py-6 pb-24 md:pb-6">
        {list.length > 1 && (
          <div className="mb-4 max-w-sm"><EnrollmentSelector enrollments={list} selectedId={selectedId} onSelect={selectEnrollment} /></div>
        )}
        <div className="flex gap-6 items-start">
          <SchoolNav active={parsed.view === "lesson" ? "course" : parsed.view} onNavigate={goView} />
          <div className="min-w-0 flex-1">{screen}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell h-full min-h-0 flex flex-col" style={{ background: "var(--sh-card-base)" }} data-testid="school-app">
      {header}
      <div className="app-scroll-root flex-1 min-h-0 overflow-y-auto overscroll-contain" data-scroll-root>
        {body}
      </div>

      {/* Practice Coach — the exact same engine, hosted with School context.
          onCompleted makes Finish Practice route to the backend-decided next
          step instead of stranding the client on the finished form. */}
      {practice && (
        <PracticePanel homework={practice.homework} dogPhoto={selectedEntry?.dog_photo}
                       onClose={closePractice} onChanged={refreshAll} onPracticeLogged={practiceLogged}
                       onCompleted={practiceCompleted} />
      )}

      {/* Module Quiz — server-graded; a passing submit already advanced the
          enrollment, so closing/continuing only refreshes and routes. */}
      {quizFor && (
        <ModuleQuizPanel
          enrollmentId={selectedId}
          moduleId={quizFor.moduleId}
          checkpointPassed={quizFor.checkpointPassed}
          onClose={() => { setQuizFor(null); refreshAll(); }}
          onAdvanced={() => { setQuizFor(null); refreshAll(); go("today"); }}
          onReviewLesson={(lid) => { setQuizFor(null); go("lesson", lid); }}
        />
      )}

      <AskTrainerPanel open={!!askContext} context={askContext}
                       onClose={() => setAskContext(null)}
                       onSent={() => { refreshAll(); }} />
    </div>
  );
}
