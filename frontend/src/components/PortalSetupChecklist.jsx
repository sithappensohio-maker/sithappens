import { useEffect, useState } from "react";
import { api } from "../lib/api";

const STATUS_META = {
  complete:       { label: "Complete",          cls: "bg-shGreen/15  text-shGreen border-shGreen/40",   icon: "fa-circle-check" },
  pending_review: { label: "Waiting Review",    cls: "bg-shBlue/15   text-shBlue   border-shBlue/40",   icon: "fa-clock" },
  in_progress:    { label: "Needs Attention",   cls: "bg-shOrange/15 text-shOrange border-shOrange/40", icon: "fa-circle-exclamation" },
  not_started:    { label: "Start Here",        cls: "bg-shOrange/15 text-shOrange border-shOrange/40", icon: "fa-circle-exclamation" },
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

function stepPlainEnglish(step) {
  if (!step) return "Finish the highlighted setup step so booking can unlock.";
  switch (step.id) {
    case "client_info":
      return "Confirm your name, phone, and email. This lets us contact you fast if something comes up.";
    case "dog_info":
      return "Add your dog's basic profile, notes, and anything we should know before they come in.";
    case "emergency":
      return "Add someone we can call if we cannot reach you.";
    case "vaccines":
      if (step.status === "pending_review") return "Your vaccine records are uploaded. Sit Happens just needs to review and approve them.";
      return "Upload current Rabies, Bordetella, and DHPP records for each dog.";
    case "waiver":
      return "Review and sign the required waiver. It only takes a minute.";
    case "intake_forms":
      return "Fill out any forms we assigned to your account.";
    default:
      return step.blurb || "Finish this setup item.";
  }
}

/**
 * First-time client setup checklist.
 *
 * This reuses the existing backend requirements but makes the client path much
 * more hand-holdy: one obvious next step, plain-English instructions, then the
 * full checklist for context. No booking, payment, dog, or client data is
 * changed here — this is guidance only.
 */
export default function PortalSetupChecklist({ onAction = () => {}, onHelp = null, onStatusChange = () => {}, refreshKey = 0 }) {
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
  // save) so step states catch up immediately without waiting for the 60s poll.
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
  // Don't render at all if the client is already ready (the success / app tour
  // is surfaced separately — see PortalSetupSuccess in Portal.jsx).
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
      // For `intake` we ALWAYS try to find + click the first pending "Fill out"
      // button, even if the section element isn't yet mounted.
      if (target === "intake") {
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        let tries = 0;
        const attempt = () => {
          const btns = document.querySelectorAll('[data-testid^="portal-intake-fill-"]');
          let fillBtn = null;
          btns.forEach((b) => {
            if (fillBtn) return;
            const rect = b.getBoundingClientRect();
            const style = window.getComputedStyle(b);
            const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
            if (visible) fillBtn = b;
          });
          if (fillBtn) {
            fillBtn.scrollIntoView({ behavior: "smooth", block: "center" });
            fillBtn.click();
            return;
          }
          tries += 1;
          if (tries < 6) setTimeout(attempt, 300);
        };
        setTimeout(attempt, 150);
        return;
      }
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
  const nextStep = steps.find(s => s.status !== "complete") || steps[0];
  const nextIndex = Math.max(0, steps.findIndex(s => s.id === nextStep?.id));
  const nextMeta = STATUS_META[nextStep?.status] || STATUS_META.not_started;
  const remaining = Math.max(0, total_count - completed_count);

  return (
    <div className="relative overflow-hidden bg-bgPanel border-2 border-shOrange/40 rounded-2xl p-4 sm:p-7 mb-6 shadow-2xl"
         data-testid="portal-setup-checklist">
      <div className="absolute inset-0 pointer-events-none opacity-30"
           style={{ background: "radial-gradient(circle at 10% 10%, rgba(242,101,34,0.5) 0%, transparent 40%), radial-gradient(circle at 90% 90%, rgba(140,198,63,0.35) 0%, transparent 45%)" }}/>
      <div className="relative">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-black uppercase tracking-[0.35em] text-shOrange mb-1">
              <i className="fas fa-route mr-1.5"/>Start Here · New Client Setup
            </p>
            <h2 className="text-2xl sm:text-4xl font-black text-white uppercase italic tracking-tight leading-tight">
              Finish These Steps, <span className="text-shGreen">Then Book.</span>
            </h2>
          </div>
          <span className={`shrink-0 text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${overallMeta.cls}`}
                data-testid="portal-setup-overall-badge">
            <i className={`fas ${overallMeta.icon} mr-1.5`}/>{completed_count} / {total_count} done
          </span>
        </div>

        <p className="text-[13px] sm:text-[14px] text-gray-300 mt-1 max-w-3xl leading-relaxed">
          Don&apos;t hunt around the portal. Do the green button below first, then the next one.
          Booking unlocks automatically when the required setup items are finished or approved.
        </p>

        <div className="mt-4 h-2 rounded-full bg-bgBase overflow-hidden">
          <div className={`h-full transition-all ${pct === 100 ? "bg-shGreen" : "bg-shOrange"}`}
               style={{ width: `${Math.max(pct, 4)}%` }} data-testid="portal-setup-progress"/>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4" data-testid="portal-setup-how-it-works">
          <div className="rounded-xl border border-shOrange/30 bg-bgBase/80 p-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-shOrange"><i className="fas fa-1 mr-1"/>Do Next Step</p>
            <p className="text-[12px] text-gray-400 mt-1 leading-snug">Tap the big green button. We&apos;ll open the right screen for you.</p>
          </div>
          <div className="rounded-xl border border-shBlue/30 bg-bgBase/80 p-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-shBlue"><i className="fas fa-2 mr-1"/>We Review</p>
            <p className="text-[12px] text-gray-400 mt-1 leading-snug">Vaccines may show waiting review after upload. That means you&apos;re done for now.</p>
          </div>
          <div className="rounded-xl border border-shGreen/30 bg-bgBase/80 p-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-shGreen"><i className="fas fa-3 mr-1"/>Book</p>
            <p className="text-[12px] text-gray-400 mt-1 leading-snug">When setup clears, the portal explains booking, credits, messages, and rewards.</p>
          </div>
        </div>

        {nextStep && (
          <div className="mt-5 rounded-2xl border-2 border-shGreen bg-shGreen/10 p-4 sm:p-6 shadow-2xl ring-2 ring-shGreen/20"
               data-testid="portal-setup-next-step">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="inline-flex items-center rounded-full bg-shGreen text-bgHeader px-3 py-1 text-[11px] font-black uppercase tracking-[0.25em]">
                  <i className="fas fa-arrow-right mr-1.5"/>Do This Next · Step {nextIndex + 1} of {total_count}
                </p>
                <h3 className="text-lg sm:text-2xl text-white font-black uppercase italic tracking-tight mt-1">
                  {nextStep.label}
                </h3>
                <p className="text-[13px] sm:text-[14px] text-gray-200 mt-1 leading-relaxed">
                  {stepPlainEnglish(nextStep)}
                </p>
                {nextStep.missing && nextStep.missing.length > 0 && (
                  <div className="mt-3 rounded-lg bg-bgBase/80 border border-bgHover p-3">
                    <p className="text-[11px] text-shOrange font-black uppercase tracking-widest mb-1">
                      What&apos;s missing
                    </p>
                    <ul className="space-y-1">
                      {nextStep.missing.slice(0, 5).map((m, i) => (
                        <li key={i} className="text-[12px] text-gray-300 break-words">
                          <i className="fas fa-circle-exclamation text-shOrange mr-1.5"/>{m}
                        </li>
                      ))}
                      {nextStep.missing.length > 5 && (
                        <li className="text-[12px] text-gray-500">+ {nextStep.missing.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${nextMeta.cls}`}>
                <i className={`fas ${nextMeta.icon} mr-1`}/>{nextMeta.label}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
              {nextStep.status === "pending_review" ? (
                <div data-testid="portal-setup-next-waiting"
                     className="w-full bg-shBlue/15 text-shBlue border border-shBlue/35 text-[13px] sm:text-[14px] font-black uppercase tracking-widest py-3 rounded min-h-[44px] grid place-items-center text-center">
                  <span><i className="fas fa-clock mr-2"/>Waiting on Sit Happens Review</span>
                </div>
              ) : (
                <button
                  onClick={() => goTo(nextStep.action_target)}
                  data-testid="portal-setup-next-action"
                  className="w-full bg-shGreen text-bgHeader text-[13px] sm:text-[14px] font-black uppercase tracking-widest py-3 rounded hover:bg-white active:scale-[0.98] transition min-h-[44px] shadow-lg"
                >
                  <i className="fas fa-hand-pointer mr-2"/>Tap Here: {nextStep.action_label}
                </button>
              )}
              {onHelp && (
                <button
                  onClick={onHelp}
                  data-testid="portal-setup-help-action"
                  className="w-full sm:w-auto bg-shBlue/15 text-shBlue border border-shBlue/35 text-[12px] font-black uppercase tracking-widest px-4 py-3 rounded hover:bg-shBlue/25 transition min-h-[44px]"
                >
                  <i className="fas fa-comments mr-2"/>Need Help?
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12px] font-black uppercase tracking-widest text-gray-400">
            Full setup checklist · {remaining} left
          </p>
          <p className="text-[12px] text-gray-500">
            Green means done. Orange means it needs you. Blue means Sit Happens is reviewing it.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {steps.map((s, idx) => {
            const meta = STATUS_META[s.status] || STATUS_META.not_started;
            const isComplete = s.status === "complete";
            const isNext = nextStep && s.id === nextStep.id;
            return (
              <div key={s.id}
                   data-testid={`portal-setup-step-${s.id}`}
                   className={`relative rounded-xl border p-3 sm:p-4 transition ${
                     isComplete
                       ? "bg-shGreen/5 border-shGreen/30"
                       : isNext
                         ? "bg-bgBase border-shGreen/55 ring-1 ring-shGreen/25"
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
                    <p className={`text-[15px] font-black uppercase italic tracking-tight break-words ${isComplete ? "text-shGreen" : "text-white"}`}>
                      {s.label}
                    </p>
                    <p className="text-[12px] text-gray-400 mt-0.5 leading-snug">{s.blurb}</p>
                    {!isComplete && s.missing && s.missing.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {s.missing.slice(0, 3).map((m, i) => (
                          <li key={i} className="text-[11px] text-shOrange break-words">
                            <i className="fas fa-circle-exclamation mr-1"/>{m}
                          </li>
                        ))}
                        {s.missing.length > 3 && (
                          <li className="text-[11px] text-gray-500">+ {s.missing.length - 3} more</li>
                        )}
                      </ul>
                    )}
                    {s.status === "pending_review" && (
                      <p className="text-[11px] text-shBlue mt-2 leading-snug">
                        <i className="fas fa-clock mr-1"/>We&apos;ve got your records — our team is reviewing them.
                      </p>
                    )}
                  </div>
                </div>
                {!isComplete && s.status !== "pending_review" && (
                  <button
                    onClick={() => goTo(s.action_target)}
                    data-testid={`portal-setup-step-action-${s.id}`}
                    className="mt-3 w-full bg-shGreen text-bgHeader text-[12px] sm:text-[13px] font-black uppercase tracking-widest py-2.5 sm:py-2 rounded hover:bg-shGreen/90 active:scale-[0.98] transition min-h-[40px]"
                  >
                    <i className="fas fa-arrow-right mr-2"/>{s.action_label}
                  </button>
                )}
                {!isComplete && s.status === "pending_review" && (
                  <div data-testid={`portal-setup-step-waiting-${s.id}`}
                       className="mt-3 w-full bg-shBlue/10 text-shBlue border border-shBlue/30 text-[12px] font-black uppercase tracking-widest py-2 rounded text-center">
                    <i className="fas fa-clock mr-2"/>Waiting On Review
                  </div>
                )}
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

        {booking_locked && (
          <div className="mt-5 bg-shOrange/10 border border-shOrange/30 rounded-lg p-4"
               data-testid="portal-setup-lock-message">
            <p className="text-[13px] text-shOrange font-black uppercase tracking-widest">
              <i className="fas fa-lock mr-1.5"/>Booking is locked for safety
            </p>
            <p className="text-[13px] text-gray-300 mt-1">
              Follow the big green button above. When your info, dog profile, emergency contact,
              vaccines, waiver, and any assigned forms are complete or approved, the Book button turns on automatically.
            </p>
            {onHelp && (
              <button onClick={onHelp} data-testid="portal-setup-lock-help"
                      className="mt-3 text-[12px] text-shBlue font-black uppercase tracking-widest underline decoration-dotted">
                Need help? Message Sit Happens
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const DEFAULT_OFFERINGS = [
  { id: "book", icon: "fa-calendar-plus", title: "Book Services", text: "Request daycare, boarding, training, grooming, or other services from one place." },
  { id: "bookings", icon: "fa-calendar-day", title: "See Your Schedule", text: "Check upcoming visits, past bookings, and booking status without calling in." },
  { id: "dogs", icon: "fa-dog", title: "Manage Dog Info", text: "Keep your dog's profile, notes, vaccine records, and important details updated." },
  { id: "messages", icon: "fa-comments", title: "Message Us", text: "Send questions, updates, or help requests right from the portal." },
  { id: "credits", icon: "fa-wallet", title: "Track Credits & Balances", text: "See daycare or boarding credits, payment options, and balances when available." },
  { id: "extras", icon: "fa-trophy", title: "Rewards & Fun Stuff", text: "Use trivia, rewards, report cards, photos, tips, and more when they are available." },
];

/**
 * Full success / mini-tour shown after setup unlocks booking.
 */
export function PortalSetupSuccess({ onBook, onDismiss, onHelp, dismissable = true, offerings = DEFAULT_OFFERINGS }) {
  const items = Array.isArray(offerings) && offerings.length ? offerings : DEFAULT_OFFERINGS;
  return (
    <div className="relative overflow-hidden bg-shGreen/10 border-2 border-shGreen/40 rounded-2xl p-5 sm:p-6 mb-4 shadow-2xl"
         data-testid="portal-setup-success">
      <div className="absolute inset-0 pointer-events-none opacity-25"
           style={{ background: "radial-gradient(circle at 50% 0%, rgba(140,198,63,0.7) 0%, transparent 55%), radial-gradient(circle at 0% 100%, rgba(0,169,224,0.35) 0%, transparent 45%)" }}/>
      {dismissable && onDismiss && (
        <button onClick={onDismiss} data-testid="portal-setup-success-dismiss"
                className="absolute top-2 right-2 text-gray-400 hover:text-white text-lg p-2 z-10"
                aria-label="Dismiss">
          <i className="fas fa-xmark"/>
        </button>
      )}
      <div className="relative">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
              <i className="fas fa-circle-check mr-1.5"/>Portal Unlocked
            </p>
            <h3 className="text-2xl sm:text-4xl font-black text-white uppercase italic tracking-tight leading-tight">
              You&apos;re Ready. Here&apos;s What You Can Do.
            </h3>
            <p className="text-[13px] sm:text-[15px] text-gray-300 mt-1 max-w-3xl leading-relaxed">
              Your setup is complete. Before you start clicking around, here are the main things this portal is for.
            </p>
          </div>
          {onBook && (
            <button onClick={onBook} data-testid="portal-setup-book-now"
                    className="bg-shGreen text-bgHeader px-5 py-3 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-white active:scale-[0.98] transition">
              <i className="fas fa-paw mr-2"/>Book a Service
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5" data-testid="portal-setup-app-tour">
          {items.map((item) => (
            <div key={item.id || item.title}
                 className="rounded-xl border border-bgHover bg-bgBase/80 p-4">
              <div className="w-10 h-10 rounded-lg bg-shGreen/15 text-shGreen grid place-items-center mb-3">
                <i className={`fas ${item.icon || "fa-paw"}`}/>
              </div>
              <p className="text-[13px] font-black uppercase italic tracking-tight text-white">
                {item.title}
              </p>
              <p className="text-[12px] text-gray-400 mt-1 leading-snug">
                {item.text}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-shBlue/30 bg-shBlue/10 p-4">
          <div className="min-w-0">
            <p className="text-[12px] font-black uppercase tracking-widest text-shBlue">
              <i className="fas fa-circle-question mr-1.5"/>Not sure where to start?
            </p>
            <p className="text-[12px] text-gray-300 mt-0.5">
              Book your first service or send us a message and we&apos;ll help you through it.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {onHelp && (
              <button onClick={onHelp} data-testid="portal-setup-success-help"
                      className="bg-shBlue/15 text-shBlue border border-shBlue/35 px-4 py-2.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shBlue/25 transition">
                <i className="fas fa-comments mr-2"/>Message Us
              </button>
            )}
            {dismissable && onDismiss && (
              <button onClick={onDismiss} data-testid="portal-setup-success-explore"
                      className="bg-bgPanel text-white border border-bgHover px-4 py-2.5 rounded text-[12px] font-black uppercase tracking-widest hover:border-shGreen/50 transition">
                Explore Portal
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
