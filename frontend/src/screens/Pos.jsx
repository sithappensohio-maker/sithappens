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
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import { CheckoutModal } from "../components/CheckoutModal";
import TakePaymentModal from "../components/TakePaymentModal";
import ManageProductsPanel from "../components/ManageProductsPanel";
import StripeRefundModal from "../components/StripeRefundModal";
import { RegisterTab } from "./Staff";
import {
  checkPosHealth,
  printReceipt as posPrintReceipt,
  openDrawer as posOpenDrawer,
} from "../lib/posAgent";

const TENDER_LABELS = { cash: "Cash", check: "Check", venmo: "Venmo", paypal: "PayPal", other: "Other" };
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function Pos() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // ── Register + hardware status ──────────────────────────────────────────
  const [registerStatus, setRegisterStatus] = useState(null);
  const [printerReady, setPrinterReady] = useState(null);
  const [drawerFormOpen, setDrawerFormOpen] = useState(false);
  const [drawerReason, setDrawerReason] = useState("Make change");
  const [drawerCustomReason, setDrawerCustomReason] = useState("");
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [openBusy, setOpenBusy] = useState(false);

  const loadRegister = () => api.get("/admin/register/session").then(({ data }) => setRegisterStatus(data)).catch(() => {});
  useEffect(() => {
    loadRegister();
    const t = setInterval(loadRegister, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const check = () => checkPosHealth().then((r) => setPrinterReady(r.ready));
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  const doOpenRegister = async () => {
    setOpenBusy(true);
    try {
      await api.post("/admin/register/open-drawer", { opening_cash: Number(openingCash || 0) });
      toast.success("Register opened");
      setOpeningCash("");
      loadRegister();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not open the register");
    }
    setOpenBusy(false);
  };

  const submitManualDrawer = async () => {
    const reason = drawerReason === "Other" ? drawerCustomReason.trim() : drawerReason;
    if (!reason || reason.length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    setDrawerBusy(true);
    try {
      const { data } = await api.post("/admin/pos/open-drawer", { reason });
      const result = await posOpenDrawer(data.open_drawer_token);
      if (result.ok) { toast.success("Drawer opened"); setDrawerFormOpen(false); setDrawerCustomReason(""); }
      else toast.error(result.error || "Drawer failed to open");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not authorize drawer open");
    }
    setDrawerBusy(false);
  };

  const registerOpen = registerStatus?.status === "OPEN";

  // ── Product catalog ──────────────────────────────────────────────────────
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [manageProductsOpen, setManageProductsOpen] = useState(false);
  const loadProducts = () => {
    api.get("/pos/products").then(({ data }) => setProducts(data || [])).catch(() => {});
    api.get("/pos/products/categories").then(({ data }) => setCategories(data?.categories || [])).catch(() => {});
  };
  useEffect(() => { loadProducts(); }, []);
  const filteredProducts = useMemo(() => products.filter((p) => {
    if (activeCategory && p.category !== activeCategory) return false;
    if (productSearch && !p.name.toLowerCase().includes(productSearch.toLowerCase())) return false;
    return true;
  }), [products, activeCategory, productSearch]);

  // ── Cart ─────────────────────────────────────────────────────────────────
  const [cartLines, setCartLines] = useState([]);
  const [discount, setDiscount] = useState(null);
  const [priced, setPriced] = useState(null);

  const addProduct = (p) => {
    if (!registerOpen && false) return; // retail non-cash sales don't need the register open; gate happens at tender time
    if (p.track_inventory) {
      const inCart = cartLines.find((l) => l.kind === "retail" && l.product_id === p.id)?.qty || 0;
      if (inCart + 1 > Number(p.stock_on_hand || 0) + 0.0005) {
        toast.error(`Only ${p.stock_on_hand} in stock for ${p.name}.`);
        return;
      }
    }
    setCartLines((lines) => {
      const idx = lines.findIndex((l) => l.kind === "retail" && l.product_id === p.id);
      if (idx >= 0) {
        const copy = [...lines];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...lines, { kind: "retail", product_id: p.id, name: p.name, unit_price: p.price, qty: 1 }];
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
    }]);
    setCustomOpen(false); setCustomDesc(""); setCustomAmount(""); setCustomReason("");
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

  const linesPayload = () => cartLines.map((l) => (l.kind === "custom"
    ? { kind: "custom", description: l.description, custom_amount: l.custom_amount, custom_reason: l.custom_reason }
    : { kind: "retail", product_id: l.product_id, qty: l.qty }
  ));

  useEffect(() => {
    if (cartLines.length === 0) { setPriced(null); return; }
    const t = setTimeout(() => {
      api.post("/pos/sales/preview", { lines: linesPayload(), discount })
        .then(({ data }) => setPriced(data))
        .catch((e) => { toast.error(e?.response?.data?.detail || "Could not price the cart"); setPriced(null); });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cartLines), JSON.stringify(discount)]);

  // ── Client panel ─────────────────────────────────────────────────────────
  const [allClients, setAllClients] = useState([]);
  useEffect(() => { api.get("/clients").then(({ data }) => setAllClients(data || [])).catch(() => {}); }, []);
  const [clientQuery, setClientQuery] = useState("");
  const clientResults = useMemo(() => {
    if (!clientQuery || clientQuery.length < 2) return [];
    const q = clientQuery.toLowerCase();
    return allClients.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q)).slice(0, 8);
  }, [clientQuery, allClients]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientBookings, setClientBookings] = useState([]);
  const [clientInvoice, setClientInvoice] = useState(null);

  const pickClient = async (c) => {
    setSelectedClient(c); setClientQuery("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [bk, inv] = await Promise.all([
        api.get("/bookings", { params: { status_filter: "approved", start_date: today, end_date: today } }),
        api.get(`/clients/${c.id}/invoices`).catch(() => ({ data: [] })),
      ]);
      setClientBookings((bk.data || []).filter((b) => b.client_id === c.id));
      const invoices = Array.isArray(inv.data) ? inv.data : [];
      setClientInvoice(invoices.find((i) => i.balance > 0.005) || null);
    } catch { /* non-fatal — client panel just shows less */ }
  };
  const clearClient = () => { setSelectedClient(null); setClientBookings([]); setClientInvoice(null); };

  const [checkoutBooking, setCheckoutBooking] = useState(null);
  const [services, setServices] = useState([]);
  useEffect(() => { api.get("/services").then(({ data }) => setServices(data || [])).catch(() => {}); }, []);
  const [showTakePayment, setShowTakePayment] = useState(false);

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

  const total = priced?.total ?? 0;
  const tenderedSoFar = tenders.reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, Math.round((total - tenderedSoFar) * 100) / 100);

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
      const { data } = await api.post("/pos/sales", {
        client_id: selectedClient?.id || null,
        lines: linesPayload(),
        discount,
        tenders,
        idempotency_key: saleIdemKey,
      });
      setSaleResult(data);
      setTenderOpen(false);
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
  const [registerToolsOpen, setRegisterToolsOpen] = useState(false);

  // ── Recent sales ─────────────────────────────────────────────────────────
  const [recentSales, setRecentSales] = useState([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const loadRecent = () => api.get("/pos/sales").then(({ data }) => setRecentSales(data || [])).catch(() => {});
  useEffect(() => { if (recentOpen) loadRecent(); }, [recentOpen]);
  useEffect(() => { if (saleResult) loadRecent(); }, [saleResult]);

  // ── Online payments (Stripe) — deliberately separate from Recent Sales.
  // Recent Sales is backed by pos_sales (the POS Register's own retail
  // history); stripe_online booking payments live in a different collection
  // (payments/invoices) entirely, so they get their own panel here rather
  // than being forced into that list. ──
  const [onlinePayments, setOnlinePayments] = useState([]);
  const [onlinePaymentsOpen, setOnlinePaymentsOpen] = useState(false);
  const loadOnlinePayments = () => api.get("/admin/stripe-online-payments", { params: { limit: 50 } })
    .then(({ data }) => setOnlinePayments(data.payments || [])).catch(() => {});
  useEffect(() => { if (onlinePaymentsOpen) loadOnlinePayments(); }, [onlinePaymentsOpen]);
  const [refundingPayment, setRefundingPayment] = useState(null);

  // ── Online Orders (Client Shop Phase 2) — paid shop_orders awaiting
  // pickup/fulfillment follow-up. Separate from both Recent Sales (pos_sales)
  // and Online Payments (the raw Stripe payment ledger) — this is the
  // operational "what do I hand the client" view. ──
  const [onlineOrders, setOnlineOrders] = useState([]);
  const [onlineOrdersOpen, setOnlineOrdersOpen] = useState(false);
  const [orderActionBusyId, setOrderActionBusyId] = useState(null);
  const [onlineOrdersUnseenCount, setOnlineOrdersUnseenCount] = useState(0);

  const refreshUnseenCount = () => api.get("/admin/shop-orders/unseen-count")
    .then(({ data }) => setOnlineOrdersUnseenCount(data.unseen || 0)).catch(() => {});
  useEffect(() => { refreshUnseenCount(); }, []);

  // Never clear the badge before the order list has actually loaded — the
  // mark-seen call only fires inside this .then(), after a successful fetch,
  // for exactly the paid orders that came back with admin_unseen === true.
  const loadOnlineOrders = () => api.get("/admin/shop-orders")
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
    }).catch(() => {});
  useEffect(() => { if (onlineOrdersOpen) loadOnlineOrders(); }, [onlineOrdersOpen]);

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
        </div>
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-shTextMuted text-sm">Print receipt</span>
            <button onClick={() => retryHardware("print_receipt")} disabled={hwBusy.print_receipt}
                    className="text-shPrimary text-sm font-black uppercase tracking-widest disabled:opacity-50">
              {hwBusy.print_receipt ? "Sending…" : "Reprint"}
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
                <span className="text-shTextMuted">{TENDER_LABELS[t.method]}{t.notes ? ` — ${t.notes}` : ""}</span>
                <div className="flex items-center gap-2">
                  <span className="text-shText font-bold">{money(t.amount)}</span>
                  <button onClick={() => removeTender(i)} className="text-shTextMuted hover:text-shDanger"><i className="fas fa-times" /></button>
                </div>
              </div>
            ))}
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

      {/* Register + hardware status header */}
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded ${registerOpen ? "text-shPrimary bg-shPrimary/10" : "text-shAccent bg-shAccent/10"}`}>
            Register: {registerStatus?.status || "…"}
          </span>
          <span className={`text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded ${printerReady ? "text-shPrimary bg-shPrimary/10" : "text-shTextMuted bg-shBorder/40"}`}>
            Printer: {printerReady === null ? "Checking…" : printerReady ? "Ready" : "Unavailable"}
          </span>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          {isAdmin && (
            <button onClick={() => setDrawerFormOpen((o) => !o)} data-testid="pos-open-drawer-toggle"
                    className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded px-4 py-2 text-shText text-[12px] font-black uppercase tracking-widest">
              <i className="fas fa-drawer-alt mr-1.5" />Open Drawer
            </button>
          )}
          <button onClick={() => setRecentOpen((o) => !o)}
                  className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded px-4 py-2 text-shText text-[12px] font-black uppercase tracking-widest">
            Recent Sales
          </button>
          {isAdmin && (
            <button onClick={() => setManageProductsOpen(true)} data-testid="pos-manage-products-toggle"
                    className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded px-4 py-2 text-shText text-[12px] font-black uppercase tracking-widest">
              Manage Products
            </button>
          )}
          <button onClick={() => setRegisterToolsOpen((o) => !o)} data-testid="pos-register-tools-toggle"
                  className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded px-4 py-2 text-shText text-[12px] font-black uppercase tracking-widest">
            Register Tools
          </button>
          {isAdmin && (
            <button onClick={() => setOnlinePaymentsOpen((o) => !o)} data-testid="pos-online-payments-toggle"
                    className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shSecondary/50 rounded px-4 py-2 text-shText text-[12px] font-black uppercase tracking-widest">
              Online Payments
            </button>
          )}
          <button onClick={() => setOnlineOrdersOpen((o) => !o)} data-testid="pos-online-orders-toggle"
                  className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded px-4 py-2 text-shText text-[12px] font-black uppercase tracking-widest">
            Online Orders
            {onlineOrdersUnseenCount > 0 && (
              <span className="ml-2 inline-block bg-shAccent text-bgHeader text-[10px] font-black px-1.5 py-0.5 rounded-full align-middle"
                    data-testid="pos-online-orders-unseen-badge">{onlineOrdersUnseenCount} NEW</span>
            )}
          </button>
        </div>
      </div>

      {!registerOpen && (
        <div className="bg-[var(--sh-card-base)] border border-shAccent/40 rounded-2xl p-4 flex items-center gap-3 flex-wrap">
          <span className="text-shAccent font-black uppercase text-sm tracking-widest">Register Closed</span>
          <input type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="Opening cash"
                 className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText w-40" />
          <button onClick={doOpenRegister} disabled={openBusy}
                  className="bg-shPrimary text-bgHeader rounded px-4 py-2 font-black uppercase text-[12px] tracking-widest disabled:opacity-50">
            {openBusy ? "Opening…" : "Open Register"}
          </button>
        </div>
      )}

      {drawerFormOpen && (
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 space-y-2">
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
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4">
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
                    {isAdmin && s.status !== "voided" && (
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
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4" data-testid="pos-online-payments-panel">
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
                    </div>
                    <div>
                      {p.shop_order_id ? (
                        // Client Shop Phase 2 — refunds for Shop orders aren't
                        // built yet (Phase 3). Display-only for now.
                        <span className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Shop Order</span>
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
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4" data-testid="pos-online-orders-panel">
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
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4">
          <RegisterTab excludeTabs={["sale"]} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: client + products */}
        <div className="lg:col-span-3 space-y-4">
          {/* Client panel */}
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4">
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
                  {!clientInvoice && (
                    <button onClick={() => setShowTakePayment(true)}
                            className="w-full bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted rounded-xl py-3 font-black uppercase tracking-widest text-sm">
                      Pay Account / Tab
                    </button>
                  )}
                  {clientBookings.map((b) => (
                    <button key={b.id} onClick={() => setCheckoutBooking(b)}
                            className="w-full bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded-xl py-3 font-black uppercase tracking-widest text-sm text-shText">
                      Check Out {b.dog_name} ({b.service_type})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Product panel */}
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4">
            <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black mb-2">Products</p>
            <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText mb-2" />
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={() => setActiveCategory("")}
                        className={`px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest ${!activeCategory ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted"}`}>
                  All
                </button>
                {categories.map((c) => (
                  <button key={c} onClick={() => setActiveCategory(c)}
                          className={`px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest ${activeCategory === c ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted"}`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filteredProducts.map((p) => {
                const outOfStock = p.track_inventory && Number(p.stock_on_hand || 0) <= 0.0005;
                const lowStock = p.track_inventory && !outOfStock && p.low_stock_threshold != null &&
                  Number(p.stock_on_hand || 0) <= Number(p.low_stock_threshold) + 0.0005;
                return (
                  <button key={p.id} onClick={() => addProduct(p)} disabled={outOfStock} data-testid={`pos-product-${p.id}`}
                          className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 rounded-xl p-3 text-left disabled:opacity-40 disabled:hover:border-shBorder">
                    <p className="text-shText font-bold text-sm truncate">{p.name}</p>
                    <p className="text-shPrimary font-black">{money(p.price)}</p>
                    {p.track_inventory && (
                      <p className={`text-[11px] font-black uppercase tracking-widest mt-0.5 ${outOfStock ? "text-shDanger" : lowStock ? "text-shAccent" : "text-shTextMuted"}`}>
                        {outOfStock ? "Out of Stock" : lowStock ? `${p.stock_on_hand} left • Low Stock` : `${p.stock_on_hand} in stock`}
                      </p>
                    )}
                  </button>
                );
              })}
              {filteredProducts.length === 0 && <p className="text-shTextMuted text-sm col-span-full">No products found.</p>}
            </div>
            {isAdmin && (
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
                <button onClick={addCustom} className="w-full bg-shPrimary text-bgHeader rounded py-2 font-black uppercase text-[12px] tracking-widest">
                  Add to Cart
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: cart */}
        <div className="lg:col-span-2">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-4 sticky top-4">
            <p className="text-shTextMuted text-[13px] uppercase tracking-widest font-black mb-2">Cart</p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {cartLines.length === 0 && <p className="text-shTextMuted text-sm">Cart is empty.</p>}
              {cartLines.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-shBorder pb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-shText truncate">{l.kind === "custom" ? l.description : l.name}</p>
                    {l.kind === "retail" && (
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

            {isAdmin && cartLines.length > 0 && !discount && (
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
              <div className="flex justify-between text-shText font-black text-lg"><span>Total</span><span>{money(priced?.total)}</span></div>
            </div>

            <button onClick={openTender} disabled={cartLines.length === 0 || !priced} data-testid="pos-checkout-button"
                    className="mt-4 w-full bg-shPrimary text-bgHeader rounded-2xl py-4 font-black uppercase tracking-widest text-lg disabled:opacity-40">
              Checkout
            </button>
          </div>
        </div>
      </div>

      {checkoutBooking && (
        <CheckoutModal
          booking={checkoutBooking}
          services={services}
          onClose={() => { setCheckoutBooking(null); clearClient(); }}
        />
      )}
      {showTakePayment && selectedClient && (
        <TakePaymentModal
          presetClientId={selectedClient.id}
          onClose={() => setShowTakePayment(false)}
          onSuccess={() => { setShowTakePayment(false); clearClient(); }}
        />
      )}
      {manageProductsOpen && (
        <ManageProductsPanel
          onClose={() => setManageProductsOpen(false)}
          onChanged={loadProducts}
        />
      )}

      {refundingPayment && (
        <StripeRefundModal
          payment={refundingPayment}
          onClose={() => setRefundingPayment(null)}
          onDone={loadOnlinePayments}
        />
      )}
    </div>
  );
}
