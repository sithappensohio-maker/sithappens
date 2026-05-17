import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import WaiverModal from "../components/WaiverModal";
import Lightbox from "../components/Lightbox";
import PortalDogModal from "../components/PortalDogModal";
import PortalProfileModal from "../components/PortalProfileModal";
import PortalTrainingCard from "../components/PortalTrainingCard";
import HomeworkSectionLogger from "../components/HomeworkSectionLogger";
import MultiDateCalendar from "../components/MultiDateCalendar";
import InstallAppButton from "../components/InstallAppButton";
import TrophyWall from "../components/TrophyWall";
import TrophyCelebration from "../components/TrophyCelebration";
import Tutorials from "./Tutorials";
import { useConfirm } from "../lib/useConfirm";
import { compressImage } from "../lib/imageCompress";

function todayISO() { return new Date().toISOString().split("T")[0]; }

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
          <p className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Your code</p>
          <p className="text-3xl font-black text-shOrange tracking-[0.3em] mt-1" data-testid="refer-code">{code}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <a href={sms} data-testid="refer-via-sms" className="bg-shGreen/10 hover:bg-shGreen/20 text-shGreen text-center py-3 rounded font-black text-[12px] uppercase tracking-widest"><i className="fas fa-comment mr-1"/>Text</a>
          <a href={email} data-testid="refer-via-email" className="bg-shBlue/10 hover:bg-shBlue/20 text-shBlue text-center py-3 rounded font-black text-[12px] uppercase tracking-widest"><i className="fas fa-envelope mr-1"/>Email</a>
          <button onClick={copy} data-testid="refer-copy" className="bg-shOrange/10 hover:bg-shOrange/20 text-shOrange text-center py-3 rounded font-black text-[12px] uppercase tracking-widest"><i className={`fas ${copied?"fa-check":"fa-copy"} mr-1`}/>{copied?"Copied":"Copy"}</button>
        </div>
        <button onClick={onClose} className="w-full bg-bgBase border border-bgHover text-gray-300 py-3 rounded font-black text-[13px] uppercase tracking-widest">Done</button>
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
        <p className="text-[13px] text-gray-400 mb-4">Snap a photo of the new vaccine certificate and enter the expiry date your vet wrote on it.</p>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-gray-400 font-black uppercase tracking-widest">New expiry date</label>
            <input type="date" value={expiresOn} onChange={(e)=>setExpiresOn(e.target.value)} data-testid="vaccine-expiry-input"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm" style={{colorScheme:"dark"}} />
          </div>
          <div>
            <label className="text-[12px] text-gray-400 font-black uppercase tracking-widest">Cert photo (optional but recommended)</label>
            <input type="file" accept="image/*" capture="environment" onChange={handleFile} data-testid="vaccine-photo-input"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm file:bg-shBlue file:text-white file:border-0 file:rounded file:px-3 file:py-1 file:font-black file:text-[12px] file:uppercase file:tracking-widest" />
            {photo && <img src={photo} alt="cert preview" className="mt-2 rounded max-h-40 object-contain border border-bgHover"/>}
          </div>
          {err && <p className="text-[13px] text-red-400 font-black uppercase tracking-widest">{err}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 text-gray-400 py-3 text-[13px] font-black uppercase tracking-widest">Cancel</button>
            <button onClick={save} disabled={saving || !expiresOn} data-testid="vaccine-save"
                    className="flex-1 bg-shGreen text-bgHeader py-3 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">{saving?"Saving…":"Submit Update"}</button>
          </div>
        </div>
      </div>
    </div>
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
            <li key={i} className="flex items-start gap-2 text-[13px] text-gray-300">
              <i className={`fas fa-check ${info.color} mt-1 text-[11px] shrink-0`}/>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <button onClick={onClose} className="mt-5 w-full bg-bgBase border border-bgHover text-gray-300 hover:text-white py-3 rounded font-black text-[13px] uppercase tracking-widest">Got it</button>
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

  const loadAll = useCallback(async () => {
    try {
      const [dRes, bRes, wRes, sRes, hRes] = await Promise.all([
        api.get("/dogs"),
        api.get("/bookings"),
        api.get("/waivers/me"),
        api.get("/settings/public"),
        api.get("/homework"),
      ]);
      setDogs(dRes.data);
      setBookings(bRes.data);
      setWaiver(wRes.data);
      setPubSettings(sRes.data);
      setHomework(hRes.data);
      if (dRes.data.length > 0 && !bookDogId) setBookDogId(dRes.data[0].id);
      // Only auto-open the waiver modal AFTER the user has added at least one dog
      // (otherwise the onboarding banner takes them through profile → dog → waiver in order).
      const needsSign = !wRes.data?.signed || wRes.data?.needs_resign;
      if (needsSign && sRes.data?.waiver_required_for_booking && dRes.data.length > 0) setShowWaiver(true);
      await reloadUser();
    } catch {}
  }, [bookDogId, reloadUser]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Fetch credits separately via a small endpoint - we'll use the user from useAuth but credits live on client doc.
  // Use a helper: fetch own client info via portal endpoint
  const [credits, setCredits] = useState(0);
  const [visitCounts, setVisitCounts] = useState({});
  const [referralCode, setReferralCode] = useState(null);
  const [showReferModal, setShowReferModal] = useState(false);
  const [vaccineModal, setVaccineModal] = useState(null); // { dog, vaccine }
  const [trophies, setTrophies] = useState({ client_trophies: [], dog_trophies: [], unseen: [] });
  const [celebrating, setCelebrating] = useState([]);
  const loadTrophies = useCallback(async () => {
    try {
      const { data } = await api.get("/portal/trophies");
      setTrophies(data);
      if ((data.unseen || []).length) setCelebrating(data.unseen);
    } catch {}
  }, []);
  useEffect(() => { loadTrophies(); }, [loadTrophies, bookings]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/portal/me");
        setClient(data.client); setCredits(data.client.credits);
        setVisitCounts(data.visit_counts || {});
        setReferralCode(data.referral_code || null);
      } catch {}
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
    if (!(await confirm({ title: "Cancel this booking?", body: "Any deducted credits will be refunded to your pack.", confirmText: "Cancel booking", cancelText: "Keep it", tone: "danger" }))) return;
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
  const canBook = avail && avail.vaccine_ok && avail.open_slots > 0 && !waiverNeeded;

  // Onboarding checklist — show until all complete
  const profileComplete = !!(client?.phone && client?.address);
  const hasDog = dogs.length > 0;
  const waiverDone = waiver?.signed && !waiver?.needs_resign;
  const onboardingDone = profileComplete && hasDog && waiverDone;
  const onboardingStep = !profileComplete ? 1 : !hasDog ? 2 : !waiverDone ? 3 : 4;

  return (
    <div className="h-full flex flex-col bg-bgBase" data-testid="client-portal">
      <header className="bg-bgHeader border-b border-bgHover flex items-center justify-between gap-2 px-3 sm:px-8 py-3 sm:py-0 sm:h-24">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <img src="/logo.png" alt="Sit Happens" className="h-10 sm:h-16 shrink-0" data-testid="portal-logo" />
          <div className="min-w-0">
            <p className="hidden sm:block text-[15px] text-gray-500 font-black uppercase tracking-[0.25em]">Dog Training • Daycare • Boarding</p>
            <p className="text-[11px] sm:text-xs text-shGreen font-black uppercase tracking-widest sm:mt-1 truncate">Welcome, {user.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button onClick={()=>setTutorialsOpen(true)} data-testid="portal-help-button"
                  className="text-[11px] sm:text-xs bg-shBlue/10 text-shBlue px-2.5 sm:px-4 py-2 rounded font-black uppercase tracking-widest hover:bg-shBlue/20 flex items-center gap-2">
            <i className="fas fa-circle-question"/>
            <span className="hidden sm:inline">How to Use</span>
          </button>
          <InstallAppButton
            testid="portal-install-app"
            label="Install"
            className="text-[11px] sm:text-xs bg-shGreen/10 text-shGreen px-2.5 sm:px-4 py-2 rounded font-black uppercase tracking-widest hover:bg-shGreen/20 flex items-center gap-2"
          />
          <button onClick={logout} data-testid="logout-button" className="text-[11px] sm:text-xs bg-red-500/10 text-red-400 px-2.5 sm:px-4 py-2 rounded font-black uppercase tracking-widest hover:bg-red-500/20">
            <i className="fas fa-right-from-bracket sm:hidden"/>
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 sm:p-8 max-w-6xl mx-auto w-full pb-24 md:pb-8">
        {!onboardingDone && (
          <div className="mb-4 sm:mb-6 bg-gradient-to-br from-shGreen/15 via-bgPanel to-shBlue/15 border border-shGreen/40 rounded-xl p-4 sm:p-6 shadow-2xl" data-testid="onboarding-banner">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-black text-white uppercase italic tracking-tight">Hi {user.name.split(" ")[0]}! 🐾 Welcome to Sit Happens</h3>
                <p className="text-[13px] sm:text-[14px] text-gray-300 mt-1">So glad you're here. Before booking your pup's first stay, please knock out these quick steps so we can take great care of them.</p>
              </div>
              <span className="shrink-0 bg-shGreen/20 text-shGreen text-[11px] sm:text-[13px] font-black uppercase tracking-widest px-2 sm:px-3 py-1 rounded-full">{Math.min(onboardingStep - 1, 3)} of 3</span>
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
          <div className="bg-bgPanel p-6 rounded-xl border border-bgHover shadow-2xl" data-testid="credits-card">
            <p className="text-[14px] text-gray-400 font-black uppercase tracking-widest text-center mb-4">Your Credits</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-bgBase rounded p-3">
                <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest">Daycare</p>
                <p className="text-3xl font-black text-shGreen mt-1">{credits}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">days</p>
              </div>
              <div className="bg-bgBase rounded p-3">
                <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest">Training</p>
                <p className="text-3xl font-black text-purple-400 mt-1">{client?.training_credits || 0}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">sessions</p>
              </div>
              <div className="bg-bgBase rounded p-3">
                <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest">Boarding</p>
                <p className="text-3xl font-black text-shOrange mt-1">{client?.boarding_credits || 0}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">nights</p>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest mt-3 text-center">Grooming is pay-on-the-day</p>
            <button onClick={()=>setProfileOpen(true)} data-testid="open-profile"
                    className="mt-4 w-full bg-bgBase border border-bgHover text-gray-300 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:border-shBlue hover:text-shBlue">
              <i className="fas fa-user-pen mr-2"/>My Profile
            </button>
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

          {(pubSettings?.client_portal_links?.website_url || client?.photo_gallery_url || pubSettings?.client_portal_links?.photo_gallery_url || referralCode) && (
            <div className="bg-bgPanel p-4 rounded-xl border border-bgHover shadow-lg" data-testid="portal-quick-links">
              <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-3"><i className="fas fa-bookmark text-shBlue mr-2"/>Quick Links</p>
              <div className="grid grid-cols-1 gap-2">
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
                  <a href={client?.photo_gallery_url || pubSettings.client_portal_links.photo_gallery_url} target="_blank" rel="noopener noreferrer"
                     data-testid="portal-link-gallery"
                     className="flex items-start gap-3 bg-gradient-to-br from-shGreen/15 to-shBlue/10 hover:from-shGreen/25 hover:to-shBlue/20 border border-shGreen/40 hover:border-shGreen/60 rounded-lg px-3 py-3 transition group">
                    <i className="fas fa-camera-retro text-shGreen text-2xl w-7 text-center mt-0.5"/>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[14px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                        See Your Pup In Action
                        <span className="text-[10px] font-black bg-shOrange/20 text-shOrange px-1.5 py-0.5 rounded uppercase tracking-widest">Order Prints</span>
                      </div>
                      <p className="text-[11px] text-gray-400 normal-case tracking-normal mt-0.5">Browse your private gallery & order high-quality prints</p>
                    </div>
                    <i className="fas fa-arrow-up-right-from-square text-shGreen group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition text-xs mt-1"/>
                  </a>
                )}
                {referralCode && (
                  <button onClick={()=>setShowReferModal(true)} data-testid="portal-refer-friend"
                          className="flex items-center gap-3 bg-bgBase hover:bg-shOrange/15 border border-bgHover hover:border-shOrange/50 rounded px-3 py-2.5 transition w-full text-left">
                    <i className="fas fa-gift text-shOrange text-lg w-6 text-center"/>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-black text-white uppercase tracking-widest">Refer a Friend</p>
                      <p className="text-[11px] text-gray-500 normal-case tracking-normal">Earn a free daycare day for every referral</p>
                    </div>
                    <i className="fas fa-arrow-right text-gray-500 text-xs"/>
                  </button>
                )}
              </div>
            </div>
          )}

          <div id="portal-book-section" className="bg-bgPanel p-6 rounded-xl border border-bgHover shadow-2xl">
            <h4 className="font-black text-shBlue mb-4 uppercase text-xs tracking-widest"><i className="fas fa-calendar-plus mr-2"/>Book Service</h4>

            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
            <select value={bookDogId} onChange={(e)=>setBookDogId(e.target.value)} data-testid="portal-book-dog"
                    className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Service</label>
            <div className="grid grid-cols-2 gap-2 mt-1 mb-3" data-testid="portal-service-grid">
              {["daycare","boarding","training","grooming"].map(t => (
                <div key={t} className="relative">
                  <button onClick={()=>{ setBookType(t); if(t==="boarding") setIsRecurring(false); if(t==="grooming") setIsRecurring(false); }} data-testid={`book-service-${t}`}
                          className={`w-full py-2 pr-7 rounded text-[14px] font-black uppercase tracking-widest ${bookType===t?"bg-shBlue text-white":"bg-bgBase border border-bgHover text-gray-400"}`}>{t}</button>
                  <button onClick={(e)=>{e.stopPropagation(); setShowServiceInfo(t);}} data-testid={`book-service-info-${t}`}
                          aria-label={`About ${t}`}
                          className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-[13px] ${bookType===t?"text-white hover:bg-white/15":"text-gray-500 hover:text-shBlue hover:bg-shBlue/10"}`}>
                    <i className="fas fa-circle-info"/>
                  </button>
                </div>
              ))}
            </div>

            {bookType === "grooming" && (
              <div className="mb-3" data-testid="book-grooming-types">
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Grooming Service</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {[
                    { k: "bath", label: "Bath", icon: "fa-bath" },
                    { k: "nail_trim", label: "Nail Trim", icon: "fa-scissors" },
                  ].map(g => (
                    <button key={g.k} onClick={()=>setGroomingType(g.k)} data-testid={`book-grooming-${g.k}`}
                            className={`py-3 rounded text-[14px] font-black uppercase tracking-widest border flex items-center justify-center gap-2 ${groomingType===g.k?"bg-pink-500/15 text-pink-300 border-pink-500/60":"bg-bgBase border-bgHover text-gray-400"}`}>
                      <i className={`fas ${g.icon}`}/>{g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {bookType !== "boarding" && (
              <div className="flex gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isRecurring} onChange={(e)=>{setIsRecurring(e.target.checked); if(e.target.checked) setIsMultiDate(false);}} data-testid="recurring-toggle" className="accent-shGreen" />
                  <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">Recurring (weekdays)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isMultiDate} onChange={(e)=>{setIsMultiDate(e.target.checked); if(e.target.checked) setIsRecurring(false);}} data-testid="multi-date-toggle" className="accent-shGreen" />
                  <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">Pick specific days</span>
                </label>
              </div>
            )}

            {!isMultiDate && (
              <>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">{bookType==="boarding"?"Start Date":isRecurring?"Recurrence Start":"Date"}</label>
                <input type="date" value={bookDate} onChange={(e)=>setBookDate(e.target.value)} data-testid="portal-book-date"
                       className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </>
            )}

            {bookType==="boarding" && <>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">End Date</label>
              <input type="date" value={bookEnd} onChange={(e)=>setBookEnd(e.target.value)} data-testid="portal-book-end"
                     className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
            </>}

            {isRecurring && bookType!=="boarding" && <>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Repeat Until</label>
              <input type="date" value={recEnd} onChange={(e)=>setRecEnd(e.target.value)} data-testid="rec-end"
                     className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Repeat On</label>
              <div className="grid grid-cols-7 gap-1 mt-1 mb-3">
                {["M","T","W","T","F","S","S"].map((d,i)=>(
                  <button key={i} onClick={()=>toggleRecDay(i)} data-testid={`rec-day-${i}`}
                          className={`py-2 rounded text-[14px] font-black uppercase ${recDays.includes(i)?"bg-shGreen text-bgHeader":"bg-bgBase border border-bgHover text-gray-400"}`}>{d}</button>
                ))}
              </div>
            </>}

            {isMultiDate && bookType!=="boarding" && (
              <MultiDateCalendar selected={multiDates} onToggle={toggleMultiDate} />
            )}

            {avail && (
              <div className={`text-[14px] font-black p-3 rounded uppercase text-center tracking-widest mb-3 ${!avail.vaccine_ok?"bg-red-500/20 text-red-400":avail.open_slots<=0?"bg-shOrange/20 text-shOrange":"bg-shGreen/10 text-shGreen"}`} data-testid="availability-message">
                {!avail.vaccine_ok ? "Rabies vaccine missing/expired"
                  : avail.open_slots <= 0 ? "Fully booked"
                  : `${avail.open_slots} of ${avail.capacity} slots open`}
              </div>
            )}

            {err && <div className="text-[14px] font-black p-3 rounded uppercase text-center tracking-widest mb-3 bg-red-500/15 text-red-400">{err}</div>}
            {success && <div className="text-[14px] font-black p-3 rounded uppercase text-center tracking-widest mb-3 bg-shGreen/15 text-shGreen">{success}</div>}

            <button onClick={book} disabled={!canBook} data-testid="portal-book-button"
                    className={`w-full py-3 rounded font-black uppercase text-[14px] tracking-widest shadow-lg ${canBook?"bg-shBlue text-white hover:bg-shBlue/90":"bg-bgBase text-gray-500 cursor-not-allowed border border-bgHover"}`}>
              Book Now
            </button>
          </div>
        </div>

        <div className="col-span-2 space-y-6">
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
                          <span className="shrink-0 bg-shGreen/15 text-shGreen text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" data-testid={`visit-badge-${d.id}`}>
                            <i className="fas fa-trophy mr-1"/>{visits}{visits >= 100 ? "+" : ""} {visits === 1 ? "visit" : "visits"}
                          </span>
                        )}
                      </div>
                      <p className="text-[14px] text-gray-400 mt-2">Rabies: <span className={d.vaccines?.rabies && d.vaccines.rabies>=today?"text-shGreen":"text-red-400"}>{d.vaccines?.rabies||"Missing"}</span></p>
                    </div>
                  </button>
                  {expiringVaccines.length > 0 && (
                    <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-2 flex items-center justify-between gap-2" data-testid={`vaccine-alert-${d.id}`}>
                      <p className="text-[11px] text-red-300 font-black uppercase tracking-widest min-w-0 truncate">
                        <i className="fas fa-shield-virus mr-1"/>{expiringVaccines.length} vaccine{expiringVaccines.length > 1 ? "s" : ""} need updating
                      </p>
                      <button onClick={()=>setVaccineModal({ dog: d, vaccine: expiringVaccines[0] })}
                              data-testid={`vaccine-upload-btn-${d.id}`}
                              className="shrink-0 text-[11px] font-black uppercase tracking-widest text-shGreen hover:underline">
                        Upload <i className="fas fa-arrow-right ml-1"/>
                      </button>
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

          {(trophies.client_trophies.length > 0 || trophies.dog_trophies.length > 0) && (
            <div data-testid="portal-trophies-section" className="bg-gradient-to-br from-shOrange/10 via-bgPanel to-shBlue/10 border border-shOrange/30 rounded-2xl p-5">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4 flex items-center gap-2">
                <i className="fas fa-trophy text-shOrange"/> Trophy Wall
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500 normal-case">· {trophies.client_trophies.length + trophies.dog_trophies.length} earned</span>
              </h2>
              {trophies.client_trophies.length > 0 && (
                <div className="mb-5">
                  <div className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">Yours</div>
                  <TrophyWall awards={trophies.client_trophies} testIdPrefix="portal-client-trophies"/>
                </div>
              )}
              {trophies.dog_trophies.length > 0 && dogs.map(d => {
                const mine = trophies.dog_trophies.filter(t => t.recipient_id === d.id);
                if (!mine.length) return null;
                return (
                  <div key={d.id} className="mb-4 last:mb-0">
                    <div className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">{d.name}'s trophies</div>
                    <TrophyWall awards={mine} testIdPrefix={`portal-dog-trophies-${d.id}`}/>
                  </div>
                );
              })}
            </div>
          )}

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
                          <span className="text-[14px] text-shBlue font-black uppercase tracking-widest">{h.dog_name}</span>
                          {h.due_date && <span className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Due {h.due_date}</span>}
                          {hasTemplate && <span className="text-[12px] text-shGreen font-black uppercase tracking-widest"><i className="fas fa-list-check mr-1"/>{(h.section_logs||[]).length} sessions logged</span>}
                        </div>
                        <h4 className="text-sm font-black text-white uppercase tracking-tight">{h.title}</h4>
                        {h.instructions && <p className="text-xs text-gray-300 mt-1 whitespace-pre-wrap">{h.instructions}</p>}
                        {h.video_url && <a href={h.video_url} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[14px] text-shBlue hover:underline font-black uppercase tracking-widest"><i className="fas fa-play mr-1"/>Watch demo</a>}
                      </div>
                      {h.status !== "completed" && (
                        <button onClick={()=>{setHwModal(h); setHwNote(""); setHwPhoto("");}} data-testid={`portal-complete-${h.id}`}
                                className="shrink-0 bg-shGreen text-bgHeader px-4 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shGreen/90">Mark Done</button>
                      )}
                    </div>
                    {hasTemplate && h.status !== "completed" && (
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

          <div>
            <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4">My Bookings</h2>
            <div className="space-y-3" data-testid="portal-bookings">
              {bookings.length === 0 && <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-500 uppercase font-black text-xs">No bookings yet.</div>}
              {bookings.map(b => (
                <div key={b.id} className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-black text-white uppercase tracking-tight">{b.dog_name}</p>
                      <p className="text-[14px] text-gray-400 font-black uppercase tracking-widest mt-1">{b.service_type} · {b.date}{b.end_date && b.end_date!==b.date?` → ${b.end_date}`:""}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[14px] font-black uppercase px-2 py-1 rounded ${b.status==="approved"?"bg-shGreen/15 text-shGreen":b.status==="pending"?"bg-shOrange/15 text-shOrange":b.status==="rejected"?"bg-red-500/15 text-red-400":b.status==="completed"?"bg-shBlue/15 text-shBlue":"bg-gray-500/15 text-gray-400"}`}>{b.status}</span>
                      {(b.status==="pending"||b.status==="approved") && <button onClick={()=>cancel(b.id)} className="text-[14px] font-black uppercase text-red-400 hover:underline tracking-widest">Cancel</button>}
                    </div>
                  </div>
                  {b.report_card && (
                    <div className="border-t border-bgHover/50 bg-gradient-to-br from-shGreen/5 to-shBlue/5 p-4" data-testid={`report-card-${b.id}`}>
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
                          {b.report_card.mood_tags.map(m => (
                            <span key={m} className="text-[15px] font-black uppercase tracking-widest bg-shGreen/15 text-shGreen px-2 py-1 rounded-full">{m}</span>
                          ))}
                        </div>
                      )}
                      {b.report_card.note && <p className="text-xs text-gray-300 italic">"{b.report_card.note}"</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
          onClick={()=>{ const el = document.getElementById("portal-book-section"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          data-testid="portal-sticky-book"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-shGreen text-bgHeader py-3 px-5 pb-safe flex items-center justify-center gap-2 font-black uppercase tracking-widest text-[14px] shadow-2xl border-t border-shGreen/60"
        >
          <i className="fas fa-calendar-plus"/>Book Service
        </button>
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
      {celebrating.length > 0 && (
        <TrophyCelebration awards={celebrating} onAllSeen={()=>{ setCelebrating([]); loadTrophies(); }}/>
      )}
      {vaccineModal && <VaccineUploadModal dog={vaccineModal.dog} vaccine={vaccineModal.vaccine} onClose={()=>setVaccineModal(null)} onSaved={async()=>{ setVaccineModal(null); await loadAll(); }} />}
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
              className={`w-full py-2 rounded font-black text-[13px] uppercase tracking-widest transition ${done ? "bg-shGreen/20 text-shGreen cursor-default" : disabled ? "bg-bgBase text-gray-600 cursor-not-allowed border border-bgHover" : "bg-shBlue text-white hover:bg-shBlue/90"}`}>
        {done ? "Complete" : cta}
      </button>
    </div>
  );
}
