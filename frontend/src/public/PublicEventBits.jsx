// Event surfaces that live outside the event page: the homepage banner and
// the /events index. Both read the shared upcoming-events list, so they
// appear when an event is published and disappear when it ends.
import { Link } from "react-router-dom";
import PublicSiteShell from "./PublicSiteShell";
import { Eyebrow, Title, Cta } from "./PublicBits";
import { usePublicEvents, eventHref, fmtEventWhen, fmtEventShort } from "./publicEvents";

/** Homepage banner for the next upcoming event. Renders nothing when there is none. */
export function UpcomingEventBanner() {
  const events = usePublicEvents();
  const ev = events && events[0];
  if (!ev) return null;
  const when = fmtEventWhen(ev);
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-4 mb-2" data-testid="site-event-banner">
      <div className="sh-site-band flex flex-col lg:flex-row lg:items-center gap-4" style={{ borderColor: "rgba(242,101,34,.45)" }}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange"><i className="fas fa-calendar-day mr-1.5" />{ev.admission === "free" ? "Free community event" : "Upcoming event"}{events.length > 1 ? ` · ${events.length} coming up` : ""}</p>
          <p className="sh-display text-2xl sm:text-3xl text-white leading-none mt-1.5" style={{ textWrap: "balance" }} data-testid="site-event-banner-name">{ev.name_line_1 || ev.name}{ev.name_line_2 ? <span className="text-shGreen"> {ev.name_line_2}</span> : null}</p>
          <p className="text-[14px] text-gray-200 mt-2 font-bold" data-testid="site-event-banner-when">{when.day} · {when.time}{ev.location_name ? ` · ${ev.location_name}` : ""}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <Cta color="green" to={eventHref(ev)} icon="fa-paw" testid="site-event-banner-cta">{ev.registration_closed ? "Event details" : "Preregister free"}</Cta>
          {events.length > 1 && <Cta color="ghost" to="/events" icon="fa-calendar-days" testid="site-event-banner-all">All events</Cta>}
        </div>
      </div>
    </div>
  );
}

/** /events — every published upcoming event. */
export default function PublicEvents() {
  const events = usePublicEvents();
  return (
    <PublicSiteShell testid="public-events">
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <Eyebrow icon="fa-calendar-days" color="text-shOrange">Events</Eyebrow>
        <Title as="h1">Come hang out with us.</Title>
        <p className="text-gray-300 mt-3 max-w-2xl">Community events at Sit Happens. Preregistration is free and helps us plan. Leashed dogs only, no retractable leashes.</p>
        {events === null && <p className="text-gray-400 mt-8">Loading…</p>}
        {events && events.length === 0 && <p className="text-gray-300 mt-8" data-testid="public-events-empty">Nothing on the calendar right now. Check back soon, or <Link to="/contact" className="text-shGreen font-black">get in touch</Link>.</p>}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="public-events-list">
          {(events || []).map((ev) => (
            <Link key={ev.slug} to={eventHref(ev)} className="sh-site-card block" style={{ "--card-accent": "#f26522" }} data-testid={`public-event-card-${ev.slug}`}>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange">{fmtEventShort(ev)}</p>
              <p className="sh-display text-2xl text-white leading-none mt-2">{ev.name_line_1 || ev.name}{ev.name_line_2 ? <span className="text-shGreen"> {ev.name_line_2}</span> : null}</p>
              <p className="text-[14px] text-gray-300 mt-2">{ev.location_name}{ev.admission === "free" ? " · Free admission" : ""}</p>
              <p className="mt-4 text-[13px] font-black uppercase tracking-widest text-shGreen">{ev.registration_closed ? "Details" : "Preregister free"} <i className="fas fa-arrow-right ml-1" /></p>
            </Link>
          ))}
        </div>
      </section>
    </PublicSiteShell>
  );
}
