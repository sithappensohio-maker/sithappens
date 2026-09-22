import { useEffect, useState } from "react";
import { pricingLine } from "../lib/programPricing";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import RequestMeetGreetModal from "../components/RequestMeetGreetModal";
import ContactInquiryModal from "../components/ContactInquiryModal";
import { money, formatLabel, ONLINE_SCHOOL_HREF } from "./publicSite";

/* Small building blocks shared by the public pages. All CTAs route into the
 * app's existing doors: the Meet & Greet request, the contact questionnaire,
 * the Online School storefront, and sign-in. */

export function Eyebrow({ icon, color = "text-shGreen", children }) {
  return (
    <p className={`text-[11px] sm:text-[12px] font-black uppercase tracking-[0.32em] ${color} mb-2`}>
      {icon && <i className={`fas ${icon} mr-2`} />}{children}
    </p>
  );
}

export function Title({ as: Tag = "h2", children, className = "" }) {
  return <Tag className={`sh-display text-3xl sm:text-4xl lg:text-5xl text-white leading-[0.98] ${className}`} style={{ textWrap: "balance" }}>{children}</Tag>;
}

export function Section({ id, children, tone = "base", className = "", testid }) {
  const tones = { base: "", panel: "border-t border-bgHover/60 bg-bgPanel/30", dark: "border-t border-bgHover/60 bg-bgHeader/60" };
  return (
    <section id={id} className={`relative ${tones[tone] || ""} ${className}`} data-testid={testid}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">{children}</div>
    </section>
  );
}

const BTN = {
  green: "bg-shGreen text-bgHeader hover:bg-shGreen/90",
  blue: "bg-shBlue text-white hover:bg-shBlue/90",
  orange: "bg-shOrange text-white hover:bg-shOrange/90",
  ghost: "border border-bgHover text-white hover:border-shGreen bg-transparent",
};
export function Cta({ color = "green", to, href, onClick, icon, children, testid, className = "", small = false }) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-full font-black uppercase tracking-widest shadow-lg transition ${small ? "px-4 py-2.5 text-[12px]" : "px-6 py-3.5 text-[14px]"} ${BTN[color] || BTN.green} ${className}`;
  const inner = <>{icon && <i className={`fas ${icon}`} />}{children}</>;
  if (to) return <Link to={to} className={cls} data-testid={testid}>{inner}</Link>;
  if (href) return <a href={href} className={cls} data-testid={testid}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls} data-testid={testid}>{inner}</button>;
}

/** The three doors, wired once so every page offers the same ones. */
export function usePublicDoors() {
  const [meetGreetOpen, setMeetGreetOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const modals = (
    <>
      <RequestMeetGreetModal open={meetGreetOpen} onClose={() => setMeetGreetOpen(false)} />
      <ContactInquiryModal open={inquiryOpen} onClose={() => setInquiryOpen(false)} />
    </>
  );
  return { openMeetGreet: () => setMeetGreetOpen(true), openInquiry: () => setInquiryOpen(true), modals };
}

/** Phone · email · address strip, the way the old site repeats it. */
export function ContactStrip({ site, testid = "site-contact-strip" }) {
  if (!site) return null;
  const tel = (site.phone || "").replace(/[^\d+]/g, "");
  return (
    <div className="sh-site-strip" data-testid={testid}>
      {site.phone && <a href={`tel:${tel}`} className="sh-site-strip__item"><i className="fas fa-phone" /><span>{site.phone}</span></a>}
      {site.email && <a href={`mailto:${site.email}`} className="sh-site-strip__item"><i className="fas fa-envelope" /><span>{site.email}</span></a>}
      {site.address_line && (
        <a href={site.map_url || "#"} target="_blank" rel="noopener noreferrer" className="sh-site-strip__item">
          <i className="fas fa-location-dot" /><span>{site.address_line}, {site.city}, {site.state} {site.zip}</span>
        </a>
      )}
    </div>
  );
}

const TYPE_COLOR = { private_lessons: "#8cc63f", group_class: "#00a9e0", day_train: "#00a9e0", board_train: "#f26522", service_dog: "#a855f7" };

export function ProgramCard({ p, onAsk, testid }) {
  const color = TYPE_COLOR[p.type] || "#8cc63f";
  const fmt = formatLabel(p.format);
  return (
    <article className="sh-site-card flex flex-col" style={{ "--card-accent": color }} data-testid={testid || `site-program-${p.id}`}>
      {p.image_url && <img src={p.image_url} alt="" className="w-full h-36 object-cover rounded-lg mb-3" loading="lazy" />}
      <p className="text-[10px] font-black uppercase tracking-[0.25em] mb-1" style={{ color }}>
        <i className="fas fa-paw mr-1.5" />{p.type_label || "Training"}
      </p>
      <h3 className="text-[19px] font-black uppercase italic tracking-tight text-white leading-tight">{p.name}</h3>
      {p.description && <p className="text-[14px] text-gray-300 leading-relaxed mt-2">{p.description}</p>}
      {p.focus && <p className="text-[13px] text-gray-400 leading-relaxed mt-2"><span className="text-white font-black uppercase text-[11px] tracking-widest mr-1.5">Focus</span>{p.focus}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        {fmt && <><dt className="text-gray-500 uppercase tracking-widest font-black text-[10px]">Format</dt><dd className="text-gray-200">{fmt}</dd></>}
        {p.min_age_months ? <><dt className="text-gray-500 uppercase tracking-widest font-black text-[10px]">Minimum age</dt><dd className="text-gray-200">{p.min_age_months} months</dd></> : null}
        {p.prerequisites?.length ? <><dt className="text-gray-500 uppercase tracking-widest font-black text-[10px]">Requires</dt><dd className="text-gray-200">{p.prerequisites.join(", ")}</dd></> : null}
      </dl>
      <div className="mt-auto pt-4 flex items-center justify-between gap-3">
        <span className="text-[18px] font-black text-white" data-testid={`${testid || `site-program-${p.id}`}-price`}>
          {p.pricing?.has_price
            ? p.pricing.display
            : <span className="text-[13px] text-gray-300 normal-case tracking-normal">{pricingLine(p)}</span>}
        </span>
        <button type="button" onClick={onAsk} className="text-[12px] font-black uppercase tracking-widest text-shGreen hover:text-white transition">
          Ask about this <i className="fas fa-arrow-right ml-1" />
        </button>
      </div>
    </article>
  );
}

/** Live free-course card from the Online School storefront. Rendered only
 *  when the server says a course is genuinely free-claimable. */
export function FreeCourseCard({ testid = "site-free-course" }) {
  const [item, setItem] = useState(undefined);
  useEffect(() => {
    let alive = true;
    // The same public catalog the Shop renders; `free_claim_available` is the
    // server's own verdict (see lib/freeCourseClaim), never a $0 guess.
    api.get("/public/shop/catalog")
      .then((r) => {
        const all = Array.isArray(r.data?.items) ? r.data.items : [];
        const free = all.find((i) => i && i.kind === "training_program" && i.free_claim_available === true);
        if (alive) setItem(free || null);
      })
      .catch(() => { if (alive) setItem(null); });
    return () => { alive = false; };
  }, []);
  const href = item ? `/shop/item/training_program/${item.id}` : ONLINE_SCHOOL_HREF;
  return (
    <div className="sh-site-card sh-site-card--glow flex flex-col sm:flex-row sm:items-center gap-4" style={{ "--card-accent": "#00a9e0" }} data-testid={testid}>
      <div className="w-14 h-14 rounded-xl grid place-items-center shrink-0 bg-shBlue/15 text-shBlue text-2xl"><i className="fas fa-graduation-cap" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-shGreen"><i className="fas fa-gift mr-1.5" />Free starter course</p>
        <h3 className="text-[19px] font-black uppercase italic tracking-tight text-white leading-tight mt-0.5" data-testid={`${testid}-name`}>
          {item ? item.name : "Start training from home today"}
        </h3>
        <p className="text-[14px] text-gray-300 leading-relaxed mt-1">
          {item?.short_description || item?.description || "Step-by-step Sit Happens lessons, guided practice and progress tracking, from your phone. Free to start, no card needed."}
        </p>
      </div>
      <Cta color="blue" href={href} icon="fa-play" testid={`${testid}-cta`} className="shrink-0">Start the free course</Cta>
    </div>
  );
}

export function FaqList({ items, testid = "site-faq" }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={testid}>
      {items.map((f, i) => (
        <details key={i} className="sh-site-faq" data-testid={`${testid}-${i}`}>
          <summary className="cursor-pointer text-[15px] font-black text-white uppercase italic tracking-tight flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-shGreen text-bgHeader grid place-items-center text-[12px] shrink-0">{i + 1}</span>
            <span className="pt-1">{f.q}</span>
          </summary>
          <p className="text-[14px] text-gray-300 leading-relaxed mt-2 pl-10">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function FinalCta({ site, onMeetGreet, onInquiry, meetGreetEnabled = true, testid = "site-final-cta" }) {
  return (
    <div className="sh-site-final sh-splatter-explosion" data-testid={testid}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        <img src="/logo.png" alt="" className="h-24 sm:h-28 shrink-0 self-start drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)]" />
        <div className="flex-1 min-w-0">
          <Title as="h2">Ready for a better life together?</Title>
          <p className="text-[15px] text-gray-300 leading-relaxed mt-3 max-w-xl">
            Book a free Meet &amp; Greet and take the first step toward a happier, better-behaved best friend. No pressure, just solutions.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] uppercase tracking-widest font-black text-gray-400">
            <li><i className="fas fa-check text-shGreen mr-1.5" />No pressure, just solutions</li>
            <li><i className="fas fa-check text-shGreen mr-1.5" />Personalized training plan</li>
            <li><i className="fas fa-check text-shGreen mr-1.5" />Local trainers who care</li>
          </ul>
        </div>
        <div className="flex flex-col gap-3 shrink-0 w-full lg:w-auto">
          {meetGreetEnabled
            ? <Cta color="green" onClick={onMeetGreet} icon="fa-paw" testid={`${testid}-meet-greet`}>Book a free Meet &amp; Greet</Cta>
            : <Cta color="green" onClick={onInquiry} icon="fa-paw" testid={`${testid}-meet-greet`}>Tell us about your dog</Cta>}
          <Cta color="ghost" onClick={onInquiry} icon="fa-pen-to-square" testid={`${testid}-inquiry`}>Tell us about your dog</Cta>
          {site?.phone && <a href={`tel:${site.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center justify-center min-h-[44px] py-2 text-center text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-white"><i className="fas fa-phone mr-1.5" />or call {site.phone}</a>}
        </div>
      </div>
    </div>
  );
}
