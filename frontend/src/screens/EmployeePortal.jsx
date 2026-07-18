// Employee Portal — staff-only shell. Designed mobile-first because most
// staff will use this on a tablet/phone at the front desk.
//
// Five sections:
//   1. Clock In/Out (default landing) — big primary button + geolocation
//   2. Today's Roster — read-only dogs on-site with feeding/meds/emergency phones
//   3. My Timecard — last 30 days of entries with hour totals
//   4. Profile — view own info, change password
//
// Sensitive admin data (income, P&L, settings, billing) is NOT reachable.
import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import BrandFooter from "../components/BrandFooter";
import ReportCardModal from "../components/ReportCardModal";
import { CheckoutModal, CancelBookingModal } from "../components/CheckoutModal";
import { todayISO } from "../lib/date";
import { useConfirm } from "../lib/useConfirm";

function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}
function hoursSinceISO(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null, accuracy_m: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
      }),
      () => resolve({ lat: null, lng: null, accuracy_m: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}

export default function EmployeePortal() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("clock");
  const [incidentOpen, setIncidentOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bgBase flex flex-col pb-safe" data-scroll-root data-testid="employee-portal">
      <header className="bg-bgPanel border-b border-bgHover p-3 sm:p-4 flex items-center justify-between gap-2 sticky top-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.png" alt="Sit Happens" className="w-10 h-10 sm:w-12 sm:h-12 object-contain shrink-0" />
          <div className="min-w-0">
            <p className="text-[12px] sm:text-[13px] font-black uppercase tracking-widest text-shGreen">Staff Portal</p>
            <p className="text-white font-black truncate" data-testid="emp-name">{user.name || user.email}</p>
          </div>
        </div>
        <button onClick={logout} data-testid="emp-logout"
                className="bg-bgBase border border-bgHover text-gray-300 px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:border-red-400 hover:text-red-300 shrink-0">
          <i className="fas fa-right-from-bracket mr-1"/><span className="hidden sm:inline">Logout</span>
        </button>
      </header>

      <nav className="bg-bgPanel border-b border-bgHover px-2 py-2 flex gap-1 overflow-x-auto sticky top-[64px] sm:top-[72px] z-20" data-testid="emp-nav">
        {[
          ["clock", "Clock", "fa-clock"],
          ["roster", "Roster", "fa-paw"],
          ["tasks", "My Tasks", "fa-list-check"],
          ["schedule", "Schedule", "fa-calendar-week"],
          ["timecard", "Timecard", "fa-receipt"],
          ["timeoff", "Time Off", "fa-umbrella-beach"],
          ["trivia", "Trivia", "fa-brain"],
          ["profile", "Profile", "fa-user"],
        ].map(([k, label, icon]) => (
          <button key={k} onClick={()=>setTab(k)} data-testid={`emp-tab-${k}`}
                  className={`shrink-0 px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest transition ${tab===k ? "bg-shGreen text-bgHeader shadow" : "text-gray-400 hover:text-white"}`}>
            <i className={`fas ${icon} mr-1.5`}/>{label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-3 sm:p-5 pb-28 sm:pb-8 max-w-3xl w-full mx-auto">
        {tab === "clock" && <ClockTab />}
        {tab === "roster" && <RosterTab />}
        {tab === "tasks" && <MyTasksTab />}
        {tab === "schedule" && <MyScheduleTab />}
        {tab === "timecard" && <TimecardTab />}
        {tab === "timeoff" && <TimeOffTab />}
        {tab === "trivia" && <TriviaTab />}
        {tab === "profile" && <ProfileTab user={user} />}
      </main>

      {/* Sprint 110cn — Always-visible "Log Incident" FAB. Critical for the
          floor: bite, escape attempt, injury, etc. — staff can fire one off
          in 10 seconds from any tab. Tab order intentionally puts it after
          the main content so screen readers reach it last. */}
      <button
        type="button"
        onClick={() => setIncidentOpen(true)}
        data-testid="emp-incident-fab"
        className="employee-incident-fab fixed bottom-5 right-5 z-40 bg-red-600 hover:bg-red-500 text-white rounded-full shadow-2xl shadow-red-900/40 px-5 py-4 font-black uppercase tracking-widest text-[13px] flex items-center gap-2 transition-transform active:scale-95"
        title="Log an incident — bite, injury, escape, etc."
      >
        <i className="fas fa-triangle-exclamation"/>
        <span className="hidden sm:inline">Log Incident</span>
      </button>
      {incidentOpen && <IncidentLogModal onClose={() => setIncidentOpen(false)} />}

      <BrandFooter />
    </div>
  );
}

// ─────────────────────── Clock tab ───────────────────────
function ClockTab() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [breakMin, setBreakMin] = useState(0);

  const load = async () => {
    try { const r = await api.get("/employee/me"); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const clockIn = async () => {
    setBusy(true); setErr("");
    try {
      const geo = await getGeo();
      await api.post("/time-clock/clock-in", { ...geo, note });
      setNote("");
      await load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const clockOut = async () => {
    setBusy(true); setErr("");
    try {
      const geo = await getGeo();
      await api.post("/time-clock/clock-out", { ...geo, note, break_minutes: breakMin });
      setNote(""); setBreakMin(0);
      await load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (!data) return <p className="text-gray-500 text-sm">Loading…</p>;
  const open = data.open_entry;
  const live = open ? hoursSinceISO(open.clock_in_at) : 0;
  // Sprint 110ba — running pay during open shift (hourly rate from /employee/me)
  const rate = Number(data?.user?.hourly_rate || 0);
  const liveGross = open && rate > 0 ? (live * rate) : 0;

  return (
    <div className="space-y-5" data-testid="clock-tab">
      <div className={`rounded-xl p-5 border ${open ? "bg-shGreen/10 border-shGreen/40" : "bg-bgPanel border-bgHover"}`} data-testid="clock-status">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-400 mb-2">
          {open ? <span className="text-shGreen">Currently clocked in</span> : "Not clocked in"}
        </p>
        {open ? (
          <>
            <p className="text-3xl font-black text-shGreen">{live.toFixed(2)} hr</p>
            {rate > 0 && (
              <p className="text-[14px] text-gray-300 mt-1" data-testid="clock-live-pay">
                <i className="fas fa-dollar-sign text-shGreen mr-1"/>Earned today: <span className="font-black text-white">${liveGross.toFixed(2)}</span>
                <span className="text-gray-500 ml-2 text-[12px] uppercase tracking-widest">@ ${rate.toFixed(2)}/hr</span>
              </p>
            )}
            <p className="text-[14px] text-gray-300 mt-1">Started at <span className="font-black text-white">{fmtTime(open.clock_in_at)}</span></p>
            {open.clock_in_lat != null && (
              <p className="text-[12px] text-gray-500 mt-1">
                <i className="fas fa-location-dot mr-1"/>
                {open.clock_in_lat.toFixed(5)}, {open.clock_in_lng.toFixed(5)}
                {open.clock_in_accuracy_m ? ` · ±${Math.round(open.clock_in_accuracy_m)}m` : ""}
              </p>
            )}
            {open.clock_in_note && <p className="text-[13px] text-gray-300 mt-1 italic">"{open.clock_in_note}"</p>}
          </>
        ) : (
          <p className="text-gray-300 text-sm">Tap "Clock In" below to start your shift. Today's total: <span className="font-black text-white">{data.today_hours}h</span></p>
        )}
      </div>

      <div className="bg-bgPanel border border-bgHover rounded-xl p-5 space-y-3">
        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Note (optional)</span>
          <input value={note} onChange={(e)=>setNote(e.target.value)} maxLength={200}
                 placeholder="e.g. covering for Bobby"
                 data-testid="clock-note-input"
                 className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        </label>
        {open && (
          <label className="block">
            <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Break taken (minutes)</span>
            <input type="number" min="0" max="240" value={breakMin}
                   onChange={(e)=>setBreakMin(Math.max(0, Number(e.target.value)||0))}
                   data-testid="clock-break-input"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
        )}
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        {open ? (
          <button onClick={clockOut} disabled={busy} data-testid="clock-out-btn"
                  className="w-full bg-red-500 text-white py-4 rounded-lg text-base font-black uppercase tracking-widest shadow-lg hover:bg-red-600 disabled:opacity-50">
            <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-power-off"} mr-2`}/>Clock Out
          </button>
        ) : (
          <button onClick={clockIn} disabled={busy} data-testid="clock-in-btn"
                  className="w-full bg-shGreen text-bgHeader py-4 rounded-lg text-base font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90 disabled:opacity-50">
            <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-play"} mr-2`}/>Clock In
          </button>
        )}
        <p className="text-[12px] text-gray-500">Your location is recorded with each clock action for management visibility.</p>
      </div>

      {data.today_entries?.length > 0 && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="today-entries">
          <p className="text-[13px] font-black uppercase tracking-widest text-gray-500 mb-2">Today's entries</p>
          <div className="space-y-2">
            {data.today_entries.map(e => (
              <div key={e.id} className="bg-bgBase/60 rounded p-2 text-sm flex justify-between gap-2">
                <span className="text-gray-300">{fmtTime(e.clock_in_at)} → {fmtTime(e.clock_out_at) || "open"}</span>
                <span className="font-black text-white">{e.hours ? `${e.hours.toFixed(2)}h` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────── Roster tab ───────────────────────
function RosterTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [reportFor, setReportFor] = useState(null);
  const [services, setServices] = useState([]);
  const [checkoutFor, setCheckoutFor] = useState(null); // full booking row
  const [cancelFor, setCancelFor] = useState(null);
  const confirm = useConfirm();
  const load = async () => {
    try { const r = await api.get("/employee/roster-today"); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);
  // Services drive the add-on chips + default base prices in the checkout modal.
  useEffect(() => {
    api.get("/services").then(r => setServices(r.data || [])).catch(() => setServices([]));
  }, []);

  const checkIn = async (bid, row, vaccineAck = false) => {
    setBusyId(bid); setErr("");
    try {
      const geo = await getGeo();
      await api.post(`/bookings/${bid}/check-in`, { ...geo, vaccine_ack: vaccineAck });
      await load();
    }
    catch (e) {
      // The server checks every vaccine the business requires (not just
      // rabies) at the actual moment of check-in and asks staff to
      // explicitly confirm before proceeding on a warning.
      const detail = e.response?.data?.detail;
      if (detail?.code === "vaccine_warning") {
        const ok = await confirm({
          title: `Vaccine warning · ${detail.dog_name || row?.dog_name || "this dog"}`,
          body: `${detail.message} Do not check in unless you have a verbal/written OK from the owner. Continue?`,
          confirmText: "Check in anyway",
          destructive: true,
        });
        if (ok) { setBusyId(null); await checkIn(bid, row, true); return; }
      } else {
        setErr(formatErr(detail));
      }
    }
    finally { setBusyId(null); }
  };
  // Open the same checkout modal admins use — credits, add-ons, payment method,
  // boarding extension, price override. Fetches the full booking record first
  // so we have credit_value / credit_service_type / end_date for the modal.
  const openCheckout = async (bid) => {
    setBusyId(bid); setErr("");
    try {
      const r = await api.get(`/bookings/${bid}`);
      setCheckoutFor(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusyId(null); }
  };

  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!data) return <p className="text-gray-500 text-sm">Loading…</p>;
  const { roster, date } = data;

  return (
    <div className="space-y-3" data-testid="roster-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black uppercase italic tracking-tight">Today · {date}</h3>
        <button onClick={load} className="text-shBlue text-[13px] font-black uppercase tracking-widest" data-testid="roster-refresh">
          <i className="fas fa-rotate mr-1"/>Refresh
        </button>
      </div>
      {roster.length === 0 && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-8 text-center text-gray-500 text-sm">
          <i className="fas fa-paw text-2xl block mb-2 opacity-40"/>
          No dogs scheduled today.
        </div>
      )}
      {roster.map(r => (
        <div key={r.booking_id} className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-2" data-testid={`roster-row-${r.booking_id}`}>
          {/* Sprint 110cn — vaccine guard banner + birthday banner */}
          <VaccineGuard vaccines={r.vaccines} dogName={r.dog_name} />
          {r.is_birthday && (
            <div className="flex items-center gap-2 bg-shOrange/15 border border-shOrange/40 rounded-lg px-3 py-2 text-shOrange text-[13px] font-black uppercase tracking-widest" data-testid={`birthday-${r.booking_id}`}>
              <i className="fas fa-cake-candles"/>It's {r.dog_name}'s birthday today! 🎉
            </div>
          )}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-base font-black text-white uppercase">{r.dog_name} <span className="text-gray-500 normal-case text-[14px] font-normal">· {r.breed || "—"}</span></p>
              <p className="text-[13px] text-gray-400 font-black uppercase tracking-widest">
                {r.service_type}
                {r.kennel ? ` · ${r.kennel}` : ""}
                {r.dropoff_time ? ` · drop ${r.dropoff_time}` : ""}
                {r.pickup_time ? ` · pick ${r.pickup_time}` : ""}
              </p>
            </div>
            <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded ${r.checked_in_at && !r.checked_out_at ? "bg-shGreen/15 text-shGreen" : r.checked_out_at ? "bg-shBlue/15 text-shBlue" : "bg-gray-500/15 text-gray-400"}`}>
              {r.checked_out_at ? "Out" : r.checked_in_at ? "On-site" : "Not in"}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[14px]">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Owner</p>
              <p className="text-gray-200">{r.client_name || "—"}</p>
              {r.client_phone && (
                <a href={`tel:${r.client_phone}`} className="text-shBlue font-black" data-testid={`call-owner-${r.booking_id}`}>
                  <i className="fas fa-phone mr-1"/>{r.client_phone}
                </a>
              )}
              {r.client_emergency && <p className="text-[12px] text-shOrange mt-0.5"><i className="fas fa-bell mr-1"/>Emerg: {r.client_emergency}</p>}
            </div>
            <div>
              {(r.vet_name || r.vet_phone) && (
                <>
                  <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Vet</p>
                  <p className="text-gray-200">{r.vet_name || "—"}</p>
                  {r.vet_phone && <a href={`tel:${r.vet_phone}`} className="text-shBlue font-black"><i className="fas fa-phone mr-1"/>{r.vet_phone}</a>}
                </>
              )}
            </div>
          </div>
          {(r.feeding_schedule?.length > 0 || r.medications?.length > 0) && (
            <div className="border-t border-bgHover/60 pt-2 space-y-1.5 text-[13px]">
              {r.feeding_schedule?.map((f, i) => (
                <CarePoint key={`f${i}`} kind="feeding" booking_id={r.booking_id} index={i}
                           icon="fa-bowl-food" iconColor="text-shGreen"
                           label={`${f.time} · ${f.amount} ${f.food_type}${f.notes ? ` · ${f.notes}` : ""}`}
                           confirmed={(r.feeding_log || []).some(x => x.index === i)}
                           onLogged={load}/>
              ))}
              {r.medications?.map((m, i) => (
                <CarePoint key={`m${i}`} kind="medication" booking_id={r.booking_id} index={i}
                           icon="fa-pills" iconColor="text-shOrange"
                           label={`${m.name} · ${m.dosage}${m.times ? ` · ${m.times}` : ""}${m.with_food ? " · w/ food" : ""}${m.notes ? ` · ${m.notes}` : ""}`}
                           confirmed={(r.medication_log || []).some(x => x.index === i)}
                           onLogged={load}/>
              ))}
            </div>
          )}
          {/* Sprint 110cn — Bathroom counter (critical for boarding). */}
          {r.checked_in_at && !r.checked_out_at && (
            <BathroomCounter booking_id={r.booking_id} log={r.bathroom_log || {pee:0,poop:0}} onChange={load} />
          )}
          {r.notes && <p className="text-[13px] text-gray-400 italic border-t border-bgHover/60 pt-2">"{r.notes}"</p>}
          <div className="border-t border-bgHover/60 pt-2 flex gap-2 flex-wrap" data-testid={`roster-actions-${r.booking_id}`}>
            {!r.checked_in_at && (
              <button onClick={()=>checkIn(r.booking_id, r)} disabled={busyId === r.booking_id}
                      data-testid={`emp-checkin-${r.booking_id}`}
                      className="flex-1 min-w-[140px] bg-shGreen text-bgHeader py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shGreen/90 disabled:opacity-50">
                <i className={`fas ${busyId === r.booking_id ? "fa-spinner fa-spin" : "fa-arrow-right-to-bracket"} mr-1`}/>Check In
              </button>
            )}
            {r.checked_in_at && !r.checked_out_at && (
              <button onClick={()=>openCheckout(r.booking_id)} disabled={busyId === r.booking_id}
                      data-testid={`emp-checkout-${r.booking_id}`}
                      className="flex-1 min-w-[140px] bg-shBlue text-white py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
                <i className={`fas ${busyId === r.booking_id ? "fa-spinner fa-spin" : "fa-arrow-right-from-bracket"} mr-1`}/>Check Out
              </button>
            )}
            <button onClick={async()=>{
                      // Always fetch fresh booking so the modal sees the latest report_card
                      try { const fr = await api.get(`/bookings/${r.booking_id}`); setReportFor(fr.data); }
                      catch { setReportFor({ id: r.booking_id, dog_name: r.dog_name, client_name: r.client_name, date: data?.date }); }
                    }}
                    data-testid={`emp-report-${r.booking_id}`}
                    className={`min-w-[140px] py-2 px-3 rounded font-black text-[13px] uppercase tracking-widest border ${r.checked_out_at ? "bg-shGreen text-bgHeader border-shGreen hover:bg-shGreen/90" : "bg-bgBase border-bgHover text-shGreen hover:border-shGreen"}`}>
              <i className="fas fa-clipboard mr-1"/>{r.checked_out_at ? "Add Report" : "Notes"}
            </button>
            {r.checked_out_at && (
              <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest self-center">
                <i className="fas fa-check-circle text-shGreen mr-1"/>Out at {fmtTime(r.checked_out_at)}
              </p>
            )}
          </div>
        </div>
      ))}
      {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest" data-testid="roster-err">{err}</p>}
      {reportFor && <ReportCardModal booking={reportFor} onClose={()=>{ setReportFor(null); load(); }} />}
      {checkoutFor && <CheckoutModal booking={checkoutFor} services={services}
                                     onRequestCancel={(b)=>{ setCheckoutFor(null); setCancelFor(b); }}
                                     onClose={()=>{ setCheckoutFor(null); load(); }} />}
      {cancelFor && <CancelBookingModal booking={cancelFor} onClose={()=>{ setCancelFor(null); load(); }} />}
    </div>
  );
}

// ─────────────────────── Timecard tab ───────────────────────
function TimecardTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  // Sprint 110cn — punch-correction request (forgot to clock out, etc.).
  // null = closed, {entry: ...} = pre-filled from a specific row,
  // {date: ""} = blank "I forgot entirely" form.
  const [correctionFor, setCorrectionFor] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const load = async () => {
    try { const r = await api.get("/time-clock/me", { params: { days } }); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);
  // Sprint 110ba — tick the running-pay clock every 30s if currently clocked in
  useEffect(() => {
    if (!data?.live) return;
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
    // eslint-disable-next-line
  }, [data?.live?.entry_id]);

  const grouped = useMemo(() => {
    if (!data) return {};
    const g = {};
    for (const e of data.entries) {
      const d = (e.clock_in_at || "").split("T")[0];
      (g[d] = g[d] || []).push(e);
    }
    return g;
  }, [data]);

  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!data) return <p className="text-gray-500 text-sm">Loading…</p>;

  const rate = Number(data.hourly_rate || 0);
  const fmt$ = (v) => `$${Number(v || 0).toFixed(2)}`;
  const downloadCsv = async () => {
    try {
      // Sprint 110di-46 — same-origin safe fallback + correct token key
      // ("sh_token" matches what the rest of the app uses).
      const token = localStorage.getItem("sh_token") || "";
      const API_ROOT = process.env.REACT_APP_BACKEND_URL || "";
      const url = `${API_ROOT}/api/time-clock/me.csv?days=${days}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `my-timecard-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(obj), 5000);
    } catch { /* no-op: surfaced via the resulting blank download */ }
  };

  return (
    <div className="space-y-4" data-testid="timecard-tab">
      {/* Live-pay tile while clocked in */}
      {data.live && (
        <div className="bg-shGreen/10 border border-shGreen/40 rounded-xl p-4" data-testid="timecard-live">
          <p className="text-[11px] font-black uppercase tracking-widest text-shGreen mb-1"><i className="fas fa-bolt mr-1"/>Earning right now</p>
          <div className="flex items-baseline gap-3">
            <p className="text-3xl font-black text-shGreen">{fmt$(data.live.gross_so_far)}</p>
            <p className="text-[14px] text-gray-300 font-black uppercase tracking-widest">{data.live.hours_so_far}h so far</p>
          </div>
          {rate > 0 && <p className="text-[12px] text-gray-500 mt-1">@ {fmt$(rate)}/hr · updates every 30s</p>}
        </div>
      )}

      {/* Pay summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="timecard-summary">
        <SummaryTile label="This week" subtitle={`${data.this_week.start} → ${data.this_week.end}`} hours={data.this_week.hours} gross={data.this_week.gross} testId="tc-this-week"/>
        <SummaryTile label="Last week" subtitle={`${data.last_week.start} → ${data.last_week.end}`} hours={data.last_week.hours} gross={data.last_week.gross} testId="tc-last-week"/>
        <SummaryTile label={`Last ${days} days`} subtitle="window total" hours={data.total_hours} gross={data.total_gross} testId="tc-window"/>
        <SummaryTile label="Year-to-date" subtitle={`${data.ytd?.year || ""}`} hours={data.ytd?.hours || 0} gross={data.ytd?.gross || 0} testId="tc-ytd"/>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {rate > 0 ? (
            <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest"><i className="fas fa-dollar-sign mr-1"/>Hourly rate · {fmt$(rate)}</p>
          ) : (
            <p className="text-[12px] text-shOrange font-black uppercase tracking-widest"><i className="fas fa-info-circle mr-1"/>No hourly rate set — ask admin</p>
          )}
        </div>
        <div className="flex gap-2">
          <select value={days} onChange={(e)=>setDays(Number(e.target.value))} data-testid="timecard-days"
                  className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={downloadCsv} data-testid="timecard-csv"
                  className="bg-shBlue text-bgHeader px-3 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow">
            <i className="fas fa-download mr-1"/>CSV
          </button>
        </div>
      </div>
      {Object.keys(grouped).length === 0 && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 text-sm">No entries in this window.</div>
      )}
      <PayHistoryPanel/>
      {Object.entries(grouped).map(([d, entries]) => {
        const dailyHours = entries.reduce((s,e)=> s + (Number(e.hours)||0), 0);
        const dailyGross = entries.reduce((s,e)=> s + (Number(e.gross)||0), 0);
        return (
          <div key={d} className="bg-bgPanel border border-bgHover rounded-xl p-3" data-testid={`tc-day-${d}`}>
            <div className="flex justify-between items-center mb-2">
              <p className="text-[14px] font-black uppercase tracking-widest text-white">{d}</p>
              <p className="text-[14px] font-black">
                <span className="text-shGreen">{dailyHours.toFixed(2)}h</span>
                {rate > 0 && <span className="text-gray-400 normal-case ml-2">· {fmt$(dailyGross)}</span>}
              </p>
            </div>
            <div className="space-y-1">
              {entries.map(e => (
                <div key={e.id} className="bg-bgBase/60 rounded p-2 text-[13px] flex justify-between items-center gap-2" data-testid={`tc-entry-${e.id}`}>
                  <span className="text-gray-300">{fmtTime(e.clock_in_at)} → {e.clock_out_at ? fmtTime(e.clock_out_at) : <span className="text-shGreen">open</span>}</span>
                  <span className="font-black text-right flex items-center gap-2">
                    <span className="text-white">{e.hours ? `${e.hours.toFixed(2)}h` : "—"}</span>
                    {rate > 0 && e.gross > 0 && <span className="text-gray-400 normal-case ml-2">{fmt$(e.gross)}</span>}
                    {/* Sprint 110cn — fix-it button for this entry. */}
                    <button onClick={()=>setCorrectionFor({ entry: e })}
                            data-testid={`tc-fix-${e.id}`}
                            title="Request correction for this punch"
                            className="text-gray-500 hover:text-shOrange ml-1 px-1.5 py-0.5 rounded text-[11px]">
                      <i className="fas fa-pen-to-square"/>
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {/* Sprint 110cn — "I forgot to clock in/out" button + my-corrections history */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button onClick={()=>setCorrectionFor({ date: "" })} data-testid="tc-request-correction"
                className="bg-shOrange/10 border border-shOrange/40 text-shOrange px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shOrange/20">
          <i className="fas fa-clock-rotate-left mr-1"/>Request correction
        </button>
        <button onClick={()=>setShowHistory(v=>!v)} data-testid="tc-toggle-history"
                className="text-gray-400 hover:text-white text-[12px] font-black uppercase tracking-widest">
          {showHistory ? "Hide" : "Show"} my corrections
        </button>
      </div>
      {showHistory && <PunchCorrectionHistory />}
      {correctionFor && <PunchCorrectionModal seed={correctionFor} onClose={()=>{ setCorrectionFor(null); load(); }} />}
    </div>
  );
}

function SummaryTile({ label, subtitle, hours, gross, testId }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-3" data-testid={testId}>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="text-2xl font-black text-white">${Number(gross || 0).toFixed(2)}</p>
      <p className="text-[12px] text-shGreen font-black uppercase tracking-widest">{Number(hours || 0).toFixed(2)}h</p>
      {subtitle && <p className="text-[10px] text-gray-600 truncate mt-1">{subtitle}</p>}
    </div>
  );
}

// ─────────────────────── Profile tab ───────────────────────
function ProfileTab({ user }) {
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const change = async () => {
    if (pw.next.length < 8) { setErr("Use at least 8 characters"); return; }
    if (pw.next !== pw.confirm) { setErr("New passwords do not match"); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const { data } = await api.post("/auth/change-password", {
        current_password: pw.current,
        new_password: pw.next,
      });
      if (data?.token) localStorage.setItem("sh_token", data.token);
      setMsg("Password updated."); setPw({ current: "", next: "", confirm: "" });
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="profile-tab">
      <div className="bg-bgPanel border border-bgHover rounded-xl p-5 space-y-2">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">Profile</p>
        <p className="text-base text-white"><span className="text-gray-500">Name:</span> {user.name}</p>
        <p className="text-base text-white"><span className="text-gray-500">Email:</span> {user.email}</p>
        <p className="text-base text-white"><span className="text-gray-500">Role:</span> Employee</p>
      </div>
      <div className="bg-bgPanel border border-bgHover rounded-xl p-5 space-y-3">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">Change password</p>
        <input type="password" value={pw.current} onChange={(e)=>setPw({...pw,current:e.target.value})} placeholder="Current password"
               autoComplete="current-password" data-testid="pw-current"
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        <input type="password" value={pw.next} onChange={(e)=>setPw({...pw,next:e.target.value})} placeholder="New password (min 8)"
               autoComplete="new-password" data-testid="pw-input"
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        <input type="password" value={pw.confirm} onChange={(e)=>setPw({...pw,confirm:e.target.value})} placeholder="Confirm new password"
               autoComplete="new-password" data-testid="pw-confirm"
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        {msg && <p className="text-shGreen text-[14px] font-black uppercase tracking-widest">{msg}</p>}
        <button onClick={change} disabled={busy || !pw.current || !pw.next || !pw.confirm} data-testid="pw-save"
                className="w-full bg-shBlue text-white py-3 rounded font-black text-[14px] uppercase tracking-widest disabled:opacity-50">
          {busy ? "Saving…" : "Update Password"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────── My Tasks tab ───────────────────────
function MyTasksTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { const r = await api.get("/employee/my-tasks"); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);
  const claim = async (id) => {
    setBusy(true);
    try { await api.post(`/tasks/${id}/claim`); await load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const complete = async (id) => {
    setBusy(true);
    try { await api.post(`/tasks/${id}/complete`); await load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!data) return <p className="text-gray-500 text-sm">Loading…</p>;

  return (
    <div className="space-y-5" data-testid="my-tasks-tab">
      <Section title="Assigned to me" testid="mine-list">
        {data.tasks.length === 0 && <p className="text-gray-500 text-sm">Nothing assigned yet.</p>}
        {data.tasks.map(t => (
          <div key={t.id} className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid={`mine-task-${t.id}`}>
            <p className="font-black text-white">{t.title}</p>
            {t.description && <p className="text-[13px] text-gray-400 mt-1">{t.description}</p>}
            <button onClick={()=>complete(t.id)} disabled={busy} data-testid={`complete-${t.id}`}
                    className="mt-2 bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest">
              <i className="fas fa-check mr-1"/>Mark done
            </button>
          </div>
        ))}
      </Section>
      <Section title="Today's bookings on me" testid="my-bookings">
        {data.today_bookings.length === 0 && <p className="text-gray-500 text-sm">No bookings assigned today.</p>}
        {data.today_bookings.map(b => (
          <div key={b.id} className="bg-bgPanel border border-bgHover rounded-xl p-3" data-testid={`my-booking-${b.id}`}>
            <p className="font-black text-white">{b.dog_name} <span className="text-gray-500 text-[14px] font-normal">· {b.service_type}</span></p>
            <p className="text-[13px] text-gray-400">{b.dropoff_time ? `drop ${b.dropoff_time}` : ""}{b.pickup_time ? ` · pick ${b.pickup_time}` : ""}</p>
          </div>
        ))}
      </Section>
      {data.vaccine_reviews.length > 0 && (
        <Section title="Vaccine reviews on me" testid="my-vax">
          {data.vaccine_reviews.map((v, i) => (
            <div key={i} className="bg-bgPanel border border-bgHover rounded-xl p-3">
              <p className="font-black text-white">{v.dog_name} · {v.vaccine}</p>
              <p className="text-[12px] text-gray-500">Uploaded {fmtDateTime(v.uploaded_at)}</p>
            </div>
          ))}
        </Section>
      )}
      <Section title="Unassigned · claim if you can take it" testid="unassigned-list">
        {data.unassigned_tasks.length === 0 && <p className="text-gray-500 text-sm">Nothing to claim.</p>}
        {data.unassigned_tasks.map(t => (
          <div key={t.id} className="bg-bgPanel border border-shGreen/30 rounded-xl p-4" data-testid={`claimable-${t.id}`}>
            <p className="font-black text-white">{t.title}</p>
            {t.description && <p className="text-[13px] text-gray-400 mt-1">{t.description}</p>}
            <button onClick={()=>claim(t.id)} disabled={busy} data-testid={`claim-${t.id}`}
                    className="mt-2 bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest">
              <i className="fas fa-hand mr-1"/>Claim
            </button>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, testid, children }) {
  return (
    <div data-testid={testid}>
      <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-2">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─────────────────────── My Schedule tab ───────────────────────
function MyScheduleTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try { const r = await api.get("/employee/my-shifts"); setData(r.data); }
      catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    })();
  }, []);
  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!data) return <p className="text-gray-500 text-sm">Loading…</p>;
  const grouped = {};
  for (const s of data.shifts) (grouped[s.date] = grouped[s.date] || []).push(s);

  return (
    <div className="space-y-3" data-testid="my-schedule-tab">
      <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">Next 14 days</p>
      {data.shifts.length === 0 && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 text-sm">No upcoming shifts.</div>
      )}
      {Object.entries(grouped).map(([d, list]) => (
        <div key={d} className="bg-bgPanel border border-bgHover rounded-xl p-3" data-testid={`my-sched-${d}`}>
          <p className="text-[13px] font-black uppercase tracking-widest text-white mb-1">{d}</p>
          {list.map(s => (
            <div key={s.id} className="bg-bgBase/60 rounded p-2 text-sm flex justify-between items-center gap-2">
              <span className="text-gray-200">{s.start_time}–{s.end_time}{s.role ? ` · ${s.role}` : ""}</span>
              {s.source === "template" && <i className="fas fa-repeat text-shGreen text-[11px]" title="From weekly template"/>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}


// ─────────────────────── Pay History (weekly trend) ───────────────────────
function PayHistoryPanel() {
  const [weeks, setWeeks] = useState(12);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try { const r = await api.get("/employee/pay-history", { params: { weeks } }); setData(r.data); }
      catch {}
    })();
  }, [weeks, open]);

  const maxGross = Math.max(1, ...(data?.weeks || []).map(w => w.gross));

  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-3" data-testid="pay-history">
      <button onClick={()=>setOpen(o=>!o)}
              data-testid="pay-history-toggle"
              className="w-full flex justify-between items-center text-left">
        <p className="text-[13px] font-black uppercase tracking-widest text-white">
          <i className="fas fa-chart-line text-shBlue mr-2"/>Pay history trend
        </p>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-gray-400`}/>
      </button>
      {open && (
        <div className="mt-3 space-y-3" data-testid="pay-history-content">
          <div className="flex flex-wrap items-center gap-2">
            <select value={weeks} onChange={e=>setWeeks(Number(e.target.value))}
                    data-testid="pay-history-weeks"
                    className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm">
              <option value={4}>Last 4 weeks</option>
              <option value={8}>Last 8 weeks</option>
              <option value={12}>Last 12 weeks</option>
              <option value={26}>Last 26 weeks</option>
              <option value={52}>Last 52 weeks</option>
            </select>
            {data && (
              <p className="text-[12px] text-gray-400 ml-auto" data-testid="pay-history-total">
                Total: <span className="text-shGreen font-black">${data.total_gross.toFixed(2)}</span>
                {" "}· <span className="text-white">{data.total_hours.toFixed(1)}h</span>
                {data.best_week && data.best_week.gross > 0 && (
                  <span className="text-gray-500 normal-case ml-2">Best: ${data.best_week.gross.toFixed(2)} ({data.best_week.week_start})</span>
                )}
              </p>
            )}
          </div>
          {!data ? <p className="text-gray-500 text-sm">Loading…</p> : (
            <div className="space-y-1">
              {data.weeks.map(w => (
                <div key={w.week_start} className="flex items-center gap-3 text-[12px]" data-testid={`pay-week-${w.week_start}`}>
                  <span className="text-gray-400 w-24 shrink-0">{w.week_start}</span>
                  <div className="flex-1 bg-bgBase rounded h-5 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-shGreen/60 rounded"
                         style={{ width: `${(w.gross / maxGross) * 100}%` }}/>
                  </div>
                  <span className="text-shGreen font-black w-20 text-right">${w.gross.toFixed(2)}</span>
                  <span className="text-gray-500 w-14 text-right">{w.hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── Time Off tab ───────────────────────
function TimeOffTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setErr("");
    try { const r = await api.get("/employee/time-off"); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const cancel = async (id) => {
    try { await api.delete(`/employee/time-off/${id}`); await load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  if (!data) return <p className="text-gray-500 text-sm">Loading…</p>;
  const statusColor = { pending: "shBlue", approved: "shGreen", rejected: "red-400", cancelled: "gray-500" };

  return (
    <div className="space-y-3" data-testid="timeoff-tab">
      <div className="flex justify-between items-center">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">My requests</p>
        <button onClick={()=>setShowForm(true)} data-testid="timeoff-new-btn"
                className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
          <i className="fas fa-plus mr-1"/>Request time off
        </button>
      </div>

      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px]">{err}</div>}

      {data.requests.length === 0 && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 text-sm">No requests yet — tap "Request time off" to submit one.</div>
      )}

      {data.requests.map(r => (
        <div key={r.id} className="bg-bgPanel border border-bgHover rounded-xl p-3" data-testid={`timeoff-mine-${r.id}`}>
          <div className="flex justify-between items-start gap-2">
            <div>
              <p className="text-white font-black">{r.start_date} → {r.end_date}</p>
              <p className="text-[12px] text-gray-400 capitalize">{r.request_type}{r.reason ? ` · "${r.reason}"` : ""}</p>
              {r.admin_notes && <p className="text-[12px] text-shOrange mt-1">Admin: {r.admin_notes}</p>}
            </div>
            <div className="text-right shrink-0">
              <span className={`text-[11px] font-black uppercase tracking-widest text-${statusColor[r.status] || "gray-400"}`}>{r.status}</span>
              <p className="text-[10px] text-gray-500 mt-0.5">{(r.created_at||"").slice(0,10)}</p>
            </div>
          </div>
          {r.status === "pending" && (
            <button onClick={()=>cancel(r.id)} data-testid={`timeoff-cancel-${r.id}`}
                    className="mt-2 text-[11px] text-gray-400 hover:text-red-400 font-black uppercase tracking-widest">
              <i className="fas fa-xmark mr-1"/>Cancel request
            </button>
          )}
        </div>
      ))}

      {showForm && (
        <TimeOffFormModal onClose={()=>setShowForm(false)}
                          onSaved={()=>{ setShowForm(false); load(); }}/>
      )}
    </div>
  );
}

function TimeOffFormModal({ onClose, onSaved }) {
  const today = todayISO();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [type, setType] = useState("vacation");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (startDate > endDate) { setErr("Start date must be on or before end date"); return; }
    setSaving(true);
    try {
      await api.post("/employee/time-off", {
        start_date: startDate, end_date: endDate, request_type: type, reason,
      });
      onSaved();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" data-testid="timeoff-form-modal" onClick={onClose}>
      <div className="bg-bgPanel border border-shGreen/40 rounded-xl p-5 max-w-md w-full space-y-3" onClick={e=>e.stopPropagation()}>
        <h3 className="text-white font-black uppercase italic text-lg"><i className="fas fa-umbrella-beach text-shGreen mr-2"/>Request time off</h3>
        {err && <div className="text-red-400 bg-red-500/10 rounded p-2 text-[13px]">{err}</div>}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Start</span>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
                   style={{colorScheme:"dark"}} data-testid="timeoff-start"
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
          </label>
          <label className="block">
            <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">End</span>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}
                   style={{colorScheme:"dark"}} data-testid="timeoff-end"
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
          </label>
        </div>
        <label className="block">
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Type</span>
          <select value={type} onChange={e=>setType(e.target.value)} data-testid="timeoff-type"
                  style={{colorScheme:"dark"}}
                  className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
            {["vacation","sick","personal","unpaid","other"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Reason (optional)</span>
          <textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} rows={3}
                    data-testid="timeoff-reason"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} data-testid="timeoff-cancel"
                  className="bg-bgBase border border-bgHover px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300 hover:border-red-400">
            Cancel
          </button>
          <button onClick={save} disabled={saving} data-testid="timeoff-submit"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
            {saving ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}




// ───────────────────────── Sprint 110cn — Roster helpers ─────────────────────────

/** Shows a red banner if rabies is expired/missing, an orange one if any vaccine
 *  expires within 14 days. Other vaccines just warn — only rabies blocks
 *  check-in (handled in RosterTab.checkIn). */
function VaccineGuard({ vaccines, dogName: _dogName }) {
  const today = new Date().toISOString().slice(0, 10);
  const v = vaccines || {};
  const days = (d) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  const expired = [];
  const expiring = [];
  for (const name of ["rabies", "dhpp", "bordetella"]) {
    const d = v[name];
    if (!d) { expired.push({ name, label: `${name} missing` }); continue; }
    if (d < today) expired.push({ name, label: `${name} expired ${d}` });
    else if (days(d) <= 14) expiring.push({ name, label: `${name} expires ${d} (${days(d)}d)` });
  }
  if (expired.length === 0 && expiring.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="vaccine-guard">
      {expired.length > 0 && (
        <div className="flex items-center gap-2 bg-red-600/15 border border-red-500/50 rounded-lg px-3 py-2 text-red-300 text-[12px] font-black uppercase tracking-widest">
          <i className="fas fa-triangle-exclamation"/>{expired.map(x => x.label).join(" · ")}
        </div>
      )}
      {expiring.length > 0 && (
        <div className="flex items-center gap-2 bg-shOrange/15 border border-shOrange/40 rounded-lg px-3 py-2 text-shOrange text-[12px] font-black uppercase tracking-widest">
          <i className="fas fa-clock"/>{expiring.map(x => x.label).join(" · ")}
        </div>
      )}
    </div>
  );
}

/** A single feeding or medication row with a tap-to-confirm checkmark.
 *  Becomes solid green once confirmed (shows ✓). Optional photo can be
 *  attached at confirm-time for medications (liability proof). */
function CarePoint({ kind, booking_id, index, icon, iconColor, label, confirmed, onLogged }) {
  const [busy, setBusy] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const confirm = async (withPhoto = false) => {
    if (busy || confirmed) return;
    if (withPhoto) {
      // open hidden input
      document.getElementById(`carepoint-photo-${kind}-${booking_id}-${index}`).click();
      return;
    }
    setBusy(true);
    try {
      await api.post(`/employee/bookings/${booking_id}/log-${kind}`, { index });
      onLogged();
    } catch {}
    finally { setBusy(false); }
  };
  const onPhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const { compressImage } = await import("../lib/imageCompress");
      const data = await compressImage(f, { maxSize: 1200, quality: 0.7 });
      await api.post(`/employee/bookings/${booking_id}/log-${kind}`, { index, photo: data });
      onLogged();
      setShowPhoto(false);
    } catch {}
    finally { setBusy(false); e.target.value = ""; }
  };
  return (
    <div className={`flex items-start gap-2 px-2 py-1.5 rounded transition ${confirmed ? "bg-shGreen/10 border border-shGreen/30" : "bg-bgBase/40 border border-transparent hover:border-bgHover"}`}
         data-testid={`carepoint-${kind}-${booking_id}-${index}`}>
      <button type="button" onClick={()=>confirm(false)} disabled={busy || confirmed}
              data-testid={`carepoint-confirm-${kind}-${booking_id}-${index}`}
              title={confirmed ? "Already logged" : "Tap to confirm"}
              className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center border-2 ${confirmed ? "bg-shGreen border-shGreen text-bgHeader" : "border-bgHover text-gray-500 hover:border-shGreen hover:text-shGreen"} disabled:opacity-70`}>
        <i className={`fas ${busy ? "fa-spinner fa-spin" : confirmed ? "fa-check" : "fa-circle"} text-[12px]`}/>
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-gray-300 text-[13px]"><i className={`fas ${icon} ${iconColor} mr-1.5`}/>{label}</p>
      </div>
      {!confirmed && kind === "medication" && (
        <>
          <button type="button" onClick={()=>confirm(true)} data-testid={`carepoint-photo-btn-${kind}-${booking_id}-${index}`}
                  className="shrink-0 text-gray-500 hover:text-shBlue px-1.5 py-1 text-[12px]"
                  title="Confirm with photo proof">
            <i className="fas fa-camera"/>
          </button>
          <input id={`carepoint-photo-${kind}-${booking_id}-${index}`} type="file" accept="image/*" capture="environment"
                 onChange={onPhoto} className="hidden"/>
        </>
      )}
    </div>
  );
}

/** Bathroom counter — pee/poop tick buttons. Long-press to decrement (undo).
 *  Critical for boarding: clients constantly ask "did he go today?". */
function BathroomCounter({ booking_id, log, onChange }) {
  const [busy, setBusy] = useState(false);
  const tick = async (kind, delta) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/employee/bookings/${booking_id}/bathroom`, { kind, delta });
      onChange();
    } catch {}
    finally { setBusy(false); }
  };
  return (
    <div className="border-t border-bgHover/60 pt-2 flex items-center gap-2 text-[13px]" data-testid={`bathroom-${booking_id}`}>
      <span className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-toilet mr-1"/>Bathroom</span>
      <button onClick={()=>tick("pee", 1)} onContextMenu={(e)=>{e.preventDefault(); tick("pee", -1);}} disabled={busy}
              data-testid={`bathroom-pee-${booking_id}`}
              className="bg-shBlue/15 border border-shBlue/40 text-shBlue px-2 py-1 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shBlue/25 disabled:opacity-50">
        💧 Pee · {log.pee || 0}
      </button>
      <button onClick={()=>tick("poop", 1)} onContextMenu={(e)=>{e.preventDefault(); tick("poop", -1);}} disabled={busy}
              data-testid={`bathroom-poop-${booking_id}`}
              className="bg-shOrange/15 border border-shOrange/40 text-shOrange px-2 py-1 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shOrange/25 disabled:opacity-50">
        💩 Poop · {log.poop || 0}
      </button>
      <span className="text-[10px] text-gray-600 normal-case hidden sm:inline">long-press to undo</span>
    </div>
  );
}

// ───────────────────────── Sprint 110cn — Incident logger ─────────────────────────
function IncidentLogModal({ onClose }) {
  const [dogs, setDogs] = useState([]);
  const [filter, setFilter] = useState("");
  const [dogId, setDogId] = useState("");
  const [type, setType] = useState("behavior");
  const [severity, setSeverity] = useState("minor");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [vetRequired, setVetRequired] = useState(false);
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    // Pre-load today's roster — most incidents involve a dog who's on-site now.
    api.get("/employee/roster-today")
      .then(r => setDogs(r.data?.roster?.map(x => ({ id: x.dog_id, name: x.dog_name, breed: x.breed })) || []))
      .catch(() => {});
  }, []);
  const filtered = dogs.filter(d =>
    (d.name || "").toLowerCase().includes(filter.toLowerCase()),
  );
  const onPhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const { compressImage } = await import("../lib/imageCompress");
      setPhoto(await compressImage(f, { maxSize: 1400, quality: 0.7 }));
    } catch {}
  };
  const submit = async () => {
    setErr("");
    if (!dogId) { setErr("Pick a dog first"); return; }
    if (description.trim().length < 3) { setErr("Add a short description"); return; }
    setBusy(true);
    try {
      await api.post("/employee/incidents", {
        dog_id: dogId, type, severity, description,
        action_taken: actionTaken, photo, vet_required: vetRequired,
      });
      setMsg("Incident logged — admin notified.");
      setTimeout(onClose, 1100);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail));
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-2" data-testid="incident-modal">
      <div className="bg-bgPanel w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-red-500/30 max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto">
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-4 py-3 flex justify-between items-center">
          <p className="font-black text-white uppercase tracking-widest"><i className="fas fa-triangle-exclamation text-red-400 mr-2"/>Log Incident</p>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="fas fa-xmark"/></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-400">Dog</label>
            <input value={filter} onChange={(e)=>setFilter(e.target.value)} placeholder="Filter today's dogs…"
                   data-testid="incident-dog-filter"
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
            <div className="max-h-40 overflow-y-auto mt-2 space-y-1">
              {filtered.length === 0 && <p className="text-[12px] text-gray-500">No matching on-site dogs.</p>}
              {filtered.map(d => (
                <button key={d.id} onClick={()=>setDogId(d.id)} data-testid={`incident-dog-${d.id}`}
                        className={`w-full text-left px-3 py-2 rounded text-[14px] flex justify-between items-center ${dogId === d.id ? "bg-red-600/20 border border-red-500/50 text-white" : "bg-bgBase/60 hover:bg-bgBase text-gray-300 border border-transparent"}`}>
                  <span>{d.name} <span className="text-gray-500">· {d.breed || "—"}</span></span>
                  {dogId === d.id && <i className="fas fa-check text-red-400"/>}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Type</span>
              <select value={type} onChange={(e)=>setType(e.target.value)} data-testid="incident-type"
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
                <option value="bite">Bite</option>
                <option value="injury">Injury</option>
                <option value="escape">Escape</option>
                <option value="illness">Illness (vomit/diarrhea/etc.)</option>
                <option value="property_damage">Property damage</option>
                <option value="behavior">Behavior issue</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Severity</span>
              <select value={severity} onChange={(e)=>setSeverity(e.target.value)} data-testid="incident-severity"
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">What happened?</span>
            <textarea value={description} onChange={(e)=>setDescription(e.target.value)} rows={3}
                      data-testid="incident-description"
                      placeholder="Brief, factual. Time, what triggered it, what dog(s) involved."
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Action taken</span>
            <input value={actionTaken} onChange={(e)=>setActionTaken(e.target.value)}
                   data-testid="incident-action"
                   placeholder='e.g. "separated dogs, applied ice, called owner"'
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
          </label>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-[13px] text-gray-300">
              <input type="checkbox" checked={vetRequired} onChange={(e)=>setVetRequired(e.target.checked)} data-testid="incident-vet"/>
              Vet needed
            </label>
            <label className="flex items-center gap-2 bg-bgBase border border-bgHover rounded px-3 py-1.5 text-[12px] text-gray-300 cursor-pointer hover:border-shBlue">
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" data-testid="incident-photo"/>
              <i className="fas fa-camera"/>{photo ? "Photo attached ✓" : "Add photo"}
            </label>
          </div>
          {err && <p className="text-red-400 text-[12px] font-black uppercase tracking-widest" data-testid="incident-err">{err}</p>}
          {msg && <p className="text-shGreen text-[12px] font-black uppercase tracking-widest" data-testid="incident-msg">{msg}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="bg-bgBase border border-bgHover px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300">Cancel</button>
            <button onClick={submit} disabled={busy || !!msg} data-testid="incident-submit"
                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
              {busy ? "Logging…" : "Log Incident"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Sprint 110cn — Punch corrections ─────────────────────────
function PunchCorrectionModal({ seed, onClose }) {
  const entry = seed?.entry || null;
  const initialDate = entry ? (entry.clock_in_at || "").slice(0, 10) : (seed?.date || todayISO());
  const [date, setDate] = useState(initialDate);
  const [clockIn, setClockIn] = useState(entry ? toLocalDT(entry.clock_in_at) : "");
  const [clockOut, setClockOut] = useState(entry ? toLocalDT(entry.clock_out_at) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const submit = async () => {
    setErr("");
    if (reason.trim().length < 3) { setErr("Why? (e.g. 'forgot to clock out')"); return; }
    setBusy(true);
    try {
      await api.post("/employee/punch-corrections", {
        target_entry_id: entry?.id || "",
        target_date: date,
        requested_clock_in: clockIn ? new Date(clockIn).toISOString() : "",
        requested_clock_out: clockOut ? new Date(clockOut).toISOString() : "",
        reason,
      });
      setMsg("Sent to admin for approval.");
      setTimeout(onClose, 1100);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail));
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-2" data-testid="punch-correction-modal">
      <div className="bg-bgPanel w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-shOrange/30 max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto">
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-4 py-3 flex justify-between items-center">
          <p className="font-black text-white uppercase tracking-widest"><i className="fas fa-clock-rotate-left text-shOrange mr-2"/>Punch correction</p>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="fas fa-xmark"/></button>
        </div>
        <div className="p-4 space-y-3">
          {entry && (
            <div className="bg-bgBase/60 rounded p-2 text-[12px] text-gray-400">
              Editing: {fmtDateTime(entry.clock_in_at)} → {entry.clock_out_at ? fmtDateTime(entry.clock_out_at) : "still open"}
            </div>
          )}
          {!entry && (
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Date</span>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} data-testid="punch-date"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Clock in</span>
              <input type="datetime-local" value={clockIn} onChange={(e)=>setClockIn(e.target.value)} data-testid="punch-in"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
            </label>
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Clock out</span>
              <input type="datetime-local" value={clockOut} onChange={(e)=>setClockOut(e.target.value)} data-testid="punch-out"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Reason</span>
            <textarea value={reason} onChange={(e)=>setReason(e.target.value)} rows={2} data-testid="punch-reason"
                      placeholder="e.g. 'Forgot to clock out — left at 5:30pm'"
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
          </label>
          {err && <p className="text-red-400 text-[12px] font-black uppercase tracking-widest" data-testid="punch-err">{err}</p>}
          {msg && <p className="text-shGreen text-[12px] font-black uppercase tracking-widest" data-testid="punch-msg">{msg}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="bg-bgBase border border-bgHover px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300">Cancel</button>
            <button onClick={submit} disabled={busy || !!msg} data-testid="punch-submit"
                    className="bg-shOrange text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
              {busy ? "Sending…" : "Send to admin"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalDT(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

function PunchCorrectionHistory() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get("/employee/punch-corrections").then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, []);
  if (rows === null) return <p className="text-gray-500 text-sm mt-2">Loading…</p>;
  if (rows.length === 0) return <p className="text-gray-500 text-sm mt-2" data-testid="punch-history-empty">No correction requests yet.</p>;
  const tone = { pending: "text-shOrange bg-shOrange/15 border-shOrange/40",
                 approved: "text-shGreen bg-shGreen/15 border-shGreen/40",
                 denied: "text-red-300 bg-red-600/15 border-red-500/40" };
  return (
    <div className="space-y-2 mt-2" data-testid="punch-history">
      {rows.map(r => (
        <div key={r.id} className="bg-bgPanel border border-bgHover rounded p-3 space-y-1 text-[13px]" data-testid={`punch-row-${r.id}`}>
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <span className="text-white font-black uppercase tracking-widest text-[12px]">{r.target_date}</span>
            <span className={`px-2 py-0.5 rounded border text-[11px] font-black uppercase tracking-widest ${tone[r.status] || ""}`}>{r.status}</span>
          </div>
          {r.reason && <p className="text-gray-400 italic text-[12px]">"{r.reason}"</p>}
          {r.admin_note && <p className="text-[12px] text-gray-500">Admin: {r.admin_note}</p>}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Sprint 110cn — Staff Trivia ─────────────────────────
function TriviaTab() {
  const [questions, setQuestions] = useState(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [reveal, setReveal] = useState(null);   // {correct_index, correct, explanation}
  const [score, setScore] = useState({ right: 0, wrong: 0 });
  const [err, setErr] = useState("");
  const load = async () => {
    setErr(""); setQuestions(null); setIdx(0); setPicked(null); setReveal(null); setScore({ right: 0, wrong: 0 });
    try {
      const r = await api.get("/employee/trivia/quiz", { params: { count: 5 } });
      setQuestions(r.data?.questions || []);
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Couldn't load questions"); }
  };
  useEffect(() => { load(); }, []);
  const choose = async (i) => {
    if (picked !== null) return;
    setPicked(i);
    try {
      const q = questions[idx];
      const r = await api.post("/employee/trivia/answer", { question_id: q.id, chosen_index: i });
      setReveal(r.data);
      setScore(s => r.data.correct ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 });
    } catch { /* show nothing — staff can re-pick */ }
  };
  const next = () => {
    setPicked(null); setReveal(null);
    if (idx + 1 < questions.length) setIdx(idx + 1);
    else setQuestions([]); // trigger end state
  };
  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (questions === null) return <p className="text-gray-500 text-sm">Loading trivia…</p>;
  if (questions.length === 0 || idx >= questions.length) {
    return (
      <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center space-y-3" data-testid="trivia-done">
        <i className="fas fa-graduation-cap text-shGreen text-4xl"/>
        <p className="text-white font-black text-xl">All done!</p>
        {score.right + score.wrong > 0 && (
          <p className="text-gray-400 text-sm">You got {score.right} of {score.right + score.wrong} right — keep learning!</p>
        )}
        <button onClick={load} data-testid="trivia-again"
                className="bg-shGreen text-bgHeader px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest">
          <i className="fas fa-rotate mr-2"/>Play again
        </button>
      </div>
    );
  }
  const q = questions[idx];
  return (
    <div className="space-y-4" data-testid="trivia-tab">
      <div className="flex items-center justify-between text-[12px] font-black uppercase tracking-widest">
        <span className="text-gray-500">Question {idx + 1} / {questions.length}</span>
        <span className="text-gray-400">
          <span className="text-shGreen">{score.right} right</span> · <span className="text-red-400">{score.wrong} wrong</span>
        </span>
      </div>
      <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-shBlue bg-shBlue/15 border border-shBlue/40 px-2 py-0.5 rounded">{q.difficulty}</span>
          {q.tag && <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 bg-bgBase border border-bgHover px-2 py-0.5 rounded">{q.tag}</span>}
        </div>
        <p className="text-white text-lg font-black" data-testid="trivia-question">{q.question}</p>
        <div className="space-y-2">
          {q.choices.map((c, i) => {
            const isPicked = picked === i;
            const isCorrect = reveal?.correct_index === i;
            const tone = reveal
              ? isCorrect ? "bg-shGreen/20 border-shGreen text-white"
                : isPicked ? "bg-red-600/20 border-red-500 text-white"
                : "bg-bgBase border-bgHover text-gray-500"
              : isPicked ? "bg-shBlue/15 border-shBlue text-white"
                : "bg-bgBase border-bgHover text-gray-300 hover:border-shBlue";
            return (
              <button key={i} onClick={()=>choose(i)} disabled={picked !== null}
                      data-testid={`trivia-choice-${i}`}
                      className={`w-full text-left px-3 py-3 rounded border text-[14px] font-black uppercase tracking-widest transition disabled:cursor-default ${tone}`}>
                {String.fromCharCode(65 + i)}. {c}
                {reveal && isCorrect && <i className="fas fa-check ml-2 text-shGreen"/>}
                {reveal && isPicked && !isCorrect && <i className="fas fa-xmark ml-2 text-red-400"/>}
              </button>
            );
          })}
        </div>
        {reveal && reveal.explanation && (
          <div className="bg-shBlue/10 border border-shBlue/30 rounded p-3 text-[13px] text-gray-200" data-testid="trivia-explanation">
            <i className="fas fa-lightbulb text-shBlue mr-1"/>{reveal.explanation}
          </div>
        )}
        {picked !== null && (
          <div className="flex justify-end pt-1">
            <button onClick={next} data-testid="trivia-next"
                    className="bg-shGreen text-bgHeader px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest">
              {idx + 1 < questions.length ? "Next →" : "Finish"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
