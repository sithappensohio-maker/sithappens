/* Sprint 110cr — Two compact admin widgets that live side-by-side under the
   Dashboard hero:
     • OwnerClock — solo operator clock-in/out using the same time-clock
       backend staff uses. Geo capture optional. Shows live hours-today.
     • EndOfDayPanel — single-button "wrap up the day" review modal: who's
       still on-site, unpaid completed bookings, missing report cards,
       cash collected, care-log roll-up. Designed to take 30s. */
import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

// ───────────────────────── OwnerClock ─────────────────────────
export function OwnerClock() {
  const [state, setState] = useState({ open: null, today_hours: 0 });
  const [busy, setBusy] = useState(false);
  const [showOut, setShowOut] = useState(false);
  const load = async () => {
    try {
      const r = await api.get("/time-clock/current");
      setState(r.data || { open: null, today_hours: 0 });
    } catch { /* not signed in as someone with a clock — silently no-op */ }
  };
  useEffect(() => { load(); }, []);

  // Live tick so "currently open" hours update without a refresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!state.open) return;
    const i = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(i);
  }, [state.open]);
  const _ = tick; // referenced so eslint doesn't complain

  const getGeo = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }),
      () => resolve({}),
      { timeout: 4000, maximumAge: 60000 }
    );
  });

  const openHours = () => {
    if (!state.open) return 0;
    const ms = Date.now() - new Date(state.open.clock_in_at).getTime();
    return ms / 3600000;
  };

  const clockIn = async () => {
    setBusy(true);
    try {
      const geo = await getGeo();
      await api.post("/time-clock/clock-in", { ...geo, note: "Owner shift" });
      toast.success("Clocked in. Have a great day.");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't clock in"); }
    finally { setBusy(false); }
  };
  const clockOut = async () => {
    setBusy(true);
    try {
      const geo = await getGeo();
      await api.post("/time-clock/clock-out", geo);
      toast.success("Clocked out. See you tomorrow!");
      setShowOut(false);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't clock out"); }
    finally { setBusy(false); }
  };

  const open = state.open;
  const totalToday = (state.today_hours || 0) + (open ? openHours() : 0);

  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl px-4 py-3 flex items-center gap-3" data-testid="owner-clock">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${open ? "bg-shGreen/20 text-shGreen" : "bg-bgBase border border-bgHover text-gray-500"}`}>
        <i className={`fas ${open ? "fa-circle-check" : "fa-clock"}`}/>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">Owner clock</p>
        <p className="text-[14px] font-black text-white truncate">
          {open ? <>On the clock · <span className="text-shGreen">{openHours().toFixed(2)}h</span></> : <>Off the clock</>}
        </p>
        <p className="text-[11px] text-gray-500">{totalToday > 0 ? `${totalToday.toFixed(2)}h today` : "0.00h today"}</p>
      </div>
      {open ? (
        <button onClick={()=>setShowOut(true)} disabled={busy} data-testid="owner-clock-out"
                className="bg-red-600/20 border border-red-500 text-red-300 px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest hover:bg-red-600/30 disabled:opacity-50">
          <i className="fas fa-stop mr-1"/>Out
        </button>
      ) : (
        <button onClick={clockIn} disabled={busy} data-testid="owner-clock-in"
                className="bg-shGreen text-bgHeader px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
          <i className="fas fa-play mr-1"/>{busy ? "…" : "Clock in"}
        </button>
      )}
      {showOut && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3" onClick={()=>setShowOut(false)}>
          <div className="bg-bgPanel border border-bgHover rounded-xl p-5 max-w-sm w-full" onClick={(e)=>e.stopPropagation()}>
            <p className="text-white font-black uppercase tracking-widest mb-2">End your shift?</p>
            <p className="text-[13px] text-gray-400 mb-4">You'll log <span className="text-white font-black">{openHours().toFixed(2)}h</span> for this session.</p>
            <div className="flex justify-end gap-2">
              <button onClick={()=>setShowOut(false)} className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest">Cancel</button>
              <button onClick={clockOut} disabled={busy} data-testid="owner-clock-out-confirm"
                      className="bg-red-600 text-white px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                {busy ? "…" : "Clock out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── EndOfDayPanel ─────────────────────────
export function EndOfDayPanel({ onJump = () => {} }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [closeout, setCloseout] = useState({ notes: "", cash_counted: "", clover_batch: "", venmo_total: "", paypal_total: "", check_total: "" });
  const [closeoutReview, setCloseoutReview] = useState(false);
  const [startDay, setStartDay] = useState({ opening_cash: "", notes: "", opening_override_reason: "" });
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const loadStatus = async () => {
    try {
      const r = await api.get("/admin/end-of-day");
      setData(r.data);
      const suggested = r.data?.register?.opening_rollover?.suggested_cash;
      const opening = suggested ?? r.data?.register?.totals?.opening_cash;
      if (opening !== undefined && opening !== null && startDay.opening_cash === "") {
        setStartDay(s => ({ ...s, opening_cash: Number(opening || 0).toFixed(2) }));
      }
    } catch { /* dashboard card should not be noisy */ }
  };
  useEffect(() => { loadStatus(); }, []);
  const openPanel = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const r = await api.get("/admin/end-of-day");
      setData(r.data);
      const suggested = r.data?.register?.opening_rollover?.suggested_cash;
      const opening = suggested ?? r.data?.register?.totals?.opening_cash;
      if (opening !== undefined && opening !== null && startDay.opening_cash === "") {
        setStartDay(s => ({ ...s, opening_cash: Number(opening || 0).toFixed(2) }));
      }
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't load wrap-up"); }
    finally { setLoading(false); }
  };
  const close = () => { setOpen(false); loadStatus(); };
  const saveStartDay = async () => {
    setStarting(true);
    try {
      await api.post("/admin/register/open-drawer", {
        opening_cash: startDay.opening_cash === "" ? 0 : Number(startDay.opening_cash),
        notes: startDay.notes || "Start-day checklist completed",
        opening_override_reason: startDay.opening_override_reason || "",
      });
      toast.success("Day started");
      setStartDay(s => ({ ...s, opening_override_reason: "" }));
      await loadStatus();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't start day"); }
    finally { setStarting(false); }
  };


  const reviewCloseout = () => {
    if (closeout.cash_counted === "" || !Number.isFinite(Number(closeout.cash_counted)) || Number(closeout.cash_counted) < 0) {
      toast.error("Count the cash drawer before closing the day. Enter 0.00 if it is intentionally empty.");
      return;
    }
    setCloseoutReview(true);
  };

  const saveCloseout = async () => {
    setClosing(true);
    try {
      const counted = Number(closeout.cash_counted);
      const payload = {
        notes: closeout.notes || "",
        cash_counted: counted,
        rollover_confirmed: true,
        confirmed_rollover_cash: counted,
        clover_batch: closeout.clover_batch === "" ? null : Number(closeout.clover_batch),
        venmo_total: closeout.venmo_total === "" ? null : Number(closeout.venmo_total),
        paypal_total: closeout.paypal_total === "" ? null : Number(closeout.paypal_total),
        check_total: closeout.check_total === "" ? null : Number(closeout.check_total),
      };
      await api.post("/admin/end-of-day/closeout", payload);
      toast.success(`Day closed. $${counted.toFixed(2)} will carry forward.`);
      setCloseoutReview(false);
      setCloseout({ notes: "", cash_counted: "", clover_batch: "", venmo_total: "", paypal_total: "", check_total: "" });
      close();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Closeout failed"); }
    finally { setClosing(false); }
  };

  const reopenDay = async () => {
    if (reopenReason.trim().length < 3) {
      toast.error("Enter a reason for reopening the register.");
      return;
    }
    setReopening(true);
    try {
      const r = await api.post("/admin/register/reopen-day", { reason: reopenReason.trim() });
      setData(d => ({ ...d, register: r.data.register }));
      setReopenReason("");
      toast.success("Register reopened. Save a new closeout after making changes.");
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't reopen the register"); }
    finally { setReopening(false); }
  };


  const latestCloseout = data?.register?.latest_closeout;
  const dayStarted = Boolean(data?.register?.drawer_session);
  const hasBlockers = Boolean((data?.still_on_premises?.length || 0) || (data?.unpaid_bookings?.length || 0));
  const expectedCash = Number(data?.register?.totals?.expected_cash || 0);
  const countedCash = closeout.cash_counted === "" ? null : Number(closeout.cash_counted);
  const cashOverShort = countedCash === null || !Number.isFinite(countedCash) ? null : countedCash - expectedCash;
  const suggestedOpening = data?.register?.opening_rollover?.suggested_cash;
  const openingOverride = suggestedOpening != null && startDay.opening_cash !== "" && Math.abs(Number(startDay.opening_cash) - Number(suggestedOpening)) > 0.005;
  const card = latestCloseout
    ? { eyebrow: "Day complete", title: "Closeout saved", sub: "View today’s wrap-up", icon: "fa-circle-check", tone: "green" }
    : dayStarted
      ? { eyebrow: "Day started", title: hasBlockers ? "Finish the day" : "Ready to close", sub: "Boarding stayovers do not block", icon: "fa-sun", tone: "orange" }
      : { eyebrow: "Start day", title: "Open checklist", sub: "Set drawer + review today", icon: "fa-list-check", tone: "blue" };
  const iconTone = card.tone === "green"
    ? "bg-shGreen/20 text-shGreen group-hover:bg-shGreen"
    : card.tone === "blue"
      ? "bg-shBlue/20 text-shBlue group-hover:bg-shBlue"
      : "bg-shOrange/20 text-shOrange group-hover:bg-shOrange";

  return (
    <>
      <button onClick={openPanel} data-testid="end-of-day-btn"
              className={`bg-bgPanel border border-bgHover rounded-xl px-4 py-3 flex items-center gap-3 transition group text-left ${latestCloseout ? "hover:border-shGreen" : dayStarted ? "hover:border-shOrange" : "hover:border-shBlue"}`}>
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition group-hover:text-bgHeader ${iconTone}`}>
          <i className={`fas ${card.icon}`}/>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">{card.eyebrow}</p>
          <p className="text-[14px] font-black text-white">{card.title}</p>
          <p className="text-[11px] text-gray-500">{card.sub}</p>
        </div>
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-2" onClick={close} data-testid="end-of-day-modal">
          <div className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto" onClick={(e)=>e.stopPropagation()}>
            <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-3 flex justify-between items-center">
              <div>
                <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${latestCloseout ? "text-shGreen" : dayStarted ? "text-shOrange" : "text-shBlue"}`}><i className={`fas ${latestCloseout ? "fa-circle-check" : dayStarted ? "fa-moon" : "fa-list-check"} mr-1`}/>{latestCloseout ? "Day complete" : dayStarted ? "End of day" : "Start day"}</p>
                <h3 className="text-xl font-black text-white">{latestCloseout ? "Day Complete" : dayStarted ? "Wrap-up" : "Open Day"} · {data?.date || "today"}</h3>
              </div>
              <button onClick={close} className="text-gray-400 hover:text-white" data-testid="end-of-day-close"><i className="fas fa-xmark"/></button>
            </div>
            <div className="p-5 space-y-4">
              {loading && <p className="text-gray-500 text-sm">Loading…</p>}
              {data && (
                <>
                  {!data.register?.drawer_session && !data.register?.latest_closeout && (
                    <div className="bg-shBlue/10 border border-shBlue/40 rounded-xl p-4 space-y-3" data-testid="start-day-checklist">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-widest text-shBlue"><i className="fas fa-sun mr-1"/>Start-the-day checklist</p>
                        <p className="text-[13px] text-gray-400 mt-1">This does not block the app. It just opens the drawer and gives you a clean daily starting point.</p>
                      </div>
                      {suggestedOpening != null && (
                        <div className="bg-bgPanel/70 border border-shGreen/30 rounded-lg p-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-shGreen">Carried forward from {data.register?.opening_rollover?.from_date}</p>
                          <p className="text-xl text-white font-black mt-1">${Number(suggestedOpening).toFixed(2)}</p>
                          <p className="text-[11px] text-gray-500 mt-1">This is the actual cash count confirmed at the previous closeout.</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Opening cash drawer</span>
                          <input type="number" min="0" step="0.01" value={startDay.opening_cash} onChange={(e)=>setStartDay({...startDay, opening_cash: e.target.value})}
                                 className={`mt-1 w-full bg-bgPanel border rounded p-2 text-white text-sm ${openingOverride ? "border-shOrange" : "border-bgHover"}`}/>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Opening notes</span>
                          <input value={startDay.notes} onChange={(e)=>setStartDay({...startDay, notes: e.target.value})}
                                 placeholder="Anything to watch today?"
                                 className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
                        </label>
                      </div>
                      {openingOverride && (
                        <label className="block bg-shOrange/10 border border-shOrange/40 rounded-lg p-3">
                          <span className="text-[10px] font-black uppercase tracking-widest text-shOrange">Reason for changing the rollover amount · required</span>
                          <input value={startDay.opening_override_reason} onChange={(e)=>setStartDay({...startDay, opening_override_reason: e.target.value})}
                                 placeholder="Bank deposit, owner removed cash, recount, correction…"
                                 className="mt-1 w-full bg-bgPanel border border-shOrange/50 rounded p-2 text-white text-sm"/>
                        </label>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] text-gray-300">
                        <p><i className="fas fa-calendar-day text-shGreen mr-1"/>Review today’s bookings and arrivals.</p>
                        <p><i className="fas fa-shield-dog text-shOrange mr-1"/>Check vaccines, meds, meals, behavior notes, and low credits.</p>
                        <p><i className="fas fa-moon text-shBlue mr-1"/>Boarding dogs already staying over are expected on-site.</p>
                        <p><i className="fas fa-cash-register text-shGreen mr-1"/>Drawer starts from the opening cash you save here.</p>
                      </div>

                      {data.staff_readiness && (
                        <div className={`border rounded-xl p-3 ${data.staff_readiness.ratio_warn ? "bg-shOrange/10 border-shOrange/40" : "bg-bgBase/60 border-shGreen/30"}`} data-testid="start-day-staff-readiness">
                          <p className="text-[11px] font-black uppercase tracking-widest text-shGreen mb-2"><i className="fas fa-users-gear mr-1"/>Staff readiness</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <EodStat label="Scheduled" value={data.staff_readiness.scheduled_count || 0}/>
                            <EodStat label="Clocked in" value={data.staff_readiness.clocked_in_count || 0} color="text-shGreen"/>
                            <EodStat label="Expected dogs" value={data.staff_readiness.expected_dogs || 0} color="text-shOrange"/>
                            <EodStat label="Dogs/staff" value={data.staff_readiness.dogs_per_staff == null ? "—" : `1:${data.staff_readiness.dogs_per_staff}`} color={data.staff_readiness.ratio_warn ? "text-red-300" : "text-shGreen"}/>
                          </div>
                          {data.staff_readiness.warnings?.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {data.staff_readiness.warnings.slice(0,3).map((w, idx)=>(
                                <p key={`${w.kind}-${idx}`} className="text-[11px] text-shOrange font-black uppercase tracking-widest"><i className="fas fa-triangle-exclamation mr-1"/>{w.title}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button onClick={saveStartDay} disabled={starting || (openingOverride && startDay.opening_override_reason.trim().length < 3)}
                              className="w-full bg-shBlue text-white px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50"
                              data-testid="start-day-save">
                        <i className="fas fa-door-open mr-1"/>{starting ? "Starting…" : "Start Day"}
                      </button>
                    </div>
                  )}

                  {data.register?.latest_closeout && (
                    <div className="bg-shGreen/15 border border-shGreen/40 rounded-xl p-4 space-y-3" data-testid="day-complete-banner">
                      <div>
                        <p className="text-white font-black uppercase tracking-widest"><i className="fas fa-circle-check text-shGreen mr-2"/>Day Complete</p>
                        <p className="text-[13px] text-gray-400 mt-1">Actual cash counted: <span className="text-white font-black">{data.register.latest_closeout.cash_counted == null ? "Not entered" : `$${Number(data.register.latest_closeout.cash_counted).toFixed(2)}`}</span>. {data.register.latest_closeout.cash_counted == null ? "Reopen the day and save a corrected closeout so tomorrow has a rollover amount." : "That amount is locked in for the next opening."}</p>
                      </div>
                      <div className="bg-bgPanel/70 border border-bgHover rounded-lg p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-shOrange">Need to change something after close?</p>
                        <p className="text-[11px] text-gray-500 mt-1">Reopening creates an audit record. Make the correction, then save a fresh closeout.</p>
                        <div className="flex flex-col sm:flex-row gap-2 mt-2">
                          <input value={reopenReason} onChange={(e)=>setReopenReason(e.target.value)} placeholder="Reason for reopening · required"
                                 className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                          <button onClick={reopenDay} disabled={reopening || reopenReason.trim().length < 3}
                                  className="bg-shOrange text-bgHeader px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                            <i className="fas fa-lock-open mr-1"/>{reopening ? "Reopening…" : "Reopen Day"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {data.boarding_stayovers?.length > 0 && (
                    <EodSection title="Boarding stayovers · not blockers" icon="fa-moon" tone="blue" items={data.boarding_stayovers}
                                render={(r)=>(<div className="flex justify-between items-center">
                                  <div><span className="text-white font-black">{r.dog_name}</span> <span className="text-gray-500 text-xs">· {r.client_name || "—"}</span></div>
                                  <span className="text-[11px] text-gray-400">checkout {r.end_date || "later"}</span>
                                </div>)}
                                onClick={(r)=>{ onJump(r.booking_id); close(); }}/>
                  )}

                  {data.all_clear ? (
                    <div className="bg-shGreen/15 border border-shGreen/40 rounded-xl p-6 text-center" data-testid="eod-all-clear">
                      <i className="fas fa-circle-check text-shGreen text-5xl mb-2"/>
                      <p className="text-white font-black text-xl uppercase tracking-widest">All clear!</p>
                      <p className="text-gray-400 text-sm mt-1">Everyone's gone home and the money blockers are handled. Report cards are optional. Go relax — you've earned it. 🐾</p>
                    </div>
                  ) : (
                    <>
                      {data.still_on_premises?.length > 0 && (
                        <EodSection title="Still on premises" icon="fa-paw" tone="red" items={data.still_on_premises}
                                    render={(r)=>(<div className="flex justify-between items-center">
                                      <div><span className="text-white font-black">{r.dog_name}</span> <span className="text-gray-500 text-xs">· {r.client_name || "—"}</span></div>
                                      <span className="text-[11px] text-gray-400">{r.service_type}{r.kennel ? ` · ${r.kennel}` : ""}</span>
                                    </div>)}
                                    onClick={(r)=>{ onJump(r.booking_id); close(); }}/>
                      )}
                      {data.unpaid_bookings?.length > 0 && (
                        <EodSection title="Unpaid bookings" icon="fa-dollar-sign" tone="orange" items={data.unpaid_bookings}
                                    render={(r)=>(<div className="flex justify-between items-center">
                                      <div><span className="text-white font-black">{r.dog_name}</span> <span className="text-gray-500 text-xs">· {r.client_name || "—"}</span></div>
                                      <span className="text-shOrange font-black">${r.amount.toFixed(2)}</span>
                                    </div>)}
                                    onClick={(r)=>{ onJump(r.booking_id); close(); }}/>
                      )}
                      {data.missing_report_cards?.length > 0 && (
                        <EodSection title="Optional report cards not filed" icon="fa-camera-retro" tone="blue" items={data.missing_report_cards}
                                    render={(r)=>(<div className="flex justify-between items-center">
                                      <div><span className="text-white font-black">{r.dog_name}</span> <span className="text-gray-500 text-xs">· {r.client_name || "—"}</span></div>
                                      <span className="text-[11px] text-gray-400">{r.service_type}</span>
                                    </div>)}
                                    onClick={(r)=>{ onJump(r.booking_id); close(); }}/>
                      )}
                    </>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                    <EodStat label="Completed" value={data.completed_count}/>
                    <EodStat label="Cash today" value={`$${(data.revenue_cash || 0).toFixed(2)}`} color="text-shGreen"/>
                    <EodStat label="Meals · meds" value={`${data.care_log_totals?.feedings || 0} · ${data.care_log_totals?.medications || 0}`}/>
                    <EodStat label="💧 · 💩" value={`${data.care_log_totals?.pee || 0} · ${data.care_log_totals?.poop || 0}`}/>
                  </div>

                  {data.register && (
                    <div className="bg-bgBase/60 border border-shGreen/30 rounded-xl p-3" data-testid="eod-register-expected">
                      <p className="text-[11px] font-black uppercase tracking-widest text-shGreen mb-2"><i className="fas fa-cash-register mr-1"/>Expected register totals</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <EodStat label="Expected cash drawer" value={`$${(data.register.totals?.expected_cash || 0).toFixed(2)}`} color="text-shGreen"/>
                        <EodStat label="Clover" value={`$${(data.register.incoming_by_method?.clover || 0).toFixed(2)}`}/>
                        <EodStat label="Venmo" value={`$${(data.register.incoming_by_method?.venmo || 0).toFixed(2)}`}/>
                        <EodStat label="PayPal" value={`$${(data.register.incoming_by_method?.paypal || 0).toFixed(2)}`}/>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-2">Cash drawer = opening cash + cash payments - expenses marked paid from drawer.</p>
                    </div>
                  )}

                  {!data.register?.latest_closeout && (
                    <div className="bg-bgBase/60 border border-bgHover rounded-xl p-3 space-y-3" data-testid="eod-closeout-form">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[11px] font-black uppercase tracking-widest text-shGreen"><i className="fas fa-clipboard-check mr-1"/>Close and carry forward</p>
                        <button type="button" onClick={()=>setCloseout({...closeout, cash_counted: expectedCash.toFixed(2)})}
                                className="bg-bgPanel border border-shGreen/40 text-shGreen px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest">
                          Use expected ${expectedCash.toFixed(2)}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[
                          ["cash_counted", "Actual cash counted · required"],
                          ["clover_batch", "Clover batch"],
                          ["venmo_total", "Venmo total"],
                          ["paypal_total", "PayPal total"],
                          ["check_total", "Checks total"],
                        ].map(([k,label]) => (
                          <label key={k} className="block">
                            <span className={`text-[10px] font-black uppercase tracking-widest ${k === "cash_counted" ? "text-shGreen" : "text-gray-500"}`}>{label}</span>
                            <input type="number" min="0" step="0.01" value={closeout[k]} onChange={(e)=>{ setCloseout({...closeout, [k]: e.target.value}); setCloseoutReview(false); }}
                                   className={`mt-1 w-full bg-bgPanel border rounded p-2 text-white text-sm ${k === "cash_counted" && closeout.cash_counted === "" ? "border-shOrange" : "border-bgHover"}`}/>
                          </label>
                        ))}
                      </div>
                      {cashOverShort != null && (
                        <div className={`rounded-lg border p-3 ${Math.abs(cashOverShort) < 0.005 ? "bg-shGreen/10 border-shGreen/30" : "bg-shOrange/10 border-shOrange/40"}`}>
                          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Live drawer difference</p>
                          <p className={`text-lg font-black ${Math.abs(cashOverShort) < 0.005 ? "text-shGreen" : "text-shOrange"}`}>{cashOverShort >= 0 ? "+" : "-"}${Math.abs(cashOverShort).toFixed(2)} {cashOverShort >= 0 ? "over" : "short"}</p>
                        </div>
                      )}
                      <label className="block">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Notes</span>
                        <textarea value={closeout.notes} onChange={(e)=>{ setCloseout({...closeout, notes: e.target.value}); setCloseoutReview(false); }}
                                  placeholder="Anything weird today? unpaid promise, cash drawer note, supply issue…"
                                  className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm min-h-[70px]"/>
                      </label>

                      {!closeoutReview ? (
                        <button onClick={reviewCloseout} disabled={closeout.cash_counted === ""}
                                className="w-full bg-shGreen text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50"
                                data-testid="eod-review-closeout">
                          <i className="fas fa-magnifying-glass mr-1"/>Review Closeout
                        </button>
                      ) : (
                        <div className="bg-bgPanel border-2 border-shGreen/50 rounded-xl p-4 space-y-3" data-testid="eod-closeout-confirmation">
                          <p className="text-white font-black uppercase tracking-widest"><i className="fas fa-shield-check text-shGreen mr-2"/>Confirm the rollover</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <EodStat label="Expected drawer" value={`$${expectedCash.toFixed(2)}`}/>
                            <EodStat label="Actual counted" value={`$${Number(closeout.cash_counted).toFixed(2)}`} color="text-shGreen"/>
                            <EodStat label="Over / short" value={`${cashOverShort >= 0 ? "+" : "-"}$${Math.abs(cashOverShort || 0).toFixed(2)}`} color={Math.abs(cashOverShort || 0) < 0.005 ? "text-shGreen" : "text-shOrange"}/>
                          </div>
                          <div className="bg-shGreen/10 border border-shGreen/30 rounded-lg p-3 text-center">
                            <p className="text-[10px] font-black uppercase tracking-widest text-shGreen">Amount opening tomorrow</p>
                            <p className="text-2xl text-white font-black mt-1">${Number(closeout.cash_counted).toFixed(2)}</p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button onClick={()=>setCloseoutReview(false)} className="sm:w-1/3 bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest">Go Back</button>
                            <button onClick={saveCloseout} disabled={closing}
                                    className="flex-1 bg-shGreen text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50"
                                    data-testid="eod-save-closeout">
                              <i className="fas fa-lock mr-1"/>{closing ? "Closing…" : `Confirm & Carry $${Number(closeout.cash_counted).toFixed(2)} Forward`}
                            </button>
                          </div>
                        </div>
                      )}
                      {!data.all_clear && <p className="text-[11px] text-shOrange font-black uppercase tracking-widest">There are still safety or money items to resolve. Boarding stayovers are not blockers unless due for checkout.</p>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EodSection({ title, icon, tone, items, render, onClick }) {
  const toneCls = {
    red: "bg-red-600/10 border-red-500/40 text-red-300",
    orange: "bg-shOrange/10 border-shOrange/40 text-shOrange",
    blue: "bg-shBlue/10 border-shBlue/40 text-shBlue",
  }[tone] || "";
  return (
    <div className={`rounded-xl border p-3 ${toneCls}`} data-testid={`eod-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <p className="text-[11px] font-black uppercase tracking-widest mb-2"><i className={`fas ${icon} mr-1`}/>{title} · {items.length}</p>
      <div className="space-y-1.5">
        {items.map(i => (
          <button key={i.booking_id} onClick={()=>onClick(i)}
                  className="w-full bg-bgPanel/80 hover:bg-bgPanel rounded p-2 text-left text-[13px] transition">
            {render(i)}
          </button>
        ))}
      </div>
    </div>
  );
}

function EodStat({ label, value, color = "text-white" }) {
  return (
    <div className="bg-bgBase/60 border border-bgHover rounded-lg p-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-lg font-black ${color}`}>{value}</p>
    </div>
  );
}
