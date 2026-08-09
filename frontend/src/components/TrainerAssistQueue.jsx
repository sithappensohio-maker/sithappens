// Online School Phase 4 — Trainer Assist queue & case detail for staff.
// "Do it yourself doesn't mean do it alone." Every case here IS a
// checkpoint graded trainer_assist_recommended (Phase 2) — there is no
// second collection, so this screen is purely a case-management view over
// data that already exists. Video reuses the exact ReviewVideo pattern
// from CheckpointReviewQueue.jsx (same homework media endpoint, no
// duplicate storage). Scheduling reuses AdminBookingModal / the real
// booking system — no calendar of its own.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import AdminBookingModal from "./AdminBookingModal";
import NeonEdge from "./premium/NeonEdge";
import HuskyDogImage from "./brand/HuskyDogImage";

const STATUS_META = {
  needs_attention:   { label: "Needs Attention",    cls: "bg-red-500/15 text-red-300 border-red-500/40", dot: "bg-red-400" },
  contacted:         { label: "Contacted",          cls: "bg-shAccent/15 text-shAccent border-shAccent/40", dot: "bg-shAccent" },
  scheduled:         { label: "Scheduled",          cls: "bg-shBlue/15 text-shBlue border-shBlue/40", dot: "bg-shBlue" },
  // Derived-only — never stored. The linked booking was cancelled through
  // the existing, untouched booking-cancellation path; trainer_assist_status
  // itself stays "scheduled" in the database (see server.py's
  // _enrich_trainer_assist_schedule / admin_school_trainer_assist_detail).
  reschedule_needed: { label: "Needs Reschedule",   cls: "bg-shAccent/15 text-shAccent border-shAccent/40", dot: "bg-shAccent" },
  completed:         { label: "Completed",          cls: "bg-shPrimary/15 text-shPrimary border-shPrimary/40", dot: "bg-shPrimary" },
};
const SECTIONS = [
  { key: "needs_attention", title: "Needs Attention" },
  { key: "contacted", title: "Contacted" },
  { key: "scheduled", title: "Scheduled" },
  { key: "completed", title: "Recently Completed" },
];

function fmtDateTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

export default function TrainerAssistQueue({ onClose, onChanged, onMessageClient, canMessage = false, initialSubmissionId = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [completeMode, setCompleteMode] = useState(false);
  const [clientSummary, setClientSummary] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const initialHandled = useRef(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/school/trainer-assist");
      setItems(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const loadDetail = async (id) => {
    setDetailLoading(true); setErr(""); setCompleteMode(false); setClientSummary(""); setInternalNote("");
    try {
      const { data } = await api.get(`/admin/school/trainer-assist/${id}`);
      setDetail(data);
    } catch (e) {
      setErr(e.response?.data?.detail || "Failed to load case.");
    } finally { setDetailLoading(false); }
  };

  const open = (id) => { setActiveId(id); loadDetail(id); };
  useEffect(() => {
    if (initialHandled.current || !initialSubmissionId) return;
    initialHandled.current = true;
    open(initialSubmissionId);
  }, [initialSubmissionId]);
  const back = () => { setActiveId(null); setDetail(null); setErr(""); };

  const refreshAll = async (id) => {
    await load();
    await loadDetail(id);
    onChanged?.();
  };

  const markContacted = async () => {
    if (!activeId) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/admin/school/trainer-assist/${activeId}/contact`, {});
      await refreshAll(activeId);
    } catch (e) { setErr(e.response?.data?.detail || "Failed to mark contacted."); }
    finally { setBusy(false); }
  };

  const onBookingCreated = async (booking) => {
    setBookingModalOpen(false);
    if (!booking?.id || !activeId) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/admin/school/trainer-assist/${activeId}/schedule`, { booking_id: booking.id });
      await refreshAll(activeId);
    } catch (e) { setErr(e.response?.data?.detail || "Failed to link the appointment."); }
    finally { setBusy(false); }
  };

  const submitComplete = async () => {
    if (!activeId || !clientSummary.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/admin/school/trainer-assist/${activeId}/complete`, {
        client_summary: clientSummary.trim(), internal_note: internalNote.trim() || undefined,
      });
      setCompleteMode(false);
      await refreshAll(activeId);
    } catch (e) { setErr(e.response?.data?.detail || "Failed to complete Trainer Assist."); }
    finally { setBusy(false); }
  };

  const cp = detail?.checkpoint;
  const status = detail?.trainer_assist_status;
  const rubric = cp?.rubric_snapshot || {};

  const bySection = SECTIONS.map(s => ({ ...s, rows: items.filter(it => it.trainer_assist_status === s.key) }));

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 lg:p-6 z-50" onClick={onClose} data-testid="trainer-assist-queue-modal">
      <div className="bg-bgPanel border border-shBorder/70 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto shadow-[0_30px_100px_rgba(0,0,0,0.72)]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-bgHeader/95 backdrop-blur-xl border-b border-shBorder/60 px-3 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-purple-400/10 border border-purple-400/30 grid place-items-center"><i className="fas fa-handshake text-purple-300"/></div>
            <div className="min-w-0">
              <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.16em] text-purple-300 truncate">Online School · Human support</p>
              <h3 className="sh-display text-xl sm:text-2xl text-shText leading-none mt-1 truncate">Trainer Assist</h3>
              <p className="text-[12px] text-shTextMuted mt-1">{loading ? "Loading…" : `${items.filter(i => i.trainer_assist_status !== "completed").length} student${items.filter(i => i.trainer_assist_status !== "completed").length === 1 ? "" : "s"} need help`}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl border border-shBorder/60 bg-black/20 grid place-items-center text-shTextMuted hover:text-shText" data-testid="trainer-assist-queue-close"><i className="fas fa-times"/></button>
        </div>

        {!activeId ? (
          <div className="p-3 sm:p-5 space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="trainer-assist-queue-list">
            {items.length === 0 && !loading && (
              <div className="text-center py-12 text-shTextMuted">
                <i className="fas fa-mug-hot text-3xl mb-3 opacity-40 block"/>
                <p className="text-[14px] font-black uppercase tracking-widest">No students need help right now.</p>
              </div>
            )}
            {bySection.map(sec => sec.rows.length > 0 && (
              <div key={sec.key} data-testid={`trainer-assist-section-${sec.key}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2.5 flex items-center gap-2">
                  {sec.title} · {sec.rows.length}
                </p>
                <div className="space-y-2">
                  {sec.rows.map((it, idx) => (
                    <button key={it.id} onClick={() => open(it.id)} data-testid={`trainer-assist-item-${sec.key}-${idx}`}
                            className="w-full text-left border border-shBorder/60 bg-black/20 rounded-2xl p-3.5 sm:p-4 hover:border-purple-400/40 hover:bg-white/[0.025] transition">
                      <div className="flex items-start sm:items-center gap-3">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl overflow-hidden border border-purple-400/20 shrink-0 bg-black/30"><HuskyDogImage src={it.dog_photo} name={it.dog_name} alt={it.dog_name} className="w-full h-full object-cover object-top"/></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-shText font-black text-[14px] sm:text-[15px] truncate">{it.dog_name} · {it.client_name}</p>
                            {it.appointment_cancelled && (
                              <span className="text-[9px] font-black uppercase tracking-[0.1em] px-2 py-1 rounded-lg border bg-shAccent/15 text-shAccent border-shAccent/40 shrink-0" data-testid={`trainer-assist-item-${sec.key}-${idx}-reschedule-badge`}>
                                <i className="fas fa-calendar-xmark mr-1"/>Needs Reschedule
                              </span>
                            )}
                          </div>
                          <p className="text-shTextMuted text-[13px] truncate mt-0.5">
                            {it.program_name}{it.module_name ? ` · ${it.module_name}` : ""} · {it.lesson_name}
                          </p>
                          {it.trainer_feedback && <p className="text-shTextMuted text-[13px] italic mt-1 truncate">"{it.trainer_feedback}"</p>}
                          <p className="text-shTextMuted text-[11px] mt-1">
                            {sec.key === "completed" ? `Resolved ${fmtDateTime(it.completed_at)}` : `Recommended ${fmtDateTime(it.recommended_at)}`}
                          </p>
                        </div>
                        <div className="hidden sm:grid w-9 h-9 rounded-xl border border-shBorder/60 place-items-center shrink-0"><i className="fas fa-chevron-right text-shTextMuted text-[11px]"/></div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 sm:p-5 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="trainer-assist-detail-pane">
            <button onClick={back} className="inline-flex items-center min-h-[42px] text-[12px] sm:text-[13px] text-shTextMuted hover:text-shSecondary font-black" data-testid="trainer-assist-back">
              <i className="fas fa-chevron-left mr-1"/>Back to queue
            </button>

            {detailLoading && <p className="text-shTextMuted text-[13px]"><i className="fas fa-spinner fa-spin mr-1"/>Loading case…</p>}

            {!detailLoading && detail && (
              <>
                <NeonEdge accentRgb="168,85,247" intensity="subtle" className="p-4 sm:p-5">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl overflow-hidden border border-purple-400/25 shrink-0"><HuskyDogImage src={detail.dog?.photo} name={detail.dog?.name} alt={detail.dog?.name} className="w-full h-full object-cover object-top"/></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-purple-300">Student</p>
                      <h4 className="text-shText text-lg font-black tracking-tight mt-1">{detail.dog?.name} <span className="text-shTextMuted font-medium">· {detail.client?.name}</span></h4>
                      <p className="text-shTextMuted text-[12px] mt-0.5">{detail.program_name}{detail.current_module_name ? ` · currently on ${detail.current_module_name}` : ""}</p>
                    </div>
                    {status && <span className={`shrink-0 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.1em] px-2.5 py-1.5 rounded-lg border ${STATUS_META[status]?.cls || ""}`} data-testid="trainer-assist-status-pill">{STATUS_META[status]?.label || status}</span>}
                  </div>
                </NeonEdge>

                <div className="rounded-2xl border border-shBorder/60 bg-black/20 p-4 sm:p-5 space-y-3">
                  <div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-shTextMuted">Why they're here</p><p className="text-shText text-[16px] font-black mt-1">{cp?.lesson_name}</p></div>
                  {cp?.trainer_feedback && <div className="rounded-xl border border-purple-400/15 bg-purple-500/[0.05] p-3.5"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-purple-300/80 mb-1">Trainer feedback</p><p className="text-gray-200 text-[13px] leading-relaxed">“{cp.trainer_feedback}”</p></div>}
                  {cp?.client_note && <div className="rounded-xl border border-shSecondary/15 bg-shSecondary/[0.04] p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-shSecondary/80 mb-1">Client note</p><p className="text-shTextMuted text-[13px]">“{cp.client_note}”</p></div>}
                </div>

                {cp?.homework_id && cp?.video_media_id && (
                  <ReviewVideo homeworkId={cp.homework_id} mediaId={cp.video_media_id}/>
                )}

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-shPrimary/20 bg-shPrimary/[0.04] p-4"><ScoreGroup title="Handler Skills" criteria={rubric.handler_criteria} scores={cp?.handler_scores} overall={cp?.handler_overall}/></div>
                  <div className="rounded-2xl border border-shSecondary/20 bg-shSecondary/[0.04] p-4"><ScoreGroup title="Dog Performance" criteria={rubric.dog_criteria} scores={cp?.dog_scores} overall={cp?.dog_overall}/></div>
                </div>

                {detail.appointment && detail.appointment.status === "cancelled" ? (
                  <div className="bg-shAccent/10 border border-shAccent/40 rounded-xl p-4" data-testid="trainer-assist-appointment-cancelled">
                    <p className="text-[11px] font-black uppercase tracking-widest text-shAccent mb-1"><i className="fas fa-calendar-xmark mr-1"/>Appointment Canceled</p>
                    <p className="text-shText text-[14px]">Was {detail.appointment.date} {detail.appointment.time ? `· ${detail.appointment.time}` : ""}</p>
                    <p className="text-shTextMuted text-[12px] mt-0.5">This appointment was canceled. Schedule a replacement below.</p>
                  </div>
                ) : detail.appointment && (
                  <div className="bg-shBlue/10 border border-shBlue/40 rounded-xl p-4" data-testid="trainer-assist-appointment">
                    <p className="text-[11px] font-black uppercase tracking-widest text-shBlue mb-1">Scheduled Appointment</p>
                    <p className="text-shText text-[14px]">{detail.appointment.date} {detail.appointment.time ? `· ${detail.appointment.time}` : ""}</p>
                    <p className="text-shTextMuted text-[12px] mt-0.5 capitalize">{detail.appointment.status}</p>
                  </div>
                )}

                {err && <p className="text-red-400 text-[14px] uppercase font-black">{err}</p>}

                {status !== "completed" && (
                  <div className="bg-black/15 border border-shBorder/55 rounded-2xl p-4 sm:p-5 space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Actions</p>
                    <div className="grid grid-cols-1 sm:flex gap-2 sm:flex-wrap">
                      {canMessage && (
                        <button onClick={() => onMessageClient?.({ clientId: detail.client?.id, dogId: detail.dog?.id, lessonName: cp?.lesson_name, onSent: markContacted })}
                                disabled={busy} data-testid="trainer-assist-message-client"
                                className="min-h-[46px] bg-shSecondary/10 text-shSecondary border border-shSecondary/35 px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shSecondary/15 disabled:opacity-50">
                          <i className="fas fa-comment mr-1.5"/>Message Client
                        </button>
                      )}
                      {status === "needs_attention" && (
                        <button onClick={markContacted} disabled={busy} data-testid="trainer-assist-mark-contacted"
                                className="min-h-[46px] bg-shAccent/10 text-shAccent border border-shAccent/35 px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shAccent/15 disabled:opacity-50">
                          <i className="fas fa-check mr-1.5"/>Mark Contacted
                        </button>
                      )}
                      <button onClick={() => setBookingModalOpen(true)} disabled={busy} data-testid="trainer-assist-schedule"
                              className="min-h-[46px] bg-shBlue/10 text-shBlue border border-shBlue/35 px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shBlue/15 disabled:opacity-50">
                        <i className="fas fa-calendar-plus mr-1.5"/>{status === "scheduled" || status === "reschedule_needed" ? "Reschedule" : "Schedule Trainer Assist"}
                      </button>
                      <button onClick={() => setCompleteMode(v => !v)} disabled={busy} data-testid="trainer-assist-complete-toggle"
                              className="min-h-[46px] bg-shPrimary text-bgHeader px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shPrimary/85 disabled:opacity-50">
                        <i className="fas fa-flag-checkered mr-1.5"/>Complete Trainer Assist
                      </button>
                    </div>

                    {completeMode && (
                      <div className="space-y-2 border-t border-shBorder/50 pt-3" data-testid="trainer-assist-complete-form">
                        <label className="text-[11px] font-black uppercase tracking-widest text-shText">Client-facing follow-up summary (required)</label>
                        <textarea value={clientSummary} onChange={(e) => setClientSummary(e.target.value)} rows={3}
                                  placeholder="We worked on keeping the leash loose before changing direction. Practice this at low distraction and then submit another checkpoint when you're ready."
                                  data-testid="trainer-assist-client-summary"
                                  className="w-full bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-purple-400/40"/>
                        <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Internal note (staff-only, optional)</label>
                        <textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={2}
                                  placeholder="Staff-only context — never shown to the client."
                                  data-testid="trainer-assist-internal-note"
                                  className="w-full bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-purple-400/40"/>
                        <div className="flex justify-stretch sm:justify-end">
                          <button onClick={submitComplete} disabled={busy || !clientSummary.trim()} data-testid="trainer-assist-submit-complete"
                                  className="w-full sm:w-auto min-h-[46px] bg-shPrimary text-bgHeader px-5 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black disabled:opacity-50">
                            {busy ? <><i className="fas fa-spinner fa-spin mr-2"/>Completing…</> : "Confirm Complete"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {status === "completed" && (
                  <div className="bg-shPrimary/10 border border-shPrimary/40 rounded-xl p-4" data-testid="trainer-assist-completed-summary">
                    <p className="text-[11px] font-black uppercase tracking-widest text-shPrimary mb-1">Resolved</p>
                    <p className="text-shText text-[13px]">{cp?.trainer_assist_client_summary || "No client-facing summary was recorded."}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {bookingModalOpen && detail && (
        <AdminBookingModal
          presetClientId={detail.client?.id}
          presetDogId={detail.dog?.id}
          presetServiceType="training"
          presetNotes={`Trainer Assist follow-up · ${cp?.lesson_name || "Online School checkpoint"}`}
          onClose={() => setBookingModalOpen(false)}
          onCreated={onBookingCreated}
        />
      )}
    </div>
  );
}

function ScoreGroup({ title, criteria, scores, overall }) {
  if (!criteria || criteria.length === 0) return null;
  const dogTone = /dog/i.test(title);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${dogTone ? "text-shSecondary" : "text-shPrimary"}`}>{title}</p>
        {overall != null && <span className={`text-[13px] font-black ${dogTone ? "text-shSecondary" : "text-shPrimary"}`}>{Number(overall).toFixed(1)}<span className="text-[10px] text-shTextMuted">/5</span></span>}
      </div>
      <div className="space-y-2.5">
        {criteria.map(c => {
          const score = Number(scores?.[c.id] ?? 0);
          return (
            <div key={c.id} data-testid={`trainer-assist-score-${c.id}`}>
              <div className="flex items-center justify-between gap-3 mb-1"><span className="text-[12px] text-shText">{c.name}</span><span className="text-shTextMuted font-black text-[11px]">{scores?.[c.id] ?? "—"}/5</span></div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className={`h-full rounded-full ${dogTone ? "bg-shSecondary" : "bg-shPrimary"}`} style={{ width: `${Math.max(0, Math.min(100, (score / 5) * 100))}%` }}/></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewVideo({ homeworkId, mediaId }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/homework/${homeworkId}/media/${mediaId}`);
        setSrc(data.data || "");
      } catch { /* ignore */ }
    })();
  }, [homeworkId, mediaId]);
  if (!src) return <p className="text-[13px] text-shTextMuted mt-2 font-black uppercase tracking-widest"><i className="fas fa-spinner fa-spin mr-1"/>Loading video…</p>;
  return (
    <div data-testid="trainer-assist-video">
      <video src={src} controls playsInline className="max-h-[420px] rounded-2xl border border-shBorder/55 bg-black/40 w-full"/>
    </div>
  );
}
