import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import TrainingSessionWorkspaceBase from "./TrainingSessionWorkspaceBase";

const REASONS = [
  ["Mastered earlier than expected", "mastered_early"],
  ["Previously trained", "previously_trained"],
  ["Trainer assessment", "trainer_assessment"],
  ["Other", "other"],
];

export default function TrainingSessionWorkspace(props) {
  const [enrollmentId, setEnrollmentId] = useState(props.enrollmentId || null);
  const [options, setOptions] = useState(null);
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [reasonPreset, setReasonPreset] = useState("mastered_early");
  const [note, setNote] = useState("");
  const [masteredIds, setMasteredIds] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnrollmentId(props.enrollmentId || null);
  }, [props.enrollmentId]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (props.enrollmentId || !props.bookingId) return;
      try {
        const { data } = await api.post(`/bookings/${props.bookingId}/training-session/draft`);
        if (!cancelled && data?.resolution === "ready" && data?.draft?.enrollment_id) {
          setEnrollmentId(data.draft.enrollment_id);
        }
      } catch (_) {
        // The base workspace owns normal draft/resolution errors. This lookup
        // is only for the optional manual In-Person control.
      }
    };
    resolve();
    return () => { cancelled = true; };
  }, [props.bookingId, props.enrollmentId]);

  const loadOptions = useCallback(async () => {
    if (!enrollmentId) return null;
    try {
      const { data } = await api.get(`/training/enrollments/${enrollmentId}/manual-progress`);
      setOptions(data);
      return data;
    } catch (_) {
      // Online and Hybrid intentionally return 409 here. They should look
      // exactly like the original workspace with no manual-progression UI.
      setOptions(null);
      return null;
    }
  }, [enrollmentId]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  const allLessons = useMemo(() => options ? [
    {
      id: options.current_lesson_id,
      name: options.current_lesson_name,
      module_id: options.current_module_id,
      module_name: options.current_module_name,
    },
    ...(options.future_lessons || []),
  ] : [], [options]);

  const targetIndex = allLessons.findIndex(l => l.id === targetId);
  const passedLessons = targetIndex > 0 ? allLessons.slice(0, targetIndex) : [];

  const toggleMastered = (lessonId) => {
    setMasteredIds(ids => ids.includes(lessonId) ? ids.filter(id => id !== lessonId) : [...ids, lessonId]);
  };

  const openControl = async () => {
    const fresh = await loadOptions();
    if (!fresh?.future_lessons?.length) {
      toast.info("There isn't a later In-Person lesson available to move to.");
      return;
    }
    setTargetId("");
    setMasteredIds([]);
    setReasonPreset("mastered_early");
    setNote("");
    setOpen(true);
  };

  const saveMove = async () => {
    if (!targetId || !enrollmentId) return;
    const label = REASONS.find(([, key]) => key === reasonPreset)?.[0] || "Trainer assessment";
    const reason = `${label}${note.trim() ? ` — ${note.trim()}` : ""}`;
    setSaving(true);
    try {
      const { data } = await api.post(`/training/enrollments/${enrollmentId}/manual-progress`, {
        target_lesson_id: targetId,
        reason,
        mastered_lesson_ids: masteredIds.filter(id => passedLessons.some(l => l.id === id)),
      });
      toast.success(`In-Person progress moved to ${data.current_lesson_name}`);
      setOpen(false);
      await loadOptions();
    } catch (e) {
      toast.error(formatErr(e?.response?.data?.detail) || "Could not move this dog's In-Person progress");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TrainingSessionWorkspaceBase {...props} />

      {!!options?.future_lessons?.length && !open && (
        <button
          type="button"
          onClick={openControl}
          data-testid="in-person-manual-progress-open"
          className="fixed z-[70] left-4 bottom-4 sm:left-6 sm:bottom-6 rounded-xl border border-shSecondary/60 bg-[var(--sh-card-base)] px-4 py-3 text-left shadow-2xl hover:border-shSecondary transition"
        >
          <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-shSecondary">In-Person Trainer Control</span>
          <span className="block text-[13px] font-black text-shText mt-0.5"><i className="fas fa-forward-step mr-1.5"/>Move Dog Ahead</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-3 sm:p-5" data-testid="in-person-manual-progress-modal">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-shSecondary/45 bg-[var(--sh-card-base)] shadow-2xl">
            <div className="p-4 sm:p-5 border-b border-shBorder">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-shSecondary">Trainer-controlled In-Person progression</p>
              <h3 className="text-xl font-black text-shText mt-1">Move this dog to a later lesson</h3>
              <p className="text-[13px] text-shTextMuted mt-2 leading-relaxed">
                Use this when the dog has mastered material earlier than expected. This changes only the In-Person School position. Online and Hybrid School remain gated. If a session is already open, that session stays attached to the lesson it started on; the new position is used the next time training is opened.
              </p>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div className="rounded-xl border border-shBorder bg-black/15 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Current lesson</p>
                <p className="text-sm font-black text-shText mt-1">{options?.current_module_name} · {options?.current_lesson_name}</p>
              </div>

              <div>
                <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Move dog to</label>
                <select
                  value={targetId}
                  onChange={(e) => { setTargetId(e.target.value); setMasteredIds([]); }}
                  data-testid="in-person-manual-progress-target"
                  className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-sm"
                >
                  <option value="">Choose a later lesson…</option>
                  {(options?.future_lessons || []).map(l => (
                    <option key={l.id} value={l.id}>{l.module_name} · {l.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Why move ahead?</label>
                  <select
                    value={reasonPreset}
                    onChange={(e) => setReasonPreset(e.target.value)}
                    data-testid="in-person-manual-progress-reason"
                    className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-sm"
                  >
                    {REASONS.map(([label, key]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Optional note</label>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. already reliable around distractions"
                    data-testid="in-person-manual-progress-note"
                    className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-sm"
                  />
                </div>
              </div>

              {!!passedLessons.length && (
                <div className="rounded-xl border border-shBorder bg-black/15 p-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Lessons being passed over</p>
                  <p className="text-[11px] text-shTextMuted mt-1">They are recorded as advanced/skipped by default. Check Mastered only when you actually verified that lesson.</p>
                  <div className="space-y-2 mt-3">
                    {passedLessons.map((lesson, idx) => (
                      <label key={lesson.id} className="flex items-center justify-between gap-3 rounded-lg border border-shBorder/70 px-3 py-2 text-[12px] text-shText">
                        <span>
                          <b>{lesson.name}</b>
                          <span className="block text-[10px] text-shTextMuted">{idx === 0 ? "Current lesson" : `${lesson.module_name} · passed over`}</span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <input type="checkbox" checked={masteredIds.includes(lesson.id)} onChange={() => toggleMastered(lesson.id)} />
                          Mastered
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 border-t border-shBorder flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-shTextMuted font-black uppercase text-[12px] tracking-widest">Cancel</button>
              <button
                type="button"
                onClick={saveMove}
                disabled={!targetId || saving}
                data-testid="in-person-manual-progress-save"
                className="bg-shSecondary text-bgHeader px-4 py-2 rounded-lg font-black uppercase text-[12px] tracking-widest disabled:opacity-50"
              >
                {saving ? "Moving…" : "Move Dog Ahead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
