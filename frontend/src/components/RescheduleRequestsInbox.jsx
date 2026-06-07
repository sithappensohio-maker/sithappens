import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

/**
 * Sprint 110cf — Admin inbox for client-initiated reschedule requests.
 *
 * Compact card that shows pending requests on the Bookings screen header.
 * Each request displays the proposed slots; admin clicks one to approve,
 * or "Decline" to send a polite "we'll be in touch" reply.
 */
export default function RescheduleRequestsInbox({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [decliningId, setDecliningId] = useState(null);
  const [declineReason, setDeclineReason] = useState("");

  const load = () => {
    api.get("/admin/reschedule-requests", { params: { status: "pending" } })
      .then(r => setRows(r.data || []))
      .catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);

  const approve = async (reqId, slotIdx, slot) => {
    try {
      await api.post(`/admin/reschedule-requests/${reqId}/approve`,
                     { slot_index: slotIdx });
      toast.success(`Moved to ${slot.date} at ${slot.time}`);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Approve failed");
    }
  };

  const submitDecline = async (reqId) => {
    try {
      await api.post(`/admin/reschedule-requests/${reqId}/decline`,
                     { reason: declineReason });
      toast.success("Client notified · we'll follow up");
      setDecliningId(null);
      setDeclineReason("");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Decline failed");
    }
  };

  if (rows.length === 0) return null;

  return (
    <div className="bg-shBlue/5 border border-shBlue/40 rounded-xl p-4 shadow-lg space-y-3"
         data-testid="reschedule-inbox">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue">
          <i className="fas fa-calendar-pen mr-1.5"/>Reschedule requests · {rows.length} pending
        </p>
        <button onClick={load}
                className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white">
          <i className="fas fa-rotate"/>
        </button>
      </div>

      {rows.map(req => (
        <div key={req.id}
             data-testid={`reschedule-row-${req.id}`}
             className="bg-bgPanel border border-bgHover rounded-lg p-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div className="min-w-0">
              <p className="text-sm font-black text-white">
                {req.dog_name} · {req.client_name}
              </p>
              <p className="text-[12px] text-gray-400">
                Currently <strong className="text-gray-300">{req.current_date} at {req.current_time || "—"}</strong>
              </p>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              {new Date(req.created_at).toLocaleString()}
            </span>
          </div>

          {req.client_note && (
            <p className="text-[12px] text-gray-400 italic mt-1.5 mb-1.5">
              &ldquo;{req.client_note}&rdquo;
            </p>
          )}

          <div className="mt-2">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-shGreen mb-1.5">
              Proposed slots · tap to approve
            </p>
            <div className="flex flex-wrap gap-2">
              {(req.proposed_slots || []).map((s, i) => (
                <button
                  key={i}
                  onClick={() => approve(req.id, i, s)}
                  data-testid={`reschedule-approve-${req.id}-${i}`}
                  className="bg-shGreen/15 hover:bg-shGreen/30 text-shGreen border border-shGreen/40 rounded px-3 py-1.5 text-[12px] font-black uppercase tracking-widest transition"
                >
                  <i className="fas fa-check mr-1.5"/>
                  {s.date} · {s.time}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-bgHover">
            {decliningId === req.id ? (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  placeholder="Why? (sent to client)"
                  data-testid={`reschedule-decline-reason-${req.id}`}
                  className="flex-1 bg-bgBase border border-bgHover rounded px-2 py-1 text-xs text-white"
                />
                <button onClick={() => submitDecline(req.id)}
                        data-testid={`reschedule-decline-confirm-${req.id}`}
                        className="bg-red-500/20 hover:bg-red-500/40 text-red-300 border border-red-500/40 rounded px-2 py-1 text-[10px] font-black uppercase tracking-widest">
                  Send
                </button>
                <button onClick={() => { setDecliningId(null); setDeclineReason(""); }}
                        className="text-gray-500 hover:text-white text-[10px] font-black uppercase tracking-widest">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDecliningId(req.id)}
                data-testid={`reschedule-decline-${req.id}`}
                className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-400"
              >
                <i className="fas fa-xmark mr-1"/>None work · decline
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
