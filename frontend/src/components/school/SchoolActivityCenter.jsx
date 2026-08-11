// School HQ → Activity — organized for real client volume. Activity is a
// searchable HISTORY/audit surface: every filter runs server-side, events
// from one training sitting arrive pre-bundled into a single expandable
// card, the feed is sectioned by time, and a Group-by-Student mode makes the
// dog/owner the organizing unit. Needs Attention stays the work queue —
// nothing here duplicates it; exceptions are merely LOUDER in the history.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useLiveRefresh } from "../../lib/useLiveRefresh";
import EmptyState from "../premium/EmptyState";
import { timeAgo } from "../../lib/schoolHq";

const TYPE_OPTIONS = [
  ["", "All activity"],
  ["lesson_completed", "Lesson completed"],
  ["practice_completed", "Practice completed"],
  ["practice_problem", "Practice difficulty / problem"],
  ["checkpoint_submitted", "Checkpoint submitted"],
  ["trainer_review", "Trainer review completed"],
  ["trainer_assist", "Trainer Assist"],
  ["course_completed", "Course / week completed"],
  ["enrollment", "Enrollment"],
];

const RANGE_OPTIONS = [
  ["all", "All time"],
  ["today", "Today"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
];

function rangeToDates(range) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  if (range === "today") return { date_from: iso(now) };
  if (range === "7d") return { date_from: iso(new Date(now - 6 * 864e5)) };
  if (range === "30d") return { date_from: iso(new Date(now - 29 * 864e5)) };
  return {};
}

function timeSection(iso) {
  if (!iso) return "OLDER";
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const today = startOfDay(now);
  const days = Math.floor((today - startOfDay(d)) / 864e5);
  if (days <= 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  if (days < 7) return "EARLIER THIS WEEK";
  return "OLDER";
}

function SummaryTile({ value, label, accent = "text-shText", onClick, testid }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
            className="rounded-xl border border-shBorder/55 bg-black/15 px-3 py-2.5 text-left hover:border-shSecondary/40 transition min-w-0">
      <p className={`text-[20px] font-black leading-none ${accent}`}>{value ?? "—"}</p>
      <p className="text-[9px] font-black uppercase tracking-widest text-shTextMuted mt-1 truncate">{label}</p>
    </button>
  );
}

function GroupCard({ group, onOpenStudent, testid }) {
  const [open, setOpen] = useState(false);
  const attention = group.requires_attention;
  return (
    <div className={`rounded-2xl border p-3.5 ${attention ? "border-shAccent/50 bg-shAccent/[0.05]" : "border-shBorder/55 bg-[var(--sh-card-base)]"}`}
         data-testid={testid}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-black text-shText truncate">
              {group.client_name || "Student"}{group.dog_name ? <span className="text-shTextMuted"> · {group.dog_name}</span> : null}
            </p>
            {attention && (
              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-shAccent/15 text-shAccent border-shAccent/40">
                Needs attention
              </span>
            )}
            <span className="text-[10px] text-shTextMuted font-bold shrink-0">{timeAgo(group.ended_at)}</span>
          </div>
          <p className={`text-[13px] mt-1 break-words ${attention ? "text-shAccent font-black" : "text-shText font-bold"}`}>
            {group.headline}{!attention && " ✓"}
          </p>
          {group.event_count > 1 && !open && (
            <p className="text-[11px] text-shTextMuted mt-1">
              {group.events.slice(0, 3).map((e) => e.title).join(" · ")}
              {group.event_count > 3 ? ` · +${group.event_count - 3} more` : ""}
            </p>
          )}
          {open && (
            <ul className="mt-2 space-y-1 border-l-2 border-shBorder/50 pl-3" data-testid={`${testid}-events`}>
              {group.events.map((e) => (
                <li key={e.id} className="text-[11px] text-shTextMuted">
                  <span className="text-shText">{e.title}</span>
                  <span className="ml-2">{timeAgo(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mt-2 truncate">
            {[group.program_name, group.module_name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {group.school_enrollment_id && (
            <button type="button" onClick={() => onOpenStudent?.(group.school_enrollment_id)} data-testid={`${testid}-view-student`}
                    className="min-h-[38px] px-3 rounded-lg border border-shBorder/60 text-[10px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText transition">
              View Student
            </button>
          )}
          {group.event_count > 1 && (
            <button type="button" onClick={() => setOpen((v) => !v)} data-testid={`${testid}-toggle`}
                    className="min-h-[38px] px-3 rounded-lg border border-shSecondary/40 text-[10px] font-black uppercase tracking-widest text-shSecondary hover:bg-shSecondary/10 transition">
              {open ? "Hide" : `View Activity · ${group.event_count}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StudentCard({ s, onOpenStudent, testid }) {
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState(null);
  useEffect(() => {
    if (!open || timeline !== null) return undefined;
    let live = true;
    api.get("/admin/school/hq/activity", { params: { grouped: true, client_id: s.client_id, dog_id: s.dog_id, limit: 40 } })
      .then(({ data }) => { if (live) setTimeline(data.groups || []); })
      .catch(() => { if (live) setTimeline([]); });
    return () => { live = false; };
  }, [open, timeline, s.client_id, s.dog_id]);
  const flag = (on, label) => (
    <span className={`text-[10px] font-black uppercase tracking-widest ${on ? "text-shPrimary" : "text-shTextMuted/60"}`}>
      {label} {on ? "✓" : "·"}
    </span>
  );
  return (
    <div className="rounded-2xl border border-shBorder/55 bg-[var(--sh-card-base)] p-3.5" data-testid={testid}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-black text-shText truncate">{s.dog_name} <span className="text-shTextMuted font-bold">— {s.client_name}</span></p>
          <p className="text-[11px] text-shTextMuted mt-0.5 truncate">{[s.program_name, s.module_name].filter(Boolean).join(" · ")}</p>
          <p className="text-[11px] text-shTextMuted mt-1">
            {s.activities_today} activit{s.activities_today === 1 ? "y" : "ies"} today · Last activity {timeAgo(s.last_activity_at)}
          </p>
          <div className="flex gap-3 mt-1.5">{flag(s.today_learn, "Learn")}{flag(s.today_practice, "Practice")}{flag(s.today_lesson, "Lesson")}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          {s.school_enrollment_id && (
            <button type="button" onClick={() => onOpenStudent?.(s.school_enrollment_id)}
                    className="min-h-[38px] px-3 rounded-lg border border-shBorder/60 text-[10px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText transition">
              View Student
            </button>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} data-testid={`${testid}-toggle`}
                  className="min-h-[38px] px-3 rounded-lg border border-shSecondary/40 text-[10px] font-black uppercase tracking-widest text-shSecondary hover:bg-shSecondary/10 transition">
            {open ? "Hide Activity" : "View Activity"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-shBorder/40 pt-3">
          {timeline === null ? (
            <p className="text-[11px] text-shTextMuted"><i className="fas fa-spinner fa-spin mr-1" />Loading…</p>
          ) : timeline.length === 0 ? (
            <p className="text-[11px] text-shTextMuted">No recent activity.</p>
          ) : (
            timeline.map((g, i) => <GroupCard key={g.id} group={g} onOpenStudent={onOpenStudent} testid={`${testid}-group-${i}`} />)
          )}
        </div>
      )}
    </div>
  );
}

export default function SchoolActivityCenter({ onOpenStudent, testid = "school-activity-center" }) {
  const [summary, setSummary] = useState(null);
  const [groups, setGroups] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [students, setStudents] = useState(null);
  const [byStudent, setByStudent] = useState(false);
  // Filters — all applied SERVER-SIDE.
  const [search, setSearch] = useState("");
  const [typeCat, setTypeCat] = useState("");
  const [range, setRange] = useState("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const searchTimer = useRef(null);
  const [query, setQuery] = useState("");

  const params = useMemo(() => ({
    grouped: true, limit: 50,
    ...(query ? { q: query } : {}),
    ...(typeCat ? { type_category: typeCat } : {}),
    ...(attentionOnly ? { attention_only: true } : {}),
    ...rangeToDates(range),
  }), [query, typeCat, attentionOnly, range]);

  const loadFeed = useCallback(async () => {
    try {
      const [{ data: sum }, { data: feed }] = await Promise.all([
        api.get("/admin/school/hq/activity/summary"),
        api.get("/admin/school/hq/activity", { params }),
      ]);
      setSummary(sum);
      setGroups(feed.groups || []);
      setCursor(feed.next_before || null);
    } catch { /* keep last */ }
  }, [params]);

  const loadStudents = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/school/hq/activity/students", { params: query ? { q: query } : {} });
      setStudents(data.students || []);
    } catch { setStudents([]); }
  }, [query]);

  useEffect(() => { if (byStudent) loadStudents(); else loadFeed(); }, [byStudent, loadFeed, loadStudents]);
  useLiveRefresh(byStudent ? loadStudents : loadFeed, { intervalMs: 60_000 });

  const onSearchChange = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQuery(v.trim()), 350);
  };

  const loadMore = async () => {
    if (!cursor) return;
    try {
      const { data } = await api.get("/admin/school/hq/activity", { params: { ...params, before: cursor } });
      setGroups((prev) => [...(prev || []), ...(data.groups || [])]);
      setCursor(data.next_before || null);
    } catch { /* ignore */ }
  };

  const sections = useMemo(() => {
    const out = [];
    let current = null;
    (groups || []).forEach((g) => {
      const sec = timeSection(g.ended_at);
      if (sec !== current) { out.push({ section: sec, items: [] }); current = sec; }
      out[out.length - 1].items.push(g);
    });
    return out;
  }, [groups]);

  const s = summary || {};
  return (
    <div className="space-y-4" data-testid={testid}>
      {/* ── Today at a glance — click a number to filter the feed ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid={`${testid}-summary`}>
        <SummaryTile value={s.active_students_today} label="Active students" onClick={() => { setByStudent(true); }} testid={`${testid}-sum-students`} />
        <SummaryTile value={s.practices_today} label="Practices today" onClick={() => { setByStudent(false); setTypeCat("practice_completed"); setRange("today"); }} testid={`${testid}-sum-practices`} />
        <SummaryTile value={s.lessons_completed_today} label="Lessons completed" onClick={() => { setByStudent(false); setTypeCat("lesson_completed"); setRange("today"); }} testid={`${testid}-sum-lessons`} />
        <SummaryTile value={s.checkpoints_submitted_today} label="Checkpoints today" onClick={() => { setByStudent(false); setTypeCat("checkpoint_submitted"); setRange("today"); }} testid={`${testid}-sum-checkpoints`} />
        <SummaryTile value={s.needs_attention} label="Need attention" accent="text-shAccent"
                     onClick={() => { setByStudent(false); setAttentionOnly(true); setRange("all"); setTypeCat(""); }} testid={`${testid}-sum-attention`} />
      </div>

      {/* ── Filter / control bar — every control queries the backend ── */}
      <div className="flex flex-wrap items-center gap-2" data-testid={`${testid}-filters`}>
        <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search client, dog, or course…"
               data-testid={`${testid}-search`}
               className="flex-1 min-w-[180px] min-h-[42px] rounded-xl border border-shBorder/55 bg-black/20 px-3 text-sm text-shText focus:outline-none focus:border-shSecondary/40" />
        <select value={typeCat} onChange={(e) => setTypeCat(e.target.value)} data-testid={`${testid}-type`}
                className="min-h-[42px] rounded-xl border border-shBorder/55 bg-black/20 px-2 text-[12px] text-shText">
          {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} data-testid={`${testid}-range`}
                className="min-h-[42px] rounded-xl border border-shBorder/55 bg-black/20 px-2 text-[12px] text-shText">
          {RANGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" onClick={() => setAttentionOnly((v) => !v)} data-testid={`${testid}-attention-toggle`}
                className={`min-h-[42px] px-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition ${attentionOnly ? "bg-shAccent/15 border-shAccent/50 text-shAccent" : "border-shBorder/55 text-shTextMuted hover:text-shText"}`}>
          Needs Attention Only
        </button>
        <button type="button" onClick={() => setByStudent((v) => !v)} data-testid={`${testid}-group-by-student`}
                className={`min-h-[42px] px-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition ${byStudent ? "bg-shSecondary/15 border-shSecondary/50 text-shSecondary" : "border-shBorder/55 text-shTextMuted hover:text-shText"}`}>
          Group by Student
        </button>
      </div>

      {/* ── Feed ── */}
      {byStudent ? (
        <div className="space-y-2.5" data-testid={`${testid}-students`}>
          {students === null ? (
            <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
          ) : students.length === 0 ? (
            <EmptyState icon="fa-user-graduate" accent="cyan" title="No recent student activity" description="Student rollups appear here as clients train." />
          ) : (
            students.map((st, i) => <StudentCard key={`${st.client_id}:${st.dog_id}`} s={st} onOpenStudent={onOpenStudent} testid={`${testid}-student-${i}`} />)
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {groups === null ? (
            <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
          ) : groups.length === 0 ? (
            <EmptyState icon="fa-stream" accent="cyan" title="No activity matches" description="Try widening the filters — history is kept, not hidden." />
          ) : (
            sections.map(({ section, items }) => (
              <section key={section}>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-shTextMuted mb-2" data-testid={`${testid}-section-${section.toLowerCase().replace(/\s+/g, "-")}`}>{section}</p>
                <div className="space-y-2.5">
                  {items.map((g, i) => <GroupCard key={g.id} group={g} onOpenStudent={onOpenStudent} testid={`${testid}-group-${section}-${i}`} />)}
                </div>
              </section>
            ))
          )}
          {cursor && (
            <button type="button" onClick={loadMore} data-testid={`${testid}-load-more`}
                    className="w-full min-h-[44px] rounded-xl border border-shBorder/60 text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText transition">
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
