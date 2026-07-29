import { useState } from "react";
import { api } from "../lib/api";
import { todayISO } from "../lib/date";

const KIND_META = {
  reps:         { unit: "reps",   step: 1,    type: "number" },
  sets:         { unit: "sets",   step: 1,    type: "number" },
  duration_sec: { unit: "sec",    step: 1,    type: "number" },
  duration_min: { unit: "min",    step: 1,    type: "number" },
  distance_ft:  { unit: "ft",     step: 1,    type: "number" },
  success_rate: { unit: "%",      step: 1,    type: "number", min: 0, max: 100 },
  rating_5:     { unit: "/ 5",    step: 1,    type: "number", min: 1, max: 5 },
  checkbox:     { type: "checkbox" },
  text:         { type: "text" },
  longtext:     { type: "longtext" },
};

/**
 * Client-facing per-section logger. Each section gets a "Log a session" form
 * with one input per field, plus an inline history of past entries.
 *
 * Props:
 *   - homework: full homework doc with template_snapshot + section_logs
 *   - onLogged: refreshes parent after a successful log
 */
export default function HomeworkSectionLogger({ homework, onLogged }) {
  const snap = homework.template_snapshot;
  if (!snap) return null;

  return (
    <div className="space-y-4">
      {(snap.global_rules_this_week || []).length > 0 && (
        <div className="bg-shAccent/5 border border-shAccent/30 rounded-lg p-3">
          <p className="text-[15px] font-black uppercase tracking-widest text-shAccent mb-2"><i className="fas fa-triangle-exclamation mr-1"/>House Rules This Week</p>
          <ul className="space-y-1 text-[15px] text-shTextMuted">
            {snap.global_rules_this_week.map((r,i) => <li key={i} className="flex gap-2"><span className="text-shAccent flex-shrink-0">▸</span><span>{r}</span></li>)}
          </ul>
        </div>
      )}

      {(snap.sections || []).map(section => (
        <SectionCard
          key={section.id}
          section={section}
          logs={(homework.section_logs || []).filter(l => l.section_id === section.id)}
          homeworkId={homework.id}
          onLogged={onLogged}
        />
      ))}
    </div>
  );
}

function SectionCard({ section, logs, homeworkId, onLogged }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [values, setValues] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setField = (fid, v) => setValues((s) => ({ ...s, [fid]: v }));

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      // Coerce numeric fields to numbers
      const field_values = {};
      for (const f of section.fields || []) {
        const v = values[f.id];
        if (v === undefined || v === "") continue;
        const km = KIND_META[f.kind] || {};
        if (km.type === "number") field_values[f.id] = Number(v);
        else if (km.type === "checkbox") field_values[f.id] = !!v;
        else field_values[f.id] = v;
      }
      await api.post(`/homework/${homeworkId}/section-log`, { section_id: section.id, date, field_values, note });
      setValues({}); setNote(""); setDate(todayISO()); setOpen(false);
      onLogged?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Failed to log");
    } finally { setBusy(false); }
  };

  const lastLog = logs[logs.length - 1];

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-4">
      <div className="flex items-center justify-between">
        <h5 className="text-shText font-black text-[15px] uppercase tracking-tight">{section.title}</h5>
        <span className="text-[14px] font-black uppercase tracking-widest text-shTextMuted">{logs.length} log{logs.length===1?"":"s"}</span>
      </div>
      {section.instructions && <p className="text-[15px] text-shTextMuted mt-2 whitespace-pre-wrap leading-snug">{section.instructions}</p>}

      {!open ? (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={()=>setOpen(true)} data-testid={`log-section-${section.id}`}
                  className="bg-shSecondary/15 text-shSecondary px-4 py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shSecondary/25">
            <i className="fas fa-plus mr-1"/> Log a session
          </button>
          {lastLog && <span className="text-[14px] text-shTextMuted">Last logged {lastLog.date}</span>}
        </div>
      ) : (
        <div className="mt-3 space-y-3 bg-[var(--sh-card-base)]/50 border border-shBorder rounded p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Session date</label>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)}
                     className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm" style={{colorScheme:"dark"}} />
            </div>
          </div>
          {(section.fields || []).map(f => <FieldInput key={f.id} field={f} value={values[f.id]} onChange={(v)=>setField(f.id, v)} />)}
          <div>
            <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Note (optional)</label>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={2}
                      placeholder="Anything notable about today's session?"
                      className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          {err && <p className="text-[15px] text-shDanger">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={()=>setOpen(false)} className="text-shTextMuted text-[14px] uppercase font-black tracking-widest">Cancel</button>
            <button onClick={submit} disabled={busy} data-testid={`submit-section-${section.id}`}
                    className="bg-shPrimary text-black px-4 py-2 rounded font-black text-[14px] uppercase tracking-widest disabled:opacity-50">
              {busy ? "Saving…" : "Save log"}
            </button>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[14px] font-black uppercase tracking-widest text-shTextMuted hover:text-shTextMuted">View history ({logs.length})</summary>
          <ul className="mt-2 space-y-2">
            {logs.slice().reverse().map(l => (
              <li key={l.id} className="text-[14px] text-shTextMuted bg-[var(--sh-card-base)]/40 rounded p-2 border border-shBorder/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-shPrimary font-black">{l.date}</span>
                  <span className="text-shTextMuted">{(l.logged_at||"").slice(11,16)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {(section.fields || []).map(f => {
                    const v = l.field_values?.[f.id];
                    if (v === undefined || v === "" || v === null) return null;
                    const km = KIND_META[f.kind] || {};
                    let display = v;
                    if (km.type === "checkbox") display = v ? "✓" : "✗";
                    return <span key={f.id} className="text-shTextMuted"><span className="text-shTextMuted">{f.label}:</span> <span className="text-shText font-black">{String(display)}</span>{km.unit ? ` ${km.unit}` : ""}</span>;
                  })}
                </div>
                {l.note && <p className="mt-1 italic text-shTextMuted">"{l.note}"</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  const km = KIND_META[field.kind] || { type: "text" };
  const targetSuffix = field.target ? ` (goal: ${field.target}${km.unit ? " " + km.unit : ""})` : "";
  if (km.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={(e)=>onChange(e.target.checked)}
               className="w-4 h-4 accent-shPrimary" />
        <span className="text-[15px] text-shTextMuted">{field.label}</span>
      </label>
    );
  }
  if (km.type === "longtext") {
    return (
      <div>
        <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">{field.label}</label>
        <textarea value={value || ""} onChange={(e)=>onChange(e.target.value)} rows={2}
                  placeholder={field.placeholder || ""}
                  className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
      </div>
    );
  }
  return (
    <div>
      <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">{field.label}{targetSuffix}</label>
      <input
        type={km.type}
        min={km.min} max={km.max} step={km.step}
        value={value ?? ""}
        onChange={(e)=>onChange(e.target.value)}
        placeholder={field.placeholder || ""}
        className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"
      />
    </div>
  );
}
