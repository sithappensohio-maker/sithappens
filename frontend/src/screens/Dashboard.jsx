import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import AdminBookingModal from "../components/AdminBookingModal";
import VaccineCenterModal from "../components/VaccineCenterModal";
import usePullToRefresh, { RefreshSpinner } from "../lib/usePullToRefresh";
import { useConfirm } from "../lib/useConfirm";

const DEFAULT_MOOD_TAGS = ["Playful", "Calm", "Napped Well", "Made a Friend", "Worked on Training", "Star of the Day", "Tired Pup", "Extra Hungry"];

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

export default function Dashboard({ onNavigate = () => {}, onJumpToDog = () => {}, onJumpToClient = () => {} }) {
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [moodTags, setMoodTags] = useState(DEFAULT_MOOD_TAGS);
  const [reportFor, setReportFor] = useState(null); // booking
  const [checkoutFor, setCheckoutFor] = useState(null); // booking — opens checkout modal
  const [cancelFor, setCancelFor] = useState(null); // booking — opens cancel-confirm modal
  const [services, setServices] = useState([]);
  const [showQuick, setShowQuick] = useState(false);
  const [programs, setPrograms] = useState(null);
  const [pendingVax, setPendingVax] = useState([]);
  const [vaxPhoto, setVaxPhoto] = useState(null); // {photo, dog_name, vaccine}
  const [vaccineCenterOpen, setVaccineCenterOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState({ top_dogs: [], top_clients: [] });
  const [quoteRequests, setQuoteRequests] = useState([]);
  const confirm = useConfirm();

  const load = async () => {
    try {
      const [s, a, st, pg, sv, vx, lb, qr] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/vaccine-alerts"),
        api.get("/settings"),
        api.get("/programs/active-summary").catch(()=>({data:null})),
        api.get("/services").catch(()=>({data:[]})),
        api.get("/admin/vaccine-cert-uploads").catch(()=>({data:[]})),
        api.get("/trophies/leaderboard").catch(()=>({data:{top_dogs:[],top_clients:[]}})),
        api.get("/admin/quote-requests?status=open").catch(()=>({data:[]})),
      ]);
      setStats(s.data);
      setAlerts(a.data);
      if (Array.isArray(st.data?.mood_tags) && st.data.mood_tags.length) setMoodTags(st.data.mood_tags);
      setPrograms(pg.data);
      setServices(sv.data || []);
      setPendingVax(Array.isArray(vx.data) ? vx.data : []);
      setLeaderboard(lb.data || { top_dogs: [], top_clients: [] });
      setQuoteRequests(Array.isArray(qr.data) ? qr.data : []);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const checkIn = async (id) => { try { await api.post(`/bookings/${id}/check-in`); load(); } catch {} };
  const dismiss = async (dogId) => { try { await api.post(`/vaccine-alerts/${dogId}/dismiss`); load(); } catch {} };

  const approveVax = async (v) => {
    try {
      await api.post(`/admin/dogs/${v.dog_id}/vaccine-cert/${v.vaccine}/review`);
      setPendingVax(prev => prev.filter(x => !(x.dog_id===v.dog_id && x.vaccine===v.vaccine)));
    } catch {}
  };
  const rejectVax = async (v) => {
    const ok = await confirm({
      title: `Reject ${v.vaccine.toUpperCase()} cert?`,
      body: `This will remove the upload AND clear ${v.dog_name}'s ${v.vaccine} expiry. The client will need to reupload before they can book.`,
      confirmText: "Reject",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/dogs/${v.dog_id}/vaccine-cert/${v.vaccine}`);
      setPendingVax(prev => prev.filter(x => !(x.dog_id===v.dog_id && x.vaccine===v.vaccine)));
    } catch (e) { console.warn("rejectVax failed:", e); }
  };

  const { pulling, progress } = usePullToRefresh("[data-scroll-root]", load);

  if (!stats) return <div className="text-gray-400 text-sm">Loading dashboard…</div>;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="admin-dashboard">
      <RefreshSpinner pulling={pulling} progress={progress} />
      {alerts.length > 0 && (
        <div className="card-warning rounded-xl p-5 shadow-xl" data-testid="vaccine-alerts-banner">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-black text-shOrange uppercase tracking-widest flex items-center gap-2"><i className="fas fa-shield-virus"/> Vaccine Alerts · {alerts.length}</h3>
            <button onClick={()=>setVaccineCenterOpen(true)} data-testid="open-vaccine-center"
                    className="bg-shOrange text-bgHeader px-4 py-2 rounded font-black uppercase tracking-widest text-[14px] shadow hover:bg-shOrange/90">
              <i className="fas fa-shield-heart mr-1"/>Manage All
            </button>
          </div>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.dog_id} className="flex items-center justify-between bg-bgBase/50 rounded p-3" data-testid={`alert-${a.dog_id}`}>
                <div className="text-xs">
                  <span className="font-black text-white uppercase">{a.dog_name}</span>
                  <span className="text-gray-400"> · {a.owner_name}</span>
                  <span className={`ml-3 text-[14px] font-black uppercase px-2 py-0.5 rounded ${a.status==='expired'||a.status==='missing'?'bg-red-500/20 text-red-400':'bg-shOrange/20 text-shOrange'}`}>
                    Rabies {a.status}{a.rabies?` · ${a.rabies}`:''}
                  </span>
                </div>
                <button onClick={()=>dismiss(a.dog_id)} data-testid={`dismiss-${a.dog_id}`} className="text-[14px] font-black uppercase tracking-widest text-gray-400 hover:text-white">Dismiss 30d</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingVax.length > 0 && (
        <div className="card-info rounded-xl p-5 shadow-xl" data-testid="pending-vax-reviews">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-black text-shBlue uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-file-medical"/> Pending Vaccine Reviews · {pendingVax.length}
            </h3>
            <span className="text-[13px] font-bold uppercase tracking-widest text-gray-500">Client uploads awaiting approval</span>
          </div>
          <div className="space-y-2">
            {pendingVax.map(v => (
              <div key={`${v.dog_id}-${v.vaccine}`} className="flex items-center justify-between gap-3 bg-bgBase/50 rounded p-3 flex-wrap" data-testid={`pending-vax-${v.dog_id}-${v.vaccine}`}>
                <div className="flex items-center gap-3 min-w-0">
                  {v.photo ? (
                    <button
                      type="button"
                      onClick={()=>setVaxPhoto(v)}
                      className="w-14 h-14 rounded overflow-hidden ring-1 ring-shBlue/40 shrink-0 hover:ring-shBlue transition"
                      data-testid={`view-vax-photo-${v.dog_id}-${v.vaccine}`}
                      title="Click to view full"
                    >
                      <img src={v.photo} alt={`${v.vaccine} cert`} className="w-full h-full object-cover"/>
                    </button>
                  ) : (
                    <div className="w-14 h-14 rounded bg-bgBase/80 ring-1 ring-gray-700 grid place-items-center text-gray-500 shrink-0">
                      <i className="fas fa-image"/>
                    </div>
                  )}
                  <div className="text-xs min-w-0">
                    <div className="font-black text-white uppercase truncate">{v.dog_name} <span className="text-gray-500 font-normal normal-case">· {v.client_name || "—"}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-black uppercase px-2 py-0.5 rounded bg-shBlue/20 text-shBlue text-[13px] tracking-widest">{v.vaccine}</span>
                      {v.expires_on && <span className="text-gray-400">Expires <span className="font-black text-white">{v.expires_on}</span></span>}
                      {v.uploaded_at && <span className="text-gray-500">· uploaded {new Date(v.uploaded_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={()=>rejectVax(v)}
                    data-testid={`reject-vax-${v.dog_id}-${v.vaccine}`}
                    className="text-[13px] font-black uppercase tracking-widest px-3 py-2 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition"
                  >
                    <i className="fas fa-times mr-1"/> Reject
                  </button>
                  <button
                    onClick={()=>approveVax(v)}
                    data-testid={`approve-vax-${v.dog_id}-${v.vaccine}`}
                    className="text-[13px] font-black uppercase tracking-widest px-3 py-2 rounded bg-shGreen/20 text-shGreen hover:bg-shGreen/30 transition"
                  >
                    <i className="fas fa-check mr-1"/> Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {quoteRequests.length > 0 && (
        <div className="card-info rounded-xl p-5 shadow-xl" data-testid="quote-requests-panel">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-xs font-black text-shGreen uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-envelope-open-text"/> Quote Requests · {quoteRequests.length}
            </h3>
            <span className="text-[13px] font-bold uppercase tracking-widest text-gray-500">Clients interested in services/programs</span>
          </div>
          <div className="space-y-2">
            {quoteRequests.map(q => (
              <div key={q.id} className="flex items-start justify-between gap-3 bg-bgBase/50 rounded p-3 flex-wrap" data-testid={`quote-request-${q.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-black text-white uppercase italic tracking-tight">
                    {q.client_name} <span className="text-gray-500 font-normal normal-case">wants info on</span> <span className="text-shGreen">{q.item_name}</span>
                    {q.listed_price > 0 && <span className="text-gray-400 text-[14px] font-normal normal-case"> · ${Number(q.listed_price).toFixed(2)}</span>}
                  </div>
                  <div className="text-[13px] text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                    <span><i className="fas fa-clock mr-1"/>{q.created_at ? new Date(q.created_at).toLocaleString() : ""}</span>
                    {q.client_email && <a href={`mailto:${q.client_email}`} className="text-shBlue hover:underline"><i className="fas fa-envelope mr-1"/>{q.client_email}</a>}
                    {q.client_phone && <a href={`tel:${q.client_phone}`} className="text-shBlue hover:underline"><i className="fas fa-phone mr-1"/>{q.client_phone}</a>}
                  </div>
                  {q.message && <p className="text-[14px] text-gray-300 mt-2 italic bg-bgPanel/60 rounded p-2"><i className="fas fa-quote-left text-gray-600 mr-1"/>{q.message}</p>}
                </div>
                <button
                  onClick={async ()=>{
                    try {
                      await api.post(`/admin/quote-requests/${q.id}/close`);
                      setQuoteRequests(prev => prev.filter(x => x.id !== q.id));
                    } catch {}
                  }}
                  data-testid={`close-quote-${q.id}`}
                  className="text-[13px] font-black uppercase tracking-widest px-3 py-2 rounded bg-shGreen/20 text-shGreen hover:bg-shGreen/30 transition self-start"
                >
                  <i className="fas fa-check mr-1"/> Mark Handled
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(stats.first_time_bookings_today || []).length > 0 && (
        <div className="card-success rounded-xl p-5 shadow-xl" data-testid="first-booking-banner">
          <h3 className="text-xs font-black text-shGreen uppercase tracking-widest flex items-center gap-2 mb-3">
            <i className="fas fa-party-horn"/> First Booking Celebration · {stats.first_time_bookings_today.length}
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.first_time_bookings_today.map(b => (
              <div key={b.booking_id} className="bg-bgBase/60 rounded-full px-4 py-2 flex items-center gap-3 text-xs" data-testid={`first-booking-${b.booking_id}`}>
                <span className="text-shGreen text-base"><i className="fas fa-paw"/></span>
                <span className="font-black text-white uppercase">{b.client_name || "New client"}</span>
                <span className="text-gray-400">just booked their</span>
                <span className="font-black text-shGreen uppercase">first {b.service_type || "session"}</span>
                {b.dog_name && <span className="text-gray-400">for <span className="font-black text-white uppercase">{b.dog_name}</span></span>}
                {b.date && <span className="text-shBlue font-black uppercase text-[13px] tracking-widest">· {b.date}{b.end_date && b.end_date !== b.date ? ` → ${b.end_date}` : ""}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {(stats.upcoming_birthdays || []).length > 0 && (
        <div className="card-info rounded-xl p-5 shadow-xl" data-testid="birthday-banner">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        <StatCard label="Daycare Today" value={`${stats.daycare_occupancy} / ${stats.daycare_capacity}`} accent="border-t-shBlue" gradClass="card-info"    textColor="text-white" testId="stat-daycare" onClick={()=>onNavigate("schedule")} />
        <StatCard label="Boarding Today" value={stats.boarding_today}   accent="border-t-shGreen"  gradClass="card-hero"    textColor="text-shGreen" testId="stat-boarding" onClick={()=>onNavigate("schedule")} />
        <StatCard label="Health Flags"  value={stats.health_flags}    accent="border-t-shOrange" gradClass="card-warning" textColor="text-shOrange" testId="stat-health" onClick={()=>setVaccineCenterOpen(true)} />
        <StatCard label="Total Dogs"    value={stats.total_dogs}      accent="border-t-bgHover"  gradClass=""             textColor="text-white" testId="stat-dogs" onClick={()=>onNavigate("dogs")} />
      </div>

      {programs && programs.total > 0 && (
        <div className="bg-bgPanel rounded-xl border border-bgHover p-4" data-testid="programs-tile">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-black text-white uppercase tracking-widest"><i className="fas fa-graduation-cap mr-2 text-shBlue"/>Dogs in Active Programs</p>
            <span className="text-xs text-gray-500 font-black uppercase tracking-widest">{programs.total} active</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(programs.by_type).map(([type, count]) => {
              const colors = {private_lessons:"#00a9e0", board_train:"#8cc63f", service_dog:"#a855f7", custom:"#ec4899"};
              const labels = {private_lessons:"Private Lessons", board_train:"Board & Train", service_dog:"Service Dog", custom:"Custom"};
              return (
                <div key={type} className="px-3 py-1.5 rounded border" style={{borderColor:(colors[type]||"#475569")+"60", background:(colors[type]||"#475569")+"15"}}>
                  <span className="text-[14px] font-black uppercase tracking-widest" style={{color: colors[type]||"#94a3b8"}}>{labels[type]||type}</span>
                  <span className="text-white ml-2 font-black">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between gap-3">
          <h3 className="text-xs font-black text-white uppercase tracking-widest"><i className="fas fa-clipboard-check mr-2 text-shGreen"/>Today's Check-in Board</h3>
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-black text-gray-500 uppercase hidden sm:inline">{stats.today_roster?.length || 0} dogs</span>
            <button onClick={()=>setShowQuick(true)} data-testid="quick-checkin-button"
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest shadow hover:bg-shGreen/90">
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
            // Credit balance for the relevant pool — shown so admin can settle from credits at check-out
            const balField = b.service_type === "training" ? "training_credits"
                            : b.service_type === "boarding" ? "boarding_credits"
                            : b.service_type === "daycare" ? "credits"
                            : null;
            const credits = balField ? (b.client_credits?.[balField] ?? null) : null;
            const creditChipColor = credits == null ? ""
              : credits > 0 ? "bg-shGreen/15 text-shGreen border-shGreen/40"
              : "bg-gray-700/50 text-gray-400 border-gray-600";
            return (
              <div key={b.id} className="px-6 py-4 flex items-center justify-between hover:bg-bgBase/30 transition" data-testid={`roster-${b.id}`}>
                <button
                  type="button"
                  onClick={() => b.dog_id ? onJumpToDog(b.dog_id) : null}
                  title="Open dog profile"
                  className="flex items-center gap-4 -ml-2 pl-2 pr-3 py-1 rounded text-left transition hover:bg-bgPanel/60 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shGreen/40"
                  data-testid={`roster-dog-link-${b.id}`}
                >
                  <div className={`w-3 h-3 rounded-full ${done?"bg-gray-500":onPremises?"bg-shGreen animate-pulse":"bg-shOrange"}`}/>
                  <div>
                    <p className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                      {b.dog_name}
                      {careIcons.map((ic,idx)=><i key={idx} className={`fas ${ic.i} ${ic.c} text-[14px]`} title={`${ic.n} ${ic.i==="fa-pills"?"medications":"feedings"}`} />)}
                      {credits != null && (
                        <span className={`text-[13px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${creditChipColor}`}
                              title={`Available ${b.service_type} credits`} data-testid={`roster-credits-${b.id}`}>
                          <i className="fas fa-coins mr-1"/>{credits}
                        </span>
                      )}
                    </p>
                    <p className="text-[14px] text-gray-400 font-black uppercase tracking-widest">{b.client_name} · {b.service_type}{b.kennel?` · ${b.kennel}`:""}</p>
                  </div>
                </button>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden md:block">
                    <p className="text-[15px] text-gray-500 font-black uppercase tracking-widest">In · Out</p>
                    <p className="text-xs text-gray-300 font-mono">{fmtTime(b.checked_in_at)} · {fmtTime(b.checked_out_at)}</p>
                  </div>
                  {!b.checked_in_at && (
                    <button onClick={()=>checkIn(b.id)} data-testid={`checkin-${b.id}`}
                            className="bg-shGreen text-bgHeader px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest shadow hover:bg-shGreen/90">Check In</button>
                  )}
                  {onPremises && (
                    <>
                      <button onClick={()=>setCheckoutFor(b)} data-testid={`checkout-${b.id}`}
                              className="bg-shBlue text-white px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest shadow hover:bg-shBlue/90">Check Out</button>
                      <button onClick={()=>setCancelFor(b)} data-testid={`cancel-${b.id}`}
                              title="Cancel booking — refunds any credit deducted"
                              className="bg-bgHover/40 text-gray-300 px-3 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-red-500/40 hover:text-white">
                        <i className="fas fa-times mr-1"/>Cancel
                      </button>
                    </>
                  )}
                  {done && !b.report_card && (
                    <button onClick={()=>setReportFor(b)} data-testid={`report-${b.id}`}
                            className="bg-shOrange/15 text-shOrange border border-shOrange/40 px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shOrange/25">+ Report Card</button>
                  )}
                  {done && b.report_card && (
                    <button onClick={()=>setReportFor(b)} data-testid={`view-report-${b.id}`}
                            className="bg-shGreen/15 text-shGreen border border-shGreen/40 px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shGreen/25">View Card</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(leaderboard.top_dogs.length > 0 || leaderboard.top_clients.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="leaderboard-section">
          {leaderboard.top_dogs.length > 0 && (
            <div className="bg-bgPanel rounded-xl p-5 border-t-4 border-shOrange shadow-lg" data-testid="top-dogs-leaderboard">
              <h3 className="text-xs font-black text-shOrange uppercase tracking-widest mb-4 flex items-center gap-2"><i className="fas fa-trophy"/>Top Dogs · Most Trophies</h3>
              <div className="space-y-2">
                {leaderboard.top_dogs.map((d, i) => (
                  <button
                    key={d.dog_id}
                    type="button"
                    onClick={() => onJumpToDog(d.dog_id)}
                    title="Open dog profile"
                    className="w-full text-left flex items-center gap-3 bg-bgBase/50 rounded p-2 transition hover:bg-bgBase hover:ring-1 hover:ring-shOrange/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shOrange/60"
                    data-testid={`top-dog-${d.dog_id}`}
                  >
                    <span className={`text-lg font-black w-7 text-center ${i===0?"text-yellow-400":i===1?"text-slate-300":i===2?"text-amber-600":"text-gray-500"}`}>#{i+1}</span>
                    {d.photo ? (
                      <img src={d.photo} alt={d.dog_name} className="w-10 h-10 rounded-full object-cover ring-1 ring-bgHover"/>
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-bgHover grid place-items-center text-shGreen"><i className="fas fa-paw"/></div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-white uppercase truncate">{d.dog_name}</div>
                      <div className="text-[13px] text-gray-500">{d.breed || "—"} · {d.owner_name || ""}</div>
                    </div>
                    <span className="bg-shOrange/15 text-shOrange font-black uppercase tracking-widest text-[13px] px-2 py-1 rounded">{d.trophy_count} 🏆</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {leaderboard.top_clients.length > 0 && (
            <div className="bg-bgPanel rounded-xl p-5 border-t-4 border-shBlue shadow-lg" data-testid="top-clients-leaderboard">
              <h3 className="text-xs font-black text-shBlue uppercase tracking-widest mb-4 flex items-center gap-2"><i className="fas fa-medal"/>Top Clients · Most Trophies</h3>
              <div className="space-y-2">
                {leaderboard.top_clients.map((c, i) => (
                  <button
                    key={c.client_id}
                    type="button"
                    onClick={() => onJumpToClient(c.client_id)}
                    title="Open client profile"
                    className="w-full text-left flex items-center gap-3 bg-bgBase/50 rounded p-2 transition hover:bg-bgBase hover:ring-1 hover:ring-shBlue/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shBlue/60"
                    data-testid={`top-client-${c.client_id}`}
                  >
                    <span className={`text-lg font-black w-7 text-center ${i===0?"text-yellow-400":i===1?"text-slate-300":i===2?"text-amber-600":"text-gray-500"}`}>#{i+1}</span>
                    <div className="w-10 h-10 rounded-full bg-bgHover grid place-items-center text-shBlue"><i className="fas fa-user"/></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-white uppercase truncate">{c.client_name}</div>
                    </div>
                    <span className="bg-shBlue/15 text-shBlue font-black uppercase tracking-widest text-[13px] px-2 py-1 rounded">{c.trophy_count} 🏆</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {reportFor && <ReportCardModal booking={reportFor} moodTags={moodTags} onClose={()=>{ setReportFor(null); load(); }} />}
      <VaccineCenterModal open={vaccineCenterOpen} onClose={()=>setVaccineCenterOpen(false)} onChanged={load} />
      {checkoutFor && <CheckoutModal booking={checkoutFor} services={services}
                                     onRequestCancel={(b)=>{ setCheckoutFor(null); setCancelFor(b); }}
                                     onClose={()=>{ setCheckoutFor(null); load(); }} />}
      {cancelFor && <CancelBookingModal booking={cancelFor} onClose={()=>{ setCancelFor(null); load(); }} />}
      {showQuick && <AdminBookingModal defaultCheckIn={true} onClose={()=>setShowQuick(false)} onCreated={load} />}
      {vaxPhoto && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur grid place-items-center p-6" onClick={()=>setVaxPhoto(null)} data-testid="vax-photo-lightbox">
          <div className="max-w-3xl w-full bg-bgPanel rounded-xl overflow-hidden shadow-2xl" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-bgHover">
              <div className="text-xs font-black uppercase tracking-widest text-white">
                {vaxPhoto.dog_name} · <span className="text-shBlue">{vaxPhoto.vaccine}</span>
                {vaxPhoto.expires_on && <span className="text-gray-400 normal-case font-normal"> · expires {vaxPhoto.expires_on}</span>}
              </div>
              <button onClick={()=>setVaxPhoto(null)} data-testid="vax-photo-close" className="text-gray-400 hover:text-white text-lg"><i className="fas fa-times"/></button>
            </div>
            <div className="bg-black p-3 flex justify-center">
              <img src={vaxPhoto.photo} alt="vaccine cert" className="max-h-[75vh] object-contain"/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, gradClass = "", textColor, testId, onClick }) {
  const base = `bg-bgPanel ${gradClass} p-6 rounded-xl border-t-4 ${accent} shadow-lg text-left w-full transition`;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={`${base} hover:scale-[1.02] hover:shadow-xl active:scale-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shGreen/60`}
        title="Click to view details"
      >
        <div className="flex items-start justify-between">
          <p className="text-[14px] text-gray-400 font-black uppercase tracking-widest">{label}</p>
          <i className="fas fa-arrow-right text-[14px] text-gray-500 opacity-0 group-hover:opacity-100"></i>
        </div>
        <p className={`text-3xl font-black mt-2 ${textColor}`}>{value}</p>
      </button>
    );
  }
  return (
    <div className={base} data-testid={testId}>
      <p className="text-[14px] text-gray-400 font-black uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-black mt-2 ${textColor}`}>{value}</p>
    </div>
  );
}

function ReportCardModal({ booking, moodTags, onClose }) {
  const existing = booking.report_card || { photos: [], mood_tags: [], note: "" };
  const [photos, setPhotos] = useState(existing.photos || []);
  // Saved report-card moods are plain label strings (legacy compatible).
  const [moods, setMoods] = useState(existing.mood_tags || []);
  const [note, setNote] = useState(existing.note || "");
  const [saving, setSaving] = useState(false);
  // Normalize the tag catalog so each entry has {label, icon, color}, regardless
  // of whether settings stored it as a string (legacy) or object (new).
  const tagDefs = (moodTags || []).map(t => (typeof t === "string"
    ? { label: t, icon: "", color: "" }
    : { label: t?.label || "", icon: t?.icon || "", color: t?.color || "" })).filter(t => t.label);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length);
    const compressed = await Promise.all(files.map(f => compressImage(f)));
    setPhotos((p) => [...p, ...compressed.filter(Boolean)].slice(0, 3));
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
        <p className="text-[15px] text-shGreen font-black uppercase tracking-widest mb-6">{booking.dog_name} · {booking.client_name} · {booking.date}</p>

        <div className="space-y-5">
          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Photos (up to 3)</label>
            <div className="mt-2 flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt="" loading="lazy" decoding="async" className="h-24 w-24 rounded object-cover border border-bgHover" />
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
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Mood / Highlights</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {tagDefs.map(({ label, icon, color }) => {
                const hex = color || "#8cc63f";
                const selected = moods.includes(label);
                return (
                  <button key={label} onClick={()=>toggleMood(label)} data-testid={`mood-${label.replace(/\s/g,'-')}`}
                          className="px-3 py-2 rounded-full text-[14px] font-black uppercase tracking-widest border transition flex items-center gap-2"
                          style={selected
                            ? { backgroundColor: hex, color: "#0f172a", borderColor: hex }
                            : { backgroundColor: "transparent", color: hex, borderColor: `${hex}55` }}>
                    {icon && <i className={`fas ${icon}`}/>}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Note from the trainer</label>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={3} placeholder="e.g., Biscuit absolutely crushed recall today!"
                      data-testid="report-note-input"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shGreen outline-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Close</button>
            <button onClick={save} disabled={saving} data-testid="save-report-button"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving?"Saving…":"Save Report Card"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function CheckoutModal({ booking, services, onClose, onRequestCancel }) {
  // Pre-deducted credit info — if non-zero, the owner already has a pending charge
  // on their pack that we'll either consume (default) or refund.
  const hadCredit = !!booking.credit_value && !booking.actual_price;
  const creditAmt = Number(booking.credit_value || 0);
  const creditPool = booking.credit_service_type || booking.service_type || "daycare";
  const creditsDeducted = booking.credits_deducted || 0;

  // For boarding: how many nights this booking covers (1 if no end_date).
  const nightsNeeded = (() => {
    if (booking.service_type !== "boarding") return 1;
    try {
      const s = new Date(booking.date), e = new Date(booking.end_date || booking.date);
      const n = Math.round((e - s) / (1000 * 60 * 60 * 24)) || 1;
      return Math.max(1, n);
    } catch { return 1; }
  })();
  // Fetch client balance so we can offer "pay with credits" at checkout when
  // the booking was made without any pre-deduction (e.g. client had no credits
  // at booking time, then bought a pack later). Without this admins were stuck
  // having to take cash even though the client now had credits.
  const [clientBal, setClientBal] = useState(null); // { credits, training_credits, boarding_credits }
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/clients/${booking.client_id}`);
        if (alive) setClientBal({
          credits: data.credits || 0,
          training_credits: data.training_credits || 0,
          boarding_credits: data.boarding_credits || 0,
        });
      } catch (e) { console.warn("client balance fetch failed", e); }
    })();
    return () => { alive = false; };
  }, [booking.client_id]);

  const balField = booking.service_type === "training" ? "training_credits"
                  : booking.service_type === "boarding" ? "boarding_credits"
                  : "credits";
  const available = clientBal ? (clientBal[balField] || 0) : 0;
  // Can the admin opt to settle this booking from credits NOW?
  const canPayWithCredits = !hadCredit && !booking.actual_price && available >= nightsNeeded;

  // Default: use credits if either (a) the booking was pre-deducted (legacy)
  // or (b) the client has enough credits available right now. Credits are
  // deducted at checkout only, so this is the typical happy path.
  const [useCredits, setUseCredits] = useState(hadCredit);
  const [defaultedFromBal, setDefaultedFromBal] = useState(false);
  // Once we know the client's balance, flip the default ON if they can cover it.
  useEffect(() => {
    if (clientBal && !defaultedFromBal && !hadCredit && available >= nightsNeeded && nightsNeeded > 0 && !booking.actual_price) {
      setUseCredits(true);
      setDefaultedFromBal(true);
    }
  }, [clientBal, available, nightsNeeded, hadCredit, defaultedFromBal, booking.actual_price]);
  const [payMethod, setPayMethod] = useState("cash");
  const [basePrice, setBasePrice] = useState(""); // empty = use service default
  // Boarding-only: extra nights beyond the original booking
  const [extraNights, setExtraNights] = useState(0);
  const [extraUseCredits, setExtraUseCredits] = useState(true);
  const [extraRate, setExtraRate] = useState(""); // empty = use settings boarding_rate
  const boardingRate = (services || []).find(s => s.service_type === "boarding" && s.is_default && s.active)?.base_price || 0;
  const extraRateEffective = extraRate !== "" ? Number(extraRate) || 0 : Number(boardingRate || 0);
  // How many extra-night credits CAN be drawn? Min of (extraNights, currentBoardingCredits).
  // We approximate boarding balance from the original booking — exact balance is server-side.
  const isBoarding = booking.service_type === "boarding";
  // Add-ons are NOT the same service-type as the booking (those would just bump the base).
  // Show the rest of the active services as quick-add chips.
  const addOnCandidates = (services || []).filter(s => s.active && s.service_type !== booking.service_type);
  const [cart, setCart] = useState({}); // { service_id: { service, qty } }

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const addOne = (svc) => setCart(c => ({ ...c, [svc.id]: { service: svc, qty: (c[svc.id]?.qty || 0) + 1 } }));
  const removeOne = (svc) => setCart(c => {
    const next = { ...c };
    const cur = next[svc.id];
    if (!cur) return c;
    if (cur.qty <= 1) delete next[svc.id]; else next[svc.id] = { ...cur, qty: cur.qty - 1 };
    return next;
  });

  const cartItems = Object.values(cart);
  const addOnTotal = cartItems.reduce((s, it) => s + (Number(it.service.base_price || 0) * it.qty), 0);

  // Base price preview — what gets logged as today's income line.
  // Even when paying with credits, we still want a dollar figure for income tracking.
  let basePreview = 0;
  if (basePrice !== "") {
    basePreview = Number(basePrice) || 0;
  } else if (useCredits && hadCredit && creditAmt > 0) {
    // Legacy: pre-deducted credits with a known lot value
    basePreview = creditAmt;
  } else {
    const defaultSvc = (services || []).find(s => s.is_default && s.service_type === booking.service_type && s.active);
    basePreview = defaultSvc ? Number(defaultSvc.base_price || 0) : Number(booking.actual_price || 0);
  }
  // Estimate extra-nights charge for preview purposes (server is source of truth).
  const extraNightsCharge = isBoarding && extraNights > 0 && !extraUseCredits
    ? Math.round(extraNights * extraRateEffective * 100) / 100
    : 0;
  const chargedToday = (useCredits ? 0 : basePreview) + addOnTotal + extraNightsCharge;
  const grandLine = basePreview + addOnTotal + extraNightsCharge;

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const body = {
        use_credits: useCredits,
        add_ons: cartItems.map(it => ({
          service_id: it.service.id, name: it.service.name,
          price: Number(it.service.base_price || 0), qty: it.qty,
        })),
      };
      if (isBoarding && extraNights > 0) {
        body.extra_nights = Number(extraNights);
        body.extra_nights_use_credits = extraUseCredits;
        if (extraRate !== "") body.extra_nights_rate = Number(extraRate);
      }
      if (!useCredits) {
        // Paying today (no credits). Fold operator's chosen payment method.
        body.payment_method = payMethod;
        body.payment_status = "paid";
        if (basePrice !== "") body.base_price = Number(basePrice);
      } else if (!hadCredit) {
        // Settling from credits AT CHECKOUT (Case C on the backend). The server
        // will consume credits + flag payment_method="credits" itself. Send
        // base_price if admin entered one so income is tracked correctly even
        // though it's a credit redemption.
        if (basePrice !== "") body.base_price = Number(basePrice);
      } else if (extraNightsCharge > 0) {
        // Owner is keeping main-stay credits, but the extra nights still need to be billed
        body.payment_method = payMethod;
        body.payment_status = "paid";
        if (basePrice !== "") body.base_price = Number(basePrice);
      } else {
        // Pre-deducted credits, no extra charges — still pass base_price if
        // admin overrode it so the income line reflects the day's value.
        if (basePrice !== "") body.base_price = Number(basePrice);
      }
      await api.post(`/bookings/${booking.id}/check-out`, body);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.detail || "Check-out failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="checkout-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-sign-out-alt text-shBlue mr-2"/>Check Out · {booking.dog_name}
          </h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
        </div>
        <p className="text-[14px] text-gray-400 mb-4">{booking.client_name} · {booking.service_type}</p>

        {/* Section 1 — How to pay the base service */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Base service</p>
          {hadCredit ? (
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${useCredits ? "border-shGreen bg-shGreen/10" : "border-bgHover hover:border-shGreen/50"}`} data-testid="opt-use-credits">
                <input type="radio" checked={useCredits} onChange={()=>setUseCredits(true)} className="mt-1 accent-shGreen" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Use {creditsDeducted || 1} {creditPool} credit{(creditsDeducted || 1) === 1 ? "" : "s"}</p>
                  <p className="text-[14px] text-gray-400">${creditAmt.toFixed(2)} value · already deducted from their pack at approval</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${!useCredits ? "border-shBlue bg-shBlue/10" : "border-bgHover hover:border-shBlue/50"}`} data-testid="opt-charge">
                <input type="radio" checked={!useCredits} onChange={()=>setUseCredits(false)} className="mt-1 accent-shBlue" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Charge as regular service</p>
                  <p className="text-[14px] text-gray-400">Refund {creditsDeducted || 1} credit{(creditsDeducted || 1) === 1 ? "" : "s"} back to their pack & take payment today</p>
                </div>
              </label>
            </div>
          ) : canPayWithCredits ? (
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${useCredits ? "border-shGreen bg-shGreen/10" : "border-bgHover hover:border-shGreen/50"}`} data-testid="opt-credit-at-checkout">
                <input type="radio" checked={useCredits} onChange={()=>setUseCredits(true)} className="mt-1 accent-shGreen" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Deduct {nightsNeeded} {booking.service_type} credit{nightsNeeded === 1 ? "" : "s"} now</p>
                  <p className="text-[14px] text-gray-400">Client has <span className="text-shGreen font-black">{available}</span> available · FIFO from oldest pack</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${!useCredits ? "border-shBlue bg-shBlue/10" : "border-bgHover hover:border-shBlue/50"}`} data-testid="opt-no-credit-at-checkout">
                <input type="radio" checked={!useCredits} onChange={()=>setUseCredits(false)} className="mt-1 accent-shBlue" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Charge as regular service</p>
                  <p className="text-[14px] text-gray-400">Collect payment today. Credits stay untouched.</p>
                </div>
              </label>
            </div>
          ) : (
            <p className="text-[15px] text-gray-300">
              No credits on file for this booking — collecting payment today.
              {clientBal && available > 0 && available < nightsNeeded && (
                <span className="block mt-1 text-[14px] text-shOrange">
                  Client has {available} {booking.service_type} credit{available === 1 ? "" : "s"} but {nightsNeeded} {nightsNeeded === 1 ? "is" : "are"} needed.
                </span>
              )}
            </p>
          )}
        </div>

        {/* Section 1b — Boarding stay extension (extra nights) */}
        {isBoarding && (
          <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase" data-testid="checkout-extra-nights-panel">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black"><i className="fas fa-moon text-shBlue mr-1.5"/>Stayed Extra Nights?</p>
              {booking.end_date && <span className="text-[12px] text-gray-500">Original end: {booking.end_date}</span>}
            </div>
            <div className="flex items-center gap-2 mb-3">
              <button type="button" onClick={()=>setExtraNights(Math.max(0, Number(extraNights)-1))} data-testid="extra-nights-minus"
                      className="bg-bgPanel w-9 h-9 rounded text-white font-black hover:bg-red-500/30">−</button>
              <input type="number" min="0" max="60" value={extraNights} onChange={(e)=>setExtraNights(Math.max(0, parseInt(e.target.value)||0))} data-testid="extra-nights-input"
                     className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm text-center font-black"/>
              <button type="button" onClick={()=>setExtraNights(Number(extraNights)+1)} data-testid="extra-nights-plus"
                      className="bg-bgPanel w-9 h-9 rounded text-white font-black hover:bg-shGreen/30">+</button>
              <span className="text-[14px] text-gray-400 ml-2">extra night{extraNights === 1 ? "" : "s"}</span>
            </div>
            {extraNights > 0 && (
              <div className="space-y-3 animate-slide-in">
                <label className="flex items-center gap-2 text-[15px] text-gray-300">
                  <input type="checkbox" checked={extraUseCredits} onChange={(e)=>setExtraUseCredits(e.target.checked)} data-testid="extra-nights-use-credits"/>
                  Use remaining boarding credits first (any leftover gets billed)
                </label>
                {!extraUseCredits && (
                  <div>
                    <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Per-night rate <span className="text-gray-600">(blank = settings default)</span></label>
                    <input type="number" step="0.01" value={extraRate} onChange={(e)=>setExtraRate(e.target.value)} data-testid="extra-nights-rate"
                           placeholder={boardingRate ? `$${Number(boardingRate).toFixed(2)}` : "$0.00"}
                           className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
                  </div>
                )}
                <div className="text-[14px] bg-bgPanel rounded p-2 text-gray-300">
                  <i className="fas fa-circle-info text-shBlue mr-1"/>
                  {extraUseCredits
                    ? `Will draw up to ${extraNights} credit${extraNights===1?"":"s"} from boarding pack; any uncovered nights will be billed at $${extraRateEffective.toFixed(2)}/night.`
                    : `Charging ${extraNights} × $${extraRateEffective.toFixed(2)} = $${(extraNights * extraRateEffective).toFixed(2)} for the extension.`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Section 2 — Add-ons */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Add-on services <span className="text-gray-600">(bath, nail trim, etc.)</span></p>
          {addOnCandidates.length === 0 ? (
            <p className="text-[14px] text-gray-500 italic">No add-on services configured. Add some in Settings → Services & Prices.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {addOnCandidates.map(svc => {
                const inCart = cart[svc.id]?.qty || 0;
                return (
                  <button key={svc.id} onClick={()=>addOne(svc)} data-testid={`addon-${svc.id}`}
                          className={`text-left flex items-center justify-between gap-2 p-2.5 rounded border transition ${inCart > 0 ? "border-purple-400 bg-purple-400/10" : "border-bgHover hover:border-purple-400/60"}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-black text-white truncate"><i className={`fas ${svc.icon || 'fa-tag'} mr-1.5 text-purple-400`}/>{svc.name}</p>
                      <p className="text-[13px] text-gray-400 font-bold">${Number(svc.base_price || 0).toFixed(2)}</p>
                    </div>
                    {inCart > 0 && (
                      <div className="flex items-center gap-1 shrink-0" onClick={(e)=>e.stopPropagation()}>
                        <button onClick={()=>removeOne(svc)} data-testid={`addon-minus-${svc.id}`} className="bg-bgHover w-6 h-6 rounded text-white font-black hover:bg-red-500/40">−</button>
                        <span className="text-white font-black w-5 text-center text-sm">{inCart}</span>
                        <span className="text-purple-400 text-[13px] font-black">+</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 3 — Payment method + Service value */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Payment</p>
          {/* Payment method only shown when NOT fully covered by credits */}
          {(!useCredits || addOnTotal > 0) && (
            <select value={payMethod} onChange={(e)=>setPayMethod(e.target.value)} data-testid="checkout-pay-method"
                    className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mb-3">
              <option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Transfer</option><option value="check">Check</option><option value="other">Other</option>
            </select>
          )}
          {/* Service value — ALWAYS shown so income is tracked even when paying with credits */}
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">
              {useCredits ? "Service value (for income tracking)" : "Base price"}
              <span className="text-gray-600"> (blank = use service default)</span>
            </label>
            <input type="number" step="0.01" value={basePrice} onChange={(e)=>setBasePrice(e.target.value)} data-testid="checkout-base-price"
                   placeholder={basePreview ? `$${basePreview.toFixed(2)}` : "$0.00"}
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
            {useCredits && (
              <p className="text-[13px] text-gray-500 mt-1.5 normal-case">
                <i className="fas fa-circle-info text-shGreen mr-1"/>
                Credit is still consumed from the client's pack. This dollar amount is recorded as today's income so the daily/weekly totals stay accurate.
              </p>
            )}
          </div>
        </div>

        {/* Total summary */}
        <div className="mb-4 border-t-2 border-shGreen pt-3 flex items-end justify-between">
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Base · ${basePreview.toFixed(2)}</p>
            {addOnTotal > 0 && <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Add-ons · ${addOnTotal.toFixed(2)}</p>}
            {useCredits && hadCredit && <p className="text-[12px] uppercase tracking-widest text-shGreen font-black">−${creditAmt.toFixed(2)} via credits</p>}
          </div>
          <div className="text-right">
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">{useCredits && hadCredit && addOnTotal === 0 ? "Total" : "Charged today"}</p>
            <p className="text-shGreen text-3xl font-black" data-testid="checkout-total">${chargedToday.toFixed(2)}</p>
          </div>
        </div>

        {err && <p className="text-red-400 text-[15px] mb-3">{err}</p>}

        <div className="flex items-center justify-between gap-3">
          <button onClick={() => onRequestCancel?.(booking)} disabled={busy} data-testid="checkout-cancel-booking"
                  className="text-red-400 font-black uppercase text-[14px] tracking-widest hover:text-red-300 disabled:opacity-50">
            <i className="fas fa-times-circle mr-1"/>Cancel booking instead
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Close</button>
            <button onClick={submit} disabled={busy} data-testid="confirm-checkout"
                    className="bg-shBlue text-white px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Checking out…" : "Complete Check-out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function CancelBookingModal({ booking, onClose }) {
  const credits = Number(booking.credits_deducted || 0);
  const pool = booking.credit_service_type || booking.service_type;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const confirm = async () => {
    setBusy(true); setErr("");
    try { await api.delete(`/bookings/${booking.id}`); onClose(); }
    catch (e) {
      setErr(e.response?.data?.detail || "Cancel failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60]" data-testid="cancel-modal">
      <div className="bg-bgPanel border border-red-500/40 rounded-2xl w-full max-w-md p-7 shadow-2xl animate-slide-in">
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-red-500/20 text-red-400 w-12 h-12 rounded-full flex items-center justify-center text-xl">
            <i className="fas fa-times"/>
          </div>
          <div>
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">Cancel booking?</h4>
            <p className="text-[14px] text-gray-400">{booking.dog_name} · {booking.client_name}</p>
          </div>
        </div>

        <p className="text-[14px] text-gray-300 leading-relaxed mb-4">
          This will remove the booking from today's list. Use it if the dog was checked in by mistake or the client changed their mind.
        </p>

        {credits > 0 ? (
          <div className="bg-shGreen/10 border border-shGreen/40 rounded p-3 mb-4 flex items-center gap-2">
            <i className="fas fa-coins text-shGreen text-lg"/>
            <p className="text-[15px] text-white">
              <span className="text-shGreen font-black">{credits} {pool} credit{credits === 1 ? "" : "s"}</span> will be refunded to <strong>{booking.client_name}</strong>.
            </p>
          </div>
        ) : (
          <div className="bg-bgBase border border-bgHover rounded p-3 mb-4 text-[15px] text-gray-400">
            <i className="fas fa-info-circle mr-1.5"/>No credits to refund on this booking.
          </div>
        )}

        {err && <p className="text-red-400 text-[15px] mb-3">{err}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} data-testid="cancel-keep" className="text-gray-400 font-black uppercase text-[14px] tracking-widest hover:text-white disabled:opacity-50">
            Keep it
          </button>
          <button onClick={confirm} disabled={busy} data-testid="cancel-confirm"
                  className="bg-red-500 text-white px-7 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg hover:bg-red-600 disabled:opacity-50">
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>
        </div>
      </div>
    </div>
  );
}
