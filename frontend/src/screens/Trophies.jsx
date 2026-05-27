import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import TrophyBadge from "../components/TrophyBadge";
import { compressImage } from "../lib/imageCompress";
import PageHero from "../components/PageHero";

const TIER_OPTIONS = ["bronze", "silver", "gold", "platinum"];
const TRIGGER_KIND_OPTIONS = [
  { value: "", label: "— manual only —" },
  { value: "goal_score_5_count", label: "Dog: Training goals scored 5" },
  { value: "program_completed", label: "Dog: Programs completed" },
  { value: "homework_streak_days", label: "Client: Homework streak (days)" },
  { value: "homework_completed", label: "Client: Homework total completed" },
  { value: "visit_count", label: "Client: Total visits (checkouts)" },
  { value: "successful_referrals", label: "Client: Successful referrals" },
];

export default function Trophies() {
  const confirm = useConfirm();
  const [trophies, setTrophies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/trophies/catalog");
      setTrophies(data.trophies || []);
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to load"); }
  };
  useEffect(() => { load(); }, []);

  const dogTrophies = trophies.filter(t => t.category === "dog");
  const clientTrophies = trophies.filter(t => t.category === "client");

  const removeTrophy = async (t) => {
    const ok = await confirm({
      title: t.is_default ? `Deactivate "${t.name}"?` : `Delete "${t.name}"?`,
      body: t.is_default
        ? "Default trophies can't be deleted — but they will be deactivated so no future awards are granted. Existing recipients keep their badges."
        : "This will permanently delete the trophy definition. Existing awards stay intact.",
      confirmText: t.is_default ? "Deactivate" : "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try { await api.delete(`/trophies/catalog/${t.code}`); load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="trophies-screen">
      <PageHero
        eyebrow={{ icon: "fa-trophy", text: "Achievement catalog", color: "text-shOrange" }}
        title="Trophy Catalog."
        highlight="Earn it. Show it."
        subtitle="15 trophies seeded by default — add custom ones for your business below."
        right={(
          <button onClick={()=>setCreating(true)} data-testid="add-trophy-button"
                  className="bg-shOrange text-white px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shOrange/90 transition">
            <i className="fas fa-plus mr-2"/>New Trophy
          </button>
        )}
        testid="trophies-hero"
      />
      {err && <div className="bg-red-500/10 text-red-400 rounded p-3 text-sm">{err}</div>}

      <TrophySection title="Client Trophies" trophies={clientTrophies} onEdit={setEditing} onDelete={removeTrophy}/>
      <TrophySection title="Dog Trophies" trophies={dogTrophies} onEdit={setEditing} onDelete={removeTrophy}/>

      {(editing || creating) && (
        <TrophyEditor
          trophy={editing}
          isNew={creating}
          onClose={()=>{ setEditing(null); setCreating(false); }}
          onSaved={()=>{ setEditing(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function TrophySection({ title, trophies, onEdit, onDelete }) {
  if (!trophies.length) return null;
  return (
    <div>
      <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">{title} · {trophies.length}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {trophies.map(t => (
          <div key={t.code} className={`bg-bgPanel rounded-xl p-4 border ${t.active ? "border-bgHover" : "border-red-500/30 opacity-60"} flex items-start gap-3`} data-testid={`trophy-card-${t.code}`}>
            <TrophyBadge definition={t} size="md"/>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h5 className="text-sm font-black text-white uppercase">{t.name}</h5>
                <span className="text-[12px] font-black uppercase tracking-widest text-gray-500">{t.tier}</span>
                {!t.active && <span className="text-[12px] font-black text-red-400 uppercase">Inactive</span>}
              </div>
              <p className="text-[14px] text-gray-400 mt-1 leading-tight">{t.description}</p>
              <div className="text-[13px] text-gray-500 mt-2">
                {t.trigger_type === "auto" ? (
                  <span><i className="fas fa-robot mr-1"/>Auto · {t.trigger_kind} ≥ {t.threshold}</span>
                ) : (
                  <span><i className="fas fa-hand-pointer mr-1"/>Manual award</span>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={()=>onEdit(t)} data-testid={`edit-trophy-${t.code}`}
                        className="text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-shBlue/80">Edit</button>
                <button onClick={()=>onDelete(t)} data-testid={`delete-trophy-${t.code}`}
                        className="text-[13px] font-black uppercase tracking-widest text-red-400 hover:text-red-300">{t.is_default ? "Deactivate" : "Delete"}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrophyEditor({ trophy, isNew, onClose, onSaved }) {
  const [form, setForm] = useState(trophy || {
    code: "", name: "", description: "", category: "dog", tier: "bronze",
    icon: "fa-trophy", custom_image: "", trigger_type: "manual", trigger_kind: "", threshold: 0, active: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // 512px is plenty for the in-app badge AND for the 1200×630 share PNG
    // (we paste it into a 328px circle on the share card).
    const compressed = await compressImage(f, { maxWidth: 512, maxHeight: 512, quality: 0.85 });
    setForm(s => ({ ...s, custom_image: compressed }));
  };

  const save = async () => {
    setBusy(true); setErr("");
    try {
      if (isNew) {
        await api.post("/trophies/catalog", form);
      } else {
        const patch = {
          name: form.name, description: form.description, tier: form.tier,
          icon: form.icon, custom_image: form.custom_image, threshold: form.threshold, active: form.active,
        };
        await api.put(`/trophies/catalog/${form.code}`, patch);
      }
      onSaved?.();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur grid place-items-center p-4" onClick={onClose} data-testid="trophy-editor">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black uppercase italic text-white"><i className="fas fa-trophy text-shOrange mr-2"/>{isNew ? "New Trophy" : "Edit Trophy"}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><i className="fas fa-times text-lg"/></button>
        </div>
        <div className="flex items-center gap-4 mb-4 bg-bgBase rounded p-3">
          <TrophyBadge definition={form} size="lg"/>
          <div className="flex-1 text-[14px] text-gray-400">Live preview</div>
        </div>
        <div className="space-y-3">
          {isNew && (
            <Field label="Code (slug, unique)" required>
              <input value={form.code} onChange={(e)=>setForm({...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")})}
                     placeholder="e.g. dog_paw_picaso" data-testid="trophy-code-input"
                     className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm font-mono outline-none focus:border-shBlue"/>
            </Field>
          )}
          <Field label="Name" required>
            <input value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} data-testid="trophy-name-input"
                   className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm outline-none focus:border-shBlue"/>
          </Field>
          <Field label="Description">
            <textarea value={form.description} onChange={(e)=>setForm({...form, description: e.target.value})} rows={2}
                      className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm outline-none focus:border-shBlue"/>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {isNew && (
              <Field label="Category">
                <select value={form.category} onChange={(e)=>setForm({...form, category: e.target.value})}
                        className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm outline-none">
                  <option value="dog">Dog</option>
                  <option value="client">Client</option>
                </select>
              </Field>
            )}
            <Field label="Tier">
              <select value={form.tier} onChange={(e)=>setForm({...form, tier: e.target.value})} data-testid="trophy-tier-select"
                      className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm outline-none capitalize">
                {TIER_OPTIONS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </Field>
            <Field label="FontAwesome icon (e.g. fa-bone)">
              <input value={form.icon} onChange={(e)=>setForm({...form, icon: e.target.value})}
                     className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm font-mono outline-none focus:border-shBlue"/>
            </Field>
            {isNew && (
              <Field label="Trigger kind">
                <select value={form.trigger_kind} onChange={(e)=>setForm({...form, trigger_kind: e.target.value, trigger_type: e.target.value ? "auto" : "manual"})}
                        className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm outline-none">
                  {TRIGGER_KIND_OPTIONS.filter(o => !o.value || o.value.startsWith(form.category === "dog" ? "" : "") ).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )}
            {form.trigger_type === "auto" && (
              <Field label="Threshold">
                <input type="number" value={form.threshold} onChange={(e)=>setForm({...form, threshold: parseInt(e.target.value)||0})}
                       className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm outline-none focus:border-shBlue"/>
              </Field>
            )}
          </div>
          <Field label="Custom image (overrides icon)">
            <input type="file" accept="image/*" onChange={onFile} className="text-sm text-gray-300"/>
            {form.custom_image && (
              <div className="mt-2 flex items-center gap-2">
                <img src={form.custom_image} alt="preview" className="w-12 h-12 rounded-full object-cover"/>
                <button onClick={()=>setForm({...form, custom_image: ""})} className="text-[13px] text-red-400 font-black uppercase">Remove</button>
              </div>
            )}
          </Field>
          {!isNew && (
            <label className="flex items-center gap-2 text-[15px] text-gray-300">
              <input type="checkbox" checked={form.active !== false} onChange={(e)=>setForm({...form, active: e.target.checked})}/>
              Active (uncheck to stop awarding without losing history)
            </label>
          )}
        </div>
        {err && <div className="bg-red-500/10 text-red-400 rounded p-3 text-sm mt-3">{err}</div>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-[15px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={busy || !form.name || (isNew && !form.code)} data-testid="save-trophy-button"
                  className="bg-shOrange text-white px-7 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg hover:bg-shOrange/90 disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">{label}{required && <span className="text-red-400 ml-1">*</span>}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
