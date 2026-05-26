import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";

const MOOD_EMOJI = ["", "😞", "😅", "😐", "💪", "😄"];
const MOOD_LABEL = ["", "Rough", "Tricky", "OK", "Strong", "Awesome"];

const KIND_META = {
  reps:         { unit: "reps",   type: "number" },
  sets:         { unit: "sets",   type: "number" },
  duration_sec: { unit: "sec",    type: "number" },
  duration_min: { unit: "min",    type: "number" },
  distance_ft:  { unit: "ft",     type: "number" },
  success_rate: { unit: "%",      type: "number", min: 0, max: 100 },
  rating_5:     { unit: "/ 5",    type: "number", min: 1, max: 5 },
  mood_5:       { type: "mood" },
  checkbox:     { type: "checkbox" },
  text:         { type: "text" },
  longtext:     { type: "longtext" },
};

/**
 * Sprint 109 — Today's Plan: a single UNIFIED card for the client portal that
 * folds steps + homework fields + mood + photo + note + submit into one place.
 * Steps tick live (instant progress), but the day isn't COMPLETE until the
 * client fills out the required fields and hits "Mark Day Complete".
 *
 * Replaces the previous "TodayPlan steps only / DailyCheckInCard fields"
 * split — the homework's actionable day no longer renders twice.
 */
export default function TodayPlanCard({ onChanged, homeworkId = null, unwrapped = false }) {
  // Sprint 110l — when `homeworkId` is set, this card filters its today-plan
  // items down to ONE specific plan. When `unwrapped=true`, the outer green
  // "Today's Plan" frame is skipped — the caller (e.g. a per-plan homework
  // card in Portal.jsx) owns the chrome and just wants the actionable-day
  // content inline. This is what powers the merged single-card-per-plan UX.
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null); // `${hwid}:${stepid}`
  const [err, setErr] = useState("");
  const [catchUpFor, setCatchUpFor] = useState(null);
  // Per-homework form state. Key: homework_id → { values, mood, photo, note, submitting }
  const [forms, setForms] = useState({});
  // Sprint 110i — track which steps are expanded so clients can read the full
  // label/description without truncation. Also which item is in fullscreen.
  const [expanded, setExpanded] = useState({}); // key: `${hwid}:${stepid}` → bool
  const [fullscreenItem, setFullscreenItem] = useState(null);
  const toggleExpand = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const load = async () => {
    try {
      const r = await api.get("/portal/today-plan");
      setData(r.data);
      // Pre-fill form state from any existing in-progress log so refreshing
      // doesn't wipe what they typed.
      const next = {};
      for (const it of r.data.items || []) {
        const prev = forms[it.homework_id] || {};
        next[it.homework_id] = {
          values: prev.values || {},
          mood: prev.mood ?? 0,
          photo: prev.photo || "",
          note: prev.note || "",
          submitting: false,
        };
      }
      setForms(next);
      // Sprint 110k — if the fullscreen modal is currently open, re-point it
      // at the freshly-loaded item so check-step toggles reflect immediately.
      setFullscreenItem((curr) => {
        if (!curr) return curr;
        const fresh = (r.data.items || []).find((it) => it.homework_id === curr.homework_id);
        return fresh || curr;
      });
      setErr("");
    } catch (e) { setErr(e.response?.data?.detail || "Couldn't load today's plan"); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Sprint 110k — Escape key closes the fullscreen modal.
  useEffect(() => {
    if (!fullscreenItem) return;
    const onKey = (e) => { if (e.key === "Escape") setFullscreenItem(null); };
    window.addEventListener("keydown", onKey);
    // Lock background scroll while modal is open so the page behind doesn't drift
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreenItem]);

  const patchForm = (hwId, patch) => {
    setForms((f) => ({ ...f, [hwId]: { ...(f[hwId] || {}), ...patch } }));
  };

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

  const onPickPhoto = (hwId, e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => patchForm(hwId, { photo: reader.result || "" });
    reader.readAsDataURL(f);
  };

  // What blocks the day from being submittable? Returns "" if good to go, or a
  // human-readable reason.
  const blockReason = (item, form) => {
    const allStepsDone = (item.steps || []).every(s => s.done);
    if (item.steps?.length && !allStepsDone) return "Check off every step first";
    // Mood is collected on every submission unless mood_5 is already a field
    const hasMoodField = (item.fields || []).some(f => f.kind === "mood_5");
    if (!hasMoodField && !form.mood) return "Pick how today went (mood)";
    for (const f of item.fields || []) {
      const v = f.kind === "mood_5" ? form.mood : form.values?.[f.id];
      const km = KIND_META[f.kind] || {};
      const isEmpty = v === undefined || v === "" || v === null ||
                      (km.type === "number" && Number.isNaN(Number(v)));
      // Only checkbox is allowed to be "false". Everything else must have a value.
      if (km.type === "checkbox") continue;
      if (isEmpty) return `Fill in "${f.label || f.kind}"`;
    }
    return "";
  };

  const submitDay = async (item) => {
    const form = forms[item.homework_id] || {};
    const reason = blockReason(item, form);
    if (reason) { setErr(reason); return; }
    patchForm(item.homework_id, { submitting: true });
    setErr("");
    try {
      const field_values = {};
      for (const f of item.fields || []) {
        const v = f.kind === "mood_5" ? form.mood : form.values?.[f.id];
        if (v === undefined || v === "" || v === null) continue;
        const km = KIND_META[f.kind] || {};
        if (km.type === "number") field_values[f.id] = Number(v);
        else if (km.type === "checkbox") field_values[f.id] = !!v;
        else field_values[f.id] = v;
      }
      await api.post(`/homework/${item.homework_id}/day/${item.day_number}/submit`, {
        field_values,
        note: form.note || "",
        mood: form.mood || null,
        photo: form.photo || "",
        video_media_id: "",
      });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Submit failed");
    } finally {
      patchForm(item.homework_id, { submitting: false });
    }
  };

  if (!data || data.count === 0) return null;

  // Sprint 110l — filter to one plan when embedded inside a per-plan card.
  const visibleItems = homeworkId
    ? (data.items || []).filter((it) => it.homework_id === homeworkId)
    : (data.items || []);
  if (visibleItems.length === 0) return null;

  // When the caller passes unwrapped=true (rendering inside a parent plan
  // card), skip the green outer frame and just spit out the inner items list.
  const inner = (
    <>
      {err && <p className="text-red-400 text-[14px] mb-3" data-testid="today-plan-err">{err}</p>}
      <div className="space-y-4">
        {visibleItems.map((item) => {
          const pct = item.total_days ? Math.round((item.streak / item.total_days) * 100) : 0;
          // Sprint 105 — auto-roll up per-day minutes from steps; the client sees a single total at-a-glance
          const totalMinutes = (item.steps || []).reduce((acc, s) => acc + (Number(s.minutes) || 0), 0);
          const allResources = [...(item.resources || []), ...(item.plan_resources || [])];
          return (
            <div key={item.homework_id} className={`${unwrapped ? "" : "bg-bgBase border border-bgHover rounded-lg p-4"}`} data-testid={`today-plan-item-${item.homework_id}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-black uppercase tracking-widest text-shBlue">
                    {item.dog_name} · day {item.day_number}/{item.total_days}
                    {totalMinutes > 0 && <span className="text-gray-500 normal-case"> · ~{totalMinutes} min</span>}
                  </p>
                  <h3 className="text-base font-black text-white uppercase italic tracking-tight">{item.title}</h3>
                  {item.day_focus && <p className="text-[14px] text-gray-300 mt-0.5"><i className="fas fa-flag-checkered text-shGreen mr-1"/>{item.day_focus}</p>}
                </div>
                {/* Sprint 110m — when this is rendered inside a per-plan card
                    (unwrapped=true), the parent already shows a progress ring at
                    the header level, so we drop the duplicate "Progress N%" tile. */}
                {!unwrapped && (
                  <div className="text-right">
                    <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Progress</p>
                    <p className="text-shGreen text-xl font-black">{pct}%</p>
                  </div>
                )}
              </div>

              {/* Open-fullscreen affordance + instructions accordion */}
              <div className="flex items-center justify-end gap-2 mb-2">
                <button onClick={() => setFullscreenItem(item)}
                        data-testid={`today-plan-fullscreen-${item.homework_id}`}
                        className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:text-white border border-shBlue/40 hover:border-shBlue rounded px-2.5 py-1 transition">
                  <i className="fas fa-expand mr-1.5"/>Open fullscreen
                </button>
              </div>

              {item.instructions && (
                <div className="bg-bgPanel/60 border-l-4 border-shGreen/60 rounded p-3 mb-3" data-testid={`today-plan-instructions-block-${item.homework_id}`}>
                  <p className="text-[11px] font-black uppercase tracking-widest text-shGreen mb-1">
                    <i className="fas fa-bookmark mr-1"/>Trainer's instructions
                  </p>
                  <p className="text-[13px] text-gray-200 whitespace-pre-wrap leading-relaxed">{item.instructions}</p>
                </div>
              )}

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
                <p className="text-[14px] text-gray-500 italic mt-1">No checklist steps on this day — fill in the homework below.</p>
              ) : (
                <div className="space-y-1.5 mt-1">
                  {item.status !== "submitted" && (
                    <p className="text-[12px] font-black uppercase tracking-widest text-shGreen mb-1" data-testid={`today-plan-instructions-${item.homework_id}`}>
                      <i className="fas fa-square-check mr-1"/>Check off each step as you complete the homework below
                    </p>
                  )}
                  {item.steps.map((s) => {
                    const id = `${item.homework_id}:${s.id}`;
                    const isBusy = busy === id;
                    const hasMore = !!(s.description || s.notes);
                    const isOpen = !!expanded[id];
                    return (
                      <div key={s.id}
                           data-testid={`today-plan-step-${item.homework_id}-${s.id}`}
                           className={`rounded border transition ${s.done ? "border-shGreen/40 bg-shGreen/5" : "border-bgHover hover:border-shGreen/40"}`}>
                        <div className="flex items-start gap-3 p-2.5">
                          <button onClick={() => toggleStep(item, s)}
                                  disabled={isBusy || item.status === "submitted"}
                                  data-testid={`today-plan-step-check-${item.homework_id}-${s.id}`}
                                  className={`shrink-0 w-7 h-7 rounded grid place-items-center transition ${s.done ? "bg-shGreen text-bgHeader" : "bg-bgPanel border border-bgHover hover:border-shGreen"} disabled:opacity-60`}
                                  aria-label={s.done ? "Mark step incomplete" : "Mark step complete"}>
                            {isBusy ? <i className="fas fa-spinner fa-spin text-xs"/> : s.done ? <i className="fas fa-check text-xs"/> : null}
                          </button>
                          <button onClick={() => hasMore ? toggleExpand(id) : toggleStep(item, s)}
                                  disabled={isBusy || item.status === "submitted"}
                                  data-testid={`today-plan-step-label-${item.homework_id}-${s.id}`}
                                  className="flex-1 text-left disabled:opacity-60">
                            <p className={`text-[15px] leading-snug break-words ${s.done ? "line-through text-gray-500" : "text-white"}`}>
                              {s.label}
                              {hasMore && (
                                <i className={`fas ${isOpen ? "fa-chevron-up" : "fa-chevron-down"} ml-2 text-[11px] text-gray-500`}/>
                              )}
                            </p>
                          </button>
                          {s.minutes ? (
                            <span className={`shrink-0 text-[12px] font-black uppercase tracking-widest ${s.done ? "text-gray-600" : "text-shGreen"}`}>
                              {s.minutes} min
                            </span>
                          ) : null}
                        </div>
                        {hasMore && isOpen && (
                          <div className="px-3 pb-3 pt-1 border-t border-bgHover/60 space-y-2"
                               data-testid={`today-plan-step-detail-${item.homework_id}-${s.id}`}>
                            {s.description && (
                              <p className="text-[13px] text-gray-300 whitespace-pre-wrap leading-relaxed">
                                {s.description}
                              </p>
                            )}
                            {s.notes && (
                              <p className="text-[12px] text-gray-400 italic whitespace-pre-wrap leading-relaxed border-l-2 border-shBlue/40 pl-2">
                                <i className="fas fa-circle-info mr-1 text-shBlue"/>{s.notes}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline homework form — fields + mood + photo + note + submit.
                  Hidden once submitted/needs_redo flips back to submitted. */}
              {item.status !== "submitted" && (
                <InlineHomeworkForm
                  item={item}
                  form={forms[item.homework_id] || {}}
                  patch={(p) => patchForm(item.homework_id, p)}
                  onPickPhoto={(e) => onPickPhoto(item.homework_id, e)}
                  blockReason={blockReason(item, forms[item.homework_id] || {})}
                  onSubmit={() => submitDay(item)}
                />
              )}

            </div>
          );
        })}
      </div>
    </>
  );

  const portals = (
    <>
      {catchUpFor && (
        <CatchUpModal target={catchUpFor} onApply={applyCatchUp} onClose={() => setCatchUpFor(null)} />
      )}
      {fullscreenItem && createPortal(
        <FullscreenItemModal item={fullscreenItem}
                             busy={busy}
                             onToggleStep={(s) => toggleStep(fullscreenItem, s)}
                             onClose={() => setFullscreenItem(null)} />,
        document.body,
      )}
    </>
  );

  if (unwrapped) {
    return <>{inner}{portals}</>;
  }

  return (
    <div className="bg-bgPanel border border-shGreen/40 rounded-xl p-5 mb-5 shadow-lg" data-testid="today-plan-card">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-lg font-black text-white uppercase italic tracking-tight">
          <i className="fas fa-bullseye text-shGreen mr-2"/>Today's Plan
        </h2>
        <span className="text-[12px] text-gray-500 font-black uppercase tracking-widest">{visibleItems.length} active</span>
      </div>
      {inner}
      {portals}
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


function FullscreenItemModal({ item, busy, onToggleStep, onClose }) {
  // Sprint 110i — full-window view of a single training plan day. Steps render
  // with their full label, description, and notes expanded inline. Trainer's
  // instructions + plan resources stay visible. Designed to give the client
  // breathing room when reading longer step descriptions.
  const totalMinutes = (item.steps || []).reduce((acc, s) => acc + (Number(s.minutes) || 0), 0);
  const allResources = [...(item.resources || []), ...(item.plan_resources || [])];
  return (
    <div className="fixed inset-0 z-[9999] bg-bgBase overflow-y-auto overscroll-contain" data-testid="today-plan-fullscreen-modal" role="dialog" aria-modal="true">
      <div className="sticky top-0 z-10 bg-bgPanel border-b border-bgHover shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-shBlue">
              {item.dog_name} · day {item.day_number}/{item.total_days}
              {totalMinutes > 0 && <span className="text-gray-500 normal-case"> · ~{totalMinutes} min</span>}
            </p>
            <h2 className="text-lg font-black text-white uppercase italic tracking-tight truncate">{item.title}</h2>
          </div>
          <button onClick={onClose}
                  type="button"
                  data-testid="today-plan-fullscreen-close"
                  aria-label="Close fullscreen view"
                  className="shrink-0 bg-red-500/20 hover:bg-red-500/40 border-2 border-red-400/60 hover:border-red-400 text-white rounded-full w-11 h-11 grid place-items-center text-lg font-black transition active:scale-95">
            <i className="fas fa-xmark"/>
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {item.day_focus && (
          <div className="bg-shGreen/10 border border-shGreen/30 rounded-lg p-4">
            <p className="text-[12px] font-black uppercase tracking-widest text-shGreen mb-1.5">
              <i className="fas fa-flag-checkered mr-1"/>Today's focus
            </p>
            <p className="text-[16px] text-white leading-relaxed">{item.day_focus}</p>
          </div>
        )}

        {item.instructions && (
          <div className="bg-bgPanel border border-bgHover rounded-lg p-4">
            <p className="text-[12px] font-black uppercase tracking-widest text-gray-400 mb-2">
              <i className="fas fa-bookmark text-shGreen mr-1"/>Trainer's instructions
            </p>
            <p className="text-[15px] text-gray-200 whitespace-pre-wrap leading-relaxed">{item.instructions}</p>
          </div>
        )}

        {allResources.length > 0 && (
          <div className="bg-purple-500/5 border border-purple-400/30 rounded-lg p-4">
            <p className="text-[12px] font-black uppercase tracking-widest text-purple-300 mb-2">
              <i className="fas fa-paperclip mr-1"/>Resources for today
            </p>
            <div className="flex flex-wrap gap-2">
              {allResources.map((r) => {
                const isUpload = !!r.media_id;
                return (
                  <a key={r.id}
                     href={isUpload ? `#res-${r.id}` : (r.url || "#")}
                     target={isUpload ? "_self" : "_blank"}
                     rel="noreferrer"
                     onClick={isUpload ? (async (e) => {
                       e.preventDefault();
                       try {
                         const res = await api.get(`/homework/resource/${r.media_id}`);
                         const win = window.open("", "_blank");
                         if (win) win.location.href = res.data?.data || "#";
                       } catch (err) { console.warn(err); }
                     }) : undefined}
                     data-testid={`today-plan-fullscreen-resource-${r.id}`}
                     className="bg-purple-500/15 hover:bg-purple-500/30 text-purple-200 px-3 py-2 rounded text-[14px] font-black inline-flex items-center gap-2 transition">
                    <i className={`fas ${isUpload ? "fa-file-arrow-down" : "fa-arrow-up-right-from-square"} text-[11px]`}/>{r.name}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {(item.steps || []).length > 0 && (
          <div>
            <p className="text-[12px] font-black uppercase tracking-widest text-shGreen mb-3">
              <i className="fas fa-list-check mr-1"/>Steps · tap circle to mark done
            </p>
            <div className="space-y-3">
              {item.steps.map((s) => {
                const isBusy = busy === `${item.homework_id}:${s.id}`;
                return (
                  <div key={s.id}
                       data-testid={`today-plan-fullscreen-step-${s.id}`}
                       className={`rounded-lg border p-4 transition ${s.done ? "border-shGreen/40 bg-shGreen/5" : "border-bgHover bg-bgPanel"}`}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => onToggleStep(s)}
                              type="button"
                              disabled={isBusy || item.status === "submitted"}
                              data-testid={`today-plan-fullscreen-step-check-${s.id}`}
                              aria-label={s.done ? "Mark step incomplete" : "Mark step complete"}
                              className={`shrink-0 w-12 h-12 rounded-full grid place-items-center transition active:scale-95 ${s.done ? "bg-shGreen text-bgHeader" : "bg-bgBase border-2 border-shGreen/60 hover:border-shGreen hover:bg-shGreen/10"} disabled:opacity-60`}>
                        {isBusy ? <i className="fas fa-spinner fa-spin"/> : s.done ? <i className="fas fa-check text-lg"/> : <i className="fas fa-circle text-shGreen/30 text-xs"/>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <p className={`text-[17px] leading-snug font-black ${s.done ? "line-through text-gray-500" : "text-white"}`}>{s.label}</p>
                          {s.minutes ? (
                            <span className={`shrink-0 text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded ${s.done ? "bg-bgHover text-gray-500" : "bg-shGreen/20 text-shGreen"}`}>
                              {s.minutes} min
                            </span>
                          ) : null}
                        </div>
                        {s.description && (
                          <p className="text-[14px] text-gray-300 mt-2 whitespace-pre-wrap leading-relaxed">{s.description}</p>
                        )}
                        {s.notes && (
                          <p className="text-[13px] text-gray-400 italic mt-2 border-l-2 border-shBlue/40 pl-3 whitespace-pre-wrap leading-relaxed">
                            <i className="fas fa-circle-info text-shBlue mr-1"/>{s.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Big "Done reading" button at the bottom so clients always have an
            obvious way out, even after scrolling far down. */}
        <div className="pt-4">
          <button onClick={onClose}
                  type="button"
                  data-testid="today-plan-fullscreen-done"
                  className="w-full bg-shGreen text-bgHeader py-4 rounded-lg text-[15px] font-black uppercase tracking-widest hover:opacity-90 active:scale-95 transition">
            <i className="fas fa-check mr-2"/>Done reading — back to portal
          </button>
        </div>
      </div>
    </div>
  );
}




function InlineHomeworkForm({ item, form, patch, onPickPhoto, blockReason, onSubmit }) {
  const hwId = item.homework_id;
  const hasMoodField = (item.fields || []).some(f => f.kind === "mood_5");
  const submitting = !!form.submitting;
  const disabled = !!blockReason || submitting;
  return (
    <div className="mt-4 pt-4 border-t border-bgHover space-y-3" data-testid={`today-plan-form-${hwId}`}>
      <p className="text-[12px] font-black uppercase tracking-widest text-shBlue">
        <i className="fas fa-pen-to-square mr-1"/>Today's homework
      </p>

      {!hasMoodField && (
        <MoodRow value={form.mood || 0} onChange={(v) => patch({ mood: v })} testid={`today-plan-mood-${hwId}`} />
      )}

      {(item.fields || []).map((f) => (
        <FieldInput key={f.id}
                    field={f}
                    hwId={hwId}
                    value={f.kind === "mood_5" ? (form.mood || 0) : (form.values?.[f.id] ?? "")}
                    onChange={(v) => {
                      if (f.kind === "mood_5") patch({ mood: v });
                      else patch({ values: { ...(form.values || {}), [f.id]: v } });
                    }} />
      ))}

      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Note for your trainer (optional)</label>
        <textarea value={form.note || ""} onChange={(e) => patch({ note: e.target.value })}
                  rows={2}
                  data-testid={`today-plan-note-${hwId}`}
                  placeholder="Anything tricky? Wins? Questions?"
                  className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
      </div>

      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest block">Photo (optional)</label>
        {form.photo ? (
          <div className="mt-1 relative inline-block">
            <img src={form.photo} alt="" className="max-h-24 rounded border border-bgHover" />
            <button onClick={() => patch({ photo: "" })}
                    data-testid={`today-plan-photo-clear-${hwId}`}
                    className="absolute top-1 right-1 bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px]">
              <i className="fas fa-times"/>
            </button>
          </div>
        ) : (
          <label className="mt-1 inline-flex items-center gap-2 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-gray-300 font-black uppercase tracking-widest hover:border-shBlue cursor-pointer"
                 data-testid={`today-plan-photo-pick-${hwId}`}>
            <i className="fas fa-camera"/>Add photo
            <input type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {blockReason && (
          <span className="text-[12px] text-gray-400 italic" data-testid={`today-plan-block-${hwId}`}>
            <i className="fas fa-lock mr-1"/>{blockReason}
          </span>
        )}
        <button onClick={onSubmit}
                disabled={disabled}
                data-testid={`today-plan-submit-${hwId}`}
                className="bg-shGreen text-bgHeader px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50 disabled:cursor-not-allowed">
          <i className={`fas ${submitting ? "fa-spinner fa-spin" : "fa-paper-plane"} mr-2`}/>
          {submitting ? "Sending…" : "Mark Day Complete"}
        </button>
      </div>
    </div>
  );
}

function MoodRow({ value, onChange, testid }) {
  return (
    <div>
      <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">How did it go?</label>
      <div className="flex gap-1.5 mt-1" data-testid={testid}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => onChange(n)} type="button"
                  data-testid={`${testid}-${n}`}
                  className={`flex-1 py-2 rounded border text-center transition ${value === n ? "border-shGreen bg-shGreen/15" : "border-bgHover hover:border-shGreen/50"}`}>
            <div className="text-xl leading-none">{MOOD_EMOJI[n]}</div>
            <div className={`text-[10px] font-black uppercase tracking-widest mt-0.5 ${value === n ? "text-shGreen" : "text-gray-500"}`}>{MOOD_LABEL[n]}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldInput({ field, hwId, value, onChange }) {
  const km = KIND_META[field.kind] || { type: "text" };
  const label = (
    <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">
      {field.label || field.kind}
      {km.unit && <span className="text-gray-600 normal-case ml-1">({km.unit})</span>}
    </label>
  );
  const tid = `today-plan-field-${hwId}-${field.id}`;
  if (km.type === "mood") {
    return <MoodRow value={Number(value) || 0} onChange={onChange} testid={tid} />;
  }
  if (km.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)}
               data-testid={tid}
               className="accent-shGreen w-4 h-4" />
        <span className="text-[14px] text-white">{field.label || field.kind}</span>
      </label>
    );
  }
  if (km.type === "longtext") {
    return (
      <div>
        {label}
        <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2}
                  data-testid={tid}
                  className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input type={km.type === "number" ? "number" : "text"}
             value={value ?? ""}
             onChange={(e) => onChange(e.target.value)}
             min={km.min} max={km.max}
             data-testid={tid}
             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
    </div>
  );
}

