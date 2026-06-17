/* Sprint 110es — Phase 2: Care Board (Feeding & Medication tracker)
   Daily operational view + per-item complete/skip with staff initials.
   Auto-refreshes every 60s to keep "due now" / "missed" pills accurate. */
import { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { toast } from "sonner";
import PageHero from "../components/PageHero";

const STATUS_META = {
  not_due:   { label: "Not due yet", icon: "fa-clock",  cls: "bg-bgHover text-gray-300" },
  due_now:   { label: "Due now",      icon: "fa-bell",   cls: "bg-shOrange/15 text-shOrange ring-1 ring-shOrange/40" },
  completed: { label: "Completed",    icon: "fa-check",  cls: "bg-shGreen/15 text-shGreen" },
  missed:    { label: "Missed",       icon: "fa-triangle-exclamation", cls: "bg-red-500/15 text-red-300 ring-1 ring-red-400/50" },
  skipped:   { label: "Skipped",      icon: "fa-forward",cls: "bg-purple-500/15 text-purple-300" },
};

function fmtDelta(mins) {
  if (mins === null || mins === undefined) return null;
  const a = Math.abs(mins);
  const h = Math.floor(a / 60);
  const m = a % 60;
  const txt = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return mins < 0 ? `in ${txt}` : `${txt} overdue`;
}

export default function CareBoard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");           // all|feeding|medication
  const [activeItem, setActiveItem] = useState(null);    // item being acted on
  const [actionKind, setActionKind] = useState(null);    // "complete" | "skip"

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get("/care/today");
      setData(d);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't load the care board");
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const summary = data?.summary || { not_due: 0, due_now: 0, completed: 0, missed: 0, skipped: 0 };

  const rows = useMemo(() => {
    if (!data) return [];
    let xs = [];
    if (filter === "all" || filter === "feeding") xs = xs.concat(data.feedings || []);
    if (filter === "all" || filter === "medication") xs = xs.concat(data.medications || []);
    // re-sort across the combined set
    xs.sort((a, b) => {
      const ta = (a.time || "99:99");
      const tb = (b.time || "99:99");
      return ta.localeCompare(tb);
    });
    return xs;
  }, [data, filter]);

  const overdueCount = summary.missed;
  const dueNowCount = summary.due_now;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="care-board-screen">
      <PageHero
        eyebrow={{ icon: "fa-bowl-food", text: `${data?.on_site_count || 0} dog${(data?.on_site_count||0)===1?"":"s"} on-site today`, color: "text-shGreen" }}
        title="Care Board."
        highlight="Feedings & meds."
        subtitle="Every dog with food or medication due today. Sorted by time. Overdue items rise to the top of your attention."
        right={(
          <button onClick={load} data-testid="care-refresh"
                  className="bg-shGreen text-bgBase px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">
            <i className="fas fa-rotate mr-2"/>Refresh
          </button>
        )}
        testid="care-hero"
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatTile label="Due now"      value={dueNowCount}      color="text-shOrange" icon="fa-bell" testid="stat-due-now"/>
        <StatTile label="Missed"       value={overdueCount}     color="text-red-300"  icon="fa-triangle-exclamation" testid="stat-missed"/>
        <StatTile label="Completed"    value={summary.completed} color="text-shGreen" icon="fa-check" testid="stat-completed"/>
        <StatTile label="Skipped"      value={summary.skipped}   color="text-purple-300" icon="fa-forward" testid="stat-skipped"/>
        <StatTile label="Upcoming"     value={summary.not_due}   color="text-gray-300" icon="fa-clock" testid="stat-upcoming"/>
      </div>

      <div className="flex gap-2">
        {[["all","All"],["feeding","Feedings"],["medication","Medications"]].map(([k, l]) => (
          <button key={k} onClick={()=>setFilter(k)} data-testid={`filter-${k}`}
                  className={`px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest border transition ${filter===k?"bg-shGreen text-bgBase border-shGreen":"bg-bgPanel text-gray-400 border-bgHover hover:text-white"}`}>
            {l}
          </button>
        ))}
      </div>

      {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

      {loading ? <p className="text-gray-500 text-sm">Loading…</p> : rows.length === 0 ? (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center" data-testid="care-empty">
          <p className="text-shGreen font-black uppercase text-xs tracking-widest">
            <i className="fas fa-shield-heart mr-2"/>Nothing on the schedule for today. Either no dogs are on-site or none of them have feeding/med plans.
          </p>
          <p className="text-[12px] text-gray-500 mt-3">
            Tip: set up a dog's default feeding/med plan on the Dogs screen, or open a booking and edit its Care schedule directly.
          </p>
        </div>
      ) : (
        <div className="grid gap-2" data-testid="care-list">
          {rows.map((it) => (
            <CareRow key={`${it.booking_id}-${it.id}`} it={it}
                     onComplete={()=>{ setActiveItem(it); setActionKind("complete"); }}
                     onSkip={()=>{ setActiveItem(it); setActionKind("skip"); }} />
          ))}
        </div>
      )}

      {activeItem && actionKind && (
        <CareActionModal it={activeItem} kind={actionKind}
                         onClose={()=>{ setActiveItem(null); setActionKind(null); }}
                         onDone={()=>{ setActiveItem(null); setActionKind(null); load(); }} />
      )}
    </div>
  );
}

function StatTile({ label, value, color, icon, testid }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-3 text-center" data-testid={testid}>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
        <i className={`fas ${icon} mr-1`}/>{label}
      </p>
      <p className={`text-2xl font-black mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function CareRow({ it, onComplete, onSkip }) {
  const meta = STATUS_META[it.derived_status] || STATUS_META.not_due;
  const isCompleted = it.derived_status === "completed";
  const isSkipped = it.derived_status === "skipped";
  const isMissed = it.derived_status === "missed";
  const isDue = it.derived_status === "due_now";
  const accent = isMissed ? "border-l-red-400"
              : isDue     ? "border-l-shOrange"
              : isCompleted ? "border-l-shGreen"
              : isSkipped ? "border-l-purple-400"
              : "border-l-bgHover";
  return (
    <div className={`bg-bgPanel border border-bgHover border-l-4 ${accent} rounded-xl p-4 shadow-lg`}
         data-testid={`care-row-${it.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-base text-white font-black uppercase tracking-tight">
              <i className={`fas ${it.kind === "feeding" ? "fa-bowl-food text-shGreen" : "fa-pills text-purple-400"} mr-2`}/>
              {it.time || "—"} · {it.label}
            </span>
            <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${meta.cls}`}>
              <i className={`fas ${meta.icon} mr-1`}/>{meta.label}
            </span>
            {fmtDelta(it.due_minutes_delta) && !isCompleted && !isSkipped && (
              <span className={`text-[11px] font-black uppercase tracking-widest ${isMissed?"text-red-300":isDue?"text-shOrange":"text-gray-500"}`}>
                {fmtDelta(it.due_minutes_delta)}
              </span>
            )}
          </div>
          <p className="text-[13px] text-gray-300">
            <span className="text-white font-black">{it.dog_name}</span>
            {it.client_name && <span className="text-gray-500"> · {it.client_name}</span>}
            {it.service_type && <span className="text-gray-500"> · {it.service_type}</span>}
            {it.kennel && <span className="text-gray-500"> · kennel {it.kennel}</span>}
          </p>
          {(it.amount || it.food_type) && (
            <p className="text-[13px] text-gray-400 mt-1">
              {it.amount && <span><span className="text-shBlue font-black uppercase text-[10px] tracking-widest mr-1">Amt</span>{it.amount}</span>}
              {it.food_type && <span className="ml-3"><span className="text-shBlue font-black uppercase text-[10px] tracking-widest mr-1">Food</span>{it.food_type}</span>}
              {it.food_from_home && <span className="ml-3 text-[11px] font-black uppercase tracking-widest bg-shBlue/15 text-shBlue px-2 py-0.5 rounded">From home</span>}
            </p>
          )}
          {it.instructions && (
            <p className="text-[13px] text-gray-400 mt-1">
              <span className="text-shBlue font-black uppercase text-[10px] tracking-widest mr-1">Instructions</span>{it.instructions}
            </p>
          )}
          {isCompleted && (
            <p className="text-[12px] text-shGreen font-black uppercase tracking-widest mt-2">
              <i className="fas fa-check-circle mr-1"/>{it.completed_initials || "—"} · {(it.completed_at || "").slice(11,16)}
              {it.completion_note && <span className="text-gray-400 normal-case ml-2 font-normal">— {it.completion_note}</span>}
            </p>
          )}
          {isSkipped && (
            <p className="text-[12px] text-purple-300 font-black uppercase tracking-widest mt-2">
              <i className="fas fa-forward mr-1"/>{it.completed_initials || "—"} · {it.skip_reason}
              {it.skip_note && <span className="text-gray-400 normal-case ml-2 font-normal">— {it.skip_note}</span>}
            </p>
          )}
        </div>
        {!isCompleted && !isSkipped && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={onComplete} data-testid={`care-complete-${it.id}`}
                    className="text-[12px] font-black uppercase tracking-widest bg-shGreen text-bgBase px-4 py-2 rounded shadow-lg hover:bg-shGreen/90">
              <i className="fas fa-check mr-1"/>Complete
            </button>
            <button onClick={onSkip} data-testid={`care-skip-${it.id}`}
                    className="text-[12px] font-black uppercase tracking-widest bg-purple-500/20 text-purple-200 border border-purple-400/40 px-4 py-2 rounded hover:bg-purple-500/30">
              <i className="fas fa-forward mr-1"/>Skip
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CareActionModal({ it, kind, onClose, onDone }) {
  const [initials, setInitials] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const SKIP_REASONS = ["Dog refused", "Vomited", "Out at pickup", "Owner instruction", "Sleeping", "Other"];

  const submit = async () => {
    setErr("");
    if (!initials.trim()) { setErr("Initials required."); return; }
    if (kind === "skip" && !reason.trim()) { setErr("Pick a skip reason."); return; }
    setBusy(true);
    try {
      const url = `/bookings/${it.booking_id}/care/${it.id}/${kind}`;
      const body = kind === "complete"
        ? { initials, note }
        : { initials, reason, note };
      await api.post(url, body);
      toast.success(kind === "complete" ? "Logged" : "Skipped");
      onDone();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't save.");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in"
           data-testid={`care-${kind}-modal`}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h4 className="text-lg font-black text-white uppercase italic tracking-tight">
              {kind === "complete" ? "Mark complete" : "Skip"}
            </h4>
            <p className="text-[13px] text-gray-400 mt-1">
              {it.time} · {it.label} · <span className="text-white font-black">{it.dog_name}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Staff initials</label>
            <input value={initials} onChange={(e)=>setInitials(e.target.value)} maxLength={8}
                   placeholder="e.g. JT" data-testid="care-initials"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm uppercase tracking-widest font-black"
                   autoFocus />
          </div>

          {kind === "skip" && (
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Reason</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {SKIP_REASONS.map((r) => (
                  <button key={r} type="button" onClick={()=>setReason(r)}
                          data-testid={`care-skip-reason-${r}`}
                          className={`text-[12px] font-black uppercase tracking-widest px-2 py-2 rounded border ${reason===r?"bg-purple-500 text-white border-purple-500":"bg-bgBase border-bgHover text-gray-300 hover:text-white"}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">
              {kind === "complete" ? "Note (optional)" : "Detail (optional)"}
            </label>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={2}
                      placeholder={kind === "complete" ? "e.g. ate all of it" : "e.g. wouldn't take pill, will retry at 6"}
                      data-testid="care-note"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>

          {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

          <div className="flex justify-end gap-3 pt-2 border-t border-bgHover">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[12px] tracking-widest">Cancel</button>
            <button onClick={submit} disabled={busy} data-testid={`care-${kind}-submit`}
                    className={`px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow-xl disabled:opacity-60 ${kind==="complete"?"bg-shGreen text-bgBase":"bg-purple-500 text-white"}`}>
              {busy ? "Saving…" : (kind === "complete" ? "Mark Complete" : "Skip")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
