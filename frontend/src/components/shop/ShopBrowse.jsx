import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SORTS, availableFilters, activeFilterCount, EMPTY_FILTERS,
} from "../../lib/shopDepartments";
import { ShopCard } from "./ShopCards";
import { GridSkeleton } from "./ShopPrimitives";

/**
 * Browsing: departments, search, sort, filters, and the grid itself.
 *
 * The rule running through all of it — a control is only shown when it could
 * change what is on screen. `availableFilters` decides that from the actual
 * items, so a department with one category never grows a category filter and
 * nobody ever opens a filter sheet to find one disabled checkbox.
 */

// ═════════════════════════════════════════════════ department navigation

/**
 * Departments as a real navigation, not a row of tabs named after tables.
 *
 * On a phone it scrolls horizontally and the active one is scrolled into
 * view, because at 320px five departments cannot fit and truncating them
 * into icons makes them unreadable. `aria-current` rather than colour alone
 * carries which one you are in.
 */
export function DepartmentNav({ departments, current, onSelect, showAll = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const active = ref.current?.querySelector('[aria-current="page"]');
    // Guarded because scrolling the active department into view is a nicety,
    // and a missing scrollIntoView (jsdom, older embedded webviews) must not
    // take the navigation down with it.
    if (typeof active?.scrollIntoView !== "function") return;
    try { active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }
    catch { /* not worth failing a render over */ }
  }, [current]);

  const tabs = showAll
    ? [{ key: null, label: "All", count: null }, ...departments]
    : departments;

  return (
    <nav aria-label="Shop departments" className="relative">
      <ul ref={ref}
          className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap"
          data-testid="shop-department-nav">
        {tabs.map((d) => {
          const active = (d.key || null) === (current || null);
          return (
            <li key={d.key || "all"} className="shrink-0">
              <button type="button" onClick={() => onSelect(d.key)}
                      aria-current={active ? "page" : undefined}
                      data-testid={`shop-dept-${d.key || "all"}`}
                      className={`px-3.5 py-2 rounded-full text-[12px] font-black uppercase tracking-[0.1em] transition
                        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shPrimary
                        ${active
                          ? "bg-shPrimary text-bgHeader"
                          : "border border-shBorder text-shTextMuted hover:text-shText hover:border-shPrimary/50"}`}>
                {d.label}
                {d.count != null && (
                  <span className={`ml-1.5 tabular-nums ${active ? "opacity-70" : "opacity-50"}`}>{d.count}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════ search

/**
 * Search that does not thrash.
 *
 * Filtering happens in the browser over an already-loaded catalog, so there
 * is no request per keystroke to debounce — but the input still owns its own
 * value and hands it up on a short delay, so a fast typist does not re-sort
 * twenty-three cards on every letter.
 */
export function ShopSearch({ value, onChange, placeholder = "Search the shop…", resultCount }) {
  const id = useId();
  const [local, setLocal] = useState(value || "");
  useEffect(() => { setLocal(value || ""); }, [value]);
  useEffect(() => {
    if (local === (value || "")) return;
    const t = setTimeout(() => onChange(local), 140);
    return () => clearTimeout(t);
  }, [local]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex-1 min-w-0">
      <label htmlFor={id} className="sr-only">Search the shop</label>
      <i className="fas fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-shTextMuted text-[13px] pointer-events-none"
         aria-hidden="true" />
      <input id={id} type="search" value={local} placeholder={placeholder}
             onChange={(e) => setLocal(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Escape" && local) { setLocal(""); onChange(""); } }}
             data-testid="shop-search"
             className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-shBorder bg-black/25 text-shText
                        text-[14px] placeholder:text-shTextMuted/70
                        focus:border-shPrimary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary/40" />
      {local && (
        <button type="button" onClick={() => { setLocal(""); onChange(""); }}
                aria-label="Clear search" data-testid="shop-search-clear"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full grid place-items-center
                           text-shTextMuted hover:text-shText focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary">
          <i className="fas fa-xmark text-[13px]" aria-hidden="true" />
        </button>
      )}
      {value && resultCount != null && (
        <p className="sr-only" role="status" aria-live="polite">
          {resultCount} {resultCount === 1 ? "result" : "results"} for {value}
        </p>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════ sort

export function SortSelect({ value, onChange }) {
  const id = useId();
  return (
    <div className="shrink-0">
      <label htmlFor={id} className="sr-only">Sort products</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
              data-testid="shop-sort"
              className="py-2.5 pl-3 pr-8 rounded-xl border border-shBorder bg-black/25 text-shText text-[13px] font-bold
                         focus:border-shPrimary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary/40">
        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════ filters

function FilterFields({ options, filters, onChange }) {
  return (
    <div className="space-y-5">
      {options.categories.length > 0 && (
        <fieldset>
          <legend className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2">Category</legend>
          <div className="flex flex-wrap gap-1.5">
            {[{ id: null, name: "All" }, ...options.categories].map((c) => {
              const active = (filters.categoryId || null) === c.id;
              return (
                <button key={c.id || "all"} type="button" aria-pressed={active}
                        onClick={() => onChange({ ...filters, categoryId: c.id })}
                        data-testid={`shop-filter-cat-${c.id || "all"}`}
                        className={`px-3 py-1.5 rounded-full text-[12px] font-bold transition
                          focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary
                          ${active ? "bg-shPrimary text-bgHeader" : "border border-shBorder text-shTextMuted hover:text-shText"}`}>
                  {c.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {options.availability && (
        <fieldset>
          <legend className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2">Availability</legend>
          <label className="inline-flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={filters.availability === "in_stock"}
                   onChange={(e) => onChange({ ...filters, availability: e.target.checked ? "in_stock" : "any" })}
                   data-testid="shop-filter-instock"
                   className="w-4 h-4 accent-[var(--sh-primary,#8cc63f)]" />
            <span className="text-[13px] text-shText">In stock only</span>
          </label>
        </fieldset>
      )}

      {options.priceRange && (
        <fieldset>
          <legend className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-2">
            Up to <span className="text-shPrimary tabular-nums">
              ${filters.maxPrice ?? options.priceRange.max}
            </span>
          </legend>
          <input type="range" min={options.priceRange.min} max={options.priceRange.max}
                 value={filters.maxPrice ?? options.priceRange.max}
                 aria-label="Maximum price"
                 onChange={(e) => {
                   const v = Number(e.target.value);
                   onChange({ ...filters, maxPrice: v >= options.priceRange.max ? null : v });
                 }}
                 data-testid="shop-filter-price"
                 className="w-full accent-[var(--sh-primary,#8cc63f)]" />
        </fieldset>
      )}
    </div>
  );
}

/**
 * Filters: inline on a desktop sidebar, a sheet on a phone.
 *
 * The sheet traps focus and closes on Escape, because a drawer you cannot
 * get out of with a keyboard is worse than no drawer. Apply/Reset are
 * explicit on mobile — changing a filter and watching the page move behind
 * a sheet you cannot see is disorienting.
 */
export function FilterControls({ items, filters, onChange, compact }) {
  const options = availableFilters(items);
  const hasAny = options.categories.length > 0 || options.availability || options.priceRange;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const sheetRef = useRef(null);
  const count = activeFilterCount(filters);

  useEffect(() => { if (open) setDraft(filters); }, [open, filters]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    sheetRef.current?.querySelector("button, input")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!hasAny) return null;

  if (!compact) {
    return (
      <aside aria-label="Filters" data-testid="shop-filters-inline"
             className="hidden lg:block w-[210px] shrink-0">
        <div className="sticky top-4 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-black uppercase tracking-[0.16em] text-shText">Filter</h2>
            {count > 0 && (
              <button type="button" onClick={() => onChange(EMPTY_FILTERS)}
                      data-testid="shop-filter-reset"
                      className="text-[11px] font-bold text-shPrimary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary">
                Reset
              </button>
            )}
          </div>
          <FilterFields options={options} filters={filters} onChange={onChange} />
        </div>
      </aside>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="shop-filter-open"
              className="lg:hidden shrink-0 px-3.5 py-2.5 rounded-xl border border-shBorder text-shText text-[13px] font-bold
                         hover:border-shPrimary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary">
        <i className="fas fa-sliders mr-1.5 text-[12px]" aria-hidden="true" />Filter
        {count > 0 && (
          <span className="ml-1.5 px-1.5 rounded-full bg-shPrimary text-bgHeader text-[11px] tabular-nums"
                data-testid="shop-filter-count">{count}</span>
        )}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
             role="dialog" aria-modal="true" aria-label="Filter products"
             data-testid="shop-filter-sheet">
          <button type="button" aria-label="Close filters" onClick={() => setOpen(false)}
                  className="absolute inset-0 bg-black/70" />
          <div ref={sheetRef}
               className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border-t sm:border border-shBorder
                          p-5 pb-7 max-h-[80vh] overflow-y-auto"
               style={{ background: "var(--sh-card-base)" }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-shText font-black uppercase tracking-widest text-sm">Filter</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close filters"
                      className="text-shTextMuted hover:text-shText focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary">
                <i className="fas fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <FilterFields options={options} filters={draft} onChange={setDraft} />
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={() => { setDraft(EMPTY_FILTERS); onChange(EMPTY_FILTERS); setOpen(false); }}
                      data-testid="shop-filter-sheet-reset"
                      className="flex-1 py-2.5 rounded-xl border border-shBorder text-shText text-[12px] font-black uppercase tracking-widest">
                Reset
              </button>
              <button type="button" onClick={() => { onChange(draft); setOpen(false); }}
                      data-testid="shop-filter-apply"
                      className="flex-1 py-2.5 rounded-xl bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest">
                Show results
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════ grid

/**
 * The grid, with a column count that follows the department rather than one
 * breakpoint set for everything.
 *
 *   grid   merchandise — 2 up on a phone, because one product per screen is
 *          a catalogue you scroll past rather than browse. 320px gets 2 as
 *          well: at 148px a card still shows a photo, a name and a price,
 *          which is all a merch card has.
 *   editorial  training — one wide card per row; these are read, not scanned.
 *   value  packs — two up from tablet, so they can be compared side by side.
 */
const GRID_CLASS = {
  grid: "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 sm:gap-x-5",
  editorial: "grid grid-cols-1 gap-4",
  value: "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4",
  gift: "grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4",
};

export function ProductGrid({ items, layout = "grid", loading, skeletonCount = 8, ...cardProps }) {
  const cls = GRID_CLASS[layout] || GRID_CLASS.grid;
  if (loading) return <GridSkeleton count={skeletonCount} className={cls} />;
  return (
    <div className={cls} data-testid="shop-product-grid" data-layout={layout}>
      {items.map((item) => (
        <ShopCard key={`${item.kind}-${item.id}`} item={item} {...cardProps} />
      ))}
    </div>
  );
}
