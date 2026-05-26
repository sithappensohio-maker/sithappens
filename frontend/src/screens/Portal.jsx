import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import WaiverModal from "../components/WaiverModal";
import Lightbox from "../components/Lightbox";
import PortalDogModal from "../components/PortalDogModal";
import PortalProfileModal from "../components/PortalProfileModal";
import PortalTrainingCard from "../components/PortalTrainingCard";
import PortalFilesSection from "../components/PortalFilesSection";
import PortalBookWizard from "../components/PortalBookWizard";
import HomeworkSectionLogger from "../components/HomeworkSectionLogger";
import DailyCheckInCard from "../components/DailyCheckInCard";
import TodayPlanCard from "../components/TodayPlanCard";
import HomeworkIncentivesPanel from "../components/HomeworkIncentivesPanel";
import PlanProgressRing from "../components/PlanProgressRing";
import MultiDateCalendar from "../components/MultiDateCalendar";
import InstallAppButton from "../components/InstallAppButton";
import TextSizePicker from "../components/TextSizePicker";
import TrophyWall from "../components/TrophyWall";
import TrophyCelebration from "../components/TrophyCelebration";
import ServicesByCategory from "../components/ServicesByCategory";
import Tutorials from "./Tutorials";
import { useConfirm } from "../lib/useConfirm";
import { compressImage } from "../lib/imageCompress";

function todayISO() { return new Date().toISOString().split("T")[0]; }

const _WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const _emptyRecurring = { dog_id: "", service_type: "daycare", weekdays: [0, 2, 4], notes: "", default_horizon_weeks: 12, active: true, label: "", start_date: "" };

/**
 * Client-facing "My Recurring Schedules" — same model as the admin Recurring
 * screen, scoped server-side to the calling client's dogs.
 *
 * Why a modal: keeps the Portal compact and lets us open it from a Quick Link
 * without occupying screen real-estate when the client isn't using it.
 */
function MyRecurringModal({ dogs, onClose }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(_emptyRecurring);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState("list"); // "list" | "form"

  const load = async () => {
    try { const { data } = await api.get("/recurring-templates"); setRows(data); } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Load failed"); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ ..._emptyRecurring, dog_id: dogs[0]?.id || "" }); setStep("form"); setErr(""); };
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      dog_id: r.dog_id, service_type: r.service_type,
      weekdays: r.weekdays || [], notes: r.notes || "",
      default_horizon_weeks: r.default_horizon_weeks || 12,
      active: r.active !== false, label: r.label || "",
      start_date: r.start_date || "",
    });
    setStep("form"); setErr("");
  };

  const save = async () => {
    setErr("");
    if (!form.dog_id) { setErr("Pick a dog."); return; }
    if (!form.weekdays.length) { setErr("Pick at least one weekday."); return; }
    try {
      if (editing) await api.put(`/recurring-templates/${editing.id}`, form);
      else await api.post("/recurring-templates", form);
      await load(); setStep("list");
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
  };

  const extend = async (r) => {
    setBusy(r.id); setToast(null);
    try {
      const { data } = await api.post(`/recurring-templates/${r.id}/extend`, {});
      const skipped = (data.skipped || []).length;
      setToast({ ok: true, msg: `Booked ${data.created} day${data.created !== 1 ? "s" : ""} through ${data.window?.to}.${skipped ? ` ${skipped} skipped (already booked).` : ""}` });
      load();
    } catch (e) {
      setToast({ ok: false, msg: formatErr(e.response?.data?.detail) || "Extend failed" });
    } finally { setBusy(null); }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete "${r.label}"? Already-booked sessions remain on the calendar.`)) return;
    try { await api.delete(`/recurring-templates/${r.id}`); load(); } catch (e) { console.warn("recurring delete failed", e); }
  };

  const toggleDay = (d) => setForm(f => ({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d].sort() }));

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur grid place-items-center p-3 sm:p-6" onClick={onClose} data-testid="my-recurring-modal">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-4 flex items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-2 min-w-0">
            {step === "form" && <button onClick={()=>setStep("list")} className="text-gray-400 hover:text-white"><i className="fas fa-arrow-left"/></button>}
            <h2 className="text-lg font-black uppercase italic text-white tracking-tight truncate"><i className="fas fa-rotate text-shGreen mr-2"/>{step === "form" ? (editing ? "Edit Schedule" : "New Schedule") : "My Recurring Schedules"}</h2>
          </div>
          <button onClick={onClose} data-testid="my-recurring-close" className="text-gray-500 hover:text-white"><i className="fas fa-xmark text-xl"/></button>
        </div>

        <div className="p-5 space-y-3">
          {toast && (
            <div className={`rounded-lg p-3 text-[15px] ${toast.ok ? "bg-shGreen/15 text-shGreen border border-shGreen/40" : "bg-red-500/15 text-red-400 border border-red-500/40"}`}>
              <i className={`fas ${toast.ok ? "fa-check-circle" : "fa-triangle-exclamation"} mr-2`}/>{toast.msg}
            </div>
          )}

          {step === "list" && (
            <>
              <p className="text-[14px] text-gray-400 normal-case leading-relaxed">Set up a weekly daycare pattern once (e.g. M/W/F), then tap <strong className="text-white">Extend</strong> any time to roll the next batch of bookings forward.</p>
              {rows.length === 0 ? (
                <div className="bg-bgBase border border-dashed border-bgHover rounded-lg p-6 text-center" data-testid="my-recurring-empty">
                  <i className="fas fa-calendar-week text-gray-600 text-3xl mb-2"/>
                  <p className="text-white font-black text-[14px] uppercase tracking-widest">No saved schedules yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rows.map(r => (
                    <div key={r.id} className="bg-bgBase border border-bgHover rounded-lg p-3" data-testid={`my-recurring-row-${r.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-white font-black text-[14px] truncate">{r.label}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {_WD.map((d, i) => (
                              <span key={i} className={`text-[12px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${r.weekdays?.includes(i) ? "bg-shBlue/25 text-shBlue" : "bg-bgHover text-gray-600"}`}>{d}</span>
                            ))}
                          </div>
                          <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-1.5">
                            {r.last_booked_through ? <>Booked through <span className="text-white">{r.last_booked_through}</span></> : "Never extended"}
                          </p>
                        </div>
                        <button onClick={()=>extend(r)} disabled={busy === r.id} data-testid={`my-extend-${r.id}`}
                                className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-40 whitespace-nowrap shrink-0">
                          {busy === r.id ? <><i className="fas fa-circle-notch fa-spin mr-1"/>…</> : <><i className="fas fa-forward mr-1"/>Extend</>}
                        </button>
                      </div>
                      <div className="flex gap-3 mt-2 text-[13px] font-black uppercase tracking-widest">
                        <button onClick={()=>openEdit(r)} className="text-shBlue hover:underline">Edit</button>
                        <button onClick={()=>remove(r)} className="text-red-400 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={openNew} data-testid="my-recurring-new-btn"
                      className="w-full bg-shBlue text-white px-4 py-3 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shBlue/90">
                <i className="fas fa-plus mr-2"/>New Schedule
              </button>
            </>
          )}

          {step === "form" && (
            <div className="space-y-3">
              <div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                <select value={form.dog_id} onChange={(e)=>setForm({...form, dog_id: e.target.value})}
                        data-testid="my-recurring-dog-select"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option value="">— pick a dog —</option>
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}{d.breed ? ` · ${d.breed}` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Weekdays</label>
                <div className="flex gap-1 mt-1.5">
                  {_WD.map((d, i) => (
                    <button key={i} type="button" onClick={()=>toggleDay(i)}
                            data-testid={`my-recurring-day-${i}`}
                            className={`flex-1 py-2 rounded text-[13px] font-black uppercase tracking-widest transition ${form.weekdays.includes(i) ? "bg-shBlue text-white" : "bg-bgBase text-gray-500 hover:bg-bgHover"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Start on</label>
                <input type="date" value={form.start_date}
                       onChange={(e)=>setForm({...form, start_date: e.target.value})}
                       data-testid="my-recurring-start-date"
                       style={{colorScheme:"dark"}}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                <p className="text-[12px] text-gray-500 normal-case tracking-normal mt-1">Leave blank to start today.</p>
              </div>
              <div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Default extend window (weeks)</label>
                <input type="number" min="1" max="52" value={form.default_horizon_weeks}
                       onChange={(e)=>setForm({...form, default_horizon_weeks: parseInt(e.target.value) || 12})}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                <p className="text-[12px] text-gray-500 normal-case tracking-normal mt-1">How far forward each "Extend" tap should book at once. Default 12 weeks (~3 months).</p>
              </div>
              <div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Notes (optional)</label>
                <input value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})}
                       placeholder="e.g. drop-off after 8am"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
              </div>
              {err && <p className="text-red-400 text-[14px] normal-case">{err}</p>}
              <div className="bg-shBlue/10 border border-shBlue/30 rounded p-2.5 text-[13px] text-gray-300 normal-case leading-snug">
                <i className="fas fa-circle-info text-shBlue mr-1"/>Daycare schedules only. For training schedules, request a free evaluation and our team will set it up for you.
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={()=>setStep("list")} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
                <button onClick={save} data-testid="my-recurring-save-btn"
                        className="bg-shBlue text-white px-5 py-2 rounded font-black text-[14px] uppercase tracking-widest hover:bg-shBlue/90">
                  {editing ? "Save" : "Create"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



/**
 * Inner "Download PIN" strip that sits inside the gallery card (below the
 * clickable link), making the relationship between the PIN and the gallery
 * unmistakable. Hidden if no PIN is set.
 */
function GalleryPinRow({ pin, accent = "green" }) {
  const [copied, setCopied] = useState(false);
  if (!pin) return null;
  const copy = async (e) => {
    e?.stopPropagation?.();
    try { await navigator.clipboard.writeText(pin); setCopied(true); setTimeout(()=>setCopied(false), 1800); } catch {}
  };
  const divider = accent === "orange" ? "border-shOrange/30 bg-shOrange/5" : "border-shGreen/30 bg-bgBase/40";
  return (
    <div data-testid="portal-gallery-pin"
         className={`flex items-center gap-3 px-3 py-3 border-t ${divider}`}>
      <i className="fas fa-key text-shOrange text-lg w-6 text-center shrink-0"/>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-black text-shOrange uppercase tracking-widest leading-none">Your Download PIN</p>
        <p className="text-white font-black text-[17px] tracking-[0.3em] mt-1.5 truncate" data-testid="portal-gallery-pin-value">{pin}</p>
        <p className="text-[12px] text-gray-400 normal-case tracking-normal mt-1.5 leading-tight">Enter this PIN when the gallery asks for it to unlock photo downloads.</p>
      </div>
      <button type="button" onClick={copy} data-testid="portal-gallery-pin-copy"
              className="text-[13px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded bg-shOrange/15 text-shOrange hover:bg-shOrange/25 transition whitespace-nowrap shrink-0">
        <i className={`fas ${copied ? "fa-check" : "fa-copy"} mr-1`}/>{copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ReferFriendModal({ code, onClose }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/?ref=${code}`;
  const message = `Hey! I use Sit Happens for my dog and they're great. Use my referral code ${code} when you sign up and we both win 🐾 ${shareUrl}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(()=>setCopied(false), 2500); } catch {}
  };
  const sms = `sms:?&body=${encodeURIComponent(message)}`;
  const email = `mailto:?subject=${encodeURIComponent("Try Sit Happens with my code!")}&body=${encodeURIComponent(message)}`;
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose} data-testid="refer-modal">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 sm:p-7 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto pb-safe">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3"><span className="text-shOrange text-2xl"><i className="fas fa-gift"/></span><h4 className="text-xl font-black text-white uppercase italic tracking-tight">Refer a Friend</h4></div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><i className="fas fa-times text-lg"/></button>
        </div>
        <p className="text-[14px] text-gray-300 mb-4">Share your code with a friend. After they sign up and complete their first appointment (daycare, training, or boarding), we'll add a free daycare day to your account as a thank-you.</p>
        <div className="bg-bgBase border border-shOrange/40 rounded-lg p-4 text-center mb-4">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Your code</p>
          <p className="text-3xl font-black text-shOrange tracking-[0.3em] mt-1" data-testid="refer-code">{code}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <a href={sms} data-testid="refer-via-sms" className="bg-shGreen/10 hover:bg-shGreen/20 text-shGreen text-center py-3 rounded font-black text-[14px] uppercase tracking-widest"><i className="fas fa-comment mr-1"/>Text</a>
          <a href={email} data-testid="refer-via-email" className="bg-shBlue/10 hover:bg-shBlue/20 text-shBlue text-center py-3 rounded font-black text-[14px] uppercase tracking-widest"><i className="fas fa-envelope mr-1"/>Email</a>
          <button onClick={copy} data-testid="refer-copy" className="bg-shOrange/10 hover:bg-shOrange/20 text-shOrange text-center py-3 rounded font-black text-[14px] uppercase tracking-widest"><i className={`fas ${copied?"fa-check":"fa-copy"} mr-1`}/>{copied?"Copied":"Copy"}</button>
        </div>
        <button onClick={onClose} className="w-full bg-bgBase border border-bgHover text-gray-300 py-3 rounded font-black text-[15px] uppercase tracking-widest">Done</button>
      </div>
    </div>
  );
}

function VaccineUploadModal({ dog, vaccine, onClose, onSaved }) {
  const [expiresOn, setExpiresOn] = useState("");
  const [photo, setPhoto] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const compressed = await compressImage(f, { maxWidth: 1400, maxHeight: 1400, quality: 0.78 });
      setPhoto(compressed);
    } catch (ex) {
      setErr("Couldn't read that photo. Try a different one.");
    }
  };
  const save = async () => {
    if (!expiresOn) { setErr("Pick the new expiry date."); return; }
    setErr(""); setSaving(true);
    try {
      await api.post(`/portal/dogs/${dog.id}/vaccine-update`, { vaccine, expires_on: expiresOn, photo });
      onSaved();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Upload failed.");
    } finally { setSaving(false); }
  };
  const label = { rabies: "Rabies", bordetella: "Bordetella", dhpp: "DHPP" }[vaccine] || vaccine;
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose} data-testid="vaccine-upload-modal">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 sm:p-7 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto pb-safe">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">Update {label} for {dog.name}</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><i className="fas fa-times text-lg"/></button>
        </div>
        <p className="text-[15px] text-gray-400 mb-4">Snap a photo of the new vaccine certificate and enter the expiry date your vet wrote on it.</p>
        <div className="space-y-3">
          <div>
            <label className="text-[14px] text-gray-400 font-black uppercase tracking-widest">New expiry date</label>
            <input type="date" value={expiresOn} onChange={(e)=>setExpiresOn(e.target.value)} data-testid="vaccine-expiry-input"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm" style={{colorScheme:"dark"}} />
          </div>
          <div>
            <label className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Cert photo (optional but recommended)</label>
            <input type="file" accept="image/*" capture="environment" onChange={handleFile} data-testid="vaccine-photo-input"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm file:bg-shBlue file:text-white file:border-0 file:rounded file:px-3 file:py-1 file:font-black file:text-[14px] file:uppercase file:tracking-widest" />
            {photo && <img src={photo} alt="cert preview" className="mt-2 rounded max-h-40 object-contain border border-bgHover"/>}
          </div>
          {err && <p className="text-[15px] text-red-400 font-black uppercase tracking-widest">{err}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 text-gray-400 py-3 text-[15px] font-black uppercase tracking-widest">Cancel</button>
            <button onClick={save} disabled={saving || !expiresOn} data-testid="vaccine-save"
                    className="flex-1 bg-shGreen text-bgHeader py-3 rounded font-black text-[15px] uppercase tracking-widest shadow disabled:opacity-50">{saving?"Saving…":"Submit Update"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Get-started checklist surfaced on every portal load until the client has at
 * least one dog AND every required vaccine has a non-expired date on file.
 * The whole reason this exists: new clients were missing the (subtle) vaccine
 * alerts buried in the dog list and showing up to drop-off with an expired
 * rabies cert. This makes the action item the first thing they see.
 *
 * Dismissible per browser session (`sessionStorage`), so it pops again on
 * next login if anything is still incomplete.
 */
function OnboardingChecklist({ dogs, client, onAddDog, onUploadVaccine, onDismiss }) {
  const today = todayISO();
  const REQ = [
    { key: "rabies", label: "Rabies" },
    { key: "bordetella", label: "Bordetella" },
    { key: "dhpp", label: "DHPP" },
  ];

  const dogRows = dogs.map((d) => {
    const missing = REQ.filter((r) => {
      const v = d.vaccines?.[r.key] || "";
      return !v || v < today;
    });
    return { dog: d, missing };
  });
  const incompleteDogs = dogRows.filter((r) => r.missing.length > 0);
  const totalMissing = incompleteDogs.reduce((n, r) => n + r.missing.length, 0);
  const hasNoDogs = dogs.length === 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
         data-testid="vaccine-onboarding-modal">
      <div className="bg-bgPanel border border-shOrange/60 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl animate-slide-in max-h-[92vh] overflow-y-auto"
           onClick={(e)=>e.stopPropagation()}>
        <div className="bg-gradient-to-br from-shOrange/25 to-shBlue/10 p-5 sm:p-6 border-b border-shOrange/30">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-black uppercase tracking-widest bg-shOrange text-bgHeader px-2 py-0.5 rounded-full">Action Required</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black italic text-white uppercase tracking-tight">
            Welcome{client?.name ? `, ${client.name.split(" ")[0]}` : ""}!
          </h2>
          <p className="text-[14px] text-gray-300 normal-case mt-2 leading-relaxed">
            Before we can host your pup, we need their vaccine records on file. <strong className="text-white">It only takes 2 minutes</strong> — snap a photo of each cert and type in the expiry date.
          </p>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center" data-testid="onboarding-how-it-works">
            <div className="bg-bgBase border border-bgHover rounded-lg p-3">
              <div className="w-9 h-9 mx-auto rounded-full bg-shGreen/15 text-shGreen flex items-center justify-center">
                <i className="fas fa-camera text-base"/>
              </div>
              <p className="text-[12px] font-black text-white uppercase tracking-widest mt-2 leading-tight">1. Upload Cert</p>
              <p className="text-[12px] text-gray-500 normal-case tracking-normal mt-1 leading-tight">Snap a photo + type the expiry date</p>
            </div>
            <div className="bg-bgBase border border-bgHover rounded-lg p-3">
              <div className="w-9 h-9 mx-auto rounded-full bg-shBlue/15 text-shBlue flex items-center justify-center">
                <i className="fas fa-check-double text-base"/>
              </div>
              <p className="text-[12px] font-black text-white uppercase tracking-widest mt-2 leading-tight">2. We Verify</p>
              <p className="text-[12px] text-gray-500 normal-case tracking-normal mt-1 leading-tight">Quick admin check — usually within a few hours</p>
            </div>
            <div className="bg-bgBase border border-bgHover rounded-lg p-3">
              <div className="w-9 h-9 mx-auto rounded-full bg-shOrange/15 text-shOrange flex items-center justify-center">
                <i className="fas fa-calendar-check text-base"/>
              </div>
              <p className="text-[12px] font-black text-white uppercase tracking-widest mt-2 leading-tight">3. Book Stays</p>
              <p className="text-[12px] text-gray-500 normal-case tracking-normal mt-1 leading-tight">Daycare, boarding & training open up</p>
            </div>
          </div>

          {hasNoDogs ? (
            <div className="bg-bgBase border border-bgHover rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-shBlue/20 text-shBlue font-black flex items-center justify-center shrink-0">1</div>
                <div className="flex-1">
                  <p className="text-white font-black text-[15px] uppercase tracking-widest">Add your dog</p>
                  <p className="text-[14px] text-gray-400 normal-case mt-1">Tell us their name, breed, age, and any feeding or medication notes.</p>
                  <button onClick={onAddDog} data-testid="onboarding-add-dog-btn"
                          className="mt-3 bg-shBlue text-white px-4 py-2 rounded font-black text-[14px] uppercase tracking-widest hover:bg-shBlue/90">
                    <i className="fas fa-plus mr-1.5"/>Add Dog
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between bg-bgBase rounded-lg px-4 py-3 border border-bgHover">
                <div>
                  <p className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Vaccines still needed</p>
                  <p className="text-shOrange font-black text-[26px] leading-none mt-1" data-testid="onboarding-missing-count">{totalMissing}</p>
                </div>
                <i className="fas fa-shield-virus text-shOrange/40 text-4xl"/>
              </div>

              <div className="space-y-3">
                {incompleteDogs.map((row) => (
                  <div key={row.dog.id} className="bg-bgBase border border-bgHover rounded-lg p-4">
                    <p className="text-white font-black text-[15px] uppercase tracking-widest">{row.dog.name}{row.dog.breed ? <span className="text-gray-500"> · {row.dog.breed}</span> : null}</p>
                    <div className="mt-3 space-y-2">
                      {row.missing.map((r) => (
                        <div key={r.key} className="flex items-center justify-between gap-3 bg-bgPanel rounded p-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <i className="fas fa-circle-exclamation text-shOrange text-sm"/>
                            <span className="text-[15px] font-black text-white uppercase tracking-widest truncate">{r.label}</span>
                            <span className="text-[13px] text-gray-500 normal-case tracking-normal truncate">
                              {row.dog.vaccines?.[r.key] ? `expired ${row.dog.vaccines[r.key]}` : "no date on file"}
                            </span>
                          </div>
                          <button onClick={() => onUploadVaccine(row.dog, r.key)}
                                  data-testid={`onboarding-upload-${row.dog.id}-${r.key}`}
                                  className="bg-shGreen text-bgHeader px-3 py-1.5 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shGreen/80 whitespace-nowrap">
                            <i className="fas fa-camera mr-1"/>Upload
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-shBlue/10 border border-shBlue/30 rounded-lg p-3 flex gap-3">
                <i className="fas fa-circle-info text-shBlue text-base mt-0.5"/>
                <p className="text-[14px] text-gray-300 normal-case leading-snug">
                  Don't have a clear photo handy? Just type the <strong className="text-white">expiry date</strong> your vet wrote on the certificate — you can upload the photo later. We'll review and approve each upload before it goes live.
                </p>
              </div>
            </>
          )}

          <button onClick={onDismiss} data-testid="onboarding-dismiss-btn"
                  className="w-full text-gray-500 hover:text-gray-300 text-[14px] font-black uppercase tracking-widest py-3">
            Remind me later <span className="opacity-60">(this stays out of your way until next login)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Persistent slim banner at the top of the portal when vaccines are
 *  incomplete. Always visible (not dismissible) because the action is
 *  blocking — they literally can't book daycare without it. */
function OnboardingBanner({ missingCount, onOpen }) {
  if (!missingCount) return null;
  return (
    <button onClick={onOpen} data-testid="vaccine-onboarding-banner"
            className="w-full bg-gradient-to-r from-shOrange/25 to-shOrange/10 border-b border-shOrange/50 px-4 py-3 flex items-center gap-3 hover:from-shOrange/35 transition text-left">
      <i className="fas fa-shield-virus text-shOrange text-lg shrink-0"/>
      <div className="flex-1 min-w-0">
        <p className="text-white font-black text-[15px] uppercase tracking-widest">
          {missingCount} vaccine{missingCount > 1 ? "s" : ""} need uploading before you can book
        </p>
        <p className="text-[13px] text-gray-300 normal-case tracking-normal">Tap to finish setting up your account</p>
      </div>
      <span className="bg-shOrange text-bgHeader text-[13px] font-black uppercase tracking-widest px-3 py-1.5 rounded shrink-0">
        Finish setup <i className="fas fa-arrow-right ml-1 text-[12px]"/>
      </span>
    </button>
  );
}



const SERVICE_INFO = {
  daycare: {
    label: "Daycare",
    icon: "fa-sun",
    color: "text-shBlue",
    summary: "Drop your dog off for the day to play, socialise, and get supervised exercise.",
    bullets: [
      "Best for friendly dogs aged 6 months+",
      "Drop-off & pick-up during business hours",
      "Deducted from your Daycare credit pack on approval",
      "Bordetella + DHPP vaccines required",
    ],
  },
  boarding: {
    label: "Boarding",
    icon: "fa-moon",
    color: "text-shGreen",
    summary: "Overnight stays in our climate-controlled kennels with daily playtime.",
    bullets: [
      "Choose start + end dates (we count nights)",
      "Pay-on-the-day — no credit pack needed",
      "Bring your dog's regular food if possible",
      "Pickup before noon to avoid an extra night",
    ],
  },
  training: {
    label: "Training",
    icon: "fa-graduation-cap",
    color: "text-purple-400",
    summary: "1-on-1 sessions with your trainer working through your dog's training program.",
    bullets: [
      "Deducted from your Training credit pack on approval",
      "Bring a hungry dog (skip the meal beforehand!)",
      "We'll log progress + homework for you to practice",
      "Sessions are usually 30-60 minutes",
    ],
  },
  grooming: {
    label: "Grooming",
    icon: "fa-bath",
    color: "text-pink-400",
    summary: "Bath services and nail trims — keep your pup looking sharp.",
    bullets: [
      "Choose Bath or Nail Trim above",
      "Pay-on-the-day at pickup",
      "Drop off in the morning, pickup same day",
      "Mention any sensitive spots when you arrive",
    ],
  },
  photography: {
    label: "Photography",
    icon: "fa-camera-retro",
    color: "text-shOrange",
    summary: "Professional pet photography sessions. Capture your pup's personality with a custom shoot.",
    bullets: [
      "Pick a date that works for you",
      "Pay-on-the-day at the session",
      "Edited images delivered in your private gallery within 1–2 weeks",
      "Order prints, canvases & gifts straight from your gallery",
    ],
  },
};

function ServiceInfoModal({ type, onClose, customDescriptions }) {
  if (!type) return null;
  const info = SERVICE_INFO[type];
  if (!info) return null;
  const summary = customDescriptions?.[type] || info.summary;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose} data-testid="service-info-modal">
      <div className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 sm:p-7 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto pb-safe" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`text-2xl ${info.color}`}><i className={`fas ${info.icon}`}/></span>
            <h4 className="text-lg sm:text-xl font-black text-white uppercase italic tracking-tight">{info.label}</h4>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 -m-1" data-testid="service-info-close"><i className="fas fa-times text-lg"/></button>
        </div>
        <p className="text-[14px] text-gray-300 mb-4 whitespace-pre-line">{summary}</p>
        <ul className="space-y-2">
          {info.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-[15px] text-gray-300">
              <i className={`fas fa-check ${info.color} mt-1 text-[13px] shrink-0`}/>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <button onClick={onClose} className="mt-5 w-full bg-bgBase border border-bgHover text-gray-300 hover:text-white py-3 rounded font-black text-[15px] uppercase tracking-widest">Got it</button>
      </div>
    </div>
  );
}

export default function Portal() {
  const confirm = useConfirm();
  const { user, logout, reloadUser } = useAuth();
  const [dogs, setDogs] = useState([]);
  const [client, setClient] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [bookDogId, setBookDogId] = useState("");
  const [bookDate, setBookDate] = useState(todayISO());
  const [bookEnd, setBookEnd] = useState("");
  const [bookType, setBookType] = useState("daycare");
  const [groomingType, setGroomingType] = useState("bath");
  const [isRecurring, setIsRecurring] = useState(false);
  const [isMultiDate, setIsMultiDate] = useState(false);
  const [multiDates, setMultiDates] = useState([]);  // array of YYYY-MM-DD
  const [recEnd, setRecEnd] = useState("");
  const [recDays, setRecDays] = useState([]);
  const [avail, setAvail] = useState(null);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [waiver, setWaiver] = useState(null); // {signed, current_version, signature, needs_resign}
  const [pubSettings, setPubSettings] = useState(null);
  const [showServiceInfo, setShowServiceInfo] = useState(null); // service type key
  const [showWaiver, setShowWaiver] = useState(false);
  const [homework, setHomework] = useState([]);
  const [hwModal, setHwModal] = useState(null);
  const [hwNote, setHwNote] = useState("");
  const [hwPhoto, setHwPhoto] = useState("");
  const [lightbox, setLightbox] = useState({ open: false, photos: [], index: 0 });
  const [dogModal, setDogModal] = useState({ open: false, dog: null });
  const [profileOpen, setProfileOpen] = useState(false);
  const [tutorialsOpen, setTutorialsOpen] = useState(false);
  const [publicServices, setPublicServices] = useState([]);
  const [publicPrograms, setPublicPrograms] = useState([]);
  const [showServicesModal, setShowServicesModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  // Client-portal bookings tab: "upcoming" (pending+approved+today) | "past" (completed+cancelled+rejected) | "all"
  const [bookingsTab, setBookingsTab] = useState("upcoming");
  // Optional month filter for the "All" tab — "YYYY-MM" or "" for no filter.
  const [bookingsMonth, setBookingsMonth] = useState("");
  // New: wizard-based booking flow (replaces inline form).
  const [showBookWizard, setShowBookWizard] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [dRes, bRes, wRes, sRes, hRes, svcRes, prgRes] = await Promise.all([
        api.get("/dogs"),
        api.get("/bookings"),
        api.get("/waivers/me"),
        api.get("/settings/public"),
        api.get("/homework"),
        api.get("/services").catch(()=>({data:[]})),
        api.get("/programs").catch(()=>({data:[]})),
      ]);
      setDogs(dRes.data);
      setBookings(bRes.data);
      setWaiver(wRes.data);
      setPubSettings(sRes.data);
      setHomework(hRes.data);
      setPublicServices((svcRes.data || []).filter(s => s.active));
      setPublicPrograms((prgRes.data || []));
      if (dRes.data.length > 0 && !bookDogId) setBookDogId(dRes.data[0].id);
      // Only auto-open the waiver modal AFTER the user has added at least one dog
      // (otherwise the onboarding banner takes them through profile → dog → waiver in order).
      const needsSign = !wRes.data?.signed || wRes.data?.needs_resign;
      if (needsSign && sRes.data?.waiver_required_for_booking && dRes.data.length > 0) setShowWaiver(true);
      await reloadUser();
    } catch (e) { console.warn("portal loadAll failed", e); }
  }, [bookDogId, reloadUser]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Onboarding state — compute total missing/expired required vaccines.
  // Anything > 0 here keeps the orange "finish setup" banner pinned.
  const onboardingMissing = (() => {
    const today = todayISO();
    const REQ = ["rabies", "bordetella", "dhpp"];
    let total = 0;
    for (const d of dogs) {
      for (const v of REQ) {
        const exp = d.vaccines?.[v] || "";
        if (!exp || exp < today) total += 1;
      }
    }
    return total;
  })();
  const onboardingNeeded = dogs.length === 0 || onboardingMissing > 0;
  const dismissOnboarding = () => {
    try { sessionStorage.setItem("sh_onboarding_dismissed", "1"); } catch {}
    setOnboardingDismissed(true);
  };
  const reopenOnboarding = () => {
    try { sessionStorage.removeItem("sh_onboarding_dismissed"); } catch {}
    setOnboardingDismissed(false);
  };

  // Fetch credits separately via a small endpoint - we'll use the user from useAuth but credits live on client doc.
  // Use a helper: fetch own client info via portal endpoint
  const [credits, setCredits] = useState(0);
  const [visitCounts, setVisitCounts] = useState({});
  const [referralCode, setReferralCode] = useState(null);
  const [dogFilter, setDogFilter] = useState("");  // empty = show all dogs' bookings
  const [rebookSeed, setRebookSeed] = useState(null);  // {dog_id, service_type} preselected when "Book Again" tapped
  const [showReferModal, setShowReferModal] = useState(false);
  const [vaccineModal, setVaccineModal] = useState(null); // { dog, vaccine }
  // Onboarding checklist — auto-pops on portal load when any required vaccine
  // is missing/expired (or the client has no dog yet). Dismissed-this-session
  // is tracked in sessionStorage so it reappears next login until resolved.
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem("sh_onboarding_dismissed") === "1"
  );
  const [trophies, setTrophies] = useState({ client_trophies: [], dog_trophies: [], unseen: [] });
  const [celebrating, setCelebrating] = useState([]);
  const loadTrophies = useCallback(async () => {
    try {
      const { data } = await api.get("/portal/trophies");
      setTrophies(data);
      if ((data.unseen || []).length) setCelebrating(data.unseen);
    } catch (e) { console.warn("loadTrophies failed", e); }
  }, []);
  useEffect(() => { loadTrophies(); }, [loadTrophies, bookings]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/portal/me");
        setClient(data.client); setCredits(data.client.credits);
        setVisitCounts(data.visit_counts || {});
        setReferralCode(data.referral_code || null);
      } catch (e) { console.warn("portal/me load failed", e); }
    })();
  }, [bookings]);

  const checkAvail = useCallback(async () => {
    if (!bookDogId || !bookDate) return;
    try {
      const { data } = await api.get("/bookings/availability", { params: { date_str: bookDate, dog_id: bookDogId } });
      setAvail(data);
    } catch (e) {
      setAvail(null);
      setErr(formatErr(e.response?.data?.detail));
    }
  }, [bookDogId, bookDate]);

  useEffect(() => { checkAvail(); }, [checkAvail]);

  const book = async () => {
    setErr(""); setSuccess("");
    if (bookType === "training") {
      setErr("Training sessions require a free evaluation first. Tap \"Request Info\" below to get in touch and we'll set you up.");
      return;
    }
    try {
      if (isMultiDate && bookType !== "boarding") {
        if (multiDates.length === 0) { setErr("Pick at least one date"); return; }
        const { data } = await api.post("/bookings/multi-dates", {
          dog_id: bookDogId, dates: multiDates, service_type: bookType,
        });
        const c = data.created?.length || 0;
        const s = data.skipped?.length || 0;
        setSuccess(`${c} bookings created${s?`, ${s} skipped (${data.skipped.map(x=>`${x.date}: ${x.reason}`).join('; ')})`:""}.`);
        setMultiDates([]); setIsMultiDate(false);
      } else if (isRecurring && bookType !== "boarding") {
        if (recDays.length === 0) { setErr("Pick at least one weekday"); return; }
        if (!recEnd) { setErr("Pick an end date for the recurrence"); return; }
        const { data } = await api.post("/bookings/recurring", {
          dog_id: bookDogId, start_date: bookDate, end_date: recEnd,
          service_type: bookType, weekdays: recDays,
        });
        const c = data.created?.length || 0;
        const s = data.skipped?.length || 0;
        setSuccess(`${c} bookings created${s?`, ${s} skipped`:""}.`);
      } else {
        await api.post("/bookings", { dog_id: bookDogId, date: bookDate, end_date: bookType==="boarding"?bookEnd||bookDate:null, service_type: bookType, grooming_type: bookType==="grooming" ? groomingType : null });
        setSuccess("Booking submitted! Awaiting admin approval.");
      }
      loadAll();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const toggleMultiDate = (d) => setMultiDates(multiDates.includes(d) ? multiDates.filter(x=>x!==d) : [...multiDates, d].sort());

  const toggleRecDay = (d) => setRecDays(recDays.includes(d) ? recDays.filter(x=>x!==d) : [...recDays, d]);

  const cancel = async (id) => {
    if (!(await confirm({ title: "Cancel this booking?", body: "Credits aren't charged until check-out, so cancelling is free.", confirmText: "Cancel booking", cancelText: "Keep it", tone: "danger" }))) return;
    try { await api.delete(`/bookings/${id}`); loadAll(); } catch (e) { alert(formatErr(e.response?.data?.detail)); }
  };

  const completeHw = async () => {
    try {
      await api.post(`/homework/${hwModal.id}/complete`, { note: hwNote, photo: hwPhoto });
      setHwModal(null); setHwNote(""); setHwPhoto(""); loadAll();
    } catch (e) { alert(formatErr(e.response?.data?.detail)); }
  };

  const onHwFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const dataUrl = await compressImage(f);
    setHwPhoto(dataUrl);
  };

  const waiverNeeded = pubSettings?.waiver_required_for_booking && (!waiver?.signed || waiver?.needs_resign);
  // Bug fix: previously this had `&& bookType !== "training"` which disabled
  // the Book Now button for ALL training bookings. Training is bookable.
  const canBook = avail && avail.vaccine_ok && avail.open_slots > 0 && !waiverNeeded;

  // Onboarding checklist — show until all complete
  const profileComplete = !!(client?.phone && client?.address);
  const hasDog = dogs.length > 0;
  const waiverDone = waiver?.signed && !waiver?.needs_resign;
  const onboardingDone = profileComplete && hasDog && waiverDone;
  const onboardingStep = !profileComplete ? 1 : !hasDog ? 2 : !waiverDone ? 3 : 4;

  return (
    <div className="h-full flex flex-col bg-bgBase" data-testid="client-portal">
      <OnboardingBanner missingCount={onboardingMissing} onOpen={reopenOnboarding} />
      <header className="bg-bgHeader border-b border-bgHover flex items-center justify-between gap-2 px-3 sm:px-8 py-3 sm:py-0 sm:h-24">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <img src="/logo.png" alt="Sit Happens" className="h-10 sm:h-16 shrink-0" data-testid="portal-logo" />
          <div className="min-w-0">
            <p className="hidden sm:block text-[15px] text-gray-500 font-black uppercase tracking-[0.25em]">Dog Training • Daycare • Boarding • Photography</p>
            <p className="text-[13px] sm:text-xs text-shGreen font-black uppercase tracking-widest sm:mt-1 truncate">Welcome, {user.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button onClick={()=>setTutorialsOpen(true)} data-testid="portal-help-button"
                  className="text-[13px] sm:text-xs bg-shBlue/10 text-shBlue px-2.5 sm:px-4 py-2 rounded font-black uppercase tracking-widest hover:bg-shBlue/20 flex items-center gap-2">
            <i className="fas fa-circle-question"/>
            <span className="hidden sm:inline">How to Use</span>
          </button>
          <InstallAppButton
            testid="portal-install-app"
            label="Install"
            className="text-[13px] sm:text-xs bg-shGreen/10 text-shGreen px-2.5 sm:px-4 py-2 rounded font-black uppercase tracking-widest hover:bg-shGreen/20 flex items-center gap-2"
          />
          <button onClick={logout} data-testid="logout-button" className="text-[13px] sm:text-xs bg-red-500/10 text-red-400 px-2.5 sm:px-4 py-2 rounded font-black uppercase tracking-widest hover:bg-red-500/20">
            <i className="fas fa-right-from-bracket sm:hidden"/>
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 sm:p-8 max-w-6xl mx-auto w-full pb-24 md:pb-8">
        {!onboardingDone && (
          <div className="mb-4 sm:mb-6 card-hero rounded-xl p-4 sm:p-6 shadow-2xl" data-testid="onboarding-banner">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-black text-white uppercase italic tracking-tight">Hi {user.name.split(" ")[0]}! 🐾 Welcome to Sit Happens</h3>
                <p className="text-[15px] sm:text-[14px] text-gray-300 mt-1">So glad you're here. Before booking your pup's first stay, please knock out these quick steps so we can take great care of them.</p>
              </div>
              <span className="shrink-0 bg-shGreen/20 text-shGreen text-[13px] sm:text-[15px] font-black uppercase tracking-widest px-2 sm:px-3 py-1 rounded-full">{Math.min(onboardingStep - 1, 3)} of 3</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <OnboardStep n={1} done={profileComplete} active={onboardingStep===1} title="Complete your profile" desc="Add your phone, address and emergency contact." cta="Edit Profile" onClick={()=>setProfileOpen(true)} testId="onb-profile" />
              <OnboardStep n={2} done={hasDog} active={onboardingStep===2} title="Add your dog(s)" desc="Tell us about your pup — breed, age, and vaccinations (rabies expiration is required)." cta="Add a Dog" onClick={()=>setDogModal({open:true, dog:null})} testId="onb-adddog" disabled={onboardingStep<2} />
              <OnboardStep n={3} done={waiverDone} active={onboardingStep===3} title="Sign the waiver" desc="A quick e-signature so we're all set legally." cta="Sign Waiver" onClick={()=>setShowWaiver(true)} testId="onb-waiver" disabled={onboardingStep<3} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="col-span-1 space-y-6">
          <div className="bg-bgPanel card-pop p-6 rounded-xl border border-bgHover shadow-2xl" data-testid="credits-card">
            <p className="text-[14px] text-gray-400 font-black uppercase tracking-widest text-center mb-4">Your Credits</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-bgBase rounded p-3">
                <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">Daycare</p>
                <p className="text-3xl font-black text-shGreen mt-1">{credits}</p>
                <p className="text-[12px] text-gray-500 uppercase tracking-widest mt-1">days</p>
              </div>
              <div className="bg-bgBase rounded p-3">
                <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">Training</p>
                <p className="text-3xl font-black text-purple-400 mt-1">{client?.training_credits || 0}</p>
                <p className="text-[12px] text-gray-500 uppercase tracking-widest mt-1">sessions</p>
              </div>
              <div className="bg-bgBase rounded p-3">
                <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">Boarding</p>
                <p className="text-3xl font-black text-shOrange mt-1">{client?.boarding_credits || 0}</p>
                <p className="text-[12px] text-gray-500 uppercase tracking-widest mt-1">nights</p>
              </div>
            </div>
            <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-3 text-center">Grooming is pay-on-the-day</p>
            <button onClick={()=>setProfileOpen(true)} data-testid="open-profile"
                    className="mt-4 w-full bg-bgBase border border-bgHover text-gray-300 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:border-shBlue hover:text-shBlue">
              <i className="fas fa-user-pen mr-2"/>My Profile
            </button>
            <button onClick={()=>{
                       const el = document.getElementById("portal-bookings-anchor");
                       if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                     }}
                    data-testid="jump-to-bookings"
                    className="mt-2 w-full bg-bgBase border border-bgHover text-gray-300 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:border-shGreen hover:text-shGreen">
              <i className="fas fa-calendar-day mr-2"/>My Bookings · {bookings.length}
            </button>
            <div className="mt-4 pt-4 border-t border-bgHover">
              <TextSizePicker testid="portal-text-size" compact />
            </div>
          </div>

          <div className={`p-5 rounded-xl border shadow-2xl ${waiverNeeded?"bg-red-500/10 border-red-500/40":"bg-shGreen/5 border-shGreen/30"}`} data-testid="waiver-status-card">
            <div className="flex items-center justify-between mb-2">
              <p className={`text-[14px] font-black uppercase tracking-widest ${waiverNeeded?"text-red-400":"text-shGreen"}`}>
                <i className={`fas ${waiverNeeded?"fa-exclamation-triangle":"fa-file-signature"} mr-2`} /> Client Waiver
              </p>
              {waiver?.signed && !waiver?.needs_resign && <span className="text-[15px] text-gray-500 font-black uppercase tracking-widest">v{waiver.signature?.waiver_version}</span>}
            </div>
            {waiverNeeded ? (
              <>
                <p className="text-xs text-gray-300 mb-3">{waiver?.needs_resign?"Our waiver has been updated. Please re-sign to continue booking.":"You must sign the client waiver before booking services."}</p>
                <button onClick={()=>setShowWaiver(true)} data-testid="open-waiver-button"
                        className="w-full bg-red-500 text-white py-2 rounded font-black text-[14px] uppercase tracking-widest hover:bg-red-500/90">
                  Sign Waiver Now
                </button>
              </>
            ) : (
              <p className="text-xs text-gray-400">Signed by <span className="text-white font-black">{waiver?.signature?.typed_name}</span> on {(waiver?.signature?.signed_at||"").slice(0,10)}</p>
            )}
          </div>

          {(pubSettings?.client_portal_links?.website_url || client?.photo_gallery_url || pubSettings?.client_portal_links?.photo_gallery_url || referralCode || publicServices.length > 0 || publicPrograms.length > 0) && (
            <div className="bg-bgPanel p-4 rounded-xl border border-bgHover shadow-lg" data-testid="portal-quick-links">
              <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest mb-3"><i className="fas fa-bookmark text-shBlue mr-2"/>Quick Links</p>
              <div className="grid grid-cols-1 gap-2">
                {(publicServices.length > 0 || publicPrograms.length > 0) && (
                  <button onClick={()=>setShowServicesModal(true)} data-testid="portal-open-services-btn"
                          className="flex items-start gap-3 bg-gradient-to-br from-shGreen/15 to-shBlue/10 hover:from-shGreen/25 hover:to-shBlue/20 border border-shGreen/40 hover:border-shGreen/60 rounded-lg px-3 py-3 transition group text-left w-full">
                    <i className="fas fa-list-check text-shGreen text-2xl w-7 text-center mt-0.5"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-black text-white uppercase tracking-widest">Services & Pricing</div>
                      <p className="text-[13px] text-gray-400 normal-case tracking-normal mt-0.5">{publicServices.length + publicPrograms.length} services & programs offered · request a quote</p>
                    </div>
                    <i className="fas fa-arrow-right text-shGreen group-hover:translate-x-0.5 transition text-xs mt-1"/>
                  </button>
                )}
                {dogs.length > 0 && (
                  <button onClick={()=>setShowRecurringModal(true)} data-testid="portal-open-recurring-btn"
                          className="flex items-start gap-3 bg-gradient-to-br from-shBlue/15 to-purple-500/10 hover:from-shBlue/25 hover:to-purple-500/20 border border-shBlue/40 hover:border-shBlue/60 rounded-lg px-3 py-3 transition group text-left w-full">
                    <i className="fas fa-rotate text-shBlue text-2xl w-7 text-center mt-0.5"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-black text-white uppercase tracking-widest">My Recurring Schedules</div>
                      <p className="text-[13px] text-gray-400 normal-case tracking-normal mt-0.5">Set up M/W/F daycare once · extend 12 weeks in one tap</p>
                    </div>
                    <i className="fas fa-arrow-right text-shBlue group-hover:translate-x-0.5 transition text-xs mt-1"/>
                  </button>
                )}
                {pubSettings?.client_portal_links?.website_url && (
                  <a href={pubSettings.client_portal_links.website_url} target="_blank" rel="noopener noreferrer"
                     data-testid="portal-link-website"
                     className="flex items-center gap-3 bg-bgBase hover:bg-shBlue/15 border border-bgHover hover:border-shBlue/50 rounded px-3 py-2.5 transition">
                    <i className="fas fa-globe text-shBlue text-lg w-6 text-center"/>
                    <span className="text-[14px] font-black text-white uppercase tracking-widest flex-1 text-left">Visit Our Website</span>
                    <i className="fas fa-arrow-up-right-from-square text-gray-500 text-xs"/>
                  </a>
                )}
                {(client?.photo_gallery_url || pubSettings?.client_portal_links?.photo_gallery_url) && (
                  <div data-testid="portal-gallery-card"
                       className={`relative rounded-lg overflow-hidden bg-gradient-to-br border transition ${client?.photo_gallery_has_new
                           ? "from-shOrange/20 to-shGreen/10 border-shOrange/60 shadow-[0_0_18px_-6px_rgba(255,138,0,0.7)]"
                           : "from-shGreen/15 to-shBlue/10 border-shGreen/40 hover:border-shGreen/60"}`}>
                    {client?.photo_gallery_has_new && (
                      <span data-testid="portal-gallery-new-badge"
                            className="absolute top-2 right-2 flex items-center gap-1.5 bg-shOrange text-bgHeader text-[12px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full shadow-[0_0_12px_rgba(255,138,0,0.8)] animate-pulse z-10 ring-2 ring-shOrange/40">
                        <i className="fas fa-bell text-[10px]"/>New photos!
                      </span>
                    )}
                    <a href={client?.photo_gallery_url || pubSettings.client_portal_links.photo_gallery_url} target="_blank" rel="noopener noreferrer"
                       data-testid="portal-link-gallery"
                       onClick={() => {
                         if (client?.photo_gallery_has_new) {
                           api.post("/portal/gallery/mark-seen").catch(() => {});
                           setClient((c) => c ? { ...c, photo_gallery_has_new: false } : c);
                         }
                       }}
                       className="flex items-start gap-3 px-3 py-3 hover:bg-white/[0.03] transition group">
                      <i className={`fas fa-camera-retro text-2xl w-7 text-center mt-0.5 ${client?.photo_gallery_has_new ? "text-shOrange" : "text-shGreen"}`}/>
                      <div className="flex-1 min-w-0 text-left">
                        <div className={`text-[14px] font-black text-white uppercase tracking-widest flex items-center gap-2 ${client?.photo_gallery_has_new ? "pr-32" : ""}`}>
                          See Your Pup In Action
                          <span className="text-[12px] font-black bg-shOrange/20 text-shOrange px-1.5 py-0.5 rounded uppercase tracking-widest">Order Prints</span>
                        </div>
                        <p className="text-[13px] text-gray-400 normal-case tracking-normal mt-0.5">
                          {client?.photo_gallery_has_new
                            ? "Fresh photos just dropped! Browse your private gallery & order prints"
                            : "Browse your private gallery & order high-quality prints"}
                        </p>
                      </div>
                      <i className={`fas fa-arrow-up-right-from-square group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition text-xs mt-1 ${client?.photo_gallery_has_new ? "text-shOrange" : "text-shGreen"}`}/>
                    </a>
                    <GalleryPinRow pin={client?.photo_gallery_pin} accent={client?.photo_gallery_has_new ? "orange" : "green"} />
                  </div>
                )}
                {referralCode && (
                  <button onClick={()=>setShowReferModal(true)} data-testid="portal-refer-friend"
                          className="flex items-center gap-3 bg-bgBase hover:bg-shOrange/15 border border-bgHover hover:border-shOrange/50 rounded px-3 py-2.5 transition w-full text-left">
                    <i className="fas fa-gift text-shOrange text-lg w-6 text-center"/>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-black text-white uppercase tracking-widest">Refer a Friend</p>
                      <p className="text-[13px] text-gray-500 normal-case tracking-normal">Earn a free daycare day for every referral</p>
                    </div>
                    <i className="fas fa-arrow-right text-gray-500 text-xs"/>
                  </button>
                )}
              </div>
            </div>
          )}

          <div id="portal-book-section" className="bg-bgPanel p-6 rounded-xl border border-bgHover shadow-2xl">
            <h4 className="font-black text-shBlue mb-2 uppercase text-xs tracking-widest">
              <i className="fas fa-calendar-plus mr-2"/>Book a Service
            </h4>
            <p className="text-[14px] text-gray-500 mb-4 leading-relaxed">
              {dogs.length === 0 ? "Add a dog first to book a service." :
               waiverNeeded ? "Sign the waiver before booking your first service." :
               "Choose a service, pick a date, and we'll take it from there."}
            </p>
            <button
              onClick={() => setShowBookWizard(true)}
              disabled={dogs.length === 0 || waiverNeeded}
              data-testid="portal-book-button"
              className={`w-full py-4 rounded font-black uppercase text-[14px] tracking-widest shadow-lg flex items-center justify-center gap-2 transition ${
                (dogs.length === 0 || waiverNeeded)
                  ? "bg-bgBase text-gray-500 cursor-not-allowed border border-bgHover"
                  : "bg-shBlue text-white hover:bg-shBlue/90"
              }`}>
              <i className="fas fa-calendar-plus"/>Book Service
            </button>
            {waiverNeeded && (
              <button onClick={()=>setShowWaiver(true)} data-testid="portal-book-waiver-link"
                      className="w-full mt-2 text-[14px] text-shOrange underline decoration-dotted text-center font-black uppercase tracking-widest">
                Sign waiver to enable booking
              </button>
            )}
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          {/* Sprint 110n — Homework is the #1 client priority; promoted to the
              top of the portal main column, followed by Achievements. The old
              referral feed has been removed (client uses a separate system). */}
          {homework.length > 0 && (
            <div data-testid="portal-homework">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4"><i className="fas fa-graduation-cap text-shBlue mr-2"/>Training Homework</h2>
              <div className="space-y-3">
                {homework.map(h => {
                  const hasTemplate = !!h.template_snapshot;
                  return (
                  <div key={h.id} className={`bg-bgPanel border rounded-xl p-4 ${h.status==="completed"?"border-shGreen/40":"border-shOrange/40"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`text-[14px] font-black uppercase px-2 py-0.5 rounded tracking-widest ${h.status==="completed"?"bg-shGreen/15 text-shGreen":"bg-shOrange/15 text-shOrange"}`}>{h.status}</span>
                          {h.daily_tracker && <span className="text-[14px] text-purple-300 bg-purple-500/15 font-black uppercase px-2 py-0.5 rounded tracking-widest"><i className="fas fa-calendar-check mr-1"/>Daily Tracker</span>}
                          <span className="text-[14px] text-shBlue font-black uppercase tracking-widest">{h.dog_name}</span>
                          {h.due_date && <span className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Due {h.due_date}</span>}
                          {hasTemplate && !h.daily_tracker && <span className="text-[14px] text-shGreen font-black uppercase tracking-widest"><i className="fas fa-list-check mr-1"/>{(h.section_logs||[]).length} sessions logged</span>}
                        </div>
                        <h4 className="text-sm font-black text-white uppercase tracking-tight">{h.title}</h4>
                        {h.instructions && <p className="text-xs text-gray-300 mt-1 whitespace-pre-wrap">{h.instructions}</p>}
                        {h.video_url && <a href={h.video_url} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[14px] text-shBlue hover:underline font-black uppercase tracking-widest"><i className="fas fa-play mr-1"/>Watch demo</a>}
                      </div>
                      {h.daily_tracker && h.progress_summary && h.status !== "completed" && (
                        <PlanProgressRing
                          pct={h.progress_summary.pct}
                          current={h.progress_summary.current_day}
                          total={h.progress_summary.total_days}
                          completed={h.progress_summary.completed_days}
                          testid={`portal-plan-ring-${h.id}`}
                        />
                      )}
                      {h.status !== "completed" && !h.daily_tracker && (
                        <button onClick={()=>{setHwModal(h); setHwNote(""); setHwPhoto("");}} data-testid={`portal-complete-${h.id}`}
                                className="shrink-0 bg-shGreen text-bgHeader px-4 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shGreen/90">Mark Done</button>
                      )}
                    </div>

                    {h.daily_tracker && h.status !== "completed" && (
                      <>
                        <div className="mt-4 pt-4 border-t border-bgHover" data-testid={`portal-today-${h.id}`}>
                          <TodayPlanCard homeworkId={h.id} unwrapped={true} onChanged={loadAll} />
                        </div>
                        <details className="mt-3 group" data-testid={`portal-history-${h.id}`}>
                          <summary className="list-none cursor-pointer flex items-center justify-between gap-2 py-2 px-3 rounded bg-bgBase border border-bgHover hover:border-shBlue/50 transition">
                            <span className="text-[12px] font-black uppercase tracking-widest text-gray-400 group-hover:text-white">
                              <i className="fas fa-clock-rotate-left mr-2"/>Previous days &amp; history
                            </span>
                            <i className="fas fa-chevron-down text-gray-500 text-xs group-open:rotate-180 transition-transform"/>
                          </summary>
                          <div className="mt-3">
                            <DailyCheckInCard homeworkId={h.id} onChanged={loadAll} hideActionableForm={true} />
                          </div>
                        </details>
                      </>
                    )}
                    {hasTemplate && !h.daily_tracker && h.status !== "completed" && (
                      <div className="mt-4 pt-4 border-t border-bgHover">
                        <HomeworkSectionLogger homework={h} onLogged={loadAll} />
                      </div>
                    )}
                    {h.status === "completed" && h.completion_note && (
                      <p className="mt-2 text-xs text-gray-300 italic">"{h.completion_note}"</p>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {(trophies.client_trophies.length > 0 || trophies.dog_trophies.length > 0) && (
            <div data-testid="portal-trophies-section" className="bg-gradient-to-br from-shOrange/10 via-bgPanel to-shBlue/10 border border-shOrange/30 rounded-2xl p-5">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4 flex items-center gap-2">
                <i className="fas fa-trophy text-shOrange"/> Trophy Wall
                <span className="text-[13px] font-bold uppercase tracking-widest text-gray-500 normal-case">· {trophies.client_trophies.length + trophies.dog_trophies.length} earned</span>
              </h2>
              {trophies.client_trophies.length > 0 && (
                <div className="mb-5">
                  <div className="text-[13px] font-black uppercase tracking-widest text-gray-500 mb-2">Yours</div>
                  <TrophyWall awards={trophies.client_trophies} testIdPrefix="portal-client-trophies"/>
                </div>
              )}
              {trophies.dog_trophies.length > 0 && dogs.map(d => {
                const mine = trophies.dog_trophies.filter(t => t.recipient_id === d.id);
                if (!mine.length) return null;
                return (
                  <div key={d.id} className="mb-4 last:mb-0">
                    <div className="text-[13px] font-black uppercase tracking-widest text-gray-500 mb-2">{d.name}'s trophies</div>
                    <TrophyWall awards={mine} testIdPrefix={`portal-dog-trophies-${d.id}`}/>
                  </div>
                );
              })}
            </div>
          )}

          <HomeworkIncentivesPanel />

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tight">My Dogs</h2>
              <button onClick={()=>setDogModal({open:true, dog:null})} data-testid="portal-add-dog"
                      className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow hover:bg-shGreen/90">
                <i className="fas fa-plus mr-1"/>Add a Dog
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="portal-dogs">
              {dogs.length === 0 && (
                <div className="md:col-span-2 bg-bgPanel border border-dashed border-bgHover rounded-xl p-8 text-center">
                  <i className="fas fa-paw text-shGreen text-3xl mb-3"/>
                  <p className="text-sm font-black text-white uppercase tracking-tight">No dogs added yet</p>
                  <p className="text-[14px] text-gray-400 mt-1">Click "Add a Dog" above to tell us about your pup.</p>
                </div>
              )}
              {dogs.map(d => {
                const visits = visitCounts[d.id] || 0;
                const today = todayISO();
                const soon = new Date(); soon.setDate(soon.getDate() + 30);
                const soonStr = soon.toISOString().slice(0, 10);
                const expiringVaccines = ["rabies", "bordetella", "dhpp"].filter(v => {
                  const exp = d.vaccines?.[v];
                  return !exp || exp < today || exp < soonStr;
                });
                return (
                <div key={d.id} className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden shadow-lg" data-testid={`portal-dog-${d.id}`}>
                  <button onClick={()=>setDogModal({open:true, dog:d})}
                          className="block w-full text-left hover:border-shGreen transition group">
                    {d.photo
                      ? <div className="h-32 w-full bg-bgBase flex items-center justify-center overflow-hidden">
                          <img src={d.photo} alt={d.name} loading="lazy" decoding="async" className="max-h-32 max-w-full object-contain" />
                        </div>
                      : <div className="h-32 bg-gradient-to-br from-bgHover to-bgPanel flex items-center justify-center text-shGreen text-4xl"><i className="fas fa-paw" /></div>}
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-lg font-black text-white uppercase truncate">{d.name}</h4>
                        <i className="fas fa-pen text-gray-600 group-hover:text-shGreen text-[14px]"/>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-[14px] text-shBlue font-black uppercase tracking-widest truncate">{d.breed || "Unknown"}</p>
                        {visits > 0 && (
                          <span className="shrink-0 bg-shGreen/15 text-shGreen text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" data-testid={`visit-badge-${d.id}`}>
                            <i className="fas fa-trophy mr-1"/>{visits}{visits >= 100 ? "+" : ""} {visits === 1 ? "visit" : "visits"}
                          </span>
                        )}
                      </div>
                      <p className="text-[14px] text-gray-400 mt-2">Rabies: <span className={d.vaccines?.rabies && d.vaccines.rabies>=today?"text-shGreen":"text-red-400"}>{d.vaccines?.rabies||"Missing"}</span></p>
                    </div>
                  </button>
                  {expiringVaccines.length > 0 && (
                    <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2 flex items-center justify-between gap-2" data-testid={`vaccine-alert-${d.id}`}>
                      <p className="text-[13px] text-red-300 font-black uppercase tracking-widest min-w-0 truncate">
                        <i className="fas fa-shield-virus mr-1"/>{expiringVaccines.length} vaccine{expiringVaccines.length > 1 ? "s" : ""} need updating
                      </p>
                      <button onClick={()=>setVaccineModal({ dog: d, vaccine: expiringVaccines[0] })}
                              data-testid={`vaccine-upload-btn-${d.id}`}
                              className="shrink-0 text-[13px] font-black uppercase tracking-widest text-shGreen hover:underline">
                        Upload <i className="fas fa-arrow-right ml-1"/>
                      </button>
                    </div>
                  )}
                  {(d.vet_phone || d.vet_name) && (
                    <div className="border-t border-bgHover/60 px-4 py-2 flex flex-wrap gap-x-3 gap-y-1 items-center" data-testid={`quick-contacts-${d.id}`}>
                      <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
                        <i className="fas fa-stethoscope text-shBlue mr-1"/>Vet
                      </span>
                      {d.vet_name && <span className="text-[13px] text-gray-300 truncate">{d.vet_name}</span>}
                      {d.vet_phone && (
                        <>
                          <a href={`tel:${d.vet_phone}`} data-testid={`vet-call-${d.id}`}
                             onClick={(e)=>e.stopPropagation()}
                             className="text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-white">
                            <i className="fas fa-phone mr-1"/>Call
                          </a>
                          <a href={`sms:${d.vet_phone}`} data-testid={`vet-sms-${d.id}`}
                             onClick={(e)=>e.stopPropagation()}
                             className="text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-white">
                            <i className="fas fa-message mr-1"/>Text
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>

          {dogs.length > 0 && (
            <div data-testid="portal-training-section">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4"><i className="fas fa-medal text-shGreen mr-2"/>Training Progress</h2>
              <div className="space-y-4">
                {dogs.map(d => <PortalTrainingCard key={d.id} dog={d} />)}
              </div>
            </div>
          )}

          <PortalFilesSection dogs={dogs} />

          <div id="portal-bookings-anchor">
            {bookings.length === 0 && dogs.length > 0 && !waiverNeeded && (
              <div className="bg-shGreen/10 border border-shGreen/30 rounded-xl p-5 mb-4" data-testid="first-time-tutorial">
                <p className="text-[12px] font-black uppercase tracking-widest text-shGreen mb-2"><i className="fas fa-paw mr-1"/>What to expect on your first visit</p>
                <ol className="space-y-2 text-[14px] text-gray-300 list-decimal list-inside">
                  <li><span className="font-black text-white">Pack the basics:</span> leash, any meds, and your dog's regular food if boarding overnight.</li>
                  <li><span className="font-black text-white">Drop off between 7–10am</span> (or your scheduled time). We'll do a quick intake at the front desk.</li>
                  <li><span className="font-black text-white">You'll get a Pup Report Card</span> by end of day — photos, mood, and a note about how the day went.</li>
                </ol>
                <p className="text-[12px] text-gray-500 mt-3 italic">Questions? Text us anytime — we love new pups.</p>
              </div>
            )}
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tight">My Bookings</h2>
              {/* Tabbed filter — keeps the list short. Counts shown on each tab. */}
              {(() => {
                // Today is "upcoming". A booking is "past" iff its end_date (or date) is
                // before today AND status is completed/cancelled/rejected, OR status is
                // any terminal state regardless of date.
                const todayIso = new Date().toISOString().slice(0,10);
                const isPast = (b) => {
                  const dt = b.end_date || b.date || "";
                  const terminal = ["completed","cancelled","rejected"].includes(b.status);
                  return terminal || (dt && dt < todayIso);
                };
                const counts = {
                  upcoming: bookings.filter(b => !isPast(b)).length,
                  past: bookings.filter(b => isPast(b)).length,
                  all: bookings.length,
                };
                return (
                  <div className="flex bg-bgPanel border border-bgHover rounded-lg p-1 text-[14px] font-black uppercase tracking-widest" data-testid="bookings-tabs">
                    {[
                      { key: "upcoming", label: "Upcoming", color: "shGreen" },
                      { key: "past",     label: "Past",     color: "shBlue"  },
                      { key: "all",      label: "All",      color: "white"   },
                    ].map(t => {
                      const active = bookingsTab === t.key;
                      return (
                        <button key={t.key}
                                onClick={()=>{ setBookingsTab(t.key); if (t.key !== "all") setBookingsMonth(""); }}
                                data-testid={`bookings-tab-${t.key}`}
                                className={`px-3 py-1.5 rounded transition flex items-center gap-1.5 ${active ? "bg-bgBase text-white" : "text-gray-500 hover:text-white"}`}>
                          <span>{t.label}</span>
                          <span className={`text-[12px] px-1.5 py-0.5 rounded ${active ? "bg-shGreen/20 text-shGreen" : "bg-bgHover text-gray-400"}`}>{counts[t.key]}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            {dogs.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap mb-3" data-testid="dog-filter-pills">
                <span className="text-[12px] font-black uppercase tracking-widest text-gray-500">Filter:</span>
                <button onClick={()=>setDogFilter("")} data-testid="dog-filter-all"
                        className={`px-3 py-1 rounded-full text-[12px] font-black uppercase tracking-widest border ${!dogFilter ? "bg-shGreen text-bgHeader border-shGreen" : "border-bgHover text-gray-400 hover:text-white"}`}>All Dogs</button>
                {dogs.map(d => (
                  <button key={d.id} onClick={()=>setDogFilter(d.id)} data-testid={`dog-filter-${d.id}`}
                          className={`px-3 py-1 rounded-full text-[12px] font-black uppercase tracking-widest border flex items-center gap-1.5 ${dogFilter === d.id ? "bg-shGreen text-bgHeader border-shGreen" : "border-bgHover text-gray-400 hover:text-white"}`}>
                    {d.photo && <img src={d.photo} alt="" className="w-4 h-4 rounded-full object-cover"/>}
                    <span>{d.name}</span>
                  </button>
                ))}
              </div>
            )}
            {(() => {
              const todayIso = new Date().toISOString().slice(0,10);
              const isPast = (b) => {
                const dt = b.end_date || b.date || "";
                const terminal = ["completed","cancelled","rejected"].includes(b.status);
                return terminal || (dt && dt < todayIso);
              };
              let filtered = bookingsTab === "upcoming" ? bookings.filter(b => !isPast(b))
                              : bookingsTab === "past"   ? bookings.filter(b => isPast(b))
                              : bookings;
              if (dogFilter) filtered = filtered.filter(b => b.dog_id === dogFilter);
              // Build a unique sorted list of YYYY-MM stamps for the dropdown.
              const monthsAvailable = Array.from(new Set(
                bookings.map(b => (b.date || "").slice(0, 7)).filter(Boolean)
              )).sort((a, b) => b.localeCompare(a));
              if (bookingsTab === "all" && bookingsMonth) {
                filtered = filtered.filter(b => (b.date || "").startsWith(bookingsMonth));
              }
              // Past first feels backward to clients — sort upcoming ascending, past descending.
              const sorted = [...filtered].sort((a, b) => {
                const ad = a.date || ""; const bd = b.date || "";
                return bookingsTab === "past" ? bd.localeCompare(ad) : ad.localeCompare(bd);
              });
              const monthDropdown = (bookingsTab === "all" && monthsAvailable.length > 1) ? (
                <div className="mb-3" data-testid="bookings-month-filter-wrap">
                  <select value={bookingsMonth}
                          onChange={(e)=>setBookingsMonth(e.target.value)}
                          data-testid="bookings-month-filter"
                          className="bg-bgPanel border border-bgHover rounded px-3 py-1.5 text-white text-[14px] font-black uppercase tracking-widest">
                    <option value="">All months</option>
                    {monthsAvailable.map(m => {
                      const [y, mm] = m.split("-");
                      const label = new Date(parseInt(y), parseInt(mm) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
                      return <option key={m} value={m}>{label}</option>;
                    })}
                  </select>
                </div>
              ) : null;
              if (sorted.length === 0) {
                return (
                  <>
                    {monthDropdown}
                    <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 uppercase font-black text-xs" data-testid="bookings-empty">
                      {bookingsTab === "upcoming" ? "No upcoming bookings — book a service above." : bookingsTab === "past" ? "No past bookings yet." : bookingsMonth ? "No bookings that month." : "No bookings yet."}
                    </div>
                  </>
                );
              }
              return (
                <>
                  {monthDropdown}
                  <div className="space-y-3" data-testid="portal-bookings">
                    {sorted.map(b => (
                <div key={b.id} className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-black text-white uppercase tracking-tight">{b.dog_name}</p>
                      <p className="text-[14px] text-gray-400 font-black uppercase tracking-widest mt-1">{b.service_type} · {b.date}{b.end_date && b.end_date!==b.date?` → ${b.end_date}`:""}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[14px] font-black uppercase px-2 py-1 rounded ${b.status==="approved"?"bg-shGreen/15 text-shGreen":b.status==="pending"?"bg-shOrange/15 text-shOrange":b.status==="rejected"?"bg-red-500/15 text-red-400":b.status==="completed"?"bg-shBlue/15 text-shBlue":"bg-gray-500/15 text-gray-400"}`}>{b.status}</span>
                      {(b.status==="pending"||b.status==="approved") && <button onClick={()=>cancel(b.id)} className="text-[14px] font-black uppercase text-red-400 hover:underline tracking-widest">Cancel</button>}
                      {["completed","cancelled","rejected"].includes(b.status) && (
                        <button onClick={()=>{
                                  setRebookSeed({ dog_id: b.dog_id, service_type: b.service_type });
                                  setShowBookWizard(true);
                                  document.getElementById("portal-book-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                }}
                                data-testid={`book-again-${b.id}`}
                                className="text-[14px] font-black uppercase tracking-widest text-shBlue hover:text-white px-2 py-1 rounded border border-shBlue/40">
                          <i className="fas fa-rotate-right mr-1"/>Book Again
                        </button>
                      )}
                    </div>
                  </div>
                  {b.report_card && (
                    <div className="border-t border-bgHover/50 card-success p-4" data-testid={`report-card-${b.id}`}>
                      <p className="text-[14px] font-black text-shGreen uppercase tracking-widest mb-3"><i className="fas fa-paw mr-1"/> Pup Report Card</p>
                      {b.report_card.photos?.length > 0 && (
                        <div className="flex gap-2 mb-3">
                          {b.report_card.photos.map((p, i) => (
                            <img key={i} src={p} alt="" loading="lazy" decoding="async" data-testid={`report-photo-${b.id}-${i}`}
                                 onClick={()=>setLightbox({ open: true, photos: b.report_card.photos, index: i })}
                                 className="h-24 w-24 rounded object-cover border border-bgHover cursor-pointer hover:border-shGreen transition" />
                          ))}
                        </div>
                      )}
                      {b.report_card.mood_tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {b.report_card.mood_tags.map(m => {
                            // Look up icon + color from public settings catalog. Tags can be legacy strings or {label, icon, color}.
                            const def = (pubSettings?.mood_tags || []).find(t => (typeof t === "string" ? t === m : t?.label === m));
                            const icon = (def && typeof def === "object") ? def.icon : "";
                            const hex = (def && typeof def === "object" && def.color) ? def.color : "#8cc63f";
                            return (
                              <span key={m} className="text-[15px] font-black uppercase tracking-widest px-2 py-1 rounded-full inline-flex items-center gap-1.5 border"
                                    style={{ backgroundColor: `${hex}26`, borderColor: `${hex}55`, color: hex }}>
                                {icon && <i className={`fas ${icon}`}/>}
                                <span>{m}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {b.report_card.note && <p className="text-xs text-gray-300 italic">"{b.report_card.note}"</p>}
                    </div>
                  )}
                </div>
                  ))}
                </div>
                </>
              );
            })()}
          </div>
        </div>
        </div>
      </div>

      {showWaiver && pubSettings?.waiver_text && (
        <WaiverModal
          waiverText={pubSettings.waiver_text}
          version={pubSettings.waiver_version || 1}
          dogNames={dogs.map(d=>d.name).join(", ")}
          onSigned={async ()=>{ setShowWaiver(false); await loadAll(); }}
          onClose={()=>setShowWaiver(false)}
          allowClose={waiver?.signed && !waiver?.needs_resign}
        />
      )}

      {/* Mobile-only sticky "Book Service" jump bar — keeps the CTA always reachable */}
      {dogs.length > 0 && (
        <button
          onClick={()=>setShowBookWizard(true)}
          disabled={waiverNeeded}
          data-testid="portal-sticky-book"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-shGreen text-bgHeader py-3 px-5 pb-safe flex items-center justify-center gap-2 font-black uppercase tracking-widest text-[14px] shadow-2xl border-t border-shGreen/60 disabled:opacity-50"
        >
          <i className="fas fa-calendar-plus"/>Book Service
        </button>
      )}

      {showBookWizard && (
        <PortalBookWizard
          dogs={dogs}
          seed={rebookSeed}
          onClose={()=>{ setShowBookWizard(false); setRebookSeed(null); }}
          onBooked={()=>{ setShowBookWizard(false); setRebookSeed(null); loadAll(); setSuccess("Booking submitted!"); setTimeout(()=>setSuccess(""), 4000); }} />
      )}

      {hwModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 md:p-8 shadow-2xl animate-slide-in">
            <h4 className="text-lg font-black text-white uppercase italic tracking-tight mb-1">Mark Done</h4>
            <p className="text-[14px] text-shBlue font-black uppercase tracking-widest mb-4">{hwModal.title}</p>
            <div className="space-y-4">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">How did it go? (optional)</label>
                <textarea value={hwNote} onChange={(e)=>setHwNote(e.target.value)} rows={3} placeholder="Feedback for your trainer" data-testid="hw-complete-note"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Proof Photo (optional)</label>
                <div className="mt-2 flex items-center gap-3">
                  {hwPhoto && <img src={hwPhoto} alt="" loading="lazy" decoding="async" className="h-20 w-20 rounded object-cover border border-bgHover" />}
                  <label className="bg-bgBase border border-bgHover rounded px-4 py-2 cursor-pointer text-xs font-black uppercase tracking-widest text-gray-300 hover:bg-bgHover">
                    Upload <input type="file" accept="image/*" onChange={onHwFile} className="hidden" />
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={()=>setHwModal(null)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
                <button onClick={completeHw} data-testid="hw-complete-button" className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl">Mark Complete</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {lightbox.open && (
        <Lightbox photos={lightbox.photos} index={lightbox.index}
                  onClose={()=>setLightbox({ open: false, photos: [], index: 0 })}
                  onIndex={(i)=>setLightbox(l => ({ ...l, index: i }))} />
      )}
      {dogModal.open && (
        <PortalDogModal dog={dogModal.dog}
                        onClose={()=>setDogModal({open:false, dog:null})}
                        onSaved={loadAll} />
      )}
      {profileOpen && client && (
        <PortalProfileModal client={client}
                            onClose={()=>setProfileOpen(false)}
                            onSaved={loadAll} />
      )}
      {tutorialsOpen && (
        <div className="fixed inset-0 z-[9999] bg-bgBase overflow-y-auto" data-testid="portal-tutorials-overlay">
          <header className="sticky top-0 bg-bgHeader border-b border-bgHover h-16 flex items-center justify-between px-6 z-10">
            <div className="flex items-center gap-3">
              <i className="fas fa-circle-question text-shBlue text-lg"/>
              <span className="text-white font-black uppercase tracking-widest text-[14px]">How to Use Sit Happens</span>
            </div>
            <button onClick={()=>setTutorialsOpen(false)} data-testid="portal-tutorials-close"
                    className="text-gray-300 hover:text-white text-lg p-2"><i className="fas fa-times"/></button>
          </header>
          <div className="p-6 max-w-6xl mx-auto">
            <Tutorials role="client" />
          </div>
        </div>
      )}

      <ServiceInfoModal type={showServiceInfo} onClose={()=>setShowServiceInfo(null)} customDescriptions={pubSettings?.service_descriptions} />
      {showReferModal && referralCode && <ReferFriendModal code={referralCode} onClose={()=>setShowReferModal(false)} />}
      {showServicesModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur grid place-items-center p-3 sm:p-6 animate-fade-in" onClick={()=>setShowServicesModal(false)} data-testid="services-modal">
          <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl animate-slide-in">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-bgPanel/95 backdrop-blur border-b border-bgHover">
              <div className="min-w-0">
                <h2 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight"><i className="fas fa-list-check text-shGreen mr-2"/>Services & Pricing</h2>
                <p className="text-[14px] text-gray-400 truncate">{publicServices.length + publicPrograms.length} offered · tap any tile to request info</p>
              </div>
              <button onClick={()=>setShowServicesModal(false)} data-testid="services-modal-close"
                      className="shrink-0 text-gray-400 hover:text-white p-2 rounded hover:bg-bgHover transition">
                <i className="fas fa-times text-xl"/>
              </button>
            </div>
            <div className="p-4 sm:p-6">
              <ServicesByCategory services={publicServices} programs={publicPrograms}/>
              <p className="text-[13px] text-gray-500 mt-5 text-center"><i className="fas fa-circle-info text-shBlue mr-1"/>Save on daycare, training & boarding with multi-visit Credit Packs — ask us about current deals.</p>
            </div>
          </div>
        </div>
      )}
      {celebrating.length > 0 && (
        <TrophyCelebration awards={celebrating} onAllSeen={()=>{ setCelebrating([]); loadTrophies(); }}/>
      )}
      {vaccineModal && <VaccineUploadModal dog={vaccineModal.dog} vaccine={vaccineModal.vaccine} onClose={()=>setVaccineModal(null)} onSaved={async()=>{ setVaccineModal(null); await loadAll(); }} />}
      {showRecurringModal && <MyRecurringModal dogs={dogs} onClose={()=>setShowRecurringModal(false)} />}
      {onboardingNeeded && !onboardingDismissed && (
        <OnboardingChecklist
          dogs={dogs}
          client={client}
          onAddDog={() => { setOnboardingDismissed(true); setDogModal({ open: true, dog: null }); }}
          onUploadVaccine={(dog, vaccine) => { setOnboardingDismissed(true); setVaccineModal({ dog, vaccine }); }}
          onDismiss={dismissOnboarding}
        />
      )}
    </div>
  );
}

function OnboardStep({ n, done, active, title, desc, cta, onClick, testId, disabled = false }) {
  return (
    <div className={`rounded-lg p-4 border ${done ? "bg-shGreen/10 border-shGreen/40" : active ? "bg-shBlue/10 border-shBlue/50" : "bg-bgBase/40 border-bgHover"}`}>
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-black ${done ? "bg-shGreen text-bgHeader" : active ? "bg-shBlue text-white" : "bg-bgHover text-gray-400"}`}>
          {done ? <i className="fas fa-check"/> : n}
        </div>
        <p className="text-sm font-black text-white uppercase tracking-tight">{title}</p>
      </div>
      <p className="text-[14px] text-gray-300 leading-snug mb-3">{desc}</p>
      <button onClick={onClick} disabled={disabled || done} data-testid={testId}
              className={`w-full py-2 rounded font-black text-[15px] uppercase tracking-widest transition ${done ? "bg-shGreen/20 text-shGreen cursor-default" : disabled ? "bg-bgBase text-gray-600 cursor-not-allowed border border-bgHover" : "bg-shBlue text-white hover:bg-shBlue/90"}`}>
        {done ? "Complete" : cta}
      </button>
    </div>
  );
}
