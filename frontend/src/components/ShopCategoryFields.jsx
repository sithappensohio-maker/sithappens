import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Shared category/subcategory picker for the three Shop-item edit forms
// (products, credit packs, training programs). Purely organizational —
// never touches pricing, fulfillment, or credit/training logic. Clears an
// incompatible subcategory whenever the category changes, so an invalid
// combination is never saved.
//
// Always fetches both active and inactive categories: an item's EXISTING
// assignment must stay visible and selected even if that category or
// subcategory was later deactivated (never silently dropped), while the
// option lists offered for a NEW selection only include active entries.
export default function ShopCategoryFields({ categoryId, subcategoryId, onChange }) {
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    api.get("/shop/categories", { params: { include_inactive: true } })
      .then(({ data }) => setCategories(data.categories || []))
      .catch(() => setCategories([]));
  }, []);

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

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Category</label>
          <select value={categoryId || ""} data-testid="shop-item-category-select"
                  onChange={(e) => onChange({ category_id: e.target.value || null, subcategory_id: null })}
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="">Uncategorized</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{!c.active ? " (Inactive)" : ""}</option>
            ))}
          </select>
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
    </div>
  );
}
