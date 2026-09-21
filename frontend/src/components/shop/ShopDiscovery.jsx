import { ShopCard } from "./ShopCards";

/**
 * The restrained bits of the shop: a saved item, a small row of suggestions,
 * and a way back to what you were just looking at.
 *
 * The rule all three follow is the same one: show nothing rather than show
 * filler. A recommendation row with one card, a "recently viewed" containing
 * only the page you are on, a favourites strip with nothing in it — each of
 * those is worse than the whitespace it replaced, so each of them renders as
 * nothing at all.
 */

/**
 * The heart.
 *
 * A real <button>, because it does something, and because a real button is
 * the only version of this that a keyboard and a screen reader both
 * understand for free. Its label says what pressing it will DO rather than
 * what it currently is ("Save" / "Saved"), and `aria-pressed` carries the
 * state — a filled shape alone is not a state anyone can hear.
 *
 * Nothing about it is hover-only. The heart is visible at rest on every
 * card, because a control that appears on hover does not exist on a phone.
 */
export function FavoriteButton({ kind, refId, name, saved, onToggle, busy, className = "", size = "md" }) {
  const label = saved ? `Remove ${name || "this item"} from saved items`
    : `Save ${name || "this item"} for later`;
  // 36px on a card, 44px where it stands alone. 44 is the size a thumb
  // actually hits; a card's heart sits on a photograph and is one of two
  // controls in a small tile, so it takes the smaller of the two — but not
  // the 32px it was, which measured as a miss more often than a press.
  const box = size === "sm" ? "w-9 h-9 text-[14px]" : "w-11 h-11 text-[17px]";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!busy) onToggle?.(kind, refId); }}
      aria-pressed={!!saved}
      aria-label={label}
      title={label}
      disabled={busy}
      data-testid={`shop-favorite-${kind}-${refId}`}
      className={`${box} shrink-0 grid place-items-center rounded-full border transition
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2
        focus-visible:ring-offset-[var(--sh-card-base)] disabled:opacity-60
        ${saved ? "border-shDanger/50 bg-shDanger/10 text-shDanger"
                : "border-shBorder bg-[var(--sh-card-base)] text-shTextMuted hover:text-shText hover:border-shText/40"}
        ${className}`}
    >
      <i className={`${saved ? "fas" : "far"} fa-heart`} aria-hidden="true" />
    </button>
  );
}

/** A heading that is a real heading, so the page outlines correctly and a
 *  screen reader can jump between sections instead of reading everything. */
function RowHeading({ children, sub, testId }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-[13px] sm:text-[15px] font-black uppercase tracking-[0.18em] text-shText"
          data-testid={testId}>
        {children}
      </h2>
      {sub && <p className="text-[11px] text-shTextMuted shrink-0">{sub}</p>}
    </div>
  );
}

/** Three or four cards, never a second catalogue. Two columns on a phone is
 *  deliberate: one column reads as "the page continues", which is exactly
 *  what a suggestion row should not claim. */
function CardRow({ items, cardProps, testId }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" data-testid={testId}>
      {items.map((item) => (
        <ShopCard key={`${item.kind}:${item.id}`} item={item} {...cardProps} />
      ))}
    </div>
  );
}

/**
 * "Pairs well with" / "You may also like".
 *
 * Grouped by what the person curating actually meant, so a deliberate
 * pairing is not flattened into the same anonymous row as a fallback
 * suggestion. A group with nothing in it does not render a heading.
 */
export function Recommendations({ recommendations, cardProps, className = "" }) {
  const groups = [];
  for (const entry of recommendations || []) {
    const label = entry.rel === "same_department" ? "More like this" : entry.label;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(entry.item);
    else groups.push({ label, rel: entry.rel, items: [entry.item] });
  }
  if (groups.length === 0) return null;
  return (
    <section className={className} data-testid="shop-recommendations" aria-label="Recommended items">
      {groups.map((g) => (
        <div key={g.label} className="mb-6 last:mb-0">
          <RowHeading testId={`shop-recommendation-heading-${g.rel}`}>{g.label}</RowHeading>
          <CardRow items={g.items} cardProps={cardProps} testId={`shop-recommendation-row-${g.rel}`} />
        </div>
      ))}
    </section>
  );
}

/**
 * Where you were.
 *
 * Hidden entirely when there is nothing worth showing — which includes the
 * case where the only thing remembered is the page you are standing on. A
 * "recently viewed" row containing one card, and that card being this one,
 * is the kind of detail that makes a shop feel automated rather than
 * looked after.
 */
export function RecentlyViewed({ items, cardProps, className = "", max = 4 }) {
  const shown = (items || []).slice(0, max);
  if (shown.length === 0) return null;
  return (
    <section className={className} data-testid="shop-recently-viewed" aria-label="Recently viewed">
      <RowHeading testId="shop-recently-viewed-heading">Pick up where you left off</RowHeading>
      <CardRow items={shown} cardProps={cardProps} testId="shop-recently-viewed-row" />
    </section>
  );
}

/**
 * The saved-items page.
 *
 * An item that has since been withdrawn stays in the list, says so, and
 * offers to be removed. It is deliberately nameless: the name belongs to an
 * item this client may no longer be allowed to see, and we never stored one
 * to fall back on. "Something you saved is no longer available" is the most
 * that can honestly be said.
 */
export function FavoritesList({ favorites, loading, cardProps, onRemove, onBrowse }) {
  if (loading) {
    return <p className="text-shTextMuted text-sm py-8 text-center" data-testid="shop-favorites-loading">
      Loading your saved items…
    </p>;
  }
  const list = favorites || [];
  if (list.length === 0) {
    return (
      <div className="text-center py-12 px-4" data-testid="shop-favorites-empty">
        <div className="w-14 h-14 rounded-2xl mx-auto grid place-items-center border border-shBorder">
          <i className="far fa-heart text-shTextMuted text-[20px]" aria-hidden="true" />
        </div>
        <h2 className="text-[16px] font-black text-shText mt-4">Nothing saved yet</h2>
        <p className="text-[13px] text-shTextMuted mt-1.5 max-w-sm mx-auto leading-relaxed">
          Tap the heart on anything in the shop and it will be here next time —
          on this device or any other.
        </p>
        {onBrowse && (
          <button onClick={onBrowse} data-testid="shop-favorites-browse"
                  className="mt-5 text-[12px] font-black uppercase tracking-widest text-shPrimary
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary rounded px-2 py-1">
            Browse the shop
          </button>
        )}
      </div>
    );
  }

  const available = list.filter((f) => f.available && f.item);
  const gone = list.filter((f) => !f.available || !f.item);
  return (
    <div data-testid="shop-favorites-list">
      {available.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {available.map((f) => (
            <ShopCard key={`${f.kind}:${f.ref_id}`} item={f.item} {...cardProps} />
          ))}
        </div>
      )}
      {gone.length > 0 && (
        <div className="mt-6" data-testid="shop-favorites-unavailable">
          <RowHeading>No longer available</RowHeading>
          <div className="space-y-2">
            {gone.map((f) => (
              <div key={`${f.kind}:${f.ref_id}`}
                   className="border border-shBorder rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
                <p className="text-[13px] text-shTextMuted">
                  Something you saved is no longer available.
                </p>
                <button onClick={() => onRemove?.(f.kind, f.ref_id)}
                        data-testid={`shop-favorite-remove-${f.kind}-${f.ref_id}`}
                        className="text-[11px] font-black uppercase tracking-widest text-shTextMuted
                                   hover:text-shDanger shrink-0 focus-visible:outline-none
                                   focus-visible:ring-2 focus-visible:ring-shPrimary rounded px-2 py-1">
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
