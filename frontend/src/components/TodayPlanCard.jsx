import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Sprint 103 — Today's Plan: a single unified checklist for the client portal
 * that pulls today's available day from every active daily-tracker homework
 * and lets the client tick steps off without drilling into each tracker.
 *
 * Auto-submits the day when all steps are checked; surfaces a Catch-Up modal
 * if the client missed yesterday.
 *
 * Props:
 *   onChanged — optional callback after any state change (used to refresh
 *               the parent portal so other tiles update too).
 */
export default function TodayPlanCard({ onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null); // `${hwid}:${stepid}`
  const [err, setErr] = useState("");
  const [catchUpFor, setCatchUpFor] = useState(null); // { homework_id, missed_day_number, dog_name, title }

  const load = async () => {
    try {
      const r = await api.get("/portal/today-plan");
      setData(r.data);
      setErr("");
    } catch (e) { setErr(e.response?.data?.detail || "Couldn't load today's plan"); }
  };
  useEffect(() => { load(); }, []);

  const toggleStep = async (item, step) => {
    setBusy(`${item.homework_id}:${step.id}`);
    setErr("");
    try {
      await api.post(`/homework/${item.homework_id}/day/${item.day_number}/toggle-step`, {
        step_id: step.id,
        done: !step.done,
      });
      await load();
      onChanged?.();
    } catch (e) { setErr(e.response?.data?.detail || "Couldn't update step"); }
    finally { setBusy(null); }
  };

  const applyCatchUp = async (strategy) => {
    if (!catchUpFor) return;
    try {
      await api.post(`/homework/${catchUpFor.homework_id}/catch-up`, {
        strategy,
        missed_day_number: catchUpFor.missed_day_number,
      });
      setCatchUpFor(null);
      await load();
      onChanged?.();
    } catch (e) { setErr(e.response?.data?.detail || "Couldn't apply catch-up"); }
  };

  if (!data || data.count === 0) return null; // hide entirely when no active trackers

  return (
    <div className="bg-bgPanel border border-shGreen/40 rounded-xl p-5 mb-5 shadow-lg" data-testid="today-plan-card">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-lg font-black text-white uppercase italic tracking-tight">
          <i className="fas fa-bullseye text-shGreen mr-2"/>Today's Plan
        </h2>
        <span className="text-[12px] text-gray-500 font-black uppercase tracking-widest">{data.count} active</span>
      </div>

      {err && <p className="text-red-400 text-[14px] mb-3" data-testid="today-plan-err">{err}</p>}

      <div className="space-y-4">
        {data.items.map((item) => {
          const pct = item.total_days ? Math.round((item.streak / item.total_days) * 100) : 0;
          // Sprint 105 — auto-roll up per-day minutes from steps; the client sees a single total at-a-glance
          const totalMinutes = (item.steps || []).reduce((acc, s) => acc + (Number(s.minutes) || 0), 0);
          const allResources = [...(item.resources || []), ...(item.plan_resources || [])];
          return (
            <div key={item.homework_id} className="bg-bgBase border border-bgHover rounded-lg p-4" data-testid={`today-plan-item-${item.homework_id}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-black uppercase tracking-widest text-shBlue">
                    {item.dog_name} · day {item.day_number}/{item.total_days}
                    {totalMinutes > 0 && <span className="text-gray-500 normal-case"> · ~{totalMinutes} min</span>}
                  </p>
                  <h3 className="text-base font-black text-white uppercase italic tracking-tight">{item.title}</h3>
                  {item.day_focus && <p className="text-[14px] text-gray-300 mt-0.5"><i className="fas fa-flag-checkered text-shGreen mr-1"/>{item.day_focus}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Progress</p>
                  <p className="text-shGreen text-xl font-black">{pct}%</p>
                </div>
              </div>

              {allResources.length > 0 && (
                <div className="mb-3 bg-purple-500/5 border border-purple-400/30 rounded p-2.5" data-testid={`today-plan-resources-${item.homework_id}`}>
                  <p className="text-[12px] font-black uppercase tracking-widest text-purple-300 mb-1.5"><i className="fas fa-paperclip mr-1"/>Take with you</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allResources.map((r) => {
                      // Sprint 106 — uploaded files come back via the resource endpoint
                      // and are streamed as base64; we open them via a tiny helper that
                      // fetches + re-bundles as a blob URL so the browser handles PDF/image previews.
                      const isUpload = !!r.media_id;
                      return (
                        <a
                          key={r.id}
                          href={isUpload ? `#res-${r.id}` : (r.url || "#")}
                          target={isUpload ? "_self" : "_blank"}
                          rel="noreferrer"
                          onClick={isUpload ? (async (e) => {
                            e.preventDefault();
                            try {
                              const res = await api.get(`/homework/resource/${r.media_id}`);
                              const win = window.open("", "_blank");
                              if (win) win.location.href = res.data?.data || "#";
                            } catch (err) { console.warn("download failed", err); }
                          }) : undefined}
                          data-testid={`today-plan-resource-${r.id}`}
                          className="bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 px-2.5 py-1 rounded text-[13px] font-black inline-flex items-center gap-1.5 transition"
                        >
                          <i className={`fas ${isUpload ? "fa-file-arrow-down" : "fa-arrow-up-right-from-square"} text-[10px]`}/>{r.name}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {item.missed_yesterday && (
                <button onClick={() => setCatchUpFor({
                  homework_id: item.homework_id,
                  missed_day_number: item.missed_day_number,
                  dog_name: item.dog_name,
                  title: item.title,
                })}
                        data-testid={`today-plan-catchup-${item.homework_id}`}
                        className="w-full mb-3 bg-shOrange/15 border border-shOrange/40 hover:bg-shOrange/25 rounded p-3 text-left transition">
                  <p className="text-[13px] font-black uppercase tracking-widest text-shOrange">
                    <i className="fas fa-clock-rotate-left mr-1"/>You missed day {item.missed_day_number}
                  </p>
                  <p className="text-[14px] text-gray-300">Tap to pick a catch-up plan.</p>
                </button>
              )}

              {item.status === "submitted" ? (
                <p className="text-[14px] text-shGreen italic"><i className="fas fa-circle-check mr-1"/>Submitted — waiting on trainer review.</p>
              ) : item.status === "needs_redo" ? (
                <p className="text-[14px] text-shOrange italic"><i className="fas fa-rotate-left mr-1"/>Trainer asked you to redo this day. Re-check steps below.</p>
              ) : null}

              {item.steps.length === 0 ? (
                <p className="text-[14px] text-gray-500 italic mt-1">No checklist steps on this day — open the homework card below to log fields.</p>
              ) : (
                <div className="space-y-1.5 mt-1">
                  {item.steps.map((s) => {
                    const id = `${item.homework_id}:${s.id}`;
                    const isBusy = busy === id;
                    return (
                      <button key={s.id} onClick={() => toggleStep(item, s)}
                              disabled={isBusy || item.status === "submitted"}
                              data-testid={`today-plan-step-${item.homework_id}-${s.id}`}
                              className={`w-full flex items-center gap-3 p-2.5 rounded border text-left transition ${s.done ? "border-shGreen/40 bg-shGreen/5" : "border-bgHover hover:border-shGreen/40"} disabled:opacity-60`}>
                        <span className={`w-6 h-6 rounded grid place-items-center shrink-0 ${s.done ? "bg-shGreen text-bgHeader" : "bg-bgPanel border border-bgHover"}`}>
                          {isBusy ? <i className="fas fa-spinner fa-spin text-xs"/> : s.done ? <i className="fas fa-check text-xs"/> : null}
                        </span>
                        <span className={`flex-1 text-[15px] ${s.done ? "line-through text-gray-500" : "text-white"}`}>{s.label}</span>
                        {s.minutes ? (
                          <span className={`text-[12px] font-black uppercase tracking-widest ${s.done ? "text-gray-600" : "text-shGreen"}`}>
                            {s.minutes} min
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {item.all_done && item.status === "submitted" && (
                <p className="text-[13px] text-shGreen mt-2 font-black uppercase tracking-widest"><i className="fas fa-paper-plane mr-1"/>All steps done — auto-submitted!</p>
              )}
            </div>
          );
        })}
      </div>

      {catchUpFor && (
        <CatchUpModal target={catchUpFor} onApply={applyCatchUp} onClose={() => setCatchUpFor(null)} />
      )}
    </div>
  );
}


function CatchUpModal({ target, onApply, onClose }) {
  const [busy, setBusy] = useState(null);
  const apply = async (strategy) => {
    setBusy(strategy);
    await onApply(strategy);
    setBusy(null);
  };
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose} data-testid="catch-up-modal">
      <div className="bg-bgPanel border border-shOrange/40 rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h4 className="text-lg font-black text-white uppercase italic tracking-tight">
          <i className="fas fa-clock-rotate-left text-shOrange mr-2"/>Catch up — {target.dog_name}
        </h4>
        <p className="text-[14px] text-gray-400 mt-1">Day {target.missed_day_number} of {target.title} got skipped. What now?</p>

        <div className="space-y-2 mt-4">
          <CatchUpOption busy={busy === "skip_missed"} onClick={() => apply("skip_missed")} testid="catchup-skip"
                         icon="fa-forward" title="Skip yesterday" subtitle="Mark it done and move on to today's plan."/>
          <CatchUpOption busy={busy === "double_up"} onClick={() => apply("double_up")} testid="catchup-double"
                         icon="fa-layer-group" title="Double up today" subtitle="Add yesterday's steps onto today so you stay on schedule."/>
          <CatchUpOption busy={busy === "shift_forward"} onClick={() => apply("shift_forward")} testid="catchup-shift"
                         icon="fa-right-from-bracket" title="Push back the schedule" subtitle="Bump everything out by one day."/>
        </div>

        <button onClick={onClose} disabled={!!busy} className="mt-4 text-gray-400 hover:text-white text-[13px] font-black uppercase tracking-widest w-full text-center py-2">
          Never mind
        </button>
      </div>
    </div>
  );
}

function CatchUpOption({ busy, onClick, icon, title, subtitle, testid }) {
  return (
    <button onClick={onClick} disabled={busy} data-testid={testid}
            className="w-full text-left flex items-start gap-3 p-3 rounded border border-bgHover hover:border-shGreen/50 bg-bgBase transition disabled:opacity-60">
      <i className={`fas ${busy ? "fa-spinner fa-spin" : icon} text-shGreen text-xl w-8 text-center pt-0.5`}/>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-white uppercase tracking-tight">{title}</p>
        <p className="text-[13px] text-gray-400">{subtitle}</p>
      </div>
    </button>
  );
}
