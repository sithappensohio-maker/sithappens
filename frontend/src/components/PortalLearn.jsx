// Training-school expansion, Phase 6 — client-facing "Learn" curriculum
// browser. Read-only: shows only unlocked modules/lessons with client-safe
// fields (the backend never even sends trainer-only fields — nothing to
// hide here client-side).
//
// UI Phase 4 — visual course-library redesign. Same /portal/learn contract,
// same self-contained fetch; `homework` is an OPTIONAL prop (Portal.jsx
// already has it loaded) used only to cross-reference "Related Homework" on
// a lesson's detail — no new fetch introduced here for it.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Avatar from "./Avatar";
import ProgramRoadmap from "./training/ProgramRoadmap";
import LessonCard from "./training/LessonCard";
import LessonDetailPanel from "./training/LessonDetailPanel";
import EmptyState from "./training/EmptyState";
import { buildModuleRoadmap, buildLessonCards, lockedLessonExplanation } from "../lib/clientLearningPolish";

export default function PortalLearn({ homework = [] }) {
  const [data, setData] = useState(null);
  const [activeDogId, setActiveDogId] = useState(null);
  const [detailLesson, setDetailLesson] = useState(null);

  useEffect(() => {
    api.get("/portal/learn").then(({ data }) => {
      setData(data);
      if (data?.length > 0) setActiveDogId(d => d || data[0].dog_id);
    }).catch(() => setData([]));
  }, []);

  if (!data || data.length === 0) return null;
  const entry = data.find(d => d.dog_id === activeDogId) || data[0];
  const roadmap = buildModuleRoadmap(entry);
  const currentModule = entry.modules.find(m => m.is_current);

  const openLesson = (lesson, module) => {
    const lessons = (module.lessons || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = lessons.findIndex(l => l.id === lesson.id);
    const next = lessons[idx + 1];
    setDetailLesson({
      lesson,
      nextLessonName: next ? next.name : (module.lockedLessonCount > 0 ? `${module.lockedLessonCount} more in this module` : null),
      relatedHomeworkTitles: homework.filter(h => h.source_lesson_id === lesson.id).map(h => h.title),
    });
  };

  return (
    <div id="portal-learn-anchor" data-testid="portal-learn">
      <div className="mb-3 flex items-end justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-1">
            <i className="fas fa-book-open mr-1.5"/>Course Library
          </p>
          <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Learn.</h2>
        </div>
        {data.length > 1 && (
          <div className="flex gap-1.5" data-testid="learn-dog-selector">
            {data.map(d => (
              <button key={d.dog_id} onClick={() => setActiveDogId(d.dog_id)} data-testid={`learn-dog-${d.dog_id}`}
                      className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full border ${d.dog_id === activeDogId ? "bg-shPrimary/15 border-shPrimary text-shPrimary" : "border-shBorder text-shTextMuted"}`}>
                {d.dog_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compact program header — dog identity + program/module context,
          kept short so lessons stay near the top of a mobile screen. */}
      <div className="flex items-center gap-3 bg-black/20 border border-shBorder rounded-xl p-3 mb-4" data-testid="learn-program-header">
        <Avatar src={entry.dog_photo} icon="fa-paw" size="md" alt={entry.dog_name}/>
        <div className="min-w-0">
          <p className="text-[14px] font-black text-shText truncate">{entry.dog_name}</p>
          <p className="text-[12px] text-shTextMuted truncate">{entry.program_name}{entry.current_module_name ? ` · ${entry.current_module_name}` : ""}</p>
        </div>
      </div>

      <ProgramRoadmap
        modules={roadmap}
        testid="learn-roadmap"
        renderModuleBody={(m) => {
          if (m.status === "locked") {
            return <EmptyState icon="fa-lock" message={m.description} testid="learn-roadmap-locked"/>;
          }
          const cards = buildLessonCards(m);
          if (cards.length === 0) return <EmptyState icon="fa-book-open" message="No lessons in this module yet." testid={`learn-module-${m.id}-empty`}/>;
          return (
            <div className="space-y-2">
              {cards.map(card => (
                <LessonCard
                  key={card.id}
                  name={card.name} overview={card.overview} estimatedMinutes={card.estimatedMinutes}
                  status={card.status} hasVideo={card.hasVideo}
                  lockedReason={card.status === "locked" ? lockedLessonExplanation({ isCurrentModule: true }) : null}
                  actionLabel={card.status !== "locked" ? (card.status === "current" ? "Resume" : "Review") : null}
                  onAction={card.status !== "locked" ? () => openLesson(card.lesson, m) : undefined}
                  testid={`learn-lesson-${card.id}`}
                />
              ))}
            </div>
          );
        }}
      />

      {!currentModule && roadmap.every(m => m.status === "locked") && (
        <EmptyState icon="fa-graduation-cap" message="No unlocked lessons yet — your trainer will open the first module soon." testid="learn-no-lessons"/>
      )}

      {detailLesson && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4" onClick={() => setDetailLesson(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
            <div className="px-5 py-4 border-b border-shBorder flex items-center justify-between shrink-0">
              <h3 className="text-base font-black text-shText uppercase tracking-tight truncate">{detailLesson.lesson.name}</h3>
              <button onClick={() => setDetailLesson(null)} data-testid="learn-lesson-detail-close" className="text-shTextMuted hover:text-shText text-xl px-2 shrink-0"><i className="fas fa-times"/></button>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4">
              <LessonDetailPanel
                lesson={detailLesson.lesson}
                nextLessonName={detailLesson.nextLessonName}
                relatedHomeworkTitles={detailLesson.relatedHomeworkTitles}
                testid="learn-lesson-detail"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
