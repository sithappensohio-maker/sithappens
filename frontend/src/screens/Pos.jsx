/* Front Desk — the unified Money Hub / front-desk checkout shell.
 *
 * This screen is a FRONT END to Sit Happens' existing authoritative systems.
 * It does NOT recompute booking/service pricing, credit eligibility, or
 * invoice math anywhere — those all continue to flow through the exact
 * same endpoints/components already in production:
 *   - Retail cart lines price + total server-side via POST /pos/sales/preview
 *     and commit via POST /pos/sales (new, this phase — the only genuinely
 *     new accounting surface here, and it writes exactly one retail_sales
 *     row per completed sale).
 *   - "Check Out Dog" launches the EXISTING <CheckoutModal> component
 *     unmodified — same credit deduction, pricing, add-ons, hardware tokens.
 *   - "Pay Invoice / Pay Tab" launches the EXISTING <TakePaymentModal>
 *     component unmodified.
 * Credits are never spendable on retail lines (matches existing business
 * rules — see the pos_sales trace notes) and are only ever shown/consumed
 * inside those embedded, unmodified components.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { emitRegisterChanged } from "../lib/registerBus";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import RegisterHub from "../components/RegisterHub";
import PendingActionsPanel from "../components/PendingActionsPanel";
import { CheckoutModal } from "../components/CheckoutModal";
import TakePaymentModal from "../components/TakePaymentModal";
import StripeRefundModal from "../components/StripeRefundModal";
import ShopRefundModal from "../components/ShopRefundModal";
import ItemThumbnail from "../components/ItemThumbnail";
import AdminBookingModal from "../components/AdminBookingModal";
import { RegisterTab } from "./Staff";
import {
  checkPosHealth,
  printReceipt as posPrintReceipt,
  openDrawer as posOpenDrawer,
} from "../lib/posAgent";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import { useConfirm } from "../lib/useConfirm";
import { classifyVisit, visitStatusLabel, visitCounts, filterVisits, sortVisits, isMissedCheckout } from "../lib/frontDeskVisits";
import { creditPackStaffLine } from "../lib/shopPolish";
import {
  FrontDeskStatCard, FrontDeskQuickAction, FrontDeskToolButton, FrontDeskStatusChip,
  FrontDeskDogAvatar, FrontDeskSectionHeader, CatalogCategoryTile,
} from "../components/frontdesk/FrontDeskBits";

// "card" here is a manually-recorded/offline card payment (external reader),
// not a Stripe Terminal integration.
const TENDER_LABELS = { cash: "Cash", card: "Card", check: "Check", venmo: "Venmo", paypal: "PayPal", other: "Other" };
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function Pos({ onOpenShopManager } = {}) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const canBookingEdit = can("booking_edit");
  // Permission-bug checkpoint: these used to gate on a blanket `role ===
  // "admin"` check, which — since every account that can even open Front
  // Desk has `role: "admin"` regardless of its restricted `staff_role` — showed
  // every one of these trusted-only controls to front-desk/trainer/care
  // staff too. Mapped onto the closest existing permission keys instead, so a
  // restricted staff_role (front_desk, trainer, daycare_staff, boarding_staff,
  // read_only — none of which carry these keys) no longer sees them, while
  // manager/owner (which do) are unaffected.
  const canDrawerAndRefunds = can("finance_reports");   // open drawer, Online Payments/refund panel
  const canPricingActions = can("pricing");             // manage products, custom item, discount
  const canVoid = can("delete_records");                // void a completed sale

  // ── Register + hardware status ──────────────────────────────────────────
  // Step 3: status fetching/opening/closed-banner UI moved into RegisterHub,
  // which pushes each status result back up via onStatusChange so the cart's
  // cash gating below keeps working from the same single fetch.
  const [registerStatus, setRegisterStatus] = useState(null);
  const [printerReady, setPrinterReady] = useState(null);
  // One register panel at a time. The active panel renders directly beneath
  // the register controls (see the render section), so opening one is always
  // visible regardless of how long Action Required / Today's Visits grow —
  // the fix for the "buttons look dead" 8,000px-jump regression, done in
  // layout instead of scrollIntoView.
  const [activePanel, setActivePanel] = useState(null);
  const toggleRegisterPanel = (key) => {
    const next = activePanel === key ? null : key;
    setActivePanel(next);
    // Small mobile courtesy only: block "nearest" is a no-op when the panel
    // (which sits directly beneath the controls) is already on screen, and a
    // minimal nudge when the stacked mobile header pushes it past the fold.
    // Never the old thousands-of-pixels jump.
    if (next) setTimeout(() => document.querySelector("[data-register-panel]")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
  };
  const drawerFormOpen = activePanel === "drawer";
  const recentOpen = activePanel === "recent";
  const onlinePaymentsOpen = activePanel === "payments";
  const onlineOrdersOpen = activePanel === "orders";
  const registerToolsOpen = activePanel === "tools";
  const [drawerReason, setDrawerReason] = useState("Make change");
  const [drawerCustomReason, setDrawerCustomReason] = useState("");
  const [drawerBusy, setDrawerBusy] = useState(false);
  // Register Tools remount key — the prominent Close Register button routes
  // into the EXISTING Close Day workflow by remounting RegisterTab with
  // sh_register_default_tab preset (its documented deep-link mechanism).
  const [registerToolsKey, setRegisterToolsKey] = useState(0);
  const registerToolsRef = useRef(null);
  useEffect(() => {
    const check = () => checkPosHealth().then((r) => setPrinterReady(r.ready));
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  const openCloseoutWorkflow = () => {
    try { localStorage.setItem("sh_register_default_tab", "closeout"); } catch { /* ignore */ }
    setActivePanel("tools");
    setRegisterToolsKey((k) => k + 1);
    // The tools panel now lives directly beneath the register controls, so
    // this is a small "make sure the panel header is on screen" nudge (a
    // no-op when it's already visible) — not the old 8,000px page jump.
    setTimeout(() => registerToolsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };

  const submitManualDrawer = async () => {
    const reason = drawerReason === "Other" ? drawerCustomReason.trim() : drawerReason;
    if (!reason || reason.length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    setDrawerBusy(true);
    try {
      const { data } = await api.post("/admin/pos/open-drawer", { reason });
      const result = await posOpenDrawer(data.open_drawer_token);
      if (result.ok) { toast.success("Drawer opened"); setActivePanel((cur) => (cur === "drawer" ? null : cur)); setDrawerCustomReason(""); }
      else toast.error(result.error || "Drawer failed to open");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not authorize drawer open");
    }
    setDrawerBusy(false);
  };

  const registerOpen = registerStatus?.status === "OPEN";

  // ── Today's Visits — the operational arrival/pickup roster ───────────────
  // A thin front-end over the EXISTING operational roster (GET
  // /employee/roster-today) and the EXISTING check-in/check-out endpoints —
  // checked_in_at/checked_out_at/status on the booking document remain the
  // only source of truth. Never a second attendance collection.
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [visitsTab, setVisitsTab] = useState("expected");
  const [visitsSearch, setVisitsSearch] = useState("");
  const [visitsExpanded, setVisitsExpanded] = useState(false);
  const VISITS_COLLAPSED_LIMIT = 5;
  const [checkInBusyId, setCheckInBusyId] = useState(null);
  const [quickCheckinOpen, setQuickCheckinOpen] = useState(false);
  // Front Desk V2 — "Book a Service" quick action opens the SAME existing
  // AdminBookingModal used everywhere else, just without the check-in preset.
  const [bookServiceOpen, setBookServiceOpen] = useState(false);
  // First-use staff guidance card — contextual help only, dismiss per visit.
  const [guideDismissed, setGuideDismissed] = useState(false);
  const visitsRef = useRef(null);
  const jumpToVisits = (tab) => {
    setVisitsTab(tab); setVisitsExpanded(false);
    setTimeout(() => visitsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };

  const loadRoster = () => api.get("/employee/roster-today")
    .then(({ data }) => { const rows = data.roster || []; setRoster(rows); return rows; })
    .catch(() => { setRoster([]); return []; })
    .finally(() => setRosterLoading(false));
  useEffect(() => { loadRoster(); }, []);
  // 45s cadence — a lean single-endpoint roster poll, not a dashboard-style
  // reload. Auto-pauses while CheckoutModal/AdminBookingModal hold the
  // shared edit lock (see useEditLock in those components).
  useLiveRefresh(loadRoster, { intervalMs: 45_000 });

  const rosterCounts = useMemo(() => visitCounts(roster), [roster]);
  // Overdue pickups — dogs still on-site past their stay's scheduled end.
  // Real roster data (isMissedCheckout), never a fabricated "pickups" metric.
  const overduePickups = useMemo(
    () => roster.filter((r) => classifyVisit(r) === "on_site" && isMissedCheckout(r)).length,
    [roster],
  );
  const visitsFiltered = useMemo(
    () => sortVisits(filterVisits(roster, visitsTab, visitsSearch), visitsTab),
    [roster, visitsTab, visitsSearch],
  );
  const visitsVisible = visitsExpanded ? visitsFiltered : visitsFiltered.slice(0, VISITS_COLLAPSED_LIMIT);

  const captureGeo = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
    );
  });
  const [checkoutLoadingId, setCheckoutLoadingId] = useState(null);

  // ── Product catalog ──────────────────────────────────────────────────────
  // Front Desk product/register-integration fix — this used to call
  // /pos/products (physical retail products only, and its own dead
  // free-text /pos/products/categories distinct-value list) which is why
  // items configured only as credit packs/training programs, or under the
  // real category taxonomy, never appeared here ("No products found" even
  // though items existed and were marked Show on Register). Now loads the
  // SAME canonical catalog Shop Manager/the client Shop already use
  // (products + credit packs + training programs, one `kind`-tagged list),
  // just filtered on show_at_register instead of show_online/
  // available_online — not a second product system.
  const [products, setProducts] = useState([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const loadProducts = (clientId) => {
    return api.get("/pos/catalog", { params: clientId ? { client_id: clientId } : {} })
      .then(({ data }) => { const items = data?.items || []; setProducts(items); return items; })
      .catch(() => { setProducts([]); return []; });
  };
  useEffect(() => { loadProducts(); }, []);

  // Cart lines snapshot their price at add-time, but switching which client
  // is selected (or clearing back to Walk-in) re-resolves grandfathered
  // pricing — without this, a line already in the cart would keep showing
  // its old price/badge even though the actual charge at checkout has moved
  // on, which is exactly the kind of mismatch a cashier must never see.
  const CATALOG_ID_FIELD = { retail: "product_id", credit_pack: "pack_id", training_program: "program_id" };
  const CATALOG_KIND_FOR_CART = { retail: "product", credit_pack: "credit_pack", training_program: "training_program" };
  const resyncCartPricing = (items) => {
    setCartLines((lines) => lines.map((l) => {
      const idField = CATALOG_ID_FIELD[l.kind];
      if (!idField) return l; // custom lines have no catalog counterpart
      const match = items.find((it) => it.kind === CATALOG_KIND_FOR_CART[l.kind] && it.id === l[idField]);
      if (!match) return l;
      return { ...l, unit_price: match.effective_price, list_price: match.list_price, has_price_override: match.has_price_override };
    }));
  };

  // Categories are generated from whatever's actually in the loaded
  // catalog's real taxonomy (category_id/category_name) — never hardcoded,
  // and never the old dead free-text `category` field new items don't set.
  const categoryPills = useMemo(() => {
    const map = new Map();
    for (const p of products) {
      if (!p.category_id) continue;
      if (!map.has(p.category_id)) map.set(p.category_id, { id: p.category_id, label: p.category_name || "Category", count: 0 });
      map.get(p.category_id).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory && p.category_id !== activeCategory) return false;
      if (!q) return true;
      const haystack = [p.name, p.description, p.sku, p.category_name, p.category, p.service_type, p.program_type]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [products, activeCategory, productSearch]);

  // Declared here (ahead of the Client panel section below) because the
  // cart/pricing logic that follows needs to read it — addItem's
  // client-required guard and the live pricing-preview effect both key off
  // which client (if any) is selected.
  const [selectedClient, setSelectedClient] = useState(null);

  // ── Cart ─────────────────────────────────────────────────────────────────
  const [cartLines, setCartLines] = useState([]);
  const [discount, setDiscount] = useState(null);
  const [priced, setPriced] = useState(null);

  // Maps a catalog item's `kind` ("product"|"credit_pack"|"training_program")
  // to the cart line "kind" + the id field that line stores it under. Retail
  // keeps its historical "retail"/"product_id" naming (unchanged wire shape
  // for /pos/sales); packs/programs are new cart line kinds.
  const CART_KIND = { product: "retail", credit_pack: "credit_pack", training_program: "training_program" };
  const CART_ID_FIELD = { retail: "product_id", credit_pack: "pack_id", training_program: "program_id" };

  const addItem = (item) => {
    const cartKind = CART_KIND[item.kind];
    if (cartKind !== "retail" && !selectedClient) {
      toast.error(item.kind === "credit_pack"
        ? "Select a client first — credit packs are tied to a client's account."
        : "Select a client first — training programs are tied to a client's account.");
      return;
    }
    if (item.kind === "product" && item.track_inventory) {
      const inCart = cartLines.find((l) => l.kind === "retail" && l.product_id === item.id)?.qty || 0;
      if (inCart + 1 > Number(item.stock_on_hand || 0) + 0.0005) {
        toast.error(`Only ${item.stock_on_hand} in stock for ${item.name}.`);
        return;
      }
    }
    const idField = CART_ID_FIELD[cartKind];
    setCartLines((lines) => {
      const idx = lines.findIndex((l) => l.kind === cartKind && l[idField] === item.id);
      if (idx >= 0) {
        const copy = [...lines];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...lines, {
        kind: cartKind, [idField]: item.id, name: item.name,
        unit_price: item.effective_price, list_price: item.list_price,
        has_price_override: item.has_price_override, qty: 1,
      }];
    });
  };
  const updateQty = (i, delta) => setCartLines((lines) => {
    const copy = [...lines];
    const nextQty = Math.round((copy[i].qty + delta) * 100) / 100;
    if (nextQty <= 0) { copy.splice(i, 1); return copy; }
    copy[i] = { ...copy[i], qty: nextQty };
    return copy;
  });
  const removeLine = (i) => setCartLines((lines) => lines.filter((_, idx) => idx !== i));
  const resetCart = () => { setCartLines([]); setDiscount(null); setPriced(null); };

  const [customOpen, setCustomOpen] = useState(false);
  // Step 4C-1 — a custom line must say what it IS: merchandise (taxable
  // retail goods) or a service (never sales-taxable). Structured — the
  // backend decides tax from this, never from the description text.
  const [customKind, setCustomKind] = useState("merchandise");
  const [customDesc, setCustomDesc] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customReason, setCustomReason] = useState("");
  const addCustom = () => {
    if (!customDesc.trim() || !(Number(customAmount) > 0) || customReason.trim().length < 3) {
      toast.error("Custom item needs a description, a positive amount, and a reason (3+ characters).");
      return;
    }
    setCartLines((lines) => [...lines, {
      kind: "custom", description: customDesc.trim(),
      custom_amount: Number(customAmount), custom_reason: customReason.trim(),
      custom_kind: customKind,
    }]);
    setCustomOpen(false); setCustomDesc(""); setCustomAmount(""); setCustomReason(""); setCustomKind("merchandise");
  };

  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountKind, setDiscountKind] = useState("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const applyDiscount = () => {
    if (!(Number(discountValue) > 0) || discountReason.trim().length < 3) {
      toast.error("Discount needs a positive value and a reason (3+ characters).");
      return;
    }
    setDiscount({ kind: discountKind, value: Number(discountValue), reason: discountReason.trim() });
    setDiscountOpen(false);
  };

  // One unified checkout — every cart line kind (retail, custom, credit
  // pack, training program) is priced and eventually submitted together in
  // ONE request to POST /pos/checkout, so a mixed cart is always exactly
  // one financial transaction (one sale, one receipt, one register event)
  // instead of several unrelated ones.
  const cartLinesPayload = () => cartLines.map((l) => {
    if (l.kind === "custom") return { kind: "custom", description: l.description, custom_amount: l.custom_amount, custom_reason: l.custom_reason, custom_kind: l.custom_kind || "merchandise" };
    if (l.kind === "credit_pack") return { kind: "credit_pack", pack_id: l.pack_id, qty: l.qty };
    if (l.kind === "training_program") return { kind: "training_program", program_id: l.program_id, qty: l.qty };
    return { kind: "retail", product_id: l.product_id, qty: l.qty };
  });

  useEffect(() => {
    if (cartLines.length === 0) { setPriced(null); return; }
    const t = setTimeout(() => {
      api.post("/pos/checkout/preview", { lines: cartLinesPayload(), discount, client_id: selectedClient?.id || null })
        .then(({ data }) => setPriced(data))
        .catch((e) => { toast.error(e?.response?.data?.detail || "Could not price the cart"); setPriced(null); });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cartLines), JSON.stringify(discount), selectedClient?.id]);

  // ── Client panel ─────────────────────────────────────────────────────────
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState([]);
  // Phase 6 — POS no longer downloads the full decorated client directory
  // just to find one customer. Debounced server search returns at most eight
  // matching rows and still includes the credit/account fields pricing needs.
  useEffect(() => {
    const needle = clientQuery.trim();
    if (needle.length < 2) { setClientResults([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get("/clients/options", { params: { q: needle, limit: 8 } })
        .then(({ data }) => { if (!cancelled) setClientResults(data || []); })
        .catch(() => { if (!cancelled) setClientResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clientQuery]);
  // Sourced from the SAME roster Today's Visits reads (never a second,
  // independently-fetched definition of "this client's bookings today") —
  // this is also how ongoing boarding stays that began before today stay
  // visible here, since the roster query itself now covers that range.
  const clientBookings = useMemo(
    () => (selectedClient ? roster.filter((r) => r.client_id === selectedClient.id) : []),
    [roster, selectedClient],
  );
  const [clientInvoice, setClientInvoice] = useState(null);
  const [clientInvoiceError, setClientInvoiceError] = useState(false);
  const refreshClientInvoice = (clientId) => {
    // Operational lookup gated by take_payments (not finance_reports) — a
    // cashier allowed to collect a payment can always see whether an unpaid
    // invoice exists. A failed request is an ERROR, never "no invoice".
    setClientInvoiceError(false);
    api.get(`/clients/${clientId}/open-invoices`)
      .then(({ data }) => {
        const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
        setClientInvoice(invoices.find((i) => i.balance > 0.005) || null);
      })
      .catch(() => { setClientInvoice(null); setClientInvoiceError(true); });
  };

  const pickClient = (c) => {
    setSelectedClient(c); setClientQuery("");
    // Re-resolve grandfathered/client-specific pricing for this client, and
    // re-price any lines already in the cart to match (see resyncCartPricing).
    loadProducts(c.id).then(resyncCartPricing);
    refreshClientInvoice(c.id);
  };
  const clearClient = () => {
    setSelectedClient(null); setClientInvoice(null);
    // Credit packs/training programs are always tied to a client account —
    // dropping to Walk-in means any such lines can no longer be sold.
    setCartLines((lines) => {
      const dropped = lines.filter((l) => l.kind === "credit_pack" || l.kind === "training_program");
      if (dropped.length > 0) toast.error("Removed credit packs/training programs from the cart — they require a client.");
      return lines.filter((l) => l.kind !== "credit_pack" && l.kind !== "training_program");
    });
    // Revert catalog + any remaining (retail) cart lines to standard walk-in pricing.
    loadProducts().then(resyncCartPricing);
  };

  const [checkoutBooking, setCheckoutBooking] = useState(null);
  const [services, setServices] = useState([]);
  useEffect(() => { api.get("/services").then(({ data }) => setServices(data || [])).catch(() => {}); }, []);
  const [showTakePayment, setShowTakePayment] = useState(false);

  // Shared by both Today's Visits' "Check Out" button and the client
  // panel's — fetches the full booking (credit_value/actual_price/add_ons/
  // etc., none of which the lean roster row carries) before opening the
  // existing CheckoutModal, so pricing/credits/discounts all resolve
  // exactly as they do everywhere else that opens this same modal.
  const openCheckoutFor = async (bookingId) => {
    setCheckoutLoadingId(bookingId);
    try {
      const { data } = await api.get(`/bookings/${bookingId}`);
      setCheckoutBooking(data);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Could not open checkout");
    }
    setCheckoutLoadingId(null);
  };

  const doCheckIn = async (row, vaccineAck = false) => {
    setCheckInBusyId(row.booking_id);
    try {
      const geo = await captureGeo();
      await api.post(`/bookings/${row.booking_id}/check-in`, { ...geo, vaccine_ack: vaccineAck });
      toast.success(`${row.dog_name} checked in`);
      loadRoster();
      if (selectedClient?.id === row.client_id) refreshClientInvoice(selectedClient.id);
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail?.code === "vaccine_warning") {
        const ok = await confirm({
          title: `Vaccine warning · ${detail.dog_name || row.dog_name}`,
          body: `${detail.message} Do not check in unless you have a verbal/written OK from the owner. Continue?`,
          confirmText: "Check in anyway",
          destructive: true,
        });
        if (ok) { await doCheckIn(row, true); return; }
        setCheckInBusyId(null);
        return;
      }
      toast.error(formatErr(detail) || "Check-in failed");
    }
    setCheckInBusyId(null);
  };

  // ── Tender / sale completion ─────────────────────────────────────────────
  const [tenderOpen, setTenderOpen] = useState(false);
  const [tenders, setTenders] = useState([]);
  const [tenderMethod, setTenderMethod] = useState("cash");
  const [tenderAmount, setTenderAmount] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [tenderNotes, setTenderNotes] = useState("");
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleResult, setSaleResult] = useState(null);
  const [saleIdemKey, setSaleIdemKey] = useState(() => crypto.randomUUID());
  const [hwBusy, setHwBusy] = useState({});
  const [emailBusy, setEmailBusy] = useState(false);
  const [receiptViewOpen, setReceiptViewOpen] = useState(null); // receipt payload JSON, or null

  const total = priced?.total ?? 0;
  const tenderedSoFar = tenders.reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, Math.round((total - tenderedSoFar) * 100) / 100);
  // Change owed to the client: cash physically handed over beyond what was
  // applied. Carried onto the sale-complete screen so the number the cashier
  // needs most doesn't vanish the moment the tender is added.
  const changeDue = Math.round(tenders.reduce(
    (s, t) => s + (t.method === "cash" && t.tendered_amount ? Math.max(0, t.tendered_amount - t.amount) : 0), 0,
  ) * 100) / 100;

  const openTender = () => {
    if (!priced || cartLines.length === 0) { toast.error("Add something to the cart first"); return; }
    setTenders([]); setTenderAmount(String(total)); setCashReceived(""); setTenderNotes(""); setTenderMethod("cash");
    setTenderOpen(true);
  };

  const addTender = () => {
    const amount = Number(tenderAmount);
    if (!(amount > 0)) { toast.error("Enter a positive amount"); return; }
    if (amount > remaining + 0.005) { toast.error(`Amount can't exceed the remaining ${money(remaining)} due`); return; }
    if (tenderMethod === "other" && !tenderNotes.trim()) { toast.error("A note is required for Other"); return; }
    const row = { method: tenderMethod, amount: Math.round(amount * 100) / 100, notes: tenderNotes.trim() || undefined };
    if (tenderMethod === "cash") {
      const received = Number(cashReceived || amount);
      if (received < amount - 0.005) { toast.error("Cash received cannot be less than the amount applied"); return; }
      row.tendered_amount = Math.round(received * 100) / 100;
    }
    setTenders((t) => [...t, row]);
    const left = Math.max(0, Math.round((remaining - amount) * 100) / 100);
    setTenderAmount(String(left));
    setCashReceived(""); setTenderNotes("");
  };
  const removeTender = (i) => setTenders((t) => t.filter((_, idx) => idx !== i));

  const completeSale = async () => {
    if (remaining > 0.005) { toast.error("Tenders must add up to the full total before completing the sale"); return; }
    setSaleBusy(true);
    try {
      // One request, one financial transaction — POST /pos/checkout prices,
      // validates tenders, creates the sale record, mints every credit-pack/
      // training-program entitlement, adjusts inventory, and returns one
      // receipt result, all as a single atomic, idempotent commit. See
      // create_pos_sale's docstring (backend/server.py) for the full
      // rollback discipline — a failure partway through can never leave a
      // half-completed sale, a double charge, or orphaned credits.
      const { data } = await api.post("/pos/checkout", {
        client_id: selectedClient?.id || null,
        lines: cartLinesPayload(),
        discount,
        tenders,
        idempotency_key: saleIdemKey,
      });
      setSaleResult(data);
      setTenderOpen(false);
      emitRegisterChanged(); // sale committed — refresh register displays
      // Post-commit, best-effort hardware — never affects the sale that already succeeded.
      if (data.pos_print_receipt_token) {
        const r = await posPrintReceipt(data.pos_print_receipt_token);
        if (!r.ok) toast.error(r.error || "Receipt printing failed");
      }
      if (data.pos_open_drawer_token) {
        const r = await posOpenDrawer(data.pos_open_drawer_token);
        if (!r.ok) toast.error(r.error || "Cash drawer failed to open");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not complete the sale");
    }
    setSaleBusy(false);
  };

  const retryHardware = async (action) => {
    if (!saleResult?.pos_sale_id) return;
    setHwBusy((b) => ({ ...b, [action]: true }));
    try {
      const { data } = await api.post(`/pos/sales/${saleResult.pos_sale_id}/pos-tokens`, { actions: [action] });
      const token = action === "print_receipt" ? data.print_receipt_token : data.open_drawer_token;
      const result = action === "print_receipt" ? await posPrintReceipt(token) : await posOpenDrawer(token);
      if (result.ok) toast.success(action === "print_receipt" ? "Receipt sent" : "Drawer opened");
      else toast.error(result.error || "Hardware action failed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not retry");
    }
    setHwBusy((b) => ({ ...b, [action]: false }));
  };

  const emailReceipt = async (posSaleId) => {
    setEmailBusy(true);
    try {
      const { data } = await api.post(`/receipts/pos_sale/${posSaleId}/email`, {});
      if (data.ok) toast.success("Receipt emailed");
      else toast.error(data.detail || "Could not email the receipt");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not email the receipt");
    }
    setEmailBusy(false);
  };

  const viewReceipt = async (posSaleId) => {
    try {
      const { data } = await api.get(`/receipts/pos_sale/${posSaleId}`);
      setReceiptViewOpen(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the receipt");
    }
  };

  const newSale = () => {
    setSaleResult(null);
    resetCart();
    clearClient();
    setSaleIdemKey(crypto.randomUUID());
    loadProducts(); // refresh stock counts — the just-completed sale may have changed them
  };

  // ── Register tools — the canonical till-adjustment/owner-draw/bank-deposit/
  // cash-expense/close-day/refund/sell-credits/record-payment/reports UI,
  // reused unmodified (see RegisterTab in Staff.jsx). Money Hub embeds this
  // directly instead of reimplementing any of it, per the consolidation
  // pass — "New Sale" is hidden here since this screen's own cart replaces it.

  // ── Recent sales ─────────────────────────────────────────────────────────
  const [recentSales, setRecentSales] = useState([]);
  const loadRecent = () => api.get("/pos/sales").then(({ data }) => setRecentSales(data || [])).catch(() => {});
  useEffect(() => { if (recentOpen) loadRecent(); }, [recentOpen]);
  useEffect(() => { if (saleResult) loadRecent(); }, [saleResult]);

  // ── Online payments (Stripe) — deliberately separate from Recent Sales.
  // Recent Sales is backed by pos_sales (the POS Register's own retail
  // history); stripe_online booking payments live in a different collection
  // (payments/invoices) entirely, so they get their own panel here rather
  // than being forced into that list. ──
  const [onlinePayments, setOnlinePayments] = useState([]);
  const loadOnlinePayments = () => api.get("/admin/stripe-online-payments", { params: { limit: 50 } })
    .then(({ data }) => setOnlinePayments(data.payments || [])).catch(() => {});
  useEffect(() => { if (onlinePaymentsOpen) loadOnlinePayments(); }, [onlinePaymentsOpen]);
  const [refundingPayment, setRefundingPayment] = useState(null);
  const [refundingShopPayment, setRefundingShopPayment] = useState(null);

  // ── Online Orders (Client Shop Phase 2) — paid shop_orders awaiting
  // pickup/fulfillment follow-up. Separate from both Recent Sales (pos_sales)
  // and Online Payments (the raw Stripe payment ledger) — this is the
  // operational "what do I hand the client" view. ──
  const [onlineOrders, setOnlineOrders] = useState([]);
  const [orderActionBusyId, setOrderActionBusyId] = useState(null);
  const [onlineOrdersUnseenCount, setOnlineOrdersUnseenCount] = useState(0);

  const refreshUnseenCount = useCallback(() => api.get("/admin/shop-orders/unseen-count", { sharedCache: "refresh" })
    .then(({ data }) => setOnlineOrdersUnseenCount(data.unseen || 0)).catch(() => {}), []);
  useEffect(() => { refreshUnseenCount(); }, [refreshUnseenCount]);

  // Never clear the badge before the order list has actually loaded — the
  // mark-seen call only fires inside this .then(), after a successful fetch,
  // for exactly the paid orders that came back with admin_unseen === true.
  const loadOnlineOrders = useCallback(() => api.get("/admin/shop-orders")
    .then(({ data }) => {
      const orders = data.orders || [];
      setOnlineOrders(orders);
      const newlyUnseenIds = orders.filter((o) => o.admin_unseen === true).map((o) => o.id);
      if (newlyUnseenIds.length > 0) {
        api.post("/admin/shop-orders/mark-seen", { order_ids: newlyUnseenIds })
          .then(() => {
            setOnlineOrders((prev) => prev.map((o) => (newlyUnseenIds.includes(o.id) ? { ...o, admin_unseen: false } : o)));
            refreshUnseenCount();
            window.dispatchEvent(new CustomEvent("sh:shop-orders-seen"));
          })
          .catch(() => {});
      }
    }).catch(() => {}), [refreshUnseenCount]);
  useEffect(() => { if (onlineOrdersOpen) loadOnlineOrders(); }, [onlineOrdersOpen, loadOnlineOrders]);

  const runOrderAction = async (orderId, action) => {
    setOrderActionBusyId(orderId);
    try {
      await api.post(`/admin/shop-orders/${orderId}/fulfillment`, { action });
      await loadOnlineOrders();
      toast.success(action === "retry_fulfillment" ? "Fulfillment retried" : "Order updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update this order");
    }
    setOrderActionBusyId(null);
  };

  const reprintSale = async (sale) => {
    try {
      const { data } = await api.post(`/pos/sales/${sale.id}/pos-tokens`, { actions: ["print_receipt"] });
      const result = await posPrintReceipt(data.print_receipt_token);
      if (result.ok) toast.success("Receipt sent to printer");
      else toast.error(result.error || "Reprint failed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not reissue print token");
    }
  };

  // Void — admin-only (matches backend require_admin), reason required.
  // Same-day only; the backend rejects once the business day is closed out
  // and directs to the financial-correction workflow instead.
  const [voidingSaleId, setVoidingSaleId] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const submitVoid = async (saleId) => {
    if (voidReason.trim().length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    setVoidBusy(true);
    try {
      const { data } = await api.post(`/pos/sales/${saleId}/void`, {
        reason: voidReason.trim(), idempotency_key: crypto.randomUUID(),
      });
      toast.success("Sale voided");
      emitRegisterChanged(); // void committed — refresh register displays
      if (data.pos_open_drawer_token) {
        const r = await posOpenDrawer(data.pos_open_drawer_token);
        if (!r.ok) toast.error(r.error || "Cash drawer failed to open for the void");
      }
      setVoidingSaleId(null); setVoidReason("");
      loadRecent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not void this sale");
    }
    setVoidBusy(false);
  };

  // ── Sale-complete screen ─────────────────────────────────────────────────
  if (saleResult) {
    const s = saleResult.sale;
    return (
      <div className="max-w-xl mx-auto space-y-4 animate-slide-in" data-testid="pos-sale-complete">
        <div className="bg-[var(--sh-card-base)] border border-shPrimary/40 rounded-2xl p-6 text-center">
          <i className="fas fa-circle-check text-shPrimary text-4xl mb-3" />
          <p className="text-shText text-xl font-black uppercase tracking-widest">Sale Complete</p>
          <p className="text-shTextMuted mt-1">Receipt #{s.receipt_number} · {money(s.total)}</p>
          {changeDue > 0.005 && (
            <div className="mt-3 bg-shPrimary/15 border border-shPrimary/50 rounded-xl py-3" data-testid="pos-complete-change-due">
              <p className="text-shTextMuted text-[12px] uppercase tracking-widest font-black">Give Change</p>
              <p className="text-shPrimary text-3xl font-black">{money(changeDue)}</p>
            </div>
          )}
        </div>
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-shTextMuted text-sm">Print receipt</span>
            <button onClick={() => retryHardware("print_receipt")} disabled={hwBusy.print_receipt}
                    className="text-shPrimary text-sm font-black uppercase tracking-widest disabled:opacity-50">
              {hwBusy.print_receipt ? "Sending…" : "Reprint"}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-shTextMuted text-sm">View receipt</span>
            <button onClick={() => viewReceipt(saleResult.pos_sale_id)} data-testid="pos-view-receipt"
                    className="text-shSecondary text-sm font-black uppercase tracking-widest">
              View
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-shTextMuted text-sm">Email receipt</span>
            <button onClick={() => emailReceipt(saleResult.pos_sale_id)} disabled={emailBusy} data-testid="pos-email-receipt"
                    className="text-shSecondary text-sm font-black uppercase tracking-widest disabled:opacity-50">
              {emailBusy ? "Sending…" : "Email"}
            </button>
          </div>
          {s.cash_component > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-shTextMuted text-sm">Cash drawer</span>
              <button onClick={() => retryHardware("open_drawer")} disabled={hwBusy.open_drawer}
                      className="text-shPrimary text-sm font-black uppercase tracking-widest disabled:opacity-50">
                {hwBusy.open_drawer ? "Opening…" : "Retry Open"}
              </button>
            </div>
          )}
        </div>
        <button onClick={newSale} data-testid="pos-new-sale"
                className="w-full bg-shPrimary text-bgHeader rounded-2xl py-4 font-black uppercase tracking-widest text-lg">
          New Sale
        </button>
        {receiptViewOpen && (
          <div className="fixed inset-0 bg-black/70 z-50 grid place-items-center p-4" onClick={() => setReceiptViewOpen(null)}>
            <div className="bg-white text-black rounded-lg p-5 max-w-sm w-full text-[13px]" onClick={(e) => e.stopPropagation()} data-testid="pos-receipt-view-modal">
              {receiptViewOpen.test_receipt && (
                <div className="bg-amber-200 text-amber-900 text-center font-black text-[10px] uppercase tracking-widest py-1 mb-2 rounded">{receiptViewOpen.test_label}</div>
              )}
              <p className="font-black text-base">{receiptViewOpen.business_name}</p>
              <p className="text-gray-500 mt-1">Receipt #{receiptViewOpen.receipt_number}</p>
              {receiptViewOpen.client_name && <p className="text-gray-500">Client: {receiptViewOpen.client_name}</p>}
              <div className="border-t border-gray-200 my-2" />
              {(receiptViewOpen.line_items || []).map((li, i) => (
                <div key={i} className="flex justify-between gap-2"><span>{li.description}{li.qty > 1 ? ` × ${li.qty}` : ""}</span><span className="font-bold">{money(li.amount)}</span></div>
              ))}
              <div className="border-t border-gray-200 my-2" />
              {receiptViewOpen.subtotal != null && (
                <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{money(receiptViewOpen.subtotal)}</span></div>
              )}
              {Number(receiptViewOpen.discount_amount || 0) > 0.005 && (
                <div className="flex justify-between text-gray-600"><span>Discount</span><span>-{money(receiptViewOpen.discount_amount)}</span></div>
              )}
              {receiptViewOpen.tax_amount != null && (
                <div className="flex justify-between text-gray-600"><span>Tax{receiptViewOpen.tax_rate_pct > 0 ? ` (${receiptViewOpen.tax_rate_pct}%)` : ""}</span><span>{money(receiptViewOpen.tax_amount)}</span></div>
              )}
              <div className="border-t border-gray-200 my-2" />
              <div className="flex justify-between font-black text-base"><span>Total</span><span>{money(receiptViewOpen.total || receiptViewOpen.invoice_total || receiptViewOpen.payment_amount)}</span></div>
              <button onClick={() => setReceiptViewOpen(null)} className="mt-4 w-full bg-gray-100 text-gray-700 rounded py-2 font-black uppercase text-[12px] tracking-widest">Close</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Tender screen ────────────────────────────────────────────────────────
  if (tenderOpen) {
    return (
      <div className="max-w-xl mx-auto space-y-4 animate-slide-in" data-testid="pos-tender-screen">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-6 text-center">
          <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black">Total Due</p>
          <p className="text-shText text-4xl font-black">{money(total)}</p>
          {tenders.length > 0 && (
            <p className="text-shPrimary text-sm mt-1">Remaining: {money(remaining)}</p>
          )}
        </div>

        {tenders.length > 0 && (
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 space-y-1">
            {tenders.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-shTextMuted">
                  {TENDER_LABELS[t.method]}{t.notes ? ` — ${t.notes}` : ""}
                  {t.method === "cash" && t.tendered_amount > t.amount && (
                    <span className="text-shPrimary ml-1">(received {money(t.tendered_amount)})</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-shText font-bold">{money(t.amount)}</span>
                  <button onClick={() => removeTender(i)} className="text-shTextMuted hover:text-shDanger"><i className="fas fa-times" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {remaining <= 0.005 && changeDue > 0.005 && (
          <div className="bg-shPrimary/15 border border-shPrimary/50 rounded-2xl p-4 text-center" data-testid="pos-change-due">
            <p className="text-shTextMuted text-[12px] uppercase tracking-widest font-black">Give Change</p>
            <p className="text-shPrimary text-3xl font-black">{money(changeDue)}</p>
          </div>
        )}

        {remaining > 0.005 && (
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(TENDER_LABELS).map(([k, label]) => (
                <button key={k} onClick={() => setTenderMethod(k)}
                        className={`py-2 rounded text-[11px] font-black uppercase tracking-wide ${tenderMethod === k ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted"}`}>
                  {label}
                </button>
              ))}
            </div>

            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Amount to apply</label>
              <input type="number" value={tenderAmount} onChange={(e) => setTenderAmount(e.target.value)}
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-3 text-shText text-xl font-black" />
            </div>

            {tenderMethod === "cash" && (
              <div>
                <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Cash received</label>
                <input type="number" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)}
                       placeholder={tenderAmount} className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-3 text-shText text-xl font-black" />
                <div className="flex gap-2 mt-2">
                  {[Number(tenderAmount) || 0, 50, 60, 100].filter((v, i, arr) => arr.indexOf(v) === i && v > 0).map((v) => (
                    <button key={v} onClick={() => setCashReceived(String(v))}
                            className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded py-2 text-shText text-sm font-bold">
                      {v === Number(tenderAmount) ? "Exact" : `$${v}`}
                    </button>
                  ))}
                </div>
                {cashReceived && Number(cashReceived) >= Number(tenderAmount || 0) && (
                  <p className="text-shPrimary text-sm mt-1">Change due: {money(Number(cashReceived) - Number(tenderAmount || 0))}</p>
                )}
              </div>
            )}

            {tenderMethod === "other" && (
              <input value={tenderNotes} onChange={(e) => setTenderNotes(e.target.value)} placeholder="Note (required, e.g. Zelle)"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-3 text-shText" />
            )}

            <button onClick={addTender} className="w-full bg-[var(--sh-card-base)] border border-shPrimary/50 text-shPrimary rounded-xl py-3 font-black uppercase tracking-widest">
              Add Tender
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => setTenderOpen(false)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">
            Cancel
          </button>
          <button onClick={completeSale} disabled={remaining > 0.005 || saleBusy} data-testid="pos-complete-sale"
                  className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
            {saleBusy ? "Completing…" : "Complete Sale"}
          </button>
        </div>
      </div>
    );
  }

  // ── Main register screen ─────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-slide-in" data-testid="pos-screen">
      <PageHero
        eyebrow={{ icon: "fa-cash-register", text: "Front desk", color: "text-shPrimary" }}
        title="Front Desk."
        highlight="Where all the money stuff happens."
        subtitle="Checkout, retail, invoice payments, register, and till tools — one screen."
        testid="pos-hero"
      />

      {/* Today at a Glance — real roster/orders/register data only, each
          card jumps to the section it summarizes. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5" data-testid="pos-glance-row">
        <FrontDeskStatCard icon="fa-paw" tone="lime" value={rosterCounts.expected} label="Expected Visits"
                           action="View list" onClick={() => jumpToVisits("expected")} testid="pos-glance-expected"/>
        <FrontDeskStatCard icon="fa-house" tone="blue" value={rosterCounts.on_site} label="On-Site Dogs"
                           action="View now" onClick={() => jumpToVisits("on_site")} testid="pos-glance-onsite"/>
        <FrontDeskStatCard icon="fa-clock" tone="orange" value={overduePickups} label="Overdue Pickups"
                           action="View list" onClick={() => jumpToVisits("on_site")} testid="pos-glance-pickups"/>
        <FrontDeskStatCard icon="fa-bag-shopping" tone="purple" value={onlineOrdersUnseenCount} label="New Online Orders"
                           action="View orders" onClick={() => toggleRegisterPanel("orders")} testid="pos-glance-orders"/>
        <FrontDeskStatCard icon="fa-cash-register" tone={registerOpen ? "lime" : "orange"}
                           value={registerOpen ? "OPEN" : "CLOSED"} label="Register" testid="pos-glance-register"/>
      </div>

      {/* Step 3 — the register hub is THE status/expected-cash/closeout
          surface. Pos keeps only the tools row + printer chip here. */}
      <RegisterHub onStatusChange={setRegisterStatus} onOpenCloseout={openCloseoutWorkflow} />

      {/* Quick Actions — the daily moves as large obvious cards, with the
          less-common register utilities in a compact secondary row. Same
          permissions, same panel toggles, same testids as before. */}
      <div data-testid="pos-quick-actions">
        <FrontDeskSectionHeader icon="fa-bolt" tone="lime" title="Quick Actions"/>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
          {canBookingEdit && (
            <FrontDeskQuickAction icon="fa-user-plus" tone="lime" title="Quick Check-In / Walk-In"
                                  sub="Start a check-in for any dog" onClick={() => setQuickCheckinOpen(true)}
                                  testid="pos-quick-checkin-button"/>
          )}
          {canBookingEdit && (
            <FrontDeskQuickAction icon="fa-calendar-plus" tone="blue" title="Book a Service"
                                  sub="Make a reservation" onClick={() => setBookServiceOpen(true)}
                                  testid="pos-quick-book-service"/>
          )}
          <FrontDeskQuickAction icon="fa-bag-shopping" tone="purple" title="Online Orders"
                                sub="Manage pickups & fulfillment" onClick={() => toggleRegisterPanel("orders")}
                                active={onlineOrdersOpen} badge={onlineOrdersUnseenCount}
                                testid="pos-online-orders-toggle"/>
          {canDrawerAndRefunds && (
            <FrontDeskQuickAction icon="fa-inbox" tone="orange" title="Open Cash Drawer"
                                  sub={registerOpen ? "Drawer tools" : "Register not opened"}
                                  onClick={() => toggleRegisterPanel("drawer")} active={drawerFormOpen}
                                  testid="pos-open-drawer-toggle"/>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          <FrontDeskToolButton icon="fa-receipt" label="Recent Sales" onClick={() => toggleRegisterPanel("recent")}
                               active={recentOpen} testid="pos-recent-sales-toggle"/>
          <FrontDeskToolButton icon="fa-sliders" label="Register Tools" onClick={() => toggleRegisterPanel("tools")}
                               active={registerToolsOpen} testid="pos-register-tools-toggle"/>
          {canDrawerAndRefunds && (
            <FrontDeskToolButton icon="fa-credit-card" label="Online Payments" onClick={() => toggleRegisterPanel("payments")}
                                 active={onlinePaymentsOpen} testid="pos-online-payments-toggle"/>
          )}
          {canPricingActions && (
            <FrontDeskToolButton icon="fa-store" label="Shop Manager" onClick={() => onOpenShopManager?.()}
                                 testid="pos-manage-products-toggle"/>
          )}
          <span className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${printerReady ? "border-shPrimary/45 bg-shPrimary/10 text-shPrimary" : "border-shBorder/60 bg-black/15 text-shTextMuted"}`}>
            <i className="fas fa-print text-[9px]"/>Printer: {printerReady === null ? "Checking…" : printerReady ? "Ready" : "Unavailable"}
          </span>
        </div>
      </div>

      {/* Active register panel — exactly one of the register-area
          panels renders HERE, directly beneath the register controls, so
          opening one never depends on the length of Action Required or
          Today's Visits below. */}
      {drawerFormOpen && (
        <div data-register-panel="" className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 space-y-2">
          <select value={drawerReason} onChange={(e) => setDrawerReason(e.target.value)}
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            {["Make change", "Count drawer", "Register open/close", "Other"].map((r) => <option key={r}>{r}</option>)}
          </select>
          {drawerReason === "Other" && (
            <input value={drawerCustomReason} onChange={(e) => setDrawerCustomReason(e.target.value)} placeholder="Reason"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          )}
          <button onClick={submitManualDrawer} disabled={drawerBusy}
                  className="w-full bg-shPrimary text-bgHeader rounded py-2 font-black uppercase text-[12px] tracking-widest disabled:opacity-50">
            {drawerBusy ? "Opening…" : "Confirm Open Drawer"}
          </button>
        </div>
      )}

      {recentOpen && (
        <div data-register-panel="" data-testid="pos-recent-sales-panel" className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4">
          <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black mb-2">Recent Sales</p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {recentSales.length === 0 && <p className="text-shTextMuted text-sm">No sales yet today.</p>}
            {recentSales.map((s) => (
              <div key={s.id} className="border-b border-shBorder py-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-shText font-bold">#{s.receipt_number}</span>{" "}
                    <span className="text-shTextMuted">{s.client_name || "Walk-in"} · {s.status === "voided" ? "VOIDED" : new Date(s.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={s.status === "voided" ? "text-shTextMuted line-through" : "text-shText font-bold"}>{money(s.total)}</span>
                    <button onClick={() => reprintSale(s)} className="text-shPrimary text-[11px] font-black uppercase tracking-widest">Reprint</button>
                    {canVoid && s.status !== "voided" && (
                      <button onClick={() => { setVoidingSaleId(s.id); setVoidReason(""); }}
                              className="text-shAccent text-[11px] font-black uppercase tracking-widest">Void</button>
                    )}
                  </div>
                </div>
                {voidingSaleId === s.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason for void (required)"
                           className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                    <button onClick={() => submitVoid(s.id)} disabled={voidBusy}
                            className="bg-shAccent text-bgHeader rounded px-3 py-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                      {voidBusy ? "Voiding…" : "Confirm"}
                    </button>
                    <button onClick={() => { setVoidingSaleId(null); setVoidReason(""); }} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {onlinePaymentsOpen && (
        <div data-register-panel="" className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4" data-testid="pos-online-payments-panel">
          <div className="flex items-center justify-between mb-2">
            <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black">Online Payments (Stripe)</p>
            <button onClick={loadOnlinePayments} className="text-[11px] uppercase tracking-widest font-black text-shTextMuted hover:text-shSecondary">
              <i className="fas fa-rotate-right mr-1" />Refresh
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {onlinePayments.length === 0 && <p className="text-shTextMuted text-sm">No Stripe Online payments yet.</p>}
            {onlinePayments.map((p) => {
              const fullyRefunded = p.remaining_refundable <= 0.005;
              const card = p.card_brand ? `${p.card_brand[0].toUpperCase()}${p.card_brand.slice(1)}${p.card_last4 ? ` •••• ${p.card_last4}` : ""}` : null;
              return (
                <div key={p.payment_id} className="border border-shBorder rounded-lg p-3" data-testid={`online-payment-${p.payment_id}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-shText font-bold text-sm">{p.client_name || "Unknown client"}</p>
                      <p className="text-shTextMuted text-[12px]">
                        {p.shop_order_id ? `Order #${p.shop_order_id.slice(0, 8)}` : `Invoice #${(p.invoice_id || "").slice(0, 8)}`}
                        {" · "}{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
                        {card ? ` · ${card}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-[12px] text-shTextMuted">
                      <p>Paid: <span className="text-shText font-bold">{money(p.amount)}</span></p>
                      <p>Refunded: <span className="text-shText font-bold">{money(p.refunded_amount)}</span></p>
                      <p>Refundable: <span className="text-shPrimary font-bold">{money(p.remaining_refundable)}</span></p>
                      {p.dispute_status && <p className="text-red-300 font-black uppercase tracking-wider">Dispute: {String(p.dispute_status).replaceAll("_", " ")} · {money(p.disputed_amount)}</p>}
                      {p.shop_refund_reconciliation_required && <p className="text-amber-300 font-black uppercase tracking-wider">Refund needs entitlement review</p>}
                    </div>
                    <div>
                      {p.shop_order_id ? (
                        fullyRefunded ? (
                          <span className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Fully Refunded</span>
                        ) : p.refund_in_progress ? (
                          <span className="text-shAccent text-[11px] font-black uppercase tracking-widest">Refund Processing</span>
                        ) : (
                          <button onClick={() => setRefundingShopPayment(p)} data-testid={`refund-shop-order-${p.payment_id}`}
                                  className="bg-shSecondary/15 border border-shSecondary/40 text-shSecondary px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shSecondary/25 transition">
                            Refund Order
                          </button>
                        )
                      ) : fullyRefunded ? (
                        <span className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Fully Refunded</span>
                      ) : p.refund_in_progress ? (
                        <button disabled className="bg-[var(--sh-card-base)] border border-shBorder text-shAccent px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest opacity-70 cursor-not-allowed">
                          <i className="fas fa-circle-notch fa-spin mr-1" />Refund Processing
                        </button>
                      ) : (
                        <button onClick={() => setRefundingPayment(p)} data-testid={`refund-via-stripe-${p.payment_id}`}
                                className="bg-shSecondary/15 border border-shSecondary/40 text-shSecondary px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shSecondary/25 transition">
                          Refund via Stripe
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {onlineOrdersOpen && (
        <div data-register-panel="" className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4" data-testid="pos-online-orders-panel">
          <div className="flex items-center justify-between mb-2">
            <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black">Online Orders (Shop)</p>
            <button onClick={loadOnlineOrders} className="text-[11px] uppercase tracking-widest font-black text-shTextMuted hover:text-shPrimary">
              <i className="fas fa-rotate-right mr-1" />Refresh
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {onlineOrders.length === 0 && <p className="text-shTextMuted text-sm">No paid Shop orders yet.</p>}
            {onlineOrders.map((o) => {
              const busy = orderActionBusyId === o.id;
              const hasPhysical = (o.lines || []).some((l) => l.kind === "product");
              return (
                <div key={o.id} className="border border-shBorder rounded-lg p-3" data-testid={`online-order-${o.id}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-shText font-bold text-sm">
                        Order #{o.id.slice(0, 8).toUpperCase()} · {o.client_name || "Unknown client"}
                        {o.admin_unseen === true && (
                          <span className="ml-2 inline-block bg-shAccent text-bgHeader text-[10px] font-black px-1.5 py-0.5 rounded-full align-middle"
                                data-testid={`online-order-new-${o.id}`}>NEW</span>
                        )}
                      </p>
                      <p className="text-shTextMuted text-[12px]">
                        {o.created_at ? new Date(o.created_at).toLocaleString() : "—"} · {money(o.total)}
                      </p>
                      <p className="text-[11px] text-shTextMuted mt-1">
                        {(o.lines || []).map((l) => `${l.quantity}× ${l.name}`).join(", ")}
                      </p>
                    </div>
                    <div className="text-right">
                      {/* For physical/mixed orders, pickup_status IS the customer-facing
                          status — fulfillment_status is an internal detail, never the
                          prominent label here. Non-physical orders have no pickup concept,
                          so fulfillment_status stays primary for those. */}
                      {o.fulfillment_status === "needs_attention" ? (
                        <span className="text-shAccent text-[11px] font-black uppercase tracking-widest">Needs Attention</span>
                      ) : hasPhysical ? (
                        o.pickup_status === "picked_up" ? (
                          <span className="text-shPrimary text-[11px] font-black uppercase tracking-widest">Completed</span>
                        ) : o.pickup_status === "ready_for_pickup" ? (
                          <span className="text-shPrimary text-[11px] font-black uppercase tracking-widest">Ready for Pickup</span>
                        ) : o.pickup_status === "preparing" ? (
                          <span className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Preparing</span>
                        ) : (
                          <span className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Processing</span>
                        )
                      ) : o.fulfillment_status === "fulfilled" ? (
                        <span className="text-shPrimary text-[11px] font-black uppercase tracking-widest">Fulfilled</span>
                      ) : (
                        <span className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Processing</span>
                      )}
                      {hasPhysical && (
                        <p className="text-[10px] text-shTextMuted mt-1">
                          Payment: Paid · Fulfillment: {o.fulfillment_status === "fulfilled" ? "Complete" : o.fulfillment_status === "needs_attention" ? "Attention" : "Processing"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {o.fulfillment_status === "needs_attention" && (
                      <button onClick={() => runOrderAction(o.id, "retry_fulfillment")} disabled={busy}
                              data-testid={`online-order-retry-${o.id}`}
                              className="bg-shAccent/15 border border-shAccent/40 text-shAccent px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shAccent/25 transition disabled:opacity-50">
                        {busy ? "Retrying…" : "Retry Fulfillment"}
                      </button>
                    )}
                    {o.pickup_status === "preparing" && (
                      <button onClick={() => runOrderAction(o.id, "mark_ready")} disabled={busy}
                              data-testid={`online-order-mark-ready-${o.id}`}
                              className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                        Mark Ready
                      </button>
                    )}
                    {o.pickup_status === "ready_for_pickup" && (
                      <button onClick={() => runOrderAction(o.id, "mark_picked_up")} disabled={busy}
                              data-testid={`online-order-mark-picked-up-${o.id}`}
                              className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                        Mark Picked Up
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {registerToolsOpen && (
        <div ref={registerToolsRef} data-register-panel="" className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4">
          {/* Remount on key change so a Close Register click re-reads the
              sh_register_default_tab deep-link even if tools were open. */}
          <RegisterTab key={registerToolsKey} excludeTabs={["sale"]} />
        </div>
      )}

      {/* Action Required — same shared panel as the Dashboard. It renders
          nothing for staff without booking permissions (the API 403s and the
          panel hides itself), so Front Desk never shows misleading actions. */}
      <PendingActionsPanel testid="frontdesk-pending-actions" compactWhenEmpty={false} />

      {/* Today's Visits — arrival/pickup roster. A focused list, not a
          second dashboard: three status tabs with counts, search, and just
          enough per-row detail to act (check in / check out) without
          leaving Front Desk. */}
      <div ref={visitsRef} className="sh-front-desk-panel p-4" data-testid="pos-todays-visits">
        <FrontDeskSectionHeader icon="fa-paw" tone="lime" title="Today's Visits"
          right={
            <button onClick={loadRoster} className="min-h-[36px] px-2 text-[11px] uppercase tracking-widest font-black text-shTextMuted hover:text-shPrimary">
              <i className="fas fa-rotate-right mr-1" />Refresh
            </button>
          }/>

        <div className="flex flex-wrap gap-2 mb-3">
          {[
            ["expected", `Expected (${rosterCounts.expected})`],
            ["on_site", `On-Site (${rosterCounts.on_site})`],
            ["checked_out", `Checked Out (${rosterCounts.checked_out})`],
            ["all", `All (${roster.length})`],
          ].map(([k, label]) => (
            <button key={k} onClick={() => { setVisitsTab(k); setVisitsExpanded(false); }} data-testid={`pos-visits-tab-${k}`}
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition ${visitsTab === k ? "bg-shPrimary text-bgHeader shadow-[0_0_14px_rgba(140,198,63,0.35)]" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted hover:border-shSecondary/45"}`}>
              {label}
            </button>
          ))}
        </div>
        <input value={visitsSearch} onChange={(e) => setVisitsSearch(e.target.value)} placeholder="Search by dog or client name"
               data-testid="pos-visits-search"
               className="w-full bg-black/20 border border-shBorder/60 rounded-xl px-3 py-2.5 text-shText text-sm mb-3 focus:outline-none focus:border-shSecondary/50" />

        {rosterLoading ? (
          <p className="text-shTextMuted text-sm py-4 text-center">Loading…</p>
        ) : visitsFiltered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-shBorder/60 py-6 text-center" data-testid="pos-visits-empty">
            <p className="text-shTextMuted text-sm">No visits match this filter.</p>
            {canBookingEdit && visitsTab === "expected" && !visitsSearch && (
              <p className="text-[12px] text-shTextMuted mt-1">Walk-in arriving? Use <span className="text-shPrimary font-black">Quick Check-In / Walk-In</span> above.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {visitsVisible.map((row) => {
              const bucket = classifyVisit(row);
              const label = visitStatusLabel(row);
              const missed = isMissedCheckout(row);
              const arrivedAt = row.checked_in_at ? new Date(row.checked_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";
              const timeLabel = bucket === "expected" ? (row.dropoff_time || row.time || "—") : arrivedAt;
              return (
                <div key={row.booking_id}
                     className={`rounded-xl border p-2.5 sm:p-3 flex items-center gap-3 transition hover:bg-white/[0.03] ${
                       missed ? "border-shAccent/60 bg-gradient-to-r from-shAccent/[0.12] to-black/15"
                       : bucket === "on_site" ? "border-shSecondary/45 bg-gradient-to-r from-shSecondary/[0.10] to-black/15"
                       : bucket === "checked_out" ? "border-shBorder/60 bg-black/10 opacity-80"
                       : "border-shPrimary/40 bg-gradient-to-r from-shPrimary/[0.09] to-black/15"}`}
                     data-testid={`pos-visit-row-${row.booking_id}`}>
                  {/* Time block + colored state bar, like a run sheet. */}
                  <span className={`self-stretch w-1 rounded-full shrink-0 ${missed ? "bg-shAccent" : bucket === "on_site" ? "bg-shSecondary" : bucket === "checked_out" ? "bg-shBorder" : "bg-shPrimary"}`} aria-hidden="true"/>
                  <span className="w-[52px] shrink-0 text-center">
                    <span className="block text-[13px] font-black text-shText leading-tight">{timeLabel}</span>
                    <span className="block text-[8.5px] font-black uppercase tracking-widest text-shTextMuted mt-0.5">{bucket === "expected" ? "Drop-off" : bucket === "checked_out" ? "Arrived" : "Arrived"}</span>
                  </span>
                  <FrontDeskDogAvatar name={row.dog_name} bucket={bucket}/>
                  <div className="min-w-0 flex-1">
                    <p className="text-shText font-black text-[14px] leading-tight truncate">{row.dog_name}</p>
                    <p className="text-shTextMuted text-[11.5px] truncate">
                      {[row.breed, row.client_name].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-shTextMuted text-[11px] truncate">
                      <span className="text-shSecondary font-bold capitalize">{String(row.service_type || "").replace(/_/g, " ")}</span>
                      {bucket === "expected" && row.pickup_time && <> · Pickup {row.pickup_time}</>}
                      {bucket === "on_site" && row.pickup_time && <> · Pickup {row.pickup_time}</>}
                      {bucket === "checked_out" && row.checked_out_at && <> · Out {new Date(row.checked_out_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</>}
                      {(row.kennel || row.room || row.crate || row.yard_group || row.training_group) && (
                        <> · {[row.kennel, row.room, row.crate, row.yard_group, row.training_group].filter(Boolean).join(" / ")}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <FrontDeskStatusChip bucket={bucket} missed={missed} label={label}/>
                    {bucket === "expected" && (
                      <button onClick={() => doCheckIn(row)} disabled={checkInBusyId === row.booking_id} data-testid={`pos-visit-checkin-${row.booking_id}`}
                              className="bg-shPrimary text-bgHeader rounded-lg px-4 py-2.5 min-h-[42px] text-[12px] font-black uppercase tracking-widest shadow-[0_8px_22px_-10px_rgba(140,198,63,0.8)] hover:brightness-110 transition disabled:opacity-50">
                        {checkInBusyId === row.booking_id ? "Checking In…" : "Check In"}
                      </button>
                    )}
                    {bucket === "on_site" && (
                      <button onClick={() => openCheckoutFor(row.booking_id)} disabled={checkoutLoadingId === row.booking_id} data-testid={`pos-visit-checkout-${row.booking_id}`}
                              className="bg-[var(--sh-card-base)] border border-shSecondary/60 text-shSecondary rounded-lg px-4 py-2.5 min-h-[42px] text-[12px] font-black uppercase tracking-widest hover:bg-shSecondary/10 transition disabled:opacity-50">
                        {checkoutLoadingId === row.booking_id ? "Loading…" : "Check Out"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!rosterLoading && visitsFiltered.length > VISITS_COLLAPSED_LIMIT && (
          <button onClick={() => setVisitsExpanded((v) => !v)} data-testid="pos-visits-expand"
                  className="mt-3 text-[11px] font-black uppercase tracking-widest text-shPrimary">
            {visitsExpanded ? "Show fewer" : `Show all ${visitsFiltered.length}`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: client + products */}
        <div className="lg:col-span-3 space-y-4">
          {/* Client panel */}
          <div className="sh-front-desk-panel p-4">
            {!selectedClient ? (
              <>
                <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black mb-2">Client</p>
                <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)}
                       placeholder="Search client (or leave blank for Walk-in)"
                       data-testid="pos-client-search"
                       className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-3 text-shText" />
                {clientResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {clientResults.map((c) => (
                      <button key={c.id} onClick={() => pickClient(c)}
                              className="w-full text-left bg-[var(--sh-card-base)] hover:border-shPrimary/50 border border-shBorder rounded p-2 text-shText text-sm">
                        {c.name} <span className="text-shTextMuted">{c.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-shText font-black text-lg">{selectedClient.name}</p>
                  <button onClick={clearClient} className="text-shTextMuted hover:text-shText text-sm">
                    <i className="fas fa-times mr-1" />Walk-in
                  </button>
                </div>
                {selectedClient.dogs?.length > 0 && (
                  <p className="text-shTextMuted text-sm mt-1">Dogs: {selectedClient.dogs.map((d) => d.name).join(", ")}</p>
                )}
                <div className="flex flex-wrap gap-3 mt-2 text-sm">
                  {Number(selectedClient.credits || 0) > 0 && <span className="text-shPrimary">{selectedClient.credits} daycare credits</span>}
                  {Number(selectedClient.boarding_credits || 0) > 0 && <span className="text-shPrimary">{selectedClient.boarding_credits} boarding credits</span>}
                  {Number(selectedClient.training_credits || 0) > 0 && <span className="text-shPrimary">{selectedClient.training_credits} training credits</span>}
                  {Number(selectedClient.account_balance || 0) !== 0 && (
                    <span className={selectedClient.account_balance > 0 ? "text-shAccent" : "text-shPrimary"}>
                      Tab: {money(selectedClient.account_balance)}
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {clientInvoice && (
                    <button onClick={() => setShowTakePayment(true)} data-testid="pos-pay-invoice"
                            className="w-full bg-[var(--sh-card-base)] border border-shPrimary/50 text-shPrimary rounded-xl py-3 font-black uppercase tracking-widest text-sm">
                      Pay Invoice — {money(clientInvoice.balance)}
                    </button>
                  )}
                  {!clientInvoice && clientInvoiceError && (
                    <div className="w-full border border-shAccent/40 text-shAccent rounded-xl py-3 px-3 text-[12px] font-black uppercase tracking-widest text-center"
                         data-testid="pos-invoice-lookup-error">
                      Couldn't check for open invoices — retry before taking payment
                    </div>
                  )}
                  {!clientInvoice && !clientInvoiceError && (
                    <button onClick={() => setShowTakePayment(true)}
                            className="w-full bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted rounded-xl py-3 font-black uppercase tracking-widest text-sm">
                      Pay Account / Tab
                    </button>
                  )}
                  {/* Status-aware — never a blanket "Check Out {dog}" label
                      regardless of whether the dog has even arrived yet.
                      Reads the same roster rows as Today's Visits, so this
                      panel can never disagree with it about who's expected/
                      on-site (also naturally covers ongoing boarding stays
                      that began before today). */}
                  {clientBookings.map((b) => {
                    const bucket = classifyVisit(b);
                    if (bucket === "checked_out") {
                      return (
                        <div key={b.booking_id}
                             className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded-xl py-3 font-black uppercase tracking-widest text-sm text-shTextMuted text-center">
                          Checked Out · {b.dog_name} ({b.service_type}) · {new Date(b.checked_out_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </div>
                      );
                    }
                    if (bucket === "on_site") {
                      return (
                        <button key={b.booking_id} onClick={() => openCheckoutFor(b.booking_id)} disabled={checkoutLoadingId === b.booking_id}
                                data-testid={`pos-client-checkout-${b.booking_id}`}
                                className="w-full bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded-xl py-3 font-black uppercase tracking-widest text-sm text-shText disabled:opacity-50">
                          {checkoutLoadingId === b.booking_id ? "Loading…" : `Check Out ${b.dog_name} (${b.service_type})`}
                          {isMissedCheckout(b) && <span className="ml-2 text-shAccent">· Missed Checkout</span>}
                        </button>
                      );
                    }
                    return (
                      <button key={b.booking_id} onClick={() => doCheckIn(b)} disabled={checkInBusyId === b.booking_id}
                              data-testid={`pos-client-checkin-${b.booking_id}`}
                              className="w-full bg-shPrimary/10 border border-shPrimary/40 hover:border-shPrimary rounded-xl py-3 font-black uppercase tracking-widest text-sm text-shPrimary disabled:opacity-50">
                        {checkInBusyId === b.booking_id ? "Checking In…" : `Check In ${b.dog_name} (${b.service_type})`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Product panel */}
          <div className="sh-front-desk-panel p-4">
            <div className="sh-front-desk-panel__head"><div><p className="sh-front-desk-panel__eyebrow">Register catalog</p><h3 className="sh-front-desk-panel__title">Products & Services</h3></div></div>
            <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search by name, SKU, category…"
                   data-testid="pos-product-search"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText mb-2" />
            {categoryPills.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3" data-testid="pos-category-pills">
                <button onClick={() => setActiveCategory("")} data-testid="pos-category-all" aria-pressed={!activeCategory || undefined}
                        className={`rounded-2xl border p-3 text-left min-h-[76px] flex flex-col justify-between transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary ${!activeCategory ? "border-shPrimary/70 bg-shPrimary/[0.10] ring-2 ring-shPrimary ring-inset" : "border-shBorder/60 bg-black/15 hover:border-shSecondary/45"}`}>
                  <i className="fas fa-border-all text-[16px] text-shText" aria-hidden="true"/>
                  <span className="mt-1.5">
                    <span className="block text-[12px] font-black uppercase tracking-[0.08em] text-shText leading-tight">All</span>
                    <span className="block text-[10px] font-bold text-shTextMuted mt-0.5">{products.length} item{products.length === 1 ? "" : "s"}</span>
                  </span>
                </button>
                {categoryPills.map((c, i) => (
                  <CatalogCategoryTile key={c.id} label={c.label} count={c.count} index={i}
                                       active={activeCategory === c.id}
                                       onClick={() => setActiveCategory(activeCategory === c.id ? "" : c.id)}
                                       testid={`pos-category-${c.id}`}/>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {filteredProducts.map((item) => {
                const outOfStock = item.kind === "product" && item.track_inventory && Number(item.stock_on_hand || 0) <= 0.0005;
                const lowStock = item.kind === "product" && item.track_inventory && !outOfStock && item.low_stock_threshold != null &&
                  Number(item.stock_on_hand || 0) <= Number(item.low_stock_threshold) + 0.0005;
                return (
                  <button key={`${item.kind}-${item.id}`} onClick={() => addItem(item)} disabled={outOfStock}
                          data-testid={`pos-product-${item.id}`}
                          className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded-xl p-3 text-left disabled:opacity-40 disabled:hover:border-shBorder">
                    <ItemThumbnail imageId={item.image_id} alt={item.name} variant="banner" size={80} fit="contain" className="mb-1.5" />
                    <p className="text-shText font-bold text-sm truncate">{item.name}</p>
                    {item.category_name && (
                      <p className="text-shTextMuted text-[10px] font-black uppercase tracking-widest truncate">{item.category_name}</p>
                    )}
                    {item.has_price_override ? (
                      <div>
                        <p className="text-shPrimary font-black">{money(item.effective_price)} <span className="text-shTextMuted text-[10px] font-black uppercase tracking-widest">Your Price</span></p>
                        <p className="text-shTextMuted text-[11px] line-through">{money(item.list_price)}</p>
                      </div>
                    ) : (
                      <p className="text-shPrimary font-black">{money(item.effective_price)}</p>
                    )}
                    {item.kind === "product" && item.track_inventory && (
                      <p className={`text-[11px] font-black uppercase tracking-widest mt-0.5 ${outOfStock ? "text-shDanger" : lowStock ? "text-shAccent" : "text-shTextMuted"}`}>
                        {outOfStock ? "Out of Stock" : lowStock ? `${item.stock_on_hand} left • Low Stock` : `${item.stock_on_hand} in stock`}
                      </p>
                    )}
                    {item.kind === "credit_pack" && (
                      <p className="text-shTextMuted text-[11px] font-black uppercase tracking-widest mt-0.5">
                        {creditPackStaffLine(item)}
                      </p>
                    )}
                    {item.kind === "training_program" && (
                      <p className="text-shTextMuted text-[11px] font-black uppercase tracking-widest mt-0.5">
                        {item.format_count ? `${item.format_count} ${item.format_unit || "sessions"}` : "Training program"}
                      </p>
                    )}
                    <span className="mt-1.5 inline-block text-shSecondary text-[11px] font-black uppercase tracking-widest">
                      <i className="fas fa-cart-plus mr-1" />Add to Cart
                    </span>
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <p className="text-shTextMuted text-sm col-span-full" data-testid="pos-no-products">No products found.</p>
              )}
            </div>
            {canPricingActions && (
              <button onClick={() => setCustomOpen((o) => !o)}
                      className="mt-3 w-full bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted rounded-xl py-2 text-sm font-black uppercase tracking-widest">
                + Custom Item
              </button>
            )}
            {customOpen && (
              <div className="mt-2 space-y-2 bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-3">
                <input value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} placeholder="Description"
                       className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                <input type="number" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder="Amount"
                       className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                <input value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Reason (required)"
                       className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                <div className="grid grid-cols-2 gap-2" data-testid="pos-custom-kind">
                  {[["merchandise", "Merchandise — taxable"], ["service", "Service — no sales tax"]].map(([k, label]) => (
                    <label key={k} className={`cursor-pointer rounded px-2 py-2 border text-[11px] font-black uppercase tracking-widest text-center ${
                        customKind === k ? "bg-shPrimary/15 border-shPrimary/40 text-shPrimary" : "bg-[var(--sh-card-base)] border-shBorder text-shTextMuted"}`}>
                      <input type="radio" name="pos-custom-kind" value={k} checked={customKind === k}
                             onChange={() => setCustomKind(k)} data-testid={`pos-custom-kind-${k}`}
                             className="mr-1 accent-shPrimary" />{label}
                    </label>
                  ))}
                </div>
                <button onClick={addCustom} className="w-full bg-shPrimary text-bgHeader rounded py-2 font-black uppercase text-[12px] tracking-widest">
                  Add to Cart
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: cart — persistently visible on desktop while staff browse. */}
        <div className="lg:col-span-2">
          <div className="sh-front-desk-cart sh-hue-card sh-hue-card--lime p-4 lg:sticky lg:top-4 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <p className="text-shText text-[14px] uppercase tracking-[0.12em] font-black"><i className="fas fa-cart-shopping mr-2 text-shPrimary"/>Your Cart
                {cartLines.length > 0 && <span className="ml-2 text-[11px] text-shTextMuted normal-case tracking-normal font-bold">{cartLines.length} item{cartLines.length === 1 ? "" : "s"}</span>}
              </p>
              {cartLines.length > 0 && (
                <button onClick={resetCart} data-testid="pos-clear-cart"
                        className="text-shTextMuted hover:text-shDanger text-[11px] font-black uppercase tracking-widest">
                  Clear Cart
                </button>
              )}
            </div>
            {/* Who this sale belongs to — mirrors the client panel state. */}
            <div className={`rounded-xl border px-3 py-2 mb-3 flex items-center gap-2.5 ${selectedClient ? "border-shSecondary/45 bg-shSecondary/[0.07]" : "border-shBorder/60 bg-black/15"}`} data-testid="pos-cart-client">
              <span className={`w-8 h-8 rounded-lg grid place-items-center border shrink-0 ${selectedClient ? "border-shSecondary/50 bg-shSecondary/15 text-shSecondary" : "border-shBorder/60 bg-black/20 text-shTextMuted"}`}>
                <i className={`fas ${selectedClient ? "fa-user" : "fa-person-walking"} text-[13px]`}/>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-black text-shText truncate">{selectedClient ? selectedClient.name : "Walk-in sale"}</span>
                <span className="block text-[10.5px] text-shTextMuted">{selectedClient ? "Client pricing applied" : "Select a client for packs, programs & client pricing"}</span>
              </span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {cartLines.length === 0 && <p className="text-shTextMuted text-sm">Cart is empty.</p>}
              {cartLines.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-shBorder pb-2" data-testid="pos-cart-line">
                  <div className="flex-1 min-w-0">
                    <p className="text-shText truncate">{l.kind === "custom" ? l.description : l.name}</p>
                    {l.kind === "credit_pack" && <p className="text-shTextMuted text-[10px] uppercase tracking-widest">Credit Pack</p>}
                    {l.kind === "training_program" && <p className="text-shTextMuted text-[10px] uppercase tracking-widest">Training Program</p>}
                    {l.has_price_override && <p className="text-shPrimary text-[10px] font-black uppercase tracking-widest">Client price applied</p>}
                    {l.kind !== "custom" && (
                      <div className="flex items-center gap-2 mt-1">
                        <button onClick={() => updateQty(i, -1)} className="w-6 h-6 bg-[var(--sh-card-base)] rounded text-shText">-</button>
                        <span className="text-shTextMuted w-6 text-center">{l.qty}</span>
                        <button onClick={() => updateQty(i, 1)} className="w-6 h-6 bg-[var(--sh-card-base)] rounded text-shText">+</button>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-shText font-bold">{money(l.kind === "custom" ? l.custom_amount : l.unit_price * l.qty)}</p>
                    <button onClick={() => removeLine(i)} className="text-shTextMuted hover:text-shDanger text-xs">Remove</button>
                  </div>
                </div>
              ))}
            </div>

            {canPricingActions && cartLines.length > 0 && !discount && (
              <button onClick={() => setDiscountOpen((o) => !o)}
                      className="mt-2 text-shPrimary text-[12px] font-black uppercase tracking-widest">
                + Discount
              </button>
            )}
            {discountOpen && (
              <div className="mt-2 space-y-2 bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-3">
                <div className="flex gap-2">
                  <button onClick={() => setDiscountKind("fixed")} className={`flex-1 py-1 rounded text-[11px] font-black uppercase ${discountKind === "fixed" ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted"}`}>$ Fixed</button>
                  <button onClick={() => setDiscountKind("percent")} className={`flex-1 py-1 rounded text-[11px] font-black uppercase ${discountKind === "percent" ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted"}`}>% Percent</button>
                </div>
                <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="Value"
                       className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Reason (required)"
                       className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                <button onClick={applyDiscount} className="w-full bg-shPrimary text-bgHeader rounded py-2 font-black uppercase text-[12px] tracking-widest">Apply</button>
              </div>
            )}
            {discount && (
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-shTextMuted">Discount ({discount.reason})</span>
                <button onClick={() => setDiscount(null)} className="text-shTextMuted hover:text-shDanger text-xs">Remove</button>
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-shBorder space-y-1 text-sm">
              <div className="flex justify-between text-shTextMuted"><span>Subtotal</span><span>{money(priced?.subtotal)}</span></div>
              {priced?.discount_amount > 0 && <div className="flex justify-between text-shTextMuted"><span>Discount</span><span>-{money(priced.discount_amount)}</span></div>}
              {priced?.tax_amount > 0 && <div className="flex justify-between text-shTextMuted"><span>Tax</span><span>{money(priced.tax_amount)}</span></div>}
              <div className="flex justify-between items-baseline text-shText font-black"><span className="text-[15px]">Total</span><span className="text-[24px]">{money(total)}</span></div>
            </div>

            <button onClick={openTender} disabled={cartLines.length === 0 || !priced} data-testid="pos-checkout-button"
                    className="sh-front-desk-checkout mt-4 w-full min-h-[54px] bg-gradient-to-r from-shPrimary to-[#b7e35c] text-bgHeader font-black uppercase tracking-widest text-[15px] rounded-xl shadow-[0_0_24px_rgba(140,198,63,0.45)] hover:brightness-110 transition disabled:opacity-40 disabled:shadow-none">
              Checkout{cartLines.length > 0 && priced ? ` · ${money(total)}` : ""}
            </button>
          </div>

          {/* Contextual first-use guidance — plain help, not a workflow engine. */}
          {!guideDismissed && (
            <div className="mt-3 rounded-2xl border border-shSecondary/40 bg-shSecondary/[0.06] p-3.5 flex items-start gap-3" data-testid="pos-staff-guide">
              <span className="w-9 h-9 rounded-full grid place-items-center bg-shSecondary/15 border border-shSecondary/45 text-shSecondary shrink-0"><i className="fas fa-circle-question text-[14px]"/></span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-black uppercase tracking-[0.1em] text-shSecondary">What do I do next?</p>
                <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed">
                  Check dogs in from <b className="text-shText">Today&apos;s Visits</b>, add anything they&apos;re buying from <b className="text-shText">Products &amp; Services</b>, then hit the green <b className="text-shText">Checkout</b>. The register must be open before taking cash.
                </p>
              </div>
              <button onClick={() => setGuideDismissed(true)} aria-label="Dismiss guide" className="text-shTextMuted hover:text-shText px-1"><i className="fas fa-times"/></button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile sticky checkout bar — the cart lives at the bottom of the
          single-column flow, so surface the total + the SAME openTender
          action the cart button uses. Desktop keeps the persistent cart. */}
      {cartLines.length > 0 && priced && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))]" data-testid="pos-mobile-checkout-bar">
          <button onClick={openTender}
                  className="w-full min-h-[54px] rounded-2xl bg-gradient-to-r from-shPrimary to-[#b7e35c] text-bgHeader font-black uppercase tracking-widest text-[14px] shadow-[0_-6px_30px_rgba(0,0,0,0.5),0_0_24px_rgba(140,198,63,0.5)] flex items-center justify-center gap-3">
            <span>{cartLines.length} item{cartLines.length === 1 ? "" : "s"}</span>
            <span aria-hidden="true">·</span>
            <span>Checkout {money(total)}</span>
          </button>
        </div>
      )}

      {checkoutBooking && (
        <CheckoutModal
          booking={checkoutBooking}
          services={services}
          // Refreshes Today's Visits + the selected client's invoice either
          // way (cancel or confirm) — closing without confirming never
          // stamps anything, so a refresh after a cancel just shows the
          // dog exactly where it already was (still On-Site). No longer
          // force-clears the selected client: "Refresh the selected
          // client"/"invoice information" implies staying on them, e.g. to
          // take payment on their tab right after.
          onClose={() => {
            setCheckoutBooking(null);
            loadRoster();
            if (selectedClient) refreshClientInvoice(selectedClient.id);
          }}
        />
      )}
      {quickCheckinOpen && (
        <AdminBookingModal
          defaultCheckIn={true}
          onClose={() => setQuickCheckinOpen(false)}
          onCreated={() => { setQuickCheckinOpen(false); loadRoster(); }}
        />
      )}
      {bookServiceOpen && (
        <AdminBookingModal
          defaultCheckIn={false}
          onClose={() => setBookServiceOpen(false)}
          onCreated={() => { setBookServiceOpen(false); loadRoster(); }}
        />
      )}
      {showTakePayment && selectedClient && (
        <TakePaymentModal
          presetClientId={selectedClient.id}
          onClose={() => setShowTakePayment(false)}
          onSuccess={() => { setShowTakePayment(false); clearClient(); }}
        />
      )}
      {refundingPayment && (
        <StripeRefundModal
          payment={refundingPayment}
          onClose={() => setRefundingPayment(null)}
          onDone={loadOnlinePayments}
        />
      )}

      {refundingShopPayment && (
        <ShopRefundModal
          payment={refundingShopPayment}
          onClose={() => setRefundingShopPayment(null)}
          onDone={() => { loadOnlinePayments(); loadOnlineOrders(); }}
        />
      )}
    </div>
  );
}
