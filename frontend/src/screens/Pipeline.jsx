import { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";

const STATUS_META = {
  active: { label: "Active", color: "#8cc63f", icon: "fa-play" },
  on_hold: { label: "On Hold", color: "#f59e0b", icon: "fa-pause" },
  completed: { label: "Completed", color: "#00a9e0", icon: "fa-flag-checkered" },
  withdrawn: { label: "Withdrawn", color: "#64748b", icon: "fa-xmark" },
};

const TYPE_META = {
  private_lessons: { label: "Private Lessons", color: "#00a9e0" },
  board_train: { label: "Board & Train", color: "#8cc63f" },
  service_dog: { label: "Service Dog", color: "#a855f7" },
  custom: { label: "Custom", color: "#ec4899" },
};

/** Admin "all dogs in training" overview. Lives at the new "Pipeline" nav item. */
export default function Pipeline({ onJumpToDog }) {
  const [rows, setRows] = useState([]);
  const [filterStatus, setFilterStatus] = useState("active");
  const [filterType, setFilterType] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const params = {};
    if (filterStatus) params.status = filterStatus;
    if (filterType) params.type = filterType;
    if (search) params.search = search;
    try {
      const { data } = await api.get("/programs/pipeline", { params });
      setRows(data);
    } catch { setRows([]); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filterStatus, filterType]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const stats = useMemo(() => {
    const s = { active: 0, on_hold: 0, completed: 0, overdue: 0 };
    rows.forEach(r => {
      if (s[r.status] != null) s[r.status]++;
      if (r.status === "active" && r.days_to_target != null && r.days_to_target < 0) s.overdue++;
    });
    return s;
  }, [rows]);

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="pipeline-screen">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-white uppercase italic tracking-tight"><i className="fas fa-line-chart text-shGreen mr-2"/>Training Pipeline</h1>
          <p className="text-[14px] text-gray-400 mt-1">Every dog enrolled in a training program, at a glance.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Stat label="Active" value={stats.active} color="#8cc63f" />
          <Stat label="On Hold" value={stats.on_hold} color="#f59e0b" />
          <Stat label="Completed" value={stats.completed} color="#00a9e0" />
          {stats.overdue > 0 && <Stat label="Overdue" value={stats.overdue} color="#ef4444" />}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5 items-center" data-testid="pipeline-filters">
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search dog, client, program…"
               data-testid="pipeline-search"
               className="flex-1 min-w-[200px] bg-bgPanel border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
        <FilterChip label="All Statuses" value="" current={filterStatus} onClick={setFilterStatus} />
        {Object.entries(STATUS_META).map(([k, m]) => (
          <FilterChip key={k} label={m.label} value={k} current={filterStatus} onClick={setFilterStatus} color={m.color} />
        ))}
        <div className="w-full md:w-auto md:ml-2">
          <select value={filterType} onChange={(e)=>setFilterType(e.target.value)} data-testid="pipeline-type-filter"
                  className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
            <option value="">All Types</option>
            {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {/* Rows */}
      <div className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden shadow-lg">
        {loading && <p className="p-8 text-center text-gray-500 text-sm"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="p-12 text-center text-gray-500 text-sm">No enrollments match these filters.</p>
        )}
        {!loading && rows.length > 0 && (
          <div className="divide-y divide-bgHover">
            {rows.map(r => <Row key={r.id} row={r} onJumpToDog={onJumpToDog} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ row, onJumpToDog }) {
  const sm = STATUS_META[row.status] || STATUS_META.active;
  const tm = TYPE_META[row.program_snapshot?.type] || TYPE_META.private_lessons;
  const overdue = row.status === "active" && row.days_to_target != null && row.days_to_target < 0;
  return (
    <button onClick={()=>onJumpToDog?.(row.dog_id)} data-testid={`pipeline-row-${row.id}`}
            className="w-full px-4 py-3 hover:bg-bgHover/30 text-left transition flex items-center gap-3">
      {row.dog_photo
        ? <img src={row.dog_photo} alt={row.dog_name} loading="lazy" decoding="async" className="w-10 h-10 rounded-full object-cover border border-bgHover shrink-0" />
        : <div className="w-10 h-10 rounded-full bg-bgBase border border-bgHover flex items-center justify-center shrink-0 text-shGreen"><i className="fas fa-paw"/></div>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-black text-white">{row.dog_name}</p>
          <span className="text-[14px] text-gray-500">·</span>
          <p className="text-[15px] text-gray-400 truncate">{row.client_name}</p>
          <span className="text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded" style={{color: tm.color, background: tm.color+"15", border: `1px solid ${tm.color}40`}}>{tm.label}</span>
          {overdue && <span className="text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40"><i className="fas fa-triangle-exclamation mr-1"/>Overdue {Math.abs(row.days_to_target)}d</span>}
        </div>
        <p className="text-[15px] text-gray-300 mt-1 truncate">{row.program_snapshot?.name}</p>
        <div className="mt-1.5 flex items-center gap-3">
          <div className="flex-1 max-w-xs h-2 bg-bgBase rounded-full overflow-hidden border border-bgHover">
            <div className="h-full transition-all" style={{width: `${row.mastered_pct||0}%`, background: tm.color}} />
          </div>
          <span className="text-[14px] text-gray-400 font-black tabular-nums whitespace-nowrap">{row.mastered_pct}% · {row.mastered_goals}/{row.total_goals}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span className="text-[13px] font-black uppercase tracking-widest px-2 py-1 rounded" style={{color: sm.color, background: sm.color+"15", border: `1px solid ${sm.color}40`}}>
          <i className={`fas ${sm.icon} mr-1`}/>{sm.label}
        </span>
        <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-1">
          {row.days_since_start != null ? `${row.days_since_start}d in` : "—"}
          {row.target_completion_date && ` · ${row.days_to_target >= 0 ? row.days_to_target + "d left" : Math.abs(row.days_to_target) + "d over"}`}
        </p>
      </div>
    </button>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="px-3 py-1.5 rounded border bg-bgPanel" style={{borderColor: color+"50"}}>
      <span className="text-[14px] font-black uppercase tracking-widest" style={{color}}>{label}</span>
      <span className="text-white ml-2 font-black">{value}</span>
    </div>
  );
}

function FilterChip({ label, value, current, onClick, color }) {
  const active = current === value;
  return (
    <button onClick={()=>onClick(value)} data-testid={`pipeline-filter-${value || "all"}`}
            className={`px-3 py-1.5 rounded text-[15px] font-black uppercase tracking-widest border transition ${active?"text-white":"text-gray-400 border-bgHover hover:text-white"}`}
            style={active ? {background: (color||"#00a9e0"), borderColor: color||"#00a9e0"} : {}}>
      {label}
    </button>
  );
}
