import { useMemo, useState } from "react";

/**
 * Curating what goes with what.
 *
 * The whole point of this editor is that nobody types an id. Ids are how
 * this feature gets quietly broken: a pasted id with a trailing space, an id
 * for a product that was archived last month, an id copied from the wrong
 * column. So the only way to add something here is to search for it by name
 * and pick it from a list of things that actually exist.
 *
 * What gets saved is a reference and a relationship type — never a name,
 * price or picture. Those belong to the item being pointed at and are read
 * from it live, which is why renaming a product does not leave a stale label
 * on every page that recommends it.
 *
 * Order is meaningful: it is the order the customer sees, and the person
 * curating decides it. Nothing re-sorts alphabetically behind their back.
 */

export const REL_OPTIONS = [
  { value: "complements", label: "Pairs well with", hint: "Use these together" },
  { value: "related", label: "You may also like", hint: "A reasonable next look" },
  { value: "alternate", label: "Other options", hint: "The other size, or the cheaper one" },
];

const MAX_RELATIONSHIPS = 24;
const MAX_RESULTS = 8;

const keyOf = (r) => `${r.rel}:${r.kind}:${r.ref_id}`;

export default function RelatedItemsEditor({
  value = [], onChange, candidates = [], selfKind = "product", selfId = null,
}) {
  const [rel, setRel] = useState("complements");
  const [query, setQuery] = useState("");

  const chosen = Array.isArray(value) ? value : [];
  const byRef = useMemo(() => {
    const map = new Map();
    for (const c of candidates) map.set(`${c.kind}:${c.id}`, c);
    return map;
  }, [candidates]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const already = new Set(chosen.map(keyOf));
    return candidates
      .filter((c) => {
        // An item cannot be related to itself, so it is not offered. The
        // server refuses it too — this just means nobody has to discover
        // that by being told off.
        if (c.kind === selfKind && c.id === selfId) return false;
        if (already.has(`${rel}:${c.kind}:${c.id}`)) return false;
        return (c.name || "").toLowerCase().includes(q)
          || (c.sku || "").toLowerCase().includes(q);
      })
      .slice(0, MAX_RESULTS);
  }, [query, candidates, chosen, rel, selfKind, selfId]);

  const add = (candidate) => {
    if (chosen.length >= MAX_RELATIONSHIPS) return;
    onChange([...chosen, { rel, kind: candidate.kind, ref_id: candidate.id }]);
    setQuery("");
  };

  const remove = (index) => onChange(chosen.filter((_, i) => i !== index));

  const move = (index, delta) => {
    const next = [...chosen];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div data-testid="related-items-editor" className="space-y-3">
      <div>
        <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Related Items</p>
        <p className="text-[11px] text-shTextMuted mt-0.5">
          Shown on this product&apos;s page, in this order. Anything hidden, inactive or
          sold elsewhere is left out automatically.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {REL_OPTIONS.map((o) => (
          <button key={o.value} type="button" onClick={() => setRel(o.value)}
                  data-testid={`related-rel-${o.value}`}
                  aria-pressed={rel === o.value}
                  title={o.hint}
                  className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border transition
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary
                    ${rel === o.value ? "border-shPrimary/60 bg-shPrimary/10 text-shPrimary"
                                      : "border-shBorder text-shTextMuted hover:text-shText"}`}>
            {o.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <label htmlFor="related-search" className="sr-only">Search for an item to relate</label>
        <input
          id="related-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products, packs and programs by name…"
          data-testid="related-search"
          disabled={chosen.length >= MAX_RELATIONSHIPS}
          className="w-full bg-black/20 border border-shBorder rounded-lg px-3 py-2 text-sm text-shText
                     placeholder:text-shTextMuted focus:outline-none focus:border-shPrimary/60 disabled:opacity-50"
        />
        {results.length > 0 && (
          <ul className="absolute z-30 left-0 right-0 mt-1 border border-shBorder rounded-lg overflow-hidden
                         max-h-64 overflow-y-auto list-none p-0 m-0"
              style={{ background: "var(--sh-card-base)" }} data-testid="related-search-results">
            {results.map((c) => (
              <li key={`${c.kind}:${c.id}`}>
                <button type="button" onClick={() => add(c)}
                        data-testid={`related-add-${c.kind}-${c.id}`}
                        className="w-full text-left px-3 py-2 text-sm text-shText hover:bg-shPrimary/10
                                   focus-visible:outline-none focus-visible:bg-shPrimary/10">
                  <span className="font-bold">{c.name}</span>
                  <span className="text-[11px] text-shTextMuted ml-2 uppercase tracking-widest">
                    {c.kind === "credit_pack" ? "Pack" : c.kind === "training_program" ? "Program" : "Product"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && results.length === 0 && (
          <p className="text-[11px] text-shTextMuted mt-1" data-testid="related-search-empty">
            Nothing matches “{query.trim()}”.
          </p>
        )}
      </div>

      {chosen.length === 0 ? (
        <p className="text-[12px] text-shTextMuted" data-testid="related-items-empty">
          Nothing related yet. The shop will fall back to other items in the same
          category on its own.
        </p>
      ) : (
        <ul className="space-y-1.5 list-none p-0 m-0" data-testid="related-items-chosen">
          {chosen.map((r, i) => {
            const item = byRef.get(`${r.kind}:${r.ref_id}`);
            const relLabel = REL_OPTIONS.find((o) => o.value === r.rel)?.label || r.rel;
            return (
              <li key={`${keyOf(r)}-${i}`}
                  className="flex items-center gap-2 border border-shBorder rounded-lg px-2.5 py-1.5"
                  data-testid={`related-item-${r.kind}-${r.ref_id}`}>
                <div className="flex flex-col shrink-0">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                          aria-label={`Move ${item?.name || "item"} up`}
                          className="text-shTextMuted hover:text-shText disabled:opacity-30 text-[10px] leading-none py-0.5">
                    <i className="fas fa-chevron-up" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === chosen.length - 1}
                          aria-label={`Move ${item?.name || "item"} down`}
                          className="text-shTextMuted hover:text-shText disabled:opacity-30 text-[10px] leading-none py-0.5">
                    <i className="fas fa-chevron-down" aria-hidden="true" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  {/* An item that no longer resolves is shown as missing rather
                      than as a blank row: the reference is still stored, and the
                      admin is the one who should decide whether to drop it. */}
                  <p className="text-[13px] text-shText font-bold truncate">
                    {item ? item.name : "Item no longer available"}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-shTextMuted">{relLabel}</p>
                </div>
                <button type="button" onClick={() => remove(i)}
                        data-testid={`related-remove-${r.kind}-${r.ref_id}`}
                        aria-label={`Remove ${item?.name || "item"}`}
                        className="text-shTextMuted hover:text-shDanger shrink-0 px-1.5
                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary rounded">
                  <i className="fas fa-xmark" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {chosen.length >= MAX_RELATIONSHIPS && (
        <p className="text-[11px] text-shOrange">
          That is the maximum of {MAX_RELATIONSHIPS} related items.
        </p>
      )}
    </div>
  );
}
