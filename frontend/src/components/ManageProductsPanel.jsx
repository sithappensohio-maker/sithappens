/* Manage Products — simple retail stock management, reached from Front Desk.
 *
 * No barcodes, no SKU/UPC requirement. Reuses the existing pos_products
 * catalog (GET/POST/PUT /pos/products) and adds the stock side: starting
 * stock at creation, POST /pos/products/{id}/adjust-stock for receiving
 * shipments and manual corrections (always with a reason, never a silent
 * edit), and GET /pos/products/{id}/movements for history. Editing a
 * product's info (name/price/etc.) never touches stock_on_hand — that only
 * changes via a sale, a void, or an explicit adjustment here.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import ShopImageUpload from "./ShopImageUpload";
import ShopCategoryFields from "./ShopCategoryFields";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const BLANK_FORM = {
  name: "", category: "", description: "", price: "", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  show_online: false, online_description: "", image_id: null, online_sort_order: "",
  category_id: null, subcategory_id: null, featured: false, show_at_register: true,
  sales_destination: "internal", shopify_product_url: "", shopify_display_price: "", shopify_from_price: false,
  // Public no-account storefront — see the "Public Storefront" section of
  // the editor below. guest_cart_allowed never permits guest checkout, only
  // temporary local cart placement.
  publicly_visible: false, guest_cart_allowed: false, show_public_price: true,
  requires_approval: false, requires_completed_onboarding: false,
};

// Shared product add/edit form — used by this panel AND the unified Shop
// Manager Items tab. Parent owns `form`/`setForm`/`originalImageId` state
// and the actual save call (mirrors ProgramEditor's pattern in Programs.jsx);
// this component is purely presentational/input-bound so there is exactly
// ONE product form implementation, never a second copy to keep in sync.
export function ProductEditor({ form, setForm, editingId, originalImageId, saving, onSave, onClose }) {
  return (
    <div className="space-y-3">
      <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black">{editingId ? "Edit Product" : "Add Product"}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Product Name *</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                 className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
        </div>

        <div className="col-span-2">
          <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Sales Destination</label>
          <div className="flex gap-2 mt-1">
            <button type="button" data-testid="destination-internal"
                    onClick={() => setForm((f) => ({ ...f, sales_destination: "internal" }))}
                    className={`flex-1 rounded px-3 py-2 text-[12px] font-black uppercase tracking-widest ${form.sales_destination === "internal" ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
              Internal Sit Happens Checkout
            </button>
            <button type="button" data-testid="destination-shopify"
                    onClick={() => setForm((f) => ({ ...f, sales_destination: "shopify_external" }))}
                    className={`flex-1 rounded px-3 py-2 text-[12px] font-black uppercase tracking-widest ${form.sales_destination === "shopify_external" ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
              External Shopify Product
            </button>
          </div>
          <p className="text-[11px] text-shTextMuted mt-1">
            Shopify products are display-only links in the Shop — Shopify alone handles pricing, variants, inventory, tax, and checkout.
          </p>
        </div>

        {form.sales_destination === "internal" && (
          <>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Register Group (optional)</label>
              <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
              <p className="text-[11px] text-shTextMuted mt-0.5">Groups products into tabs on the in-person register only. Use Shop Category below for the client Shop.</p>
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Selling Price *</label>
              <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Cost (optional)</label>
              <input type="number" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">
                {editingId ? "Stock On Hand (use Receive/Adjust to change)" : "Starting Stock"}
              </label>
              <input type="number" disabled={!!editingId} value={form.starting_stock}
                     onChange={(e) => setForm((f) => ({ ...f, starting_stock: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText disabled:opacity-50" />
            </div>
          </>
        )}

        <div className="col-span-2">
          <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Description (optional)</label>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                 className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
        </div>

        {form.sales_destination === "shopify_external" && (
          <>
            <div className="col-span-2">
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Shopify Product URL *</label>
              <input value={form.shopify_product_url} onChange={(e) => setForm((f) => ({ ...f, shopify_product_url: e.target.value }))}
                     placeholder="https://yourstore.myshopify.com/products/..."
                     data-testid="product-shopify-url"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
              <p className="text-[11px] text-shTextMuted mt-0.5">Must be a secure https:// link. Clients are sent here to view options and check out on Shopify.</p>
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Displayed Price (optional)</label>
              <input type="number" value={form.shopify_display_price}
                     onChange={(e) => setForm((f) => ({ ...f, shopify_display_price: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
              <input type="checkbox" id="from-price" checked={form.shopify_from_price}
                     onChange={(e) => setForm((f) => ({ ...f, shopify_from_price: e.target.checked }))} />
              <label htmlFor="from-price" className="text-shText text-sm">Show as "From" price</label>
            </div>
            <p className="col-span-2 text-[11px] text-shTextMuted">
              Admin note: this price is informational only — the final Shopify price may vary by size, color, promotion, or variant. Client-specific and grandfathered pricing never applies here; Shopify controls this price.
            </p>
          </>
        )}

        {form.sales_destination === "internal" && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="track-inv" checked={form.track_inventory}
                   onChange={(e) => setForm((f) => ({ ...f, track_inventory: e.target.checked }))} />
            <label htmlFor="track-inv" className="text-shText text-sm">Track Inventory</label>
          </div>
        )}
        {form.sales_destination === "internal" && form.track_inventory && (
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Low Stock Warning</label>
            <input type="number" value={form.low_stock_threshold}
                   onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))}
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="active" checked={form.active}
                 onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          <label htmlFor="active" className="text-shText text-sm">Active</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="featured" checked={form.featured}
                 onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))} />
          <label htmlFor="featured" className="text-shText text-sm">Featured in Shop</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="show-at-register" checked={form.show_at_register}
                 onChange={(e) => setForm((f) => ({ ...f, show_at_register: e.target.checked }))}
                 data-testid="product-show-at-register" />
          <label htmlFor="show-at-register" className="text-shText text-sm">Show at Register</label>
        </div>
      </div>

      {/* Shop Organization — purely organizational, independent of online
          visibility. An item can be categorized whether or not it's
          shown in the client Shop. */}
      <div className="border-t border-shBorder pt-3 mt-1 space-y-3">
        <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Shop Category</p>
        <ShopCategoryFields categoryId={form.category_id} subcategoryId={form.subcategory_id} section="merch"
                            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
      </div>

      {/* Client Shop Phase 1 — additive online-visibility controls. */}
      <div className="border-t border-shBorder pt-3 mt-1 space-y-3">
        <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Client Shop</p>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="show-online" checked={form.show_online}
                 onChange={(e) => setForm((f) => ({ ...f, show_online: e.target.checked }))}
                 data-testid="product-show-online" />
          <label htmlFor="show-online" className="text-shText text-sm">Show Online (client Shop)</label>
        </div>
        {form.show_online && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Online Description (optional — falls back to Description)</label>
              <input value={form.online_description} onChange={(e) => setForm((f) => ({ ...f, online_description: e.target.value }))}
                     data-testid="product-online-description"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Sort Order (optional)</label>
              <input type="number" value={form.online_sort_order}
                     onChange={(e) => setForm((f) => ({ ...f, online_sort_order: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Product Photo</label>
              <ShopImageUpload imageId={form.image_id} originalImageId={originalImageId}
                               onChange={(id) => setForm((f) => ({ ...f, image_id: id }))} />
            </div>
          </div>
        )}
      </div>

      {/* Public no-account storefront — only meaningful for internally-
          fulfilled, online-shown products. Shopify listings always bypass
          these fields entirely (Shopify governs its own guest browsing). */}
      {form.show_online && form.sales_destination === "internal" && (
        <div className="border-t border-shBorder pt-3 mt-1 space-y-3">
          <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Public Storefront (signed-out visitors)</p>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="publicly-visible" checked={form.publicly_visible}
                   onChange={(e) => setForm((f) => ({ ...f, publicly_visible: e.target.checked }))}
                   data-testid="product-publicly-visible" />
            <label htmlFor="publicly-visible" className="text-shText text-sm">Publicly Visible (shown to signed-out visitors)</label>
          </div>
          {form.publicly_visible && (
            <>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="guest-cart-allowed" checked={form.guest_cart_allowed}
                       onChange={(e) => setForm((f) => ({ ...f, guest_cart_allowed: e.target.checked }))}
                       data-testid="product-guest-cart-allowed" />
                <label htmlFor="guest-cart-allowed" className="text-shText text-sm">Allow guests to add to cart — never allows guest checkout</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="show-public-price" checked={form.show_public_price}
                       onChange={(e) => setForm((f) => ({ ...f, show_public_price: e.target.checked }))}
                       data-testid="product-show-public-price" />
                <label htmlFor="show-public-price" className="text-shText text-sm">Show Price to Guests</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="requires-approval" checked={form.requires_approval}
                       onChange={(e) => setForm((f) => ({ ...f, requires_approval: e.target.checked }))}
                       data-testid="product-requires-approval" />
                <label htmlFor="requires-approval" className="text-shText text-sm">Requires Approval</label>
              </div>
              {form.requires_approval && (
                <p className="text-[11px] text-shOrange" data-testid="product-requires-approval-warning">
                  Enabling this blocks online checkout entirely until approval support is built — customers will be directed to contact staff instead.
                </p>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" id="requires-onboarding" checked={form.requires_completed_onboarding}
                       onChange={(e) => setForm((f) => ({ ...f, requires_completed_onboarding: e.target.checked }))}
                       data-testid="product-requires-onboarding" />
                <label htmlFor="requires-onboarding" className="text-shText text-sm">Requires Completed Account Setup</label>
              </div>
            </>
          )}
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">
          Cancel
        </button>
        <button onClick={onSave} disabled={saving}
                className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function stockStatus(p) {
  if (!p.active) return { label: "INACTIVE", cls: "text-shTextMuted bg-shSurfaceRaised" };
  if (!p.track_inventory) return { label: "NOT TRACKED", cls: "text-shTextMuted bg-shSurfaceRaised" };
  const stock = Number(p.stock_on_hand || 0);
  if (stock <= 0.0005) return { label: "OUT OF STOCK", cls: "text-red-400 bg-red-500/10" };
  if (p.low_stock_threshold != null && stock <= Number(p.low_stock_threshold) + 0.0005) {
    return { label: "LOW STOCK", cls: "text-shAccent bg-shAccent/10" };
  }
  return { label: "IN STOCK", cls: "text-shPrimary bg-shPrimary/10" };
}

export default function ManageProductsPanel({ onClose, onChanged }) {
  const [products, setProducts] = useState([]);
  const [archivedProducts, setArchivedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | low | out | inactive | archived

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get("/pos/products", { params: { include_inactive: true } }),
      api.get("/pos/products", { params: { include_archived: true } }),
    ])
      .then(([normal, archived]) => {
        setProducts(normal.data || []);
        setArchivedProducts(archived.data || []);
      })
      .catch(() => toast.error("Could not load products"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Shop Organization category/subcategory names, for the list column only —
  // the Add/Edit form itself uses ShopCategoryFields, which resolves its own
  // names. Fetched once so the table can show "Category / Subcategory"
  // instead of raw ids.
  const [shopCategories, setShopCategories] = useState([]);
  useEffect(() => {
    api.get("/shop/categories", { params: { include_inactive: true } })
      .then(({ data }) => setShopCategories(data.categories || []))
      .catch(() => setShopCategories([]));
  }, []);
  const shopCategoryLabel = (p) => {
    if (!p.category_id) return "Uncategorized";
    const cat = shopCategories.find((c) => c.id === p.category_id);
    if (!cat) return "Uncategorized";
    const sub = (cat.subcategories || []).find((s) => s.id === p.subcategory_id);
    return sub ? `${cat.name} / ${sub.name}` : cat.name;
  };

  const filtered = useMemo(() => {
    const source = filter === "archived" ? archivedProducts : products;
    return source.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "archived") return true; // source is already archived-only
      if (filter === "inactive") return !p.active;
      if (!p.active) return filter === "all" ? true : false;
      if (filter === "low") {
        return p.track_inventory && p.low_stock_threshold != null &&
          Number(p.stock_on_hand || 0) <= Number(p.low_stock_threshold) + 0.0005 && Number(p.stock_on_hand || 0) > 0.0005;
      }
      if (filter === "out") return p.track_inventory && Number(p.stock_on_hand || 0) <= 0.0005;
      return true;
    });
  }, [products, archivedProducts, search, filter]);
  const isArchivedView = filter === "archived";

  // ── Add/Edit form ─────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  // Client Shop Phase 1 media lifecycle — the image_id this product had
  // BEFORE this form opened (null for a brand-new product). Never deleted
  // by ShopImageUpload itself; only this panel deletes it, and only after
  // a successful save that actually replaced/removed it.
  const [originalImageId, setOriginalImageId] = useState(null);

  const openAdd = () => { setEditingId(null); setForm(BLANK_FORM); setOriginalImageId(null); setFormOpen(true); };
  const openEdit = (p) => {
    setEditingId(p.id);
    setOriginalImageId(p.image_id || null);
    setForm({
      name: p.name || "", category: p.category || "", description: p.description || "",
      price: String(p.price ?? ""), cost: p.cost != null ? String(p.cost) : "",
      starting_stock: String(p.stock_on_hand ?? 0),
      low_stock_threshold: p.low_stock_threshold != null ? String(p.low_stock_threshold) : "",
      track_inventory: !!p.track_inventory, active: p.active !== false,
      show_online: !!p.show_online, online_description: p.online_description || "",
      image_id: p.image_id || null,
      online_sort_order: p.online_sort_order != null ? String(p.online_sort_order) : "",
      category_id: p.category_id || null, subcategory_id: p.subcategory_id || null,
      featured: !!p.featured, show_at_register: p.show_at_register !== false,
      sales_destination: p.sales_destination === "shopify_external" ? "shopify_external" : "internal",
      shopify_product_url: p.shopify_product_url || "",
      shopify_display_price: p.shopify_display_price != null ? String(p.shopify_display_price) : "",
      shopify_from_price: !!p.shopify_from_price,
      publicly_visible: !!p.publicly_visible, guest_cart_allowed: !!p.guest_cart_allowed,
      show_public_price: p.show_public_price !== false,
      requires_approval: !!p.requires_approval, requires_completed_onboarding: !!p.requires_completed_onboarding,
    });
    setFormOpen(true);
  };

  // Shared cleanup: if a new (not-yet-saved) image was uploaded this
  // session, delete it; the original persisted image (if any) is left
  // alone since nothing about the product actually changed.
  const cleanupUnsavedImageIfAny = () => {
    if (form.image_id && form.image_id !== originalImageId) {
      api.delete(`/shop/media/${form.image_id}`).catch(() => {});
    }
  };

  const closeFormWithoutSaving = () => {
    cleanupUnsavedImageIfAny();
    setFormOpen(false);
  };

  // The panel's own top-level X closes the WHOLE Manage Products modal —
  // including the add/edit form if it happened to be open underneath.
  // That exit path must get the identical cleanup as Cancel; otherwise
  // closing the panel with the form open leaks the same temp upload.
  const handlePanelClose = () => {
    if (formOpen) cleanupUnsavedImageIfAny();
    onClose();
  };

  const saveForm = async () => {
    if (!form.name.trim()) { toast.error("Product name is required"); return; }
    const isShopify = form.sales_destination === "shopify_external";
    if (!isShopify && !(Number(form.price) >= 0)) { toast.error("Selling price is required"); return; }
    if (isShopify && !form.shopify_product_url.trim()) { toast.error("A Shopify product URL is required"); return; }
    const body = {
      name: form.name.trim(), category: isShopify ? "" : form.category.trim(), description: form.description.trim() || null,
      price: isShopify ? 0 : Number(form.price), cost: (!isShopify && form.cost !== "") ? Number(form.cost) : null,
      low_stock_threshold: (!isShopify && form.low_stock_threshold !== "") ? Number(form.low_stock_threshold) : null,
      track_inventory: !isShopify && form.track_inventory, active: form.active,
      show_online: form.show_online, online_description: form.online_description.trim() || null,
      image_id: form.image_id || null,
      online_sort_order: form.online_sort_order !== "" ? parseInt(form.online_sort_order, 10) : null,
      category_id: form.category_id || null, subcategory_id: form.subcategory_id || null,
      featured: form.featured, show_at_register: form.show_at_register,
      sales_destination: form.sales_destination,
      shopify_product_url: isShopify ? form.shopify_product_url.trim() : null,
      shopify_display_price: (isShopify && form.shopify_display_price !== "") ? Number(form.shopify_display_price) : null,
      shopify_from_price: isShopify && form.shopify_from_price,
      publicly_visible: !isShopify && form.publicly_visible,
      guest_cart_allowed: !isShopify && form.publicly_visible && form.guest_cart_allowed,
      show_public_price: form.show_public_price,
      requires_approval: !isShopify && form.publicly_visible && form.requires_approval,
      requires_completed_onboarding: !isShopify && form.publicly_visible && form.requires_completed_onboarding,
    };
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/pos/products/${editingId}`, body);
        toast.success("Product updated");
      } else {
        await api.post("/pos/products", { ...body, starting_stock: isShopify ? 0 : Number(form.starting_stock || 0) });
        toast.success("Product added");
      }
      // Save succeeded — NOW it's safe to drop the old image, if replaced/removed.
      if (originalImageId && originalImageId !== form.image_id) {
        api.delete(`/shop/media/${originalImageId}`).catch(() => {});
      }
      setFormOpen(false);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save product");
    }
    setSaving(false);
  };

  // ── Quick stock actions (receive / adjust) ──────────────────────────────
  const [stockModal, setStockModal] = useState(null); // { product, mode: "receive" | "adjust" }
  const [stockQty, setStockQty] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [stockBusy, setStockBusy] = useState(false);

  const openReceive = (p) => { setStockModal({ product: p, mode: "receive" }); setStockQty(""); setStockReason("Shipment received"); };
  const openAdjust = (p) => { setStockModal({ product: p, mode: "adjust" }); setStockQty(""); setStockReason(""); };

  const submitStock = async () => {
    const qty = Number(stockQty);
    if (!qty) { toast.error("Enter a non-zero quantity"); return; }
    if (stockReason.trim().length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    const delta = stockModal.mode === "receive" ? Math.abs(qty) : qty;
    const source = stockModal.mode === "receive" ? "RESTOCK" : "MANUAL_ADJUSTMENT";
    setStockBusy(true);
    try {
      await api.post(`/pos/products/${stockModal.product.id}/adjust-stock`, {
        quantity_delta: delta, reason: stockReason.trim(), source,
      });
      toast.success("Stock updated");
      setStockModal(null);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust stock");
    }
    setStockBusy(false);
  };

  // ── History ──────────────────────────────────────────────────────────────
  const [historyProduct, setHistoryProduct] = useState(null);
  const [movements, setMovements] = useState([]);
  const openHistory = (p) => {
    setHistoryProduct(p);
    api.get(`/pos/products/${p.id}/movements`).then(({ data }) => setMovements(data || [])).catch(() => setMovements([]));
  };

  // ── Delete / Archive / Restore ──────────────────────────────────────────
  // The backend — not just this UI — decides whether a product can be
  // permanently deleted: DELETE /pos/products/{id} checks every order/sale/
  // inventory reference and returns 409 (never silently no-ops) when history
  // exists. That 409 is exactly the signal that flips this confirm dialog
  // from "permanently delete" to "archive instead".
  const [confirmDelete, setConfirmDelete] = useState(null); // product
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [hasHistory, setHasHistory] = useState(false); // whether the 409 already fired for confirmDelete
  const [archiveBusy, setArchiveBusy] = useState(null); // product id currently archiving/restoring

  const openDeleteConfirm = (p) => { setConfirmDelete(p); setHasHistory(false); };

  const confirmDeleteProduct = async () => {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/pos/products/${confirmDelete.id}`);
      toast.success(`"${confirmDelete.name}" permanently deleted`);
      setConfirmDelete(null);
      load();
      onChanged?.();
    } catch (e) {
      if (e?.response?.status === 409) {
        setHasHistory(true);
      } else {
        toast.error(e?.response?.data?.detail || "Could not delete product");
      }
    }
    setDeleteBusy(false);
  };

  const archiveFromDeleteFlow = async () => {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    try {
      await api.post(`/pos/products/${confirmDelete.id}/archive`);
      toast.success(`"${confirmDelete.name}" archived — order and receipt history is untouched`);
      setConfirmDelete(null);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not archive product");
    }
    setDeleteBusy(false);
  };

  const restoreProduct = async (p) => {
    setArchiveBusy(p.id);
    try {
      await api.post(`/pos/products/${p.id}/restore`);
      toast.success(`"${p.name}" restored`);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not restore product");
    }
    setArchiveBusy(null);
  };

  // ── Duplicate ────────────────────────────────────────────────────────────
  const [duplicateBusy, setDuplicateBusy] = useState(null);
  const duplicateProduct = async (p) => {
    setDuplicateBusy(p.id);
    try {
      await api.post(`/pos/products/${p.id}/duplicate`);
      toast.success(`"${p.name}" duplicated — the copy starts hidden from the Shop until you review it`);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not duplicate product");
    }
    setDuplicateBusy(null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" data-testid="manage-products-panel">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-shText text-xl font-black uppercase tracking-widest">Manage Products</p>
          <button onClick={handlePanelClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times text-lg" /></button>
        </div>

        {formOpen ? (
          <ProductEditor form={form} setForm={setForm} editingId={editingId} originalImageId={originalImageId}
                         saving={saving} onSave={saveForm} onClose={closeFormWithoutSaving} />
        ) : historyProduct ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black">History — {historyProduct.name}</p>
              <button onClick={() => setHistoryProduct(null)} className="text-shPrimary text-[11px] font-black uppercase tracking-widest">Back</button>
            </div>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {movements.length === 0 && <p className="text-shTextMuted text-sm">No stock movements yet.</p>}
              {movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm border-b border-shBorder py-1.5">
                  <div>
                    <span className="text-shText font-bold">{new Date(m.created_at).toLocaleDateString()}</span>{" "}
                    <span className="text-shTextMuted">{m.type} — {m.reason}</span>
                  </div>
                  <span className={m.quantity_delta > 0 ? "text-shPrimary font-bold" : "text-red-400 font-bold"}>
                    {m.quantity_delta > 0 ? "+" : ""}{m.quantity_delta}{"  "}
                    <span className="text-shTextMuted font-normal">{m.stock_before} → {m.stock_after}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products"
                     className="flex-1 min-w-[160px] bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              {[["all", "All"], ["low", "Low Stock"], ["out", "Out of Stock"], ["inactive", "Inactive"], ["archived", "Archived"]].map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                        className={`px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest ${filter === k ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted"}`}>
                  {label}
                </button>
              ))}
              <button onClick={openAdd} className="bg-shPrimary text-bgHeader rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest">
                + Add Product
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-shTextMuted text-[11px] uppercase tracking-widest text-left border-b border-shBorder">
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2">Shop Category</th>
                    <th className="py-2 pr-2">Register Group</th>
                    <th className="py-2 pr-2 text-right">Price</th>
                    <th className="py-2 pr-2 text-right">Cost</th>
                    <th className="py-2 pr-2 text-right">Stock</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="py-6 text-center text-shTextMuted">Loading…</td></tr>}
                  {!loading && filtered.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-shTextMuted">No products found.</td></tr>}
                  {filtered.map((p) => {
                    const status = p.archived
                      ? { label: "ARCHIVED", cls: "text-shTextMuted bg-shSurfaceRaised" }
                      : stockStatus(p);
                    return (
                      <tr key={p.id} className="border-b border-shBorder/60" data-testid={`product-row-${p.id}`}>
                        <td className={`py-2 pr-2 text-shText font-bold ${p.archived ? "" : "cursor-pointer"}`}
                            onClick={() => { if (!p.archived) openEdit(p); }}>
                          {p.name}
                          {p.sales_destination === "shopify_external" && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shAccent/10 text-shAccent align-middle">
                              Shopify Merchandise
                            </span>
                          )}
                          {p.featured && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary align-middle">Featured</span>}
                        </td>
                        <td className="py-2 pr-2 text-shTextMuted">{shopCategoryLabel(p)}</td>
                        <td className="py-2 pr-2 text-shTextMuted">{p.sales_destination === "shopify_external" ? "—" : (p.category || "—")}</td>
                        <td className="py-2 pr-2 text-right text-shText">
                          {p.sales_destination === "shopify_external"
                            ? (p.shopify_display_price != null ? `${p.shopify_from_price ? "From " : ""}${money(p.shopify_display_price)}` : "—")
                            : money(p.price)}
                        </td>
                        <td className="py-2 pr-2 text-right text-shTextMuted">{p.cost != null ? money(p.cost) : "—"}</td>
                        <td className="py-2 pr-2 text-right text-shText">{p.track_inventory ? p.stock_on_hand : "—"}</td>
                        <td className="py-2 pr-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${status.cls}`}>{status.label}</span>
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          <div className="flex items-center gap-2 justify-end">
                            {isArchivedView ? (
                              <button onClick={() => restoreProduct(p)} disabled={archiveBusy === p.id}
                                      data-testid={`product-restore-${p.id}`}
                                      className="text-shPrimary text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
                                {archiveBusy === p.id ? "Restoring…" : "Restore"}
                              </button>
                            ) : (
                              <>
                                {p.track_inventory && (
                                  <>
                                    <button onClick={() => openReceive(p)} className="text-shPrimary text-[11px] font-black uppercase tracking-widest">Receive</button>
                                    <button onClick={() => openAdjust(p)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Adjust</button>
                                    <button onClick={() => openHistory(p)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">History</button>
                                  </>
                                )}
                                <button onClick={() => openEdit(p)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Edit</button>
                                <button onClick={() => duplicateProduct(p)} disabled={duplicateBusy === p.id}
                                        data-testid={`product-duplicate-${p.id}`}
                                        className="text-shTextMuted text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
                                  {duplicateBusy === p.id ? "Duplicating…" : "Duplicate"}
                                </button>
                                <button onClick={() => openDeleteConfirm(p)} data-testid={`product-delete-${p.id}`}
                                        className="text-red-400 text-[11px] font-black uppercase tracking-widest">Delete</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {stockModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3">
            <p className="text-shText font-black uppercase tracking-widest">
              {stockModal.mode === "receive" ? "Receive Stock" : "Adjust Stock"} — {stockModal.product.name}
            </p>
            <p className="text-shTextMuted text-sm">Current: {stockModal.product.stock_on_hand}</p>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">
                {stockModal.mode === "receive" ? "Quantity received" : "Quantity adjustment (+/-)"}
              </label>
              <input type="number" value={stockQty} onChange={(e) => setStockQty(e.target.value)}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Reason</label>
              <input value={stockReason} onChange={(e) => setStockReason(e.target.value)} placeholder="e.g. Damaged, Lost, count correction"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setStockModal(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">
                Cancel
              </button>
              <button onClick={submitStock} disabled={stockBusy}
                      className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
                {stockBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="product-delete-confirm">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3">
            {!hasHistory ? (
              <>
                <p className="text-shText font-black uppercase tracking-widest">Delete "{confirmDelete.name}"?</p>
                <p className="text-shTextMuted text-sm">
                  This permanently removes the product from the catalog. This can only be done for a product with
                  no order, sale, or inventory history — if it has history, we'll offer to archive it instead.
                </p>
                {confirmDelete.track_inventory && (
                  <p className="text-shTextMuted text-[13px]">Current stock on hand: <span className="text-shText font-bold">{confirmDelete.stock_on_hand}</span></p>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setConfirmDelete(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">
                    Cancel
                  </button>
                  <button onClick={confirmDeleteProduct} disabled={deleteBusy}
                          data-testid="product-delete-confirm-btn"
                          className="flex-1 bg-red-500 text-white rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
                    {deleteBusy ? "Deleting…" : "Permanently Delete"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-shText font-black uppercase tracking-widest">"{confirmDelete.name}" has order history</p>
                <p className="text-shTextMuted text-sm">
                  This product has been referenced by a Shop order, POS sale, or inventory transaction, so it
                  can't be permanently deleted — doing so would rewrite past orders and receipts. Archive it
                  instead: it disappears from the Shop and register, but every past order, receipt, and report
                  keeps showing it exactly as it was.
                </p>
                {confirmDelete.track_inventory && (
                  <p className="text-shTextMuted text-[13px]">
                    Current stock on hand ({confirmDelete.stock_on_hand}) is preserved — archiving never creates a sale or adjustment.
                  </p>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setConfirmDelete(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">
                    Cancel
                  </button>
                  <button onClick={archiveFromDeleteFlow} disabled={deleteBusy}
                          data-testid="product-archive-confirm-btn"
                          className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
                    {deleteBusy ? "Archiving…" : "Archive Product"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
