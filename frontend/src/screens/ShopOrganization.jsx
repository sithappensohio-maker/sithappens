import { useEffect, useMemo, useState } from "react";
import PageHero from "../components/PageHero";
import { api, formatErr } from "../lib/api";

// Shop Organization (Phase 1) — lets an admin group existing pos_products /
// credit_packs / programs into Category -> Subcategory for display, without
// ever touching pricing or the item's underlying kind. Exactly two levels;
// a subcategory always belongs to one parent category.

const KIND_LABEL = { physical_product: "Product", credit_pack: "Credit Pack", training_program: "Training Program" };

// Shopify-linked merchandise is still stored/kinded as physical_product — this
// only affects the label so Shop Organization never confuses a display-only
// Shopify link with a real internal-checkout product.
function itemKindLabel(it) {
  if (it.kind === "physical_product" && it.sales_destination === "shopify_external") return "Shopify Merchandise";
  return KIND_LABEL[it.kind];
}

function StatusPill({ active }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
      active ? "bg-shPrimary/15 border-shPrimary/35 text-shPrimary" : "bg-shBorder/40 border-shBorder text-shTextMuted"
    }`}>
      <i className={`fas ${active ? "fa-circle-check" : "fa-circle-pause"}`} />{active ? "Active" : "Inactive"}
    </span>
  );
}

function MoveControls({ onUp, onDown, onTop, onBottom, disabledUp, disabledDown }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={onTop} disabled={disabledUp} title="Move to top"
              className="w-7 h-7 rounded border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30 disabled:cursor-not-allowed">
        <i className="fas fa-angles-up text-[11px]" />
      </button>
      <button onClick={onUp} disabled={disabledUp} title="Move up"
              className="w-7 h-7 rounded border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30 disabled:cursor-not-allowed">
        <i className="fas fa-chevron-up text-[11px]" />
      </button>
      <button onClick={onDown} disabled={disabledDown} title="Move down"
              className="w-7 h-7 rounded border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30 disabled:cursor-not-allowed">
        <i className="fas fa-chevron-down text-[11px]" />
      </button>
      <button onClick={onBottom} disabled={disabledDown} title="Move to bottom"
              className="w-7 h-7 rounded border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30 disabled:cursor-not-allowed">
        <i className="fas fa-angles-down text-[11px]" />
      </button>
    </div>
  );
}

export default function ShopOrganization({ openCreateOnMount = false, onCreateConsumed = () => {} }) {
  const [tab, setTab] = useState("categories"); // categories | uncategorized | preview
  const [categories, setCategories] = useState([]);
  const [uncategorized, setUncategorized] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState({ name: "", description: "" });

  const [addingSubFor, setAddingSubFor] = useState(null); // category_id
  const [subDraft, setSubDraft] = useState({ name: "", description: "" });

  const [removeTarget, setRemoveTarget] = useState(null); // { type: "category"|"subcategory", row, impact }
  const [removeAction, setRemoveAction] = useState("deactivate");
  const [removeDestination, setRemoveDestination] = useState("");

  const [bulkSelection, setBulkSelection] = useState([]); // [{kind,id}]
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkSubcategoryId, setBulkSubcategoryId] = useState("");

  // Phase 4 — global "+ New" menu reuses this exact same modal.
  useEffect(() => {
    if (openCreateOnMount) {
      setTab("categories");
      setCategoryDraft({ name: "", description: "" });
      setAddingCategory(true);
      onCreateConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [catRes, uncatRes] = await Promise.all([
        api.get("/shop/categories", { params: { include_inactive: true } }),
        api.get("/shop/uncategorized-items"),
      ]);
      setCategories(catRes.data.categories || []);
      setUncategorized(uncatRes.data.items || []);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const saveCategory = async () => {
    setErr("");
    if (!categoryDraft.name.trim()) return setErr("Category name is required.");
    try {
      await api.post("/shop/categories", { name: categoryDraft.name.trim(), description: categoryDraft.description || null });
      setAddingCategory(false);
      setCategoryDraft({ name: "", description: "" });
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const saveSubcategory = async (categoryId) => {
    setErr("");
    if (!subDraft.name.trim()) return setErr("Subcategory name is required.");
    try {
      await api.post("/shop/subcategories", { category_id: categoryId, name: subDraft.name.trim(), description: subDraft.description || null });
      setAddingSubFor(null);
      setSubDraft({ name: "", description: "" });
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const toggleCategoryActive = async (cat) => {
    try {
      await api.put(`/shop/categories/${cat.id}`, { active: !cat.active });
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const toggleSubActive = async (sub) => {
    try {
      await api.put(`/shop/subcategories/${sub.id}`, { active: !sub.active });
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const moveCategory = async (fromIdx, toIdx) => {
    const ids = categories.map((c) => c.id);
    if (toIdx < 0 || toIdx >= ids.length) return;
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    setCategories((prev) => {
      const byId = Object.fromEntries(prev.map((c) => [c.id, c]));
      return ids.map((id) => byId[id]);
    });
    try {
      await api.post("/shop/categories/reorder", { ordered_ids: ids });
    } catch (e) { setErr(formatErr(e)); load(); }
  };

  const moveSubcategory = async (category, fromIdx, toIdx) => {
    const subs = category.subcategories || [];
    if (toIdx < 0 || toIdx >= subs.length) return;
    const ids = subs.map((s) => s.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    try {
      await api.post("/shop/subcategories/reorder", { ordered_ids: ids });
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const openRemoveCategory = async (cat) => {
    try {
      const { data } = await api.get(`/shop/categories/${cat.id}/impact`);
      setRemoveTarget({ type: "category", row: cat, impact: data });
      setRemoveAction("deactivate");
      setRemoveDestination("");
    } catch (e) { setErr(formatErr(e)); }
  };

  const openRemoveSubcategory = (cat, sub) => {
    setRemoveTarget({ type: "subcategory", row: sub, parentCategory: cat, impact: { item_count: sub.item_count } });
    setRemoveAction("deactivate");
    setRemoveDestination("");
  };

  const confirmRemove = async () => {
    setErr("");
    try {
      if (removeTarget.type === "category") {
        const body = { action: removeAction };
        if (removeAction === "move_to_category") body.target_category_id = removeDestination;
        await api.delete(`/shop/categories/${removeTarget.row.id}`, { data: body });
      } else {
        const body = { action: removeAction };
        if (removeAction === "move_to_subcategory") body.target_subcategory_id = removeDestination;
        await api.delete(`/shop/subcategories/${removeTarget.row.id}`, { data: body });
      }
      setRemoveTarget(null);
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const toggleBulkItem = (kind, id) => {
    setBulkSelection((prev) => {
      const exists = prev.find((s) => s.kind === kind && s.id === id);
      if (exists) return prev.filter((s) => !(s.kind === kind && s.id === id));
      return [...prev, { kind, id }];
    });
  };

  const applyBulkAssign = async () => {
    setErr("");
    if (bulkSelection.length === 0) return setErr("Select at least one item.");
    try {
      await api.post("/shop/items/bulk-assign", {
        items: bulkSelection, category_id: bulkCategoryId || null, subcategory_id: bulkSubcategoryId || null,
      });
      setBulkSelection([]);
      setBulkCategoryId("");
      setBulkSubcategoryId("");
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const bulkCategoryOptions = categories.filter((c) => c.active);
  const bulkSubcategoryOptions = (categories.find((c) => c.id === bulkCategoryId)?.subcategories || []).filter((s) => s.active);

  const activeCategoriesForDest = (excludeId) => categories.filter((c) => c.id !== excludeId);

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow={{ icon: "fa-sitemap", text: "Shop Organization", color: "text-shSecondary" }}
        title="Shop Organization"
        highlight="without touching code."
        subtitle="Group products, prepaid-visit packs, and training programs into categories and subcategories clients can browse. Renaming a category never disconnects its items."
      />

      {err && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="shop-org-error">
          {err}
        </div>
      )}

      <div className="flex gap-2 border-b border-shBorder">
        {[["categories", "Categories & Subcategories"], ["uncategorized", `Uncategorized Items (${uncategorized.length})`], ["preview", "Client Preview"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} data-testid={`shop-org-tab-${key}`}
                  className={`px-3 py-2 text-[12px] font-black uppercase tracking-widest border-b-2 -mb-px ${
                    tab === key ? "border-shPrimary text-shPrimary" : "border-transparent text-shTextMuted hover:text-shText"
                  }`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>
      ) : tab === "categories" ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setAddingCategory(true)} data-testid="shop-org-add-category"
                    className="bg-shPrimary text-bgBase px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shPrimary/90">
              <i className="fas fa-plus mr-1" />Add Category
            </button>
          </div>

          {addingCategory && (
            <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-2">
              <input value={categoryDraft.name} onChange={(e) => setCategoryDraft((d) => ({ ...d, name: e.target.value }))}
                     placeholder="Category name (e.g. Dog Gear)" data-testid="shop-org-category-name-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <input value={categoryDraft.description} onChange={(e) => setCategoryDraft((d) => ({ ...d, description: e.target.value }))}
                     placeholder="Optional description"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAddingCategory(false)} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest px-3 py-2">Cancel</button>
                <button onClick={saveCategory} data-testid="shop-org-save-category"
                        className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[12px] tracking-widest">Save Category</button>
              </div>
            </div>
          )}

          {categories.length === 0 && !addingCategory && (
            <div className="text-center text-shTextMuted py-10 text-sm italic">No categories yet. Everything shows as uncategorized.</div>
          )}

          {categories.map((cat, idx) => (
            <div key={cat.id} className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl overflow-hidden" data-testid={`shop-org-category-${cat.id}`}>
              <div className="flex flex-wrap items-center gap-3 p-3">
                <button onClick={() => toggleExpand(cat.id)} className="text-shTextMuted hover:text-shText">
                  <i className={`fas fa-chevron-${expanded[cat.id] ? "down" : "right"} text-[12px]`} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-shText font-bold text-[14px] truncate">{cat.name}</p>
                  <p className="text-[11px] text-shTextMuted">
                    {cat.active_subcategory_count} subcategor{cat.active_subcategory_count === 1 ? "y" : "ies"} · {cat.item_count} item{cat.item_count === 1 ? "" : "s"}
                  </p>
                </div>
                <StatusPill active={cat.active} />
                <MoveControls
                  disabledUp={idx === 0} disabledDown={idx === categories.length - 1}
                  onUp={() => moveCategory(idx, idx - 1)} onDown={() => moveCategory(idx, idx + 1)}
                  onTop={() => moveCategory(idx, 0)} onBottom={() => moveCategory(idx, categories.length - 1)}
                />
                <button onClick={() => toggleCategoryActive(cat)} data-testid={`shop-org-toggle-category-${cat.id}`}
                        className="text-[11px] font-black uppercase text-shSecondary hover:text-shSecondary/80 tracking-widest">
                  {cat.active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => openRemoveCategory(cat)} data-testid={`shop-org-remove-category-${cat.id}`}
                        className="text-[11px] font-black uppercase text-red-400 hover:text-red-300 tracking-widest">
                  Remove
                </button>
              </div>

              {expanded[cat.id] && (
                <div className="border-t border-shBorder p-3 space-y-2 bg-black/10">
                  {(cat.subcategories || []).map((sub, sIdx) => (
                    <div key={sub.id} className="flex flex-wrap items-center gap-3 pl-6 py-1.5" data-testid={`shop-org-subcategory-${sub.id}`}>
                      <i className="fas fa-turn-up fa-rotate-90 text-shTextMuted text-[11px]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-shText text-[13px] font-semibold truncate">{sub.name}</p>
                        <p className="text-[11px] text-shTextMuted">{sub.item_count} item{sub.item_count === 1 ? "" : "s"}</p>
                      </div>
                      <StatusPill active={sub.active} />
                      <MoveControls
                        disabledUp={sIdx === 0} disabledDown={sIdx === (cat.subcategories.length - 1)}
                        onUp={() => moveSubcategory(cat, sIdx, sIdx - 1)} onDown={() => moveSubcategory(cat, sIdx, sIdx + 1)}
                        onTop={() => moveSubcategory(cat, sIdx, 0)} onBottom={() => moveSubcategory(cat, sIdx, cat.subcategories.length - 1)}
                      />
                      <button onClick={() => toggleSubActive(sub)} className="text-[11px] font-black uppercase text-shSecondary hover:text-shSecondary/80 tracking-widest">
                        {sub.active ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => openRemoveSubcategory(cat, sub)} className="text-[11px] font-black uppercase text-red-400 hover:text-red-300 tracking-widest">
                        Remove
                      </button>
                    </div>
                  ))}

                  {addingSubFor === cat.id ? (
                    <div className="ml-6 bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3 space-y-2">
                      <p className="text-[12px] text-shTextMuted">{cat.name} → <span className="text-shText font-bold">{subDraft.name || "New subcategory"}</span></p>
                      <input value={subDraft.name} onChange={(e) => setSubDraft((d) => ({ ...d, name: e.target.value }))}
                             placeholder="Subcategory name" data-testid={`shop-org-subcategory-name-input-${cat.id}`}
                             className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setAddingSubFor(null)} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest px-3 py-1.5">Cancel</button>
                        <button onClick={() => saveSubcategory(cat.id)} data-testid={`shop-org-save-subcategory-${cat.id}`}
                                className="bg-shPrimary text-bgBase px-3 py-1.5 rounded font-black uppercase text-[12px] tracking-widest">Save</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setAddingSubFor(cat.id); setSubDraft({ name: "", description: "" }); }}
                            data-testid={`shop-org-add-subcategory-${cat.id}`}
                            className="ml-6 text-[12px] font-black uppercase text-shPrimary hover:text-shPrimary/80 tracking-widest">
                      <i className="fas fa-plus mr-1" />Add Subcategory
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3 mt-6">
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Bulk Assign Uncategorized Items</p>
            {uncategorized.length === 0 ? (
              <p className="text-[13px] text-shTextMuted italic">No uncategorized items.</p>
            ) : (
              <>
                <div className="max-h-52 overflow-y-auto space-y-1">
                  {uncategorized.map((it) => {
                    const checked = bulkSelection.some((s) => s.kind === it.kind && s.id === it.id);
                    return (
                      <label key={`${it.kind}:${it.id}`} className="flex items-center gap-2 p-1.5 rounded border border-shBorder text-[13px] text-shText cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => toggleBulkItem(it.kind, it.id)} />
                        <span className="flex-1 truncate">{it.name}</span>
                        <span className="text-[11px] uppercase tracking-widest text-shTextMuted">{itemKindLabel(it)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={bulkCategoryId} onChange={(e) => { setBulkCategoryId(e.target.value); setBulkSubcategoryId(""); }}
                          data-testid="shop-org-bulk-category-select"
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                    <option value="">Choose category…</option>
                    {bulkCategoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={bulkSubcategoryId} onChange={(e) => setBulkSubcategoryId(e.target.value)} disabled={!bulkCategoryId}
                          data-testid="shop-org-bulk-subcategory-select"
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm disabled:opacity-40">
                    <option value="">No subcategory</option>
                    {bulkSubcategoryOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="flex justify-end">
                  <button onClick={applyBulkAssign} disabled={!bulkCategoryId} data-testid="shop-org-bulk-apply"
                          className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[12px] tracking-widest disabled:opacity-40">
                    Apply to {bulkSelection.length} item{bulkSelection.length === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : tab === "uncategorized" ? (
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4">
          <div className="bg-shAccent/10 border border-shAccent/30 rounded-lg p-3 text-shAccent text-[13px] mb-3">
            These items are still available in the Shop but are not organized into a category.
          </div>
          {uncategorized.length === 0 ? (
            <p className="text-shTextMuted text-sm italic text-center py-6">Everything is categorized.</p>
          ) : (
            <ul className="space-y-1">
              {uncategorized.map((it) => (
                <li key={`${it.kind}:${it.id}`} className="flex items-center justify-between p-2 border border-shBorder rounded text-[13px] text-shText">
                  <span>{it.name}</span>
                  <span className="text-[11px] uppercase tracking-widest text-shTextMuted">{itemKindLabel(it)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-4">
          <p className="text-[12px] text-shTextMuted">How this looks to clients — inactive categories/subcategories are hidden.</p>
          {categories.filter((c) => c.active).length === 0 ? (
            <p className="text-shTextMuted text-sm italic">No active categories — clients see a flat "All" list.</p>
          ) : (
            categories.filter((c) => c.active).map((c) => (
              <div key={c.id} className="border border-shBorder rounded-lg p-3">
                <p className="text-shText font-bold text-[14px]"><i className="fas fa-folder mr-2 text-shSecondary"/>{c.name}</p>
                {(c.subcategories || []).filter((s) => s.active).length > 0 && (
                  <ul className="mt-2 ml-6 space-y-1">
                    {c.subcategories.filter((s) => s.active).map((s) => (
                      <li key={s.id} className="text-[13px] text-shTextMuted"><i className="fas fa-turn-up fa-rotate-90 mr-2 text-[10px]"/>{s.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {removeTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 grid place-items-center p-4" data-testid="shop-org-remove-modal">
          <div className="bg-bgCard border border-shBorder rounded-2xl p-5 w-full max-w-md space-y-3">
            <p className="text-shText font-bold text-lg">Remove "{removeTarget.row.name}"?</p>
            <p className="text-[13px] text-shTextMuted">
              {removeTarget.type === "category"
                ? `${removeTarget.impact.subcategory_count} subcategor${removeTarget.impact.subcategory_count === 1 ? "y" : "ies"} and ${removeTarget.impact.item_count} Shop item${removeTarget.impact.item_count === 1 ? "" : "s"} currently use this category.`
                : `${removeTarget.impact.item_count} Shop item${removeTarget.impact.item_count === 1 ? "" : "s"} currently use this subcategory.`}
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[13px] text-shText">
                <input type="radio" checked={removeAction === "deactivate"} onChange={() => setRemoveAction("deactivate")} />
                Deactivate instead (recommended) — hides it from clients, keeps everything else
              </label>
              {removeTarget.type === "category" ? (
                <>
                  <label className="flex items-center gap-2 text-[13px] text-shText">
                    <input type="radio" checked={removeAction === "move_to_category"} onChange={() => setRemoveAction("move_to_category")} />
                    Move everything to another category
                  </label>
                  {removeAction === "move_to_category" && (
                    <select value={removeDestination} onChange={(e) => setRemoveDestination(e.target.value)}
                            className="ml-6 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                      <option value="">Choose destination…</option>
                      {activeCategoriesForDest(removeTarget.row.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  <label className="flex items-center gap-2 text-[13px] text-shText">
                    <input type="radio" checked={removeAction === "move_to_uncategorized"} onChange={() => setRemoveAction("move_to_uncategorized")} />
                    Move items to Uncategorized
                  </label>
                </>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-[13px] text-shText">
                    <input type="radio" checked={removeAction === "move_to_subcategory"} onChange={() => setRemoveAction("move_to_subcategory")} />
                    Move items to another subcategory in this category
                  </label>
                  {removeAction === "move_to_subcategory" && (
                    <select value={removeDestination} onChange={(e) => setRemoveDestination(e.target.value)}
                            className="ml-6 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                      <option value="">Choose destination…</option>
                      {(removeTarget.parentCategory.subcategories || []).filter((s) => s.id !== removeTarget.row.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  <label className="flex items-center gap-2 text-[13px] text-shText">
                    <input type="radio" checked={removeAction === "move_to_category"} onChange={() => setRemoveAction("move_to_category")} />
                    Move items to the parent category without a subcategory
                  </label>
                </>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setRemoveTarget(null)} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest px-3 py-2">Cancel</button>
              <button onClick={confirmRemove} data-testid="shop-org-confirm-remove"
                      className="bg-red-500/90 text-white px-4 py-2 rounded font-black uppercase text-[12px] tracking-widest hover:bg-red-500">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
