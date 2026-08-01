import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import NeonEdge from "./premium/NeonEdge";
import PremiumButton from "./premium/PremiumButton";
import { accentRgb } from "./premium/tokens";
import ItemThumbnail from "./ItemThumbnail";
import ShopItemDetail from "./ShopItemDetail";
import {
  categoryOptionsForTab, subcategoryOptionsForTab, nextFiltersForTab,
  sortShopItems, singularUnit, stockCeiling, isInternalPhysical, orderStatusLabel,
} from "../lib/shopPolish";

/* Client Shop — Phase 1 gave read-only catalog browsing. Phase 2 adds a
 * real cart + checkout: physical products, credit packs, and training
 * programs can all be added to ONE cart and checked out together through
 * Stripe's Hosted Checkout. This component NEVER loads any Stripe SDK and
 * NEVER talks to Stripe directly — it only ever asks our own backend for a
 * session.url and does a plain browser navigation to it. Browser success is
 * never financial authority: after Stripe redirects back, this polls our
 * own GET /portal/shop-orders/{id} endpoint and only shows a final state
 * once our webhook/local-apply has actually completed. Same pattern as
 * PortalInvoices.jsx's Pay Online flow.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const TABS = [
  { key: "all", label: "All" },
  { key: "product", label: "Merch & Gear" },
  { key: "credit_pack", label: "Prepaid Visits" },
  { key: "training_program", label: "Training" },
];

// Client Shop Item Detail — a real route (/shop/item/:kind/:id) so the
// browser back button, refresh, and direct links all behave normally. `kind`
// here matches the catalog's own discriminator ("product"/"credit_pack"/
// "training_program"), the same strings the cart/checkout already use.
function parseDetailRoute() {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/shop\/item\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { kind: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) };
}

function readReturnParams() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("shop_order");
  const stripeState = params.get("stripe");
  if (orderId) {
    params.delete("shop_order");
    params.delete("stripe");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }
  return { orderId, stripeState };
}

// Shopify-linked merchandise is a display-only catalog link — Sit Happens
// never processes its checkout, so "adding" it just sends the client to the
// configured Shopify page. New tab on desktop (client stays in the Shop);
// same-tab navigation on mobile, where a background new-tab is easy to miss
// and the client needs to clearly land on Shopify. Click is logged (best-
// effort, nonfinancial) before navigating — never blocks the navigation.
function openShopifyListing(item) {
  api.post("/shop/merch-click", { product_id: item.id }).catch(() => {});
  const url = item.shopify_product_url;
  if (!url) return;
  const isMobile = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  if (isMobile) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

const PURCHASE_LABELS = { credit_pack: "Purchase Pack", training_program: "Purchase Program" };
const purchaseLabel = (kind) => PURCHASE_LABELS[kind] || "Add to Cart";

function ItemCard({ item, cartQty, onAdd, onOpenDetail }) {
  const isShopifyMerch = item.kind === "product" && item.sales_destination === "shopify_external";
  const outOfStock = item.kind === "product" && !isShopifyMerch && item.track_inventory && !item.in_stock;
  const ceiling = stockCeiling(item);
  const atMax = ceiling != null && cartQty >= ceiling;
  return (
    <NeonEdge accentRgb={accentRgb("lime")} intensity="subtle" onClick={() => onOpenDetail(item)}
              className="p-3 flex flex-col hover:-translate-y-0.5 transition duration-200 text-left cursor-pointer" data-testid={`shop-card-${item.kind}-${item.id}`}>
      <div className="relative">
        <ItemThumbnail imageId={item.image_id} alt={item.name} variant="banner" size={128} className="rounded-lg" />
        {item.featured && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shPrimary text-bgHeader">
            Featured
          </span>
        )}
      </div>
      <p className="text-shText font-bold text-[14px] mt-3 line-clamp-2 min-h-[2.25em]">{item.name}</p>
      {item.category_name && (
        <p className="text-[11px] text-shSecondary font-bold mt-0.5 truncate">
          {item.category_name}{item.subcategory_name ? ` → ${item.subcategory_name}` : ""}
        </p>
      )}
      {item.description && <p className="text-shTextMuted text-[12px] mt-1 line-clamp-2">{item.description}</p>}

      {isShopifyMerch ? (
        <p className="text-[11px] text-shSecondary uppercase tracking-widest font-bold mt-1" data-testid={`shop-merch-badge-${item.id}`}>
          <i className="fas fa-arrow-up-right-from-square mr-1" />Fulfilled by Shopify
        </p>
      ) : item.kind === "product" ? (
        <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-bold mt-1">
          {item.track_inventory
            ? (item.in_stock ? `${item.stock_on_hand} in stock` : "Out of stock")
            : "Available"}
        </p>
      ) : null}
      {item.kind === "credit_pack" && (
        <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-bold mt-1">
          {item.qty} {item.service_type} visits{item.value_each != null ? ` · ${money(item.value_each)} per visit` : ""}
        </p>
      )}
      {item.kind === "training_program" && (
        <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-bold mt-1">
          {item.format_count} {item.format_unit}
          {item.format_count > 0 && item.price != null
            ? ` · ${money(item.price / item.format_count)} per ${singularUnit(item.format_unit)}`
            : ""}
        </p>
      )}

      <div className="mt-auto pt-3 space-y-2">
        {isShopifyMerch ? (
          item.shopify_display_price != null && (
            <p className="text-shPrimary font-black text-[18px]">
              {item.shopify_from_price ? "From " : ""}{money(item.shopify_display_price)}
            </p>
          )
        ) : (item.kind === "credit_pack" || item.kind === "product") && item.has_price_override ? (
          <div data-testid={`shop-price-override-${item.id}`}>
            <p className="text-shPrimary font-black text-[18px]">Your price: {money(item.effective_price)}</p>
            <p className="text-[11px] text-shTextMuted font-bold uppercase tracking-widest">Client-specific price</p>
            <p className="text-[12px] text-shTextMuted mt-0.5">
              Standard price: <span className="line-through">{money(item.list_price)}</span>
            </p>
          </div>
        ) : (
          <p className="text-shPrimary font-black text-[18px]">{money(item.price)}</p>
        )}
        {isShopifyMerch ? (
          <PremiumButton variant="primary" onClick={(e) => { e.stopPropagation(); openShopifyListing(item); }} data-testid={`shop-view-options-${item.id}`} className="w-full justify-center">
            View Options <i className="fas fa-arrow-up-right-from-square ml-1 text-[11px]" />
          </PremiumButton>
        ) : outOfStock ? (
          <button disabled onClick={(e) => e.stopPropagation()} data-testid={`shop-buy-${item.kind}-${item.id}`}
                  className="w-full px-3 py-2 rounded-md text-[11px] font-black uppercase tracking-widest border border-shBorder text-shTextMuted cursor-not-allowed"
                  style={{ background: "var(--sh-card-base)" }} title="This item is currently out of stock">
            Out of Stock
          </button>
        ) : atMax ? (
          <button disabled onClick={(e) => e.stopPropagation()} data-testid={`shop-buy-${item.kind}-${item.id}`}
                  className="w-full px-3 py-2 rounded-md text-[11px] font-black uppercase tracking-widest border border-shBorder text-shTextMuted cursor-not-allowed"
                  style={{ background: "var(--sh-card-base)" }} title="You already have the maximum available quantity in your cart">
            Max in Cart ({cartQty})
          </button>
        ) : (
          <PremiumButton variant="primary" onClick={(e) => { e.stopPropagation(); onAdd(item); }} data-testid={`shop-buy-${item.kind}-${item.id}`} className="w-full justify-center">
            {cartQty > 0 ? `In Cart (${cartQty})` : purchaseLabel(item.kind)}
          </PremiumButton>
        )}
      </div>
    </NeonEdge>
  );
}

// Tone classes for orderStatusLabel's output (see ../lib/shopPolish.js).
const ORDER_STATUS_TONE = {
  "Needs Attention": "text-shOrange",
  "Not Completed": "text-shDanger",
  "Completed": "text-shGreen",
  "Picked Up": "text-shGreen",
  "Ready for Pickup": "text-shGreen",
};

const cartKey = (kind, refId) => `${kind}:${refId}`;

// Shared by CartPanel, the header Cart button, and CheckoutTray so every
// surface that shows a total is reading the exact same numbers — never a
// second, independently-recomputed total that could drift out of agreement.
function useCartLines(cart, items) {
  return useMemo(() => {
    const lines = cart.map((c) => {
      const item = items.find((i) => i.kind === c.kind && i.id === c.ref_id);
      return { ...c, item };
    }).filter((l) => l.item);
    const subtotal = lines.reduce((sum, l) => sum + (l.item.price || 0) * l.quantity, 0);
    return { lines, subtotal };
  }, [cart, items]);
}

function CartPanel({ lines, subtotal, onQtyChange, onRemove, onCheckout, busy, onClose }) {
  // Portaled to document.body — this panel must NEVER be a direct child of
  // a .bg-bgPanel.rounded-2xl/.rounded-xl container (index.css's `> *`
  // dialog-content rule forces position:relative on direct children of
  // those, which would silently break this backdrop's `fixed` positioning
  // since PortalShop's own root wrapper carries those exact classes).
  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" data-testid="shop-cart-panel">
      <div className="border border-shBorder rounded-2xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto shadow-sh" style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between">
          <p className="text-shText font-bold uppercase tracking-widest text-sm">Your Cart</p>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-xmark" /></button>
        </div>

        {lines.length === 0 && <p className="text-shTextMuted text-sm py-6 text-center">Your cart is empty.</p>}

        <div className="space-y-2">
          {lines.map((l) => {
            const ceiling = stockCeiling(l.item);
            const atMax = ceiling != null && l.quantity >= ceiling;
            return (
              <div key={cartKey(l.kind, l.ref_id)} className="border border-shBorder rounded-lg p-3 flex items-center justify-between gap-2"
                   style={{ background: "var(--sh-card-base)" }}
                   data-testid={`shop-cart-line-${l.kind}-${l.ref_id}`}>
                <div className="min-w-0">
                  <p className="text-shText font-bold text-sm truncate">{l.item.name}</p>
                  <p className="text-[11px] text-shTextMuted">{money(l.item.price)} each · {money(l.item.price * l.quantity)} total</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => onQtyChange(l.kind, l.ref_id, l.quantity - 1)}
                          className="w-7 h-7 rounded border border-shBorder text-shTextMuted hover:text-shText transition bg-[var(--sh-card-base)]">−</button>
                  <span className="text-shText font-bold w-5 text-center">{l.quantity}</span>
                  <button onClick={() => onQtyChange(l.kind, l.ref_id, l.quantity + 1)} disabled={atMax}
                          title={atMax ? "Maximum available quantity is already in your cart" : undefined}
                          className="w-7 h-7 rounded border border-shBorder text-shTextMuted hover:text-shText transition bg-[var(--sh-card-base)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-shTextMuted">+</button>
                  <button onClick={() => onRemove(l.kind, l.ref_id)} className="text-shTextMuted hover:text-shDanger ml-1">
                    <i className="fas fa-trash-can text-xs" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {lines.length > 0 && (
          <>
            {lines.some((l) => isInternalPhysical(l.item)) && (
              <p className="text-[11px] text-shOrange bg-shOrange/10 border border-shOrange/30 rounded p-2" data-testid="shop-cart-pickup-notice">
                <i className="fas fa-store mr-1" />Local pickup at Sit Happens — shipping is not available for this item.
              </p>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-shBorder">
              <p className="text-shTextMuted text-sm">Subtotal</p>
              <p className="text-shText font-black">{money(subtotal)}</p>
            </div>
            <p className="text-[11px] text-shTextMuted">Tax (if applicable) is calculated on the next step. You&apos;ll be taken to Stripe&apos;s secure checkout — Sit Happens never sees or stores your card details.</p>
            <PremiumButton variant="primary" onClick={onCheckout} disabled={busy} data-testid="shop-checkout-button" className="w-full justify-center py-3">
              {busy ? "Redirecting…" : "Continue to Secure Checkout"}
            </PremiumButton>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Persistent checkout CTA — floats above the shop content whenever the cart
// has at least one item, so "buy now" never depends on the client noticing
// the small header Cart button. Reads the exact same `cartCount`/`subtotal`
// as the header button and CartPanel (see useCartLines above) — never a
// second total. Portaled to document.body for the same z-index/positioning
// reasons as CartPanel (see its comment).
function CheckoutTray({ cartCount, subtotal, onViewCart, onCheckout, busy, justAdded }) {
  const [mobileNavH, setMobileNavH] = useState(0);
  useEffect(() => {
    const measure = () => {
      const nav = document.querySelector('[data-testid="client-mobile-nav"]');
      setMobileNavH(nav ? nav.getBoundingClientRect().height : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (cartCount === 0) return null;

  const glow = justAdded ? "0 0 0 3px rgba(140,198,63,0.55), 0 0 32px -4px rgba(140,198,63,0.7)" : "0 8px 28px -8px rgba(0,0,0,0.5)";

  return createPortal(
    <>
      {/* Desktop — floats above content, left-inset to clear the persistent
          client sidebar (w-52 = 13rem) so it never overlaps nav chrome and
          stays aligned with the actual shop content column. */}
      <div className="hidden md:flex fixed bottom-6 z-40 justify-center pointer-events-none" style={{ left: "13rem", right: 0 }}>
        <div
          data-testid="shop-checkout-tray"
          className="pointer-events-auto flex items-center gap-4 pl-5 pr-3 py-3 rounded-2xl border border-shPrimary/40 w-full max-w-xl mx-6 transition-shadow duration-300"
          style={{ background: "var(--sh-card-base)", boxShadow: glow }}
        >
          <i className="fas fa-cart-shopping text-shPrimary text-lg" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-shText font-bold text-sm leading-tight">{cartCount} item{cartCount !== 1 ? "s" : ""}</p>
            <p className="text-shPrimary font-black text-sm leading-tight">{money(subtotal)}</p>
          </div>
          <PremiumButton variant="secondary" onClick={onViewCart} data-testid="shop-tray-view-cart" className="py-2.5 px-4">
            View Cart
          </PremiumButton>
          <PremiumButton variant="primary" onClick={onCheckout} disabled={busy} data-testid="shop-tray-checkout" className="py-2.5 px-6">
            {busy ? "Redirecting…" : "Checkout"}
          </PremiumButton>
        </div>
      </div>

      {/* Mobile — fixed bottom bar, offset above the bottom nav (measured,
          not guessed) and respecting the phone's safe-area inset. */}
      <div className="md:hidden fixed inset-x-0 z-40" style={{ bottom: mobileNavH }} data-testid="shop-checkout-tray-mobile">
        <div
          className="flex items-center gap-3 px-4 pt-3 border-t border-shPrimary/40 transition-shadow duration-300"
          style={{ background: "var(--sh-card-base)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))", boxShadow: glow }}
        >
          <button onClick={onViewCart} aria-label={`View cart, ${cartCount} item${cartCount !== 1 ? "s" : ""}, ${money(subtotal)}`}
                  data-testid="shop-tray-view-cart-mobile" className="flex items-center gap-2 flex-1 min-w-0 text-left">
            <i className="fas fa-cart-shopping text-shPrimary text-lg shrink-0" aria-hidden="true" />
            <span className="text-shText font-bold text-sm truncate">{cartCount} · {money(subtotal)}</span>
          </button>
          <PremiumButton variant="primary" onClick={onCheckout} disabled={busy} data-testid="shop-tray-checkout-mobile" className="py-2.5 px-5 shrink-0">
            {busy ? "…" : "Checkout"}
          </PremiumButton>
        </div>
      </div>
    </>,
    document.body,
  );
}

function ApparelSection({ storeUrl }) {
  if (!storeUrl) return null;
  return (
    <div data-testid="shop-apparel-section"
         className="mb-4 rounded-2xl border border-shOrange/30 bg-gradient-to-br from-shOrange/10 to-transparent p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="w-12 h-12 shrink-0 rounded-full bg-shOrange/15 border border-shOrange/30 grid place-items-center">
        <i className="fas fa-shirt text-shOrange text-lg" />
      </div>
      <div className="flex-1">
        <p className="text-white font-black text-[15px]">Sit Happens Apparel &amp; Merch</p>
        <p className="text-gray-400 text-sm mt-0.5">
          Shirts, hoodies, mugs and more — printed and shipped directly to you.
        </p>
        <p className="text-gray-500 text-[12px] mt-1">
          Opens in a new tab with its own secure checkout, and ships straight to your door.
        </p>
      </div>
      <a href={storeUrl} target="_blank" rel="noopener noreferrer" data-testid="shop-apparel-button"
         className="shrink-0 bg-shOrange text-bgHeader px-5 py-2.5 rounded text-[12px] font-black uppercase tracking-widest text-center hover:brightness-110 transition">
        Shop Apparel <i className="fas fa-arrow-up-right-from-square ml-1 text-[11px]" />
      </a>
    </div>
  );
}

export default function PortalShop({ initialTab = "all", fullScreen = false, shopifyStoreUrl = "", cart: cartProp, onCartChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(initialTab);
  // Shop Organization (Phase 1) — category/subcategory browsing, additive to
  // the existing kind tabs above. "" means no category filter (shows every
  // item, categorized or not); a subcategory filter only applies once a
  // category is chosen, and is cleared whenever the category changes.
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [subcategoryFilter, setSubcategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  // Cart is controlled by the parent (Portal.jsx) when cart/onCartChange are
  // passed, so it survives leaving/returning to this view — still the ONE
  // cart, just lifted, not a second one. Falls back to local state so this
  // component still works standalone if ever used without those props.
  const [localCart, setLocalCart] = useState([]); // [{kind, ref_id, quantity}]
  const cart = cartProp !== undefined ? cartProp : localCart;
  const setCart = onCartChange || setLocalCart;
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const idemKeyRef = useRef(null);

  // Item Detail page — a real route (/shop/item/:kind/:id), not a modal, so
  // back button / refresh / direct links all behave like a normal store.
  // The grid's own state (tab/search/category filters) lives on THIS same
  // component and is never reset by opening/closing the detail view — only
  // which JSX renders below changes. `detailScrollRef` remembers where the
  // grid was scrolled to (the actual scroll container is Portal.jsx's
  // [data-scroll-root], not a container inside this component) so returning
  // from a detail page restores the client's place in the grid.
  const [detail, setDetail] = useState(() => parseDetailRoute());
  const detailScrollRef = useRef(0);

  useEffect(() => {
    const onPop = () => setDetail(parseDetailRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openDetail = (item) => {
    const scrollRoot = document.querySelector("[data-scroll-root]");
    if (scrollRoot) detailScrollRef.current = scrollRoot.scrollTop;
    const path = `/shop/item/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`;
    window.history.pushState({ shDetail: true }, "", path);
    setDetail({ kind: item.kind, id: item.id });
  };

  const closeDetail = () => {
    if (window.history.state?.shDetail) {
      window.history.back();
    } else {
      // Reached directly (refresh/shared link) — no history entry of ours
      // to pop back to, so just drop the item segment from the URL.
      window.history.pushState({}, "", "/");
      setDetail(null);
    }
    setTimeout(() => {
      document.querySelector("[data-scroll-root]")?.scrollTo({ top: detailScrollRef.current });
    }, 0);
  };

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const load = () => {
    setLoading(true);
    api.get("/shop/catalog")
      .then(({ data }) => setItems(data.items || []))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load the shop"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get("/shop/catalog/taxonomy")
      .then(({ data }) => setCategories(data.categories || []))
      .catch(() => setCategories([]));
  }, []);

  // Category/subcategory choices are scoped to the selected tab — a category
  // with no matching item in this tab should never appear as an option here,
  // even though the full taxonomy (loaded above) still lists it for other
  // tabs. Derived from the already-loaded catalog items, never a second
  // taxonomy fetch/filter system (see ../lib/shopPolish.js).
  const categoryOptions = useMemo(
    () => categoryOptionsForTab(categories, items, tab),
    [categories, items, tab],
  );
  const selectedCategory = categoryOptions.find((c) => c.id === categoryFilter);
  const subcategoryOptions = useMemo(
    () => subcategoryOptionsForTab(categories, items, tab, categoryFilter),
    [categories, items, tab, categoryFilter],
  );

  // Selecting a tab can invalidate the current category/subcategory choice
  // (e.g. a category that only ever contained Training items, while
  // switching to the Merch & Gear tab) — clear whatever no longer applies
  // rather than silently showing a filter that can never match anything.
  const selectTab = (key) => {
    setTab(key);
    const next = nextFiltersForTab(items, key, categoryFilter, subcategoryFilter);
    if (next.categoryFilter !== categoryFilter) setCategoryFilter(next.categoryFilter);
    if (next.subcategoryFilter !== subcategoryFilter) setSubcategoryFilter(next.subcategoryFilter);
  };

  const filtered = useMemo(() => {
    let list = tab === "all" ? items : items.filter((i) => i.kind === tab);
    if (categoryFilter) list = list.filter((i) => i.category_id === categoryFilter);
    if (subcategoryFilter) list = list.filter((i) => i.subcategory_id === subcategoryFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) => (
        (i.name || "").toLowerCase().includes(q)
        || (i.description || "").toLowerCase().includes(q)
        || (i.category_name || "").toLowerCase().includes(q)
        || (i.subcategory_name || "").toLowerCase().includes(q)
      ));
    }
    return sortShopItems(list);
  }, [items, tab, categoryFilter, subcategoryFilter, search]);

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);
  const { lines: cartLines, subtotal: cartSubtotal } = useCartLines(cart, items);

  // Brief highlight on the persistent tray right after an add, so the client
  // notices it appeared/updated — auto-clears itself, never blocks anything.
  const [justAdded, setJustAdded] = useState(false);
  const justAddedTimerRef = useRef(null);
  const pulseTray = () => {
    setJustAdded(true);
    clearTimeout(justAddedTimerRef.current);
    justAddedTimerRef.current = setTimeout(() => setJustAdded(false), 900);
  };
  useEffect(() => () => clearTimeout(justAddedTimerRef.current), []);

  const addToCart = (item, qty = 1) => {
    const ceiling = stockCeiling(item);
    const existingQty = cart.find((c) => c.kind === item.kind && c.ref_id === item.id)?.quantity || 0;
    if (ceiling != null && existingQty >= ceiling) {
      toast.error(`Only ${ceiling} are currently available`);
      return;
    }
    let nextQty = existingQty + qty;
    if (ceiling != null && nextQty > ceiling) {
      nextQty = ceiling;
      toast.error(`Only ${ceiling} are currently available`);
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.kind === item.kind && c.ref_id === item.id);
      if (existing) {
        return prev.map((c) => (c === existing ? { ...c, quantity: nextQty } : c));
      }
      return [...prev, { kind: item.kind, ref_id: item.id, quantity: nextQty }];
    });
    idemKeyRef.current = null; // cart changed — a fresh checkout attempt needs a fresh key
    pulseTray();
  };

  const changeQty = (kind, refId, qty) => {
    idemKeyRef.current = null;
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => !(c.kind === kind && c.ref_id === refId)));
      return;
    }
    const item = items.find((i) => i.kind === kind && i.id === refId);
    const ceiling = stockCeiling(item);
    if (ceiling != null && qty > ceiling) {
      toast.error(`Only ${ceiling} are currently available`);
      qty = ceiling;
    }
    setCart((prev) => prev.map((c) => (c.kind === kind && c.ref_id === refId ? { ...c, quantity: qty } : c)));
  };

  const removeFromCart = (kind, refId) => {
    idemKeyRef.current = null;
    setCart((prev) => prev.filter((c) => !(c.kind === kind && c.ref_id === refId)));
  };

  // My Orders — a compact panel over the client's own existing order history
  // (GET /portal/shop-orders, already hand-picked to safe fields only: no
  // Stripe ids, payment-attempt ids, or reservation internals). Lazy-loaded
  // on first open, and explicitly refreshed once a checkout actually
  // finishes (see the Stripe-return poll below) so a just-completed order
  // shows up without the client needing to manually refresh.
  const [orders, setOrders] = useState([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const loadOrders = () => {
    api.get("/portal/shop-orders")
      .then(({ data }) => { setOrders(data.orders || []); setOrdersLoaded(true); })
      .catch(() => {});
  };
  useEffect(() => {
    if (ordersOpen && !ordersLoaded) loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersOpen]);

  const submitCheckout = async () => {
    if (cart.length === 0) return;
    if (!idemKeyRef.current) idemKeyRef.current = crypto.randomUUID();
    setCheckoutBusy(true);
    try {
      const { data } = await api.post("/shop/checkout", {
        items: cart.map((c) => ({ kind: c.kind, ref_id: c.ref_id, quantity: c.quantity })),
        idempotency_key: idemKeyRef.current,
      });
      window.location.href = data.url; // plain navigation — no Stripe SDK involved
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start checkout");
      setCheckoutBusy(false);
      // Keep idemKeyRef.current — a retry of this SAME unchanged cart must
      // reuse the same idempotency key so the server resumes the same
      // claim/order/reservation instead of creating a second one. Only cart
      // mutations (addToCart/changeQty/removeFromCart, above) or a
      // completed purchase (below) mint a new key.
    }
  };

  // ── Returning from Stripe — poll our own order status, never trust the URL alone ──
  const [returning, setReturning] = useState(null); // { orderId, status, fulfillmentStatus, pickupStatus, hasPhysical } | null
  const pollRef = useRef(null);
  useEffect(() => {
    const { orderId, stripeState } = readReturnParams();
    if (!orderId) return;
    if (stripeState === "cancel") {
      toast("Checkout canceled — nothing was charged.");
      return;
    }
    setReturning({ orderId, status: "pending_payment", fulfillmentStatus: "pending", pickupStatus: null, hasPhysical: false });
    const poll = () => {
      api.get(`/portal/shop-orders/${orderId}`)
        .then(({ data }) => {
          const hasPhysical = (data.lines || []).some((l) => l.kind === "product");
          setReturning({
            orderId, status: data.status, fulfillmentStatus: data.fulfillment_status,
            pickupStatus: data.pickup_status, hasPhysical,
          });
          if (data.status === "paid") {
            setCart([]);
            idemKeyRef.current = null; // purchase completed — any future checkout is a new attempt
            loadOrders(); // so the newly completed order shows up in My Orders right away
            if (data.fulfillment_status === "fulfilled") {
              clearInterval(pollRef.current);
            }
            // needs_attention still stops polling — staff handle it from here
            if (data.fulfillment_status === "needs_attention") {
              clearInterval(pollRef.current);
            }
          } else if (["payment_failed", "canceled"].includes(data.status)) {
            clearInterval(pollRef.current);
          }
          // pending_payment — keep polling, still processing
        })
        .catch(() => {});
    };
    poll();
    pollRef.current = setInterval(poll, 2500);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hidden once the cart is empty, while the full cart panel is already open
  // (it has its own Checkout button — showing both would be redundant), and
  // during the post-Stripe return/processing banner (the closest thing this
  // single-page shop has to a separate "payment screen").
  const trayVisible = cartCount > 0 && !cartOpen && !returning;

  return (
    <div id="portal-shop-anchor" data-testid="portal-shop"
         className={fullScreen ? "w-full max-w-6xl mx-auto" : "p-6 rounded-2xl border border-shBorder shadow-sh"}
         style={fullScreen ? undefined : { background: "var(--sh-card-base)" }}>
      <div className="flex items-center justify-between mb-4 gap-2">
        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shPrimary">
          <i className="fas fa-bag-shopping mr-1" />Shop
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setOrdersOpen((o) => !o)} data-testid="shop-my-orders-toggle"
                  className="border border-shBorder text-shTextMuted hover:text-shText px-3 py-2 rounded-md text-[11px] font-bold uppercase tracking-widest hover:border-shPrimary/50 transition"
                  style={{ background: "var(--sh-card-base)" }}>
            <i className="fas fa-receipt mr-1" />My Orders
          </button>
          <button onClick={() => setCartOpen(true)} data-testid="shop-cart-open"
                  aria-label={cartCount > 0 ? `Open cart, ${cartCount} item${cartCount !== 1 ? "s" : ""}, ${money(cartSubtotal)}` : "Open cart"}
                  className="relative border border-shBorder text-shTextMuted hover:text-shText px-3 py-2 rounded-md text-[11px] font-bold uppercase tracking-widest hover:border-shPrimary/50 transition"
                  style={{ background: "var(--sh-card-base)" }}>
            <i className="fas fa-cart-shopping mr-1" />Cart{cartCount > 0 && <span className="hidden sm:inline"> ({cartCount}) · {money(cartSubtotal)}</span>}
            {cartCount > 0 && (
              <span style={{ position: "absolute" }} className="-top-2 -right-2 bg-shAccent text-white rounded-full w-5 h-5 text-[10px] grid place-items-center font-black" data-testid="shop-cart-count">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {ordersOpen && (
        <div className="mb-4 border border-shBorder rounded-xl p-4" style={{ background: "var(--sh-card-base)" }} data-testid="shop-my-orders-panel">
          <div className="flex items-center justify-between mb-2">
            <p className="text-shText font-bold uppercase tracking-widest text-sm">My Orders</p>
            <button onClick={loadOrders} className="text-[11px] uppercase tracking-widest font-black text-shTextMuted hover:text-shPrimary">
              <i className="fas fa-rotate-right mr-1" />Refresh
            </button>
          </div>
          {orders.length === 0 ? (
            <p className="text-shTextMuted text-sm py-2">No orders yet.</p>
          ) : (
            <>
              <div className="space-y-2">
                {(ordersExpanded ? orders : orders.slice(0, 3)).map((o) => {
                  const label = orderStatusLabel(o);
                  return (
                    <div key={o.order_id} className="border border-shBorder rounded-lg p-3" data-testid={`shop-order-${o.order_id}`}>
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-shText font-bold text-sm">Order #{o.order_id.slice(0, 8).toUpperCase()}</p>
                          <p className="text-shTextMuted text-[12px]">
                            {o.created_at ? new Date(o.created_at).toLocaleDateString() : "—"} · {money(o.total)}
                          </p>
                          <p className="text-[11px] text-shTextMuted mt-1 line-clamp-1">
                            {(o.lines || []).map((l) => `${l.quantity}× ${l.name}`).join(", ")}
                          </p>
                        </div>
                        <span className={`shrink-0 text-[11px] font-black uppercase tracking-widest ${ORDER_STATUS_TONE[label] || "text-shTextMuted"}`}>
                          {label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {orders.length > 3 && (
                <button onClick={() => setOrdersExpanded((v) => !v)} data-testid="shop-my-orders-expand"
                        className="mt-2 text-[11px] font-black uppercase tracking-widest text-shPrimary">
                  {ordersExpanded ? "Show fewer" : `Show ${orders.length - 3} more`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {detail ? (
        <ShopItemDetail
          kind={detail.kind}
          itemId={detail.id}
          cart={cart}
          onAddToCart={addToCart}
          onBack={closeDetail}
          allItems={items}
          onOpenItem={openDetail}
        />
      ) : (
      <>
      <ApparelSection storeUrl={shopifyStoreUrl} />

      {returning && (
        <div className="mb-4 border border-shBorder rounded-lg p-3 text-sm" style={{ background: "var(--sh-card-base)" }} data-testid="shop-order-return-status">
          {returning.status === "pending_payment" ? (
            <span className="text-gray-300"><i className="fas fa-circle-notch fa-spin mr-2" />Payment processing…</span>
          ) : returning.status === "paid" && returning.fulfillmentStatus !== "fulfilled" && returning.fulfillmentStatus !== "needs_attention" ? (
            <span className="text-gray-300"><i className="fas fa-circle-notch fa-spin mr-2" />Payment received — order processing…</span>
          ) : returning.status === "paid" && returning.fulfillmentStatus === "fulfilled" ? (
            !returning.hasPhysical ? (
              <span className="text-shGreen font-black"><i className="fas fa-circle-check mr-2" />Order received! Your visits/sessions have been added.</span>
            ) : returning.pickupStatus === "picked_up" ? (
              <span className="text-shGreen font-black"><i className="fas fa-circle-check mr-2" />Order completed. Thank you!</span>
            ) : returning.pickupStatus === "ready_for_pickup" ? (
              <span className="text-shGreen font-black"><i className="fas fa-circle-check mr-2" />Your order is ready for pickup at Sit Happens.</span>
            ) : (
              <span className="text-shGreen font-black"><i className="fas fa-circle-check mr-2" />Order received! We&apos;re preparing your items for pickup at Sit Happens.</span>
            )
          ) : returning.status === "paid" && returning.fulfillmentStatus === "needs_attention" ? (
            <span className="text-shOrange"><i className="fas fa-triangle-exclamation mr-2" />Order received — our team is finishing up part of your order and will follow up shortly.</span>
          ) : (
            <span className="text-shOrange"><i className="fas fa-triangle-exclamation mr-2" />Checkout didn&apos;t go through. Nothing was charged — try again below.</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-center mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => selectTab(t.key)} data-testid={`shop-tab-${t.key}`}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-widest transition border ${
                    tab === t.key ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted hover:border-shPrimary/50 hover:text-shText"
                  }`}
                  style={tab === t.key ? undefined : { background: "var(--sh-card-base)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Shop Organization (Phase 1) — a dropdown rather than a long row of
          category buttons, so this never overflows on mobile. Subcategory
          only appears once a category is chosen and clears whenever the
          category changes. */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-shTextMuted text-[13px]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the shop…"
                 data-testid="shop-search-input"
                 className="w-full pl-9 pr-3 py-2 rounded-md border border-shBorder text-shText text-sm focus:outline-none focus:border-shPrimary/60"
                 style={{ background: "var(--sh-card-base)" }} />
        </div>
        {categoryOptions.length > 0 && (
          <>
            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setSubcategoryFilter(""); }}
                    data-testid="shop-category-select"
                    className="rounded-md border border-shBorder text-shText text-sm px-3 py-2 focus:outline-none focus:border-shPrimary/60"
                    style={{ background: "var(--sh-card-base)" }}>
              <option value="">All Categories</option>
              {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {subcategoryOptions.length > 0 && (
              <select value={subcategoryFilter} onChange={(e) => setSubcategoryFilter(e.target.value)}
                      data-testid="shop-subcategory-select"
                      className="rounded-md border border-shBorder text-shText text-sm px-3 py-2 focus:outline-none focus:border-shPrimary/60"
                      style={{ background: "var(--sh-card-base)" }}>
                <option value="">All of {selectedCategory.name}</option>
                {subcategoryOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {loading && <p className="text-gray-500 text-sm text-center py-6">Loading the shop…</p>}
      {!loading && err && <p className="text-red-400 text-sm text-center py-6">{err}</p>}
      {!loading && !err && filtered.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-6">Nothing here yet — check back soon.</p>
      )}
      {!loading && !err && filtered.length > 0 && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${fullScreen ? "lg:grid-cols-4" : ""} gap-3`}>
          {filtered.map((item) => {
            const inCart = cart.find((c) => c.kind === item.kind && c.ref_id === item.id);
            return (
              <ItemCard key={`${item.kind}-${item.id}`} item={item} cartQty={inCart ? inCart.quantity : 0} onAdd={addToCart} onOpenDetail={openDetail} />
            );
          })}
        </div>
      )}
      </>
      )}

      {/* Reserves room below the last card so the persistent checkout tray
          (fixed, below) never covers it — matches the tray's own height at
          each breakpoint rather than a guess. */}
      {trayVisible && <div className="h-24 md:h-20" aria-hidden="true" />}

      {cartOpen && (
        <CartPanel
          lines={cartLines}
          subtotal={cartSubtotal}
          onQtyChange={changeQty}
          onRemove={removeFromCart}
          onCheckout={submitCheckout}
          busy={checkoutBusy}
          onClose={() => setCartOpen(false)}
        />
      )}

      {trayVisible && (
        <CheckoutTray
          cartCount={cartCount}
          subtotal={cartSubtotal}
          onViewCart={() => setCartOpen(true)}
          onCheckout={submitCheckout}
          busy={checkoutBusy}
          justAdded={justAdded}
        />
      )}
    </div>
  );
}
