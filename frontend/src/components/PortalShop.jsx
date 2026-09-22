import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import NeonEdge from "./premium/NeonEdge";
import PremiumButton from "./premium/PremiumButton";
import { accentRgb } from "./premium/tokens";
import ItemThumbnail from "./ItemThumbnail";
import { isFreeClaimable } from "../lib/freeCourseClaim";
import { SELECTED_ENROLLMENT_KEY } from "../lib/studentSchool";
import ShopItemDetail from "./ShopItemDetail";
import GuestCheckoutPanel from "./GuestCheckoutPanel";
import ShopLanding from "./shop/ShopLanding";
import CartPanel from "./shop/ShopCart";
import {
  DepartmentNav, ShopSearch, SortSelect, FilterControls, ProductGrid,
} from "./shop/ShopBrowse";
import {
  visibleDepartments, departmentByKey, resolveDepartmentParam, browseItems,
  itemsInDepartment, EMPTY_FILTERS, activeFilterCount,
} from "../lib/shopDepartments";
import { cartGiftKey } from "../lib/shopPolish";
import { useAuth } from "../lib/auth";
import { useDiscovery, useFavorites, useRememberViewed } from "../lib/useShopDiscovery";
import {
  trackShop, trackOnce, trackImpressions, trackProductView, flushShopEvents,
  startShopAnalytics,
} from "../lib/shopAnalytics";
import { useDocumentMeta, publicOrigin } from "../lib/useDocumentMeta";
import { shopMetaFor } from "../lib/shopSeo";
import {
  FavoriteButton, FavoritesList, Recommendations, RecentlyViewed,
} from "./shop/ShopDiscovery";
import { MyOrders } from "./shop/ShopOrders";
import HuskyDogImage from "./brand/HuskyDogImage";
import OnlineSchoolStorefront from "./OnlineSchoolStorefront";
import {
  itemsForTab, subcategoryOptionsForTab, nextFiltersForTab,
  sortShopItems, singularUnit, stockCeiling, isInternalPhysical,
  shopBackTarget,
  categoryGroupsForTab, matchesSearchQuery, OTHER_CATEGORY_ID,
  sectionMetaFor, visibleSectionsInOrder, categoryCoverImageId, shouldHideEmptyCategory,
  orderCategoryGroupsFeaturedFirst, filterFeaturedItems, guestItemCta, creditPackCardLine,
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

// PERMANENT — the cart/catalog kind discriminator strings. Never
// admin-editable; only the display label/description/image/order for each
// comes from shop_page settings (see shopPolish.js's sectionMetaFor), with
// these exact strings as the hardcoded fallback on a fresh install.
const TABS = [
  { key: "all", label: "All" },
  { key: "product", label: "Merch & Gear" },
  { key: "credit_pack", label: "Prepaid Visits" },
  { key: "training_program", label: "Training" },
  { key: "online_school", label: "Online School" },
];


function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(max-width: 640px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 640px)");
    const handler = () => setIsMobile(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler); else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler); else mq.removeListener(handler);
    };
  }, []);
  return isMobile;
}

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
  // They are leaving for Shopify's own checkout, so this is the last thing
  // this shop will hear about that sale — which is exactly why it is worth
  // counting.
  trackShop({ event: "shopify_outbound", kind: item.kind, ref_id: item.id });
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







// Shared by CartPanel, the header Cart button, and CheckoutTray so every
// surface that shows a total is reading the exact same numbers — never a
// second, independently-recomputed total that could drift out of agreement.
function useCartLines(cart, items, dogs = []) {
  return useMemo(() => {
    const lines = cart.map((c) => {
      const item = items.find((i) => i.kind === c.kind && i.id === c.ref_id);
      const dog_name = c.dog_id ? dogs.find((d) => d.id === c.dog_id)?.name : undefined;
      return { ...c, item, dog_name };
    }).filter((l) => l.item);
    const subtotal = lines.reduce((sum, l) => sum + (l.item.price || 0) * l.quantity, 0);
    return { lines, subtotal };
  }, [cart, items, dogs]);
}

// Persistent checkout CTA — floats above the shop content whenever the cart
// has at least one item, so "buy now" never depends on the client noticing
// the small header Cart button. Reads the exact same `cartCount`/`subtotal`
// as the header button and CartPanel (see useCartLines above) — never a
// second total. Portaled to document.body for the same z-index/positioning
// reasons as CartPanel (see its comment).
function CheckoutTray({ cartCount, subtotal, onViewCart, onCheckout, busy, justAdded, previewMode, guestMode, onSignIn }) {
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
      <div className="hidden md:flex fixed bottom-6 z-40 justify-center pointer-events-none" style={{ left: "13rem", right: 0 }} data-bottom-dock="">
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
          <PremiumButton variant="primary" onClick={onCheckout} disabled={!guestMode && (busy || previewMode)} data-testid="shop-tray-checkout" className="py-2.5 px-6">
            {previewMode ? "Preview Only" : busy ? "Redirecting…" : "Checkout"}
          </PremiumButton>
        </div>
      </div>

      {/* Mobile — fixed bottom bar, offset above the bottom nav (measured,
          not guessed) and respecting the phone's safe-area inset. */}
      <div className="md:hidden fixed inset-x-0 z-40" style={{ bottom: mobileNavH }} data-testid="shop-checkout-tray-mobile" data-bottom-dock="">
        <div
          className="flex items-center gap-3 px-4 pt-3 border-t border-shPrimary/40 transition-shadow duration-300"
          style={{ background: "var(--sh-card-base)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))", boxShadow: glow }}
        >
          <button onClick={onViewCart} aria-label={`View cart, ${cartCount} item${cartCount !== 1 ? "s" : ""}, ${money(subtotal)}`}
                  data-testid="shop-tray-view-cart-mobile" className="flex items-center gap-2 flex-1 min-w-0 text-left">
            <i className="fas fa-cart-shopping text-shPrimary text-lg shrink-0" aria-hidden="true" />
            <span className="text-shText font-bold text-sm truncate">{cartCount} · {money(subtotal)}</span>
          </button>
          <PremiumButton variant="primary" onClick={onCheckout} disabled={!guestMode && (busy || previewMode)} data-testid="shop-tray-checkout-mobile" className="py-2.5 px-5 shrink-0">
            {previewMode ? "Preview" : busy ? "…" : "Checkout"}
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

/**
 * Everything shown beneath a product: what pairs with it, and what you were
 * looking at before.
 *
 * One request for both, because they need the same catalogue read behind
 * them. Rendering nothing at all is the normal case for a brand-new visitor
 * with no history and a product nobody has curated yet, and that is the
 * correct output — an empty "you may also like" is worse than whitespace.
 */
export function DetailDiscovery({ detail, clientId, mode, cardProps }) {
  const guest = mode === "guest";
  const live = mode !== "preview";
  useRememberViewed({ kind: detail.kind, refId: detail.id, clientId, guest, enabled: live });
  const { recommendations, recentlyViewed } = useDiscovery({
    kind: detail.kind, refId: detail.id, clientId, guest, enabled: live,
  });

  // One per meaningful visit to this product, not one per render.
  useEffect(() => {
    if (live) trackProductView(detail.kind, detail.id);
  }, [live, detail.kind, detail.id]);

  // Which suggestions were actually shown, and where they came from — the
  // pair of numbers that says whether curation is worth the effort.
  useEffect(() => {
    if (!live || recommendations.length === 0) return;
    for (const r of recommendations) {
      trackShop({ event: "recommendation_impression", kind: r.item.kind,
                  ref_id: r.item.id, rec_source: r.rel });
    }
  }, [live, recommendations]);

  const cardPropsWithTracking = {
    ...cardProps,
    onOpenDetail: (item) => {
      const source = recommendations.find((r) => r.item.id === item.id)?.rel;
      if (live) {
        trackShop({ event: "recommendation_click", kind: item.kind, ref_id: item.id,
                    rec_source: source || "recently_viewed" });
      }
      cardProps.onOpenDetail?.(item);
    },
  };

  if (recommendations.length === 0 && recentlyViewed.length === 0) return null;
  return (
    <div className="mt-10 pt-8 border-t border-shBorder space-y-8">
      <Recommendations recommendations={recommendations} cardProps={cardPropsWithTracking} />
      <RecentlyViewed items={recentlyViewed} cardProps={cardPropsWithTracking} />
    </div>
  );
}

export default function PortalShop({
  initialTab = "all", fullScreen = false, shopifyStoreUrl = "", cart: cartProp, onCartChange,
  // mode: "authenticated" (default, real client) | "preview" (admin Shop
  // Manager Client Preview — reuses this exact same presentation instead of
  // a second fake storefront) | "guest" (public no-account storefront).
  mode = "authenticated", previewClientId = null,
  // Called with the catalog once it loads, so a wrapper never has to fetch
  // the same list a second time for its own purposes.
  onItemsLoaded,
  // guest mode only — called whenever a guest clicks a CTA that requires an
  // account (sign-in, hidden-price, or an approval/dog contact-required
  // blocker). `(item, reason)` — reason is "hidden_price"|"approval"|"dog"|null.
  onRequireAccount,
  // Phase 5 — Online School commerce. Called when a client clicks "Go to
  // Online School"/"View Completed Course" on an already-enrolled/completed
  // online_school-fulfillment program's detail view; Portal.jsx wires this
  // to closing the Shop overlay and opening the Online School dashboard.
  onGoToOnlineSchool,
  // Free Online School claim — Portal.jsx wires this to opening the
  // client's add-dog workflow, so a client with no dog is routed into the
  // real onboarding rather than being offered a placeholder.
  onAddDog,
  // Post-purchase — "View balance" on a credit-pack line. Wired by
  // Portal.jsx to closing the Shop and returning to the portal, which is
  // where a client's visit balance already lives; the Shop deliberately does
  // not grow a second place to show it.
  onGoToCredits,
  // Real Online School numbers (dogs trained, review average), already
  // fetched by whoever mounts this. Passed through rather than fetched here
  // so the authenticated Shop does not make a request it has no use for.
  schoolStats,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(initialTab);

  // ── saved items, and the things worth showing beside a product ──
  //
  // Both are for a real signed-in client only. Preview mode is an admin
  // looking at somebody else's storefront, and a guest has no account to
  // save anything to — in both cases the heart would be a promise we cannot
  // keep, so it is simply absent rather than present and broken.
  // `|| {}` because useAuth returns null outside an AuthProvider, and this
  // component is mounted without one (the render-smoke tests, and the admin
  // Shop Manager preview). All it wants is client_id; crashing the whole
  // storefront over a missing context would be a poor trade for a heart.
  const { user } = useAuth() || {};

  // ── analytics ──
  //
  // Every event below answers a question an owner asks. Nothing here is a
  // generic interaction log: a re-render reports nothing, and a component
  // mounting twice reports once. Preview mode reports nothing at all — an
  // admin looking at the storefront is not a customer, and counting them
  // would quietly inflate every funnel the admin then reads.
  const analyticsOn = mode !== "preview";

  // Which products the ORDERS say are best sellers. Server-computed from
  // completed sales — an admin cannot set this, and it is empty when the
  // shop has not sold enough for the badge to mean anything. Read from the
  // catalogue response rather than a second request, so a storefront never
  // pays for a badge.
  const bestSellerIds = useMemo(
    () => new Set((items || []).filter((i) => i.best_seller).map((i) => i.id)),
    [items],
  );
  useEffect(() => {
    if (!analyticsOn) return undefined;
    const stop = startShopAnalytics();
    // Once per page load, not once per effect run — StrictMode runs this
    // twice and browser QA caught it reporting two visits for one.
    trackOnce("shop_view", { event: "shop_view" });
    return stop;
  }, [analyticsOn]);
  const isRealClient = mode === "authenticated";
  const clientId = isRealClient ? user?.client_id : null;
  const favorites = useFavorites(isRealClient);
  const [favoriteItems, setFavoriteItems] = useState(null); // null = not fetched
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(null);

  const toggleFavorite = useCallback(async (kind, refId) => {
    setFavoriteBusy(`${kind}:${refId}`);
    try {
      const nowSaved = await favorites.toggle(kind, refId);
      trackShop({ event: nowSaved ? "favorite_add" : "favorite_remove", kind, ref_id: refId });
      // Keep the saved-items view honest without re-fetching the whole list
      // on every heart: only the list currently on screen needs to change.
      if (favoriteItems) setFavoriteItems(await favorites.reload());
      toast.success(nowSaved ? "Saved for later" : "Removed from saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update your saved items");
    } finally {
      setFavoriteBusy(null);
    }
  }, [favorites, favoriteItems]);

  // Fetch the saved list only when somebody asks to see it. The header
  // count comes from the light /shop/favorites read the hook already does;
  // the resolved items are a second, larger payload nobody needs until the
  // panel opens.
  useEffect(() => {
    if (!favoritesOpen || !isRealClient) return;
    favorites.reload().then(setFavoriteItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoritesOpen, isRealClient]);

  // A heart on a card, or nothing at all. Gift cards are deliberately
  // excluded: a gift card is money with a value printed on it, not
  // something you come back to later.
  const favoriteSlot = useCallback((item, { size = "sm" } = {}) => {
    if (!isRealClient || !item || item.kind === "gift_card") return null;
    return (
      <FavoriteButton
        kind={item.kind} refId={item.id} name={item.name}
        saved={favorites.isSaved(item.kind, item.id)}
        busy={favoriteBusy === `${item.kind}:${item.id}`}
        onToggle={toggleFavorite}
        size={size}
      />
    );
  }, [isRealClient, favorites, favoriteBusy, toggleFavorite]);

  // ── buying something again ──
  //
  // A reference and a quantity, handed to the ordinary add-to-cart path.
  // Deliberately NOT a copy of the old order line: the item is looked up in
  // today's catalogue, priced by the cart from that catalogue, and priced
  // again by the server at checkout. There is no code path here through
  // which an old price could become authoritative, because no old price is
  // ever read.
  const [buyAgainBusy, setBuyAgainBusy] = useState(null);
  const buyAgain = useCallback((action) => {
    const item = items.find((i) => i.kind === action.kind && i.id === action.ref_id);
    if (!item) {
      // The server said this was buyable when it built the receipt; if the
      // catalogue in this tab disagrees it is stale, and adding a line we
      // cannot price would be worse than saying so.
      toast.error("That item is no longer available");
      return;
    }
    setBuyAgainBusy(action.ref_id);
    trackShop({ event: "buy_again", kind: action.kind, ref_id: action.ref_id,
                quantity: Math.max(1, action.quantity || 1) });
    addToCart(item, Math.max(1, action.quantity || 1));
    setOrdersOpen(false);
    setCartOpen(true);
    setBuyAgainBusy(null);
  }, [items]);

  const openEnrolledCourse = useCallback((enrollmentId) => {
    // School's OWN selection key, rather than a second routing mechanism.
    try { sessionStorage.setItem(SELECTED_ENROLLMENT_KEY, enrollmentId); } catch { /* ignore */ }
    onGoToOnlineSchool?.();
  }, [onGoToOnlineSchool]);
  // Shop Appearance & Organization settings — read via the public/no-auth
  // /settings/public endpoint (works in every mode, including guest) so
  // title/subtitle/banner/landing-mode/section labels/order/visibility all
  // apply consistently everywhere this component is mounted. Defaults to
  // {} until loaded so every `!== false` check below defaults sensibly true.
  const [shopPage, setShopPage] = useState({});
  useEffect(() => {
    api.get("/settings/public")
      .then(({ data }) => setShopPage(data.shop_page || {}))
      .catch(() => setShopPage({}));
  }, []);
  // Shop category/subcategory navigation, additive to the existing kind tabs
  // above. categoryFilter === "" means no category is selected — whether
  // that shows category cards to click through or a flat grid of every item
  // is the separate showAllItems flag below (see its own comment). A
  // subcategory filter only ever applies once a category is chosen, and is
  // cleared whenever the category changes.
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [subcategoryFilter, setSubcategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  // Departments replace the old kind-named tabs. `null` is the storefront
  // front page; a key is a department. Read from the URL on first render so
  // a department link is shareable and survives a reload, which is the whole
  // difference between a shop and a filter.
  const [department, setDepartment] = useState(() => {
    if (typeof window === "undefined") return null;
    return resolveDepartmentParam(new URLSearchParams(window.location.search));
  });
  const [sort, setSort] = useState("featured");
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Filtering and sorting are reported as "somebody used this control",
  // never as what they chose to see — the useful business question is
  // whether the controls earn their place on the page, and the answer does
  // not need anyone's browsing preferences stored alongside it.
  const changeSort = useCallback((next) => {
    trackShop({ event: "sort_used", department: department || undefined });
    setSort(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department]);
  const changeFilters = useCallback((next) => {
    trackShop({ event: "filter_used", department: department || undefined });
    setFilters(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department]);
  // Phase 5 — Online School commerce. Only the authenticated client's own
  // dogs (server already scopes GET /dogs by owner for role="client",
  // same endpoint Portal.jsx itself uses) — needed for the dog-selection
  // step on an online_school-fulfillment program and to label cart lines.
  const [dogs, setDogs] = useState([]);

  /* Start Free Course — the claim path. Deliberately NOT the cart: a free
     course has no line, no total and no order, so nothing here touches
     checkout. The server does every eligibility check and is idempotent, so
     a double-click converges on the enrollment that already exists rather
     than creating a second one. */
  const [freeClaim, setFreeClaim] = useState(null);      // success card payload
  const [claiming, setClaiming] = useState(false);
  const claimFreeCourse = async (item, dogId) => {
    if (claiming) return;                                 // local double-click guard
    setClaiming(true);
    try {
      const { data } = await api.post("/shop/free-course/claim", { program_id: item.id, dog_id: dogId });
      setFreeClaim({ ...data, program: item });
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : d?.message || "Couldn't start this course — try again.");
    } finally {
      setClaiming(false);
    }
  };
  useEffect(() => {
    if (mode !== "authenticated") return;
    api.get("/dogs").then(({ data }) => setDogs(data || [])).catch(() => {});
  }, [mode]);
  // Cart is controlled by the parent (Portal.jsx) when cart/onCartChange are
  // passed, so it survives leaving/returning to this view — still the ONE
  // cart, just lifted, not a second one. Falls back to local state so this
  // component still works standalone if ever used without those props.
  const [localCart, setLocalCart] = useState([]); // [{kind, ref_id, quantity}]
  const cart = cartProp !== undefined ? cartProp : localCart;
  const setCart = onCartChange || setLocalCart;
  const [cartOpen, setCartOpen] = useState(false);
  // Guest checkout is its own step rather than part of the cart: it has to
  // ask for an email, and it re-prices server-side before anything is paid.
  const [guestCheckoutOpen, setGuestCheckoutOpen] = useState(false);
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
    const target = shopBackTarget({
      hasOwnHistoryEntry: !!window.history.state?.shDetail,
      kind: detail?.kind,
    });
    if (target.action === "back") {
      window.history.back();
    } else {
      window.history.pushState({}, "", target.path);
      if (target.tab) setTab(target.tab);
      setDetail(null);
    }
    setTimeout(() => {
      document.querySelector("[data-scroll-root]")?.scrollTo({ top: detailScrollRef.current });
    }, 0);
  };

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  // preview mode reuses the exact same admin-only catalog-preview/taxonomy-
  // preview endpoints Shop Manager's Client Preview tab already used — same
  // _build_shop_catalog/_shop_taxonomy_payload the real client hits, so this
  // is never a fake approximation. guest mode fetches ONLY the allowlisted
  // public endpoints (Phase 2a) — never the authenticated /shop/* routes,
  // which 403 without a client session anyway.
  const catalogUrl = mode === "preview" ? "/shop-manager/catalog-preview" : mode === "guest" ? "/public/shop/catalog" : "/shop/catalog";
  const catalogParams = mode === "preview" && previewClientId ? { preview_client_id: previewClientId } : {};
  const taxonomyUrl = mode === "preview" ? "/shop-manager/catalog-preview-taxonomy" : mode === "guest" ? "/public/shop/taxonomy" : "/shop/catalog/taxonomy";

  const load = () => {
    setLoading(true);
    api.get(catalogUrl, { params: catalogParams })
      .then(({ data }) => {
        const loaded = data.items || [];
        setItems(loaded);
        // Hand the catalog to whoever wrapped us. PublicShop needs it to
        // find the free course for its hero, and was fetching the whole
        // catalog a second time to get it.
        onItemsLoaded?.(loaded);
      })
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load the shop"))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [mode, previewClientId]);
  useEffect(() => {
    api.get(taxonomyUrl)
      .then(({ data }) => setCategories(data.categories || []))
      .catch(() => setCategories([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // show_out_of_stock=false hides tracked-inventory out-of-stock products
  // from browse grids/cards/counts ONLY — never from a direct item-detail
  // link (that uses the full `items` list untouched, see ShopItemDetail),
  // and never from cart resolution (a client with one already in their cart
  // must still be able to see/manage that line).
  const browsableItems = useMemo(() => {
    if (shopPage.show_out_of_stock !== false) return items;
    // Guest items carry no track_inventory/in_stock (see Phase 2a's public
    // allowlist) — only the computed `availability` string.
    if (mode === "guest") return items.filter((i) => !(i.kind === "product" && i.availability === "out_of_stock"));
    return items.filter((i) => !(i.kind === "product" && i.track_inventory && !i.in_stock));
  }, [items, shopPage.show_out_of_stock, mode]);



  // Tab-button row + breadcrumb labels — permanent `key`s from TABS, but
  // the displayed label/order come from settings (sectionMetaFor), falling
  // back to TABS' own hardcoded strings when unconfigured.
  // Only departments with something in them, and only those the admin's
  // existing section switches allow. Asked of the real catalog every time
  // rather than hardcoded, so an empty Shop shows no empty shelves.
  const departments = useMemo(() => visibleDepartments(browsableItems, {
    sectionVisible: (sectionKey) =>
      ((shopPage.sections || {})[sectionKey] || {}).visible !== false,
  }), [browsableItems, shopPage]);

  // Changing department resets filters, because a category filter from Gear
  // means nothing in Training and silently hiding half of a department the
  // shopper just opened is the sort of thing that reads as a bug.
  const selectDepartment = useCallback((key) => {
    if (key) trackShop({ event: "department_view", department: key });
    setDepartment(key || null);
    setFilters(EMPTY_FILTERS);
    setSearch("");
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (key) params.set("dept", key); else params.delete("dept");
      params.delete("section"); params.delete("tab");
      const q = params.toString();
      window.history.pushState({}, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
    try { document.querySelector("[data-scroll-root]")?.scrollTo({ top: 0, behavior: "smooth" }); }
    catch { /* not fatal */ }
  }, []);

  // Back/forward must move between departments, not just between the Shop
  // and the item pages.
  useEffect(() => {
    const onPop = () => {
      setDepartment(resolveDepartmentParam(new URLSearchParams(window.location.search)));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const browsing = useMemo(
    () => browseItems(browsableItems, { department, query: search, filters, sort }),
    [browsableItems, department, search, filters, sort],
  );
  const currentDept = departmentByKey(department);

  // Products that were genuinely on screen. Deduplicated per view CONTEXT
  // (this department, this search), so scrolling a grid counts each product
  // once, opening a different department counts them again because it is a
  // different list, and a re-render counts nothing at all.
  useEffect(() => {
    if (!analyticsOn || loading) return;
    trackImpressions(browsing.slice(0, 24), { department: department || "", search });
  }, [analyticsOn, loading, browsing, department, search]);

  // One search event per settled query, not one per keystroke. The debounce
  // is what makes the report a list of things people searched for rather
  // than a list of prefixes they typed on the way.
  const lastSearchRef = useRef("");
  useEffect(() => {
    if (!analyticsOn) return undefined;
    const query = search.trim();
    if (!query || query === lastSearchRef.current) return undefined;
    const id = setTimeout(() => {
      lastSearchRef.current = query;
      const count = browsing.length;
      trackShop({ event: "search", query, result_count: count,
                  department: department || undefined });
      if (count === 0) {
        // The most useful row in the whole dashboard: something a customer
        // expected to find here and did not.
        trackShop({ event: "search_zero_results", query, result_count: 0,
                    department: department || undefined });
      }
    }, 900);
    return () => clearTimeout(id);
  }, [analyticsOn, search, browsing.length, department]);

  // What one visit costs normally, so a prepaid pack can say what it saves
  // — and say nothing when the catalog cannot prove it. Never invented: if
  // no single-visit price exists, this is undefined and no saving shows.
  const baselineVisitPrice = useMemo(() => {
    const singles = itemsInDepartment(browsableItems, "prepaid")
      .map((p) => ({ qty: Number(p.display_quantity ?? p.qty ?? 0), price: Number(p.price || 0) }))
      .filter((p) => p.qty === 1 && p.price > 0);
    return singles.length ? Math.max(...singles.map((p) => p.price)) : undefined;
  }, [browsableItems]);


  // "" means no category filter is set. Whether that renders the
  // category/section index (cards to click through) or a flat grid of every
  // item in the tab is a SEPARATE, explicit choice — showAllItems — so
  // categoryFilter === "" doesn't automatically mean "show every product".
  // Reset whenever the top-level tab changes so a stale "View All" doesn't
  // leak into a freshly selected section.
  const [showAllItems, setShowAllItems] = useState(false);





  const searching = search.trim().length > 0;

  const filtered = useMemo(() => {
    let list = itemsForTab(browsableItems, tab);
    // A search always scopes to the whole active tab, ignoring whatever
    // category/subcategory was selected before typing — see the search
    // input's comment above for why.
    if (!searching) {
      if (categoryFilter === OTHER_CATEGORY_ID) {
        list = list.filter((i) => !i.category_id);
      } else if (categoryFilter) {
        list = list.filter((i) => i.category_id === categoryFilter);
      }
      if (subcategoryFilter) list = list.filter((i) => i.subcategory_id === subcategoryFilter);
    }
    list = list.filter((i) => matchesSearchQuery(i, search));
    return sortShopItems(list);
  }, [browsableItems, tab, categoryFilter, subcategoryFilter, search, searching]);

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);
  const { lines: cartLines, subtotal: cartSubtotal } = useCartLines(cart, items, dogs);

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

  // Phase 5 — Online School commerce. `dogId` is only ever set for a
  // training_program line whose program is purchase_fulfillment=
  // "online_school" (see ShopItemDetail's dog selector); every other line
  // passes it as undefined and behaves byte-identically to before. Cart-
  // line identity includes dogId so two different dogs buying the SAME
  // program stay as two separate lines — matches the server's own
  // dog_id-aware _normalize_cart_lines aggregation key.
  const addToCart = (item, qty = 1, dogId = undefined, gift = undefined) => {
    const ceiling = stockCeiling(item);
    // A gift card for Dana and one for Sam are different things even at the
    // same value, so the recipient is part of what makes a cart line the
    // same line — matching how the server keys them.
    const sameLine = (c) => c.kind === item.kind && c.ref_id === item.id
      && c.dog_id === dogId && cartGiftKey(c.gift) === cartGiftKey(gift);
    const existingQty = cart.find(sameLine)?.quantity || 0;
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
      const existing = prev.find(sameLine);
      if (existing) {
        return prev.map((c) => (c === existing ? { ...c, quantity: nextQty } : c));
      }
      return [...prev, { kind: item.kind, ref_id: item.id, quantity: nextQty, dog_id: dogId, gift }];
    });
    // The reference and how many. Deliberately not the gift fields beside
    // it — a recipient's name and address are exactly what analytics must
    // never carry, and the server would refuse them anyway.
    trackShop({ event: "add_to_cart", kind: item.kind, ref_id: item.id, quantity: qty });
    idemKeyRef.current = null; // cart changed — a fresh checkout attempt needs a fresh key
    pulseTray();
  };

  const changeQty = (kind, refId, qty, dogId = undefined, gift = undefined) => {
    idemKeyRef.current = null;
    // Must match addToCart's identity exactly, or changing the quantity on
    // Dana's card silently changes Sam's as well.
    const sameLine = (c) => c.kind === kind && c.ref_id === refId
      && c.dog_id === dogId && cartGiftKey(c.gift) === cartGiftKey(gift);
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => !sameLine(c)));
      return;
    }
    const item = items.find((i) => i.kind === kind && i.id === refId);
    const ceiling = stockCeiling(item);
    if (ceiling != null && qty > ceiling) {
      toast.error(`Only ${ceiling} are currently available`);
      qty = ceiling;
    }
    setCart((prev) => prev.map((c) => (sameLine(c) ? { ...c, quantity: qty } : c)));
  };

  const removeFromCart = (kind, refId, dogId = undefined, gift = undefined) => {
    idemKeyRef.current = null;
    trackShop({ event: "remove_from_cart", kind, ref_id: refId });
    setCart((prev) => prev.filter((c) => !(c.kind === kind && c.ref_id === refId
      && c.dog_id === dogId && cartGiftKey(c.gift) === cartGiftKey(gift))));
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
    if (mode === "guest") {
      // A guest pays through the public endpoint, which prices the basket
      // again and refuses anything that needs an account. Opening the panel
      // is all this does — the panel itself does the asking and the paying.
      setCartOpen(false);
      setGuestCheckoutOpen(true);
      return;
    }
    // Preview mode never calls the real checkout endpoint: there is no
    // client session to charge.
    if (mode !== "authenticated") return;
    if (!idemKeyRef.current) idemKeyRef.current = crypto.randomUUID();
    // One per ATTEMPT, keyed on the same idempotency key the server uses to
    // recognise a retry — so a customer who presses Checkout twice is one
    // checkout start, not two, without the browser having to remember.
    // Note what is NOT reported: completion. A browser may say an attempt
    // began; only the payment path may say an order was paid.
    trackShop({ event: "checkout_started", dedupe_key: idemKeyRef.current,
                quantity: cartCount });
    flushShopEvents();
    setCheckoutBusy(true);
    try {
      const { data } = await api.post("/shop/checkout", {
        // The gift travels with the line. Leaving it out here is how a
        // recipient silently becomes the buyer.
        items: cart.map((c) => ({
          kind: c.kind, ref_id: c.ref_id, quantity: c.quantity, dog_id: c.dog_id,
          recipient_email: c.gift?.recipient_email || null,
          recipient_name: c.gift?.recipient_name || null,
          gift_message: c.gift?.gift_message || null,
        })),
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

  // The tab title and the rendered-page tags. Social preview bots never run
  // this — they read the server-rendered document (backend domains/shop/seo)
  // — but Googlebot does, and so does every bookmark and browser tab.
  // Deliberately suppressed on the item-detail branch, where ShopItemDetail
  // describes the item it actually loaded rather than guessing from a route.
  useDocumentMeta({
    ...shopMetaFor({
      department: detail ? null : department,
      shopPage,
      origin: publicOrigin(),
    }),
    // An account-only storefront is not for search engines. The public one
    // is, and it is the same component — so the flag follows the mode.
    noindex: mode !== "guest",
    enabled: !detail && mode !== "preview",
  });

  // One set of props for every card the shop draws outside the main grid —
  // the recommendation rows, the recently-viewed row, the saved-items page.
  // Sharing it is what keeps a card in a suggestion row behaving exactly
  // like the same card in the grid, heart and all.
  const cardProps = {
    mode, onOpenDetail: openDetail, onAdd: addToCart,
    onRequireAccount, onShopify: openShopifyListing, favoriteSlot, bestSellerIds,
  };

  // "Pick up where you left off" on the front page. No product page is being
  // viewed here, so this asks only for the recently-viewed resolution — and
  // asks for nothing at all when this browser has remembered nothing.
  const landingDiscovery = useDiscovery({
    kind: null, refId: null, clientId, guest: mode === "guest",
    enabled: mode !== "preview",
  });

  return (
    <div id="portal-shop-anchor" data-testid="portal-shop"
         className={fullScreen ? "w-full max-w-6xl mx-auto" : "p-6 rounded-2xl border border-shBorder shadow-sh"}
         style={fullScreen ? undefined : { background: "var(--sh-card-base)" }}>
      {mode === "preview" && (
        <div className="mb-4 border border-shSecondary/40 bg-shSecondary/10 rounded-lg p-3 text-center" data-testid="shop-preview-banner">
          <p className="text-shSecondary text-[11px] font-black uppercase tracking-widest">
            <i className="fas fa-eye mr-1.5" />Preview Only — no real orders will be created
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mb-1 gap-2">
        {/* The storefront hero says the shop's name and strapline. Repeating
            them here made three copies of the same two lines above the fold
            — this row keeps only what the hero cannot carry: the account
            actions. Inside a department the heading is the department, so
            they are not repeated there either. */}
        <div aria-hidden="true" />
        <div className="flex items-center gap-2">
          {isRealClient && (
            <button onClick={() => { setFavoritesOpen((v) => !v); setOrdersOpen(false); }}
                    data-testid="shop-saved-toggle"
                    aria-expanded={favoritesOpen}
                    className="border border-shBorder text-shTextMuted hover:text-shText px-3 py-2 min-h-[44px] inline-flex items-center rounded-md text-[11px] font-bold uppercase tracking-widest hover:border-shPrimary/50 transition"
                    style={{ background: "var(--sh-card-base)" }}>
              <i className={`${favorites.count > 0 ? "fas" : "far"} fa-heart mr-1`} aria-hidden="true" />
              Saved{favorites.count > 0 && <span className="hidden sm:inline"> ({favorites.count})</span>}
            </button>
          )}
          <button onClick={() => { setOrdersOpen((o) => !o); setFavoritesOpen(false); }} data-testid="shop-my-orders-toggle"
                  className="border border-shBorder text-shTextMuted hover:text-shText px-3 py-2 min-h-[44px] inline-flex items-center rounded-md text-[11px] font-bold uppercase tracking-widest hover:border-shPrimary/50 transition"
                  style={{ background: "var(--sh-card-base)" }}>
            <i className="fas fa-receipt mr-1" />My Orders
          </button>
          <button onClick={() => { trackShop({ event: "cart_view", quantity: cartCount }); setCartOpen(true); }}
                  data-testid="shop-cart-open"
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

      {/* Shop banner — heading/image/CTA, all admin-configured via
          shop_page.banner_*. Rendered only when there's something to show. */}
      {(shopPage.banner_image_id || shopPage.banner_heading) && (
        <div className="mb-4 rounded-2xl border border-shBorder overflow-hidden relative" data-testid="shop-banner">
          <ItemThumbnail imageId={shopPage.banner_image_id} alt={shopPage.banner_heading || "Shop banner"} variant="banner" size={220} className="w-full" public={mode === "guest"} />
          {(shopPage.banner_heading || (shopPage.banner_cta_text && shopPage.banner_cta_url)) && (
            <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
              {shopPage.banner_heading && <p className="text-shText font-black text-lg">{shopPage.banner_heading}</p>}
              {shopPage.banner_cta_text && shopPage.banner_cta_url && (
                shopPage.banner_cta_url.startsWith("https://") ? (
                  <a href={shopPage.banner_cta_url} target="_blank" rel="noopener noreferrer" data-testid="shop-banner-cta"
                     className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest">
                    {shopPage.banner_cta_text}
                  </a>
                ) : shopPage.banner_cta_url.startsWith("/") && !shopPage.banner_cta_url.startsWith("//") ? (
                  <a href={shopPage.banner_cta_url} data-testid="shop-banner-cta"
                     className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest">
                    {shopPage.banner_cta_text}
                  </a>
                ) : null
              )}
            </div>
          )}
        </div>
      )}

      {favoritesOpen && isRealClient && (
        <div className="mb-4 border border-shBorder rounded-xl p-4" style={{ background: "var(--sh-card-base)" }}
             data-testid="shop-saved-panel">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-shText font-bold uppercase tracking-widest text-sm">Saved Items</h2>
            <button onClick={() => setFavoritesOpen(false)} data-testid="shop-saved-close"
                    aria-label="Close saved items"
                    className="text-shTextMuted hover:text-shText focus-visible:outline-none
                               focus-visible:ring-2 focus-visible:ring-shPrimary rounded px-2 py-1">
              <i className="fas fa-xmark" aria-hidden="true" />
            </button>
          </div>
          <FavoritesList
            favorites={favoriteItems}
            loading={favoriteItems === null}
            cardProps={cardProps}
            onRemove={toggleFavorite}
            onBrowse={() => setFavoritesOpen(false)}
          />
        </div>
      )}

      {ordersOpen && (
        <div className="mb-4 border border-shBorder rounded-xl p-4" style={{ background: "var(--sh-card-base)" }}
             data-testid="shop-my-orders-panel">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-shText font-bold uppercase tracking-widest text-sm">My Orders</h2>
            <button onClick={() => setOrdersOpen(false)} data-testid="shop-my-orders-close"
                    aria-label="Close orders"
                    className="text-shTextMuted hover:text-shText focus-visible:outline-none
                               focus-visible:ring-2 focus-visible:ring-shPrimary rounded px-2 py-1">
              <i className="fas fa-xmark" aria-hidden="true" />
            </button>
          </div>
          <MyOrders
            orders={orders}
            onRefresh={loadOrders}
            onBuyAgain={buyAgain}
            onOpenItem={(a) => { setOrdersOpen(false); openDetail({ kind: a.kind, id: a.ref_id }); }}
            onOpenCourse={(a) => openEnrolledCourse(a.enrollment_id)}
            onOpenCredits={onGoToCredits}
            busyRef={buyAgainBusy}
          />
        </div>
      )}

      {/* You're in! — a free claim ends in School, never in a $0 receipt. */}
      {freeClaim ? (
        <div className="max-w-lg mx-auto text-center py-10" data-testid="free-course-success">
          <div className="w-16 h-16 rounded-2xl mx-auto grid place-items-center border border-shPrimary/35 bg-shPrimary/10">
            <i className="fas fa-graduation-cap text-shPrimary text-[22px]" />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-shPrimary mt-4">
            {freeClaim.created ? "You're in!" : "Already yours"}
          </p>
          <h2 className="text-[22px] sm:text-[26px] font-black text-shText mt-1.5 leading-tight text-balance">
            {freeClaim.program_name || freeClaim.program?.name}
          </h2>
          <p className="text-[13px] text-shTextMuted mt-2 leading-relaxed">
            {freeClaim.dog_name
              ? `${freeClaim.dog_name}'s course is ready in School.`
              : "Your course is ready in School."}
          </p>
          <PremiumButton variant="primary" data-testid="free-course-start-lesson"
                         onClick={() => {
                           /* Land on the course they just claimed, not on
                              whichever enrollment School last had selected.
                              Uses School's OWN selection key rather than a
                              second routing mechanism. */
                           try { sessionStorage.setItem(SELECTED_ENROLLMENT_KEY, freeClaim.school_enrollment_id); } catch { /* ignore */ }
                           setFreeClaim(null);
                           onGoToOnlineSchool?.();
                         }}
                         className="w-full sm:w-auto sm:px-8 justify-center py-3 mt-6">
            <i className="fas fa-play mr-1.5 text-[11px]" />Start Lesson 1
          </PremiumButton>
          <button type="button" onClick={() => setFreeClaim(null)} data-testid="free-course-back-to-shop"
                  className="block mx-auto mt-4 min-h-[44px] text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">
            Back to Shop
          </button>
        </div>
      ) : detail ? (
        <ShopItemDetail
          kind={detail.kind}
          itemId={detail.id}
          cart={cart}
          onAddToCart={addToCart}
          onBack={closeDetail}
          allItems={items}
          onOpenItem={openDetail}
          mode={mode}
          onRequireAccount={onRequireAccount}
          onGoToOnlineSchool={onGoToOnlineSchool}
          onClaimFreeCourse={claimFreeCourse}
          onAddDog={onAddDog}
          dogs={dogs}
          favoriteSlot={favoriteSlot}
          discoverySlot={<DetailDiscovery detail={detail} clientId={clientId} mode={mode}
                                          cardProps={cardProps} />}
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

      {loading && (
        <div className="space-y-6" data-testid="shop-loading">
          <div className="h-40 sm:h-52 rounded-2xl bg-white/5 animate-pulse motion-reduce:animate-none" />
          <ProductGrid items={[]} layout="grid" loading skeletonCount={8} />
        </div>
      )}
      {!loading && err && (
        <p className="text-shDanger text-sm text-center py-6" role="alert">{err}</p>
      )}

      {/* ── the storefront front page ──
          No department chosen and nothing searched: merchandising, not a
          filtered list. This is what replaced a page whose first product sat
          two screens down on a phone. */}
      {!loading && !err && !department && !searching && (
        <ShopLanding
          items={browsableItems}
          departments={departments}
          shopPage={shopPage}
          mode={mode}
          baselineVisitPrice={baselineVisitPrice}
          schoolStats={schoolStats}
          onSelectDepartment={selectDepartment}
          onOpenDetail={openDetail}
          onAdd={addToCart}
          onRequireAccount={onRequireAccount}
          onShopify={openShopifyListing}
          favoriteSlot={favoriteSlot}
          bestSellerIds={bestSellerIds}
          recentlyViewed={
            <RecentlyViewed items={landingDiscovery.recentlyViewed} cardProps={cardProps} />
          }
        />
      )}

      {/* ── inside a department, or searching ── */}
      {!loading && !err && (department || searching) && (
        <div data-testid="shop-department-view">
          <DepartmentNav departments={departments} current={department}
                         onSelect={selectDepartment} />

          {currentDept && !searching && (
            <div className="mt-5 mb-1">
              <h1 className="sh-display text-[26px] sm:text-[32px] text-shText leading-tight">
                {currentDept.label}
              </h1>
              <p className="text-[13.5px] text-shTextMuted mt-1">{currentDept.tagline}</p>
            </div>
          )}

          <div className="flex items-center gap-2 mt-4 mb-5">
            <ShopSearch value={search} onChange={setSearch} resultCount={browsing.length} />
            <FilterControls items={itemsInDepartment(browsableItems, department)}
                            filters={filters} onChange={changeFilters} compact />
            <SortSelect value={sort} onChange={changeSort} />
          </div>

          <div className="flex gap-7 items-start">
            <FilterControls items={itemsInDepartment(browsableItems, department)}
                            filters={filters} onChange={changeFilters} />

            <div className="flex-1 min-w-0">
              {/* Online School keeps its own, stronger educational sell —
                  the brief is explicit that it should not be flattened into
                  a product grid. Only its chrome is unified. */}
              {department === "online_school" && !searching ? (
                <OnlineSchoolStorefront
                  items={browsing}
                  mode={mode}
                  onOpenDetail={openDetail}
                  showHero={mode !== "guest"}
                />
              ) : browsing.length === 0 ? (
                <div className="py-14 text-center" data-testid="shop-empty">
                  <i className="fas fa-magnifying-glass text-shTextMuted/40 text-2xl" aria-hidden="true" />
                  <p className="text-[15px] font-bold text-shText mt-3">
                    {searching ? `Nothing matches “${search}”` : "Nothing here just yet"}
                  </p>
                  <p className="text-[13px] text-shTextMuted mt-1.5 max-w-[42ch] mx-auto">
                    {searching
                      ? "Try a shorter word, or browse a department below."
                      : "We are restocking this one — the rest of the shop is open."}
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center mt-5">
                    {searching && (
                      <button type="button" onClick={() => setSearch("")}
                              data-testid="shop-empty-clear"
                              className="px-4 py-2.5 rounded-xl bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest">
                        Clear search
                      </button>
                    )}
                    {activeFilterCount(filters) > 0 && (
                      <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}
                              data-testid="shop-empty-reset-filters"
                              className="px-4 py-2.5 rounded-xl border border-shBorder text-shText text-[12px] font-black uppercase tracking-widest">
                        Reset filters
                      </button>
                    )}
                    <button type="button" onClick={() => selectDepartment(null)}
                            data-testid="shop-empty-home"
                            className="px-4 py-2.5 rounded-xl border border-shBorder text-shText text-[12px] font-black uppercase tracking-widest">
                      Back to the shop
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="sr-only" role="status" aria-live="polite">
                    {browsing.length} {browsing.length === 1 ? "product" : "products"}
                  </p>
                  <ProductGrid
                    items={browsing}
                    layout={searching ? "grid" : (currentDept?.layout || "grid")}
                    mode={mode}
                    baselinePrice={baselineVisitPrice}
                    onOpenDetail={openDetail}
                    onAdd={addToCart}
                    onRequireAccount={onRequireAccount}
                    onShopify={openShopifyListing}
                    favoriteSlot={favoriteSlot}
                    bestSellerIds={bestSellerIds}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {/* Reserves room below the last card so the persistent checkout tray
          (fixed, below) never covers it — matches the tray's own height at
          each breakpoint rather than a guess. */}
      {trayVisible && <div className="h-24 md:h-20" aria-hidden="true" />}

      {guestCheckoutOpen && (
        <GuestCheckoutPanel
          cart={cart}
          onClose={() => setGuestCheckoutOpen(false)}
          onSignIn={() => { setGuestCheckoutOpen(false); onRequireAccount?.(null, null); }}
          onRemoveLines={(lines) => {
            // Only the lines the SERVER named. Nothing else leaves the cart,
            // and the visitor is put back in it so they can see what is left.
            setCart((prev) => prev.filter((c) => !lines.some(
              (b) => b.kind === c.kind && b.ref_id === c.ref_id)));
            setGuestCheckoutOpen(false);
            setCartOpen(true);
          }}
        />
      )}
      {cartOpen && (
        <CartPanel
          lines={cartLines}
          subtotal={cartSubtotal}
          onQtyChange={changeQty}
          onRemove={removeFromCart}
          onCheckout={submitCheckout}
          busy={checkoutBusy}
          previewMode={mode === "preview"}
          guestMode={mode === "guest"}
          onSignIn={() => onRequireAccount?.(null, null)}
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
          previewMode={mode === "preview"}
          guestMode={mode === "guest"}
          onSignIn={() => onRequireAccount?.(null, null)}
        />
      )}
    </div>
  );
}
