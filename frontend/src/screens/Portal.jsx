import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFeature, useTheme } from "../lib/theme";
import WaiverModal from "../components/WaiverModal";
import Lightbox from "../components/Lightbox";
import PortalDogModal from "../components/PortalDogModal";
import PortalProfileModal from "../components/PortalProfileModal";
import PortalTrainingCard from "../components/PortalTrainingCard";
import PortalLearn from "../components/PortalLearn";
import PortalProgress from "../components/PortalProgress";
import PortalFilesSection from "../components/PortalFilesSection";
import IntakePortalSection from "../components/IntakePortalSection";
import PortalBookWizard from "../components/PortalBookWizard";
import HomeworkIncentivesPanel from "../components/HomeworkIncentivesPanel";
import ClientTodayPanel from "../components/training/ClientTodayPanel";
import PracticePanel from "../components/training/PracticePanel";
import SchoolApp from "./SchoolApp";
import OnlineSchoolHeroCard from "../components/school/OnlineSchoolHeroCard";
import MultiDateCalendar from "../components/MultiDateCalendar";
import PortalHomeActionCard from "../components/PortalHomeActionCard";
import PremiumButton from "../components/premium/PremiumButton";
import ClientSidebar from "../components/ClientSidebar";
import ClientMobileNav from "../components/ClientMobileNav";
import ClientProfileMenu from "../components/ClientProfileMenu";
import TextSizePicker from "../components/TextSizePicker";
import TrophyWall from "../components/TrophyWall";
import TrophyCelebration from "../components/TrophyCelebration";
import CareLogStrip from "../components/CareLogStrip";
import HomeworkStreakTile from "../components/HomeworkStreakTile";
import RescheduleRequestModal from "../components/RescheduleRequestModal";
import PortalPaymentPlans from "../components/PortalPaymentPlans";
import PortalMessages from "../components/PortalMessages";
import PortalSetupChecklist, { PortalSetupSuccess } from "../components/PortalSetupChecklist";
import NeedsPasswordCard from "../components/NeedsPasswordCard";
import PaymentOptionsCard from "../components/PaymentOptionsCard";
import PortalInvoices from "../components/PortalInvoices";
import PortalShop from "../components/PortalShop";
import GuestCartMergeReview from "../components/GuestCartMergeReview";
import { readGuestCart, consumePendingShopRedirect } from "../lib/shopGuestCart";
import PortalPhotography from "../components/PortalPhotography";
import NeedHelpCard from "../components/NeedHelpCard";
import VaccineUploadWizard from "../components/VaccineUploadWizard";
import VaccineQuickUploadModal from "../components/VaccineQuickUploadModal";
import PortalAnnouncementsCard from "../components/PortalAnnouncementsCard";
import PortalTrainingTipCard from "../components/PortalTrainingTipCard";
import PortalEngagementHub from "../components/PortalEngagementHub";
import PortalNeedsAttentionCard from "../components/PortalNeedsAttentionCard";
import PortalSuccessPanel from "../components/PortalSuccessPanel";
import { CLIENT_LABELS, bookingStatusLabel } from "../lib/clientLabels";
import ServicesByCategory from "../components/ServicesByCategory";
import { DogFactCard } from "../components/DogFactCard";
import { DailyTriviaCard } from "../components/DailyTriviaCard";
import Tutorials from "./Tutorials";
import { useConfirm } from "../lib/useConfirm";
import { compressImage } from "../lib/imageCompress";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import { todayISO } from "../lib/date";
import HuskyDogImage from "../components/brand/HuskyDogImage";
import { toast } from "sonner";

const _WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const _emptyRecurring = { dog_id: "", service_type: "daycare", service_id: "", dropoff_time: "", weekdays: [0, 2, 4], notes: "", default_horizon_weeks: 12, active: true, label: "", start_date: "" };

/**
 * Client-facing "My Recurring Schedules" — same model as the admin Recurring
 * screen, scoped server-side to the calling client's dogs.
 *
 * Why a modal: keeps the Portal compact and lets us open it from a Quick Link
 * without occupying screen real-estate when the client isn't using it.
 */
function MyRecurringModal({ dogs, onClose }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState([]);
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(_emptyRecurring);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState("list"); // "list" | "form"

  const load = async () => {
    try {
      const [{ data: templates }, { data: svcs }] = await Promise.all([
        api.get("/recurring-templates"),
        api.get("/services"),
      ]);
      setRows(templates);
      setServices((svcs || []).filter(s => s.active !== false && !s.is_addon && s.service_type === "daycare"));
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Load failed"); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    const first = services[0];
    setEditing(null);
    setForm({ ..._emptyRecurring, dog_id: dogs[0]?.id || "", service_id: first?.id || "" });
    setStep("form"); setErr("");
  };
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      dog_id: r.dog_id, service_type: r.service_type, service_id: r.service_id || "",
      dropoff_time: r.dropoff_time || "", weekdays: r.weekdays || [], notes: r.notes || "",
      default_horizon_weeks: r.default_horizon_weeks || 12,
      active: r.active !== false, label: r.label || "",
      start_date: r.start_date || "",
    });
    setStep("form"); setErr("");
  };

  const save = async () => {
    setErr("");
    if (!form.dog_id) { setErr("Pick a dog."); return; }
    if (!form.service_id) { setErr("Pick the daycare service."); return; }
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
    const ok = await confirm({
      title: `Delete “${r.label}”?`,
      body: "Already-booked sessions remain on the calendar. Only the recurring schedule is removed.",
      confirmText: "Delete Schedule",
      tone: "danger",
    });
    if (!ok) return;
    try { await api.delete(`/recurring-templates/${r.id}`); load(); } catch (e) { console.warn("recurring delete failed", e); }
  };

  const toggleDay = (d) => setForm(f => ({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d].sort() }));

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur grid place-items-center p-3 sm:p-6" onClick={onClose} data-testid="my-recurring-modal">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg shadow-2xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto">
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
                          <p className="text-[12px] text-shBlue font-black uppercase tracking-widest mt-1.5">{r.service_name || "Daycare"}</p>
                          <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-1">
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
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Daycare service</label>
                <select value={form.service_id} onChange={(e)=>setForm({...form, service_id: e.target.value, service_type: "daycare"})}
                        data-testid="my-recurring-service-select"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option value="">— pick a service —</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Usual drop-off time (optional)</label>
                <input type="time" value={form.dropoff_time} onChange={(e)=>setForm({...form, dropoff_time: e.target.value})}
                       data-testid="my-recurring-dropoff-time" style={{colorScheme:"dark"}}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
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
      <div onClick={(e)=>e.stopPropagation()} className="border border-shBorder rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 sm:p-7 shadow-sh animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto pb-safe" style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3"><span className="text-shAccent text-2xl"><i className="fas fa-gift"/></span><h4 className="text-xl font-bold text-shText tracking-tight">Refer a Friend</h4></div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText p-1"><i className="fas fa-times text-lg"/></button>
        </div>
        <p className="text-[14px] text-shTextMuted mb-4">Share your code with a friend. After they sign up and complete their first appointment (daycare, training, or boarding), we'll add a free daycare day to your account as a thank-you.</p>
        <div className="border border-shAccent/40 rounded-lg p-4 text-center mb-4" style={{ background: "var(--sh-card-base)" }}>
          <p className="text-[13px] uppercase tracking-widest text-shTextMuted font-bold">Your code</p>
          <p className="text-3xl font-black text-shAccent tracking-[0.3em] mt-1" data-testid="refer-code">{code}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <a href={sms} data-testid="refer-via-sms" className="bg-shPrimary/10 hover:bg-shPrimary/20 text-shPrimary text-center py-3 rounded-md font-bold text-[14px] uppercase tracking-widest transition"><i className="fas fa-comment mr-1"/>Text</a>
          <a href={email} data-testid="refer-via-email" className="bg-shSecondary/10 hover:bg-shSecondary/20 text-shSecondary text-center py-3 rounded-md font-bold text-[14px] uppercase tracking-widest transition"><i className="fas fa-envelope mr-1"/>Email</a>
          <button onClick={copy} data-testid="refer-copy" className="bg-shAccent/10 hover:bg-shAccent/20 text-shAccent text-center py-3 rounded-md font-bold text-[14px] uppercase tracking-widest transition"><i className={`fas ${copied?"fa-check":"fa-copy"} mr-1`}/>{copied?"Copied":"Copy"}</button>
        </div>
        <PremiumButton variant="secondary" onClick={onClose} className="w-full justify-center py-3">Done</PremiumButton>
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
    if (!photo) { setErr("Attach a clear photo of the vaccine certificate before submitting."); return; }
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
      <div onClick={(e)=>e.stopPropagation()} className="border border-shBorder rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 sm:p-7 shadow-sh animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto pb-safe" style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <h4 className="text-xl font-bold text-shText tracking-tight">Update {label} for {dog.name}</h4>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText p-1"><i className="fas fa-times text-lg"/></button>
        </div>
        <p className="text-[15px] text-shTextMuted mb-4">Step 1: enter the expiry date. Step 2: attach a clear photo of the certificate. After you submit, Sit Happens reviews it before booking unlocks.</p>
        <div className="space-y-3">
          <div>
            <label className="text-[14px] text-shTextMuted font-bold uppercase tracking-widest">New expiry date</label>
            <input type="date" value={expiresOn} onChange={(e)=>setExpiresOn(e.target.value)} data-testid="vaccine-expiry-input"
                   className="w-full mt-1 border border-shBorder rounded p-3 text-shText text-sm focus:outline-none focus:border-shPrimary/60" style={{colorScheme:"dark", background: "var(--sh-card-base)"}} />
          </div>
          <div>
            <label className="text-[14px] text-shTextMuted font-bold uppercase tracking-widest">Cert photo required</label>
            <input type="file" accept="image/*" capture="environment" onChange={handleFile} data-testid="vaccine-photo-input"
                   className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm file:bg-shSecondary file:text-shText file:border-0 file:rounded file:px-3 file:py-1 file:font-bold file:text-[14px] file:uppercase file:tracking-widest" style={{ background: "var(--sh-card-base)" }} />
            {photo && <img src={photo} alt="cert preview" className="mt-2 rounded max-h-40 object-contain border border-shBorder"/>}
          </div>
          {err && <p className="text-[15px] text-shDanger font-bold uppercase tracking-widest">{err}</p>}
          <div className="flex gap-2">
            <PremiumButton variant="ghost" onClick={onClose} className="flex-1 justify-center py-3">Cancel</PremiumButton>
            <PremiumButton variant="primary" onClick={save} disabled={saving || !expiresOn || !photo} data-testid="vaccine-save" className="flex-1 justify-center py-3">{saving?"Saving…":"Submit for Review"}</PremiumButton>
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
      <div className="border border-shAccent/50 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-sh animate-slide-in max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto" style={{ background: "var(--sh-card-base)" }}
           onClick={(e)=>e.stopPropagation()}>
        <div className="p-5 sm:p-6 border-b border-shAccent/30 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(60% 100% at 15% 20%, rgba(242,101,34,0.18), transparent 65%)" }} />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[12px] font-bold uppercase tracking-widest bg-shAccent/15 text-shAccent border border-shAccent/40 px-2 py-0.5 rounded-full">Action Required</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-shText tracking-tight">
              Welcome{client?.name ? `, ${client.name.split(" ")[0]}` : ""}!
            </h2>
            <p className="text-[14px] text-shTextMuted normal-case mt-2 leading-relaxed">
              Before we can host your pup, we need their vaccine records on file. <strong className="text-shText">It only takes 2 minutes</strong> — snap a photo of each cert and type in the expiry date.
            </p>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center" data-testid="onboarding-how-it-works">
            <div className="border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
              <div className="w-9 h-9 mx-auto rounded-full bg-shPrimary/15 text-shPrimary flex items-center justify-center">
                <i className="fas fa-camera text-base"/>
              </div>
              <p className="text-[12px] font-bold text-shText uppercase tracking-widest mt-2 leading-tight">1. Upload Cert</p>
              <p className="text-[12px] text-shTextMuted normal-case tracking-normal mt-1 leading-tight">Snap a photo + type the expiry date</p>
            </div>
            <div className="border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
              <div className="w-9 h-9 mx-auto rounded-full bg-shSecondary/15 text-shSecondary flex items-center justify-center">
                <i className="fas fa-check-double text-base"/>
              </div>
              <p className="text-[12px] font-bold text-shText uppercase tracking-widest mt-2 leading-tight">2. We Verify</p>
              <p className="text-[12px] text-shTextMuted normal-case tracking-normal mt-1 leading-tight">Quick admin check — usually within a few hours</p>
            </div>
            <div className="border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
              <div className="w-9 h-9 mx-auto rounded-full bg-shAccent/15 text-shAccent flex items-center justify-center">
                <i className="fas fa-calendar-check text-base"/>
              </div>
              <p className="text-[12px] font-bold text-shText uppercase tracking-widest mt-2 leading-tight">3. Book Stays</p>
              <p className="text-[12px] text-shTextMuted normal-case tracking-normal mt-1 leading-tight">Daycare, boarding & training open up</p>
            </div>
          </div>

          {hasNoDogs ? (
            <div className="border border-shBorder rounded-lg p-4" style={{ background: "var(--sh-card-base)" }}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-shSecondary/20 text-shSecondary font-bold flex items-center justify-center shrink-0">1</div>
                <div className="flex-1">
                  <p className="text-shText font-bold text-[15px] uppercase tracking-widest">Add your dog</p>
                  <p className="text-[14px] text-shTextMuted normal-case mt-1">Tell us their name, breed, age, and any feeding or medication notes.</p>
                  <PremiumButton variant="cyan" onClick={onAddDog} data-testid="onboarding-add-dog-btn" className="mt-3">
                    <i className="fas fa-plus mr-1.5"/>Add Dog
                  </PremiumButton>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg px-4 py-3 border border-shBorder" style={{ background: "var(--sh-card-base)" }}>
                <div>
                  <p className="text-[13px] font-bold text-shTextMuted uppercase tracking-widest">Vaccines still needed</p>
                  <p className="text-shAccent font-bold text-[26px] leading-none mt-1" data-testid="onboarding-missing-count">{totalMissing}</p>
                </div>
                <i className="fas fa-shield-virus text-shAccent/40 text-4xl"/>
              </div>

              <div className="space-y-3">
                {incompleteDogs.map((row) => (
                  <div key={row.dog.id} className="border border-shBorder rounded-lg p-4" style={{ background: "var(--sh-card-base)" }}>
                    <p className="text-shText font-bold text-[15px] uppercase tracking-widest">{row.dog.name}{row.dog.breed ? <span className="text-shTextMuted"> · {row.dog.breed}</span> : null}</p>
                    <div className="mt-3 space-y-2">
                      {row.missing.map((r) => (
                        <div key={r.key} className="flex items-center justify-between gap-3 rounded p-2.5 border border-shBorder" style={{ background: "var(--sh-card-base)" }}>
                          <div className="flex items-center gap-2 min-w-0">
                            <i className="fas fa-circle-exclamation text-shAccent text-sm"/>
                            <span className="text-[15px] font-bold text-shText uppercase tracking-widest truncate">{r.label}</span>
                            <span className="text-[13px] text-shTextMuted normal-case tracking-normal truncate">
                              {row.dog.vaccines?.[r.key] ? `expired ${row.dog.vaccines[r.key]}` : "no date on file"}
                            </span>
                          </div>
                          <PremiumButton variant="primary" onClick={() => onUploadVaccine(row.dog, r.key)}
                                  data-testid={`onboarding-upload-${row.dog.id}-${r.key}`} className="whitespace-nowrap py-1.5">
                            <i className="fas fa-camera mr-1"/>Upload
                          </PremiumButton>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-shSecondary/10 border border-shSecondary/30 rounded-lg p-3 flex gap-3">
                <i className="fas fa-circle-info text-shSecondary text-base mt-0.5"/>
                <p className="text-[14px] text-shTextMuted normal-case leading-snug">
                  Don't have a clear photo handy? Just type the <strong className="text-shText">expiry date</strong> your vet wrote on the certificate — you can upload the photo later. We'll review and approve each upload before it goes live.
                </p>
              </div>
            </>
          )}

          <button onClick={onDismiss} data-testid="onboarding-dismiss-btn"
                  className="w-full text-shTextMuted hover:text-shText text-[14px] font-bold uppercase tracking-widest py-3">
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
  // Legacy vaccine-only banner intentionally disabled.
  // The real client guidance now lives in PortalSetupChecklist so clients see
  // one clear Start Here flow instead of two different setup systems.
  return null;
}



export default function Portal() {
  const confirm = useConfirm();
  const { user, logout, reloadUser } = useAuth();
  const [shopInitialTab, setShopInitialTab] = useState("all");
  // Client Shop Phase 2 UX — the Shop is a dedicated full-screen view, not
  // an embedded dashboard card. Lazy-initialized from the URL so a Stripe
  // return (?shop_order=...&stripe=...) lands the client directly back in
  // the Shop view instead of an arbitrary spot on the dashboard — PortalShop
  // itself still reads/clears those same params for its own return-status
  // polling, this only decides which top-level view is showing.
  const [shopOpen, setShopOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has("shop_order")) return true;
    // Public no-account storefront (Phase 4) — a bare /shop or /shop/ path
    // now also opens the real authenticated Shop directly (ShopRouteGate in
    // App.js already resolved this visitor as authenticated before Portal
    // ever mounts), not just the item-detail sub-path below.
    if (/^\/shop\/?$/.test(window.location.pathname)) return true;
    // Client Shop Item Detail — a real /shop/item/:kind/:id route, so a
    // refresh or direct link on that path also needs to land back in the
    // full-screen Shop view (PortalShop itself reads the same path to
    // decide which item to show).
    return /^\/shop\/item\/[^/]+\/[^/]+/.test(window.location.pathname);
  });
  // Lifted out of PortalShop so the cart survives leaving/returning to the
  // Shop view (Portal itself never unmounts) and so the nav badge below can
  // show the live quantity. Still the ONE cart — PortalShop is a fully
  // controlled consumer of this same state, not a second cart.
  const [shopCart, setShopCart] = useState([]); // [{kind, ref_id, quantity}]

  // Public no-account storefront (Phase 4) — once, on mount: (1) a strictly
  // validated pending /shop or /shop/item/:kind/:id redirect stashed by the
  // guest storefront's sign-in CTA (defense in depth — the primary flow
  // never actually navigates away from /shop, see GuestAuthModal's doc
  // comment, but this covers any real navigation elsewhere and back), and
  // (2) whether a non-empty guest cart exists at all, which decides whether
  // the merge-review dialog below ever mounts.
  const [showGuestMergeReview, setShowGuestMergeReview] = useState(false);
  // Tracks whether a non-empty guest cart still exists in localStorage —
  // "Not Now" on the review deliberately leaves it there (never cleared
  // except by an explicit confirm), so this count re-appears as a small,
  // resumable "Review saved items" affordance rather than the guest's
  // browsing being silently lost the moment they dismiss the dialog once.
  const [guestCartPendingCount, setGuestCartPendingCount] = useState(0);
  useEffect(() => {
    const pending = consumePendingShopRedirect();
    if (pending && pending !== window.location.pathname) {
      window.history.replaceState({}, "", pending);
      if (/^\/shop\/?$/.test(pending)) { setShopOpen(true); }
      else if (/^\/shop\/item\//.test(pending)) { setShopOpen(true); }
    }
    if (window.location.pathname === "/shop" || window.location.pathname === "/shop/" || /^\/shop\/item\//.test(window.location.pathname)) {
      const guestCart = readGuestCart();
      if (guestCart.length > 0) {
        setShowGuestMergeReview(true);
        setGuestCartPendingCount(guestCart.reduce((n, l) => n + l.quantity, 0));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Refreshes the resumable-banner count (never force-reopens the dialog
  // itself) each time the Shop view is opened, not just on Portal's initial
  // mount — Portal itself never unmounts when toggling in and out of the
  // Shop, so the authenticated cart survives that toggle even though it
  // resets on a real page reload.
  useEffect(() => {
    if (!shopOpen) return;
    const count = readGuestCart().reduce((n, l) => n + l.quantity, 0);
    if (count > 0) setGuestCartPendingCount(count);
  }, [shopOpen]);
  const shopCartCount = shopCart.reduce((n, c) => n + c.quantity, 0);
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
  const [showWaiver, setShowWaiver] = useState(false);
  const [waiverSuccess, setWaiverSuccess] = useState(null); // { signedAt } | null
  const [homework, setHomework] = useState([]);
  const [practiceFor, setPracticeFor] = useState(null); // homework doc open in the Homework Practice screen
  const [schoolEntries, setSchoolEntries] = useState([]); // Online School (Phase 1) — /portal/school; empty for any client with no school enrollment
  // Student School (Phase 2A) — real /school* URLs via the same history
  // navigation-swap pattern the Shop view uses, so a refresh while in School
  // lands back in School (not the portal home).
  const [schoolPath, setSchoolPath] = useState(() =>
    (typeof window !== "undefined" && /^\/school(\/.*)?$/.test(window.location.pathname)) ? window.location.pathname : null);
  useEffect(() => {
    const onPop = () => setSchoolPath(/^\/school(\/.*)?$/.test(window.location.pathname) ? window.location.pathname : null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openSchool = () => { window.history.pushState({}, "", "/school"); setSchoolPath("/school"); };
  const [lightbox, setLightbox] = useState({ open: false, photos: [], index: 0 });
  const [dogModal, setDogModal] = useState({ open: false, dog: null });
  const [profileOpen, setProfileOpen] = useState(false);
  const [tutorialsOpen, setTutorialsOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messagesUnread, setMessagesUnread] = useState(0);
  // Photography Phase 1 — dedicated full-screen Photography page, same
  // navigation-swap pattern as the full-screen Shop view below.
  const [photographyOpen, setPhotographyOpen] = useState(false);
  // Focused Client Usability phase — secondary/optional portal features
  // (Shop, Credits/Prepaid Visits, Rewards, Referrals, Training history,
  // Homework, Files, Trivia) are collapsed by default under one "More"
  // disclosure so Home stays focused on what needs a client's attention
  // today. Nothing is removed — every existing section/behavior is exactly
  // the same markup, just hidden until expanded (same pattern already used
  // for the full setup checklist below).
  const [moreOpen, setMoreOpen] = useState(false);

  // Sprint 110di-17 — Feature Visibility gates. Each useFeature read is
  // cheap (just a context lookup) and defaults to TRUE so first paint
  // never hides anything before the branding context has resolved.
  const feat = {
    daycare:          useFeature("daycare"),
    boarding:         useFeature("boarding"),
    training:         useFeature("training"),
    grooming:         useFeature("grooming"),
    photography:      useFeature("photography"),
    homework:         useFeature("homework"),
    rewards:          useFeature("rewards"),
    trivia:           useFeature("trivia"),
    waitlist:         useFeature("waitlist"),
    client_messaging: useFeature("client_messaging"),
    payment_plans:    useFeature("payment_plans"),
  };

  // Sprint 110di-18 — Client Portal Controls. Read once from theme context.
  // `sectionOn(name)` is the canonical helper — Feature Visibility (master)
  // wins over the per-section toggle. `label(key, fallback)` returns the
  // admin's custom label, defaulting to the hard-coded fallback so legacy
  // installs keep working.
  const { branding: _brandingCpc } = useTheme();
  const cpc = _brandingCpc?.client_portal_controls || {};
  const sectionOn = (name) => {
    // Each section can have an implicit Feature Visibility master.
    const masterMap = { trivia_rewards: "rewards", messages: "client_messaging" };
    const m = masterMap[name];
    if (m && feat[m] === false) return false;
    return (cpc.sections || {})[name] !== false;
  };
  const label = (key, fallback) => {
    const v = (cpc.labels || {})[key];
    return (typeof v === "string" && v.trim()) ? v : fallback;
  };
  // Admin announcement banner — only show when enabled AND inside the
  // optional date window. Empty start/end means no lower/upper bound.
  const _ann = cpc.announcement || {};
  const _todayISO = new Date().toISOString().slice(0, 10);
  const announcementVisible = !!(_ann.enabled
    && (_ann.title?.trim() || _ann.message?.trim())
    && (!_ann.start_date || _ann.start_date <= _todayISO)
    && (!_ann.end_date   || _ann.end_date   >= _todayISO));
  // Sprint 110dh-6 — first-time client setup gate.
  const [setupStatus, setSetupStatus] = useState(null);
  const [setupRefresh, setSetupRefresh] = useState(0);
  // Redesign — the full step-by-step setup checklist is collapsed behind a
  // compact "Action Needed" summary on Home by default; expanding it doesn't
  // change any of its own logic, just whether its (unchanged) markup is shown.
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [vaccineWizard, setVaccineWizard] = useState(null); // [{dog, vaccine}, ...]
  // Sprint 110dh-9 — once the client has seen the "Setup Complete" hero and
  // clicked through (or dismissed) it, remember that locally so it doesn't
  // permanently sit at the top of the portal.
  const [setupSuccessDismissed, setSetupSuccessDismissed] = useState(() => {
    try { return localStorage.getItem("sh_setup_success_tour_dismissed_v3") === "1"; } catch { return false; }
  });
  const bookingLocked = setupStatus?.booking_locked === true;
  const readyToBook = setupStatus?.ready_to_book === true;
  const showSetupSuccess = readyToBook && !setupSuccessDismissed;
  const dismissSetupSuccess = () => {
    try { localStorage.setItem("sh_setup_success_tour_dismissed_v3", "1"); } catch {}
    setSetupSuccessDismissed(true);
  };
  const bumpSetupRefresh = () => setSetupRefresh(n => n + 1);

  // Poll the client portal unread badge so the header button shows a count.
  useEffect(() => {
    if (!user || user.role !== "client") return;
    let alive = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/me/messages-unread-count");
        if (alive) setMessagesUnread(data?.unread || 0);
      } catch { /* ignore */ }
    };
    tick();
    const h = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(h); };
  }, [user]);
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

  // Sprint 110di-14 — central guard for ALL "open booking wizard" callers.
  // Fetches the live setup gate, syncs state, and either (a) routes the
  // client to the setup checklist when booking is locked, or (b) opens the
  // wizard. Use this anywhere the wizard could be opened so the sticky
  // mobile CTA, the desktop Book Now button, and any future entry point all
  // share a single source of truth — no second onboarding system.
  const openBookingIfReady = useCallback(async () => {
    let live = setupStatus;
    try {
      const { data } = await api.get("/portal/setup-status");
      live = data;
      setSetupStatus(data);
    } catch {
      // Network blip — fall back to last known state. If we don't have one,
      // route to the checklist to be safe (never silently bypass the gate).
    }
    if (!live || live.booking_locked === true) {
      // Refresh the checklist so the user sees the latest steps, then
      // scroll to it. window+scrollRoot fallbacks keep mobile happy.
      setSetupRefresh(n => n + 1);
      const target = document.querySelector('[data-testid="portal-setup-checklist"]');
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
      try {
        const sr = document.querySelector('[data-scroll-root]');
        if (sr) sr.scrollTo({ top: 0, behavior: "smooth" });
      } catch {}
      return;
    }
    setShowBookWizard(true);
  }, [setupStatus]);
  // Sprint 110cf — Reschedule request modal for prepaid program sessions
  const [rescheduleFor, setRescheduleFor] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [dRes, bRes, wRes, sRes, hRes, svcRes, prgRes, schRes] = await Promise.all([
        api.get("/dogs"),
        api.get("/bookings"),
        api.get("/waivers/me"),
        api.get("/settings/public"),
        api.get("/homework"),
        api.get("/services").catch(()=>({data:[]})),
        api.get("/programs").catch(()=>({data:[]})),
        api.get("/portal/school").catch(()=>({data:[]})),
      ]);
      setDogs(dRes.data);
      setBookings(bRes.data);
      setWaiver(wRes.data);
      setPubSettings(sRes.data);
      setHomework(hRes.data);
      setPublicServices((svcRes.data || []).filter(s => s.active));
      setPublicPrograms((prgRes.data || []));
      setSchoolEntries(schRes.data || []);
      if (dRes.data.length > 0 && !bookDogId) setBookDogId(dRes.data[0].id);
      // Only auto-open the waiver modal AFTER the user has added at least one dog
      // (otherwise the onboarding banner takes them through profile → dog → waiver in order).
      const needsSign = !wRes.data?.signed || wRes.data?.needs_resign;
      if (needsSign && sRes.data?.waiver_required_for_booking && dRes.data.length > 0) setShowWaiver(true);
      await reloadUser();
    } catch (e) { console.warn("portal loadAll failed", e); }
  }, [bookDogId, reloadUser]);

  useEffect(() => { loadAll(); }, [loadAll]);
  // Sprint 110ao — Client portal also auto-refreshes every 30 s so booking
  // approvals, new trophies, and updated daily reports show up without a
  // manual reload. Auto-pauses while a modal is open (PortalBookWizard
  // acquires the edit lock).
  useLiveRefresh(loadAll, { intervalMs: 30_000 });

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
  const [rebookSeed, setRebookSeed] = useState(null);  // {dog_id, service_type, service_id} preselected when "Book Again" tapped
  const [showReferModal, setShowReferModal] = useState(false);
  const [vaccineModal, setVaccineModal] = useState(null); // { dog, vaccine }
  const [vaccineQuick, setVaccineQuick] = useState(null); // { initialDogId }
  // Confirmation MODAL shown after a client submits something that goes into
  // Sit Happens' review queue (vaccine certs today; other reviewed record
  // types can reuse this the same way). Stays open until the client
  // explicitly closes it — no auto-dismiss, so it can't be missed.
  const [reviewConfirm, setReviewConfirm] = useState(null); // { title, msg }
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

  // Sprint 110di-54 — Client self-service "email me a statement" button.
  // Reuses POST /portal/send-statement which proxies to the same handler
  // the admin "Send statement" uses (so the message is identical to what
  // the operator sends).
  const [sendingStatement, setSendingStatement] = useState(false);
  const [statementMsg, setStatementMsg] = useState("");
  const requestStatement = async () => {
    setSendingStatement(true); setStatementMsg("");
    try {
      const { data } = await api.post("/portal/send-statement");
      setStatementMsg(`Statement on its way to ${data.sent_to}.`);
    } catch (e) {
      setStatementMsg(e?.response?.data?.detail || "Couldn’t send the statement — please try again later.");
    } finally {
      setSendingStatement(false);
      setTimeout(() => setStatementMsg(""), 5000);
    }
  };

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
    try { await api.delete(`/bookings/${id}`); loadAll(); } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Could not cancel booking"); }
  };

  const waiverNeeded = pubSettings?.waiver_required_for_booking && (!waiver?.signed || waiver?.needs_resign);
  // Bug fix: previously this had `&& bookType !== "training"` which disabled
  // the Book Now button for ALL training bookings. Training is bookable.
  const canBook = avail && avail.vaccine_ok && avail.open_slots > 0 && !waiverNeeded;

  // Photography Phase 1 — declared before the photographyOpen early-return
  // below (which references it) since `const` bindings aren't hoisted.
  const goPhotographyBookSession = (serviceId) => {
    setRebookSeed({ service_type: "photography", service_id: serviceId || "" });
    setPhotographyOpen(false);
    if (dogs.length === 0) setDogModal({ open: true, dog: null });
    else openBookingIfReady();
  };

  // Sprint 110di-3 — Old 3-step onboarding banner removed; the full setup
  // gating now lives in `PortalSetupChecklist`. Kept the `Hi <name>! Welcome`
  // header. No need to track per-step state here anymore.

  // Client Shop Phase 2 UX — dedicated full-screen Shop view. Placed after
  // every hook above has already run (React rules-of-hooks), before the
  // normal dashboard JSX. Cart/component state lives inside PortalShop
  // itself and is untouched by switching in/out of this view, since
  // PortalShop stays mounted continuously whenever shopOpen is true — this
  // is a real navigation swap, not a duplicated Shop implementation.
  if (shopOpen) {
    return (
      <div className="app-shell h-full min-h-0 flex flex-col" style={{ background: "var(--sh-card-base)" }} data-testid="client-portal-shop-page">
        <header className="shrink-0 border-b border-shBorder flex items-center justify-between gap-2 px-3 sm:px-8 py-3" style={{ background: "var(--sh-card-base)" }}>
          <PremiumButton variant="secondary" onClick={() => {
            // Leaving the Shop entirely — clear any /shop/item/:kind/:id path
            // so a later refresh lands on the portal, not back in that item.
            if (/^\/shop\/item\//.test(window.location.pathname)) window.history.pushState({}, "", "/");
            setShopOpen(false);
          }} data-testid="portal-shop-back-button">
            <i className="fas fa-arrow-left"/>
            <span>Back to Portal</span>
          </PremiumButton>
          <img src="/logo.png" alt="Sit Happens" className="h-9 sm:h-12 shrink-0" />
        </header>
        {!showGuestMergeReview && guestCartPendingCount > 0 && (
          <button onClick={() => setShowGuestMergeReview(true)} data-testid="guest-cart-resume-banner"
                  className="shrink-0 w-full text-center py-2 text-[12px] font-black uppercase tracking-widest bg-shSecondary/10 text-shSecondary border-b border-shSecondary/30 hover:bg-shSecondary/20 transition">
            <i className="fas fa-cart-shopping mr-1.5" />
            {guestCartPendingCount} item{guestCartPendingCount !== 1 ? "s" : ""} saved from browsing — Review &amp; Add to Cart
          </button>
        )}
        <div className="app-scroll-root flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-6" data-scroll-root>
          <PortalShop initialTab={shopInitialTab} fullScreen shopifyStoreUrl={pubSettings?.client_portal_links?.shopify_store_url}
                      cart={shopCart} onCartChange={setShopCart}
                      onGoToOnlineSchool={() => { setShopOpen(false); openSchool(); }} />
        </div>
        {showGuestMergeReview && (
          <GuestCartMergeReview
            authCart={shopCart}
            onApply={(next) => { setShopCart(next); setShowGuestMergeReview(false); setGuestCartPendingCount(0); }}
            onDismiss={() => setShowGuestMergeReview(false)}
          />
        )}
      </div>
    );
  }

  // Photography Phase 1 — dedicated full-screen Photography destination,
  // same navigation-swap pattern as the Shop view above. Booking/pricing
  // logic is untouched: "Book a Session" just seeds the existing booking
  // wizard with service_type="photography" (optionally a specific
  // service_id) exactly like the existing "Book Again" rebook flow does.
  if (photographyOpen) {
    return (
      <div className="app-shell h-full min-h-0 flex flex-col" style={{ background: "var(--sh-card-base)" }} data-testid="client-portal-photography-page">
        <header className="shrink-0 border-b border-shBorder flex items-center justify-between gap-2 px-3 sm:px-8 py-3" style={{ background: "var(--sh-card-base)" }}>
          <PremiumButton variant="secondary" onClick={() => setPhotographyOpen(false)} data-testid="portal-photography-back-button">
            <i className="fas fa-arrow-left"/>
            <span>Back to Portal</span>
          </PremiumButton>
          <img src="/logo.png" alt="Sit Happens" className="h-9 sm:h-12 shrink-0" />
        </header>
        <div className="app-scroll-root flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-6" data-scroll-root>
          <PortalPhotography
            pubSettings={pubSettings}
            client={client}
            services={publicServices.filter(s => s.service_type === "photography")}
            onBookSession={goPhotographyBookSession}
          />
        </div>
      </div>
    );
  }

  // Student School (Phase 2A) — full-screen routed area, same navigation-swap
  // early-return as the Shop/Photography views above.
  if (schoolPath) {
    return (
      <SchoolApp
        path={schoolPath}
        clientName={user.name?.split(" ")[0] || user.name}
        onNavigate={(p) => { window.history.pushState({}, "", p); setSchoolPath(p); }}
        onExit={() => { window.history.pushState({}, "", "/"); setSchoolPath(null); loadAll(); }}
      />
    );
  }

  // Redesign Phase B — shared handlers for the sidebar (desktop) and bottom
  // nav / "More" sheet (mobile). Every one of these reuses an existing
  // Portal.jsx state setter or handler already wired elsewhere on this
  // screen (booking wizard gate, Shop, Photography info card, Messages,
  // dog modal, anchors for Payments/Credits/Rewards, Refer modal, How to
  // Use) — no new navigation/business logic is introduced here.
  const goHome = () => document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0, behavior: "smooth" });
  const goBook = () => { if (dogs.length === 0) setDogModal({ open: true, dog: null }); else openBookingIfReady(); };
  const goShop = () => { setShopInitialTab("all"); setShopOpen(true); };
  const goPhotography = () => setPhotographyOpen(true);
  const goMessages = () => setMessagesOpen(true);
  const goMyDogs = () => setDogModal({ open: true, dog: dogs[0] || null });
  const goPayments = () => document.getElementById("portal-payments-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const goCredits = () => {
    setMoreOpen(true);
    setTimeout(() => document.querySelector('[data-testid="credits-card"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const goRewards = () => {
    setMoreOpen(true);
    setTimeout(() => document.querySelector('[data-testid="portal-trophies-section"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const goTraining = () => {
    setMoreOpen(true);
    setTimeout(() => document.getElementById("portal-training-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const goHomeworkHistory = () => {
    setMoreOpen(true);
    setTimeout(() => document.getElementById("portal-homework-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const goFiles = () => {
    setMoreOpen(true);
    setTimeout(() => document.getElementById("portal-files-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const goRefer = () => setShowReferModal(true);
  const goHelp = () => setTutorialsOpen(true);

  // Shared "open the right thing for this setup step" dispatch — used by
  // both PortalSetupChecklist's own onAction AND the new "What You Need to
  // Do" card, so there's exactly one place that knows how to act on each
  // setup target rather than two copies of the same logic.
  const handlePortalSetupAction = (target) => {
    if (target === "waiver") {
      setShowWaiver(true);
      return true;
    }
    if (target === "vaccines") {
      // Collect every (dog, required-vaccine) pair that's missing or
      // expired, then fire the multi-step wizard. If there's only one,
      // the wizard still works (1-of-1).
      const todayIso = new Date().toISOString().slice(0, 10);
      const required = ["rabies", "bordetella", "dhpp"];
      const queue = [];
      dogs.forEach(d => {
        required.forEach(v => {
          const exp = d?.vaccines?.[v];
          if (!exp || String(exp).slice(0, 10) < todayIso) {
            queue.push({ dog: d, vaccine: v });
          }
        });
      });
      if (queue.length > 0) { setVaccineWizard(queue); return true; }
      if (dogs.length > 0)  { setVaccineModal({ dog: dogs[0], vaccine: "rabies" }); return true; }
      // No dogs yet — open the add-dog modal so they start there.
      setDogModal({ open: true, dog: null });
      return true;
    }
    if (target === "dogs") {
      // Always open the Add Dog modal from the setup checklist —
      // covers both "add first dog" and "add another dog".
      setDogModal({ open: true, dog: null });
      return true;
    }
    if (target === "profile") {
      setProfileOpen(true);
      return true;
    }
    return false;  // let the checklist fall through to its default scroll
  };

  // "What You Need to Do" card's primary action — covers the shared setup
  // targets above PLUS the targets unique to items 6-10 of the priority
  // list (payment/booking review/messages/next-appointment/book).
  const handleNeedsAttentionAction = (target, payload) => {
    if (["waiver", "vaccines", "dogs", "profile"].includes(target)) {
      handlePortalSetupAction(target);
      return;
    }
    if (target === "intake") {
      setSetupExpanded(true);
      setTimeout(() => document.querySelector('[data-testid="portal-setup-checklist"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      return;
    }
    if (target === "payment") {
      goPayments();
      return;
    }
    if (target === "booking") {
      const b = bookings.find(x => x.id === payload?.bookingId);
      setBookingsTab(b && ["rejected", "completed", "cancelled"].includes(b.status) ? "past" : "upcoming");
      setTimeout(() => document.getElementById("portal-bookings-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      return;
    }
    if (target === "messages") {
      setMessagesOpen(true);
      return;
    }
    if (target === "book") {
      goBook();
      return;
    }
  };

  return (
    <div className="app-shell h-full min-h-0 flex bg-bgBase sh-client-portal" data-testid="client-portal">
      <ClientSidebar
        shopCartCount={shopCartCount}
        messagesUnread={messagesUnread}
        showPhotography={feat.photography}
        showMessages={sectionOn("messages")}
        showHelp={sectionOn("help_button")}
        onHome={goHome} onBook={goBook} onShop={goShop} onPhotography={goPhotography} onMessages={goMessages}
        onMyDogs={goMyDogs} onPayments={goPayments} onCredits={goCredits} onRewards={goRewards} onRefer={goRefer} onHelp={goHelp}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <OnboardingBanner missingCount={onboardingMissing} onOpen={reopenOnboarding} />
        {/* Redesign Phase B — simplified header. Logo now lives in the
            sidebar on desktop (shown here only on mobile, where the sidebar
            is hidden); lower-value utility actions (How to Use / Install /
            Logout) moved into ClientProfileMenu instead of permanent
            buttons. Same underlying behaviour for all of them. */}
        <header className="shrink-0 bg-bgHeader border-b border-shBorder flex items-center justify-between gap-3 px-3 sm:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt="Sit Happens" className="h-9 w-auto shrink-0 md:hidden" data-testid="portal-logo" />
            <div className="hidden sm:block min-w-0">
              <p className="text-xl text-shText font-bold truncate">
                Welcome back, {user.name.split(" ")[0] || user.name}!
              </p>
              <p className="text-[13px] text-shTextMuted truncate">
                Here&apos;s what&apos;s happening with your pup.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sectionOn("messages") && (
              <button onClick={goMessages} data-testid="portal-messages-button"
                      className="relative flex items-center gap-2 h-9 px-3 rounded-full border border-shBorder text-shText text-[13px] font-semibold hover:border-shSecondary/50 transition"
                      style={{ background: "var(--sh-card-base)", boxShadow: messagesUnread > 0 ? "0 0 14px -5px rgba(0,169,224,0.55)" : undefined }}>
                <i className="fas fa-comment-dots text-shSecondary"/>
                <span className="hidden sm:inline">Messages</span>
                {messagesUnread > 0 && (
                  <span className="bg-shPrimary text-bgHeader text-[10px] font-black rounded-full min-w-[18px] h-[18px] px-1 grid place-items-center"
                        data-testid="portal-messages-badge">{messagesUnread}</span>
                )}
              </button>
            )}
            <ClientProfileMenu name={user.name} showHelp={sectionOn("help_button")} onHelp={goHelp} onLogout={logout} />
          </div>
        </header>

      <div className="app-scroll-root flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-8 max-w-6xl mx-auto w-full pb-24 md:pb-8" data-scroll-root>
        {/* Sit Happens School — the HERO of an enrolled client's
            portal: the very first card in the scroll, above even the quick
            actions, so the paid course is the first thing a school client
            notices on desktop and mobile alike. Renders nothing for clients
            with no School enrollment — a no-op for everyone else. */}
        {schoolEntries.length > 0 && (
          <div className="mb-4 sm:mb-6">
            <OnlineSchoolHeroCard entries={schoolEntries} onOpen={openSchool} />
          </div>
        )}

        {/* Above-the-fold quick actions — all 3 cards stay on Home per the
            user's own correction; Book is kept the strongest (emphasized)
            so it doesn't visually compete with Shop, rather than removing
            Shop/Photography from view (Focused Client Usability phase). */}
        <div className={`grid grid-cols-1 ${feat.photography ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3 mb-4 sm:mb-6`}
             data-testid="portal-top-quick-actions">
          <PortalHomeActionCard
            testId="portal-quickaction-book"
            icon="fa-calendar-plus" accent="primary" emphasized
            title="Book Now" description="Schedule daycare, boarding, training, grooming and more."
            ctaLabel="Book an Appointment" onClick={goBook}
          />
          <PortalHomeActionCard
            testId="portal-quickaction-shop"
            icon="fa-bag-shopping" accent="shop"
            title="Shop" description="Browse premium training gear, tools & exclusive products."
            ctaLabel="Shop Now" cartCount={shopCartCount} onClick={goShop}
          />
          {feat.photography && (
            <PortalHomeActionCard
              testId="portal-quickaction-photography"
              icon="fa-camera-retro" accent="accent"
              title="Photography" description="Capture progress. Book a session or order photos."
              ctaLabel="View Photography" onClick={goPhotography}
            />
          )}
        </div>

        {/* Persistent waiver-signature confirmation — replaces the old
            silent modal close (Focused Client Usability phase). Only ever
            shown after the server has actually confirmed the signature. */}
        {waiverSuccess && (
          <div className="mb-4 sm:mb-6">
            <PortalSuccessPanel
              testId="portal-waiver-success"
              title="Your waiver was signed successfully"
              subtitle={dogs.length ? `Covers ${dogs.map(d => d.name).join(", ")}` : undefined}
              date={waiverSuccess.signedAt}
              status="Signed"
              statusTone="green"
              nextSteps="You're all set — this waiver is on file and you're ready to book services."
              onDone={() => setWaiverSuccess(null)}
            />
          </div>
        )}

        {/* "What You Need to Do" — one prominent card showing only the
            single highest-priority relevant action (Focused Client
            Usability phase). Replaces the old generic "Action Needed"
            compact banner, which only ever covered the setup checklist. */}
        <PortalNeedsAttentionCard
          setupStatus={setupStatus} client={client} dogs={dogs} bookings={bookings}
          messagesUnread={messagesUnread} onAction={handleNeedsAttentionAction}
        />

        {/* "More" — Shop, Prepaid Visits, Rewards, Referrals, Training
            history, Homework history, Photography, Files, Trivia, and other
            optional tools. Collapsed by default so Home stays focused;
            nothing here is removed, just tucked behind one clearly-labeled
            disclosure. Opening it reveals the SAME sections (unchanged
            markup/logic) further down the page. */}
        <button type="button" onClick={() => setMoreOpen((v) => !v)} data-testid="portal-more-toggle"
                className="w-full mb-4 sm:mb-6 flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl border border-shBorder bg-[var(--sh-card-base)] hover:border-shPrimary/40 transition">
          <span className="flex items-center gap-2 text-[15px] font-bold text-shText">
            <i className="fas fa-ellipsis text-shTextMuted"/>More
            <span className="text-[13px] text-shTextMuted font-normal">Prepaid visits, rewards, referrals, training history & more</span>
          </span>
          <i className={`fas fa-chevron-down text-shTextMuted transition-transform ${moreOpen ? "rotate-180" : ""}`}/>
        </button>

        {/* The old compact "Action Needed" banner (setup-only, generic
            copy) is superseded by PortalNeedsAttentionCard above, which
            covers this same setup-incomplete case with specific per-step
            guidance plus 9 other priority cases. setSetupExpanded(true) is
            still triggered via the card's "setup"/"intake" action targets
            (see handleNeedsAttentionAction), so "Continue Setup" behavior
            is fully preserved — just reached through one card instead of
            two overlapping ones. */}

        {/* Sprint 110di-18 — Admin-set announcement banner. Renders at the
            very top whenever enabled + within the date window. */}
        {announcementVisible && (() => {
          const styleMap = {
            info:    { bg: "bg-shBlue/10",   border: "border-shBlue/50",   text: "text-shBlue",   icon: "fa-circle-info" },
            success: { bg: "bg-shGreen/10",  border: "border-shGreen/50",  text: "text-shGreen",  icon: "fa-circle-check" },
            warning: { bg: "bg-shOrange/10", border: "border-shOrange/50", text: "text-shOrange", icon: "fa-triangle-exclamation" },
            urgent:  { bg: "bg-red-500/15",  border: "border-red-500/60",  text: "text-red-400",  icon: "fa-bullhorn" },
          };
          const sty = styleMap[_ann.style] || styleMap.info;
          return (
            <div data-testid="portal-admin-announcement"
                 className={`mb-4 rounded-xl border ${sty.bg} ${sty.border} p-4 shadow-lg flex items-start gap-3`}>
              <i className={`fas ${sty.icon} ${sty.text} text-xl shrink-0 mt-0.5`}/>
              <div className="min-w-0">
                {_ann.title?.trim() && (
                  <p className={`text-[14px] font-black uppercase tracking-widest ${sty.text}`}>{_ann.title}</p>
                )}
                {_ann.message?.trim() && (
                  <p className="text-[13px] text-gray-200 mt-0.5 leading-snug">{_ann.message}</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Sprint 110dh-6 / 110di-22 — Setup checklist hoisted ABOVE landing_priority
            so "Requirements to Book" is ALWAYS the first thing a not-yet-onboarded
            client sees, regardless of the admin's landing_priority order. The
            checklist auto-hides once setup is complete, so this slot becomes
            invisible for fully onboarded clients. The success card (shown once
            the first time setup completes) also lives here. */}
        {showSetupSuccess && (
          <PortalSetupSuccess
            onBook={() => {
              dismissSetupSuccess();
              openBookingIfReady();
            }}
            onHelp={sectionOn("messages") ? (() => setMessagesOpen(true)) : null}
            onDismiss={dismissSetupSuccess}
            offerings={[
              { id: "book", icon: "fa-calendar-plus", title: "Book Services", text: "Request daycare, boarding, training, grooming, or other services from one place." },
              { id: "bookings", icon: "fa-calendar-day", title: "See Your Schedule", text: "Check upcoming visits, past bookings, and booking status without calling in." },
              { id: "dogs", icon: "fa-dog", title: "Manage Dog Info", text: "Keep your dog's profile, notes, vaccine records, and important details updated." },
              ...(sectionOn("messages") ? [{ id: "messages", icon: "fa-comments", title: "Message Us", text: "Send questions, updates, or help requests right from the portal." }] : []),
              ...(sectionOn("credits") ? [{ id: "credits", icon: "fa-wallet", title: "Track Credits & Balances", text: "See daycare or boarding credits, payment options, and balances when available." }] : []),
              ...(sectionOn("trivia_rewards") ? [{ id: "rewards", icon: "fa-trophy", title: "Rewards & Trivia", text: "Play trivia, earn rewards, and see fun extras when available." }] : []),
            ]}
          />
        )}
        <NeedsPasswordCard />
        {/* Kept permanently mounted (never conditionally rendered) so it
            keeps reporting live setup status via onStatusChange regardless
            of whether the compact banner above is expanded — only its
            visual output is hidden/shown, its own internals/props/behavior
            are completely unchanged. */}
        <div className={setupExpanded ? "" : "hidden"} data-testid="portal-setup-checklist-wrap">
        <PortalSetupChecklist
          refreshKey={setupRefresh}
          onStatusChange={setSetupStatus}
          onHelp={sectionOn("messages") ? (() => setMessagesOpen(true)) : null}
          onAction={handlePortalSetupAction}
        />
        </div>

        {/* Phase 10A — One organized client overview replaces the old stack of
            tiny landing callouts and the redundant welcome-only card. Existing
            booking, setup, homework, trophy, dog, and credit data is reused.
            Focused Client Usability phase — this whole hub duplicates the new
            "What You Need to Do" card's priority messaging (hidden via
            hidePriorityCard) and its own My Dogs mini-overview duplicates the
            full My Dogs section that stays prominent below, so the rest of
            the hub (Quick Actions/Recent Activity) moves behind "More" too —
            nothing removed, still one click away. */}
        <PortalAnnouncementsCard defaultCollapsed />
        <div className={moreOpen ? "" : "hidden"} data-testid="portal-more-engagement-hub">
        <PortalEngagementHub
          hidePriorityCard
          dogs={dogs}
          bookings={bookings}
          homework={homework}
          trophies={trophies}
          setupStatus={setupStatus}
          messagesUnread={messagesUnread}
          credits={credits}
          trainingCredits={client?.training_credits || 0}
          boardingCredits={client?.boarding_credits || 0}
          showMessages={sectionOn("messages")}
          showHomework={feat.homework}
          showCredits={sectionOn("credits")}
          showRewards={sectionOn("trivia_rewards") && feat.rewards}
          showUpload={sectionOn("vaccines_compliance")}
          showReferral={feat.rewards && !!referralCode}
          onSetup={() => document.querySelector('[data-testid="portal-setup-checklist"]')?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onMessages={() => setMessagesOpen(true)}
          onBookings={() => {
            setBookingsTab("upcoming");
            document.getElementById("portal-bookings-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onReportCards={() => {
            setBookingsTab("past");
            document.getElementById("portal-bookings-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onHomework={() => document.getElementById("portal-homework-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onCredits={() => document.querySelector('[data-testid="credits-card"]')?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onRewards={() => document.querySelector('[data-testid="portal-trophies-section"]')?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onRefer={() => setShowReferModal(true)}
          onBook={() => {
            if (dogs.length === 0) setDogModal({ open: true, dog: null });
            else openBookingIfReady();
          }}
          onUpload={() => {
            const todayIso = new Date().toISOString().slice(0, 10);
            const needs = (d, k) => !d?.vaccines?.[k] || String(d.vaccines[k]).slice(0, 10) < todayIso;
            const candidate = dogs.find(d => needs(d, "rabies"))
                           || dogs.find(d => needs(d, "bordetella"))
                           || dogs.find(d => needs(d, "dhpp"))
                           || dogs[0];
            if (candidate) setVaccineQuick({ initialDogId: candidate.id });
            else setDogModal({ open: true, dog: null });
          }}
          onHelp={sectionOn("help_button") ? (() => setTutorialsOpen(true)) : null}
          onDogOpen={(dog) => setDogModal({ open: true, dog })}
        />
        </div>

        {/* Sprint 110di-51 — Account balance / tab banner. Shown only when the
            client has an outstanding balance OR a pre-paid credit on file so
            it stays out of the way for paid-in-full clients. POSITIVE = owes
            the business, NEGATIVE = credit on file. */}
        {client && Math.abs(Number(client.account_balance || 0)) > 0.005 && (
          (Number(client.account_balance) > 0 ? (
            <div className="mb-4 sm:mb-6 bg-shOrange/15 border border-shOrange/40 rounded-xl p-4 sm:p-5 shadow-2xl"
                 data-testid="portal-balance-owes">
              <div className="flex items-center gap-4">
                <i className="fas fa-file-invoice-dollar text-shOrange text-3xl"/>
                <div className="flex-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange">{CLIENT_LABELS.balanceDue}</p>
                  <p className="text-3xl font-black text-white" data-testid="portal-balance-amount">
                    ${Number(client.account_balance).toFixed(2)}
                  </p>
                  <p className="text-[13px] text-gray-300 mt-1">
                    You have an outstanding balance. You can pay an open invoice below or settle up next time you stop in.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button onClick={requestStatement} disabled={sendingStatement}
                        data-testid="portal-send-statement-btn"
                        className="bg-shOrange/30 border border-shOrange/50 text-shOrange px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shOrange/40 disabled:opacity-50 transition">
                  <i className={`fas ${sendingStatement ? "fa-circle-notch fa-spin" : "fa-envelope"} mr-2`}/>
                  {sendingStatement ? "Sending…" : "Email me my statement"}
                </button>
                {statementMsg && (
                  <span className="text-[12px] text-gray-300" data-testid="portal-statement-msg">{statementMsg}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-4 sm:mb-6 bg-shGreen/10 border border-shGreen/40 rounded-xl p-4 sm:p-5 shadow-2xl"
                 data-testid="portal-balance-credit">
              <div className="flex items-center gap-4">
                <i className="fas fa-piggy-bank text-shGreen text-3xl"/>
                <div className="flex-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">{CLIENT_LABELS.accountCredit}</p>
                  <p className="text-3xl font-black text-white" data-testid="portal-balance-amount">
                    ${Math.abs(Number(client.account_balance)).toFixed(2)}
                  </p>
                  <p className="text-[13px] text-gray-300 mt-1">
                    You overpaid on a recent visit — we&apos;ll apply this to your next ticket automatically.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button onClick={requestStatement} disabled={sendingStatement}
                        data-testid="portal-send-statement-btn"
                        className="bg-shGreen/20 border border-shGreen/40 text-shGreen px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shGreen/30 disabled:opacity-50 transition">
                  <i className={`fas ${sendingStatement ? "fa-circle-notch fa-spin" : "fa-envelope"} mr-2`}/>
                  {sendingStatement ? "Sending…" : "Email me my statement"}
                </button>
                {statementMsg && (
                  <span className="text-[12px] text-gray-300" data-testid="portal-statement-msg">{statementMsg}</span>
                )}
              </div>
            </div>
          ))
        )}

        {/* Stripe Online Payments (Phase 3A) — client-facing invoice list +
            Pay Online. Self-hides while loading/empty; independently checks
            whether online payments are enabled server-side. */}
        <div id="portal-payments-anchor">
          <PortalInvoices />
        </div>

        {/* Phase 10A — Fun extras remain available without competing with the
            client's real tasks. The drawer is closed by default so the home
            screen stays calm for people who are uncomfortable with new apps. */}
        {(sectionOn("dog_facts") || sectionOn("training_tip") || (sectionOn("trivia_rewards") && feat.trivia)) && (
          <details className="mb-6 group bg-bgPanel border border-bgHover rounded-2xl shadow-xl overflow-hidden" data-testid="portal-fun-drawer">
            <summary className="list-none cursor-pointer px-4 sm:px-5 py-4 flex items-center justify-between gap-3 hover:bg-bgHover/40 transition">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-full bg-shOrange/15 text-shOrange grid place-items-center shrink-0"><i className="fas fa-bone"/></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange">Optional fun</p>
                  <p className="text-[15px] sm:text-base font-black text-white uppercase italic tracking-tight truncate">Dog facts, training tips & trivia</p>
                </div>
              </div>
              <i className="fas fa-chevron-down text-gray-500 group-open:rotate-180 transition-transform"/>
            </summary>
            <div className="border-t border-bgHover p-4 sm:p-5 space-y-5">
              {sectionOn("dog_facts") && <DogFactCard variant="big" />}
              {sectionOn("training_tip") && <PortalTrainingTipCard />}
              {sectionOn("trivia_rewards") && feat.trivia && <DailyTriviaCard />}
            </div>
          </details>
        )}

        {/* Sprint 110dh-5 — Mobile-only hoist: Action Needed (intake forms) is
            the most important item so it should be the first thing visible on
            a phone. Desktop version lives inside the right column below. */}
        <div className="md:hidden mb-6" data-testid="portal-mobile-action-needed">
          <IntakePortalSection />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="col-span-1 space-y-6">
          {/* Focused Client Usability phase — Credits/Prepaid-visits and the
              Waiver reference card are secondary on Home; tucked behind the
              "More" disclosure below (unchanged markup/logic, just hidden
              until the client opens it). */}
          <div className={moreOpen ? "" : "hidden"} data-testid="portal-more-credits-waiver">
          {/* Sprint 110x — credits card upgraded with brand-color glow halos
              behind each metric, slightly bigger numbers, gradient bg. Same
              data, much more visually engaging.
              Sprint 110di-18 — Gated by Client Portal Controls section toggle. */}
          {sectionOn("credits") && (
          <div className="relative overflow-hidden p-6 rounded-2xl border border-shBorder shadow-sh" style={{ background: "var(--sh-card-base)" }} data-testid="credits-card">
            <div className="absolute inset-0 pointer-events-none opacity-25"
                 style={{ background: "radial-gradient(circle at 50% 0%, rgba(140,198,63,0.35) 0%, transparent 55%)" }}/>
            <div className="relative">
              <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen text-center mb-4">
                <i className="fas fa-wallet mr-1"/>{label("credits", CLIENT_LABELS.creditPack)}
              </p>
              {/* Focused Client Usability phase — a client who has never
                  purchased prepaid visits and has no visit history at all
                  sees a simple purchase action instead of an empty 0/0/0
                  metrics dashboard. */}
              {(credits || 0) === 0 && (client?.training_credits || 0) === 0 && (client?.boarding_credits || 0) === 0
                && Object.values(visitCounts || {}).every((v) => !v) ? (
                <div className="text-center" data-testid="portal-credits-empty-state">
                  <p className="text-[14px] text-gray-300">You haven't purchased any {CLIENT_LABELS.creditPack.toLowerCase()} yet — buy some below to get started.</p>
                </div>
              ) : (
              <>
              {/* Sprint 110di-17 — credit tiles gated by service feature
                  toggles. Use a dynamic grid count so layout stays centered
                  when 1-3 services are enabled. */}
              {(() => {
                const tiles = [];
                if (feat.daycare) tiles.push(
                  <CreditMetricCard key="daycare" icon="fa-sun" label="Daycare" value={credits || 0} unit="days"
                    color="shGreen" haloRgba="rgba(140,198,63,0.7)" dropShadow="0 0 8px rgba(140,198,63,0.4)"
                    testid="credit-metric-daycare"/>
                );
                if (feat.training) tiles.push(
                  <CreditMetricCard key="training" icon="fa-graduation-cap" label="Training" value={client?.training_credits || 0} unit="sessions"
                    color="purple-400" haloRgba="rgba(168,85,247,0.7)" dropShadow="0 0 8px rgba(168,85,247,0.4)"
                    testid="credit-metric-training"/>
                );
                if (feat.boarding) tiles.push(
                  <CreditMetricCard key="boarding" icon="fa-moon" label="Boarding" value={client?.boarding_credits || 0} unit="nights"
                    color="shOrange" haloRgba="rgba(242,101,34,0.7)" dropShadow="0 0 8px rgba(242,101,34,0.4)"
                    testid="credit-metric-boarding"/>
                );
                if (tiles.length === 0) return null;
                const colsClass = tiles.length === 1 ? "grid-cols-1" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-3";
                return (
                  <div className={`grid ${colsClass} gap-2 text-center items-stretch`}>{tiles}</div>
                );
              })()}
              {feat.grooming && (
                <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-3 text-center">
                  <i className="fas fa-bath text-shBlue mr-1"/>Grooming is pay-on-the-day
                </p>
              )}
              <p className="text-[11px] text-gray-500 mt-2 text-center" data-testid="credits-helper-text">
                <i className="fas fa-circle-info mr-1"/>Credits update after completed bookings or admin changes.
              </p>
              {(() => {
                const totalCredits = (credits || 0) + (client?.training_credits || 0) + (client?.boarding_credits || 0);
                if (totalCredits > 2) return null;
                return (
                  <div className="mt-3 border border-shAccent/30 rounded-lg p-3 text-center" style={{ background: "var(--sh-card-base)" }}
                       data-testid="portal-low-credits-helper">
                    <p className="text-[12px] text-shOrange font-black uppercase tracking-widest">
                      <i className="fas fa-circle-info mr-1"/>Need more credits?
                    </p>
                    <p className="text-[12px] text-gray-300 mt-1">
                      Contact us or book your next service.
                    </p>
                    <button onClick={()=>{
                              const el = document.getElementById("portal-bookings-anchor");
                              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                            data-testid="portal-low-credits-book"
                            className="mt-2 inline-block text-[11px] font-black uppercase tracking-widest text-shGreen hover:underline">
                      Book a service <i className="fas fa-arrow-right ml-1"/>
                    </button>
                  </div>
                );
              })()}
              </>
              )}
              <PremiumButton variant="secondary" onClick={()=>setProfileOpen(true)} data-testid="open-profile" className="mt-4 w-full justify-center py-2.5">
                <i className="fas fa-user-pen"/>My Profile
              </PremiumButton>
              <PremiumButton variant="secondary" onClick={()=>{
                         setShopInitialTab("credit_pack");
                         setShopOpen(true);
                       }}
                      data-testid="buy-more-credits" className="mt-2 w-full justify-center py-2.5">
                <i className="fas fa-cart-plus"/>Buy {CLIENT_LABELS.creditPack}
              </PremiumButton>
              <PremiumButton variant="secondary" onClick={()=>{
                         const el = document.getElementById("portal-bookings-anchor");
                         if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                       }}
                      data-testid="jump-to-bookings" className="mt-2 w-full justify-center py-2.5">
                <i className="fas fa-calendar-day"/>{label("my_bookings", "My Bookings")} · {bookings.length}
              </PremiumButton>
              <div className="mt-4 pt-4 border-t border-shBorder">
                <TextSizePicker testid="portal-text-size" compact />
              </div>
            </div>
          </div>
          )}

          {/* The dedicated Shop sidebar card was removed — the top-of-page
              quick action (see portal-top-quick-actions, above the fold) is
              now the single primary Shop entrance for Home. Keeping this one
              here too would just duplicate that same promotion. */}

          {sectionOn("waiver_documents") && (
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
          )}
          </div>

          {/* Sprint 110x — Book Service promoted ABOVE quick links and turned
              into a vivid gradient hero CTA (brand-color glow, oversized icon,
              big punchy headline). It's the #1 action a client takes — should
              feel like the marquee not a small text card. */}
          <div id="portal-book-section"
               className="relative overflow-hidden rounded-2xl border border-shBlue/40 bg-gradient-to-br from-shBlue/30 via-shGreen/15 to-shOrange/15 p-5 shadow-2xl"
               data-testid="portal-book-hero">
            <div className="absolute inset-0 pointer-events-none opacity-50"
                 style={{ background: "radial-gradient(circle at 20% 30%, rgba(0,169,224,0.45) 0%, transparent 45%), radial-gradient(circle at 80% 80%, rgba(140,198,63,0.4) 0%, transparent 50%)" }}/>
            <div className="relative">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur grid place-items-center text-shGreen shrink-0 shadow-lg">
                  <i className="fas fa-calendar-plus text-2xl"/>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">
                    <i className="fas fa-paw mr-1"/>Ready when you are
                  </p>
                  <h3 className="text-xl font-black text-white uppercase italic tracking-tight leading-tight">
                    Book a service.
                  </h3>
                </div>
              </div>
              <p className="text-[14px] text-gray-200 leading-relaxed mb-4">
                {bookingLocked ? (cpc.booking_locked_message || "Complete your setup checklist above before booking.") :
                 dogs.length === 0 ? "Add a dog first to book a service." :
                 waiverNeeded ? "Sign the waiver before booking your first service." :
                 "Daycare, boarding, training & more — pick a service and a date."}
              </p>
              <button
                onClick={openBookingIfReady}
                disabled={!bookingLocked && (dogs.length === 0 || waiverNeeded)}
                data-testid="portal-book-button"
                className={`w-full py-4 rounded-lg font-black uppercase text-[14px] tracking-widest shadow-xl flex items-center justify-center gap-2 transition ${
                  bookingLocked
                    ? "bg-shOrange/20 text-shOrange border border-shOrange/40 hover:bg-shOrange/30 cursor-pointer"
                    : (dogs.length === 0 || waiverNeeded)
                      ? "bg-bgBase/60 text-gray-500 cursor-not-allowed border border-bgHover"
                      : "bg-shGreen text-bgHeader hover:bg-white hover:scale-[1.02] active:scale-[0.98]"
                }`}>
                {bookingLocked
                  ? <><i className="fas fa-lock"/>Setup required — open checklist</>
                  : <><i className="fas fa-calendar-plus"/>{dogs.length === 0 || waiverNeeded ? "Book Service" : "Book Now"}{!(dogs.length === 0 || waiverNeeded) && <i className="fas fa-arrow-right ml-1"/>}</>
                }
              </button>
              {bookingLocked && (
                <p className="text-[11px] text-shOrange mt-2 text-center font-black uppercase tracking-widest">
                  <i className="fas fa-circle-info mr-1"/>Booking unlocks once your setup checklist is complete.
                </p>
              )}
              {waiverNeeded && (
                <button onClick={()=>setShowWaiver(true)} data-testid="portal-book-waiver-link"
                        className="w-full mt-2 text-[14px] text-shOrange underline decoration-dotted text-center font-black uppercase tracking-widest">
                  Sign waiver to enable booking
                </button>
              )}
            </div>
          </div>

          {/* Focused Client Usability phase — Quick Links / Payment Options /
              Help are secondary browsing tools; tucked behind "More" too. */}
          <div className={moreOpen ? "" : "hidden"} data-testid="portal-more-quicklinks-help">
          {sectionOn("profile_quick_links") && (pubSettings?.client_portal_links?.website_url || client?.photo_gallery_url || pubSettings?.client_portal_links?.photo_gallery_url || referralCode || publicServices.length > 0 || publicPrograms.length > 0) && (
            <div className="relative overflow-hidden bg-bgPanel p-5 rounded-2xl border border-bgHover shadow-2xl" data-testid="portal-quick-links">
              {/* Sprint 110y — Quick Links overhauled. Brand-glow halo on the
                  whole card, eyebrow + italic headline, then a 2-col grid of
                  vivid colored tile cards (mirroring landing-page categories)
                  instead of flat full-width rows. Each link gets its own
                  branded color palette + icon halo so the visual rhythm
                  reads quickly even at a glance. */}
              <div className="absolute inset-0 pointer-events-none opacity-20"
                   style={{ background: "radial-gradient(circle at 50% 0%, rgba(0,169,224,0.45) 0%, transparent 55%)" }}/>
              <div className="relative">
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-1">
                  <i className="fas fa-ellipsis mr-1.5"/>Extra tools
                </p>
                <h3 className="text-xl font-black text-white uppercase italic tracking-tight mb-4">More Options.</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Primary actions now live in the organized overview above.
                      Keep only occasional tools here so clients do not have to
                      choose between duplicate Book, Messages, or Upload buttons. */}
                  {(publicServices.length > 0 || publicPrograms.length > 0) && (
                    <QuickLinkTile
                      onClick={()=>setShowServicesModal(true)}
                      testid="portal-open-services-btn"
                      icon="fa-list-check"
                      color="#8cc63f"
                      title="Services & Pricing"
                      subtitle={`${publicServices.length + publicPrograms.length} offered · quote`}
                    />
                  )}
                  {feat.homework && (homework.length > 0 || dogs.length > 0) && (
                    <QuickLinkTile
                      onClick={()=>{
                        const el = document.getElementById("portal-homework-anchor")
                                || document.getElementById("portal-training-section");
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      testid="portal-ql-training-files"
                      icon="fa-graduation-cap"
                      color="#a855f7"
                      title="School & Practice"
                      subtitle={homework.length > 0 ? `${homework.length} active plan${homework.length===1?"":"s"}` : "Progress · files"}
                    />
                  )}
                  {feat.rewards && referralCode && (
                    <QuickLinkTile
                      onClick={()=>setShowReferModal(true)}
                      testid="portal-refer-friend"
                      icon="fa-gift"
                      color="#f97316"
                      title="Refer a Friend"
                      subtitle="Earn a free daycare day"
                    />
                  )}
                  {dogs.length > 0 && (
                    <QuickLinkTile
                      onClick={()=>setShowRecurringModal(true)}
                      testid="portal-open-recurring-btn"
                      icon="fa-rotate"
                      color="#00a9e0"
                      title="My Schedules"
                      subtitle="Recurring · M/W/F"
                    />
                  )}
                  {pubSettings?.client_portal_links?.website_url && (
                    <QuickLinkTile
                      href={pubSettings.client_portal_links.website_url}
                      testid="portal-link-website"
                      icon="fa-globe"
                      color="#06b6d4"
                      title="Our Website"
                      subtitle="Visit ↗"
                      external
                    />
                  )}
                  {(client?.photo_gallery_url || pubSettings?.client_portal_links?.photo_gallery_url) && (
                    <QuickLinkTile
                      href={client?.photo_gallery_url || pubSettings.client_portal_links.photo_gallery_url}
                      testid="portal-link-gallery"
                      icon="fa-camera-retro"
                      color={client?.photo_gallery_has_new ? "#f97316" : "#8cc63f"}
                      title="Photo Gallery"
                      subtitle={client?.photo_gallery_has_new ? "✨ New photos!" : "Order prints ↗"}
                      external
                      pulse={!!client?.photo_gallery_has_new}
                      onExtClick={() => {
                        if (client?.photo_gallery_has_new) {
                          api.post("/portal/gallery/mark-seen").catch(() => {});
                          setClient((c) => c ? { ...c, photo_gallery_has_new: false } : c);
                        }
                      }}
                      badge={client?.photo_gallery_has_new ? "NEW" : null}
                    />
                  )}
                </div>
                {/* Gallery pin (if present, render below tiles in compact form) */}
                {(client?.photo_gallery_url || pubSettings?.client_portal_links?.photo_gallery_url) && client?.photo_gallery_pin && (
                  <div className="mt-2.5">
                    <GalleryPinRow pin={client?.photo_gallery_pin} accent={client?.photo_gallery_has_new ? "orange" : "green"} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sprint 110di-29 — Payment Options card. Self-hides when admin
              hasn't enabled any methods. Booking is NEVER gated on payment;
              this just tells the client HOW they can pay if they want to. */}
          <PaymentOptionsCard />

          {/* Sprint 110di-33 — Need Help? feedback card. Gated by the
              client_portal_controls.sections.help_button toggle. */}
          {sectionOn("help_button") && <NeedHelpCard />}
          </div>

        </div>

        <div className="col-span-2 space-y-6">
          {/* Training UI Phase 3 — Client Today, promoted to the top of the
              main column so active practice is never buried behind "More"
              (the brief's core complaint about the previous layout). Reads
              the SAME `dogs`/`homework`/`bookings` state already loaded by
              loadAll() below — no second fetch, so an assignment can never
              be represented twice. */}
          {feat.homework && (
            <ClientTodayPanel dogs={dogs} homework={homework} bookings={bookings} onOpenPractice={setPracticeFor} testid="client-today-panel"/>
          )}

          {/* Sit Happens School — promoted to the full-width hero card
              ABOVE the grid (see OnlineSchoolHeroCard); the slim teaser that
              lived here was too easy to overlook for a primary paid feature. */}

          {/* Focused Client Usability phase — Homework streak + Payment
              plans are secondary; tucked behind "More". Required intake
              forms stay OUTSIDE this wrapper (below) since they can block
              booking and must never be hidden from a client who needs to
              complete one. */}
          <div className={moreOpen ? "" : "hidden"} data-testid="portal-more-homeworkstreak-plans">
          {/* Sprint 110by — Homework completion streak tile (renders only when
              the client has logged at least one completion). Sits above the
              homework list as a quick dopamine nudge. */}
          <HomeworkStreakTile />

          {/* Sprint 110ch — Payment plans (renders only when there's at least
              one plan tied to this client). Includes sign-agreement flow. */}
          <PortalPaymentPlans />
          </div>

          {/* Sprint 110er — Phase 1.5: pending intake forms assigned by admin.
              Renders only when the client has at least one sent submission.
              Sprint 110dh-5 — Desktop-only here; a mobile copy is hoisted to
              the top of the page so "Action Needed" is the first thing the
              client sees on a phone. */}
          <div className="hidden md:block">
            <IntakePortalSection />
          </div>

          {/* Focused Client Usability phase — Homework history and Rewards
              are secondary ("Training history/Homework history"/"Rewards"
              per spec); tucked behind "More". My Dogs (below, outside this
              wrapper) stays prominent. */}
          <div className={moreOpen ? "" : "hidden"} data-testid="portal-more-homework-rewards">
          {/* Training UI Phase 3 — the verbose per-assignment card list that
              used to live here (Sprint 110n) was replaced by the prominent
              ClientTodayPanel above, which covers the exact same `homework`
              data with better presentation. Kept ONLY here in "More" is a
              legacy quick-link scroll target (below) pointing back at
              client-today-panel, so the "Training Files & Homework" tile
              still resolves to something visible. */}

          {/* Training-school expansion (Phase 6) — client learning
              experience: Learn (curriculum) and Progress, each a
              self-contained read-only view fed by the same enrollment/
              goal_progress data every staff view already reads. Both
              render nothing if the client has no dog with an active
              enrollment, so this is a no-op for daycare/boarding-only
              clients. */}
          <PortalLearn homework={homework}/>
          <PortalProgress homework={homework}/>

          {sectionOn("trivia_rewards") && feat.rewards && (trophies.client_trophies.length > 0 || trophies.dog_trophies.length > 0) && (
            <div data-testid="portal-trophies-section"
                 className="relative overflow-hidden bg-gradient-to-br from-shOrange/15 via-bgPanel to-shBlue/15 border border-shOrange/40 rounded-2xl p-5 shadow-2xl">
              {/* Sprint 110z — Trophy Wall gets matching brand-glow halo + eyebrow
                  + italic headline treatment so it feels celebratory. */}
              <div className="absolute inset-0 pointer-events-none opacity-30"
                   style={{ background: "radial-gradient(circle at 0% 0%, rgba(242,101,34,0.5) 0%, transparent 45%), radial-gradient(circle at 100% 100%, rgba(0,169,224,0.4) 0%, transparent 50%)" }}/>
              <div className="relative">
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange mb-1">
                  <i className="fas fa-trophy mr-1.5"/>{trophies.client_trophies.length + trophies.dog_trophies.length} earned
                </p>
                <h2 className="text-2xl font-black text-white uppercase italic tracking-tight mb-4">
                  Trophy Wall.
                </h2>
                {trophies.client_trophies.length > 0 && (
                  <div className="mb-5">
                    <div className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen mb-2"><i className="fas fa-user mr-1.5"/>Yours</div>
                    <TrophyWall awards={trophies.client_trophies} testIdPrefix="portal-client-trophies"/>
                  </div>
                )}
                {trophies.dog_trophies.length > 0 && dogs.map(d => {
                  const mine = trophies.dog_trophies.filter(t => t.recipient_id === d.id);
                  if (!mine.length) return null;
                  return (
                    <div key={d.id} className="mb-4 last:mb-0">
                      <div className="text-[12px] font-black uppercase tracking-[0.3em] text-shBlue mb-2"><i className="fas fa-paw mr-1.5"/>{d.name}'s trophies</div>
                      <TrophyWall awards={mine} testIdPrefix={`portal-dog-trophies-${d.id}`}/>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {feat.homework && <HomeworkIncentivesPanel />}
          </div>

          <div id="portal-dogs-anchor">
            {/* Sprint 110y — My Dogs section header gets the eyebrow + italic
                headline treatment matching the rest of the polished portal. */}
            <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-1">
                  <i className="fas fa-paw mr-1.5"/>The real stars
                </p>
                <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">My Dogs</h2>
              </div>
              <button onClick={()=>setDogModal({open:true, dog:null})} data-testid="portal-add-dog"
                      className="bg-shGreen text-bgHeader px-4 py-2.5 rounded-lg font-black text-[13px] uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition">
                <i className="fas fa-plus mr-1.5"/>Add a Dog
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
                // Sprint 110di-fix — split "must upload now" from "heads up
                // expiring soon" so the alert badge no longer lies after a
                // client uploads a fresh cert that happens to be < 30 days
                // from today.
                const needsUpload = ["rabies", "bordetella", "dhpp"].filter(v => {
                  const exp = d.vaccines?.[v];
                  return !exp || exp < today;
                });
                const expiringSoon = ["rabies", "bordetella", "dhpp"].filter(v => {
                  const exp = d.vaccines?.[v];
                  return exp && exp >= today && exp < soonStr;
                });
                // Sprint 110dh-8 — dog card status badge derived from existing
                // data only (no schema changes). Priority: expired > missing >
                // missing-info > complete.
                const reallyExpired = ["rabies", "bordetella", "dhpp"].filter(v => {
                  const exp = d.vaccines?.[v]; return exp && exp < today;
                });
                const reallyMissing = ["rabies", "bordetella", "dhpp"].filter(v => !d.vaccines?.[v]);
                const missingDogInfo = !((d.name || "").trim() && (d.breed || "").trim() &&
                                          ((d.birthday || "").trim() || d.age_y || d.age_m));
                let cardBadge;
                if (reallyExpired.length > 0) {
                  cardBadge = { label: "Expired records", cls: "bg-red-500/15 text-red-300 border-red-500/40", icon: "fa-circle-xmark" };
                } else if (reallyMissing.length > 0) {
                  cardBadge = { label: "Needs vaccines", cls: "bg-shOrange/15 text-shOrange border-shOrange/40", icon: "fa-shield-virus" };
                } else if (missingDogInfo) {
                  cardBadge = { label: "Missing info", cls: "bg-shBlue/15 text-shBlue border-shBlue/40", icon: "fa-circle-info" };
                } else {
                  cardBadge = { label: "Complete", cls: "bg-shGreen/15 text-shGreen border-shGreen/40", icon: "fa-circle-check" };
                }
                return (
                <div key={d.id}
                     className="relative bg-gradient-to-br from-bgPanel via-bgPanel to-shGreen/10 rounded-2xl border border-bgHover hover:border-shGreen/50 overflow-hidden shadow-2xl transition-all hover:-translate-y-0.5"
                     data-testid={`portal-dog-${d.id}`}>
                  {/* Sprint 110z — dog cards get the gradient + glow treatment.
                      Each card has a soft shGreen halo from the top-right and
                      lifts on hover, matching the rest of the portal polish. */}
                  <div className="absolute inset-0 pointer-events-none opacity-25"
                       style={{ background: "radial-gradient(circle at 100% 0%, rgba(140,198,63,0.45) 0%, transparent 55%)" }}/>
                  <span className={`absolute top-3 left-3 z-10 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${cardBadge.cls}`}
                        data-testid={`dog-card-badge-${d.id}`}>
                    <i className={`fas ${cardBadge.icon} mr-1`}/>{cardBadge.label}
                  </span>
                  <button onClick={()=>setDogModal({open:true, dog:d})}
                          className="relative block w-full text-left group">
                    <div className="h-36 w-full bg-bgBase overflow-hidden">
                      <HuskyDogImage
                        src={d.photo}
                        name={d.name}
                        alt={d.name}
                        className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    </div>
                    <div className="p-4 relative">
                      <div className="flex items-center justify-between gap-2">
                        {/* Sprint 110di-6 — pr-1 + min-w-0 stops italic glyph
                            slant from getting clipped by `truncate` overflow
                            on short dog names like "DD" / "SDF". */}
                        <h4 className="min-w-0 flex-1 pr-1 text-lg font-black text-white uppercase italic tracking-tight truncate">{d.name}</h4>
                        <i className="fas fa-pen text-gray-600 group-hover:text-shGreen text-[14px] transition shrink-0"/>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="min-w-0 flex-1 pr-1 text-[12px] text-shBlue font-black uppercase tracking-widest truncate">{d.breed || "Unknown breed"}</p>
                        {visits > 0 && (
                          <span className="shrink-0 bg-shGreen/20 text-shGreen text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-shGreen/30" data-testid={`visit-badge-${d.id}`}>
                            <i className="fas fa-trophy mr-1"/>{visits}{visits >= 100 ? "+" : ""} {visits === 1 ? "visit" : "visits"}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-gray-400 mt-2"><i className="fas fa-shield-virus text-shBlue mr-1"/>Rabies: <span className={d.vaccines?.rabies && d.vaccines.rabies>=today?"text-shGreen font-black":"text-red-400 font-black"}>{d.vaccines?.rabies||"Missing"}</span></p>
                    </div>
                  </button>
                  {needsUpload.length > 0 && (
                    <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2 flex items-center justify-between gap-2" data-testid={`vaccine-alert-${d.id}`}>
                      <p className="text-[12px] sm:text-[13px] text-red-300 font-black uppercase tracking-widest min-w-0 truncate">
                        <i className="fas fa-shield-virus mr-1"/>{needsUpload.length} record{needsUpload.length > 1 ? "s" : ""} needed
                      </p>
                      <button onClick={()=>setVaccineQuick({ initialDogId: d.id })}
                              data-testid={`vaccine-upload-btn-${d.id}`}
                              className="shrink-0 text-[12px] sm:text-[13px] font-black uppercase tracking-widest text-shGreen hover:underline whitespace-nowrap">
                        Upload Vaccines <i className="fas fa-arrow-right ml-1"/>
                      </button>
                    </div>
                  )}
                  {needsUpload.length === 0 && expiringSoon.length > 0 && (
                    <div className="border-t border-shOrange/30 bg-shOrange/10 px-4 py-2 flex items-center justify-between gap-2" data-testid={`vaccine-soon-${d.id}`}>
                      <p className="text-[12px] sm:text-[13px] text-shOrange font-black uppercase tracking-widest min-w-0 truncate">
                        <i className="fas fa-hourglass-half mr-1"/>{expiringSoon.length} expiring soon
                      </p>
                      <button onClick={()=>setVaccineQuick({ initialDogId: d.id })}
                              data-testid={`vaccine-renew-btn-${d.id}`}
                              className="shrink-0 text-[12px] sm:text-[13px] font-black uppercase tracking-widest text-shGreen hover:underline whitespace-nowrap">
                        Renew Now <i className="fas fa-arrow-right ml-1"/>
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

          {/* Focused Client Usability phase — Training history and Files are
              secondary; tucked behind "More". My Bookings (below, outside
              this wrapper) stays prominent. */}
          <div className={moreOpen ? "" : "hidden"} data-testid="portal-more-training-files">
          {dogs.length > 0 && (
            <div id="portal-training-anchor" data-testid="portal-training-section">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4"><i className="fas fa-medal text-shGreen mr-2"/>Training Progress</h2>
              <div className="space-y-4">
                {dogs.map(d => <PortalTrainingCard key={d.id} dog={d} />)}
              </div>
            </div>
          )}

          <div id="portal-files-anchor">
            <PortalFilesSection dogs={dogs} />
          </div>
          </div>

          <div id="portal-bookings-anchor">
            {/* Sprint 110di-18 — booking history list gated. Empty-state copy
                respects the admin's client_portal_controls.empty_states. */}
            {bookings.length === 0 && dogs.length > 0 && !waiverNeeded && (() => {
              // Sprint 110di-4 — admin-editable "What to expect" block.
              // Driven by settings.portal_first_visit (with safe defaults).
              const fv = pubSettings?.portal_first_visit || {};
              if (fv.enabled === false) return null;
              const heading = fv.heading || "What to expect on your first visit";
              const bullets = Array.isArray(fv.bullets) && fv.bullets.length > 0 ? fv.bullets : [
                { title: "Pack the basics", body: "leash, any meds, and your dog's regular food if boarding overnight." },
                { title: "Drop off between 7–10am", body: "(or your scheduled time). We'll do a quick intake at the front desk." },
                { title: "You'll get a Pup Report Card", body: "by end of day — photos, mood, and a note about how the day went." },
              ];
              const footer = (typeof fv.footer === "string") ? fv.footer : "Questions? Text us anytime — we love new pups.";
              return (
                <div className="bg-shGreen/10 border border-shGreen/30 rounded-xl p-5 mb-4" data-testid="first-time-tutorial">
                  <p className="text-[12px] font-black uppercase tracking-widest text-shGreen mb-2">
                    <i className="fas fa-paw mr-1"/>{heading}
                  </p>
                  <ol className="space-y-2 text-[14px] text-gray-300 list-decimal list-inside">
                    {bullets.map((b, i) => (
                      <li key={i}>
                        {b.title && <span className="font-black text-white">{b.title}{b.body ? ":" : ""} </span>}
                        {b.body}
                      </li>
                    ))}
                  </ol>
                  {footer && <p className="text-[12px] text-gray-500 mt-3 italic">{footer}</p>}
                </div>
              );
            })()}
            {/* Sprint 110z — My Bookings header gets matching eyebrow + italic
                headline so it aligns with rest of polished portal. */}
            <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange mb-1">
                  <i className="fas fa-calendar-day mr-1.5"/>{bookings.length} on file
                </p>
                <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">My Bookings.</h2>
              </div>
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
                  <div className="flex bg-bgPanel border border-bgHover rounded-lg p-1 text-[12px] sm:text-[14px] font-black uppercase tracking-widest" data-testid="bookings-tabs">
                    {[
                      { key: "upcoming", label: "Upcoming", color: "shGreen" },
                      { key: "past",     label: "Past",     color: "shBlue"  },
                      { key: "all",      label: "All",      color: "white"   },
                    ].filter(t => t.key !== "past" || sectionOn("booking_history")).map(t => {
                      const active = bookingsTab === t.key;
                      return (
                        <button key={t.key}
                                onClick={()=>{ setBookingsTab(t.key); if (t.key !== "all") setBookingsMonth(""); }}
                                data-testid={`bookings-tab-${t.key}`}
                                className={`px-2 sm:px-3 py-1.5 rounded transition flex items-center gap-1 sm:gap-1.5 ${active ? "bg-bgBase text-white" : "text-gray-500 hover:text-white"}`}>
                          <span>{t.label}</span>
                          <span className={`text-[10px] sm:text-[12px] px-1 sm:px-1.5 py-0.5 rounded ${active ? "bg-shGreen/20 text-shGreen" : "bg-bgHover text-gray-400"}`}>{counts[t.key]}</span>
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
                              : (bookingsTab === "past" && sectionOn("booking_history")) ? bookings.filter(b => isPast(b))
                              : bookingsTab === "past" ? []
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
                      {bookingsTab === "upcoming" ? (cpc.empty_states?.no_bookings || "No upcoming bookings — book a service above.") : bookingsTab === "past" ? (cpc.empty_states?.no_bookings || "No past bookings yet.") : bookingsMonth ? "No bookings that month." : (cpc.empty_states?.no_bookings || "No bookings yet.")}
                    </div>
                  </>
                );
              }
              return (
                <>
                  {monthDropdown}
                  <div className="space-y-3" data-testid="portal-bookings">
                    {sorted.map(b => (
                <div key={b.id}
                     className={`relative overflow-hidden rounded-2xl border shadow-xl transition-all hover:-translate-y-0.5 ${
                       b.status === "approved"  ? "bg-gradient-to-br from-shGreen/15 via-bgPanel to-bgPanel border-shGreen/40"
                       : b.status === "pending" ? "bg-gradient-to-br from-shOrange/15 via-bgPanel to-bgPanel border-shOrange/40"
                       : b.status === "rejected" ? "bg-gradient-to-br from-red-500/10 via-bgPanel to-bgPanel border-red-500/30"
                       : b.status === "completed" ? "bg-gradient-to-br from-shBlue/15 via-bgPanel to-bgPanel border-shBlue/40"
                       : "bg-bgPanel border-bgHover"
                     }`}>
                  {/* Sprint 110z — booking cards get gradient + per-status
                      glow halo so the list reads "this is approved / pending /
                      completed" at a glance without needing to find the
                      status pill. */}
                  <div className="absolute inset-0 pointer-events-none opacity-25"
                       style={{ background: b.status === "approved"
                         ? "radial-gradient(circle at 100% 0%, rgba(140,198,63,0.45) 0%, transparent 50%)"
                         : b.status === "pending"
                         ? "radial-gradient(circle at 100% 0%, rgba(242,101,34,0.45) 0%, transparent 50%)"
                         : b.status === "completed"
                         ? "radial-gradient(circle at 100% 0%, rgba(0,169,224,0.4) 0%, transparent 50%)"
                         : "transparent" }}/>
                  <div className="relative flex items-center justify-between p-4 gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-black text-white uppercase italic tracking-tight">{b.dog_name}</p>
                      <p className="text-[12px] text-gray-400 font-black uppercase tracking-widest mt-1">{b.service_type} · {b.date}{b.end_date && b.end_date!==b.date?` → ${b.end_date}`:""}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                      <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded border ${b.status==="approved"?"bg-shGreen/15 text-shGreen border-shGreen/40":b.status==="pending"?"bg-shOrange/15 text-shOrange border-shOrange/40":b.status==="rejected"?"bg-red-500/15 text-red-400 border-red-500/40":b.status==="completed"?"bg-shBlue/15 text-shBlue border-shBlue/40":"bg-gray-500/15 text-gray-400 border-bgHover"}`}>{bookingStatusLabel(b.status)}</span>
                      {(b.status==="pending"||b.status==="approved") && <button onClick={()=>cancel(b.id)} className="text-[12px] font-black uppercase text-red-400 hover:text-red-300 tracking-widest px-2 py-1 rounded border border-red-500/30 hover:border-red-500/60 transition">Cancel</button>}
                      {/* Sprint 110cf — prepaid program sessions get a Reschedule Request button */}
                      {b.status==="approved" && b.is_prepaid_program_session && !isPast(b) && (
                        <button onClick={()=>setRescheduleFor(b)}
                                data-testid={`request-reschedule-${b.id}`}
                                className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:text-white px-2 py-1 rounded border border-shBlue/40 hover:bg-shBlue/15 transition">
                          <i className="fas fa-calendar-pen mr-1"/>Reschedule
                        </button>
                      )}
                      {["completed","cancelled","rejected"].includes(b.status) && (
                        <button onClick={()=>{
                                  setRebookSeed({ dog_id: b.dog_id, service_type: b.service_type, service_id: b.service_id || "" });
                                  openBookingIfReady();
                                  document.getElementById("portal-book-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                }}
                                data-testid={`book-again-${b.id}`}
                                className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:text-white px-2 py-1 rounded border border-shBlue/40 hover:bg-shBlue/15 transition">
                          <i className="fas fa-rotate-right mr-1"/>Book Again
                        </button>
                      )}
                    </div>
                  </div>
                  {b.report_card && (
                    <div className="border-t border-shPrimary/20 bg-shPrimary/5 p-4" data-testid={`report-card-${b.id}`}>
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
                      {/* Sprint 110co — staff floor actions surfaced inline. */}
                      <CareLogStrip feedings={b.feeding_log} medications={b.medication_log} bathroom={b.bathroom_log} />
                    </div>
                  )}
                  {/* Sprint 110co — Care log shows even WITHOUT a formal
                      report card. Clients want this transparency for every
                      visit, especially boarding. */}
                  {!b.report_card && ((b.feeding_log?.length || 0) + (b.medication_log?.length || 0) + ((b.bathroom_log?.pee || 0) + (b.bathroom_log?.poop || 0)) > 0) && (
                    <div className="border-t border-bgHover/50 p-4">
                      <CareLogStrip feedings={b.feeding_log} medications={b.medication_log} bathroom={b.bathroom_log} />
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

        <ClientMobileNav
          shopCartCount={shopCartCount}
          showPhotography={feat.photography}
          showHelp={sectionOn("help_button")}
          onHome={goHome} onBook={goBook} onShop={goShop} onPhotography={goPhotography}
          onMyDogs={goMyDogs} onPayments={goPayments} onCredits={goCredits} onRewards={goRewards} onRefer={goRefer} onHelp={goHelp}
        />
      </div>

      {showWaiver && pubSettings?.waiver_text && (
        <WaiverModal
          waiverText={pubSettings.waiver_text}
          version={pubSettings.waiver_version || 1}
          dogNames={dogs.map(d=>d.name).join(", ")}
          onSigned={async ()=>{
            setShowWaiver(false);
            await loadAll();
            bumpSetupRefresh();
            setWaiverSuccess({ signedAt: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
          }}
          onClose={()=>setShowWaiver(false)}
          allowClose={waiver?.signed && !waiver?.needs_resign}
        />
      )}

      {showBookWizard && readyToBook && (
        <PortalBookWizard
          dogs={dogs}
          seed={rebookSeed}
          onClose={()=>{ setShowBookWizard(false); setRebookSeed(null); }}
          onBooked={(info)=>{
            // Sprint 110di-29 — when the wizard wants to keep itself open on
            // the acknowledgement step (step 4 with payment options), don't
            // tear it down here. The wizard's own "Done" button calls
            // onClose when the client is ready.
            loadAll();
            setSuccess("Booking submitted!");
            setTimeout(()=>setSuccess(""), 4000);
            if (!info?.keepOpen) {
              setShowBookWizard(false);
              setRebookSeed(null);
            }
          }} />
      )}

      {rescheduleFor && (
        <RescheduleRequestModal
          booking={rescheduleFor}
          onClose={()=>setRescheduleFor(null)}
          onSubmitted={()=>{
            setRescheduleFor(null);
            loadAll();
            setSuccess("Reschedule request sent — we'll confirm shortly!");
            setTimeout(()=>setSuccess(""), 4500);
          }}
        />
      )}

      {practiceFor && (
        <PracticePanel homework={practiceFor} dogPhoto={dogs.find(d => d.id === practiceFor.dog_id)?.photo}
                       onClose={() => setPracticeFor(null)} onChanged={loadAll}/>
      )}
      {lightbox.open && (
        <Lightbox photos={lightbox.photos} index={lightbox.index}
                  onClose={()=>setLightbox({ open: false, photos: [], index: 0 })}
                  onIndex={(i)=>setLightbox(l => ({ ...l, index: i }))} />
      )}
      {dogModal.open && (
        <PortalDogModal dog={dogModal.dog}
                        onClose={()=>setDogModal({open:false, dog:null})}
                        onSaved={async () => { await loadAll(); bumpSetupRefresh(); }}
                        onUploadVaccines={(dog) => { setDogModal({open:false, dog:null}); setVaccineQuick({ initialDogId: dog.id }); }} />
      )}
      {profileOpen && client && (
        <PortalProfileModal client={client}
                            onClose={()=>setProfileOpen(false)}
                            onSaved={async () => { await loadAll(); bumpSetupRefresh(); }} />
      )}
      {tutorialsOpen && (
        <div className="fixed inset-0 z-[9999] bg-[var(--sh-card-base)] overflow-y-auto" data-testid="portal-tutorials-overlay">
          <header className="sticky top-0 bg-[var(--sh-card-base)] border-b border-shBorder h-16 flex items-center justify-between px-6 z-10">
            <div className="flex items-center gap-3">
              <i className="fas fa-circle-question text-shSecondary text-lg"/>
              <span className="text-shText font-black uppercase tracking-widest text-[14px]">How to Use Sit Happens</span>
            </div>
            <button onClick={()=>setTutorialsOpen(false)} data-testid="portal-tutorials-close"
                    className="text-shTextMuted hover:text-shText text-lg p-2"><i className="fas fa-times"/></button>
          </header>
          <div className="p-6 max-w-6xl mx-auto">
            <Tutorials role="client" />
          </div>
        </div>
      )}

      {feat.client_messaging && (
        <PortalMessages
          dogs={dogs}
          open={messagesOpen}
          onClose={() => setMessagesOpen(false)}
          onUnreadChange={setMessagesUnread}
        />
      )}

      {showReferModal && referralCode && <ReferFriendModal code={referralCode} onClose={()=>setShowReferModal(false)} />}
      {showServicesModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur grid place-items-center p-3 sm:p-6 animate-fade-in" onClick={()=>setShowServicesModal(false)} data-testid="services-modal">
          <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-5xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto shadow-2xl animate-slide-in">
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
      {vaccineModal && (
        <VaccineUploadModal dog={vaccineModal.dog} vaccine={vaccineModal.vaccine}
          onClose={()=>setVaccineModal(null)}
          onSaved={async()=>{
            const dogName = vaccineModal.dog?.name || "your dog";
            setVaccineModal(null);
            await loadAll(); bumpSetupRefresh();
            setReviewConfirm({ dogName, plural: false });
          }} />
      )}

      {vaccineQuick && (
        <VaccineQuickUploadModal
          dogs={dogs}
          initialDogId={vaccineQuick.initialDogId}
          onClose={()=>setVaccineQuick(null)}
          onSaved={async()=>{
            const dogName = dogs.find(d => d.id === vaccineQuick.initialDogId)?.name || "your dog";
            setVaccineQuick(null);
            await loadAll(); bumpSetupRefresh();
            setReviewConfirm({ dogName, plural: true });
          }}
        />
      )}

      {reviewConfirm && (
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
             data-testid="review-confirm-modal" onClick={()=>setReviewConfirm(null)}>
          <div onClick={(e)=>e.stopPropagation()}
               className="bg-bgPanel border border-shGreen/40 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in">
            <div className="text-center">
              <span className="inline-flex w-14 h-14 rounded-full bg-shGreen/15 text-shGreen items-center justify-center text-2xl mb-3">
                <i className="fas fa-circle-check"/>
              </span>
              <h4 className="text-lg font-black text-white uppercase italic tracking-tight mb-1">
                Upload Received!
              </h4>
              <p className="text-[13px] text-shOrange font-black uppercase tracking-widest mb-4">
                This is NOT approved yet
              </p>
            </div>
            <div className="space-y-2.5 mb-5">
              <div className="flex items-start gap-3 bg-bgBase/60 border border-bgHover rounded-lg p-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-shGreen/20 text-shGreen font-black text-[12px] flex items-center justify-center">1</span>
                <p className="text-[13px] text-gray-200 leading-snug">We got {reviewConfirm.dogName || "your dog"}'s new vaccine {reviewConfirm.plural ? "records" : "record"}.</p>
              </div>
              <div className="flex items-start gap-3 bg-bgBase/60 border border-bgHover rounded-lg p-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-shGreen/20 text-shGreen font-black text-[12px] flex items-center justify-center">2</span>
                <p className="text-[13px] text-gray-200 leading-snug">Our staff will look at what you uploaded.</p>
              </div>
              <div className="flex items-start gap-3 bg-bgBase/60 border border-bgHover rounded-lg p-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-shGreen/20 text-shGreen font-black text-[12px] flex items-center justify-center">3</span>
                <p className="text-[13px] text-gray-200 leading-snug">We will either <span className="text-shGreen font-black">APPROVE</span> it or <span className="text-red-400 font-black">DECLINE</span> it — this takes a little time, it is not instant.</p>
              </div>
              <div className="flex items-start gap-3 bg-bgBase/60 border border-bgHover rounded-lg p-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-shGreen/20 text-shGreen font-black text-[12px] flex items-center justify-center">4</span>
                <p className="text-[13px] text-gray-200 leading-snug">Booking stays <span className="font-black">locked</span> until this is approved.</p>
              </div>
              <div className="flex items-start gap-3 bg-bgBase/60 border border-bgHover rounded-lg p-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-shGreen/20 text-shGreen font-black text-[12px] flex items-center justify-center">5</span>
                <p className="text-[13px] text-gray-200 leading-snug">Come back and check this page later to see if it was approved.</p>
              </div>
            </div>
            <button onClick={()=>setReviewConfirm(null)} data-testid="review-confirm-close"
                    className="w-full bg-shGreen text-bgHeader py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl">
              Got it
            </button>
          </div>
        </div>
      )}

      {vaccineWizard && vaccineWizard.length > 0 && (
        <VaccineUploadWizard
          queue={vaccineWizard}
          onProgress={() => { bumpSetupRefresh(); loadAll(); }}
          onAllDone={() => { bumpSetupRefresh(); loadAll(); }}
          onClose={() => setVaccineWizard(null)} />
      )}
      {showRecurringModal && <MyRecurringModal dogs={dogs} onClose={()=>setShowRecurringModal(false)} />}
      {false && onboardingNeeded && !onboardingDismissed && (
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

function OnboardingChecklistPlaceholder() { return null; }  // (legacy slot — onboarding UI moved to PortalSetupChecklist)


/**
 * Sprint 110di-14 — Shared credit metric tile used by the portal credits
 * card (Daycare / Training / Boarding). One component, identical layout,
 * identical sizing — only the icon / label / value / unit / color change.
 *
 * Layout: flex column, items-center + justify-center, equal padding, equal
 * height (h-full inside an items-stretch grid). Verified at <400px width:
 * label sits on a single line because the parent grid is grid-cols-3 with
 * tight gap-2, and we use uppercase tracking-widest at text-[11px].
 */
function CreditMetricCard({ icon, label, value, unit, color, haloRgba, dropShadow, testid }) {
  // Tailwind can't JIT class names from a runtime string for arbitrary
  // brand colors (shGreen / shOrange / purple-400), so we whitelist the
  // border + text variants we actually use. Keeping the color="brand" API
  // on the call-site clean while guaranteeing the classes ship in the bundle.
  const borderCls = {
    shGreen:      "border-shGreen/20",
    shOrange:     "border-shOrange/20",
    "purple-400": "border-purple-500/20",
  }[color] || "border-bgHover";
  const textCls = {
    shGreen:      "text-shGreen",
    shOrange:     "text-shOrange",
    "purple-400": "text-purple-400",
  }[color] || "text-white";
  return (
    <div
      data-testid={testid}
      className={`relative bg-bgBase rounded-lg p-3 border ${borderCls} h-full flex flex-col items-center justify-center text-center`}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-20 rounded-lg"
        style={{ background: `radial-gradient(circle, ${haloRgba} 0%, transparent 65%)` }}
      />
      <div className="relative flex flex-col items-center justify-center gap-1 w-full">
        <i className={`fas ${icon} ${textCls} text-sm`} />
        <p className="text-[11px] text-gray-400 font-black uppercase tracking-widest text-center leading-tight">
          {label}
        </p>
        <p
          className={`text-3xl font-black ${textCls} leading-none`}
          style={{ filter: `drop-shadow(${dropShadow})` }}
        >
          {value}
        </p>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest text-center leading-tight">
          {unit}
        </p>
      </div>
    </div>
  );
}


/**
 * Sprint 110y — Compact gradient tile for the portal Quick Links overhaul.
 *
 * Replaces the old full-width text rows with vivid, brand-colored 2-column
 * tile cards (mirrors the landing-page "What we do" category tiles). Each
 * tile gets its own accent color, an icon halo, and a hover lift.
 *
 * Renders as a <button> when `onClick` is provided, or an <a> when `href`
 * is provided. Either gets the same visual treatment.
 */
function QuickLinkTile({
  onClick, href, external = false, onExtClick,
  testid, icon, color, title, subtitle,
  badge = null, pulse = false,
}) {
  const cls = `group relative overflow-hidden bg-bgBase hover:bg-bgPanel border rounded-xl p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg flex flex-col items-start gap-2 ${
    pulse ? "border-shOrange/60 shadow-[0_0_18px_-6px_rgba(255,138,0,0.6)]" : "border-bgHover hover:border-white/20"
  }`;
  const halo = (
    <div className="absolute inset-0 pointer-events-none opacity-20"
         style={{ background: `radial-gradient(circle at 100% 0%, ${color} 0%, transparent 65%)` }}/>
  );
  const body = (
    <>
      {halo}
      {badge && (
        <span className="absolute top-1.5 right-1.5 text-[10px] font-black uppercase tracking-widest text-bgHeader px-1.5 py-0.5 rounded animate-pulse z-10"
              style={{ background: color }}>
          {badge}
        </span>
      )}
      <div className="relative w-10 h-10 rounded-lg grid place-items-center shrink-0"
           style={{ backgroundColor: `${color}22`, color }}>
        <i className={`fas ${icon} text-xl`}/>
      </div>
      <div className="relative min-w-0 w-full">
        <div className="text-[12px] font-black text-white uppercase tracking-wide leading-tight">{title}</div>
        <p className="text-[11px] text-gray-400 normal-case tracking-normal mt-0.5 leading-snug">{subtitle}</p>
      </div>
      <i className="relative fas fa-arrow-right text-[10px] absolute bottom-2 right-2 group-hover:translate-x-0.5 transition opacity-50 group-hover:opacity-100"
         style={{ color }}/>
    </>
  );
  if (href) {
    return (
      <a href={href} target={external ? "_blank" : "_self"} rel={external ? "noopener noreferrer" : undefined}
         data-testid={testid} className={cls} onClick={onExtClick}>
        {body}
      </a>
    );
  }
  return (
    <button onClick={onClick} data-testid={testid} className={cls}>{body}</button>
  );
}

