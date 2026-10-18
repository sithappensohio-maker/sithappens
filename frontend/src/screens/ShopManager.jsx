import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import AdminTabs from "../components/admin/AdminTabs";
import { useConfirm } from "../lib/useConfirm";
import { previewLessonMoves, lessonMovePreviewNote, lessonMoveLines, lessonMovesHeadline } from "../lib/lessonMoves";
import { pickupActionToast } from "../lib/shopPolish";
import { structureRefusal, saveProblemLine, liveProblemsHeadline, LIVE_PROBLEMS_NOTE } from "../lib/programStudioPolish";
import { ProductEditor, variantsPayload, PrintLabelsModal } from "../components/ManageProductsPanel";
import ShopAnalyticsDashboard from "../components/shop/ShopAnalyticsDashboard";
import RegisterSalesDashboard from "../components/shop/RegisterSalesDashboard";
import { PackEditor } from "../components/CreditPacksSettings";
import { ProgramEditor, fetchProgramById } from "../components/Programs";
import ItemThumbnail from "../components/ItemThumbnail";
import ShopImageUpload from "../components/ShopImageUpload";
import { galleryIds } from "../lib/shopImage";
import PortalShop from "../components/PortalShop";
import NeonEdge from "../components/premium/NeonEdge";
import HuskyDogImage from "../components/brand/HuskyDogImage";
import {
  inventoryStatus, itemWarnings, marginDisplay, filterItemsByView,
  catalogProfitSummary,
  orderRef, orderComputedStatus, filterOrdersByView, searchOrders,
} from "../lib/shopManagerPolish";
import { DEPARTMENTS } from "../lib/shopDepartments";

/* ============================================================================
 * Shop Manager — the ONE place to create, edit, organize, price, display,
 * and manage everything sold through the app.
 *
 * Architecture rule this file follows throughout: physical products, prepaid
 * credit packs, and training programs keep their existing specialized
 * models/business logic completely untouched (inventory/SKU/tax for
 * products; credits/expiration for packs; sessions/modules/enrollment for
 * programs). This screen unifies the ADMIN EXPERIENCE only — listing,
 * filtering, placement, and editing — by reusing the exact same editor
 * components the previous standalone screens used (ProductEditor,
 * PackEditor, ProgramEditor are all imported, not reimplemented) and the
 * exact same endpoints for every write.
 * ========================================================================== */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const WARNING_TONE_CLASS = {
  bad: "bg-red-500/10 text-red-400",
  warn: "bg-shOrange/10 text-shOrange",
  muted: "bg-shBorder/40 text-shTextMuted",
};

const SECTION_TABS = [
  { key: "all", label: "All" },
  { key: "merch", label: "Merch & Gear" },
  { key: "prepaid_visits", label: "Prepaid Visits" },
  { key: "training", label: "Training" },
];

const VIEW_OPTIONS = [
  ["all", "All"], ["missing_details", "Missing Details"], ["uncategorized", "Uncategorized"],
  ["low_stock", "Low Stock"], ["out_of_stock", "Out of Stock"], ["hidden", "Hidden"],
  ["inactive", "Inactive"], ["archived", "Archived"],
];

const KIND_LABEL = { physical_product: "Product", credit_pack: "Prepaid Pack", training_program: "Training Program" };

const BLANK_PRODUCT_FORM = {
  name: "", sku: "", variants: [], category: "", description: "", price: "", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  show_online: false, online_description: "", image_id: null, online_sort_order: "",
  category_id: null, subcategory_id: null, featured: false, show_at_register: true,
  sales_destination: "internal", shopify_product_url: "", shopify_display_price: "", shopify_from_price: false,
  printify_product_id: "", printify_blueprint_id: null, printify_print_provider_id: null,
  // Printify's raw print_areas (text-layer placeholders) — the backend
  // derives personalization fields (Name/Phone/Address, etc.) from THIS,
  // not from anything typed in the form. Without it carried through here
  // too, a product saved from Shop Manager never shows a personalization
  // input anywhere (register or Shop), even if Printify itself has them.
  printify_print_areas: null,
  // Merchandise is taxable by default; this is the per-item exemption. Missing here meant it was never
  // loaded on edit or sent on save, so an exempt item kept getting taxed no matter what the box showed.
  taxable: true, tax_exempt_reason: "",
  publicly_visible: false, guest_cart_allowed: false, show_public_price: true,
  requires_approval: false, requires_completed_onboarding: false,
  shippable: false, shipping_weight_lbs: "",
};

const BLANK_PACK_FORM = {
  name: "", qty: 10, price: 300, service_type: "daycare", icon: "fa-tag", color: "", active: true, welcome_email_template_slug: null,
  available_online: false, online_description: "", image_id: null,
  category_id: null, subcategory_id: null, show_at_register: true, featured: false,
  publicly_visible: false, show_public_price: true, requires_completed_onboarding: false,
  // Customer-facing quantity fix — presentation-only marketing metadata,
  // see CreditPacksSettings.jsx's matching `empty` object for the rationale.
  display_quantity: null, display_unit: null, display_dog_count: null,
};

const blankProgramForm = (type = "private_lessons") => ({
  name: "", slug: "", type, description: "", focus: "",
  format: { count: 1, unit: "sessions" }, min_age_months: 0,
  prereq_slugs: [], modules: [], price: 0, active: true,
  available_online: false, online_description: "", image_id: null,
  category_id: null, subcategory_id: null, show_at_register: true, featured: false,
  publicly_visible: false, show_public_price: true,
  requires_dog: false, requires_approval: false, requires_completed_onboarding: false,
});

// Rebuilds a physical product's full update_pos_product payload from its
// raw stored record (GET /pos/products), the same field-by-field shape
// saveProduct() builds from the (string-based) editor form — update_pos_product
// takes a full PosProductIn replace, not a patch, so an inline edit that only
// sent `{price}` would reset every other field to its Pydantic default
// (wiping category, variants, visibility, tax, everything). Kept separate
// from saveProduct's own body-building rather than unified with it: that one
// reads string form state (`productForm.price`), this one reads raw numeric
// DB values (`raw.price`) — different enough input shapes that forcing one
// shared function would need its own branching anyway.
function physicalProductPutPayload(raw, overrides = {}) {
  const r = { ...raw, ...overrides };
  const isShopify = r.sales_destination === "shopify_external";
  const isPrintify = r.sales_destination === "printify";
  return {
    name: (r.name || "").trim(), sku: isShopify ? null : (r.sku || null),
    category: isShopify ? "" : (r.category || ""), description: r.description || null,
    price: isShopify ? 0 : Number(r.price || 0),
    cost: (!isShopify && r.cost != null && r.cost !== "") ? Number(r.cost) : null,
    low_stock_threshold: (!isShopify && r.low_stock_threshold != null) ? Number(r.low_stock_threshold) : null,
    track_inventory: !isShopify && !!r.track_inventory, active: r.active !== false,
    variants: isShopify ? [] : variantsPayload(r.variants || []),
    show_online: !!r.show_online, online_description: r.online_description || null,
    image_id: r.image_id || null, image_ids: r.image_ids || [],
    online_sort_order: r.online_sort_order ?? null,
    category_id: r.category_id || null, subcategory_id: r.subcategory_id || null,
    featured: !!r.featured, show_at_register: r.show_at_register !== false,
    sales_destination: r.sales_destination || "internal",
    shopify_product_url: isShopify ? (r.shopify_product_url || "").trim() : null,
    shopify_display_price: (isShopify && r.shopify_display_price != null && r.shopify_display_price !== "") ? Number(r.shopify_display_price) : null,
    shopify_from_price: isShopify && !!r.shopify_from_price,
    printify_product_id: isPrintify ? (r.printify_product_id || "").trim() : null,
    printify_blueprint_id: isPrintify ? r.printify_blueprint_id : null,
    printify_print_provider_id: isPrintify ? r.printify_print_provider_id : null,
    printify_print_areas: isPrintify ? r.printify_print_areas : null,
    publicly_visible: !!r.publicly_visible,
    guest_cart_allowed: !isShopify && !!r.publicly_visible && !!r.guest_cart_allowed,
    show_public_price: r.show_public_price !== false,
    requires_approval: !isShopify && !!r.publicly_visible && !!r.requires_approval,
    requires_completed_onboarding: !isShopify && !!r.publicly_visible && !!r.requires_completed_onboarding,
    taxable: r.taxable !== false,
    tax_exempt_reason: r.taxable !== false ? null : (r.tax_exempt_reason || "").trim() || null,
    shippable: !isShopify && !isPrintify && !!r.shippable,
    shipping_weight_lbs: (!isShopify && !isPrintify && r.shippable) ? Number(r.shipping_weight_lbs || 0) : null,
  };
}

function itemKindLabel(it) {
  if (it.kind === "physical_product" && it.sales_destination === "shopify_external") return "Shopify Merchandise";
  if (it.kind === "physical_product" && it.sales_destination === "printify") return "Printify Print-on-Demand";
  return KIND_LABEL[it.kind];
}

function StatusPill({ active, label }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
      active ? "bg-shPrimary/15 border-shPrimary/35 text-shPrimary" : "bg-shBorder/40 border-shBorder text-shTextMuted"
    }`}>
      <i className={`fas ${active ? "fa-circle-check" : "fa-circle-pause"}`} />{label || (active ? "Active" : "Inactive")}
    </span>
  );
}

/* Owner: a row with inventory tracking could carry up to 7 action buttons
 * (Edit, Duplicate, Print Label, Receive/Adjust Stock, Stock History,
 * Delete) — wide enough that the table's horizontal scroll hid Delete
 * entirely off-screen for shorter rows too, reading as "there's no delete".
 * Edit and Delete/Hide stay inline (always reachable); everything else
 * collapses behind this one "More" button so every row is the same fixed
 * width. */
// Rendered via portal at document.body: the Items table sits inside an
// overflow-x-auto wrapper (for horizontal scrolling on mobile), and per the
// CSS overflow spec that also forces the Y axis to clip — any dropdown
// positioned inside it gets cut off after its first item. That's why a row
// with only one menu item ("Duplicate") looked fine but adding a second
// ("Delete", for packs/programs) rendered invisibly. Portal + fixed
// positioning (computed from the trigger's own bounding rect) escapes the
// clipping ancestor entirely — same fix, same root cause, as
// ClientActionsMenu in screens/Clients.jsx (a different clipping ancestor
// there — card `isolation: isolate` — but the identical bug shape).
function RowActionsMenu({ actions, testIdPrefix }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, bottom: undefined });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const MENU_WIDTH = 176; // w-44

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < 160 && r.top > spaceBelow;
      setPos({
        left: Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
        top: openUp ? undefined : r.bottom + 4,
        bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
      });
    };
    reposition();
    const onDocClick = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="inline-block">
      <button ref={triggerRef} onClick={() => setOpen(o => !o)} data-testid={`${testIdPrefix}-more`}
              aria-haspopup="menu" aria-expanded={open}
              className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">
        More <i className={`fas fa-caret-${open ? "up" : "down"} ml-0.5`} />
      </button>
      {open && createPortal((
        <div ref={menuRef} role="menu" data-testid={`${testIdPrefix}-more-panel`}
             style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_WIDTH, background: "var(--sh-card-base)" }}
             className="z-[9999] rounded-xl border border-shBorder shadow-2xl overflow-hidden">
          {actions.map((a) => (
            <button key={a.key} role="menuitem" data-testid={a.testId} disabled={a.disabled}
                    onClick={() => { setOpen(false); a.onClick(); }}
                    className="w-full text-left px-3 py-2 text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised disabled:opacity-40 transition">
              {a.label}
            </button>
          ))}
        </div>
      ), document.body)}
    </div>
  );
}

/* ============================================================================
 * ITEMS TAB
 * ========================================================================== */
function ItemsTab({ onEditItem, onAddShopItem }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("all");
  // all | missing_details | uncategorized | low_stock | out_of_stock | hidden | inactive | archived
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [stockModal, setStockModal] = useState(null); // { item, mode: "receive" | "adjust" }
  const [stockQty, setStockQty] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [historyItem, setHistoryItem] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // any kind now — mirrors ManageProductsPanel's safe-delete flow
  const [hasHistory, setHasHistory] = useState(false);
  // credit_pack's own 409 isn't a real history block like the other two
  // kinds' — it's a softer "N clients have a custom price on this, pass
  // force=true to proceed anyway" warning (see _count_active_overrides_
  // for_target) — the server's own wording is carried through verbatim
  // rather than re-described, since re-describing it risked drifting out
  // of sync with what force=true actually does.
  const [blockedDetail, setBlockedDetail] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printLabelTarget, setPrintLabelTarget] = useState(null); // {productId, itemName, initialSku, price} — row-level quick print, non-variant products only
  // Bulk select — "clean up unused stuff" (owner, 2026-10-17) one row at a
  // time was the whole reason Delete got added everywhere; it's still one
  // row at a time without this. Keyed by "kind:id" since credit_pack and
  // training_program ids aren't guaranteed unique against each other.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  // Grouped by category, collapsible (owner, 2026-10-18: "this long ass
  // list will get out of hand fast... much better if it was organized") —
  // a catalog with dozens of items in a handful of categories read as one
  // undifferentiated wall of rows. Collapsed is an explicit opt-OUT set
  // (empty = everything expanded), so a newly-added category always
  // starts visible rather than silently defaulting to hidden.
  const [collapsedCategories, setCollapsedCategories] = useState(() => new Set());
  // Inline price edit — click the Price cell, type, Enter. No reason needed:
  // a price change isn't an audited movement the way stock is.
  const [editingPriceKey, setEditingPriceKey] = useState(null); // "kind:id" of the row being edited
  const [priceDraft, setPriceDraft] = useState("");
  const [priceSaving, setPriceSaving] = useState(false);
  // Inline stock edit — NOT a bare "type a number, done" the way price is:
  // adjust-stock is an audited movement and the backend requires a reason
  // (3+ chars) for every change, by design, same as the Receive/Adjust
  // modal. This keeps that invariant but inline, in the row itself, instead
  // of a popup — qty delta + reason, two fields instead of opening a modal.
  const [editingStockKey, setEditingStockKey] = useState(null);
  const [stockDraftQty, setStockDraftQty] = useState("");
  const [stockDraftReason, setStockDraftReason] = useState("");
  const [stockDraftSaving, setStockDraftSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setForbidden(false);
    const params = {};
    if (section !== "all") params.section = section;
    if (view === "uncategorized") params.category_id = "uncategorized";
    if (view === "hidden") params.hidden_only = true;
    // Archived products are excluded from the normal response by design —
    // this is the one view that deliberately asks for them instead.
    if (view === "archived") params.include_archived = true;
    api.get("/shop-manager/items", { params })
      .then(({ data }) => setItems(data.items || []))
      .catch((e) => {
        if (e?.response?.status === 403) setForbidden(true);
        else toast.error("Could not load Shop Manager items");
      })
      .finally(() => setLoading(false));
  }, [section, view]);
  useEffect(() => { load(); }, [load]);
  // A changed Type/Status filter can make the selected rows disappear from
  // view entirely — clear the selection rather than leave it acting on
  // items the admin can no longer see.
  useEffect(() => { setSelected(new Set()); }, [section, view]);

  const filtered = useMemo(() => {
    const list = filterItemsByView(items, view);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) => (it.name || "").toLowerCase().includes(q));
  }, [items, view, search]);

  // Grouped by category, collapsible (owner, 2026-10-18: "this long ass
  // list will get out of hand fast... much better if it was organized") —
  // a catalog with dozens of items in a handful of categories read as one
  // undifferentiated wall of rows. "Uncategorized" always sorts last since
  // it's a fallback bucket, not a real category someone filed things under.
  const groupedFiltered = useMemo(() => {
    const groups = new Map();
    for (const it of filtered) {
      const name = it.category_name || "Uncategorized";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(it);
    }
    return Array.from(groups.entries())
      .map(([name, rows]) => ({ name, rows }))
      .sort((a, b) => {
        if (a.name === "Uncategorized") return 1;
        if (b.name === "Uncategorized") return -1;
        return a.name.localeCompare(b.name);
      });
  }, [filtered]);
  const toggleCategoryCollapsed = (name) => setCollapsedCategories((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const priceDisplay = (it) => {
    if (it.kind === "physical_product" && it.sales_destination === "shopify_external") {
      return it.shopify_display_price != null ? `${it.shopify_from_price ? "From " : ""}${money(it.shopify_display_price)}` : "—";
    }
    return money(it.list_price);
  };

  // Click the Price cell, type, Enter (or click away) — no modal. An
  // archived product has no live price to edit (it's off the Shop/
  // Register entirely until Restored); a Shopify listing edits its
  // informational Displayed Price field instead of a real selling price,
  // same field the full editor's "Displayed Price" controls.
  const priceEditable = (it) => !(it.kind === "physical_product" && it.archived);
  const priceEditValue = (it) => {
    if (it.kind === "physical_product" && it.sales_destination === "shopify_external") {
      return it.shopify_display_price != null ? String(it.shopify_display_price) : "";
    }
    return it.list_price != null ? String(it.list_price) : "";
  };
  const beginEditPrice = (it) => {
    if (!priceEditable(it)) return;
    setEditingPriceKey(rowKey(it));
    setPriceDraft(priceEditValue(it));
  };
  const cancelPriceEdit = () => setEditingPriceKey(null);
  const savePriceEdit = async (it) => {
    const isShopify = it.kind === "physical_product" && it.sales_destination === "shopify_external";
    const trimmed = priceDraft.trim();
    if (trimmed === "" && !isShopify) { toast.error("Enter a price"); return; }
    if (trimmed !== "" && !(Number(trimmed) >= 0)) { toast.error("Enter a valid price"); return; }
    const n = trimmed === "" ? null : Number(trimmed);
    // Nothing actually changed — close without a write.
    if (trimmed === priceEditValue(it).trim()) { setEditingPriceKey(null); return; }
    setPriceSaving(true);
    try {
      if (it.kind === "physical_product") {
        const { data } = await api.get("/pos/products", { params: { include_inactive: true } });
        const raw = (data || []).find((p) => p.id === it.id);
        if (!raw) throw new Error("not found");
        const overrides = isShopify ? { shopify_display_price: n } : { price: n };
        await api.put(`/pos/products/${it.id}`, physicalProductPutPayload(raw, overrides));
      } else {
        const path = it.kind === "credit_pack" ? "/credit-packs" : "/programs";
        const raw = it.kind === "credit_pack"
          ? (await api.get(path, { params: { include_inactive: true } })).data?.find((p) => p.id === it.id)
          : await fetchProgramById(it.id);
        if (!raw) throw new Error("not found");
        await api.put(`${path}/${it.id}`, { ...raw, price: n });
      }
      toast.success("Price updated");
      setEditingPriceKey(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update price");
    }
    setPriceSaving(false);
  };

  // Click the Inventory cell, enter a quantity and a reason, done — still
  // two fields and not a bare "type a number", because adjust-stock is an
  // audited movement and the backend requires a reason for every change by
  // design (same rule the Receive/Adjust Stock modal already enforces).
  // Inline just skips opening that modal; it doesn't skip the reason.
  const stockEditable = (it) => it.kind === "physical_product" && it.track_inventory && !it.archived;
  const beginEditStock = (it) => {
    if (!stockEditable(it)) return;
    setEditingStockKey(rowKey(it));
    setStockDraftQty("");
    setStockDraftReason("");
  };
  const cancelStockEdit = () => setEditingStockKey(null);
  const saveStockEdit = async (it) => {
    const qty = Number(stockDraftQty);
    if (!qty) { toast.error("Enter a non-zero quantity"); return; }
    if (stockDraftReason.trim().length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    setStockDraftSaving(true);
    try {
      const { data } = await api.post(`/pos/products/${it.id}/adjust-stock`, { quantity_delta: qty, reason: stockDraftReason.trim(), source: "MANUAL_ADJUSTMENT" });
      toast.success(`Stock updated — now ${data.stock_on_hand}`);
      setEditingStockKey(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust stock");
    }
    setStockDraftSaving(false);
  };

  const duplicateItem = async (it) => {
    setBusyId(it.id);
    const path = it.kind === "physical_product" ? `/pos/products/${it.id}/duplicate`
      : it.kind === "credit_pack" ? `/credit-packs/${it.id}/duplicate`
      : `/programs/${it.id}/duplicate`;
    try {
      await api.post(path);
      toast.success(`"${it.name}" duplicated — the copy starts hidden until you review it`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not duplicate");
    }
    setBusyId(null);
  };

  const archiveProduct = async (it) => {
    setBusyId(it.id);
    try {
      await api.post(`/pos/products/${it.id}/archive`);
      toast.success(`"${it.name}" archived`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not archive");
    }
    setBusyId(null);
  };

  const restoreProduct = async (it) => {
    setBusyId(it.id);
    try {
      await api.post(`/pos/products/${it.id}/restore`);
      toast.success(`"${it.name}" restored`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not restore");
    }
    setBusyId(null);
  };

  // Every kind's own real permanent-delete path, matching delete_pos_product's
  // long-standing rule: hard delete ONLY with no real history, 409 otherwise.
  // credit_pack's DELETE already enforced this (see toggleHidePackOrProgram's
  // own comment below); training_program's hard=true query param is new
  // (server.py's delete_program) — owner, 2026-10-17: "can we make it so any
  // item in the shop can be deleted so i can clean up unused stuff."
  const deleteEndpointFor = (it, { force = false } = {}) =>
    it.kind === "physical_product" ? `/pos/products/${it.id}`
      : it.kind === "credit_pack" ? `/credit-packs/${it.id}${force ? "?force=true" : ""}`
        : `/programs/${it.id}?hard=true`;

  const openDeleteProduct = (it) => { setDeleteTarget(it); setHasHistory(false); setBlockedDetail(""); };
  const confirmDeleteProduct = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await api.delete(deleteEndpointFor(deleteTarget));
      toast.success(`"${deleteTarget.name}" permanently deleted`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      if (e?.response?.status === 409) { setHasHistory(true); setBlockedDetail(e?.response?.data?.detail || ""); }
      else toast.error(e?.response?.data?.detail || "Could not delete");
    }
    setBusyId(null);
  };
  // credit_pack's 409 is a soft warning (active client-specific prices),
  // not a real history block — force=true proceeds anyway, same as the
  // server already allows (unlike physical_product/training_program,
  // which have no force option because theirs IS a real, final block).
  const confirmDeleteForced = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await api.delete(deleteEndpointFor(deleteTarget, { force: true }));
      toast.success(`"${deleteTarget.name}" permanently deleted`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete");
    }
    setBusyId(null);
  };
  // The fallback once delete is refused for real history. Physical products
  // have a real Archive (restorable, remembers prior active/show_online —
  // see archiveProduct); packs/programs don't, so this explicitly hides
  // them instead — never toggleHidePackOrProgram, which would REACTIVATE
  // an already-hidden item instead of hiding it (several of the exact
  // items prompting this feature are already "Hidden Everywhere").
  const archiveFromDeleteFlow = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "physical_product") {
      await archiveProduct(deleteTarget);
    } else {
      setBusyId(deleteTarget.id);
      try {
        const path = deleteTarget.kind === "credit_pack" ? "/credit-packs" : "/programs";
        const { data } = await api.get(path, { params: { include_inactive: true } });
        const raw = (data || []).find((p) => p.id === deleteTarget.id);
        if (raw) await api.put(`${path}/${deleteTarget.id}`, { ...raw, active: false });
        toast.success(`"${deleteTarget.name}" hidden`);
        load();
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not hide");
      }
      setBusyId(null);
    }
    setDeleteTarget(null);
  };

  // Packs/programs have no archive concept — "Hide"/"Activate" ALWAYS goes
  // through each kind's own PUT (which replaces the whole record, so the
  // full existing doc is fetched fresh first), toggling only `active`.
  // Deliberately NEVER calls DELETE here: DELETE /credit-packs/{id} hard-
  // deletes any non-default pack outright (only default/seeded packs get
  // soft-deactivated) — using it for a reversible "Hide" action would
  // silently destroy a custom pack instead of just hiding it.
  const toggleHidePackOrProgram = async (it) => {
    setBusyId(it.id);
    try {
      if (it.kind === "credit_pack") {
        const { data } = await api.get("/credit-packs", { params: { include_inactive: true } });
        const raw = (data || []).find((p) => p.id === it.id);
        if (raw) await api.put(`/credit-packs/${it.id}`, { ...raw, active: !it.active });
      } else {
        const { data } = await api.get("/programs", { params: { include_inactive: true } });
        const raw = (data || []).find((p) => p.id === it.id);
        if (raw) await api.put(`/programs/${it.id}`, { ...raw, active: !it.active });
      }
      toast.success(it.active ? `"${it.name}" hidden` : `"${it.name}" activated`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update");
    }
    setBusyId(null);
  };

  const rowKey = (it) => `${it.kind}:${it.id}`;
  const toggleSelect = (it) => setSelected((prev) => {
    const next = new Set(prev);
    const k = rowKey(it);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((it) => selected.has(rowKey(it)));
  const toggleSelectAll = () => setSelected(() => (allFilteredSelected ? new Set() : new Set(filtered.map(rowKey))));
  const selectedItems = filtered.filter((it) => selected.has(rowKey(it)));

  // Bulk Archive/Hide — deliberately sets the hidden/archived state rather
  // than reusing archiveProduct/toggleHidePackOrProgram's single-item
  // behavior as-is: toggleHidePackOrProgram FLIPS active, which would
  // reactivate any already-hidden pack/program caught in a mixed
  // selection. A bulk "clean these up" action should only ever move
  // things toward hidden, never accidentally the other way.
  const bulkHideSelected = async () => {
    if (selectedItems.length === 0) return;
    setBulkBusy(true);
    let ok = 0, failed = 0;
    for (const it of selectedItems) {
      try {
        if (it.kind === "physical_product") {
          if (!it.archived) await api.post(`/pos/products/${it.id}/archive`);
        } else {
          const path = it.kind === "credit_pack" ? "/credit-packs" : "/programs";
          if (it.active) {
            const { data } = await api.get(path, { params: { include_inactive: true } });
            const raw = (data || []).find((p) => p.id === it.id);
            if (raw) await api.put(`${path}/${it.id}`, { ...raw, active: false });
          }
        }
        ok++;
      } catch { failed++; }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed === 0) toast.success(`${ok} item${ok === 1 ? "" : "s"} archived/hidden`);
    else toast.error(`${ok} archived/hidden, ${failed} failed`);
    load();
  };

  // Bulk Delete — same permanently-delete-only-with-no-real-history rule
  // as the single-item flow (deleteEndpointFor), just without that flow's
  // per-item "Delete Anyway"/Archive-instead prompts: a blocked item is
  // skipped and counted, not stopped on. Anything blocked still has real
  // history and needs Archive/Hide instead, same as it always did.
  const bulkDeleteSelected = async () => {
    if (selectedItems.length === 0) return;
    setBulkBusy(true);
    let ok = 0, blocked = 0;
    for (const it of selectedItems) {
      try {
        await api.delete(deleteEndpointFor(it));
        ok++;
      } catch { blocked++; }
    }
    setBulkBusy(false);
    setBulkDeleteConfirm(false);
    setSelected(new Set());
    if (blocked === 0) toast.success(`${ok} item${ok === 1 ? "" : "s"} permanently deleted`);
    else toast.error(`${ok} deleted, ${blocked} blocked — they have real history, use Archive/Hide instead`);
    load();
  };

  const openReceiveStock = (it) => { setStockModal({ item: it, mode: "receive" }); setStockQty(""); setStockReason("Shipment received"); };
  const openAdjustStock = (it) => { setStockModal({ item: it, mode: "adjust" }); setStockQty(""); setStockReason(""); };

  const submitStock = async () => {
    const qty = Number(stockQty);
    if (!qty) { toast.error("Enter a non-zero quantity"); return; }
    if (stockModal.mode === "receive" && qty <= 0) { toast.error("Receive Stock only accepts a positive quantity"); return; }
    if (stockReason.trim().length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    const delta = stockModal.mode === "receive" ? Math.abs(qty) : qty;
    const source = stockModal.mode === "receive" ? "RESTOCK" : "MANUAL_ADJUSTMENT";
    try {
      const { data } = await api.post(`/pos/products/${stockModal.item.id}/adjust-stock`, { quantity_delta: delta, reason: stockReason.trim(), source });
      toast.success(`Stock updated — now ${data.stock_on_hand}`);
      setStockModal(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust stock");
    }
  };

  const openStockHistory = (it) => {
    setHistoryItem(it);
    setHistoryLoading(true);
    setHistoryRows([]);
    api.get(`/pos/products/${it.id}/movements`)
      .then(({ data }) => setHistoryRows(data || []))
      .catch(() => toast.error("Could not load stock history"))
      .finally(() => setHistoryLoading(false));
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("sh_token") || "";
      const API_ROOT = process.env.REACT_APP_BACKEND_URL || "";
      const r = await fetch(`${API_ROOT}/api/pos/products/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast.error(`CSV download failed (${r.status})`); return; }
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = "sit-happens-products.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(obj), 5000);
    } catch {
      toast.error("CSV download failed");
    }
    setExporting(false);
  };

  return (
    <div className="space-y-3">
      {/* Two dropdowns, not twelve buttons — "what kind of thing" (Type)
          and "what's going on with it" (Status) used to be two unlabeled
          rows of buttons with identical visual weight, easy to read as one
          big undifferentiated wall of filters instead of two separate
          questions. */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items"
               className="flex-1 min-w-[160px] bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
        <div className="flex items-center gap-1.5">
          <label htmlFor="sm-section-select" className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Type</label>
          <select id="sm-section-select" value={section} onChange={(e) => setSection(e.target.value)} data-testid="sm-section-select"
                  className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            {SECTION_TABS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="sm-view-select" className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Status</label>
          <select id="sm-view-select" value={view} onChange={(e) => setView(e.target.value)} data-testid="sm-view-select"
                  className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            {VIEW_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <button onClick={exportCsv} disabled={exporting} data-testid="sm-export-csv"
                className="bg-[var(--sh-card-base)] border border-shBorder rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest text-shText disabled:opacity-40">
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        <button onClick={() => setImportOpen(true)} data-testid="sm-import-csv"
                className="bg-[var(--sh-card-base)] border border-shBorder rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest text-shText">
          Import CSV
        </button>
        <button onClick={onAddShopItem} data-testid="sm-add-item"
                className="bg-shPrimary text-bgHeader rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest">
          + Add Shop Item
        </button>
      </div>

      {importOpen && (
        <CsvImportModal onClose={() => setImportOpen(false)} onApplied={load} />
      )}

      {printLabelTarget && (
        <PrintLabelsModal {...printLabelTarget}
          onSkuResolved={load}
          onClose={() => setPrintLabelTarget(null)} />
      )}

      {forbidden ? (
        <div className="text-center text-shTextMuted py-10 text-sm" data-testid="sm-items-forbidden">
          You don't have permission to view Shop items and pricing. Ask an owner/admin to grant the pricing permission,
          or use the Categories &amp; Layout tab if you only need to organize categories.
        </div>
      ) : (
      <>
      {/* Catalog profitability rollup — display-only, from the rows shown
          below. Honest numbers: items without a cost are excluded and
          called out, never counted as zero-cost. */}
      {(() => {
        const ps = catalogProfitSummary(filtered);
        if (ps.costedCount === 0 && ps.missingCostCount === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-shBorder bg-[var(--sh-card-base)] px-4 py-2.5" data-testid="sm-profit-summary">
            <span className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Profitability</span>
            <span className="text-sm text-shText">Stock at cost <span className="font-black">{ps.inventoryCost}</span></span>
            <span className="text-sm text-shText">Retail value <span className="font-black">{ps.inventoryRetail}</span></span>
            <span className="text-sm text-shText">Potential profit <span className="font-black text-shPrimary">{ps.potentialProfit}</span>{ps.marginPercent && <span className="text-shTextMuted"> ({ps.marginPercent} margin)</span>}</span>
            {ps.missingCostCount > 0 && (
              <span className="text-[12px] text-shOrange" data-testid="sm-profit-missing-cost">{ps.missingCostCount} product{ps.missingCostCount === 1 ? "" : "s"} missing cost — not counted</span>
            )}
          </div>
        );
      })()}

      {/* Bulk actions — "can we make it so any item in the shop can be
          deleted so i can clean up unused stuff" (owner, 2026-10-17) was
          still one row at a time without this. Only shows once something
          is actually checked, so it costs nothing for the normal one-row
          workflow. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-shPrimary/40 bg-shPrimary/5 px-4 py-2.5" data-testid="sm-bulk-bar">
          <span className="text-sm text-shText font-black">{selected.size} selected</span>
          <button onClick={bulkHideSelected} disabled={bulkBusy} data-testid="sm-bulk-hide"
                  className="text-shTextMuted text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
            Archive / Hide
          </button>
          <button onClick={() => setBulkDeleteConfirm(true)} disabled={bulkBusy} data-testid="sm-bulk-delete"
                  className="text-red-400 text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
            Delete
          </button>
          <button onClick={() => setSelected(new Set())} disabled={bulkBusy}
                  className="ml-auto text-shTextMuted text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-shTextMuted text-[11px] uppercase tracking-widest text-left border-b border-shBorder">
              <th className="py-2 pr-2 w-8">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} data-testid="sm-select-all"
                       aria-label="Select all shown items" />
              </th>
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Type</th>
              <th className="py-2 pr-2" title="Which part of the catalog this is sold through (Merch & Gear, Prepaid Visits, Training).">
                Section <i className="fas fa-circle-info text-[9px] text-shTextMuted/60" aria-hidden="true" />
              </th>
              <th className="py-2 pr-2" title="The Shop category/subcategory this item is filed under, for browsing in the client Shop.">
                Category <i className="fas fa-circle-info text-[9px] text-shTextMuted/60" aria-hidden="true" />
              </th>
              <th className="py-2 pr-2 text-right">Price</th>
              <th className="py-2 pr-2 text-right">Cost</th>
              <th className="py-2 pr-2 text-right">Margin</th>
              <th className="py-2 pr-2">Inventory</th>
              <th className="py-2 pr-2" title="Visible in the online client Shop. Independent of Register — an item can be shown in one and hidden in the other.">
                Shop <i className="fas fa-circle-info text-[9px] text-shTextMuted/60" aria-hidden="true" />
              </th>
              <th className="py-2 pr-2" title="Sellable from the in-person register. Independent of Shop — an item can be shown in one and hidden in the other.">
                Register <i className="fas fa-circle-info text-[9px] text-shTextMuted/60" aria-hidden="true" />
              </th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={13} className="py-6 text-center text-shTextMuted">Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={13} className="py-6 text-center text-shTextMuted">No items found.</td></tr>}
            {!loading && groupedFiltered.map((group) => {
              const collapsed = collapsedCategories.has(group.name);
              return (
              <Fragment key={group.name}>
                <tr className="border-b border-shBorder/60 bg-[var(--sh-card-base)]/40 cursor-pointer select-none"
                    onClick={() => toggleCategoryCollapsed(group.name)}
                    data-testid={`sm-category-group-${group.name}`}>
                  <td colSpan={13} className="py-2 pr-2">
                    <span className="flex items-center gap-2 text-shText font-black text-[11px] uppercase tracking-widest">
                      <i className={`fas fa-chevron-${collapsed ? "right" : "down"} text-[9px] text-shTextMuted`} aria-hidden="true" />
                      {group.name}
                      <span className="text-shTextMuted font-normal">({group.rows.length})</span>
                    </span>
                  </td>
                </tr>
                {!collapsed && group.rows.map((it) => {
              const margin = marginDisplay(it);
              const inv = inventoryStatus(it);
              const warnings = itemWarnings(it);
              return (
              <tr key={`${it.kind}:${it.id}`} className="border-b border-shBorder/60" data-testid={`sm-item-row-${it.id}`}>
                <td className="py-2 pr-2">
                  <input type="checkbox" checked={selected.has(rowKey(it))} onChange={() => toggleSelect(it)} data-testid={`sm-select-${it.id}`}
                         aria-label={`Select ${it.name}`} />
                </td>
                <td className="py-2 pr-2 text-shText font-bold cursor-pointer" onClick={() => onEditItem(it)}>
                  <div className="flex items-center gap-2">
                    <ItemThumbnail imageId={it.image_id} alt={it.name} size={40} />
                    <span>
                      {it.name}
                      {it.featured && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary align-middle">Featured</span>}
                      {warnings.map((w, wi) => (
                        <span key={wi} className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest align-middle ${WARNING_TONE_CLASS[w.tone]}`} data-testid={`sm-warning-${it.id}`}>
                          {w.label}
                        </span>
                      ))}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-2 text-shTextMuted">{itemKindLabel(it)}</td>
                <td className="py-2 pr-2 text-shTextMuted">{it.section_label}</td>
                <td className="py-2 pr-2 text-shTextMuted">{it.category_name || "Uncategorized"}{it.subcategory_name ? ` / ${it.subcategory_name}` : ""}</td>
                <td className="py-2 pr-2 text-right text-shText">
                  {editingPriceKey === rowKey(it) ? (
                    <input type="number" autoFocus value={priceDraft} disabled={priceSaving}
                           onChange={(e) => setPriceDraft(e.target.value)}
                           onBlur={() => savePriceEdit(it)}
                           onKeyDown={(e) => { if (e.key === "Enter") savePriceEdit(it); else if (e.key === "Escape") cancelPriceEdit(); }}
                           data-testid={`sm-price-input-${it.id}`}
                           className="w-20 bg-[var(--sh-card-base)] border border-shPrimary rounded p-1 text-right text-shText text-sm" />
                  ) : (
                    <span onClick={() => beginEditPrice(it)} data-testid={`sm-price-${it.id}`}
                          className={priceEditable(it) ? "cursor-pointer hover:underline decoration-dotted decoration-shTextMuted/50" : ""}
                          title={priceEditable(it) ? "Click to edit" : undefined}>
                      {priceDisplay(it)}
                    </span>
                  )}
                  {it.pricing_variable && <span className="ml-1 text-[10px] text-shSecondary" title="Client-specific/grandfathered pricing may apply">*</span>}
                </td>
                <td className="py-2 pr-2 text-right text-shTextMuted" data-testid={`sm-cost-${it.id}`}>
                  {margin ? margin.cost : "—"}
                </td>
                <td className="py-2 pr-2 text-right text-shTextMuted" data-testid={`sm-margin-${it.id}`}>
                  {margin && margin.gm ? margin.gm : "—"}
                </td>
                <td className="py-2 pr-2 text-shTextMuted">
                  {editingStockKey === rowKey(it) ? (
                    <div className="flex items-center gap-1" data-testid={`sm-stock-inline-${it.id}`}>
                      <input type="number" autoFocus placeholder="+/-" value={stockDraftQty} disabled={stockDraftSaving}
                             onChange={(e) => setStockDraftQty(e.target.value)}
                             onKeyDown={(e) => { if (e.key === "Escape") cancelStockEdit(); }}
                             data-testid={`sm-stock-inline-qty-${it.id}`}
                             className="w-14 bg-[var(--sh-card-base)] border border-shPrimary rounded p-1 text-shText text-sm" />
                      <input type="text" placeholder="Reason" value={stockDraftReason} disabled={stockDraftSaving}
                             onChange={(e) => setStockDraftReason(e.target.value)}
                             onKeyDown={(e) => { if (e.key === "Enter") saveStockEdit(it); else if (e.key === "Escape") cancelStockEdit(); }}
                             data-testid={`sm-stock-inline-reason-${it.id}`}
                             className="w-24 bg-[var(--sh-card-base)] border border-shBorder rounded p-1 text-shText text-sm" />
                      <button onClick={() => saveStockEdit(it)} disabled={stockDraftSaving} data-testid={`sm-stock-inline-save-${it.id}`}
                              className="text-shPrimary text-[11px] disabled:opacity-40"><i className="fas fa-check" /></button>
                      <button onClick={cancelStockEdit} disabled={stockDraftSaving} data-testid={`sm-stock-inline-cancel-${it.id}`}
                              className="text-shTextMuted text-[11px] disabled:opacity-40"><i className="fas fa-xmark" /></button>
                    </div>
                  ) : inv ? (
                    <span onClick={() => beginEditStock(it)} data-testid={`sm-inventory-${it.id}`}
                          className={`${inv.tone === "bad" ? "text-red-400" : inv.tone === "warn" ? "text-shOrange" : inv.tone === "ok" ? "text-shPrimary" : "text-shTextMuted"} ${stockEditable(it) ? "cursor-pointer hover:underline decoration-dotted" : ""}`}
                          title={stockEditable(it) ? "Click to adjust stock" : undefined}>
                      {inv.label}
                    </span>
                  ) : "—"}
                </td>
                <td className="py-2 pr-2"><StatusPill active={it.show_online} label={it.show_online ? "Shown" : "Hidden"} /></td>
                <td className="py-2 pr-2"><StatusPill active={it.show_at_register} label={it.show_at_register ? "Shown" : "Hidden"} /></td>
                <td className="py-2 pr-2">
                  {it.kind === "physical_product" && it.archived
                    ? <StatusPill active={false} label="Archived" />
                    : <StatusPill active={it.active} />}
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <div className="flex items-center gap-2 justify-end">
                    {it.kind === "physical_product" && it.archived ? (
                      <button onClick={() => restoreProduct(it)} disabled={busyId === it.id} data-testid={`sm-restore-${it.id}`}
                              className="text-shPrimary text-[11px] font-black uppercase tracking-widest disabled:opacity-40">Restore</button>
                    ) : (
                      <>
                        <button onClick={() => onEditItem(it)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Edit</button>
                        {/* One quick, reversible, always-visible action per
                            kind — Archive for a physical product (restorable,
                            see restoreProduct above), Hide/Activate for a
                            pack or program (no archive concept for those).
                            This used to only exist for packs/programs; a
                            physical product had no one-click way to pull
                            itself from Shop/Register short of opening Edit
                            and unchecking both visibility boxes, or getting
                            bounced off Delete into this same action anyway
                            (see archiveFromDeleteFlow). */}
                        {it.kind === "physical_product" ? (
                          <button onClick={() => archiveProduct(it)} disabled={busyId === it.id}
                                  data-testid={`sm-archive-${it.id}`}
                                  className="text-shTextMuted text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
                            Archive
                          </button>
                        ) : (
                          <button onClick={() => toggleHidePackOrProgram(it)} disabled={busyId === it.id}
                                  data-testid={`sm-toggle-active-${it.id}`}
                                  className="text-shTextMuted text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
                            {it.active ? "Hide" : "Activate"}
                          </button>
                        )}
                        {/* Delete is always inline, never behind the More
                            menu, for every kind — a physical product already
                            had this (owner-reported: several row actions once
                            pushed Delete off-screen behind a menu, which read
                            as "no way to delete this"); a pack/program had
                            the exact same button buried in the menu instead,
                            same bug by a different name. */}
                        <button onClick={() => openDeleteProduct(it)} disabled={busyId === it.id}
                                data-testid={`sm-delete-${it.id}`}
                                className="text-red-400 text-[11px] font-black uppercase tracking-widest disabled:opacity-40">Delete</button>
                        <RowActionsMenu testIdPrefix={`sm-row-${it.id}`} actions={[
                          { key: "duplicate", label: "Duplicate", disabled: busyId === it.id,
                            testId: `sm-duplicate-${it.id}`, onClick: () => duplicateItem(it) },
                          ...(it.kind === "physical_product" && it.sales_destination !== "shopify_external" && (!it.variants || it.variants.length === 0) ? [
                            { key: "print-label", label: "Print Label", testId: `sm-print-label-${it.id}`,
                              onClick: () => setPrintLabelTarget({ productId: it.id, itemName: it.name, initialSku: it.sku || "", price: it.list_price }) },
                          ] : []),
                          ...(it.kind === "physical_product" && it.track_inventory ? [
                            { key: "receive-stock", label: "Receive Stock", testId: `sm-receive-stock-${it.id}`, onClick: () => openReceiveStock(it) },
                            { key: "adjust-stock", label: "Adjust Stock", testId: `sm-adjust-stock-${it.id}`, onClick: () => openAdjustStock(it) },
                            { key: "stock-history", label: "Stock History", testId: `sm-stock-history-${it.id}`, onClick: () => openStockHistory(it) },
                          ] : []),
                        ]} />
                      </>
                    )}
                  </div>
                </td>
              </tr>
              );
                })}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}

      {stockModal && (() => {
        const isReceive = stockModal.mode === "receive";
        const parsedQty = Number(stockQty);
        const delta = isReceive ? Math.abs(parsedQty || 0) : (parsedQty || 0);
        const resulting = (stockModal.item.stock_on_hand ?? 0) + delta;
        return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="sm-stock-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3">
            <p className="text-shText font-black uppercase tracking-widest">{isReceive ? "Receive Stock" : "Adjust Stock"} — {stockModal.item.name}</p>
            <p className="text-shTextMuted text-sm">Current stock: {stockModal.item.stock_on_hand}</p>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">
                {isReceive ? "Quantity received" : "Quantity adjustment (+/-)"}
              </label>
              <input type="number" min={isReceive ? 0 : undefined} value={stockQty} onChange={(e) => setStockQty(e.target.value)}
                     data-testid="sm-stock-qty-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Reason</label>
              <input value={stockReason} onChange={(e) => setStockReason(e.target.value)}
                     placeholder={isReceive ? "e.g. Shipment received" : "e.g. Damaged, Lost, count correction"}
                     data-testid="sm-stock-reason-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            {parsedQty !== 0 && !Number.isNaN(parsedQty) && (
              <p className="text-shTextMuted text-sm" data-testid="sm-stock-resulting">
                Resulting stock: <span className="text-shText font-bold">{resulting}</span>
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setStockModal(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">Cancel</button>
              <button onClick={submitStock} data-testid="sm-stock-save" className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest">Save</button>
            </div>
          </div>
        </div>
        );
      })()}

      {historyItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="sm-stock-history-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="text-shText font-black uppercase tracking-widest">Stock History — {historyItem.name}</p>
              <button onClick={() => setHistoryItem(null)} className="text-shTextMuted hover:text-shText"><i className="fas fa-xmark" /></button>
            </div>
            {historyLoading ? (
              <p className="text-shTextMuted text-sm py-6 text-center">Loading…</p>
            ) : historyRows.length === 0 ? (
              <p className="text-shTextMuted text-sm py-6 text-center">No stock movements recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-shTextMuted text-[11px] uppercase tracking-widest text-left border-b border-shBorder">
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2">Type</th>
                      <th className="py-2 pr-2">Reason</th>
                      <th className="py-2 pr-2 text-right">Change</th>
                      <th className="py-2 pr-2 text-right">Before</th>
                      <th className="py-2 pr-2 text-right">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((m) => (
                      <tr key={m.id} className="border-b border-shBorder/60" data-testid={`sm-movement-${m.id}`}>
                        <td className="py-2 pr-2 text-shTextMuted whitespace-nowrap">{m.created_at ? new Date(m.created_at).toLocaleString() : "—"}</td>
                        <td className="py-2 pr-2 text-shText">{m.type}</td>
                        <td className="py-2 pr-2 text-shTextMuted">{m.reason}</td>
                        <td className={`py-2 pr-2 text-right font-bold ${m.quantity_delta > 0 ? "text-shPrimary" : "text-red-400"}`}>
                          {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                        </td>
                        <td className="py-2 pr-2 text-right text-shTextMuted">{m.stock_before}</td>
                        <td className="py-2 pr-2 text-right text-shText">{m.stock_after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteTarget && (() => {
        const kindNoun = deleteTarget.kind === "physical_product" ? "product"
          : deleteTarget.kind === "credit_pack" ? "pack" : "program";
        const isCreditPack = deleteTarget.kind === "credit_pack";
        const historyNoun = deleteTarget.kind === "physical_product" ? "order, sale, or inventory" : "enrollment";
        const fallbackVerb = deleteTarget.kind === "physical_product" ? "archiving" : "hiding";
        const fallbackLabel = deleteTarget.kind === "physical_product" ? "Archive Product" : `Hide ${kindNoun === "pack" ? "Pack" : "Program"}`;
        return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="sm-delete-confirm">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3">
            {!hasHistory ? (
              <>
                <p className="text-shText font-black uppercase tracking-widest">Delete "{deleteTarget.name}"?</p>
                <p className="text-shTextMuted text-sm">
                  {isCreditPack
                    ? "This permanently removes the pack from your catalog. Any client with a custom price on it keeps that override, just no longer tied to a live catalog item."
                    : `This permanently removes the ${kindNoun}. Only possible with no ${historyNoun} history — otherwise we'll offer to ${fallbackVerb} it instead.`}
                </p>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setDeleteTarget(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">Cancel</button>
                  <button onClick={confirmDeleteProduct} className="flex-1 bg-red-500 text-white rounded-xl py-3 font-black uppercase tracking-widest">Permanently Delete</button>
                </div>
              </>
            ) : isCreditPack ? (
              <>
                <p className="text-shText font-black uppercase tracking-widest">"{deleteTarget.name}"</p>
                <p className="text-shTextMuted text-sm">{blockedDetail || "Some clients have a custom price on this pack."}</p>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setDeleteTarget(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">Cancel</button>
                  <button onClick={confirmDeleteForced} className="flex-1 bg-red-500 text-white rounded-xl py-3 font-black uppercase tracking-widest">Delete Anyway</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-shText font-black uppercase tracking-widest">"{deleteTarget.name}" has {historyNoun} history</p>
                <p className="text-shTextMuted text-sm">Can't be permanently deleted — {fallbackVerb} instead keeps every past {deleteTarget.kind === "physical_product" ? "order/receipt/report" : "enrollment/progress"} intact.</p>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setDeleteTarget(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">Cancel</button>
                  <button onClick={archiveFromDeleteFlow} className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest">{fallbackLabel}</button>
                </div>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {bulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="sm-bulk-delete-confirm">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3">
            <p className="text-shText font-black uppercase tracking-widest">Delete {selectedItems.length} item{selectedItems.length === 1 ? "" : "s"}?</p>
            <p className="text-shTextMuted text-sm">
              Permanently removes every selected item with no order/sale/enrollment history. Anything with real
              history is skipped and left alone — use Archive/Hide for those instead.
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setBulkDeleteConfirm(false)} disabled={bulkBusy}
                      className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3 disabled:opacity-40">Cancel</button>
              <button onClick={bulkDeleteSelected} disabled={bulkBusy} data-testid="sm-bulk-delete-confirm-submit"
                      className="flex-1 bg-red-500 text-white rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
                {bulkBusy ? "Deleting…" : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * ADD SHOP ITEM — type picker
 * ========================================================================== */
function TypePickerModal({ onClose, onPick }) {
  const options = [
    { key: "physical_product", label: "Physical Product", icon: "fa-box", desc: "Inventory, SKU, cost, tax, register + Shop checkout." },
    { key: "shopify_external", label: "Shopify/External Merchandise", icon: "fa-arrow-up-right-from-square", desc: "Display-only Shop link — Shopify handles checkout." },
    { key: "printify", label: "Printify Print-on-Demand", icon: "fa-shirt", desc: "Sold and paid for here — Printify only handles production/shipping." },
    { key: "credit_pack", label: "Prepaid Visit Pack", icon: "fa-ticket", desc: "Bulk daycare/boarding/visit credits." },
    { key: "training_program", label: "Training Program", icon: "fa-graduation-cap", desc: "Sessions, curriculum, enrollment." },
  ];
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg p-6 space-y-3">
        <p className="text-shText text-lg font-black uppercase tracking-widest">What are you adding?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {options.map((o) => (
            <button key={o.key} onClick={() => onPick(o.key)} data-testid={`sm-pick-${o.key}`}
                    className="text-left bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 hover:border-shPrimary/60 transition">
              <i className={`fas ${o.icon} text-shPrimary text-lg mb-2`} />
              <p className="text-shText font-black text-sm">{o.label}</p>
              <p className="text-shTextMuted text-[12px] mt-1">{o.desc}</p>
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="text-shTextMuted font-black uppercase text-sm tracking-widest">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * CSV IMPORT — bulk-edit the flat product catalog from a spreadsheet.
 *
 * Preview-then-commit: the same file is posted twice (commit=false, then
 * commit=true) so the admin sees exactly what every row will do — create,
 * update, or skip with a reason — before anything is actually written.
 * ========================================================================== */
function CsvImportModal({ onClose, onApplied }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // {committed, rows, summary}
  const [result, setResult] = useState(null); // same shape, after commit=true
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const runPreview = async () => {
    if (!file) return;
    setBusy(true); setErr(""); setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/pos/products/import.csv", fd, { params: { commit: false } });
      setPreview(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not read that file");
    }
    setBusy(false);
  };

  const applyImport = async () => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/pos/products/import.csv", fd, { params: { commit: true } });
      setResult(data);
      toast.success(`Import applied — ${data.summary.ok} of ${data.summary.total} rows`);
      onApplied();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not apply the import");
    }
    setBusy(false);
  };

  const rows = (result || preview)?.rows || [];
  const summary = (result || preview)?.summary;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} data-testid="csv-import-modal"
           className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <p className="text-shText text-lg font-black uppercase tracking-widest">Import Products from CSV</p>
        <p className="text-shTextMuted text-[12px]">
          Columns: <code className="text-shText">id, name, sku, price, cost, track_inventory, stock_on_hand, low_stock_threshold, active, taxable</code>.
          A row matches an existing product by id first, else by sku — anything else creates a new one. A blank cell on
          a matched row leaves that field exactly as it is. Products with options (variants) and Shopify-linked
          listings aren't included — edit those from the Items table directly.
        </p>

        {!result && (
          <div className="flex items-center gap-3">
            <label className="bg-[var(--sh-card-base)] border border-shBorder rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest text-shText cursor-pointer">
              {file ? file.name : "Choose CSV File"}
              <input type="file" accept=".csv,text/csv" className="hidden" data-testid="csv-import-file-input"
                     onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setErr(""); }} />
            </label>
            <button onClick={runPreview} disabled={!file || busy} data-testid="csv-import-preview-btn"
                    className="bg-shPrimary text-bgHeader rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest disabled:opacity-40">
              {busy ? "Reading…" : "Preview"}
            </button>
          </div>
        )}

        {err && <p className="text-shDanger text-sm" role="alert">{err}</p>}

        {summary && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="csv-import-summary">
              <span className="text-shText"><span className="font-black text-shPrimary">{summary.ok}</span> will {result ? "be" : "be"} {result ? "applied" : "apply"}</span>
              <span className="text-shText"><span className="font-black text-shOrange">{summary.skipped}</span> skipped</span>
              <span className="text-shTextMuted">{summary.total} rows total</span>
            </div>
            <div className="overflow-x-auto border border-shBorder rounded-lg">
              <table className="w-full text-[12px]" data-testid="csv-import-rows">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-shTextMuted border-b border-shBorder">
                    <th className="py-1.5 px-2">Row</th>
                    <th className="py-1.5 px-2">Action</th>
                    <th className="py-1.5 px-2">Product</th>
                    <th className="py-1.5 px-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.row} className="border-t border-shBorder">
                      <td className="py-1 px-2 text-shTextMuted tabular-nums">{r.row}</td>
                      <td className="py-1 px-2">
                        <span className={r.action === "skip" ? "text-shDanger" : r.action === "create" ? "text-shPrimary" : "text-shText"}>
                          {r.action}
                        </span>
                      </td>
                      <td className="py-1 px-2 text-shText">{r.name || "—"}</td>
                      <td className="py-1 px-2 text-shTextMuted">{r.error || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-shTextMuted font-black uppercase text-sm tracking-widest">
            {result ? "Close" : "Cancel"}
          </button>
          {preview && !result && (
            <button onClick={applyImport} disabled={busy || summary.ok === 0} data-testid="csv-import-apply-btn"
                    className="bg-shPrimary text-bgHeader rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest disabled:opacity-40">
              {busy ? "Applying…" : `Apply ${summary.ok} Change${summary.ok === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * CATEGORIES & LAYOUT TAB
 * ========================================================================== */
function CategoriesTab() {
  const [section, setSection] = useState("merch");
  const [categories, setCategories] = useState([]);
  const [uncategorized, setUncategorized] = useState([]);
  // Every item in this section, so an expanded category can show what's
  // actually IN it — owner: "i would like for it to show me what items are
  // in the category when expanded". Same /shop-manager/items ItemsTab
  // already uses, just filtered client-side by category_id per row.
  const [sectionItems, setSectionItems] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const BLANK_CATEGORY_DRAFT = { name: "", description: "", image_id: null, mobile_image_id: null, is_featured: false, is_department: false, hide_when_empty: null };
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null); // null = adding new; category.id = editing
  const [categoryDraft, setCategoryDraft] = useState(BLANK_CATEGORY_DRAFT);
  const [categoryOriginalImageId, setCategoryOriginalImageId] = useState(null);
  const [categoryOriginalMobileImageId, setCategoryOriginalMobileImageId] = useState(null);
  const [addingSubFor, setAddingSubFor] = useState(null);
  const [subDraft, setSubDraft] = useState({ name: "", description: "" });

  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeAction, setRemoveAction] = useState("deactivate");
  const [removeDestination, setRemoveDestination] = useState("");

  const [bulkSelection, setBulkSelection] = useState([]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkSubcategoryId, setBulkSubcategoryId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, uncatRes] = await Promise.all([
        api.get("/shop/categories", { params: { include_inactive: true, section } }),
        api.get("/shop/uncategorized-items", { params: { section } }),
      ]);
      setCategories(catRes.data.categories || []);
      setUncategorized(uncatRes.data.items || []);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
    // Separate call, separate failure: /shop-manager/items needs the
    // "pricing" permission and this tab deliberately doesn't (see
    // ItemsTab's forbidden message — "use the Categories & Layout tab if
    // you only need to organize categories"). A staffer without it still
    // gets categories/uncategorized above; expanding a category just shows
    // no item list instead of breaking the whole tab's load.
    api.get("/shop-manager/items", { params: { section } })
      .then(({ data }) => setSectionItems(data.items || []))
      .catch(() => setSectionItems([]));
  }, [section]);
  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const openAddCategory = () => {
    setEditingCategoryId(null);
    setCategoryDraft(BLANK_CATEGORY_DRAFT);
    setCategoryOriginalImageId(null);
    setCategoryOriginalMobileImageId(null);
    setAddingCategory(true);
  };
  const openEditCategory = (cat) => {
    setEditingCategoryId(cat.id);
    setCategoryDraft({
      name: cat.name || "", description: cat.description || "",
      image_id: cat.image_id || null, mobile_image_id: cat.mobile_image_id || null,
      is_featured: !!cat.is_featured, is_department: !!cat.is_department,
      hide_when_empty: cat.hide_when_empty ?? null,
    });
    setCategoryOriginalImageId(cat.image_id || null);
    setCategoryOriginalMobileImageId(cat.mobile_image_id || null);
    setAddingCategory(true);
  };
  const cancelCategoryForm = () => {
    // Closing without saving — drop any not-yet-saved uploads from this session.
    if (categoryDraft.image_id && categoryDraft.image_id !== categoryOriginalImageId) {
      api.delete(`/shop/media/${categoryDraft.image_id}`).catch(() => {});
    }
    if (categoryDraft.mobile_image_id && categoryDraft.mobile_image_id !== categoryOriginalMobileImageId) {
      api.delete(`/shop/media/${categoryDraft.mobile_image_id}`).catch(() => {});
    }
    setAddingCategory(false);
    setEditingCategoryId(null);
    setCategoryDraft(BLANK_CATEGORY_DRAFT);
  };

  const saveCategory = async () => {
    setErr("");
    if (!categoryDraft.name.trim()) return setErr("Category name is required.");
    const body = {
      name: categoryDraft.name.trim(), description: categoryDraft.description || null,
      // PUT is a patch — the backend treats `null` as "field omitted, leave
      // unchanged" and only clears on an explicit "" (see update_shop_category).
      // POST (create) has no such ambiguity, so it keeps sending null.
      image_id: categoryDraft.image_id || (editingCategoryId ? "" : null),
      mobile_image_id: categoryDraft.mobile_image_id || (editingCategoryId ? "" : null),
      is_featured: categoryDraft.is_featured, is_department: categoryDraft.is_department,
      hide_when_empty: categoryDraft.hide_when_empty,
    };
    try {
      if (editingCategoryId) {
        await api.put(`/shop/categories/${editingCategoryId}`, body);
        // Save succeeded — now safe to drop old images, if replaced/removed.
        if (categoryOriginalImageId && categoryOriginalImageId !== categoryDraft.image_id) {
          api.delete(`/shop/media/${categoryOriginalImageId}`).catch(() => {});
        }
        if (categoryOriginalMobileImageId && categoryOriginalMobileImageId !== categoryDraft.mobile_image_id) {
          api.delete(`/shop/media/${categoryOriginalMobileImageId}`).catch(() => {});
        }
      } else {
        await api.post("/shop/categories", { ...body, section });
      }
      setAddingCategory(false);
      setEditingCategoryId(null);
      setCategoryDraft(BLANK_CATEGORY_DRAFT);
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
    try { await api.put(`/shop/categories/${cat.id}`, { active: !cat.active }); load(); } catch (e) { setErr(formatErr(e)); }
  };
  const toggleSubActive = async (sub) => {
    try { await api.put(`/shop/subcategories/${sub.id}`, { active: !sub.active }); load(); } catch (e) { setErr(formatErr(e)); }
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
    try { await api.post("/shop/categories/reorder", { ordered_ids: ids }); } catch (e) { setErr(formatErr(e)); load(); }
  };

  const moveSubcategory = async (category, fromIdx, toIdx) => {
    const subs = category.subcategories || [];
    if (toIdx < 0 || toIdx >= subs.length) return;
    const ids = subs.map((s) => s.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    try { await api.post("/shop/subcategories/reorder", { ordered_ids: ids }); load(); } catch (e) { setErr(formatErr(e)); }
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
      await api.post("/shop/items/bulk-assign", { items: bulkSelection, category_id: bulkCategoryId || null, subcategory_id: bulkSubcategoryId || null });
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
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SECTION_TABS.filter((s) => s.key !== "all").map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)} data-testid={`sm-cat-section-${s.key}`}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${section === s.key ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="sm-cat-error">{err}</div>}

      {loading ? (
        <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={openAddCategory} data-testid="sm-add-category"
                    className="bg-shPrimary text-bgBase px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shPrimary/90">
              <i className="fas fa-plus mr-1" />Add Category to {SECTION_TABS.find((s) => s.key === section)?.label}
            </button>
          </div>

          {addingCategory && (
            <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3" data-testid="sm-category-form">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">{editingCategoryId ? "Edit Category" : "New Category"}</p>
              <input value={categoryDraft.name} onChange={(e) => setCategoryDraft((d) => ({ ...d, name: e.target.value }))}
                     placeholder="Category name" data-testid="sm-category-name-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <input value={categoryDraft.description} onChange={(e) => setCategoryDraft((d) => ({ ...d, description: e.target.value }))}
                     placeholder="Optional description"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Cover Image</label>
                  <ShopImageUpload imageId={categoryDraft.image_id} originalImageId={categoryOriginalImageId}
                                   onChange={(id) => setCategoryDraft((d) => ({ ...d, image_id: id }))} />
                </div>
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Mobile Cover Image (optional — falls back to Cover Image)</label>
                  <ShopImageUpload imageId={categoryDraft.mobile_image_id} originalImageId={categoryOriginalMobileImageId}
                                   onChange={(id) => setCategoryDraft((d) => ({ ...d, mobile_image_id: id }))} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={categoryDraft.is_featured}
                         onChange={(e) => setCategoryDraft((d) => ({ ...d, is_featured: e.target.checked }))}
                         data-testid="sm-category-featured" />
                  <span className="text-shText text-sm">Featured (shown first, before non-featured categories)</span>
                </label>
                {section === "merch" && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={categoryDraft.is_department}
                           onChange={(e) => setCategoryDraft((d) => ({ ...d, is_department: e.target.checked }))}
                           data-testid="sm-category-is-department" />
                    <span className="text-shText text-sm">Feature as its own Shop department — items in this category leave Gear and get their own tile</span>
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-shText">
                  Hide when empty:
                  <select value={categoryDraft.hide_when_empty === null ? "" : categoryDraft.hide_when_empty ? "true" : "false"}
                          onChange={(e) => setCategoryDraft((d) => ({ ...d, hide_when_empty: e.target.value === "" ? null : e.target.value === "true" }))}
                          data-testid="sm-category-hide-when-empty"
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm">
                    <option value="">Default (use global setting)</option>
                    <option value="true">Always</option>
                    <option value="false">Never</option>
                  </select>
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={cancelCategoryForm} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest px-3 py-2">Cancel</button>
                <button onClick={saveCategory} data-testid="sm-save-category"
                        className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[12px] tracking-widest">Save Category</button>
              </div>
            </div>
          )}

          {categories.length === 0 && !addingCategory && (
            <div className="text-center text-shTextMuted py-10 text-sm italic">No categories in this section yet.</div>
          )}

          {categories.map((cat, idx) => (
            <div key={cat.id} className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl overflow-hidden" data-testid={`sm-category-${cat.id}`}>
              <div className="flex flex-wrap items-center gap-3 p-3">
                <button onClick={() => toggleExpand(cat.id)} data-testid={`sm-expand-category-${cat.id}`} className="text-shTextMuted hover:text-shText">
                  <i className={`fas fa-chevron-${expanded[cat.id] ? "down" : "right"} text-[12px]`} />
                </button>
                <ItemThumbnail imageId={cat.image_id} alt={cat.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-shText font-bold text-sm truncate">
                    {cat.name} <span className="text-shTextMuted font-normal">· {cat.item_count} item{cat.item_count === 1 ? "" : "s"}</span>
                    {cat.is_featured && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary align-middle">Featured</span>}
                    {cat.is_department && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shSecondary/10 text-shSecondary align-middle">Department</span>}
                  </p>
                </div>
                <StatusPill active={cat.active} />
                <div className="flex items-center gap-1">
                  <button onClick={() => moveCategory(idx, idx - 1)} disabled={idx === 0} className="w-7 h-7 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-up text-[11px]" /></button>
                  <button onClick={() => moveCategory(idx, idx + 1)} disabled={idx === categories.length - 1} className="w-7 h-7 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-down text-[11px]" /></button>
                </div>
                <button onClick={() => openEditCategory(cat)} data-testid={`sm-edit-category-${cat.id}`} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Edit</button>
                <button onClick={() => toggleCategoryActive(cat)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">{cat.active ? "Hide" : "Show"}</button>
                <button onClick={() => openRemoveCategory(cat)} className="text-red-400 text-[11px] font-black uppercase tracking-widest">Remove</button>
              </div>
              {expanded[cat.id] && (
                <div className="border-t border-shBorder p-3 pl-9 space-y-3">
                  <div className="space-y-1.5" data-testid={`sm-category-items-${cat.id}`}>
                    <p className="text-[10px] text-shTextMuted uppercase tracking-widest font-black">Items in this category</p>
                    {sectionItems.filter((it) => it.category_id === cat.id).length === 0 ? (
                      <p className="text-[12px] text-shTextMuted italic">No items in this category yet.</p>
                    ) : (
                      sectionItems.filter((it) => it.category_id === cat.id).map((it) => (
                        <div key={`${it.kind}:${it.id}`} className="flex items-center gap-2 text-[13px]" data-testid={`sm-category-item-${cat.id}-${it.id}`}>
                          <ItemThumbnail imageId={it.image_id} alt={it.name} size={32} />
                          <span className="flex-1 text-shText truncate">
                            {it.name}
                            {it.subcategory_name && <span className="text-shTextMuted"> · {it.subcategory_name}</span>}
                          </span>
                          <span className="text-[10px] uppercase tracking-widest text-shTextMuted">{itemKindLabel(it)}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="border-t border-shBorder pt-3 space-y-2">
                  {(cat.subcategories || []).map((sub, sidx) => (
                    <div key={sub.id} className="flex items-center gap-2 text-[13px]">
                      <span className="flex-1 text-shText">{sub.name} <span className="text-shTextMuted">· {sub.item_count}</span></span>
                      <StatusPill active={sub.active} />
                      <button onClick={() => moveSubcategory(cat, sidx, sidx - 1)} disabled={sidx === 0} className="w-6 h-6 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-up text-[10px]" /></button>
                      <button onClick={() => moveSubcategory(cat, sidx, sidx + 1)} disabled={sidx === (cat.subcategories || []).length - 1} className="w-6 h-6 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-down text-[10px]" /></button>
                      <button onClick={() => toggleSubActive(sub)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">{sub.active ? "Hide" : "Show"}</button>
                      <button onClick={() => openRemoveSubcategory(cat, sub)} className="text-red-400 text-[11px] font-black uppercase tracking-widest">Remove</button>
                    </div>
                  ))}
                  {addingSubFor === cat.id ? (
                    <div className="flex gap-2">
                      <input value={subDraft.name} onChange={(e) => setSubDraft((d) => ({ ...d, name: e.target.value }))}
                             placeholder="Subcategory name" data-testid={`sm-subcategory-name-input-${cat.id}`}
                             className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                      <button onClick={() => setAddingSubFor(null)} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest px-2">Cancel</button>
                      <button onClick={() => saveSubcategory(cat.id)} className="bg-shPrimary text-bgBase px-3 py-1.5 rounded font-black uppercase text-[12px] tracking-widest">Save</button>
                    </div>
                  ) : (
                    <button onClick={() => { setAddingSubFor(cat.id); setSubDraft({ name: "", description: "" }); }}
                            data-testid={`sm-add-subcategory-${cat.id}`}
                            className="text-[12px] font-black uppercase text-shPrimary tracking-widest">
                      <i className="fas fa-plus mr-1" />Add Subcategory
                    </button>
                  )}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3 mt-6">
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Bulk Assign Uncategorized Items ({SECTION_TABS.find((s) => s.key === section)?.label})</p>
            {uncategorized.length === 0 ? (
              <p className="text-[13px] text-shTextMuted italic">No uncategorized items in this section.</p>
            ) : (
              <>
                <div className="max-h-52 overflow-y-auto space-y-1">
                  {uncategorized.map((it) => {
                    const checked = bulkSelection.some((s) => s.kind === it.kind && s.id === it.id);
                    return (
                      <label key={`${it.kind}:${it.id}`} className="flex items-center gap-2 p-1.5 rounded border border-shBorder text-[13px] text-shText cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => toggleBulkItem(it.kind, it.id)} />
                        <ItemThumbnail imageId={it.image_id} alt={it.name} size={36} />
                        <span className="flex-1 truncate">{it.name}</span>
                        <span className="text-[11px] uppercase tracking-widest text-shTextMuted">{itemKindLabel(it)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={bulkCategoryId} onChange={(e) => { setBulkCategoryId(e.target.value); setBulkSubcategoryId(""); }}
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                    <option value="">Choose category…</option>
                    {bulkCategoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={bulkSubcategoryId} onChange={(e) => setBulkSubcategoryId(e.target.value)} disabled={!bulkCategoryId}
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm disabled:opacity-40">
                    <option value="">No subcategory</option>
                    {bulkSubcategoryOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="flex justify-end">
                  <button onClick={applyBulkAssign} disabled={!bulkCategoryId}
                          className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[12px] tracking-widest disabled:opacity-40">
                    Apply to {bulkSelection.length} item{bulkSelection.length === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {removeTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-md p-5 space-y-3">
            <p className="text-shText font-black uppercase tracking-widest">Remove "{removeTarget.row.name}"?</p>
            <p className="text-shTextMuted text-sm">
              {removeTarget.impact.item_count} item{removeTarget.impact.item_count === 1 ? "" : "s"} currently assigned.
              {removeTarget.type === "category" && ` ${removeTarget.impact.subcategory_count || 0} subcategor${(removeTarget.impact.subcategory_count || 0) === 1 ? "y" : "ies"}.`}
              {" "}Products/packs/programs are never deleted by this action.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-shText">
                <input type="radio" checked={removeAction === "deactivate"} onChange={() => setRemoveAction("deactivate")} />
                Deactivate (hide from Shop, keep items assigned)
              </label>
              <label className="flex items-center gap-2 text-sm text-shText">
                <input type="radio" checked={removeAction === (removeTarget.type === "category" ? "move_to_uncategorized" : "move_to_category")} onChange={() => setRemoveAction(removeTarget.type === "category" ? "move_to_uncategorized" : "move_to_category")} />
                Delete and move items to {removeTarget.type === "category" ? "Uncategorized" : "the parent category"}
              </label>
              {removeTarget.type === "category" && (
                <label className="flex items-center gap-2 text-sm text-shText">
                  <input type="radio" checked={removeAction === "move_to_category"} onChange={() => setRemoveAction("move_to_category")} />
                  Delete and move items to another category:
                  <select value={removeDestination} onChange={(e) => setRemoveDestination(e.target.value)} disabled={removeAction !== "move_to_category"}
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1 text-shText text-sm disabled:opacity-40">
                    <option value="">Choose…</option>
                    {activeCategoriesForDest(removeTarget.row.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="flex gap-3 pt-1 justify-end">
              <button onClick={() => setRemoveTarget(null)} className="text-shTextMuted font-black uppercase text-sm tracking-widest px-3 py-2">Cancel</button>
              <button onClick={confirmRemove} className="bg-shPrimary text-bgHeader rounded-xl px-4 py-2 font-black uppercase tracking-widest">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * CLIENT PREVIEW TAB — mounts the REAL PortalShop presentation in
 * mode="preview" (see PortalShop.jsx), which itself reuses the exact same
 * catalog builder + pricing resolver + category-card navigation a real
 * client sees. Never a second, bespoke storefront implementation to keep
 * in sync — the client-picker below only decides `previewClientId`.
 * ========================================================================== */
function ClientPreviewTab() {
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [previewClient, setPreviewClient] = useState(null);

  useEffect(() => {
    const needle = clientQuery.trim();
    if (needle.length < 2) { setClientResults([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get("/clients/options", { params: { q: needle, limit: 8 } }).then(({ data }) => {
        if (!cancelled) setClientResults(data || []);
      }).catch(() => { if (!cancelled) setClientResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clientQuery]);


  return (
    <div className="space-y-4">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Preview as</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setPreviewClient(null); setClientQuery(""); }}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${!previewClient ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
            Standard / public pricing
          </button>
          {previewClient && (
            <span className="px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest bg-shSecondary/15 text-shSecondary">
              {previewClient.name}
            </span>
          )}
          <div className="relative flex-1 min-w-[200px]">
            <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Search a client to preview their exact pricing…"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            {clientResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-[var(--sh-card-base)] border border-shBorder rounded shadow-lg max-h-48 overflow-y-auto">
                {clientResults.map((c) => (
                  <button key={c.id} onClick={() => { setPreviewClient(c); setClientQuery(""); setClientResults([]); }}
                          className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-shText hover:bg-shPrimary/10">
                    <div className="w-7 h-7 rounded-full bg-shPrimary/20 text-shPrimary font-black text-[12px] grid place-items-center border border-shBorder shrink-0">
                      {(c.name || "?").trim().charAt(0).toUpperCase() || "?"}
                    </div>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <PortalShop key={previewClient?.id || "standard"} mode="preview" previewClientId={previewClient?.id || null} fullScreen />
    </div>
  );
}

/* ============================================================================
 * ONLINE ORDERS TAB — reuses the exact same admin order/fulfillment
 * endpoints Front Desk's Online Orders panel already uses (Pos.jsx is left
 * completely untouched; Front Desk still needs its own quick pickup
 * actions). Never a second order model or fulfillment workflow — this is
 * only a second admin SURFACE onto the same shop_orders data.
 * ========================================================================== */
const ORDER_FILTERS = [
  ["all", "All"], ["open", "Open"], ["new", "New"], ["preparing", "Preparing"],
  ["ready_for_pickup", "Ready for Pickup"], ["completed", "Completed"], ["needs_attention", "Needs Attention"],
];

const ORDER_STATUS_LABEL = {
  needs_attention: "Needs Attention", picked_up: "Picked Up", ready_for_pickup: "Ready for Pickup",
  preparing: "Preparing", processing: "Processing", completed: "Completed",
  preparing_to_ship: "Preparing to Ship", shipped: "Shipped",
};

function shipAddressLine(a) {
  if (!a) return "";
  return [a.address1, a.address2, [a.city, a.region, a.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}

function OnlineOrdersTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [trackingDrafts, setTrackingDrafts] = useState({});

  const load = () => {
    setLoading(true);
    setForbidden(false);
    api.get("/admin/shop-orders")
      .then(({ data }) => {
        const rows = data.orders || [];
        setOrders(rows);
        // Same "mark seen once actually shown" contract as Front Desk's own
        // Online Orders panel — only after a successful fetch, only the
        // orders that came back genuinely unseen.
        const newlyUnseenIds = rows.filter((o) => o.admin_unseen === true).map((o) => o.id);
        if (newlyUnseenIds.length > 0) {
          api.post("/admin/shop-orders/mark-seen", { order_ids: newlyUnseenIds })
            .then(() => {
              setOrders((prev) => prev.map((o) => (newlyUnseenIds.includes(o.id) ? { ...o, admin_unseen: false } : o)));
              window.dispatchEvent(new CustomEvent("sh:shop-orders-seen"));
            })
            .catch(() => {});
        }
      })
      .catch((e) => {
        if (e?.response?.status === 403) setForbidden(true);
        else toast.error("Could not load online orders");
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => searchOrders(filterOrdersByView(orders, filter), search),
    [orders, filter, search],
  );

  const runAction = async (orderId, action) => {
    setBusyId(orderId);
    try {
      const { data } = await api.post(`/admin/shop-orders/${orderId}/fulfillment`, { action });
      load();
      const note = pickupActionToast(action, data);   // what happened to the customer's "ready" email
      if (note.level === "success") toast.success(note.message); else toast(note.message);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update this order");
    }
    setBusyId(null);
  };

  const markShipped = async (orderId) => {
    setBusyId(orderId);
    try {
      await api.post(`/admin/shop-orders/${orderId}/mark-shipped`, { tracking_number: trackingDrafts[orderId]?.trim() || null });
      load();
      toast.success("Marked shipped — the customer has been emailed.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not mark this order shipped");
    }
    setBusyId(null);
  };

  if (forbidden) {
    return (
      <div className="text-center text-shTextMuted py-10 text-sm" data-testid="sm-orders-forbidden">
        You don't have permission to view or update online orders. Ask an owner/admin to grant the payments permission.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <NeonEdge accentRgb="0,169,224" intensity="subtle">
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">Shop operations</p>
              <h3 className="sh-display text-xl text-shText mt-0.5">Online Orders</h3>
              <p className="text-[11px] text-shTextMuted mt-1">Paid orders, pickup fulfillment, and any access issue that needs your attention.</p>
            </div>
            <button onClick={load} className="rounded-xl border border-shBorder/70 bg-white/[0.025] px-3 py-2 text-[11px] font-black text-shTextMuted hover:text-shSecondary hover:border-shSecondary/30 transition">
              <i className="fas fa-rotate-right mr-1.5" />Refresh
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ORDER_FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} data-testid={`sm-order-filter-${k}`}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-[0.1em] transition ${filter === k ? "bg-shPrimary text-[#071018] shadow-[0_0_18px_rgba(140,198,63,0.10)]" : "bg-white/[0.025] border border-shBorder/60 text-shTextMuted hover:text-shText"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative mt-3">
            <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-shTextMuted"/>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, order, dog, or item"
                   data-testid="sm-order-search"
                   className="w-full bg-black/20 border border-shBorder/60 rounded-xl pl-9 pr-3 py-2.5 text-shText text-sm outline-none" />
          </div>
        </div>
      </NeonEdge>

      {loading ? (
        <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <p className="text-shTextMuted text-sm py-6 text-center">No orders match this filter.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const busy = busyId === o.id;
            const status = orderComputedStatus(o);
            const hasPhysical = (o.lines || []).some((l) => l.kind === "product");
            return (
              <NeonEdge key={o.id} accentRgb={status === "needs_attention" ? "242,101,34" : "0,169,224"} intensity={status === "needs_attention" ? "standard" : "subtle"} data-testid={`sm-order-${o.id}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <HuskyDogImage name={(o.lines || []).find(l => l.dog_name)?.dog_name || o.client_name} className="w-11 h-11 rounded-xl object-cover border border-shBorder/60 bg-black/30 shrink-0"/>
                      <div className="min-w-0">
                        <p className="text-shText font-bold text-sm">
                          Order #{orderRef(o)} · {o.client_name || "Unknown client"}
                      {o.admin_unseen === true && (
                        <span className="ml-2 inline-block bg-shAccent text-bgHeader text-[10px] font-black px-1.5 py-0.5 rounded-full align-middle" data-testid={`sm-order-new-${o.id}`}>NEW</span>
                      )}
                    </p>
                    <p className="text-shTextMuted text-[12px]">
                      {o.created_at ? new Date(o.created_at).toLocaleString() : "—"} · {money(o.total)}
                    </p>
                    <p className="text-[11px] text-shTextMuted mt-1">
                      {(o.lines || []).map((l) => `${l.quantity}× ${l.name}${l.dog_name ? ` (${l.dog_name})` : ""}`).join(", ")}
                    </p>
                    {/* Phase 6 (6.8) — surface WHY a line is stuck, not just that it is. */}
                        {(o.lines || []).filter((l) => l.fulfillment_error).map((l) => (
                          <div key={l.item_id} className="mt-2 rounded-lg border border-shAccent/25 bg-shAccent/[0.06] px-3 py-2 text-[11px] text-shAccent" data-testid={`sm-order-line-error-${l.item_id}`}>
                            <i className="fas fa-triangle-exclamation mr-1.5"/><span className="font-black">{l.name}</span>: {l.fulfillment_error}
                          </div>
                        ))}
                        {o.shipping_address && (
                          <p className="text-[11px] text-shTextMuted mt-1" data-testid={`sm-order-ship-address-${o.id}`}>
                            <i className="fas fa-truck-fast mr-1.5"/>Ship to: {shipAddressLine(o.shipping_address)}
                            {o.tracking_number ? ` · Tracking: ${o.tracking_number}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[11px] font-black uppercase tracking-widest ${
                      status === "needs_attention" ? "text-shOrange" : ["picked_up", "completed", "shipped"].includes(status) ? "text-shPrimary" : "text-shTextMuted"
                    }`}>
                      {ORDER_STATUS_LABEL[status]}
                    </p>
                    <p className="text-[10px] text-shTextMuted mt-1">
                      Payment: Paid{hasPhysical ? ` · ${o.shipping_address ? "Shipping" : "Pickup"}: ${ORDER_STATUS_LABEL[status]}` : ""}
                    </p>
                  </div>
                </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-shBorder/45 flex-wrap">
                  {status === "needs_attention" && (
                    <button onClick={() => runAction(o.id, "retry_fulfillment")} disabled={busy} data-testid={`sm-order-retry-${o.id}`}
                            className="bg-shAccent text-[#080b12] px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-[0.1em] hover:brightness-110 transition disabled:opacity-50 shadow-[0_0_18px_rgba(242,101,34,0.10)]">
                      {busy ? "Retrying…" : "Retry Fulfillment"}
                    </button>
                  )}
                  {o.pickup_status === "preparing" && (
                    <button onClick={() => runAction(o.id, "mark_ready")} disabled={busy} data-testid={`sm-order-mark-ready-${o.id}`}
                            className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                      Mark Ready
                    </button>
                  )}
                  {o.pickup_status === "ready_for_pickup" && (
                    <button onClick={() => runAction(o.id, "mark_picked_up")} disabled={busy} data-testid={`sm-order-mark-picked-up-${o.id}`}
                            className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                      Mark Picked Up
                    </button>
                  )}
                  {o.shipping_status === "preparing" && (
                    <div className="flex items-center gap-2" data-testid={`sm-order-shipping-${o.id}`}>
                      <input value={trackingDrafts[o.id] || ""} maxLength={60}
                             onChange={(e) => setTrackingDrafts((d) => ({ ...d, [o.id]: e.target.value }))}
                             placeholder="Tracking # (optional)" data-testid={`sm-order-tracking-input-${o.id}`}
                             className="bg-black/20 border border-shBorder/60 rounded px-2 py-1.5 text-[11px] text-shText w-40" />
                      <button onClick={() => markShipped(o.id)} disabled={busy} data-testid={`sm-order-mark-shipped-${o.id}`}
                              className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                        Mark Shipped
                      </button>
                    </div>
                  )}
                  </div>
                </div>
              </NeonEdge>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * PRINTIFY ORDERS TAB — print-on-demand production status for every paid
 * Printify line, from the register (Pos.jsx's scan-to-cart +
 * PrintifyFulfillmentModal) OR the online Shop (ShopItemDetail.jsx's size/
 * personalization form) — one shared outbox, one shared screen. This
 * screen is read-only visibility into what happens AFTER that sale: the
 * outbox worker (domains/printify/client.process_outbox) submits each
 * queued row with retry/backoff, and Printify's own webhook fills in
 * production/shipment status as it happens. A "stuck" row is a real paid
 * order that hasn't reached Printify yet — the one thing on this screen
 * that needs a human.
 * ========================================================================== */
const PRINTIFY_STATUS_FILTERS = [
  ["", "All"], ["pending", "Queued"], ["stuck", "Stuck"], ["submitted", "Submitted"],
];

function printifyRowBadge(row) {
  if (row.status === "stuck") return { label: "Stuck", className: "text-shAccent" };
  if (row.status === "pending") return { label: "Queued", className: "text-shTextMuted" };
  // Submitted — show Printify's own last-known status once the webhook (or
  // a future reconciliation sweep) has reported one, not just "Submitted".
  const sub = { created: "Created", "in-production": "In production", shipped: "Shipped", delivered: "Delivered" };
  return { label: sub[row.printify_status] || "Submitted", className: "text-shPrimary" };
}

function PrintifyOrdersTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [printifyEnabled, setPrintifyEnabled] = useState(true);
  const [registering, setRegistering] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/admin/printify/outbox", { params: { status: filter || undefined } })
      .then(({ data }) => {
        setRows(data.rows || []);
        setPrintifyEnabled(data.printify_enabled !== false);
      })
      .catch(() => toast.error("Could not load Printify orders"))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter]);

  const retry = async (rowId) => {
    setBusyId(rowId);
    try {
      await api.post(`/admin/printify/outbox/${rowId}/retry`);
      toast.success("Queued for the next attempt.");
      load();
    } catch (e) {
      toast.error(formatErr(e, "Could not retry this order"));
    }
    setBusyId(null);
  };

  const registerWebhooks = async () => {
    setRegistering(true);
    try {
      const { data } = await api.post("/admin/printify/webhooks/register");
      const created = data.created || [];
      toast.success(created.length ? `Subscribed: ${created.join(", ")}` : "Already up to date — nothing new to subscribe.");
    } catch (e) {
      toast.error(formatErr(e, "Could not register Printify webhooks"));
    }
    setRegistering(false);
  };

  return (
    <div className="space-y-4">
      <NeonEdge accentRgb="0,169,224" intensity="subtle">
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">Shop operations</p>
              <h3 className="sh-display text-xl text-shText mt-0.5">Printify Orders</h3>
              <p className="text-[11px] text-shTextMuted mt-1">Print-on-demand items sold at the register or online — production/shipment status, and any order that needs a retry.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={registerWebhooks} disabled={registering} data-testid="sm-printify-register-webhooks"
                      className="rounded-xl border border-shBorder/70 bg-white/[0.025] px-3 py-2 text-[11px] font-black text-shTextMuted hover:text-shSecondary hover:border-shSecondary/30 transition disabled:opacity-50">
                <i className="fas fa-tower-broadcast mr-1.5" />{registering ? "Registering…" : "Register Webhooks"}
              </button>
              <button onClick={load} className="rounded-xl border border-shBorder/70 bg-white/[0.025] px-3 py-2 text-[11px] font-black text-shTextMuted hover:text-shSecondary hover:border-shSecondary/30 transition">
                <i className="fas fa-rotate-right mr-1.5" />Refresh
              </button>
            </div>
          </div>
          {!printifyEnabled && (
            <div className="rounded-lg border border-shAccent/25 bg-shAccent/[0.06] px-3 py-2 text-[11px] text-shAccent mb-3" data-testid="sm-printify-not-configured">
              <i className="fas fa-triangle-exclamation mr-1.5" />Printify isn't connected yet — set PRINTIFY_API_KEY/PRINTIFY_SHOP_ID (and the PRINTIFY_PICKUP_* address, for in-store pickup orders) in the backend environment. Queued orders will hold until then.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {PRINTIFY_STATUS_FILTERS.map(([k, label]) => (
              <button key={k || "all"} onClick={() => setFilter(k)} data-testid={`sm-printify-filter-${k || "all"}`}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-[0.1em] transition ${filter === k ? "bg-shPrimary text-[#071018] shadow-[0_0_18px_rgba(140,198,63,0.10)]" : "bg-white/[0.025] border border-shBorder/60 text-shTextMuted hover:text-shText"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </NeonEdge>

      {loading ? (
        <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-shTextMuted text-sm py-6 text-center">No Printify orders match this filter.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const busy = busyId === row.id;
            const badge = printifyRowBadge(row);
            const tracking = row.tracking || {};
            return (
              <NeonEdge key={row.id} accentRgb={row.status === "stuck" ? "242,101,34" : "0,169,224"} intensity={row.status === "stuck" ? "standard" : "subtle"} data-testid={`sm-printify-row-${row.id}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="min-w-0">
                      <p className="text-shText font-bold text-sm">
                        {row.source === "shop_order" ? "Online Order" : "Sale"} #{(row.source_id || "").slice(0, 8).toUpperCase()} · {row.fulfillment_method === "ship" ? "Ship" : "Pickup"}
                      </p>
                      <p className="text-shTextMuted text-[12px]">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                      </p>
                      <p className="text-[11px] text-shTextMuted mt-1">
                        {(row.line_items || []).map((li) => `${li.quantity}× ${li.name}`).join(", ")}
                      </p>
                      {row.status === "stuck" && row.last_error && (
                        <div className="mt-2 rounded-lg border border-shAccent/25 bg-shAccent/[0.06] px-3 py-2 text-[11px] text-shAccent" data-testid={`sm-printify-error-${row.id}`}>
                          <i className="fas fa-triangle-exclamation mr-1.5" />{row.last_error}
                        </div>
                      )}
                      {tracking.number && (
                        <p className="text-[11px] text-shTextMuted mt-1" data-testid={`sm-printify-tracking-${row.id}`}>
                          <i className="fas fa-truck-fast mr-1.5" />
                          {tracking.url ? (
                            <a href={tracking.url} target="_blank" rel="noreferrer" className="text-shSecondary hover:underline">{tracking.code ? `${tracking.code.toUpperCase()} ` : ""}{tracking.number}</a>
                          ) : (
                            <>{tracking.code ? `${tracking.code.toUpperCase()} ` : ""}{tracking.number}</>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-[11px] font-black uppercase tracking-widest ${badge.className}`}>{badge.label}</p>
                      {row.status === "stuck" && (
                        <button onClick={() => retry(row.id)} disabled={busy} data-testid={`sm-printify-retry-${row.id}`}
                                className="mt-2 bg-shAccent text-[#080b12] px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-[0.1em] hover:brightness-110 transition disabled:opacity-50 shadow-[0_0_18px_rgba(242,101,34,0.10)]">
                          {busy ? "Retrying…" : "Retry"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </NeonEdge>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * SHOP SETTINGS TAB — global shop appearance/organization settings + the
 * public no-account storefront toggles, all living on the same shop_page
 * sub-object of the one settings singleton (GET/PUT /settings). Reuses
 * ShopImageUpload for the banner/section cover images, same delete-old-
 * image-after-save sequencing as every other editor in this file.
 * ========================================================================== */
// online_school included — the client shop always supported a configured
// cover image/label for it (sectionMetaFor), but this editor predated the
// section, leaving no admin surface to upload one.
const SHOP_SETTINGS_SECTION_KEYS = ["merch", "prepaid_visits", "training", "online_school"];

const BLANK_DISCOUNT_CODE_FORM = {
  code: "", kind: "percent", value: "10", clients_only: true,
  max_uses_total: "", max_uses_per_client: "", expires_at: "",
};

function DiscountCodesTab() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK_DISCOUNT_CODE_FORM);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/admin/shop-discount-codes")
      .then(({ data }) => setCodes(data.codes || []))
      .catch(() => toast.error("Could not load discount codes"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const createCode = async () => {
    if (!form.code.trim()) { toast.error("Enter a code"); return; }
    if (!(Number(form.value) > 0)) { toast.error("Enter a value greater than 0"); return; }
    setSaving(true);
    try {
      await api.post("/admin/shop-discount-codes", {
        code: form.code.trim(), kind: form.kind, value: Number(form.value),
        clients_only: form.clients_only,
        max_uses_total: form.max_uses_total !== "" ? Number(form.max_uses_total) : null,
        max_uses_per_client: form.max_uses_per_client !== "" ? Number(form.max_uses_per_client) : null,
        expires_at: form.expires_at || null,
      });
      toast.success("Discount code created");
      setForm(BLANK_DISCOUNT_CODE_FORM);
      load();
    } catch (e) {
      toast.error(formatErr(e?.response?.data?.detail) || "Could not create the code");
    }
    setSaving(false);
  };

  const toggleActive = async (c) => {
    try {
      await api.put(`/admin/shop-discount-codes/${c.id}`, { active: !c.active });
      load();
    } catch (e) {
      toast.error(formatErr(e?.response?.data?.detail) || "Could not update the code");
    }
  };

  return (
    <div className="space-y-5 max-w-3xl" data-testid="sm-discount-codes">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">New Code</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Code</label>
            <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                   placeholder="e.g. WELCOME10" data-testid="sm-discount-code-input"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Type</label>
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                      className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                <option value="percent">% off</option>
                <option value="fixed">$ off</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Value</label>
              <input type="number" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                     data-testid="sm-discount-value-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Max total uses (optional)</label>
            <input type="number" value={form.max_uses_total} onChange={(e) => setForm((f) => ({ ...f, max_uses_total: e.target.value }))}
                   placeholder="Unlimited" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Max uses per client (optional)</label>
            <input type="number" value={form.max_uses_per_client} onChange={(e) => setForm((f) => ({ ...f, max_uses_per_client: e.target.value }))}
                   placeholder="Unlimited" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Expires (optional)</label>
            <input type="date" value={form.expires_at ? form.expires_at.slice(0, 10) : ""}
                   onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value ? `${e.target.value}T23:59:59Z` : "" }))}
                   style={{ colorScheme: "dark" }}
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" id="discount-clients-only" checked={form.clients_only}
                   onChange={(e) => setForm((f) => ({ ...f, clients_only: e.target.checked }))} />
            <label htmlFor="discount-clients-only" className="text-shText text-sm">Existing clients only</label>
          </div>
        </div>
        <button onClick={createCode} disabled={saving} data-testid="sm-discount-create"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
          {saving ? "Creating…" : "Create Code"}
        </button>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-3">Codes</p>
        {loading ? (
          <div className="text-center text-shTextMuted py-6 text-sm">Loading…</div>
        ) : codes.length === 0 ? (
          <div className="text-center text-shTextMuted py-6 text-sm">No discount codes yet.</div>
        ) : (
          <div className="space-y-2">
            {codes.map((c) => (
              <div key={c.id} data-testid={`sm-discount-row-${c.code}`}
                   className="flex items-center justify-between bg-[var(--sh-card-base)] border border-shBorder/60 rounded-lg px-3 py-2.5">
                <div>
                  <span className="text-shText font-black text-sm">{c.code}</span>
                  <span className="text-shTextMuted text-[12px] ml-2">
                    {c.kind === "percent" ? `${c.value}% off` : `$${c.value.toFixed(2)} off`}
                    {c.clients_only && " · clients only"}
                    {c.max_uses_total != null && ` · ${c.uses_total}/${c.max_uses_total} used`}
                    {c.max_uses_total == null && c.uses_total > 0 && ` · ${c.uses_total} used`}
                    {c.max_uses_per_client != null && ` · max ${c.max_uses_per_client}/client`}
                    {c.expires_at && ` · expires ${String(c.expires_at).slice(0, 10)}`}
                  </span>
                </div>
                <button onClick={() => toggleActive(c)} data-testid={`sm-discount-toggle-${c.code}`}
                        className={`px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest ${c.active ? "bg-shPrimary/20 text-shPrimary" : "bg-[var(--sh-card-base)] text-shTextMuted border border-shBorder"}`}>
                  {c.active ? "Active" : "Off"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const REVIEW_STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
];

function ReviewStars({ rating }) {
  return (
    <span className="inline-flex gap-0.5 text-shAccent" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={`${n <= rating ? "fas" : "far"} fa-star text-[12px]`} />
      ))}
    </span>
  );
}

function ReviewsTab() {
  const [status, setStatus] = useState("pending");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get("/admin/shop-reviews", { params: { status } })
      .then(({ data }) => setReviews(data.reviews || []))
      .catch(() => toast.error("Could not load reviews"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const moderate = async (r, next) => {
    try {
      await api.put(`/admin/shop-reviews/${r.id}`, { status: next });
      toast.success(next === "published" ? "Review published" : "Review rejected");
      load();
    } catch (e) {
      toast.error(formatErr(e?.response?.data?.detail) || "Could not update the review");
    }
  };

  return (
    <div className="space-y-4 max-w-3xl" data-testid="sm-reviews">
      <div className="flex gap-2">
        {REVIEW_STATUS_FILTERS.map((f) => (
          <button key={f.value} onClick={() => setStatus(f.value)} data-testid={`sm-reviews-filter-${f.value}`}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${status === f.value
                    ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted border border-shBorder"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4">
        {loading ? (
          <div className="text-center text-shTextMuted py-6 text-sm">Loading…</div>
        ) : reviews.length === 0 ? (
          <div className="text-center text-shTextMuted py-6 text-sm" data-testid="sm-reviews-empty">No {status} reviews.</div>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} data-testid={`sm-review-row-${r.id}`} className="border border-shBorder/60 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-shText font-black text-sm">{r.product_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <ReviewStars rating={r.rating} />
                      <span className="text-shTextMuted text-[12px]">{r.client_name}</span>
                    </div>
                    {r.text && <p className="text-shText text-[13px] mt-2">{r.text}</p>}
                  </div>
                  {status === "pending" && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => moderate(r, "published")} data-testid={`sm-review-approve-${r.id}`}
                              className="px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest bg-shPrimary text-bgHeader">
                        Approve
                      </button>
                      <button onClick={() => moderate(r, "rejected")} data-testid={`sm-review-reject-${r.id}`}
                              className="px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest border border-shBorder text-shTextMuted">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ShopSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [sp, setSp] = useState(null); // shop_page draft
  const [originalBannerImageId, setOriginalBannerImageId] = useState(null);
  const [originalSectionImageIds, setOriginalSectionImageIds] = useState({});
  const [originalDepartmentImageIds, setOriginalDepartmentImageIds] = useState({});

  const load = () => {
    setLoading(true);
    api.get("/settings")
      .then(({ data }) => {
        const shopPage = data.shop_page || {};
        setSp(shopPage);
        setOriginalBannerImageId(shopPage.banner_image_id || null);
        const orig = {};
        for (const key of SHOP_SETTINGS_SECTION_KEYS) orig[key] = (shopPage.sections || {})[key]?.image_id || null;
        setOriginalSectionImageIds(orig);
        const origDept = {};
        for (const d of DEPARTMENTS) origDept[d.key] = (shopPage.department_images || {})[d.key] || null;
        setOriginalDepartmentImageIds(origDept);
      })
      .catch(() => toast.error("Could not load shop settings"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const setField = (patch) => setSp((s) => ({ ...s, ...patch }));
  const setSection = (key, patch) => setSp((s) => ({ ...s, sections: { ...(s.sections || {}), [key]: { ...((s.sections || {})[key] || {}), ...patch } } }));
  // The 5 built-in departments (Gear, Training, Online School, Prepaid
  // Visits, Gift Cards) have no category record of their own to hold an
  // image on — unlike a self-service department, they only ever showed
  // whatever photo their first item happened to have, with no admin
  // control over it (owner: "cant set an image for the gift card or gear
  // categories"). This is that control.
  const setDepartmentImage = (key, imageId) => setSp((s) => ({ ...s, department_images: { ...(s.department_images || {}), [key]: imageId } }));

  // Same up/down-arrow reorder Categories already uses, instead of the raw
  // "Order" number field this used to be — a plain integer input meant an
  // admin had to type "3" into a box and guess what that put next to what.
  // Reassigns every key a fresh 0..n sequence from its CURRENT sorted
  // position rather than swapping the two raw stored numbers directly, so
  // it still works correctly even when sections start out tied at the same
  // order value (e.g. all default to 0 before anyone has ever reordered).
  const orderedSectionKeys = [...SHOP_SETTINGS_SECTION_KEYS]
    .sort((a, b) => (sp?.sections?.[a]?.order ?? 0) - (sp?.sections?.[b]?.order ?? 0));
  const moveSection = (key, direction) => {
    const keys = [...orderedSectionKeys];
    const idx = keys.indexOf(key);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= keys.length) return;
    [keys[idx], keys[swapIdx]] = [keys[swapIdx], keys[idx]];
    setSp((s) => {
      const nextSections = { ...(s.sections || {}) };
      keys.forEach((k, i) => { nextSections[k] = { ...(nextSections[k] || {}), order: i }; });
      return { ...s, sections: nextSections };
    });
  };

  const save = async () => {
    setErr("");
    if (sp.banner_cta_url && !(/^\/(?!\/)/.test(sp.banner_cta_url) || /^https:\/\//.test(sp.banner_cta_url))) {
      setErr("Banner link must be an internal path (starting with /) or an https:// URL.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/settings", { shop_page: sp });
      // Save succeeded — now safe to drop any replaced/removed images.
      if (originalBannerImageId && originalBannerImageId !== sp.banner_image_id) {
        api.delete(`/shop/media/${originalBannerImageId}`).catch(() => {});
      }
      for (const key of SHOP_SETTINGS_SECTION_KEYS) {
        const origId = originalSectionImageIds[key];
        const nextId = sp.sections?.[key]?.image_id || null;
        if (origId && origId !== nextId) api.delete(`/shop/media/${origId}`).catch(() => {});
      }
      for (const d of DEPARTMENTS) {
        const origId = originalDepartmentImageIds[d.key];
        const nextId = sp.department_images?.[d.key] || null;
        if (origId && origId !== nextId) api.delete(`/shop/media/${origId}`).catch(() => {});
      }
      toast.success("Shop settings saved");
      load();
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Could not save shop settings");
    }
    setSaving(false);
  };

  if (loading || !sp) return <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>;

  return (
    <div className="space-y-5 max-w-3xl" data-testid="sm-shop-settings">
      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="sm-shop-settings-error">{err}</div>}

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Global</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Shop Title</label>
            <input value={sp.title || ""} onChange={(e) => setField({ title: e.target.value })} data-testid="sm-shop-title"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Subtitle</label>
            <input value={sp.subtitle || ""} onChange={(e) => setField({ subtitle: e.target.value })} data-testid="sm-shop-subtitle"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
        </div>
        <div>
          <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Default Landing View</label>
          <select value={sp.landing_mode || "section_cards"} onChange={(e) => setField({ landing_mode: e.target.value })} data-testid="sm-shop-landing-mode"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="section_cards">Section Cards (default)</option>
            <option value="featured_items">Featured Items</option>
            <option value="all_items">All Items</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.show_search !== false} onChange={(e) => setField({ show_search: e.target.checked })} data-testid="sm-shop-show-search" />
            <span className="text-shText text-sm">Show Search</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.show_item_counts !== false} onChange={(e) => setField({ show_item_counts: e.target.checked })} data-testid="sm-shop-show-counts" />
            <span className="text-shText text-sm">Show Category Item Counts</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.show_out_of_stock !== false} onChange={(e) => setField({ show_out_of_stock: e.target.checked })} data-testid="sm-shop-show-oos" />
            <span className="text-shText text-sm">Show Out-of-Stock Products</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.hide_empty_categories !== false} onChange={(e) => setField({ hide_empty_categories: e.target.checked })} data-testid="sm-shop-hide-empty" />
            <span className="text-shText text-sm">Hide Empty Categories (default)</span>
          </label>
        </div>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Banner</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner Heading</label>
            <input value={sp.banner_heading || ""} onChange={(e) => setField({ banner_heading: e.target.value })} data-testid="sm-banner-heading"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner Image</label>
            <ShopImageUpload imageId={sp.banner_image_id} originalImageId={originalBannerImageId}
                             onChange={(id) => setField({ banner_image_id: id })} />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner CTA Text (optional)</label>
            <input value={sp.banner_cta_text || ""} onChange={(e) => setField({ banner_cta_text: e.target.value })} data-testid="sm-banner-cta-text"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner Link (internal path or https:// URL)</label>
            <input value={sp.banner_cta_url || ""} onChange={(e) => setField({ banner_cta_url: e.target.value })} placeholder="/shop or https://…" data-testid="sm-banner-cta-url"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
        </div>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-4">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Sections</p>
        {orderedSectionKeys.map((key, idx) => {
          const row = sp.sections?.[key] || {};
          return (
            <div key={key} className="border-t border-shBorder pt-3 first:border-t-0 first:pt-0 space-y-2" data-testid={`sm-section-row-${key}`}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-shTextMuted uppercase tracking-widest">Permanent key: <span className="text-shText font-bold">{key}</span></p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveSection(key, -1)} disabled={idx === 0} data-testid={`sm-section-up-${key}`}
                          className="w-7 h-7 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-up text-[11px]" /></button>
                  <button type="button" onClick={() => moveSection(key, 1)} disabled={idx === orderedSectionKeys.length - 1} data-testid={`sm-section-down-${key}`}
                          className="w-7 h-7 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-down text-[11px]" /></button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Customer-Facing Name</label>
                  <input value={row.label || ""} onChange={(e) => setSection(key, { label: e.target.value })} data-testid={`sm-section-label-${key}`}
                         className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Short Description</label>
                  <input value={row.description || ""} onChange={(e) => setSection(key, { description: e.target.value })} data-testid={`sm-section-description-${key}`}
                         className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Cover Image</label>
                  <ShopImageUpload imageId={row.image_id} originalImageId={originalSectionImageIds[key]}
                                   onChange={(id) => setSection(key, { image_id: id })} />
                </div>
                <label className="flex items-center gap-2 self-end pb-2">
                  <input type="checkbox" checked={row.visible !== false} onChange={(e) => setSection(key, { visible: e.target.checked })} data-testid={`sm-section-visible-${key}`} />
                  <span className="text-shText text-sm">Visible</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* The 5 built-in department tiles under the Shop's hero (Gear,
          Training, Online School, Prepaid Visits, Gift Cards) — a
          self-service department already gets its image from its own
          category above; these never had anywhere to set one at all,
          always just showing whatever photo their first item had. */}
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-4">
        <div>
          <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Department Tile Images</p>
          <p className="text-[11px] text-shTextMuted mt-1">Optional. Left blank, a department's tile shows a photo from one of its own items instead.</p>
        </div>
        {DEPARTMENTS.map((d) => (
          <div key={d.key} className="border-t border-shBorder pt-3 first:border-t-0 first:pt-0 flex items-center gap-3" data-testid={`sm-department-image-row-${d.key}`}>
            <span className="flex-1 text-shText text-sm font-bold">{d.label}</span>
            <ShopImageUpload imageId={sp.department_images?.[d.key] || null} originalImageId={originalDepartmentImageIds[d.key]}
                             onChange={(id) => setDepartmentImage(d.key, id)} />
          </div>
        ))}
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Public Storefront (signed-out visitors)</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!sp.public_shop_enabled} onChange={(e) => setField({ public_shop_enabled: e.target.checked })} data-testid="sm-public-shop-enabled" />
          <span className="text-shText text-sm">Enable Public Shop (/shop, no account required)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!sp.public_browsing_enabled} onChange={(e) => setField({ public_browsing_enabled: e.target.checked })} data-testid="sm-public-browsing-enabled" />
          <span className="text-shText text-sm">Allow Public Browsing</span>
        </label>
        {sp.public_shop_enabled && sp.public_browsing_enabled && (
          <>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_prices !== false} onChange={(e) => setField({ show_public_prices: e.target.checked })} data-testid="sm-show-public-prices" />
                <span className="text-shText text-sm">Show Prices to Guests</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_merch !== false} onChange={(e) => setField({ show_public_merch: e.target.checked })} data-testid="sm-show-public-merch" />
                <span className="text-shText text-sm">Merch & Gear Publicly Browsable</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_prepaid !== false} onChange={(e) => setField({ show_public_prepaid: e.target.checked })} data-testid="sm-show-public-prepaid" />
                <span className="text-shText text-sm">Prepaid Visits Publicly Browsable</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_training !== false} onChange={(e) => setField({ show_public_training: e.target.checked })} data-testid="sm-show-public-training" />
                <span className="text-shText text-sm">Training Publicly Browsable</span>
              </label>
            </div>
            <label className="flex items-center gap-2 opacity-60" title="Credit packs and training programs always require an account regardless of this setting.">
              <input type="checkbox" checked disabled />
              <span className="text-shText text-sm">Require Account for Credit Packs &amp; Training (always on)</span>
            </label>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">"Existing Client Pricing" Message</label>
              <input value={sp.existing_client_pricing_message || ""} onChange={(e) => setField({ existing_client_pricing_message: e.target.value })} data-testid="sm-existing-client-pricing-message"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Guest Sign-In Prompt Message</label>
              <input value={sp.guest_sign_in_message || ""} onChange={(e) => setField({ guest_sign_in_message: e.target.value })} data-testid="sm-guest-sign-in-message"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} data-testid="sm-save-shop-settings"
                className="bg-shPrimary text-bgBase px-6 py-2.5 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-40">
          {saving ? "Saving…" : "Save Shop Settings"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
 * MAIN SHELL
 * ========================================================================== */
export default function ShopManager({ openCreateOnMount = false, onCreateConsumed = () => {} }) {
  const confirm = useConfirm();
  const [tab, setTab] = useState("items"); // items | categories | preview
  const [pickerOpen, setPickerOpen] = useState(false);

  // Product editor state (shared shape with ManageProductsPanel)
  const [productForm, setProductForm] = useState(null);
  const [productEditingId, setProductEditingId] = useState(null);
  const [productOriginalImageId, setProductOriginalImageId] = useState(null);
  // Gallery equivalent of the above. This screen still spoke the
  // single-photo language after ProductEditor moved to a gallery, so a
  // product edited here showed no photos and saved none back.
  const [productOriginalImageIds, setProductOriginalImageIds] = useState([]);
  const [productSaving, setProductSaving] = useState(false);

  // Pack editor state (shared shape with CreditPacksSettings)
  const [packForm, setPackForm] = useState(null);
  const [packEditing, setPackEditing] = useState(null);
  const [packOriginalImageId, setPackOriginalImageId] = useState(null);
  const [packErr, setPackErr] = useState("");
  const [emailTemplates, setEmailTemplates] = useState([]);

  // Program editor state (shared shape with Programs.jsx)
  const [programForm, setProgramForm] = useState(null);
  const [programErr, setProgramErr] = useState("");   // audit #53: why a save was refused
  const [programOriginalImageId, setProgramOriginalImageId] = useState(null);
  const [programMeta, setProgramMeta] = useState(null);
  const [allPrograms, setAllPrograms] = useState([]);

  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  // Everything an admin can relate an item TO, in the SHOP's vocabulary.
  // The Shop Manager calls a product a "physical_product"; the catalog, the
  // cart and a relationship reference all call it a "product". Translating
  // here, once, is what stops a reference being saved in the admin spelling
  // and then never resolving anywhere a customer can see.
  //
  // Loaded HERE rather than in ItemsTab because this is the component that
  // renders the editors — the first version of this read a list that lives
  // in a sibling component, which builds cleanly and throws a ReferenceError
  // the moment an editor opens.
  const [relatableItems, setRelatableItems] = useState([]);
  useEffect(() => {
    api.get("/shop-manager/items")
      .then(({ data }) => setRelatableItems(
        (data.items || [])
          .filter((it) => it.active !== false && !it.archived)
          .map((it) => ({
            kind: it.kind === "physical_product" ? "product" : it.kind,
            id: it.id, name: it.name, sku: it.sku,
          }))
          .filter((it) => ["product", "credit_pack", "training_program"].includes(it.kind)),
      ))
      .catch(() => setRelatableItems([]));
  }, [refreshKey]);

  useEffect(() => {
    api.get("/admin/email-templates").then((r) => setEmailTemplates((r.data || []).filter((t) => t.audience === "client"))).catch(() => setEmailTemplates([]));
    api.get("/programs/meta").then((r) => setProgramMeta(r.data)).catch(() => {});
    api.get("/programs", { params: { include_inactive: true } }).then((r) => setAllPrograms(r.data || [])).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    // Deliberately depends on openCreateOnMount (not mount-only []) — the
    // "+ New → Add Shop Item" launcher can fire while ShopManager is
    // ALREADY mounted (the admin is already on this screen), in which case
    // a mount-only effect would never re-open the picker on a repeat click.
    if (openCreateOnMount) {
      setTab("items");
      setPickerOpen(true);
      onCreateConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateOnMount]);

  const closeAllEditors = () => {
    setProductForm(null);
    setPackForm(null);
    setProgramForm(null);
  };

  const pickType = (key) => {
    setPickerOpen(false);
    if (key === "physical_product" || key === "shopify_external" || key === "printify") {
      setProductEditingId(null);
      setProductOriginalImageId(null);
      setProductOriginalImageIds([]);
      setProductForm({ ...BLANK_PRODUCT_FORM, image_ids: [], sales_destination: key === "shopify_external" || key === "printify" ? key : "internal" });
    } else if (key === "credit_pack") {
      setPackEditing(null);
      setPackOriginalImageId(null);
      setPackErr("");
      setPackForm({ ...BLANK_PACK_FORM });
    } else if (key === "training_program") {
      setProgramOriginalImageId(null);
      setProgramErr("");
      setProgramForm(blankProgramForm());
    }
  };

  const editItem = async (item) => {
    if (item.kind === "physical_product") {
      const { data } = await api.get("/pos/products", { params: item.archived ? { include_archived: true } : { include_inactive: true } });
      const raw = (data || []).find((p) => p.id === item.id);
      if (!raw) { toast.error("Could not load product"); return; }
      setProductEditingId(raw.id);
      setProductOriginalImageId(raw.image_id || null);
      setProductOriginalImageIds(galleryIds(raw));
      setProductForm({
        name: raw.name || "", sku: raw.sku || "", category: raw.category || "", description: raw.description || "",
        price: String(raw.price ?? ""), cost: raw.cost != null ? String(raw.cost) : "",
        starting_stock: String(raw.stock_on_hand ?? 0),
        variants: Array.isArray(raw.variants) ? raw.variants.map((v) => ({ ...v })) : [],
        low_stock_threshold: raw.low_stock_threshold != null ? String(raw.low_stock_threshold) : "",
        track_inventory: !!raw.track_inventory, active: raw.active !== false,
        show_online: !!raw.show_online, online_description: raw.online_description || "",
        image_id: raw.image_id || null,
        image_ids: galleryIds(raw),
        online_sort_order: raw.online_sort_order != null ? String(raw.online_sort_order) : "",
        category_id: raw.category_id || null, subcategory_id: raw.subcategory_id || null,
        featured: !!raw.featured, show_at_register: raw.show_at_register !== false,
        sales_destination: (raw.sales_destination === "shopify_external" || raw.sales_destination === "printify")
          ? raw.sales_destination : "internal",
        shopify_product_url: raw.shopify_product_url || "",
        shopify_display_price: raw.shopify_display_price != null ? String(raw.shopify_display_price) : "",
        shopify_from_price: !!raw.shopify_from_price,
        printify_product_id: raw.printify_product_id || "",
        printify_blueprint_id: raw.printify_blueprint_id ?? null,
        printify_print_provider_id: raw.printify_print_provider_id ?? null,
        printify_print_areas: raw.printify_print_areas ?? null,
        publicly_visible: !!raw.publicly_visible, guest_cart_allowed: !!raw.guest_cart_allowed,
        show_public_price: raw.show_public_price !== false,
        requires_approval: !!raw.requires_approval, requires_completed_onboarding: !!raw.requires_completed_onboarding,
        // Absent means taxable — the same default the pricing engine uses.
        taxable: raw.taxable !== false, tax_exempt_reason: raw.tax_exempt_reason || "",
        shippable: !!raw.shippable,
        shipping_weight_lbs: raw.shipping_weight_lbs != null ? String(raw.shipping_weight_lbs) : "",
      });
    } else if (item.kind === "credit_pack") {
      const { data } = await api.get("/credit-packs", { params: { include_inactive: true } });
      const raw = (data || []).find((p) => p.id === item.id);
      if (!raw) { toast.error("Could not load pack"); return; }
      setPackEditing(raw);
      setPackOriginalImageId(raw.image_id || null);
      setPackErr("");
      setPackForm({ ...BLANK_PACK_FORM, ...raw });
    } else {
      // The bounded /programs list must never decide editability — load the
      // exact program by id (fetchProgramById falls back to nothing, so a
      // wrong program can never be silently selected).
      const raw = await fetchProgramById(item.id);
      if (!raw) { toast.error("Could not load program"); return; }
      setProgramOriginalImageId(raw.image_id || null);
      setProgramErr("");
      setProgramForm({ ...raw });
    }
  };

  const saveProduct = async () => {
    if (!productForm.name.trim()) { toast.error("Product name is required"); return; }
    const isShopify = productForm.sales_destination === "shopify_external";
    const isPrintify = productForm.sales_destination === "printify";
    if (!isShopify && !(Number(productForm.price) >= 0)) { toast.error("Selling price is required"); return; }
    if (isShopify && !productForm.shopify_product_url.trim()) { toast.error("A Shopify product URL is required"); return; }
    if (isPrintify && !productForm.printify_product_id.trim()) { toast.error("A Printify product ID is required"); return; }
    if (isPrintify && productForm.variants.length === 0) { toast.error("A Printify listing needs at least one size"); return; }
    if (isPrintify && productForm.variants.some((v) => !(v.printify_variant_id || "").trim())) {
      toast.error("Every size needs its Printify variant ID"); return;
    }
    if (productForm.variants.some((v) => !v.name.trim())) { toast.error("Every option needs a name."); return; }
    if (productForm.shippable && !(Number(productForm.shipping_weight_lbs) > 0)) {
      toast.error("Enter a shipping weight for this product"); return;
    }
    const body = {
      name: productForm.name.trim(), sku: isShopify ? null : (productForm.sku.trim() || null),
      category: isShopify ? "" : productForm.category.trim(), description: productForm.description.trim() || null,
      price: isShopify ? 0 : Number(productForm.price), cost: (!isShopify && productForm.cost !== "") ? Number(productForm.cost) : null,
      low_stock_threshold: (!isShopify && productForm.low_stock_threshold !== "") ? Number(productForm.low_stock_threshold) : null,
      track_inventory: !isShopify && productForm.track_inventory, active: productForm.active,
      variants: isShopify ? [] : variantsPayload(productForm.variants),
      show_online: productForm.show_online, online_description: productForm.online_description.trim() || null,
      image_id: productForm.image_id || null,
      image_ids: productForm.image_ids || [],
      online_sort_order: productForm.online_sort_order !== "" ? parseInt(productForm.online_sort_order, 10) : null,
      category_id: productForm.category_id || null, subcategory_id: productForm.subcategory_id || null,
      featured: productForm.featured, show_at_register: productForm.show_at_register,
      sales_destination: productForm.sales_destination,
      shopify_product_url: isShopify ? productForm.shopify_product_url.trim() : null,
      shopify_display_price: (isShopify && productForm.shopify_display_price !== "") ? Number(productForm.shopify_display_price) : null,
      shopify_from_price: isShopify && productForm.shopify_from_price,
      printify_product_id: isPrintify ? productForm.printify_product_id.trim() : null,
      printify_blueprint_id: isPrintify ? productForm.printify_blueprint_id : null,
      printify_print_provider_id: isPrintify ? productForm.printify_print_provider_id : null,
      printify_print_areas: isPrintify ? productForm.printify_print_areas : null,
      // See ManageProductsPanel: a Shopify listing is allowed to be public.
      publicly_visible: !!productForm.publicly_visible,
      guest_cart_allowed: !isShopify && productForm.publicly_visible && productForm.guest_cart_allowed,
      show_public_price: productForm.show_public_price,
      requires_approval: !isShopify && productForm.publicly_visible && productForm.requires_approval,
      requires_completed_onboarding: !isShopify && productForm.publicly_visible && productForm.requires_completed_onboarding,
      taxable: productForm.taxable,
      tax_exempt_reason: productForm.taxable ? null : (productForm.tax_exempt_reason || "").trim() || null,
      shippable: !isShopify && !isPrintify && productForm.shippable,
      shipping_weight_lbs: (!isShopify && !isPrintify && productForm.shippable) ? Number(productForm.shipping_weight_lbs) : null,
    };
    setProductSaving(true);
    try {
      if (productEditingId) {
        await api.put(`/pos/products/${productEditingId}`, body);
        toast.success("Product updated");
      } else {
        await api.post("/pos/products", { ...body, starting_stock: isShopify ? 0 : Number(productForm.starting_stock || 0) });
        toast.success("Product added");
      }
      // Safe only now the save succeeded: anything the product used to have
      // and no longer does. Mirrors ManageProductsPanel.
      for (const id of productOriginalImageIds) {
        if (!(productForm.image_ids || []).includes(id)) {
          api.delete(`/shop/media/${id}`).catch(() => {});
        }
      }
      setProductForm(null);
      bumpRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save product");
    }
    setProductSaving(false);
  };
  const closeProductWithoutSaving = () => {
    // Every image added this session, not just the primary one -- with a
    // gallery, abandoning the form could otherwise strand seven uploads.
    for (const id of productForm?.image_ids || []) {
      if (id && !productOriginalImageIds.includes(id)) {
        api.delete(`/shop/media/${id}`).catch(() => {});
      }
    }
    setProductForm(null);
  };

  const savePack = async () => {
    setPackErr("");
    if (!packForm.name?.trim()) { setPackErr("Pack name is required."); return; }
    if (!Number.isFinite(packForm.qty) || packForm.qty < 1) { setPackErr("Credits per pack must be at least 1."); return; }
    if (!Number.isFinite(packForm.price) || packForm.price < 0) { setPackErr("Price must be 0 or higher."); return; }
    try {
      if (packEditing) await api.put(`/credit-packs/${packEditing.id}`, packForm);
      else await api.post("/credit-packs", packForm);
      if (packOriginalImageId && packOriginalImageId !== packForm.image_id) {
        api.delete(`/shop/media/${packOriginalImageId}`).catch(() => {});
      }
      toast.success(packEditing ? "Pack updated" : "Pack added");
      setPackForm(null);
      bumpRefresh();
    } catch (e) {
      setPackErr(formatErr(e.response?.data?.detail) || "Save failed");
    }
  };
  const closePackWithoutSaving = () => {
    if (packForm?.image_id && packForm.image_id !== packOriginalImageId) {
      api.delete(`/shop/media/${packForm.image_id}`).catch(() => {});
    }
    setPackForm(null);
  };

  const saveProgram = async () => {
    setProgramErr("");
    try {
      const payload = { ...programForm };
      if (programForm.id) {
        // Editing an existing program: ask whether to push changes to dogs
        // already enrolled — mirrors Programs.jsx's own save() exactly, so
        // Shop Manager never silently defaults to (or skips) a cascade.
        let cascade = false;
        try {
          const { data } = await api.get(`/programs/${programForm.id}/active-enrollments-count`);
          if ((data?.count || 0) > 0) {
            // Audit #52: say who a removed lesson would move, before asking.
            const moves = await previewLessonMoves(api, programForm.id, payload.modules);
            cascade = await confirm({
              title: `Apply changes to ${data.count} enrolled dog${data.count > 1 ? "s" : ""}?`,
              body: "Yes: every active enrollment updates to the new program. Trainer scores and notes for goals that still exist are preserved; progress on any removed goals is dropped.\n\nNo: only future enrollments use the new version. Currently-enrolled dogs keep their existing program snapshot." + lessonMovePreviewNote(moves),
              confirmText: "Yes, update enrolled dogs",
              cancelText: "No, only future enrollments",
              tone: "warning",
            });
          }
        } catch { /* count endpoint failure isn't fatal — just skip cascade */ }
        const url = `/programs/${programForm.id}${cascade ? "?cascade=true" : ""}`;
        const { data: saved } = await api.put(url, payload);
        const moved = saved?._lesson_moves || [];
        if (moved.length) {
          toast(lessonMovesHeadline(moved), {
            description: <ul data-testid="sm-lesson-moves">{lessonMoveLines(moved).map((line, i) => <li key={i}>{line}</li>)}</ul>,
            duration: 20000,
          });
        }
        // Audit #53: problems the course already had don't stop the save — say they're still there.
        const old = saved?._live_problems || [];
        if (old.length) {
          toast(liveProblemsHeadline(old), {
            description: <div data-testid="sm-live-problems"><p>{LIVE_PROBLEMS_NOTE}</p><ul>{old.map((line, i) => <li key={i}>• {line}</li>)}</ul></div>,
            duration: 20000,
          });
        }
      } else {
        await api.post("/programs", payload);
      }
      if (programOriginalImageId && programOriginalImageId !== payload.image_id) {
        api.delete(`/shop/media/${programOriginalImageId}`).catch(() => {});
      }
      toast.success(programForm.id ? "Program updated" : "Program added");
      setProgramForm(null);
      bumpRefresh();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Save failed");
      // Audit #53: what the save would have put live, listed in the editor (it stays open).
      const refusal = structureRefusal(e);
      if (refusal) setProgramErr([refusal.message, ...refusal.errors.map(p => `• ${saveProblemLine(p)}`)].join("\n"));
    }
  };
  const closeProgramWithoutSaving = () => {
    if (programForm?.image_id && programForm.image_id !== programOriginalImageId) {
      api.delete(`/shop/media/${programForm.image_id}`).catch(() => {});
    }
    setProgramErr("");
    setProgramForm(null);
  };

  return (
    <div className="space-y-5 sh-shop-manager-workspace">
      <PageHero
        eyebrow={{ icon: "fa-bag-shopping", text: "Shop Manager", color: "text-shPrimary" }}
        title="Shop Manager"
        highlight="one place for everything you sell."
        subtitle="Create, edit, organize, price, and display physical products, Shopify merchandise, prepaid visit packs, and training programs — all from one screen."
      />

      <AdminTabs
        testid="shop-manager-tabs"
        value={tab}
        onChange={setTab}
        items={[
          { key: "items", label: "Items", icon: "fa-boxes-stacked", testid: "sm-tab-items" },
          { key: "insights", label: "Insights", icon: "fa-chart-simple", testid: "sm-tab-insights", accent: "cyan" },
          { key: "register_sales", label: "Register Sales", icon: "fa-cash-register", testid: "sm-tab-register_sales", accent: "cyan" },
          { key: "categories", label: "Categories & Layout", icon: "fa-layer-group", testid: "sm-tab-categories", accent: "cyan" },
          { key: "shop_settings", label: "Shop Settings", icon: "fa-sliders", testid: "sm-tab-shop_settings", accent: "cyan" },
          { key: "discounts", label: "Discount Codes", icon: "fa-tag", testid: "sm-tab-discounts", accent: "cyan" },
          { key: "reviews", label: "Reviews", icon: "fa-star", testid: "sm-tab-reviews", accent: "cyan" },
          { key: "orders", label: "Online Orders", icon: "fa-receipt", testid: "sm-tab-orders", accent: "orange" },
          { key: "printify_orders", label: "Printify Orders", icon: "fa-shirt", testid: "sm-tab-printify_orders", accent: "orange" },
          { key: "preview", label: "Client Preview", icon: "fa-mobile-screen", testid: "sm-tab-preview", accent: "cyan" },
        ]}
        // 10 flat tabs made "where do I even look for X" a real question —
        // Catalog (what you sell), Sales (money/orders), Storefront (how it
        // looks/behaves to a customer). Same tabs, same testids, just
        // visibly clustered.
        groups={[
          { label: "Catalog", keys: ["items", "categories"] },
          { label: "Sales", keys: ["insights", "register_sales", "orders", "printify_orders"] },
          { label: "Storefront", keys: ["shop_settings", "discounts", "reviews", "preview"] },
        ]}
      />

      {tab === "items" && <ItemsTab key={refreshKey} onEditItem={editItem} onAddShopItem={() => setPickerOpen(true)} />}
      {tab === "insights" && <ShopAnalyticsDashboard key={`insights-${refreshKey}`} />}
      {tab === "register_sales" && <RegisterSalesDashboard key={`register-sales-${refreshKey}`} />}
      {tab === "categories" && <CategoriesTab key={`cat-${refreshKey}`} />}
      {tab === "shop_settings" && <ShopSettingsTab key={`shop-settings-${refreshKey}`} />}
      {tab === "discounts" && <DiscountCodesTab key={`discounts-${refreshKey}`} />}
      {tab === "reviews" && <ReviewsTab key={`reviews-${refreshKey}`} />}
      {tab === "orders" && <OnlineOrdersTab key={`orders-${refreshKey}`} />}
      {tab === "printify_orders" && <PrintifyOrdersTab key={`printify-orders-${refreshKey}`} />}
      {tab === "preview" && <ClientPreviewTab key={`prev-${refreshKey}`} />}

      {pickerOpen && <TypePickerModal onClose={() => setPickerOpen(false)} onPick={pickType} />}

      {productForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" data-testid="sm-product-editor-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <ProductEditor relatableItems={relatableItems}
                           form={productForm} setForm={setProductForm} editingId={productEditingId}
                           originalImageId={productOriginalImageId}
                           originalImageIds={productOriginalImageIds} saving={productSaving}
                           onSave={saveProduct} onClose={closeProductWithoutSaving} />
          </div>
        </div>
      )}

      {packForm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6" data-testid="sm-pack-editor-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl shadow-2xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto">
            <div className="sticky top-0 bg-[var(--sh-card-base)] border-b border-shBorder px-5 py-4 flex items-center justify-between gap-3 z-10">
              <h5 className="text-shText font-black text-[16px] uppercase italic tracking-tight">{packEditing ? `Edit · ${packEditing.name}` : "New Pack"}</h5>
              <button onClick={closePackWithoutSaving} className="text-shTextMuted hover:text-shText"><i className="fas fa-xmark text-xl" /></button>
            </div>
            <PackEditor relatableItems={relatableItems}
                        form={packForm} setForm={setPackForm} editing={packEditing} originalImageId={packOriginalImageId}
                        emailTemplates={emailTemplates} err={packErr} onSave={savePack} onClose={closePackWithoutSaving} />
          </div>
        </div>
      )}

      {programForm && programMeta && (
        <ProgramEditor relatableItems={relatableItems}
                       program={programForm} setProgram={setProgramForm} meta={programMeta} allPrograms={allPrograms}
                       onSave={saveProgram} onClose={closeProgramWithoutSaving} originalImageId={programOriginalImageId}
                       extraError={programErr} />
      )}
    </div>
  );
}
