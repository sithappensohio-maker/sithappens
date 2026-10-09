import { useState } from "react";

// Generic avatar: a real photo when one is known, otherwise a colored
// initial circle — never a broken <img>. `photo` is looked up by the caller
// (per-entity-kind: dogs have one via a lazy GET /dogs/{id} backfill, clients
// in this codebase have no stored photo field at all, so callers simply never
// pass one for them and every row/card falls back to the initial).
function EntityAvatarImg({ photo, label, sizeClass }) {
  const initial = (label || "?").trim().charAt(0).toUpperCase() || "?";
  if (photo) {
    return <img src={photo} alt={label || "Avatar"} className={`${sizeClass} rounded-full object-cover border border-shBorder shrink-0`} />;
  }
  return (
    <div className={`${sizeClass} rounded-full bg-shPrimary/20 text-shPrimary font-black grid place-items-center border border-shBorder shrink-0`}>
      {initial}
    </div>
  );
}

// Shared "search box + scrollable tappable result cards, collapsing into a
// selected-item card once picked" picker. Extracted verbatim (same Tailwind
// classes/sizing/tokens) from AdminBookingModal's Quick Check-in dog picker —
// this is a refactor, not a redesign — so it can be reused for any kind of
// entity (dog, client, …) on any screen that used to hand-roll the same
// plain long <select> dropdown.
//
// `items` is the candidate list: [{ id, primaryLabel, secondaryLabel,
// searchText }]. `photos` is an OPTIONAL { [id]: dataUriOrEmptyString } map —
// pass it (and keep it fed by your own lazy GET-by-id effect, same pattern as
// AdminBookingModal's dogPhotos) when the entity kind actually has photos;
// omit it entirely for one that doesn't (e.g. clients) and every row/card
// gracefully shows only the initial-circle, with no fetch ever attempted
// here — this component never fetches anything itself.
export default function EntitySearchPicker({
  testid,
  items,
  selectedId,
  onSelect,
  photos = {},
  searchPlaceholder = "Search…",
  noItemsLabel = "Nothing on file",
  noMatchesLabel = "No matches",
  renderSelected,
  changeLabel = "Change",
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = (items || []).find(i => i.id === selectedId) || null;
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? (items || [])
    : (items || []).filter(i => (i.searchText || `${i.primaryLabel || ""} ${i.secondaryLabel || ""}`).toLowerCase().includes(q));

  const showSearch = searchOpen || !selectedId;

  return (
    <div data-testid={testid}>
      {showSearch ? (
        <div data-testid={`${testid}-search`}>
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-shTextMuted text-sm" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              data-testid={`${testid}-search-input`}
              className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded-xl pl-9 pr-3 py-3 text-shText text-sm focus:border-shPrimary outline-none"
            />
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-shBorder divide-y divide-shBorder" data-testid={`${testid}-results`}>
            {filtered.length === 0 && (
              <div className="p-4 text-[13px] text-shTextMuted font-black uppercase tracking-widest">
                {(items || []).length === 0 ? noItemsLabel : noMatchesLabel}
              </div>
            )}
            {filtered.map(item => (
              <button key={item.id} type="button"
                      onClick={() => { onSelect(item.id); setSearchOpen(false); setQuery(""); }}
                      data-testid={`${testid}-result-${item.id}`}
                      className="w-full flex items-center gap-3 p-3 min-h-[60px] text-left hover:bg-shPrimary/10 transition">
                <EntityAvatarImg photo={photos[item.id]} label={item.primaryLabel} sizeClass="w-11 h-11 text-[15px]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-black text-shText truncate">{item.primaryLabel}</div>
                  <div className="text-[12.5px] text-shTextMuted truncate">{item.secondaryLabel}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-[var(--sh-card-base)]/60 border border-shBorder rounded-xl p-3" data-testid={`${testid}-selected-card`}>
          <EntityAvatarImg photo={photos[selectedId]} label={selected?.primaryLabel} sizeClass="w-14 h-14 text-[18px]" />
          <div className="flex-1 min-w-0">
            {renderSelected ? renderSelected(selected) : (
              <>
                <div className="text-[16px] font-black text-shText truncate">{selected?.primaryLabel || "—"}</div>
                <div className="text-[13px] text-shTextMuted truncate">{selected?.secondaryLabel}</div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setSearchOpen(true)} data-testid={`${testid}-change`}
                  className="text-[12px] font-black uppercase tracking-widest text-shSecondary hover:opacity-80 whitespace-nowrap">
            {changeLabel}
          </button>
        </div>
      )}
    </div>
  );
}
