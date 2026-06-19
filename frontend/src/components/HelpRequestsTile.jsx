/* Sprint 110di-33 — Admin Help Requests tile.

Tiny dashboard widget that lists open client feedback / help requests
and lets the admin one-click Mark Reviewed or Mark Resolved. Not a
ticket system; not a thread. Just a list with two action verbs.

Empty state: hides itself entirely so the dashboard stays clean. */
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TYPE_LABELS = {
  feedback: "Feedback", problem: "Problem", feature: "Suggestion",
  booking:  "Booking",  other:   "Other",
};
const TYPE_COLORS = {
  feedback: "text-shBlue",   problem: "text-red-400",
  feature:  "text-shGreen",  booking: "text-shOrange",
  other:    "text-gray-400",
};

export default function HelpRequestsTile() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/help-requests");
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const setStatus = async (id, status) => {
    setBusyId(id);
    try {
      await api.put(`/admin/help-requests/${id}`, { status });
      await load();
    } finally { setBusyId(null); }
  };

  if (loading) return null;
  const open = items.filter(i => i.status !== "resolved");
  if (open.length === 0) return null;  // self-hides when nothing to do

  return (
    <div className="bg-bgPanel rounded-xl border border-shBlue/30 p-4" data-testid="dashboard-help-requests">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-black text-shBlue uppercase tracking-widest">
          <i className="fas fa-life-ring mr-2"/>Client Help Requests
        </p>
        <span className="text-[11px] text-gray-500 font-black uppercase tracking-widest" data-testid="help-requests-count">
          {open.length} open
        </span>
      </div>
      <div className="space-y-2">
        {open.slice(0, 10).map(req => (
          <div key={req.id} className="bg-bgBase border border-bgHover rounded-lg p-3" data-testid={`help-req-${req.id}`}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-black uppercase tracking-widest">
                  <span className={TYPE_COLORS[req.type] || "text-gray-300"}>
                    {TYPE_LABELS[req.type] || req.type}
                  </span>
                  <span className="text-gray-500 mx-2">·</span>
                  <span className="text-white">{req.client_name || "Unknown client"}</span>
                  {req.status === "reviewed" && (
                    <span className="ml-2 text-shOrange normal-case text-[10px]">[reviewed]</span>
                  )}
                </p>
                <p className="text-white font-black text-[14px] mt-1" data-testid={`help-req-${req.id}-subject`}>
                  {req.subject}
                </p>
                <p className="text-[12px] text-gray-400 mt-1 line-clamp-3 whitespace-pre-wrap">{req.message}</p>
                <p className="text-[10px] text-gray-600 mt-1.5">{(req.created_at || "").slice(0, 19).replace("T", " ")}</p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {req.status === "new" && (
                  <button onClick={() => setStatus(req.id, "reviewed")} disabled={busyId === req.id}
                          data-testid={`help-req-${req.id}-reviewed`}
                          className="bg-shOrange/20 text-shOrange border border-shOrange/40 px-2 py-1 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shOrange/30 disabled:opacity-50">
                    <i className="fas fa-eye mr-1"/>Reviewed
                  </button>
                )}
                <button onClick={() => setStatus(req.id, "resolved")} disabled={busyId === req.id}
                        data-testid={`help-req-${req.id}-resolved`}
                        className="bg-shGreen/20 text-shGreen border border-shGreen/40 px-2 py-1 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shGreen/30 disabled:opacity-50">
                  <i className="fas fa-check mr-1"/>Resolved
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
