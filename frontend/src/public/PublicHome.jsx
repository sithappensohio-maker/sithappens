import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import PublicSiteShell from "./PublicSiteShell";
import { Eyebrow, Title, Section, Cta, usePublicDoors, ContactStrip, ProgramCard, FreeCourseCard, FinalCta } from "./PublicBits";
import { UpcomingEventBanner } from "./PublicEventBits";
import { usePublicSite, bookingHref, hoursRows, money, ONLINE_SCHOOL_HREF } from "./publicSite";
import { PROBLEMS, PROMISE, PILLARS, HOW_TO_BOOK, FALLBACK_PROGRAMS, CATEGORY_META } from "./publicContent";

/**
 * The public Sit Happens homepage — what a logged-out visitor sees at `/`.
 * Answers, in order: what we do, where we are, training options, how to
 * book, the free School course, where clients log in, how to reach us.
 * Data comes from the app's own systems: /public/site (business facts),
 * /public/services (daycare, boarding, photography prices), /public/training-
 * programs (the programs collection), /public/school/storefront (free course).
 */
function useCatalog() {
  const [services, setServices] = useState([]);
  const [programs, setPrograms] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get("/public/services").then((r) => { if (alive) setServices(Array.isArray(r.data) ? r.data : []); }).catch(() => {});
    api.get("/public/training-programs").then((r) => { if (alive) setPrograms(r.data?.programs || []); }).catch(() => { if (alive) setPrograms([]); });
    return () => { alive = false; };
  }, []);
  return { services, programs };
}

function lowestPrice(services, type) {
  const prices = services.filter((s) => s.service_type === type && Number(s.base_price) > 0).map((s) => Number(s.base_price));
  return prices.length ? Math.min(...prices) : null;
}

export default function PublicHome() {
  const { user } = useAuth();
  const { site, data } = usePublicSite();
  const { services, programs } = useCatalog();
  const { openMeetGreet, openInquiry, modals } = usePublicDoors();
  const meetGreetEnabled = data?.meet_greet_enabled !== false;
  const bookFree = meetGreetEnabled ? openMeetGreet : openInquiry;
  const fv = data?.feature_visibility || {};
  const showSchool = fv.online_school !== false;
  const showPhotography = fv.photography !== false;

  const daycareFrom = lowestPrice(services, "daycare");
  const boardingFrom = lowestPrice(services, "boarding");
  const photoFrom = lowestPrice(services, "photography");
  const rows = hoursRows(data?.business_hours);
  const stay = data?.stay || null;

  const previewPrograms = useMemo(() => {
    if (programs === null) return [];
    if (programs.length === 0) return FALLBACK_PROGRAMS;
    const lessons = programs.filter((p) => p.type !== "board_train");
    const bt = programs.filter((p) => p.type === "board_train");
    return [...lessons.slice(0, 3), ...bt.slice(0, 1)];
  }, [programs]);

  const categories = [
    { key: "training", to: "/training" },
    { key: "daycare", href: "#daycare-boarding", price: daycareFrom, unit: "day" },
    { key: "boarding", href: "#daycare-boarding", price: boardingFrom, unit: "night" },
    showSchool && { key: "online_school", href: ONLINE_SCHOOL_HREF },
    showPhotography && { key: "photography", to: "/photography", price: photoFrom, unit: "session" },
  ].filter(Boolean);

  const daycareServices = services.filter((s) => s.service_type === "daycare");
  const boardingServices = services.filter((s) => s.service_type === "boarding");
  // /public/services already returns these; the page just never rendered them,
  // so the website has never mentioned a service the app fully supports. Shown
  // only when grooming is switched on AND something is actually configured —
  // an empty grooming section would be advertising nothing.
  const groomingServices = services.filter((s) => s.service_type === "grooming");
  const showGrooming = fv.grooming !== false && groomingServices.length > 0;

  // "What does it cost" and "when do I pay" are halves of the same question,
  // so each pricing card carries one payment line. The services in a card
  // normally share a category default, and repeating it on every row would be
  // noise; when they genuinely differ we say nothing rather than pick one and
  // tell some visitors the wrong thing.
  const paymentNote = (list) => {
    const distinct = [...new Set(list.map((x) => x.payment?.short).filter(Boolean))];
    return distinct.length === 1 ? distinct[0] : null;
  };

  return (
    <PublicSiteShell testid="public-home">
      {/* ===== Next event — a strip at the very top, only while one is published ===== */}
      <UpcomingEventBanner />

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden" data-testid="site-hero">
        <div className="absolute inset-0 pointer-events-none opacity-40"
             style={{ background: "radial-gradient(circle at 10% 15%, #00a9e0 0%, transparent 36%), radial-gradient(circle at 90% 80%, #8cc63f 0%, transparent 40%), radial-gradient(circle at 72% 8%, #f26522 0%, transparent 28%)" }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-12 sm:pt-16 sm:pb-16 sh-splatter">
          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_.85fr] gap-8 lg:gap-12 items-center">
            <div>
              <Eyebrow icon="fa-location-dot">{site?.tagline || "Dog Training · Daycare & Boarding · Warren, Ohio"}</Eyebrow>
              <h1 className="sh-display text-[40px] sm:text-6xl lg:text-7xl text-white leading-[0.95]" style={{ textWrap: "balance" }} data-testid="site-hero-headline">
                {site?.hero_headline || "Dog training for real-life chaos in Warren, Ohio."}
              </h1>
              <p className="text-base sm:text-lg text-gray-300 leading-relaxed mt-5 max-w-2xl" data-testid="site-hero-sub">
                {site?.hero_subheadline || "We help dogs (and their humans) build better habits, stronger connections, and calmer days."}
              </p>
              <ul className="mt-5 flex flex-wrap gap-2" data-testid="site-hero-problems" aria-label="What we help with">
                {PROBLEMS.map((p) => (
                  <li key={p} className="px-3 py-1.5 rounded-full bg-bgPanel border border-bgHover text-[12px] font-black uppercase tracking-wide text-gray-200">
                    <i className="fas fa-check text-shGreen mr-1.5" />{p}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-col sm:flex-row flex-wrap gap-3" data-testid="site-hero-ctas">
                <Cta color="green" onClick={bookFree} icon="fa-paw" testid="site-hero-book" className="sm:min-w-[240px]">Book a free Meet &amp; Greet</Cta>
                {showSchool && <Cta color="blue" href={ONLINE_SCHOOL_HREF} icon="fa-graduation-cap" testid="site-hero-free-course">Start the free course</Cta>}
                <Cta color="ghost" to={user ? "/" : "/login"} icon={user ? "fa-house" : "fa-user"} testid="site-hero-login">{user ? "Go to my portal" : "Sign in / Create account"}</Cta>
              </div>
              <p className="mt-4 text-[12px] uppercase tracking-widest font-black text-gray-500">
                <i className="fas fa-shield-halved text-shGreen mr-1.5" />Vaccine-checked · <i className="fas fa-camera text-shOrange mx-1.5" />Daily report cards · <i className="fas fa-graduation-cap text-shBlue mx-1.5" />Trainer-built courses
              </p>
            </div>
            <div className="relative hidden lg:flex items-center justify-center" aria-hidden="true">
              <div className="absolute inset-0 -m-10 rounded-full pointer-events-none opacity-70 blur-3xl"
                   style={{ background: "radial-gradient(circle, rgba(140,198,63,0.55) 0%, rgba(0,169,224,0.35) 45%, transparent 70%)" }} />
              <img src="/logo.png" alt="" className="relative w-[300px] xl:w-[340px] drop-shadow-[0_18px_40px_rgba(0,0,0,0.7)]" />
              <div className="sh-site-paw-badge" data-testid="site-hero-badge">
                <span>Better</span><span className="text-shGreen">Behavior.</span><span>Happier</span><span className="text-shBlue">Life.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Where we are ===== */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 -mt-2 mb-2">
        <ContactStrip site={site} testid="site-hero-contact" />
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[12px] uppercase tracking-widest font-black text-gray-500" data-testid="site-hero-facts">
          {site?.service_area && <span><i className="fas fa-map text-shBlue mr-1.5" />Serving {site.service_area}</span>}
          {rows[0] && <span><i className="fas fa-clock text-shGreen mr-1.5" />{rows[0].days} {rows[0].hours}</span>}
        </div>
      </div>

      {/* ===== What we do ===== */}
      <Section tone="panel" testid="site-services">
        <Eyebrow icon="fa-list-check" color="text-shBlue">What we do</Eyebrow>
        <Title>Training, daycare, boarding, School and portraits. One team that knows your dog.</Title>
        <div className={`mt-8 grid grid-cols-1 sm:grid-cols-2 ${({ 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" })[categories.length] || "lg:grid-cols-5"} gap-4`}>
          {categories.map((c) => {
            const m = CATEGORY_META[c.key];
            const inner = (
              <>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${m.color}22`, color: m.color }}>
                  <i className={`fas ${m.icon} text-2xl`} />
                </div>
                <h3 className="text-lg font-black uppercase italic tracking-tight text-white">{m.label}</h3>
                <p className="text-[14px] text-gray-300 leading-relaxed mt-1.5 flex-1">{m.blurb}</p>
                <p className="mt-3 text-[12px] font-black uppercase tracking-widest text-shGreen">
                  {c.price != null ? `From ${money(c.price)}/${c.unit}` : c.key === "online_school" ? "Free course available" : "Learn more"} <i className="fas fa-arrow-right ml-1" />
                </p>
              </>
            );
            const cls = "sh-site-card group flex flex-col hover:border-shGreen/50 transition";
            return c.to
              ? <Link key={c.key} to={c.to} className={cls} data-testid={`site-category-${c.key}`}>{inner}</Link>
              : <a key={c.key} href={c.href} className={cls} data-testid={`site-category-${c.key}`}>{inner}</a>;
          })}
        </div>
      </Section>

      {/* ===== Free Meet & Greet ===== */}
      <Section testid="site-consult">
        <div className="sh-site-band sh-splatter-explosion">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-center">
            <div>
              <Eyebrow icon="fa-paw">{PROMISE.eyebrow}</Eyebrow>
              <Title>{PROMISE.consult_title}</Title>
              <p className="text-[15px] text-gray-300 leading-relaxed mt-3 max-w-2xl">{PROMISE.consult_body}</p>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] uppercase tracking-widest font-black text-gray-400">
                {PROMISE.consult_points.map((p) => <li key={p}><i className="fas fa-check text-shGreen mr-1.5" />{p}</li>)}
              </ul>
            </div>
            <Cta color="green" onClick={bookFree} icon="fa-calendar-check" testid="site-consult-cta" className="w-full lg:w-auto">Book a free Meet &amp; Greet</Cta>
          </div>
        </div>
      </Section>

      {/* ===== Training programs ===== */}
      <Section tone="panel" id="training" testid="site-programs">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <Eyebrow icon="fa-graduation-cap" color="text-shOrange">Training programs</Eyebrow>
            <Title>Customized programs for every stage of your dog's journey.</Title>
          </div>
          <Link to="/training" className="text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-white border border-shGreen/40 hover:border-shGreen rounded px-4 py-2 transition" data-testid="site-programs-all">
            All programs & pricing <i className="fas fa-arrow-right ml-1" />
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {previewPrograms.map((p) => <ProgramCard key={p.id} p={p} onAsk={openInquiry} />)}
          {programs === null && [0, 1, 2, 3].map((i) => <div key={i} className="sh-site-card h-56 animate-pulse" />)}
        </div>
      </Section>

      {/* ===== Daycare & boarding ===== */}
      <Section id="daycare-boarding" testid="site-daycare-boarding">
        <Eyebrow icon="fa-sun" color="text-shBlue">Daycare & boarding</Eyebrow>
        <Title>Play, comfort, and dependable care for your dog.</Title>
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="sh-site-card" style={{ "--card-accent": "#8cc63f" }} data-testid="site-daycare-card">
            <h3 className="text-2xl font-black uppercase italic tracking-tight text-shGreen">Dog daycare</h3>
            <p className="text-[14px] text-gray-300 mt-1">{data?.service_descriptions?.daycare || "Perfect for socialization, exercise, and burning off extra energy."}</p>
            <ul className="mt-4 space-y-2 text-[14px]">
              {daycareServices.length === 0 && <li className="text-gray-400">Pricing is shared at your free Meet &amp; Greet.</li>}
              {daycareServices.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 border-b border-bgHover/60 pb-2">
                  <span className="text-gray-200">{s.name}{s.description ? <span className="block text-[12px] text-gray-500">{s.description}</span> : null}</span>
                  <span className="font-black text-white whitespace-nowrap">{money(s.base_price)}</span>
                </li>
              ))}
              {paymentNote(daycareServices) && <li className="text-[12px] text-gray-400 pt-1" data-testid="site-daycare-payment"><i className="fas fa-wallet text-shGreen mr-1.5" />{paymentNote(daycareServices)}</li>}
              {(stay?.daycare?.lines || []).map((l) => <li key={l} className="text-[12px] text-gray-400 pt-1"><i className="fas fa-circle-info text-shGreen mr-1.5" />{l}</li>)}
              {rows.length > 0 && <li className="text-[12px] text-gray-400 pt-1"><i className="fas fa-clock text-shGreen mr-1.5" />Hours: {rows.map((r) => `${r.days} ${r.hours}`).join(" · ")}</li>}
            </ul>
          </div>
          <div className="sh-site-card" style={{ "--card-accent": "#f26522" }} data-testid="site-boarding-card">
            <h3 className="text-2xl font-black uppercase italic tracking-tight text-shOrange">Overnight boarding</h3>
            <p className="text-[14px] text-gray-300 mt-1">{data?.service_descriptions?.boarding || "A safe, comfortable home away from home. All boarding includes supervised daycare play."}</p>
            <ul className="mt-4 space-y-2 text-[14px]">
              {boardingServices.length === 0 && <li className="text-gray-400">Pricing is shared at your free Meet &amp; Greet.</li>}
              {boardingServices.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 border-b border-bgHover/60 pb-2">
                  <span className="text-gray-200">{s.name}{s.description ? <span className="block text-[12px] text-gray-500">{s.description}</span> : null}</span>
                  <span className="font-black text-white whitespace-nowrap">{money(s.base_price)}<span className="text-[11px] text-gray-500 font-bold"> / night</span></span>
                </li>
              ))}
              {paymentNote(boardingServices) && <li className="text-[12px] text-gray-400 pt-1" data-testid="site-boarding-payment"><i className="fas fa-wallet text-shOrange mr-1.5" />{paymentNote(boardingServices)}</li>}
              {(stay?.boarding?.lines || []).map((l) => <li key={l} className="text-[12px] text-gray-400 pt-1"><i className="fas fa-door-open text-shOrange mr-1.5" />{l}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Cta color="green" to={bookingHref(user)} icon="fa-calendar-check" testid="site-book-now">{user ? "Book from my portal" : "Book now"}</Cta>
          <Cta color="ghost" onClick={bookFree} icon="fa-paw" testid="site-daycare-meet-greet">Book a free Meet &amp; Greet</Cta>
        </div>
      </Section>

      {/* ===== Grooming ===== */}
      {showGrooming && (
        <Section id="grooming" testid="site-grooming">
          <Eyebrow icon="fa-scissors" color="text-shSecondary">Grooming</Eyebrow>
          <Title>Clean ears, tidy nails, happier walks.</Title>
          <div className="mt-8 sh-site-card" style={{ "--card-accent": "#00a9e0" }} data-testid="site-grooming-card">
            <p className="text-[14px] text-gray-300">
              {data?.service_descriptions?.grooming
                || "Straightforward grooming add-ons you can book alongside a daycare or boarding stay, or on their own."}
            </p>
            <ul className="mt-4 space-y-2 text-[14px]">
              {groomingServices.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 border-b border-bgHover/60 pb-2">
                  <span className="text-gray-200 min-w-0">
                    {s.name}
                    {s.description ? <span className="block text-[12px] text-gray-500">{s.description}</span> : null}
                  </span>
                  <span className="font-black text-white whitespace-nowrap">{money(s.base_price)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-gray-400 mt-3">
              <i className="fas fa-circle-info text-shSecondary mr-1.5" />
              Grooming is booked by request — we confirm the time with you.
            </p>
            {paymentNote(groomingServices) && (
              <p className="text-[12px] text-gray-400 mt-1" data-testid="site-grooming-payment">
                <i className="fas fa-wallet text-shSecondary mr-1.5" />{paymentNote(groomingServices)}
              </p>
            )}
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Cta color="green" to={bookingHref(user)} icon="fa-calendar-check" testid="site-grooming-book">
              {user ? "Book from my portal" : "Book grooming"}
            </Cta>
            <Cta color="ghost" onClick={openInquiry} icon="fa-pen-to-square" testid="site-grooming-ask">Ask about grooming</Cta>
          </div>
        </Section>
      )}

      {/* ===== Online School ===== */}
      {showSchool && (
        <Section tone="panel" id="online-school" testid="site-school">
          <Eyebrow icon="fa-laptop-file" color="text-shBlue">Online School</Eyebrow>
          <Title>Train from home, with the same trainers.</Title>
          <p className="text-[15px] text-gray-300 leading-relaxed mt-3 max-w-2xl">
            Work through real Sit Happens training with step-by-step lessons, guided practice, progress tracking and course certificates, from your phone or computer.
          </p>
          <div className="mt-6"><FreeCourseCard /></div>
          <a href={ONLINE_SCHOOL_HREF} className="inline-flex items-center min-h-[44px] py-2 mt-4 text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-white" data-testid="site-school-browse">
            Browse all online courses <i className="fas fa-arrow-right ml-1" />
          </a>
        </Section>
      )}

      {/* ===== Photography ===== */}
      {showPhotography && (
        <Section testid="site-photography">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-center sh-site-band">
            <div>
              <Eyebrow icon="fa-camera-retro" color="text-shOrange">Pet photography</Eyebrow>
              <Title>{data?.photography_page?.headline || "Capture the moments worth keeping."}</Title>
              <p className="text-[15px] text-gray-300 leading-relaxed mt-3 max-w-2xl">Outdoor sessions, polished portraits, action shots and personality photos. Images that capture your dog's unique charm, energy, and attitude.</p>
            </div>
            <Cta color="orange" to="/photography" icon="fa-camera" testid="site-photography-cta" className="w-full lg:w-auto">Pet photography</Cta>
          </div>
        </Section>
      )}

      {/* ===== How to book ===== */}
      <Section tone="panel" testid="site-how">
        <Eyebrow icon="fa-route">How to book</Eyebrow>
        <Title>From first hello to first wag in three steps.</Title>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {HOW_TO_BOOK.map((s) => (
            <div key={s.n} className="relative sh-site-card" data-testid={`site-how-${s.n}`}>
              <span className="absolute -top-3 -left-3 w-10 h-10 rounded-full bg-shGreen text-bgHeader flex items-center justify-center font-black text-lg shadow-lg">{s.n}</span>
              <h3 className="text-base font-black uppercase italic tracking-tight text-white mt-2">{s.title}</h3>
              <p className="text-[14px] text-gray-300 leading-relaxed mt-1.5">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-gray-400 mt-5" data-testid="site-how-door-hint">
          <span className="text-white font-black">Book a free Meet &amp; Greet</span> to pick an actual time,
          or <span className="text-white font-black">tell us about your dog</span> if you just have questions for now.
        </p>
        <div className="mt-3 flex flex-col sm:flex-row flex-wrap gap-3 items-start sm:items-center">
          <Cta color="green" onClick={bookFree} icon="fa-paw" testid="site-how-meet-greet">Book a free Meet &amp; Greet</Cta>
          <Cta color="ghost" onClick={openInquiry} icon="fa-pen-to-square" testid="site-how-inquiry">Tell us about your dog</Cta>
          <Link to={user ? "/" : "/login"} className="inline-flex items-center min-h-[44px] py-2 text-[13px] font-black uppercase tracking-widest text-gray-400 hover:text-white" data-testid="site-how-login">
            <i className="fas fa-user mr-1.5" />{user ? "Go to my portal" : "Already a client? Sign in"}
          </Link>
        </div>
      </Section>

      {/* ===== Why us ===== */}
      <Section testid="site-why">
        <Eyebrow icon="fa-heart" color="text-shOrange">Why Sit Happens</Eyebrow>
        <Title>Built around the dog. And the human.</Title>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PILLARS.map((w, i) => (
            <div key={i} className="sh-site-card" data-testid={`site-why-${i}`}>
              <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${w.color}22`, color: w.color }}><i className={`fas ${w.icon} text-xl`} /></div>
              <h3 className="text-[15px] font-black uppercase italic tracking-tight text-white">{w.title}</h3>
              <p className="text-[14px] text-gray-300 leading-relaxed mt-1.5">{w.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ===== Contact + final CTA ===== */}
      <Section tone="dark" id="contact" testid="site-contact">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-8">
          <div>
            <Eyebrow icon="fa-comments">Contact us</Eyebrow>
            <Title>Questions? We answer the phone.</Title>
            <div className="mt-5 space-y-3 text-[15px]" data-testid="site-contact-details">
              {site?.phone && <a href={`tel:${site.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-3 min-h-[44px] py-1 text-white hover:text-shGreen"><span className="w-10 h-10 rounded-lg bg-shGreen/15 text-shGreen grid place-items-center shrink-0"><i className="fas fa-phone" /></span>{site.phone}</a>}
              {site?.email && <a href={`mailto:${site.email}`} className="flex items-center gap-3 min-h-[44px] py-1 text-white hover:text-shBlue break-all"><span className="w-10 h-10 rounded-lg bg-shBlue/15 text-shBlue grid place-items-center shrink-0"><i className="fas fa-envelope" /></span>{site.email}</a>}
              {site?.address_line && <a href={site.map_url || "#"} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-white hover:text-shOrange"><span className="w-10 h-10 rounded-lg bg-shOrange/15 text-shOrange grid place-items-center"><i className="fas fa-location-dot" /></span>{site.address_line}, {site.city}, {site.state} {site.zip}</a>}
            </div>
            {rows.length > 0 && (
              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]" data-testid="site-contact-hours">
                {rows.map((r) => <div key={r.days} className="contents"><dt className="text-gray-500 font-black uppercase tracking-widest text-[11px] pt-0.5">{r.days}</dt><dd className="text-gray-200">{r.hours}</dd></div>)}
              </dl>
            )}
            <Link to="/contact" className="inline-flex items-center min-h-[44px] py-2 mt-5 text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-white" data-testid="site-contact-more">
              Contact page & directions <i className="fas fa-arrow-right ml-1" />
            </Link>
          </div>
          <FinalCta site={site} onMeetGreet={openMeetGreet} onInquiry={openInquiry} meetGreetEnabled={meetGreetEnabled} />
        </div>
      </Section>
      {modals}
    </PublicSiteShell>
  );
}
