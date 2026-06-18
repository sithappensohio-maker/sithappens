/* Sprint 110er — Phase 1.5: Client-portal "fill out assigned form" UX.
   Renders only when the client has pending intake forms (status=sent).
   Backend endpoints already exist:
     - GET  /portal/intake/assigned
     - POST /portal/intake/submissions/{id}/submit
*/
import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

const FORM_TYPE_LABELS = {
  client_intake: "New Client",
  dog_intake: "New Dog",
  daycare_temperament: "Daycare Temperament",
  boarding_intake: "Boarding",
  feeding_instructions: "Feeding",
  medication_instructions: "Medication",
  training_evaluation: "Training Eval",
  service_dog_training: "Service Dog",
  behavior_history: "Behavior History",
  bite_aggression_disclosure: "Bite Disclosure",
  emergency_vet_contact: "Emergency / Vet",
};

export default function IntakePortalSection() {
  const [assigned, setAssigned] = useState([]);
  const [active, setActive] = useState(null);   // submission currently being filled

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/portal/intake/assigned");
      setAssigned(data.assigned || []);
    } catch {
      setAssigned([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (assigned.length === 0) return null;

  const n = assigned.length;
  const summary = n === 1
    ? "You have 1 item that needs attention."
    : `You have ${n} items that need attention.`;

  return (
    <div data-testid="portal-intake-section">
      <div className="mb-4">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange mb-1">
          <i className="fas fa-clipboard-list mr-1.5"/>Action needed
        </p>
        <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Intake Forms.</h2>
        <p className="text-[14px] text-shOrange font-black mt-1" data-testid="portal-intake-summary">
          <i className="fas fa-circle-exclamation mr-1.5"/>{summary}
        </p>
        <p className="text-[13px] text-gray-400 mt-1">
          We sent you {n} form{n===1?"":"s"} to fill out. Takes a couple of minutes each.
        </p>
      </div>
      <div className="space-y-3">
        {assigned.map((s) => (
          <div key={s.id} className="bg-bgPanel border-l-4 border-shOrange rounded-2xl p-5 shadow-2xl"
               data-testid={`portal-intake-card-${s.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[11px] font-black uppercase tracking-widest bg-shOrange/15 text-shOrange px-2 py-0.5 rounded">
                    {FORM_TYPE_LABELS[s.form_type] || s.form_type}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest bg-shBlue/15 text-shBlue px-2 py-0.5 rounded">
                    Pending
                  </span>
                </div>
                <p className="text-base text-white font-black uppercase tracking-tight">{s.template?.name || s.template_name}</p>
                {s.template?.description && (
                  <p className="text-[13px] text-gray-400 mt-1">{s.template.description}</p>
                )}
                <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-2">
                  {s.template?.fields?.length || 0} field{(s.template?.fields?.length||0)===1?"":"s"}
                  <span className="text-gray-600 ml-2">· assigned {s.sent_at?.slice(0,10) || s.created_at?.slice(0,10)}</span>
                </p>
              </div>
              <button onClick={()=>setActive(s)} data-testid={`portal-intake-fill-${s.id}`}
                      className="bg-shGreen text-bgBase px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">
                <i className="fas fa-pen-to-square mr-2"/>Fill out
              </button>
            </div>
          </div>
        ))}
      </div>

      {active && (
        <IntakeFillModal sub={active} onClose={()=>setActive(null)} onSubmitted={()=>{ setActive(null); load(); }} />
      )}
    </div>
  );
}

/* ───── Fill-out modal ───── */
function IntakeFillModal({ sub, onClose, onSubmitted }) {
  const fields = sub.template?.fields || [];
  const [answers, setAnswers] = useState(() => {
    // pre-populate with empty/default values keyed by field id
    const init = {};
    for (const f of fields) {
      if (sub.answers && Object.prototype.hasOwnProperty.call(sub.answers, f.id)) {
        init[f.id] = sub.answers[f.id];
      } else if (f.field_type === "yes_no") {
        init[f.id] = null;
      } else if (f.field_type === "multi_select" || f.field_type === "checkbox") {
        init[f.id] = [];
      } else {
        init[f.id] = "";
      }
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const setA = (id, v) => setAnswers((cur) => ({ ...cur, [id]: v }));

  const validate = () => {
    for (const f of fields) {
      if (!f.required) continue;
      const v = answers[f.id];
      if (v === null || v === undefined) return `"${f.label}" is required.`;
      if (Array.isArray(v) && v.length === 0) return `"${f.label}" is required.`;
      if (typeof v === "string" && !v.trim()) return `"${f.label}" is required.`;
    }
    return null;
  };

  const submit = async () => {
    const msg = validate();
    if (msg) { setErr(msg); return; }
    setSubmitting(true);
    setErr("");
    try {
      await api.post(`/portal/intake/submissions/${sub.id}/submit`, { answers });
      toast.success("Form submitted — thanks!");
      onSubmitted();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't submit. Try again.");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60]">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in"
           data-testid="portal-intake-modal">
        <div className="flex items-start justify-between mb-1">
          <div className="flex-1 min-w-0 pr-3">
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{sub.template?.name || sub.template_name}</h4>
            {sub.template?.description && (
              <p className="text-[13px] text-gray-400 mt-1">{sub.template.description}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" data-testid="portal-intake-close">
            <i className="fas fa-times"/>
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400 italic">This form has no questions. Hit submit to mark it complete.</p>
        ) : (
          <div className="space-y-4 mt-4">
            {fields.map((f) => (
              <FieldInput key={f.id} f={f} value={answers[f.id]} setValue={(v)=>setA(f.id, v)} />
            ))}
          </div>
        )}

        {err && <div className="mt-4 text-[14px] text-red-300 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-bgHover">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[13px] tracking-widest" data-testid="portal-intake-cancel">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting} data-testid="portal-intake-submit"
                  className="bg-shGreen text-bgBase px-7 py-2.5 rounded font-black text-[13px] uppercase tracking-widest shadow-xl disabled:opacity-60">
            {submitting ? <><i className="fas fa-circle-notch fa-spin mr-2"/>Submitting…</> : <><i className="fas fa-paper-plane mr-2"/>Submit Form</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───── Per-field renderer ───── */
function FieldInput({ f, value, setValue }) {
  const inputClass = "w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none";
  const baseLabel = (
    <label className="block text-[12px] font-black text-gray-400 uppercase tracking-widest">
      {f.label}
      {f.required && <span className="ml-2 text-[10px] text-red-300">Required</span>}
    </label>
  );
  const help = f.help_text ? <p className="mt-1 text-[12px] text-gray-500">{f.help_text}</p> : null;

  switch (f.field_type) {
    case "short_text":
    case "email":
    case "phone":
    case "number":
      return (
        <div>
          {baseLabel}
          <input
            type={f.field_type === "number" ? "number" : (f.field_type === "email" ? "email" : (f.field_type === "phone" ? "tel" : "text"))}
            value={value ?? ""}
            onChange={(e)=>setValue(e.target.value)}
            placeholder={f.placeholder || ""}
            className={inputClass}
            data-testid={`intake-field-${f.id}`}
          />
          {help}
        </div>
      );
    case "long_text":
      return (
        <div>
          {baseLabel}
          <textarea
            value={value ?? ""}
            onChange={(e)=>setValue(e.target.value)}
            placeholder={f.placeholder || ""}
            rows={4}
            className={inputClass}
            data-testid={`intake-field-${f.id}`}
          />
          {help}
        </div>
      );
    case "date":
      return (
        <div>
          {baseLabel}
          <input
            type="date"
            value={value ?? ""}
            onChange={(e)=>setValue(e.target.value)}
            className={inputClass}
            style={{ colorScheme: "dark" }}
            data-testid={`intake-field-${f.id}`}
          />
          {help}
        </div>
      );
    case "dropdown":
      return (
        <div>
          {baseLabel}
          <select value={value ?? ""} onChange={(e)=>setValue(e.target.value)} className={inputClass}
                  data-testid={`intake-field-${f.id}`}>
            <option value="">— Select —</option>
            {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {help}
        </div>
      );
    case "yes_no":
      return (
        <div>
          {baseLabel}
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={()=>setValue(true)}
                    data-testid={`intake-field-${f.id}-yes`}
                    className={`px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest border transition
                               ${value===true ? "bg-shGreen text-bgBase border-shGreen" : "bg-bgBase border-bgHover text-gray-300 hover:text-white"}`}>
              Yes
            </button>
            <button type="button" onClick={()=>setValue(false)}
                    data-testid={`intake-field-${f.id}-no`}
                    className={`px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest border transition
                               ${value===false ? "bg-red-500 text-white border-red-500" : "bg-bgBase border-bgHover text-gray-300 hover:text-white"}`}>
              No
            </button>
          </div>
          {help}
        </div>
      );
    case "multi_select":
    case "checkbox": {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (opt) => setValue(arr.includes(opt) ? arr.filter(x=>x!==opt) : [...arr, opt]);
      return (
        <div>
          {baseLabel}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(f.options || []).map((o) => (
              <label key={o} className="inline-flex items-center gap-2 cursor-pointer text-[13px] text-gray-200"
                     data-testid={`intake-field-${f.id}-opt-${o}`}>
                <input type="checkbox" checked={arr.includes(o)} onChange={()=>toggle(o)}
                       className="accent-shGreen w-4 h-4"/>
                <span>{o}</span>
              </label>
            ))}
          </div>
          {help}
        </div>
      );
    }
    case "file_upload":
      return (
        <div>
          {baseLabel}
          <div className="mt-1 bg-bgBase border border-dashed border-bgHover rounded p-3 text-[12px] text-gray-500 italic">
            <i className="fas fa-circle-info mr-1"/>File uploads coming soon. For now, please email any documents to your trainer or note &quot;will bring at drop-off&quot; below.
          </div>
          <input
            type="text"
            value={value ?? ""}
            onChange={(e)=>setValue(e.target.value)}
            placeholder="Note about file (optional)"
            className={inputClass}
            data-testid={`intake-field-${f.id}`}
          />
          {help}
        </div>
      );
    case "staff_only_note":
      // Backend already strips these from /portal/intake/assigned, but render
      // nothing as a defensive guard in case one ever slips through.
      return null;
    default:
      return (
        <div>
          {baseLabel}
          <input value={value ?? ""} onChange={(e)=>setValue(e.target.value)} className={inputClass}
                 data-testid={`intake-field-${f.id}`} />
          {help}
        </div>
      );
  }
}
