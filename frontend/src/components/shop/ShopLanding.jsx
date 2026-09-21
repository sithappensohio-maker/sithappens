import { itemsInDepartment, sortItems, packValue } from "../../lib/shopDepartments";
import { ShopCard } from "./ShopCards";
import { ProductImage, Price, money } from "./ShopPrimitives";
import { dogsTrainedLabel, ratingSummary } from "../../lib/schoolStorefront";

/**
 * The Shop's front page.
 *
 * What it replaces: a page where the first product sat 750px down on a
 * desktop and two full screens down on a 320px phone, behind a site header,
 * a page header, a full-width Online School hero, a duplicate "Shop Sit
 * Happens" heading, a tab row and a search box. Everything the business
 * wanted to say came before anything it wanted to sell.
 *
 * So the order here is deliberate, and the hero is deliberately short: a
 * compact band that says where you are and hands you the departments, then
 * PRODUCTS. Everything after that is merchandising, and it gets quieter as
 * it goes down the page — featured gear loud, training explanatory, packs
 * comparative, Online School kept as the strong section it already was,
 * gift cards last before the closing note.
 *
 * Sections render only when they have something in them. A storefront with
 * three empty shelves looks shut.
 */

function SectionHeading({ eyebrow, title, action, onAction, id }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.22em] text-shSecondary">
            {eyebrow}
          </p>
        )}
        <h2 id={id} className="sh-display text-[22px] sm:text-[28px] text-shText leading-tight mt-1">
          {title}
        </h2>
      </div>
      {action && (
        /* -my-2 py-2: the padding is what a thumb hits, and the negative
           margin keeps the heading row looking exactly as it did. Measured
           at 18px tall on a 320px screen in the release acceptance pass,
           which is smaller than the thing pressing it. */
        <button type="button" onClick={onAction}
                className="shrink-0 -my-2 py-2 pl-2 -mr-2 pr-2 text-[12px] font-black uppercase tracking-[0.1em] text-shPrimary
                           hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shPrimary">
          {action} <i className="fas fa-arrow-right ml-1 text-[10px]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * The hero. One job: say whose shop this is, and get out of the way.
 *
 * Uses the admin's own `shop_page.title`/`subtitle` when they are set, so
 * merchandising copy stays where the operator already edits it rather than
 * being hardcoded here. Capped in height so products are visible on a phone
 * without scrolling past a poster first.
 */
function Hero({ shopPage, departments, onSelectDepartment, items, isPublic }) {
  const title = shopPage?.title || "Shop Sit Happens";
  const subtitle = shopPage?.subtitle
    || "Gear we actually use, training that actually works, and visits you can buy up front.";
  return (
    <section data-testid="shop-hero" className="mb-9" aria-labelledby="shop-hero-h">
      {/* Deliberately short. A separate hero band and a separate departments
          row were 878px between them — a full desktop screen, and nearly two
          phone screens, before anything for sale. They said the same thing
          twice, so they are one thing now: who we are, and where to go. */}
      <div className="max-w-[54ch]">
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-shPrimary">Sit Happens</p>
        <h1 id="shop-hero-h" className="sh-display text-[26px] sm:text-[34px] lg:text-[38px] text-shText leading-[1.05] mt-1.5">
          {title}
        </h1>
        <p className="text-[14px] text-shTextMuted leading-relaxed mt-2">{subtitle}</p>
      </div>

      {departments.length > 0 && (
        <nav aria-label="Shop departments"
             className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3 mt-5"
             data-testid="shop-department-tiles">
          {departments.map((d, i) => (
            <DepartmentTile key={d.key} dept={d} onSelect={onSelectDepartment}
                            isPublic={isPublic} coverItem={itemsInDepartment(items, d.key)[0]}
                            /* An odd number of departments leaves the last
                               tile alone in a two-up row with a hole beside
                               it. Letting it span both columns turns a
                               ragged edge into a deliberate one. */
                            wide={departments.length % 2 === 1 && i === departments.length - 1} />
          ))}
        </nav>
      )}
    </section>
  );
}

/** A department as a place you can walk into, for the row under the hero. */
function DepartmentTile({ dept, coverItem, onSelect, isPublic, wide }) {
  return (
    <button type="button" onClick={() => onSelect(dept.key)}
            data-testid={`shop-dept-tile-${dept.key}`}
            className={`${wide ? "col-span-2 lg:col-span-1" : ""} group relative text-left rounded-2xl overflow-hidden border border-shBorder
                       hover:border-shPrimary/50 transition focus-visible:outline focus-visible:outline-2
                       focus-visible:outline-offset-2 focus-visible:outline-shPrimary`}>
      <div className="relative">
        <ProductImage item={coverItem} surface="thumb" ratio="16 / 9" isPublic={isPublic} alt=""
                      className="!rounded-none group-hover:[&>img]:scale-[1.04]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-3">
        <p className="sh-display text-[15px] sm:text-[17px] text-white leading-tight">{dept.label}</p>
        <p className="hidden sm:block text-[11px] text-white/70 mt-0.5 line-clamp-1">{dept.tagline}</p>
      </div>
    </button>
  );
}

export default function ShopLanding({
  items, departments, shopPage, mode, onSelectDepartment, onOpenDetail,
  onAdd, onRequireAccount, onShopify, baselineVisitPrice, schoolStats,
  // The heart, if this viewer has somewhere to save things to. A function
  // rather than a flag so the landing never has to know what a favourite is.
  favoriteSlot,
  bestSellerIds,
  // Lower on the page, and only when there is something to come back to.
  recentlyViewed,
}) {
  const isPublic = mode === "guest";
  const has = (key) => itemsInDepartment(items, key).length > 0;
  const top = (key, n) => sortItems(itemsInDepartment(items, key), "featured").slice(0, n);

  const gear = top("gear", 8);
  const training = top("training", 2);
  const school = top("online_school", 2);
  const packs = top("prepaid", 3);
  const gifts = sortItems(itemsInDepartment(items, "gift_cards"), "price_asc").slice(0, 4);

  const cardProps = { mode, onOpenDetail, onAdd, onRequireAccount, onShopify, favoriteSlot, bestSellerIds };

  return (
    <div className="space-y-10 sm:space-y-14" data-testid="shop-landing">
      <Hero shopPage={shopPage} departments={departments} items={items}
            onSelectDepartment={onSelectDepartment} isPublic={isPublic} />

      {gear.length > 0 && (
        <section aria-labelledby="shop-gear-h">
          <SectionHeading id="shop-gear-h" eyebrow="Gear" title="Kit we actually use"
                          action="All gear" onAction={() => onSelectDepartment("gear")} />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 sm:gap-x-5">
            {gear.map((item) => <ShopCard key={item.id} item={item} {...cardProps} />)}
          </div>
        </section>
      )}

      {training.length > 0 && (
        <section aria-labelledby="shop-training-h">
          <SectionHeading id="shop-training-h" eyebrow="Training" title="Work with a trainer"
                          action="All training" onAction={() => onSelectDepartment("training")} />
          <div className="grid grid-cols-1 gap-4">
            {training.map((item) => <ShopCard key={item.id} item={item} {...cardProps} />)}
          </div>
        </section>
      )}

      {packs.length > 0 && (
        <section aria-labelledby="shop-packs-h">
          <SectionHeading id="shop-packs-h" eyebrow="Prepaid Visits" title="Buy visits up front"
                          action="All packs" onAction={() => onSelectDepartment("prepaid")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {packs.map((item) => (
              <ShopCard key={item.id} item={item} baselinePrice={baselineVisitPrice} {...cardProps} />
            ))}
          </div>
        </section>
      )}

      {school.length > 0 && (
        <section aria-labelledby="shop-school-h"
                 className="relative overflow-hidden rounded-2xl border border-shSecondary/30 p-5 sm:p-7"
                 style={{ background: "linear-gradient(135deg, rgba(0,169,224,0.10), transparent 55%)" }}
                 data-testid="shop-school-spotlight">
          <SectionHeading id="shop-school-h" eyebrow="Sit Happens Online School"
                          title="Train your dog, anywhere"
                          action="All courses" onAction={() => onSelectDepartment("online_school")} />
          <p className="text-[14px] text-shTextMuted leading-relaxed max-w-[60ch] -mt-2 mb-4">
            Real Sit Happens training in a guided online format — clear lessons,
            hands-on practice, progress tracking, and trainer-built programmes
            you work through at home.
          </p>
          {/* Real numbers or nothing. `dogsTrainedLabel`/`ratingSummary`
              return null until the data clears its own honesty threshold, so
              a fresh install shows the plain value pills rather than
              "4.9 from 0 reviews". */}
          {(() => {
            const dogs = dogsTrainedLabel(schoolStats?.dogs_trained);
            const rating = ratingSummary(schoolStats);
            const chips = [
              dogs && { key: "dogs", icon: "fa-paw", text: `${dogs} dogs trained`, real: true },
              rating && { key: "rating", icon: "fa-star", text: `${rating.average} from ${rating.count} reviews`, real: true },
              !dogs && !rating && { key: "paced", icon: "fa-circle-play", text: "Self-paced" },
              !dogs && !rating && { key: "guided", icon: "fa-list-check", text: "Guided practice" },
              { key: "feedback", icon: "fa-user-check", text: "Real trainer feedback" },
            ].filter(Boolean);
            return (
              <ul className="flex flex-wrap gap-2 mb-5" aria-label="About Online School">
                {chips.map((c) => (
                  <li key={c.key}
                      data-testid={c.real ? `shop-school-stat-${c.key}` : undefined}
                      className="px-2.5 py-1.5 rounded-full border border-shSecondary/30 bg-shSecondary/10
                                 text-shSecondary text-[11px] font-black uppercase tracking-wider">
                    <i className={`fas ${c.icon} mr-1.5`} aria-hidden="true" />{c.text}
                  </li>
                ))}
              </ul>
            );
          })()}
          <div className="grid grid-cols-1 gap-4">
            {school.map((item) => <ShopCard key={item.id} item={item} {...cardProps} />)}
          </div>
        </section>
      )}

      {recentlyViewed}

      {gifts.length > 0 && (
        <section aria-labelledby="shop-gifts-h">
          <SectionHeading id="shop-gifts-h" eyebrow="Gift Cards" title="For the dog person in your life"
                          action="All amounts" onAction={() => onSelectDepartment("gift_cards")} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {gifts.map((item) => <ShopCard key={item.id} item={item} {...cardProps} />)}
          </div>
        </section>
      )}

      {/* Why shop here. Three plain facts about how this business actually
          works — not testimonials, not star ratings, nothing invented. */}
      <section aria-labelledby="shop-trust-h" data-testid="shop-trust">
        <h2 id="shop-trust-h" className="sr-only">Why shop with Sit Happens</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            ["fa-store", "Collect in store", "Order online, pick it up next time you are in. No postage, no waiting in."],
            ["fa-lock", "Secure checkout", "Payment is handled by Stripe. We never see your card details."],
            ["fa-paw", "Chosen by trainers", "Everything here is kit we use in class, not a catalogue we drop-ship."],
          ].map(([icon, title, body]) => (
            <div key={title} className="rounded-xl border border-shBorder p-4" style={{ background: "var(--sh-card-base)" }}>
              <i className={`fas ${icon} text-shPrimary`} aria-hidden="true" />
              <p className="text-[14px] font-bold text-shText mt-2">{title}</p>
              <p className="text-[12.5px] text-shTextMuted leading-relaxed mt-1">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
