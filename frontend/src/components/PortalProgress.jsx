// Training-school expansion, Phase 6 — client-facing "Progress" view.
// Individual, never comparative — a slower dog is never framed as behind.
//
// UI Phase 4 — visual redesign. Same /portal/progress + /portal/session-
// recaps contracts as before, plus the existing /portal/trophies data
// (already fetched elsewhere in Portal.jsx for the Trophy Wall) refetched
// here specifically for the restrained Achievements list — no parallel
// progress/streak calculation anywhere in this file.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Avatar from "./Avatar";
import ProgramRoadmap from "./training/ProgramRoadmap";
import ProgressSummary from "./training/ProgressSummary";
import SkillProgressCard from "./training/SkillProgressCard";
import AchievementCard from "./training/AchievementCard";
import SessionRecapCard from "./training/SessionRecapCard";
import TrainingReportCard from "./training/TrainingReportCard";
import EmptyState from "./training/EmptyState";
import { filterSkills, deriveStrongestSkill, deriveRecentWin } from "../lib/clientLearningPolish";

const FILTERS = [
  { key: "all", label: "All Skills" },
  { key: "current_module", label: "Current Module" },
  { key: "needs_practice", label: "Needs Practice" },
  { key: "reliable", label: "Reliable" },
  { key: "mastered", label: "Mastered" },
];

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function PortalProgress({ homework = [] }) {
  const [data, setData] = useState(null);
  const [recaps, setRecaps] = useState([]);
  const [trophies, setTrophies] = useState({ client_trophies: [], dog_trophies: [] });
  const [activeDogId, setActiveDogId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    api.get("/portal/progress").then(({ data }) => {
      setData(data);
      if (data?.length > 0) setActiveDogId(d => d || data[0].dog_id);
    }).catch(() => setData([]));
    api.get("/portal/session-recaps").then(({ data }) => setRecaps(data)).catch(() => setRecaps([]));
    api.get("/portal/trophies").then(({ data }) => setTrophies(data)).catch(() => {});
  }, []);

  if (!data || data.length === 0) return null;
  const entry = data.find(d => d.dog_id === activeDogId) || data[0];
  const dogRecaps = recaps.filter(r => r.dog_id === entry.dog_id);
  const dogTrophies = trophies.dog_trophies.filter(t => t.recipient_id === entry.dog_id);
  const currentModuleSkillIds = new Set((entry.current_skills || []).map(s => s.id));
  const visibleSkills = filterSkills(entry.current_skills || [], filter, currentModuleSkillIds);
  const homeworkBySkill = new Map(homework.filter(h => h.source_skill_id).map(h => [h.source_skill_id, h.title]));

  const roadmap = [
    ...entry.completed_modules.map(m => ({ id: m.id, name: m.name, status: "completed", lessons: [] })),
    ...(entry.current_module_name ? [{ id: "__current__", name: entry.current_module_name, status: "current", lessons: [] }] : []),
  ];

  return (
    <div id="portal-progress-anchor" data-testid="portal-progress">
      <div className="mb-3 flex items-end justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-1">
            <i className="fas fa-chart-line mr-1.5"/>How You&apos;re Doing
          </p>
          <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Progress.</h2>
        </div>
        {data.length > 1 && (
          <div className="flex gap-1.5" data-testid="progress-dog-selector">
            {data.map(d => (
              <button key={d.dog_id} onClick={() => setActiveDogId(d.dog_id)} data-testid={`progress-dog-select-${d.dog_id}`}
                      className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full border ${d.dog_id === entry.dog_id ? "bg-shGreen/15 border-shGreen text-shGreen" : "border-shBorder text-shTextMuted"}`}>
                {d.dog_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 bg-black/20 border border-shBorder rounded-xl p-3 mb-4" data-testid={`progress-dog-${entry.dog_id}`}>
        <Avatar src={entry.dog_photo} icon="fa-paw" size="md" alt={entry.dog_name}/>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-black text-shText truncate">{entry.dog_name} · {entry.program_name}</p>
          {entry.total_weeks > 0 && <p className="text-[12px] text-shTextMuted">Week {entry.current_week} of {entry.total_weeks}</p>}
        </div>
        {entry.program_status === "completed" && (
          <button onClick={() => scrollToId("portal-training-anchor")} data-testid="progress-certificate-banner"
                  className="shrink-0 bg-shAccent/15 text-shAccent border border-shAccent/40 px-3 py-1.5 rounded-lg font-black text-[11px] uppercase tracking-widest">
            <i className="fas fa-award mr-1"/>Certificate Earned
          </button>
        )}
      </div>

      <div className="mb-4">
        <ProgressSummary
          completionPct={entry.mastered_pct}
          currentModuleName={entry.current_module_name}
          reliableCount={(entry.current_skills || []).filter(s => s.level_label === "Reliable").length}
          masteredCount={(entry.current_skills || []).filter(s => s.level_label === "Mastered").length}
          practiceSessions={dogRecaps.length}
          assessmentsPassed={(entry.current_skills || []).filter(s => s.level_label === "Mastered").length}
          testid="progress-summary"
        />
      </div>

      {roadmap.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Module Journey</p>
          <ProgramRoadmap modules={roadmap} testid="progress-roadmap"/>
        </div>
      )}

      <div className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Skills</p>
          <button onClick={() => setReportOpen(true)} data-testid="progress-open-report-card"
                  className="text-[11px] font-black uppercase tracking-widest text-shSecondary">
            <i className="fas fa-file-lines mr-1"/>View Report Card
          </button>
        </div>
        <div className="flex gap-1.5 flex-wrap mb-3" data-testid="progress-skill-filters">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} data-testid={`progress-filter-${f.key}`}
                    className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-full border ${filter === f.key ? "bg-shSecondary/15 border-shSecondary text-shSecondary" : "border-shBorder text-shTextMuted"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {visibleSkills.length === 0 ? (
          <EmptyState icon="fa-paw" message="No skills scored yet — check back after the first session." testid="progress-skills-empty"/>
        ) : (
          <div className="space-y-2">
            {visibleSkills.map(s => (
              <SkillProgressCard key={s.id} skill={s} homeworkTitle={homeworkBySkill.get(s.id)}
                                  onReviewLesson={() => scrollToId("portal-learn-anchor")}
                                  testid={`progress-skill-${s.id}`}/>
            ))}
          </div>
        )}
      </div>

      {dogTrophies.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Achievements</p>
          <div className="space-y-2" data-testid="progress-achievements">
            {dogTrophies.map(t => (
              <AchievementCard key={t.id} trophy={t} testid={`progress-achievement-${t.id}`}/>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Session History</p>
        {dogRecaps.length === 0 ? (
          <EmptyState icon="fa-calendar-check" message="No completed sessions yet." testid="progress-history-empty"/>
        ) : (
          <div className="space-y-2" data-testid="progress-session-history">
            {dogRecaps.slice(0, 10).map((r, i) => <SessionRecapCard key={i} recap={r} testid={`progress-recap-${i}`}/>)}
          </div>
        )}
      </div>

      {reportOpen && (
        <TrainingReportCard
          dog={entry} progress={entry}
          strongestSkill={deriveStrongestSkill(entry.current_skills)}
          recentWin={deriveRecentWin(dogRecaps)}
          onClose={() => setReportOpen(false)}
          testid="progress-report-card"
        />
      )}
    </div>
  );
}
