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
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shAccent mb-1">
          <i className="fas fa-clipboard-list mr-1.5"/>Action needed
        </p>
        <h2 className="text-2xl font-black text-shText uppercase italic tracking-tight">Intake Forms.</h2>
        <p className="text-[14px] text-shAccent font-black mt-1" data-testid="portal-intake-summary">
          <i className="fas fa-circle-exclamation mr-1.5"/>{summary}
        </p>
        <p className="text-[13px] text-shTextMuted mt-1">
          We sent you {n} form{n===1?"":"s"} to fill out. Takes a couple of minutes each.
        </p>
      </div>
      <div className="space-y-3">
        {assigned.map((s) => (
          <div key={s.id} className="bg-[var(--sh-card-base)] border-l-4 border-shAccent rounded-2xl p-5 shadow-2xl"
               data-testid={`portal-intake-card-${s.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[11px] font-black uppercase tracking-widest bg-shAccent/15 text-shAccent px-2 py-0.5 rounded">
                    {FORM_TYPE_LABELS[s.form_type] || s.form_type}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest bg-shSecondary/15 text-shSecondary px-2 py-0.5 rounded">
                    Pending
                  </span>
                </div>
                <p className="text-base text-shText font-black uppercase tracking-tight">{s.template?.name || s.template_name}</p>
                {s.template?.description && (
                  <p className="text-[13px] text-shTextMuted mt-1">{s.template.description}</p>
                )}
                <p className="text-[12px] text-shTextMuted font-black uppercase tracking-widest mt-2">
                  {s.template?.fields?.length || 0} field{(s.template?.fields?.length||0)===1?"":"s"}
                  <span className="text-shTextMuted ml-2">· assigned {s.sent_at?.slice(0,10) || s.created_at?.slice(0,10)}</span>
                </p>
              </div>
              <button onClick={()=>setActive(s)} data-testid={`portal-intake-fill-${s.id}`}
                      className="bg-shPrimary text-bgBase px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shPrimary/90">
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
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-2xl max-h-[calc(var(--app-height)_-_1rem)] overflow-y-auto animate-slide-in"
           data-testid="portal-intake-modal">
        <div className="flex items-start justify-between mb-1">
          <div className="flex-1 min-w-0 pr-3">
            <h4 className="text-xl font-black text-shText uppercase italic tracking-tight">{sub.template?.name || sub.template_name}</h4>
            {sub.template?.description && (
              <p className="text-[13px] text-shTextMuted mt-1">{sub.template.description}</p>
            )}
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText" data-testid="portal-intake-close">
            <i className="fas fa-times"/>
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="mt-4 text-sm text-shTextMuted italic">This form has no questions. Hit submit to mark it complete.</p>
        ) : (
          <div className="space-y-4 mt-4">
            {fields.map((f) => (
              <FieldInput key={f.id} f={f} value={answers[f.id]} setValue={(v)=>setA(f.id, v)} submissionId={sub.id} />
            ))}
          </div>
        )}

        {err && <div className="mt-4 text-[14px] text-red-300 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-shBorder">
          <button onClick={onClose} className="text-shTextMuted font-black uppercase text-[13px] tracking-widest" data-testid="portal-intake-cancel">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting} data-testid="portal-intake-submit"
                  className="bg-shPrimary text-bgBase px-7 py-2.5 rounded font-black text-[13px] uppercase tracking-widest shadow-xl disabled:opacity-60">
            {submitting ? <><i className="fas fa-circle-notch fa-spin mr-2"/>Submitting…</> : <><i className="fas fa-paper-plane mr-2"/>Submit Form</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───── Per-field renderer ───── */
function FieldInput({ f, value, setValue, submissionId }) {
  const inputClass = "w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm focus:border-shSecondary outline-none";
  const baseLabel = (
    <label className="block text-[12px] font-black text-shTextMuted uppercase tracking-widest">
      {f.label}
      {f.required && <span className="ml-2 text-[10px] text-red-300">Required</span>}
    </label>
  );
  const help = f.help_text ? <p className="mt-1 text-[12px] text-shTextMuted">{f.help_text}</p> : null;

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
                               ${value===true ? "bg-shPrimary text-bgBase border-shPrimary" : "bg-[var(--sh-card-base)] border-shBorder text-shTextMuted hover:text-shText"}`}>
              Yes
            </button>
            <button type="button" onClick={()=>setValue(false)}
                    data-testid={`intake-field-${f.id}-no`}
                    className={`px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest border transition
                               ${value===false ? "bg-red-500 text-shText border-red-500" : "bg-[var(--sh-card-base)] border-shBorder text-shTextMuted hover:text-shText"}`}>
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
              <label key={o} className="inline-flex items-center gap-2 cursor-pointer text-[13px] text-shTextMuted"
                     data-testid={`intake-field-${f.id}-opt-${o}`}>
                <input type="checkbox" checked={arr.includes(o)} onChange={()=>toggle(o)}
                       className="accent-shPrimary w-4 h-4"/>
                <span>{o}</span>
              </label>
            ))}
          </div>
          {help}
        </div>
      );
    }
    case "file_upload":
      return <IntakeFileUpload f={f} value={value} setValue={setValue} submissionId={submissionId} help={help} baseLabel={baseLabel} />;
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


const INTAKE_MAX_FILE_BYTES = 10 * 1024 * 1024;

function IntakeFileUpload({ f, value, setValue, submissionId, help, baseLabel }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  const upload = async (file) => {
    if (!file) return;
    if (file.size > INTAKE_MAX_FILE_BYTES) {
      setUploadErr("File too large — maximum 10 MB.");
      return;
    }
    setUploading(true);
    setUploadErr("");
    try {
      const data = await intakeFileToDataUri(file);
      const { data: saved } = await api.post(`/portal/intake/submissions/${submissionId}/files/${f.id}`, {
        name: file.name,
        content_type: file.type || "application/octet-stream",
        data,
      });
      setValue({ file_id: saved.id, name: saved.name, content_type: saved.content_type, size_bytes: saved.size_bytes });
      toast.success("Document uploaded");
    } catch (e) {
      setUploadErr(formatErr(e.response?.data?.detail) || "Upload failed. Please try again.");
    }
    setUploading(false);
  };

  return (
    <div>
      {baseLabel}
      <div className="mt-1 rounded-lg border border-dashed border-shBorder bg-[var(--sh-card-base)] p-3">
        {value?.file_id ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-black text-shText truncate"><i className="fas fa-file-circle-check text-shPrimary mr-2"/>{value.name || "Uploaded document"}</p>
              <p className="text-[11px] text-shTextMuted mt-0.5">Uploaded and attached to this intake form.</p>
            </div>
            <label className="shrink-0 cursor-pointer text-[11px] font-black uppercase tracking-widest text-shSecondary">
              Replace
              <input type="file" className="hidden" disabled={uploading}
                     accept="application/pdf,image/*,text/plain,.doc,.docx"
                     onChange={(e)=>upload(e.target.files?.[0] || null)} data-testid={`intake-field-${f.id}-file`} />
            </label>
          </div>
        ) : (
          <label className="flex min-h-[48px] cursor-pointer items-center justify-center rounded border border-shBorder bg-shSurfaceRaised/40 px-3 text-[12px] font-black uppercase tracking-widest text-shSecondary hover:border-shSecondary/60">
            {uploading ? <><i className="fas fa-spinner fa-spin mr-2"/>Uploading…</> : <><i className="fas fa-paperclip mr-2"/>Choose document</>}
            <input type="file" className="hidden" disabled={uploading}
                   accept="application/pdf,image/*,text/plain,.doc,.docx"
                   onChange={(e)=>upload(e.target.files?.[0] || null)} data-testid={`intake-field-${f.id}-file`} />
          </label>
        )}
        <p className="mt-2 text-[11px] text-shTextMuted">PDF, image, text, or Word document · max 10 MB.</p>
      </div>
      {uploadErr && <p className="mt-1 text-[12px] font-bold text-red-300" data-testid={`intake-field-${f.id}-upload-error`}>{uploadErr}</p>}
      {help}
    </div>
  );
}

function intakeFileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
