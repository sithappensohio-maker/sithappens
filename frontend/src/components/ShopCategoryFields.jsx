import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";

// Shared category/subcategory picker for every Shop-item edit form
// (products, credit packs, training programs — via the legacy panels AND
// the unified Shop Manager). Purely organizational — never touches
// pricing, fulfillment, or credit/training logic. Clears an incompatible
// subcategory whenever the category changes, so an invalid combination is
// never saved.
//
// `section` (Shop Manager unification) — the item's PERMANENT top-level
// section, derived from its kind, never chosen here. Only categories that
// live inside this exact section are ever offered, and a category created
// from this picker is stamped with this section automatically — a Merch
// category can never end up offered to a training program.
//
// Always fetches both active and inactive categories: an item's EXISTING
// assignment must stay visible and selected even if that category or
// subcategory was later deactivated (never silently dropped), while the
// option lists offered for a NEW selection only include active entries.
export default function ShopCategoryFields({ categoryId, subcategoryId, section, onChange }) {
  const [categories, setCategories] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  const load = () => {
    api.get("/shop/categories", { params: { include_inactive: true, ...(section ? { section } : {}) } })
      .then(({ data }) => setCategories(data.categories || []))
      .catch(() => setCategories([]));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [section]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const categoryIsInactive = !!selectedCategory && !selectedCategory.active;
  // Selectable options are active categories, plus the current assignment
  // itself if it happens to be inactive — so it stays visible and labeled
  // rather than disappearing from the dropdown.
  const categoryOptions = categories.filter((c) => c.active || c.id === categoryId);

  const allSubcategories = selectedCategory?.subcategories || [];
  const subcategoryOptions = allSubcategories.filter((s) => s.active || s.id === subcategoryId);
  const selectedSubcategory = allSubcategories.find((s) => s.id === subcategoryId);
  const subcategoryIsInactive = !!selectedSubcategory && !selectedSubcategory.active;
  const noSubcategoriesAvailable = !!categoryId && subcategoryOptions.length === 0;

  const handleCategorySelect = (value) => {
    if (value === "__new__") {
      setCreating(true);
      setNewCategoryName("");
      return;
    }
    onChange({ category_id: value || null, subcategory_id: null });
  };

  const saveNewCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) { toast.error("Category name is required"); return; }
    setSavingNew(true);
    try {
      const { data } = await api.post("/shop/categories", { name, section });
      load();
      onChange({ category_id: data.id, subcategory_id: null });
      setCreating(false);
      setNewCategoryName("");
      toast.success(`"${name}" category created`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create category");
    }
    setSavingNew(false);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Category</label>
          {creating ? (
            <div className="flex gap-1.5">
              <input autoFocus value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)}
                     placeholder="New category name" data-testid="shop-item-new-category-input"
                     onKeyDown={(e) => { if (e.key === "Enter") saveNewCategory(); if (e.key === "Escape") setCreating(false); }}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <button onClick={saveNewCategory} disabled={savingNew} data-testid="shop-item-new-category-save"
                      className="shrink-0 bg-shPrimary text-bgHeader rounded px-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
                {savingNew ? "…" : "Add"}
              </button>
              <button onClick={() => setCreating(false)} className="shrink-0 text-shTextMuted text-[11px] font-black uppercase tracking-widest px-1">
                Cancel
              </button>
            </div>
          ) : (
            <select value={categoryId || ""} data-testid="shop-item-category-select"
                    onChange={(e) => handleCategorySelect(e.target.value)}
                    className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
              <option value="">Uncategorized</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{!c.active ? " (Inactive)" : ""}</option>
              ))}
              {section && <option value="__new__">+ Create new category…</option>}
            </select>
          )}
          {categoryIsInactive && (
            <p className="text-[11px] text-amber-400 mt-1" data-testid="shop-item-category-inactive-note">
              Current category is inactive. It stays assigned until you pick a different one.
            </p>
          )}
        </div>
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Subcategory</label>
          <select value={subcategoryId || ""} data-testid="shop-item-subcategory-select"
                  disabled={!categoryId || subcategoryOptions.length === 0}
                  onChange={(e) => onChange({ category_id: categoryId, subcategory_id: e.target.value || null })}
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm disabled:opacity-40">
            <option value="">
              {!categoryId ? "Select a category first" : noSubcategoriesAvailable ? "No subcategories available" : "None"}
            </option>
            {subcategoryOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{!s.active ? " (Inactive)" : ""}</option>
            ))}
          </select>
          {subcategoryIsInactive && (
            <p className="text-[11px] text-amber-400 mt-1" data-testid="shop-item-subcategory-inactive-note">
              Current subcategory is inactive. It stays assigned until you pick a different one.
            </p>
          )}
        </div>
      </div>
      {section && (
        <p className="text-[11px] text-shTextMuted mt-1.5" data-testid="shop-item-placement-summary">
          {categoryId
            ? <>This item will appear under: <span className="text-shSecondary font-bold">{selectedCategory?.name || "…"}{subcategoryId ? ` → ${selectedSubcategory?.name || "…"}` : ""}</span></>
            : <>This item will appear as <span className="text-shSecondary font-bold">Uncategorized</span></>}
        </p>
      )}
    </div>
  );
}
