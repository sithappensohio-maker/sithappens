import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import AdminPageHeader from "../components/admin/AdminPageHeader";
import AdminTabs from "../components/admin/AdminTabs";
import AdminStatCard from "../components/admin/AdminStatCard";
import EmptyState from "../components/premium/EmptyState";
import { accentRgb } from "../components/premium/tokens";
import SchoolNeedsAttention from "../components/school/SchoolNeedsAttention";
import SchoolActivityFeed from "../components/school/SchoolActivityFeed";
import SchoolReviewsPanel from "../components/school/SchoolReviewsPanel";
import SchoolActivityCenter from "../components/school/SchoolActivityCenter";
import CheckpointReviewQueue from "../components/CheckpointReviewQueue";
import TrainerAssistQueue from "../components/TrainerAssistQueue";
import SchoolStudentsPanel from "../components/school/SchoolStudentsPanel";
import SchoolInterventionsPanel from "../components/school/SchoolInterventionsPanel";
import SchoolAnalyticsPanel from "../components/school/SchoolAnalyticsPanel";
import SchoolResourcesPanel from "../components/school/SchoolResourcesPanel";
import SchoolSettingsPanel from "../components/school/SchoolSettingsPanel";
import { navigateToScreen, announceAttentionChanged } from "../lib/schoolHq";

/* School HQ — the admin operations hub for the Online School. A thin, live
 * view over the Phase-1 event/notification spine + the existing checkpoint /
 * Trainer-Assist workflows (reused as-is, launched from their tabs). Broken
 * into small pieces (feed, queue, stat cards) rather than one mega-component. */
export default function SchoolHQ() {
  const [tab, setTabRaw] = useState("overview");
  // Backward-compatible deep links: old notifications/state that target the
  // retired standalone "checkpoints" tab land on Reviews → Checkpoints.
  const [reviewType, setReviewType] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const setTab = useCallback((t) => {
    if (t === "checkpoints") { setReviewType("checkpoints"); setTabRaw("reviews"); return; }
    setTabRaw(t);
  }, []);
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  const [summary, setSummary] = useState(null);
  const [attention, setAttention] = useState([]);
  const [activity, setActivity] = useState([]); // Overview strip only — the Activity tab is self-contained
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [trainerAssistOpen, setTrainerAssistOpen] = useState(false);
  const [checkpointTargetId, setCheckpointTargetId] = useState(null);
  const [trainerAssistTargetId, setTrainerAssistTargetId] = useState(null);
  const [studentTargetId, setStudentTargetId] = useState(null);

  const loadSummary = useCallback(async () => {
    const { data } = await api.get("/admin/school/hq/summary");
    setSummary(data);
  }, []);
  const loadAttention = useCallback(async () => {
    const { data } = await api.get("/admin/school/hq/needs-attention", { params: { sort: "priority", limit: 50 } });
    setAttention(data.items || []);
  }, []);
  const loadActivity = useCallback(async () => {
    const { data } = await api.get("/admin/school/hq/activity", { params: { limit: 8 } });
    setActivity(data.items || []);
  }, []);

  // One live-refresh loader: summary always (drives cards + tab counts + the
  // sidebar badge stays in sync via its own poll), plus the active tab's list.
  // The Activity tab manages its own data (SchoolActivityCenter).
  const refresh = useCallback(async () => {
    await loadSummary();
    const t = tabRef.current;
    if (t === "overview" || t === "needs_attention") await loadAttention();
    if (t === "overview") await loadActivity();
  }, [loadSummary, loadAttention, loadActivity]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    refresh().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refresh, tab]);

  useLiveRefresh(refresh, { intervalMs: 30000 });

  // Deep-link routing — every actionable item opens the EXACT record/workflow,
  // never a dead end. Checkpoint/Trainer-Assist open their existing queue
  // modal on the matching tab; question/video/could-not-complete open the
  // Homework thread (the real practice record) via the app shell.
  const openItem = useCallback(async (item) => {
    const t = item.notification_type || item.event_type || "";
    if (item.id && item.notification_type && !item.read_at) {
      try { await api.post(`/admin/school/hq/notifications/${item.id}/read`); announceAttentionChanged(); } catch { /* ignore */ }
    }
    const dl = item.deep_link || {};
    if (t.startsWith("checkpoint")) {
      setCheckpointTargetId(item.checkpoint_id || dl.checkpoint_id || null);
      setTab("checkpoints"); setCheckpointOpen(true);
    } else if ((t === "practice_video_submitted" || t === "practice_could_not_complete" || t === "practice_difficulty_reported" || t === "practice_review_attention") && (dl.section_log_id || item.metadata?.section_log_id)) {
      // Practice review work lives in Reviews → Practice now; the row opens
      // the exact submission. Question deep links keep going to the Homework
      // thread below (that's where the reply box lives).
      setReviewType("practice");
      setReviewTarget({
        section_log_id: dl.section_log_id || item.metadata?.section_log_id,
        homework_id: item.homework_id || dl.homework_id || null,
      });
      setTab("reviews");
    } else if (t.startsWith("trainer_assist")) {
      setTrainerAssistTargetId(item.trainer_assist_id || item.checkpoint_id || dl.trainer_assist_id || dl.checkpoint_id || null);
      setTab("trainer_assist"); setTrainerAssistOpen(true);
    } else if ((t === "student_question" || dl.screen === "messages") && (item.thread_id || dl.thread_id)) {
      navigateToScreen("messages", { thread_id: item.thread_id || dl.thread_id });
    } else if (t === "trainer_request_completed" || dl.student_id || dl.school_enrollment_id) {
      const sid = dl.student_id || dl.school_enrollment_id || item.school_enrollment_id;
      if (sid) { setStudentTargetId(sid); setTab("students"); }
    } else {
      navigateToScreen("homework", {
        homework_id: item.homework_id || dl.homework_id || null,
        video_media_id: dl.video_media_id || item.metadata?.video_media_id || null,
        question_id: item.metadata?.question_id || dl.question_id || null,
        section_log_id: dl.section_log_id || item.metadata?.section_log_id || null,
        day_number: dl.day_number || item.metadata?.day_number || null,
      });
    }
  }, [setTab]);

  const markRead = useCallback(async (item) => {
    setBusyId(item.id);
    try {
      await api.post(`/admin/school/hq/notifications/${item.id}/read`);
      setAttention((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      announceAttentionChanged();
    } finally { setBusyId(null); }
  }, []);

  const resolveItem = useCallback(async (item) => {
    setBusyId(item.id);
    try {
      await api.post(`/admin/school/hq/notifications/${item.id}/resolve`);
      setAttention((prev) => prev.filter((n) => n.id !== item.id));
      announceAttentionChanged();
      loadSummary();
    } finally { setBusyId(null); }
  }, [loadSummary]);

  const onQueueChanged = useCallback(() => { refresh(); }, [refresh]);

  const s = summary || {};
  const tabs = [
    { key: "overview", label: "Overview", icon: "fa-gauge", accent: "lime" },
    { key: "reviews", label: "Reviews", icon: "fa-clipboard-check", accent: "purple", count: s.reviews_pending ?? ((s.checkpoints_pending || 0) + (s.practice_reviews_pending || 0)) },
    { key: "activity", label: "Activity", icon: "fa-stream", accent: "cyan" },
    { key: "needs_attention", label: "Needs Attention", icon: "fa-bell", accent: "orange", count: s.needs_attention || 0 },
    { key: "trainer_assist", label: "Trainer Assist", icon: "fa-hand-holding-heart", accent: "purple", count: s.trainer_assists || 0 },
    { key: "students", label: "Students", icon: "fa-user-graduate", accent: "cyan" },
    { key: "interventions", label: "Interventions", icon: "fa-shield-heart", accent: "orange" },
    { key: "analytics", label: "Analytics", icon: "fa-chart-column", accent: "lime" },
    { key: "resources", label: "Resources", icon: "fa-folder-open", accent: "cyan" },
    { key: "settings", label: "Settings", icon: "fa-sliders", accent: "neutral" },
  ];

  return (
    <div className="space-y-4" data-testid="school-hq">
      <AdminPageHeader icon="fa-school" title="School HQ" testid="school-hq-header"
                       description="Everything happening in your Online School — student activity, items needing attention, checkpoints, and Trainer Assist in one place." />

      <AdminTabs items={tabs} value={tab} onChange={setTab} testid="school-hq-tabs" />

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="school-hq-overview-cards">
            <AdminStatCard icon="fa-user-graduate" accent="cyan" value={s.active_students ?? "—"} label="Active students" onClick={() => setTab("activity")} testid="stat-active-students" />
            <AdminStatCard icon="fa-bell" accent="orange" value={s.needs_attention ?? "—"} label="Needs attention" onClick={() => setTab("needs_attention")} testid="stat-needs-attention" />
            <AdminStatCard icon="fa-clipboard-check" accent="purple" value={s.reviews_pending ?? "—"} label="Reviews to do" detail="Practice + checkpoints" onClick={() => setTab("reviews")} testid="stat-reviews" />
            <AdminStatCard icon="fa-circle-question" accent="orange" value={s.new_questions ?? "—"} label="New questions" onClick={() => setTab("needs_attention")} testid="stat-questions" />
            <AdminStatCard icon="fa-hand-holding-heart" accent="purple" value={s.trainer_assists ?? "—"} label="Trainer assists" onClick={() => setTab("trainer_assist")} testid="stat-trainer-assist" />
            <AdminStatCard icon="fa-user-clock" accent="neutral" value={s.inactive_students ?? "—"} label="Inactive students" detail="No activity for 14+ days" testid="stat-inactive" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* min-w-0 lets each grid column shrink below its content's
                intrinsic min-width (grid items default to min-width:auto),
                so the row cards wrap instead of forcing horizontal overflow
                on narrow screens. */}
            <section className="min-w-0">
              <SectionTitle icon="fa-bell" title="Needs attention" onSeeAll={() => setTab("needs_attention")} />
              <SchoolNeedsAttention items={attention.slice(0, 5)} loading={loading} busyId={busyId}
                                    onOpen={openItem} onRead={markRead} onResolve={resolveItem} />
            </section>
            <section className="min-w-0">
              <SectionTitle icon="fa-stream" title="Recent activity" onSeeAll={() => setTab("activity")} />
              <SchoolActivityFeed items={activity.slice(0, 8)} loading={loading} onOpen={openItem} />
            </section>
          </div>
        </div>
      )}

      {/* Activity — a volume-ready, searchable HISTORY (grouped sessions,
          server-side filters, summary tiles, Group-by-Student). The Overview
          keeps its small recent-activity strip; Needs Attention stays the
          actual work queue. */}
      {tab === "activity" && (
        <SchoolActivityCenter onOpenStudent={(sid) => { setStudentTargetId(sid); setTab("students"); }} />
      )}

      {tab === "needs_attention" && (
        <SchoolNeedsAttention items={attention} loading={loading} busyId={busyId}
                              onOpen={openItem} onRead={markRead} onResolve={resolveItem} />
      )}

      {tab === "reviews" && (
        <SchoolReviewsPanel
          summary={s}
          initialReviewType={reviewType}
          initialTarget={reviewTarget}
          onOpenCheckpoint={(id) => { setCheckpointTargetId(id); setCheckpointOpen(true); }}
          onChanged={() => { setReviewTarget(null); refresh(); }}
        />
      )}

      {tab === "trainer_assist" && (
        <QueueLaunchPanel
          icon="fa-hand-holding-heart" accent="purple"
          count={s.trainer_assists || 0}
          title="Trainer Assist cases"
          blurb="Students a trainer recommended for a hands-on session — contact, schedule, and complete each case."
          buttonLabel="Open Trainer Assist queue"
          onOpen={() => setTrainerAssistOpen(true)}
          emptyLabel="No active Trainer Assist cases."
        />
      )}

      {tab === "students" && <SchoolStudentsPanel initialStudentId={studentTargetId} onInitialConsumed={() => setStudentTargetId(null)} />}
      {tab === "interventions" && <SchoolInterventionsPanel onOpenStudent={(id) => { setStudentTargetId(id); setTab("students"); }} />}
      {tab === "analytics" && <SchoolAnalyticsPanel />}
      {tab === "resources" && <SchoolResourcesPanel />}
      {tab === "settings" && <SchoolSettingsPanel />}

      {checkpointOpen && (
        <CheckpointReviewQueue initialSubmissionId={checkpointTargetId}
                               onClose={() => { setCheckpointOpen(false); setCheckpointTargetId(null); onQueueChanged(); }}
                               onGraded={onQueueChanged} />
      )}
      {trainerAssistOpen && (
        <TrainerAssistQueue initialSubmissionId={trainerAssistTargetId}
                            onClose={() => { setTrainerAssistOpen(false); setTrainerAssistTargetId(null); onQueueChanged(); }}
                            onChanged={onQueueChanged} />
      )}
    </div>
  );
}

function SectionTitle({ icon, title, onSeeAll }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-[12px] font-black uppercase tracking-[0.28em] text-shTextMuted"><i className={`fas ${icon} mr-1.5 text-shSecondary`} />{title}</p>
      {onSeeAll && (
        <button type="button" onClick={onSeeAll} className="min-h-[44px] px-2 -mx-2 -my-3 inline-flex items-center text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText transition">
          See all <i className="fas fa-arrow-right ml-1" />
        </button>
      )}
    </div>
  );
}

function QueueLaunchPanel({ icon, accent, count, title, blurb, buttonLabel, onOpen, emptyLabel }) {
  if (!count) {
    return <EmptyState icon={icon} accent="lime" title="All clear" description={emptyLabel} />;
  }
  const rgb = accentRgb(accent);
  // Row on desktop, stacked on narrow. The count block keeps its intrinsic
  // width (shrink-0) and the copy carries a real minimum width, so the
  // explanatory text can never be squeezed into a sliver between the count and
  // the action button (the previous AdminStatCard was w-full and collapsed it).
  return (
    <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-5 flex flex-col md:flex-row md:items-center gap-4 md:gap-6" data-testid="queue-launch">
      <div className="shrink-0 flex items-center gap-3">
        <span className="w-12 h-12 rounded-xl grid place-items-center" style={{ background: `rgba(${rgb},0.14)`, color: `rgb(${rgb})` }}>
          <i className={`fas ${icon} text-lg`} />
        </span>
        <div className="min-w-0">
          <p className="text-[28px] font-black text-shText leading-none">{count}</p>
          <p className="text-[11px] font-bold uppercase tracking-widest text-shTextMuted mt-1">{title}</p>
        </div>
      </div>
      <p className="flex-1 md:min-w-[15rem] text-shTextMuted text-[13px] leading-relaxed">{blurb}</p>
      <button type="button" onClick={onOpen}
              className="shrink-0 w-full md:w-auto text-[13px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl bg-shPrimary/15 border border-shPrimary/40 text-shPrimary hover:bg-shPrimary/25 transition"
              data-testid="queue-launch-open">
        <i className="fas fa-arrow-right mr-2" />{buttonLabel}
      </button>
    </div>
  );
}
