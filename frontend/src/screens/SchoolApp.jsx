import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import PremiumButton from "../components/premium/PremiumButton";
import EmptyState from "../components/premium/EmptyState";
import SchoolNav from "../components/school/student/SchoolNav";
import EnrollmentSelector from "../components/school/student/EnrollmentSelector";
import StudentHome from "../components/school/student/StudentHome";
import OnlineSchoolDashboard from "../components/OnlineSchoolDashboard";
import { parseSchoolPath, schoolPathFor, SELECTED_ENROLLMENT_KEY } from "../lib/studentSchool";

/* Student School — the routed client area (Phase 2A). Real /school* URLs via the
 * app's history.pushState convention (no react-router). Home is the new
 * command center; the other nav destinations + the primary CTA open the
 * existing, working School experience (OnlineSchoolDashboard) as a bridge until
 * 2B/2C replace those screens with routed components. Progression/data all come
 * from the backend view-model — no progression logic lives here. */
export default function SchoolApp({ path, clientName, onNavigate, onExit }) {
  const parsed = parseSchoolPath(path);
  const [list, setList] = useState(null);          // enrollments; null = loading
  const [selectedId, setSelectedId] = useState(null);
  const [home, setHome] = useState(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [legacy, setLegacy] = useState(null);      // { view } → open existing overlay, or null

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
      if (has(cur)) return cur;
      if (has(parsed.enrollmentId)) return parsed.enrollmentId;
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
  useEffect(() => { setHomeLoading(true); setHome(null); loadHome(); }, [loadHome]);
  useLiveRefresh(loadHome, { intervalMs: 45000 });

  const selectEnrollment = useCallback((id) => {
    setSelectedId(id);
    onNavigate(schoolPathFor("home"));
  }, [onNavigate]);

  // Deeper views bridge to the existing School experience for 2A.
  const goView = useCallback((view) => {
    if (view === "home") { setLegacy(null); onNavigate(schoolPathFor("home")); return; }
    onNavigate(view === "course" ? schoolPathFor("course", selectedId) : schoolPathFor(view));
    const map = { course: "journey", today: "home", progress: "journey", feedback: "feedback" };
    setLegacy({ view: map[view] || "home" });
  }, [onNavigate, selectedId]);

  const openPrimary = useCallback(() => {
    const t = home?.current_action?.type;
    setLegacy({ view: (t === "trainer_assist" || t === "awaiting_review") ? "feedback" : "home" });
  }, [home]);

  const closeLegacy = useCallback(() => {
    setLegacy(null);
    onNavigate(schoolPathFor("home"));
    loadList(); loadHome();
  }, [onNavigate, loadList, loadHome]);

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
    body = (
      <div className="max-w-5xl mx-auto w-full px-3 sm:px-6 py-4 sm:py-6 pb-24 md:pb-6">
        {list.length > 1 && (
          <div className="mb-4 max-w-sm"><EnrollmentSelector enrollments={list} selectedId={selectedId} onSelect={selectEnrollment} /></div>
        )}
        <div className="flex gap-6 items-start">
          <SchoolNav active={parsed.view} onNavigate={goView} />
          <div className="min-w-0 flex-1">
            <StudentHome
              home={home}
              loading={homeLoading}
              clientName={clientName}
              onPrimaryAction={openPrimary}
              onAsk={() => setLegacy({ view: "help" })}
              onViewFeedback={() => goView("feedback")}
              onViewProgress={() => goView("progress")}
            />
          </div>
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
