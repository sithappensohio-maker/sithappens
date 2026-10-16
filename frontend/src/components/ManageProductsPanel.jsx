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
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import RelatedItemsEditor from "./shop/RelatedItemsEditor";
import ShopGalleryUpload from "./ShopGalleryUpload";
import { galleryIds as productGallery } from "../lib/shopImage";
import ShopCategoryFields from "./ShopCategoryFields";
import ItemThumbnail from "./ItemThumbnail";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const BLANK_FORM = {
  name: "", sku: "", category: "", description: "", price: "", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  // Options like size/color — a barcode-scannable sku per option, its own
  // stock, and an optional price different from the base product. Empty
  // means "no options" (every existing product). See the Variants section
  // of this form below.
  variants: [],
  show_online: false, online_description: "", image_id: null, image_ids: [], online_sort_order: "",
  category_id: null, subcategory_id: null, featured: false, show_at_register: true,
  sales_destination: "internal", shopify_product_url: "", shopify_display_price: "", shopify_from_price: false,
  // Printify POD — the Printify product id this listing submits production
  // orders against. Each variant row carries its own printify_variant_id
  // (see the Options section below) instead of a plain barcode SKU.
  printify_product_id: "", printify_blueprint_id: null, printify_print_provider_id: null,
  // Public no-account storefront — see the "Public Storefront" section of
  // the editor below. guest_cart_allowed never permits guest checkout, only
  // temporary local cart placement.
  publicly_visible: false, guest_cart_allowed: false, show_public_price: true,
  requires_approval: false, requires_completed_onboarding: false,
  // Merchandise is taxable. This is the exemption for the rare thing that
  // genuinely is not — a gift card, say — so it starts switched on.
  taxable: true, tax_exempt_reason: "",
  // Curated relationships — references only, never a copied name or price.
  shop_relationships: [],
};

// Turns the editor's variant rows into what POST/PUT /pos/products expects
// (PosProductVariantIn: id/name/sku/price_override/starting_stock) — strips
// the display-only stock_on_hand and the React-only _localKey. Shared by
// this panel AND Shop Manager's save call so there is one translation, not two.
export function variantsPayload(formVariants) {
  return (formVariants || []).map((v) => ({
    id: v.id || null,
    name: v.name.trim(),
    sku: (v.sku || "").trim() || null,
    price_override: v.price_override !== "" && v.price_override != null ? Number(v.price_override) : null,
    starting_stock: v.id ? 0 : Number(v.starting_stock || 0),
    printify_variant_id: (v.printify_variant_id || "").trim() || null,
  }));
}

// Printable barcode label for one product or option. Lazy-loads jsbarcode
// (same "only ship it when actually used" pattern as html2pdf.js elsewhere
// in this app) and renders the SAME code into every copy at once via
// JsBarcode's selector form, since every copy on the sheet is identical.
//
// A product/option with no barcode yet gets one generated server-side on
// open (POST .../generate-sku) — idempotent and collision-checked there,
// never invented client-side. `onSkuResolved` hands the result back to the
// caller's own form state so a later Save can't silently wipe it out by
// sending back the stale blank value.
export function PrintLabelsModal({ productId, variantId = null, itemName, initialSku, price, onClose, onSkuResolved }) {
  const [sku, setSku] = useState(initialSku || "");
  const [resolving, setResolving] = useState(!initialSku);
  const [copies, setCopies] = useState(1);
  const barcodeContainerRef = useRef(null);

  useEffect(() => {
    if (initialSku) return;
    let cancelled = false;
    setResolving(true);
    const path = variantId
      ? `/pos/products/${productId}/variants/${variantId}/generate-sku`
      : `/pos/products/${productId}/generate-sku`;
    api.post(path)
      .then(({ data }) => {
        if (cancelled) return;
        setSku(data.sku);
        onSkuResolved?.(data.sku);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e?.response?.data?.detail || "Could not generate a barcode");
        onClose();
      })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sku || resolving || !barcodeContainerRef.current) return;
    let cancelled = false;
    import("jsbarcode").then((mod) => {
      if (cancelled) return;
      const JsBarcode = mod.default || mod;
      // JsBarcode's selector form wants a real Array, not a NodeList — it
      // silently renders nothing (no error) if handed one directly.
      const nodes = Array.from(barcodeContainerRef.current?.querySelectorAll(".print-label-barcode") || []);
      if (nodes.length) JsBarcode(nodes, sku, { format: "CODE128", width: 2, height: 50, fontSize: 14, margin: 4 });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sku, resolving, copies]);

  const copyCount = Math.min(50, Math.max(1, Number(copies) || 1));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4" onClick={onClose} data-testid="print-labels-modal">
      <style>{`@media print { .no-print{display:none!important;} body{background:white!important;} .print-label{break-inside:avoid;} }`}</style>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg p-6 space-y-4">
        <div className="no-print space-y-4">
          <p className="text-shText text-lg font-black uppercase tracking-widest">Print Barcode Label</p>
          {resolving ? (
            <p className="text-shTextMuted text-sm">Generating a barcode…</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Copies</label>
                <input type="number" min={1} max={50} value={copies} data-testid="print-labels-copies"
                       onChange={(e) => setCopies(e.target.value)}
                       className="w-20 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="text-shTextMuted font-black uppercase text-sm tracking-widest">Close</button>
                <button onClick={() => window.print()} data-testid="print-labels-print-btn"
                        className="bg-shPrimary text-bgHeader rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest">
                  <i className="fas fa-print mr-1" />Print
                </button>
              </div>
            </>
          )}
        </div>
        {!resolving && (
          <div ref={barcodeContainerRef} className="flex flex-wrap gap-3 justify-center" data-testid="print-labels-sheet">
            {Array.from({ length: copyCount }).map((_, i) => (
              <div key={i} className="print-label border border-shBorder rounded p-2 text-center bg-white" style={{ width: 220 }}>
                <p className="text-black text-[12px] font-bold truncate">{itemName}</p>
                <svg className="print-label-barcode mx-auto" />
                {price != null && <p className="text-black text-[12px] font-black">${Number(price).toFixed(2)}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// A real Printify product carries dozens of color/size combinations, each
// needing its own Printify variant id for a size row below — hand-copying
// every one out of the Printify dashboard is slow and typo-prone. This
// fetches the product's real (enabled-only) variants from Printify and
// lets an admin check off which ones to actually carry; ProductEditor
// turns the checked ones into size rows itself.
export function PrintifyVariantPickerModal({ printifyProductId, existingVariantIds, onClose, onAdd }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [product, setProduct] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    api.get(`/admin/printify/products/${encodeURIComponent(printifyProductId)}`)
      .then(({ data }) => { if (!cancelled) setProduct(data); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || "Could not fetch this product from Printify"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [printifyProductId]);

  const already = useMemo(() => new Set(existingVariantIds || []), [existingVariantIds]);
  const filtered = useMemo(() => {
    const all = product?.variants || [];
    const q = filter.trim().toLowerCase();
    return q ? all.filter((v) => v.title.toLowerCase().includes(q)) : all;
  }, [product, filter]);

  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAllShown = () => setChecked((prev) => {
    const next = new Set(prev);
    filtered.forEach((v) => { if (!already.has(v.id)) next.add(v.id); });
    return next;
  });
  const confirm = () => {
    const chosen = (product?.variants || []).filter((v) => checked.has(v.id) && !already.has(v.id));
    if (chosen.length === 0) return;
    onAdd(chosen, { blueprintId: product.blueprint_id ?? null, printProviderId: product.print_provider_id ?? null });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4" onClick={onClose} data-testid="printify-variant-picker-modal">
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h5 className="text-shText font-black text-[16px] uppercase italic tracking-tight">Fetch Sizes From Printify</h5>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-xmark text-xl" /></button>
        </div>
        {loading ? (
          <p className="text-shTextMuted text-sm">Loading…</p>
        ) : err ? (
          <p className="text-shDanger text-sm" role="alert">{err}</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {product.image && <img src={product.image} alt="" className="w-14 h-14 rounded-lg object-cover border border-shBorder" />}
              <p className="text-shText font-bold text-sm">{product.title}</p>
            </div>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by color or size…"
                   data-testid="printify-picker-filter"
                   className="w-full bg-black/10 border border-shBorder rounded p-2 text-shText text-sm" />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-shTextMuted">{filtered.length} shown · {checked.size} selected</span>
              <button type="button" onClick={selectAllShown} data-testid="printify-picker-select-all"
                      className="text-shPrimary font-black uppercase tracking-widest">Select All Shown</button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 border border-shBorder rounded-lg p-2">
              {filtered.length === 0 ? (
                <p className="text-shTextMuted text-sm py-2 text-center">No variants match.</p>
              ) : filtered.map((v) => {
                const alreadyAdded = already.has(v.id);
                return (
                  <label key={v.id} data-testid={`printify-picker-row-${v.id}`}
                         className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${alreadyAdded ? "opacity-40" : "cursor-pointer hover:bg-white/5"}`}>
                    <input type="checkbox" checked={alreadyAdded || checked.has(v.id)} disabled={alreadyAdded}
                           onChange={() => toggle(v.id)} />
                    <span className="flex-1 text-shText">{v.title}{alreadyAdded ? " (already added)" : ""}</span>
                    <span className="text-shTextMuted">${v.price.toFixed(2)}</span>
                    {!v.is_available && <span className="text-shAccent text-[10px] font-black uppercase ml-1">Unavailable</span>}
                  </label>
                );
              })}
            </div>
          </>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded-xl py-2.5 font-black uppercase tracking-widest text-shTextMuted">
            Cancel
          </button>
          <button onClick={confirm} disabled={loading || !!err || checked.size === 0} data-testid="printify-picker-add"
                  className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-2.5 font-black uppercase tracking-widest disabled:opacity-40">
            Add {checked.size || ""} {checked.size === 1 ? "Size" : "Sizes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Shared product add/edit form — used by this panel AND the unified Shop
// Manager Items tab. Parent owns `form`/`setForm`/`originalImageId` state
// and the actual save call (mirrors ProgramEditor's pattern in Programs.jsx);
// this component is purely presentational/input-bound so there is exactly
// ONE product form implementation, never a second copy to keep in sync.
export function ProductEditor({ form, setForm, editingId, originalImageId, saving, onSave, onClose,
  // The photos the product already had when this editor opened. The gallery
  // deletes anything OUTSIDE this list the moment it is removed, because that
  // can only be a this-session upload -- so an empty list here would delete a
  // product's real photos before the admin ever saved. It was read as a bare
  // identifier from the parent's scope, which is a ReferenceError the moment
  // the editor renders; both callers pass it now.
  originalImageIds = [],
  // Everything an admin could relate this item TO, so the picker searches by
  // name instead of asking anyone to paste an id. Optional: a caller that has
  // not loaded a catalogue simply gets no picker rather than a broken one.
  relatableItems = [] }) {
  // Defensive, same reason originalImageIds/relatableItems default above:
  // a caller built before this field existed (see productEditorMounts.test.js,
  // which exists specifically to catch a prop a caller forgot) must still
  // render instead of crashing — never trust form.variants to be present.
  const variants = form.variants || [];
  const isShopify = form.sales_destination === "shopify_external";
  const isPrintify = form.sales_destination === "printify";
  // Printify and plain internal products both keep the normal
  // price/cost/options machinery — only a Shopify link zeroes it all out.
  const showsOptions = !isShopify;
  // `_localKey` is a React list-key only — never sent to the backend (see
  // handleSave's strip in both callers). A row with a real `id` is an
  // existing variant (its stock is read-only here; Receive/Adjust changes
  // it); one without is brand new (its "Starting Stock" is what the create/
  // edit call actually sends).
  const addVariantRow = () => setForm((f) => {
    const fv = f.variants || [];
    return { ...f, variants: [...fv, { _localKey: `new-${Date.now()}-${fv.length}`, name: "", sku: "", price_override: "", starting_stock: "0" }] };
  });
  const updateVariantRow = (i, patch) => setForm((f) => {
    const copy = [...(f.variants || [])];
    copy[i] = { ...copy[i], ...patch };
    return { ...f, variants: copy };
  });
  const removeVariantRow = (i) => setForm((f) => ({ ...f, variants: (f.variants || []).filter((_, idx) => idx !== i) }));

  // Print Barcode Label — same narrow, documented exception as Receive/
  // Adjust below: {kind: "product"} for the plain product's own sku,
  // {kind: "variant", index} for one option's. Only ever opened for an
  // EXISTING row (a real id to generate/attach a barcode to), never a
  // not-yet-saved product or option.
  const [printTarget, setPrintTarget] = useState(null);

  // "Fetch from Printify" — see PrintifyVariantPickerModal above.
  const [showPrintifyPicker, setShowPrintifyPicker] = useState(false);
  const addPrintifyVariants = (chosen, { blueprintId, printProviderId } = {}) => {
    setForm((f) => {
      const basePrice = f.price !== "" && f.price != null ? Number(f.price) : null;
      const rows = chosen.map((v, i) => ({
        _localKey: `printify-${v.id}-${Date.now()}-${i}`,
        name: v.title, sku: "", starting_stock: "0", printify_variant_id: v.id,
        // Only set a per-size override when it actually differs from the
        // product's base price — most sizes match it, and a blank field
        // already means "same as above" (see the Price field's own label).
        price_override: basePrice != null && basePrice === v.price ? "" : String(v.price),
      }));
      // An empty base price gets the first fetched size's price as a
      // starting point, so picking sizes doesn't leave Selling Price blank
      // — still fully editable, just one less manual step for the common
      // case where every size costs the same.
      const nextPrice = basePrice == null && chosen.length > 0 ? String(chosen[0].price) : f.price;
      return {
        ...f, price: nextPrice, variants: [...(f.variants || []), ...rows],
        // Identifies the print method (blank garment + printer) — needed
        // later to look up real shipping cost. Captured once, here, so
        // nobody ever has to type a blueprint/print-provider id by hand.
        printify_blueprint_id: blueprintId ?? f.printify_blueprint_id,
        printify_print_provider_id: printProviderId ?? f.printify_print_provider_id,
      };
    });
    toast.success(`Added ${chosen.length} size${chosen.length === 1 ? "" : "s"} from Printify`);
  };

  // Inline Receive/Adjust for an EXISTING variant's stock — the one place
  // this form steps outside "purely presentational" (see the file-level
  // comment on this component), because the alternative is wiring a second
  // copy of the stock-adjust modal through both callers just to reach a
  // variant. Mirrors adjust_pos_product_stock's own two reasons (RESTOCK a
  // shipment vs. a free-form count correction) at the plain-product level.
  const [adjustingVariant, setAdjustingVariant] = useState(null); // index into variants, or null
  const [variantAdjustQty, setVariantAdjustQty] = useState("");
  const [variantAdjustReason, setVariantAdjustReason] = useState("");
  const [variantAdjustBusy, setVariantAdjustBusy] = useState(false);
  const submitVariantAdjust = async (i, mode) => {
    const v = variants[i];
    const qty = Number(variantAdjustQty);
    if (!qty) { toast.error("Enter a non-zero quantity"); return; }
    if (mode === "receive" && qty <= 0) { toast.error("Receive Stock only accepts a positive quantity"); return; }
    if (variantAdjustReason.trim().length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    setVariantAdjustBusy(true);
    try {
      const { data } = await api.post(`/pos/products/${editingId}/variants/${v.id}/adjust-stock`, {
        quantity_delta: mode === "receive" ? Math.abs(qty) : qty,
        reason: variantAdjustReason.trim(), source: mode === "receive" ? "RESTOCK" : "MANUAL_ADJUSTMENT",
      });
      updateVariantRow(i, { stock_on_hand: data.stock_on_hand });
      toast.success(`Stock updated — now ${data.stock_on_hand}`);
      setAdjustingVariant(null); setVariantAdjustQty(""); setVariantAdjustReason("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust stock");
    }
    setVariantAdjustBusy(false);
  };

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
            <button type="button" data-testid="destination-printify"
                    onClick={() => setForm((f) => ({ ...f, sales_destination: "printify" }))}
                    className={`flex-1 rounded px-3 py-2 text-[12px] font-black uppercase tracking-widest ${isPrintify ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
              Printify Print-on-Demand
            </button>
          </div>
          <p className="text-[11px] text-shTextMuted mt-1">
            {isPrintify
              ? "Sold and paid for right here, same as a normal product — Printify only takes over production and shipping after payment."
              : "Shopify products are display-only links in the Shop — Shopify alone handles pricing, variants, inventory, tax, and checkout."}
          </p>
        </div>

        {form.sales_destination === "internal" && (
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Register Group (optional)</label>
            <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            <p className="text-[11px] text-shTextMuted mt-0.5">Groups products into tabs on the in-person register only. Use Shop Category below for the client Shop.</p>
          </div>
        )}
        {(form.sales_destination === "internal" || isPrintify) && (
          <>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Selling Price *</label>
              <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Cost (optional)</label>
              <input type="number" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
              {isPrintify && (
                <p className="text-[11px] text-shTextMuted mt-0.5">Printify's own production cost, for your own margin tracking only — never synced automatically.</p>
              )}
            </div>
          </>
        )}
        {form.sales_destination === "internal" && variants.length === 0 && (
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">
              {editingId ? "Stock On Hand (use Receive/Adjust to change)" : "Starting Stock"}
            </label>
            <input type="number" disabled={!!editingId} value={form.starting_stock}
                   onChange={(e) => setForm((f) => ({ ...f, starting_stock: e.target.value }))}
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText disabled:opacity-50" />
          </div>
        )}
        {form.sales_destination === "internal" && (
          <div className="col-span-2">
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Barcode / SKU (optional)</label>
            <div className="flex gap-2">
              <input value={form.sku || ""} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                     placeholder="Scan it here, or type it in" data-testid="product-sku"
                     disabled={variants.length > 0}
                     className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText disabled:opacity-50" />
              {editingId && variants.length === 0 && (
                <button type="button" onClick={() => setPrintTarget({ kind: "product" })} data-testid="product-print-label"
                        className="text-shPrimary text-[11px] font-black uppercase tracking-widest whitespace-nowrap px-2">
                  <i className="fas fa-print mr-1" />Print Label
                </button>
              )}
            </div>
            <p className="text-[11px] text-shTextMuted mt-0.5">
              {variants.length > 0
                ? "This product has options below — each option gets its own code instead."
                : "Scanning this at the register adds the item straight to the cart. No code yet? Print Label will make one."}
            </p>
          </div>
        )}
        {isPrintify && (
          <div className="col-span-2">
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Printify Product ID *</label>
            <div className="flex gap-2">
              <input value={form.printify_product_id || ""} onChange={(e) => setForm((f) => ({ ...f, printify_product_id: e.target.value }))}
                     placeholder="Copy from the product's page in your Printify dashboard"
                     data-testid="product-printify-id"
                     className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
              <button type="button" onClick={() => setShowPrintifyPicker(true)}
                      disabled={!(form.printify_product_id || "").trim()}
                      data-testid="product-printify-fetch-sizes"
                      className="shrink-0 bg-[var(--sh-card-base)] border border-shBorder rounded px-3 text-[11px] font-black uppercase tracking-widest text-shPrimary disabled:opacity-40 disabled:text-shTextMuted">
                <i className="fas fa-cloud-arrow-down mr-1.5" />Fetch Sizes
              </button>
            </div>
            <p className="text-[11px] text-shTextMuted mt-0.5">
              The Printify product this listing submits production orders against. Set up the product in Printify first, then copy its id here — then Fetch Sizes to pick its colors/sizes instead of typing each variant id by hand.
            </p>
          </div>
        )}

        <div className="col-span-2">
          <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Description (optional)</label>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                 className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
        </div>

        {/* Photo is channel-independent: the register grid and the client
            Shop both render it, so it must never require Show Online. */}
        <div className="col-span-2">
          <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Product Photo (shown at the register and in the client Shop)</label>
          <ShopGalleryUpload imageIds={form.image_ids} originalImageIds={originalImageIds}
                             onChange={(ids) => setForm((f) => ({ ...f, image_ids: ids, image_id: ids[0] || null }))} />
        </div>

        {(form.sales_destination === "internal" || isPrintify) && form.cost !== "" && form.cost != null && form.price !== "" && Number(form.price) > 0 && (
          <div className="col-span-2 rounded border border-shBorder bg-[var(--sh-card-base)] px-3 py-2 text-sm text-shText" data-testid="product-margin-preview">
            <span className="text-[11px] text-shTextMuted uppercase tracking-widest mr-2">Profit per unit</span>
            <span className="font-black">{money(Number(form.price) - Number(form.cost))}</span>
            <span className="text-shTextMuted ml-2">({(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100).toFixed(1)}% margin)</span>
          </div>
        )}

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

      {/* Options — size/color/etc. A barcode-scannable sku, its own stock,
          and an optional price per option, instead of one flat product. A
          Printify listing uses the same rows for its sizes, but swaps the
          barcode/stock fields for a Printify variant id — nothing is
          scanned or stocked for a made-to-order item. */}
      {showsOptions && (
        <div className="border-t border-shBorder pt-3 mt-1 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">
              {isPrintify ? "Sizes (required)" : "Options (size, color, etc.)"}
            </p>
            <button type="button" onClick={addVariantRow} data-testid="product-add-variant"
                    className="text-shPrimary text-[11px] font-black uppercase tracking-widest">
              <i className="fas fa-plus mr-1" />Add {isPrintify ? "Size" : "Option"}
            </button>
          </div>
          {variants.length === 0 ? (
            <p className="text-[11px] text-shTextMuted">
              {isPrintify
                ? "A Printify listing needs at least one size before it can be saved."
                : "No options — sold as one single item. Add an option if it comes in sizes or colors."}
            </p>
          ) : (
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={v.id || v._localKey} className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-2.5" data-testid={`product-variant-row-${i}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-shTextMuted uppercase tracking-widest">Option {i + 1}{v.id ? "" : " (new)"}</label>
                    <button type="button" onClick={() => removeVariantRow(i)} data-testid={`product-remove-variant-${i}`}
                            className="text-shTextMuted hover:text-shDanger text-[12px]"><i className="fas fa-times" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-shTextMuted uppercase tracking-widest">Name *</label>
                      <input value={v.name} onChange={(e) => updateVariantRow(i, { name: e.target.value })}
                             placeholder="e.g. Small" data-testid={`product-variant-name-${i}`}
                             className="w-full bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" />
                    </div>
                    {isPrintify ? (
                      <div>
                        <label className="text-[10px] text-shTextMuted uppercase tracking-widest">Printify Variant ID *</label>
                        <input value={v.printify_variant_id || ""} onChange={(e) => updateVariantRow(i, { printify_variant_id: e.target.value })}
                               placeholder="From this size's row in Printify" data-testid={`product-variant-printify-id-${i}`}
                               className="w-full bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" />
                      </div>
                    ) : (
                      <div>
                        <label className="text-[10px] text-shTextMuted uppercase tracking-widest">Barcode / SKU</label>
                        <div className="flex gap-1.5">
                          <input value={v.sku || ""} onChange={(e) => updateVariantRow(i, { sku: e.target.value })}
                                 placeholder="Scan it here" data-testid={`product-variant-sku-${i}`}
                                 className="flex-1 bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" />
                          {v.id && (
                            <button type="button" onClick={() => setPrintTarget({ kind: "variant", index: i })}
                                    data-testid={`product-variant-print-label-${i}`}
                                    className="text-shPrimary text-[10px] font-black uppercase tracking-widest whitespace-nowrap px-1">
                              <i className="fas fa-print" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] text-shTextMuted uppercase tracking-widest">Price (blank = same as above)</label>
                      <input type="number" value={v.price_override ?? ""} onChange={(e) => updateVariantRow(i, { price_override: e.target.value })}
                             placeholder={form.price || "0"} data-testid={`product-variant-price-${i}`}
                             className="w-full bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" />
                    </div>
                    {!isPrintify && (
                      <div>
                        <label className="text-[10px] text-shTextMuted uppercase tracking-widest">
                          {v.id ? "Stock" : "Starting Stock"}
                        </label>
                        {v.id ? (
                          <div className="flex items-center gap-2">
                            <span className="flex-1 bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" data-testid={`product-variant-stock-${i}`}>
                              {v.stock_on_hand ?? 0}
                            </span>
                            <button type="button" onClick={() => { setAdjustingVariant(adjustingVariant === i ? null : i); setVariantAdjustQty(""); setVariantAdjustReason(""); }}
                                    data-testid={`product-variant-adjust-toggle-${i}`}
                                    className="text-shPrimary text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                              {adjustingVariant === i ? "Cancel" : "Receive/Adjust"}
                            </button>
                          </div>
                        ) : (
                          <input type="number" value={v.starting_stock ?? "0"}
                                 onChange={(e) => updateVariantRow(i, { starting_stock: e.target.value })}
                                 data-testid={`product-variant-stock-${i}`}
                                 className="w-full bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" />
                        )}
                      </div>
                    )}
                  </div>
                  {adjustingVariant === i && (
                    <div className="mt-2 pt-2 border-t border-shBorder grid grid-cols-2 gap-2" data-testid={`product-variant-adjust-panel-${i}`}>
                      <div>
                        <label className="text-[10px] text-shTextMuted uppercase tracking-widest">Quantity (+ to add, − to remove)</label>
                        <input type="number" value={variantAdjustQty} onChange={(e) => setVariantAdjustQty(e.target.value)}
                               data-testid={`product-variant-adjust-qty-${i}`}
                               className="w-full bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-shTextMuted uppercase tracking-widest">Reason</label>
                        <input value={variantAdjustReason} onChange={(e) => setVariantAdjustReason(e.target.value)}
                               placeholder="e.g. Shipment received" data-testid={`product-variant-adjust-reason-${i}`}
                               className="w-full bg-black/10 border border-shBorder rounded p-1.5 text-shText text-sm" />
                      </div>
                      <div className="col-span-2 flex gap-2">
                        <button type="button" disabled={variantAdjustBusy} onClick={() => submitVariantAdjust(i, "receive")}
                                data-testid={`product-variant-adjust-receive-${i}`}
                                className="flex-1 bg-shPrimary text-bgHeader rounded py-1.5 text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                          Receive Stock
                        </button>
                        <button type="button" disabled={variantAdjustBusy} onClick={() => submitVariantAdjust(i, "adjust")}
                                data-testid={`product-variant-adjust-submit-${i}`}
                                className="flex-1 bg-[var(--sh-card-base)] border border-shBorder text-shText rounded py-1.5 text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                          Apply Adjustment
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sales tax. Merchandise is taxed — that is the rule and it is not
          per-category any more — so this is only ever about the rare item
          that genuinely is not, and it asks why so the answer survives the
          person who knew it. */}
      <div className="border-t border-shBorder pt-3 mt-1 space-y-2">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="product-taxable" checked={form.taxable}
                 onChange={(e) => setForm((f) => ({ ...f, taxable: e.target.checked }))}
                 data-testid="product-taxable" />
          <label htmlFor="product-taxable" className="text-shText text-sm">Charge sales tax on this item</label>
        </div>
        {!form.taxable ? (
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Why is it exempt?</label>
            <input value={form.tax_exempt_reason} maxLength={300}
                   onChange={(e) => setForm((f) => ({ ...f, tax_exempt_reason: e.target.value }))}
                   placeholder="e.g. Gift card — taxed when it is spent, not when it is sold"
                   data-testid="product-tax-exempt-reason"
                   className="mt-1 w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            <p className="text-[11px] text-shTextMuted mt-1">Kept with the product and shown against the No-tax badge in this list.</p>
          </div>
        ) : (
          <p className="text-[11px] text-shTextMuted">
            Turn this off only for something genuinely not taxable. Services are handled separately — they are never taxed.
          </p>
        )}
      </div>

      {/* Self-fulfilled shipping (owner request 2026-10-15) — off by
          default; the admin opts each product in individually. Never for
          a Shopify-linked or Printify listing, which already ship through
          their own path. */}
      {!isShopify && !isPrintify && (
        <div className="border-t border-shBorder pt-3 mt-1 space-y-2">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="product-shippable" checked={form.shippable}
                   onChange={(e) => setForm((f) => ({ ...f, shippable: e.target.checked }))}
                   data-testid="product-shippable" />
            <label htmlFor="product-shippable" className="text-shText text-sm">Can be shipped (FedEx)</label>
          </div>
          {form.shippable && (
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Shipping weight (lbs)</label>
              <input type="number" min="0" step="0.1" value={form.shipping_weight_lbs}
                     onChange={(e) => setForm((f) => ({ ...f, shipping_weight_lbs: e.target.value }))}
                     data-testid="product-shipping-weight"
                     className="mt-1 w-32 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <p className="text-[11px] text-shTextMuted mt-1">Used to get a real FedEx Ground rate at checkout.</p>
            </div>
          )}
        </div>
      )}

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
        {isPrintify && (
          <p className="text-[11px] text-shTextMuted" data-testid="product-printify-online-note">
            Sellable at the register either way — check this box to also offer it in the client Shop, where a
            customer picks a size (and fills in any personalized text) before checking out, same as at the register.
          </p>
        )}
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
          </div>
        )}
      </div>

      {/* Curated "pairs well with". Only for items that are actually in the
          shop — relating two products nobody can see achieves nothing. */}
      {form.show_online && form.sales_destination === "internal" && (
        <div className="border-t border-shBorder pt-3 mt-1">
          <RelatedItemsEditor
            value={form.shop_relationships}
            onChange={(next) => setForm((f) => ({ ...f, shop_relationships: next }))}
            candidates={relatableItems}
            selfKind="product"
            selfId={editingId}
          />
        </div>
      )}

      {/* Public no-account storefront. A Shopify listing belongs here too:
          on the guest storefront it is a display-only card whose button
          hands the visitor to Shopify, which is exactly what we want a
          stranger to be able to find. What it must never gain is a guest
          CART or an account-gate, because nothing is bought on our side —
          domains/shop/guest refuses it regardless, and those controls stay
          internal-only so the form cannot imply otherwise. */}
      {form.show_online && (
        <div className="border-t border-shBorder pt-3 mt-1 space-y-3">
          <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Public Storefront (signed-out visitors)</p>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="publicly-visible" checked={form.publicly_visible}
                   onChange={(e) => setForm((f) => ({ ...f, publicly_visible: e.target.checked }))}
                   data-testid="product-publicly-visible" />
            <label htmlFor="publicly-visible" className="text-shText text-sm">Publicly Visible (shown to signed-out visitors)</label>
          </div>
          {form.publicly_visible && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="show-public-price" checked={form.show_public_price}
                     onChange={(e) => setForm((f) => ({ ...f, show_public_price: e.target.checked }))}
                     data-testid="product-show-public-price" />
              <label htmlFor="show-public-price" className="text-shText text-sm">Show Price to Guests</label>
            </div>
          )}
          {form.publicly_visible && isShopify && (
            <p className="text-[11px] text-shTextMuted" data-testid="product-shopify-public-note">
              Guests will see this listing and can open it on Shopify. Checkout,
              stock and payment stay with Shopify, so there is no guest cart or
              account requirement to set here.
            </p>
          )}
          {form.publicly_visible && isPrintify && (
            <p className="text-[11px] text-shTextMuted" data-testid="product-printify-public-note">
              This listing isn't in the client Shop (see the note above), so guests won't see it here either — register-only, same as for clients.
            </p>
          )}
          {form.publicly_visible && form.sales_destination === "internal" && (
            <>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="guest-cart-allowed" checked={form.guest_cart_allowed}
                       onChange={(e) => setForm((f) => ({ ...f, guest_cart_allowed: e.target.checked }))}
                       data-testid="product-guest-cart-allowed" />
                <label htmlFor="guest-cart-allowed" className="text-shText text-sm">Allow guests to add to cart — never allows guest checkout</label>
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

      {printTarget && printTarget.kind === "product" && (
        <PrintLabelsModal
          productId={editingId}
          itemName={form.name}
          initialSku={form.sku || ""}
          price={form.price !== "" ? Number(form.price) : null}
          onSkuResolved={(sku) => setForm((f) => ({ ...f, sku }))}
          onClose={() => setPrintTarget(null)}
        />
      )}
      {printTarget && printTarget.kind === "variant" && (() => {
        const v = variants[printTarget.index];
        if (!v) return null;
        return (
          <PrintLabelsModal
            productId={editingId}
            variantId={v.id}
            itemName={`${form.name} — ${v.name}`}
            initialSku={v.sku || ""}
            price={v.price_override !== "" && v.price_override != null ? Number(v.price_override) : (form.price !== "" ? Number(form.price) : null)}
            onSkuResolved={(sku) => updateVariantRow(printTarget.index, { sku })}
            onClose={() => setPrintTarget(null)}
          />
        );
      })()}
      {showPrintifyPicker && (
        <PrintifyVariantPickerModal
          printifyProductId={form.printify_product_id.trim()}
          existingVariantIds={variants.map((v) => v.printify_variant_id).filter(Boolean)}
          onAdd={addPrintifyVariants}
          onClose={() => setShowPrintifyPicker(false)}
        />
      )}
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
  // Every image the product ALREADY had when the form opened. Only images
  // uploaded during this session may be deleted on removal; these survive
  // until a save actually drops them.
  const [originalImageIds, setOriginalImageIds] = useState([]);

  // This panel only knows about products, so that is what it offers to
  // relate to. The unified Shop Manager passes packs and programs too.
  const relatableItems = useMemo(
    () => products.filter((p) => p.active !== false)
      .map((p) => ({ kind: "product", id: p.id, name: p.name, sku: p.sku })),
    [products]);

  const openAdd = () => { setEditingId(null); setForm(BLANK_FORM); setOriginalImageId(null); setOriginalImageIds([]); setFormOpen(true); };
  const openEdit = (p) => {
    setEditingId(p.id);
    setOriginalImageId(p.image_id || null);
    setOriginalImageIds(productGallery(p));
    setForm({
      name: p.name || "", sku: p.sku || "", category: p.category || "", description: p.description || "",
      price: String(p.price ?? ""), cost: p.cost != null ? String(p.cost) : "",
      starting_stock: String(p.stock_on_hand ?? 0),
      // Backend shape already matches what this form reads/writes per row
      // (id/name/sku/price_override/stock_on_hand) — just copied in as-is.
      variants: Array.isArray(p.variants) ? p.variants.map((v) => ({ ...v })) : [],
      low_stock_threshold: p.low_stock_threshold != null ? String(p.low_stock_threshold) : "",
      track_inventory: !!p.track_inventory, active: p.active !== false,
      show_online: !!p.show_online, online_description: p.online_description || "",
      image_id: p.image_id || null,
      // A product that only ever had one photo opens as a one-image gallery
      // — no migration, nothing for the admin to redo.
      image_ids: productGallery(p),
      online_sort_order: p.online_sort_order != null ? String(p.online_sort_order) : "",
      category_id: p.category_id || null, subcategory_id: p.subcategory_id || null,
      featured: !!p.featured, show_at_register: p.show_at_register !== false,
      // Absent means taxable — the same default the pricing engine uses, so
      // a product saved before this field existed reads back honestly.
      taxable: p.taxable !== false, tax_exempt_reason: p.tax_exempt_reason || "",
      sales_destination: (p.sales_destination === "shopify_external" || p.sales_destination === "printify")
        ? p.sales_destination : "internal",
      shopify_product_url: p.shopify_product_url || "",
      shopify_display_price: p.shopify_display_price != null ? String(p.shopify_display_price) : "",
      shopify_from_price: !!p.shopify_from_price,
      printify_product_id: p.printify_product_id || "",
      printify_blueprint_id: p.printify_blueprint_id ?? null,
      printify_print_provider_id: p.printify_print_provider_id ?? null,
      publicly_visible: !!p.publicly_visible, guest_cart_allowed: !!p.guest_cart_allowed,
      show_public_price: p.show_public_price !== false,
      requires_approval: !!p.requires_approval, requires_completed_onboarding: !!p.requires_completed_onboarding,
      shop_relationships: Array.isArray(p.shop_relationships)
        ? p.shop_relationships.map((r) => ({ rel: r.rel, kind: r.kind, ref_id: r.ref_id }))
        : [],
    });
    setFormOpen(true);
  };

  // Shared cleanup: if a new (not-yet-saved) image was uploaded this
  // session, delete it; the original persisted image (if any) is left
  // alone since nothing about the product actually changed.
  const cleanupUnsavedImageIfAny = () => {
    // Every image added in this session, not just the primary one — with a
    // gallery, abandoning the form could otherwise strand seven uploads.
    for (const id of form.image_ids || []) {
      if (id && !originalImageIds.includes(id)) {
        api.delete(`/shop/media/${id}`).catch(() => {});
      }
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
    const isPrintify = form.sales_destination === "printify";
    if (!isShopify && !(Number(form.price) >= 0)) { toast.error("Selling price is required"); return; }
    if (isShopify && !form.shopify_product_url.trim()) { toast.error("A Shopify product URL is required"); return; }
    if (isPrintify && !form.printify_product_id.trim()) { toast.error("A Printify product ID is required"); return; }
    if (isPrintify && form.variants.length === 0) { toast.error("A Printify listing needs at least one size"); return; }
    if (isPrintify && form.variants.some((v) => !(v.printify_variant_id || "").trim())) {
      toast.error("Every size needs its Printify variant ID"); return;
    }
    if (form.variants.some((v) => !v.name.trim())) { toast.error("Every option needs a name."); return; }
    const body = {
      name: form.name.trim(), sku: isShopify ? null : (form.sku.trim() || null),
      category: isShopify ? "" : form.category.trim(), description: form.description.trim() || null,
      price: isShopify ? 0 : Number(form.price), cost: (!isShopify && form.cost !== "") ? Number(form.cost) : null,
      low_stock_threshold: (!isShopify && form.low_stock_threshold !== "") ? Number(form.low_stock_threshold) : null,
      track_inventory: !isShopify && form.track_inventory, active: form.active,
      variants: isShopify ? [] : variantsPayload(form.variants),
      show_online: form.show_online, online_description: form.online_description.trim() || null,
      image_id: form.image_id || null,
      image_ids: form.image_ids || [],
      online_sort_order: form.online_sort_order !== "" ? parseInt(form.online_sort_order, 10) : null,
      category_id: form.category_id || null, subcategory_id: form.subcategory_id || null,
      featured: form.featured, show_at_register: form.show_at_register,
      taxable: form.taxable,
      tax_exempt_reason: form.taxable ? null : (form.tax_exempt_reason.trim() || null),
      sales_destination: form.sales_destination,
      shopify_product_url: isShopify ? form.shopify_product_url.trim() : null,
      shopify_display_price: (isShopify && form.shopify_display_price !== "") ? Number(form.shopify_display_price) : null,
      shopify_from_price: isShopify && form.shopify_from_price,
      printify_product_id: isPrintify ? form.printify_product_id.trim() : null,
      printify_blueprint_id: isPrintify ? form.printify_blueprint_id : null,
      printify_print_provider_id: isPrintify ? form.printify_print_provider_id : null,
      // A Shopify listing may be public: it is a display-only card that sends
      // the visitor to Shopify. Everything below it stays internal-only,
      // because none of it describes buying something here.
      publicly_visible: !!form.publicly_visible,
      guest_cart_allowed: !isShopify && form.publicly_visible && form.guest_cart_allowed,
      show_public_price: form.show_public_price,
      requires_approval: !isShopify && form.publicly_visible && form.requires_approval,
      requires_completed_onboarding: !isShopify && form.publicly_visible && form.requires_completed_onboarding,
      // Always sent, so clearing the list actually clears it. The server
      // treats an OMITTED field as "leave them alone" precisely so a caller
      // that predates this cannot wipe curation by accident — which means
      // the editor has to be explicit about an empty list being deliberate.
      shop_relationships: form.shop_relationships || [],
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
      // Safe only now the save succeeded: anything the product used to have
      // and no longer does.
      for (const id of originalImageIds) {
        if (!(form.image_ids || []).includes(id)) {
          api.delete(`/shop/media/${id}`).catch(() => {});
        }
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
                         originalImageIds={originalImageIds}
                         relatableItems={relatableItems}
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
                          <div className="flex items-center gap-2">
                          <ItemThumbnail imageId={p.image_id} alt={p.name} size={40} />
                          <span>
                          {p.name}
                          {p.sales_destination === "shopify_external" && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shAccent/10 text-shAccent align-middle">
                              Shopify Merchandise
                            </span>
                          )}
                          {p.featured && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary align-middle">Featured</span>}
                          {p.taxable === false && (
                            /* Visible in the list, not just buried in the
                               editor: "which of my products are not taxed?"
                               is the question you ask when a filing looks
                               wrong, and it should take one glance. */
                            <span title={p.tax_exempt_reason || "No reason recorded"}
                                  data-testid={`product-no-tax-${p.id}`}
                                  className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shOrange/10 text-shOrange align-middle">
                              No tax
                            </span>
                          )}
                          </span>
                          </div>
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
