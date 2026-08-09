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
import OnlineSchoolDashboard from "../components/OnlineSchoolDashboard";
import { parseSchoolPath, schoolPathFor, SELECTED_ENROLLMENT_KEY } from "../lib/studentSchool";

/* Student School — the routed client area. Phase 2B: Home, My Course, Lesson,
 * and Today's Training are native screens; Practice Coach is hosted here with
 * full School context and returns to /school/today on completion. The legacy
 * OnlineSchoolDashboard remains ONLY as the bridge for the Phase-2C routes
 * (Progress, Feedback). Progression/data all come from the backend — no
 * progression logic lives in this shell. */
export default function SchoolApp({ path, clientName, onNavigate, onExit }) {
  const parsed = parseSchoolPath(path);
  const [list, setList] = useState(null);          // enrollments; null = loading
  const [selectedId, setSelectedId] = useState(null);
  const [home, setHome] = useState(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [detail, setDetail] = useState(null);      // roadmap detail for the selected enrollment
  const [practice, setPractice] = useState(null);  // { homework } → PracticePanel hosted here
  const [practiceDone, setPracticeDone] = useState(false);
  const [legacy, setLegacy] = useState(null);      // 2C bridge only: { view }

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

  // ── Practice Coach hosting (engine reused as-is, School context kept) ──
  const openPractice = useCallback(async (lessonId) => {
    try {
      const { data } = await api.post(`/portal/school/${selectedId}/lessons/${lessonId}/start-practice`);
      const { data: hw } = await api.get(`/homework/${data.homework_id}`);
      setPractice({ homework: hw });
      refreshAll(); // Start-Practice completed the Learn step server-side
    } catch (e) {
      const msg = e.response?.data?.detail || "Couldn't start practice — try again.";
      window.alert(typeof msg === "string" ? msg : "Couldn't start practice — try again.");
    }
  }, [selectedId, refreshAll]);

  const closePractice = useCallback(() => {
    setPractice(null);
    setPracticeDone(true);
    refreshAll();
    go("today");
  }, [refreshAll, go]);

  // ── One router for every school action (Home CTA, Today CTA) ──
  const runAction = useCallback(async (action) => {
    const t = action?.type;
    const lessonId = action?.target?.lesson_id || home?.current_lesson?.id;
    setPracticeDone(false);
    if (t === "practice" && lessonId) { openPractice(lessonId); return; }
    if ((t === "lesson" || t === "submit_checkpoint" || t === "remediation") && lessonId) { go("lesson", lessonId); return; }
    if (t === "advance") {
      // The existing advancement action — backend moves the pointer exactly
      // once (CAS-guarded); we just refresh and stay on Today for the new task.
      try { await api.post(`/portal/school/${selectedId}/advance`); } catch { /* backend gate holds */ }
      refreshAll(); go("today"); return;
    }
    if (t === "course_complete" || t === "start") { go("course"); return; }
    if (t === "trainer_assist") { setLegacy({ view: "feedback" }); go("feedback"); return; }
    go("today");
  }, [home, go, openPractice, selectedId, refreshAll]);

  // 2C bridge — Progress & Feedback only.
  const goView = useCallback((view) => {
    setPracticeDone(false);
    if (view === "progress" || view === "feedback") {
      onNavigate(schoolPathFor(view));
      setLegacy({ view: view === "progress" ? "journey" : "feedback" });
      return;
    }
    setLegacy(null);
    go(view === "course" ? "course" : view);
  }, [go, onNavigate]);

  const closeLegacy = useCallback(() => {
    setLegacy(null);
    onNavigate(schoolPathFor("home"));
    loadList(); refreshAll();
  }, [onNavigate, loadList, refreshAll]);

  const selectedEntry = Array.isArray(list) ? list.find((e) => e.school_enrollment_id === selectedId) : null;

  const header = (
    <header className="shrink-0 border-b border-shBorder flex items-center justify-between gap-2 px-3 sm:px-6 py-3" style={{ background: "var(--sh-card-base)" }}>
      <PremiumButton variant="secondary" onClick={onExit} data-testid="school-back-button">
        <i className="fas fa-arrow-left" /><span className="hidden sm:inline">Portal</span>
      </PremiumButton>
      <div className="flex items-center gap-2 text-shText font-black uppercase tracking-widest text-[13px]">
        <i className="fas fa-graduation-cap text-shPrimary" />School
      </div>
      <img src="/logo.png" alt="Sit Happens" className="h-8 sm:h-10 shrink-0" />
    </header>
  );

  let body;
  if (list === null) {
    body = <div className="p-6"><StudentHome loading /></div>;
  } else if (list.length === 0) {
    body = (
      <div className="p-6 max-w-md mx-auto">
        <EmptyState icon="fa-graduation-cap" accent="lime" title="No active course yet"
                    description="When you enroll in a Sit Happens Online School course, your training home will appear here."
                    ctaLabel="Back to Portal" onClick={onExit} />
      </div>
    );
  } else {
    let screen;
    if (parsed.view === "course") {
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
          onStartPractice={openPractice}
          onAdvanced={() => { refreshAll(); go("today"); }}
          onStateChanged={(opts) => { refreshAll(); if (opts?.openLessonId) go("lesson", opts.openLessonId); }}
          onBackToCourse={() => go("course")}
        />
      );
    } else if (parsed.view === "today") {
      screen = (
        <TodayScreen home={home} loading={homeLoading}
                     practiceJustCompleted={practiceDone} onAction={runAction} />
      );
    } else {
      screen = (
        <StudentHome
          home={home} loading={homeLoading} clientName={clientName}
          onPrimaryAction={() => runAction(home?.current_action)}
          onAsk={() => setLegacy({ view: "help" })}
          onViewFeedback={() => goView("feedback")}
          onViewProgress={() => goView("progress")}
        />
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

      {/* Practice Coach — the exact same engine, hosted with School context. */}
      {practice && (
        <PracticePanel homework={practice.homework} dogPhoto={selectedEntry?.dog_photo}
                       onClose={closePractice} onChanged={closePractice} />
      )}

      {/* Legacy bridge — Phase 2C routes only (Progress / Feedback / Help). */}
      {legacy && (
        <OnlineSchoolDashboard
          clientFirstName={clientName}
          initialActiveId={selectedId}
          initialView={legacy.view}
          onClose={closeLegacy}
          onContactTrainer={() => setLegacy({ view: "help" })}
        />
      )}
    </div>
  );
}
