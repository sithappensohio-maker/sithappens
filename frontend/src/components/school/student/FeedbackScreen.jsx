import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import EmptyState from "../../training/EmptyState";
import ScorePair from "./ScorePair";

const OUTCOME = {
  advance: { label: "Ready to advance", cls: "text-shPrimary", icon: "fa-circle-check" },
  prescribe_practice: { label: "More practice needed", cls: "text-shAccent", icon: "fa-rotate-left" },
  trainer_assist_recommended: { label: "Trainer Assist recommended", cls: "text-purple-300", icon: "fa-hand-holding-heart" },
};

function fmt(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

function CriterionGroup({ title, criteria = [], scores = {} }) {
  if (!criteria.length) return null;
  return (
    <div className="rounded-xl border border-shBorder bg-black/15 p-3">
      <p className="text-[11px] font-black text-shText mb-2">{title}</p>
      <div className="space-y-2">
        {criteria.map((c) => {
          const score = Number(scores?.[c.id] ?? 0);
          return (
            <div key={c.id}>
              <div className="flex justify-between gap-2 text-[11px]"><span className="text-shTextMuted">{c.name}</span><span className="font-black text-shText">{score}/5</span></div>
              <div className="h-1.5 rounded-full bg-shBorder/40 mt-1 overflow-hidden"><div className="h-full bg-shPrimary rounded-full" style={{ width: `${Math.max(0, Math.min(100, score * 20))}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shTextMuted">Trainer review</p>
          <h3 className="text-[17px] font-black text-shText mt-1">{entry.lesson_name || "Checkpoint"}</h3>
          <p className="text-[11px] text-shTextMuted mt-1">{[entry.module_name, entry.trainer_name, fmt(entry.graded_at)].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${meta.cls}`}><i className={`fas ${meta.icon} mr-1.5`} />{meta.label}</span>
      </div>

      <div className="mt-4"><ScorePair handler={entry.handler_overall} dog={entry.dog_overall} /></div>
      {entry.trainer_feedback && <p className="mt-4 text-[13px] text-gray-200 leading-relaxed border-l-2 border-shSecondary/35 pl-3 whitespace-pre-wrap">“{entry.trainer_feedback}”</p>}
      {(entry.video_annotations || []).length > 0 && <div className="mt-4 rounded-xl border border-shSecondary/20 bg-shSecondary/[0.04] p-3"><p className="text-[10px] font-black uppercase tracking-widest text-shSecondary">Trainer video notes</p><div className="space-y-2 mt-2">{entry.video_annotations.map((a)=><p key={a.id} className="text-[12px] text-shText"><span className="font-black text-shSecondary mr-2">{Math.floor(Number(a.timestamp_seconds||0)/60)}:{String(Math.floor(Number(a.timestamp_seconds||0)%60)).padStart(2,'0')}</span>{a.note}</p>)}</div></div>}

      {entry.outcome === "prescribe_practice" && (
        <div className="mt-4 rounded-xl border border-shAccent/25 bg-shAccent/[0.05] p-3 text-[12px] text-shTextMuted">
          <p className="font-black text-shAccent uppercase tracking-widest text-[10px]">Practice plan</p>
          {p.practice_sessions_remaining != null && <p className="mt-1">{p.practice_sessions_remaining} practice session{p.practice_sessions_remaining === 1 ? "" : "s"} remaining.</p>}
          {p.notes && <p className="mt-1">{p.notes}</p>}
        </div>
      )}
      {entry.outcome === "trainer_assist_recommended" && (
        <div className="mt-4 rounded-xl border border-purple-400/25 bg-purple-500/[0.05] p-3 text-[12px] text-shTextMuted">
          <p className="font-black text-purple-300 uppercase tracking-widest text-[10px]">Trainer Assist · {(ta.status || "recommended").replace(/_/g, " ")}</p>
          {ta.scheduled_date && <p className="mt-1">Scheduled: {[ta.scheduled_date, ta.scheduled_time].filter(Boolean).join(" · ")}</p>}
          {ta.client_summary && <p className="mt-1 text-shText">{ta.client_summary}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {hasRubric && <button onClick={() => setOpen((v) => !v)} className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">{open ? "Hide scoring details" : "View scoring details"} <i className={`fas fa-chevron-${open ? "up" : "down"} ml-1`} /></button>}
        <button onClick={() => onAsk?.({ checkpoint: entry })} className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:text-shText"><i className="fas fa-comment-dots mr-1" />Ask about this review</button>
      </div>
      {open && hasRubric && <div className="grid sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-shBorder"><CriterionGroup title="Handler Skills" criteria={rubric.handler_criteria} scores={entry.handler_scores} /><CriterionGroup title="Dog Performance" criteria={rubric.dog_criteria} scores={entry.dog_scores} /></div>}
    </article>
  );
}

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
  return (
    <div className="rounded-2xl border border-shBorder bg-black/15 p-4" data-testid={`school-thread-${thread.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-[13px] font-black text-shText">{thread.subject}</p><p className="text-[11px] text-shTextMuted mt-0.5">{[thread.school_module_name, thread.school_lesson_name].filter(Boolean).join(" · ") || "Online School"}</p></div>
        {thread.unread_client && <span className="text-[9px] font-black uppercase tracking-widest bg-shAccent/15 text-shAccent px-2 py-1 rounded">New reply</span>}
      </div>
      <div className="space-y-2 mt-3 max-h-64 overflow-y-auto">
        {messages.map((m) => <div key={m.id} className={`rounded-xl p-2.5 text-[12px] ${m.sender_role === "client" ? "bg-shBorder/20" : "bg-shPrimary/[0.07] border border-shPrimary/15"}`}><p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">{m.sender_name}</p><p className="text-shText mt-1 whitespace-pre-wrap">{m.body}</p></div>)}
      </div>
      <div className="flex gap-2 mt-3"><input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Reply…" className="flex-1 min-w-0 rounded-xl border border-shBorder bg-black/20 px-3 py-2 text-[12px] text-shText" /><button onClick={send} disabled={busy || !reply.trim()} className="min-h-[40px] px-3 rounded-xl bg-shPrimary text-bgHeader text-[10px] font-black uppercase tracking-widest disabled:opacity-40">Send</button></div>
    </div>
  );
}

export default function FeedbackScreen({ enrollmentId, onAsk, onChanged }) {
  const [history, setHistory] = useState(null);
  const [support, setSupport] = useState(null);
  const load = useCallback(async () => {
    const [h, s] = await Promise.all([api.get(`/portal/school/${enrollmentId}/checkpoint-history`), api.get(`/portal/school/${enrollmentId}/support`)]);
    setHistory(h.data || []); setSupport(s.data || { threads: [], practice_questions: [] });
    onChanged?.();
  }, [enrollmentId, onChanged]);
  useEffect(() => { if (!enrollmentId) return; setHistory(null); setSupport(null); load().catch(() => { setHistory([]); setSupport({ threads: [], practice_questions: [] }); }); }, [load, enrollmentId]);

  const answeredPractice = useMemo(() => (support?.practice_questions || []).filter((q) => q.answer), [support]);
  const pendingPractice = useMemo(() => (support?.practice_questions || []).filter((q) => !q.answer), [support]);

  if (history === null || support === null) return <div className="space-y-3"><div className="h-24 rounded-2xl bg-shBorder/25 animate-pulse" /><div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" /></div>;
  return (
    <div className="max-w-3xl mx-auto space-y-5" data-testid="native-feedback-screen">
      <header className="flex items-start justify-between gap-3 flex-wrap"><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-shAccent">Your trainer is part of the course</p><h1 className="text-2xl sm:text-3xl font-black text-shText mt-1">Trainer Feedback</h1><p className="text-[13px] text-shTextMuted mt-1">Checkpoint reviews, trainer guidance, and your School conversations in one place.</p></div><button onClick={() => onAsk?.({})} className="min-h-[42px] px-4 rounded-xl border border-shSecondary/35 text-shSecondary text-[11px] font-black uppercase tracking-widest"><i className="fas fa-comment-dots mr-1.5" />Ask Trainer</button></header>

      {history.length === 0 ? <EmptyState icon="fa-comment-dots" message="No trainer feedback yet — checkpoint reviews will appear here as you progress." testid="native-feedback-empty" /> : <section className="space-y-3"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shTextMuted">Checkpoint reviews · {history.length}</p>{history.map((e) => <FeedbackEntry key={e.id} entry={e} onAsk={onAsk} />)}</section>}

      {(support.threads || []).length > 0 && <section className="space-y-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shSecondary">Trainer conversations</p><p className="text-[12px] text-shTextMuted mt-1">Questions asked through Online School stay attached to the training context.</p></div>{support.threads.map((t) => <ConversationCard key={t.id} thread={t} onRefresh={load} />)}</section>}

      {(answeredPractice.length > 0 || pendingPractice.length > 0) && <section className="space-y-2"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shSecondary">Practice Coach questions</p>{[...pendingPractice, ...answeredPractice].map((q) => <div key={q.id} className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-3"><p className="text-[11px] text-shTextMuted">{[q.module_name, q.lesson_name].filter(Boolean).join(" · ")}</p><p className="text-[13px] text-shText mt-1">You asked: “{q.text}”</p>{q.answer ? <p className="text-[13px] text-gray-200 mt-2 border-l-2 border-shSecondary/35 pl-3"><span className="font-black text-shSecondary">{q.answered_by || "Your trainer"}:</span> {q.answer}</p> : <p className="text-[11px] font-black uppercase tracking-widest text-shAccent mt-2">Waiting on a reply</p>}</div>)}</section>}
    </div>
  );
}
