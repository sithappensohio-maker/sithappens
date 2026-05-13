import { useEffect, useState } from "react";
import { api } from "../lib/api";
import AdminBookingModal from "../components/AdminBookingModal";

const DEFAULT_MOOD_TAGS = ["Playful", "Calm", "Napped Well", "Made a Friend", "Worked on Training", "Star of the Day", "Tired Pup", "Extra Hungry"];

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [moodTags, setMoodTags] = useState(DEFAULT_MOOD_TAGS);
  const [reportFor, setReportFor] = useState(null); // booking
  const [showQuick, setShowQuick] = useState(false);

  const load = async () => {
    try {
      const [s, a, st] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/vaccine-alerts"),
        api.get("/settings"),
      ]);
      setStats(s.data);
      setAlerts(a.data);
      if (Array.isArray(st.data?.mood_tags) && st.data.mood_tags.length) setMoodTags(st.data.mood_tags);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const checkIn = async (id) => { try { await api.post(`/bookings/${id}/check-in`); load(); } catch {} };
  const checkOut = async (id) => { try { await api.post(`/bookings/${id}/check-out`); load(); } catch {} };
  const dismiss = async (dogId) => { try { await api.post(`/vaccine-alerts/${dogId}/dismiss`); load(); } catch {} };

  if (!stats) return <div className="text-gray-400 text-sm">Loading dashboard…</div>;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="admin-dashboard">
      {alerts.length > 0 && (
        <div className="bg-gradient-to-r from-shOrange/20 to-red-500/10 border border-shOrange/40 rounded-xl p-5 shadow-xl" data-testid="vaccine-alerts-banner">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-black text-shOrange uppercase tracking-widest flex items-center gap-2"><i className="fas fa-shield-virus"/> Vaccine Alerts · {alerts.length}</h3>
          </div>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.dog_id} className="flex items-center justify-between bg-bgBase/50 rounded p-3" data-testid={`alert-${a.dog_id}`}>
                <div className="text-xs">
                  <span className="font-black text-white uppercase">{a.dog_name}</span>
                  <span className="text-gray-400"> · {a.owner_name}</span>
                  <span className={`ml-3 text-[10px] font-black uppercase px-2 py-0.5 rounded ${a.status==='expired'||a.status==='missing'?'bg-red-500/20 text-red-400':'bg-shOrange/20 text-shOrange'}`}>
                    Rabies {a.status}{a.rabies?` · ${a.rabies}`:''}
                  </span>
                </div>
                <button onClick={()=>dismiss(a.dog_id)} data-testid={`dismiss-${a.dog_id}`} className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white">Dismiss 30d</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(stats.upcoming_birthdays || []).length > 0 && (
        <div className="bg-gradient-to-r from-shGreen/20 to-shBlue/10 border border-shGreen/40 rounded-xl p-5 shadow-xl" data-testid="birthday-banner">
          <h3 className="text-xs font-black text-shGreen uppercase tracking-widest flex items-center gap-2 mb-3"><i className="fas fa-cake-candles"/> Upcoming Birthdays · {stats.upcoming_birthdays.length}</h3>
          <div className="flex flex-wrap gap-2">
            {stats.upcoming_birthdays.map(b => (
              <div key={b.dog_id} className="bg-bgBase/60 rounded-full px-4 py-2 flex items-center gap-3 text-xs">
                <span className="font-black text-white uppercase">{b.dog_name}</span>
                <span className="text-shGreen font-black">turns {b.turning}</span>
                <span className="text-gray-400">{b.days===0?"today!":b.days===1?"tomorrow":`in ${b.days} days`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard label="Daycare Today" value={`${stats.daycare_occupancy} / ${stats.daycare_capacity}`} accent="border-t-shBlue" textColor="text-white" testId="stat-daycare" />
        <StatCard label="Boarding Today" value={stats.boarding_today} accent="border-t-shGreen" textColor="text-shGreen" testId="stat-boarding" />
        <StatCard label="Health Flags" value={stats.health_flags} accent="border-t-shOrange" textColor="text-shOrange" testId="stat-health" />
        <StatCard label="Total Dogs" value={stats.total_dogs} accent="border-t-bgHover" textColor="text-white" testId="stat-dogs" />
      </div>

      <div className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between gap-3">
          <h3 className="text-xs font-black text-white uppercase tracking-widest"><i className="fas fa-clipboard-check mr-2 text-shGreen"/>Today's Check-in Board</h3>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-black text-gray-500 uppercase hidden sm:inline">{stats.today_roster?.length || 0} dogs</span>
            <button onClick={()=>setShowQuick(true)} data-testid="quick-checkin-button"
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow hover:bg-shGreen/90">
              <i className="fas fa-plus mr-1"/>Quick Check-in
            </button>
          </div>
        </div>
        <div className="divide-y divide-bgHover/40" data-testid="checkin-board">
          {(stats.today_roster || []).length === 0 && <div className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black">No dogs scheduled today.</div>}
          {(stats.today_roster || []).map(b => {
            const onPremises = b.checked_in_at && !b.checked_out_at;
            const done = !!b.checked_out_at;
            const d = b.dog || {};
            const careIcons = [];
            if (d.feeding_schedule?.length) careIcons.push({i:"fa-bowl-food",c:"text-shGreen",n:d.feeding_schedule.length});
            if (d.medications?.length) careIcons.push({i:"fa-pills",c:"text-purple-400",n:d.medications.length});
            return (
              <div key={b.id} className="px-6 py-4 flex items-center justify-between hover:bg-bgBase/30 transition" data-testid={`roster-${b.id}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-3 h-3 rounded-full ${done?"bg-gray-500":onPremises?"bg-shGreen animate-pulse":"bg-shOrange"}`}/>
                  <div>
                    <p className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                      {b.dog_name}
                      {careIcons.map((ic,idx)=><i key={idx} className={`fas ${ic.i} ${ic.c} text-[10px]`} title={`${ic.n} ${ic.i==="fa-pills"?"medications":"feedings"}`} />)}
                    </p>
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{b.client_name} · {b.service_type}{b.kennel?` · ${b.kennel}`:""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden md:block">
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest">In · Out</p>
                    <p className="text-xs text-gray-300 font-mono">{fmtTime(b.checked_in_at)} · {fmtTime(b.checked_out_at)}</p>
                  </div>
                  {!b.checked_in_at && (
                    <button onClick={()=>checkIn(b.id)} data-testid={`checkin-${b.id}`}
                            className="bg-shGreen text-bgHeader px-5 py-2 rounded font-black uppercase text-[10px] tracking-widest shadow hover:bg-shGreen/90">Check In</button>
                  )}
                  {onPremises && (
                    <button onClick={()=>checkOut(b.id)} data-testid={`checkout-${b.id}`}
                            className="bg-shBlue text-white px-5 py-2 rounded font-black uppercase text-[10px] tracking-widest shadow hover:bg-shBlue/90">Check Out</button>
                  )}
                  {done && !b.report_card && (
                    <button onClick={()=>setReportFor(b)} data-testid={`report-${b.id}`}
                            className="bg-shOrange/15 text-shOrange border border-shOrange/40 px-5 py-2 rounded font-black uppercase text-[10px] tracking-widest hover:bg-shOrange/25">+ Report Card</button>
                  )}
                  {done && b.report_card && (
                    <button onClick={()=>setReportFor(b)} data-testid={`view-report-${b.id}`}
                            className="bg-shGreen/15 text-shGreen border border-shGreen/40 px-5 py-2 rounded font-black uppercase text-[10px] tracking-widest hover:bg-shGreen/25">View Card</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {reportFor && <ReportCardModal booking={reportFor} moodTags={moodTags} onClose={()=>{ setReportFor(null); load(); }} />}
      {showQuick && <AdminBookingModal defaultCheckIn={true} onClose={()=>setShowQuick(false)} onCreated={load} />}
    </div>
  );
}

function StatCard({ label, value, accent, textColor, testId }) {
  return (
    <div className={`bg-bgPanel p-6 rounded-xl border-t-4 ${accent} shadow-lg`} data-testid={testId}>
      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-black mt-2 ${textColor}`}>{value}</p>
    </div>
  );
}

function ReportCardModal({ booking, moodTags, onClose }) {
  const existing = booking.report_card || { photos: [], mood_tags: [], note: "" };
  const [photos, setPhotos] = useState(existing.photos || []);
  const [moods, setMoods] = useState(existing.mood_tags || []);
  const [note, setNote] = useState(existing.note || "");
  const [saving, setSaving] = useState(false);

  const onFiles = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length);
    files.forEach(f => {
      const r = new FileReader();
      r.onload = () => setPhotos((p) => [...p, r.result].slice(0, 3));
      r.readAsDataURL(f);
    });
  };

  const toggleMood = (m) => setMoods((cur) => cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/bookings/${booking.id}/report-card`, { photos, mood_tags: moods, note });
      onClose();
    } catch (e) { alert("Failed to save"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-8 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto" data-testid="report-card-modal">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">Pup Report Card</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
        </div>
        <p className="text-[11px] text-shGreen font-black uppercase tracking-widest mb-6">{booking.dog_name} · {booking.client_name} · {booking.date}</p>

        <div className="space-y-5">
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Photos (up to 3)</label>
            <div className="mt-2 flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt="" className="h-24 w-24 rounded object-cover border border-bgHover" />
                  <button onClick={()=>setPhotos(photos.filter((_,j)=>j!==i))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 text-xs">×</button>
                </div>
              ))}
              {photos.length < 3 && (
                <label className="h-24 w-24 rounded border-2 border-dashed border-bgHover flex items-center justify-center cursor-pointer hover:border-shGreen text-gray-500 hover:text-shGreen">
                  <i className="fas fa-camera text-xl" />
                  <input type="file" accept="image/*" multiple onChange={onFiles} className="hidden" data-testid="report-photo-input" />
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Mood / Highlights</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(moodTags || []).map(m => (
                <button key={m} onClick={()=>toggleMood(m)} data-testid={`mood-${m.replace(/\s/g,'-')}`}
                        className={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition ${moods.includes(m)?"bg-shGreen text-bgHeader border-shGreen":"bg-bgBase text-gray-400 border-bgHover hover:border-shGreen/50"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Note from the trainer</label>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={3} placeholder="e.g., Biscuit absolutely crushed recall today!"
                      data-testid="report-note-input"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shGreen outline-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[10px] tracking-widest">Close</button>
            <button onClick={save} disabled={saving} data-testid="save-report-button"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[10px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving?"Saving…":"Save Report Card"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
