import { useEffect, useState, useMemo, useRef } from "react";
import { api } from "../lib/api";
import PageHero from "../components/PageHero";
import ReviewRequestButton from "../components/ReviewRequestButton";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import TrainingTrackerModal from "../components/TrainingTrackerModal";
import CsvImportButton from "../components/CsvImportButton";
import { parseTrainingTipsCsv, TRAINING_TIPS_CSV_SAMPLE } from "../lib/csvImport";
import { toast } from "sonner";

const STATUS_META = {
  active: { label: "Active", color: "#8cc63f", icon: "fa-play" },
  on_hold: { label: "On Hold", color: "#f59e0b", icon: "fa-pause" },
  completed: { label: "Completed", color: "#00a9e0", icon: "fa-flag-checkered" },
  withdrawn: { label: "Withdrawn", color: "#64748b", icon: "fa-xmark" },
};

const TYPE_META = {
  private_lessons: { label: "Private Lessons", color: "#00a9e0" },
  board_train: { label: "Board & Train", color: "#8cc63f" },
  service_dog: { label: "Service Dog", color: "#a855f7" },
  custom: { label: "Custom", color: "#ec4899" },
};

const GOAL_STATUS_META = {
  not_started: { label: "—", color: "#64748b" },
  in_progress: { label: "WIP", color: "#f59e0b" },
  mastered: { label: "✓", color: "#8cc63f" },
};

/** Admin "all dogs in training" overview. Lives at the "Pipeline" nav item.
    Sprint 110cc — click a row to expand and edit trainer notes + per-goal
    progress inline; no need to jump to the dog page first. */
export default function Pipeline({ onJumpToDog }) {
  const [rows, setRows] = useState([]);
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterType, setFilterType] = useState("");
  const [filterStalled, setFilterStalled] = useState(false);
  const [trainerFilter, setTrainerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  // Sprint 110di-72 — Training Hub upgrades: tip-of-day, training-tracker modal pop, action launchers
  const [todayTip, setTodayTip] = useState(null);
  const [trackerFor, setTrackerFor] = useState(null);

  const load = async () => {
    setLoading(true);
    const params = {};
    if (filterStatus) params.status = filterStatus;
    if (filterType) params.type = filterType;
    if (search) params.search = search;
    if (trainerFilter) params.trainer = trainerFilter;
    if (filterStalled) params.stalled_days = 7;
    try {
      const { data } = await api.get("/programs/pipeline", { params });
      setRows(data);
    } catch { setRows([]); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filterStatus, filterType, filterStalled, trainerFilter]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useLiveRefresh(load, { intervalMs: 30_000 });
  // Sprint 110di-72 — load today's training tip once
  useEffect(() => {
    api.get("/training-tips/today")
      .then(r => setTodayTip(r.data?.tip || null))
      .catch(() => setTodayTip(null));
  }, []);

  const stats = useMemo(() => {
    const s = { active: 0, on_hold: 0, completed: 0, overdue: 0 };
    rows.forEach(r => {
      if (s[r.status] != null) s[r.status]++;
      if (r.status === "active" && r.days_to_target != null && r.days_to_target < 0) s.overdue++;
    });
    return s;
  }, [rows]);

  return (
    <>
    <div className="p-8 max-w-7xl mx-auto space-y-6" data-testid="pipeline-screen">
      <PageHero
        eyebrow={{ icon: "fa-graduation-cap", text: "Training Hub", color: "text-shGreen" }}
        title="Training Hub."
        highlight="Every dog. One view."
        subtitle="Active enrollments, current week, last trainer, stalled dogs — all on one page. Open the tracker without leaving."
        right={(
          <div className="flex gap-2 flex-wrap">
            <Stat label="Active" value={stats.active} color="#8cc63f" />
            <Stat label="On Hold" value={stats.on_hold} color="#f59e0b" />
            <Stat label="Completed" value={stats.completed} color="#00a9e0" />
            {stats.overdue > 0 && <Stat label="Overdue" value={stats.overdue} color="#ef4444" />}
          </div>
        )}
        testid="pipeline-hero"
      />

      {/* Sprint 110di-72 — Training Tip of the Day */}
      {todayTip && (
        <div data-testid="training-tip-card"
             className="bg-bgPanel border-l-4 border-shGreen rounded-r-xl p-4 sm:p-5 shadow-md card-info">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-1">
                <i className="fas fa-lightbulb mr-1.5"/>Training tip of the day · {todayTip.category?.replace(/_/g, " ")}
              </p>
              <p className="text-white text-[15px] leading-relaxed">{todayTip.tip}</p>
              {todayTip.source && (
                <p className="text-gray-500 text-[11px] mt-1">— {todayTip.source}</p>
              )}
            </div>
            <CsvImportButton
              label="Import Tips CSV"
              parse={parseTrainingTipsCsv}
              sampleText={TRAINING_TIPS_CSV_SAMPLE}
              sampleFilename="training-tips-template.csv"
              testIdPrefix="tips-csv"
              helpText="Columns: tip (required), category, difficulty, audience, source, active."
              onImport={async (parsed) => {
                if (!parsed?.rows?.length) return;
                try {
                  const { data } = await api.post("/training-tips/import", { rows: parsed.rows });
                  toast.success(`Imported ${data.imported} training tip${data.imported === 1 ? "" : "s"}`);
                  // Refresh tip-of-day in case the new pool changes today's pick
                  api.get("/training-tips/today").then(r => setTodayTip(r.data?.tip || null)).catch(() => {});
                } catch (e) {
                  toast.error(e?.response?.data?.detail || "Tips import failed");
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5 items-center" data-testid="pipeline-filters">
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search dog, client, program…"
               data-testid="pipeline-search"
               className="flex-1 min-w-[200px] bg-bgPanel border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
        <FilterChip label="All Statuses" value="" current={filterStatus} onClick={setFilterStatus} />
        {Object.entries(STATUS_META).map(([k, m]) => (
          <FilterChip key={k} label={m.label} value={k} current={filterStatus} onClick={setFilterStatus} color={m.color} />
        ))}
        <div className="w-full md:w-auto md:ml-2">
          <select value={filterType} onChange={(e)=>setFilterType(e.target.value)} data-testid="pipeline-type-filter"
                  className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
            <option value="">All Types</option>
            {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>
        <input value={trainerFilter} onChange={(e)=>setTrainerFilter(e.target.value)}
               placeholder="Filter by trainer…"
               data-testid="pipeline-trainer-filter"
               className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm w-48"/>
        <button onClick={() => setFilterStalled(s => !s)}
                data-testid="pipeline-stalled-filter"
                className={`px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest border transition ${
                  filterStalled
                    ? "bg-red-500/20 text-red-300 border-red-500/40"
                    : "bg-bgPanel text-gray-400 border-bgHover hover:text-white"
                }`}>
          <i className="fas fa-triangle-exclamation mr-1"/>Stalled 7d+
        </button>
      </div>

      <div className="card-stat rounded-xl overflow-hidden shadow-lg">
        {loading && <p className="p-8 text-center text-gray-500 text-sm"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="p-12 text-center text-gray-500 text-sm">No enrollments match these filters.</p>
        )}
        {!loading && rows.length > 0 && (
          <div className="divide-y divide-bgHover">
            {rows.map(r => (
              <Row
                key={r.id}
                row={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onJumpToDog={onJumpToDog}
                onOpenTracker={() => setTrackerFor({ dog_id: r.dog_id, enrollment_id: r.id })}
                onSaved={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>

    {trackerFor && (
      <TrainingTrackerModal
        dogId={trackerFor.dog_id}
        enrollmentId={trackerFor.enrollment_id}
        onClose={() => setTrackerFor(null)}
        onSaved={() => { setTrackerFor(null); load(); }}
        onJumpToDog={onJumpToDog}
      />
    )}
    </>
  );
}

function Row({ row, expanded, onToggle, onJumpToDog, onOpenTracker, onSaved }) {
  const sm = STATUS_META[row.status] || STATUS_META.active;
  const tm = TYPE_META[row.program_snapshot?.type] || TYPE_META.private_lessons;
  const overdue = row.status === "active" && row.days_to_target != null && row.days_to_target < 0;
  const hasNotes = (row.trainer_notes || "").trim().length > 0;

  return (
    <div data-testid={`pipeline-row-${row.id}`}>
      <button
        onClick={onToggle}
        data-testid={`pipeline-row-toggle-${row.id}`}
        className="w-full px-4 py-3 hover:bg-bgHover/30 text-left transition flex items-center gap-3"
      >
        {row.dog_photo
          ? <img src={row.dog_photo} alt={row.dog_name} loading="lazy" decoding="async" className="w-10 h-10 rounded-full object-cover border border-bgHover shrink-0" />
          : <div className="w-10 h-10 rounded-full bg-bgBase border border-bgHover flex items-center justify-center shrink-0 text-shGreen"><i className="fas fa-paw"/></div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-white">{row.dog_name}</p>
            <span className="text-[14px] text-gray-500">·</span>
            <p className="text-[15px] text-gray-400 truncate">{row.client_name}</p>
            <span className="text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded" style={{color: tm.color, background: tm.color+"15", border: `1px solid ${tm.color}40`}}>{tm.label}</span>
            {hasNotes && (
              <span className="text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-shBlue/15 text-shBlue border border-shBlue/40" title="Has trainer notes">
                <i className="fas fa-note-sticky mr-1"/>Notes
              </span>
            )}
            {overdue && <span className="text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40"><i className="fas fa-triangle-exclamation mr-1"/>Overdue {Math.abs(row.days_to_target)}d</span>}
          </div>
          <p className="text-[15px] text-gray-300 mt-1 truncate">{row.program_snapshot?.name}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="flex-1 max-w-xs h-2 bg-bgBase rounded-full overflow-hidden border border-bgHover">
              <div className="h-full transition-all" style={{width: `${row.mastered_pct||0}%`, background: tm.color}} />
            </div>
            <span className="text-[14px] text-gray-400 font-black tabular-nums whitespace-nowrap">{row.mastered_pct}% · {row.mastered_goals}/{row.total_goals}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-[13px] font-black uppercase tracking-widest px-2 py-1 rounded" style={{color: sm.color, background: sm.color+"15", border: `1px solid ${sm.color}40`}}>
            <i className={`fas ${sm.icon} mr-1`}/>{sm.label}
          </span>
          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-1">
            {row.days_since_start != null ? `${row.days_since_start}d in` : "—"}
            {row.target_completion_date && ` · ${row.days_to_target >= 0 ? row.days_to_target + "d left" : Math.abs(row.days_to_target) + "d over"}`}
          </p>
        </div>
        <i className={`fas ${expanded ? "fa-chevron-up" : "fa-chevron-down"} text-gray-500 ml-2 shrink-0`}/>
      </button>

      {expanded && (
        <ExpandedDetail row={row} onJumpToDog={onJumpToDog} onSaved={onSaved} />
      )}
      {/* Sprint 110di-72 — Quick actions + last-session ribbon */}
      <div className="border-t border-bgHover/60 bg-bgBase/40 px-4 py-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-gray-500 font-black uppercase tracking-widest">
          <i className="fas fa-clock mr-1"/>
          Last session: {row.last_session_at
            ? `${new Date(row.last_session_at).toLocaleDateString([], {month:"short",day:"numeric"})} · ${row.last_trainer_name || "Trainer"}`
            : "Never"}
        </span>
        {row.is_stalled && (
          <span className="bg-red-500/15 text-red-300 border border-red-500/30 px-2 py-0.5 rounded font-black uppercase tracking-widest"
                data-testid={`stalled-tag-${row.id}`}>
            <i className="fas fa-triangle-exclamation mr-1"/>Stalled
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button onClick={(e)=>{ e.stopPropagation(); onOpenTracker(); }}
                  data-testid={`hub-open-tracker-${row.id}`}
                  className="bg-shGreen/15 text-shGreen border border-shGreen/40 px-2 py-1 rounded font-black uppercase tracking-widest hover:bg-shGreen/25">
            <i className="fas fa-paw mr-1"/>Tracker
          </button>
          {onJumpToDog && (
            <button onClick={(e)=>{ e.stopPropagation(); onJumpToDog(row.dog_id); }}
                    data-testid={`hub-open-dog-${row.id}`}
                    className="bg-shBlue/15 text-shBlue border border-shBlue/40 px-2 py-1 rounded font-black uppercase tracking-widest hover:bg-shBlue/25">
              <i className="fas fa-dog mr-1"/>Dog Profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpandedDetail({ row, onJumpToDog, onSaved }) {
  const [notes, setNotes] = useState(row.trainer_notes || "");
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);

  const persistNotes = async (val) => {
    setSaving(true);
    try {
      await api.put(`/dogs/${row.dog_id}/programs/${row.id}`, { trainer_notes: val });
      setSavedAt(Date.now());
      onSaved?.();
    } catch (e) {
      console.error("save notes failed", e);
    }
    setSaving(false);
  };

  const onNotesChange = (val) => {
    setNotes(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistNotes(val), 800);
  };

  const updateGoal = async (goalId, patch) => {
    try {
      await api.put(`/dogs/${row.dog_id}/programs/${row.id}/goals/${goalId}`, patch);
      onSaved?.();
    } catch (e) {
      console.error("goal update failed", e);
    }
  };

  const setStatus = async (newStatus) => {
    if (!window.confirm(`Change status to "${newStatus}"?`)) return;
    try {
      await api.put(`/dogs/${row.dog_id}/programs/${row.id}`, { status: newStatus });
      onSaved?.();
    } catch (e) {
      console.error("status change failed", e);
    }
  };

  const modules = row.program_snapshot?.modules || [];
  const progress = row.goal_progress || {};

  return (
    <div className="px-4 pb-5 pt-2 bg-bgBase/40 border-t border-bgHover" data-testid={`pipeline-detail-${row.id}`}>
      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => onJumpToDog?.(row.dog_id)}
          data-testid={`pipeline-jump-${row.id}`}
          className="bg-shBlue/15 hover:bg-shBlue/30 text-shBlue border border-shBlue/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
        >
          <i className="fas fa-paw mr-1.5"/>Open dog profile
        </button>
        {row.status === "completed" && row.client_id && (
          // Sprint 110ez polish — graduation surface for the review button.
          <ReviewRequestButton clientId={row.client_id} dogId={row.dog_id}
                               clientName={row.client_name || ""} dogName={row.dog_name || ""}
                               source="graduation" />
        )}
        {row.status === "active" && (
          <>
            <button
              onClick={() => setStatus("on_hold")}
              data-testid={`pipeline-status-hold-${row.id}`}
              className="bg-orange-500/15 hover:bg-orange-500/30 text-orange-300 border border-orange-500/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
            >
              <i className="fas fa-pause mr-1.5"/>Put on hold
            </button>
            <button
              onClick={() => setStatus("completed")}
              data-testid={`pipeline-status-complete-${row.id}`}
              className="bg-shGreen/15 hover:bg-shGreen/30 text-shGreen border border-shGreen/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
            >
              <i className="fas fa-flag-checkered mr-1.5"/>Mark complete
            </button>
          </>
        )}
        {row.status === "on_hold" && (
          <button
            onClick={() => setStatus("active")}
            data-testid={`pipeline-status-resume-${row.id}`}
            className="bg-shGreen/15 hover:bg-shGreen/30 text-shGreen border border-shGreen/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
          >
            <i className="fas fa-play mr-1.5"/>Resume
          </button>
        )}
      </div>

      {/* Trainer notes */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-2">
          <label className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue">
            <i className="fas fa-note-sticky mr-1.5"/>Trainer Notes
          </label>
          <span className="text-[10px] text-gray-500 font-black uppercase tracking-widest">
            {saving ? "Saving…" : savedAt ? `Saved ${formatRelativeTime(savedAt)}` : "Auto-saves as you type"}
          </span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Anything worth remembering — temperament, what worked this week, follow-ups, handler quirks…"
          rows={4}
          data-testid={`pipeline-notes-${row.id}`}
          className="w-full bg-bgPanel border border-bgHover rounded p-2 text-sm text-white focus:border-shBlue outline-none"
        />
      </div>

      {/* Goal grid */}
      {modules.length > 0 ? (
        <div data-testid={`pipeline-goals-${row.id}`}>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-2">
            <i className="fas fa-list-check mr-1.5"/>Goals · Click a status to update
          </p>
          {modules.map((m, mi) => (
            <ModuleBlock
              key={m.id || mi}
              module={m}
              moduleIndex={mi}
              progress={progress}
              onGoalUpdate={updateGoal}
            />
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-[13px] italic">This program has no modules/goals defined yet — edit the program in Settings to add some.</p>
      )}
    </div>
  );
}

function ModuleBlock({ module: mod, moduleIndex, progress, onGoalUpdate }) {
  const goals = mod.goals || [];
  const mastered = goals.filter(g => (progress[g.id] || {}).status === "mastered").length;
  return (
    <div className="mb-3 last:mb-0 bg-bgPanel border border-bgHover rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-bgHover/40 flex items-baseline justify-between">
        <p className="text-[13px] font-black text-white">
          <span className="text-shBlue">M{moduleIndex + 1}</span> · {mod.name || `Module ${moduleIndex + 1}`}
        </p>
        <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">
          {mastered}/{goals.length} mastered
        </span>
      </div>
      {goals.length === 0 ? (
        <p className="px-3 py-2 text-gray-500 text-[12px] italic">No goals in this module.</p>
      ) : (
        <ul className="divide-y divide-bgHover">
          {goals.map(g => {
            const p = progress[g.id] || { status: "not_started", score: 0, notes: "" };
            return (
              <li key={g.id} className="px-3 py-2 flex items-center gap-3" data-testid={`pipeline-goal-${g.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-white truncate">{g.name}</p>
                  {g.description && <p className="text-[11px] text-gray-500 truncate">{g.description}</p>}
                </div>
                <ScoreSelector
                  score={p.score || 0}
                  status={p.status}
                  manualOnly={!!g.manual_only}
                  onChange={(score) => onGoalUpdate(g.id, { score })}
                  onStatusToggle={(newStatus) => onGoalUpdate(g.id, { status: newStatus })}
                  testIdPrefix={`goal-${g.id}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ScoreSelector({ score, status, manualOnly, onChange, onStatusToggle, testIdPrefix }) {
  if (manualOnly) {
    const isDone = status === "mastered";
    return (
      <button
        onClick={() => onStatusToggle(isDone ? "not_started" : "mastered")}
        data-testid={`${testIdPrefix}-toggle`}
        className={`px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest border ${isDone ? "bg-shGreen/20 text-shGreen border-shGreen/50" : "bg-bgBase text-gray-400 border-bgHover hover:text-white"}`}
      >
        {isDone ? "✓ Done" : "Mark Done"}
      </button>
    );
  }
  return (
    <div className="flex gap-1 shrink-0">
      {[0, 1, 2, 3, 4, 5].map(n => {
        const active = score === n;
        const isMastered = n >= 4;
        const color = active ? (isMastered ? "#8cc63f" : n >= 1 ? "#f59e0b" : "#64748b") : "#475569";
        return (
          <button
            key={n}
            onClick={() => onChange(n)}
            data-testid={`${testIdPrefix}-score-${n}`}
            title={n === 0 ? "Not started" : n >= 4 ? "Mastered" : "In progress"}
            className="w-6 h-6 rounded text-[10px] font-black"
            style={{ background: active ? color : "transparent", color: active ? "#fff" : color, border: `1px solid ${color}80` }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="px-3 py-1.5 rounded border bg-bgPanel" style={{borderColor: color+"50"}}>
      <span className="text-[14px] font-black uppercase tracking-widest" style={{color}}>{label}</span>
      <span className="text-white ml-2 font-black">{value}</span>
    </div>
  );
}

function FilterChip({ label, value, current, onClick, color }) {
  const active = current === value;
  return (
    <button onClick={()=>onClick(value)} data-testid={`pipeline-filter-${value || "all"}`}
            className={`px-3 py-1.5 rounded text-[15px] font-black uppercase tracking-widest border transition ${active?"text-white":"text-gray-400 border-bgHover hover:text-white"}`}
            style={active ? {background: (color||"#00a9e0"), borderColor: color||"#00a9e0"} : {}}>
      {label}
    </button>
  );
}

function formatRelativeTime(ts) {
  const diff = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

// Suppress unused-eslint-warning in lint chains that may not include this hook
export { GOAL_STATUS_META };
