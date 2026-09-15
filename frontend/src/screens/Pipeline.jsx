import { useEffect, useState, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import PageHero from "../components/PageHero";
import ReviewRequestButton from "../components/ReviewRequestButton";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import TrainingSessionWorkspace from "../components/TrainingSessionWorkspace";
import CheckpointReviewQueue from "../components/CheckpointReviewQueue";
import CsvImportButton from "../components/CsvImportButton";
import { parseTrainingTipsCsv, TRAINING_TIPS_CSV_SAMPLE } from "../lib/csvImport";
import { toast } from "sonner";
import { useConfirm, usePromptDialog } from "../lib/useConfirm";
import TrainerDayQueue from "../components/training/TrainerDayQueue";
import { hubPresentation } from "../lib/trainerDay";
import SchoolReviewsPanel from "../components/school/SchoolReviewsPanel";
import DailyReviewQueue from "../components/DailyReviewQueue";
import TrainerAssistQueue from "../components/TrainerAssistQueue";

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
  const { user, can } = useAuth();
  // Stage 12 — ONE hub, composed by capability: whoever may assign training staff
  // runs the operation (Everyone, Needs assignment, trainer chips, the full program
  // pipeline); everyone else is a trainer and gets My Training Day. Review tools and
  // the tips import keep their own permission keys.
  const canAssignStaff = can("assign_training_staff");
  const operations = canAssignStaff;
  const canManageSchool = can("manage_school");
  const canManageContent = can("manage_training_content");
  const hub = hubPresentation({ canAssign: operations });
  const [needsAssignmentOnly, setNeedsAssignmentOnly] = useState(false);
  // Stage 11.5 — Today → Training carries ?focus=<queue item key>; once the day
  // loads that card scrolls into view and is highlighted. Nothing else changes.
  const [focusKey] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("focus") || null; } catch { return null; }
  });
  const [rows, setRows] = useState([]);
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterType, setFilterType] = useState("");
  const [filterStalled, setFilterStalled] = useState(false);
  const [trainerFilter, setTrainerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  // Sprint 110di-72 — Training Hub upgrades: tip-of-day, action launchers
  const [todayTip, setTodayTip] = useState(null);
  // Training-school expansion (Phase 7, redesigned UI Phase 5) — "Today's
  // Training Dogs" — the Trainer Daily Dashboard.
  const [trainers, setTrainers] = useState([]);
  // Gap-closing pass — workspaceFor now covers BOTH entry points, the
  // booking-based "Open Plan" button ({ bookingId }) and the per-row
  // "Log Session" button ({ dogId, enrollmentId }). Every session-writing
  // entry point in this screen opens the same TrainingSessionWorkspace /
  // server-backed draft pipeline — there is no longer a second, lighter
  // modal that mutates goal_progress directly.
  const [workspaceFor, setWorkspaceFor] = useState(null);
  // Online School Phase 2 — Trainer Checkpoints & Grading entry point,
  // living next to Today's Training Dogs (the trainer daily-ops surface).
  // Stage 11 — Trainer Daily Queue. ONE aggregate request (GET /admin/training/day)
  // replaces the separate today-roster + checkpoint-count loads; every review
  // tool opened from a card deep-links to that exact item, and every close
  // reloads the queue from canonical state (no stale cards).
  const [day, setDay] = useState(null);
  const [dayLoading, setDayLoading] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);
  const [checkpointFor, setCheckpointFor] = useState(null);   // { open: true, submissionId? }
  const [practiceFor, setPracticeFor] = useState(null);       // { section_log_id }
  const [dailyFor, setDailyFor] = useState(null);             // { homework_id, day_number }
  const [assistFor, setAssistFor] = useState(null);           // { submissionId? }

  const loadDay = async () => {
    try {
      const { data } = await api.get("/admin/training/day");
      setDay(data);
    } catch { setDay({ items: [], counts: {}, omitted: ["unavailable"] }); }
    setDayLoading(false);
  };
  useEffect(() => {
    loadDay();
    api.get("/admin/school/trainers").then(r => setTrainers((r.data || []).filter(t => t.can_run_training_sessions !== false))).catch(() => setTrainers([]));
  }, []);
  useEffect(() => {
    // A trainer-tier account (staff_role set) starts on "My work"; the owner sees everyone.
    if (user?.staff_role) setMineOnly(true);
  }, [user?.staff_role]);
  useLiveRefresh(loadDay, { intervalMs: 30_000 });
  const focusDone = useRef(false);
  useEffect(() => {
    if (!focusKey || dayLoading || !day || focusDone.current) return;
    const hit = (day.items || []).find((it) => it.key === focusKey);
    if (!hit) { focusDone.current = true; return; }          // not on today's queue (nothing to scroll to)
    if (mineOnly && hit.mine === false) { setMineOnly(false); return; }
    const sel = `[data-testid="day-item-${window.CSS?.escape ? CSS.escape(focusKey) : focusKey}"]`;
    // Blocks above the queue (tip of the day, pipeline stats) finish loading after the
    // first paint and shift the page, so settle for a moment: re-centre the card only
    // while it is out of view, then stop for good — the 30 s live refresh never re-scrolls.
    // Align the card's TOP just under the shell's sticky header (owner shell or Staff
    // Portal) — a queue card can be taller than a 320px phone, so centring it would
    // leave its top off-screen.
    // Stacked sticky bars (Staff Portal header + tab strip) chain from the top edge.
    const stickyBottom = () => {
      const rects = Array.from(document.querySelectorAll("header, nav, [class*='sticky']"))
        .filter((e) => ["sticky", "fixed"].includes(getComputedStyle(e).position))
        .map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      let bottom = 0;
      for (const r of rects) if (r.top <= bottom + 1 && r.bottom > bottom) bottom = r.bottom;
      return bottom;
    };
    const inView = (el) => { const b = el.getBoundingClientRect(); const top = stickyBottom(); return b.top >= top - 1 && b.top < top + window.innerHeight * 0.4; };
    const tick = () => {
      const el = document.querySelector(sel);
      if (!el || !el.scrollIntoView || inView(el)) return;
      el.style.scrollMarginTop = `${stickyBottom() + 8}px`;
      el.scrollIntoView({ block: "start" });
    };
    // Late blocks (banners, tip of the day, stats) keep shifting the page for a few
    // seconds: follow layout changes until the trainer touches the page or 8 s pass.
    const timers = [80, 600, 1500, 3000].map((ms) => setTimeout(tick, ms));
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => tick()) : null;
    const root = document.querySelector("[data-scroll-root]");
    if (ro) { ro.observe(document.body); if (root) Array.from(root.children).forEach((c) => ro.observe(c)); }
    const stop = () => { focusDone.current = true; ro?.disconnect(); };
    const done = setTimeout(stop, 8000);
    const userEvents = ["pointerdown", "wheel", "touchstart", "keydown"];
    userEvents.forEach((ev) => window.addEventListener(ev, stop, { passive: true, once: true }));
    return () => { timers.forEach(clearTimeout); clearTimeout(done); ro?.disconnect(); userEvents.forEach((ev) => window.removeEventListener(ev, stop)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, dayLoading, day, mineOnly]);

  const load = async () => {
    setLoading(true);
    const params = {};
    if (filterStatus) params.status = filterStatus;
    if (filterType) params.type = filterType;
    // a trainer's roster is only the programs assigned to them (server-side, by id)
    if (!operations && user?.id) params.trainer = user.id;
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
  // Stage 13 request audit — the debounce is for TYPING. Without this guard it also fired
  // on mount, fetching the whole program list an extra time every time the hub opened.
  // Keyed on the search TEXT (not a mounted flag) so React's double-invoked mount effects
  // in development cannot slip an extra fetch through either.
  const lastSearch = useRef(search);
  useEffect(() => {
    if (lastSearch.current === search) return;
    lastSearch.current = search;
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
  // Legacy (pre-School, read-only) enrollments are hidden from this pipeline
  // by design — say so instead of showing an unexplained "ACTIVE 0".
  const [legacyCount, setLegacyCount] = useState(0);
  useEffect(() => {
    api.get("/training/legacy-enrollment-count")
      .then(r => setLegacyCount(Number(r.data?.active_legacy || 0)))
      .catch(() => setLegacyCount(0));
  }, []);

  const stats = useMemo(() => {
    const s = { active: 0, on_hold: 0, completed: 0, overdue: 0 };
    rows.forEach(r => {
      if (s[r.status] != null) s[r.status]++;
      if (r.status === "active" && r.days_to_target != null && r.days_to_target < 0) s.overdue++;
    });
    return s;
  }, [rows]);

  const assignTrainer = async (item, trainerId) => {
    const bookingId = item?.action?.target?.booking_id;
    if (!bookingId) return;
    try {
      await api.patch(`/admin/training/today/${bookingId}/trainer`, { assigned_trainer_id: trainerId });
      toast.success(trainerId ? "Trainer assigned" : "Trainer assignment cleared");
      await loadDay();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not assign trainer");
    }
  };
  const assignedTrainerFor = (item) => item?.assigned_trainer_id || "";

  // Every queue action carries its own target (booking / enrollment / submission /
  // homework log) — the trainer never re-selects what the app already knows.
  const runDayAction = async (action, item) => {
    const t = action?.target || {};
    switch (action?.kind) {
      case "start_session":
      case "resume_session":
      case "resolve_session":
      case "view_session":
        // Stage 11.5 — an unfinished draft from an earlier day resumes THAT draft
        // (dog + enrollment + draft_id), never today's booking bootstrap.
        if (t.draft_id && t.dog_id && t.enrollment_id) setWorkspaceFor({ dogId: t.dog_id, enrollmentId: t.enrollment_id, draftId: t.draft_id });
        else if (t.booking_id) setWorkspaceFor({ bookingId: t.booking_id });
        else if (t.dog_id && t.enrollment_id) setWorkspaceFor({ dogId: t.dog_id, enrollmentId: t.enrollment_id });
        return;
      case "review_checkpoint":
        setCheckpointFor({ open: true, submissionId: t.submission_id || null });
        return;
      case "review_practice":
        setPracticeFor({ section_log_id: t.section_log_id, homework_id: t.homework_id });
        return;
      case "review_daily":
        setDailyFor({ homework_id: t.homework_id, day_number: t.day_number });
        return;
      case "open_trainer_assist":
        setAssistFor({ submissionId: t.submission_id || null });
        return;
      case "check_in":
        try {
          await api.post(`/bookings/${t.booking_id}/check-in`);
          await loadDay();
        } catch (e) {
          toast.error(e?.response?.data?.detail || "Check-in failed — open the full check-in flow to resolve.");
        }
        return;
      case "open_dog":
        if (onJumpToDog && t.dog_id) onJumpToDog(t.dog_id);
        else toast.info("Open this dog from the Dogs screen.");
        return;
      default:
        toast.info("Nothing to open for this item.");
    }
  };

  return (
    <>
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6" data-testid="pipeline-screen">
      <PageHero
        eyebrow={{ icon: "fa-graduation-cap", text: hub.eyebrow, color: "text-shPrimary" }}
        title={hub.title}
        highlight={hub.highlight}
        subtitle={hub.subtitle}
        right={operations ? (
          <div className="flex gap-2 flex-wrap" data-testid="hub-stats-operations">
            <Stat label="Active" value={stats.active} color="#8cc63f" />
            <Stat label="On Hold" value={stats.on_hold} color="#f59e0b" />
            <Stat label="Completed" value={stats.completed} color="#00a9e0" />
            {stats.overdue > 0 && <Stat label="Overdue" value={stats.overdue} color="#ef4444" />}
            {(day?.counts?.needs_assignment || 0) > 0 && <Stat label="Needs a trainer" value={day.counts.needs_assignment} color="#f59e0b" />}
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap" data-testid="hub-stats-trainer">
            <Stat label="Needs you" value={dayLoading ? "…" : (day?.items || []).filter((it) => it.mine !== false && !["upcoming", "done"].includes(it.section)).length} color="#8cc63f" />
            <Stat label="Today" value={dayLoading ? "…" : (day?.counts?.today || 0)} color="#00a9e0" />
            <Stat label="Done" value={dayLoading ? "…" : (day?.counts?.done || 0)} color="#8cc63f" />
          </div>
        )}
        testid="pipeline-hero"
      />

      {/* Stage 11 — Trainer Daily Queue: the one place to run the training day.
          Needs attention → Today's training → Continue → Upcoming → Done, each
          item from the canonical record it points at (GET /admin/training/day). */}
      <div className="space-y-3" data-testid="today-training-dogs">
        <TrainerDayQueue
          day={day} loading={dayLoading} focusKey={focusKey} heading={hub.heading}
          mineOnly={mineOnly} onToggleMine={operations ? setMineOnly : undefined}
          needsAssignmentOnly={needsAssignmentOnly} onToggleNeedsAssignment={operations ? setNeedsAssignmentOnly : undefined}
          onAction={runDayAction} canOpenDog={!!onJumpToDog}
          trainers={trainers} canAssignTrainer={canAssignStaff} onAssignTrainer={assignTrainer}
          assignedTrainerFor={assignedTrainerFor}
        />
        {canManageSchool && (
          <div className="flex justify-end">
            <button onClick={() => setCheckpointFor({ open: true, submissionId: null })} data-testid="open-checkpoint-queue-pipeline"
                    className="text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText border border-shBorder rounded px-2.5 py-1">
              <i className="fas fa-video mr-1"/>Open checkpoint queue
            </button>
          </div>
        )}
      </div>

      {/* Sprint 110di-72 — Training Tip of the Day */}
      {todayTip && (
        <div data-testid="training-tip-card"
             className="bg-[var(--sh-card-base)] border-l-4 border-shPrimary rounded-r-xl p-4 sm:p-5 shadow-md">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shPrimary mb-1">
                <i className="fas fa-lightbulb mr-1.5"/>Training tip of the day · {todayTip.category?.replace(/_/g, " ")}
              </p>
              <p className="text-shText text-[15px] leading-relaxed">{todayTip.tip}</p>
              {todayTip.source && (
                <p className="text-shTextMuted text-[11px] mt-1">— {todayTip.source}</p>
              )}
            </div>
            {canManageContent && <CsvImportButton
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
            />}
          </div>
        </div>
      )}

      {/* Stage 12 — the operational program pipeline is the owner's; a trainer gets a quiet
          "My students" roster (the SAME rows, filtered server-side to their assignments). */}
      {operations ? (
        <div data-testid="pipeline-programs">
      <div className="flex flex-wrap gap-2 mb-5 items-center" data-testid="pipeline-filters">
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search dog, client, program…"
               data-testid="pipeline-search"
               className="flex-1 min-w-[200px] bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm focus:border-shSecondary outline-none" />
        <FilterChip label="All Statuses" value="" current={filterStatus} onClick={setFilterStatus} />
        {Object.entries(STATUS_META).map(([k, m]) => (
          <FilterChip key={k} label={m.label} value={k} current={filterStatus} onClick={setFilterStatus} color={m.color} />
        ))}
        <div className="w-full md:w-auto md:ml-2">
          <select value={filterType} onChange={(e)=>setFilterType(e.target.value)} data-testid="pipeline-type-filter"
                  className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="">All Types</option>
            {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>
        <input value={trainerFilter} onChange={(e)=>setTrainerFilter(e.target.value)}
               placeholder="Filter by trainer…"
               data-testid="pipeline-trainer-filter"
               className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm w-48"/>
        <button onClick={() => setFilterStalled(s => !s)}
                data-testid="pipeline-stalled-filter"
                className={`px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest border transition ${
                  filterStalled
                    ? "bg-red-500/20 text-red-300 border-red-500/40"
                    : "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder hover:text-shText"
                }`}>
          <i className="fas fa-triangle-exclamation mr-1"/>Stalled 7d+
        </button>
      </div>

      {legacyCount > 0 && (
        <div className="bg-shAccent/10 border border-shAccent/40 rounded-xl px-4 py-3 text-[13px] text-shTextMuted" data-testid="pipeline-legacy-hint">
          <i className="fas fa-box-archive text-shAccent mr-2"/>
          <span className="text-shText font-bold">{legacyCount} legacy training program record{legacyCount === 1 ? "" : "s"}</span> from
          before the School system {legacyCount === 1 ? "is" : "are"} read-only and not shown here. Open the dog's profile → Training tab
          to view one or migrate it into School so it can be managed from this pipeline.
        </div>
      )}
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl overflow-hidden shadow-lg">
        {loading && <p className="p-8 text-center text-shTextMuted text-sm"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="p-12 text-center text-shTextMuted text-sm">No programs match these filters.</p>
        )}
        {!loading && rows.length > 0 && (
          <div className="divide-y divide-shBorder">
            {rows.map(r => (
              <Row
                key={r.id}
                row={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onJumpToDog={onJumpToDog}
                onOpenWorkspace={() => setWorkspaceFor({ dogId: r.dog_id, enrollmentId: r.id })}
                onSaved={load}
                isAdmin={user?.role === "admin"}
              />
            ))}
          </div>
        )}
      </div>
        </div>
      ) : (
        <details className="rounded-xl border border-shBorder bg-[var(--sh-card-base)]" data-testid="my-students">
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2 min-h-[48px]">
            <span className="text-[13px] font-black uppercase tracking-widest text-shText"><i className="fas fa-users mr-1.5 text-shSecondary" aria-hidden="true" />My students · {rows.length}</span>
            <span className="text-[12px] text-shTextMuted">Dogs whose program is assigned to you</span>
          </summary>
          {loading && <p className="p-6 text-center text-shTextMuted text-sm"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>}
          {!loading && rows.length === 0 && <p className="px-4 pb-4 text-shTextMuted text-sm" data-testid="my-students-empty">No programs are assigned to you yet.</p>}
          {!loading && rows.length > 0 && (
            <div className="divide-y divide-shBorder border-t border-shBorder">
            {rows.map(r => (
              <Row
                key={r.id}
                row={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onJumpToDog={onJumpToDog}
                onOpenWorkspace={() => setWorkspaceFor({ dogId: r.dog_id, enrollmentId: r.id })}
                onSaved={load}
                isAdmin={user?.role === "admin"}
              />
            ))}
            </div>
          )}
        </details>
      )}
    </div>

    {workspaceFor && (
      <TrainingSessionWorkspace
        bookingId={workspaceFor.bookingId}
        dogId={workspaceFor.dogId}
        enrollmentId={workspaceFor.enrollmentId}
        resumeDraftId={workspaceFor.draftId}
        onClose={() => setWorkspaceFor(null)}
        onSaved={() => { setWorkspaceFor(null); loadDay(); load(); }}
        onReviewCheckpoint={() => { setWorkspaceFor(null); setCheckpointFor({ open: true, submissionId: null }); }}
      />
    )}
    {checkpointFor?.open && (
      <CheckpointReviewQueue initialSubmissionId={checkpointFor.submissionId || null}
                             onClose={() => { setCheckpointFor(null); loadDay(); }} onGraded={loadDay}/>
    )}
    {practiceFor && (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-start sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="practice-review-modal-title" data-testid="practice-review-modal">
        <div className="w-full max-w-3xl max-h-[100dvh] sm:max-h-[92vh] overflow-y-auto bg-[var(--sh-card-base)] sm:rounded-2xl border border-shBorder p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 id="practice-review-modal-title" className="text-[13px] font-black uppercase tracking-widest text-shText"><i className="fas fa-clipboard-check mr-1.5 text-shSecondary" aria-hidden="true"/>Practice review</h2>
            <button type="button" onClick={() => { setPracticeFor(null); loadDay(); }} data-testid="practice-review-modal-close"
                    className="min-h-[40px] min-w-[40px] rounded-lg border border-shBorder text-shTextMuted hover:text-shText" aria-label="Close">✕</button>
          </div>
          <SchoolReviewsPanel initialTarget={{ section_log_id: practiceFor.section_log_id }}
                              onOpenCheckpoint={(id) => { setPracticeFor(null); setCheckpointFor({ open: true, submissionId: id || null }); }}
                              onChanged={loadDay}/>
        </div>
      </div>
    )}
    {dailyFor && (
      <DailyReviewQueue initialItem={dailyFor} onClose={() => { setDailyFor(null); loadDay(); }} onReviewed={loadDay}/>
    )}
    {assistFor && (
      <TrainerAssistQueue initialSubmissionId={assistFor.submissionId || null} onClose={() => { setAssistFor(null); loadDay(); }} onChanged={loadDay}/>
    )}
    </>
  );
}

function Row({ row, expanded, onToggle, onJumpToDog, onOpenWorkspace, onSaved, isAdmin }) {
  const sm = STATUS_META[row.status] || STATUS_META.active;
  const tm = TYPE_META[row.program_snapshot?.type] || TYPE_META.private_lessons;
  const overdue = row.status === "active" && row.days_to_target != null && row.days_to_target < 0;
  const hasNotes = (row.trainer_notes || "").trim().length > 0;

  return (
    <div data-testid={`pipeline-row-${row.id}`}>
      <button
        onClick={onToggle}
        data-testid={`pipeline-row-toggle-${row.id}`}
        className="w-full px-4 py-3 hover:bg-shSurfaceRaised/30 text-left transition flex items-center gap-3"
      >
        {row.dog_photo
          ? <img src={row.dog_photo} alt={row.dog_name} loading="lazy" decoding="async" className="w-10 h-10 rounded-full object-cover border border-shBorder shrink-0" />
          : <div className="w-10 h-10 rounded-full bg-[var(--sh-card-base)] border border-shBorder flex items-center justify-center shrink-0 text-shPrimary"><i className="fas fa-paw"/></div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-shText">{row.dog_name}</p>
            <span className="text-[14px] text-shTextMuted">·</span>
            <p className="text-[15px] text-shTextMuted truncate">{row.client_name}</p>
            <span className="text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded" style={{color: tm.color, background: tm.color+"15", border: `1px solid ${tm.color}40`}}>{tm.label}</span>
            {hasNotes && (
              <span className="text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-shSecondary/15 text-shSecondary border border-shSecondary/40" title="Has trainer notes">
                <i className="fas fa-note-sticky mr-1"/>Notes
              </span>
            )}
            {overdue && <span className="text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40"><i className="fas fa-triangle-exclamation mr-1"/>Overdue {Math.abs(row.days_to_target)}d</span>}
            {row.status === "active" && row.graduation_ready && (
              // Completion never happens automatically (owner rule) — this
              // badge says the completion rule is satisfied and a human can
              // graduate the dog whenever THEY decide it's done.
              <span className="text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-shPrimary/20 text-shPrimary border border-shPrimary/40" data-testid={`pipeline-graduation-ready-${row.id}`}>
                <i className="fas fa-graduation-cap mr-1"/>Ready to graduate
              </span>
            )}
          </div>
          <p className="text-[15px] text-shTextMuted mt-1 truncate">{row.program_snapshot?.name}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="flex-1 max-w-xs h-2 bg-[var(--sh-card-base)] rounded-full overflow-hidden border border-shBorder">
              <div className="h-full transition-all" style={{width: `${row.mastered_pct||0}%`, background: tm.color}} />
            </div>
            <span className="text-[14px] text-shTextMuted font-black tabular-nums whitespace-nowrap">{row.mastered_pct}% · {row.mastered_goals}/{row.total_goals}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-[13px] font-black uppercase tracking-widest px-2 py-1 rounded" style={{color: sm.color, background: sm.color+"15", border: `1px solid ${sm.color}40`}}>
            <i className={`fas ${sm.icon} mr-1`}/>{sm.label}
          </span>
          <p className="text-[13px] text-shTextMuted font-black uppercase tracking-widest mt-1">
            {row.days_since_start != null ? `${row.days_since_start}d in` : "—"}
            {row.target_completion_date && ` · ${row.days_to_target >= 0 ? row.days_to_target + "d left" : Math.abs(row.days_to_target) + "d over"}`}
          </p>
        </div>
        <i className={`fas ${expanded ? "fa-chevron-up" : "fa-chevron-down"} text-shTextMuted ml-2 shrink-0`}/>
      </button>

      {expanded && (
        <ExpandedDetail row={row} onJumpToDog={onJumpToDog} onSaved={onSaved} isAdmin={isAdmin} />
      )}
      {/* Sprint 110di-72 — Quick actions + last-session ribbon */}
      <div className="border-t border-shBorder/60 bg-[var(--sh-card-base)]/40 px-4 py-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-shTextMuted font-black uppercase tracking-widest">
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
          <button onClick={(e)=>{ e.stopPropagation(); onOpenWorkspace(); }}
                  data-testid={`hub-open-session-${row.id}`}
                  className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-2 py-1 rounded font-black uppercase tracking-widest hover:bg-shPrimary/25">
            <i className="fas fa-paw mr-1"/>Log Session
          </button>
          {onJumpToDog && (
            <button onClick={(e)=>{ e.stopPropagation(); onJumpToDog(row.dog_id); }}
                    data-testid={`hub-open-dog-${row.id}`}
                    className="bg-shSecondary/15 text-shSecondary border border-shSecondary/40 px-2 py-1 rounded font-black uppercase tracking-widest hover:bg-shSecondary/25">
              <i className="fas fa-dog mr-1"/>Dog Profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpandedDetail({ row, onJumpToDog, onSaved, isAdmin }) {
  const confirm = useConfirm();
  const promptDialog = usePromptDialog();
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
    const ok = await confirm({
      title: `Change training status to ${newStatus}?`,
      body: "This changes the program status immediately.",
      confirmText: "Change Status",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await api.put(`/dogs/${row.dog_id}/programs/${row.id}`, { status: newStatus });
      onSaved?.();
    } catch (e) {
      console.error("status change failed", e);
    }
  };

  // Un-graduate — explicit and audited (POST .../reopen-program). Exists
  // because graduation used to fire as a silent side effect of advancing
  // past the final lesson, un-enrolling Board & Train dogs mid-stay.
  const reopenProgram = async () => {
    const reason = await promptDialog({
      title: "Reopen this program?",
      body: "The dog goes back to ACTIVE on its final lesson so training can continue until someone explicitly graduates it. A short reason is saved to the audit trail.",
      placeholder: "e.g. completed by mistake — training not finished",
      confirmText: "Reopen Program",
      tone: "warning",
      icon: "fa-rotate-left",
    });
    if (reason == null) return;
    const clean = String(reason).trim();
    if (clean.length < 3) return;
    try {
      await api.post(`/training/enrollments/${row.id}/reopen-program`, { reason: clean });
      onSaved?.();
    } catch (e) {
      console.error("program reopen failed", e);
    }
  };

  const modules = row.program_snapshot?.modules || [];
  const progress = row.goal_progress || {};

  return (
    <div className="px-4 pb-5 pt-2 bg-[var(--sh-card-base)]/40 border-t border-shBorder" data-testid={`pipeline-detail-${row.id}`}>
      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => onJumpToDog?.(row.dog_id)}
          data-testid={`pipeline-jump-${row.id}`}
          className="bg-shSecondary/15 hover:bg-shSecondary/30 text-shSecondary border border-shSecondary/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
        >
          <i className="fas fa-paw mr-1.5"/>Open dog profile
        </button>
        {row.status === "completed" && row.client_id && (
          // Sprint 110ez polish — graduation surface for the review button.
          <ReviewRequestButton clientId={row.client_id} dogId={row.dog_id}
                               clientName={row.client_name || ""} dogName={row.dog_name || ""}
                               source="graduation" />
        )}
        {isAdmin && row.status === "completed" && (
          <button
            onClick={reopenProgram}
            data-testid={`pipeline-reopen-program-${row.id}`}
            className="bg-shSecondary/15 hover:bg-shSecondary/30 text-shSecondary border border-shSecondary/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
          >
            <i className="fas fa-rotate-left mr-1.5"/>Reopen program
          </button>
        )}
        {isAdmin && row.status === "active" && (
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
              className="bg-shPrimary/15 hover:bg-shPrimary/30 text-shPrimary border border-shPrimary/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
            >
              <i className="fas fa-flag-checkered mr-1.5"/>Mark complete
            </button>
          </>
        )}
        {isAdmin && row.status === "on_hold" && (
          <button
            onClick={() => setStatus("active")}
            data-testid={`pipeline-status-resume-${row.id}`}
            className="bg-shPrimary/15 hover:bg-shPrimary/30 text-shPrimary border border-shPrimary/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest"
          >
            <i className="fas fa-play mr-1.5"/>Resume
          </button>
        )}
      </div>

      {/* Trainer notes */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-2">
          <label className="text-[11px] font-black uppercase tracking-[0.3em] text-shSecondary">
            <i className="fas fa-note-sticky mr-1.5"/>Trainer Notes <span className="text-shTextMuted normal-case tracking-normal font-bold">(staff only)</span>
          </label>
          <span className="text-[10px] text-shTextMuted font-black uppercase tracking-widest">
            {saving ? "Saving…" : savedAt ? `Saved ${formatRelativeTime(savedAt)}` : "Auto-saves as you type"}
          </span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Anything worth remembering — temperament, what worked this week, follow-ups, handler quirks…"
          rows={4}
          data-testid={`pipeline-notes-${row.id}`}
          className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-sm text-shText focus:border-shSecondary outline-none"
        />
      </div>

      {/* Goal grid */}
      {modules.length > 0 ? (
        <div data-testid={`pipeline-goals-${row.id}`}>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shPrimary mb-2">
            <i className="fas fa-list-check mr-1.5"/>Goals · {isAdmin ? "Admin corrections" : "Lesson progress"}
          </p>
          <p className="text-[12px] text-shTextMuted italic mb-2">
            {isAdmin
              ? <>Corrections only — normal progress belongs in <span className="text-shPrimary font-black not-italic">Log Session</span>.</>
              : <>Progress is read-only here. Use <span className="text-shPrimary font-black not-italic">Log Session</span> to record today&apos;s training.</>}
          </p>
          {modules.map((m, mi) => (
            <ModuleBlock
              key={m.id || mi}
              module={m}
              moduleIndex={mi}
              progress={progress}
              onGoalUpdate={updateGoal}
              canEdit={isAdmin}
            />
          ))}
        </div>
      ) : (
        <p className="text-shTextMuted text-[13px] italic">This program has no modules/goals defined yet — edit the program in Settings to add some.</p>
      )}
    </div>
  );
}

function ModuleBlock({ module: mod, moduleIndex, progress, onGoalUpdate, canEdit }) {
  const goals = mod.goals || [];
  const mastered = goals.filter(g => (progress[g.id] || {}).status === "mastered").length;
  return (
    <div className="mb-3 last:mb-0 bg-[var(--sh-card-base)] border border-shBorder rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-shSurfaceRaised/40 flex items-baseline justify-between">
        <p className="text-[13px] font-black text-shText">
          <span className="text-shSecondary">M{moduleIndex + 1}</span> · {mod.name || `Module ${moduleIndex + 1}`}
        </p>
        <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">
          {mastered}/{goals.length} mastered
        </span>
      </div>
      {goals.length === 0 ? (
        <p className="px-3 py-2 text-shTextMuted text-[12px] italic">No goals in this module.</p>
      ) : (
        <ul className="divide-y divide-shBorder">
          {goals.map(g => {
            const p = progress[g.id] || { status: "not_started", score: 0, notes: "" };
            return (
              <li key={g.id} className="px-3 py-2 flex items-center gap-3" data-testid={`pipeline-goal-${g.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-shText truncate">{g.name}</p>
                  {g.description && <p className="text-[11px] text-shTextMuted truncate">{g.description}</p>}
                </div>
                {canEdit ? (
                  <ScoreSelector
                    score={p.score || 0}
                    status={p.status}
                    manualOnly={!!g.manual_only}
                    onChange={(score) => onGoalUpdate(g.id, { score })}
                    onStatusToggle={(newStatus) => onGoalUpdate(g.id, { status: newStatus })}
                    testIdPrefix={`goal-${g.id}`}
                  />
                ) : (
                  <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted shrink-0">
                    {p.status === "mastered" ? "Mastered" : p.status === "in_progress" ? `Level ${p.score || 0}` : "Not started"}
                  </span>
                )}
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
        className={`px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest border ${isDone ? "bg-shPrimary/20 text-shPrimary border-shPrimary/50" : "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder hover:text-shText"}`}
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
    <div className="px-3 py-1.5 rounded border bg-[var(--sh-card-base)]" style={{borderColor: color+"50"}}>
      <span className="text-[14px] font-black uppercase tracking-widest" style={{color}}>{label}</span>
      <span className="text-shText ml-2 font-black">{value}</span>
    </div>
  );
}

function FilterChip({ label, value, current, onClick, color }) {
  const active = current === value;
  return (
    <button onClick={()=>onClick(value)} data-testid={`pipeline-filter-${value || "all"}`}
            className={`px-3 py-1.5 rounded text-[15px] font-black uppercase tracking-widest border transition ${active?"text-shText":"text-shTextMuted border-shBorder hover:text-shText"}`}
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
