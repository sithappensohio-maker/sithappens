import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import ScorePair from "./ScorePair";
import AchievementCard from "../../training/AchievementCard";
import ProgressRing from "../../training/ProgressRing";
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
          <p className="text-[16px] font-black text-shText truncate">{module.name}</p>
          <p className="text-[14px] text-shTextMuted mt-0.5">{q.title || "Module Quiz"}{q.attempt_count > 0 ? ` · ${q.attempt_count} attempt${q.attempt_count === 1 ? "" : "s"}` : ""}</p>
        </div>
        <span className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${QUIZ_TONE_CLS[chip.tone] || QUIZ_TONE_CLS.locked}`}>{chip.label}</span>
          {q.attempt_count > 0 && <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[13px]`} />}
        </span>
      </button>
      {open && q.attempt_count > 0 && (
        <div className="mt-2 space-y-1 border-t border-shBorder/40 pt-2" data-testid={`progress-quiz-attempts-${module.id}`}>
          {attempts === null ? (
            <p className="text-[14px] text-shTextMuted"><i className="fas fa-spinner fa-spin mr-1" />Loading attempts…</p>
          ) : (
            attempts.map((a) => (
              <p key={a.id} className="text-[15px] text-shTextMuted">
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
  return <div className="rounded-xl border border-shBorder bg-black/15 p-3"><p className="text-xl font-black text-shText">{value}</p><p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mt-0.5">{label}</p></div>;
}

export default function ProgressScreen({ enrollmentId, home, detail, onOpenHistory, onPrimaryAction }) {
  const [history, setHistory] = useState(null);
  const [trophies, setTrophies] = useState(null);
  const [record, setRecord] = useState(null);
  const load = useCallback(async () => {
    const [h, t, r] = await Promise.all([api.get(`/portal/school/${enrollmentId}/checkpoint-history`), api.get("/portal/trophies"), api.get(`/portal/school/${enrollmentId}/record`)]);
    setHistory(h.data || []); setTrophies([...(t.data?.dog_trophies || []), ...(t.data?.client_trophies || [])]); setRecord(r.data || { programs: [], checkpoints: [] });
  }, [enrollmentId]);
  useEffect(() => { if (!enrollmentId) return; setHistory(null); setTrophies(null); setRecord(null); load().catch(() => { setHistory([]); setTrophies([]); setRecord({ programs: [], checkpoints: [] }); }); }, [load, enrollmentId]);

  const p = home?.progress || {};
  /* School Achievements = this dog's trophies PLUS the owner's client
     trophies (Practice streaks, Practice completions, visit tiers) — those
     are earned through School work, so they belong on the School record. */
  const dogTrophies = useMemo(() => (trophies || []).filter((t) => t.recipient_type === "client" || !home?.dog?.id || t.recipient_id === home.dog.id || t.dog_id === home.dog.id), [trophies, home?.dog?.id]);
  /* Every graded checkpoint is part of the record, including legacy rows
     whose overall scores resolve to null — dropping those told a client with
     a real passed checkpoint that they had none. `scored` stays separate
     because an average can only be taken over rows that actually have
     numbers. */
  const graded = (history || []).filter((x) => x && x.status === "graded");
  const scored = graded.filter((x) => x.handler_overall != null || x.dog_overall != null);
  const explain = interpretation(scored, home?.dog?.name);
  const pct = Number(p.course_pct || 0);
  const mastery = Number(p.mastered_pct || 0);

  if (history === null || trophies === null || record === null) return <div className="space-y-3"><div className="h-36 rounded-2xl bg-shBorder/25 animate-pulse" /><div className="h-44 rounded-2xl bg-shBorder/20 animate-pulse" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-5" data-testid="native-progress-screen">
      <header><p className="text-[13px] font-black uppercase tracking-[0.22em] text-shPrimary">Your training journey</p><h1 className="text-2xl sm:text-3xl font-black text-shText mt-1">Progress</h1><p className="text-[16px] text-shTextMuted mt-1">Course completion and trainer-scored checkpoint results are separate on purpose.</p></header>

      {/* Keep the momentum — the SAME current_action the rest of School runs
          on, so Progress ends with something to do rather than a dead end.
          Suppressed entirely when the server offers no action. */}
      {onPrimaryAction && home?.current_action?.label && (
        <section className="rounded-2xl border border-shPrimary/30 bg-shPrimary/[0.05] p-4 sm:p-5" data-testid="progress-momentum">
          <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary">Keep the momentum</p>
          {home.current_action.sublabel && (
            <p className="text-[16px] text-shTextMuted mt-1.5 leading-relaxed">{home.current_action.sublabel}</p>
          )}
          <button type="button" onClick={onPrimaryAction} data-testid="progress-momentum-action"
                  className="mt-3 w-full sm:w-auto sm:px-6 min-h-[50px] rounded-xl bg-shPrimary text-[#071018] font-black text-[17px] inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
            {home.current_action.label}<i className="fas fa-arrow-right text-[14px]" />
          </button>
        </section>
      )}

      {onOpenHistory && (
        <button type="button" onClick={onOpenHistory} data-testid="progress-open-lesson-history"
                className="w-full flex items-center gap-3 rounded-xl border border-shSecondary/30 bg-shSecondary/[0.05] p-3 text-left min-h-[52px]">
          <span className="w-9 h-9 rounded-xl bg-shSecondary/10 border border-shSecondary/25 grid place-items-center shrink-0"><i className="fas fa-clipboard-list text-shSecondary" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-black text-shText">Training history</span>
            <span className="block text-[14px] text-shTextMuted">Every lesson recap for this program</span>
          </span>
          <i className="fas fa-chevron-right text-shTextMuted text-[14px]" />
        </button>
      )}

      <section className="rounded-3xl border border-shPrimary/30 bg-gradient-to-br from-shPrimary/[0.07] via-black/10 to-shSecondary/[0.04] p-5 sm:p-6" data-testid="progress-course-completion">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <ProgressRing pct={pct} testid="progress-course-ring"/>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-black uppercase tracking-widest text-shPrimary">Overall progress</p>
            <p className="text-[21px] sm:text-[23px] font-black text-shText mt-0.5 leading-tight">{home?.program?.name}</p>
            <p className="text-[15px] text-shTextMuted mt-0.5">{p.current_module_name || (home?.status === "completed" ? "Completed" : "")}</p>
            <div className="h-2.5 rounded-full bg-black/25 overflow-hidden mt-3"><div className="h-full bg-shPrimary rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4"><Stat value={`${p.lessons_completed || 0}/${p.lessons_total || 0}`} label="Lessons" /><Stat value={`${p.modules_completed || 0}/${p.modules_total || 0}`} label="Modules" /><Stat value={p.checkpoints_passed || 0} label="Checkpoints passed" /></div>
      </section>

      {mastery > 0 && <section className="rounded-2xl border border-shSecondary/25 bg-[var(--sh-card-base)] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[13px] font-black uppercase tracking-widest text-shSecondary">Skill mastery</p><p className="text-[15px] text-shTextMuted mt-1">Trainer-scored skill goals — separate from finishing course lessons.</p></div><p className="text-2xl font-black text-shSecondary">{mastery}%</p></div></section>}

      {(detail?.roadmap?.modules || []).some((m) => m.quiz) && (
        <section className="space-y-2" data-testid="progress-module-quizzes">
          <div><p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary">Module quizzes</p><p className="text-[15px] text-shTextMuted mt-1">Knowledge checks that unlock each next module — retakes are always free.</p></div>
          {(detail.roadmap.modules || []).filter((m) => m.quiz).map((m) => (
            <ModuleQuizProgressRow key={m.id} enrollmentId={enrollmentId} module={m} />
          ))}
        </section>
      )}

      <section className="space-y-3" data-testid="progress-checkpoint-history">
        <div><p className="text-[13px] font-black uppercase tracking-[0.2em] text-shSecondary">Checkpoint history</p><p className="text-[15px] text-shTextMuted mt-1">Handler Skills and Dog Performance stay separate so you know what is limiting progress.</p></div>
        {graded.length === 0 ? <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-5 text-center text-[16px] text-shTextMuted">No trainer-scored checkpoints yet. Your first review will appear here.</div> : (
          <>
            {graded.map((x, i) => {
              const hasScore = x.handler_overall != null || x.dog_overall != null;
              return (
                <div key={x.id} className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4" data-testid={`progress-checkpoint-${x.id}`} data-scored={hasScore ? "true" : "false"}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <p className="text-[16px] font-black text-shText">{x.lesson_name || `Checkpoint ${graded.length - i}`}</p>
                      <p className="text-[14px] text-shTextMuted mt-0.5">{[x.module_name, x.trainer_name, x.graded_at ? new Date(x.graded_at).toLocaleDateString() : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted shrink-0">{(x.outcome || "reviewed").replace(/_/g, " ")}</span>
                  </div>
                  <ScorePair handler={x.handler_overall} dog={x.dog_overall} compact />
                  {!hasScore && (
                    <p className="text-[14px] text-shTextMuted mt-2.5 leading-snug" data-testid={`progress-checkpoint-unscored-${x.id}`}>
                      Scores weren&apos;t recorded for this one — your trainer&apos;s note is the record.
                    </p>
                  )}
                  {x.trainer_feedback && <p className="text-[15px] text-shText/90 mt-2.5 leading-relaxed border-l-2 border-shSecondary/35 pl-2.5 whitespace-pre-wrap">{x.trainer_feedback}</p>}
                </div>
              );
            })}
            {explain && <div className="rounded-2xl border border-shSecondary/25 bg-shSecondary/[0.05] p-4"><p className="text-[16px] font-black text-shText">{explain.title}</p><p className="text-[15px] text-shTextMuted mt-1 leading-relaxed">{explain.body}</p></div>}
          </>
        )}
      </section>

      <section className="space-y-3" data-testid="progress-achievements"><p className="text-[13px] font-black uppercase tracking-[0.2em] text-shAccent">Achievements</p>{dogTrophies.length ? <div className="grid sm:grid-cols-2 gap-3">{dogTrophies.map((t) => <AchievementCard key={t.id} trophy={t} testid={`progress-achievement-${t.id}`} />)}</div> : <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 text-[15px] text-shTextMuted">Achievements will appear here as {home?.dog?.name || "your dog"} reaches milestones.</div>}</section>

      <section className="space-y-3" data-testid="dog-training-record">
        <div><p className="text-[13px] font-black uppercase tracking-[0.2em] text-shSecondary">Permanent training record</p><p className="text-[15px] text-shTextMuted mt-1">Every in-person, online, and hybrid School program and trainer-scored checkpoint stays attached to {home?.dog?.name || "your dog"}.</p></div>
        <div className="space-y-2">{(record.programs || []).map((program) => <div key={program.school_enrollment_id} className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-3 flex items-center justify-between gap-3"><div><p className="text-[16px] font-black text-shText">{program.name || "School program"}</p><p className="text-[13px] text-shTextMuted mt-1">{program.started_at ? new Date(program.started_at).toLocaleDateString() : "Start date not recorded"}{program.completed_at ? ` → ${new Date(program.completed_at).toLocaleDateString()}` : ""}</p></div><span className={`text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${program.status === "completed" ? "bg-shPrimary/15 text-shPrimary" : "bg-shBorder/25 text-shTextMuted"}`}>{program.status || "active"}</span></div>)}</div>
      </section>

      {detail?.status === "completed" && <p className="text-[14px] text-shTextMuted">Course history remains available for review after completion.</p>}
    </div>
  );
}
