// Sit Happens Online School (Phase 1) — the client-facing dashboard. Opens
// as a full-screen overlay (same pattern as PracticePanel/
// HomeworkTemplateEditor) so the student lands somewhere focused, never a
// generic library. Reuses the EXACT SAME shared components the trainer-led
// Learn screen uses (ProgramRoadmap, LessonCard, LessonDetailPanel,
// EmptyState) and the EXACT SAME Practice Coach engine (PracticePanel) —
// Online School is a navigation/progression layer on top, never a fork.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Avatar from "./Avatar";
import ProgramRoadmap from "./training/ProgramRoadmap";
import LessonCard from "./training/LessonCard";
import LessonDetailPanel from "./training/LessonDetailPanel";
import EmptyState from "./training/EmptyState";
import PracticePanel from "./training/PracticePanel";
import {
  buildSchoolRoadmap, buildSchoolLessonCards, nextActionLabel, canAdvance,
  practiceButtonLabel, continueButtonLabel, formatCompletionPct,
} from "../lib/onlineSchoolPolish";

export default function OnlineSchoolDashboard({ clientFirstName, onClose }) {
  const [list, setList] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLesson, setDetailLesson] = useState(null);
  const [practiceHomework, setPracticeHomework] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [finishedMsg, setFinishedMsg] = useState("");

  useEffect(() => { loadList(); }, []);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId]);

  const loadList = async () => {
    try {
      const { data } = await api.get("/portal/school");
      setList(data);
      if (data.length > 0) setActiveId(id => id || data[0].school_enrollment_id);
    } catch { setList([]); }
  };

  const loadDetail = async (id) => {
    try {
      const { data } = await api.get(`/portal/school/${id}`);
      setDetail(data);
    } catch { setDetail(null); }
  };

  const openLesson = async (lessonId) => {
    setErr("");
    try {
      const { data } = await api.get(`/portal/school/${activeId}/lessons/${lessonId}`);
      setDetailLesson(data);
    } catch (e) {
      setErr(e.response?.data?.detail || "This lesson isn't available yet.");
    }
  };

  const startPractice = async (lessonId) => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/portal/school/${activeId}/lessons/${lessonId}/start-practice`);
      const { data: hw } = await api.get(`/homework/${data.homework_id}`);
      setPracticeHomework(hw);
      setDetailLesson(null);
    } catch (e) {
      setErr(e.response?.data?.detail || "Couldn't start practice.");
    } finally { setBusy(false); }
  };

  const onPracticeClosed = () => {
    setPracticeHomework(null);
    loadDetail(activeId);
  };

  const advance = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/portal/school/${activeId}/advance`);
      if (data.finished) {
        setFinishedMsg("Program complete! Great work.");
        loadList();
      } else {
        await loadDetail(activeId);
        setDetailLesson(null);
      }
    } catch (e) {
      setErr(e.response?.data?.detail || "Couldn't continue — try practicing the current lesson first.");
    } finally { setBusy(false); }
  };

  if (!list) return null;
  if (list.length === 0) {
    return (
      <Overlay onClose={onClose} testid="online-school-dashboard">
        <EmptyState icon="fa-graduation-cap" message="No Online School enrollment yet." testid="online-school-empty"/>
      </Overlay>
    );
  }

  const entry = list.find(d => d.school_enrollment_id === activeId) || list[0];
  const roadmap = detail?.roadmap;
  const roadmapModules = roadmap ? buildSchoolRoadmap(roadmap) : [];
  // Hero prefers the freshly-loaded detail (refreshed after every advance)
  // over the list entry, which only refreshes on a full reload — otherwise
  // the hero's "Next Up"/% complete would visibly lag one step behind the
  // roadmap immediately below it after a client advances.
  const heroMasteredPct = detail ? detail.mastered_pct : entry.mastered_pct;
  const heroCurrentLessonName = roadmap ? (roadmap.current_lesson?.name || null) : entry.current_lesson_name;

  return (
    <Overlay onClose={onClose} testid="online-school-dashboard">
      {list.length > 1 && (
        <div className="flex gap-1.5 mb-3 flex-wrap" data-testid="school-dog-selector">
          {list.map(d => (
            <button key={d.school_enrollment_id} onClick={() => setActiveId(d.school_enrollment_id)}
                    data-testid={`school-dog-${d.school_enrollment_id}`}
                    className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full border ${d.school_enrollment_id === activeId ? "bg-shPrimary/15 border-shPrimary text-shPrimary" : "border-shBorder text-shTextMuted"}`}>
              {d.dog_name}
            </button>
          ))}
        </div>
      )}

      {/* Hero — "what am I working on / what do I do next / how far have I
          gotten / do I need my trainer" answered above the fold. */}
      <div className="relative overflow-hidden bg-gradient-to-br from-shBlue/15 via-bgPanel to-shPrimary/10 border border-shBorder rounded-2xl p-5 mb-4 shadow-xl" data-testid="school-hero">
        <div className="flex items-center gap-3 mb-3">
          <Avatar src={entry.dog_photo} icon="fa-paw" size="lg" alt={entry.dog_name}/>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-0.5">
              <i className="fas fa-graduation-cap mr-1.5"/>Welcome back{clientFirstName ? `, ${clientFirstName}` : ""} + {entry.dog_name}
            </p>
            <h2 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight truncate">{entry.program_name}</h2>
            <p className="text-[13px] font-bold text-shPrimary">{formatCompletionPct(heroMasteredPct)}</p>
          </div>
        </div>
        {heroCurrentLessonName && (
          <div className="bg-black/25 border border-shBorder rounded-xl p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1">Next Up</p>
            <p className="text-[15px] font-black text-shText mb-3">{heroCurrentLessonName}</p>
            <button onClick={() => roadmap?.current_lesson && openLesson(roadmap.current_lesson.id)}
                    data-testid="school-continue-training" disabled={busy}
                    className="w-full bg-shPrimary text-bgHeader py-3 rounded-xl font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
              <i className="fas fa-play mr-2"/>{roadmap ? continueButtonLabel(roadmap) : "Continue Training"}
            </button>
          </div>
        )}
      </div>

      {finishedMsg && (
        <div className="bg-shPrimary/10 border border-shPrimary/40 rounded-xl p-4 mb-4 text-center" data-testid="school-finished-banner">
          <i className="fas fa-flag-checkered text-shPrimary text-2xl mb-1"/>
          <p className="text-shPrimary font-black uppercase tracking-widest">{finishedMsg}</p>
        </div>
      )}

      {err && <p className="text-shDanger text-[13px] font-bold mb-3" data-testid="school-error">{err}</p>}

      {/* Roadmap */}
      <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shTextMuted mb-2">
        <i className="fas fa-route mr-1.5"/>{entry.program_name}
      </p>
      <ProgramRoadmap
        modules={roadmapModules}
        testid="school-roadmap"
        renderModuleBody={(m) => {
          if (m.status === "locked") {
            return <EmptyState icon="fa-lock" message={m.lockedReason} testid="school-roadmap-locked"/>;
          }
          const cards = buildSchoolLessonCards(m);
          if (cards.length === 0) return <EmptyState icon="fa-book-open" message="No lessons in this module yet." testid={`school-module-${m.id}-empty`}/>;
          return (
            <div className="space-y-2">
              {cards.map(card => (
                <LessonCard
                  key={card.id}
                  name={card.name} overview={card.overview} estimatedMinutes={card.estimatedMinutes}
                  status={card.status} hasVideo={card.hasVideo}
                  lockedReason={card.status === "locked" ? card.lockedReason : null}
                  actionLabel={card.status !== "locked" ? (card.isCurrent ? "Open" : "Review") : null}
                  onAction={card.status !== "locked" ? () => openLesson(card.id) : undefined}
                  testid={`school-lesson-${card.id}`}
                />
              ))}
            </div>
          );
        }}
      />

      {/* Lesson detail */}
      {detailLesson && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-2 sm:p-4" onClick={() => setDetailLesson(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
            <div className="px-5 py-4 border-b border-shBorder flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">{detailLesson.module_name}</p>
                <h3 className="text-base font-black text-shText uppercase tracking-tight truncate">{detailLesson.lesson.name}</h3>
              </div>
              <button onClick={() => setDetailLesson(null)} data-testid="school-lesson-detail-close" className="text-shTextMuted hover:text-shText text-xl px-2 shrink-0"><i className="fas fa-times"/></button>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-3">
              <LessonDetailPanel lesson={detailLesson.lesson} testid="school-lesson-detail"/>

              {detailLesson.skills.length > 0 && (
                <div className="bg-shSecondary/5 border border-shSecondary/30 rounded-lg p-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary mb-1.5"><i className="fas fa-star mr-1.5"/>Skill</p>
                  {detailLesson.skills.map(s => (
                    <p key={s.id} className="text-[13px] text-shText">{s.name}{s.client_facing_explanation ? ` — ${s.client_facing_explanation}` : ""}</p>
                  ))}
                </div>
              )}

              {detailLesson.has_practice_recipe ? (
                <button onClick={() => startPractice(detailLesson.lesson.id)} disabled={busy}
                        data-testid="school-start-practice"
                        className="w-full bg-shPrimary text-bgHeader py-3 rounded-xl font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
                  <i className="fas fa-paw mr-2"/>{practiceButtonLabel(detailLesson.practiced)}
                </button>
              ) : (
                <EmptyState icon="fa-circle-info" message="Practice for this lesson isn't set up yet — check back soon." testid="school-no-practice"/>
              )}

              {detailLesson.is_current && detailLesson.practiced && (
                <button onClick={advance} disabled={busy} data-testid="school-advance"
                        className="w-full bg-shSecondary text-bgHeader py-2.5 rounded-xl font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
                  <i className="fas fa-arrow-right mr-2"/>Continue
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Practice Coach — the exact same PracticePanel used everywhere else
          in the app. Online School never forks the practice engine. */}
      {practiceHomework && (
        <PracticePanel homework={practiceHomework} dogPhoto={entry.dog_photo}
                        onClose={onPracticeClosed} onChanged={onPracticeClosed}/>
      )}
    </Overlay>
  );
}

function Overlay({ children, onClose, testid }) {
  return (
    <div className="fixed inset-0 bg-black/85 z-50 overflow-y-auto" data-testid={testid}>
      <div className="min-h-full flex items-start justify-center p-3 sm:p-6">
        <div className="w-full max-w-2xl bg-bgPanel border border-shBorder rounded-2xl shadow-2xl">
          <div className="sticky top-0 bg-bgPanel border-b border-shBorder px-4 py-3 flex items-center justify-between rounded-t-2xl z-10">
            <p className="text-[13px] font-black uppercase tracking-[0.3em] text-shPrimary"><i className="fas fa-graduation-cap mr-1.5"/>Sit Happens Online School</p>
            <button onClick={onClose} data-testid="online-school-close" className="text-shTextMuted hover:text-shText text-xl px-2"><i className="fas fa-times"/></button>
          </div>
          <div className="p-4 sm:p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
