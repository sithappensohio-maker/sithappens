import { useState } from "react";
import { api, formatErr } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import { dogAgeLabel, dogAgeMonths } from "../lib/dogAge";
import PremiumButton from "./premium/PremiumButton";

const empty = {
  name: "", breed: "", age_y: 0, age_m: 0, birthday: "",
  // Stage 1 — these used to default to "Male" and "No", which meant every dog
  // whose owner skipped the dropdowns was recorded as an intact male. A
  // pre-filled guess that gets saved is worse than an empty field.
  sex: "", fixed: "",
  vaccines: { rabies: "", bordetella: "", dhpp: "" },
  notes: "", photo: "",
  vet_name: "", vet_phone: "",
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function vaxStatusLabel(dateStr) {
  if (!dateStr) return { text: "Not on file", cls: "bg-red-500/15 text-red-400" };
  if (dateStr < todayISO()) return { text: "Expired", cls: "bg-red-500/15 text-red-400" };
  return { text: "Valid", cls: "bg-shGreen/15 text-shGreen" };
}
function fmtVaxDate(iso) {
  if (!iso) return "—";
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}

export default function PortalDogModal({ dog = null, onClose, onSaved, onUploadVaccines }) {
  const [form, setForm] = useState(dog ? {
    ...empty, ...dog,
    vaccines: { ...empty.vaccines, ...(dog.vaccines || {}) },
  } : empty);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const isEdit = !!dog;

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const dataUrl = await compressImage(f);
    setForm((p) => ({ ...p, photo: dataUrl }));
  };

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  // Stage 1 — one pass over every rule, so the client is told everything that
  // is wrong at once. This used to `return` on the first failure and print a
  // single sentence at the bottom of a modal three screens tall, naming a
  // field that was scrolled off the top and not highlighted.
  //
  // Vet details are NOT required: backend PortalDogIn has them as
  // Optional[str] = "", and the server's booking gate
  // (_compute_setup_status_for_client) asks only for name, breed and an age.
  // They were required by this form alone.
  const validate = (f) => {
    const problems = {};
    if (!(f.name || "").trim())  problems.name  = "Please tell us your dog's name.";
    if (!(f.breed || "").trim()) problems.breed = "Please add a breed — a best guess is fine.";
    if (!f.sex)   problems.sex   = "Please choose one.";
    if (!f.fixed) problems.fixed = "Please choose one.";
    const hasBirthday = !!(f.birthday || "").trim();
    const hasAge = (parseInt(f.age_y) || 0) > 0 || (parseInt(f.age_m) || 0) > 0;
    if (!hasBirthday && !hasAge) problems.age = "Add a birthday, or an approximate age.";
    return problems;
  };
  const FIELD_ORDER = ["name", "breed", "age", "sex", "fixed"];

  const save = async () => {
    setErr("");
    const problems = validate(form);
    setFieldErrors(problems);
    const firstBad = FIELD_ORDER.find((k) => problems[k]);
    if (firstBad) {
      setErr(Object.keys(problems).length === 1
        ? "One thing still needs your attention."
        : `${Object.keys(problems).length} things still need your attention.`);
      // Take them to it rather than describing it from a distance.
      window.setTimeout(() => {
        const el = document.querySelector(`[data-field="${firstBad}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          const focusable = el.querySelector("input, select, textarea");
          if (focusable && typeof focusable.focus === "function") focusable.focus({ preventScroll: true });
        }
      }, 30);
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        age_y: parseInt(form.age_y) || 0,
        age_m: parseInt(form.age_m) || 0,
      };
      // Birthday wins — derive stored age fields so they stay accurate.
      if (form.birthday) {
        const months = dogAgeMonths({ birthday: form.birthday });
        body.age_y = Math.floor(months / 12);
        body.age_m = months % 12;
      }
      const { data: saved } = isEdit
        ? await api.put(`/portal/dogs/${dog.id}`, body)
        : await api.post("/portal/dogs", body);
      onSaved?.(saved || body);
      onClose();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="portal-dog-modal">
      <div className="border border-shBorder rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-sh max-h-[calc(var(--app-height)_-_1rem)] overflow-y-auto animate-slide-in"
           style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-xl font-bold text-shText tracking-tight">{isEdit ? `Edit · ${dog.name}` : "Add Your Dog"}</h4>
            <p className="text-[13px] font-semibold text-shTextMuted uppercase tracking-widest mt-1">Tell us about your pup</p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times text-xl" /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name" required name="name" error={fieldErrors.name}>
              <input value={form.name} onChange={(e)=>set({name:e.target.value})} data-testid="pd-name"
                     className="w-full border border-shBorder rounded p-2 text-white text-sm focus:border-shGreen outline-none" />
            </Field>
            <Field label="Breed" required name="breed" error={fieldErrors.breed}>
              <input value={form.breed} onChange={(e)=>set({breed:e.target.value})} placeholder="Golden Retriever"
                     className="w-full border border-shBorder rounded p-2 text-white text-sm focus:border-shGreen outline-none" />
            </Field>
          </div>

          <div data-field="age" className={fieldErrors.age ? "rounded-lg -m-1 p-1 ring-1 ring-shOrange/60" : ""}>
          {fieldErrors.age && (
            <p className="mb-1 text-[12px] text-shOrange font-bold" data-testid="pd-error-age">
              <i className="fas fa-circle-exclamation mr-1"/>{fieldErrors.age}
            </p>
          )}
          <p className="text-[11px] text-shTextMuted mb-1">Know the birthday? Add it and we&apos;ll work out the age. Otherwise give us a rough age.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {form.birthday ? (
              <>
                <Field label="Age">
                  <div className="w-full border border-shBorder rounded p-2 text-shText text-sm flex items-center gap-2" style={{ background: "var(--sh-card-base)" }}>
                    <i className="fas fa-magic-wand-sparkles text-shGreen text-[13px]"/>
                    <span>{dogAgeLabel(form)}</span>
                  </div>
                </Field>
                <Field label="Birthday">
                  <input type="date" value={form.birthday} onChange={(e)=>set({birthday:e.target.value})}
                         className="w-full border border-shBorder rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
                </Field>
                <Field label="">
                  <button type="button" onClick={()=>set({birthday:""})}
                          className="w-full mt-1 text-[13px] text-gray-500 hover:text-gray-300 underline">Clear birthday</button>
                </Field>
              </>
            ) : (
              <>
                <Field label="Years">
                  <input type="number" min="0" value={form.age_y} onChange={(e)=>set({age_y:e.target.value})}
                         className="w-full border border-shBorder rounded p-2 text-white text-sm" />
                </Field>
                <Field label="Months">
                  <input type="number" min="0" max="11" value={form.age_m} onChange={(e)=>set({age_m:e.target.value})}
                         className="w-full border border-shBorder rounded p-2 text-white text-sm" />
                </Field>
                <Field label="Birthday">
                  <input type="date" value={form.birthday} onChange={(e)=>set({birthday:e.target.value})}
                         className="w-full border border-shBorder rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
                </Field>
              </>
            )}
          </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sex" required name="sex" error={fieldErrors.sex}>
              <select value={form.sex} onChange={(e)=>set({sex:e.target.value})} data-testid="pd-sex"
                      className="w-full border border-shBorder rounded p-2 text-white text-sm">
                <option value="">Select…</option>
                <option value="Male">Male</option><option value="Female">Female</option>
              </select>
            </Field>
            <Field label="Spayed / Neutered" required name="fixed" error={fieldErrors.fixed}>
              <select value={form.fixed} onChange={(e)=>set({fixed:e.target.value})} data-testid="pd-fixed"
                      className="w-full border border-shBorder rounded p-2 text-white text-sm">
                <option value="">Select…</option>
                <option value="Yes">Yes</option><option value="No">No</option>
              </select>
            </Field>
          </div>

          <div className="border border-shAccent/25 rounded-lg p-4 space-y-3" style={{ background: "var(--sh-card-base)" }} data-testid="pd-vaccines-readonly">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold uppercase tracking-widest text-shAccent"><i className="fas fa-shield-virus mr-2"/>Vaccinations</p>
            </div>
            <p className="text-[13px] text-shTextMuted leading-snug">
              Vaccine dates can't be edited here — they only update once {"Sit Happens"} reviews and approves an uploaded certificate.
              {isEdit ? " Use the button below to submit a new certificate." : " You can add certificates for this pup right after saving."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[["rabies","Rabies"],["bordetella","Bordetella"],["dhpp","DHPP (distemper/parvo combo)"]].map(([k,label]) => {
                const st = vaxStatusLabel(form.vaccines?.[k]);
                return (
                  <div key={k} className="rounded border border-shBorder p-2.5" style={{ background: "var(--sh-card-base)" }} data-testid={`pd-vax-status-${k}`}>
                    <p className="text-[11px] font-black text-gray-300 uppercase tracking-widest">{label}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5">On file: {fmtVaxDate(form.vaccines?.[k])}</p>
                    <span className={`inline-block mt-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span>
                  </div>
                );
              })}
            </div>
            {isEdit && onUploadVaccines && (
              <button type="button" onClick={() => onUploadVaccines(dog)} data-testid="pd-upload-vaccines-cta"
                      className="w-full min-h-[44px] bg-shBlue/15 hover:bg-shBlue/25 text-shBlue text-[12px] font-black uppercase tracking-widest px-3 py-2 rounded border border-shBlue/30 transition">
                <i className="fas fa-camera mr-1.5"/>Upload / update vaccine certificate
              </button>
            )}
          </div>

          <Field label="Photo (optional)">
            <div className="flex items-center gap-3">
              {form.photo && <img src={form.photo} alt="" loading="lazy" decoding="async" className="h-16 w-16 rounded object-cover border border-shBorder" />}
              <label className="border border-shBorder rounded px-4 py-2 cursor-pointer text-xs font-bold uppercase tracking-widest text-shTextMuted hover:bg-shSurfaceRaised transition"
                     style={{ background: "var(--sh-card-base)" }}>
                Upload <input type="file" accept="image/*" onChange={onFile} className="hidden" data-testid="pd-photo" />
              </label>
              {form.photo && <button onClick={()=>set({photo:""})} className="text-red-400 text-xs font-black uppercase">Remove</button>}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Vet name" name="vet_name"
                   hint="Optional — so we can reach them in an emergency. You can add this later.">
              <input value={form.vet_name} onChange={(e)=>set({vet_name:e.target.value})}
                     className="w-full border border-shBorder rounded p-2 text-white text-sm" />
            </Field>
            <Field label="Vet phone" name="vet_phone">
              <input value={form.vet_phone} onChange={(e)=>set({vet_phone:e.target.value})}
                     className="w-full border border-shBorder rounded p-2 text-white text-sm" />
            </Field>
          </div>

          <Field label="Notes — allergies, fears, special needs, anything we should know">
            <textarea value={form.notes} onChange={(e)=>set({notes:e.target.value})} rows={3}
                      className="w-full border border-shBorder rounded p-2 text-white text-sm focus:border-shGreen outline-none" />
          </Field>

          {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <PremiumButton variant="ghost" onClick={onClose}>Cancel</PremiumButton>
            <PremiumButton variant="primary" onClick={save} disabled={saving} data-testid="pd-submit">
              {saving ? "Saving…" : (isEdit ? "Save Changes" : "Add Dog")}
            </PremiumButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required = false, children, name, error, hint }) {
  return (
    <div data-field={name} className={error ? "rounded-lg -m-1 p-1 ring-1 ring-shOrange/60" : ""}>
      <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest break-words">
        {label}{required && <span className="text-shOrange ml-1">*</span>}
      </label>
      <div className="mt-1">{children}</div>
      {error && (
        <p className="mt-1 text-[12px] text-shOrange font-bold break-words" data-testid={`pd-error-${name}`}>
          <i className="fas fa-circle-exclamation mr-1"/>{error}
        </p>
      )}
      {!error && hint && <p className="mt-1 text-[11px] text-shTextMuted break-words">{hint}</p>}
    </div>
  );
}
