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

  return (
    <div className="min-h-screen bg-bgBase flex flex-col" data-scroll-root data-testid="employee-portal">
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
          ["timecard", "Timecard", "fa-receipt"],
          ["profile", "Profile", "fa-user"],
        ].map(([k, label, icon]) => (
          <button key={k} onClick={()=>setTab(k)} data-testid={`emp-tab-${k}`}
                  className={`shrink-0 px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest transition ${tab===k ? "bg-shGreen text-bgHeader shadow" : "text-gray-400 hover:text-white"}`}>
            <i className={`fas ${icon} mr-1.5`}/>{label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-3 sm:p-5 pb-safe max-w-3xl w-full mx-auto">
        {tab === "clock" && <ClockTab />}
        {tab === "roster" && <RosterTab />}
        {tab === "timecard" && <TimecardTab />}
        {tab === "profile" && <ProfileTab user={user} />}
      </main>

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

  return (
    <div className="space-y-5" data-testid="clock-tab">
      <div className={`rounded-xl p-5 border ${open ? "bg-shGreen/10 border-shGreen/40" : "bg-bgPanel border-bgHover"}`} data-testid="clock-status">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-400 mb-2">
          {open ? <span className="text-shGreen">Currently clocked in</span> : "Not clocked in"}
        </p>
        {open ? (
          <>
            <p className="text-3xl font-black text-shGreen">{live.toFixed(2)} hr</p>
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
  const load = async () => {
    try { const r = await api.get("/employee/roster-today"); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

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
            <div className="border-t border-bgHover/60 pt-2 space-y-1 text-[13px]">
              {r.feeding_schedule?.map((f, i) => (
                <p key={`f${i}`} className="text-gray-300"><i className="fas fa-bowl-food text-shGreen mr-1"/>{f.time} · {f.amount} {f.food_type}{f.notes ? ` · ${f.notes}` : ""}</p>
              ))}
              {r.medications?.map((m, i) => (
                <p key={`m${i}`} className="text-gray-300"><i className="fas fa-pills text-shOrange mr-1"/>{m.name} · {m.dosage}{m.times ? ` · ${m.times}` : ""}{m.with_food ? " · w/ food" : ""}{m.notes ? ` · ${m.notes}` : ""}</p>
              ))}
            </div>
          )}
          {r.notes && <p className="text-[13px] text-gray-400 italic border-t border-bgHover/60 pt-2">"{r.notes}"</p>}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────── Timecard tab ───────────────────────
function TimecardTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => {
    try { const r = await api.get("/time-clock/me", { params: { days } }); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);

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

  return (
    <div className="space-y-4" data-testid="timecard-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">Last {days} days</p>
          <p className="text-3xl font-black text-shGreen">{data.total_hours} hr</p>
        </div>
        <select value={days} onChange={(e)=>setDays(Number(e.target.value))} data-testid="timecard-days"
                className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {Object.keys(grouped).length === 0 && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 text-sm">No entries in this window.</div>
      )}
      {Object.entries(grouped).map(([d, entries]) => {
        const dailyHours = entries.reduce((s,e)=> s + (Number(e.hours)||0), 0);
        return (
          <div key={d} className="bg-bgPanel border border-bgHover rounded-xl p-3" data-testid={`tc-day-${d}`}>
            <div className="flex justify-between items-center mb-2">
              <p className="text-[14px] font-black uppercase tracking-widest text-white">{d}</p>
              <p className="text-[14px] font-black text-shGreen">{dailyHours.toFixed(2)}h</p>
            </div>
            <div className="space-y-1">
              {entries.map(e => (
                <div key={e.id} className="bg-bgBase/60 rounded p-2 text-[13px] flex justify-between items-center gap-2">
                  <span className="text-gray-300">{fmtTime(e.clock_in_at)} → {e.clock_out_at ? fmtTime(e.clock_out_at) : <span className="text-shGreen">open</span>}</span>
                  <span className="font-black text-white">{e.hours ? `${e.hours.toFixed(2)}h` : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────── Profile tab ───────────────────────
function ProfileTab({ user }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const change = async () => {
    if (pw.length < 6) { setErr("Min 6 characters"); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      await api.post("/auth/change-password", { password: pw });
      setMsg("Password updated."); setPw("");
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
        <input type="password" value={pw} onChange={(e)=>setPw(e.target.value)} placeholder="New password (min 6)"
               data-testid="pw-input"
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        {msg && <p className="text-shGreen text-[14px] font-black uppercase tracking-widest">{msg}</p>}
        <button onClick={change} disabled={busy || !pw} data-testid="pw-save"
                className="w-full bg-shBlue text-white py-3 rounded font-black text-[14px] uppercase tracking-widest disabled:opacity-50">
          {busy ? "Saving…" : "Update Password"}
        </button>
      </div>
    </div>
  );
}
