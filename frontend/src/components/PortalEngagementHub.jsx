import { useMemo } from "react";
import NeonEdge from "./premium/NeonEdge";
import NeonIconStage from "./premium/NeonIconStage";
import MiniActionCard from "./premium/MiniActionCard";
import EmptyState from "./premium/EmptyState";
import { accentRgb, HOVER_BORDER_CLASS } from "./premium/tokens";

/* Existing "tone" names (green/blue/orange/purple/gray) predate the
 * premium accent system's names (lime/cyan/orange/purple/neutral) — this
 * maps one to the other so TONES-driven content can feed the new shared
 * components without renaming every call site that already passes tone. */
const TONE_ACCENT = { green: "lime", blue: "cyan", orange: "orange", purple: "purple", gray: "neutral" };

const REQUIRED_VACCINES = ["rabies", "bordetella", "dhpp"];

const toDate = (value) => {
  if (!value) return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isoDay = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const titleCase = (value = "") => String(value)
  .replace(/_/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase());

const friendlyDate = (value) => {
  const date = toDate(value);
  if (!date) return "Date not set";
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (isoDay(date) === isoDay(today)) return "Today";
  if (isoDay(date) === isoDay(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
};


export function isActiveOnPremisesBooking(booking, today = isoDay()) {
  if (!booking?.checked_in_at || booking?.checked_out_at) return false;

  const status = String(booking.status || "").toLowerCase();
  // Only an approved (or legacy checked_in) booking can represent a real
  // on-premises visit. A pending/cancelled/completed row with an old timestamp
  // must never leak into the client-facing status.
  if (!["approved", "checked_in"].includes(status)) return false;

  // A stale check-in timestamp by itself must never make the portal say a dog
  // is currently on site. The booking also has to cover the current business
  // day. This protects client previews from old/incomplete checkout records and
  // future bookings that were accidentally stamped with checked_in_at.
  const start = String(booking.date || "").slice(0, 10);
  const end = String(booking.end_date || booking.date || "").slice(0, 10);
  if (!start || !end) return false;
  return start <= today && today <= end;
}


export function scopeBookingsToDogs(bookings = [], dogs = []) {
  const dogIds = new Set((dogs || []).map((dog) => String(dog?.id || "")).filter(Boolean));
  if (!dogIds.size) return [];
  return (bookings || []).filter((booking) => dogIds.has(String(booking?.dog_id || "")));
}

const relativeTime = (value) => {
  const date = toDate(value);
  if (!date) return "Recently";
  const now = Date.now();
  const diff = now - date.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return future ? `In ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `In ${hours} hr${hours === 1 ? "" : "s"}` : `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return future ? `In ${days} day${days === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"} ago`;
  return friendlyDate(value);
};

export function getDogPortalSnapshot(dog, bookings = [], homework = []) {
  const today = isoDay();
  const dogBookings = bookings.filter((b) => String(b.dog_id || "") === String(dog.id || ""));
  const activeVisit = dogBookings.find((b) => isActiveOnPremisesBooking(b, today));
  const upcoming = dogBookings
    .filter((b) => ["pending", "approved"].includes(b.status) && (b.end_date || b.date || "") >= today)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))[0];
  const missingVaccines = REQUIRED_VACCINES.filter((key) => {
    const exp = dog?.vaccines?.[key];
    return !exp || String(exp).slice(0, 10) < today;
  });
  const activeHomework = homework.filter((h) => h.dog_id === dog.id && h.status !== "completed");

  let status = "Profile ready";
  let tone = "green";
  let icon = "fa-circle-check";
  if (activeVisit) {
    status = `Checked in for ${titleCase(activeVisit.service_type)}`;
    tone = "blue";
    icon = "fa-location-dot";
  } else if (missingVaccines.length) {
    status = `${missingVaccines.length} vaccine record${missingVaccines.length === 1 ? "" : "s"} needed`;
    tone = "orange";
    icon = "fa-shield-virus";
  } else if (activeHomework.length) {
    status = `${activeHomework.length} training task${activeHomework.length === 1 ? "" : "s"} active`;
    tone = "purple";
    icon = "fa-graduation-cap";
  } else if (upcoming) {
    status = `${titleCase(upcoming.service_type)} ${friendlyDate(upcoming.date)}`;
    tone = upcoming.status === "pending" ? "orange" : "green";
    icon = "fa-calendar-check";
  }

  return { dog, activeVisit, upcoming, missingVaccines, activeHomework, status, tone, icon };
}

export function buildPortalPriority({
  dogs = [], bookings = [], homework = [], messagesUnread = 0,
  setupStatus = null, credits = 0, trainingCredits = 0, boardingCredits = 0,
  showMessages = true, showHomework = true, showCredits = true,
}) {
  const today = isoDay();
  const firstDog = dogs[0];
  const portalBookings = scopeBookingsToDogs(bookings, dogs);

  // The compact "Action Needed" banner in Portal.jsx already owns this
  // message when setup is locked — falling through here (instead of
  // returning early) avoids showing the same "Finish your setup" copy
  // twice on Home.
  if (showMessages && messagesUnread > 0) {
    return {
      kind: "messages", tone: "orange", icon: "fa-comments",
      eyebrow: "New message",
      title: `You have ${messagesUnread} unread message${messagesUnread === 1 ? "" : "s"}`,
      text: "Open the conversation to see the latest update from Sit Happens.",
      button: "Read messages",
    };
  }

  const checkedIn = portalBookings.find((b) => isActiveOnPremisesBooking(b, today));
  if (checkedIn) {
    return {
      kind: "bookings", tone: "blue", icon: "fa-paw",
      eyebrow: "Happening now",
      title: `${checkedIn.dog_name || firstDog?.name || "Your dog"} is checked in`,
      text: `${titleCase(checkedIn.service_type)} is underway. Visit details and care updates will appear with the booking.`,
      button: "View today’s visit",
    };
  }

  const recentReport = portalBookings
    .filter((b) => b.report_card)
    .sort((a, b) => String(b.report_card?.created_at || b.checked_out_at || b.date || "").localeCompare(String(a.report_card?.created_at || a.checked_out_at || a.date || "")))[0];
  if (recentReport) {
    const stamp = recentReport.report_card?.created_at || recentReport.checked_out_at || `${recentReport.date}T12:00:00`;
    const ageMs = Date.now() - (toDate(stamp)?.getTime() || 0);
    if (ageMs >= 0 && ageMs <= 4 * 24 * 60 * 60 * 1000) {
      const photoCount = recentReport.report_card?.photos?.length || 0;
      return {
        kind: "report", tone: "green", icon: "fa-camera-retro",
        eyebrow: "New from Sit Happens",
        title: `${recentReport.dog_name || "Your dog"}’s Pup Report Card is ready`,
        text: photoCount ? `${photoCount} photo${photoCount === 1 ? "" : "s"}, mood notes, and visit details are waiting for you.` : "See how the visit went and read the staff note.",
        button: "View report card",
      };
    }
  }

  const activeHomework = showHomework
    ? homework.filter((h) => h.status !== "completed")
      .sort((a, b) => String(a.due_date || "9999-12-31").localeCompare(String(b.due_date || "9999-12-31")))[0]
    : null;
  if (activeHomework) {
    return {
      kind: "homework", tone: "purple", icon: "fa-graduation-cap",
      eyebrow: "Training next step",
      title: `${activeHomework.dog_name || firstDog?.name || "Your dog"}: ${activeHomework.title || "Training homework"}`,
      text: activeHomework.due_date ? `Due ${friendlyDate(activeHomework.due_date)}. Open the plan for today’s instructions and progress.` : "Open the plan for today’s instructions and progress.",
      button: "Open homework",
    };
  }

  const upcoming = portalBookings
    .filter((b) => ["pending", "approved"].includes(b.status) && (b.end_date || b.date || "") >= today)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))[0];
  if (upcoming) {
    return {
      kind: "bookings", tone: upcoming.status === "pending" ? "orange" : "blue", icon: "fa-calendar-day",
      eyebrow: upcoming.status === "pending" ? "Waiting for approval" : "Coming up",
      title: `${upcoming.dog_name || firstDog?.name || "Your dog"} has ${titleCase(upcoming.service_type)} ${friendlyDate(upcoming.date)}`,
      text: upcoming.status === "pending" ? "Your request is in. You can review the details while Sit Happens confirms it." : "Review the visit details now so drop-off is easy.",
      button: "View booking",
    };
  }

  const serviceBalances = [
    { name: "daycare", value: Number(credits || 0) },
    { name: "training", value: Number(trainingCredits || 0) },
    { name: "boarding", value: Number(boardingCredits || 0) },
  ].filter((row) => row.value > 0 && row.value <= 1);
  if (showCredits && serviceBalances.length) {
    const low = serviceBalances[0];
    return {
      kind: "credits", tone: "orange", icon: "fa-wallet",
      eyebrow: "Running low",
      title: `You have ${low.value} ${titleCase(low.name)} credit${low.value === 1 ? "" : "s"} left`,
      text: "Check your balance before the next visit so there are no surprises.",
      button: "View credits",
    };
  }

  return {
    kind: "book", tone: "green", icon: "fa-calendar-plus",
    eyebrow: dogs.length ? "Ready when you are" : "Let’s get started",
    title: dogs.length ? `Plan ${firstDog?.name || "your dog"}’s next visit` : "Add your dog to begin",
    text: dogs.length ? "There are no upcoming visits. Booking daycare, boarding, or training starts here." : "Once your dog is added, the portal will guide you through the remaining setup steps.",
    button: dogs.length ? "Book a service" : "Add a dog",
  };
}

export function buildPortalActivity({ bookings = [], dogs = null, homework = [], trophies = { client_trophies: [], dog_trophies: [] } }) {
  const items = [];
  const portalBookings = Array.isArray(dogs) ? scopeBookingsToDogs(bookings, dogs) : bookings;

  portalBookings.forEach((b) => {
    if (b.report_card) {
      items.push({
        id: `report-${b.id}`, kind: "report", icon: "fa-camera-retro", tone: "green",
        title: `${b.dog_name || "Your dog"} received a Pup Report Card`,
        text: b.report_card?.photos?.length ? `${b.report_card.photos.length} photo${b.report_card.photos.length === 1 ? "" : "s"} included` : "Visit note ready to view",
        ts: b.report_card?.created_at || b.checked_out_at || `${b.date}T18:00:00`,
      });
    }
    else if (isActiveOnPremisesBooking(b)) {
      items.push({
        id: `checkin-${b.id}`, kind: "bookings", icon: "fa-location-dot", tone: "blue",
        title: `${b.dog_name || "Your dog"} checked in`,
        text: titleCase(b.service_type), ts: b.checked_in_at,
      });
    } else if (b.checked_out_at) {
      items.push({
        id: `checkout-${b.id}`, kind: "bookings", icon: "fa-house", tone: "blue",
        title: `${b.dog_name || "Your dog"} checked out`,
        text: `${titleCase(b.service_type)} visit completed`, ts: b.checked_out_at,
      });
    } else if (["approved", "pending", "rejected", "cancelled"].includes(b.status)) {
      const verb = { approved: "was approved", pending: "was requested", rejected: "could not be approved", cancelled: "was cancelled" }[b.status];
      items.push({
        id: `booking-${b.id}`, kind: "bookings", icon: "fa-calendar-day", tone: b.status === "approved" ? "green" : b.status === "pending" ? "orange" : "gray",
        title: `${b.dog_name || "Your dog"}’s ${titleCase(b.service_type)} ${verb}`,
        text: friendlyDate(b.date), ts: b.created_at || `${b.date}T12:00:00`,
      });
    }
  });

  homework.forEach((h) => {
    items.push({
      id: `homework-${h.id}`, kind: "homework", icon: h.status === "completed" ? "fa-circle-check" : "fa-graduation-cap", tone: h.status === "completed" ? "green" : "purple",
      title: h.status === "completed" ? `${h.dog_name || "Your dog"} completed ${h.title || "homework"}` : `${h.title || "Training homework"} was assigned to ${h.dog_name || "your dog"}`,
      text: h.status === "completed" ? "Training progress updated" : (h.due_date ? `Due ${friendlyDate(h.due_date)}` : "Open for instructions"),
      ts: h.completed_at || h.created_at,
    });
  });

  [...(trophies.client_trophies || []), ...(trophies.dog_trophies || [])].forEach((t) => {
    items.push({
      id: `trophy-${t.id}`, kind: "rewards", icon: t.trophy_icon || "fa-trophy", tone: "orange",
      title: `${t.recipient_name || "You"} earned “${t.trophy_name || "a new trophy"}”`,
      text: t.trophy_description || "Achievement unlocked",
      ts: t.awarded_at,
    });
  });

  return items
    .filter((item) => toDate(item.ts))
    .sort((a, b) => (toDate(b.ts)?.getTime() || 0) - (toDate(a.ts)?.getTime() || 0))
    .slice(0, 6);
}

const TONES = {
  green: {
    text: "text-shGreen", border: "border-shGreen/45", bg: "from-shGreen/20", button: "bg-shGreen text-bgHeader",
    hover: "hover:border-shGreen/60 hover:shadow-[0_0_18px_-6px_rgba(140,198,63,0.35)]", glow: "140,198,63",
  },
  blue: {
    text: "text-shBlue", border: "border-shBlue/45", bg: "from-shBlue/20", button: "bg-shBlue text-white",
    hover: "hover:border-shBlue/60 hover:shadow-[0_0_18px_-6px_rgba(0,169,224,0.35)]", glow: "0,169,224",
  },
  orange: {
    text: "text-shOrange", border: "border-shOrange/45", bg: "from-shOrange/20", button: "bg-shOrange text-bgHeader",
    hover: "hover:border-shOrange/60 hover:shadow-[0_0_18px_-6px_rgba(242,101,34,0.35)]", glow: "242,101,34",
  },
  purple: {
    text: "text-purple-300", border: "border-purple-500/45", bg: "from-purple-500/20", button: "bg-purple-500 text-white",
    hover: "hover:border-purple-400/60 hover:shadow-[0_0_18px_-6px_rgba(168,85,247,0.35)]", glow: "168,85,247",
  },
  gray: {
    text: "text-gray-300", border: "border-bgHover", bg: "from-bgHover/40", button: "bg-bgHover text-white",
    hover: "hover:border-gray-400/40", glow: "148,163,184",
  },
};

function runPriorityAction(kind, actions) {
  const map = {
    setup: actions.onSetup,
    messages: actions.onMessages,
    bookings: actions.onBookings,
    report: actions.onReportCards || actions.onBookings,
    homework: actions.onHomework,
    credits: actions.onCredits,
    rewards: actions.onRewards,
    book: actions.onBook,
  };
  map[kind]?.();
}

export default function PortalEngagementHub({
  dogs = [], bookings = [], homework = [], trophies = { client_trophies: [], dog_trophies: [] },
  setupStatus, messagesUnread = 0, credits = 0, trainingCredits = 0, boardingCredits = 0,
  showMessages = true, showHomework = true, showCredits = true, showRewards = true, showUpload = true,
  showReferral = false, hidePriorityCard = false,
  onSetup, onMessages, onBookings, onReportCards, onHomework, onCredits, onRewards, onBook,
  onUpload, onHelp, onDogOpen, onRefer,
}) {
  const priority = useMemo(() => buildPortalPriority({
    dogs, bookings, homework, messagesUnread, setupStatus, credits, trainingCredits, boardingCredits,
    showMessages, showHomework, showCredits,
  }), [dogs, bookings, homework, messagesUnread, setupStatus, credits, trainingCredits, boardingCredits, showMessages, showHomework, showCredits]);

  const portalBookings = useMemo(() => scopeBookingsToDogs(bookings, dogs), [bookings, dogs]);
  const activity = useMemo(() => buildPortalActivity({ bookings: portalBookings, dogs, homework: showHomework ? homework : [], trophies: showRewards ? trophies : { client_trophies: [], dog_trophies: [] } }), [portalBookings, dogs, homework, trophies, showHomework, showRewards]);
  const dogSnapshots = useMemo(() => dogs.map((dog) => getDogPortalSnapshot(dog, portalBookings, showHomework ? homework : [])), [dogs, portalBookings, homework, showHomework]);
  const tone = TONES[priority.tone] || TONES.green;
  const actionCount = 1 + (showMessages ? 1 : 0) + (showUpload ? 1 : 0) + (showCredits ? 1 : 0)
    + (showRewards ? 1 : 0) + (showReferral ? 1 : 0) + (onHelp ? 1 : 0);
  const actions = { onSetup, onMessages, onBookings, onReportCards, onHomework, onCredits, onRewards, onBook };

  return (
    <section className="mb-6 space-y-4" data-testid="portal-engagement-hub" aria-label="Your portal overview">
      {!hidePriorityCard && (
      <NeonEdge accentRgb={accentRgb(TONE_ACCENT[priority.tone] || "lime")} intensity="hero"
                className="p-5 sm:p-6" data-testid="portal-priority-card">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-4">
          <NeonIconStage icon={priority.icon} accentRgb={accentRgb(TONE_ACCENT[priority.tone] || "lime")} strong
                         sizeClass="w-16 h-16 sm:w-24 sm:h-24" iconSizeClass="text-2xl sm:text-4xl" />
          <div className="min-w-0 flex-1">
            <p className={`text-[11px] font-black uppercase tracking-[0.2em] ${tone.text}`}>{priority.eyebrow}</p>
            <h2 className="text-xl sm:text-2xl font-bold text-shText mt-1 leading-tight">{priority.title}</h2>
            <p className="text-[14px] text-shTextMuted mt-1.5 leading-relaxed">{priority.text}</p>
          </div>
          <button type="button" onClick={() => runPriorityAction(priority.kind, actions)} data-testid={`portal-priority-${priority.kind}`}
                  className={`${tone.button} min-h-[46px] px-5 py-3 rounded-xl font-black uppercase tracking-widest text-[13px] shadow-sh hover:brightness-110 hover:-translate-y-0.5 active:scale-[0.98] transition duration-200 shrink-0`}>
            {priority.button}<i className="fas fa-arrow-right ml-2"/>
          </button>
        </div>
      </NeonEdge>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <NeonEdge accentRgb={accentRgb("lime")} intensity="standard" className="relative lg:col-span-3 p-4 sm:p-5" data-testid="portal-dog-overview">
          <i className="fas fa-paw absolute -right-4 -bottom-6 text-[110px] leading-none opacity-[0.04] text-shPrimary pointer-events-none select-none" aria-hidden="true"/>
          <div className="relative z-10 flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-[15px] font-bold text-shText">My Dogs</h3>
            </div>
            <button type="button" onClick={() => document.getElementById("portal-dogs-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="text-[11px] font-black uppercase tracking-widest text-shPrimary hover:underline">
              Manage
            </button>
          </div>
          {dogSnapshots.length === 0 ? (
            <div className="relative z-10">
              <EmptyState
                icon="fa-paw" accent="lime" onClick={onBook}
                title="You haven't added any dogs yet."
                description="Add your dog to book services, manage records and track their progress."
                ctaLabel="Add Your First Dog"
              />
            </div>
          ) : (
            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {dogSnapshots.slice(0, 4).map((row) => {
                const dogAccent = TONE_ACCENT[row.tone] || "lime";
                return (
                  <NeonEdge key={row.dog.id} as="button" onClick={() => onDogOpen?.(row.dog)} data-testid={`portal-overview-dog-${row.dog.id}`}
                            accentRgb={accentRgb(dogAccent)} intensity="subtle"
                            className={`min-w-0 text-left p-3 flex items-center gap-3 transition duration-200 hover:-translate-y-0.5 ${HOVER_BORDER_CLASS[dogAccent] || ""}`}>
                    {row.dog.photo ? (
                      <img src={row.dog.photo} alt="" className="relative z-10 w-11 h-11 rounded-full object-cover border border-shBorder shrink-0"/>
                    ) : (
                      <span className="relative z-10 shrink-0">
                        <NeonIconStage icon="fa-paw" accentRgb={accentRgb(dogAccent)} rings={false} sizeClass="w-11 h-11" iconSizeClass="text-base" />
                      </span>
                    )}
                    <span className="relative z-10 min-w-0 flex-1">
                      <span className="block text-shText font-bold truncate">{row.dog.name}</span>
                      <span className="block text-[12px] font-semibold mt-0.5 truncate" style={{ color: `rgb(${accentRgb(dogAccent)})` }}><i className={`fas ${row.icon} mr-1.5`}/>{row.status}</span>
                    </span>
                    <i className="relative z-10 fas fa-chevron-right text-shTextMuted text-xs shrink-0"/>
                  </NeonEdge>
                );
              })}
            </div>
          )}
        </NeonEdge>

        <NeonEdge accentRgb={accentRgb("cyan")} intensity="standard" className="relative lg:col-span-2 p-4 sm:p-5" data-testid="portal-essential-actions">
          <h3 className="relative z-10 text-[15px] font-bold text-shText mb-3">Quick Actions</h3>
          <div className="relative z-10 grid grid-cols-2 gap-2">
            <MiniActionCard icon={dogs.length ? "fa-calendar-plus" : "fa-paw"} label={dogs.length ? "Book" : "Add Dog"} onClick={onBook} accent="lime" testid="portal-action-book"/>
            {showMessages && <MiniActionCard icon="fa-comments" label="Message Us" onClick={onMessages} accent="cyan" badge={messagesUnread} testid="portal-action-messages"/>}
            {showUpload && <MiniActionCard icon="fa-file-arrow-up" label="Upload Records" onClick={onUpload} accent="cyan" testid="portal-action-upload"/>}
            {showCredits && <MiniActionCard icon="fa-wallet" label="Credits" onClick={onCredits} accent="purple" testid="portal-action-credits"/>}
            {/* Sprint 110ff — Rewards and Refer-a-Friend were already wired
                through as props (used by the priority card + activity feed)
                but never actually got a button here, so they had no real
                entry point on the page a client would ever see. */}
            {showRewards && <MiniActionCard icon="fa-trophy" label="Rewards" onClick={onRewards} accent="amber" testid="portal-action-rewards"/>}
            {showReferral && <MiniActionCard icon="fa-gift" label="Refer a Friend" onClick={onRefer} accent="orange" testid="portal-action-refer"/>}
            {onHelp && <MiniActionCard icon="fa-circle-question" label="Get Help" onClick={onHelp} accent="neutral" testid="portal-action-help" wide={actionCount % 2 === 1}/>}
          </div>
        </NeonEdge>
      </div>

      <NeonEdge accentRgb={accentRgb("neutral")} intensity="subtle" className="p-4 sm:p-5" data-testid="portal-recent-activity">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-[15px] font-bold text-shText">Recent Activity</h3>
          <button type="button" onClick={onBookings} className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline">All bookings <i className="fas fa-arrow-right ml-1"/></button>
        </div>
        {activity.length === 0 ? (
          <div className="border border-dashed border-shBorder rounded-xl p-5 text-center">
            <i className="fas fa-bell text-shTextMuted text-2xl"/>
            <p className="text-shText font-bold text-[14px] mt-2">Nothing new yet</p>
            <p className="text-[13px] text-shTextMuted mt-1">Booking updates, report cards, training progress, and rewards will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-shBorder">
            {activity.map((item) => {
              const itemTone = TONES[item.tone] || TONES.gray;
              return (
                <button key={item.id} type="button" onClick={() => runPriorityAction(item.kind, actions)}
                        className="w-full text-left py-3 first:pt-0 last:pb-0 flex items-start gap-3 group transition duration-200 hover:-translate-y-0.5">
                  <span className={`w-9 h-9 rounded-full bg-[var(--sh-card-base)] border ${itemTone.border} ${itemTone.text} grid place-items-center shrink-0 mt-0.5`}><i className={`fas ${item.icon}`}/></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-shText font-semibold leading-snug group-hover:text-shPrimary transition">{item.title}</span>
                    <span className="block text-[12px] text-shTextMuted mt-0.5 truncate">{item.text}</span>
                  </span>
                  <span className="text-[11px] text-shTextMuted whitespace-nowrap mt-1">{relativeTime(item.ts)}</span>
                </button>
              );
            })}
          </div>
        )}
      </NeonEdge>
    </section>
  );
}
