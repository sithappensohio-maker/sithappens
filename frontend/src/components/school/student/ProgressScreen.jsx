import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import ScorePair from "./ScorePair";
import AchievementCard from "../../training/AchievementCard";
import { moduleQuizChip } from "../../../lib/onlineSchoolPolish";

const QUIZ_TONE_CLS = {
  passed: "bg-shPrimary/15 text-shPrimary",
  ready: "bg-shSecondary/15 text-shSecondary",
  locked: "bg-shBorder/30 text-shTextMuted",
};

function ModuleQuizProgressRow({ enrollmentId, module }) {
  const [open, setOpen] = useState(false);
  const [attempts, setAttempts] = useState(null);
  const chip = moduleQuizChip(module.quiz);
  useEffect(() => {
    if (!open || attempts !== null) return undefined;
    let live = true;
    api.get(`/portal/school/${enrollmentId}/modules/${module.id}/quiz/attempts`)
      .then(({ data }) => { if (live) setAttempts(data || []); })
      .catch(() => { if (live) setAttempts([]); });
    return () => { live = false; };
  }, [open, attempts, enrollmentId, module.id]);
  if (!chip) return null;
  const q = module.quiz || {};
  return (
    <div className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-3" data-testid={`progress-quiz-${module.id}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left min-h-[36px]">
        <div className="min-w-0">
          <p className="text-[13px] font-black text-shText truncate">{module.name}</p>
          <p className="text-[11px] text-shTextMuted mt-0.5">{q.title || "Module Quiz"}{q.attempt_count > 0 ? ` · ${q.attempt_count} attempt${q.attempt_count === 1 ? "" : "s"}` : ""}</p>
        </div>
        <span className="flex items-center gap-2 shrink-0">
          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${QUIZ_TONE_CLS[chip.tone] || QUIZ_TONE_CLS.locked}`}>{chip.label}</span>
          {q.attempt_count > 0 && <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[10px]`} />}
        </span>
      </button>
      {open && q.attempt_count > 0 && (
        <div className="mt-2 space-y-1 border-t border-shBorder/40 pt-2" data-testid={`progress-quiz-attempts-${module.id}`}>
          {attempts === null ? (
            <p className="text-[11px] text-shTextMuted"><i className="fas fa-spinner fa-spin mr-1" />Loading attempts…</p>
          ) : (
            attempts.map((a) => (
              <p key={a.id} className="text-[12px] text-shTextMuted">
                Attempt {a.attempt_number} — <span className={a.passed ? "text-shPrimary font-black" : "text-shText"}>{Math.round(a.score_percent || 0)}%</span>
                {a.passed && <i className="fas fa-check text-shPrimary ml-1.5" />}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function avg(values) {
  const xs = values.filter((v) => Number.isFinite(Number(v))).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function interpretation(history, dogName) {
  const h = avg(history.map((x) => x.handler_overall));
  const d = avg(history.map((x) => x.dog_overall));
  if (h == null || d == null) return null;
  const diff = h - d;
  if (diff >= 0.5) return { title: "Your handling is ahead of your dog's consistency", body: `Your technique is scoring strongly. Keep building ${dogName || "your dog"}'s repetitions before increasing difficulty.` };
  if (diff <= -0.5) return { title: `${dogName || "Your dog"} is showing the skill clearly`, body: "Your dog's performance is currently ahead of your handling score. Focus on making your technique more consistent." };
  return { title: "Handler and dog are progressing together", body: "Your checkpoint scores are tracking closely. Keep building clean repetitions at the current level." };
}

function Stat({ value, label }) {
  return <div className="rounded-xl border border-shBorder bg-black/15 p-3"><p className="text-xl font-black text-shText">{value}</p><p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mt-0.5">{label}</p></div>;
}

export default function ProgressScreen({ enrollmentId, home, detail, onOpenHistory }) {
  const [history, setHistory] = useState(null);
  const [trophies, setTrophies] = useState(null);
  const [record, setRecord] = useState(null);
  const load = useCallback(async () => {
    const [h, t, r] = await Promise.all([api.get(`/portal/school/${enrollmentId}/checkpoint-history`), api.get("/portal/trophies"), api.get(`/portal/school/${enrollmentId}/record`)]);
    setHistory(h.data || []); setTrophies(t.data?.dog_trophies || []); setRecord(r.data || { programs: [], checkpoints: [] });
  }, [enrollmentId]);
  useEffect(() => { if (!enrollmentId) return; setHistory(null); setTrophies(null); setRecord(null); load().catch(() => { setHistory([]); setTrophies([]); setRecord({ programs: [], checkpoints: [] }); }); }, [load, enrollmentId]);

  const p = home?.progress || {};
  const dogTrophies = useMemo(() => (trophies || []).filter((t) => !home?.dog?.id || t.recipient_id === home.dog.id || t.dog_id === home.dog.id), [trophies, home?.dog?.id]);
  const scored = (history || []).filter((x) => x.handler_overall != null || x.dog_overall != null);
  const explain = interpretation(scored, home?.dog?.name);
  const pct = Number(p.course_pct || 0);
  const mastery = Number(p.mastered_pct || 0);

  if (history === null || trophies === null || record === null) return <div className="space-y-3"><div className="h-36 rounded-2xl bg-shBorder/25 animate-pulse" /><div className="h-44 rounded-2xl bg-shBorder/20 animate-pulse" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-5" data-testid="native-progress-screen">
      <header><p className="text-[10px] font-black uppercase tracking-[0.22em] text-shPrimary">Your training journey</p><h1 className="text-2xl sm:text-3xl font-black text-shText mt-1">Progress</h1><p className="text-[13px] text-shTextMuted mt-1">Course completion and trainer-scored checkpoint results are separate on purpose.</p></header>

      {onOpenHistory && (
        <button type="button" onClick={onOpenHistory} data-testid="progress-open-lesson-history"
                className="w-full flex items-center gap-3 rounded-xl border border-shSecondary/30 bg-shSecondary/[0.05] p-3 text-left min-h-[52px]">
          <span className="w-9 h-9 rounded-xl bg-shSecondary/10 border border-shSecondary/25 grid place-items-center shrink-0"><i className="fas fa-clipboard-list text-shSecondary" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-black text-shText">Training history</span>
            <span className="block text-[11.5px] text-shTextMuted">Every lesson recap for this program</span>
          </span>
          <i className="fas fa-chevron-right text-shTextMuted text-[11px]" />
        </button>
      )}

      <section className="rounded-2xl border border-shPrimary/30 bg-shPrimary/[0.055] p-5 sm:p-6" data-testid="progress-course-completion">
        <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-shPrimary">Course progress</p><p className="text-3xl font-black text-shText mt-1">{pct}%</p></div><p className="text-[12px] text-shTextMuted text-right">{home?.program?.name}<br/>{p.current_module_name || (home?.status === "completed" ? "Completed" : "")}</p></div>
        <div className="h-2.5 rounded-full bg-black/25 overflow-hidden mt-4"><div className="h-full bg-shPrimary rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
        <div className="grid grid-cols-3 gap-2 mt-4"><Stat value={`${p.lessons_completed || 0}/${p.lessons_total || 0}`} label="Lessons" /><Stat value={`${p.modules_completed || 0}/${p.modules_total || 0}`} label="Modules" /><Stat value={p.checkpoints_passed || 0} label="Checkpoints" /></div>
      </section>

      {mastery > 0 && <section className="rounded-2xl border border-shSecondary/25 bg-[var(--sh-card-base)] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-shSecondary">Skill mastery</p><p className="text-[12px] text-shTextMuted mt-1">Trainer-scored skill goals — separate from finishing course lessons.</p></div><p className="text-2xl font-black text-shSecondary">{mastery}%</p></div></section>}

      {(detail?.roadmap?.modules || []).some((m) => m.quiz) && (
        <section className="space-y-2" data-testid="progress-module-quizzes">
          <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shPrimary">Module quizzes</p><p className="text-[12px] text-shTextMuted mt-1">Knowledge checks that unlock each next module — retakes are always free.</p></div>
          {(detail.roadmap.modules || []).filter((m) => m.quiz).map((m) => (
            <ModuleQuizProgressRow key={m.id} enrollmentId={enrollmentId} module={m} />
          ))}
        </section>
      )}

      <section className="space-y-3" data-testid="progress-checkpoint-history">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shSecondary">Checkpoint history</p><p className="text-[12px] text-shTextMuted mt-1">Handler Skills and Dog Performance stay separate so you know what is limiting progress.</p></div>
        {scored.length === 0 ? <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-5 text-center text-[13px] text-shTextMuted">No trainer-scored checkpoints yet. Your first review will appear here.</div> : (
          <>
            {scored.map((x, i) => <div key={x.id} className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4"><div className="flex items-start justify-between gap-2 mb-3"><div><p className="text-[13px] font-black text-shText">{x.lesson_name || `Checkpoint ${scored.length - i}`}</p><p className="text-[11px] text-shTextMuted mt-0.5">{[x.module_name, x.graded_at ? new Date(x.graded_at).toLocaleDateString() : null].filter(Boolean).join(" · ")}</p></div><span className="text-[9px] font-black uppercase tracking-widest text-shTextMuted">{(x.outcome || "reviewed").replace(/_/g, " ")}</span></div><ScorePair handler={x.handler_overall} dog={x.dog_overall} compact /></div>)}
            {explain && <div className="rounded-2xl border border-shSecondary/25 bg-shSecondary/[0.05] p-4"><p className="text-[13px] font-black text-shText">{explain.title}</p><p className="text-[12px] text-shTextMuted mt-1 leading-relaxed">{explain.body}</p></div>}
          </>
        )}
      </section>

      <section className="space-y-3" data-testid="progress-achievements"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shAccent">Achievements</p>{dogTrophies.length ? <div className="grid sm:grid-cols-2 gap-3">{dogTrophies.map((t) => <AchievementCard key={t.id} icon={t.trophy_icon} name={t.trophy_name} date={t.awarded_at} description={t.trophy_description} testid={`progress-achievement-${t.id}`} />)}</div> : <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 text-[12px] text-shTextMuted">Achievements will appear here as {home?.dog?.name || "your dog"} reaches milestones.</div>}</section>

      <section className="space-y-3" data-testid="dog-training-record">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shSecondary">Permanent training record</p><p className="text-[12px] text-shTextMuted mt-1">Every in-person, online, and hybrid School program and trainer-scored checkpoint stays attached to {home?.dog?.name || "your dog"}.</p></div>
        <div className="space-y-2">{(record.programs || []).map((program) => <div key={program.school_enrollment_id} className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-3 flex items-center justify-between gap-3"><div><p className="text-[13px] font-black text-shText">{program.name || "School program"}</p><p className="text-[10px] text-shTextMuted mt-1">{program.started_at ? new Date(program.started_at).toLocaleDateString() : "Start date not recorded"}{program.completed_at ? ` → ${new Date(program.completed_at).toLocaleDateString()}` : ""}</p></div><span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${program.status === "completed" ? "bg-shPrimary/15 text-shPrimary" : "bg-shBorder/25 text-shTextMuted"}`}>{program.status || "active"}</span></div>)}</div>
      </section>

      {detail?.status === "completed" && <p className="text-[11px] text-shTextMuted">Course history remains available for review after completion.</p>}
    </div>
  );
}
