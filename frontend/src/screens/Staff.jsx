// Admin → Staff screen.
// Manage employees (CRUD), view all timecards, override clock entries.
import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

function todayISO() { return new Date().toISOString().split("T")[0]; }
function daysAgoISO(n) { return new Date(Date.now() - n*86400000).toISOString().split("T")[0]; }
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

  const loadEmployees = async () => {
    try { const r = await api.get("/admin/employees"); setEmployees(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  const loadTimecards = async () => {
    try {
      const params = { start_date: start, end_date: end };
      if (userFilter) params.user_id = userFilter;
      const r = await api.get("/admin/time-clock", { params });
      setTcData(r.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };
  useEffect(() => { loadEmployees(); }, []);
  useEffect(() => { loadTimecards(); /* eslint-disable-next-line */ }, [start, end, userFilter]);

  const deactivate = async (emp) => {
    if (!(await confirm({ title: `Deactivate ${emp.name}?`, body: "They won't be able to log in. Past time entries are preserved.", confirmText: "Deactivate", tone: "danger" }))) return;
    await api.delete(`/admin/employees/${emp.id}`);
    loadEmployees();
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="staff-screen">
      {err && <div className="text-red-400 bg-red-500/10 rounded p-3 text-[14px] font-black uppercase tracking-widest">{err}</div>}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight"><i className="fas fa-users-gear text-shGreen mr-2"/>Staff</h3>
          <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">Employees, schedules, time clock</p>
        </div>
        <button onClick={()=>setModal({ mode: "new" })} data-testid="staff-new-btn"
                className="bg-shGreen text-black px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/80">
          <i className="fas fa-plus mr-1"/>Add Employee
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-bgHover overflow-x-auto" data-testid="staff-subtabs">
        {[
          ["employees", "Employees", "fa-users"],
          ["timecards", "Timecards", "fa-clock"],
          ["schedule", "Schedule", "fa-calendar-week"],
          ["tasks", "Tasks", "fa-list-check"],
          ["payroll", "Payroll", "fa-file-csv"],
        ].map(([k, label, icon]) => (
          <button key={k} onClick={()=>setSubtab(k)} data-testid={`staff-subtab-${k}`}
                  className={`shrink-0 px-3 py-2 text-[13px] font-black uppercase tracking-widest border-b-2 transition ${subtab===k ? "border-shGreen text-shGreen" : "border-transparent text-gray-400 hover:text-white"}`}>
            <i className={`fas ${icon} mr-1.5`}/>{label}
          </button>
        ))}
      </div>

      {subtab === "employees" && (<>

      {/* Employee list */}
      <div className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden" data-testid="staff-list">
        {employees.length === 0 && (
          <div className="p-10 text-center text-gray-500 text-sm font-black uppercase tracking-widest">No employees yet. Click "Add Employee" to get started.</div>
        )}
        <div className="divide-y divide-bgHover/40">
          {employees.map(e => (
            <div key={e.id} className="p-4 flex items-center justify-between gap-3 flex-wrap" data-testid={`staff-row-${e.id}`}>
              <div className="min-w-0 flex-1">
                <p className="text-base font-black text-white">
                  {e.name}
                  {!e.active && <span className="ml-2 text-[11px] font-black uppercase tracking-widest bg-red-500/15 text-red-300 px-2 py-0.5 rounded">Inactive</span>}
                </p>
                <p className="text-[13px] text-gray-400">{e.email}{e.phone ? ` · ${e.phone}` : ""}</p>
                <p className="text-[12px] text-gray-500 mt-1">${e.hourly_rate.toFixed(2)}/hr{e.last_login_at ? ` · last login ${fmtTime(e.last_login_at)}` : " · never logged in"}</p>
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
          ))}
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
