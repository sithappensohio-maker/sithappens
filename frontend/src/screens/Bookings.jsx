import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import AdminBookingModal from "../components/AdminBookingModal";
import usePullToRefresh, { RefreshSpinner } from "../lib/usePullToRefresh";

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [err, setErr] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const confirm = useConfirm();
  const load = async () => {
    try { const { data } = await api.get("/bookings"); setBookings(data); } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const approve = async (id) => { try { await api.post(`/bookings/${id}/approve`); load(); } catch (e) { setErr(formatErr(e.response?.data?.detail)); } };
  const reject = async (id) => { try { await api.post(`/bookings/${id}/reject`); load(); } catch (e) { setErr(formatErr(e.response?.data?.detail)); } };
  const cancel = async (id) => {
    if (!(await confirm({ title: "Cancel booking?", body: "This will remove the booking. Credits aren't charged until check-out.", confirmText: "Cancel booking", cancelText: "Keep it", tone: "danger" }))) return;
    try { await api.delete(`/bookings/${id}`); load(); } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  // Hide completed / cancelled / rejected by default — they clutter the active queue.
  // Toggle "Show history" reveals them when needed.
  const FINISHED = new Set(["completed", "cancelled", "canceled", "rejected"]);
  const visible = showHistory ? bookings : bookings.filter(b => !FINISHED.has(b.status));
  const hiddenCount = bookings.length - visible.length;

  const statusStyle = (s) => ({
    pending: "bg-shOrange/15 text-shOrange",
    approved: "bg-shGreen/15 text-shGreen",
    rejected: "bg-red-500/15 text-red-400",
    cancelled: "bg-gray-500/15 text-gray-400",
    completed: "bg-shBlue/15 text-shBlue",
  })[s] || "bg-gray-500/15 text-gray-400";

  const { pulling, progress } = usePullToRefresh("[data-scroll-root]", load);

  return (
    <div className="space-y-6 animate-slide-in" data-testid="bookings-screen">
      <RefreshSpinner pulling={pulling} progress={progress} />
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Bookings</h3>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && !showHistory && (
            <button onClick={()=>setShowHistory(true)} data-testid="show-history-btn"
                    className="text-[15px] font-black uppercase tracking-widest text-gray-400 hover:text-white px-3 py-2 bg-bgPanel rounded border border-bgHover">
              <i className="fas fa-clock-rotate-left mr-2"/>Show History · {hiddenCount}
            </button>
          )}
          {showHistory && (
            <button onClick={()=>setShowHistory(false)} data-testid="hide-history-btn"
                    className="text-[15px] font-black uppercase tracking-widest text-shOrange hover:text-white px-3 py-2 bg-bgPanel rounded border border-shOrange/40">
              <i className="fas fa-eye-slash mr-2"/>Hide History
            </button>
          )}
          <button onClick={()=>setShowModal(true)} data-testid="new-booking-button"
                  className="bg-shGreen text-bgHeader px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">+ New Booking</button>
        </div>
      </div>
      {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
      <div className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden">
        {/* Desktop: table */}
        <table className="w-full text-left text-sm hidden md:table">
          <thead className="text-[14px] text-gray-500 font-black uppercase">
            <tr><th className="px-6 py-3">Dog</th><th className="px-6 py-3">Client</th><th className="px-6 py-3">Service</th><th className="px-6 py-3">Dates</th><th className="px-6 py-3">Status</th><th className="px-6 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody data-testid="bookings-body">
            {visible.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black">{showHistory || bookings.length === 0 ? "No bookings yet." : "No active bookings. Click Show History to see past ones."}</td></tr>}
            {visible.map(b => (
              <tr key={b.id} className="border-t border-bgHover/40">
                <td className="px-6 py-4 text-white font-black uppercase text-xs">{b.dog_name}</td>
                <td className="px-6 py-4 text-gray-300 text-xs">{b.client_name}</td>
                <td className="px-6 py-4 text-[14px] font-black uppercase text-gray-300">{b.service_type}{b.service_type==="grooming" && b.grooming_type ? ` · ${b.grooming_type==="bath"?"Bath":"Nail Trim"}` : ""}</td>
                <td className="px-6 py-4 text-xs text-gray-300">
                  {b.date}{b.end_date && b.end_date !== b.date ? ` → ${b.end_date}` : ""}
                  {b.time && <span className="ml-2 text-shOrange font-black tracking-widest">@ {b.time}</span>}
                </td>
                <td className="px-6 py-4"><span className={`text-[14px] font-black uppercase px-2 py-1 rounded ${statusStyle(b.status)}`}>{b.status}</span></td>
                <td className="px-6 py-4 text-right space-x-2">
                  <button onClick={()=>setEditing(b)} data-testid={`edit-${b.id}`} className="text-[14px] font-black uppercase text-shBlue hover:underline">Edit</button>
                  {b.status === "pending" && <>
                    <button onClick={()=>approve(b.id)} data-testid={`approve-${b.id}`} className="text-[14px] font-black uppercase text-shGreen hover:underline">Approve</button>
                    <button onClick={()=>reject(b.id)} className="text-[14px] font-black uppercase text-red-400 hover:underline">Reject</button>
                  </>}
                  {(b.status === "approved" || b.status === "pending") && <button onClick={()=>cancel(b.id)} className="text-[14px] font-black uppercase text-gray-400 hover:underline">Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile: stacked cards */}
        <div className="md:hidden divide-y divide-bgHover/40" data-testid="bookings-mobile">
          {visible.length === 0 && <div className="px-4 py-10 text-center text-xs text-gray-500 uppercase font-black">{showHistory || bookings.length === 0 ? "No bookings yet." : "No active bookings. Tap Show History to see past ones."}</div>}
          {visible.map(b => (
            <div key={b.id} className="p-4 space-y-2" data-testid={`booking-card-${b.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black uppercase text-white">{b.dog_name}</p>
                  <p className="text-[13px] text-gray-400 truncate">{b.client_name}</p>
                </div>
                <span className={`shrink-0 text-[13px] font-black uppercase px-2 py-1 rounded ${statusStyle(b.status)}`}>{b.status}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
                <span className="font-black uppercase tracking-widest text-gray-300">{b.service_type}{b.service_type==="grooming" && b.grooming_type ? ` · ${b.grooming_type==="bath"?"Bath":"Nail Trim"}` : ""}</span>
                <span className="text-gray-400">{b.date}{b.end_date && b.end_date !== b.date ? ` → ${b.end_date}` : ""}{b.time ? ` @ ${b.time}` : ""}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                <button onClick={()=>setEditing(b)} data-testid={`edit-${b.id}-m`} className="text-[14px] font-black uppercase tracking-widest text-shBlue hover:underline">Edit</button>
                {b.status === "pending" && <>
                  <button onClick={()=>approve(b.id)} data-testid={`approve-${b.id}-m`} className="text-[14px] font-black uppercase tracking-widest text-shGreen hover:underline">Approve</button>
                  <button onClick={()=>reject(b.id)} className="text-[14px] font-black uppercase tracking-widest text-red-400 hover:underline">Reject</button>
                </>}
                {(b.status === "approved" || b.status === "pending") && <button onClick={()=>cancel(b.id)} className="text-[14px] font-black uppercase tracking-widest text-gray-400 hover:underline">Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {showModal && <AdminBookingModal onClose={()=>setShowModal(false)} onCreated={load} />}
      {editing && <AdminBookingModal existing={editing} onClose={()=>setEditing(null)} onCreated={load} />}
    </div>
  );
}
