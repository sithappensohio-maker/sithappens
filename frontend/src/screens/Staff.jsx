// Admin → Staff screen.
// Manage employees (CRUD), view all timecards, override clock entries.
import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import PageHero from "../components/PageHero";
import RolesPanel from "../components/RolesPanel";
import { todayISO, daysAgoISO } from "../lib/date";
import TrainerScorecardTab from "../components/TrainerScorecardTab";
import { compressImage } from "../lib/imageCompress";

function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

// Register form controls must live at module scope. Defining component types
// inside RegisterTab creates a new component identity on every state update,
// which makes React remount the input and drop focus after each keystroke.
function RegisterFormInput({ label, value, onChange, type = "text", step, placeholder, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
      {children || (
        <input
          type={type}
          step={step}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ""}
          className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"
        />
      )}
    </label>
  );
}

function RegisterSelect({ label, value, onChange, children }) {
  return (
    <RegisterFormInput label={label} value={value} onChange={onChange}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"
      >
        {children}
      </select>
    </RegisterFormInput>
  );
}

export default function Staff() {
  const confirm = useConfirm();
  const [employees, setEmployees] = useState([]);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null);  // {mode:"new"|"edit"|"reset-pw", emp?}
  const [start, setStart] = useState(daysAgoISO(13));
  const [end, setEnd] = useState(todayISO());
  const [userFilter, setUserFilter] = useState("");
  const [tcData, setTcData] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [subtab, setSubtab] = useState("ops");
  const [paySnap, setPaySnap] = useState(null);

  const loadEmployees = async () => {
    try { const r = await api.get("/admin/employees"); setEmployees(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  const loadPaySnap = async () => {
    try { const r = await api.get("/admin/staff/pay-snapshot"); setPaySnap(r.data); }
    catch {}
  };
  const loadTimecards = async () => {
    try {
      const params = { start_date: start, end_date: end };
      if (userFilter) params.user_id = userFilter;
      const r = await api.get("/admin/time-clock", { params });
      setTcData(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { loadEmployees(); loadPaySnap(); }, []);
  useEffect(() => { loadTimecards(); /* eslint-disable-next-line */ }, [start, end, userFilter]);

  const deactivate = async (emp) => {
    if (!(await confirm({ title: `Deactivate ${emp.name}?`, body: "They won't be able to log in. Past time entries are preserved.", confirmText: "Deactivate", tone: "danger" }))) return;
    await api.delete(`/admin/employees/${emp.id}`);
    loadEmployees();
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="staff-screen">
      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px] font-black uppercase tracking-widest">{err}</div>}
      <PageHero
        eyebrow={{ icon: "fa-users-gear", text: "Team operations", color: "text-shGreen" }}
        title="Staff."
        highlight="The crew that makes it happen."
        subtitle="Employees, schedules, timecards, payroll, and tax estimates."
        right={(
          <button onClick={()=>setModal({ mode: "new" })} data-testid="staff-new-btn"
                  className="bg-shGreen text-bgHeader px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition">
            <i className="fas fa-plus mr-2"/>Add Employee
          </button>
        )}
        testid="staff-hero"
      />

      {/* Sprint 110ex — Phase 7: Roles & permissions panel */}
      <RolesPanel />

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-bgHover overflow-x-auto" data-testid="staff-subtabs">
        {[
          ["ops", "Ops Hub", "fa-tower-observation"],
          ["employees", "Employees", "fa-users"],
          ["timecards", "Timecards", "fa-clock"],
          ["schedule", "Schedule", "fa-calendar-week"],
          ["tasks", "Tasks", "fa-list-check"],
          ["payroll", "Payroll", "fa-file-csv"],
          ["taxes", "Payroll Tax", "fa-calculator"],
          ["quarterly", "Quarterly Tax", "fa-file-invoice-dollar"],
          ["money", "Money Audit", "fa-scale-balanced"],
          ["register", "Register", "fa-cash-register"],
          ["timeoff", "Time Off", "fa-umbrella-beach"],
          ["corrections", "Corrections", "fa-clock-rotate-left"],
          ["training", "Training", "fa-clipboard-user"],
        ].map(([k, label, icon]) => (
          <button key={k} onClick={()=>setSubtab(k)} data-testid={`staff-subtab-${k}`}
                  className={`shrink-0 px-3 py-2 text-[13px] font-black uppercase tracking-widest border-b-2 transition ${subtab===k ? "border-shGreen text-shGreen" : "border-transparent text-gray-400 hover:text-white"}`}>
            <i className={`fas ${icon} mr-1.5`}/>{label}
          </button>
        ))}
      </div>

      {subtab === "ops" && <StaffOpsTab onGo={setSubtab} />}

      {subtab === "employees" && (<>

      {/* Owner's Draw drill-down — only shown when an owner is configured */}
      <OwnerDrawCard/>

      {/* Employee list */}
      <div className="card-staff rounded-xl overflow-hidden" data-testid="staff-list">
        {paySnap && paySnap.totals.this_week_gross > 0 && (
          <div className="bg-bgBase/40 border-b border-bgHover px-4 py-2 flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="staff-pay-totals">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-hand-holding-dollar mr-1 text-shGreen"/>This week so far</p>
            <p className="text-[14px] font-black text-shGreen">${paySnap.totals.this_week_gross.toFixed(2)}</p>
            <p className="text-[12px] text-gray-400 font-black uppercase tracking-widest">{paySnap.totals.this_week_hours.toFixed(1)}h · {paySnap.totals.currently_clocked_in} on the clock now</p>
            <p className="text-[11px] text-gray-500 ml-auto">Week of {paySnap.totals.week_start}</p>
          </div>
        )}
        {employees.length === 0 && (
          <div className="p-10 text-center text-gray-500 text-sm font-black uppercase tracking-widest">No employees yet. Click "Add Employee" to get started.</div>
        )}
        <div className="divide-y divide-bgHover/40">
          {employees.map(e => {
            const snap = paySnap?.snapshot?.find(s => s.user_id === e.id);
            return (
            <div key={e.id} className="p-4 flex items-center justify-between gap-3 flex-wrap" data-testid={`staff-row-${e.id}`}>
              <div className="min-w-0 flex-1">
                <p className="text-base font-black text-white">
                  {e.name}
                  {e.is_owner && <span className="ml-2 text-[11px] font-black uppercase tracking-widest bg-shBlue/20 text-shBlue px-2 py-0.5 rounded" data-testid={`staff-owner-${e.id}`}><i className="fas fa-crown mr-1"/>Owner</span>}
                  {!e.active && <span className="ml-2 text-[11px] font-black uppercase tracking-widest bg-red-500/15 text-red-300 px-2 py-0.5 rounded">Inactive</span>}
                  {snap?.live && <span className="ml-2 text-[11px] font-black uppercase tracking-widest bg-shGreen/20 text-shGreen px-2 py-0.5 rounded animate-pulse" data-testid={`staff-live-${e.id}`}><i className="fas fa-bolt mr-1"/>On the clock</span>}
                </p>
                <p className="text-[13px] text-gray-400">{e.email}{e.phone ? ` · ${e.phone}` : ""}</p>
                <p className="text-[12px] text-gray-500 mt-1">${e.hourly_rate.toFixed(2)}/hr{e.is_owner ? " · owner's draw" : ""}{e.last_login_at ? ` · last login ${fmtTime(e.last_login_at)}` : " · never logged in"}</p>
                {/* Sprint 110bb — pay snapshot mini-row */}
                {snap && e.active && (snap.this_week_hours > 0 || snap.last_week_hours > 0 || snap.live) && (
                  <p className="text-[12px] mt-1.5 font-black uppercase tracking-widest" data-testid={`staff-pay-${e.id}`}>
                    <span className="text-shGreen">This wk · {snap.this_week_hours.toFixed(1)}h · ${snap.this_week_gross.toFixed(2)}</span>
                    <span className="text-gray-500 normal-case mx-2">·</span>
                    <span className="text-gray-400">Last wk · {snap.last_week_hours.toFixed(1)}h · ${snap.last_week_gross.toFixed(2)}</span>
                    <span className="text-gray-500 normal-case mx-2">·</span>
                    <span className="text-gray-400">YTD · ${snap.ytd_gross.toFixed(2)}</span>
                    {snap.live && (
                      <>
                        <span className="text-gray-500 normal-case mx-2">·</span>
                        <span className="text-shGreen">Now · ${snap.live.gross_so_far.toFixed(2)}</span>
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={()=>setModal({ mode: "edit", emp: e })} data-testid={`staff-edit-${e.id}`}
                        className="text-[13px] font-black uppercase text-shBlue hover:underline">Edit</button>
                <button onClick={()=>setModal({ mode: "reset-pw", emp: e })} data-testid={`staff-reset-${e.id}`}
                        className="text-[13px] font-black uppercase text-shOrange hover:underline">Reset PW</button>
                {e.active && <button onClick={()=>deactivate(e)} data-testid={`staff-deactivate-${e.id}`}
                                    className="text-[13px] font-black uppercase text-red-400 hover:underline">Deactivate</button>}
              </div>
            </div>
          );})}
        </div>
      </div>
      </>)}

      {subtab === "timecards" && (
      <div className="card-staff rounded-xl p-5 space-y-4" data-testid="timecard-viewer">
        <div>
          <h4 className="text-white font-black uppercase italic tracking-tight"><i className="fas fa-clock text-shBlue mr-2"/>Time Clock</h4>
          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-1">Hours and payroll cost by employee</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
            <span className="block mb-1">Start</span>
            <input type="date" value={start} onChange={(e)=>setStart(e.target.value)} style={{colorScheme:"dark"}}
                   data-testid="tc-start"
                   className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm"/>
          </label>
          <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
            <span className="block mb-1">End</span>
            <input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} style={{colorScheme:"dark"}}
                   data-testid="tc-end"
                   className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm"/>
          </label>
          <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
            <span className="block mb-1">Employee</span>
            <select value={userFilter} onChange={(e)=>setUserFilter(e.target.value)}
                    data-testid="tc-user-filter"
                    className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm">
              <option value="">All staff</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </label>
        </div>
        {tcData && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-bgBase border border-bgHover rounded p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-clock mr-1 text-shBlue"/>Total hours</p>
                <p className="text-2xl font-black text-shBlue mt-1">{tcData.grand_hours}</p>
              </div>
              <div className="bg-bgBase border border-bgHover rounded p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-dollar-sign mr-1 text-shGreen"/>Payroll cost</p>
                <p className="text-2xl font-black text-shGreen mt-1">${tcData.grand_cost.toFixed(2)}</p>
              </div>
              <div className="bg-bgBase border border-bgHover rounded p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-receipt mr-1 text-gray-400"/>Entries</p>
                <p className="text-2xl font-black text-white mt-1">{tcData.entries.length}</p>
              </div>
            </div>
            {tcData.per_user.length > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">By employee</p>
                <div className="space-y-1">
                  {tcData.per_user.map(u => (
                    <div key={u.user_id} className="flex justify-between items-center gap-2 text-[14px]" data-testid={`tc-per-user-${u.user_id}`}>
                      <span className="text-gray-300 truncate">{u.name}</span>
                      <span className="text-gray-500 shrink-0">
                        {u.hours}h · ${u.cost.toFixed(2)} · ${u.hourly_rate.toFixed(2)}/hr
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]" data-testid="tc-entries-table">
                <thead className="text-[12px] font-black uppercase tracking-widest text-gray-500 border-b border-bgHover">
                  <tr>
                    <th className="px-2 py-2 text-left">Employee</th>
                    <th className="px-2 py-2 text-left">Clock In</th>
                    <th className="px-2 py-2 text-left">Clock Out</th>
                    <th className="px-2 py-2 text-right">Hours</th>
                    <th className="px-2 py-2 text-right">Cost</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {tcData.entries.map(e => {
                    const u = tcData.per_user.find(p => p.user_id === e.user_id) || {};
                    const cost = (Number(e.hours)||0) * (u.hourly_rate || 0);
                    return (
                      <tr key={e.id} className="border-b border-bgHover/40 hover:bg-bgBase/40" data-testid={`tc-row-${e.id}`}>
                        <td className="px-2 py-2 text-gray-200">{u.name || e.user_name || "—"}</td>
                        <td className="px-2 py-2 text-gray-300">{fmtTime(e.clock_in_at)}{e.clock_in_lat ? <i className="fas fa-location-dot ml-1 text-shBlue text-[10px]" title={`${e.clock_in_lat.toFixed(4)},${e.clock_in_lng.toFixed(4)}`}/> : null}</td>
                        <td className="px-2 py-2 text-gray-300">{e.clock_out_at ? <>{fmtTime(e.clock_out_at)}{e.clock_out_lat ? <i className="fas fa-location-dot ml-1 text-shBlue text-[10px]" title={`${e.clock_out_lat.toFixed(4)},${e.clock_out_lng.toFixed(4)}`}/> : null}</> : <span className="text-shGreen">open</span>}</td>
                        <td className="px-2 py-2 text-right font-black text-white">{e.hours ? e.hours.toFixed(2) : "—"}</td>
                        <td className="px-2 py-2 text-right text-shGreen">{e.hours ? `$${cost.toFixed(2)}` : "—"}</td>
                        <td className="px-2 py-2 text-right">
                          <button onClick={()=>setEditingEntry(e)} data-testid={`tc-edit-${e.id}`}
                                  className="text-[13px] font-black uppercase text-shBlue hover:underline">Edit</button>
                        </td>
                      </tr>
                    );
                  })}
                  {tcData.entries.length === 0 && (
                    <tr><td colSpan="6" className="px-2 py-6 text-center text-gray-500 text-[14px] uppercase font-black tracking-widest">No clock entries in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      )}

      {subtab === "schedule" && <ScheduleTab employees={employees} />}
      {subtab === "tasks" && <TasksTab employees={employees} />}
      {subtab === "payroll" && <PayrollTab employees={employees} />}
      {subtab === "taxes" && <TaxEstimatorTab />}
      {subtab === "quarterly" && <QuarterlyTaxTab />}
      {subtab === "money" && <MoneyAuditTab />}
      {subtab === "register" && <RegisterTab />}
      {subtab === "timeoff" && <TimeOffAdminTab />}
      {subtab === "corrections" && <PunchCorrectionsAdminTab />}
      {subtab === "training" && <TrainerScorecardTab />}

      {modal && <EmployeeFormModal mode={modal.mode} emp={modal.emp}
                                  onClose={()=>setModal(null)}
                                  onSaved={()=>{ setModal(null); loadEmployees(); }} />}
      {editingEntry && <TimeClockEditModal entry={editingEntry}
                                          onClose={()=>setEditingEntry(null)}
                                          onSaved={()=>{ setEditingEntry(null); loadTimecards(); }}/>}
    </div>
  );
}


function StaffOpsTab({ onGo }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.get("/admin/staff/readiness");
      setData(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Could not load staff readiness"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const warnings = data?.warnings || [];
  const ratio = data?.dogs_per_staff == null ? "—" : `1:${data.dogs_per_staff}`;
  const serviceCounts = data?.service_counts || {};

  return (
    <div className="space-y-4" data-testid="staff-ops-tab">
      {err && <div className="text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3 text-[13px] font-black uppercase tracking-widest">{err}</div>}

      <div className="bg-bgPanel border border-shGreen/40 rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-25" style={{ background: "radial-gradient(circle at 15% 15%, rgba(140,198,63,.35), transparent 35%), radial-gradient(circle at 90% 70%, rgba(0,169,224,.28), transparent 40%)" }}/>
        <div className="relative flex flex-col lg:flex-row justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen"><i className="fas fa-clipboard-check mr-2"/>Staff Ops Hub</p>
            <h3 className="text-2xl sm:text-3xl font-black uppercase italic text-white mt-1">Today’s staffing readiness.</h3>
            <p className="text-[13px] text-gray-400 mt-1">One clean place to check schedule, clock-ins, dog load, time off, and punch corrections.</p>
          </div>
          <div className="flex gap-2 flex-wrap items-start">
            <button onClick={load} disabled={loading} className="bg-bgBase border border-bgHover text-gray-200 px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50" data-testid="staff-ops-refresh">
              <i className="fas fa-rotate mr-1"/>{loading ? "Loading" : "Refresh"}
            </button>
            <button onClick={()=>onGo("schedule")} className="bg-shBlue text-white px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest">Schedule</button>
            <button onClick={()=>onGo("timecards")} className="bg-shGreen text-bgHeader px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest">Timecards</button>
          </div>
        </div>
      </div>

      {!data ? (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-gray-500 text-sm">Loading staff readiness…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <OpsStat label="Scheduled today" value={data.scheduled_count || 0} icon="fa-calendar-day" color="text-shBlue"/>
            <OpsStat label="Clocked in now" value={data.clocked_in_count || 0} icon="fa-user-check" color="text-shGreen"/>
            <OpsStat label="Expected dogs" value={data.expected_dogs || 0} icon="fa-paw" color="text-shOrange"/>
            <OpsStat label="Dogs per staff" value={ratio} icon="fa-scale-balanced" color={data.ratio_warn ? "text-red-300" : "text-shGreen"}/>
          </div>

          {warnings.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="staff-ops-warnings">
              {warnings.map((w, i) => (
                <div key={`${w.kind}-${i}`} className={`border rounded-xl p-4 ${w.level === "warn" ? "bg-shOrange/10 border-shOrange/40" : "bg-shBlue/10 border-shBlue/40"}`}>
                  <p className={`text-[12px] font-black uppercase tracking-widest ${w.level === "warn" ? "text-shOrange" : "text-shBlue"}`}><i className="fas fa-triangle-exclamation mr-1"/>{w.title}</p>
                  <p className="text-[13px] text-gray-400 mt-1">{w.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-shGreen/10 border border-shGreen/40 rounded-xl p-4" data-testid="staff-ops-clear">
              <p className="text-white font-black uppercase tracking-widest"><i className="fas fa-circle-check text-shGreen mr-2"/>No staffing warnings right now</p>
              <p className="text-[13px] text-gray-400 mt-1">Still use common sense, but nothing obvious is screaming from schedule, clock-ins, ratio, or pending requests.</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="staff-ops-schedule-list">
              <div className="flex justify-between items-center gap-2 mb-3">
                <div>
                  <h4 className="text-white font-black uppercase italic"><i className="fas fa-calendar-week text-shBlue mr-2"/>Today’s Shift Plan</h4>
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Scheduled vs clocked in</p>
                </div>
                <button onClick={()=>onGo("schedule")} className="text-shBlue text-[12px] font-black uppercase tracking-widest hover:underline">Edit</button>
              </div>
              {(data.scheduled || []).length === 0 ? (
                <p className="text-gray-500 text-sm">No shifts scheduled today. That is okay if you are solo, but the ratio warning will use clocked-in staff only.</p>
              ) : (
                <div className="space-y-2">
                  {(data.scheduled || []).map(s => (
                    <div key={s.id} className={`bg-bgBase border rounded-lg p-3 flex justify-between gap-3 ${s.late_not_clocked_in ? "border-shOrange/60" : "border-bgHover"}`} data-testid={`staff-ops-shift-${s.id}`}>
                      <div className="min-w-0">
                        <p className="text-white font-black truncate">{s.employee_name}</p>
                        <p className="text-[12px] text-gray-500">{s.start_time}–{s.end_time}{s.role ? ` · ${s.role}` : ""}</p>
                      </div>
                      <span className={`shrink-0 text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded self-center ${s.clocked_in_now ? "bg-shGreen/20 text-shGreen" : s.late_not_clocked_in ? "bg-shOrange/20 text-shOrange" : "bg-bgPanel text-gray-400"}`}>
                        {s.clocked_in_now ? "Clocked in" : s.late_not_clocked_in ? "Missing" : "Scheduled"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="staff-ops-live-list">
              <div className="flex justify-between items-center gap-2 mb-3">
                <div>
                  <h4 className="text-white font-black uppercase italic"><i className="fas fa-bolt text-shGreen mr-2"/>Live Floor</h4>
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Clocked in staff + dog load</p>
                </div>
                <button onClick={()=>onGo("timecards")} className="text-shGreen text-[12px] font-black uppercase tracking-widest hover:underline">Timecards</button>
              </div>
              {(data.clocked_in || []).length === 0 ? (
                <p className="text-gray-500 text-sm">Nobody is clocked in right now.</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {(data.clocked_in || []).map(c => (
                    <div key={c.entry_id || c.user_id} className="bg-bgBase border border-bgHover rounded-lg p-3 flex justify-between gap-3">
                      <span className="text-white font-black truncate">{c.name}</span>
                      <span className="text-[11px] text-shGreen font-black uppercase tracking-widest">Since {fmtTime(c.clock_in_at)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <MiniLine label="Daycare" value={serviceCounts.daycare || 0}/>
                <MiniLine label="Boarding" value={serviceCounts.boarding || 0}/>
                <MiniLine label="Training" value={serviceCounts.training || 0}/>
                <MiniLine label="Grooming" value={serviceCounts.grooming || 0}/>
                <MiniLine label="Stayovers" value={data.boarding_stayovers || 0}/>
                <MiniLine label="Arrivals left" value={data.arrivals_remaining || 0}/>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ActionTile label="Pending time off" value={data.pending_time_off_count || 0} icon="fa-umbrella-beach" onClick={()=>onGo("timeoff")} warn={(data.pending_time_off_count || 0) > 0}/>
            <ActionTile label="Punch corrections" value={data.pending_punch_correction_count || 0} icon="fa-clock-rotate-left" onClick={()=>onGo("corrections")} warn={(data.pending_punch_correction_count || 0) > 0}/>
            <ActionTile label="Staff training" value="Open" icon="fa-clipboard-user" onClick={()=>onGo("training")}/>
          </div>
        </>
      )}
    </div>
  );
}

function OpsStat({ label, value, icon, color }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className={`fas ${icon} mr-1 ${color || "text-shGreen"}`}/>{label}</p>
      <p className={`text-2xl font-black mt-1 ${color || "text-white"}`}>{value}</p>
    </div>
  );
}

function MiniLine({ label, value }) {
  return <div className="bg-bgBase border border-bgHover rounded p-2 flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest">{label}</span><span className="text-white font-black">{value}</span></div>;
}

function ActionTile({ label, value, icon, onClick, warn=false }) {
  return (
    <button onClick={onClick} className={`bg-bgPanel border rounded-xl p-4 text-left hover:border-shGreen transition ${warn ? "border-shOrange/50" : "border-bgHover"}`}>
      <p className={`text-[11px] font-black uppercase tracking-widest ${warn ? "text-shOrange" : "text-gray-500"}`}><i className={`fas ${icon} mr-1`}/>{label}</p>
      <p className="text-xl font-black text-white mt-1">{value}</p>
    </button>
  );
}

function EmployeeFormModal({ mode, emp, onClose, onSaved }) {
  const [form, setForm] = useState({
    email: emp?.email || "",
    name: emp?.name || "",
    display_name: emp?.display_name || "",
    hourly_rate: emp?.hourly_rate ?? 0,
    active: emp?.active ?? true,
    phone: emp?.phone || "",
    notes: emp?.notes || "",
    is_owner: emp?.is_owner ?? false,
    tax_status: emp?.tax_status || "1099",
    address_street: emp?.address_street || "",
    address_city: emp?.address_city || "",
    address_state: emp?.address_state || "",
    address_zip: emp?.address_zip || "",
  });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true); setErr("");
    try {
      if (mode === "new") {
        if (!password || password.length < 6) throw new Error("Password must be at least 6 characters");
        await api.post("/admin/employees", { ...form, password });
      } else if (mode === "edit") {
        await api.put(`/admin/employees/${emp.id}`, form);
      } else if (mode === "reset-pw") {
        if (!password || password.length < 6) throw new Error("Password must be at least 6 characters");
        await api.post(`/admin/employees/${emp.id}/reset-password`, { password });
      }
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const title = mode === "new" ? "Add Employee" : mode === "edit" ? "Edit Employee" : "Reset Password";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl max-w-md w-full p-5 space-y-3" onClick={e=>e.stopPropagation()} data-testid="emp-modal">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-black uppercase italic tracking-tight">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="fas fa-times"/></button>
        </div>
        {mode !== "reset-pw" && (
          <>
            <Field label="Name *" value={form.name} onChange={v=>setForm({...form, name: v})} testid="emp-name"/>
            <Field label="Email *" type="email" value={form.email} onChange={v=>setForm({...form, email: v})} testid="emp-email"/>
            <Field label="Display name (shown on run sheet)" value={form.display_name} onChange={v=>setForm({...form, display_name: v})} testid="emp-display"/>
            <Field label="Phone" value={form.phone} onChange={v=>setForm({...form, phone: v})} testid="emp-phone"/>
            <Field label="Hourly rate ($)" type="number" value={form.hourly_rate} onChange={v=>setForm({...form, hourly_rate: Number(v)||0})} testid="emp-rate"/>
            {mode === "edit" && (
              <label className="flex items-center gap-2 text-[14px] font-black uppercase tracking-widest text-gray-400">
                <input type="checkbox" checked={form.active} onChange={(e)=>setForm({...form, active: e.target.checked})} className="w-4 h-4 accent-shGreen" data-testid="emp-active"/>
                Active (can log in)
              </label>
            )}
            <label className="flex items-start gap-2 bg-shBlue/5 border border-shBlue/30 rounded p-2">
              <input type="checkbox" checked={form.is_owner}
                     onChange={(e)=>setForm({...form, is_owner: e.target.checked})}
                     className="w-4 h-4 mt-0.5 accent-shBlue" data-testid="emp-is-owner"/>
              <div>
                <span className="text-[13px] font-black uppercase tracking-widest text-shBlue">Owner / self-pay</span>
                <p className="text-[11px] text-gray-400 mt-0.5">Excluded from payroll tax math, 1099/W2 exports, and quarterly tax labor expense. Pay tracked as owner's draw. Single owner only.</p>
              </div>
            </label>

            {/* Sprint 110bu — W-2 / 1099 prep */}
            {!form.is_owner && (<>
              <label className="block" data-testid="emp-tax-status-row">
                <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">
                  <i className="fas fa-file-invoice-dollar mr-1 text-shGreen"/>Tax classification
                </span>
                <select value={form.tax_status}
                        onChange={(e)=>setForm({...form, tax_status: e.target.value})}
                        data-testid="emp-tax-status"
                        className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option value="w2">W-2 employee (you withhold taxes)</option>
                  <option value="1099">1099-NEC contractor (paid gross)</option>
                  <option value="other">Other / not classified yet</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1 italic">
                  Used to group the year-end payroll CSV your CPA needs.
                </p>
              </label>
              <details className="bg-bgBase/40 border border-bgHover rounded p-2" data-testid="emp-address-row">
                <summary className="cursor-pointer text-[12px] font-black uppercase tracking-widest text-gray-400">
                  <i className="fas fa-house mr-1 text-shBlue"/>Mailing address
                  {(form.address_street || form.address_city) && <span className="ml-2 text-shGreen normal-case">· On file</span>}
                </summary>
                <div className="mt-2 space-y-2">
                  <Field label="Street" value={form.address_street}
                         onChange={v=>setForm({...form, address_street: v})}
                         testid="emp-addr-street"/>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="City" value={form.address_city}
                           onChange={v=>setForm({...form, address_city: v})}
                           testid="emp-addr-city"/>
                    <Field label="State" value={form.address_state}
                           onChange={v=>setForm({...form, address_state: v})}
                           testid="emp-addr-state"/>
                    <Field label="ZIP" value={form.address_zip}
                           onChange={v=>setForm({...form, address_zip: v})}
                           testid="emp-addr-zip"/>
                  </div>
                  <p className="text-[11px] text-gray-500 italic">
                    Used on the year-end W-2 / 1099-NEC. SSN/EIN is intentionally NOT stored here — your CPA collects that directly.
                  </p>
                </div>
              </details>
            </>)}
            <label className="block">
              <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Notes</span>
              <textarea value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})} rows={2}
                        data-testid="emp-notes"
                        className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
            </label>
          </>
        )}
        {(mode === "new" || mode === "reset-pw") && (
          <Field label={mode === "new" ? "Temporary password *" : "New password *"} type="password" value={password} onChange={setPassword} testid="emp-pw"/>
        )}
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 text-gray-400 py-3 text-[14px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="emp-save"
                  className="flex-1 bg-shGreen text-bgHeader py-3 rounded font-black text-[14px] uppercase tracking-widest disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", testid }) {
  return (
    <label className="block">
      <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">{label}</span>
      <input type={type} value={value} onChange={(e)=>onChange(e.target.value)}
             data-testid={testid}
             className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
    </label>
  );
}

function TimeClockEditModal({ entry, onClose, onSaved }) {
  const [form, setForm] = useState({
    clock_in_at: (entry.clock_in_at || "").slice(0, 16),
    clock_out_at: (entry.clock_out_at || "").slice(0, 16),
    break_minutes: entry.break_minutes || 0,
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const payload = {
        clock_in_at: form.clock_in_at ? new Date(form.clock_in_at).toISOString() : null,
        clock_out_at: form.clock_out_at ? new Date(form.clock_out_at).toISOString() : null,
        break_minutes: Number(form.break_minutes) || 0,
        note: form.note,
      };
      await api.put(`/admin/time-clock/${entry.id}`, payload);
      onSaved();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("Delete this clock entry permanently?")) return;
    setBusy(true);
    try { await api.delete(`/admin/time-clock/${entry.id}`); onSaved(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl max-w-md w-full p-5 space-y-3" onClick={e=>e.stopPropagation()} data-testid="tc-edit-modal">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-black uppercase italic tracking-tight">Edit Clock Entry</h3>
          <button onClick={onClose} className="text-gray-400"><i className="fas fa-times"/></button>
        </div>
        <Field label="Clock In" type="datetime-local" value={form.clock_in_at} onChange={v=>setForm({...form, clock_in_at: v})} testid="tc-in"/>
        <Field label="Clock Out" type="datetime-local" value={form.clock_out_at} onChange={v=>setForm({...form, clock_out_at: v})} testid="tc-out"/>
        <Field label="Break minutes" type="number" value={form.break_minutes} onChange={v=>setForm({...form, break_minutes: v})} testid="tc-break"/>
        <Field label="Admin note" value={form.note} onChange={v=>setForm({...form, note: v})} testid="tc-note"/>
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={remove} disabled={busy} className="text-red-400 px-3 py-2 text-[13px] font-black uppercase tracking-widest" data-testid="tc-delete">Delete</button>
          <div className="flex-1"/>
          <button onClick={onClose} className="text-gray-400 py-2 px-3 text-[13px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="tc-save"
                  className="bg-shGreen text-bgHeader py-2 px-4 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}


const DOW_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function ScheduleTab({ employees }) {
  const [templates, setTemplates] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(daysAgoISO(-13));  // +13 days from today
  const [tmplModal, setTmplModal] = useState(null);
  const [shiftModal, setShiftModal] = useState(null);
  const [sva, setSva] = useState(null);
  const [genBusy, setGenBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [t, s] = await Promise.all([
        api.get("/admin/shift-templates"),
        api.get("/admin/shifts", { params: { start_date: start, end_date: end } }),
      ]);
      setTemplates(t.data); setShifts(s.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [start, end]);

  const generate = async () => {
    setGenBusy(true); setErr("");
    try {
      const r = await api.post("/admin/shifts/generate", { start_date: start, end_date: end });
      alert(`Generated ${r.data.created} shift(s). Skipped ${r.data.skipped} (already existed).`);
      await load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setGenBusy(false); }
  };

  const loadSva = async () => {
    try {
      const r = await api.get("/admin/shifts/scheduled-vs-actual", { params: { start_date: start, end_date: end } });
      setSva(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const empName = (uid) => employees.find(e => e.id === uid)?.display_name || employees.find(e => e.id === uid)?.name || "?";
  const shiftsByDate = useMemo(() => {
    const g = {};
    for (const s of shifts) (g[s.date] = g[s.date] || []).push(s);
    return g;
  }, [shifts]);

  return (
    <div className="space-y-4" data-testid="schedule-tab">
      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px]">{err}</div>}

      {/* Weekly Templates */}
      <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
        <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
          <div>
            <h4 className="text-white font-black uppercase italic"><i className="fas fa-repeat text-shGreen mr-2"/>Recurring Weekly Templates</h4>
            <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-1">e.g. "Alex works Mon/Wed/Fri 7am-5pm"</p>
          </div>
          <button onClick={()=>setTmplModal({ mode: "new" })} data-testid="tmpl-new-btn"
                  className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest">+ Template</button>
        </div>
        {templates.length === 0 && <p className="text-gray-500 text-sm">No templates yet.</p>}
        <div className="space-y-1">
          {templates.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-[14px] bg-bgBase/50 rounded px-3 py-2" data-testid={`tmpl-${t.id}`}>
              <span className="text-gray-200">
                <span className="font-black text-white">{empName(t.user_id)}</span>
                {" · "}{DOW_LABELS[t.day_of_week]}
                {" · "}{t.start_time}–{t.end_time}
                {t.role ? <span className="text-gray-500"> · {t.role}</span> : null}
                {!t.active && <span className="ml-2 text-[11px] font-black text-red-300">(off)</span>}
              </span>
              <div className="flex gap-3">
                <button onClick={()=>setTmplModal({ mode: "edit", tmpl: t })} className="text-shBlue text-[13px] font-black uppercase">Edit</button>
                <button onClick={async()=>{ if(confirm("Delete template?")){ await api.delete(`/admin/shift-templates/${t.id}`); load(); }}} className="text-red-400 text-[13px] font-black uppercase">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Date range + generate + shifts */}
      <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
            <span className="block mb-1">Start</span>
            <input type="date" value={start} onChange={(e)=>setStart(e.target.value)} style={{colorScheme:"dark"}} className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" data-testid="sched-start"/>
          </label>
          <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
            <span className="block mb-1">End</span>
            <input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} style={{colorScheme:"dark"}} className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" data-testid="sched-end"/>
          </label>
          <button onClick={generate} disabled={genBusy} data-testid="generate-shifts-btn"
                  className="bg-shBlue text-white px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
            <i className={`fas ${genBusy ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"} mr-1`}/>Generate from Templates
          </button>
          <button onClick={()=>setShiftModal({ mode: "new" })} data-testid="shift-new-btn"
                  className="bg-shGreen text-bgHeader px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest">+ One-off Shift</button>
          <button onClick={loadSva} data-testid="sva-btn"
                  className="bg-bgBase border border-bgHover px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300">
            <i className="fas fa-balance-scale mr-1"/>Scheduled vs Actual
          </button>
        </div>
        <div className="space-y-2">
          {Object.keys(shiftsByDate).length === 0 && <p className="text-gray-500 text-sm">No shifts in this range.</p>}
          {Object.entries(shiftsByDate).map(([d, list]) => (
            <div key={d} className="bg-bgBase/50 rounded p-2" data-testid={`sched-day-${d}`}>
              <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-1">{d}</p>
              {list.map(s => (
                <div key={s.id} className="flex justify-between items-center gap-2 px-2 py-1 text-[14px]" data-testid={`shift-${s.id}`}>
                  <span className="text-gray-200">{empName(s.user_id)} · {s.start_time}–{s.end_time}{s.role ? ` · ${s.role}` : ""}{s.source === "template" ? <i className="fas fa-repeat ml-1 text-shGreen text-[10px]"/> : null}</span>
                  <div className="flex gap-3">
                    <button onClick={()=>setShiftModal({ mode: "edit", shift: s })} className="text-shBlue text-[13px] font-black uppercase">Edit</button>
                    <button onClick={async()=>{ if(confirm("Delete shift?")){ await api.delete(`/admin/shifts/${s.id}`); load(); }}} className="text-red-400 text-[13px] font-black uppercase">×</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {sva && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="sva-result">
          <h4 className="text-white font-black uppercase italic mb-2"><i className="fas fa-balance-scale text-shBlue mr-2"/>Scheduled vs Actual <span className="text-[12px] text-gray-500">(flag &gt; {sva.variance_threshold_minutes}min)</span></h4>
          {sva.shifts.length === 0 && <p className="text-gray-500 text-sm">No shifts in range.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[11px] font-black uppercase tracking-widest text-gray-500 border-b border-bgHover">
                <tr><th className="px-2 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-left">Employee</th><th className="px-2 py-1.5 text-left">Scheduled</th><th className="px-2 py-1.5 text-left">Actual</th><th className="px-2 py-1.5 text-right">Variance</th></tr>
              </thead>
              <tbody>
                {sva.shifts.map(s => (
                  <tr key={s.id} className={`border-b border-bgHover/40 ${s.flagged ? "bg-red-500/5" : ""}`} data-testid={`sva-row-${s.id}`}>
                    <td className="px-2 py-1.5 text-gray-300">{s.date}</td>
                    <td className="px-2 py-1.5 text-gray-200">{empName(s.user_id)}</td>
                    <td className="px-2 py-1.5 text-gray-300">{s.start_time}–{s.end_time}<span className="text-gray-500"> ({(s.scheduled_minutes/60).toFixed(1)}h)</span></td>
                    <td className="px-2 py-1.5 text-gray-300">
                      {s.actual_minutes ? `${(s.actual_minutes/60).toFixed(2)}h` : <span className="text-red-300 font-black">missed</span>}
                      {s.first_in && <span className="text-gray-500 text-[11px] block">{fmtTime(s.first_in)} → {fmtTime(s.last_out)}</span>}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-black ${s.flagged ? "text-red-300" : "text-gray-400"}`}>
                      {s.variance_minutes >= 0 ? "+" : ""}{s.variance_minutes}min {s.flagged && <i className="fas fa-flag ml-1"/>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tmplModal && <TemplateModal mode={tmplModal.mode} tmpl={tmplModal.tmpl} employees={employees}
                                   onClose={()=>setTmplModal(null)}
                                   onSaved={()=>{ setTmplModal(null); load(); }}/>}
      {shiftModal && <ShiftModal mode={shiftModal.mode} shift={shiftModal.shift} employees={employees}
                                 onClose={()=>setShiftModal(null)}
                                 onSaved={()=>{ setShiftModal(null); load(); }}/>}
    </div>
  );
}

function TemplateModal({ mode, tmpl, employees, onClose, onSaved }) {
  const [form, setForm] = useState({
    user_id: tmpl?.user_id || (employees[0]?.id || ""),
    day_of_week: tmpl?.day_of_week ?? 0,
    start_time: tmpl?.start_time || "07:00",
    end_time: tmpl?.end_time || "17:00",
    role: tmpl?.role || "",
    active: tmpl?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    try {
      if (mode === "new") await api.post("/admin/shift-templates", form);
      else await api.put(`/admin/shift-templates/${tmpl.id}`, form);
      onSaved();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl max-w-md w-full p-5 space-y-3" onClick={e=>e.stopPropagation()} data-testid="tmpl-modal">
        <h3 className="text-white font-black uppercase italic">{mode === "new" ? "New Template" : "Edit Template"}</h3>
        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Employee</span>
          <select value={form.user_id} onChange={(e)=>setForm({...form, user_id: e.target.value})} data-testid="tmpl-emp"
                  className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
            {employees.map(em => <option key={em.id} value={em.id}>{em.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Day of week</span>
          <select value={form.day_of_week} onChange={(e)=>setForm({...form, day_of_week: Number(e.target.value)})} data-testid="tmpl-dow"
                  className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
            {DOW_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start time" type="time" value={form.start_time} onChange={v=>setForm({...form, start_time: v})} testid="tmpl-start"/>
          <Field label="End time" type="time" value={form.end_time} onChange={v=>setForm({...form, end_time: v})} testid="tmpl-end"/>
        </div>
        <Field label="Role / notes" value={form.role} onChange={v=>setForm({...form, role: v})} testid="tmpl-role"/>
        <label className="flex items-center gap-2 text-[14px] font-black uppercase tracking-widest text-gray-400">
          <input type="checkbox" checked={form.active} onChange={(e)=>setForm({...form, active: e.target.checked})} className="w-4 h-4 accent-shGreen" data-testid="tmpl-active"/>
          Active
        </label>
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 text-gray-400 py-2 text-[13px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="tmpl-save" className="flex-1 bg-shGreen text-bgHeader py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function ShiftModal({ mode, shift, employees, onClose, onSaved }) {
  const [form, setForm] = useState({
    user_id: shift?.user_id || (employees[0]?.id || ""),
    date: shift?.date || todayISO(),
    start_time: shift?.start_time || "07:00",
    end_time: shift?.end_time || "17:00",
    role: shift?.role || "",
    notes: shift?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    try {
      if (mode === "new") await api.post("/admin/shifts", form);
      else await api.put(`/admin/shifts/${shift.id}`, form);
      onSaved();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl max-w-md w-full p-5 space-y-3" onClick={e=>e.stopPropagation()} data-testid="shift-modal">
        <h3 className="text-white font-black uppercase italic">{mode === "new" ? "New Shift" : "Edit Shift"}</h3>
        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Employee</span>
          <select value={form.user_id} onChange={(e)=>setForm({...form, user_id: e.target.value})} data-testid="shift-emp"
                  className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
            {employees.map(em => <option key={em.id} value={em.id}>{em.name}</option>)}
          </select>
        </label>
        <Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form, date: v})} testid="shift-date"/>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start time" type="time" value={form.start_time} onChange={v=>setForm({...form, start_time: v})} testid="shift-start"/>
          <Field label="End time" type="time" value={form.end_time} onChange={v=>setForm({...form, end_time: v})} testid="shift-end"/>
        </div>
        <Field label="Role" value={form.role} onChange={v=>setForm({...form, role: v})} testid="shift-role"/>
        <Field label="Notes" value={form.notes} onChange={v=>setForm({...form, notes: v})} testid="shift-notes"/>
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 text-gray-400 py-2 text-[13px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="shift-save" className="flex-1 bg-shGreen text-bgHeader py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function TasksTab({ employees }) {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState("open");
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => {
    try {
      const params = filter === "all" ? {} : { status: filter };
      const r = await api.get("/admin/tasks", { params });
      setTasks(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  const empName = (uid) => uid ? (employees.find(e => e.id === uid)?.display_name || employees.find(e => e.id === uid)?.name || "?") : "Unassigned";

  return (
    <div className="space-y-4" data-testid="tasks-tab">
      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px]">{err}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {["open", "in_progress", "done", "all"].map(f => (
            <button key={f} onClick={()=>setFilter(f)} data-testid={`task-filter-${f}`}
                    className={`px-3 py-1.5 text-[13px] font-black uppercase tracking-widest rounded ${filter===f ? "bg-shGreen text-bgHeader" : "bg-bgPanel border border-bgHover text-gray-400"}`}>
              {f.replace("_"," ")}
            </button>
          ))}
        </div>
        <button onClick={()=>setModal({ mode: "new" })} data-testid="task-new-btn"
                className="bg-shGreen text-bgHeader px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest">+ Task</button>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 && <p className="text-gray-500 text-sm">No tasks.</p>}
        {tasks.map(t => (
          <div key={t.id} className={`bg-bgPanel border border-bgHover rounded p-3 ${t.status === "done" ? "opacity-60" : ""}`} data-testid={`task-${t.id}`}>
            <div className="flex justify-between items-start gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="font-black text-white">{t.title}</p>
                {t.description && <p className="text-[13px] text-gray-400 mt-1">{t.description}</p>}
                <p className="text-[12px] text-gray-500 mt-1">
                  <i className="fas fa-user mr-1"/>{empName(t.assigned_to)}
                  {" · "}<span className="capitalize">{t.status.replace("_"," ")}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setModal({ mode: "edit", task: t })} className="text-shBlue text-[13px] font-black uppercase">Edit</button>
                <button onClick={async()=>{ if(confirm("Delete task?")){ await api.delete(`/admin/tasks/${t.id}`); load(); }}} className="text-red-400 text-[13px] font-black uppercase">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {modal && <TaskModal mode={modal.mode} task={modal.task} employees={employees}
                           onClose={()=>setModal(null)}
                           onSaved={()=>{ setModal(null); load(); }}/>}
    </div>
  );
}

function TaskModal({ mode, task, employees, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: task?.title || "",
    description: task?.description || "",
    assigned_to: task?.assigned_to || "",
    kind: task?.kind || "todo",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...form, assigned_to: form.assigned_to || null };
      if (mode === "new") await api.post("/admin/tasks", payload);
      else await api.put(`/admin/tasks/${task.id}`, payload);
      onSaved();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl max-w-md w-full p-5 space-y-3" onClick={e=>e.stopPropagation()} data-testid="task-modal">
        <h3 className="text-white font-black uppercase italic">{mode === "new" ? "New Task" : "Edit Task"}</h3>
        <Field label="Title *" value={form.title} onChange={v=>setForm({...form, title: v})} testid="task-title"/>
        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Description</span>
          <textarea value={form.description} onChange={(e)=>setForm({...form, description: e.target.value})} rows={3}
                    data-testid="task-desc"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
        </label>
        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Assigned to</span>
          <select value={form.assigned_to} onChange={(e)=>setForm({...form, assigned_to: e.target.value})} data-testid="task-assign"
                  className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
            <option value="">— Unassigned (anyone can claim) —</option>
            {employees.filter(e=>e.active).map(em => <option key={em.id} value={em.id}>{em.name}</option>)}
          </select>
        </label>
        {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 text-gray-400 py-2 text-[13px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={busy || !form.title} data-testid="task-save" className="flex-1 bg-shGreen text-bgHeader py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function PayrollTab() {
  const [start, setStart] = useState(daysAgoISO(13));
  const [end, setEnd] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const download = async () => {
    setBusy(true); setErr("");
    try {
      const res = await api.get("/admin/payroll/csv", { params: { start_date: start, end_date: end }, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `payroll_${start}_to_${end}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-5 space-y-3" data-testid="payroll-tab">
      <h4 className="text-white font-black uppercase italic"><i className="fas fa-file-csv text-shGreen mr-2"/>Payroll CSV Export</h4>
      <p className="text-[14px] text-gray-400">Generate a pay-period CSV with employee, hours, hourly rate, gross pay, shift count, and late/early flags.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
          <span className="block mb-1">Period start</span>
          <input type="date" value={start} onChange={(e)=>setStart(e.target.value)} style={{colorScheme:"dark"}} className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" data-testid="payroll-start"/>
        </label>
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
          <span className="block mb-1">Period end</span>
          <input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} style={{colorScheme:"dark"}} className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" data-testid="payroll-end"/>
        </label>
        <button onClick={download} disabled={busy} data-testid="payroll-download"
                className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
          <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-download"} mr-1`}/>Download CSV
        </button>
      </div>
      {err && <p className="text-red-400 text-[14px] font-black uppercase tracking-widest">{err}</p>}
    </div>
  );
}

const TAX_FIELD_GROUPS = [
  {
    label: "Employer-paid (added on top of gross wage)",
    color: "shOrange",
    fields: [
      ["employer_social_security_pct", "Social Security %", "Capped at SS wage cap"],
      ["social_security_wage_cap", "Social Security wage cap $", "2026: $176,100"],
      ["employer_medicare_pct", "Medicare %", "No cap"],
      ["futa_pct", "FUTA % (effective)", "Federal unemployment after state credit"],
      ["futa_wage_cap", "FUTA wage cap $", "Federal limit: $7,000"],
      ["suta_pct", "Ohio SUTA %", "Ohio re-rates yearly — update when you get yours"],
      ["suta_wage_cap", "Ohio SUTA wage cap $", "Ohio 2026: $9,000"],
      ["workers_comp_pct", "Workers' Comp %", "Ohio BWC — depends on policy/class code"],
    ],
  },
  {
    label: "Employee-withheld (employer remits but doesn't pay)",
    color: "shBlue",
    fields: [
      ["employee_social_security_pct", "Social Security %", "Employee side of FICA"],
      ["employee_medicare_pct", "Medicare %", "Employee side of FICA"],
      ["federal_income_tax_pct", "Federal income tax %", "Effective rate estimate — depends on W-4"],
      ["ohio_income_tax_pct", "Ohio income tax %", "Effective state rate estimate"],
      ["warren_city_tax_pct", "Warren city tax %", "Municipal income tax"],
    ],
  },
];

function TaxEstimatorTab() {
  const [start, setStart] = useState(daysAgoISO(13));
  const [end, setEnd] = useState(todayISO());
  const [data, setData] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tax, setTax] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const loadEstimate = async () => {
    setErr("");
    try {
      const r = await api.get("/admin/payroll/estimate", { params: { start_date: start, end_date: end } });
      setData(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  const loadTax = async () => {
    try {
      const r = await api.get("/admin/payroll-tax-settings");
      setTax(r.data.current);
      setDefaults(r.data.defaults);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { loadTax(); }, []);
  useEffect(() => { loadEstimate(); /* eslint-disable-next-line */ }, [start, end]);

  const saveTax = async () => {
    setSaving(true);
    try { await api.put("/admin/payroll-tax-settings", tax); await loadEstimate(); setSettingsOpen(false); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const resetDefaults = () => setTax({ ...defaults });

  return (
    <div className="space-y-4" data-testid="tax-estimator-tab">
      <div className="bg-shOrange/10 border border-shOrange/40 rounded p-3 text-[13px] text-gray-300" data-testid="tax-disclaimer">
        <i className="fas fa-triangle-exclamation text-shOrange mr-2"/>
        <strong className="text-shOrange">Estimator only.</strong> Sensible 2026 Warren, OH defaults — not a substitute for payroll software (Gusto, QB) or your CPA. Withholding varies by W-4, exemptions, YTD. Verify before issuing checks.
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
          <span className="block mb-1">Period start</span>
          <input type="date" value={start} onChange={(e)=>setStart(e.target.value)} style={{colorScheme:"dark"}}
                 data-testid="tax-start"
                 className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm"/>
        </label>
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
          <span className="block mb-1">Period end</span>
          <input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} style={{colorScheme:"dark"}}
                 data-testid="tax-end"
                 className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm"/>
        </label>
        <button onClick={()=>setSettingsOpen(s=>!s)} data-testid="tax-settings-toggle"
                className="bg-bgPanel border border-bgHover px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300 hover:border-shGreen">
          <i className="fas fa-sliders mr-1"/>Edit Tax Rates
        </button>
      </div>

      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px]">{err}</div>}

      {settingsOpen && tax && (
        <div className="bg-bgPanel border border-shGreen/40 rounded-xl p-4 space-y-4" data-testid="tax-settings-panel">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h4 className="text-white font-black uppercase italic"><i className="fas fa-sliders text-shGreen mr-2"/>Tax & Wage Cap Rates</h4>
            <div className="flex gap-2">
              <button onClick={resetDefaults} data-testid="tax-reset-defaults"
                      className="text-[13px] text-gray-400 hover:text-shOrange font-black uppercase tracking-widest">
                <i className="fas fa-rotate-left mr-1"/>Reset to defaults
              </button>
              <button onClick={saveTax} disabled={saving} data-testid="tax-save"
                      className="bg-shGreen text-bgHeader px-4 py-1.5 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {TAX_FIELD_GROUPS.map(group => (
            <div key={group.label}>
              <p className={`text-[12px] font-black uppercase tracking-widest text-${group.color} mb-2`}>{group.label}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {group.fields.map(([key, label, hint]) => (
                  <label key={key} className="block">
                    <span className="text-[13px] text-gray-300">{label}</span>
                    <input type="number" step="0.01" value={tax[key]}
                           onChange={(e)=>setTax({...tax, [key]: Number(e.target.value)})}
                           data-testid={`tax-${key}`}
                           className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
                    <span className="text-[11px] text-gray-500">{hint}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="tax-totals">
            <TaxKpi label="Gross" value={data.totals.gross} color="white"/>
            <TaxKpi label="Employer burden" value={data.totals.employer_burden} color="shOrange"/>
            <TaxKpi label="TOTAL EMPLOYER COST" value={data.totals.total_cost} color="shGreen" emphasis/>
            <TaxKpi label="Employee withholdings" value={data.totals.employee_withholdings} color="gray-400"/>
            <TaxKpi label="Est. employee take-home" value={data.totals.estimated_take_home} color="shBlue"/>
          </div>

          <div className="bg-bgPanel border border-bgHover rounded-xl p-4 overflow-x-auto">
            <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-calculator text-shGreen mr-2"/>Per-employee breakdown</h4>
            <table className="w-full text-[13px]">
              <thead className="text-[11px] font-black uppercase tracking-widest text-gray-500 border-b border-bgHover">
                <tr>
                  <th className="px-2 py-1.5 text-left">Employee</th>
                  <th className="px-2 py-1.5 text-right">Hours</th>
                  <th className="px-2 py-1.5 text-right">Gross</th>
                  <th className="px-2 py-1.5 text-right text-shOrange">+ Burden</th>
                  <th className="px-2 py-1.5 text-right text-shGreen">= Total Cost</th>
                  <th className="px-2 py-1.5 text-right text-shBlue">Est. Net</th>
                </tr>
              </thead>
              <tbody>
                {data.per_user.map(u => (
                  <tr key={u.user_id} className="border-b border-bgHover/40 hover:bg-bgBase/40" data-testid={`tax-row-${u.user_id}`}>
                    <td className="px-2 py-2">
                      <span className="text-gray-200 font-black">{u.name}</span>
                      <span className="text-gray-500 text-[11px] block">${u.hourly_rate.toFixed(2)}/hr · YTD before period: ${u.ytd_gross_before_period.toFixed(2)}</span>
                    </td>
                    <td className="px-2 py-2 text-right text-gray-300">{u.hours}</td>
                    <td className="px-2 py-2 text-right text-white">${u.gross.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-shOrange" title={`SS ${u.employer_breakdown.social_security.toFixed(2)} · Medicare ${u.employer_breakdown.medicare.toFixed(2)} · FUTA ${u.employer_breakdown.futa.toFixed(2)} · SUTA ${u.employer_breakdown.suta.toFixed(2)} · WC ${u.employer_breakdown.workers_comp.toFixed(2)}`}>
                      ${u.employer_burden.toFixed(2)}
                      <i className="fas fa-circle-info ml-1 text-[10px] opacity-50"/>
                    </td>
                    <td className="px-2 py-2 text-right text-shGreen font-black">${u.total_cost.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-shBlue" title={`SS ${u.employee_breakdown.social_security.toFixed(2)} · Medicare ${u.employee_breakdown.medicare.toFixed(2)} · Fed ${u.employee_breakdown.federal_income_tax.toFixed(2)} · OH ${u.employee_breakdown.ohio_income_tax.toFixed(2)} · Warren ${u.employee_breakdown.warren_city_tax.toFixed(2)}`}>
                      ${u.estimated_take_home.toFixed(2)}
                      <i className="fas fa-circle-info ml-1 text-[10px] opacity-50"/>
                    </td>
                  </tr>
                ))}
                {data.per_user.length === 0 && (
                  <tr><td colSpan="6" className="px-2 py-6 text-center text-gray-500 text-[14px] uppercase font-black tracking-widest">No clocked hours in this period.</td></tr>
                )}
              </tbody>
            </table>
            <p className="text-[12px] text-gray-500 mt-3 italic">{data.disclaimer}</p>
          </div>
        </>
      )}
    </div>
  );
}

function TaxKpi({ label, value, color, emphasis = false }) {
  return (
    <div className={`bg-bgPanel border ${emphasis ? "border-shGreen/40" : "border-bgHover"} rounded-xl p-3 ${emphasis ? "md:col-span-1" : ""}`}>
      <p className={`text-[11px] font-black uppercase tracking-widest text-${color}`}>{label}</p>
      <p className={`text-${emphasis ? "2xl" : "xl"} font-black text-${color} mt-1`}>${value.toFixed(2)}</p>
    </div>
  );
}


// ─── Quarterly Tax Estimate (Sole-Proprietor / Schedule C) ──────────────────
const QUARTERLY_TAX_FIELDS = [
  ["federal_income_pct", "Federal income tax %", "Effective rate — match your bracket"],
  ["state_income_pct", "State income tax %", "Ohio default ~2.75%"],
  ["local_income_pct", "Local income tax %", "Warren city ~2.5%"],
  ["ss_rate_pct", "Social Security % (both halves)", "Default 12.4%"],
  ["medicare_rate_pct", "Medicare % (both halves)", "Default 2.9%"],
  ["se_tax_taxable_pct", "SE taxable %", "IRS default 92.35%"],
  ["ss_wage_base", "SS wage base ($)", "2026 SSA taxable maximum $184,500"],
  ["estimated_payments_made", "Quarterly payments already made ($)", "Legacy field; payment log below wins when used"],
  ["mileage_rate_per_mile", "Mileage rate ($/mile)", "2026 IRS business standard mileage rate $0.725"],
];

function QuarterlyTaxTab() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [payments, setPayments] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [payModal, setPayModal] = useState(null); // {quarter, suggested}
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const confirm = useConfirm();

  const load = async () => {
    setErr("");
    try {
      const [est, s, p] = await Promise.all([
        api.get("/admin/quarterly-tax", { params: { year } }),
        api.get("/admin/quarterly-tax/settings"),
        api.get("/admin/quarterly-tax/payments", { params: { year } }),
      ]);
      setData(est.data);
      setSettings(s.data.current);
      setDefaults(s.data.defaults);
      setPayments(p.data.payments || []);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year]);

  const save = async () => {
    setSaving(true);
    try { await api.put("/admin/quarterly-tax/settings", settings); await load(); setSettingsOpen(false); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const reset = () => setSettings({ ...defaults });

  const deletePayment = async (p) => {
    if (!(await confirm({ title: `Delete payment?`, body: `$${p.amount.toFixed(2)} on ${p.payment_date} (Q${p.quarter})`, confirmText: "Delete", tone: "danger" }))) return;
    try { await api.delete(`/admin/quarterly-tax/payments/${p.id}`); await load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const downloadCpaPdf = async () => {
    try {
      const token = localStorage.getItem("sh_token") || "";
      // Sprint 110di-46 — same-origin safe fallback for self-hosted deploys
      // where REACT_APP_BACKEND_URL may be blank.
      const API_ROOT = process.env.REACT_APP_BACKEND_URL || "";
      const url = `${API_ROOT}/api/admin/quarterly-tax/cpa.pdf?year=${year}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setErr(`PDF download failed (${r.status})`); return; }
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `cpa-tax-summary-${year}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(obj), 5000);
    } catch (e) { setErr(formatErr(e.message)); }
  };

  if (!data) {
    return <div className="text-gray-400 p-6 text-center" data-testid="qt-loading">Loading…</div>;
  }

  const statusColor = (s) => s === "current" ? "shGreen" : s === "past" ? "gray-500" : "shBlue";
  const statusLabel = (s) => s === "current" ? "DUE NEXT" : s === "past" ? "PAST" : "UPCOMING";

  return (
    <div className="space-y-4" data-testid="quarterly-tax-tab">
      <div className="bg-shOrange/10 border border-shOrange/40 rounded p-3 text-[13px] text-gray-300" data-testid="qt-disclaimer">
        <i className="fas fa-triangle-exclamation text-shOrange mr-2"/>
        <strong className="text-shOrange">Sole-Proprietor estimator.</strong> {data.disclaimer}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400">
          <span className="block mb-1">Tax year</span>
          <select value={year} onChange={(e)=>setYear(Number(e.target.value))}
                  data-testid="qt-year"
                  style={{colorScheme:"dark"}}
                  className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm">
            {[0,1,2].map(off => {
              const y = new Date().getFullYear() - off;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
        </label>
        <button onClick={()=>setSettingsOpen(s=>!s)} data-testid="qt-settings-toggle"
                className="bg-bgPanel border border-bgHover px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300 hover:border-shGreen">
          <i className="fas fa-sliders mr-1"/>Edit Rates
        </button>
        <button onClick={downloadCpaPdf} data-testid="qt-cpa-pdf"
                className="bg-shBlue text-bgHeader px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest shadow hover:bg-shBlue/90">
          <i className="fas fa-file-pdf mr-1"/>Send PDF to CPA
        </button>
        <p className="ml-auto text-[12px] text-gray-500 italic">As of {data.as_of}</p>
      </div>

      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px]">{err}</div>}

      {settingsOpen && settings && (
        <div className="bg-bgPanel border border-shGreen/40 rounded-xl p-4 space-y-4" data-testid="qt-settings-panel">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h4 className="text-white font-black uppercase italic"><i className="fas fa-sliders text-shGreen mr-2"/>Tax Rates</h4>
            <div className="flex gap-2">
              <button onClick={reset} data-testid="qt-reset"
                      className="text-[13px] text-gray-400 hover:text-shOrange font-black uppercase tracking-widest">
                <i className="fas fa-rotate-left mr-1"/>Reset to defaults
              </button>
              <button onClick={save} disabled={saving} data-testid="qt-save"
                      className="bg-shGreen text-bgHeader px-4 py-1.5 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {QUARTERLY_TAX_FIELDS.filter(([k]) => k !== "estimated_payments_made").map(([key, label, hint]) => (
              <label key={key} className="block">
                <span className="text-[13px] text-gray-300">{label}</span>
                <input type="number" step="0.01" value={settings[key] ?? 0}
                       onChange={(e)=>setSettings({...settings, [key]: Number(e.target.value)})}
                       data-testid={`qt-field-${key}`}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
                <span className="text-[11px] text-gray-500">{hint}</span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 italic">Tip: log individual quarterly payments below — they automatically reduce your balance owed.</p>
        </div>
      )}

      {/* YTD KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="qt-kpis">
        <TaxKpi label="YTD Gross Income" value={data.income.gross} color="white"/>
        <TaxKpi label="YTD Expenses" value={data.expenses.total} color="shOrange"/>
        <TaxKpi label="Net Profit (Schedule C)" value={data.net_profit} color="shGreen" emphasis/>
        <TaxKpi label="Est. Tax Owed YTD" value={data.balance_owed_ytd} color="shBlue" emphasis/>
      </div>

      {Number(data.income?.sales_tax_collected || 0) > 0 && (
        <div className="bg-shBlue/5 border border-shBlue/40 rounded-xl p-3" data-testid="qt-sales-tax-note">
          <p className="text-[12px] font-black uppercase tracking-widest text-shBlue"><i className="fas fa-receipt mr-1"/>Sales tax separated</p>
          <p className="text-[13px] text-gray-300 mt-1">
            Cash collected before sales tax: <span className="text-white font-black">${data.income.cash_collected_before_sales_tax.toFixed(2)}</span> ·
            sales tax held aside: <span className="text-shOrange font-black">${data.income.sales_tax_collected.toFixed(2)}</span> ·
            Schedule C income uses <span className="text-shGreen font-black">${data.income.gross.toFixed(2)}</span>.
          </p>
        </div>
      )}

      {/* Owner's draw YTD tile — only render when an owner is set */}
      {Number(data.owner_draw_ytd || 0) > 0 && (
        <div className="bg-shBlue/5 border border-shBlue/40 rounded-xl p-3 flex items-baseline gap-3 flex-wrap" data-testid="qt-owner-draw">
          <p className="text-[12px] font-black uppercase tracking-widest text-shBlue">
            <i className="fas fa-crown mr-1"/>Owner's Draw YTD
          </p>
          <p className="text-2xl font-black text-shBlue">${data.owner_draw_ytd.toFixed(2)}</p>
          <p className="text-[12px] text-gray-400">{Number(data.owner_draw_hours || 0).toFixed(1)}h logged this year</p>
          <p className="text-[11px] text-gray-500 ml-auto italic">Excluded from labor expense — owner's draw comes out of net profit.</p>
        </div>
      )}

      {/* Quarterly cards with Mark-Paid CTA */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3" data-testid="qt-quarters">
        {data.quarters.map(q => {
          const fullyPaid = q.paid >= q.suggested_payment && q.suggested_payment > 0;
          return (
            <div key={q.quarter}
                 data-testid={`qt-quarter-${q.quarter}`}
                 className={`bg-bgPanel border rounded-xl p-3 ${q.status === "current" ? "border-shGreen" : "border-bgHover"} ${fullyPaid ? "opacity-90" : ""}`}>
              <div className="flex justify-between items-center">
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Q{q.quarter}</p>
                <span className={`text-[10px] font-black uppercase tracking-widest text-${statusColor(q.status)}`}>{statusLabel(q.status)}</span>
              </div>
              <p className="text-white text-xl font-black mt-1">${q.suggested_payment.toFixed(2)}</p>
              <p className="text-[11px] text-gray-500 mt-1">{q.period}</p>
              <p className={`text-[12px] font-black uppercase tracking-widest text-${statusColor(q.status)} mt-1`}>
                <i className="fas fa-calendar-day mr-1"/>Due {q.due}
              </p>
              {q.paid > 0 && (
                <p className="text-[11px] text-shGreen font-black uppercase tracking-widest mt-1" data-testid={`qt-q${q.quarter}-paid`}>
                  <i className="fas fa-check-circle mr-1"/>${q.paid.toFixed(2)} paid
                  {q.remaining > 0 && <span className="text-gray-500 normal-case ml-1">· ${q.remaining.toFixed(2)} left</span>}
                </p>
              )}
              <button onClick={()=>setPayModal({ quarter: q.quarter, suggested: q.remaining || q.suggested_payment })}
                      data-testid={`qt-q${q.quarter}-mark-paid`}
                      className="mt-2 w-full bg-shGreen/10 border border-shGreen/40 text-shGreen px-2 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shGreen/20">
                {fullyPaid ? <><i className="fas fa-plus mr-1"/>Add payment</> : <><i className="fas fa-check mr-1"/>Mark paid</>}
              </button>
            </div>
          );
        })}
      </div>

      {/* Breakdown table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="qt-income-breakdown">
          <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-arrow-trend-up text-shGreen mr-2"/>Income & Expenses</h4>
          <div className="space-y-1 text-[13px]">
            <Row label="Service bookings" value={data.income.service_bookings}/>
            <Row label="Retail sales" value={data.income.retail_sales}/>
            {Number(data.income?.sales_tax_collected || 0) > 0 && <Row label="Sales tax collected (excluded)" value={data.income.sales_tax_collected} neg/>}
            {Number(data.income?.service_unpaid_balance || 0) > 0 && <Row label="Unpaid service balances (not income yet)" value={data.income.service_unpaid_balance} neg/>}
            <Row label="GROSS INCOME" value={data.income.gross} bold/>
            <div className="border-t border-bgHover my-2"/>
            <Row label="Deductible expenses" value={data.expenses.recorded} neg/>
            {Number(data.expenses?.non_deductible || 0) > 0 && <Row label="Non-deductible / tracked only" value={data.expenses.non_deductible} color="shOrange"/>}
            <Row label="Labor (gross wages)" value={data.expenses.labor_gross} neg/>
            <Row label="Labor (employer burden)" value={data.expenses.labor_burden} neg/>
            {data.expenses.mileage_deduction > 0 && (
              <Row
                label={`Business mileage (${data.expenses.mileage_miles} mi @ $${data.expenses.mileage_rate}/mi)`}
                value={data.expenses.mileage_deduction}
                neg
              />
            )}
            <Row label="TOTAL EXPENSES" value={data.expenses.total} neg bold/>
            <div className="border-t border-bgHover my-2"/>
            <Row label="NET PROFIT" value={data.net_profit} bold color="shGreen"/>
          </div>
        </div>

        <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="qt-tax-breakdown">
          <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-receipt text-shBlue mr-2"/>Tax Breakdown</h4>
          <div className="space-y-1 text-[13px]">
            <p className="text-[11px] font-black uppercase tracking-widest text-shOrange mb-1">Self-Employment Tax</p>
            <Row label={`Social Security (on $${data.se_tax.taxable_base.toFixed(0)})`} value={data.se_tax.social_security}/>
            <Row label="Medicare" value={data.se_tax.medicare}/>
            <Row label="SE TAX TOTAL" value={data.se_tax.total} bold color="shOrange"/>
            <p className="text-[11px] text-gray-500 italic">Half deductible (${data.se_tax.deductible_half.toFixed(2)})</p>
            <div className="border-t border-bgHover my-2"/>
            <p className="text-[11px] font-black uppercase tracking-widest text-shBlue mb-1">Income Tax (on ${data.income_tax.taxable_income.toFixed(0)})</p>
            <Row label={`Federal (${data.settings.federal_income_pct}%)`} value={data.income_tax.federal}/>
            <Row label={`State (${data.settings.state_income_pct}%)`} value={data.income_tax.state}/>
            <Row label={`Local (${data.settings.local_income_pct}%)`} value={data.income_tax.local}/>
            <Row label="INCOME TAX TOTAL" value={data.income_tax.total} bold color="shBlue"/>
            <div className="border-t border-bgHover my-2"/>
            <Row label="TOTAL TAX YTD" value={data.total_tax_ytd} bold color="white"/>
            <Row label="Payments applied" value={data.payments_applied} neg/>
            <Row label="BALANCE OWED" value={data.balance_owed_ytd} bold color="shGreen"/>
          </div>
        </div>
      </div>

      {/* Payment history */}
      <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="qt-payment-history">
        <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-clock-rotate-left text-shGreen mr-2"/>Payment history — {year}</h4>
        {payments.length === 0 ? (
          <p className="text-gray-500 text-sm italic">No payments logged yet for this year. Tap "Mark paid" on any quarter to record one.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="text-[11px] font-black uppercase tracking-widest text-gray-500 border-b border-bgHover">
              <tr>
                <th className="px-2 py-1.5 text-left">Date</th>
                <th className="px-2 py-1.5 text-left">Quarter</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
                <th className="px-2 py-1.5 text-left">Method</th>
                <th className="px-2 py-1.5 text-left">Memo</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-bgHover/40" data-testid={`qt-pay-row-${p.id}`}>
                  <td className="px-2 py-2 text-gray-300">{p.payment_date}</td>
                  <td className="px-2 py-2"><span className="bg-bgBase px-2 py-0.5 rounded text-shBlue text-[11px] font-black">Q{p.quarter}</span></td>
                  <td className="px-2 py-2 text-right text-shGreen font-black">${p.amount.toFixed(2)}</td>
                  <td className="px-2 py-2 text-gray-400 text-[12px]">{p.payment_method}</td>
                  <td className="px-2 py-2 text-gray-400 text-[12px] truncate max-w-[200px]">{p.memo}</td>
                  <td className="px-2 py-2 text-right">
                    <button onClick={()=>deletePayment(p)} data-testid={`qt-pay-delete-${p.id}`}
                            className="text-gray-500 hover:text-red-400 text-[12px]">
                      <i className="fas fa-trash"/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {payModal && (
        <TaxPaymentModal year={year} quarter={payModal.quarter} suggested={payModal.suggested}
                         onClose={()=>setPayModal(null)}
                         onSaved={()=>{ setPayModal(null); load(); }}/>
      )}
    </div>
  );
}

function TaxPaymentModal({ year, quarter, suggested, onClose, onSaved }) {
  const [amount, setAmount] = useState(suggested ? suggested.toFixed(2) : "");
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [method, setMethod] = useState("EFTPS");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!amount || Number(amount) <= 0) { setErr("Enter an amount > 0"); return; }
    setSaving(true);
    try {
      await api.post("/admin/quarterly-tax/payments", {
        year, quarter, amount: Number(amount), payment_date: paymentDate,
        payment_method: method, memo,
      });
      onSaved();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" data-testid="qt-pay-modal" onClick={onClose}>
      <div className="bg-bgPanel border border-shGreen/40 rounded-xl p-5 max-w-md w-full space-y-3" onClick={e=>e.stopPropagation()}>
        <h3 className="text-white font-black uppercase italic text-lg"><i className="fas fa-circle-check text-shGreen mr-2"/>Log Q{quarter} payment</h3>
        <p className="text-[12px] text-gray-500">Tax year {year}</p>

        {err && <div className="text-red-400 bg-red-500/10 rounded p-2 text-[13px]">{err}</div>}

        <label className="block">
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Amount paid ($)</span>
          <input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}
                 data-testid="qt-pay-amount"
                 className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
        </label>
        <label className="block">
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Payment date</span>
          <input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}
                 style={{colorScheme:"dark"}} data-testid="qt-pay-date"
                 className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
        </label>
        <label className="block">
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Method</span>
          <select value={method} onChange={e=>setMethod(e.target.value)} data-testid="qt-pay-method"
                  style={{colorScheme:"dark"}}
                  className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1">
            {["EFTPS","Check","Card","ACH","Other"].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Memo (optional)</span>
          <input type="text" value={memo} onChange={e=>setMemo(e.target.value)} maxLength={120}
                 data-testid="qt-pay-memo"
                 className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} data-testid="qt-pay-cancel"
                  className="bg-bgBase border border-bgHover px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300 hover:border-red-400">
            Cancel
          </button>
          <button onClick={save} disabled={saving} data-testid="qt-pay-save"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
            {saving ? "Saving…" : "Log payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin → Time Off Review ────────────────────────────────────────────────
function TimeOffAdminTab() {
  const [filter, setFilter] = useState("pending");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [reviewModal, setReviewModal] = useState(null); // {req, status}

  const load = async () => {
    setErr("");
    try {
      const params = filter === "all" ? {} : { status: filter };
      const r = await api.get("/admin/time-off", { params });
      setData(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const review = async (req, status, notes) => {
    try { await api.put(`/admin/time-off/${req.id}`, { status, admin_notes: notes || "" }); await load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  if (!data) return <div className="text-gray-400 p-6 text-center">Loading…</div>;

  const statusColor = { pending: "shBlue", approved: "shGreen", rejected: "red-400", cancelled: "gray-500" };

  return (
    <div className="space-y-3" data-testid="timeoff-admin-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[12px] font-black uppercase tracking-widest text-gray-400">Filter:</p>
        {["pending","approved","rejected","cancelled","all"].map(f => (
          <button key={f} onClick={()=>setFilter(f)} data-testid={`timeoff-filter-${f}`}
                  className={`px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest border ${filter===f ? "bg-shGreen text-bgHeader border-shGreen" : "bg-bgPanel border-bgHover text-gray-400 hover:border-shGreen"}`}>
            {f}
          </button>
        ))}
        <p className="ml-auto text-[12px] text-gray-500">
          <i className="fas fa-bell text-shBlue mr-1"/>{data.pending_count} pending
        </p>
      </div>

      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px]">{err}</div>}

      {data.requests.length === 0 && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 text-sm">No requests in this filter.</div>
      )}

      {data.requests.map(r => (
        <div key={r.id} className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid={`timeoff-row-${r.id}`}>
          <div className="flex justify-between items-start flex-wrap gap-2">
            <div>
              <p className="text-white font-black">{r.user_name}</p>
              <p className="text-[12px] text-gray-400">{r.start_date} → {r.end_date} · <span className="capitalize">{r.request_type}</span></p>
              {r.reason && <p className="text-[12px] text-gray-300 mt-1 italic">"{r.reason}"</p>}
              {r.admin_notes && <p className="text-[12px] text-shOrange mt-1">Admin: {r.admin_notes}</p>}
            </div>
            <div className="text-right">
              <span className={`text-[11px] font-black uppercase tracking-widest text-${statusColor[r.status] || "gray-400"}`}>{r.status}</span>
              <p className="text-[11px] text-gray-500 mt-0.5">{(r.created_at||"").slice(0,10)}</p>
            </div>
          </div>
          {r.status === "pending" && (
            <div className="flex gap-2 mt-3">
              <button onClick={()=>setReviewModal({ req: r, status: "approved" })}
                      data-testid={`timeoff-approve-${r.id}`}
                      className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-check mr-1"/>Approve
              </button>
              <button onClick={()=>setReviewModal({ req: r, status: "rejected" })}
                      data-testid={`timeoff-reject-${r.id}`}
                      className="bg-red-500/10 border border-red-400 text-red-300 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-red-500/20">
                <i className="fas fa-xmark mr-1"/>Reject
              </button>
            </div>
          )}
        </div>
      ))}

      {reviewModal && (
        <TimeOffReviewModal req={reviewModal.req} status={reviewModal.status}
                            onClose={()=>setReviewModal(null)}
                            onSaved={(notes)=>{ review(reviewModal.req, reviewModal.status, notes); setReviewModal(null); }}/>
      )}
    </div>
  );
}

function TimeOffReviewModal({ req, status, onClose, onSaved }) {
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" data-testid="timeoff-review-modal" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-xl p-5 max-w-md w-full space-y-3" onClick={e=>e.stopPropagation()}>
        <h3 className="text-white font-black uppercase italic text-lg">
          {status === "approved" ? <><i className="fas fa-check text-shGreen mr-2"/>Approve request</> : <><i className="fas fa-xmark text-red-400 mr-2"/>Reject request</>}
        </h3>
        <p className="text-[12px] text-gray-400">{req.user_name} · {req.start_date} → {req.end_date} · {req.request_type}</p>
        {req.reason && <p className="text-[12px] text-gray-500 italic">Their reason: "{req.reason}"</p>}
        <label className="block">
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Note to employee (optional)</span>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={300} rows={3}
                    data-testid="timeoff-review-notes"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mt-1"/>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} data-testid="timeoff-review-cancel"
                  className="bg-bgBase border border-bgHover px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest text-gray-300 hover:border-red-400">
            Cancel
          </button>
          <button onClick={()=>onSaved(notes)} data-testid="timeoff-review-save"
                  className={`px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest ${status === "approved" ? "bg-shGreen text-bgHeader" : "bg-red-500 text-white"}`}>
            {status === "approved" ? "Approve" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, neg = false, bold = false, color = "" }) {
  const sign = neg ? "-" : "";
  const colorCls = color ? `text-${color}` : (neg ? "text-shOrange" : "text-white");
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-gray-300 ${bold ? "font-black uppercase tracking-widest text-[11px]" : ""}`}>{label}</span>
      <span className={`${colorCls} ${bold ? "font-black" : ""}`}>{sign}${value.toFixed(2)}</span>
    </div>
  );
}



// ─── Money Audit / Sanity Check ─────────────────────────────────────────────
function MoneyAuditTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [start, setStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [end, setEnd] = useState(todayISO());
  const load = async () => {
    setErr("");
    try {
      const r = await api.get("/admin/money-health", { params: { start_date: start, end_date: end } });
      setData(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to load money audit"); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  if (!data) return <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-400" data-testid="money-audit-loading">Loading money audit…</div>;
  const c = data.cash || {};
  const ar = data.receivables || {};
  const cr = data.credits || {};
  const checks = data.checks || [];
  return (
    <div className="space-y-4" data-testid="money-audit-tab">
      <div className="bg-shOrange/10 border border-shOrange/40 rounded p-3 text-[13px] text-gray-300">
        <i className="fas fa-triangle-exclamation text-shOrange mr-2"/>
        This is an owner sanity check, not bookkeeping advice. It separates cash, AR, credits, and sales tax so you can hand cleaner numbers to a CPA.
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400"><span className="block mb-1">Start</span><input type="date" value={start} onChange={e=>setStart(e.target.value)} style={{colorScheme:"dark"}} className="bg-bgPanel border border-bgHover rounded px-3 py-2 text-white"/></label>
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400"><span className="block mb-1">End</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)} style={{colorScheme:"dark"}} className="bg-bgPanel border border-bgHover rounded px-3 py-2 text-white"/></label>
        <button onClick={load} className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest"><i className="fas fa-rotate mr-1"/>Refresh</button>
        {err && <span className="text-red-400 text-[13px] font-black">{err}</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <AuditTile label="Cash collected" value={c.gross_collected_before_sales_tax} color="text-white"/>
        <AuditTile label="Schedule C income" value={c.schedule_c_income} color="text-shGreen"/>
        <AuditTile label="Sales tax held" value={c.sales_tax_collected} color="text-shOrange"/>
        <AuditTile label="Booking AR" value={ar.booking_balance_due_in_window} color="text-shBlue"/>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
          <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-cash-register text-shGreen mr-2"/>Cash breakdown</h4>
          <div className="space-y-1 text-[13px]">
            <Row label="Service collected before sales tax" value={c.service_collected_before_sales_tax || 0}/>
            <Row label="Retail/pack/program collected before sales tax" value={c.retail_collected_before_sales_tax || 0}/>
            <Row label="Sales tax held aside" value={c.sales_tax_collected || 0} neg/>
            <Row label="Schedule C income estimate" value={c.schedule_c_income || 0} bold color="shGreen"/>
          </div>
        </div>
        <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
          <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-ticket text-shBlue mr-2"/>Credits & AR</h4>
          <div className="space-y-1 text-[13px]">
            <Row label="Credit pack cash sales" value={cr.credit_pack_cash_sales_in_window || 0}/>
            <Row label="Training program cash sales" value={cr.training_program_cash_sales_in_window || 0}/>
            <Row label="Credit value redeemed" value={cr.credit_value_redeemed_in_window || 0} neg/>
            <Row label="Daycare credits outstanding" value={cr.daycare_credits_outstanding || 0}/>
            <Row label="Boarding credits outstanding" value={cr.boarding_credits_outstanding || 0}/>
            <Row label="Client account balance owed" value={ar.client_account_balance_owed_all_time || 0} bold color="shOrange"/>
          </div>
        </div>
      </div>
      <div className="bg-bgPanel border border-bgHover rounded-xl p-4" data-testid="money-audit-checks">
        <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-stethoscope text-shOrange mr-2"/>Sanity checks</h4>
        <div className="space-y-2">
          {checks.map(ch => (
            <div key={ch.key} className={`rounded border p-3 ${ch.ok ? "bg-shGreen/10 border-shGreen/40" : ch.severity === "danger" ? "bg-red-500/10 border-red-500/40" : "bg-shOrange/10 border-shOrange/40"}`}>
              <p className={`text-[12px] font-black uppercase tracking-widest ${ch.ok ? "text-shGreen" : ch.severity === "danger" ? "text-red-300" : "text-shOrange"}`}>
                <i className={`fas ${ch.ok ? "fa-circle-check" : "fa-triangle-exclamation"} mr-1`}/>{ch.label}
              </p>
              <p className="text-[13px] text-gray-300 mt-1">{ch.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditTile({ label, value = 0, color = "text-white" }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-xl font-black mt-1 ${color}`}>${Number(value || 0).toFixed(2)}</p>
    </div>
  );
}

function CountTile({ label, value = 0, color = "text-white" }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-xl font-black mt-1 ${color}`}>{Number(value || 0)}</p>
    </div>
  );
}


// ─── Register / POS / Cash Drawer ─────────────────────────────────────────
export function RegisterTab() {
  const [date, setDate] = useState(todayISO());
  const [liveToday, setLiveToday] = useState(todayISO());
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [active, setActive] = useState(() => {
    try {
      const wanted = localStorage.getItem("sh_register_default_tab");
      if (wanted) {
        localStorage.removeItem("sh_register_default_tab");
        return wanted;
      }
    } catch { /* ignore */ }
    return "overview";
  });
  const [openingCash, setOpeningCash] = useState("");
  const [notes, setNotes] = useState("");
  const [openingOverrideReason, setOpeningOverrideReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [clients, setClients] = useState([]);
  const [packs, setPacks] = useState([]);
  const [sale, setSale] = useState({ description: "", quantity: "1", unit_price: "", amount: "", category: "Misc Sale", payment_method: "clover", client_id: "", notes: "", apply_tax: false });
  const [packSale, setPackSale] = useState({ client_id: "", pack_id: "", quantity: "1", payment_method: "clover", amount_paid: "", note: "" });
  const [payment, setPayment] = useState({ client_id: "", amount: "", method: "clover", notes: "" });
  const [refund, setRefund] = useState({ client_id: "", amount: "", payment_method: "clover", reason: "", notes: "" });
  const [payout, setPayout] = useState({ amount: "", description: "", category: "Supplies", vendor: "", notes: "", tax_deductible: true });
  const [tillAdjustment, setTillAdjustment] = useState({ direction: "remove", amount: "", adjustment_type: "owner_draw", reason: "", notes: "" });
  const [closeout, setCloseout] = useState({ cash_counted: "", clover_batch: "", venmo_total: "", paypal_total: "", check_total: "", notes: "" });
  const [closeoutReview, setCloseoutReview] = useState(false);
  const [reportStart, setReportStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [reportEnd, setReportEnd] = useState(todayISO());
  const [reportData, setReportData] = useState(null);
  const [expenseRows, setExpenseRows] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [expenseReceiptPreview, setExpenseReceiptPreview] = useState(null);
  const [expenseUploadBusy, setExpenseUploadBusy] = useState(false);
  const blankExpense = { description: "", quantity: "1", unit_price: "", amount: "", category: "Cleaning supplies", payment_method: "clover", vendor: "", notes: "", tax_deductible: true, from_cash_drawer: false, recurring: false, recurring_interval: "monthly", receipt_image: "", receipt_filename: "" };
  const [expense, setExpense] = useState(blankExpense);

  const methodOptions = [
    ["cash", "Cash"], ["check", "Check"], ["venmo", "Venmo"], ["paypal", "PayPal"], ["clover", "Clover / Credit Card"], ["other", "Other"],
  ];
  const methodLabelMap = Object.fromEntries(methodOptions);
  const _prettyMethod = (m) => methodLabelMap[m] || m || "Other";

  const load = async () => {
    setErr("");
    try {
      const r = await api.get("/admin/register/day", { params: { date } });
      setData(r.data);
      if (r.data?.drawer_session?.opening_cash != null) setOpeningCash(String(r.data.drawer_session.opening_cash));
      else if (r.data?.totals?.opening_cash != null) setOpeningCash(String(r.data.totals.opening_cash));
      setOpeningOverrideReason(r.data?.opening_rollover?.is_override ? (r.data?.opening_rollover?.override_reason || "") : "");
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to load register"); }
  };
  const loadChoices = async () => {
    try {
      const [c, p] = await Promise.all([
        api.get("/clients"),
        api.get("/credit-packs", { params: { include_inactive: false } }),
      ]);
      setClients((c.data || []).filter(x => !x.archived).sort((a,b)=>(a.name||"").localeCompare(b.name||"")));
      setPacks((p.data || []).filter(x => x.active !== false));
    } catch {}
  };
  const loadExpenseChoices = async () => {
    try {
      const r = await api.get("/expenses/categories");
      setExpenseCategories(r.data?.categories || []);
    } catch {}
  };
  const loadExpenses = async () => {
    try {
      const r = await api.get("/expenses", { params: { start_date: date, end_date: date } });
      setExpenseRows(r.data || []);
    } catch {}
  };
  useEffect(() => { loadChoices(); loadExpenseChoices(); }, []);
  useEffect(() => { load(); loadExpenses(); /* eslint-disable-next-line */ }, [date]);
  useEffect(() => {
    const syncBusinessDay = () => {
      const nowDay = todayISO();
      if (nowDay === liveToday) return;
      // If the register was left on the live day overnight, advance it. Keep
      // deliberately selected historical dates untouched.
      setDate(current => current === liveToday ? nowDay : current);
      setReportEnd(current => current === liveToday ? nowDay : current);
      setLiveToday(nowDay);
      setOpeningCash("");
      setOpeningOverrideReason("");
    };
    const timer = setInterval(syncBusinessDay, 60000);
    window.addEventListener("focus", syncBusinessDay);
    return () => { clearInterval(timer); window.removeEventListener("focus", syncBusinessDay); };
  }, [liveToday]);

  const selectedClient = (id) => clients.find(c => c.id === id);
  const selectedPack = packs.find(p => p.id === packSale.pack_id);
  const saleQty = Math.max(1, Number(sale.quantity || 1));
  const saleUnit = Number(sale.unit_price || 0);
  const saleLineTotal = saleUnit > 0 ? saleQty * saleUnit : Number(sale.amount || 0);
  const expenseQty = Math.max(1, Number(expense.quantity || 1));
  const expenseUnit = Number(expense.unit_price || 0);
  const expenseLineTotal = expenseUnit > 0 ? expenseQty * expenseUnit : Number(expense.amount || 0);
  const packQty = Math.max(1, Number(packSale.quantity || 1));
  const packOrderTotal = selectedPack ? Number(selectedPack.price || 0) * packQty : 0;
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const moneyOrMissing = (n) => n === null || n === undefined ? "Not entered" : money(n);
  const suggestedOpening = data?.opening_rollover?.suggested_cash;
  const openingOverride = suggestedOpening != null && openingCash !== "" && Math.abs(Number(openingCash) - Number(suggestedOpening)) > 0.005;
  const closeoutExpectedCash = Number(data?.totals?.expected_cash || 0);
  const closeoutCountedCash = closeout.cash_counted === "" ? null : Number(closeout.cash_counted);
  const closeoutOverShort = closeoutCountedCash == null || !Number.isFinite(closeoutCountedCash) ? null : closeoutCountedCash - closeoutExpectedCash;
  const showDone = (text) => { setMsg(text); setErr(""); load(); setTimeout(()=>setMsg(""), 5000); };
  const submit = async (fn) => {
    setErr(""); setMsg("");
    try { await fn(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail) || "Register action failed"); }
  };

  const openDrawer = () => submit(async () => {
    const r = await api.post("/admin/register/open-drawer", { date, opening_cash: Number(openingCash || 0), notes, opening_override_reason: openingOverrideReason });
    setData(r.data.register); setNotes(""); setOpeningOverrideReason(""); showDone("Opening drawer saved.");
  });

  const reopenDay = () => submit(async () => {
    if (reopenReason.trim().length < 3) throw new Error("Enter a reason for reopening the register.");
    const r = await api.post("/admin/register/reopen-day", { date, reason: reopenReason.trim() });
    setData(r.data.register); setReopenReason(""); showDone("Register reopened. Save a fresh closeout after corrections.");
  });
  const submitSale = () => submit(async () => {
    const qty = Math.max(1, Number(sale.quantity || 1));
    const unitPrice = Number(sale.unit_price || 0);
    const totalAmount = unitPrice > 0 ? qty * unitPrice : Number(sale.amount || 0);
    await api.post("/retail-sales", {
      date,
      description: sale.description,
      quantity: qty,
      unit_price: unitPrice > 0 ? unitPrice : null,
      amount: Number(totalAmount || 0),
      category: sale.category || "Misc Sale",
      payment_method: sale.payment_method,
      client_id: sale.client_id || null,
      notes: sale.notes,
      apply_tax: !!sale.apply_tax,
    });
    setSale({ description: "", quantity: "1", unit_price: "", amount: "", category: "Misc Sale", payment_method: sale.payment_method, client_id: sale.client_id, notes: "", apply_tax: false });
    showDone("Sale logged in the Register.");
  });
  const submitPackSale = () => submit(async () => {
    const body = {
      items: [{ pack_id: packSale.pack_id, quantity: Math.max(1, Number(packSale.quantity || 1)) }],
      payment_method: packSale.payment_method,
      note: packSale.note,
    };
    if (packSale.amount_paid !== "") body.amount_paid = Number(packSale.amount_paid || 0);
    await api.post(`/clients/${packSale.client_id}/sell-packs`, body);
    setPackSale({ client_id: packSale.client_id, pack_id: "", quantity: "1", payment_method: packSale.payment_method, amount_paid: "", note: "" });
    showDone("Credit pack(s) sold and added to the Register.");
    loadChoices();
  });
  const submitPayment = () => submit(async () => {
    await api.post(`/clients/${payment.client_id}/payment`, { amount: Number(payment.amount || 0), method: payment.method, notes: payment.notes });
    setPayment({ client_id: payment.client_id, amount: "", method: payment.method, notes: "" });
    showDone("Client payment recorded.");
    loadChoices();
  });
  const submitRefund = () => submit(async () => {
    await api.post("/admin/register/refund", { date, amount: Number(refund.amount || 0), payment_method: refund.payment_method, client_id: refund.client_id || null, reason: refund.reason, notes: refund.notes });
    setRefund({ client_id: refund.client_id, amount: "", payment_method: refund.payment_method, reason: "", notes: "" });
    showDone("Refund recorded and deducted from Register totals.");
  });
  const submitPayout = () => submit(async () => {
    await api.post("/admin/register/cash-payout", { date, amount: Number(payout.amount || 0), description: payout.description, category: payout.category, vendor: payout.vendor, notes: payout.notes, tax_deductible: !!payout.tax_deductible });
    setPayout({ amount: "", description: "", category: payout.category, vendor: "", notes: "", tax_deductible: true });
    showDone("Cash payout logged as an expense and removed from expected drawer.");
    loadExpenses();
  });
  const submitTillAdjustment = () => submit(async () => {
    await api.post("/admin/register/till-adjustment", {
      date,
      direction: tillAdjustment.direction,
      amount: Number(tillAdjustment.amount || 0),
      adjustment_type: tillAdjustment.adjustment_type,
      reason: tillAdjustment.reason,
      notes: tillAdjustment.notes,
    });
    setTillAdjustment({ ...tillAdjustment, amount: "", reason: "", notes: "" });
    showDone(`Till adjustment saved: cash ${tillAdjustment.direction === "add" ? "added" : "removed"}.`);
  });
  const submitExpense = () => submit(async () => {
    const qty = Math.max(1, Number(expense.quantity || 1));
    const unitPrice = Number(expense.unit_price || 0);
    const totalAmount = unitPrice > 0 ? qty * unitPrice : Number(expense.amount || 0);
    await api.post("/expenses", {
      date,
      description: expense.description,
      quantity: qty,
      unit_price: unitPrice > 0 ? unitPrice : null,
      amount: Number(totalAmount || 0),
      category: expense.category,
      payment_method: expense.from_cash_drawer ? "cash" : expense.payment_method,
      vendor: expense.vendor,
      notes: expense.notes,
      tax_deductible: !!expense.tax_deductible,
      from_cash_drawer: !!expense.from_cash_drawer,
      recurring: !!expense.recurring,
      recurring_interval: expense.recurring_interval || "monthly",
      receipt_image: expense.receipt_image || "",
      receipt_filename: expense.receipt_filename || "",
    });
    setExpense({ ...blankExpense, category: expense.category, payment_method: expense.payment_method });
    showDone("Expense logged and included in Register reports.");
    loadExpenseChoices();
    loadExpenses();
  });
  const onExpenseReceiptFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExpenseUploadBusy(true);
    try {
      if (file.type.startsWith("image/")) {
        const compressed = await compressImage(file, { maxWidth: 1400, maxHeight: 1800, quality: 0.78 });
        setExpense(x => ({ ...x, receipt_image: compressed, receipt_filename: file.name }));
      } else if (file.type === "application/pdf") {
        if (file.size > 2500000) { setErr("PDF receipt is over 2.5 MB. Please compress it first."); return; }
        const reader = new FileReader();
        reader.onload = () => setExpense(x => ({ ...x, receipt_image: reader.result, receipt_filename: file.name }));
        reader.readAsDataURL(file);
      } else {
        setErr("Receipt must be a JPG/PNG image or PDF.");
      }
    } catch (ex) { setErr(ex.message || "Receipt upload failed"); }
    finally { setExpenseUploadBusy(false); e.target.value = ""; }
  };
  const reviewCloseout = () => {
    if (closeout.cash_counted === "" || !Number.isFinite(Number(closeout.cash_counted)) || Number(closeout.cash_counted) < 0) {
      setErr("Actual cash counted is required. Enter 0.00 if the drawer is intentionally empty.");
      return;
    }
    setErr("");
    setCloseoutReview(true);
  };
  const submitCloseout = () => submit(async () => {
    const counted = Number(closeout.cash_counted);
    await api.post("/admin/end-of-day/closeout", {
      cash_counted: counted,
      rollover_confirmed: true,
      confirmed_rollover_cash: counted,
      clover_batch: closeout.clover_batch === "" ? null : Number(closeout.clover_batch),
      venmo_total: closeout.venmo_total === "" ? null : Number(closeout.venmo_total),
      paypal_total: closeout.paypal_total === "" ? null : Number(closeout.paypal_total),
      check_total: closeout.check_total === "" ? null : Number(closeout.check_total),
      notes: closeout.notes,
    });
    setCloseout({ cash_counted: "", clover_batch: "", venmo_total: "", paypal_total: "", check_total: "", notes: "" });
    setCloseoutReview(false);
    showDone(`Closeout saved. ${money(counted)} will carry forward.`);
  });

  const loadReports = async () => {
    setErr("");
    try {
      const r = await api.get("/admin/register/range", { params: { start_date: reportStart, end_date: reportEnd } });
      setReportData(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to load register reports"); }
  };
  const downloadRegisterCsv = async (kind) => {
    try {
      const token = localStorage.getItem("sh_token") || "";
      const API_ROOT = process.env.REACT_APP_BACKEND_URL || "";
      const qs = new URLSearchParams({ kind, start_date: reportStart, end_date: reportEnd }).toString();
      const r = await fetch(`${API_ROOT}/api/admin/register/export.csv?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setErr(`CSV download failed (${r.status})`); return; }
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `sit-happens-${kind}-${reportStart}-to-${reportEnd}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(obj), 5000);
    } catch (e) { setErr(formatErr(e.message) || "CSV download failed"); }
  };
  const downloadTaxPacket = async () => {
    try {
      const token = localStorage.getItem("sh_token") || "";
      const API_ROOT = process.env.REACT_APP_BACKEND_URL || "";
      const qs = new URLSearchParams({ start_date: reportStart, end_date: reportEnd }).toString();
      const r = await fetch(`${API_ROOT}/api/admin/register/tax-packet.zip?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setErr(`Tax packet download failed (${r.status})`); return; }
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `sit-happens-tax-packet-${reportStart}-to-${reportEnd}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(obj), 5000);
    } catch (e) { setErr(formatErr(e.message) || "Tax packet download failed"); }
  };

  const totals = data?.totals || {};
  const incoming = data?.incoming_by_method || {};
  const sources = data?.incoming_sources || {};
  const activity = data?.activity || [];

  const methodSelect = (value, setter) => (
    <RegisterSelect label="Payment method" value={value} onChange={setter}>
      {methodOptions.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
    </RegisterSelect>
  );
  const clientSelect = (value, setter, allowBlank=true) => (
    <RegisterSelect label="Client" value={value} onChange={setter}>
      {allowBlank && <option value="">No client / walk-in</option>}
      {clients.map(c => <option key={c.id} value={c.id}>{c.name}{Number(c.account_balance || 0) ? ` · balance ${money(c.account_balance)}` : ""}</option>)}
    </RegisterSelect>
  );

  return (
    <div className="space-y-4" data-testid="register-tab">
      <div className="bg-shBlue/10 border border-shBlue/40 rounded p-3 text-[13px] text-gray-300">
        <i className="fas fa-cash-register text-shBlue mr-2"/>
        One money hub for sales, expenses, till adjustments, receipts, closeouts, tax packet exports, and reconciliation warnings.
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-black uppercase tracking-widest text-gray-400"><span className="block mb-1">Register date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{colorScheme:"dark"}} className="bg-bgPanel border border-bgHover rounded px-3 py-2 text-white"/></label>
        <button onClick={load} className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest"><i className="fas fa-rotate mr-1"/>Refresh</button>
        {msg && <span className="text-shGreen text-[13px] font-black">{msg}</span>}
        {err && <span className="text-red-400 text-[13px] font-black">{err}</span>}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-bgHover/70">
        {[
          ["overview", "Today", "fa-chart-pie"], ["sale", "New Sale", "fa-cart-plus"], ["pack", "Sell Credits", "fa-ticket"],
          ["payment", "Record Payment", "fa-hand-holding-dollar"], ["refund", "Refund", "fa-rotate-left"], ["adjustment", "Till Adjustment", "fa-scale-balanced"], ["payout", "Cash Expense", "fa-money-bill-transfer"], ["expenses", "Expenses", "fa-receipt"], ["closeout", "Close Day", "fa-clipboard-check"], ["reports", "Reports", "fa-file-csv"],
        ].map(([k,l,i]) => <button key={k} onClick={()=>setActive(k)} className={`shrink-0 px-3 py-2 text-[12px] font-black uppercase tracking-widest border-b-2 ${active===k ? "border-shGreen text-shGreen" : "border-transparent text-gray-400 hover:text-white"}`} data-testid={`register-mode-${k}`}><i className={`fas ${i} mr-1.5`}/>{l}</button>)}
      </div>

      {data?.register_closed && (
        <div className="bg-shGreen/10 border border-shGreen/40 rounded-xl p-4 space-y-3" data-testid="register-closed-banner">
          <div>
            <p className="text-white font-black uppercase tracking-widest"><i className="fas fa-lock text-shGreen mr-2"/>Register closed for {date}</p>
            <p className="text-[12px] text-gray-400 mt-1">Counted {moneyOrMissing(data.latest_closeout?.cash_counted)}. New sales, payments, refunds, expenses, and till adjustments are locked until this day is reopened.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={reopenReason} onChange={e=>setReopenReason(e.target.value)} placeholder="Reason for reopening · required"
                   className="flex-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-white text-sm"/>
            <button onClick={reopenDay} disabled={reopenReason.trim().length < 3}
                    className="bg-shOrange text-bgHeader px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
              <i className="fas fa-lock-open mr-1"/>Reopen Day
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <AuditTile label="Net incoming" value={totals.net_incoming_total ?? totals.incoming_total} color="text-shGreen"/>
        <AuditTile label="Cash drawer" value={totals.expected_cash} color="text-white"/>
        <AuditTile label="Clover/card" value={incoming.clover} color="text-shBlue"/>
        <AuditTile label="Venmo + PayPal" value={Number(incoming.venmo || 0) + Number(incoming.paypal || 0)} color="text-shGreen"/>
        <AuditTile label="Refunds" value={sources.refunds} color="text-red-300"/>
      </div>

      {active === "overview" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
              <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-door-open text-shGreen mr-2"/>Cash drawer</h4>
              <p className="text-[12px] text-gray-500 mb-3">Opening source: <span className="text-gray-300 font-bold">{data?.opening_cash_source || "—"}</span></p>
              {data?.opening_rollover?.recovered_stale_opening && (
                <div className="mb-3 bg-shOrange/10 border border-shOrange/40 rounded-lg p-3" data-testid="register-opening-recovered">
                  <p className="text-[10px] font-black uppercase tracking-widest text-shOrange">Stale opening amount corrected</p>
                  <p className="text-[12px] text-gray-300 mt-1">The saved ${Number(data.opening_rollover.recorded_stale_cash || 0).toFixed(2)} opening did not have a valid override reason, so the register restored the confirmed ${Number(suggestedOpening || 0).toFixed(2)} rollover.</p>
                </div>
              )}
              {suggestedOpening != null && (
                <div className="mb-3 bg-bgBase/70 border border-shGreen/30 rounded-lg p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-shGreen">Previous closeout · {data?.opening_rollover?.from_date}</p>
                  <p className="text-xl text-white font-black">{money(suggestedOpening)}</p>
                  <p className="text-[11px] text-gray-500">Suggested opening from the last confirmed cash count.</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <RegisterFormInput label="Opening cash" type="number" step="0.01" value={openingCash} onChange={v=>{setOpeningCash(v); setOpeningOverrideReason("");}}/>
                <RegisterFormInput label="Note" value={notes} onChange={setNotes} placeholder="optional"/>
                <button onClick={openDrawer} disabled={data?.register_closed || (openingOverride && openingOverrideReason.trim().length < 3)} className="bg-shGreen disabled:opacity-50 text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-lock-open mr-1"/>Set opening</button>
              </div>
              {openingOverride && (
                <div className="mt-3 bg-shOrange/10 border border-shOrange/40 rounded-lg p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-shOrange">Reason for changing opening cash · required</p>
                  <input value={openingOverrideReason} onChange={e=>setOpeningOverrideReason(e.target.value)} placeholder="Bank deposit, owner removal, recount, correction…"
                         className="mt-1 w-full bg-bgBase border border-shOrange/50 rounded px-3 py-2 text-white text-sm"/>
                </div>
              )}
              <div className="mt-4 space-y-1 text-[13px]">
                <Row label="Opening cash" value={totals.opening_cash || 0}/>
                <Row label="Cash payments/refunds" value={totals.cash_in || 0}/>
                <Row label="Cash expense payouts" value={totals.cash_drawer_payouts || 0} neg/>
                <Row label="Till cash added" value={totals.till_additions || 0}/>
                <Row label="Till cash removed" value={totals.till_removals || 0} neg/>
                <Row label="Net till adjustments" value={totals.till_adjustment_net || 0} color={Number(totals.till_adjustment_net || 0) === 0 ? undefined : Number(totals.till_adjustment_net || 0) > 0 ? "shGreen" : "shOrange"}/>
                <Row label="Expected cash drawer" value={totals.expected_cash || 0} bold color="shGreen"/>
                {totals.actual_cash_counted != null && <Row label="Last closeout counted" value={totals.actual_cash_counted || 0}/>} 
                {totals.cash_over_short != null && <Row label="Over / short" value={totals.cash_over_short || 0} color={totals.cash_over_short === 0 ? "shGreen" : "shOrange"}/>} 
              </div>
            </div>
            <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
              <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-money-bill-transfer text-shBlue mr-2"/>Expected by payment method</h4>
              <div className="space-y-1 text-[13px]">
                <Row label="Cash" value={incoming.cash || 0}/>
                <Row label="Clover / Credit Card" value={incoming.clover || 0}/>
                <Row label="Venmo" value={incoming.venmo || 0}/>
                <Row label="PayPal" value={incoming.paypal || 0}/>
                <Row label="Checks" value={incoming.check || 0}/>
                {(incoming.venmo_paypal || 0) > 0 && <Row label="Legacy transfer" value={incoming.venmo_paypal || 0}/>} 
                <Row label="Other" value={incoming.other || 0}/>
              </div>
            </div>
          </div>
          <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
            <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-list-check text-shOrange mr-2"/>Where the money came from</h4>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <AuditTile label="Booking payments" value={sources.booking_payments}/>
              <AuditTile label="Manual sales" value={sources.manual_sales}/>
              <AuditTile label="Credit packs" value={sources.credit_pack_sales}/>
              <AuditTile label="Training programs" value={sources.training_program_sales}/>
              <AuditTile label="Tab payments" value={sources.tab_payments}/>
              <AuditTile label="Refunds" value={sources.refunds} color="text-red-300"/>
            </div>
          </div>
          <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
            <h4 className="text-white font-black uppercase italic mb-3"><i className="fas fa-receipt text-shGreen mr-2"/>Recent register activity</h4>
            <div className="divide-y divide-bgHover/50 max-h-[420px] overflow-auto">
              {activity.length === 0 && <div className="text-gray-500 text-sm p-4 text-center">No register activity for this date yet.</div>}
              {activity.map((a,idx) => (
                <div key={`${a.id || idx}-${a.kind}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="text-white font-black">{a.label} <span className="text-gray-500 font-normal">· {a.description}</span></p>
                    <p className="text-[12px] text-gray-500">{a.client_name || "—"} · {a.payment_method || "other"}</p>
                  </div>
                  <p className={`font-black ${Number(a.amount || 0) < 0 ? "text-red-300" : "text-shGreen"}`}>{money(a.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {active === "sale" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-3">
        <h4 className="text-white font-black uppercase italic"><i className="fas fa-cart-plus text-shGreen mr-2"/>New Sale</h4>
        <p className="text-[12px] text-gray-500">Use this for merch, misc services, deposits, or any sale that did not start from a booking.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <RegisterFormInput label="Description" value={sale.description} onChange={v=>setSale({...sale, description:v})} placeholder="Leash, merch, deposit, misc service"/>
          <RegisterFormInput label="Quantity" type="number" step="1" value={sale.quantity} onChange={v=>setSale({...sale, quantity:v})} placeholder="1"/>
          <RegisterFormInput label="Price each" type="number" step="0.01" value={sale.unit_price} onChange={v=>setSale({...sale, unit_price:v})} placeholder="Use for items like 2 leashes"/>
          <RegisterFormInput label="Amount collected" type="number" step="0.01" value={sale.amount} onChange={v=>setSale({...sale, amount:v})} placeholder={saleUnit > 0 ? `auto = ${money(saleLineTotal)}` : "total sale amount"}/>
          {methodSelect(sale.payment_method, v=>setSale({...sale, payment_method:v}))}
          <RegisterFormInput label="Category" value={sale.category} onChange={v=>setSale({...sale, category:v})}/>
          {clientSelect(sale.client_id, v=>setSale({...sale, client_id:v}), true)}
          <RegisterFormInput label="Notes" value={sale.notes} onChange={v=>setSale({...sale, notes:v})}/>
        </div>
        <div className="bg-bgBase/70 border border-bgHover rounded p-3 text-[13px] text-gray-300">
          <span className="font-black text-white">Sale total:</span> {saleUnit > 0 ? `${saleQty} × ${money(saleUnit)} = ${money(saleLineTotal)}` : money(saleLineTotal)}
          <span className="block text-[11px] text-gray-500 mt-1">For items, enter quantity and price each. For a one-off service/deposit, you can just enter Amount collected.</span>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-gray-300"><input type="checkbox" checked={!!sale.apply_tax} onChange={e=>setSale({...sale, apply_tax:e.target.checked})}/> Apply configured retail sales tax to this total</label>
        <button disabled={!sale.description || !Number(saleLineTotal)} onClick={submitSale} className="bg-shGreen disabled:opacity-50 text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Log sale</button>
      </div>}

      {active === "pack" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-3">
        <h4 className="text-white font-black uppercase italic"><i className="fas fa-ticket text-shBlue mr-2"/>Sell Credit Pack</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {clientSelect(packSale.client_id, v=>setPackSale({...packSale, client_id:v}), false)}
          <RegisterSelect label="Credit pack / single-day credit" value={packSale.pack_id} onChange={v=>setPackSale({...packSale, pack_id:v})}>
            <option value="">Choose pack…</option>{packs.map(p => <option key={p.id} value={p.id}>{p.name} · {p.qty} {p.service_type} · {money(p.price)}</option>)}
          </RegisterSelect>
          <RegisterFormInput label="Quantity to sell" type="number" step="1" value={packSale.quantity} onChange={v=>setPackSale({...packSale, quantity:v})} placeholder="1"/>
          {methodSelect(packSale.payment_method, v=>setPackSale({...packSale, payment_method:v}))}
          <RegisterFormInput label="Amount paid today" type="number" step="0.01" value={packSale.amount_paid} onChange={v=>setPackSale({...packSale, amount_paid:v})} placeholder={selectedPack ? `blank = ${money(packOrderTotal)}` : "blank = full price"}/>
          <RegisterFormInput label="Note" value={packSale.note} onChange={v=>setPackSale({...packSale, note:v})}/>
        </div>
        {selectedPack && <div className="bg-bgBase/70 border border-bgHover rounded p-3 text-[13px] text-gray-300 space-y-1">
          <div><span className="font-black text-white">Credits added:</span> {packQty * Number(selectedPack.qty || 0)} {selectedPack.service_type || "service"} credits</div>
          <div><span className="font-black text-white">Order total:</span> {packQty} × {money(selectedPack.price)} = {money(packOrderTotal)}</div>
          <div className="text-[11px] text-gray-500">Leave amount paid blank for full payment, or enter partial payment to put the rest on the client balance.</div>
        </div>}
        <button disabled={!packSale.client_id || !packSale.pack_id || !packQty} onClick={submitPackSale} className="bg-shGreen disabled:opacity-50 text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Sell credit order</button>
      </div>}

      {active === "payment" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-3">
        <h4 className="text-white font-black uppercase italic"><i className="fas fa-hand-holding-dollar text-shGreen mr-2"/>Record Client Payment</h4>
        <p className="text-[12px] text-gray-500">Use this for a client paying an account balance/tab outside a booking checkout.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {clientSelect(payment.client_id, v=>setPayment({...payment, client_id:v}), false)}
          <RegisterFormInput label="Amount paid" type="number" step="0.01" value={payment.amount} onChange={v=>setPayment({...payment, amount:v})}/>
          {methodSelect(payment.method, v=>setPayment({...payment, method:v}))}
          <RegisterFormInput label="Notes" value={payment.notes} onChange={v=>setPayment({...payment, notes:v})} placeholder="Balance payment, deposit, etc."/>
        </div>
        {selectedClient(payment.client_id) && <p className="text-[12px] text-gray-400">Current balance for {selectedClient(payment.client_id).name}: <span className="font-black text-white">{money(selectedClient(payment.client_id).account_balance)}</span></p>}
        <button disabled={!payment.client_id || !Number(payment.amount)} onClick={submitPayment} className="bg-shGreen disabled:opacity-50 text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Record payment</button>
      </div>}

      {active === "refund" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-3">
        <h4 className="text-white font-black uppercase italic"><i className="fas fa-rotate-left text-red-300 mr-2"/>Issue Refund</h4>
        <p className="text-[12px] text-gray-500">This records money leaving the business and reduces Register/tax income for the day. It does not delete the original booking/sale.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <RegisterFormInput label="Refund amount" type="number" step="0.01" value={refund.amount} onChange={v=>setRefund({...refund, amount:v})}/>
          {methodSelect(refund.payment_method, v=>setRefund({...refund, payment_method:v}))}
          {clientSelect(refund.client_id, v=>setRefund({...refund, client_id:v}), true)}
          <RegisterFormInput label="Reason" value={refund.reason} onChange={v=>setRefund({...refund, reason:v})} placeholder="Cancellation refund, overcharge, etc."/>
          <RegisterFormInput label="Notes" value={refund.notes} onChange={v=>setRefund({...refund, notes:v})}/>
        </div>
        <button disabled={!Number(refund.amount) || !refund.reason} onClick={submitRefund} className="bg-red-500 disabled:opacity-50 text-white px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Record refund</button>
      </div>}

      {active === "adjustment" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-4" data-testid="register-till-adjustment-tab">
        <div>
          <h4 className="text-white font-black uppercase italic"><i className="fas fa-scale-balanced text-shBlue mr-2"/>Till Adjustment</h4>
          <p className="text-[12px] text-gray-500 mt-1">Use this when cash physically enters or leaves the drawer outside of a sale, refund, or business expense. Owner draws belong here. Every adjustment requires a reason and changes drawer reconciliation only.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <RegisterSelect label="Cash movement" value={tillAdjustment.direction} onChange={v=>setTillAdjustment({...tillAdjustment, direction:v})}>
            <option value="add">Add cash to till</option>
            <option value="remove">Remove cash from till</option>
          </RegisterSelect>
          <RegisterSelect label="Adjustment type" value={tillAdjustment.adjustment_type} onChange={v=>setTillAdjustment({...tillAdjustment, adjustment_type:v, direction: v === "owner_draw" || v === "bank_deposit" ? "remove" : tillAdjustment.direction})}>
            <option value="owner_draw">Owner draw</option>
            <option value="change_fund">Add/remove change fund</option>
            <option value="bank_deposit">Bank deposit</option>
            <option value="cash_correction">Cash count correction</option>
            <option value="other">Other adjustment</option>
          </RegisterSelect>
          <RegisterFormInput label="Amount" type="number" step="0.01" value={tillAdjustment.amount} onChange={v=>setTillAdjustment({...tillAdjustment, amount:v})} placeholder="0.00"/>
          <RegisterFormInput label="Reason (required)" value={tillAdjustment.reason} onChange={v=>setTillAdjustment({...tillAdjustment, reason:v})} placeholder="Owner draw, added change, bank deposit, correction..."/>
          <RegisterFormInput label="Notes" value={tillAdjustment.notes} onChange={v=>setTillAdjustment({...tillAdjustment, notes:v})} placeholder="optional details"/>
        </div>
        <div className={`rounded-xl border p-3 text-[13px] ${tillAdjustment.direction === "add" ? "bg-shGreen/10 border-shGreen/40 text-shGreen" : "bg-shOrange/10 border-shOrange/40 text-shOrange"}`}>
          <i className={`fas ${tillAdjustment.direction === "add" ? "fa-plus" : "fa-minus"} mr-2`}/>
          This will {tillAdjustment.direction === "add" ? "increase" : "decrease"} expected drawer cash by <strong>{money(tillAdjustment.amount)}</strong>. It will not change sales income or business expenses.
        </div>
        <button disabled={!Number(tillAdjustment.amount) || !tillAdjustment.reason.trim()} onClick={submitTillAdjustment} className={`${tillAdjustment.direction === "add" ? "bg-shGreen" : "bg-shOrange"} disabled:opacity-50 text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest`} data-testid="save-till-adjustment"><i className="fas fa-save mr-1"/>Save till adjustment</button>
      </div>}

      {active === "payout" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-3">
        <h4 className="text-white font-black uppercase italic"><i className="fas fa-money-bill-transfer text-shOrange mr-2"/>Cash Business Expense</h4>
        <p className="text-[12px] text-gray-500">Use this only when cash from the drawer paid a real business expense. For owner draws, bank deposits, change funds, or corrections, use Till Adjustment instead.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <RegisterFormInput label="Amount" type="number" step="0.01" value={payout.amount} onChange={v=>setPayout({...payout, amount:v})}/>
          <RegisterFormInput label="Description" value={payout.description} onChange={v=>setPayout({...payout, description:v})} placeholder="Poop bags, cleaner, etc."/>
          <RegisterFormInput label="Category" value={payout.category} onChange={v=>setPayout({...payout, category:v})}/>
          <RegisterFormInput label="Vendor" value={payout.vendor} onChange={v=>setPayout({...payout, vendor:v})}/>
          <RegisterFormInput label="Notes" value={payout.notes} onChange={v=>setPayout({...payout, notes:v})}/>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-gray-300"><input type="checkbox" checked={!!payout.tax_deductible} onChange={e=>setPayout({...payout, tax_deductible:e.target.checked})}/> Mark as tax deductible</label>
        <button disabled={!Number(payout.amount) || !payout.description} onClick={submitPayout} className="bg-shOrange disabled:opacity-50 text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Log cash payout</button>
      </div>}

      {active === "expenses" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-4" data-testid="register-expenses-tab">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-white font-black uppercase italic"><i className="fas fa-receipt text-red-300 mr-2"/>Expenses & Receipts</h4>
            <p className="text-[12px] text-gray-500 mt-1">Use this for money going out. If it came from the drawer, check “paid out of cash drawer” so closeout math stays right.</p>
          </div>
          <button onClick={loadExpenses} className="bg-bgBase border border-bgHover text-gray-300 px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest"><i className="fas fa-rotate mr-1"/>Refresh</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <RegisterFormInput label="Description" value={expense.description} onChange={v=>setExpense({...expense, description:v})} placeholder="Kibble, cleaner, software, etc."/>
          <RegisterFormInput label="Vendor / store" value={expense.vendor} onChange={v=>setExpense({...expense, vendor:v})} placeholder="Chewy, Tractor Supply, Clover, etc."/>
          <RegisterFormInput label="Category" value={expense.category} onChange={v=>setExpense({...expense, category:v})}>
            <input list="register-expense-categories" value={expense.category} onChange={e=>setExpense({...expense, category:e.target.value})} className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
          </RegisterFormInput>
          <datalist id="register-expense-categories">{expenseCategories.map(c => <option key={c} value={c}/>)}</datalist>
          <RegisterFormInput label="Quantity" type="number" step="0.01" value={expense.quantity} onChange={v=>setExpense({...expense, quantity:v})}/>
          <RegisterFormInput label="Price each" type="number" step="0.01" value={expense.unit_price} onChange={v=>setExpense({...expense, unit_price:v, amount:""})} placeholder="optional"/>
          <RegisterFormInput label="Total amount" type="number" step="0.01" value={expense.unit_price ? expenseLineTotal.toFixed(2) : expense.amount} onChange={v=>setExpense({...expense, amount:v})} placeholder="or enter total"/>
          {methodSelect(expense.from_cash_drawer ? "cash" : expense.payment_method, v=>setExpense({...expense, payment_method:v, from_cash_drawer: v === "cash" ? expense.from_cash_drawer : false}))}
          <RegisterFormInput label="Notes" value={expense.notes} onChange={v=>setExpense({...expense, notes:v})}/>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="flex items-center gap-2 bg-bgBase border border-bgHover rounded p-2 text-[13px] text-gray-300"><input type="checkbox" checked={!!expense.tax_deductible} onChange={e=>setExpense({...expense, tax_deductible:e.target.checked})}/> Tax deductible</label>
          <label className="flex items-center gap-2 bg-bgBase border border-shOrange/40 rounded p-2 text-[13px] text-gray-300"><input type="checkbox" checked={!!expense.from_cash_drawer} onChange={e=>setExpense({...expense, from_cash_drawer:e.target.checked, payment_method:e.target.checked ? "cash" : expense.payment_method})}/> Paid out of cash drawer</label>
          <label className="flex items-center gap-2 bg-bgBase border border-bgHover rounded p-2 text-[13px] text-gray-300"><input type="checkbox" checked={!!expense.recurring} onChange={e=>setExpense({...expense, recurring:e.target.checked})}/> Recurring</label>
        </div>
        {expense.recurring && <div className="max-w-xs"> <RegisterSelect label="Recurring interval" value={expense.recurring_interval} onChange={v=>setExpense({...expense, recurring_interval:v})}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></RegisterSelect></div>}
        <div className="bg-bgBase/50 border border-bgHover rounded-xl p-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-paperclip mr-1"/>Receipt</p>
              <p className="text-[12px] text-gray-500">JPG/PNG auto-compressed or PDF up to 2.5 MB.</p>
            </div>
            <label className="bg-bgPanel border border-bgHover text-gray-300 hover:text-white px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest cursor-pointer">
              <i className={`fas ${expenseUploadBusy ? "fa-spinner fa-spin" : "fa-upload"} mr-1`}/>{expense.receipt_image ? "Replace receipt" : "Attach receipt"}
              <input type="file" accept="image/*,application/pdf" capture="environment" onChange={onExpenseReceiptFile} className="hidden"/>
            </label>
          </div>
          {expense.receipt_image && <div className="mt-3 flex items-center gap-3 text-sm">
            {expense.receipt_image.startsWith("data:application/pdf") ? <i className="fas fa-file-pdf text-red-300 text-2xl"/> : <button onClick={()=>setExpenseReceiptPreview(expense.receipt_image)} className="w-14 h-14 rounded overflow-hidden border border-bgHover"><img src={expense.receipt_image} alt="receipt" className="w-full h-full object-cover"/></button>}
            <div className="flex-1 min-w-0"><p className="text-white font-bold truncate">{expense.receipt_filename || "receipt"}</p><p className="text-gray-500 text-[12px]">Attached to this expense</p></div>
            <button onClick={()=>setExpense({...expense, receipt_image:"", receipt_filename:""})} className="text-red-300 text-[11px] font-black uppercase tracking-widest"><i className="fas fa-trash mr-1"/>Remove</button>
          </div>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[13px] text-gray-400">Expense total: <span className="text-white font-black">{money(expenseLineTotal)}</span>{expense.from_cash_drawer && <span className="text-shOrange font-black ml-2">will reduce expected cash drawer</span>}</div>
          <button disabled={!expense.description || !Number(expenseLineTotal)} onClick={submitExpense} className="bg-red-500/20 disabled:opacity-50 text-red-300 border border-red-500/40 px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Log expense</button>
        </div>
        <div className="bg-bgBase/70 border border-bgHover rounded-xl p-4">
          <h5 className="text-white font-black uppercase italic mb-2"><i className="fas fa-list text-shGreen mr-2"/>Expenses for {date}</h5>
          <div className="divide-y divide-bgHover/50 max-h-[280px] overflow-auto">
            {expenseRows.length === 0 && <p className="text-gray-500 text-sm p-3 text-center">No expenses logged for this date.</p>}
            {expenseRows.map(e => <div key={e.id} className="py-2 flex items-start justify-between gap-3 text-sm">
              <div><p className="text-white font-black">{e.description}</p><p className="text-[12px] text-gray-500">{e.vendor || "—"} · {e.category || "Other"} · {_prettyMethod(e.payment_method)}{e.from_cash_drawer ? " · cash drawer" : ""}{e.receipt_image ? " · receipt" : ""}</p></div>
              <p className="font-black text-red-300">-{money(e.amount)}</p>
            </div>)}
          </div>
        </div>
        {expenseReceiptPreview && <div className="fixed inset-0 bg-black/90 z-[90] flex items-center justify-center p-4" onClick={()=>setExpenseReceiptPreview(null)}><img src={expenseReceiptPreview} alt="receipt preview" className="max-h-[calc(var(--app-height)_-_2rem)] max-w-[92vw] rounded shadow-2xl" onClick={e=>e.stopPropagation()}/><button onClick={()=>setExpenseReceiptPreview(null)} className="absolute top-4 right-6 text-white/70 hover:text-white text-3xl"><i className="fas fa-times"/></button></div>}
      </div>}

      {active === "closeout" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-white font-black uppercase italic"><i className="fas fa-clipboard-check text-shGreen mr-2"/>Close Day</h4>
            <p className="text-[12px] text-gray-500">Count the physical drawer, review the difference, and confirm the exact amount that opens the next business day.</p>
          </div>
          {!data?.register_closed && <button onClick={()=>{setCloseout({...closeout, cash_counted: closeoutExpectedCash.toFixed(2)}); setCloseoutReview(false);}} className="bg-bgBase border border-shGreen/40 text-shGreen px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest">Use expected {money(closeoutExpectedCash)}</button>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <AuditTile label="Expected cash" value={totals.expected_cash}/>
          <AuditTile label="Expected Clover" value={incoming.clover}/>
          <AuditTile label="Expected Venmo" value={incoming.venmo}/>
          <AuditTile label="Expected PayPal" value={incoming.paypal}/>
          <AuditTile label="Expected checks" value={incoming.check}/>
        </div>
        {data?.register_closed ? (
          <div className="bg-shGreen/10 border border-shGreen/40 rounded-xl p-4">
            <p className="text-white font-black uppercase tracking-widest"><i className="fas fa-circle-check text-shGreen mr-2"/>Closeout saved</p>
            <p className="text-[13px] text-gray-400 mt-1">Actual cash counted: <span className="text-white font-black">{moneyOrMissing(data.latest_closeout?.cash_counted)}</span>. Reopen the day above before changing anything.</p>
          </div>
        ) : (<>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <RegisterFormInput label="Actual cash counted · required" type="number" step="0.01" value={closeout.cash_counted} onChange={v=>{setCloseout({...closeout, cash_counted:v});setCloseoutReview(false);}}/>
            <RegisterFormInput label="Clover batch total" type="number" step="0.01" value={closeout.clover_batch} onChange={v=>{setCloseout({...closeout, clover_batch:v});setCloseoutReview(false);}}/>
            <RegisterFormInput label="Venmo verified total" type="number" step="0.01" value={closeout.venmo_total} onChange={v=>{setCloseout({...closeout, venmo_total:v});setCloseoutReview(false);}}/>
            <RegisterFormInput label="PayPal verified total" type="number" step="0.01" value={closeout.paypal_total} onChange={v=>{setCloseout({...closeout, paypal_total:v});setCloseoutReview(false);}}/>
            <RegisterFormInput label="Checks in drawer" type="number" step="0.01" value={closeout.check_total} onChange={v=>{setCloseout({...closeout, check_total:v});setCloseoutReview(false);}}/>
            <RegisterFormInput label="Closeout notes" value={closeout.notes} onChange={v=>{setCloseout({...closeout, notes:v});setCloseoutReview(false);}}/>
          </div>
          {closeoutOverShort != null && <div className={`border rounded-lg p-3 ${Math.abs(closeoutOverShort) < 0.005 ? "bg-shGreen/10 border-shGreen/30" : "bg-shOrange/10 border-shOrange/40"}`}><p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Live over / short</p><p className={`text-xl font-black ${Math.abs(closeoutOverShort) < 0.005 ? "text-shGreen" : "text-shOrange"}`}>{closeoutOverShort >= 0 ? "+" : "-"}{money(Math.abs(closeoutOverShort))}</p></div>}
          {!closeoutReview ? (
            <button onClick={reviewCloseout} disabled={closeout.cash_counted === ""} className="bg-shGreen disabled:opacity-50 text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-magnifying-glass mr-1"/>Review closeout</button>
          ) : (
            <div className="bg-bgBase border-2 border-shGreen/50 rounded-xl p-4 space-y-3">
              <p className="text-white font-black uppercase tracking-widest"><i className="fas fa-shield-check text-shGreen mr-2"/>Final confirmation</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <AuditTile label="Expected drawer" value={closeoutExpectedCash}/>
                <AuditTile label="Actual counted" value={closeoutCountedCash}/>
                <AuditTile label="Over / short" value={closeoutOverShort}/>
              </div>
              <div className="bg-shGreen/10 border border-shGreen/30 rounded-lg p-3 text-center"><p className="text-[10px] font-black uppercase tracking-widest text-shGreen">Opening next business day</p><p className="text-2xl text-white font-black">{money(closeoutCountedCash)}</p></div>
              <div className="flex flex-col sm:flex-row gap-2"><button onClick={()=>setCloseoutReview(false)} className="bg-bgPanel border border-bgHover text-gray-300 px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest">Go back</button><button onClick={submitCloseout} className="flex-1 bg-shGreen text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-lock mr-1"/>Confirm & carry {money(closeoutCountedCash)} forward</button></div>
            </div>
          )}
        </>)}
      </div>}


      {active === "reports" && <div className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-4" data-testid="register-reports-tab">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-white font-black uppercase italic"><i className="fas fa-file-csv text-shBlue mr-2"/>Reports, Exports & Warnings</h4>
            <p className="text-[12px] text-gray-500 mt-1">Register-first reporting: payment methods, closeouts, exports, and sanity warnings from the same money sources shown on the dashboard.</p>
          </div>
          <button onClick={loadReports} className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest"><i className="fas fa-rotate mr-1"/>Run report</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <RegisterFormInput label="Start date" type="date" value={reportStart} onChange={setReportStart}/>
          <RegisterFormInput label="End date" type="date" value={reportEnd} onChange={setReportEnd}/>
          <div className="flex flex-wrap gap-2">
            {[ ["activity","Activity"], ["payment-methods","Methods"], ["closeouts","Closeouts"], ["expenses","Expenses"], ["till-adjustments","Till adjustments"], ["tax-summary","Tax summary"] ].map(([k,l]) => (
              <button key={k} onClick={()=>downloadRegisterCsv(k)} className="bg-bgBase border border-bgHover text-gray-300 hover:text-white px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest"><i className="fas fa-download mr-1"/>{l}</button>
            ))}
            <button onClick={downloadTaxPacket} className="bg-shGreen text-bgHeader px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest"><i className="fas fa-file-zipper mr-1"/>Tax packet</button>
          </div>
        </div>
        {!reportData && <div className="text-gray-500 text-sm p-4 text-center border border-bgHover rounded bg-bgBase/40">Run the report to see range totals, closeout history, and warnings.</div>}
        {reportData && <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <AuditTile label="Gross collected" value={reportData.totals?.incoming_total}/>
            <AuditTile label="Refunds" value={reportData.totals?.refund_total} color="text-red-300"/>
            <AuditTile label="Expenses" value={reportData.totals?.expense_total} color="text-shOrange"/>
            <AuditTile label="Till net" value={reportData.totals?.till_adjustment_net} color="text-shBlue"/>
            <AuditTile label="Credit packs" value={reportData.incoming_sources?.credit_pack_sales}/>
            <CountTile label="Closeouts" value={(reportData.closeouts || []).length}/>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-bgBase/70 border border-bgHover rounded-xl p-4">
              <h5 className="text-white font-black uppercase italic mb-2"><i className="fas fa-triangle-exclamation text-shOrange mr-2"/>Sanity warnings</h5>
              <div className="space-y-2 max-h-[320px] overflow-auto">
                {(reportData.alerts || []).length === 0 && <p className="text-shGreen text-sm font-black"><i className="fas fa-circle-check mr-1"/>No register warnings in this range.</p>}
                {(reportData.alerts || []).map((a,idx) => (
                  <div key={idx} className={`rounded border p-3 ${a.severity === "danger" ? "bg-red-500/10 border-red-500/40" : "bg-shOrange/10 border-shOrange/40"}`}>
                    <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">{a.date} · {a.type}</p>
                    <p className="text-[13px] text-gray-300 mt-1">{a.message}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-bgBase/70 border border-bgHover rounded-xl p-4">
              <h5 className="text-white font-black uppercase italic mb-2"><i className="fas fa-clipboard-check text-shGreen mr-2"/>Closeout history</h5>
              <div className="space-y-2 max-h-[320px] overflow-auto">
                {(reportData.closeouts || []).length === 0 && <p className="text-gray-500 text-sm">No saved closeouts in this range.</p>}
                {(reportData.closeouts || []).map((c,idx) => {
                  const deltas = c.deltas || {};
                  return <div key={`${c.date}-${idx}`} className="border border-bgHover rounded p-3 text-sm">
                    <div className="flex justify-between gap-2"><p className="text-white font-black">{c.date}</p><p className={`text-[10px] font-black uppercase tracking-widest ${c.status === "reopened" ? "text-shOrange" : "text-shGreen"}`}>{c.status || "closed"}</p></div>
                    <p className="text-[11px] text-gray-500 mt-1">Closed by {c.created_by_name || "—"}</p>
                    <p className="text-[12px] text-gray-400 mt-1">Cash {moneyOrMissing(c.cash_counted)} · Clover {moneyOrMissing(c.clover_batch)} · Venmo {moneyOrMissing(c.venmo_total)} · PayPal {moneyOrMissing(c.paypal_total)} · Checks {moneyOrMissing(c.check_total)}</p>
                    {c.expected_cash != null && <p className="text-[11px] text-gray-500 mt-1">Expected {money(c.expected_cash)} · Over/short {money(c.cash_over_short || 0)} · Rollover {moneyOrMissing(c.rollover_cash)}</p>}
                    {Object.keys(deltas).length > 0 && <p className="text-[11px] text-gray-500 mt-1">Diffs: {Object.entries(deltas).map(([m,row]) => `${m} ${money(row.delta)}`).join(" · ")}</p>}
                    {c.status === "reopened" && <p className="text-[12px] text-shOrange mt-1"><i className="fas fa-lock-open mr-1"/>Reopened by {c.reopened_by_name || "—"}: {c.reopened_reason || "No reason recorded"}</p>}
                    {c.notes && <p className="text-[12px] text-gray-500 italic mt-1">{c.notes}</p>}
                  </div>;
                })}
              </div>
            </div>
          </div>
        </>}
      </div>}
    </div>
  );
}


// ─── Owner's Draw drill-down (sole-prop self-pay tracker) ──────────────────
function OwnerDrawCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/admin/owner/draw-summary");
        if (r.data?.owner) setData(r.data);
      } catch {}
    })();
  }, []);
  if (!data) return null;
  const o = data.owner;
  return (
    <div className="bg-shBlue/5 border border-shBlue/40 rounded-xl p-4" data-testid="owner-draw-card">
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <p className="text-[13px] font-black uppercase tracking-widest text-shBlue">
          <i className="fas fa-crown mr-2"/>Owner's Draw · {o.name}
        </p>
        <p className="text-[11px] text-gray-500 normal-case italic">${o.hourly_rate.toFixed(2)}/hr · excluded from payroll taxes &amp; 1099/W2</p>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-3">
        {[
          ["today", "Today"],
          ["month", "This month"],
          ["year", "YTD"],
        ].map(([key, label]) => (
          <div key={key} className="bg-bgPanel border border-bgHover rounded p-3" data-testid={`owner-draw-${key}`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
            <p className="text-xl font-black text-shBlue mt-1">${data[key].draw.toFixed(2)}</p>
            <p className="text-[12px] text-gray-400">{data[key].hours.toFixed(2)}h</p>
          </div>
        ))}
      </div>
    </div>
  );
}



// ─────────────── Sprint 110cn — Punch Correction admin inbox ───────────────
function PunchCorrectionsAdminTab() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [decidingId, setDecidingId] = useState(null);
  const [note, setNote] = useState("");
  const load = async () => {
    try {
      const r = await api.get("/employee/punch-corrections");
      setRows(r.data || []);
    } catch { setRows([]); }
  };
  useEffect(() => { load(); }, []);
  const decide = async (id, decision) => {
    try {
      await api.post(`/employee/punch-corrections/${id}/decision`, { decision, admin_note: note });
      setNote(""); setDecidingId(null); load();
    } catch { /* toast already shown by axios interceptor */ }
  };
  const shown = (rows || []).filter(r => filter === "all" || r.status === filter);
  return (
    <div className="space-y-3" data-testid="corrections-admin-tab">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Punch correction requests</p>
        <div className="flex gap-1 ml-auto">
          {["pending", "approved", "denied", "all"].map(s => (
            <button key={s} onClick={()=>setFilter(s)}
                    data-testid={`corr-filter-${s}`}
                    className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-widest border ${filter===s ? "bg-shGreen text-bgHeader border-shGreen" : "bg-bgBase text-gray-400 border-bgHover hover:text-white"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {rows === null && <p className="text-gray-500 text-sm">Loading…</p>}
      {rows !== null && shown.length === 0 && <p className="text-gray-500 text-sm" data-testid="corr-empty">No {filter !== "all" ? filter : ""} requests.</p>}
      {shown.map(r => (
        <div key={r.id} className="bg-bgPanel border border-bgHover rounded-xl p-4 space-y-2" data-testid={`corr-row-${r.id}`}>
          <div className="flex justify-between items-start gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-white font-black uppercase tracking-widest text-[14px]">{r.user_name}</p>
              <p className="text-[12px] text-gray-400">Target date: <span className="text-gray-200">{r.target_date}</span></p>
              {r.requested_clock_in && <p className="text-[12px] text-gray-400">Clock in → <span className="text-gray-200">{fmtTime(r.requested_clock_in)}</span></p>}
              {r.requested_clock_out && <p className="text-[12px] text-gray-400">Clock out → <span className="text-gray-200">{fmtTime(r.requested_clock_out)}</span></p>}
              <p className="text-[12px] text-gray-400 italic mt-1">&ldquo;{r.reason}&rdquo;</p>
            </div>
            <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${r.status==="pending" ? "text-shOrange border-shOrange/40 bg-shOrange/15" : r.status==="approved" ? "text-shGreen border-shGreen/40 bg-shGreen/15" : "text-red-300 border-red-500/40 bg-red-600/15"}`}>
              {r.status}
            </span>
          </div>
          {r.admin_note && <p className="text-[12px] text-gray-500">Admin: {r.admin_note}</p>}
          {r.status === "pending" && (
            decidingId === r.id ? (
              <div className="flex gap-2 pt-2 flex-wrap">
                <input value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Note (optional, sent to staff)"
                       data-testid={`corr-note-${r.id}`}
                       className="flex-1 min-w-[200px] bg-bgBase border border-bgHover rounded px-2 py-1 text-xs text-white"/>
                <button onClick={()=>decide(r.id, "approved")} data-testid={`corr-approve-${r.id}`}
                        className="bg-shGreen text-bgHeader px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">Approve</button>
                <button onClick={()=>decide(r.id, "denied")} data-testid={`corr-deny-${r.id}`}
                        className="bg-red-600/20 border border-red-500 text-red-300 px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">Deny</button>
                <button onClick={()=>{setDecidingId(null); setNote("");}}
                        className="text-gray-500 hover:text-white text-[11px] font-black uppercase tracking-widest">Cancel</button>
              </div>
            ) : (
              <button onClick={()=>setDecidingId(r.id)} data-testid={`corr-review-${r.id}`}
                      className="text-shBlue hover:text-white text-[11px] font-black uppercase tracking-widest">
                <i className="fas fa-gavel mr-1"/>Review
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
