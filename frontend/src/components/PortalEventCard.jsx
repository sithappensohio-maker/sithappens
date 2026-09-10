// Client portal Home — the next upcoming public event, with a one-tap way to
// preregister (the event page prefills a signed-in client). Renders nothing
// when no event is published, so Home is unchanged the rest of the year.
import { Link } from "react-router-dom";
import { usePublicEvents, eventHref, fmtEventShort } from "../public/publicEvents";

export default function PortalEventCard() {
  const events = usePublicEvents();
  const ev = events && events[0];
  if (!ev) return null;
  return (
    <div className="mb-4 sm:mb-6 rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3"
         style={{ borderColor: "rgba(242,101,34,.45)", background: "linear-gradient(120deg, rgba(242,101,34,.12), rgba(140,198,63,.08))" }}
         data-testid="portal-upcoming-event">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange"><i className="fas fa-calendar-day mr-1.5" />{ev.admission === "free" ? "Free event" : "Upcoming event"} · {fmtEventShort(ev)}</p>
        <p className="text-[18px] sm:text-[20px] font-black text-white leading-tight mt-1" data-testid="portal-upcoming-event-name">{ev.name}</p>
        <p className="text-[13px] text-shTextMuted mt-1">{ev.registration_closed ? "Preregistration has closed. Walk-ins welcome on the day." : "Preregister in a minute. We'll fill in your details and your dogs."}</p>
      </div>
      <Link to={eventHref(ev)} data-testid="portal-upcoming-event-cta"
            className="shrink-0 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-full bg-shGreen text-bgHeader font-black text-[13px] uppercase tracking-widest">
        <i className="fas fa-paw" />{ev.registration_closed ? "Event details" : "Preregister free"}
      </Link>
    </div>
  );
}
