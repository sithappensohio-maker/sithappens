import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { useTheme } from "../lib/theme";
import { toast } from "sonner";
import AdminBookingModal from "./AdminBookingModal";
import BookingDetailModal from "./BookingDetailModal";
import ReportCardModal from "./ReportCardModal";
import { CheckoutModal, CancelBookingModal } from "./CheckoutModal";
import TrainingSessionWorkspace from "./TrainingSessionWorkspace";
import HelpRequestsTile from "./HelpRequestsTile";
import { OwnerClock, EndOfDayPanel } from "./OwnerClockAndEndOfDay";
import { MileageDashTile } from "./MileageDashTile";
import { SalesTaxDueTile } from "./SalesTaxDueTile";
import { TaxCenterTile } from "./TaxCenter";
import { DogFactCard } from "./DogFactCard";
import { DailyTriviaCard } from "./DailyTriviaCard";
import AdminTrainingTipCard from "./AdminTrainingTipCard";

const DEFAULT_MOOD_TAGS = ["Playful", "Calm", "Napped Well", "Made a Friend", "Worked on Training", "Star of the Day", "Tired Pup", "Extra Hungry"];

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/**
 * Modernization Phase 1B — the operational pieces that were unique to the
 * legacy Dashboard now live directly inside Today. This component deliberately
 * does NOT recreate Dashboard summaries already owned by Today (hero, stats,
 * Today Brain, training plan, flow, register snapshot, rewards leaderboards,
 * program summaries). It only keeps real daily actions/tools.
 */
export default function TodayOperations({ stats, onReload = () => {}, onNavigate = () => {}, onJumpToDog = () => {}, can = () => false }) {
  const { branding } = useTheme();
  const widgets = branding?.dashboard_widgets || {};
  const widgetOn = (id) => widgets[id] !== false;
  const confirm = useConfirm();
  const [services, setServices] = useState([]);
  const [moodTags, setMoodTags] = useState(DEFAULT_MOOD_TAGS);
  const [pendingVax, setPendingVax] = useState([]);
  const [quoteRequests, setQuoteRequests] = useState([]);
  const [detailFor, setDetailFor] = useState(null);
  const [checkoutFor, setCheckoutFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [reportFor, setReportFor] = useState(null);
  const [trainingTrackerFor, setTrainingTrackerFor] = useState(null);
  const [showQuick, setShowQuick] = useState(false);
  const [vaxPhoto, setVaxPhoto] = useState(null);
  const [extrasOpen, setExtrasOpen] = useState(false);

  const loadOperations = useCallback(async () => {
    const [settings, sv, vx, qr] = await Promise.all([
      api.get("/settings").catch(() => ({ data: {} })),
      api.get("/services").catch(() => ({ data: [] })),
      api.get("/admin/vaccine-cert-uploads").catch(() => ({ data: [] })),
      api.get("/admin/quote-requests?status=open").catch(() => ({ data: [] })),
    ]);
    if (Array.isArray(settings.data?.mood_tags) && settings.data.mood_tags.length) setMoodTags(settings.data.mood_tags);
    setServices(Array.isArray(sv.data) ? sv.data : []);
    setPendingVax(Array.isArray(vx.data) ? vx.data : []);
    setQuoteRequests(Array.isArray(qr.data) ? qr.data : []);
  }, []);

  useEffect(() => { loadOperations(); }, [loadOperations]);

  const reloadAll = async () => {
    await Promise.all([loadOperations(), Promise.resolve(onReload())]);
  };

  const captureGeo = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
    );
  });

  const checkIn = async (id, vaccineAck = false) => {
    try {
      const geo = await captureGeo();
      await api.post(`/bookings/${id}/check-in`, { ...geo, vaccine_ack: vaccineAck });
      const row = (stats?.today_roster || []).find((b) => b.id === id);
      if (row?.service_type === "training") {
        setTrainingTrackerFor({ booking_id: id, dog_id: row.dog_id, dog_name: row.dog_name });
      }
      await reloadAll();
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail?.code === "vaccine_warning") {
        const ok = await confirm({
          title: `Vaccine warning · ${detail.dog_name || "this dog"}`,
          body: `${detail.message} Do not check in unless you have a verbal/written OK from the owner. Continue?`,
          confirmText: "Check in anyway",
          destructive: true,
        });
        if (ok) await checkIn(id, true);
        return;
      }
      toast.error(formatErr(detail) || "Check-in failed");
    }
  };

  const approveVax = async (v) => {
    try {
      await api.post(`/admin/dogs/${v.dog_id}/vaccine-cert/${v.vaccine}/review`);
      setPendingVax((prev) => prev.filter((x) => !(x.dog_id === v.dog_id && x.vaccine === v.vaccine)));
      await Promise.resolve(onReload());
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't approve this vaccine cert.");
    }
  };

  const rejectVax = async (v) => {
    const ok = await confirm({
      title: `Reject ${String(v.vaccine || "vaccine").toUpperCase()} cert?`,
      body: `This removes the pending upload. ${v.dog_name || "The dog"}'s previously approved date is kept unless it exactly matches this pending upload.`,
      confirmText: "Reject",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/dogs/${v.dog_id}/vaccine-cert/${v.vaccine}`);
      setPendingVax((prev) => prev.filter((x) => !(x.dog_id === v.dog_id && x.vaccine === v.vaccine)));
      await Promise.resolve(onReload());
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't reject this vaccine cert.");
    }
  };

  const closeQuote = async (q) => {
    try {
      await api.post(`/admin/quote-requests/${q.id}/close`);
      setQuoteRequests((prev) => prev.filter((x) => x.id !== q.id));
      await Promise.resolve(onReload());
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't mark this quote request handled.");
    }
  };

  const roster = stats?.today_roster || [];
  const firstBookings = stats?.first_time_bookings_today || [];
  const birthdays = stats?.upcoming_birthdays || [];
  const showExtras = widgetOn("dog_fact") || widgetOn("training_tip") || widgetOn("trivia");

  return (
    <div className="space-y-5" data-testid="today-operations">
      <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] overflow-hidden" data-testid="today-checkin-board-wrap">
        <div className="px-4 sm:px-5 py-4 border-b border-shBorder flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[15px] font-black uppercase italic tracking-tight text-shText">
              <i className="fas fa-clipboard-check text-shPrimary mr-2"/>Check-In / Check-Out
            </h2>
            <p className="text-[11px] text-shTextMuted mt-1">The live operating board for every dog on today&apos;s roster.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">{roster.length} dogs</span>
            <button onClick={() => setShowQuick(true)} data-testid="today-quick-checkin-button"
                    className="bg-shPrimary text-bgHeader px-4 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest shadow hover:bg-shPrimary/90 min-h-[42px]">
              <i className="fas fa-plus mr-1"/>Quick Check-In
            </button>
          </div>
        </div>
        <div className="divide-y divide-shBorder" data-testid="today-checkin-board">
          {roster.length === 0 && <div className="px-5 py-8 text-center text-[12px] text-shTextMuted">No dogs scheduled today.</div>}
          {roster.map((b) => {
            const onPremises = !!b.checked_in_at && !b.checked_out_at;
            const done = !!b.checked_out_at;
            const d = b.dog || {};
            const balField = b.service_type === "training" ? "training_credits" : b.service_type === "boarding" ? "boarding_credits" : b.service_type === "daycare" ? "credits" : null;
            const credits = balField ? (b.client_credits?.[balField] ?? null) : null;
            return (
              <div key={b.id} className="px-4 sm:px-5 py-3.5 flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between hover:bg-shSurfaceRaised/20 transition" data-testid={`today-roster-${b.id}`}>
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className={`w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 ${done ? "bg-gray-500" : onPremises ? "bg-shPrimary" : "bg-shAccent"}`}/>
                  <button type="button" onClick={() => b.dog_id && onJumpToDog(b.dog_id)} className="text-left min-w-0" data-testid={`today-roster-dog-${b.id}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-black text-shText">{b.dog_name || "Dog"}</span>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-shTextMuted">{b.service_type || "service"}</span>
                      {d.feeding_schedule?.length > 0 && <i className="fas fa-bowl-food text-shPrimary text-[12px]" title={`${d.feeding_schedule.length} feedings`}/>} 
                      {d.medications?.length > 0 && <i className="fas fa-pills text-purple-400 text-[12px]" title={`${d.medications.length} medications`}/>} 
                      {credits != null && <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border border-shPrimary/30 text-shPrimary"><i className="fas fa-coins mr-1"/>{credits}</span>}
                      {b.is_missed_checkout && <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border border-shAccent/40 bg-shAccent/10 text-shAccent"><i className="fas fa-triangle-exclamation mr-1"/>Missed checkout</span>}
                    </div>
                    <p className="text-[12px] text-shTextMuted mt-0.5 truncate">{b.client_name || "—"}{b.kennel ? ` · ${b.kennel}` : ""}</p>
                    <p className="text-[11px] text-shTextMuted mt-0.5">In {fmtTime(b.checked_in_at)} · Out {fmtTime(b.checked_out_at)}</p>
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                  <button onClick={() => setDetailFor(b)} data-testid={`today-booking-detail-${b.id}`} className="px-3 py-2 rounded-lg border border-shBorder text-[11px] font-black uppercase tracking-wider text-shTextMuted hover:text-shText">Details</button>
                  {!b.checked_in_at && <button onClick={() => checkIn(b.id)} data-testid={`today-checkin-${b.id}`} className="px-3 py-2 rounded-lg bg-shPrimary text-bgHeader text-[11px] font-black uppercase tracking-wider">Check In</button>}
                  {onPremises && <button onClick={() => setCheckoutFor(b)} data-testid={`today-checkout-${b.id}`} className="px-3 py-2 rounded-lg bg-shSecondary text-shText text-[11px] font-black uppercase tracking-wider">Check Out</button>}
                  {onPremises && b.service_type === "training" && <button onClick={() => setTrainingTrackerFor({ booking_id: b.id, dog_id: b.dog_id, dog_name: b.dog_name })} data-testid={`today-training-tracker-${b.id}`} className="px-3 py-2 rounded-lg border border-shPrimary/40 bg-shPrimary/10 text-shPrimary text-[11px] font-black uppercase tracking-wider">Training</button>}
                  {!done && <button onClick={() => setCancelFor(b)} data-testid={`today-cancel-${b.id}`} className="px-3 py-2 rounded-lg border border-shBorder text-shTextMuted text-[11px] font-black uppercase tracking-wider hover:text-red-300">Cancel</button>}
                  {done && <button onClick={() => setReportFor(b)} data-testid={`today-report-${b.id}`} className="px-3 py-2 rounded-lg border border-shAccent/40 bg-shAccent/10 text-shAccent text-[11px] font-black uppercase tracking-wider">{b.report_card ? "View Card" : "+ Report Card"}</button>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {(widgetOn("owner_clock") || widgetOn("closing_routine")) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="today-owner-tools">
          {widgetOn("owner_clock") && <OwnerClock/>}
          {widgetOn("closing_routine") && <EndOfDayPanel onJump={(bookingId) => setDetailFor({ id: bookingId })}/>} 
        </section>
      )}

      {(pendingVax.length > 0 || quoteRequests.length > 0) && (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="today-review-queues">
          {pendingVax.length > 0 && (
            <div className="rounded-2xl border border-shSecondary/30 bg-shSecondary/5 p-4 sm:p-5" data-testid="today-pending-vax-reviews">
              <h2 className="text-[14px] font-black uppercase italic text-shText mb-3"><i className="fas fa-file-medical text-shSecondary mr-2"/>Vaccine Reviews · {pendingVax.length}</h2>
              <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {pendingVax.map((v) => (
                  <div key={`${v.dog_id}-${v.vaccine}`} className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-3 flex items-center gap-3 flex-wrap">
                    {v.photo ? <button type="button" onClick={() => setVaxPhoto(v)} className="w-12 h-12 rounded-lg overflow-hidden border border-shSecondary/30 shrink-0"><img src={v.photo} alt="Vaccine certificate" className="w-full h-full object-cover"/></button> : <div className="w-12 h-12 rounded-lg bg-black/20 grid place-items-center text-shTextMuted shrink-0"><i className="fas fa-image"/></div>}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-black text-shText truncate">{v.dog_name || "Dog"} · <span className="text-shSecondary uppercase">{v.vaccine}</span></p>
                      <p className="text-[11px] text-shTextMuted truncate">{v.client_name || "—"}{v.expires_on ? ` · expires ${v.expires_on}` : ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => rejectVax(v)} className="px-2.5 py-2 rounded-lg bg-shDanger/15 text-red-300 text-[10px] font-black uppercase tracking-wider">Reject</button>
                      <button onClick={() => approveVax(v)} className="px-2.5 py-2 rounded-lg bg-shPrimary/15 text-shPrimary text-[10px] font-black uppercase tracking-wider">Approve</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {quoteRequests.length > 0 && (
            <div className="rounded-2xl border border-shPrimary/30 bg-shPrimary/5 p-4 sm:p-5" data-testid="today-quote-requests">
              <h2 className="text-[14px] font-black uppercase italic text-shText mb-3"><i className="fas fa-envelope-open-text text-shPrimary mr-2"/>Quote Requests · {quoteRequests.length}</h2>
              <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {quoteRequests.map((q) => (
                  <div key={q.id} className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-3">
                    <p className="text-[13px] font-black text-shText">{q.client_name || "Client"} <span className="font-normal text-shTextMuted">asked about</span> <span className="text-shPrimary">{q.item_name || "a service"}</span></p>
                    {q.message && <p className="text-[12px] text-shTextMuted mt-1 line-clamp-2">{q.message}</p>}
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      {q.client_email && <a href={`mailto:${q.client_email}`} className="text-[11px] font-bold text-shSecondary hover:underline"><i className="fas fa-envelope mr-1"/>Email</a>}
                      {q.client_phone && <a href={`tel:${q.client_phone}`} className="text-[11px] font-bold text-shSecondary hover:underline"><i className="fas fa-phone mr-1"/>Call</a>}
                      <button onClick={() => closeQuote(q)} className="ml-auto px-2.5 py-1.5 rounded-lg bg-shPrimary/15 text-shPrimary text-[10px] font-black uppercase tracking-wider"><i className="fas fa-check mr-1"/>Handled</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <HelpRequestsTile />

      {can("finance_reports") && (widgetOn("mileage") || widgetOn("sales_tax") || widgetOn("tax_center")) && (
        <section className="space-y-3" data-testid="today-finance-reminders">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-black uppercase italic text-shText"><i className="fas fa-landmark text-shSecondary mr-2"/>Money & Compliance</h2>
            <button onClick={() => onNavigate("income")} className="text-[10px] font-black uppercase tracking-widest text-shSecondary hover:underline">Open Finance <i className="fas fa-arrow-right ml-1"/></button>
          </div>
          {widgetOn("mileage") && <MileageDashTile onNavTax={() => onNavigate("staff")}/>} 
          {widgetOn("sales_tax") && <SalesTaxDueTile onNavigate={onNavigate}/>} 
          {widgetOn("tax_center") && <TaxCenterTile onNavigate={onNavigate}/>} 
        </section>
      )}

      {(firstBookings.length > 0 || birthdays.length > 0) && (
        <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="today-highlights">
          <h2 className="text-[14px] font-black uppercase italic text-shText mb-3"><i className="fas fa-sparkles text-shAccent mr-2"/>Heads Up</h2>
          <div className="flex flex-wrap gap-2">
            {firstBookings.map((b) => <span key={b.booking_id} className="px-3 py-2 rounded-xl border border-shPrimary/25 bg-shPrimary/5 text-[11px] text-shText"><i className="fas fa-paw text-shPrimary mr-1.5"/><b>{b.client_name || "New client"}</b> booked their first {b.service_type || "service"}{b.dog_name ? ` for ${b.dog_name}` : ""}.</span>)}
            {birthdays.map((b) => <span key={b.dog_id} className="px-3 py-2 rounded-xl border border-shSecondary/25 bg-shSecondary/5 text-[11px] text-shText"><i className="fas fa-cake-candles text-shSecondary mr-1.5"/><b>{b.dog_name}</b> turns {b.turning} {b.days === 0 ? "today" : b.days === 1 ? "tomorrow" : `in ${b.days} days`}.</span>)}
          </div>
        </section>
      )}

      {showExtras && (
        <section className="rounded-2xl border border-shBorder overflow-hidden" data-testid="today-daily-extras">
          <button type="button" onClick={() => setExtrasOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 bg-[var(--sh-card-base)] hover:bg-shSurfaceRaised/30 transition">
            <span className="text-[12px] font-black uppercase tracking-widest text-shText"><i className="fas fa-bone text-shTextMuted mr-2"/>Daily Extras</span>
            <i className={`fas fa-chevron-down text-shTextMuted transition-transform ${extrasOpen ? "rotate-180" : ""}`}/>
          </button>
          {extrasOpen && <div className="p-4 border-t border-shBorder space-y-3">
            {widgetOn("dog_fact") && <DogFactCard variant="big"/>}
            {widgetOn("training_tip") && <AdminTrainingTipCard/>}
            {widgetOn("trivia") && <DailyTriviaCard/>}
          </div>}
        </section>
      )}

      {reportFor && <ReportCardModal booking={reportFor} moodTags={moodTags} onClose={() => { setReportFor(null); reloadAll(); }}/>} 
      {detailFor && <BookingDetailModal booking={detailFor} onClose={() => setDetailFor(null)} onJumpToDog={onJumpToDog}/>} 
      {trainingTrackerFor && <TrainingSessionWorkspace bookingId={trainingTrackerFor.booking_id} dogId={trainingTrackerFor.dog_id} enrollmentId={trainingTrackerFor.enrollment_id} onClose={() => setTrainingTrackerFor(null)} onSaved={() => { setTrainingTrackerFor(null); reloadAll(); }}/>} 
      {checkoutFor && <CheckoutModal booking={checkoutFor} services={services} onRequestCancel={(b) => { setCheckoutFor(null); setCancelFor(b); }} onClose={() => { setCheckoutFor(null); reloadAll(); }}/>} 
      {cancelFor && <CancelBookingModal booking={cancelFor} onClose={() => { setCancelFor(null); reloadAll(); }}/>} 
      {showQuick && <AdminBookingModal defaultCheckIn={true} onClose={() => setShowQuick(false)} onCreated={() => { setShowQuick(false); reloadAll(); }}/>} 
      {vaxPhoto && <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur grid place-items-center p-6" onClick={() => setVaxPhoto(null)} data-testid="today-vax-photo-lightbox">
        <div className="max-w-3xl w-full bg-[var(--sh-card-base)] rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-shBorder">
            <div className="text-xs font-black uppercase tracking-widest text-shText">{vaxPhoto.dog_name} · <span className="text-shSecondary">{vaxPhoto.vaccine}</span>{vaxPhoto.expires_on && <span className="text-shTextMuted normal-case font-normal"> · expires {vaxPhoto.expires_on}</span>}</div>
            <button onClick={() => setVaxPhoto(null)} className="text-shTextMuted hover:text-shText text-lg"><i className="fas fa-times"/></button>
          </div>
          <div className="bg-black p-3 flex justify-center"><img src={vaxPhoto.photo} alt="Vaccine certificate" className="max-h-[75vh] object-contain"/></div>
        </div>
      </div>}
    </div>
  );
}
