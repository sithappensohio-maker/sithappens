// Event surfaces that live outside the event page: the homepage banner and
// the /events index. Both read the shared upcoming-events list, so they
// appear when an event is published and disappear when it ends.
import { Link } from "react-router-dom";
import PublicSiteShell from "./PublicSiteShell";
import { Eyebrow, Title, Cta } from "./PublicBits";
import { usePublicEvents, eventHref, fmtEventWhen, fmtEventShort, bannerImageUrl } from "./publicEvents";

/** Homepage banner for the next upcoming event: a loud, full-width band at
 *  the very top of the page, under the site header and above the hero, so it
 *  is the first thing anyone sees. Renders nothing when nothing is coming up. */
export function UpcomingEventBanner() {
  const events = usePublicEvents();
  const ev = events && events[0];
  if (!ev) return null;
  const when = fmtEventWhen(ev);
  const bg = bannerImageUrl(ev);
  return (
    <div className="relative overflow-hidden" data-testid="site-event-banner" data-has-image={bg ? "1" : "0"}
         style={{ background: "linear-gradient(100deg, rgba(242,101,34,.55) 0%, rgba(242,101,34,.22) 38%, rgba(140,198,63,.22) 70%, rgba(0,169,224,.28) 100%)", borderBottom: "2px solid rgba(242,101,34,.7)", boxShadow: "inset 0 -30px 60px -40px #000" }}>
      {bg ? (
        <>
          {/* the uploaded picture, then a dark wash so the words and button stay readable on any photo */}
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bg}")` }} data-testid="site-event-banner-image" />
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(90deg, rgba(3,7,30,.62) 0%, rgba(3,7,30,.38) 45%, rgba(3,7,30,.18) 100%)" }} />
        </>
      ) : (
        <div className="absolute inset-0 pointer-events-none opacity-60" style={{ background: "radial-gradient(circle at 8% 20%, rgba(242,101,34,.9) 0%, transparent 32%), radial-gradient(circle at 92% 70%, rgba(140,198,63,.7) 0%, transparent 30%)" }} />
      )}
      <div className={`relative max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7 ${bg ? "lg:py-12" : ""} flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8 ${bg ? "sh-event-banner--photo" : "sh-splatter"}`}>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] sm:text-[13px] font-black uppercase tracking-[0.3em] text-white" data-testid="site-event-banner-when">
            <span className="inline-block px-2 py-0.5 rounded-md bg-shOrange text-bgHeader mr-2 align-middle"><i className="fas fa-calendar-day mr-1.5" />{ev.admission === "free" ? "Free event" : "Event"}</span>
            <span className="align-middle">{when.day} · {when.time}</span>
          </p>
          <p className="sh-display text-[30px] sm:text-[40px] lg:text-[48px] text-white leading-[0.95] mt-2" style={{ textWrap: "balance" }} data-testid="site-event-banner-name">
            {ev.name_line_1 || ev.name}{ev.name_line_2 ? <><br className="hidden sm:block" /><span className="text-shGreen"> {ev.name_line_2}</span></> : null}
          </p>
          {ev.location_name && <p className="text-[14px] sm:text-[15px] text-gray-200 font-bold mt-2"><i className="fas fa-location-dot text-shOrange mr-1.5" />{ev.location_name}{ev.walk_ins_allowed !== false ? " · Walk-ins welcome" : ""}{ev.admission === "free" ? " · Free admission" : ""}</p>}
        </div>
        <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
          <Cta color="green" to={eventHref(ev)} icon="fa-paw" testid="site-event-banner-cta" className="min-h-[60px] text-[16px] px-8 sh-event-cta-pulse">{ev.registration_closed ? "Event details" : "Preregister free"}</Cta>
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-300">{ev.registration_closed ? "Preregistration has closed" : "Takes two minutes · No account needed"}</span>
          {events.length > 1 && <Link to="/events" className="text-[11px] font-black uppercase tracking-widest text-white underline underline-offset-4" data-testid="site-event-banner-all">All events ({events.length})</Link>}
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
