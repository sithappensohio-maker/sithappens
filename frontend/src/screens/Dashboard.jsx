import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import AdminBookingModal from "../components/AdminBookingModal";
import HelpRequestsTile from "../components/HelpRequestsTile";
import BookingDetailModal from "../components/BookingDetailModal";
import ReportCardModal from "../components/ReportCardModal";
import { CheckoutModal, CancelBookingModal } from "../components/CheckoutModal";
import TodaysBrainTile from "../components/TodaysBrainTile";
import { DogFactCard } from "../components/DogFactCard";
import { DailyTriviaCard } from "../components/DailyTriviaCard";
import AdminTrainingTipCard from "../components/AdminTrainingTipCard";
import { MileageDashTile } from "../components/MileageDashTile";
import { SalesTaxDueTile } from "../components/SalesTaxDueTile";
import { TaxCenterTile } from "../components/TaxCenter";
import usePullToRefresh, { RefreshSpinner } from "../lib/usePullToRefresh";
import { useConfirm } from "../lib/useConfirm";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import { OwnerClock, EndOfDayPanel } from "../components/OwnerClockAndEndOfDay";
import ReadinessChecklist from "../components/ReadinessChecklist";
import DashboardQuickLinks from "../components/DashboardQuickLinks";
import TrainingSessionWorkspace from "../components/TrainingSessionWorkspace";
import CheckpointReviewQueue from "../components/CheckpointReviewQueue";
import TrainerAssistQueue from "../components/TrainerAssistQueue";
import MessageClientModal from "../components/MessageClientModal";
import PendingActionsPanel from "../components/PendingActionsPanel";
import NeonEdge from "../components/premium/NeonEdge";
import HuskyDogImage from "../components/brand/HuskyDogImage";
import PageHero from "../components/PageHero";
import { useTheme } from "../lib/theme";
import { toast } from "sonner";

const DEFAULT_MOOD_TAGS = ["Playful", "Calm", "Napped Well", "Made a Friend", "Worked on Training", "Star of the Day", "Tired Pup", "Extra Hungry"];

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

export default function Dashboard({ onNavigate = () => {}, onJumpToDog = () => {}, onJumpToClient = () => {}, can = () => false }) {
  // Sprint 110di-19 — Dashboard Widget Controls. Single source of truth via
  // /api/branding. `widgetOn(id)` defaults TRUE (current behavior preserved).
  const { branding: _br } = useTheme();
  const _dw = _br?.dashboard_widgets || {};
  const widgetOn = (id) => _dw[id] !== false;
  const [stats, setStats] = useState(null);
  const [moodTags, setMoodTags] = useState(DEFAULT_MOOD_TAGS);
  const [reportFor, setReportFor] = useState(null); // booking
  const [checkoutFor, setCheckoutFor] = useState(null); // booking — opens checkout modal
  const [cancelFor, setCancelFor] = useState(null); // booking — opens cancel-confirm modal
  // Sprint 110aq — read-only "what's the deal with this booking" overview
  // modal launched from any roster row on the Today's Check-in Board.
  const [detailFor, setDetailFor] = useState(null);
  // Sprint 110di-69 — Training Tracker modal trigger { booking_id, dog_id, dog_name? }
  const [trainingTrackerFor, setTrainingTrackerFor] = useState(null);
  const [services, setServices] = useState([]);
  const [showQuick, setShowQuick] = useState(false);
  const [programs, setPrograms] = useState(null);
  const [pendingVax, setPendingVax] = useState([]);
  // Sprint 110di-82 — Pending homework day-submissions awaiting admin review.
  const [pendingHomework, setPendingHomework] = useState([]);
  const [pendingCheckpoints, setPendingCheckpoints] = useState([]);
  const [checkpointQueueOpen, setCheckpointQueueOpen] = useState(false);
  // Online School Phase 4 — Trainer Assist queue tile + modal.
  const [trainerAssistCases, setTrainerAssistCases] = useState([]);
  const [trainerAssistQueueOpen, setTrainerAssistQueueOpen] = useState(false);
  const [messageClientFor, setMessageClientFor] = useState(null); // {clientId, dogId, lessonName, onSent}
  const [vaxPhoto, setVaxPhoto] = useState(null); // {photo, dog_name, vaccine}
  const [todayPnl, setTodayPnl] = useState(null);
  const [registerDay, setRegisterDay] = useState(null);
  const [pnlExpanded, setPnlExpanded] = useState(false);
  const [leaderboard, setLeaderboard] = useState({ top_dogs: [], top_clients: [] });
  const [quoteRequests, setQuoteRequests] = useState([]);
  const confirm = useConfirm();
  // Sprint 110ao — Live-refresh state. We track which booking IDs we've
  // already seen so the 30 s tick only toasts NEW arrivals, not the existing
  // list. Same for quote-requests + vaccine-cert uploads. `seededRef`
  // prevents a flood of toasts on the very first load.
  const seenBookingIdsRef = useRef(null);
  const seenQuoteIdsRef = useRef(null);
  const seenVaxIdsRef = useRef(null);
  const seededRef = useRef(false);
  // `_br` (branding) and `can` are read via ref so `load` can stay a single
  // stable callback (safe to list as a dependency on the mount-only effect
  // below) while still always seeing the CURRENT branding/permission values
  // at the moment it actually runs — `can` in particular is a brand-new
  // function on every AuthProvider render, so depending on it directly would
  // re-trigger the full dashboard load constantly.
  const brRef = useRef(_br);
  brRef.current = _br;
  const canRef = useRef(can);
  canRef.current = can;

  const load = useCallback(async () => {
    try {
      const br = brRef.current;
      const widgetOnNow = (id) => (br?.dashboard_widgets || {})[id] !== false;
      const [s, st, pg, sv, vx, hw, cp, ta, lb, qr, pnl, reg] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/settings"),
        api.get("/programs/active-summary").catch(()=>({data:null})),
        api.get("/services").catch(()=>({data:[]})),
        api.get("/admin/vaccine-cert-uploads").catch(()=>({data:[]})),
        api.get("/admin/homework/pending-reviews").catch(()=>({data:[]})),
        canRef.current("manage_training_sessions")
          ? api.get("/admin/school/checkpoints/pending").catch(()=>({data:[]}))
          : Promise.resolve({data:[]}),
        canRef.current("manage_training_sessions")
          ? api.get("/admin/school/trainer-assist").catch(()=>({data:[]}))
          : Promise.resolve({data:[]}),
        (br?.feature_visibility?.rewards !== false)
          ? api.get("/trophies/leaderboard").catch(()=>({data:{top_dogs:[],top_clients:[]}}))
          : Promise.resolve({data:{top_dogs:[],top_clients:[]}}),
        api.get("/admin/quote-requests?status=open").catch(()=>({data:[]})),
        (widgetOnNow("pnl") && canRef.current("finance_reports"))
          ? api.get("/admin/today-pnl").catch(()=>({data:null}))
          : Promise.resolve({data:null}),
        widgetOnNow("register")
          ? api.get("/admin/register/day").catch(()=>({data:null}))
          : Promise.resolve({data:null}),
      ]);
      setStats(s.data);
      if (Array.isArray(st.data?.mood_tags) && st.data.mood_tags.length) setMoodTags(st.data.mood_tags);
      setPrograms(pg.data);
      setServices(sv.data || []);
      setPendingVax(Array.isArray(vx.data) ? vx.data : []);
      setPendingHomework(Array.isArray(hw.data) ? hw.data : []);
      setPendingCheckpoints(Array.isArray(cp.data) ? cp.data : []);
      setTrainerAssistCases(Array.isArray(ta.data) ? ta.data : []);
      setLeaderboard(lb.data || { top_dogs: [], top_clients: [] });
      setQuoteRequests(Array.isArray(qr.data) ? qr.data : []);
      setTodayPnl(pnl.data);
      setRegisterDay(reg.data);

      // ── New-arrival toasts (skip the first load to avoid greeting flood)
      const currentBookings = [
        ...(s.data?.bookings_today || []),
        ...(s.data?.checked_in || []),
        ...(s.data?.pending_approval || []),
      ];
      const bookingIds = new Set(currentBookings.map(b => b.id).filter(Boolean));
      const quoteIds = new Set((Array.isArray(qr.data) ? qr.data : []).map(q => q.id).filter(Boolean));
      const vaxIds = new Set((Array.isArray(vx.data) ? vx.data : []).map(v => v.id || `${v.dog_id}-${v.vaccine}`).filter(Boolean));

      if (seededRef.current) {
        const newBookings = currentBookings.filter(b => b.id && !seenBookingIdsRef.current?.has(b.id));
        const newQuotes = (Array.isArray(qr.data) ? qr.data : []).filter(q => q.id && !seenQuoteIdsRef.current?.has(q.id));
        const newVax = (Array.isArray(vx.data) ? vx.data : []).filter(v => {
          const id = v.id || `${v.dog_id}-${v.vaccine}`;
          return id && !seenVaxIdsRef.current?.has(id);
        });
        newBookings.forEach(b => {
          const svc = b.service_type ? ` · ${b.service_type}` : "";
          toast.success(`🐶 New booking · ${b.dog_name || "Dog"}${svc}`, { duration: 6000 });
        });
        newQuotes.forEach(q => {
          toast.info(`📩 New quote request${q.client_name ? ` · ${q.client_name}` : ""}`, { duration: 6000 });
        });
        newVax.forEach(v => {
          toast.warning(`📎 Vaccine upload · ${v.dog_name || "Dog"}${v.vaccine ? ` · ${v.vaccine}` : ""}`, { duration: 6000 });
        });
      }
      seenBookingIdsRef.current = bookingIds;
      seenQuoteIdsRef.current = quoteIds;
      seenVaxIdsRef.current = vaxIds;
      seededRef.current = true;
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);
  // Sprint 110ao — Live refresh every 30 s. Auto-pauses while a modal is
  // open (CheckoutModal / ReportCardModal acquire the edit lock).
  // A full dashboard refresh is intentionally limited to once per minute.
  // It fans out to several independent summaries; the previous 30-second
  // refresh plus a second P&L timer doubled that work on small self-hosted PCs.
  useLiveRefresh(load, { intervalMs: 60_000 });

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
      // Training Session Workspace (Phase 3) — auto-open for training
      // bookings; the workspace resolves the correct enrollment/draft
      // itself and shows its own resolution screen if the dog isn't ready
      // for a session (no/multiple active programs, empty module, etc.).
      const row = (stats?.today_roster || []).find(b => b.id === id);
      if (row && row.service_type === "training") {
        setTrainingTrackerFor({ booking_id: id, dog_id: row.dog_id, dog_name: row.dog_name });
      }
      load();
    } catch (e) {
      // The server re-checks vaccines at the actual moment of check-in (a
      // booking can be weeks old, so a vaccine valid at booking time may
      // have since expired) and asks for explicit staff acknowledgement —
      // this used to be a silent no-op error on this screen.
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
      setPendingVax(prev => prev.filter(x => !(x.dog_id===v.dog_id && x.vaccine===v.vaccine)));
    } catch (e) {
      // The server can legitimately reject an approval (e.g. an uploaded
      // cert with no expiry date) — this used to fail with no feedback at
      // all, leaving the item stuck in the queue with no explanation.
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't approve this vaccine cert.");
    }
  };
  const rejectVax = async (v) => {
    const ok = await confirm({
      title: `Reject ${v.vaccine.toUpperCase()} cert?`,
      body: `This will remove the upload. ${v.dog_name}'s current ${v.vaccine} expiry on file will only be cleared if it exactly matches this pending upload — an older, already-approved date is kept. The client will need to reupload before they can book.`,
      confirmText: "Reject",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/dogs/${v.dog_id}/vaccine-cert/${v.vaccine}`);
      setPendingVax(prev => prev.filter(x => !(x.dog_id===v.dog_id && x.vaccine===v.vaccine)));
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't reject this vaccine cert.");
    }
  };

  const { pulling, progress } = usePullToRefresh("[data-scroll-root]", load);

  const refreshPnl = async () => {
    try {
      const r = await api.get("/admin/today-pnl");
      setTodayPnl(r.data);
    } catch { /* silent */ }
  };

  if (!stats) return <div className="text-shTextMuted text-sm">Loading dashboard…</div>;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="admin-dashboard">
      <RefreshSpinner pulling={pulling} progress={progress} />

      {/* Sprint 110u — landing-page-style hero header. Brand glow backdrop,
          uppercase italic title, eyebrow tag, snapshot stat tiles. Replaces
          the bare H2 the page used to open with. */}
      {/* Sprint 110di-20-fix — hero card gated. */}
      {widgetOn("hero_card") && (
        <PageHero
          eyebrow={{ icon: "fa-paw", text: "Today at Sit Happens", color: "text-shSecondary" }}
          title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}.`}
          highlight="Let's get to it."
          subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          right={stats ? (
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full lg:w-auto" data-testid="dashboard-hero-tiles">
              {widgetOn("daycare_stats")  && <DashHeroTile icon="fa-sun" color="#00a9e0" label="Daycare today" value={`${stats?.daycare_occupancy ?? 0}/${stats?.daycare_capacity ?? 0}`}/>}
              {widgetOn("boarding_stats") && <DashHeroTile icon="fa-moon" color="#8cc63f" label="Boarding tonight" value={stats?.boarding_today ?? 0}/>}
              {widgetOn("training_stats") && <DashHeroTile icon="fa-graduation-cap" color="#a855f7" label="Training today" value={stats?.training_today ?? 0}/>}
              {widgetOn("grooming_stats") && <DashHeroTile icon="fa-bath" color="#06b6d4" label="Grooming today" value={stats?.grooming_today ?? 0}/>}
              <DashHeroTile icon="fa-camera-retro" color="#f97316" label="Photography today" value={stats?.photography_today ?? 0}/>
            </div>
          ) : null}
          testid="dashboard-hero"
        />
      )}

      {/* Action Required — everything waiting on a real staff decision
          (Meet & Greets, approval-required bookings, reschedule requests).
          Deliberately ABOVE every other operational widget, especially on
          mobile: visibility keys off when the request was CREATED, never the
          requested appointment date. Not widget-gated — a pending request
          must never be hidden by dashboard customization. */}
      <PendingActionsPanel testid="dashboard-pending-actions" />

      {/* Sprint 110df — Solo-operator owner clock + end-of-day wrap-up
          Sprint 110di-19 — gated by Dashboard Widget Controls */}
      {(widgetOn("owner_clock") || widgetOn("closing_routine")) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="owner-tools-row">
          {widgetOn("owner_clock") && <OwnerClock/>}
          {widgetOn("closing_routine") && <EndOfDayPanel onJump={(bid)=>setDetailFor({ id: bid })}/>}
        </div>
      )}

      {widgetOn("register") && can("finance_reports") && (
        <RegisterDashboardCard data={registerDay} onNavigate={onNavigate} />
      )}

      {/* Operations polish — Quick links to new ops screens + readiness checklist */}
      {widgetOn("quick_links") && <DashboardQuickLinks onNavigate={onNavigate} can={can} />}
      {/* Sprint 110di-72 — Operational Readiness removed from the daily Dashboard per user request.
          ReadinessChecklist component + endpoint stay available; can be re-mounted on a Settings/System
          page if needed. */}

      {/* Sprint 110ax / 110di-59 — Daily dog fact + trivia leaderboard.
          Promoted to BIG variant and moved above-the-fold (was previously
          a tiny chip near the bottom that the operator never noticed).
          Sprint 110di-60 — Added playable Trivia Question of the Day so
          staff can also play (separately tracked from clients). */}
      {widgetOn("dog_fact") && <DogFactCard variant="big" />}
      {widgetOn("training_tip") && <AdminTrainingTipCard />}
      {widgetOn("trivia") && <DailyTriviaCard />}
      {widgetOn("trivia") && <TriviaDashboardTile onNavSettings={()=>onNavigate("settings")} />}

      {pendingHomework.length > 0 && (
        <div className="bg-shAccent/5 border border-shAccent/25 rounded-xl p-5 shadow-xl" data-testid="pending-homework-reviews">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h3 className="text-xs font-black text-shAccent uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-clipboard-check"/> Practice Awaiting Review · {pendingHomework.length}
            </h3>
            <button onClick={()=>onNavigate("homework")}
                    data-testid="open-homework-queue"
                    className="text-[11px] font-black uppercase tracking-widest text-shAccent hover:text-shText border border-shAccent/40 hover:border-shAccent rounded px-3 py-1.5">
              Open Review Queue <i className="fas fa-arrow-right ml-1"/>
            </button>
          </div>
          <div className="space-y-2">
            {pendingHomework.slice(0, 5).map(h => (
              <button key={`${h.homework_id}-${h.day_number}`}
                      type="button"
                      onClick={()=>onNavigate("homework")}
                      data-testid={`pending-homework-${h.homework_id}-${h.day_number}`}
                      className="w-full text-left flex items-center justify-between gap-3 bg-[var(--sh-card-base)]/50 hover:bg-[var(--sh-card-base)] rounded p-3 flex-wrap transition">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded bg-shAccent/15 text-shAccent grid place-items-center shrink-0">
                    {h.has_photo ? <i className="fas fa-camera"/> : <i className="fas fa-paw"/>}
                  </div>
                  <div className="text-xs min-w-0">
                    <div className="font-black text-shText uppercase truncate">
                      {h.dog_name || "—"}
                      <span className="text-shTextMuted font-normal normal-case"> · {h.client_name || "—"}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-black uppercase px-2 py-0.5 rounded bg-shAccent/20 text-shAccent text-[12px] tracking-widest">
                        Day {h.day_number}{h.total_days ? ` / ${h.total_days}` : ""}
                      </span>
                      <span className="text-shTextMuted truncate max-w-[260px]">{h.title || "Daily tracker"}</span>
                      {h.submitted_at && (
                        <span className="text-shTextMuted">submitted <span className="font-black text-shText">{new Date(h.submitted_at).toLocaleString()}</span></span>
                      )}
                    </div>
                    {h.note && <div className="text-shTextMuted mt-1 italic truncate max-w-[640px]">&ldquo;{h.note}&rdquo;</div>}
                  </div>
                </div>
                <i className="fas fa-chevron-right text-shTextMuted shrink-0"/>
              </button>
            ))}
            {pendingHomework.length > 5 && (
              <p className="text-[12px] text-shTextMuted italic px-1">
                + {pendingHomework.length - 5} more in the queue
              </p>
            )}
          </div>
        </div>
      )}

      {pendingCheckpoints.length > 0 && (
        <NeonEdge accentRgb="242,101,34" intensity="standard" className="overflow-hidden" data-testid="pending-checkpoint-reviews">
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-shAccent/12 border border-shAccent/25 text-shAccent grid place-items-center shadow-[0_0_24px_rgba(242,101,34,0.10)]">
                  <i className="fas fa-video"/>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shAccent">Online School · Trainer desk</p>
                  <h3 className="sh-display text-xl text-shText mt-0.5">Checkpoint Reviews</h3>
                  <p className="text-[11px] text-shTextMuted mt-1">{pendingCheckpoints.length} student{pendingCheckpoints.length === 1 ? "" : "s"} waiting for your review</p>
                </div>
              </div>
              <button onClick={() => setCheckpointQueueOpen(true)}
                      data-testid="open-checkpoint-queue"
                      className="rounded-xl px-4 py-2.5 bg-shAccent text-[#080b12] text-[11px] font-black uppercase tracking-[0.12em] hover:brightness-110 transition shadow-[0_0_24px_rgba(242,101,34,0.14)]">
                Review Queue <i className="fas fa-arrow-right ml-1.5"/>
              </button>
            </div>
            <div className="grid gap-2">
              {pendingCheckpoints.slice(0, 5).map(c => (
                <button key={c.id} type="button" onClick={() => setCheckpointQueueOpen(true)}
                        data-testid={`pending-checkpoint-${c.id}`}
                        className="group w-full text-left flex items-center justify-between gap-3 bg-white/[0.025] hover:bg-shAccent/[0.055] border border-shBorder/50 hover:border-shAccent/25 rounded-xl p-3.5 transition">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <HuskyDogImage name={c.dog_name} className="w-11 h-11 rounded-xl object-cover bg-black/30 border border-shBorder/60 shrink-0"/>
                    <div className="min-w-0">
                      <div className="font-black text-shText text-sm truncate">{c.dog_name || "—"}</div>
                      <div className="text-[11px] text-shTextMuted truncate">{c.client_name || "—"} · {c.lesson_name || "Checkpoint"}</div>
                      {c.submitted_at && <div className="text-[10px] text-shAccent/80 mt-1">Submitted {new Date(c.submitted_at).toLocaleString()}</div>}
                    </div>
                  </div>
                  <span className="w-8 h-8 rounded-lg border border-shBorder/60 grid place-items-center text-shTextMuted group-hover:text-shAccent group-hover:border-shAccent/30 transition shrink-0"><i className="fas fa-chevron-right text-[10px]"/></span>
                </button>
              ))}
              {pendingCheckpoints.length > 5 && <p className="text-[11px] text-shTextMuted px-1 pt-1">+ {pendingCheckpoints.length - 5} more awaiting review</p>}
            </div>
          </div>
        </NeonEdge>
      )}

      {trainerAssistCases.filter(c => c.trainer_assist_status !== "completed").length > 0 && (
        <NeonEdge accentRgb="168,85,247" intensity="standard" className="overflow-hidden bg-purple-500/10 border border-purple-400/40" data-testid="trainer-assist-tile">
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-purple-500/12 border border-purple-400/25 text-purple-300 grid place-items-center shadow-[0_0_24px_rgba(168,85,247,0.12)]">
                  <i className="fas fa-handshake"/>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-purple-300">Online School · Human support</p>
                  <h3 className="sh-display text-xl text-shText mt-0.5">Trainer Assist</h3>
                  <p className="text-[11px] text-shTextMuted mt-1">{trainerAssistCases.filter(c => c.trainer_assist_status !== "completed").length} student{trainerAssistCases.filter(c => c.trainer_assist_status !== "completed").length === 1 ? "" : "s"} need a human handoff</p>
                </div>
              </div>
              <button onClick={() => setTrainerAssistQueueOpen(true)}
                      data-testid="open-trainer-assist-queue"
                      className="rounded-xl px-4 py-2.5 bg-purple-500 text-white text-[11px] font-black uppercase tracking-[0.12em] hover:bg-purple-400 transition shadow-[0_0_24px_rgba(168,85,247,0.16)]">
                Open Trainer Assist <i className="fas fa-arrow-right ml-1.5"/>
              </button>
            </div>
            <div className="grid gap-2">
              {trainerAssistCases.filter(c => c.trainer_assist_status !== "completed").slice(0, 5).map(c => (
                <button key={c.id} type="button" onClick={() => setTrainerAssistQueueOpen(true)}
                        data-testid={`trainer-assist-tile-item-${c.id}`}
                        className="group w-full text-left flex items-center justify-between gap-3 bg-white/[0.025] hover:bg-purple-500/[0.055] border border-shBorder/50 hover:border-purple-400/25 rounded-xl p-3.5 transition">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <HuskyDogImage name={c.dog_name} className="w-11 h-11 rounded-xl object-cover bg-black/30 border border-shBorder/60 shrink-0"/>
                    <div className="min-w-0">
                      <div className="font-black text-shText text-sm truncate">{c.dog_name || "—"}</div>
                      <div className="text-[11px] text-shTextMuted truncate">{c.client_name || "—"} · {c.lesson_name || "Checkpoint"}</div>
                    </div>
                  </div>
                  <span className="w-8 h-8 rounded-lg border border-shBorder/60 grid place-items-center text-shTextMuted group-hover:text-purple-300 group-hover:border-purple-400/30 transition shrink-0"><i className="fas fa-chevron-right text-[10px]"/></span>
                </button>
              ))}
            </div>
          </div>
        </NeonEdge>
      )}

      {pendingVax.length > 0 && (
        <div className="bg-shSecondary/5 border border-shSecondary/25 rounded-xl p-5 shadow-xl" data-testid="pending-vax-reviews">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-black text-shSecondary uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-file-medical"/> Pending Vaccine Reviews · {pendingVax.length}
            </h3>
            <span className="text-[13px] font-bold uppercase tracking-widest text-shTextMuted">Client uploads awaiting approval</span>
          </div>
          <div className="space-y-2">
            {pendingVax.map(v => (
              <div key={`${v.dog_id}-${v.vaccine}`} className="flex items-center justify-between gap-3 bg-[var(--sh-card-base)]/50 rounded p-3 flex-wrap" data-testid={`pending-vax-${v.dog_id}-${v.vaccine}`}>
                <div className="flex items-center gap-3 min-w-0">
                  {v.photo ? (
                    <button
                      type="button"
                      onClick={()=>setVaxPhoto(v)}
                      className="w-14 h-14 rounded overflow-hidden ring-1 ring-shSecondary/40 shrink-0 hover:ring-shSecondary transition"
                      data-testid={`view-vax-photo-${v.dog_id}-${v.vaccine}`}
                      title="Click to view full"
                    >
                      <img src={v.photo} alt={`${v.vaccine} cert`} className="w-full h-full object-cover"/>
                    </button>
                  ) : (
                    <div className="w-14 h-14 rounded bg-[var(--sh-card-base)]/80 ring-1 ring-gray-700 grid place-items-center text-shTextMuted shrink-0">
                      <i className="fas fa-image"/>
                    </div>
                  )}
                  <div className="text-xs min-w-0">
                    <div className="font-black text-shText uppercase truncate">{v.dog_name} <span className="text-shTextMuted font-normal normal-case">· {v.client_name || "—"}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-black uppercase px-2 py-0.5 rounded bg-shSecondary/20 text-shSecondary text-[13px] tracking-widest">{v.vaccine}</span>
                      {v.expires_on && <span className="text-shTextMuted">Expires <span className="font-black text-shText">{v.expires_on}</span></span>}
                      {v.uploaded_at && <span className="text-shTextMuted">· uploaded {new Date(v.uploaded_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={()=>rejectVax(v)}
                    data-testid={`reject-vax-${v.dog_id}-${v.vaccine}`}
                    className="text-[13px] font-black uppercase tracking-widest px-3 py-2 rounded bg-shDanger/20 text-red-300 hover:bg-shDanger/30 transition"
                  >
                    <i className="fas fa-times mr-1"/> Reject
                  </button>
                  <button
                    onClick={()=>approveVax(v)}
                    data-testid={`approve-vax-${v.dog_id}-${v.vaccine}`}
                    className="text-[13px] font-black uppercase tracking-widest px-3 py-2 rounded bg-shPrimary/20 text-shPrimary hover:bg-shPrimary/30 transition"
                  >
                    <i className="fas fa-check mr-1"/> Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {quoteRequests.length > 0 && (
        <div className="bg-shSecondary/5 border border-shSecondary/25 rounded-xl p-5 shadow-xl" data-testid="quote-requests-panel">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-xs font-black text-shPrimary uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-envelope-open-text"/> Quote Requests · {quoteRequests.length}
            </h3>
            <span className="text-[13px] font-bold uppercase tracking-widest text-shTextMuted">Clients interested in services/programs</span>
          </div>
          <div className="space-y-2">
            {quoteRequests.map(q => (
              <div key={q.id} className="flex items-start justify-between gap-3 bg-[var(--sh-card-base)]/50 rounded p-3 flex-wrap" data-testid={`quote-request-${q.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-black text-shText uppercase italic tracking-tight">
                    {q.client_name} <span className="text-shTextMuted font-normal normal-case">wants info on</span> <span className="text-shPrimary">{q.item_name}</span>
                    {q.listed_price > 0 && <span className="text-shTextMuted text-[14px] font-normal normal-case"> · ${Number(q.listed_price).toFixed(2)}</span>}
                  </div>
                  <div className="text-[13px] text-shTextMuted mt-1 flex flex-wrap items-center gap-2">
                    <span><i className="fas fa-clock mr-1"/>{q.created_at ? new Date(q.created_at).toLocaleString() : ""}</span>
                    {q.client_email && <a href={`mailto:${q.client_email}`} className="text-shSecondary hover:underline"><i className="fas fa-envelope mr-1"/>{q.client_email}</a>}
                    {q.client_phone && <a href={`tel:${q.client_phone}`} className="text-shSecondary hover:underline"><i className="fas fa-phone mr-1"/>{q.client_phone}</a>}
                  </div>
                  {q.message && <p className="text-[14px] text-shTextMuted mt-2 italic bg-[var(--sh-card-base)]/60 rounded p-2"><i className="fas fa-quote-left text-shTextMuted mr-1"/>{q.message}</p>}
                </div>
                <button
                  onClick={async ()=>{
                    try {
                      await api.post(`/admin/quote-requests/${q.id}/close`);
                      setQuoteRequests(prev => prev.filter(x => x.id !== q.id));
                    } catch {}
                  }}
                  data-testid={`close-quote-${q.id}`}
                  className="text-[13px] font-black uppercase tracking-widest px-3 py-2 rounded bg-shPrimary/20 text-shPrimary hover:bg-shPrimary/30 transition self-start"
                >
                  <i className="fas fa-check mr-1"/> Mark Handled
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(stats.first_time_bookings_today || []).length > 0 && (
        <div className="bg-shPrimary/5 border border-shPrimary/25 rounded-xl p-5 shadow-xl" data-testid="first-booking-banner">
          <h3 className="text-xs font-black text-shPrimary uppercase tracking-widest flex items-center gap-2 mb-3">
            <i className="fas fa-party-horn"/> First Booking Celebration · {stats.first_time_bookings_today.length}
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.first_time_bookings_today.map(b => (
              <div key={b.booking_id} className="bg-[var(--sh-card-base)]/60 rounded-full px-4 py-2 flex items-center gap-3 text-xs" data-testid={`first-booking-${b.booking_id}`}>
                <span className="text-shPrimary text-base"><i className="fas fa-paw"/></span>
                <span className="font-black text-shText uppercase">{b.client_name || "New client"}</span>
                <span className="text-shTextMuted">just booked their</span>
                <span className="font-black text-shPrimary uppercase">first {b.service_type || "session"}</span>
                {b.dog_name && <span className="text-shTextMuted">for <span className="font-black text-shText uppercase">{b.dog_name}</span></span>}
                {b.date && <span className="text-shSecondary font-black uppercase text-[13px] tracking-widest">· {b.date}{b.end_date && b.end_date !== b.date ? ` → ${b.end_date}` : ""}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {(stats.upcoming_birthdays || []).length > 0 && (
        <div className="bg-shSecondary/5 border border-shSecondary/25 rounded-xl p-5 shadow-xl" data-testid="birthday-banner">
          <h3 className="text-xs font-black text-shPrimary uppercase tracking-widest flex items-center gap-2 mb-3"><i className="fas fa-cake-candles"/> Upcoming Birthdays · {stats.upcoming_birthdays.length}</h3>
          <div className="flex flex-wrap gap-2">
            {stats.upcoming_birthdays.map(b => (
              <div key={b.dog_id} className="bg-[var(--sh-card-base)]/60 rounded-full px-4 py-2 flex items-center gap-3 text-xs">
                <span className="font-black text-shText uppercase">{b.dog_name}</span>
                <span className="text-shPrimary font-black">turns {b.turning}</span>
                <span className="text-shTextMuted">{b.days===0?"today!":b.days===1?"tomorrow":`in ${b.days} days`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <TodaysBrainTile onCTA={(it) => {
        const t = it.cta?.type;
        if (t === "open_dog" && it.cta.id) onJumpToDog(it.cta.id);
        else if (t === "open_client" && it.cta.id) onJumpToClient(it.cta.id);
        else if (t === "open_screen" && it.cta.screen) onNavigate(it.cta.screen);
        else if (t === "send_monday_digest") {
          api.post("/admin/homework/send-monday-digest")
            .then(() => toast.success("Monday digest sent — check your admin email."))
            .catch((e) => toast.error("Failed to send: " + (e.response?.data?.detail || e.message)));
        }
      }} />

      {/* Sprint 110ax / 110di-59 — Dog fact + Trivia tile moved to top of
          dashboard (see above). Originally rendered here as a chip — removed
          to avoid duplicate render. */}

      {(widgetOn("daycare_stats") || widgetOn("boarding_stats") || widgetOn("total_dogs")) && (
      <div className="grid grid-cols-3 gap-3 md:gap-6">
        {widgetOn("daycare_stats")  && <StatCard label="Daycare Today" value={`${stats.daycare_occupancy} / ${stats.daycare_capacity}`} accent="border-t-shSecondary"  textColor="text-shText" testId="stat-daycare" onClick={()=>onNavigate("schedule")} />}
        {widgetOn("boarding_stats") && <StatCard label="Boarding Today" value={stats.boarding_today}   accent="border-t-shPrimary"   textColor="text-shPrimary" testId="stat-boarding" onClick={()=>onNavigate("schedule")} />}
        {widgetOn("total_dogs")     && <StatCard label="Total Dogs"    value={stats.total_dogs}      accent="border-t-bgHover"            textColor="text-shText" testId="stat-dogs" onClick={()=>onNavigate("dogs")} />}
      </div>
      )}

      {todayPnl && widgetOn("pnl") && can("finance_reports") && <TodayPnlTile data={todayPnl} expanded={pnlExpanded} onToggle={()=>setPnlExpanded(e=>!e)} onNavStaff={()=>onNavigate("staff")} onRefresh={refreshPnl} />}

      {/* Sprint 110bq — Daily mileage quick-log */}
      {widgetOn("mileage") && <MileageDashTile onNavTax={()=>onNavigate("staff")} />}

      {/* Step 4C — Ohio sales-tax filing obligation chip */}
      {widgetOn("sales_tax") && can("finance_reports") && <SalesTaxDueTile onNavigate={onNavigate} />}

      {/* Step 4D-3 — Tax Center next-action chip (owner/finance only; the
          permission gate means restricted staff never mount it and never
          fire the aggregator request). */}
      {widgetOn("tax_center") && can("finance_reports") && <TaxCenterTile onNavigate={onNavigate} />}

      {/* Sprint 110bk — Trivia leaderboard moved to top of dashboard (see above). */}

      {/* Sprint 110di-33 — Client help requests inbox. Self-hides when
          there are no open requests. No new dashboard-widget setting —
          this is operationally critical (clients can't otherwise reach
          the operator from inside the portal) so it shows whenever
          there's something to act on. */}
      <HelpRequestsTile />


      {programs && programs.total > 0 && (
        <div className="bg-[var(--sh-card-base)] rounded-xl border border-shBorder p-4" data-testid="programs-tile">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-black text-shText uppercase tracking-widest"><i className="fas fa-graduation-cap mr-2 text-shSecondary"/>Dogs in Active Programs</p>
            <span className="text-xs text-shTextMuted font-black uppercase tracking-widest">{programs.total} active</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(programs.by_type).map(([type, count]) => {
              const colors = {private_lessons:"#00a9e0", board_train:"#8cc63f", service_dog:"#a855f7", custom:"#ec4899"};
              const labels = {private_lessons:"Private Lessons", board_train:"Board & Train", service_dog:"Service Dog", custom:"Custom"};
              return (
                <div key={type} className="px-3 py-1.5 rounded border" style={{borderColor:(colors[type]||"#475569")+"60", background:(colors[type]||"#475569")+"15"}}>
                  <span className="text-[14px] font-black uppercase tracking-widest" style={{color: colors[type]||"#94a3b8"}}>{labels[type]||type}</span>
                  <span className="text-shText ml-2 font-black">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-[var(--sh-card-base)] rounded-xl border border-shBorder overflow-hidden">
        <div className="px-6 py-4 border-b border-shBorder flex items-center justify-between gap-3">
          <h3 className="text-xs font-black text-shText uppercase tracking-widest"><i className="fas fa-clipboard-check mr-2 text-shPrimary"/>Today's Check-in Board</h3>
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-black text-shTextMuted uppercase hidden sm:inline">{stats.today_roster?.length || 0} dogs</span>
            <button onClick={()=>setShowQuick(true)} data-testid="quick-checkin-button"
                    className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest shadow hover:bg-shPrimary/90">
              <i className="fas fa-plus mr-1"/>Quick Check-in
            </button>
          </div>
        </div>
        <div className="divide-y divide-bgHover/40" data-testid="checkin-board">
          {(stats.today_roster || []).length === 0 && <div className="px-6 py-10 text-center text-xs text-shTextMuted uppercase font-black">No dogs scheduled today.</div>}
          {(stats.today_roster || []).map(b => {
            const onPremises = b.checked_in_at && !b.checked_out_at;
            const done = !!b.checked_out_at;
            const d = b.dog || {};
            const careIcons = [];
            if (d.feeding_schedule?.length) careIcons.push({i:"fa-bowl-food",c:"text-shPrimary",n:d.feeding_schedule.length});
            if (d.medications?.length) careIcons.push({i:"fa-pills",c:"text-purple-400",n:d.medications.length});
            // Credit balance for the relevant pool — shown so admin can settle from credits at check-out
            const balField = b.service_type === "training" ? "training_credits"
                            : b.service_type === "boarding" ? "boarding_credits"
                            : b.service_type === "daycare" ? "credits"
                            : null;
            const credits = balField ? (b.client_credits?.[balField] ?? null) : null;
            const creditChipColor = credits == null ? ""
              : credits > 0 ? "bg-shPrimary/15 text-shPrimary border-shPrimary/40"
              : "bg-gray-700/50 text-shTextMuted border-gray-600";
            return (
              <div
                key={b.id}
                className="px-6 py-4 flex items-center justify-between hover:bg-[var(--sh-card-base)]/30 transition cursor-pointer focus-within:bg-[var(--sh-card-base)]/30"
                data-testid={`roster-${b.id}`}
                role="button"
                tabIndex={0}
                onClick={()=>setDetailFor(b)}
                onKeyDown={(e)=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailFor(b); } }}
                title="View booking details"
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (b.dog_id) onJumpToDog(b.dog_id); }}
                  title="Open dog profile"
                  className="flex items-center gap-4 -ml-2 pl-2 pr-3 py-1 rounded text-left transition hover:bg-[var(--sh-card-base)]/60 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shPrimary/40"
                  data-testid={`roster-dog-link-${b.id}`}
                >
                  <div className={`w-3 h-3 rounded-full ${done?"bg-gray-500":onPremises?"bg-shPrimary animate-pulse":"bg-shAccent"}`}/>
                  <div>
                    <p className="text-sm font-black text-shText uppercase tracking-tight flex items-center gap-2 flex-wrap">
                      {b.dog_name}
                      {careIcons.map((ic,idx)=><i key={idx} className={`fas ${ic.i} ${ic.c} text-[14px]`} title={`${ic.n} ${ic.i==="fa-pills"?"medications":"feedings"}`} />)}
                      {credits != null && (
                        <span className={`text-[13px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${creditChipColor}`}
                              title={`Available ${b.service_type} credits`} data-testid={`roster-credits-${b.id}`}>
                          <i className="fas fa-coins mr-1"/>{credits}
                        </span>
                      )}
                      {/* Sprint 110di-85 — Flag any dog that never got checked out on their scheduled day. */}
                      {/* Sprint 110di-87 — At-a-glance planned checkout date for
                          multi-day stays (boarding). Suppressed on rows that
                          are already flagged as missed (that pill shows the
                          same date more prominently) and on rows that have
                          finished checking out. */}
                      {b.end_date && b.end_date !== b.date && !b.is_missed_checkout && !b.checked_out_at && (
                        <span data-testid={`roster-planned-out-${b.id}`}
                              title={`Scheduled check-out on ${b.end_date}. Extra days past this date are automatically billed at check-out.`}
                              className="text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border bg-shSecondary/15 text-shSecondary border-shSecondary/40">
                          <i className="fas fa-calendar-check mr-1"/>Out · {b.end_date}
                        </span>
                      )}
                      {b.is_missed_checkout && (
                        <span data-testid={`roster-missed-checkout-${b.id}`}
                              title={`Checked in ${new Date(b.checked_in_at).toLocaleString()} and never checked out — please close this out to deduct the credit.`}
                              className="text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border bg-shAccent/15 text-shAccent border-shAccent/50 animate-pulse">
                          <i className="fas fa-triangle-exclamation mr-1"/>Missed checkout · {b.end_date || b.date}
                        </span>
                      )}
                    </p>
                    <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest">{b.client_name} · {b.service_type}{b.kennel?` · ${b.kennel}`:""}</p>
                  </div>
                </button>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden md:block">
                    <p className="text-[15px] text-shTextMuted font-black uppercase tracking-widest">In · Out</p>
                    <p className="text-xs text-shTextMuted font-mono">{fmtTime(b.checked_in_at)} · {fmtTime(b.checked_out_at)}</p>
                    {(b.checked_in_by_name || b.checked_out_by_name) && (
                      <p className="text-[10px] text-shTextMuted font-black uppercase tracking-widest"
                         title={`In by ${b.checked_in_by_name||"—"}${b.checked_in_lat?` (${b.checked_in_lat.toFixed(4)},${b.checked_in_lng.toFixed(4)})`:""}${b.checked_out_by_name?`\nOut by ${b.checked_out_by_name}`:""}${b.checked_out_lat?` (${b.checked_out_lat.toFixed(4)},${b.checked_out_lng.toFixed(4)})`:""}`}>
                        <i className="fas fa-user-shield mr-1 text-shSecondary"/>{b.checked_in_by_name || "—"}
                        {b.checked_in_lat && <i className="fas fa-location-dot ml-1 text-shPrimary"/>}
                      </p>
                    )}
                  </div>
                  {!b.checked_in_at && (
                    <button onClick={(e)=>{ e.stopPropagation(); checkIn(b.id); }} data-testid={`checkin-${b.id}`}
                            className="bg-shPrimary text-bgHeader px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest shadow hover:bg-shPrimary/90">Check In</button>
                  )}
                  {onPremises && (
                    <button onClick={(e)=>{ e.stopPropagation(); setCheckoutFor(b); }} data-testid={`checkout-${b.id}`}
                            className="bg-shSecondary text-shText px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest shadow hover:bg-shSecondary/90">Check Out</button>
                  )}
                  {/* Sprint 110di-69 — Trainer shortcut: only shown on-premises for training bookings */}
                  {onPremises && b.service_type === "training" && (
                    <button onClick={(e)=>{ e.stopPropagation(); setTrainingTrackerFor({ booking_id: b.id, dog_id: b.dog_id, dog_name: b.dog_name }); }}
                            data-testid={`roster-training-tracker-${b.id}`}
                            title="Open training tracker for this dog's active program"
                            className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-3 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shPrimary/25">
                      <i className="fas fa-paw mr-1"/>Tracker
                    </button>
                  )}
                  {/* Sprint 110as — cancel is now available on EVERY row that
                      hasn't been checked out yet (not just on-premises). The
                      modal lets the operator choose refund vs charge. */}
                  {!done && (
                    <button onClick={(e)=>{ e.stopPropagation(); setCancelFor(b); }} data-testid={`cancel-${b.id}`}
                            title="Cancel booking — choose to refund or charge"
                            className="bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted px-3 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shDanger/40 hover:text-shText">
                      <i className="fas fa-times mr-1"/>Cancel
                    </button>
                  )}
                  {done && !b.report_card && (
                    <button onClick={(e)=>{ e.stopPropagation(); setReportFor(b); }} data-testid={`report-${b.id}`}
                            className="bg-shAccent/15 text-shAccent border border-shAccent/40 px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shAccent/25">+ Report Card</button>
                  )}
                  {done && b.report_card && (
                    <button onClick={(e)=>{ e.stopPropagation(); setReportFor(b); }} data-testid={`view-report-${b.id}`}
                            className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-5 py-2 rounded font-black uppercase text-[14px] tracking-widest hover:bg-shPrimary/25">View Card</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(leaderboard.top_dogs.length > 0 || leaderboard.top_clients.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="leaderboard-section">
          {leaderboard.top_dogs.length > 0 && (
            <div className="bg-[var(--sh-card-base)] rounded-xl p-5 border-t-4 border-shAccent shadow-lg" data-testid="top-dogs-leaderboard">
              <h3 className="text-xs font-black text-shAccent uppercase tracking-widest mb-4 flex items-center gap-2"><i className="fas fa-trophy"/>Top Dogs · Most Trophies</h3>
              <div className="space-y-2">
                {leaderboard.top_dogs.map((d, i) => (
                  <button
                    key={d.dog_id}
                    type="button"
                    onClick={() => onJumpToDog(d.dog_id)}
                    title="Open dog profile"
                    className="w-full text-left flex items-center gap-3 bg-[var(--sh-card-base)]/50 rounded p-2 transition hover:bg-[var(--sh-card-base)] hover:ring-1 hover:ring-shAccent/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shAccent/60"
                    data-testid={`top-dog-${d.dog_id}`}
                  >
                    <span className={`text-lg font-black w-7 text-center ${i===0?"text-yellow-400":i===1?"text-slate-300":i===2?"text-amber-600":"text-shTextMuted"}`}>#{i+1}</span>
                    {d.photo ? (
                      <img src={d.photo} alt={d.dog_name} className="w-10 h-10 rounded-full object-cover ring-1 ring-bgHover"/>
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[var(--sh-card-base)] grid place-items-center text-shPrimary"><i className="fas fa-paw"/></div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-shText uppercase truncate">{d.dog_name}</div>
                      <div className="text-[13px] text-shTextMuted">{d.breed || "—"} · {d.owner_name || ""}</div>
                    </div>
                    <span className="bg-shAccent/15 text-shAccent font-black uppercase tracking-widest text-[13px] px-2 py-1 rounded">{d.trophy_count} 🏆</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {leaderboard.top_clients.length > 0 && (
            <div className="bg-[var(--sh-card-base)] rounded-xl p-5 border-t-4 border-shSecondary shadow-lg" data-testid="top-clients-leaderboard">
              <h3 className="text-xs font-black text-shSecondary uppercase tracking-widest mb-4 flex items-center gap-2"><i className="fas fa-medal"/>Top Clients · Most Trophies</h3>
              <div className="space-y-2">
                {leaderboard.top_clients.map((c, i) => (
                  <button
                    key={c.client_id}
                    type="button"
                    onClick={() => onJumpToClient(c.client_id)}
                    title="Open client profile"
                    className="w-full text-left flex items-center gap-3 bg-[var(--sh-card-base)]/50 rounded p-2 transition hover:bg-[var(--sh-card-base)] hover:ring-1 hover:ring-shSecondary/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shSecondary/60"
                    data-testid={`top-client-${c.client_id}`}
                  >
                    <span className={`text-lg font-black w-7 text-center ${i===0?"text-yellow-400":i===1?"text-slate-300":i===2?"text-amber-600":"text-shTextMuted"}`}>#{i+1}</span>
                    <div className="w-10 h-10 rounded-full bg-[var(--sh-card-base)] grid place-items-center text-shSecondary"><i className="fas fa-user"/></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-shText uppercase truncate">{c.client_name}</div>
                    </div>
                    <span className="bg-shSecondary/15 text-shSecondary font-black uppercase tracking-widest text-[13px] px-2 py-1 rounded">{c.trophy_count} 🏆</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {reportFor && <ReportCardModal booking={reportFor} moodTags={moodTags} onClose={()=>{ setReportFor(null); load(); }} />}
      {detailFor && <BookingDetailModal booking={detailFor} onClose={()=>setDetailFor(null)} onJumpToDog={onJumpToDog} />}
      {trainingTrackerFor && (
        <TrainingSessionWorkspace
          bookingId={trainingTrackerFor.booking_id}
          dogId={trainingTrackerFor.dog_id}
          enrollmentId={trainingTrackerFor.enrollment_id}
          onClose={()=>setTrainingTrackerFor(null)}
          onSaved={()=>{ setTrainingTrackerFor(null); load(); }}
        />
      )}
      {checkpointQueueOpen && (
        <CheckpointReviewQueue onClose={() => setCheckpointQueueOpen(false)} onGraded={load}/>
      )}
      {trainerAssistQueueOpen && (
        <TrainerAssistQueue
          onClose={() => setTrainerAssistQueueOpen(false)}
          onChanged={load}
          canMessage={canRef.current("messages")}
          onMessageClient={(ctx) => setMessageClientFor(ctx)}
        />
      )}
      {messageClientFor && (
        <MessageClientModal
          clientId={messageClientFor.clientId}
          dogId={messageClientFor.dogId}
          lessonName={messageClientFor.lessonName}
          onSent={() => { messageClientFor.onSent?.(); }}
          onClose={() => setMessageClientFor(null)}
        />
      )}
      {checkoutFor && <CheckoutModal booking={checkoutFor} services={services}
                                     onRequestCancel={(b)=>{ setCheckoutFor(null); setCancelFor(b); }}
                                     onClose={()=>{ setCheckoutFor(null); load(); }} />}
      {cancelFor && <CancelBookingModal booking={cancelFor} onClose={()=>{ setCancelFor(null); load(); }} />}
      {showQuick && <AdminBookingModal defaultCheckIn={true} onClose={()=>setShowQuick(false)} onCreated={load} />}
      {vaxPhoto && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur grid place-items-center p-6" onClick={()=>setVaxPhoto(null)} data-testid="vax-photo-lightbox">
          <div className="max-w-3xl w-full bg-[var(--sh-card-base)] rounded-xl overflow-hidden shadow-2xl" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-shBorder">
              <div className="text-xs font-black uppercase tracking-widest text-shText">
                {vaxPhoto.dog_name} · <span className="text-shSecondary">{vaxPhoto.vaccine}</span>
                {vaxPhoto.expires_on && <span className="text-shTextMuted normal-case font-normal"> · expires {vaxPhoto.expires_on}</span>}
              </div>
              <button onClick={()=>setVaxPhoto(null)} data-testid="vax-photo-close" className="text-shTextMuted hover:text-shText text-lg"><i className="fas fa-times"/></button>
            </div>
            <div className="bg-black p-3 flex justify-center">
              <img src={vaxPhoto.photo} alt="vaccine cert" className="max-h-[75vh] object-contain"/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function RegisterDashboardCard({ data, onNavigate }) {
  // Sprint — Money Hub consolidation. This card is now a SUMMARY only —
  // every operational money action (new sale, sell credits, record payment,
  // expenses, cash payout, close day) lives in Front Desk. Duplicating those
  // as quick-action buttons here is exactly the scattered-UI problem the
  // consolidation pass removes; this card's only job is "here's where things
  // stand" plus one strong way in.
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const totals = data?.totals || {};
  const collected = Number(totals.net_incoming || totals.incoming_total || 0);
  const expectedCash = Number(totals.expected_cash || 0);
  const registerOpen = !!data?.drawer_session && !data?.register_closed;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-shPrimary/40 bg-[var(--sh-card-base)] p-5 shadow-xl" data-testid="dashboard-register-card">
      <div className="absolute inset-0 pointer-events-none opacity-30"
           style={{ background: "radial-gradient(circle at 10% 10%, rgba(140,198,63,0.32) 0%, transparent 36%), radial-gradient(circle at 90% 80%, rgba(0,169,224,0.24) 0%, transparent 42%)" }}/>
      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shPrimary mb-1">
            <i className="fas fa-cash-register mr-2"/>Today's Sales
          </p>
          <h3 className="text-2xl sm:text-3xl font-black text-shText uppercase italic tracking-tight" data-testid="dashboard-register-total">
            {money(collected)} <span className="text-[13px] text-shTextMuted not-italic uppercase tracking-widest">net incoming</span>
          </h3>
          <p className="text-[13px] text-shTextMuted mt-1">
            Expected drawer: <span className="font-black text-shPrimary" data-testid="dashboard-register-cash">{money(expectedCash)}</span>
            <span className="mx-2 text-shTextMuted">·</span>
            Register: <span className={`font-black ${registerOpen ? "text-shPrimary" : "text-shAccent"}`}>{registerOpen ? "Open" : "Closed"}</span>
          </p>
        </div>
        <button onClick={()=>onNavigate("pos")}
                data-testid="dashboard-open-register"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest hover:bg-shPrimary/90 transition">
          Open Front Desk <i className="fas fa-arrow-right ml-1"/>
        </button>
      </div>
      {data?.closeout && (
        <p className="relative mt-3 text-[12px] text-shPrimary font-black uppercase tracking-widest" data-testid="dashboard-register-closeout-saved">
          <i className="fas fa-check-circle mr-1"/>Closeout saved for today
        </p>
      )}
    </div>
  );
}

function TodayPnlTile({ data, expanded, onToggle, onNavStaff, onRefresh }) {
  const fmt = (n) => `${n < 0 ? "-" : ""}$${Math.abs(Number(n)||0).toFixed(2)}`;
  const isProfit = data.net >= 0;
  const revenueMethods = [
    ["cash", "Cash"], ["card", "Card / Card"], ["venmo", "Venmo"],
    ["paypal", "PayPal"], ["check", "Check"],
    ["venmo_paypal", "Venmo / PayPal (legacy)"], ["other", "Other"],
  ].filter(([key]) => Math.abs(Number(data.revenue_by_method?.[key] || 0)) >= 0.005);
  const accent = isProfit ? "text-shPrimary border-shPrimary/40" : "text-red-300 border-shDanger/40";
  const bg = isProfit ? "bg-shPrimary/5" : "bg-shDanger/5";
  return (
    <div className={`rounded-xl border ${accent} ${bg} p-4`} data-testid="today-pnl-tile">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">
            <i className={`fas ${isProfit ? "fa-arrow-trend-up text-shPrimary" : "fa-arrow-trend-down text-shDanger"} mr-2`}/>
            Today's P&amp;L · {data.date}
          </p>
          <p className={`text-3xl font-black ${isProfit ? "text-shPrimary" : "text-red-300"} mt-1`} data-testid="pnl-net">{fmt(data.net)}</p>
          <p className="text-[13px] text-shTextMuted mt-0.5">
            {fmt(data.revenue)} revenue − {fmt(data.labor_total || data.labor_cost)} labor
            {data.labor_burden ? <span className="text-shTextMuted"> ({fmt(data.labor_cost)} + {fmt(data.labor_burden)} taxes)</span> : null}
            {Number(data.expense_total || 0) > 0 && (
              <> − <span className="text-red-300" data-testid="pnl-expense-inline">{fmt(data.expense_total)} expenses</span></>
            )}
            {data.margin_pct != null && <span className="ml-2 font-black">({data.margin_pct}% margin)</span>}
          </p>
          {Number(data.expense_total || 0) > 0 && (
            <p className="text-[12px] text-red-300 font-black uppercase tracking-widest mt-1" data-testid="pnl-expense-chip">
              <i className="fas fa-receipt mr-1"/>Expenses {fmt(data.expense_total)} ({data.expense_count || 0})
            </p>
          )}
          {(data.retail_revenue > 0 || data.retail_count > 0) && (
            <p className="text-[12px] text-purple-300 font-black uppercase tracking-widest mt-1" data-testid="pnl-retail-chip">
              <i className="fas fa-bag-shopping mr-1"/>Other register income {fmt(data.retail_revenue || 0)} ({data.retail_count || 0})
            </p>
          )}
          {/* Sprint 110bf — owner's-draw chip (owner's hours still count toward
              labor cost, but we surface what's specifically the owner's pay) */}
          {Number(data.owner_draw_today || 0) > 0 && (
            <p className="text-[12px] text-shSecondary font-black uppercase tracking-widest mt-1" data-testid="pnl-owner-draw">
              <i className="fas fa-crown mr-1"/>Owner's draw today {fmt(data.owner_draw_today)}
              <span className="text-shTextMuted normal-case ml-1">({Number(data.owner_hours_today || 0).toFixed(2)}h)</span>
            </p>
          )}
          {/* Sprint 110az — Legacy pricing impact chip. Shown only when at
              least one of today's bookings is for a grandfathered client. */}
          {Math.abs(Number(data.legacy_delta || 0)) >= 0.5 && data.legacy_client_count > 0 && (
            <p className={`text-[12px] font-black uppercase tracking-widest mt-1 ${data.legacy_delta < 0 ? "text-shAccent" : "text-shPrimary"}`}
               data-testid="pnl-legacy-chip"
               title={`Catalog forecast would be ${fmt(data.catalog_forecast)}`}>
              <i className="fas fa-hand-holding-dollar mr-1"/>
              {fmt(Math.abs(data.legacy_delta))} {data.legacy_delta < 0 ? "below" : "above"} catalog
              <span className="text-shTextMuted normal-case ml-1">({data.legacy_client_count} legacy {data.legacy_client_count === 1 ? "client" : "clients"})</span>
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded px-3 py-2 text-center min-w-[88px]">
            <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Booked</p>
            <p className="text-base font-black text-shText">{data.booked_count}</p>
          </div>
          <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded px-3 py-2 text-center min-w-[88px]">
            <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Hours</p>
            <p className="text-base font-black text-shText">{data.labor_hours}</p>
          </div>
          {data.open_shifts > 0 && (
            <div className="bg-shPrimary/15 border border-shPrimary/40 rounded px-3 py-2 text-center min-w-[88px]" data-testid="pnl-open-shifts">
              <p className="text-[10px] font-black uppercase tracking-widest text-shPrimary">Clocked in</p>
              <p className="text-base font-black text-shPrimary">{data.open_shifts}</p>
            </div>
          )}
          <button onClick={onToggle} data-testid="pnl-toggle"
                  className="text-[12px] font-black uppercase tracking-widest text-shSecondary hover:underline px-2 py-1">
            <i className={`fas fa-chevron-${expanded ? "up" : "down"} mr-1`}/>{expanded ? "Less" : "Details"}
          </button>
          <button onClick={onRefresh} data-testid="pnl-refresh"
                  className="text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText px-2 py-1"
                  title="Refresh (auto every 30s)">
            <i className="fas fa-rotate"/>
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-shBorder/60 pt-3" data-testid="pnl-details">
          {revenueMethods.length > 0 && (
            <div className="mb-3" data-testid="pnl-method-breakdown">
              <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-1">Revenue by payment method</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {revenueMethods.map(([key, label]) => (
                  <div key={key} className="flex justify-between gap-2 rounded border border-shBorder bg-[var(--sh-card-base)]/50 px-2 py-1 text-[13px]">
                    <span className="text-shTextMuted">{label}</span>
                    <span className="text-shText font-black">{fmt(data.revenue_by_method[key])}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.per_employee.length === 0 ? (
            <p className="text-[14px] text-shTextMuted">No staff clocked in today.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-1">Labor breakdown</p>
              {data.per_employee.map(e => (
                <div key={e.user_id} className="flex justify-between items-center gap-2 text-[14px]" data-testid={`pnl-emp-${e.user_id}`}>
                  <span className="text-shTextMuted truncate">
                    {e.name}
                    {e.is_owner && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-shSecondary bg-shSecondary/15 border border-shSecondary/40 px-1.5 py-0.5 rounded"><i className="fas fa-crown mr-1"/>owner</span>}
                    {e.is_clocked_in && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-shPrimary bg-shPrimary/15 border border-shPrimary/40 px-1.5 py-0.5 rounded">live</span>}
                  </span>
                  <span className="text-shTextMuted shrink-0">{e.hours}h · ${e.cost.toFixed(2)} · ${e.hourly_rate.toFixed(2)}/hr</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={onNavStaff} className="mt-3 text-[12px] font-black uppercase tracking-widest text-shSecondary hover:underline" data-testid="pnl-open-staff">
            Open Staff <i className="fas fa-arrow-right ml-1"/>
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, textColor, testId, onClick }) {
  const base = `bg-[var(--sh-card-base)] border border-shBorder p-6 rounded-xl border-t-4 ${accent} shadow-lg text-left w-full transition`;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={`${base} hover:scale-[1.02] hover:shadow-xl active:scale-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-shPrimary/60`}
        title="Click to view details"
      >
        <div className="flex items-start justify-between">
          <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest">{label}</p>
          <i className="fas fa-arrow-right text-[14px] text-shTextMuted opacity-0 group-hover:opacity-100"></i>
        </div>
        <p className={`text-3xl font-black mt-2 ${textColor}`}>{value}</p>
      </button>
    );
  }
  return (
    <div className={base} data-testid={testId}>
      <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-black mt-2 ${textColor}`}>{value}</p>
    </div>
  );
}


function DashHeroTile({ icon, color, label, value }) {
  return (
    <div className="min-w-0 sm:min-w-[150px] rounded-xl border border-shBorder/70 bg-black/20 px-3 py-2.5 flex items-center gap-3"
         data-testid={`dash-hero-tile-${label.replace(/\s+/g,'-').toLowerCase()}`}>
      <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 border border-white/5"
           style={{ backgroundColor: `${color}18`, color }}>
        <i className={`fas ${icon}`}/>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-shTextMuted leading-none truncate">{label}</p>
        <p className="text-xl font-black text-shText leading-tight mt-1">{value}</p>
      </div>
    </div>
  );
}





// ─── Sprint 110bk — Trivia at-a-glance ──────────────────────────────────────
function TriviaDashboardTile({ onNavSettings }) {
  const [data, setData] = useState(null);
  const [winners, setWinners] = useState([]);
  const [winnersBusy, setWinnersBusy] = useState(false);
  const [showWinners, setShowWinners] = useState(false);
  useEffect(() => {
    (async () => {
      try { const r = await api.get("/admin/trivia/leaderboard"); setData(r.data); } catch {}
      try {
        const w = await api.get("/admin/trivia/recent-winners", { params: { days_back: 30, limit: 15 } });
        setWinners(w.data?.pending || []);
      } catch {}
    })();
  }, []);
  const redeemPerk = async (w) => {
    if (winnersBusy) return;
    setWinnersBusy(true);
    try {
      await api.post("/admin/trivia/milestones/redeem", {
        client_id: w.client_id, days: w.days, earned_on: w.earned_on,
      });
      setWinners(prev => prev.filter(x => !(x.client_id === w.client_id && x.days === w.days && x.earned_on === w.earned_on)));
    } catch {}
    setWinnersBusy(false);
  };
  if (!data || data.total_players === 0) return null;
  const top = (data.players || []).slice(0, 5);
  const pending = winners.length || (data.pending_milestones?.length || 0);
  return (
    <div className="bg-[var(--sh-card-base)] rounded-xl border border-shBorder overflow-hidden card-pop" data-testid="trivia-dash-tile">
      <button onClick={onNavSettings}
              data-testid="trivia-dash-header"
              className="w-full p-3 flex justify-between items-center hover:bg-[var(--sh-card-base)]/70 text-left">
        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shSecondary">
          <i className="fas fa-puzzle-piece mr-2"/>Trivia leaderboard
          {pending > 0 && (
            <span className="ml-2 bg-shAccent/15 text-shAccent border border-shAccent/30 px-2 py-0.5 rounded text-[10px]" data-testid="trivia-dash-pending">
              <i className="fas fa-gift mr-1"/>{pending} perk{pending===1?"":"s"} to award
            </span>
          )}
        </p>
        <span className="text-[11px] text-shTextMuted"><i className="fas fa-arrow-right ml-1"/></span>
      </button>
      <div className="px-3 pb-3">
        {top.length === 0 ? (
          <p className="text-shTextMuted text-sm">No one playing yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {top.map(p => (
                <tr key={p.client_id} className="border-t border-shBorder/40" data-testid={`trivia-dash-row-${p.client_id}`}>
                  <td className="py-1.5 pr-2 text-shTextMuted font-black w-8">#{p.rank}</td>
                  <td className="py-1.5 pr-2">
                    <p className="text-shText font-bold truncate">{p.name}</p>
                    {p.dogs.length > 0 && <p className="text-[11px] text-shTextMuted truncate">{p.dogs.join(", ")}</p>}
                  </td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                    <span className={`font-black ${p.current_streak >= 7 ? "text-shPrimary" : p.current_streak >= 3 ? "text-shAccent" : "text-shText"}`}>
                      <i className="fas fa-fire mr-1"/>{p.current_streak}d
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-shTextMuted text-[11px] whitespace-nowrap hidden sm:table-cell">
                    {p.total_correct}/{p.total_attempts} · {p.accuracy_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* Sprint 110cv — Recent winners feed: shows un-redeemed trivia perks
            so the operator can mark them claimed once delivered. */}
        {winners.length > 0 && (
          <div className="mt-3 pt-3 border-t border-shBorder/60" data-testid="trivia-recent-winners">
            <button
              onClick={(e) => { e.stopPropagation(); setShowWinners(s => !s); }}
              data-testid="trivia-recent-winners-toggle"
              className="w-full flex items-center justify-between text-left text-[11px] font-black uppercase tracking-widest text-shAccent hover:text-shText">
              <span><i className="fas fa-gift mr-2"/>Pending perks ({winners.length})</span>
              <i className={`fas fa-chevron-${showWinners ? "up" : "down"} text-[11px]`}/>
            </button>
            {showWinners && (
              <div className="mt-2 space-y-1.5">
                {winners.map(w => (
                  <div key={`${w.client_id}-${w.days}-${w.earned_on}`}
                       className="flex items-start gap-2 bg-[var(--sh-card-base)]/70 border border-shBorder/60 rounded px-2 py-1.5"
                       data-testid={`trivia-pending-perk-${w.client_id}-${w.days}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-shText font-black truncate">
                        <span className="text-shAccent mr-1">🏆 {w.days}d</span> {w.client_name}
                      </p>
                      <p className="text-[11px] text-shTextMuted truncate leading-snug">{w.label}</p>
                      <p className="text-[10px] text-shTextMuted font-black uppercase tracking-widest mt-0.5">Earned {w.earned_on}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); redeemPerk(w); }}
                      disabled={winnersBusy}
                      data-testid={`trivia-pending-redeem-${w.client_id}-${w.days}`}
                      className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest hover:bg-shPrimary/30 disabled:opacity-50 whitespace-nowrap">
                      ✓ Awarded
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="text-[10px] text-shTextMuted italic mt-2 text-right">{data.total_players} player{data.total_players===1?"":"s"} · tap card to manage</p>
      </div>
    </div>
  );
}
