import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { toast } from "sonner";
import PageHero from "../components/PageHero";

/* ─────────────────────────────────────────────────────────────────────────
   Sprint 110eq — Phase 1: Custom Intake Forms
   Admin form builder + submissions inbox.
   ───────────────────────────────────────────────────────────────────────── */

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

const FIELD_TYPE_LABELS = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  email: "Email",
  phone: "Phone",
  date: "Date",
  dropdown: "Dropdown",
  checkbox: "Checkbox",
  multi_select: "Multi-select",
  yes_no: "Yes / No",
  file_upload: "File upload (placeholder)",
  staff_only_note: "Staff-only note",
};

const STATUS_STYLE = {
  draft: "bg-bgHover text-gray-300",
  sent: "bg-shBlue/15 text-shBlue",
  submitted: "bg-shGreen/15 text-shGreen",
  reviewed: "bg-purple-500/15 text-purple-300",
  needs_follow_up: "bg-shOrange/15 text-shOrange",
  archived: "bg-bgHover text-gray-500",
};
const STATUS_LABEL = {
  draft: "Draft", sent: "Sent", submitted: "Submitted",
  reviewed: "Reviewed", needs_follow_up: "Needs follow-up", archived: "Archived",
};

const emptyField = () => ({
  id: "", label: "", field_type: "short_text", required: false,
  placeholder: "", help_text: "", options: [], staff_only: false,
});

const emptyTemplate = () => ({
  name: "", form_type: "client_intake", description: "", active: true, fields: [],
});

export default function IntakeForms() {
  const confirm = useConfirm();
  const [tab, setTab] = useState("templates");      // "templates" | "submissions"
  const [templates, setTemplates] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [clients, setClients] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [editor, setEditor] = useState(null);       // template being edited
  const [reviewer, setReviewer] = useState(null);   // submission being reviewed
  const [sendModal, setSendModal] = useState(null); // {template_id} for the "Send to client" modal

  const load = async () => {
    setLoading(true);
    try {
      const [t, s, c, d] = await Promise.all([
        api.get("/intake/templates"),
        api.get("/intake/submissions"),
        api.get("/clients"),
        api.get("/dogs"),
      ]);
      setTemplates(t.data.templates || []);
      setSubmissions(s.data.submissions || []);
      setClients(c.data || []);
      setDogs(d.data || []);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail));
    }
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const visibleTemplates = useMemo(() => {
    if (filter === "all") return templates;
    if (filter === "active") return templates.filter(t => t.active);
    if (filter === "inactive") return templates.filter(t => !t.active);
    return templates.filter(t => t.form_type === filter);
  }, [templates, filter]);

  const visibleSubmissions = useMemo(() => {
    if (statusFilter === "all") return submissions;
    return submissions.filter(s => s.status === statusFilter);
  }, [submissions, statusFilter]);

  /* ── Template actions ── */
  const newTemplate = () => setEditor({ ...emptyTemplate(), fields: [{ ...emptyField(), id: uid(), label: "Untitled field" }] });
  const editTemplate = (tpl) => setEditor(JSON.parse(JSON.stringify(tpl)));   // deep clone for safe edit
  const duplicateTemplate = async (tpl) => {
    try {
      await api.post(`/intake/templates/${tpl.id}/duplicate`);
      toast.success("Duplicated — opens as inactive copy");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };
  const toggleActive = async (tpl) => {
    try {
      await api.post(`/intake/templates/${tpl.id}/toggle-active`);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };
  const deleteTemplate = async (tpl) => {
    const ok = await confirm({
      title: `Delete ${tpl.name}?`,
      body: "If any submissions reference it, we'll soft-archive instead of deleting so history stays intact.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const r = await api.delete(`/intake/templates/${tpl.id}`);
      if (r.data?.soft_archived) toast.message("Soft-archived — submissions kept");
      else toast.success("Deleted");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };
  const saveTemplate = async (tpl) => {
    if (!tpl.name?.trim()) { toast.error("Name is required"); return; }
    if (!tpl.fields?.length) { toast.error("Add at least one field"); return; }
    try {
      const payload = {
        name: tpl.name.trim(),
        form_type: tpl.form_type,
        description: tpl.description || "",
        active: !!tpl.active,
        fields: tpl.fields.map(f => ({
          id: f.id || undefined,
          label: f.label || "Untitled field",
          field_type: f.field_type,
          required: !!f.required,
          placeholder: f.placeholder || "",
          help_text: f.help_text || "",
          options: f.options || [],
          staff_only: !!f.staff_only,
        })),
      };
      if (tpl.id) await api.put(`/intake/templates/${tpl.id}`, payload);
      else await api.post("/intake/templates", payload);
      setEditor(null);
      toast.success(tpl.id ? "Template updated" : "Template created");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  /* ── Submission actions ── */
  const sendToClient = (template_id) => setSendModal({ template_id, client_id: "", dog_id: "" });
  const confirmSend = async () => {
    const { template_id, client_id, dog_id } = sendModal;
    if (!client_id) { toast.error("Pick a client"); return; }
    try {
      await api.post("/intake/submissions", { template_id, client_id, dog_id: dog_id || null, status: "sent" });
      toast.success("Form assigned — client will see it in their portal next time they log in");
      setSendModal(null);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };
  const updateSubmissionStatus = async (sub, newStatus) => {
    try {
      await api.put(`/intake/submissions/${sub.id}`, { status: newStatus });
      load();
      if (reviewer?.id === sub.id) {
        const r = await api.get(`/intake/submissions/${sub.id}`);
        setReviewer(r.data);
      }
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };
  const saveReviewNotes = async (notes) => {
    try {
      await api.put(`/intake/submissions/${reviewer.id}`, { review_notes: notes });
      toast.success("Notes saved");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };
  const removeSubmission = async (sub) => {
    const ok = await confirm({ title: "Delete this submission?", body: "Permanent — there's no undo.", confirmText: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await api.delete(`/intake/submissions/${sub.id}`);
      setReviewer(null);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  /* ── Render ── */
  return (
    <div className="space-y-6 animate-slide-in" data-testid="intake-forms-screen">
      <PageHero
        eyebrow={{ icon: "fa-clipboard-list", text: `${templates.length} templates · ${submissions.length} submissions`, color: "text-shBlue" }}
        title="Intake Forms."
        highlight="Build, send, review."
        subtitle="Custom intake for new clients, dogs, daycare, boarding, training — anything you need on paper."
        right={(
          <button onClick={newTemplate} data-testid="new-template-btn"
                  className="bg-shGreen text-bgBase px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition">
            <i className="fas fa-plus mr-2"/>New Form
          </button>
        )}
        testid="intake-hero"
      />

      <div className="flex gap-2 border-b border-bgHover">
        <button onClick={()=>setTab("templates")} data-testid="tab-templates"
                className={`px-4 py-2 text-[13px] font-black uppercase tracking-widest border-b-2 ${tab==="templates"?"border-shGreen text-white":"border-transparent text-gray-400 hover:text-white"}`}>
          Templates · {templates.length}
        </button>
        <button onClick={()=>setTab("submissions")} data-testid="tab-submissions"
                className={`px-4 py-2 text-[13px] font-black uppercase tracking-widest border-b-2 ${tab==="submissions"?"border-shGreen text-white":"border-transparent text-gray-400 hover:text-white"}`}>
          Submissions · {submissions.length}
        </button>
      </div>

      {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

      {tab === "templates" && (
        <>
          <div className="flex flex-wrap gap-2">
            <FilterPill active={filter==="all"} onClick={()=>setFilter("all")} label={`All · ${templates.length}`} />
            <FilterPill active={filter==="active"} onClick={()=>setFilter("active")} label={`Active · ${templates.filter(t=>t.active).length}`} />
            <FilterPill active={filter==="inactive"} onClick={()=>setFilter("inactive")} label={`Inactive · ${templates.filter(t=>!t.active).length}`} />
            {Object.entries(FORM_TYPE_LABELS).map(([k, label]) => {
              const n = templates.filter(t => t.form_type === k).length;
              if (!n) return null;
              return <FilterPill key={k} active={filter===k} onClick={()=>setFilter(k)} label={`${label} · ${n}`} />;
            })}
          </div>

          {loading ? <p className="text-gray-500 text-sm">Loading…</p> : visibleTemplates.length === 0 ? (
            <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center">
              <p className="text-gray-400 text-sm">No templates match this filter. Create a new one or clear the filter.</p>
            </div>
          ) : (
            <div className="grid gap-3" data-testid="templates-list">
              {visibleTemplates.map(t => (
                <div key={t.id} className="bg-bgPanel border border-bgHover rounded-xl p-5 shadow-lg" data-testid={`template-${t.id}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-base text-white font-black uppercase tracking-tight">{t.name}</span>
                        <span className="text-[11px] font-black uppercase tracking-widest bg-shBlue/15 text-shBlue px-2 py-0.5 rounded">
                          {FORM_TYPE_LABELS[t.form_type] || t.form_type}
                        </span>
                        {t.is_starter && <span className="text-[11px] font-black uppercase tracking-widest bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded">Starter</span>}
                        {t.active ? <span className="text-[11px] font-black uppercase tracking-widest bg-shGreen/15 text-shGreen px-2 py-0.5 rounded">Active</span>
                                  : <span className="text-[11px] font-black uppercase tracking-widest bg-bgHover text-gray-400 px-2 py-0.5 rounded">Inactive</span>}
                      </div>
                      {t.description && <p className="text-[13px] text-gray-400">{t.description}</p>}
                      <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-2">
                        {t.fields?.length || 0} field{(t.fields?.length||0)===1?"":"s"}
                        {(() => {
                          const subs = submissions.filter(s => s.template_id === t.id);
                          return subs.length ? <span className="ml-3 text-shBlue">· {subs.length} submission{subs.length===1?"":"s"}</span> : null;
                        })()}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={()=>sendToClient(t.id)} disabled={!t.active}
                              data-testid={`send-${t.id}`}
                              className={`text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded ${t.active?"bg-shBlue text-white hover:bg-shBlue/90":"bg-bgHover text-gray-500 cursor-not-allowed"}`}
                              title={t.active ? "Send to a client" : "Activate first"}>
                        <i className="fas fa-paper-plane mr-1"/>Send
                      </button>
                      <button onClick={()=>editTemplate(t)} data-testid={`edit-${t.id}`}
                              className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-bgHover text-gray-300 hover:text-white">
                        <i className="fas fa-pen mr-1"/>Edit
                      </button>
                      <button onClick={()=>duplicateTemplate(t)} data-testid={`dup-${t.id}`}
                              className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-bgHover text-gray-300 hover:text-white">
                        <i className="fas fa-copy mr-1"/>Duplicate
                      </button>
                      <button onClick={()=>toggleActive(t)} data-testid={`toggle-${t.id}`}
                              className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-bgHover text-gray-300 hover:text-white">
                        {t.active ? <><i className="fas fa-pause mr-1"/>Deactivate</> : <><i className="fas fa-play mr-1"/>Activate</>}
                      </button>
                      <button onClick={()=>deleteTemplate(t)} data-testid={`del-${t.id}`}
                              className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25">
                        <i className="fas fa-trash"/>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "submissions" && (
        <>
          <div className="flex flex-wrap gap-2">
            <FilterPill active={statusFilter==="all"} onClick={()=>setStatusFilter("all")} label={`All · ${submissions.length}`} />
            {Object.entries(STATUS_LABEL).map(([k, label]) => {
              const n = submissions.filter(s => s.status === k).length;
              return <FilterPill key={k} active={statusFilter===k} onClick={()=>setStatusFilter(k)} label={`${label} · ${n}`} />;
            })}
          </div>

          {loading ? <p className="text-gray-500 text-sm">Loading…</p> : visibleSubmissions.length === 0 ? (
            <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center">
              <p className="text-gray-400 text-sm">No submissions yet. Send an active form to a client from the Templates tab.</p>
            </div>
          ) : (
            <div className="grid gap-2" data-testid="submissions-list">
              {visibleSubmissions.map(s => {
                const client = clients.find(c => c.id === s.client_id);
                const dog = dogs.find(d => d.id === s.dog_id);
                return (
                  <button key={s.id} onClick={()=>setReviewer(s)} data-testid={`sub-${s.id}`}
                          className="text-left bg-bgPanel border border-bgHover rounded-xl p-4 hover:border-shBlue transition flex items-center gap-3 flex-wrap">
                    <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${STATUS_STYLE[s.status] || "bg-bgHover"}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                    <span className="text-sm text-white font-black uppercase tracking-tight">{s.template_name}</span>
                    <span className="text-[11px] font-black uppercase tracking-widest bg-shBlue/15 text-shBlue px-2 py-0.5 rounded">
                      {FORM_TYPE_LABELS[s.form_type] || s.form_type}
                    </span>
                    <span className="text-[13px] text-gray-400 ml-auto">
                      {client?.name || "—"}{dog ? ` · ${dog.name}` : ""}
                      <span className="text-gray-500 ml-2">{s.created_at?.slice(0,10)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {editor && <TemplateEditorModal tpl={editor} setTpl={setEditor} onCancel={()=>setEditor(null)} onSave={saveTemplate} />}
      {reviewer && <SubmissionReviewerModal sub={reviewer} clients={clients} dogs={dogs} templates={templates}
                                            onClose={()=>setReviewer(null)}
                                            onStatusChange={(st)=>updateSubmissionStatus(reviewer, st)}
                                            onSaveNotes={saveReviewNotes}
                                            onDelete={()=>removeSubmission(reviewer)} />}
      {sendModal && <SendModal info={sendModal} setInfo={setSendModal} clients={clients} dogs={dogs} templates={templates}
                               onCancel={()=>setSendModal(null)} onConfirm={confirmSend} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────────── */
function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

function FilterPill({ active, onClick, label }) {
  return (
    <button onClick={onClick}
            className={`px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest border transition
                       ${active ? "bg-shGreen text-bgBase border-shGreen" : "bg-bgPanel text-gray-400 border-bgHover hover:text-white"}`}>
      {label}
    </button>
  );
}

/* ───── Template editor modal ───── */
function TemplateEditorModal({ tpl, setTpl, onCancel, onSave }) {
  const set = (patch) => setTpl({ ...tpl, ...patch });
  const setField = (idx, patch) => {
    const fields = tpl.fields.map((f, i) => i === idx ? { ...f, ...patch } : f);
    setTpl({ ...tpl, fields });
  };
  const addField = () => setTpl({ ...tpl, fields: [...(tpl.fields || []), { ...emptyField(), id: uid(), label: "Untitled field" }] });
  const removeField = (idx) => setTpl({ ...tpl, fields: tpl.fields.filter((_, i) => i !== idx) });
  const moveField = (idx, dir) => {
    const next = [...tpl.fields];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setTpl({ ...tpl, fields: next });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-3xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in" data-testid="template-editor">
        <div className="flex items-center justify-between mb-5">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{tpl.id ? "Edit Form Template" : "New Form Template"}</h4>
          <button onClick={onCancel} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Form name</label>
              <input value={tpl.name} onChange={(e)=>set({ name: e.target.value })} data-testid="tpl-name"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" placeholder="e.g. New Client Intake" />
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Form type</label>
              <select value={tpl.form_type} onChange={(e)=>set({ form_type: e.target.value })} data-testid="tpl-type"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {Object.entries(FORM_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Description (optional)</label>
            <textarea value={tpl.description || ""} onChange={(e)=>set({ description: e.target.value })} rows={2}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"
                      placeholder="Short note about when this form is used…" />
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!tpl.active} onChange={(e)=>set({ active: e.target.checked })}
                   className="accent-shGreen w-4 h-4" data-testid="tpl-active"/>
            <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">Active</span>
          </label>

          <div className="border-t border-bgHover pt-4">
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-[14px] font-black text-gray-300 uppercase tracking-widest">Fields ({tpl.fields?.length || 0})</h5>
              <button onClick={addField} data-testid="add-field"
                      className="text-[12px] font-black uppercase tracking-widest bg-shGreen text-bgBase px-3 py-1.5 rounded">
                <i className="fas fa-plus mr-1"/>Add field
              </button>
            </div>

            <div className="space-y-3">
              {(tpl.fields || []).map((f, idx) => (
                <FieldRow key={f.id || idx} f={f} idx={idx} setField={setField} removeField={removeField} moveField={moveField} total={tpl.fields.length} />
              ))}
              {(tpl.fields || []).length === 0 && <p className="text-[13px] text-gray-500 italic">No fields yet — add one above.</p>}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-bgHover">
            <button onClick={onCancel} className="text-gray-500 font-black uppercase text-[13px] tracking-widest">Cancel</button>
            <button onClick={()=>onSave(tpl)} data-testid="save-template-btn"
                    className="bg-shGreen text-bgBase px-8 py-2.5 rounded font-black text-[13px] uppercase tracking-widest shadow-xl">
              <i className="fas fa-save mr-2"/>Save Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ f, idx, setField, removeField, moveField, total }) {
  const hasOptions = ["dropdown", "multi_select", "checkbox"].includes(f.field_type);
  return (
    <div className="bg-bgBase border border-bgHover rounded-lg p-3 space-y-2" data-testid={`field-row-${idx}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
          <input value={f.label} onChange={(e)=>setField(idx, { label: e.target.value })} placeholder="Field label"
                 className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" data-testid={`field-label-${idx}`} />
          <select value={f.field_type} onChange={(e)=>setField(idx, { field_type: e.target.value })} data-testid={`field-type-${idx}`}
                  className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
            {Object.entries(FIELD_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={()=>moveField(idx, -1)} disabled={idx===0}
                  className="text-gray-400 hover:text-white disabled:opacity-30 px-1.5"><i className="fas fa-arrow-up text-xs"/></button>
          <button onClick={()=>moveField(idx, 1)} disabled={idx===total-1}
                  className="text-gray-400 hover:text-white disabled:opacity-30 px-1.5"><i className="fas fa-arrow-down text-xs"/></button>
        </div>
        <button onClick={()=>removeField(idx)} className="text-red-400 hover:text-red-300 px-2" data-testid={`field-remove-${idx}`}>
          <i className="fas fa-trash text-xs"/>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input value={f.placeholder || ""} onChange={(e)=>setField(idx, { placeholder: e.target.value })} placeholder="Placeholder (optional)"
               className="bg-bgPanel border border-bgHover rounded p-2 text-white text-[13px]" />
        <input value={f.help_text || ""} onChange={(e)=>setField(idx, { help_text: e.target.value })} placeholder="Help text (optional)"
               className="bg-bgPanel border border-bgHover rounded p-2 text-white text-[13px]" />
      </div>

      {hasOptions && (
        <div>
          <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Options (comma-separated)</label>
          <input value={(f.options || []).join(", ")} onChange={(e)=>setField(idx, { options: e.target.value.split(",").map(s=>s.trim()).filter(Boolean) })}
                 placeholder="e.g. Daily, Weekly, Monthly"
                 className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-[13px]" />
        </div>
      )}

      <div className="flex gap-4 flex-wrap">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!f.required} onChange={(e)=>setField(idx, { required: e.target.checked })}
                 className="accent-shGreen w-4 h-4" />
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Required</span>
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer" title="Hidden from clients in the portal">
          <input type="checkbox" checked={!!f.staff_only || f.field_type==="staff_only_note"} onChange={(e)=>setField(idx, { staff_only: e.target.checked })}
                 disabled={f.field_type==="staff_only_note"}
                 className="accent-shOrange w-4 h-4" />
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-400">Staff-only</span>
        </label>
      </div>
    </div>
  );
}

/* ───── Submission reviewer modal ───── */
function SubmissionReviewerModal({ sub, clients, dogs, templates, onClose, onStatusChange, onSaveNotes, onDelete }) {
  const [notes, setNotes] = useState(sub.review_notes || "");
  useEffect(() => { setNotes(sub.review_notes || ""); }, [sub.review_notes]);
  const client = clients.find(c => c.id === sub.client_id);
  const dog = dogs.find(d => d.id === sub.dog_id);
  const tpl = templates.find(t => t.id === sub.template_id);
  const fields = tpl?.fields || [];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in" data-testid="submission-reviewer">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{sub.template_name}</h4>
            <p className="text-[13px] text-gray-400 mt-0.5">
              {client?.name || "—"}{dog ? ` · ${dog.name}` : ""}
              <span className="text-gray-500 ml-2">{sub.created_at?.slice(0,10)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <button key={k} onClick={()=>onStatusChange(k)} data-testid={`set-status-${k}`}
                    className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded border transition
                               ${sub.status===k ? `${STATUS_STYLE[k]} border-current` : "bg-bgBase border-bgHover text-gray-400 hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>

        {fields.length === 0 ? (
          <p className="text-gray-500 text-sm italic">Template was deleted or has no fields.</p>
        ) : (
          <div className="space-y-3 mb-4">
            {fields.map((f) => {
              const v = sub.answers?.[f.id];
              const displayed = Array.isArray(v) ? v.join(", ") : (typeof v === "boolean" ? (v ? "Yes" : "No") : (v ?? ""));
              return (
                <div key={f.id} className="bg-bgBase border border-bgHover rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-black text-gray-400 uppercase tracking-widest">{f.label}</span>
                    {f.required && <span className="text-[10px] font-black text-red-300 uppercase tracking-widest">Required</span>}
                    {f.staff_only && <span className="text-[10px] font-black text-shOrange uppercase tracking-widest">Staff-only</span>}
                  </div>
                  <p className="text-sm text-white whitespace-pre-wrap">{displayed === "" ? <span className="text-gray-500 italic">(blank)</span> : displayed}</p>
                </div>
              );
            })}
          </div>
        )}

        <div>
          <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Admin review notes</label>
          <textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={3} data-testid="review-notes"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          <button onClick={()=>onSaveNotes(notes)} className="mt-2 text-[12px] font-black uppercase tracking-widest bg-shBlue text-white px-3 py-1.5 rounded">
            <i className="fas fa-save mr-1"/>Save notes
          </button>
        </div>

        <div className="flex justify-between mt-5 pt-4 border-t border-bgHover">
          <button onClick={onDelete} className="text-[12px] font-black uppercase tracking-widest text-red-400 hover:text-red-300">
            <i className="fas fa-trash mr-1"/>Delete
          </button>
          <button onClick={onClose} className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-white">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ───── Send-to-client modal ───── */
function SendModal({ info, setInfo, clients, dogs, templates, onCancel, onConfirm }) {
  const tpl = templates.find(t => t.id === info.template_id);
  const clientDogs = dogs.filter(d => d.owner_id === info.client_id);
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in" data-testid="send-modal">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Send &quot;{tpl?.name}&quot;</h4>
          <button onClick={onCancel} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Client</label>
            <select value={info.client_id} onChange={(e)=>setInfo({ ...info, client_id: e.target.value, dog_id: "" })} data-testid="send-client"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="">— Select a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {info.client_id && clientDogs.length > 0 && (
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Dog (optional)</label>
              <select value={info.dog_id} onChange={(e)=>setInfo({ ...info, dog_id: e.target.value })} data-testid="send-dog"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="">— Not dog-specific —</option>
                {clientDogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <p className="text-[12px] text-gray-500 italic">
            <i className="fas fa-circle-info mr-1"/>The client-portal &quot;fill out form&quot; view lands in the next phase — for now this just queues the assignment with status <strong>Sent</strong> so you can record-keep.
          </p>
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onCancel} className="text-gray-500 font-black uppercase text-[12px] tracking-widest">Cancel</button>
          <button onClick={onConfirm} data-testid="send-confirm"
                  className="bg-shBlue text-white px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest">
            <i className="fas fa-paper-plane mr-1"/>Send
          </button>
        </div>
      </div>
    </div>
  );
}
