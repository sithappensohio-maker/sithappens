/* Focused Client Usability phase — "What You Need to Do".
 *
 * One prominent card at the top of client Home showing ONLY the single
 * highest-priority relevant action, in this fixed order:
 *   1. Finish required account setup
 *   2. Add missing emergency-contact information
 *   3. Add required dog information
 *   4. Sign a required waiver
 *   5. Upload a missing or expired vaccine (or complete an assigned form)
 *   6. Pay an overdue / checkout-blocking amount
 *   7. Review a booking problem, rejection, or waitlist result
 *   8. View a pending booking request
 *   9. Read an unread staff message
 *   10. View the next appointment (fallback), else a simple welcome state
 *
 * Reuses the SAME setup-status data (label/blurb/action_label per step)
 * that PortalSetupChecklist already computes server-side — no new backend
 * calls, no duplicated business logic, just one place that decides which
 * single thing to show first.
 */
import { bookingStatusLabel } from "../lib/clientLabels";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const REJECTED_SEEN_KEY = "sh_needs_attention_rejected_seen_v1";

function readSeenRejected() {
  try {
    return new Set(JSON.parse(localStorage.getItem(REJECTED_SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function markRejectedBookingSeen(bookingId) {
  try {
    const seen = readSeenRejected();
    seen.add(bookingId);
    localStorage.setItem(REJECTED_SEEN_KEY, JSON.stringify([...seen]));
  } catch { /* best-effort only */ }
}

function friendlyDate(value) {
  if (!value) return "";
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (isoDay(date) === isoDay(today)) return "Today";
  if (isoDay(date) === isoDay(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

const titleCase = (value = "") => String(value).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function buildNeedsAttention({
  setupStatus, client, dogs = [], bookings = [], messagesUnread = 0,
}) {
  const steps = setupStatus?.steps || [];
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  const firstDog = dogs[0];

  // 1. Account setup (owner contact info)
  const clientInfo = byId.client_info;
  if (clientInfo && clientInfo.status !== "complete") {
    return {
      kind: "setup", icon: "fa-user-pen", tone: "orange",
      title: "Finish setting up your account",
      text: "We need a little more contact information before you can book.",
      entity: null, actionLabel: clientInfo.action_label || "Update Contact Info", actionTarget: "profile",
    };
  }

  // 2. Emergency contact
  const emergency = byId.emergency;
  if (emergency && emergency.status !== "complete") {
    return {
      kind: "setup", icon: "fa-phone", tone: "orange",
      title: "Add an emergency contact",
      text: "Someone we can reach if we can't reach you.",
      entity: null, actionLabel: emergency.action_label || "Add Emergency Contact", actionTarget: "profile",
    };
  }

  // 3. Dog info
  const dogInfo = byId.dog_info;
  if (dogInfo && dogInfo.status !== "complete") {
    const missingWho = (dogInfo.missing || [])[0];
    return {
      kind: "setup", icon: "fa-dog", tone: "orange",
      title: dogs.length === 0 ? "Add your dog" : "Finish your dog's profile",
      text: dogs.length === 0
        ? "Add your dog so you can start booking services."
        : (missingWho ? `${missingWho} — a few details are still missing.` : "A few details are still missing."),
      entity: firstDog ? { label: firstDog.name } : null,
      actionLabel: dogInfo.action_label || "Add Dog Profile", actionTarget: "dogs",
    };
  }

  // 4. Waiver
  const waiver = byId.waiver;
  if (waiver && waiver.status !== "complete") {
    return {
      kind: "setup", icon: "fa-file-signature", tone: "orange",
      title: "Sign our waiver",
      text: "A quick e-signature is required before your dog's first visit.",
      entity: null, actionLabel: waiver.action_label || "Review & Sign Waiver", actionTarget: "waiver",
    };
  }

  // 5. Vaccine records still needing the client to act (not just pending review)
  const vaccines = byId.vaccines;
  if (vaccines && (vaccines.missing || []).length > 0) {
    const first = vaccines.missing[0];
    return {
      kind: "setup", icon: "fa-shield-virus", tone: "orange",
      title: "Upload a vaccine record",
      text: `${first} needs a current record before your dog's next visit.`,
      entity: null, actionLabel: vaccines.action_label || "Upload Vaccine Records", actionTarget: "vaccines",
    };
  }

  // 5b. Assigned required forms (same "must finish before booking" tier)
  const intake = byId.intake_forms;
  if (intake && intake.status !== "complete" && !intake.optional) {
    return {
      kind: "setup", icon: "fa-clipboard-list", tone: "orange",
      title: "Complete a required form",
      text: intake.blurb || "Sit Happens needs one more form from you before booking.",
      entity: null, actionLabel: intake.action_label || "Complete Required Forms", actionTarget: "intake",
    };
  }

  // 6. Amount due
  const balance = Number(client?.account_balance || 0);
  if (balance > 0.005) {
    return {
      kind: "payment", icon: "fa-file-invoice-dollar", tone: "orange",
      title: "You have an amount due",
      text: "Pay online now, or settle up next time you stop in.",
      entity: { label: money(balance) }, amount: balance,
      actionLabel: "Pay Now", actionTarget: "payment",
    };
  }

  // 7. Booking problem / rejection / waitlist result the client hasn't seen yet
  const seenRejected = readSeenRejected();
  const rejected = bookings
    .filter((b) => b.status === "rejected" && !seenRejected.has(b.id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
  if (rejected) {
    return {
      kind: "booking_problem", icon: "fa-triangle-exclamation", tone: "orange", bookingId: rejected.id,
      title: "We couldn't confirm a recent request",
      text: `${bookingStatusLabel("rejected")} — see the details and what to do next.`,
      entity: { label: `${titleCase(rejected.service_type)} for ${rejected.dog_name || firstDog?.name || "your dog"}`, date: friendlyDate(rejected.date) },
      actionLabel: "Review Request", actionTarget: "booking", bookingIdForAction: rejected.id,
    };
  }

  // 8. Pending booking request awaiting confirmation
  const pending = bookings
    .filter((b) => b.status === "pending")
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))[0];
  if (pending) {
    return {
      kind: "booking_pending", icon: "fa-hourglass-half", tone: "blue",
      title: "Your request is waiting for confirmation",
      text: bookingStatusLabel("pending"),
      entity: { label: `${titleCase(pending.service_type)} for ${pending.dog_name || firstDog?.name || "your dog"}`, date: friendlyDate(pending.date) },
      actionLabel: "View Request", actionTarget: "booking", bookingIdForAction: pending.id,
    };
  }

  // 9. Unread staff message
  if (messagesUnread > 0) {
    return {
      kind: "messages", icon: "fa-comments", tone: "blue",
      title: messagesUnread === 1 ? "You have an unread message" : `You have ${messagesUnread} unread messages`,
      text: "Sit Happens sent you an update.",
      entity: null, actionLabel: "Read Message", actionTarget: "messages",
    };
  }

  // 10. Next appointment (fallback)
  const today = new Date().toISOString().slice(0, 10);
  const next = bookings
    .filter((b) => ["approved", "pending"].includes(b.status) && (b.end_date || b.date || "") >= today)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))[0];
  if (next) {
    return {
      kind: "next_appointment", icon: "fa-calendar-day", tone: "green",
      title: `${next.dog_name || firstDog?.name || "Your dog"}'s next visit is ${friendlyDate(next.date)}`,
      text: next.status === "pending" ? bookingStatusLabel("pending") : "You're all set for this visit.",
      entity: { label: titleCase(next.service_type), date: friendlyDate(next.date) },
      actionLabel: "View Details", actionTarget: "booking", bookingIdForAction: next.id,
    };
  }

  // Simple welcome state — nothing needs attention right now.
  return {
    kind: "welcome", icon: "fa-paw", tone: "green",
    title: dogs.length ? "You're all caught up" : "Welcome to Sit Happens",
    text: dogs.length ? "Nothing needs your attention right now." : "Add your dog to get started.",
    entity: null,
    actionLabel: dogs.length ? "Book a Service" : "Add Your Dog",
    actionTarget: dogs.length ? "book" : "dogs",
  };
}

const TONE_STYLES = {
  orange: { border: "border-shOrange/45", bg: "bg-shOrange/10", text: "text-shOrange", button: "bg-shOrange text-white" },
  blue: { border: "border-shBlue/45", bg: "bg-shBlue/10", text: "text-shBlue", button: "bg-shBlue text-white" },
  green: { border: "border-shGreen/45", bg: "bg-shGreen/10", text: "text-shGreen", button: "bg-shGreen text-bgHeader" },
};

export default function PortalNeedsAttentionCard({
  setupStatus, client, dogs, bookings, messagesUnread, onAction,
}) {
  const item = buildNeedsAttention({ setupStatus, client, dogs, bookings, messagesUnread });
  const tone = TONE_STYLES[item.tone] || TONE_STYLES.green;

  const handlePrimaryAction = () => {
    if (item.bookingIdForAction && item.kind === "booking_problem") {
      markRejectedBookingSeen(item.bookingIdForAction);
    }
    onAction?.(item.actionTarget, { bookingId: item.bookingIdForAction });
  };

  return (
    <div className={`mb-4 sm:mb-6 rounded-2xl border ${tone.border} ${tone.bg} p-4 sm:p-5 shadow-sh`}
         data-testid="portal-needs-attention-card" data-kind={item.kind}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className={`w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-full ${tone.bg} border ${tone.border} ${tone.text} grid place-items-center text-xl sm:text-2xl`}>
          <i className={`fas ${item.icon}`}/>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[12px] font-black uppercase tracking-[0.15em] ${tone.text}`}>
            {item.kind === "welcome" ? "Welcome" : "What you need to do"}
          </p>
          <h2 className="text-[18px] sm:text-xl font-bold text-shText mt-1 leading-snug">{item.title}</h2>
          <p className="text-[15px] text-shTextMuted mt-1 leading-relaxed">{item.text}</p>
          {item.entity && (
            <p className="text-[15px] text-shText font-semibold mt-1.5" data-testid="portal-needs-attention-entity">
              {item.entity.label}{item.entity.date ? ` · ${item.entity.date}` : ""}
            </p>
          )}
        </div>
        <button type="button" onClick={handlePrimaryAction} data-testid="portal-needs-attention-action"
                className={`${tone.button} min-h-[46px] px-5 py-3 rounded-xl font-black uppercase tracking-widest text-[14px] shadow-sh hover:brightness-110 active:scale-[0.98] transition shrink-0 w-full sm:w-auto`}>
          {item.actionLabel}<i className="fas fa-arrow-right ml-2"/>
        </button>
      </div>
    </div>
  );
}
