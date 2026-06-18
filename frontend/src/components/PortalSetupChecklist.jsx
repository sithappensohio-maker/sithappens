import { useEffect, useState } from "react";
import { api } from "../lib/api";

const STATUS_META = {
  complete:       { label: "Complete",       cls: "bg-shGreen/15  text-shGreen border-shGreen/40",     icon: "fa-circle-check" },
  pending_review: { label: "Pending Review", cls: "bg-shBlue/15   text-shBlue   border-shBlue/40",     icon: "fa-hourglass-half" },
  in_progress:    { label: "In Progress",    cls: "bg-shOrange/15 text-shOrange border-shOrange/40",   icon: "fa-circle-dot" },
  not_started:    { label: "Not Started",    cls: "bg-gray-700/30 text-gray-300 border-gray-600/40",   icon: "fa-circle" },
};

const TARGET_TESTID = {
  profile:  "open-profile",
  dogs:     "portal-add-dog",
  vaccines: null,    // routed manually
  waiver:   "open-waiver-button",
  intake:   null,    // intake handled in the existing IntakePortalSection
};

const TARGET_ANCHOR = {
  profile:  null,
  dogs:     "portal-dogs-anchor",
  vaccines: "portal-dogs-anchor",
  waiver:   null,
  intake:   null,    // querySelector via data-testid below
};

const TARGET_SELECTOR = {
  intake:   '[data-testid="portal-intake-section"]',
};

/**
 * Mounts the first-time client setup checklist.
 * - Renders at the top of the portal when booking is locked.
 * - When all gates are complete, shows a celebratory success card.
 * - Routes the user to the matching existing portal flow via testid or anchor.
 */
export default function PortalSetupChecklist({ onAction = () => {}, onStatusChange = () => {}, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { data } = await api.get("/portal/setup-status");
      setData(data);
      onStatusChange(data);
    } catch {
      setData(null);
    } finally { setLoading(false); }
  };
  // Re-fetch when refreshKey bumps (parent triggers after dog/vaccine/waiver
  // save) so step states catch up immediately without waiting for the 60s
  // poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  // Re-poll every 60s so admin-side changes (vaccine approval, intake assigned)
  // reflect without forcing a full refresh.
  useEffect(() => {
    const h = setInterval(() => { load(); }, 60000);
    return () => clearInterval(h);
  }, []);

  if (loading || !data) return null;
  const { steps, completed_count, total_count, booking_locked, ready_to_book, overall } = data;
  // Don't render at all if the client is already ready (the success state is
  // surfaced inside the bookings section instead — see Portal.jsx).
  if (ready_to_book) return null;

  const goTo = (target) => {
    // Give the parent first crack — it knows about modals, dogs, etc.
    // If it returns truthy, we don't fall through to scroll.
    try {
      if (onAction && onAction(target) === true) return;
    } catch { /* ignore parent errors */ }
    const tid = TARGET_TESTID[target];
    if (tid) {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.click(); return; }
    }
    const sel = TARGET_SELECTOR[target];
    if (sel) {
      const el = document.querySelector(sel);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    }
    const anchor = TARGET_ANCHOR[target];
    if (anchor) {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const pct = total_count ? Math.round((completed_count / total_count) * 100) : 0;
  const overallMeta = STATUS_META[overall] || STATUS_META.not_started;

  return (
    <div className="relative overflow-hidden bg-bgPanel border-2 border-shOrange/40 rounded-2xl p-5 sm:p-7 mb-6 shadow-2xl"
         data-testid="portal-setup-checklist">
      <div className="absolute inset-0 pointer-events-none opacity-30"
           style={{ background: "radial-gradient(circle at 10% 10%, rgba(242,101,34,0.5) 0%, transparent 40%), radial-gradient(circle at 90% 90%, rgba(140,198,63,0.35) 0%, transparent 45%)" }}/>
      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shOrange mb-1">
              <i className="fas fa-clipboard-check mr-1.5"/>First-time setup
            </p>
            <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tight">
              Get Ready to <span className="text-shGreen">Book.</span>
            </h2>
          </div>
          <span className={`text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${overallMeta.cls}`}
                data-testid="portal-setup-overall-badge">
            <i className={`fas ${overallMeta.icon} mr-1.5`}/>{completed_count} / {total_count} done
          </span>
        </div>

        <p className="text-[14px] text-gray-300 mt-1 max-w-2xl">
          Before your dog can join the chaos, we need a few important details. This keeps every dog safe,
          helps our team care for your dog properly, and makes booking faster after setup is complete.
        </p>

        {/* Progress bar */}
        <div className="mt-4 h-2 rounded-full bg-bgBase overflow-hidden">
          <div className={`h-full transition-all ${pct === 100 ? "bg-shGreen" : "bg-shOrange"}`}
               style={{ width: `${Math.max(pct, 4)}%` }} data-testid="portal-setup-progress"/>
        </div>

        {/* Step cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          {steps.map((s, idx) => {
            const meta = STATUS_META[s.status] || STATUS_META.not_started;
            const isComplete = s.status === "complete";
            return (
              <div key={s.id}
                   data-testid={`portal-setup-step-${s.id}`}
                   className={`relative rounded-xl border p-4 transition ${
                     isComplete
                       ? "bg-shGreen/5 border-shGreen/30"
                       : "bg-bgBase border-bgHover hover:border-shOrange/60"
                   }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        Step {idx + 1}
                      </span>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${meta.cls}`}>
                        <i className={`fas ${meta.icon} mr-1`}/>{meta.label}
                      </span>
                    </div>
                    <p className={`text-[15px] font-black uppercase italic tracking-tight ${isComplete ? "text-shGreen" : "text-white"}`}>
                      {s.label}
                    </p>
                    <p className="text-[12px] text-gray-400 mt-0.5">{s.blurb}</p>
                    {!isComplete && s.missing && s.missing.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {s.missing.slice(0, 3).map((m, i) => (
                          <li key={i} className="text-[11px] text-shOrange">
                            <i className="fas fa-circle-exclamation mr-1"/>{m}
                          </li>
                        ))}
                        {s.missing.length > 3 && (
                          <li className="text-[11px] text-gray-500">+ {s.missing.length - 3} more</li>
                        )}
                      </ul>
                    )}
                    {s.status === "pending_review" && (
                      <p className="text-[11px] text-shBlue mt-2">
                        <i className="fas fa-clock mr-1"/>We've got your records — admin is reviewing.
                      </p>
                    )}
                  </div>
                </div>
                {!isComplete && (
                  <button
                    onClick={() => goTo(s.action_target)}
                    data-testid={`portal-setup-step-action-${s.id}`}
                    className="mt-3 w-full bg-shGreen text-bgHeader text-[12px] font-black uppercase tracking-widest py-2 rounded hover:bg-shGreen/90 transition"
                  >
                    <i className="fas fa-arrow-right mr-2"/>{s.action_label}
                  </button>
                )}
                {/* Sprint 110dh-7 — secondary "Add Another Dog" / "Add Another
                    Vaccine" actions for steps that the client may want to
                    revisit even after completing the bare minimum. */}
                {isComplete && s.id === "dog_info" && (
                  <button
                    onClick={() => goTo("dogs")}
                    data-testid="portal-setup-add-another-dog"
                    className="mt-3 w-full bg-shBlue/15 text-shBlue text-[12px] font-black uppercase tracking-widest py-2 rounded hover:bg-shBlue/25 transition border border-shBlue/30"
                  >
                    <i className="fas fa-plus mr-2"/>Add Another Dog
                  </button>
                )}
                {isComplete && s.id === "vaccines" && (
                  <button
                    onClick={() => goTo("vaccines")}
                    data-testid="portal-setup-update-vaccines"
                    className="mt-3 w-full bg-shBlue/15 text-shBlue text-[12px] font-black uppercase tracking-widest py-2 rounded hover:bg-shBlue/25 transition border border-shBlue/30"
                  >
                    <i className="fas fa-rotate mr-2"/>Update Vaccine Records
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Lock message */}
        {booking_locked && (
          <div className="mt-5 bg-shOrange/10 border border-shOrange/30 rounded-lg p-4"
               data-testid="portal-setup-lock-message">
            <p className="text-[13px] text-shOrange font-black uppercase tracking-widest">
              <i className="fas fa-lock mr-1.5"/>Booking is locked
            </p>
            <p className="text-[13px] text-gray-300 mt-1">
              Almost there — complete your setup checklist before booking. Once your info, dog profile,
              emergency contact, vaccines, and waiver are complete, booking will unlock automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact success card shown inside the bookings section once everything's
 * unlocked. Rendered only when `ready_to_book` is true.
 */
export function PortalSetupSuccess({ onBook, onDismiss, dismissable = true }) {
  return (
    <div className="relative overflow-hidden bg-shGreen/10 border border-shGreen/40 rounded-2xl p-5 mb-4 shadow-2xl"
         data-testid="portal-setup-success">
      <div className="absolute inset-0 pointer-events-none opacity-20"
           style={{ background: "radial-gradient(circle at 50% 0%, rgba(140,198,63,0.6) 0%, transparent 60%)" }}/>
      {dismissable && onDismiss && (
        <button onClick={onDismiss} data-testid="portal-setup-success-dismiss"
                className="absolute top-2 right-2 text-gray-400 hover:text-white text-lg p-2 z-10"
                aria-label="Dismiss">
          <i className="fas fa-xmark"/>
        </button>
      )}
      <div className="relative flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
            <i className="fas fa-rocket mr-1.5"/>You&apos;re ready to book
          </p>
          <h3 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight">
            Setup complete.
          </h3>
          <p className="text-[13px] text-gray-300 mt-1">
            Your setup is complete. You can now book daycare, boarding, training, and other services.
          </p>
        </div>
        {onBook && (
          <button onClick={onBook} data-testid="portal-setup-book-now"
                  className="bg-shGreen text-bgHeader px-5 py-3 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition">
            <i className="fas fa-paw mr-2"/>Book a Service
          </button>
        )}
      </div>
    </div>
  );
}
