import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import AdminBookingModal from "../components/AdminBookingModal";
import ReportCardModal from "../components/ReportCardModal";
import { CheckoutModal, CancelBookingModal } from "../components/CheckoutModal";
import TodaysBrainTile from "../components/TodaysBrainTile";
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
  const [moodTags, setMoodTags] = useState(DEFAULT_MOOD_TAGS);
  const [reportFor, setReportFor] = useState(null); // booking
  const [checkoutFor, setCheckoutFor] = useState(null); // booking — opens checkout modal
  const [cancelFor, setCancelFor] = useState(null); // booking — opens cancel-confirm modal
  const [services, setServices] = useState([]);
  const [showQuick, setShowQuick] = useState(false);
  const [programs, setPrograms] = useState(null);
  const [pendingVax, setPendingVax] = useState([]);
  const [vaxPhoto, setVaxPhoto] = useState(null); // {photo, dog_name, vaccine}
  const [todayPnl, setTodayPnl] = useState(null);
  const [pnlExpanded, setPnlExpanded] = useState(false);
  const [leaderboard, setLeaderboard] = useState({ top_dogs: [], top_clients: [] });
  const [quoteRequests, setQuoteRequests] = useState([]);
  const confirm = useConfirm();

  const load = async () => {
    try {
      const [s, st, pg, sv, vx, lb, qr, pnl] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/settings"),
        api.get("/programs/active-summary").catch(()=>({data:null})),
        api.get("/services").catch(()=>({data:[]})),
        api.get("/admin/vaccine-cert-uploads").catch(()=>({data:[]})),
        api.get("/trophies/leaderboard").catch(()=>({data:{top_dogs:[],top_clients:[]}})),
        api.get("/admin/quote-requests?status=open").catch(()=>({data:[]})),
        api.get("/admin/today-pnl").catch(()=>({data:null})),
      ]);
      setStats(s.data);
      if (Array.isArray(st.data?.mood_tags) && st.data.mood_tags.length) setMoodTags(st.data.mood_tags);
      setPrograms(pg.data);
      setServices(sv.data || []);
      setPendingVax(Array.isArray(vx.data) ? vx.data : []);
      setLeaderboard(lb.data || { top_dogs: [], top_clients: [] });
      setQuoteRequests(Array.isArray(qr.data) ? qr.data : []);
      setTodayPnl(pnl.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const captureGeo = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
    );
  });
  const checkIn = async (id) => { try { const geo = await captureGeo(); await api.post(`/bookings/${id}/check-in`, geo); load(); } catch {} };

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

  // Auto-refresh today's P&L every 30s so check-ins / clock-ins reflect live
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await api.get("/admin/today-pnl");
        setTodayPnl(r.data);
      } catch { /* silent */ }
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const refreshPnl = async () => {
    try {
      const r = await api.get("/admin/today-pnl");
      setTodayPnl(r.data);
    } catch { /* silent */ }
  };

  if (!stats) return <div className="text-gray-400 text-sm">Loading dashboard…</div>;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="admin-dashboard">
      <RefreshSpinner pulling={pulling} progress={progress} />

      {/* Sprint 110u — landing-page-style hero header. Brand glow backdrop,
          uppercase italic title, eyebrow tag, snapshot stat tiles. Replaces
          the bare H2 the page used to open with. */}
      <div className="relative overflow-hidden rounded-2xl border border-bgHover bg-gradient-to-br from-bgPanel via-bgBase to-bgPanel p-5 sm:p-7" data-testid="dashboard-hero">
        <div className="absolute inset-0 pointer-events-none opacity-40"
             style={{ background: "radial-gradient(circle at 15% 20%, rgba(0,169,224,0.45) 0%, transparent 40%), radial-gradient(circle at 85% 80%, rgba(140,198,63,0.4) 0%, transparent 45%), radial-gradient(circle at 70% 10%, rgba(242,101,34,0.25) 0%, transparent 35%)" }}/>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-2">
              <i className="fas fa-paw mr-2"/>Today at Sit Happens
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase italic tracking-tight text-white leading-tight">
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"},
              <span className="text-shGreen"> let's get to it.</span>
            </h1>
            <p className="text-[14px] text-gray-300 mt-2">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          {stats && (
            <div className="flex flex-wrap gap-2 shrink-0" data-testid="dashboard-hero-tiles">
              <DashHeroTile icon="fa-sun"           color="#00a9e0" label="Daycare today" value={`${stats?.daycare_occupancy ?? 0}/${stats?.daycare_capacity ?? 0}`}/>
              <DashHeroTile icon="fa-moon"          color="#8cc63f" label="Boarding tonight" value={stats?.boarding_today ?? 0}/>
              <DashHeroTile icon="fa-graduation-cap" color="#a855f7" label="Training today" value={stats?.training_today ?? 0}/>
              <DashHeroTile icon="fa-bath"          color="#06b6d4" label="Grooming today" value={stats?.grooming_today ?? 0}/>
              <DashHeroTile icon="fa-camera-retro"  color="#f97316" label="Photography today" value={stats?.photography_today ?? 0}/>
            </div>
          )}
        </div>
      </div>

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

      <TodaysBrainTile onCTA={(it) => {
        const t = it.cta?.type;
        if (t === "open_dog" && it.cta.id) onJumpToDog(it.cta.id);
        else if (t === "open_client" && it.cta.id) onJumpToClient(it.cta.id);
        else if (t === "open_screen" && it.cta.screen) onNavigate(it.cta.screen);
        else if (t === "send_monday_digest") {
          api.post("/admin/homework/send-monday-digest")
            .then(() => alert("Monday digest fired — check your admin email."))
            .catch((e) => alert("Failed to send: " + (e.response?.data?.detail || e.message)));
        }
      }} />

      <div className="grid grid-cols-3 gap-3 md:gap-6">
        <StatCard label="Daycare Today" value={`${stats.daycare_occupancy} / ${stats.daycare_capacity}`} accent="border-t-shBlue" gradClass="card-info"    textColor="text-white" testId="stat-daycare" onClick={()=>onNavigate("schedule")} />
        <StatCard label="Boarding Today" value={stats.boarding_today}   accent="border-t-shGreen"  gradClass="card-hero"    textColor="text-shGreen" testId="stat-boarding" onClick={()=>onNavigate("schedule")} />
        <StatCard label="Total Dogs"    value={stats.total_dogs}      accent="border-t-bgHover"  gradClass=""             textColor="text-white" testId="stat-dogs" onClick={()=>onNavigate("dogs")} />
      </div>

      {todayPnl && <TodayPnlTile data={todayPnl} expanded={pnlExpanded} onToggle={()=>setPnlExpanded(e=>!e)} onNavStaff={()=>onNavigate("staff")} onRefresh={refreshPnl} />}


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
                    {(b.checked_in_by_name || b.checked_out_by_name) && (
                      <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest"
                         title={`In by ${b.checked_in_by_name||"—"}${b.checked_in_lat?` (${b.checked_in_lat.toFixed(4)},${b.checked_in_lng.toFixed(4)})`:""}${b.checked_out_by_name?`\nOut by ${b.checked_out_by_name}`:""}${b.checked_out_lat?` (${b.checked_out_lat.toFixed(4)},${b.checked_out_lng.toFixed(4)})`:""}`}>
                        <i className="fas fa-user-shield mr-1 text-shBlue"/>{b.checked_in_by_name || "—"}
                        {b.checked_in_lat && <i className="fas fa-location-dot ml-1 text-shGreen"/>}
                      </p>
                    )}
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


function TodayPnlTile({ data, expanded, onToggle, onNavStaff, onRefresh }) {
  const fmt = (n) => `${n < 0 ? "-" : ""}$${Math.abs(Number(n)||0).toFixed(2)}`;
  const isProfit = data.net >= 0;
  const accent = isProfit ? "text-shGreen border-shGreen/40" : "text-red-300 border-red-500/40";
  const bg = isProfit ? "bg-shGreen/5" : "bg-red-500/5";
  return (
    <div className={`rounded-xl border ${accent} ${bg} p-4`} data-testid="today-pnl-tile">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[12px] font-black uppercase tracking-widest text-gray-400">
            <i className={`fas ${isProfit ? "fa-arrow-trend-up text-shGreen" : "fa-arrow-trend-down text-red-400"} mr-2`}/>
            Today's P&amp;L · {data.date}
          </p>
          <p className={`text-3xl font-black ${isProfit ? "text-shGreen" : "text-red-300"} mt-1`} data-testid="pnl-net">{fmt(data.net)}</p>
          <p className="text-[13px] text-gray-400 mt-0.5">
            {fmt(data.revenue)} revenue − {fmt(data.labor_total || data.labor_cost)} labor
            {data.labor_burden ? <span className="text-gray-500"> ({fmt(data.labor_cost)} + {fmt(data.labor_burden)} taxes)</span> : null}
            {data.margin_pct != null && <span className="ml-2 font-black">({data.margin_pct}% margin)</span>}
          </p>
          {(data.retail_revenue > 0 || data.retail_count > 0) && (
            <p className="text-[12px] text-purple-300 font-black uppercase tracking-widest mt-1" data-testid="pnl-retail-chip">
              <i className="fas fa-bag-shopping mr-1"/>Retail {fmt(data.retail_revenue || 0)} ({data.retail_count || 0})
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="bg-bgBase/60 border border-bgHover rounded px-3 py-2 text-center min-w-[88px]">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Booked</p>
            <p className="text-base font-black text-white">{data.booked_count}</p>
          </div>
          <div className="bg-bgBase/60 border border-bgHover rounded px-3 py-2 text-center min-w-[88px]">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Hours</p>
            <p className="text-base font-black text-white">{data.labor_hours}</p>
          </div>
          {data.open_shifts > 0 && (
            <div className="bg-shGreen/15 border border-shGreen/40 rounded px-3 py-2 text-center min-w-[88px]" data-testid="pnl-open-shifts">
              <p className="text-[10px] font-black uppercase tracking-widest text-shGreen">Clocked in</p>
              <p className="text-base font-black text-shGreen">{data.open_shifts}</p>
            </div>
          )}
          <button onClick={onToggle} data-testid="pnl-toggle"
                  className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:underline px-2 py-1">
            <i className={`fas fa-chevron-${expanded ? "up" : "down"} mr-1`}/>{expanded ? "Less" : "Details"}
          </button>
          <button onClick={onRefresh} data-testid="pnl-refresh"
                  className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-white px-2 py-1"
                  title="Refresh (auto every 30s)">
            <i className="fas fa-rotate"/>
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-bgHover/60 pt-3" data-testid="pnl-details">
          {data.per_employee.length === 0 ? (
            <p className="text-[14px] text-gray-500">No staff clocked in today.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-1">Labor breakdown</p>
              {data.per_employee.map(e => (
                <div key={e.user_id} className="flex justify-between items-center gap-2 text-[14px]" data-testid={`pnl-emp-${e.user_id}`}>
                  <span className="text-gray-200 truncate">
                    {e.name}
                    {e.is_clocked_in && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-shGreen bg-shGreen/15 border border-shGreen/40 px-1.5 py-0.5 rounded">live</span>}
                  </span>
                  <span className="text-gray-400 shrink-0">{e.hours}h · ${e.cost.toFixed(2)} · ${e.hourly_rate.toFixed(2)}/hr</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={onNavStaff} className="mt-3 text-[12px] font-black uppercase tracking-widest text-shBlue hover:underline" data-testid="pnl-open-staff">
            Open Staff <i className="fas fa-arrow-right ml-1"/>
          </button>
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


function DashHeroTile({ icon, color, label, value }) {
  return (
    <div className="bg-bgBase/60 backdrop-blur border border-bgHover rounded-lg px-3 py-2 flex items-center gap-3 min-w-[150px]"
         data-testid={`dash-hero-tile-${label.replace(/\s+/g,'-').toLowerCase()}`}>
      <div className="w-9 h-9 rounded grid place-items-center shrink-0"
           style={{ backgroundColor: `${color}22`, color }}>
        <i className={`fas ${icon}`}/>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 leading-none">{label}</p>
        <p className="text-xl font-black text-white leading-tight mt-0.5">{value}</p>
      </div>
    </div>
  );
}



