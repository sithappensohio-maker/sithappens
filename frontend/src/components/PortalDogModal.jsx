import { useState } from "react";
import { api, formatErr } from "../lib/api";
import { compressImage } from "../lib/imageCompress";

const empty = {
  name: "", breed: "", age_y: 0, age_m: 0, birthday: "",
  sex: "Male", fixed: "No",
  vaccines: { rabies: "", bordetella: "", dhpp: "" },
  notes: "", photo: "",
  vet_name: "", vet_phone: "",
};

function todayISO() { return new Date().toISOString().split("T")[0]; }

export default function PortalDogModal({ dog = null, onClose, onSaved }) {
  const [form, setForm] = useState(dog ? {
    ...empty, ...dog,
    vaccines: { ...empty.vaccines, ...(dog.vaccines || {}) },
  } : empty);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const isEdit = !!dog;

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const dataUrl = await compressImage(f);
    setForm((p) => ({ ...p, photo: dataUrl }));
  };

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const setVax = (patch) => setForm((p) => ({ ...p, vaccines: { ...p.vaccines, ...patch } }));

  const save = async () => {
    setErr("");
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        age_y: parseInt(form.age_y) || 0,
        age_m: parseInt(form.age_m) || 0,
      };
      if (isEdit) await api.put(`/portal/dogs/${dog.id}`, body);
      else await api.post("/portal/dogs", body);
      onSaved?.();
      onClose();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    setSaving(false);
  };

  const rabiesValid = form.vaccines.rabies && form.vaccines.rabies >= todayISO();

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="portal-dog-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{isEdit ? `Edit · ${dog.name}` : "Add Your Dog"}</h4>
            <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest mt-1">Tell us about your pup</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl" /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name" required>
              <input value={form.name} onChange={(e)=>set({name:e.target.value})} data-testid="pd-name"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shGreen outline-none" />
            </Field>
            <Field label="Breed">
              <input value={form.breed} onChange={(e)=>set({breed:e.target.value})} placeholder="Golden Retriever"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shGreen outline-none" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Years">
              <input type="number" min="0" value={form.age_y} onChange={(e)=>set({age_y:e.target.value})}
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </Field>
            <Field label="Months">
              <input type="number" min="0" max="11" value={form.age_m} onChange={(e)=>set({age_m:e.target.value})}
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </Field>
            <Field label="Birthday">
              <input type="date" value={form.birthday} onChange={(e)=>set({birthday:e.target.value})}
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sex">
              <select value={form.sex} onChange={(e)=>set({sex:e.target.value})}
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option>Male</option><option>Female</option>
              </select>
            </Field>
            <Field label="Spayed / Neutered">
              <select value={form.fixed} onChange={(e)=>set({fixed:e.target.value})}
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option>Yes</option><option>No</option>
              </select>
            </Field>
          </div>

          <div className="bg-bgBase/50 border border-bgHover rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-black uppercase tracking-widest text-shOrange"><i className="fas fa-shield-virus mr-2"/>Vaccinations</p>
              {form.vaccines.rabies && (
                <span className={`text-[13px] font-black uppercase tracking-widest px-2 py-1 rounded ${rabiesValid?"bg-shGreen/15 text-shGreen":"bg-red-500/15 text-red-400"}`}>
                  Rabies {rabiesValid?"Valid":"Expired"}
                </span>
              )}
            </div>
            <p className="text-[13px] text-gray-400">Enter the <span className="text-shOrange font-black">expiration date</span> from your vet's certificate. Rabies is required to book daycare or boarding.</p>
            <Field label="Rabies expiration *">
              <input type="date" value={form.vaccines.rabies} onChange={(e)=>setVax({rabies:e.target.value})} data-testid="pd-rabies"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bordetella expiration">
                <input type="date" value={form.vaccines.bordetella} onChange={(e)=>setVax({bordetella:e.target.value})}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </Field>
              <Field label="DHPP expiration">
                <input type="date" value={form.vaccines.dhpp} onChange={(e)=>setVax({dhpp:e.target.value})}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </Field>
            </div>
          </div>

          <Field label="Photo (optional)">
            <div className="flex items-center gap-3">
              {form.photo && <img src={form.photo} alt="" loading="lazy" decoding="async" className="h-16 w-16 rounded object-cover border border-bgHover" />}
              <label className="bg-bgBase border border-bgHover rounded px-4 py-2 cursor-pointer text-xs font-black uppercase tracking-widest text-gray-300 hover:bg-bgHover">
                Upload <input type="file" accept="image/*" onChange={onFile} className="hidden" data-testid="pd-photo" />
              </label>
              {form.photo && <button onClick={()=>set({photo:""})} className="text-red-400 text-xs font-black uppercase">Remove</button>}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Vet name">
              <input value={form.vet_name} onChange={(e)=>set({vet_name:e.target.value})}
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </Field>
            <Field label="Vet phone">
              <input value={form.vet_phone} onChange={(e)=>set({vet_phone:e.target.value})}
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </Field>
          </div>

          <Field label="Notes — allergies, fears, special needs, anything we should know">
            <textarea value={form.notes} onChange={(e)=>set({notes:e.target.value})} rows={3}
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shGreen outline-none" />
          </Field>

          {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
            <button onClick={save} disabled={saving} data-testid="pd-submit"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving ? "Saving…" : (isEdit ? "Save Changes" : "Add Dog")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required = false, children }) {
  return (
    <div>
      <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">{label}{required && <span className="text-shOrange ml-1">*</span>}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
