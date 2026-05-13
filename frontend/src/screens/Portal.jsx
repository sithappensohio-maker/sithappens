import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import WaiverModal from "../components/WaiverModal";

function todayISO() { return new Date().toISOString().split("T")[0]; }

export default function Portal() {
  const { user, logout, reloadUser } = useAuth();
  const [dogs, setDogs] = useState([]);
  const [client, setClient] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [bookDogId, setBookDogId] = useState("");
  const [bookDate, setBookDate] = useState(todayISO());
  const [bookEnd, setBookEnd] = useState("");
  const [bookType, setBookType] = useState("daycare");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recEnd, setRecEnd] = useState("");
  const [recDays, setRecDays] = useState([]);
  const [avail, setAvail] = useState(null);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [waiver, setWaiver] = useState(null); // {signed, current_version, signature, needs_resign}
  const [pubSettings, setPubSettings] = useState(null);
  const [showWaiver, setShowWaiver] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [dRes, bRes, wRes, sRes] = await Promise.all([
        api.get("/dogs"),
        api.get("/bookings"),
        api.get("/waivers/me"),
        api.get("/settings/public"),
      ]);
      setDogs(dRes.data);
      setBookings(bRes.data);
      setWaiver(wRes.data);
      setPubSettings(sRes.data);
      if (dRes.data.length > 0 && !bookDogId) setBookDogId(dRes.data[0].id);
      const needsSign = !wRes.data?.signed || wRes.data?.needs_resign;
      if (needsSign && sRes.data?.waiver_required_for_booking) setShowWaiver(true);
      await reloadUser();
    } catch {}
  }, [bookDogId, reloadUser]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Fetch credits separately via a small endpoint - we'll use the user from useAuth but credits live on client doc.
  // Use a helper: fetch own client info via portal endpoint
  const [credits, setCredits] = useState(0);
  useEffect(() => {
    (async () => {
      try {
        // we'll use list of bookings client_name + try to load client info via a workaround - call /clients/me? we don't have that.
        // instead, fetch from auth/me extended: we'll add credits by computing - but simpler: fetch credits from server via /portal/me below.
        const { data } = await api.get("/portal/me");
        setClient(data.client); setCredits(data.client.credits);
      } catch {}
    })();
  }, [bookings]);

  const checkAvail = useCallback(async () => {
    if (!bookDogId || !bookDate) return;
    try {
      const { data } = await api.get("/bookings/availability", { params: { date_str: bookDate, dog_id: bookDogId } });
      setAvail(data);
    } catch (e) {
      setAvail(null);
      setErr(formatErr(e.response?.data?.detail));
    }
  }, [bookDogId, bookDate]);

  useEffect(() => { checkAvail(); }, [checkAvail]);

  const book = async () => {
    setErr(""); setSuccess("");
    try {
      if (isRecurring && bookType !== "boarding") {
        if (recDays.length === 0) { setErr("Pick at least one weekday"); return; }
        if (!recEnd) { setErr("Pick an end date for the recurrence"); return; }
        const { data } = await api.post("/bookings/recurring", {
          dog_id: bookDogId, start_date: bookDate, end_date: recEnd,
          service_type: bookType, weekdays: recDays,
        });
        const c = data.created?.length || 0;
        const s = data.skipped?.length || 0;
        setSuccess(`${c} bookings created${s?`, ${s} skipped`:""}.`);
      } else {
        await api.post("/bookings", { dog_id: bookDogId, date: bookDate, end_date: bookType==="boarding"?bookEnd||bookDate:null, service_type: bookType });
        setSuccess("Booking submitted! Awaiting admin approval.");
      }
      loadAll();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const toggleRecDay = (d) => setRecDays(recDays.includes(d) ? recDays.filter(x=>x!==d) : [...recDays, d]);

  const cancel = async (id) => {
    if (!window.confirm("Cancel this booking?")) return;
    try { await api.delete(`/bookings/${id}`); loadAll(); } catch (e) { alert(formatErr(e.response?.data?.detail)); }
  };

  const waiverNeeded = pubSettings?.waiver_required_for_booking && (!waiver?.signed || waiver?.needs_resign);
  const canBook = avail && avail.vaccine_ok && avail.open_slots > 0 && !waiverNeeded;

  return (
    <div className="h-full flex flex-col bg-bgBase" data-testid="client-portal">
      <header className="bg-bgHeader border-b border-bgHover h-24 flex items-center justify-between px-8">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Sit Happens" className="h-16" data-testid="portal-logo" />
          <div>
            <p className="text-[9px] text-gray-500 font-black uppercase tracking-[0.25em]">Dog Training • Daycare • Boarding</p>
            <p className="text-xs text-shGreen font-black uppercase tracking-widest mt-1">Welcome, {user.name}</p>
          </div>
        </div>
        <button onClick={logout} data-testid="logout-button" className="text-xs bg-red-500/10 text-red-400 px-4 py-2 rounded font-black uppercase tracking-widest hover:bg-red-500/20">Logout</button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 max-w-6xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="col-span-1 space-y-6">
          <div className="bg-bgPanel p-6 rounded-xl border border-bgHover text-center shadow-2xl" data-testid="credits-card">
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Available Credits</p>
            <p className="text-5xl font-black text-shGreen mt-2">{credits}</p>
            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-2">Each day = 1 credit</p>
          </div>

          <div className={`p-5 rounded-xl border shadow-2xl ${waiverNeeded?"bg-red-500/10 border-red-500/40":"bg-shGreen/5 border-shGreen/30"}`} data-testid="waiver-status-card">
            <div className="flex items-center justify-between mb-2">
              <p className={`text-[10px] font-black uppercase tracking-widest ${waiverNeeded?"text-red-400":"text-shGreen"}`}>
                <i className={`fas ${waiverNeeded?"fa-exclamation-triangle":"fa-file-signature"} mr-2`} /> Client Waiver
              </p>
              {waiver?.signed && !waiver?.needs_resign && <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">v{waiver.signature?.waiver_version}</span>}
            </div>
            {waiverNeeded ? (
              <>
                <p className="text-xs text-gray-300 mb-3">{waiver?.needs_resign?"Our waiver has been updated. Please re-sign to continue booking.":"You must sign the client waiver before booking services."}</p>
                <button onClick={()=>setShowWaiver(true)} data-testid="open-waiver-button"
                        className="w-full bg-red-500 text-white py-2 rounded font-black text-[10px] uppercase tracking-widest hover:bg-red-500/90">
                  Sign Waiver Now
                </button>
              </>
            ) : (
              <p className="text-xs text-gray-400">Signed by <span className="text-white font-black">{waiver?.signature?.typed_name}</span> on {(waiver?.signature?.signed_at||"").slice(0,10)}</p>
            )}
          </div>

          <div className="bg-bgPanel p-6 rounded-xl border border-bgHover shadow-2xl">
            <h4 className="font-black text-shBlue mb-4 uppercase text-xs tracking-widest"><i className="fas fa-calendar-plus mr-2"/>Book Service</h4>

            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
            <select value={bookDogId} onChange={(e)=>setBookDogId(e.target.value)} data-testid="portal-book-dog"
                    className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Service</label>
            <div className="grid grid-cols-3 gap-2 mt-1 mb-3">
              {["daycare","boarding","training"].map(t => (
                <button key={t} onClick={()=>{ setBookType(t); if(t==="boarding") setIsRecurring(false); }} data-testid={`book-service-${t}`}
                        className={`py-2 rounded text-[10px] font-black uppercase tracking-widest ${bookType===t?"bg-shBlue text-white":"bg-bgBase border border-bgHover text-gray-400"}`}>{t}</button>
              ))}
            </div>

            {bookType !== "boarding" && (
              <label className="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" checked={isRecurring} onChange={(e)=>setIsRecurring(e.target.checked)} data-testid="recurring-toggle" className="accent-shGreen" />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-300">Recurring booking</span>
              </label>
            )}

            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{bookType==="boarding"?"Start Date":isRecurring?"Recurrence Start":"Date"}</label>
            <input type="date" value={bookDate} onChange={(e)=>setBookDate(e.target.value)} data-testid="portal-book-date"
                   className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />

            {bookType==="boarding" && <>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">End Date</label>
              <input type="date" value={bookEnd} onChange={(e)=>setBookEnd(e.target.value)} data-testid="portal-book-end"
                     className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
            </>}

            {isRecurring && bookType!=="boarding" && <>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Repeat Until</label>
              <input type="date" value={recEnd} onChange={(e)=>setRecEnd(e.target.value)} data-testid="rec-end"
                     className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Repeat On</label>
              <div className="grid grid-cols-7 gap-1 mt-1 mb-3">
                {["M","T","W","T","F","S","S"].map((d,i)=>(
                  <button key={i} onClick={()=>toggleRecDay(i)} data-testid={`rec-day-${i}`}
                          className={`py-2 rounded text-[10px] font-black uppercase ${recDays.includes(i)?"bg-shGreen text-bgHeader":"bg-bgBase border border-bgHover text-gray-400"}`}>{d}</button>
                ))}
              </div>
            </>}

            {avail && (
              <div className={`text-[10px] font-black p-3 rounded uppercase text-center tracking-widest mb-3 ${!avail.vaccine_ok?"bg-red-500/20 text-red-400":avail.open_slots<=0?"bg-shOrange/20 text-shOrange":"bg-shGreen/10 text-shGreen"}`} data-testid="availability-message">
                {!avail.vaccine_ok ? "Rabies vaccine missing/expired"
                  : avail.open_slots <= 0 ? "Fully booked"
                  : `${avail.open_slots} of ${avail.capacity} slots open`}
              </div>
            )}

            {err && <div className="text-[10px] font-black p-3 rounded uppercase text-center tracking-widest mb-3 bg-red-500/15 text-red-400">{err}</div>}
            {success && <div className="text-[10px] font-black p-3 rounded uppercase text-center tracking-widest mb-3 bg-shGreen/15 text-shGreen">{success}</div>}

            <button onClick={book} disabled={!canBook} data-testid="portal-book-button"
                    className={`w-full py-3 rounded font-black uppercase text-[10px] tracking-widest shadow-lg ${canBook?"bg-shBlue text-white hover:bg-shBlue/90":"bg-bgBase text-gray-500 cursor-not-allowed border border-bgHover"}`}>
              Book Now
            </button>
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          <div>
            <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4">My Dogs</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="portal-dogs">
              {dogs.length === 0 && <div className="text-gray-500 text-xs font-black uppercase">No dogs on file. Contact us to add one.</div>}
              {dogs.map(d => (
                <div key={d.id} className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden shadow-lg">
                  {d.photo
                    ? <img src={d.photo} alt={d.name} className="h-32 w-full object-cover" />
                    : <div className="h-32 bg-gradient-to-br from-bgHover to-bgPanel flex items-center justify-center text-shGreen text-4xl"><i className="fas fa-paw" /></div>}
                  <div className="p-4">
                    <h4 className="text-lg font-black text-white uppercase">{d.name}</h4>
                    <p className="text-[10px] text-shBlue font-black uppercase tracking-widest">{d.breed || "Unknown"}</p>
                    <p className="text-[10px] text-gray-400 mt-2">Rabies: <span className={d.vaccines?.rabies && d.vaccines.rabies>=todayISO()?"text-shGreen":"text-red-400"}>{d.vaccines?.rabies||"Missing"}</span></p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4">My Bookings</h2>
            <div className="space-y-3" data-testid="portal-bookings">
              {bookings.length === 0 && <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 uppercase font-black text-xs">No bookings yet.</div>}
              {bookings.map(b => (
                <div key={b.id} className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-black text-white uppercase tracking-tight">{b.dog_name}</p>
                      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">{b.service_type} · {b.date}{b.end_date && b.end_date!==b.date?` → ${b.end_date}`:""}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${b.status==="approved"?"bg-shGreen/15 text-shGreen":b.status==="pending"?"bg-shOrange/15 text-shOrange":b.status==="rejected"?"bg-red-500/15 text-red-400":b.status==="completed"?"bg-shBlue/15 text-shBlue":"bg-gray-500/15 text-gray-400"}`}>{b.status}</span>
                      {(b.status==="pending"||b.status==="approved") && <button onClick={()=>cancel(b.id)} className="text-[10px] font-black uppercase text-red-400 hover:underline tracking-widest">Cancel</button>}
                    </div>
                  </div>
                  {b.report_card && (
                    <div className="border-t border-bgHover/50 bg-gradient-to-br from-shGreen/5 to-shBlue/5 p-4" data-testid={`report-card-${b.id}`}>
                      <p className="text-[10px] font-black text-shGreen uppercase tracking-widest mb-3"><i className="fas fa-paw mr-1"/> Pup Report Card</p>
                      {b.report_card.photos?.length > 0 && (
                        <div className="flex gap-2 mb-3">
                          {b.report_card.photos.map((p, i) => (
                            <img key={i} src={p} alt="" className="h-24 w-24 rounded object-cover border border-bgHover" />
                          ))}
                        </div>
                      )}
                      {b.report_card.mood_tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {b.report_card.mood_tags.map(m => (
                            <span key={m} className="text-[9px] font-black uppercase tracking-widest bg-shGreen/15 text-shGreen px-2 py-1 rounded-full">{m}</span>
                          ))}
                        </div>
                      )}
                      {b.report_card.note && <p className="text-xs text-gray-300 italic">"{b.report_card.note}"</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showWaiver && pubSettings?.waiver_text && (
        <WaiverModal
          waiverText={pubSettings.waiver_text}
          version={pubSettings.waiver_version || 1}
          dogNames={dogs.map(d=>d.name).join(", ")}
          onSigned={async ()=>{ setShowWaiver(false); await loadAll(); }}
          onClose={()=>setShowWaiver(false)}
          allowClose={waiver?.signed && !waiver?.needs_resign}
        />
      )}
    </div>
  );
}
