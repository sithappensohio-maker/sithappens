import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import AdminBookingModal from "../components/AdminBookingModal";

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [err, setErr] = useState("");
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    try { const { data } = await api.get("/bookings"); setBookings(data); } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const approve = async (id) => { try { await api.post(`/bookings/${id}/approve`); load(); } catch (e) { alert(formatErr(e.response?.data?.detail)); } };
  const reject = async (id) => { try { await api.post(`/bookings/${id}/reject`); load(); } catch (e) { alert(formatErr(e.response?.data?.detail)); } };
  const cancel = async (id) => { if(!window.confirm("Cancel booking?")) return; try { await api.delete(`/bookings/${id}`); load(); } catch (e) { alert(formatErr(e.response?.data?.detail)); } };

  const statusStyle = (s) => ({
    pending: "bg-shOrange/15 text-shOrange",
    approved: "bg-shGreen/15 text-shGreen",
    rejected: "bg-red-500/15 text-red-400",
    cancelled: "bg-gray-500/15 text-gray-400",
    completed: "bg-shBlue/15 text-shBlue",
  })[s] || "bg-gray-500/15 text-gray-400";

  return (
    <div className="space-y-6 animate-slide-in" data-testid="bookings-screen">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Bookings</h3>
        <button onClick={()=>setShowModal(true)} data-testid="new-booking-button"
                className="bg-shGreen text-bgHeader px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">+ New Booking</button>
      </div>
      {err && <div className="text-[11px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
      <div className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="text-[10px] text-gray-500 font-black uppercase">
            <tr><th className="px-6 py-3">Dog</th><th className="px-6 py-3">Client</th><th className="px-6 py-3">Service</th><th className="px-6 py-3">Dates</th><th className="px-6 py-3">Status</th><th className="px-6 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody data-testid="bookings-body">
            {bookings.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black">No bookings yet.</td></tr>}
            {bookings.map(b => (
              <tr key={b.id} className="border-t border-bgHover/40">
                <td className="px-6 py-4 text-white font-black uppercase text-xs">{b.dog_name}</td>
                <td className="px-6 py-4 text-gray-300 text-xs">{b.client_name}</td>
                <td className="px-6 py-4 text-[10px] font-black uppercase text-gray-300">{b.service_type}</td>
                <td className="px-6 py-4 text-xs text-gray-300">{b.date}{b.end_date && b.end_date !== b.date ? ` → ${b.end_date}` : ""}</td>
                <td className="px-6 py-4"><span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${statusStyle(b.status)}`}>{b.status}</span></td>
                <td className="px-6 py-4 text-right space-x-2">
                  {b.status === "pending" && <>
                    <button onClick={()=>approve(b.id)} data-testid={`approve-${b.id}`} className="text-[10px] font-black uppercase text-shGreen hover:underline">Approve</button>
                    <button onClick={()=>reject(b.id)} className="text-[10px] font-black uppercase text-red-400 hover:underline">Reject</button>
                  </>}
                  {(b.status === "approved" || b.status === "pending") && <button onClick={()=>cancel(b.id)} className="text-[10px] font-black uppercase text-gray-400 hover:underline">Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
