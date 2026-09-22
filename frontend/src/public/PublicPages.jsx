import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import PublicSiteShell from "./PublicSiteShell";
import { Eyebrow, Title, Section, Cta, usePublicDoors, ContactStrip, FinalCta } from "./PublicBits";
import { usePublicSite, hoursRows, money, bookingHref } from "./publicSite";
import { ABOUT, PILLARS, PHOTOGRAPHY } from "./publicContent";

/* The smaller public pages: About, Pet Photography, Contact. Each is a thin
 * page over the same shell, the same business facts, and the same doors. */

export function PublicAbout() {
  const { site, data } = usePublicSite();
  const { openMeetGreet, openInquiry, modals } = usePublicDoors();
  const meetGreetEnabled = data?.meet_greet_enabled !== false;
  return (
    <PublicSiteShell testid="public-about">
      <section className="relative overflow-hidden" data-testid="site-about-hero">
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 12% 20%, #8cc63f 0%, transparent 38%), radial-gradient(circle at 88% 75%, #00a9e0 0%, transparent 40%)" }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-10 sm:pt-14 sm:pb-12 sh-splatter">
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_.8fr] gap-8 items-center">
            <div>
              <Eyebrow icon="fa-paw">About Sit Happens</Eyebrow>
              <Title as="h1" className="text-4xl sm:text-5xl lg:text-6xl">{ABOUT.headline}</Title>
              <p className="text-base sm:text-lg text-gray-300 leading-relaxed mt-4 max-w-2xl">{ABOUT.body}</p>
              <p className="mt-5 sh-display text-xl sm:text-2xl text-shGreen">“{ABOUT.quote}”</p>
              <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-3">
                <Cta color="green" onClick={meetGreetEnabled ? openMeetGreet : openInquiry} icon="fa-paw" testid="site-about-book">Book a free consultation</Cta>
                <Cta color="ghost" to="/training" icon="fa-graduation-cap" testid="site-about-training">See training programs</Cta>
              </div>
            </div>
            <div className="hidden lg:flex justify-center" aria-hidden="true">
              <img src="/logo.png" alt="" className="w-[280px] drop-shadow-[0_18px_40px_rgba(0,0,0,0.7)]" />
            </div>
          </div>
        </div>
      </section>
      <div className="max-w-6xl mx-auto px-4 sm:px-6"><ContactStrip site={site} /></div>
      <Section tone="panel" testid="site-about-pillars">
        <Eyebrow icon="fa-heart" color="text-shOrange">How we work</Eyebrow>
        <Title>Built around the dog. And the human.</Title>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PILLARS.map((w, i) => (
            <div key={i} className="sh-site-card">
              <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${w.color}22`, color: w.color }}><i className={`fas ${w.icon} text-xl`} /></div>
              <h3 className="text-[15px] font-black uppercase italic tracking-tight text-white">{w.title}</h3>
              <p className="text-[14px] text-gray-300 leading-relaxed mt-1.5">{w.body}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section testid="site-about-where">
        <Eyebrow icon="fa-location-dot" color="text-shBlue">Where we are</Eyebrow>
        <Title>{site?.city ? `${site.city}, ${site.state}.` : "Warren, Ohio."} {site?.service_area ? `Serving ${site.service_area}.` : ""}</Title>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="sh-site-card">
            <p className="sh-site-footer__title">Visit</p>
            {site?.address_line && <p className="text-[15px] text-white">{site.address_line}<br />{site.city}, {site.state} {site.zip}</p>}
            {site?.map_url && <a href={site.map_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 text-[12px] font-black uppercase tracking-widest text-shGreen hover:text-white" data-testid="site-about-directions">Get directions <i className="fas fa-arrow-up-right-from-square ml-1" /></a>}
          </div>
          <div className="sh-site-card">
            <p className="sh-site-footer__title">Hours</p>
            {hoursRows(data?.business_hours).map((r) => <p key={r.days} className="text-[14px] text-gray-200"><span className="inline-block w-20 text-gray-500">{r.days}</span>{r.hours}</p>)}
            {hoursRows(data?.business_hours).length === 0 && <p className="text-[14px] text-gray-400">Call or message us for current hours.</p>}
          </div>
        </div>
      </Section>
      <Section tone="dark"><FinalCta site={site} onMeetGreet={openMeetGreet} onInquiry={openInquiry} meetGreetEnabled={meetGreetEnabled} testid="site-about-final" /></Section>
      {modals}
    </PublicSiteShell>
  );
}

export function PublicPhotography() {
  const { user } = useAuth();
  const { site, data } = usePublicSite();
  const { openInquiry, openMeetGreet, modals } = usePublicDoors();
  const [services, setServices] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get("/public/services").then((r) => { if (alive) setServices((Array.isArray(r.data) ? r.data : []).filter((s) => s.service_type === "photography")); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const page = data?.photography_page || {};
  return (
    <PublicSiteShell testid="public-photography">
      <section className="relative overflow-hidden" data-testid="site-photo-hero">
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 12% 20%, #f26522 0%, transparent 38%), radial-gradient(circle at 88% 75%, #00a9e0 0%, transparent 40%)" }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-10 sm:pt-14 sm:pb-12 sh-splatter">
          <Eyebrow icon="fa-camera-retro" color="text-shOrange">{PHOTOGRAPHY.eyebrow}</Eyebrow>
          <Title as="h1" className="text-4xl sm:text-5xl lg:text-6xl">{page.headline || "Capture the moments worth keeping."}</Title>
          <ul className="mt-4 flex flex-wrap gap-2">
            {PHOTOGRAPHY.points.map((p) => <li key={p} className="px-3 py-1.5 rounded-full bg-bgPanel border border-bgHover text-[12px] font-black uppercase tracking-wide text-gray-200"><i className="fas fa-camera text-shOrange mr-1.5" />{p}</li>)}
          </ul>
          <p className="text-base sm:text-lg text-gray-300 leading-relaxed mt-5 max-w-2xl">{page.body || PHOTOGRAPHY.body}</p>
          <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-3">
            <Cta color="orange" to={bookingHref(user)} icon="fa-camera" testid="site-photo-book">{user ? "Book a session from my portal" : "Book a photo session"}</Cta>
            {site?.gallery_url && <Cta color="ghost" href={site.gallery_url} icon="fa-images" testid="site-photo-gallery">View photo galleries</Cta>}
            <Cta color="ghost" onClick={openInquiry} icon="fa-comments" testid="site-photo-ask">Ask questions</Cta>
          </div>
        </div>
      </section>
      <div className="max-w-6xl mx-auto px-4 sm:px-6"><ContactStrip site={site} /></div>
      <Section tone="panel" testid="site-photo-packages">
        <Eyebrow icon="fa-tags">Sessions & pricing</Eyebrow>
        <Title>Professional dog photography in {site?.city || "Warren"}, {site?.state || "Ohio"}.</Title>
        {services.length === 0 ? (
          <p className="text-[15px] text-gray-300 mt-4 max-w-2xl">Session options and pricing are shared when you book. Tell us about your dog and what you're hoping for, and we'll recommend a session.</p>
        ) : (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((s) => (
              <div key={s.id} className="sh-site-card" style={{ "--card-accent": "#f26522" }} data-testid={`site-photo-service-${s.id}`}>
                <h3 className="text-[18px] font-black uppercase italic tracking-tight text-white">{s.name}</h3>
                {s.description && <p className="text-[14px] text-gray-300 leading-relaxed mt-2">{s.description}</p>}
                <p className="mt-3 text-[18px] font-black text-white">{money(s.base_price)}{s.duration_minutes ? <span className="text-[12px] text-gray-500 font-bold"> · {s.duration_minutes} min</span> : null}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section tone="dark"><FinalCta site={site} onMeetGreet={openMeetGreet} onInquiry={openInquiry} meetGreetEnabled={data?.meet_greet_enabled !== false} testid="site-photo-final" /></Section>
      {modals}
    </PublicSiteShell>
  );
}

export function PublicContact() {
  const { site, data } = usePublicSite();
  const { openMeetGreet, openInquiry, modals } = usePublicDoors();
  const meetGreetEnabled = data?.meet_greet_enabled !== false;
  const rows = hoursRows(data?.business_hours);
  const tel = (site?.phone || "").replace(/[^\d+]/g, "");
  return (
    <PublicSiteShell testid="public-contact">
      <section className="relative overflow-hidden" data-testid="site-contact-hero">
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 12% 20%, #00a9e0 0%, transparent 38%), radial-gradient(circle at 88% 75%, #8cc63f 0%, transparent 40%)" }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-10 sm:pt-14 sm:pb-12 sh-splatter">
          <Eyebrow icon="fa-comments">Contact</Eyebrow>
          <Title as="h1" className="text-4xl sm:text-5xl lg:text-6xl">Have questions or ready to get started?</Title>
          <p className="text-base sm:text-lg text-gray-300 leading-relaxed mt-4 max-w-2xl">Send us a message and we'll get back to you within one business day. Or skip the form and call, we answer the phone.</p>
          <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-3">
            <Cta color="green" onClick={openInquiry} icon="fa-pen-to-square" testid="site-contact-inquiry">Tell us about your dog</Cta>
            <Cta color="orange" onClick={meetGreetEnabled ? openMeetGreet : openInquiry} icon="fa-paw" testid="site-contact-meet-greet">Request a Meet & Greet</Cta>
            {tel && <Cta color="ghost" href={`tel:${tel}`} icon="fa-phone" testid="site-contact-call">Call {site.phone}</Cta>}
          </div>
        </div>
      </section>
      <Section tone="panel" testid="site-contact-cards">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="sh-site-card" style={{ "--card-accent": "#8cc63f" }}>
            <p className="sh-site-footer__title">Call or text</p>
            {site?.phone ? <a href={`tel:${tel}`} className="text-[20px] font-black text-white hover:text-shGreen" data-testid="site-contact-phone">{site.phone}</a> : <p className="text-gray-400">—</p>}
          </div>
          <div className="sh-site-card" style={{ "--card-accent": "#00a9e0" }}>
            <p className="sh-site-footer__title">Email</p>
            {site?.email ? <a href={`mailto:${site.email}`} className="text-[17px] font-black text-white hover:text-shBlue break-all" data-testid="site-contact-email">{site.email}</a> : <p className="text-gray-400">—</p>}
          </div>
          <div className="sh-site-card" style={{ "--card-accent": "#f26522" }}>
            <p className="sh-site-footer__title">Visit</p>
            {site?.address_line && <p className="text-[15px] text-white" data-testid="site-contact-address">{site.address_line}<br />{site.city}, {site.state} {site.zip}</p>}
            {site?.map_url && <a href={site.map_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[12px] font-black uppercase tracking-widest text-shOrange hover:text-white" data-testid="site-contact-directions">Get directions <i className="fas fa-arrow-up-right-from-square ml-1" /></a>}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="sh-site-card" data-testid="site-contact-hours-card">
            <p className="sh-site-footer__title">Hours</p>
            {rows.map((r) => <p key={r.days} className="text-[14px] text-gray-200"><span className="inline-block w-20 text-gray-500">{r.days}</span>{r.hours}</p>)}
            {rows.length === 0 && <p className="text-[14px] text-gray-400">Call or message us for current hours.</p>}
            {site?.service_area && <p className="text-[12px] text-gray-500 mt-3"><i className="fas fa-map text-shBlue mr-1.5" />Serving {site.service_area}.</p>}
          </div>
          <div className="sh-site-card">
            <p className="sh-site-footer__title">Already a client?</p>
            <p className="text-[14px] text-gray-300 leading-relaxed">Book, message us, and see report cards from your portal.</p>
            <Link to="/login" className="inline-block mt-3 text-[12px] font-black uppercase tracking-widest text-shGreen hover:text-white" data-testid="site-contact-login">Sign in / Create account <i className="fas fa-arrow-right ml-1" /></Link>
          </div>
        </div>
      </Section>
      <Section tone="dark"><FinalCta site={site} onMeetGreet={openMeetGreet} onInquiry={openInquiry} meetGreetEnabled={meetGreetEnabled} testid="site-contact-final" /></Section>
      {modals}
    </PublicSiteShell>
  );
}
