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
import PracticeMediaUploader from "./training/PracticeMediaUploader";
import StatusChip from "./training/StatusChip";
import AchievementCard from "./training/AchievementCard";
import SkillLevelIndicator from "./training/SkillLevelIndicator";
import { printSchoolCertificate } from "../lib/schoolCertificate";
import {
  buildSchoolRoadmap, buildSchoolLessonCards, practiceButtonLabel, continueButtonLabel,
  formatCompletionPct, trainerStatusLabel, recentFeedbackFromHistory,
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

export default function OnlineSchoolDashboard({ clientFirstName, onClose, onContactTrainer }) {
  const [list, setList] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLesson, setDetailLesson] = useState(null);
  const [practiceHomework, setPracticeHomework] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [finishedMsg, setFinishedMsg] = useState("");
  const [schoolView, setSchoolView] = useState("home");
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
      if (data.length > 0) setActiveId(id => id || data[0].school_enrollment_id);
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
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap sm:flex-nowrap">
        <DogSwitcher list={list} activeId={activeId} onSelect={setActiveId}/>
        <div className="flex gap-1 overflow-x-auto min-w-0 max-w-full" data-testid="school-nav-tabs">
          {NAV_TABS.map(t => (
            <button key={t.key} onClick={() => setSchoolView(t.key)} data-testid={`school-nav-${t.key}`}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold transition ${schoolView === t.key ? "bg-shPrimary/15 text-shPrimary" : "text-shTextMuted hover:text-shText"}`}>
              <i className={`fas ${t.icon} text-[11px]`}/>{t.label}
            </button>
          ))}
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
        isCompleted ? (
          <GraduationView
            dogName={entry.dog_name} dogPhoto={entry.dog_photo} programName={entry.program_name}
            completionSummary={detail?.completion_summary}
            onViewFeedback={() => setSchoolView("feedback")}
            onViewAchievements={() => setSchoolView("achievements")}
          />
        ) : (
          <HomeView
            entry={entry} roadmap={roadmap}
            heroMasteredPct={heroMasteredPct} heroCurrentLessonName={heroCurrentLessonName}
            trainerStatus={trainerStatus} recentFeedback={recentFeedback} busy={busy}
            onContinue={() => roadmap?.current_lesson && openLesson(roadmap.current_lesson.id)}
            onViewFeedback={() => { setSchoolView("feedback"); setExpandedHistoryId(recentFeedback?.id || null); }}
          />
        )
      )}

      {schoolView === "journey" && (
        <div>
          <p className="text-[13px] text-shTextMuted mb-3"><span className="text-shText font-bold">{entry.program_name}</span> · your training path</p>
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
        <div data-testid="school-achievements">
          <h3 className="text-lg font-black text-white mb-3">Achievements</h3>
          {dogTrophies.length === 0 ? (
            <EmptyState icon="fa-trophy" message="No achievements yet — they'll show up here as training milestones are reached." testid="school-achievements-empty"/>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {dogTrophies.map(t => (
                <div key={t.id} className="rounded-xl bg-gradient-to-br from-shAccent/10 via-black/20 to-black/20 border border-shAccent/20 p-1">
                  <AchievementCard icon={t.trophy_icon} name={t.trophy_name} date={t.awarded_at}
                                    description={t.trophy_description} testid={`school-achievement-${t.id}`}/>
                </div>
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
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-2 sm:p-4" onClick={() => setDetailLesson(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
            <div className="px-5 py-4 border-b border-shBorder flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <p className="text-[11px] text-shTextMuted">{detailLesson.module_name}</p>
                <h3 className="text-lg font-black text-shText truncate">
                  {roadmap?.requires_checkpoint && roadmap?.checkpoint_rubric?.assessment_type === "final_assessment" && detailLesson.is_current
                    ? "Stage Final Assessment" : detailLesson.lesson.name}
                </h3>
              </div>
              <button onClick={() => setDetailLesson(null)} data-testid="school-lesson-detail-close" className="text-shTextMuted hover:text-shText text-xl px-2 shrink-0"><i className="fas fa-times"/></button>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-3">
              <LessonDetailPanel lesson={detailLesson.lesson} testid="school-lesson-detail"/>

              {detailLesson.skills.length > 0 && (
                <div className="bg-shBlue/5 border border-shBlue/20 rounded-lg p-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-shBlue mb-1.5"><i className="fas fa-star mr-1.5"/>Skill</p>
                  {detailLesson.skills.map(s => (
                    <p key={s.id} className="text-[13px] text-shText">{s.name}{s.client_facing_explanation ? ` — ${s.client_facing_explanation}` : ""}</p>
                  ))}
                </div>
              )}

              {detailLesson.has_practice_recipe ? (
                <button onClick={() => startPractice(detailLesson.lesson.id)} disabled={busy}
                        data-testid="school-start-practice"
                        className="w-full bg-shPrimary text-bgHeader py-3 rounded-xl font-black text-[15px] shadow-lg shadow-shPrimary/20 disabled:opacity-50">
                  <i className="fas fa-paw mr-2"/>{practiceButtonLabel(detailLesson.practiced)}
                </button>
              ) : (
                <EmptyState icon="fa-circle-info" message="Practice for this lesson isn't set up yet — check back soon." testid="school-no-practice"/>
              )}

              {detailLesson.is_current && detailLesson.practiced && !roadmap?.requires_checkpoint && (
                <button onClick={advance} disabled={busy} data-testid="school-advance"
                        className="w-full bg-shBlue/15 text-shBlue border border-shBlue/40 py-2.5 rounded-xl font-bold text-[14px] disabled:opacity-50">
                  <i className="fas fa-arrow-right mr-2"/>Continue
                </button>
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

  if (list.length <= 1) {
    return (
      <div className="flex items-center gap-2.5" data-testid="school-dog-identity">
        <Avatar src={active.dog_photo} icon="fa-paw" size="sm" alt={active.dog_name}/>
        <div className="min-w-0">
          <p className="text-[15px] font-black text-shText leading-tight truncate">{active.dog_name}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-shTextMuted leading-tight">Online School</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref} data-testid="school-dog-switcher">
      <button onClick={() => setOpen(o => !o)} data-testid="school-dog-switcher-toggle"
              className="flex items-center gap-2.5 hover:bg-white/5 rounded-xl px-1.5 py-1 -ml-1.5 transition">
        <Avatar src={active.dog_photo} icon="fa-paw" size="sm" alt={active.dog_name}/>
        <div className="min-w-0 text-left">
          <p className="text-[15px] font-black text-shText leading-tight truncate">{active.dog_name}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-shTextMuted leading-tight">Online School</p>
        </div>
        <i className={`fas fa-chevron-down text-shTextMuted text-[11px] transition-transform ${open ? "rotate-180" : ""}`}/>
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-56 bg-[var(--sh-card-base)] border border-shBorder rounded-xl shadow-2xl overflow-hidden">
          {list.map(d => (
            <button key={d.school_enrollment_id} onClick={() => { onSelect(d.school_enrollment_id); setOpen(false); }}
                    data-testid={`school-dog-${d.school_enrollment_id}`}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/5 transition ${d.school_enrollment_id === activeId ? "bg-shPrimary/10" : ""}`}>
              <Avatar src={d.dog_photo} icon="fa-paw" size="sm" alt={d.dog_name}/>
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-bold truncate ${d.school_enrollment_id === activeId ? "text-shPrimary" : "text-shText"}`}>{d.dog_name}</p>
                <p className="text-[10px] text-shTextMuted truncate">{d.status === "completed" ? "Completed" : formatCompletionPct(d.mastered_pct)}</p>
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

function HomeView({ entry, roadmap, heroMasteredPct, heroCurrentLessonName, trainerStatus, recentFeedback, busy, onContinue, onViewFeedback }) {
  const goal = roadmap?.current_lesson?.client_overview;
  return (
    <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4" data-testid="school-home">
      {/* Dominant focal card */}
      <div className="relative overflow-hidden bg-gradient-to-br from-shBlue/10 via-bgPanel to-shPrimary/10 border border-shBorder rounded-2xl p-6 shadow-xl" data-testid="school-hero">
        {heroCurrentLessonName ? (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest text-shBlue mb-2"><i className="fas fa-play mr-1.5"/>Continue where you left off</p>
            <h2 className="text-3xl font-black text-white leading-tight mb-1">{heroCurrentLessonName}</h2>
            <p className="text-[13px] text-shTextMuted mb-3">{entry.program_name}</p>
            {goal && <p className="text-[14px] text-shText/90 mb-5 max-w-md">{goal}</p>}
            <button onClick={onContinue} data-testid="school-continue-training" disabled={busy}
                    className="bg-shPrimary text-bgHeader px-8 py-3.5 rounded-xl font-black text-[15px] shadow-lg shadow-shPrimary/25 disabled:opacity-50 hover:brightness-110 transition">
              {roadmap ? continueButtonLabel(roadmap) : "Continue Training"} <i className="fas fa-arrow-right ml-2"/>
            </button>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-black text-white mb-1">{entry.program_name}</h2>
            <p className="text-[13px] text-shTextMuted">Getting your roadmap ready…</p>
          </>
        )}
      </div>

      {/* Quiet secondary context — one card, stacked sections */}
      <div className="bg-black/15 border border-shBorder/60 rounded-2xl p-5 flex flex-col gap-4" data-testid="school-home-summary">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-shTextMuted mb-1.5">Journey</p>
          <div className="h-1.5 rounded-full bg-shBorder/50 overflow-hidden mb-1.5">
            <div className="h-full bg-shPrimary rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, heroMasteredPct || 0))}%` }}/>
          </div>
          <p className="text-[12px] text-shTextMuted">{formatCompletionPct(heroMasteredPct)} through {entry.program_name}</p>
        </div>

        {trainerStatus && (
          <div className="pt-3.5 border-t border-shBorder/50" data-testid="school-trainer-status">
            <p className="text-[10px] font-bold uppercase tracking-widest text-shTextMuted mb-1.5">Trainer</p>
            <StatusChip icon={trainerStatus.icon} label={trainerStatus.label} tone={trainerStatus.tone}/>
          </div>
        )}

        {recentFeedback && (
          <div className="pt-3.5 border-t border-shBorder/50" data-testid="school-recent-feedback">
            <p className="text-[10px] font-bold uppercase tracking-widest text-shTextMuted mb-1.5">Latest feedback</p>
            {recentFeedback.trainer_feedback && (
              <p className="text-[13px] text-shText/90 italic mb-1.5 leading-snug">"{recentFeedback.trainer_feedback.length > 130 ? `${recentFeedback.trainer_feedback.slice(0, 130)}…` : recentFeedback.trainer_feedback}"</p>
            )}
            <button onClick={onViewFeedback} data-testid="school-view-full-feedback" className="text-shBlue font-bold text-[12px]">
              View full feedback <i className="fas fa-arrow-right ml-1"/>
            </button>
          </div>
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

function RubricScoreGroup({ title, overall, criteria, scores }) {
  if (!criteria || criteria.length === 0) return null;
  return (
    <div>
      <p className="text-[12px] font-bold text-shText mb-1.5">
        {title}{overall != null ? <span className="text-shTextMuted font-normal"> — {Number(overall).toFixed(1)}/5</span> : ""}
      </p>
      <div className="space-y-1">
        {criteria.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-2 py-1">
            <p className="text-[12px] text-shTextMuted truncate">{c.name}</p>
            <SkillLevelIndicator score={scores?.[c.id] ?? 0} size="sm"/>
          </div>
        ))}
      </div>
    </div>
  );
}

function CheckpointResultEntry({ entry, expanded, onToggle }) {
  const meta = OUTCOME_META[entry.outcome] || OUTCOME_META.advance;
  const hasRubric = (entry.rubric_snapshot?.handler_criteria?.length || entry.rubric_snapshot?.dog_criteria?.length);
  return (
    <div className="bg-black/15 border border-shBorder/60 rounded-xl p-4" data-testid={`school-history-${entry.id}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-shTextMuted mb-1">Trainer review</p>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-shText truncate">{entry.lesson_name}</p>
          <p className="text-[11px] text-shTextMuted truncate">
            {entry.trainer_name ? `${entry.trainer_name} · ` : ""}{entry.graded_at ? new Date(entry.graded_at).toLocaleDateString() : ""}
          </p>
        </div>
        <div className="shrink-0">
          <StatusChip icon={meta.icon} label={meta.label} tone={meta.tone}/>
        </div>
      </div>
      {entry.trainer_feedback && (
        <p className="text-[13px] text-shText/90 leading-snug mb-2">
          {expanded || entry.trainer_feedback.length <= 140 ? entry.trainer_feedback : `${entry.trainer_feedback.slice(0, 140)}…`}
        </p>
      )}
      {(hasRubric > 0 || entry.trainer_feedback?.length > 140) && (
        <button onClick={onToggle} data-testid={`school-history-${entry.id}-toggle`} className="text-shBlue font-bold text-[12px]">
          {expanded ? "Hide details" : "View full review"} <i className={`fas fa-chevron-${expanded ? "up" : "down"} ml-1 text-[10px]`}/>
        </button>
      )}
      {expanded && hasRubric > 0 && (
        <div className="mt-3 pt-3 border-t border-shBorder/50 space-y-3">
          <div className="grid sm:grid-cols-2 gap-4">
            <RubricScoreGroup title="Handler skills" overall={entry.handler_overall} criteria={entry.rubric_snapshot?.handler_criteria} scores={entry.handler_scores}/>
            <RubricScoreGroup title="Dog performance" overall={entry.dog_overall} criteria={entry.rubric_snapshot?.dog_criteria} scores={entry.dog_scores}/>
          </div>
          <p className="text-[11px] text-shTextMuted italic">Handler and Dog are scored separately — a lower Dog score reflects where your dog is in training, not a handling mistake.</p>
        </div>
      )}
      {/* Online School Phase 4 — Trainer Assist is a SEPARATE later chapter
          of this same checkpoint's story, never overwriting the review
          feedback above it: "why was I held here" (the review, above) vs
          "what happened afterward" (this block). Internal staff notes
          never reach entry.trainer_assist — see _client_safe_trainer_assist. */}
      {entry.trainer_assist && (
        <div className="mt-3 pt-3 border-t border-purple-400/20" data-testid={`school-history-${entry.id}-trainer-assist`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-300 mb-1"><i className="fas fa-handshake mr-1"/>Trainer Assist</p>
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
      )}
    </div>
  );
}

function TrainerFeedbackHistory({ history, expandedId, onToggle }) {
  if (history === null) return null;
  if (history.length === 0) {
    return <EmptyState icon="fa-comment-dots" message="No trainer feedback yet — it'll show up here after your first checkpoint is reviewed." testid="school-feedback-empty"/>;
  }
  return (
    <div className="space-y-2.5" data-testid="school-feedback-history">
      {history.map(entry => (
        <CheckpointResultEntry key={entry.id} entry={entry} expanded={expandedId === entry.id} onToggle={() => onToggle(entry.id)}/>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkpoint panel (submit / awaiting review / prescribed practice / hold)
// ---------------------------------------------------------------------------

function CheckpointPanel({ lessonId, practiced, rubric, status, onSubmit, onGoToRefresher, busy }) {
  const [returnedToCheckpoint, setReturnedToCheckpoint] = useState(false);

  if (!practiced) {
    return (
      <EmptyState icon="fa-video" message="Practice this lesson first, then submit a checkpoint video for your trainer to review." testid="school-checkpoint-needs-practice"/>
    );
  }

  const ta = status?.trainer_assist;

  // Online School Phase 4 — real Trainer Assist lifecycle, not just an
  // on/off hold flag. "This is exactly where having a real trainer
  // helps" — never scary wording, never a fail screen (spec §20).
  if (status?.on_hold && ta) {
    return (
      <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-4" data-testid="school-checkpoint-hold">
        <p className="text-purple-300 font-black text-[15px] mb-1"><i className="fas fa-handshake mr-1.5"/>Your trainer wants to help with this one</p>
        <p className="text-shText/90 text-[13px] mt-1.5">We've paused this checkpoint so we can work through it with you.</p>
        {status.trainer_feedback && <p className="text-shText/90 text-[13px] mt-2 italic">"{status.trainer_feedback}"</p>}
        <div className="mt-3 pt-3 border-t border-purple-400/20" data-testid="school-checkpoint-hold-status">
          {ta.status === "reschedule_needed" ? (
            <p className="text-purple-300 text-[13px] font-bold"><i className="fas fa-calendar-xmark mr-1.5"/>Trainer Assist needs to be rescheduled</p>
          ) : ta.status === "scheduled" ? (
            <p className="text-purple-300 text-[13px] font-bold">
              <i className="fas fa-calendar-check mr-1.5"/>Trainer Assist scheduled{ta.scheduled_date ? ` for ${ta.scheduled_date}${ta.scheduled_time ? ` · ${ta.scheduled_time}` : ""}` : ""}
            </p>
          ) : ta.status === "contacted" ? (
            <p className="text-purple-300 text-[13px] font-bold"><i className="fas fa-comment-dots mr-1.5"/>Your trainer has reached out</p>
          ) : (
            <p className="text-purple-300 text-[13px] font-bold"><i className="fas fa-hourglass-half mr-1.5"/>Trainer is reviewing next steps</p>
          )}
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-[13px] text-shTextMuted"><i className="fas fa-check mr-1.5 text-purple-300"/>Your course progress stays exactly where it is</p>
          <p className="text-[13px] text-shTextMuted"><i className="fas fa-check mr-1.5 text-purple-300"/>You'll continue from here once cleared</p>
        </div>
      </div>
    );
  }

  // Trainer Assist complete — the hold has been lifted, but this same
  // submission still holds the client-facing follow-up summary until the
  // client resubmits. "Return to Checkpoint" is a local reveal step, not
  // a fabricated success — it just opens the same submit form below.
  if (!status?.on_hold && ta?.status === "completed" && !returnedToCheckpoint) {
    return (
      <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-4" data-testid="school-checkpoint-assist-complete">
        <p className="text-purple-300 font-black text-[15px] mb-1"><i className="fas fa-circle-check mr-1.5"/>Trainer Assist complete</p>
        {ta.client_summary && <p className="text-shText/90 text-[13px] mt-1.5">{ta.client_summary}</p>}
        <button onClick={() => setReturnedToCheckpoint(true)} data-testid="school-checkpoint-return-to-checkpoint"
                className="mt-3 w-full bg-shPrimary text-bgHeader py-2.5 rounded-xl font-black text-[13px] uppercase tracking-widest">
          You're ready to keep training <i className="fas fa-arrow-right ml-2"/>
        </button>
      </div>
    );
  }

  if (status?.status === "awaiting_review") {
    return (
      <div className="bg-shAccent/10 border border-shAccent/30 rounded-xl p-4 text-center" data-testid="school-checkpoint-awaiting-review">
        <i className="fas fa-hourglass-half text-shAccent text-xl mb-2"/>
        <p className="text-shAccent font-black text-[15px]">Your video is with your trainer</p>
        <p className="text-shTextMuted text-[12px] mt-1">You'll get an email when your review is ready.</p>
      </div>
    );
  }

  if (status?.status === "graded" && status.outcome === "prescribe_practice") {
    const p = status.prescription || {};
    const remaining = p.practice_sessions_remaining;
    const canResubmit = !remaining || remaining <= 0;
    const actionLabel = p.action === "assign_refresher_lesson" && p.refresher_lesson_name
      ? `Refresher lesson: ${p.refresher_lesson_name}`
      : p.action === "assign_recipe" ? "New practice assigned"
      : "Repeat this lesson's practice";
    return (
      <div className="space-y-3" data-testid="school-checkpoint-prescribed">
        <div className="bg-shAccent/10 border border-shAccent/30 rounded-xl p-4">
          <p className="text-shAccent font-black text-[15px] mb-1"><i className="fas fa-clipboard-list mr-1.5"/>Your trainer's plan</p>
          <p className="text-shText/90 text-[13px] mb-2">You're making progress — let's clean up one piece before moving on.</p>
          {status.trainer_feedback && <p className="text-shText/90 text-[13px] italic mb-2">"{status.trainer_feedback}"</p>}
          <p className="text-shText text-[13px] font-bold"><i className="fas fa-arrow-right mr-1.5"/>{actionLabel}</p>
          {p.min_practice_sessions_required > 0 && (
            <p className="text-shTextMuted text-[12px] mt-2" data-testid="school-checkpoint-remaining">
              {remaining > 0 ? `Practice ${remaining} more time${remaining !== 1 ? "s" : ""} before resubmitting.` : "You're ready to resubmit."}
            </p>
          )}
          {p.action === "assign_refresher_lesson" && p.refresher_lesson_id && (
            <button onClick={() => onGoToRefresher(p.refresher_lesson_id)} data-testid="school-checkpoint-go-to-refresher"
                    className="mt-2 text-shAccent font-bold text-[12px]">
              Go to refresher lesson <i className="fas fa-arrow-right ml-1"/>
            </button>
          )}
        </div>
        {canResubmit && <CheckpointSubmitForm rubric={rubric} onSubmit={(v, f, n) => onSubmit(lessonId, v, f, n)} busy={busy} resubmit/>}
      </div>
    );
  }

  // not_submitted (or already graded+advanced, which won't render here —
  // once advanced this lesson is no longer "current" so the roadmap simply
  // moves on without this panel ever showing that state).
  return <CheckpointSubmitForm rubric={rubric} onSubmit={(v, f, n) => onSubmit(lessonId, v, f, n)} busy={busy}/>;
}

function CheckpointSubmitForm({ rubric, onSubmit, busy, resubmit }) {
  const [videoFile, setVideoFile] = useState(null);
  const [videoDataUrl, setVideoDataUrl] = useState("");
  const [videoErr, setVideoErr] = useState("");
  const [note, setNote] = useState("");
  const isFinal = rubric?.assessment_type === "final_assessment";

  const onVideoUpload = (file, err) => {
    if (err) { setVideoErr(err); return; }
    setVideoErr("");
    setVideoFile(file);
    const reader = new FileReader();
    reader.onload = () => setVideoDataUrl(reader.result || "");
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2.5" data-testid="school-checkpoint-submit-form">
      {!resubmit && (
        <p className="text-[15px] font-black text-shText">
          {isFinal ? "Stage Final Assessment — show us you can do it" : "Show us you can do it"}
        </p>
      )}
      {rubric?.submission_instructions && (
        <div className="bg-shBlue/5 border border-shBlue/20 rounded-lg p-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-shBlue mb-1"><i className="fas fa-circle-info mr-1.5"/>Filming instructions</p>
          <p className="text-[13px] text-shText/90 whitespace-pre-wrap">{rubric.submission_instructions}</p>
        </div>
      )}
      <PracticeMediaUploader
        photo="" onPhotoChange={() => {}} allowPhoto={false} allowVideo videoMaxMb={10}
        videoId={videoFile ? "ready" : ""} videoName={videoFile?.name}
        onVideoUpload={onVideoUpload}
        onVideoClear={() => { setVideoFile(null); setVideoDataUrl(""); }}
        testid="school-checkpoint-video"
      />
      {videoErr && <p className="text-shDanger text-[12px] font-bold">{videoErr}</p>}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything you want your trainer to know? (optional)"
                data-testid="school-checkpoint-note"
                className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
      <p className="text-[11px] text-shTextMuted">Your trainer will review your handling AND your dog's performance.</p>
      <button onClick={() => onSubmit(videoDataUrl, videoFile?.name || "", note)} disabled={!videoDataUrl || busy}
              data-testid="school-checkpoint-submit"
              className="w-full bg-shPrimary text-bgHeader py-3 rounded-xl font-black text-[15px] shadow-lg shadow-shPrimary/20 disabled:opacity-50">
        <i className="fas fa-video mr-2"/>Submit for trainer review
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help / Graduation
// ---------------------------------------------------------------------------

function HelpView({ stuckReason, onSelectReason, hasCurrentLesson, onOpenCurrentLesson, onContactTrainer }) {
  const selected = STUCK_REASONS.find(r => r.key === stuckReason);
  return (
    <div data-testid="school-help">
      <h3 className="text-2xl font-black text-white mb-1">Need a hand?</h3>
      <p className="text-[13px] text-shTextMuted mb-4">Tell us what's happening and we'll point you in the right direction.</p>
      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        {STUCK_REASONS.map(r => (
          <button key={r.key} onClick={() => onSelectReason(r.key)} data-testid={`school-stuck-${r.key}`}
                  className={`flex items-center gap-2.5 text-left px-3.5 py-3 rounded-xl transition ${stuckReason === r.key ? "bg-shBlue/15 text-shBlue" : "bg-black/15 text-shText hover:bg-black/25"}`}>
            <i className={`fas ${r.icon} text-[14px] w-4 text-center shrink-0`}/>
            <span className="text-[13px] font-bold">{r.label}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="bg-black/15 border border-shBorder/60 rounded-xl p-4 mb-4 space-y-2">
          <p className="text-[13px] text-shText/90 leading-snug">{STUCK_TIPS[stuckReason]}</p>
          {hasCurrentLesson && (
            <button onClick={onOpenCurrentLesson} data-testid="school-stuck-open-lesson" className="text-shBlue font-bold text-[12px]">
              Review current lesson <i className="fas fa-arrow-right ml-1"/>
            </button>
          )}
        </div>
      )}
      <button onClick={onContactTrainer} data-testid="school-contact-trainer" disabled={!onContactTrainer}
              className={`${stuckReason === "need_trainer" ? "w-full bg-shPrimary text-bgHeader py-3.5 rounded-xl font-black text-[15px] shadow-lg shadow-shPrimary/20" : "text-shTextMuted hover:text-shText font-bold text-[13px]"} disabled:opacity-50`}>
        <i className="fas fa-comment mr-2"/>Contact your trainer
      </button>
    </div>
  );
}

function GraduationView({ dogName, dogPhoto, programName, completionSummary, onViewFeedback, onViewAchievements }) {
  const stats = completionSummary ? [
    completionSummary.completed_at ? { label: "Completed", value: new Date(completionSummary.completed_at).toLocaleDateString() } : null,
    { label: "Modules", value: completionSummary.total_modules },
    { label: "Lessons", value: completionSummary.total_lessons },
    completionSummary.checkpoints_passed > 0 ? { label: "Checkpoints passed", value: completionSummary.checkpoints_passed } : null,
    completionSummary.practice_sessions_logged > 0 ? { label: "Practice sessions", value: completionSummary.practice_sessions_logged } : null,
  ].filter(Boolean) : [];

  return (
    <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6" data-testid="school-graduation">
      {/* Celebration */}
      <div className="text-center lg:text-left">
        <div className="relative inline-block mb-4">
          <div className="absolute inset-0 rounded-full bg-shPrimary/25 blur-2xl"/>
          <Avatar src={dogPhoto} icon="fa-paw" size="lg" ring="border-shPrimary" alt={dogName}/>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-shPrimary grid place-items-center border-2 border-bgPanel">
            <i className="fas fa-graduation-cap text-bgHeader text-[12px]"/>
          </div>
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-shPrimary mb-1">Congratulations</p>
        <h2 className="text-4xl font-black text-white leading-tight mb-2">{dogName}</h2>
        <p className="text-[15px] text-shTextMuted mb-6">completed <span className="text-shText font-bold">{programName}</span></p>

        <button onClick={() => printSchoolCertificate({ dogName, programName, completionSummary })} data-testid="school-download-certificate"
                className="bg-shPrimary text-bgHeader px-8 py-3.5 rounded-xl font-black text-[15px] shadow-lg shadow-shPrimary/25 hover:brightness-110 transition">
          <i className="fas fa-award mr-2"/>Certificate of Completion
        </button>
      </div>

      {/* Report card */}
      <div className="bg-black/15 border border-shBorder/60 rounded-2xl p-5">
        {stats.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 pb-4 mb-4 border-b border-shBorder/50 text-[13px]">
            {stats.map(s => (
              <span key={s.label} className="text-shTextMuted">{s.value} <span className="text-shTextMuted/70">{s.label.toLowerCase()}</span></span>
            ))}
          </div>
        )}

        {completionSummary?.final_assessment && (
          <div className="mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-shTextMuted mb-2">Final report</p>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <p className="text-[11px] text-shTextMuted mb-0.5">Handler</p>
                <p className="text-2xl font-black text-shPrimary">{Number(completionSummary.final_assessment.handler_overall ?? 0).toFixed(1)}<span className="text-[13px] text-shTextMuted">/5</span></p>
              </div>
              <div>
                <p className="text-[11px] text-shTextMuted mb-0.5">Dog</p>
                <p className="text-2xl font-black text-shPrimary">{Number(completionSummary.final_assessment.dog_overall ?? 0).toFixed(1)}<span className="text-[13px] text-shTextMuted">/5</span></p>
              </div>
            </div>
            {completionSummary.final_assessment.trainer_feedback && (
              <p className="text-[13px] text-shText/90 italic leading-snug">"{completionSummary.final_assessment.trainer_feedback}"</p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onViewFeedback} data-testid="school-graduation-view-feedback"
                  className="flex-1 text-shTextMuted hover:text-shText font-bold text-[12px] py-2">
            View my feedback
          </button>
          <button onClick={onViewAchievements} data-testid="school-graduation-view-achievements"
                  className="flex-1 text-shTextMuted hover:text-shText font-bold text-[12px] py-2">
            View achievements
          </button>
        </div>
      </div>
    </div>
  );
}

function Overlay({ children, onClose, testid }) {
  return (
    <div className="fixed inset-0 bg-black/85 z-50 overflow-y-auto" data-testid={testid}>
      <div className="min-h-full flex items-start justify-center p-3 sm:p-6">
        <div className="w-full max-w-3xl bg-bgPanel border border-shBorder rounded-2xl shadow-2xl">
          <div className="sticky top-0 bg-bgPanel border-b border-shBorder px-4 py-3 flex items-center justify-between rounded-t-2xl z-10">
            <p className="text-[13px] font-black uppercase tracking-[0.3em] text-shPrimary"><i className="fas fa-graduation-cap mr-1.5"/>Sit Happens Online School</p>
            <button onClick={onClose} data-testid="online-school-close" className="text-shTextMuted hover:text-shText text-xl px-2"><i className="fas fa-times"/></button>
          </div>
          <div className="p-4 sm:p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
