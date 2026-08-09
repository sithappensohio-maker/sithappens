// Sit Happens Online School — the client-facing dashboard. Opens as a
// full-screen overlay (same pattern as PracticePanel/HomeworkTemplateEditor)
// so the student lands somewhere focused, never a generic library. Reuses
// the EXACT SAME shared components the trainer-led Learn/Progress screens
// use (ProgramRoadmap, LessonCard, LessonDetailPanel, EmptyState,
// StatusChip, AchievementCard, SkillLevelIndicator) and the EXACT SAME
// Practice Coach engine (PracticePanel) — Online School is a
// navigation/progression layer on top, never a fork.
//
// Phase 3 — Student Journey & Support. Internal tab nav (Home/My Journey/
// Trainer Feedback/Achievements/Help) inside this SAME overlay; Portal.jsx
// itself is unchanged. Practice Coach and the trainer checkpoint grading
// engine (CheckpointReviewQueue) are untouched.
//
// Visual polish pass — presentation only, every function below still calls
// the exact same endpoints/state it always did. Color language: lime =
// primary action/completion, cyan = current lesson/info, orange =
// checkpoint/attention/trainer review, purple = Trainer Assist/special
// support, gray = locked/inactive.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import Avatar from "./Avatar";
import ProgramRoadmap from "./training/ProgramRoadmap";
import LessonCard from "./training/LessonCard";
import LessonDetailPanel from "./training/LessonDetailPanel";
import EmptyState from "./training/EmptyState";
import PracticePanel from "./training/PracticePanel";
import CheckpointPanel from "./school/student/CheckpointPanel";
import StatusChip from "./training/StatusChip";
import AchievementCard from "./training/AchievementCard";
import SkillLevelIndicator from "./training/SkillLevelIndicator";
import NeonEdge from "./premium/NeonEdge";
import PremiumButton from "./premium/PremiumButton";
import SectionCard from "./premium/SectionCard";
import HuskyDogImage from "./brand/HuskyDogImage";
import { printSchoolCertificate } from "../lib/schoolCertificate";
import {
  buildSchoolRoadmap, buildSchoolLessonCards, practiceButtonLabel, continueButtonLabel,
  formatCompletionPct, trainerStatusLabel, recentFeedbackFromHistory, groupSkillsByModule,
} from "../lib/onlineSchoolPolish";

const NAV_TABS = [
  { key: "home", label: "Home", icon: "fa-house" },
  { key: "journey", label: "My Journey", icon: "fa-route" },
  { key: "feedback", label: "Trainer Feedback", icon: "fa-comment-dots" },
  { key: "achievements", label: "Achievements", icon: "fa-trophy" },
  { key: "help", label: "Help", icon: "fa-life-ring" },
];

const STUCK_REASONS = [
  { key: "wont_do", label: "Dog won't do the exercise", icon: "fa-ban" },
  { key: "stopped", label: "Was working, now stopped", icon: "fa-circle-pause" },
  { key: "distracted", label: "Too distracted", icon: "fa-eye" },
  { key: "confused", label: "Instructions are unclear", icon: "fa-circle-question" },
  { key: "worried", label: "Something concerns me", icon: "fa-triangle-exclamation" },
  { key: "need_trainer", label: "I need my trainer", icon: "fa-user-check" },
];

const STUCK_TIPS = {
  wont_do: "Shorten the session and lower the difficulty — fewer distractions, easier distance, or a higher-value treat can make the very next rep winnable.",
  stopped: "A dog who stops mid-session is often full, tired, or over-threshold. End on the last thing that worked and try again later.",
  distracted: "Move somewhere quieter for a few reps to rebuild momentum, then reintroduce distraction gradually.",
  confused: "Re-read the lesson's \"How To Do It\" steps below — if it's still unclear, your trainer can walk through it with you.",
  worried: "Trust your read of your dog. This is exactly the kind of thing to flag to your trainer rather than push through.",
  need_trainer: "That's what they're here for — send a message and they'll follow up.",
};

export default function OnlineSchoolDashboard({ clientFirstName, onClose, onContactTrainer, initialActiveId = null, initialView = "home" }) {
  const [list, setList] = useState(null);
  const [activeId, setActiveId] = useState(initialActiveId);
  const [detail, setDetail] = useState(null);
  const [detailLesson, setDetailLesson] = useState(null);
  const [practiceHomework, setPracticeHomework] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [finishedMsg, setFinishedMsg] = useState("");
  const [schoolView, setSchoolView] = useState(initialView || "home");
  const [history, setHistory] = useState(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [trophies, setTrophies] = useState(null);
  const [stuckReason, setStuckReason] = useState(null);

  useEffect(() => { loadList(); }, []);
  useEffect(() => { if (activeId) { loadDetail(activeId); loadHistory(activeId); } }, [activeId]);
  useEffect(() => { if (schoolView === "achievements" && trophies === null) loadTrophies(); }, [schoolView]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadList = async () => {
    try {
      const { data } = await api.get("/portal/school");
      setList(data);
      // Phase 6 (6.12) — the server already returns this list ordered
      // active-and-accessible first (see portal_school_list's _rank), but
      // pick explicitly rather than trust position alone: with one
      // completed, one withdrawn, and one active course, "Continue
      // Training" must always land on the active one, deterministically.
      if (data.length > 0) {
        setActiveId(id => {
          if (id && data.some(e => e.school_enrollment_id === id)) return id;
          const current = data.find(e => e.status === "active" && e.access_state !== "revoked");
          return (current || data[0]).school_enrollment_id;
        });
      }
    } catch { setList([]); }
  };

  const loadDetail = async (id) => {
    try {
      const { data } = await api.get(`/portal/school/${id}`);
      setDetail(data);
    } catch { setDetail(null); }
  };

  const loadHistory = async (id) => {
    try {
      const { data } = await api.get(`/portal/school/${id}/checkpoint-history`);
      setHistory(data);
    } catch { setHistory([]); }
  };

  const loadTrophies = async () => {
    try {
      const { data } = await api.get("/portal/trophies");
      setTrophies(data);
    } catch { setTrophies({ dog_trophies: [] }); }
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

  const submitCheckpoint = async (lessonId, video, filename, note) => {
    setBusy(true); setErr("");
    try {
      await api.post(`/portal/school/${activeId}/lessons/${lessonId}/checkpoint`, { video, filename, note });
      await loadDetail(activeId);
    } catch (e) {
      setErr(e.response?.data?.detail || "Couldn't submit checkpoint.");
    } finally { setBusy(false); }
  };

  const advance = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/portal/school/${activeId}/advance`);
      if (data.finished) {
        setFinishedMsg("Program complete! Great work.");
        loadList();
        loadDetail(activeId);
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
  const isCompleted = (detail ? detail.status : entry.status) === "completed";
  const recentFeedback = recentFeedbackFromHistory(history);
  const trainerStatus = roadmap ? trainerStatusLabel(roadmap) : null;
  const dogTrophies = (trophies?.dog_trophies || []).filter(t => t.recipient_id === entry.dog_id);

  return (
    <Overlay onClose={onClose} testid="online-school-dashboard">
      <div className="mb-4 sm:mb-5 rounded-2xl border border-shBorder/55 bg-black/15 p-2.5 sm:p-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-4">
          <DogSwitcher list={list} activeId={activeId} onSelect={setActiveId}/>
          <div className="flex gap-1 overflow-x-auto min-w-0 w-full lg:w-auto max-w-full p-1 rounded-xl bg-black/25 border border-shBorder/50 snap-x" data-testid="school-nav-tabs">
            {NAV_TABS.map(t => (
              <button key={t.key} onClick={() => setSchoolView(t.key)} data-testid={`school-nav-${t.key}`}
                      className={`shrink-0 snap-start flex items-center gap-2 px-3.5 py-2.5 sm:py-2 rounded-lg text-[11px] sm:text-[12px] font-black transition ${schoolView === t.key ? "bg-shPrimary text-bgHeader shadow-[0_6px_18px_-9px_rgba(140,198,63,0.8)]" : "text-shTextMuted hover:text-shText hover:bg-white/[0.04]"}`}>
                <i className={`fas ${t.icon} text-[11px]`}/>{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {finishedMsg && (
        <div className="bg-shPrimary/10 border border-shPrimary/40 rounded-xl p-4 mb-4 text-center" data-testid="school-finished-banner">
          <i className="fas fa-flag-checkered text-shPrimary text-2xl mb-1"/>
          <p className="text-shPrimary font-black">{finishedMsg}</p>
        </div>
      )}

      {err && <p className="text-shDanger text-[13px] font-bold mb-3" data-testid="school-error">{err}</p>}

      {schoolView === "home" && (
        entry.access_state === "revoked" ? (
          // Phase 6 (6.5) — access revoked: no protected content at all,
          // but the client still sees THAT the course exists rather than
          // it silently vanishing (matches portal_school_detail's own
          // graceful-degrade: roadmap is null, everything else stays).
          <EmptyState icon="fa-lock" message="Access to this course has been revoked. Contact us if you believe this is a mistake." testid="online-school-access-revoked"/>
        ) : isCompleted ? (
          <GraduationView
            dogName={entry.dog_name} dogPhoto={entry.dog_photo} programName={entry.program_name}
            completionSummary={detail?.completion_summary}
            onViewFeedback={() => setSchoolView("feedback")}
            onViewAchievements={() => setSchoolView("achievements")}
          />
        ) : (
          <>
            {entry.status === "withdrawn" && (
              // Phase 6 (6.5) — withdrawn + access still active: read-only
              // historical browsing stays available (My Journey/Trainer
              // Feedback tabs), but no new progression — the server itself
              // 403s start-practice/checkpoint/advance for a withdrawn
              // enrollment regardless of what the UI shows here.
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 text-center" data-testid="school-withdrawn-banner">
                <p className="text-amber-400 font-black text-sm"><i className="fas fa-circle-info mr-1.5"/>This enrollment was withdrawn. You can still browse past lessons and feedback, but training progress has stopped.</p>
              </div>
            )}
            <HomeView
              entry={entry} roadmap={roadmap} clientFirstName={clientFirstName}
              heroMasteredPct={heroMasteredPct} heroCurrentLessonName={heroCurrentLessonName}
              trainerStatus={trainerStatus} recentFeedback={recentFeedback} busy={busy}
              onContinue={() => entry.status !== "withdrawn" && roadmap?.current_lesson && openLesson(roadmap.current_lesson.id)}
              onViewFeedback={() => { setSchoolView("feedback"); setExpandedHistoryId(recentFeedback?.id || null); }}
            />
          </>
        )
      )}

      {schoolView === "journey" && (
        <div className="space-y-4">
          <NeonEdge accentRgb="0,169,224" intensity="subtle" className="p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shSecondary mb-1">My Journey</p>
                <h2 className="sh-display text-2xl sm:text-3xl text-white leading-none">{entry.program_name}</h2>
                <p className="text-[12px] text-shTextMuted mt-2">Follow the path, practice the current lesson, and unlock the next step when you're ready.</p>
              </div>
              <div className="sm:w-52">
                <div className="flex items-center justify-between text-[10px] font-bold text-shTextMuted mb-1.5"><span>Course progress</span><span className="text-shPrimary">{Math.round(Math.max(0, Math.min(100, heroMasteredPct || 0)))}%</span></div>
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-shSecondary to-shPrimary" style={{ width: `${Math.max(0, Math.min(100, heroMasteredPct || 0))}%` }}/></div>
              </div>
            </div>
          </NeonEdge>
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
                <div>
                  {cards.map((card, i) => {
                    // The client-safe roadmap only carries checkpoint config
                    // for the CURRENT lesson (server.py's _client_safe_lesson
                    // strips it elsewhere) — badge only where that's honestly
                    // known, never guessed for other lessons.
                    const isCheckpoint = card.isCurrent && !!roadmap?.requires_checkpoint;
                    const isFinal = isCheckpoint && roadmap?.checkpoint_rubric?.assessment_type === "final_assessment";
                    return (
                      <div key={card.id} className="flex gap-3">
                        <div className="flex flex-col items-center w-4 shrink-0">
                          <span className={`w-2.5 h-2.5 rounded-full mt-4 shrink-0 ${
                            card.status === "completed" ? "bg-shPrimary" : card.status === "current" ? "bg-shBlue" : card.status === "locked" ? "bg-shBorder" : "bg-shTextMuted/50"
                          }`}/>
                          {i < cards.length - 1 && <span className="w-px flex-1 bg-shBorder/60 my-0.5"/>}
                        </div>
                        <div className={`flex-1 min-w-0 pb-3 ${card.isCurrent ? "rounded-xl ring-2 ring-shBlue/40" : ""}`}>
                          {isCheckpoint && (
                            <div className="flex mb-1">
                              <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isFinal ? "bg-shAccent/15 text-shAccent" : "bg-shAccent/10 text-shAccent/80"}`}>
                                <i className="fas fa-video mr-1"/>{isFinal ? "Final Assessment" : "Trainer Checkpoint"}
                              </span>
                            </div>
                          )}
                          <LessonCard
                            name={card.name} overview={card.overview} estimatedMinutes={card.estimatedMinutes}
                            status={card.status} hasVideo={card.hasVideo}
                            lockedReason={card.status === "locked" ? card.lockedReason : null}
                            actionLabel={card.status !== "locked" ? (card.isCurrent ? "Open" : "Review") : null}
                            onAction={card.status !== "locked" ? () => openLesson(card.id) : undefined}
                            testid={`school-lesson-${card.id}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
        </div>
      )}

      {schoolView === "feedback" && (
        <TrainerFeedbackHistory history={history} expandedId={expandedHistoryId} onToggle={(id) => setExpandedHistoryId(cur => cur === id ? null : id)}/>
      )}

      {schoolView === "achievements" && (
        <div data-testid="school-achievements" className="space-y-4">
          <NeonEdge accentRgb="242,101,34" intensity="subtle" className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center"><i className="fas fa-trophy text-shAccent text-lg"/></div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shAccent">Training milestones</p>
                <h3 className="sh-display text-2xl sm:text-3xl text-white leading-none mt-1">Achievements</h3>
                <p className="text-[12px] text-shTextMuted mt-2">Real wins earned through the work you and {entry.dog_name} have put in.</p>
              </div>
            </div>
          </NeonEdge>
          {dogTrophies.length === 0 ? (
            <EmptyState icon="fa-trophy" message="No achievements yet — they'll show up here as training milestones are reached." testid="school-achievements-empty"/>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {dogTrophies.map(t => (
                <AchievementCard key={t.id} icon={t.trophy_icon} name={t.trophy_name} date={t.awarded_at}
                                 description={t.trophy_description} testid={`school-achievement-${t.id}`}/>
              ))}
            </div>
          )}
        </div>
      )}

      {schoolView === "help" && (
        <HelpView
          stuckReason={stuckReason} onSelectReason={setStuckReason}
          hasCurrentLesson={!!roadmap?.current_lesson}
          onOpenCurrentLesson={() => roadmap?.current_lesson && openLesson(roadmap.current_lesson.id)}
          onContactTrainer={onContactTrainer}
        />
      )}

      {/* Lesson detail */}
      {detailLesson && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center sm:p-4 lg:p-6" onClick={() => setDetailLesson(null)}>
          <div onClick={(e) => e.stopPropagation()} className="relative bg-[var(--sh-card-base)] border border-shBorder/70 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0 shadow-[0_30px_100px_rgba(0,0,0,0.72)] overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-50" style={{ background: "radial-gradient(circle at 12% 0%, rgba(0,169,224,0.08), transparent 26%), radial-gradient(circle at 100% 8%, rgba(140,198,63,0.06), transparent 24%)" }}/>
            <div className="relative px-3 sm:px-5 py-3 border-b border-shBorder/55 bg-bgHeader/92 backdrop-blur-xl flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden border border-shSecondary/30 bg-black/35 shrink-0"><HuskyDogImage src={entry.dog_photo} name={entry.dog_name} alt={entry.dog_name} className="w-full h-full object-cover object-top"/></div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-shSecondary truncate">{detailLesson.module_name}</p>{detailLesson.is_current && <span className="text-[8px] font-black uppercase tracking-[0.12em] px-2 py-0.5 rounded-md bg-shPrimary/10 border border-shPrimary/25 text-shPrimary shrink-0">Current</span>}</div>
                  <h3 className="text-[17px] sm:text-[20px] font-black text-white truncate mt-0.5">
                    {roadmap?.requires_checkpoint && roadmap?.checkpoint_rubric?.assessment_type === "final_assessment" && detailLesson.is_current
                      ? `${detailLesson.lesson.name} · Final Assessment` : detailLesson.lesson.name}
                  </h3>
                </div>
              </div>
              <button onClick={() => setDetailLesson(null)} data-testid="school-lesson-detail-close" className="w-10 h-10 rounded-xl border border-shBorder/55 bg-black/15 text-shTextMuted hover:text-shText grid place-items-center shrink-0"><i className="fas fa-times"/></button>
            </div>
            <div className="relative overflow-y-auto flex-1 min-h-0 px-3 sm:px-5 lg:px-6 py-4 sm:py-5 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <LessonDetailPanel lesson={detailLesson.lesson} testid="school-lesson-detail"/>

              {detailLesson.skills.length > 0 && (
                <SectionCard accent="cyan" intensity="subtle">
                  <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shSecondary mb-2"><i className="fas fa-star mr-1.5"/>Skills you&apos;re building</p>
                  <div className="space-y-2">{detailLesson.skills.map(s => <div key={s.id} className="rounded-xl border border-shBorder/45 bg-black/10 p-3"><p className="text-[13px] font-black text-shText">{s.name}</p>{s.client_facing_explanation && <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed">{s.client_facing_explanation}</p>}</div>)}</div>
                </SectionCard>
              )}

              {detailLesson.has_practice_recipe ? (
                <PremiumButton onClick={() => startPractice(detailLesson.lesson.id)} disabled={busy} data-testid="school-start-practice" className="w-full justify-center min-h-[52px] text-[13px] sm:text-[14px]">
                  <i className="fas fa-paw text-[11px]"/>{practiceButtonLabel(detailLesson.practiced)}
                </PremiumButton>
              ) : (
                <EmptyState icon="fa-circle-info" message="Practice for this lesson isn't set up yet — check back soon." testid="school-no-practice"/>
              )}

              {detailLesson.is_current && detailLesson.practiced && !roadmap?.requires_checkpoint && (
                <PremiumButton variant="secondary" onClick={advance} disabled={busy} data-testid="school-advance" className="w-full justify-center min-h-[48px]">Continue <i className="fas fa-arrow-right text-[10px]"/></PremiumButton>
              )}

              {detailLesson.is_current && roadmap?.requires_checkpoint && (
                <CheckpointPanel
                  lessonId={detailLesson.lesson.id}
                  practiced={detailLesson.practiced}
                  rubric={roadmap.checkpoint_rubric}
                  status={roadmap.checkpoint_status}
                  onSubmit={submitCheckpoint}
                  onGoToRefresher={openLesson}
                  busy={busy}
                />
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

// ---------------------------------------------------------------------------
// Dog identity switcher — replaces the old filter-pill row. The active dog
// is the identity of the whole school experience; a dropdown only appears
// when there's genuinely more than one enrolled dog to switch between.
// ---------------------------------------------------------------------------

function DogSwitcher({ list, activeId, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = list.find(d => d.school_enrollment_id === activeId) || list[0];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const identity = (
    <>
      <Avatar src={active.dog_photo} icon="fa-paw" size="md" ring="border-shPrimary/50" alt={active.dog_name}/>
      <div className="min-w-0 text-left">
        <p className="text-[17px] font-black text-shText leading-tight truncate">{active.dog_name}</p>
        <p className="text-[11px] font-semibold text-shTextMuted leading-tight truncate">{active.program_name}</p>
      </div>
    </>
  );

  if (list.length <= 1) {
    return (
      <div className="flex items-center gap-3" data-testid="school-dog-identity">
        {identity}
      </div>
    );
  }

  return (
    <div className="relative w-full sm:w-auto" ref={ref} data-testid="school-dog-switcher">
      <button
        onClick={() => setOpen(o => !o)}
        data-testid="school-dog-switcher-toggle"
        className="w-full sm:w-auto flex items-center gap-3 rounded-2xl px-2 py-1.5 sm:-ml-2 transition hover:bg-white/[0.035] sm:max-w-[320px]"
      >
        {identity}
        <span className="ml-1 w-7 h-7 rounded-full border border-shBorder/70 grid place-items-center shrink-0">
          <i className={`fas fa-chevron-down text-shTextMuted text-[10px] transition-transform ${open ? "rotate-180" : ""}`}/>
        </span>
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-2 w-[min(18rem,calc(100vw-2rem))] bg-[var(--sh-card-base)] border border-shBorder rounded-2xl shadow-2xl overflow-hidden p-1.5">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shTextMuted px-3 pt-2 pb-1">Switch student dog</p>
          {list.map(d => (
            <button
              key={d.school_enrollment_id}
              onClick={() => { onSelect(d.school_enrollment_id); setOpen(false); }}
              data-testid={`school-dog-${d.school_enrollment_id}`}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${d.school_enrollment_id === activeId ? "bg-shPrimary/10" : "hover:bg-white/[0.04]"}`}
            >
              <Avatar src={d.dog_photo} icon="fa-paw" size="sm" ring={d.school_enrollment_id === activeId ? "border-shPrimary/50" : "border-shBorder"} alt={d.dog_name}/>
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-black truncate ${d.school_enrollment_id === activeId ? "text-shPrimary" : "text-shText"}`}>{d.dog_name}</p>
                <p className="text-[10px] text-shTextMuted truncate">{d.program_name} · {d.status === "completed" ? "Completed" : formatCompletionPct(d.mastered_pct)}</p>
              </div>
              {d.school_enrollment_id === activeId && <i className="fas fa-check text-shPrimary text-[11px]"/>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student Home — one dominant focal point (Next Up), quieter secondary
// context grouped into a single stacked card below.
// ---------------------------------------------------------------------------

function HomeView({ entry, roadmap, heroMasteredPct, heroCurrentLessonName, trainerStatus, recentFeedback, busy, onContinue, onViewFeedback, clientFirstName }) {
  const goal = roadmap?.current_lesson?.client_overview;
  const pct = Math.max(0, Math.min(100, heroMasteredPct || 0));
  const greeting = clientFirstName ? `Welcome back, ${clientFirstName}` : `Training with ${entry.dog_name}`;

  return (
    <div className="space-y-4" data-testid="school-home">
      <NeonEdge accentRgb="0,169,224" intensity="hero" className="relative min-h-[300px]" data-testid="school-hero">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -right-10 -top-16 w-80 h-80 rounded-full bg-shSecondary/10 blur-3xl"/>
          <div className="absolute left-[38%] -bottom-24 w-80 h-80 rounded-full bg-shPrimary/[0.07] blur-3xl"/>
        </div>
        <div className="relative grid lg:grid-cols-[1.35fr_0.65fr] min-h-[300px]">
          <div className="p-5 sm:p-7 lg:p-8 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-shSecondary/25 bg-shSecondary/10 text-shSecondary text-[10px] font-black uppercase tracking-[0.14em]">
                <i className="fas fa-graduation-cap"/>Online School
              </span>
              <span className="text-[11px] text-shTextMuted truncate">{entry.program_name}</span>
            </div>
            <p className="text-[13px] font-bold text-shTextMuted mb-1">{greeting}</p>
            {heroCurrentLessonName ? (
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shPrimary mb-1.5">Continue where you left off</p>
                <h2 className="sh-display text-[34px] sm:text-[44px] text-white leading-[0.95] mb-3 max-w-2xl">{heroCurrentLessonName}</h2>
                {goal && <p className="text-[14px] text-shText/85 leading-relaxed max-w-xl mb-5">{goal}</p>}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <PremiumButton onClick={onContinue} data-testid="school-continue-training" disabled={busy} className="justify-center sm:justify-start sm:min-w-[210px]">
                    <i className="fas fa-play text-[11px]"/>{roadmap ? continueButtonLabel(roadmap) : "Continue Training"}<i className="fas fa-arrow-right text-[10px]"/>
                  </PremiumButton>
                  <div className="min-w-[190px]">
                    <div className="flex items-center justify-between text-[10px] font-bold text-shTextMuted mb-1.5">
                      <span>Course progress</span><span className="text-shPrimary">{Math.round(pct)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-shSecondary to-shPrimary transition-all" style={{ width: `${pct}%` }}/>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 className="sh-display text-[34px] sm:text-[44px] text-white leading-[0.95] mb-2">{entry.program_name}</h2>
                <p className="text-[13px] text-shTextMuted">Getting your roadmap ready…</p>
              </>
            )}
          </div>

          <div className="relative min-h-[220px] lg:min-h-full overflow-hidden border-t lg:border-t-0 lg:border-l border-shBorder/50 bg-black/20">
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--sh-card-base)] via-transparent to-transparent z-10"/>
            <HuskyDogImage
              src={entry.dog_photo}
              name={entry.dog_name}
              alt={entry.dog_name}
              className="absolute inset-0 w-full h-full object-cover object-top opacity-90"
            />
            <div className="absolute left-4 right-4 bottom-4 z-20 rounded-xl border border-white/10 bg-black/60 backdrop-blur-md px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shTextMuted">Your student</p>
                  <p className="text-xl font-black text-white truncate">{entry.dog_name}</p>
                </div>
                <div className="w-12 h-12 rounded-full border-4 border-shPrimary/25 grid place-items-center bg-black/50 shrink-0">
                  <span className="text-[12px] font-black text-shPrimary">{Math.round(pct)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </NeonEdge>

      <div className="grid md:grid-cols-2 gap-4" data-testid="school-home-summary">
        <SectionCard accent="lime" intensity="subtle" className="min-h-[150px]">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-shPrimary">Your journey</p>
              <h3 className="text-[17px] font-black text-shText mt-1">{formatCompletionPct(heroMasteredPct)}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-shPrimary/10 border border-shPrimary/25 grid place-items-center"><i className="fas fa-route text-shPrimary"/></div>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden mb-2">
            <div className="h-full bg-shPrimary rounded-full" style={{ width: `${pct}%` }}/>
          </div>
          <p className="text-[12px] text-shTextMuted leading-relaxed">Keep moving through {entry.program_name} one lesson at a time.</p>
        </SectionCard>

        <SectionCard accent={trainerStatus?.tone === "purple" ? "purple" : trainerStatus?.tone === "accent" ? "orange" : "cyan"} intensity="subtle" className="min-h-[150px]" data-testid="school-trainer-status">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-shSecondary">Trainer status</p>
              <h3 className="text-[17px] font-black text-shText mt-1">Real help when you need it</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-shSecondary/10 border border-shSecondary/25 grid place-items-center"><i className="fas fa-user-check text-shSecondary"/></div>
          </div>
          {trainerStatus ? <StatusChip icon={trainerStatus.icon} label={trainerStatus.label} tone={trainerStatus.tone}/> : <p className="text-[12px] text-shTextMuted">No trainer action needed right now.</p>}
        </SectionCard>

        {recentFeedback && (
          <SectionCard accent="orange" intensity="subtle" className="md:col-span-2" data-testid="school-recent-feedback">
            <div className="grid sm:grid-cols-[auto_1fr_auto] gap-3 sm:items-center">
              <div className="w-11 h-11 rounded-xl bg-shAccent/10 border border-shAccent/25 grid place-items-center"><i className="fas fa-comment-dots text-shAccent"/></div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-shAccent">Latest trainer feedback</p>
                {recentFeedback.trainer_feedback ? (
                  <p className="text-[13px] text-shText/90 mt-1 leading-relaxed">“{recentFeedback.trainer_feedback.length > 175 ? `${recentFeedback.trainer_feedback.slice(0, 175)}…` : recentFeedback.trainer_feedback}”</p>
                ) : <p className="text-[12px] text-shTextMuted mt-1">Your latest checkpoint review is ready.</p>}
              </div>
              <PremiumButton variant="secondary" onClick={onViewFeedback} data-testid="school-view-full-feedback" className="justify-center whitespace-nowrap">
                View review <i className="fas fa-arrow-right text-[10px]"/>
              </PremiumButton>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkpoint result presentation — shared by the Trainer Feedback history
// tab. Never implies a lower Dog score is a handling mistake — Handler and
// Dog are presented as two separate, equally-weighted questions.
// ---------------------------------------------------------------------------

const OUTCOME_META = {
  advance: { label: "Ready to advance", tone: "primary", icon: "fa-circle-check" },
  prescribe_practice: { label: "More practice needed", tone: "accent", icon: "fa-rotate-left" },
  trainer_assist_recommended: { label: "Trainer Assist recommended", tone: "purple", icon: "fa-handshake" },
};

function RubricScoreGroup({ title, overall, criteria, scores, tone = "lime" }) {
  if (!criteria || criteria.length === 0) return null;
  const accentClass = tone === "cyan" ? "text-shSecondary" : "text-shPrimary";
  const barClass = tone === "cyan" ? "bg-shSecondary" : "bg-shPrimary";
  return (
    <div className="rounded-xl border border-shBorder/55 bg-black/20 p-3.5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[12px] font-black text-shText">{title}</p>
        {overall != null && <span className={`text-[13px] font-black ${accentClass}`}>{Number(overall).toFixed(1)}<span className="text-[10px] text-shTextMuted">/5</span></span>}
      </div>
      <div className="space-y-2.5">
        {criteria.map(c => {
          const score = Number(scores?.[c.id] ?? 0);
          return (
            <div key={c.id}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[11px] text-shTextMuted truncate">{c.name}</p>
                <span className="text-[10px] font-bold text-shTextMuted">{score}/5</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(0, Math.min(100, (score / 5) * 100))}%` }}/>
              </div>
              <div className="mt-1.5"><SkillLevelIndicator score={score} size="sm"/></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CheckpointResultEntry({ entry, expanded, onToggle }) {
  const meta = OUTCOME_META[entry.outcome] || OUTCOME_META.advance;
  const hasRubric = (entry.rubric_snapshot?.handler_criteria?.length || entry.rubric_snapshot?.dog_criteria?.length);
  const accent = entry.outcome === "trainer_assist_recommended" ? "168,85,247" : entry.outcome === "prescribe_practice" ? "242,101,34" : "140,198,63";
  return (
    <NeonEdge accentRgb={accent} intensity="subtle" className="p-4 sm:p-5" data-testid={`school-history-${entry.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-shTextMuted mb-1">Trainer review</p>
          <p className="text-[17px] font-black text-shText leading-tight">{entry.lesson_name}</p>
          <p className="text-[11px] text-shTextMuted mt-1">
            {entry.trainer_name ? `${entry.trainer_name} · ` : ""}{entry.graded_at ? new Date(entry.graded_at).toLocaleDateString() : ""}
          </p>
        </div>
        <div className="shrink-0"><StatusChip icon={meta.icon} label={meta.label} tone={meta.tone}/></div>
      </div>

      {entry.trainer_feedback && (
        <div className="rounded-xl border border-shAccent/20 bg-shAccent/[0.055] px-4 py-3 mb-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shAccent mb-1.5"><i className="fas fa-comment-dots mr-1.5"/>Trainer feedback</p>
          <p className="text-[13px] text-shText/90 leading-relaxed">
            {expanded || entry.trainer_feedback.length <= 180 ? entry.trainer_feedback : `${entry.trainer_feedback.slice(0, 180)}…`}
          </p>
        </div>
      )}

      {(hasRubric > 0 || entry.trainer_feedback?.length > 180) && (
        <button onClick={onToggle} data-testid={`school-history-${entry.id}-toggle`} className="inline-flex items-center gap-2 text-shSecondary font-black text-[12px] hover:text-shText transition">
          {expanded ? "Hide full review" : "View full review"} <i className={`fas fa-chevron-${expanded ? "up" : "down"} text-[9px]`}/>
        </button>
      )}

      {expanded && hasRubric > 0 && (
        <div className="mt-4 pt-4 border-t border-shBorder/50 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <RubricScoreGroup title="Handler skills" overall={entry.handler_overall} criteria={entry.rubric_snapshot?.handler_criteria} scores={entry.handler_scores} tone="lime"/>
            <RubricScoreGroup title="Dog performance" overall={entry.dog_overall} criteria={entry.rubric_snapshot?.dog_criteria} scores={entry.dog_scores} tone="cyan"/>
          </div>
          <p className="text-[11px] text-shTextMuted italic leading-relaxed"><i className="fas fa-circle-info mr-1.5 text-shSecondary"/>Handler and Dog are scored separately — a lower Dog score reflects where your dog is in training, not a handling mistake.</p>
        </div>
      )}

      {/* Online School Phase 4 — Trainer Assist is a SEPARATE later chapter
          of this same checkpoint's story, never overwriting the review
          feedback above it: "why was I held here" (the review, above) vs
          "what happened afterward" (this block). Internal staff notes
          never reach entry.trainer_assist — see _client_safe_trainer_assist. */}
      {entry.trainer_assist && (
        <div className="mt-4 pt-4 border-t border-purple-400/20" data-testid={`school-history-${entry.id}-trainer-assist`}>
          <div className="flex items-start gap-3 rounded-xl border border-purple-400/20 bg-purple-500/[0.06] p-3.5">
            <div className="w-9 h-9 rounded-xl bg-purple-400/10 border border-purple-400/25 grid place-items-center shrink-0"><i className="fas fa-handshake text-purple-300 text-[13px]"/></div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-purple-300 mb-1">Trainer Assist</p>
              {entry.trainer_assist.status === "completed" ? (
                <p className="text-[13px] text-shText/90">{entry.trainer_assist.client_summary || "Resolved — ready to continue."}</p>
              ) : entry.trainer_assist.status === "reschedule_needed" ? (
                <p className="text-[13px] text-shTextMuted">That appointment was canceled — your trainer will reschedule.</p>
              ) : entry.trainer_assist.status === "scheduled" ? (
                <p className="text-[13px] text-shTextMuted">Scheduled{entry.trainer_assist.scheduled_date ? ` for ${entry.trainer_assist.scheduled_date}${entry.trainer_assist.scheduled_time ? ` · ${entry.trainer_assist.scheduled_time}` : ""}` : ""}</p>
              ) : entry.trainer_assist.status === "contacted" ? (
                <p className="text-[13px] text-shTextMuted">Your trainer reached out and is working with you on this.</p>
              ) : (
                <p className="text-[13px] text-shTextMuted">Your trainer is reviewing next steps.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </NeonEdge>
  );
}

function TrainerFeedbackHistory({ history, expandedId, onToggle }) {
  if (history === null) return null;
  if (history.length === 0) {
    return <EmptyState icon="fa-comment-dots" message="No trainer feedback yet — it'll show up here after your first checkpoint is reviewed." testid="school-feedback-empty"/>;
  }
  return (
    <div className="space-y-4" data-testid="school-feedback-history">
      <NeonEdge accentRgb="242,101,34" intensity="subtle" className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center"><i className="fas fa-comments text-shAccent"/></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shAccent">Your trainer is part of the course</p>
            <h2 className="sh-display text-2xl sm:text-3xl text-white leading-none mt-1">Trainer Feedback</h2>
            <p className="text-[12px] text-shTextMuted mt-2">See what improved, what needs work, and exactly what your trainer wants you to do next.</p>
          </div>
        </div>
      </NeonEdge>
      {history.map(entry => (
        <CheckpointResultEntry key={entry.id} entry={entry} expanded={expandedId === entry.id} onToggle={() => onToggle(entry.id)}/>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help / Graduation
// ---------------------------------------------------------------------------

function HelpView({ stuckReason, onSelectReason, hasCurrentLesson, onOpenCurrentLesson, onContactTrainer }) {
  const selected = STUCK_REASONS.find(r => r.key === stuckReason);
  return (
    <div className="space-y-4" data-testid="school-help">
      <NeonEdge accentRgb="168,85,247" intensity="subtle" className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-400/10 border border-purple-400/30 grid place-items-center"><i className="fas fa-life-ring text-purple-300"/></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-purple-300">Do it yourself doesn't mean do it alone</p>
            <h3 className="sh-display text-2xl sm:text-3xl text-white leading-none mt-1">Need a hand?</h3>
            <p className="text-[12px] text-shTextMuted mt-2">Tell us what's happening. The app helps first, and your trainer is right there when you need a human.</p>
          </div>
        </div>
      </NeonEdge>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {STUCK_REASONS.map(r => (
          <button
            key={r.key}
            onClick={() => onSelectReason(r.key)}
            data-testid={`school-stuck-${r.key}`}
            className={`group text-left rounded-2xl border p-4 transition min-h-[110px] ${stuckReason === r.key ? "border-shSecondary/50 bg-shSecondary/[0.08] shadow-[0_0_20px_rgba(0,169,224,0.08)]" : "border-shBorder/60 bg-black/15 hover:border-shBorder hover:bg-white/[0.025]"}`}
          >
            <div className={`w-9 h-9 rounded-xl grid place-items-center border mb-3 ${stuckReason === r.key ? "bg-shSecondary/10 border-shSecondary/30 text-shSecondary" : "bg-white/[0.025] border-shBorder/60 text-shTextMuted"}`}><i className={`fas ${r.icon} text-[13px]`}/></div>
            <span className="text-[13px] font-black text-shText leading-tight block">{r.label}</span>
          </button>
        ))}
      </div>

      {selected && (
        <SectionCard accent={stuckReason === "need_trainer" || stuckReason === "worried" ? "purple" : "cyan"} intensity="subtle">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shTextMuted mb-1.5">Try this first</p>
          <p className="text-[13px] text-shText/90 leading-relaxed">{STUCK_TIPS[stuckReason]}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {hasCurrentLesson && (
              <PremiumButton variant="secondary" onClick={onOpenCurrentLesson} data-testid="school-stuck-open-lesson">
                <i className="fas fa-book-open text-[10px]"/>Review current lesson
              </PremiumButton>
            )}
            <PremiumButton variant={stuckReason === "need_trainer" || stuckReason === "worried" ? "primary" : "secondary"} onClick={onContactTrainer} data-testid="school-contact-trainer" disabled={!onContactTrainer}>
              <i className="fas fa-comment text-[10px]"/>Contact your trainer
            </PremiumButton>
          </div>
        </SectionCard>
      )}

      {!selected && (
        <button onClick={onContactTrainer} data-testid="school-contact-trainer" disabled={!onContactTrainer} className="text-shTextMuted hover:text-shText font-bold text-[12px] disabled:opacity-50 transition">
          <i className="fas fa-comment mr-2"/>Skip troubleshooting and contact your trainer
        </button>
      )}
    </div>
  );
}

function GraduationView({ dogName, dogPhoto, programName, completionSummary, onViewFeedback, onViewAchievements }) {
  const stats = completionSummary ? [
    completionSummary.completed_at ? { icon: "fa-calendar-check", label: "Completed", value: new Date(completionSummary.completed_at).toLocaleDateString() } : null,
    { icon: "fa-layer-group", label: "Modules", value: completionSummary.total_modules },
    { icon: "fa-book-open", label: "Lessons", value: completionSummary.total_lessons },
    completionSummary.checkpoints_passed > 0 ? { icon: "fa-video", label: "Checkpoints passed", value: completionSummary.checkpoints_passed } : null,
    completionSummary.practice_sessions_logged > 0 ? { icon: "fa-paw", label: "Practice sessions", value: completionSummary.practice_sessions_logged } : null,
  ].filter(Boolean) : [];

  return (
    <div className="space-y-4" data-testid="school-graduation">
      <NeonEdge accentRgb="140,198,63" intensity="hero" className="overflow-hidden">
        <div className="relative grid lg:grid-cols-[0.8fr_1.2fr] min-h-[360px]">
          <div className="relative min-h-[280px] lg:min-h-full overflow-hidden bg-black/25 border-b lg:border-b-0 lg:border-r border-shPrimary/20">
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--sh-card-base)] via-transparent to-transparent z-10"/>
            <HuskyDogImage src={dogPhoto} name={dogName} alt={dogName} className="absolute inset-0 w-full h-full object-cover object-top"/>
            <div className="absolute inset-x-0 bottom-0 z-20 p-5 sm:p-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-shPrimary/30 bg-black/60 backdrop-blur-md text-shPrimary text-[10px] font-black uppercase tracking-[0.15em]"><i className="fas fa-graduation-cap"/>Online School Graduate</div>
            </div>
          </div>

          <div className="relative p-6 sm:p-8 lg:p-10 flex flex-col justify-center">
            <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-shPrimary/10 blur-3xl pointer-events-none"/>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shPrimary mb-2">Congratulations</p>
            <h2 className="sh-display text-[40px] sm:text-[54px] text-white leading-[0.9] mb-3">{dogName}</h2>
            <p className="text-[16px] text-shTextMuted mb-1">You completed</p>
            <p className="text-[20px] font-black text-shText mb-6">{programName}</p>
            {completionSummary?.final_assessment?.trainer_feedback && (
              <div className="rounded-xl border border-shPrimary/20 bg-shPrimary/[0.05] p-4 mb-6">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shPrimary mb-1.5">Final trainer note</p>
                <p className="text-[13px] text-shText/90 leading-relaxed">“{completionSummary.final_assessment.trainer_feedback}”</p>
              </div>
            )}
            <PremiumButton onClick={() => printSchoolCertificate({ dogName, programName, completionSummary })} data-testid="school-download-certificate" className="justify-center sm:self-start sm:min-w-[260px]">
              <i className="fas fa-award"/>Certificate of Completion
            </PremiumButton>
          </div>
        </div>
      </NeonEdge>

      <div className="grid lg:grid-cols-[1fr_0.8fr] gap-4">
        <SectionCard accent="lime" intensity="subtle">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shPrimary mb-3">Course record</p>
          {stats.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {stats.map(s => (
                <div key={s.label} className="rounded-xl border border-shBorder/55 bg-black/20 p-3">
                  <i className={`fas ${s.icon} text-shPrimary text-[11px] mb-2`}/>
                  <p className="text-[17px] font-black text-shText leading-tight">{s.value}</p>
                  <p className="text-[10px] text-shTextMuted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard accent="cyan" intensity="subtle">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shSecondary mb-3">Final report</p>
          <div className="space-y-4">
            {completionSummary?.final_assessment && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-shPrimary/20 bg-shPrimary/[0.05] p-3"><p className="text-[10px] text-shTextMuted mb-1">Handler skills</p><p className="text-2xl font-black text-shPrimary">{Number(completionSummary.final_assessment.handler_overall ?? 0).toFixed(1)}<span className="text-[12px] text-shTextMuted">/5</span></p></div>
                <div className="rounded-xl border border-shSecondary/20 bg-shSecondary/[0.05] p-3"><p className="text-[10px] text-shTextMuted mb-1">Dog performance</p><p className="text-2xl font-black text-shSecondary">{Number(completionSummary.final_assessment.dog_overall ?? 0).toFixed(1)}<span className="text-[12px] text-shTextMuted">/5</span></p></div>
              </div>
            )}
            <div className="flex gap-2">
              <PremiumButton variant="secondary" onClick={onViewFeedback} data-testid="school-graduation-view-feedback" className="flex-1 justify-center">Feedback</PremiumButton>
              <PremiumButton variant="secondary" onClick={onViewAchievements} data-testid="school-graduation-view-achievements" className="flex-1 justify-center">Achievements</PremiumButton>
            </div>
          </div>
        </SectionCard>
      </div>

      {Array.isArray(completionSummary?.skills_mastered) && groupSkillsByModule(completionSummary.skills_mastered).length > 0 && (
        <SectionCard accent="lime" intensity="subtle" data-testid="school-graduation-skills">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shPrimary mb-1">Skills {dogName} mastered</p>
          <p className="text-[12px] text-shTextMuted mb-3">Everything your dog now knows from this program.</p>
          <div className="space-y-4">
            {groupSkillsByModule(completionSummary.skills_mastered).map(grp => (
              <div key={grp.module || "_"}>
                {grp.module && <p className="text-[10px] font-black uppercase tracking-[0.12em] text-shSecondary mb-2">{grp.module}</p>}
                <div className="grid sm:grid-cols-2 gap-2">
                  {grp.skills.map((s, i) => (
                    <div key={`${grp.module}-${i}`} className="rounded-xl border border-shBorder/55 bg-black/20 p-3">
                      <p className="text-[13px] font-black text-shText flex items-start gap-2"><i className="fas fa-circle-check text-shPrimary text-[11px] mt-1 shrink-0"/><span>{s.name}</span></p>
                      {s.explanation && <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed">{s.explanation}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function Overlay({ children, onClose, testid }) {
  return (
    <div className="fixed inset-0 bg-black/90 z-50 overflow-y-auto" data-testid={testid}>
      <div className="fixed inset-0 pointer-events-none opacity-70" style={{ background: "radial-gradient(circle at 15% 15%, rgba(140,198,63,0.08), transparent 28%), radial-gradient(circle at 85% 20%, rgba(0,169,224,0.08), transparent 30%), linear-gradient(180deg, rgba(3,6,26,0.2), rgba(0,0,0,0.6))" }}/>
      <div className="relative min-h-full flex items-start justify-center p-0 sm:p-4 lg:p-6">
        <div className="w-full max-w-6xl min-h-[100dvh] sm:min-h-0 bg-bgPanel/95 border-0 sm:border border-shBorder rounded-none sm:rounded-2xl shadow-[0_30px_100px_rgba(0,0,0,0.65)] overflow-hidden">
          <div className="sticky top-0 z-20 bg-bgHeader/95 backdrop-blur-xl border-b border-shBorder/70 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl overflow-hidden border border-shPrimary/25 bg-black/40 shrink-0"><img src="/brand/husky-placeholder-black-white.png" alt="Sit Happens husky mascot" className="w-full h-full object-cover object-top"/></div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="sh-display text-xl sm:text-2xl text-shPrimary leading-none whitespace-nowrap">Sit Happens</span>
                  <span className="hidden sm:inline text-[9px] font-black uppercase tracking-[0.2em] text-shSecondary">Online School</span>
                </div>
                <p className="sm:hidden text-[9px] font-black uppercase tracking-[0.18em] text-shSecondary mt-0.5">Online School</p>
              </div>
            </div>
            <button onClick={onClose} data-testid="online-school-close" className="w-10 h-10 rounded-xl border border-shBorder/60 bg-black/20 grid place-items-center text-shTextMuted hover:text-shText hover:bg-white/[0.04] transition shrink-0"><i className="fas fa-times"/></button>
          </div>
          <div className="p-3 sm:p-5 lg:p-6 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
        </div>
      </div>
    </div>
  );
}
