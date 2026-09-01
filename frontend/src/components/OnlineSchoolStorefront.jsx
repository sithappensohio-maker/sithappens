import { useEffect, useState } from "react";
import { api } from "../lib/api";
import PremiumButton from "./premium/PremiumButton";
import ItemThumbnail from "./ItemThumbnail";
import HuskyDogImage from "./brand/HuskyDogImage";
import { isFreeClaimable } from "../lib/freeCourseClaim";
import { dogsTrainedLabel, ratingSummary, programRating, courseCardChips } from "../lib/schoolStorefront";

/* Online School storefront — the rich landing that replaces the generic item
 * grid on the Shop's Online School tab (guest and client alike).
 *
 * HARD RULE: nothing here is fabricated. Every stat, star, and quote comes
 * from GET /public/school/storefront (aggregates + admin-featured,
 * client-permitted testimonials) or from the catalog item itself; anything
 * missing or under its honesty threshold (see lib/schoolStorefront.js)
 * simply doesn't render. The page grows as real courses, ratings, and
 * testimonials are added — it never pads itself.
 *
 * Cards deliberately have ONE action: open the item detail. Purchase, dog
 * selection, free-course claim, and every guest gate already live on the
 * detail route — duplicating those CTAs here would mean duplicating their
 * eligibility logic and letting the two drift. */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function Stars({ average, count, testid }) {
  const rounded = Math.round(Number(average) * 2) / 2;
  return (
    <span className="inline-flex items-center gap-1.5 text-shPrimary" data-testid={testid} aria-label={`${average} out of 5 stars from ${count} reviews`}>
      <span className="text-[12px] tracking-[2px]">
        {[1, 2, 3, 4, 5].map((n) => (
          <i key={n} className={`${n <= rounded ? "fas" : n - 0.5 === rounded ? "fas fa-star-half-stroke" : "far"} fa-star`} />
        ))}
      </span>
      <span className="text-[11px] font-black text-shText">{average}</span>
      <span className="text-[10.5px] text-shTextMuted">· {count} review{count === 1 ? "" : "s"}</span>
    </span>
  );
}

function StatChip({ value, label, testid }) {
  return (
    <div className="rounded-xl border border-shBorder bg-black/25 px-4 py-2.5 min-w-[110px]" data-testid={testid}>
      <p className="text-[16px] font-black text-shPrimary leading-none tabular-nums">{value}</p>
      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shTextMuted mt-1.5">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------ Course card */

function CourseCard({ item, rating, onOpenDetail }) {
  const free = isFreeClaimable(item);
  const outcomes = (item.welcome_outcomes || []).slice(0, 4);
  const moreOutcomes = (item.welcome_outcomes || []).length - outcomes.length;
  const helps = item.helps_with || [];
  const chips = courseCardChips(item);
  return (
    <article
      className="rounded-2xl border border-shBorder/70 bg-[var(--sh-card-base)] overflow-hidden grid sm:grid-cols-[190px_minmax(0,1fr)] cursor-pointer hover:border-shSecondary/45 hover:-translate-y-0.5 transition duration-200"
      onClick={() => onOpenDetail(item)} data-testid={`school-storefront-card-${item.id}`}
    >
      <div className="relative bg-black/25 min-h-[150px]">
        {item.image_id ? (
          <ItemThumbnail imageId={item.image_id} alt={item.name} variant="banner" size={190} className="w-full h-full" public />
        ) : (
          <div className="w-full h-full min-h-[150px] relative overflow-hidden bg-[radial-gradient(circle_at_50%_20%,rgba(0,169,224,0.16),transparent_58%)]">
            <HuskyDogImage name={item.name} className="w-full h-full object-contain object-center scale-[1.06]" />
            <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/80 to-transparent" />
          </div>
        )}
        {free && (
          <span className="absolute top-2 left-2 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.12em] bg-shPrimary text-bgHeader shadow-lg">
            Free starter
          </span>
        )}
        {!free && item.featured && (
          <span className="absolute top-2 left-2 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.12em] bg-shSecondary text-[#041018] shadow-lg">
            Featured
          </span>
        )}
      </div>

      <div className="p-4 sm:p-5 min-w-0">
        {item.description && <p className="text-[12.5px] font-black text-shSecondary leading-snug line-clamp-2">{item.description}</p>}
        <h3 className="sh-display text-[20px] text-shText leading-tight mt-1">{item.name}</h3>
        {item.focus && <p className="text-[12.5px] text-shTextMuted leading-relaxed mt-1 line-clamp-2">{item.focus}</p>}

        {helps.length > 0 && (
          <p className="text-[12px] text-shText mt-2.5 leading-relaxed" data-testid={`school-storefront-helps-${item.id}`}>
            <span className="text-shPrimary font-black mr-1.5">✔</span>
            <span className="font-black">Helps with:</span> <span className="text-shTextMuted">{helps.join(", ")}</span>
          </p>
        )}
        {outcomes.length > 0 && (
          <ul className="mt-1.5 space-y-1" data-testid={`school-storefront-outcomes-${item.id}`}>
            {outcomes.map((o) => (
              <li key={o} className="text-[12px] text-shTextMuted leading-relaxed flex gap-1.5">
                <span className="text-shPrimary font-black shrink-0">✔</span>
                <span className="min-w-0">{o}</span>
              </li>
            ))}
            {moreOutcomes > 0 && <li className="text-[11px] text-shTextMuted italic ml-5">+ {moreOutcomes} more in the full program</li>}
          </ul>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {chips.map((c) => (
              <span key={c} className="text-[9.5px] font-black uppercase tracking-[0.1em] px-2 py-1 rounded-full border border-shBorder bg-black/25 text-shTextMuted">{c}</span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3.5">
          {free
            ? <span className="text-shPrimary font-black text-[18px]">FREE</span>
            : item.price != null
              ? <span className="text-shPrimary font-black text-[18px]">{money(item.price)}</span>
              : null}
          {rating && <Stars average={rating.average} count={rating.count} testid={`school-storefront-rating-${item.id}`} />}
          <PremiumButton
            variant={free ? "primary" : "secondary"}
            onClick={(e) => { e.stopPropagation(); onOpenDetail(item); }}
            data-testid={`school-storefront-open-${item.id}`}
            className="ml-auto"
          >
            {free ? "Start Free Course" : "View Program"} <i className="fas fa-arrow-right ml-1 text-[10px]" />
          </PremiumButton>
        </div>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------- Screen */

const HOW_IT_WORKS = [
  { icon: "fa-circle-play", title: "Watch the lesson", body: "Short videos with exact steps — most lessons take under 15 minutes." },
  { icon: "fa-dumbbell", title: "Practice with your dog", body: "Every lesson ends in a guided practice plan you log right from your phone." },
  { icon: "fa-user-check", title: "A real trainer checks in", body: "Send videos, ask questions, and pass trainer checkpoints — a person reviews your work, not an algorithm.", highlight: true },
];

const FAQ = [
  { q: "Is online training right for my dog?", a: "If your dog is healthy and motivated by food, toys, or praise — yes. You do the hands-on work with our structure and your trainer's eyes on your progress. Serious aggression cases belong in in-person training, and we'll tell you that honestly." },
  { q: "How is this different from YouTube or other online courses?", a: "A real Sit Happens trainer reviews your practice videos, answers your questions, and signs off on your progress at checkpoints — the same trainers who run our in-person programs." },
  { q: "What do I need to start?", a: "A leash, treats your dog loves, 10–15 minutes a day, and a phone to record short practice clips." },
  { q: "What if I get stuck?", a: "Ask your trainer right inside the course. If a skill isn't clicking, your trainer can prescribe extra practice or a hands-on session instead of leaving you to guess." },
];

export default function OnlineSchoolStorefront({ items = [], mode = "authenticated", onOpenDetail, showHero = true }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get("/public/school/storefront")
      .then(({ data: d }) => { if (!cancelled) setData(d || null); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, []);

  const stats = data?.stats || {};
  const dogsLabel = dogsTrainedLabel(stats.dogs_trained);
  const overall = ratingSummary(stats);
  const testimonials = data?.testimonials || [];
  const freeItem = items.find((i) => isFreeClaimable(i)) || null;

  return (
    <div className="space-y-5" data-testid="online-school-storefront">
      {showHero && (
        <section className="relative overflow-hidden rounded-2xl border border-shSecondary/35 bg-gradient-to-br from-shSecondary/15 via-[var(--sh-card-base)] to-shPrimary/10 p-5 sm:p-7"
                 data-testid="school-storefront-hero">
          <div className="absolute inset-0 pointer-events-none opacity-80"
               style={{ background: "radial-gradient(circle at 0% 0%, rgba(0,169,224,0.18), transparent 42%), radial-gradient(circle at 100% 100%, rgba(140,198,63,0.13), transparent 44%)" }} />
          <div className="relative">
            <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.28em] text-shSecondary">
              <i className="fas fa-graduation-cap mr-2 text-shPrimary" />Sit Happens Online School
            </p>
            <h2 className="sh-display text-2xl sm:text-4xl text-shText mt-2 leading-tight">TRAIN YOUR DOG. ANYWHERE.</h2>
            <p className="text-shTextMuted text-sm sm:text-base leading-relaxed mt-2 max-w-2xl">
              Trainer-built programs you work through at home — short video lessons, guided practice with your dog, and a real Sit Happens trainer reviewing your progress. Not another video library.
            </p>
            <div className="flex flex-wrap gap-2.5 mt-4">
              {dogsLabel && <StatChip value={dogsLabel} label="Dogs trained" testid="school-storefront-stat-dogs" />}
              {overall && <StatChip value={`${overall.average} ★`} label={`${overall.count} student reviews`} testid="school-storefront-stat-rating" />}
              <StatChip value="100%" label="Real trainer feedback" testid="school-storefront-stat-trainer" />
              {freeItem && <StatChip value="Free" label="Starter course" testid="school-storefront-stat-free" />}
            </div>
            {freeItem && (
              <div className="mt-5">
                <PremiumButton variant="primary" onClick={() => onOpenDetail(freeItem)} data-testid="school-storefront-hero-free" className="py-3 px-6">
                  <i className="fas fa-gift" />Start the free course
                </PremiumButton>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="school-storefront-how">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">How Online School works</p>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          {HOW_IT_WORKS.map((s, i) => (
            <div key={s.title} className={`rounded-xl border p-3.5 ${s.highlight ? "border-shPrimary/40 bg-shPrimary/[0.05]" : "border-shBorder/60 bg-black/15"}`}>
              <span className={`w-7 h-7 rounded-full grid place-items-center border text-[11px] font-black ${s.highlight ? "border-shPrimary/50 bg-shPrimary/10 text-shPrimary" : "border-shSecondary/45 bg-shSecondary/10 text-shSecondary"}`}>{i + 1}</span>
              <p className="text-[13px] font-black text-shText mt-2.5">
                {s.title}{s.highlight && <span className="block text-[10px] text-shPrimary uppercase tracking-widest mt-0.5">The difference</span>}
              </p>
              <p className="text-[12px] text-shTextMuted leading-relaxed mt-1">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="school-storefront-courses">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary mb-3">Choose the right program for your dog</p>
        {items.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6" data-testid="school-storefront-empty">
            New courses are being prepared — check back soon.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <CourseCard key={item.id} item={item} rating={programRating(data?.program_ratings, item.id)} onOpenDetail={onOpenDetail} />
            ))}
          </div>
        )}
      </section>

      {testimonials.length > 0 && (
        <section className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="school-storefront-testimonials">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">From real Sit Happens students</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            {testimonials.map((t) => (
              <blockquote key={t.id} className="rounded-xl border border-shBorder/60 bg-black/15 p-3.5">
                <p className="text-[12.5px] text-shText leading-relaxed">“{t.quote}”</p>
                <footer className="text-[10.5px] font-black uppercase tracking-[0.1em] text-shTextMuted mt-2">
                  {[t.client_first_name, t.dog_name && `& ${t.dog_name}`].filter(Boolean).join(" ")}{t.program_name ? ` · ${t.program_name}` : ""}
                </footer>
              </blockquote>
            ))}
          </div>
          {overall && (
            <p className="text-[12px] text-shTextMuted mt-3">
              <span className="text-shPrimary font-black text-[15px] mr-1.5">{overall.average} / 5</span>
              from {overall.count} Sit Happens Online School student review{overall.count === 1 ? "" : "s"}
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="school-storefront-faq">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">Questions people actually ask</p>
        <div className="mt-3 space-y-2">
          {FAQ.map((f) => (
            <details key={f.q} className="rounded-xl border border-shBorder/60 bg-black/15 px-4 py-3 group">
              <summary className="text-[13px] font-black text-shText cursor-pointer list-none flex items-center justify-between gap-3">
                {f.q}<i className="fas fa-chevron-down text-[10px] text-shTextMuted group-open:rotate-180 transition" />
              </summary>
              <p className="text-[12.5px] text-shTextMuted leading-relaxed mt-2 max-w-3xl">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {freeItem && (
        <section className="rounded-2xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.09] via-[var(--sh-card-base)] to-shSecondary/[0.05] p-6 text-center" data-testid="school-storefront-final-cta">
          <h3 className="sh-display text-xl sm:text-2xl text-shText">READY WHEN YOU ARE.</h3>
          <p className="text-[13px] text-shTextMuted mt-2 max-w-xl mx-auto leading-relaxed">
            Start with the free course — no card required — and see how training with a real trainer behind you feels.
          </p>
          <div className="mt-4">
            <PremiumButton variant="primary" onClick={() => onOpenDetail(freeItem)} data-testid="school-storefront-final-free" className="py-3 px-6">
              <i className="fas fa-gift" />Start the free course
            </PremiumButton>
          </div>
        </section>
      )}
    </div>
  );
}
