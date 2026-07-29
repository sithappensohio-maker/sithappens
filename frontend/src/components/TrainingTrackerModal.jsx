// Sprint 110di-69 — Trainer-only Training Tracker modal.
// Compact, mobile-first view of the dog's CURRENT module + goals. Quick score
// buttons, per-goal notes, session note, optional "Advance to next module"
// (trainer's discretion — no gating). All updates flow through the existing
// goal_progress + current_module_id machinery — no duplicate progress store.

import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

const STATUS_BUTTONS = [
  { key: "not_started", label: "Not Started", score: 0, color: "bg-gray-500/20 text-shTextMuted border-gray-500/30" },
  { key: "in_progress", label: "Learning",    score: 2, color: "bg-shSecondary/20 text-shSecondary border-shSecondary/30" },
  { key: "in_progress", label: "Proficient",  score: 3, color: "bg-shAccent/20 text-shAccent border-shAccent/30" },
  { key: "mastered",    label: "Mastered",    score: 5, color: "bg-shPrimary/20 text-shPrimary border-shPrimary/40" },
];

function statusToBtnIndex(g) {
  const sc = g.score || 0;
  if (g.status === "mastered" || sc >= 4) return 3;
  if (sc >= 3) return 2;
  if (g.status === "in_progress" || sc >= 1) return 1;
  return 0;
}

export default function TrainingTrackerModal({ bookingId, dogId, enrollmentId, onClose, onSaved, onJumpToDog }) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [drafts, setDrafts] = useState({}); // { goalId: { status, score, notes } }
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const url = bookingId
        ? `/bookings/${bookingId}/training-context`
        : `/dogs/${dogId}/programs/${enrollmentId}/training-context`;
      const { data } = await api.get(url);
      setCtx(data);
      // Seed drafts from current progress
      const seed = {};
      (data.goals || []).forEach(g => {
        seed[g.id] = { status: g.status, score: g.score, notes: g.notes || "" };
      });
      setDrafts(seed);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Failed to load training context");
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bookingId, dogId, enrollmentId]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" data-testid="training-tracker-modal">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-8 text-shTextMuted text-sm">
          <i className="fas fa-spinner fa-spin mr-2"/>Loading training context…
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onMouseDown={(e)=>{ if (e.target===e.currentTarget) onClose(); }} data-testid="training-tracker-modal">
        <div className="bg-[var(--sh-card-base)] border border-red-500/40 rounded-2xl p-6 max-w-md text-red-300 card-danger">
          <p className="font-black uppercase tracking-widest text-[12px] mb-2">Couldn&apos;t load tracker</p>
          <p className="text-sm">{err}</p>
          <button onClick={onClose} className="mt-4 text-shSecondary font-black uppercase text-[12px] tracking-widest">Close</button>
        </div>
      </div>
    );
  }
  if (ctx && !ctx.has_program) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onMouseDown={(e)=>{ if (e.target===e.currentTarget) onClose(); }} data-testid="training-tracker-modal">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-6 max-w-md">
          <p className="text-sm text-shTextMuted">This dog has no active training program enrollment.</p>
          <button onClick={onClose} data-testid="training-tracker-close-noprogram"
                  className="mt-4 text-shSecondary font-black uppercase text-[12px] tracking-widest">Close</button>
        </div>
      </div>
    );
  }

  const setDraft = (gid, patch) => setDrafts(d => ({ ...d, [gid]: { ...(d[gid] || {}), ...patch } }));
  const pickStatus = (gid, idx) => {
    const btn = STATUS_BUTTONS[idx];
    setDraft(gid, { status: btn.key, score: btn.score });
  };

  const dirtyUpdates = (ctx.goals || [])
    .filter(g => {
      const d = drafts[g.id] || {};
      return d.status !== g.status || (d.score || 0) !== (g.score || 0) || (d.notes || "") !== (g.notes || "");
    })
    .map(g => ({
      goal_id: g.id,
      status: drafts[g.id]?.status,
      score: drafts[g.id]?.score,
      notes: drafts[g.id]?.notes || "",
    }));

  const save = async ({ advance = false } = {}) => {
    if (!dirtyUpdates.length && !sessionNote.trim() && !advance) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const eid = ctx.enrollment.id;
      const did = ctx.dog?.id || dogId;
      const { data } = await api.post(`/dogs/${did}/programs/${eid}/training-session`, {
        booking_id: bookingId || null,
        session_note: sessionNote.trim() || undefined,
        goal_updates: dirtyUpdates,
        advance_to_next_module: !!advance,
      });
      toast.success(advance
        ? `Saved · advanced to ${data.current_module?.name || "next module"}`
        : `Session saved · ${dirtyUpdates.length} goal${dirtyUpdates.length === 1 ? "" : "s"} updated`);
      onSaved?.(data);
      onClose();
    } catch (e) {
      toast.error(formatErr(e?.response?.data?.detail) || "Save failed");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
         onMouseDown={(e)=>{ if (e.target===e.currentTarget) onClose(); }}
         data-testid="training-tracker-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl max-h-[calc(var(--app-height)_-_0.75rem)] flex flex-col min-h-0">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-shBorder flex items-center justify-between sticky top-0 bg-[var(--sh-card-base)] rounded-t-2xl">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shPrimary">
              <i className="fas fa-paw mr-1.5"/>Training Tracker
            </p>
            <h3 data-testid="tracker-title" className="text-lg sm:text-xl font-black text-shText uppercase tracking-tight truncate">
              {ctx.dog?.name || "Dog"} · {ctx.program?.name || "Program"}
            </h3>
            <p className="text-[12px] text-shTextMuted mt-0.5">
              <span className="text-shSecondary font-black">Week {ctx.enrollment.current_week} of {ctx.enrollment.total_weeks}</span>
              {ctx.current_module?.name && <> · <span className="text-shTextMuted">{ctx.current_module.name}</span></>}
            </p>
          </div>
          <button onClick={onClose} data-testid="tracker-close" className="text-shTextMuted hover:text-shText text-xl px-2">
            <i className="fas fa-times"/>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 min-h-0 px-4 sm:px-6 py-4 space-y-4">
          {ctx.current_module?.description && (
            <div data-testid="tracker-module-description"
                 className="bg-[var(--sh-card-base)]/60 border-l-2 border-shSecondary/40 rounded p-3 text-[14px] text-shTextMuted leading-relaxed whitespace-pre-wrap">
              {ctx.current_module.description}
            </div>
          )}

          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">
              Skills this week ({ctx.goals.length})
            </p>
            <div className="space-y-3">
              {ctx.goals.map((g) => {
                const d = drafts[g.id] || {};
                const idx = statusToBtnIndex({ status: d.status, score: d.score });
                return (
                  <div key={g.id} data-testid={`tracker-goal-${g.id}`}
                       className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded-lg p-3 space-y-2">
                    <div>
                      <p className="text-[15px] font-black text-shText">{g.name}</p>
                      {g.description && <p className="text-[13px] text-shTextMuted mt-0.5 leading-snug">{g.description}</p>}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {STATUS_BUTTONS.map((btn, i) => (
                        <button key={btn.label} onClick={() => pickStatus(g.id, i)}
                                data-testid={`tracker-status-${g.id}-${btn.label.toLowerCase().replace(/\s+/g,'-')}`}
                                className={`px-2 py-1.5 rounded font-black text-[11px] uppercase tracking-widest border transition ${
                                  idx === i ? `${btn.color} ring-2 ring-white/10` : "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder hover:text-shText"
                                }`}>
                          {btn.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={d.notes || ""}
                      onChange={(e) => setDraft(g.id, { notes: e.target.value })}
                      placeholder="Per-skill notes (optional) — what worked, what to retry next session"
                      rows={2}
                      data-testid={`tracker-goal-notes-${g.id}`}
                      className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-[13px] leading-snug"
                    />
                  </div>
                );
              })}
              {ctx.goals.length === 0 && (
                <p className="text-shTextMuted text-sm text-center py-4">No skills defined in this module yet. Open the program in Settings to add them.</p>
              )}
            </div>
          </div>

          {/* Session note */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">
              <i className="fas fa-note-sticky mr-1 text-shSecondary"/>Session note (saves to training history)
            </label>
            <textarea
              value={sessionNote}
              onChange={(e) => setSessionNote(e.target.value)}
              placeholder="How did the whole session go? Big breakthroughs, things to flag, plans for next time."
              rows={3}
              data-testid="tracker-session-note"
              className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm leading-snug"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-shBorder bg-[var(--sh-card-base)]/50 sticky bottom-0 rounded-b-2xl">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button type="button"
                    onClick={() => {
                      const did = ctx.dog?.id || dogId;
                      if (onJumpToDog && did) {
                        onJumpToDog(did);
                        onClose?.();
                      }
                    }}
                    disabled={!onJumpToDog}
                    data-testid="tracker-view-full-progress"
                    className="text-[12px] text-shSecondary hover:text-shText font-black uppercase tracking-widest underline-offset-2 hover:underline disabled:opacity-40 disabled:cursor-not-allowed">
              <i className="fas fa-up-right-from-square mr-1"/>View full program progress
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => save({ advance: true })} disabled={saving}
                      data-testid="tracker-advance-btn"
                      className="bg-shAccent/20 text-shAccent border border-shAccent/40 px-3 py-2 rounded font-black text-[12px] uppercase tracking-widest hover:bg-shAccent/30 disabled:opacity-50">
                <i className="fas fa-forward mr-1"/>Save + Advance week
              </button>
              <button onClick={() => save()} disabled={saving}
                      data-testid="tracker-save-btn"
                      className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
                {saving ? <><i className="fas fa-spinner fa-spin mr-1"/>Saving…</> : <><i className="fas fa-floppy-disk mr-1"/>Save session</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
