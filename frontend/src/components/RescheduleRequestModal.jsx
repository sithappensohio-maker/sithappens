import { useState } from "react";
import { api, formatErr } from "../lib/api";

/**
 * Sprint 110cf — Client-portal reschedule request modal.
 *
 * Owner taps "Reschedule" on a prepaid program session → picks 1–3 alternate
 * date+time slots → submits. Admin gets an email + an inbox row to approve
 * with one click. Credits are never burned (the original sale price already
 * hit Training Revenue at sale time).
 */
export default function RescheduleRequestModal({ booking, onClose, onSubmitted }) {
  // Three slot rows; the user can leave 1 or 2 blank — backend accepts 1–3
  const [slots, setSlots] = useState([
    { date: "", time: booking.time || "10:00" },
    { date: "", time: booking.time || "10:00" },
    { date: "", time: booking.time || "10:00" },
  ]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const updateSlot = (i, patch) => {
    setSlots(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const filled = slots.filter(s => s.date && s.time);

  const submit = async () => {
    if (filled.length === 0) {
      setError("Pick at least one alternate date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post(`/portal/bookings/${booking.id}/request-reschedule`, {
        proposed_slots: filled,
        client_note: note,
      });
      onSubmitted?.();
    } catch (e) {
      setError(formatErr(e.response?.data?.detail) || "Could not submit request");
    }
    setBusy(false);
  };

  // Friendly label of the current session
  const currentLabel = `${booking.date}${booking.time ? ` at ${booking.time}` : ""}`;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
         onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 md:p-7 shadow-2xl max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}
           data-testid="reschedule-request-modal">
        <div className="mb-4">
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-1">
            <i className="fas fa-calendar-pen mr-1.5"/>Reschedule request
          </p>
          <h2 className="text-xl font-black text-white">Move {booking.dog_name}&apos;s session</h2>
          <p className="text-[13px] text-gray-400 mt-1">
            Currently <strong className="text-white">{currentLabel}</strong>. Pick up to 3 alternate slots that work — we&apos;ll confirm the one that fits our schedule.
          </p>
        </div>

        <div className="space-y-2 mb-4">
          {slots.map((s, i) => (
            <div key={i}
                 data-testid={`reschedule-slot-${i}`}
                 className="bg-bgBase/60 border border-bgHover rounded p-2">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-1">
                Option {i + 1}{i > 0 ? " · optional" : ""}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <input type="date" value={s.date}
                       onChange={(e) => updateSlot(i, { date: e.target.value })}
                       data-testid={`reschedule-date-${i}`}
                       className="col-span-2 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-white text-sm" />
                <input type="time" value={s.time}
                       onChange={(e) => updateSlot(i, { time: e.target.value })}
                       data-testid={`reschedule-time-${i}`}
                       className="bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-white text-sm" />
              </div>
            </div>
          ))}
        </div>

        <label className="block mb-4">
          <span className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500">
            Note for the trainer <span className="normal-case font-normal text-gray-600">(optional)</span>
          </span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Why are you moving this session? Any preference?"
                    data-testid="reschedule-note"
                    className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
        </label>

        {error && (
          <p className="text-red-400 text-[13px] font-black uppercase tracking-widest mb-3"
             data-testid="reschedule-error">
            <i className="fas fa-circle-exclamation mr-1"/>{error}
          </p>
        )}

        <div className="flex gap-2 pt-2 border-t border-bgHover">
          <button onClick={onClose}
                  data-testid="reschedule-cancel"
                  className="flex-1 text-gray-400 hover:text-white py-2.5 text-[13px] font-black uppercase tracking-widest">
            Never mind
          </button>
          <button onClick={submit}
                  disabled={busy || filled.length === 0}
                  data-testid="reschedule-submit"
                  className="flex-1 bg-shBlue hover:bg-shBlue/80 text-white py-2.5 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
            {busy ? "Sending…" : `Send ${filled.length || ""} slot${filled.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
