import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import PublicSiteShell from "./PublicSiteShell";
import { Eyebrow, Title, Section, Cta, usePublicDoors, ContactStrip, ProgramCard, FreeCourseCard, FaqList, FinalCta } from "./PublicBits";
import { usePublicSite, ONLINE_SCHOOL_HREF } from "./publicSite";
import { FALLBACK_PROGRAMS, BOARD_TRAIN_INCLUDED, FAQ, PROMISE, ABOUT } from "./publicContent";

/** /training — every in-person program from the app's programs collection,
 *  grouped the way the old site presented them (private lessons first, then
 *  Board & Train), plus what's included, FAQ, and the same doors. */
export default function PublicTraining() {
  const { site, data } = usePublicSite();
  const { openMeetGreet, openInquiry, modals } = usePublicDoors();
  const meetGreetEnabled = data?.meet_greet_enabled !== false;
  const bookFree = meetGreetEnabled ? openMeetGreet : openInquiry;
  const [programs, setPrograms] = useState(null);
  const [typeLabels, setTypeLabels] = useState({});
  useEffect(() => {
    let alive = true;
    api.get("/public/training-programs")
      .then((r) => { if (alive) { setPrograms(r.data?.programs || []); setTypeLabels(r.data?.type_labels || {}); } })
      .catch(() => { if (alive) setPrograms([]); });
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => {
    const list = programs === null ? [] : (programs.length ? programs : FALLBACK_PROGRAMS);
    const order = ["private_lessons", "group_class", "day_train", "board_train", "service_dog"];
    const by = new Map();
    for (const p of list) {
      const k = p.type || "private_lessons";
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(p);
    }
    return [...by.entries()].sort((a, b) => (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0])));
  }, [programs]);

  const groupBlurb = {
    private_lessons: "Hands-on programs for owners who want to be actively involved in the training process.",
    board_train: "Structured residency programs with daily training, socialized play, and consistent behavior work to help your dog reach real-world results faster.",
    day_train: "Focused one-on-one training during your dog's daycare stay.",
    group_class: "Small group sessions for real-world distractions and social skills.",
    service_dog: "Advanced obedience, public access skills, and task-focused training for dependable real-world performance.",
  };

  return (
    <PublicSiteShell testid="public-training">
      <section className="relative overflow-hidden" data-testid="site-training-hero">
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 15% 20%, #a855f7 0%, transparent 36%), radial-gradient(circle at 85% 70%, #8cc63f 0%, transparent 40%)" }} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-8 sm:pt-14 sm:pb-10 sh-splatter">
          <Eyebrow icon="fa-graduation-cap" color="text-shOrange">Training in Warren, Ohio</Eyebrow>
          <Title as="h1" className="text-4xl sm:text-5xl lg:text-6xl">Training levels, Board & Train, and a plan built for your dog.</Title>
          <p className="text-base sm:text-lg text-gray-300 leading-relaxed mt-4 max-w-2xl">{PROMISE.consult_body}</p>
          <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-3">
            <Cta color="green" onClick={bookFree} icon="fa-paw" testid="site-training-book">Book a free consultation</Cta>
            <Cta color="ghost" onClick={openInquiry} icon="fa-pen-to-square" testid="site-training-inquiry">Tell us about your dog</Cta>
          </div>
        </div>
      </section>
      <div className="max-w-6xl mx-auto px-4 sm:px-6"><ContactStrip site={site} /></div>

      {programs === null && (
        <Section testid="site-training-loading"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="sh-site-card h-64 animate-pulse" />)}</div></Section>
      )}
      {groups.map(([type, list], gi) => (
        <Section key={type} tone={gi % 2 === 0 ? "panel" : "base"} id={type} testid={`site-training-group-${type}`}>
          <Eyebrow icon="fa-paw" color={type === "board_train" ? "text-shOrange" : "text-shGreen"}>{typeLabels[type] || list[0]?.type_label || "Training"}</Eyebrow>
          <Title>{type === "board_train" ? "Professional training while they stay & play." : type === "private_lessons" ? "Training levels · private lessons." : (typeLabels[type] || list[0]?.type_label)}</Title>
          {groupBlurb[type] && <p className="text-[15px] text-gray-300 leading-relaxed mt-3 max-w-2xl">{groupBlurb[type]}</p>}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((p) => <ProgramCard key={p.id} p={p} onAsk={openInquiry} />)}
          </div>
          {type === "board_train" && (
            <div className="mt-8 sh-site-band" data-testid="site-training-included">
              <Eyebrow icon="fa-check-double">What's included in every stay?</Eyebrow>
              <p className="text-[14px] text-gray-300 mb-4">Every Board & Train stay includes structured learning, daily care, and support that lasts beyond pickup.</p>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {BOARD_TRAIN_INCLUDED.map((x) => (
                  <li key={x.title} className="flex gap-3">
                    <span className="w-10 h-10 rounded-lg bg-shGreen/15 text-shGreen grid place-items-center shrink-0"><i className={`fas ${x.icon}`} /></span>
                    <span><span className="block text-[13px] font-black uppercase tracking-wide text-white">{x.title}</span><span className="text-[13px] text-gray-300 leading-relaxed">{x.body}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      ))}

      {data?.feature_visibility?.online_school !== false && (
        <Section tone="panel" testid="site-training-school">
          <Eyebrow icon="fa-laptop-file" color="text-shBlue">Prefer to start at home?</Eyebrow>
          <Title>Online School runs on the same lessons our trainers teach in person.</Title>
          <div className="mt-6"><FreeCourseCard testid="site-training-free-course" /></div>
          <a href={ONLINE_SCHOOL_HREF} className="inline-block mt-4 text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-white">Browse all online courses <i className="fas fa-arrow-right ml-1" /></a>
        </Section>
      )}

      <Section testid="site-training-faq">
        <Eyebrow icon="fa-circle-question" color="text-shBlue">Frequently asked questions</Eyebrow>
        <Title>Quick answers about Board & Train, balanced training, and your dog's stay.</Title>
        <div className="mt-8"><FaqList items={FAQ} /></div>
        <p className="mt-6 text-[14px] text-gray-300 sh-site-band"><i className="fas fa-shield-heart text-shGreen mr-2" /><span className="font-black text-white uppercase tracking-wide text-[12px] mr-2">Need help after the program is over?</span>We stand by our work. Every Board & Train program includes lifetime support, so if questions come up or a new behavior pops up, we're here to help for the life of your dog.</p>
      </Section>

      <Section tone="panel" testid="site-training-why">
        <Eyebrow icon="fa-heart" color="text-shOrange">Why choose Sit Happens?</Eyebrow>
        <Title>{ABOUT.headline}</Title>
        <p className="text-[15px] text-gray-300 leading-relaxed mt-3 max-w-3xl">{ABOUT.body}</p>
        <p className="mt-4 sh-display text-xl sm:text-2xl text-shGreen">“{ABOUT.quote}”</p>
      </Section>

      <Section tone="dark">
        <FinalCta site={site} onMeetGreet={openMeetGreet} onInquiry={openInquiry} meetGreetEnabled={meetGreetEnabled} testid="site-training-final" />
      </Section>
      {modals}
    </PublicSiteShell>
  );
}
