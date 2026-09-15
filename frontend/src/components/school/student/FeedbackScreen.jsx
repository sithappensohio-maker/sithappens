import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import ScorePair from "./ScorePair";
import SchoolExperienceFeedbackCard from "./SchoolExperienceFeedbackCard";
import { coachAttentionItems, coachFeed, coachEmptyState, coachDate, COACH_FILTERS } from "../../../lib/coachFeed";

/* Coach — the client destination formerly labelled "Feedback" (the route
 * stays /school/feedback; /school/coach is an alias). It is where the client
 * reads what the trainer told them: lesson recaps, Practice reviews,
 * checkpoint results, and the real question/reply threads.
 *
 * Stage 5 of the clarity pass. Same sources as before — /lesson-history,
 * /checkpoint-history, /support and the Today view-model — no new store and
 * no second messaging system. NEEDS YOUR ATTENTION shows only when the client
 * must do something; RECENT FROM YOUR TRAINER is one chronological feed with
 * a small filter; the rich checkpoint and conversation cards below are the
 * same components as before, opened in place. */

const OUTCOME = {
  advance: { label: "Passed", cls: "text-shPrimary", icon: "fa-circle-check" },
  prescribe_practice: { label: "More Practice needed", cls: "text-shAccent", icon: "fa-rotate-left" },
  trainer_assist_recommended: { label: "Trainer Assist", cls: "text-purple-300", icon: "fa-hand-holding-heart" },
};

// Practice Review = coaching, never a grade — wording stays encouraging.
const PRACTICE_REVIEW_META = {
  looks_good: { label: "Looks Good", cls: "text-shPrimary", icon: "fa-thumbs-up" },
  keep_practicing: { label: "Keep Practicing", cls: "text-shSecondary", icon: "fa-rotate" },
  trainer_attention: { label: "Trainer follow-up", cls: "text-shAccent", icon: "fa-hand-holding-heart" },
};

const TONE_CLS = { good: "text-shPrimary", attention: "text-shAccent", note: "text-shSecondary", waiting: "text-shTextMuted" };

function fmt(iso) { return coachDate(iso); }

function CriterionGroup({ title, criteria = [], scores = {} }) {
  if (!criteria.length) return null;
  return (
    <div className="rounded-xl border border-shBorder bg-black/15 p-3">
      <p className="text-[14px] font-black text-shText mb-2">{title}</p>
      <div className="space-y-2">
        {criteria.map((c) => {
          const score = Number(scores?.[c.id] ?? 0);
          return (
            <div key={c.id}>
              <div className="flex justify-between gap-2 text-[14px]"><span className="text-shTextMuted">{c.name}</span><span className="font-black text-shText">{score}/5</span></div>
              <div className="h-1.5 rounded-full bg-shBorder/40 mt-1 overflow-hidden"><div className="h-full bg-shPrimary rounded-full" style={{ width: `${Math.max(0, Math.min(100, score * 20))}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Full checkpoint result — unchanged component, now opened in place from the feed. */
function FeedbackEntry({ entry, onAsk }) {
  const [open, setOpen] = useState(false);
  const meta = OUTCOME[entry.outcome] || OUTCOME.advance;
  const rubric = entry.rubric_snapshot || {};
  const hasRubric = (rubric.handler_criteria?.length || 0) + (rubric.dog_criteria?.length || 0) > 0;
  const p = entry.prescription || {};
  const ta = entry.trainer_assist || {};
  return (
    <article className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid={`native-feedback-${entry.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-black uppercase tracking-[0.18em] text-shTextMuted">Checkpoint result</p>
          <h3 className="text-[20px] font-black text-shText mt-1">{entry.lesson_name || "Checkpoint"}</h3>
          <p className="text-[14px] text-shTextMuted mt-1">{[entry.module_name, entry.trainer_name, fmt(entry.graded_at)].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={`text-[13px] font-black uppercase tracking-widest ${meta.cls}`}><i className={`fas ${meta.icon} mr-1.5`} />{meta.label}</span>
      </div>

      <div className="mt-4" data-testid={`feedback-scores-${entry.id}`} data-scored={(entry.handler_overall != null || entry.dog_overall != null) ? "true" : "false"}>
        <ScorePair handler={entry.handler_overall} dog={entry.dog_overall} />
        {entry.handler_overall == null && entry.dog_overall == null && (
          <p className="text-[14px] text-shTextMuted mt-2.5 leading-snug" data-testid={`feedback-unscored-${entry.id}`}>
            Scores weren&apos;t recorded for this one — your trainer&apos;s note is the record.
          </p>
        )}
      </div>
      {entry.trainer_feedback && <p className="mt-4 text-[16px] text-gray-200 leading-relaxed border-l-2 border-shSecondary/35 pl-3 whitespace-pre-wrap">“{entry.trainer_feedback}”</p>}
      {(entry.video_annotations || []).length > 0 && <div className="mt-4 rounded-xl border border-shSecondary/20 bg-shSecondary/[0.04] p-3"><p className="text-[13px] font-black uppercase tracking-widest text-shSecondary">Trainer video notes</p><div className="space-y-2 mt-2">{entry.video_annotations.map((a)=><p key={a.id} className="text-[15px] text-shText"><span className="font-black text-shSecondary mr-2">{Math.floor(Number(a.timestamp_seconds||0)/60)}:{String(Math.floor(Number(a.timestamp_seconds||0)%60)).padStart(2,'0')}</span>{a.note}</p>)}</div></div>}

      {entry.outcome === "prescribe_practice" && (
        <div className="mt-4 rounded-xl border border-shAccent/25 bg-shAccent/[0.05] p-3 text-[15px] text-shTextMuted">
          <p className="font-black text-shAccent uppercase tracking-widest text-[13px]">What to work on</p>
          {p.practice_sessions_remaining != null && <p className="mt-1">{p.practice_sessions_remaining} more Practice session{p.practice_sessions_remaining === 1 ? "" : "s"} before you try again.</p>}
          {p.refresher_lesson_name && <p className="mt-1">Review {p.refresher_lesson_name} first.</p>}
          {p.notes && <p className="mt-1">{p.notes}</p>}
        </div>
      )}
      {entry.outcome === "trainer_assist_recommended" && (
        <div className="mt-4 rounded-xl border border-purple-400/25 bg-purple-500/[0.05] p-3 text-[15px] text-shTextMuted">
          <p className="font-black text-purple-300 uppercase tracking-widest text-[13px]">Trainer Assist</p>
          {ta.scheduled_date && <p className="mt-1">Scheduled: {[ta.scheduled_date, ta.scheduled_time].filter(Boolean).join(" · ")}</p>}
          {!ta.scheduled_date && <p className="mt-1">Your trainer will arrange the hands-on session with you.</p>}
          {ta.client_summary && <p className="mt-1 text-shText">{ta.client_summary}</p>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3">
        {hasRubric && <button onClick={() => setOpen((v) => !v)} className="min-h-[44px] px-2 -mx-2 inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">{open ? "Hide scoring details" : "View scoring details"} <i className={`fas fa-chevron-${open ? "up" : "down"} ml-1`} /></button>}
        <button onClick={() => onAsk?.({ checkpoint: entry })} className="min-h-[44px] px-2 -mx-2 inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText"><i className="fas fa-comment-dots mr-1" />Ask about this result</button>
      </div>
      {open && hasRubric && <div className="grid sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-shBorder"><CriterionGroup title="Handler Skills" criteria={rubric.handler_criteria} scores={entry.handler_scores} /><CriterionGroup title="Dog Performance" criteria={rubric.dog_criteria} scores={entry.dog_scores} /></div>}
    </article>
  );
}

/* Real conversation thread — unchanged behaviour (read receipt + reply). */
function ConversationCard({ thread, onRefresh }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const messages = thread.messages || [];
  useEffect(() => {
    if (!thread.unread_client) return undefined;
    let cancelled = false;
    api.post(`/me/messages/${thread.id}/read`)
      .then(() => { if (!cancelled) onRefresh?.(); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [thread.id, thread.unread_client, onRefresh]);
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try { await api.post(`/me/messages/${thread.id}/reply`, { body: reply.trim() }); setReply(""); onRefresh?.(); }
    finally { setBusy(false); }
  };
  const waitingOnTrainer = thread.status !== "resolved" && thread.last_message_role === "client";
  return (
    <div className="rounded-2xl border border-shBorder bg-black/15 p-4" data-testid={`school-thread-${thread.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-[16px] font-black text-shText">{thread.subject}</p><p className="text-[14px] text-shTextMuted mt-0.5">{[thread.school_module_name, thread.school_lesson_name].filter(Boolean).join(" · ") || "School"}</p></div>
        {thread.unread_client ? <span className="text-[11px] font-black uppercase tracking-widest bg-shAccent/15 text-shAccent px-2 py-1 rounded">New reply</span>
          : waitingOnTrainer ? <span className="text-[11px] font-black uppercase tracking-widest bg-shBorder/40 text-shTextMuted px-2 py-1 rounded">Waiting on your trainer</span> : null}
      </div>
      <div className="space-y-2 mt-3 max-h-64 overflow-y-auto">
        {messages.map((m) => <div key={m.id} className={`rounded-xl p-2.5 text-[15px] ${m.sender_role === "client" ? "bg-shBorder/20" : "bg-shPrimary/[0.07] border border-shPrimary/15"}`}><p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">{m.sender_role === "client" ? "You" : m.sender_name}</p><p className="text-shText mt-1 whitespace-pre-wrap">{m.body}</p></div>)}
      </div>
      <div className="flex gap-2 mt-3"><input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Reply…" aria-label="Reply to your trainer" className="flex-1 min-w-0 rounded-xl border border-shBorder bg-black/20 px-3 py-2 text-[15px] text-shText" /><button onClick={send} disabled={busy || !reply.trim()} className="min-h-[40px] px-3 rounded-xl bg-shPrimary text-bgHeader text-[13px] font-black uppercase tracking-widest disabled:opacity-40">Send</button></div>
    </div>
  );
}

/* ------------------------------------------------------------ feed cards */
function Kind({ label, icon, tone = "note" }) {
  return <p className={`text-[12px] font-black uppercase tracking-[0.18em] ${TONE_CLS[tone] || TONE_CLS.note}`}><i className={`fas ${icon} mr-1.5`} aria-hidden="true" />{label}</p>;
}

function FeedCard({ item, expanded, onToggle, onAsk, onOpenHistory, onOpenPractice, onRefresh, homeworkOpenable }) {
  const when = fmt(item.at);
  const meta = [item.who && item.kind !== "question" ? `with ${item.who}` : item.who, when].filter(Boolean).join(" · ");
  if (item.kind === "recap") {
    return (
      <article className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4" data-testid={`coach-item-${item.id}`} data-kind="recap">
        <Kind label="Session recap" icon="fa-person-chalkboard" tone="good" />
        <h3 className="text-[18px] font-black text-shText leading-snug mt-1">{item.title}</h3>
        {meta && <p className="text-[14px] text-shTextMuted mt-0.5">{meta}</p>}
        {(item.wentWell || item.keepWorking) ? (
          <div className="mt-2.5 space-y-2">
            {item.wentWell && <p className="text-[15px] text-shText leading-relaxed"><span className="font-black text-shPrimary">Went well · </span>{item.wentWell}</p>}
            {item.keepWorking && <p className="text-[15px] text-shText leading-relaxed"><span className="font-black text-shAccent">Keep working on · </span>{item.keepWorking}</p>}
          </div>
        ) : item.note ? (
          <p className="mt-2.5 text-[15px] text-gray-200 leading-relaxed border-l-2 border-shPrimary/35 pl-3">“{item.note}”</p>
        ) : (
          <p className="mt-2.5 text-[15px] text-shTextMuted">Your trainer logged this lesson.</p>
        )}
        {expanded && (
          <div className="mt-2.5 space-y-2" data-testid={`coach-recap-full-${item.id}`}>
            {item.note && (item.wentWell || item.keepWorking) && <p className="text-[15px] text-gray-200 italic leading-relaxed border-l-2 border-shSecondary/35 pl-3">“{item.note}”</p>}
            {item.nextFocus && <p className="text-[15px] text-shText leading-relaxed"><span className="font-black text-shSecondary">Next focus · </span>{item.nextFocus}</p>}
            {item.practice.length > 0 && <p className="text-[15px] text-shTextMuted">Practice assigned: {item.practice.join(", ")}</p>}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-x-3">
          <button type="button" onClick={onToggle} className="min-h-[44px] px-2 -mx-2 inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText" data-testid={`coach-toggle-${item.id}`} aria-expanded={expanded}>
            {expanded ? "Hide full recap" : "View full recap"} <i className={`fas fa-chevron-${expanded ? "up" : "down"} ml-1`} aria-hidden="true" />
          </button>
          {onOpenHistory && <button type="button" onClick={onOpenHistory} className="min-h-[44px] px-2 -mx-2 inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">All recaps</button>}
        </div>
      </article>
    );
  }
  if (item.kind === "checkpoint") {
    return (
      <article className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4" data-testid={`coach-item-${item.id}`} data-kind="checkpoint">
        <Kind label="Checkpoint result" icon="fa-clipboard-check" tone={item.tone} />
        <h3 className="text-[18px] font-black text-shText leading-snug mt-1">{item.title}</h3>
        {meta && <p className="text-[14px] text-shTextMuted mt-0.5">{meta}</p>}
        <p className={`text-[16px] font-black mt-2 ${TONE_CLS[item.tone]}`}><i className={`fas ${item.icon} mr-1.5`} aria-hidden="true" />{item.result}</p>
        <p className="text-[15px] text-shText mt-0.5 leading-relaxed">{item.body}</p>
        {item.note && !expanded && <p className="mt-2 text-[15px] text-gray-200 leading-relaxed border-l-2 border-shSecondary/35 pl-3 line-clamp-3">“{item.note}”</p>}
        {item.entry && (
          <button type="button" onClick={onToggle} className="mt-1.5 min-h-[44px] px-2 -mx-2 inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText" data-testid={`coach-toggle-${item.id}`} aria-expanded={expanded}>
            {expanded ? "Hide results" : item.tone === "attention" ? "See what to work on" : "See results"} <i className={`fas fa-chevron-${expanded ? "up" : "down"} ml-1`} aria-hidden="true" />
          </button>
        )}
        {expanded && item.entry && <div className="mt-3"><FeedbackEntry entry={item.entry} onAsk={onAsk} /></div>}
      </article>
    );
  }
  if (item.kind === "practice") {
    const openable = homeworkOpenable(item.homeworkId);
    return (
      <article className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4" data-testid={`coach-item-${item.id}`} data-kind="practice">
        <Kind label="Practice review" icon="fa-bullseye" tone={item.tone} />
        <h3 className="text-[18px] font-black text-shText leading-snug mt-1">{item.title}</h3>
        {meta && <p className="text-[14px] text-shTextMuted mt-0.5">{meta}</p>}
        <p className={`text-[16px] font-black mt-2 ${TONE_CLS[item.tone]}`}><i className={`fas ${item.icon} mr-1.5`} aria-hidden="true" />{item.result}</p>
        {item.note ? <p className="mt-2 text-[15px] text-gray-200 leading-relaxed border-l-2 border-shPrimary/35 pl-3 whitespace-pre-wrap">“{item.note}”</p>
          : <p className="mt-1 text-[15px] text-shTextMuted">{item.tone === "waiting" ? "Your trainer hasn't looked at this yet. Nothing to do until they do." : "Your trainer reviewed this Practice."}</p>}
        {openable && item.tone === "attention" && (
          <button type="button" onClick={() => onOpenPractice?.({ id: item.homeworkId })} data-testid={`coach-practice-open-${item.homeworkId}`}
                  className="mt-3 min-h-[46px] px-4 rounded-xl bg-shPrimary text-[#071018] text-[14px] font-black uppercase tracking-widest inline-flex items-center gap-2 hover:brightness-110 transition">
            Start Practice <i className="fas fa-arrow-right text-[12px]" aria-hidden="true" />
          </button>
        )}
        {openable && item.tone !== "attention" && (
          <button type="button" onClick={() => onOpenPractice?.({ id: item.homeworkId })} data-testid={`coach-practice-open-${item.homeworkId}`}
                  className="mt-1.5 min-h-[44px] px-2 -mx-2 inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">
            View Practice <i className="fas fa-chevron-right ml-1 text-[11px]" aria-hidden="true" />
          </button>
        )}
      </article>
    );
  }
  // question — a thread (reply-able) or a Practice Coach question with its answer
  if (item.thread) {
    return (
      <article className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4" data-testid={`coach-item-${item.id}`} data-kind="question">
        <Kind label={item.unread ? "New reply" : item.waiting ? "Waiting on your trainer" : "Conversation"} icon="fa-comment-dots" tone={item.unread ? "attention" : item.waiting ? "waiting" : "note"} />
        <h3 className="text-[18px] font-black text-shText leading-snug mt-1">{item.title}</h3>
        {meta && <p className="text-[14px] text-shTextMuted mt-0.5">{meta}</p>}
        {!expanded && item.body && <p className="mt-2 text-[15px] text-shText leading-relaxed"><span className="font-black text-shTextMuted">{item.who}: </span>{item.body}</p>}
        <button type="button" onClick={onToggle} className="mt-1.5 min-h-[44px] px-2 -mx-2 inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText" data-testid={`coach-toggle-${item.id}`} aria-expanded={expanded}>
          {expanded ? "Hide conversation" : "Open conversation"} <i className={`fas fa-chevron-${expanded ? "up" : "down"} ml-1`} aria-hidden="true" />
        </button>
        {expanded && <div className="mt-3"><ConversationCard thread={item.thread} onRefresh={onRefresh} /></div>}
      </article>
    );
  }
  const q = item.question || {};
  return (
    <article className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4" data-testid={`coach-item-${item.id}`} data-kind="question">
      <Kind label={q.answer ? "Trainer reply" : "Your question"} icon="fa-comment-dots" tone={q.answer ? "note" : "waiting"} />
      <h3 className="text-[18px] font-black text-shText leading-snug mt-1">{item.title}</h3>
      {when && <p className="text-[14px] text-shTextMuted mt-0.5">{when}</p>}
      <p className="mt-2 text-[15px] text-shText leading-relaxed"><span className="font-black text-shTextMuted">You asked: </span>“{q.text}”</p>
      {q.answer
        ? <p className="mt-2 text-[15px] text-gray-200 leading-relaxed border-l-2 border-shSecondary/35 pl-3"><span className="font-black text-shSecondary">{q.answered_by || "Your trainer"}: </span>{q.answer}</p>
        : <p className="mt-2 text-[14px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-hourglass-half mr-1.5" aria-hidden="true" />Waiting on a reply — nothing else to do</p>}
    </article>
  );
}

const PAGE = 8;

export default function FeedbackScreen({ enrollmentId, home = null, onAsk, onChanged, onOpenHistory, onOpenPractice, onPrimaryAction, initialData = null }) {
  // `initialData` lets tests render the screen with server-shaped records
  // without a network; the live screen always loads from the endpoints.
  const [history, setHistory] = useState(initialData?.history ?? null);
  const [support, setSupport] = useState(initialData?.support ?? null);
  // Lesson recaps are the other half of the client's coaching record. They
  // come from the SAME allowlisted endpoint the history screen uses — this is
  // a second view of one record, not a second feedback store.
  const [recaps, setRecaps] = useState(initialData?.recaps ?? []);
  const [filter, setFilter] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState({});
  const listRef = useRef(null);
  const load = useCallback(async () => {
    const [h, s] = await Promise.all([api.get(`/portal/school/${enrollmentId}/checkpoint-history`), api.get(`/portal/school/${enrollmentId}/support`)]);
    setHistory(h.data || []); setSupport(s.data || { threads: [], practice_questions: [] });
    try {
      const { data: lh } = await api.get(`/portal/school/${enrollmentId}/lesson-history`);
      setRecaps(lh?.lessons || []);
    } catch { setRecaps([]); }
    onChanged?.();
  }, [enrollmentId, onChanged]);
  useEffect(() => {
    if (!enrollmentId) return;
    setHistory(null); setSupport(null); setRecaps([]); setFilter("all"); setShown(PAGE); setExpanded({});
    load().catch(() => { setHistory([]); setSupport({ threads: [], practice_questions: [] }); });
  }, [load, enrollmentId]);

  const attention = useMemo(() => coachAttentionItems({ home, support, history: history || [] }), [home, support, history]);
  const feed = useMemo(() => coachFeed({ recaps, history: history || [], support, home }), [recaps, history, support, home]);
  const filtered = useMemo(() => (filter === "all" ? feed : feed.filter((it) => it.kind === filter)), [feed, filter]);
  const visible = filtered.slice(0, shown);
  const counts = useMemo(() => feed.reduce((acc, it) => { acc[it.kind] = (acc[it.kind] || 0) + 1; return acc; }, {}), [feed]);
  const activeIds = useMemo(() => new Set((home?.active_practice || []).map((r) => r.id)), [home]);
  const homeworkOpenable = (id) => !!id && activeIds.has(id);

  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const runAttention = (item) => {
    const c = item.cta || {};
    if (c.run === "open_practice") { onOpenPractice?.({ id: c.homeworkId }); return; }
    if (c.run === "primary_action") { onPrimaryAction?.(); return; }
    if (c.run === "expand" && c.target) {
      setFilter("all"); setShown(Math.max(shown, feed.length));
      setExpanded((e) => ({ ...e, [c.target]: true }));
      setTimeout(() => { document.querySelector(`[data-testid="coach-item-${CSS.escape(c.target)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50);
    }
  };

  if (history === null || support === null) return <div className="space-y-3"><div className="h-24 rounded-2xl bg-shBorder/25 animate-pulse" /><div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" /></div>;

  // Only claim there is nothing yet when EVERY source is genuinely empty —
  // a client with practice feedback but no checkpoint has still heard
  // from their trainer.
  const nothingYet = history.length === 0 && recaps.length === 0 && (support.practice_reviews || []).length === 0
    && (support.threads || []).length === 0 && (support.practice_questions || []).length === 0 && feed.length === 0;
  const empty = coachEmptyState(home);

  return (
    <div className="max-w-3xl mx-auto space-y-5" data-testid="native-feedback-screen" data-coach-dog={home?.dog?.id || ""}>
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-black uppercase tracking-[0.22em] text-shSecondary">Your training team</p>
          <h1 className="text-2xl sm:text-3xl font-black text-shText mt-1">Coach</h1>
          <p className="text-[16px] text-shTextMuted mt-1">What your trainer told you — lesson recaps, Practice reviews, checkpoint results, and replies.</p>
        </div>
        <button onClick={() => onAsk?.({})} className="min-h-[44px] px-4 rounded-xl border border-shSecondary/35 text-shSecondary text-[14px] font-black uppercase tracking-widest" data-testid="coach-ask-trainer"><i className="fas fa-comment-dots mr-1.5" />Ask Trainer</button>
      </header>

      {/* ---------------------------------------------- NEEDS YOUR ATTENTION */}
      {attention.length > 0 && (
        <section className="space-y-2.5" data-testid="coach-attention">
          <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shAccent"><i className="fas fa-hand-point-right mr-1.5" aria-hidden="true" />Needs your attention</p>
          {attention.map((item) => (
            <article key={item.id} className="rounded-2xl border border-shAccent/35 bg-shAccent/[0.05] p-4" data-testid={`coach-attention-${item.kind}`}>
              <h3 className="text-[18px] font-black text-shText leading-snug">{item.title}</h3>
              <p className="text-[15px] text-shText mt-1 leading-relaxed">{item.body}</p>
              {item.note && <p className="mt-2 text-[15px] text-gray-200 leading-relaxed border-l-2 border-shAccent/40 pl-3"><span className="font-black text-shText">Trainer note: </span>{item.note}</p>}
              {item.cta && (
                <button type="button" onClick={() => runAttention(item)} data-testid={`coach-attention-cta-${item.kind}`} data-primary-action="true"
                        className="mt-3 min-h-[46px] px-4 rounded-xl bg-shPrimary text-[#071018] text-[14px] font-black uppercase tracking-widest inline-flex items-center gap-2 hover:brightness-110 transition">
                  {item.cta.label} <i className="fas fa-arrow-right text-[12px]" aria-hidden="true" />
                </button>
              )}
            </article>
          ))}
        </section>
      )}

      {/* ------------------------------------------- RECENT FROM YOUR TRAINER */}
      {feed.length > 0 && (
        <section className="space-y-3" data-testid="coach-feed" ref={listRef}>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary">Recent from your trainer</p>
              <p className="text-[15px] text-shTextMuted mt-1">Newest first.</p>
            </div>
          </div>
          <div role="tablist" aria-label="Filter Coach" className="sh-coach-filters flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" data-testid="coach-filters">
            {COACH_FILTERS.filter((f) => f.key === "all" || counts[f.key]).map((f) => {
              const on = filter === f.key;
              return (
                <button key={f.key} type="button" role="tab" aria-selected={on} onClick={() => { setFilter(f.key); setShown(PAGE); }} data-testid={`coach-filter-${f.key}`}
                        className={`shrink-0 min-h-[40px] px-3 rounded-full text-[13px] font-black uppercase tracking-widest border ${on ? "bg-shPrimary text-[#071018] border-shPrimary" : "bg-black/15 text-shTextMuted border-shBorder hover:text-shText"}`}>
                  {f.label}{f.key !== "all" && counts[f.key] ? ` · ${counts[f.key]}` : ""}
                </button>
              );
            })}
          </div>
          <div className="space-y-3" data-testid="native-practice-reviews">
            {visible.map((item) => (
              <FeedCard key={item.id} item={item} expanded={!!expanded[item.id]} onToggle={() => toggle(item.id)}
                        onAsk={onAsk} onOpenHistory={onOpenHistory} onOpenPractice={onOpenPractice} onRefresh={load} homeworkOpenable={homeworkOpenable} />
            ))}
          </div>
          {filtered.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} data-testid="coach-view-older"
                    className="min-h-[44px] px-1 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">
              View older <i className="fas fa-chevron-right ml-1 text-[11px]" aria-hidden="true" />
            </button>
          )}
          {filtered.length === 0 && <p className="text-[15px] text-shTextMuted" data-testid="coach-filter-empty">Nothing in this group yet.</p>}
        </section>
      )}

      {nothingYet && (
        <section className="rounded-3xl border border-shBorder/60 bg-[var(--sh-card-base)] p-5 sm:p-6" data-testid="native-feedback-empty">
          <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shSecondary"><i className="fas fa-comment-dots mr-1.5" aria-hidden="true" />{empty.title}</p>
          <p className="text-[16px] text-shText mt-1.5 leading-relaxed">{empty.body}</p>
        </section>
      )}

      <div className="pt-2 border-t border-shBorder/60" data-testid="school-experience-feedback-section">
        <SchoolExperienceFeedbackCard enrollmentId={enrollmentId} source="feedback_screen" />
      </div>
    </div>
  );
}

export { FeedbackEntry, ConversationCard, PRACTICE_REVIEW_META, OUTCOME };
