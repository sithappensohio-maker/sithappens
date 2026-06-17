/* Sprint 110ew — Phase 6: Audit Log
   Filterable timeline of every admin/staff write. */
import { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import PageHero from "../components/PageHero";

const ACTION_META = {
  // Bookings
  booking_created:        { label: "Booking created",     icon: "fa-calendar-plus",  color: "text-shGreen" },
  booking_edited:         { label: "Booking edited",      icon: "fa-pen",            color: "text-shBlue" },
  booking_deleted:        { label: "Booking deleted",     icon: "fa-trash",          color: "text-red-300" },
  booking_canceled:       { label: "Booking canceled",    icon: "fa-ban",            color: "text-red-300" },
  booking_approved:       { label: "Booking approved",    icon: "fa-check",          color: "text-shGreen" },
  booking_denied:         { label: "Booking denied",      icon: "fa-xmark",          color: "text-red-300" },
  booking_completed:      { label: "Booking completed",   icon: "fa-flag-checkered", color: "text-shGreen" },
  booking_checked_in:     { label: "Checked in",          icon: "fa-arrow-down",     color: "text-shGreen" },
  booking_checked_out:    { label: "Checked out",         icon: "fa-arrow-up",       color: "text-gray-400" },
  booking_status_changed: { label: "Booking action",      icon: "fa-shuffle",        color: "text-shBlue" },
  care_logged:            { label: "Care action",         icon: "fa-bowl-food",      color: "text-shGreen" },
  care_completed:         { label: "Care completed",      icon: "fa-check",          color: "text-shGreen" },
  care_skipped:           { label: "Care skipped",        icon: "fa-forward",        color: "text-purple-300" },
  care_reset:             { label: "Care reset",          icon: "fa-rotate-left",    color: "text-gray-400" },
  // Dogs
  dog_created:            { label: "Dog created",         icon: "fa-paw",            color: "text-shGreen" },
  dog_edited:             { label: "Dog edited",          icon: "fa-pen",            color: "text-shBlue" },
  dog_deleted:            { label: "Dog deleted",         icon: "fa-trash",          color: "text-red-300" },
  safety_flags_changed:   { label: "Safety flags",        icon: "fa-shield-halved",  color: "text-shOrange" },
  // Clients
  client_created:         { label: "Client created",      icon: "fa-user-plus",      color: "text-shGreen" },
  client_edited:          { label: "Client edited",       icon: "fa-pen",            color: "text-shBlue" },
  client_deleted:         { label: "Client deleted",      icon: "fa-trash",          color: "text-red-300" },
  // Incidents
  incident_created:       { label: "Incident logged",     icon: "fa-triangle-exclamation", color: "text-red-300" },
  incident_edited:        { label: "Incident edited",     icon: "fa-pen",            color: "text-shBlue" },
  incident_deleted:       { label: "Incident deleted",    icon: "fa-trash",          color: "text-red-300" },
  vaccine_edited:         { label: "Vaccine record",      icon: "fa-syringe",        color: "text-shBlue" },
  // Intake
  intake_template_created:{ label: "Intake template created", icon: "fa-clipboard-list", color: "text-shGreen" },
  intake_template_edited: { label: "Intake template edited",  icon: "fa-pen",            color: "text-shBlue" },
  intake_template_deleted:{ label: "Intake template deleted", icon: "fa-trash",          color: "text-red-300" },
  intake_submission_created:{ label: "Intake sent",       icon: "fa-paper-plane",    color: "text-shBlue" },
  intake_submission_edited: { label: "Intake reviewed",   icon: "fa-pen",            color: "text-shBlue" },
  intake_submission_deleted:{ label: "Intake deleted",    icon: "fa-trash",          color: "text-red-300" },
  intake_submitted_by_client: { label: "Client submitted intake", icon: "fa-check", color: "text-shGreen" },
  // Waitlist
  waitlist_added:         { label: "Waitlist added",      icon: "fa-hourglass-half", color: "text-shBlue" },
  waitlist_edited:        { label: "Waitlist edited",     icon: "fa-pen",            color: "text-shBlue" },
  waitlist_removed:       { label: "Waitlist removed",    icon: "fa-trash",          color: "text-red-300" },
  waitlist_status_changed:{ label: "Waitlist status",     icon: "fa-shuffle",        color: "text-shOrange" },
  // Money
  expense_created:        { label: "Expense logged",      icon: "fa-receipt",        color: "text-red-300" },
  expense_edited:         { label: "Expense edited",      icon: "fa-pen",            color: "text-shBlue" },
  expense_deleted:        { label: "Expense deleted",     icon: "fa-trash",          color: "text-red-300" },
  retail_recorded:        { label: "Retail sale",         icon: "fa-cart-shopping",  color: "text-shGreen" },
  retail_deleted:         { label: "Retail deleted",      icon: "fa-trash",          color: "text-red-300" },
  payment_plan_created:   { label: "Payment plan created",icon: "fa-credit-card",    color: "text-shGreen" },
  payment_plan_edited:    { label: "Payment plan edited", icon: "fa-pen",            color: "text-shBlue" },
  // Settings
  settings_changed:       { label: "Settings changed",    icon: "fa-cog",            color: "text-shBlue" },
  kennel_labels_changed:  { label: "Kennel labels",       icon: "fa-tags",           color: "text-shBlue" },
  timeclock_edited:       { label: "Time clock",          icon: "fa-clock",          color: "text-shBlue" },
  waiver_action:          { label: "Waiver action",       icon: "fa-file-signature", color: "text-shGreen" },
};

function fmtTs(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    return `${d.toISOString().slice(0,10)} · ${hh}:${mm}`;
  } catch { return ts.slice(0,19); }
}

export default function AuditLog() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterUser, setFilterUser] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterGroup !== "all") params.append("group", filterGroup);
      if (filterUser !== "all") params.append("user_id", filterUser);
      params.append("limit", "500");
      const { data: d } = await api.get(`/audit-log?${params.toString()}`);
      setData(d);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail));
    }
    setLoading(false);
  }, [filterGroup, filterUser]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filterGroup, filterUser]);

  const visible = useMemo(() => {
    const entries = data?.entries || [];
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      (e.user_name || "").toLowerCase().includes(q) ||
      (e.action || "").toLowerCase().includes(q) ||
      (e.path || "").toLowerCase().includes(q) ||
      (e.record_id || "").toLowerCase().includes(q)
    );
  }, [data, search]);

  // Group by date for the timeline header
  const grouped = useMemo(() => {
    const map = new Map();
    for (const e of visible) {
      const d = (e.ts || "").slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(e);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <div className="space-y-6 animate-slide-in" data-testid="audit-log-screen">
      <PageHero
        eyebrow={{ icon: "fa-list-check", text: `${data?.entries?.length || 0} events captured`, color: "text-shBlue" }}
        title="Audit Log."
        highlight="Who did what, when."
        subtitle="Every booking, dog, client, incident, intake, payment, and settings change — automatically captured."
        right={(
          <button onClick={load} data-testid="audit-refresh"
                  className="bg-shGreen text-bgBase px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">
            <i className="fas fa-rotate mr-2"/>Refresh
          </button>
        )}
        testid="audit-hero"
      />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <FilterPill active={filterGroup==="all"} onClick={()=>setFilterGroup("all")} label="All"/>
          {(data?.groups || []).map(g => (
            <FilterPill key={g} active={filterGroup===g} onClick={()=>setFilterGroup(g)} label={g}/>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {(data?.users || []).length > 0 && (
            <select value={filterUser} onChange={(e)=>setFilterUser(e.target.value)} data-testid="audit-filter-user"
                    className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
              <option value="all">All users</option>
              {(data?.users || []).map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
            </select>
          )}
          <input value={search} onChange={(e)=>setSearch(e.target.value)}
                 placeholder="Search action, path, record id, user…"
                 data-testid="audit-search"
                 className="flex-1 min-w-[200px] bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
        </div>
      </div>

      {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

      {loading ? <p className="text-gray-500 text-sm">Loading…</p> : visible.length === 0 ? (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center" data-testid="audit-empty">
          <p className="text-gray-400 text-sm">No matching audit events. Try clearing the filters.</p>
        </div>
      ) : (
        <div className="space-y-5" data-testid="audit-list">
          {grouped.map(([date, rows]) => (
            <div key={date}>
              <h3 className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-2">
                <i className="fas fa-calendar-day mr-2"/>{date} · {rows.length}
              </h3>
              <div className="space-y-1.5">
                {rows.map(e => {
                  const meta = ACTION_META[e.action] || { label: e.action, icon: "fa-circle", color: "text-gray-300" };
                  const isOpen = !!expanded[e.id];
                  return (
                    <div key={e.id} className="bg-bgPanel border border-bgHover rounded-lg" data-testid={`audit-row-${e.id}`}>
                      <button onClick={()=>setExpanded(s=>({ ...s, [e.id]: !s[e.id] }))}
                              className="w-full text-left p-3 hover:bg-bgHover/30 transition">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full bg-bgBase ${meta.color}`}>
                            <i className={`fas ${meta.icon} text-[11px]`}/>
                          </span>
                          <span className={`text-[13px] font-black uppercase tracking-widest ${meta.color}`}>
                            {meta.label}
                          </span>
                          <span className="text-[12px] text-gray-300 truncate flex-1">
                            <span className="text-gray-500 font-mono text-[11px]">{e.ts?.slice(11,19)}</span>
                            <span className="text-white font-black ml-2">{e.user_name}</span>
                            <span className="text-gray-500 ml-1">({e.user_role})</span>
                            {e.record_id && <span className="text-gray-500 ml-2 font-mono text-[11px]">#{e.record_id.slice(0,8)}</span>}
                          </span>
                          <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${
                            e.status >= 400 ? "bg-red-500/15 text-red-300" :
                            e.status >= 300 ? "bg-shOrange/15 text-shOrange" :
                            "bg-shGreen/15 text-shGreen"
                          }`}>{e.status}</span>
                          <i className={`fas fa-chevron-${isOpen ? "up" : "down"} text-gray-500 text-xs`}/>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 border-t border-bgHover/40">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-[12px]">
                            <KV label="Path"   value={`${e.method} ${e.path}`} mono />
                            {e.ip && <KV label="IP" value={e.ip} mono />}
                            {e.record_id && <KV label="Record" value={e.record_id} mono />}
                            <KV label="When" value={fmtTs(e.ts)} />
                          </div>
                          {e.payload && (
                            <div className="mt-2">
                              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Payload</p>
                              <pre className="bg-bgBase border border-bgHover rounded p-2 text-[11px] text-gray-300 overflow-x-auto max-h-48 font-mono">
{JSON.stringify(e.payload, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({ active, onClick, label }) {
  return (
    <button onClick={onClick}
            className={`px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest border transition
                       ${active ? "bg-shGreen text-bgBase border-shGreen" : "bg-bgPanel text-gray-400 border-bgHover hover:text-white"}`}>
      {label}
    </button>
  );
}

function KV({ label, value, mono = false }) {
  return (
    <div>
      <span className="text-gray-500 font-black uppercase tracking-widest text-[10px] mr-2">{label}</span>
      <span className={`text-gray-200 ${mono ? "font-mono text-[11px] break-all" : ""}`}>{value}</span>
    </div>
  );
}
