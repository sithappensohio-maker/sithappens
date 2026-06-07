// Admin → Staff screen.
// Manage employees (CRUD), view all timecards, override clock entries.
import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import PageHero from "../components/PageHero";
import { todayISO, daysAgoISO } from "../lib/date";

function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
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
  const [subtab, setSubtab] = useState("employees");
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

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-bgHover overflow-x-auto" data-testid="staff-subtabs">
        {[
          ["employees", "Employees", "fa-users"],
          ["timecards", "Timecards", "fa-clock"],
          ["schedule", "Schedule", "fa-calendar-week"],
          ["tasks", "Tasks", "fa-list-check"],
          ["payroll", "Payroll", "fa-file-csv"],
          ["taxes", "Payroll Tax", "fa-calculator"],
          ["quarterly", "Quarterly Tax", "fa-file-invoice-dollar"],
          ["timeoff", "Time Off", "fa-umbrella-beach"],
          ["corrections", "Corrections", "fa-clock-rotate-left"],
        ].map(([k, label, icon]) => (
          <button key={k} onClick={()=>setSubtab(k)} data-testid={`staff-subtab-${k}`}
                  className={`shrink-0 px-3 py-2 text-[13px] font-black uppercase tracking-widest border-b-2 transition ${subtab===k ? "border-shGreen text-shGreen" : "border-transparent text-gray-400 hover:text-white"}`}>
            <i className={`fas ${icon} mr-1.5`}/>{label}
          </button>
        ))}
      </div>

      {subtab === "employees" && (<>

      {/* Owner's Draw drill-down — only shown when an owner is configured */}
      <OwnerDrawCard/>

      {/* Employee list */}
      <div className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden" data-testid="staff-list">
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
      <div className="bg-bgPanel border border-bgHover rounded-xl p-5 space-y-4" data-testid="timecard-viewer">
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
      {subtab === "timeoff" && <TimeOffAdminTab />}
      {subtab === "corrections" && <PunchCorrectionsAdminTab />}

      {modal && <EmployeeFormModal mode={modal.mode} emp={modal.emp}
                                  onClose={()=>setModal(null)}
                                  onSaved={()=>{ setModal(null); loadEmployees(); }} />}
      {editingEntry && <TimeClockEditModal entry={editingEntry}
                                          onClose={()=>setEditingEntry(null)}
                                          onSaved={()=>{ setEditingEntry(null); loadTimecards(); }}/>}
    </div>
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
  ["ss_wage_base", "SS wage base ($)", "2026 estimate $176,100"],
  ["estimated_payments_made", "Quarterly payments already made ($)", "Subtracted from YTD owed"],
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
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/admin/quarterly-tax/cpa.pdf?year=${year}`;
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
            <Row label="GROSS INCOME" value={data.income.gross} bold/>
            <div className="border-t border-bgHover my-2"/>
            <Row label="Recorded expenses" value={data.expenses.recorded} neg/>
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
