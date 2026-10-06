import { useCallback, useEffect, useRef, useState } from "react";
import { isFriendsFamily, isFriendsDog } from "../lib/friendsFamily";
import { toast } from "sonner";
import { api, formatErr } from "../lib/api";
import { useOptionalPromptDialog } from "../lib/promptCtx";
import { askRegisterPin } from "../lib/registerPin";
import { todayISO } from "../lib/date";
import { emitRegisterChanged } from "../lib/registerBus";
import { useEditLock } from "../lib/useLiveRefresh";
import { useAuth } from "../lib/auth";
import { printReceipt as posPrintReceipt, openDrawer as posOpenDrawer } from "../lib/posAgent";
import ReceiptLogo from "./ReceiptLogo";

/**
 * Shared check-out modal — used by the admin Dashboard AND the Employee
 * Portal roster. Handles credit deduction (FIFO from packs), payment-method
 * selection, add-on services (bath / nail trim / etc.), and boarding stay
 * extensions. Income tracking always logs a dollar value even when paying
 * with credits so weekly/monthly totals stay accurate.
 *
 * Props:
 *   booking          — the booking row (must include id, client_id, dog_name,
 *                      client_name, service_type, credit_value, end_date, etc.)
 *   services         — list of active services (for default base price + add-on chips)
 *   onClose          — fires when the modal should close (after success or cancel)
 *   onRequestCancel  — optional; fires when the user clicks "Cancel booking instead"
 */
const fmtBtDay = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

function CheckoutModalBody({ booking, services, onClose, onRequestCancel, lateDay, onLateDayQuestion, onLateDayUndo }) {
  const promptDialog = useOptionalPromptDialog();
  // Sprint 110ao — pauses background polling while this modal is open so
  // the booking row can't churn under the admin's input.
  useEditLock(true);
  // Audit #23 (owner's choice A): only staff with the pricing permission
  // change a price here — the visit price, the per-night rate, an extra
  // amount or a discount. Everyone else checks out at the normal price (the
  // server refuses anything else).
  const auth = useAuth();
  const canPrice = !!auth?.can?.("pricing");
  // Multi-dog reservations share a group_id. When two or more active rows in
  // that group still need checked out, this modal becomes one household checkout.
  const [groupBookings, setGroupBookings] = useState([booking]);
  const [groupLoading, setGroupLoading] = useState(true);
  const [groupReload, setGroupReload] = useState(0);
  const [anchorGone, setAnchorGone] = useState(false);   // re-read after a failure: this dog has already left
  useEffect(() => {
    let alive = true;
    setGroupLoading(true);
    (async () => {
      try {
        const { data } = await api.get(`/bookings/${booking.id}/checkout-group-preview`);
        if (!alive) return;
        const rows = data.bookings || [];
        // A friends & family booking leaves as its group, whichever family each
        // dog belongs to; a family's own dogs as the household (with a dog that
        // joined a stay under way — same group, a later start).
        const fresh = rows.find(b => b.id === booking.id) || booking;
        setAnchorGone(groupReload > 0 && !rows.some(b => b.id === booking.id));
        const ffGroup = isFriendsFamily(fresh) && fresh.group_id;
        const active = rows.filter(b =>
          (ffGroup ? b.group_id === fresh.group_id
                   : b.client_id === booking.client_id &&
                     (b.date === booking.date || (!!booking.group_id && b.group_id === booking.group_id))) &&
          b.service_type === booking.service_type &&
          b.status !== "completed" && !b.checked_out_at &&
          // A booked-but-never-arrived household dog (e.g. Bolt never
          // showed up while Lexi did) must never ride along on Lexi's
          // combined checkout — the backend already excludes it from
          // checkout-group-preview, this is defense-in-depth.
          !!b.checked_in_at
        );
        setGroupBookings(active.length ? active : [booking]);
      } catch {
        if (alive) setGroupBookings([booking]);
      } finally {
        if (alive) setGroupLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [booking, groupReload]);
  // Friends & family (lib/friendsFamily): nothing is paid at this pickup — the
  // visit goes on the paying family's account, and ONE bill is made when the
  // last dog leaves. Dogs may leave at different times, so staff can check out
  // just this one.
  const anchorRow = groupBookings.find(b => b.id === booking.id) || booking;
  const isFF = isFriendsFamily(anchorRow);
  const payerName = anchorRow.bill_to_client_name || "the paying family";
  const [leaveAlone, setLeaveAlone] = useState(false);
  const checkoutBookings = isFF && leaveAlone ? [anchorRow] : (groupBookings.length ? groupBookings : [booking]);
  // No prepaid credits on a friends & family visit (first release) — the
  // paying family's own dogs go on the one bill too.
  const ffNoCredits = isFF;
  const isGroupCheckout = checkoutBookings.length > 1;
  const groupDogNames = checkoutBookings.map(b => b.dog_name).filter(Boolean);

  // Boarding early checkout — a dog leaving before the booked end_date must
  // be charged for the stay it actually had (server-quoted: nights through
  // today + the pickup-day rule at the current clock), not the full booked
  // span. Defaults ON when applicable; the operator can flip back to the
  // full booked price, and a manual base-price override always wins.
  const [earlyQuote, setEarlyQuote] = useState(null);
  const [chargeFullStay, setChargeFullStay] = useState(false);
  useEffect(() => {
    let alive = true;
    setEarlyQuote(null); setChargeFullStay(false);
    if (booking.service_type !== "boarding" || !booking.end_date) return undefined;
    api.get(`/bookings/${booking.id}/early-checkout-quote`)
      .then(r => { if (alive && r.data?.applicable) setEarlyQuote(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [booking.id, booking.service_type, booking.end_date]);

  // Pre-deducted credit info — group bookings normally reserve each dog's
  // fractional credit separately, so add them together for one clear checkout.
  const hadCredit = checkoutBookings.every(b => !!b.credit_value && !b.actual_price);
  const creditAmt = checkoutBookings.reduce((sum, b) => sum + Number(b.credit_value || 0), 0);
  const creditPool = booking.credit_service_type || booking.service_type || "daycare";
  const creditsDeducted = checkoutBookings.reduce((sum, b) => sum + Number(b.credits_deducted || 0), 0);

  const fmtCredits = (n) => {
    const val = Math.round((Number(n) || 0) * 10) / 10;
    return Number.isInteger(val) ? String(val) : val.toFixed(1);
  };

  // Credit units for this row. New group bookings snapshot .5 credits on
  // additional dogs; legacy rows fall back to one credit/day or one credit/night.
  const creditUnitsFor = (row) => {
    const snap = Number(row.credit_units_required || 0);
    if (snap > 0) return snap;
    if (row.service_type !== "boarding") return 1;
    try {
      const s = new Date(row.date), e = new Date(row.end_date || row.date);
      const n = Math.round((e - s) / (1000 * 60 * 60 * 24)) || 1;
      return Math.max(1, n);
    } catch { return 1; }
  };
  // A daycare visit that stayed the night can be paid from DAYCARE credits —
  // the dog was already here on daycare — at the client's boarding/daycare
  // price ratio (2 per night when boarding is double daycare). Server side:
  // domains/bookings/late_day.credit_plan.
  const daycarePerNight = lateDay?.resolved === "stayed_overnight" && lateDay?.daycare_credit_option?.available
    ? Number(lateDay.daycare_credit_option.credits_per_night || 0) : 0;
  const [creditPoolChoice, setCreditPoolChoice] = useState("boarding");
  const payFromDaycare = daycarePerNight > 0 && creditPoolChoice === "daycare";
  const poolFactor = payFromDaycare ? daycarePerNight : 1;
  const creditUnitsNeeded = Math.round(checkoutBookings.reduce((sum, row) => sum + creditUnitsFor(row), 0) * poolFactor * 100) / 100;
  // Fetch client balance so we can offer "pay with credits" at checkout when
  // the booking was made without any pre-deduction (e.g. client had no credits
  // at booking time, then bought a pack later).
  const [clientBal, setClientBal] = useState(null); // { credits, training_credits, boarding_credits, account_balance }
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/clients/${booking.client_id}`);
        if (alive) setClientBal({
          credits: data.credits || 0,
          training_credits: data.training_credits || 0,
          boarding_credits: data.boarding_credits || 0,
          // Sprint 110di-51 — Running tab. Positive = owes, negative = prepaid credit.
          account_balance: Number(data.account_balance || 0),
        });
      } catch (e) { console.warn("client balance fetch failed", e); }
    })();
    return () => { alive = false; };
  }, [booking.client_id]);

  const balField = payFromDaycare ? "credits"
                  : booking.service_type === "training" ? "training_credits"
                  : booking.service_type === "boarding" ? "boarding_credits"
                  : "credits";
  const available = clientBal ? (clientBal[balField] || 0) : 0;
  const creditsToUseNow = Math.min(Number(available || 0), Number(creditUnitsNeeded || 0));
  const canPayWithCredits = !ffNoCredits && !hadCredit && !booking.actual_price && creditsToUseNow > 0;

  // Sprint 110db — Preview the lot that's about to be consumed FIFO so the
  // operator sees its Legacy / Paid-at-sale badge BEFORE clicking
  // "Confirm checkout". Same info that lives in the Pack Lots modal —
  // surfaced inline so they don't have to cross-reference.
  const [nextLot, setNextLot] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/clients/${booking.client_id}/credit-lots`);
        if (!alive || !Array.isArray(data)) return;
        const svc = payFromDaycare ? "daycare" : (booking.service_type || "daycare");
        const next = data
          .filter(l => (l.service_type || "").toLowerCase() === svc.toLowerCase())
          .filter(l => (l.qty_remaining || 0) > 0)
          .sort((a, b) => (a.purchased_at || "").localeCompare(b.purchased_at || ""))[0];
        setNextLot(next || null);
      } catch { /* non-fatal — banner just won't show */ }
    })();
    return () => { alive = false; };
  }, [booking.client_id, booking.service_type, payFromDaycare]);
  const nextLotKind = nextLot
    ? (nextLot.pack_kind === "training_program" ? "program"
       : nextLot.recognize_at_sale ? "paid_at_sale"
       : "legacy")
    : null;

  const [useCredits, setUseCredits] = useState(hadCredit);
  // A prepaid program session (audit #38): paid at the program sale — checkout
  // uses one of its credits and never charges (the server enforces it too).
  const prepaidSession = !!booking.is_prepaid_program_session && !isGroupCheckout && !ffNoCredits;
  useEffect(() => { if (prepaidSession && !useCredits) setUseCredits(true); }, [prepaidSession, useCredits]);
  const [defaultedFromBal, setDefaultedFromBal] = useState(false);
  useEffect(() => {
    if (clientBal && !defaultedFromBal && !hadCredit && creditsToUseNow > 0 && !booking.actual_price && !ffNoCredits) {
      setUseCredits(true);
      setDefaultedFromBal(true);
    }
  }, [clientBal, creditsToUseNow, hadCredit, defaultedFromBal, booking.actual_price, ffNoCredits]);
  useEffect(() => { if (ffNoCredits && useCredits) setUseCredits(false); }, [ffNoCredits, useCredits]);
  // The family's own add-on rates (GET /clients/{id}/service-prices, add_on_prices).
  // The catalogue price is not a family's price, so the cart is priced from these (audit #81).
  const [addOnRates, setAddOnRates] = useState({});
  const [addOnRatesLoaded, setAddOnRatesLoaded] = useState(false);
  const payerForRates = booking.bill_to_client_id || booking.client_id;
  const loadAddOnRates = async () => {
    if (!payerForRates) return null;
    try {
      const { data } = await api.get(`/clients/${payerForRates}/service-prices`, { sharedCache: "refresh" });
      const map = {};
      for (const [id, row] of Object.entries(data?.add_on_prices || {})) map[id] = Number(row.effective_price);
      setAddOnRates(map);
      setAddOnRatesLoaded(true);
      return map;
    } catch {
      setAddOnRatesLoaded(false);
      return null;
    }
  };
  const addOnPriceIn = (rates, svc) => (rates && rates[svc?.id] != null ? rates[svc.id] : Number(svc?.base_price || 0));
  const addOnPriceFor = (svc) => addOnPriceIn(addOnRates, svc);
  useEffect(() => { loadAddOnRates(); }, [payerForRates]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ffResult, setFfResult] = useState(null);   // after a friends & family checkout: { bill, dogs }
  const [ffBusy, setFfBusy] = useState(false);
  const ffBusyRef = useRef(false);   // (a second tap lands before the screen redraws)
  const [ffErr, setFfErr] = useState("");
  const [ffConfirmClose, setFfConfirmClose] = useState(false);
  const [payMethod, setPayMethod] = useState("cash");
  // "Other" (Zelle, Cash App…) needs a note saying what it was, as at the Register.
  const [otherNote, setOtherNote] = useState("");
  // Paying a pickup with a gift card. The balance is checked while the
  // customer is still standing there, not when the checkout is submitted.
  const [giftCode, setGiftCode] = useState("");
  const [giftCard, setGiftCard] = useState(null);
  const [giftBusy, setGiftBusy] = useState(false);
  const lookupGiftCard = async () => {
    if (!giftCode.trim()) return;
    setGiftBusy(true);
    try {
      const { data } = await api.get(`/gift-cards/lookup/${encodeURIComponent(giftCode.trim())}`);
      setGiftCard(data);
    } catch (e) {
      setGiftCard(null);
      setErr(formatErr(e.response?.data?.detail) || "No gift card with that code.");
    }
    setGiftBusy(false);
  };
  const [basePrice, setBasePrice] = useState("");
  // Reason for a manual price change — stored on the booking's
  // manual_price_override audit stamp (who/when/from/to/why).
  const [priceReason, setPriceReason] = useState("");
  const [extraNights, setExtraNights] = useState(0);
  const [extraUseCredits, setExtraUseCredits] = useState(true);
  // (Never on a friends & family visit: every extra night goes on the paying family's account.)
  const extraNightsUseCredits = extraUseCredits && !ffNoCredits;
  const [extraRate, setExtraRate] = useState("");
  // Today's price list: the screen that opened this checkout may have loaded
  // its copy hours ago (the Register and the Employee Portal load it once),
  // and add-ons are charged at the price this screen shows (audit #23).
  const [liveServices, setLiveServices] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get("/services", { sharedCache: "refresh" })
      .then(r => { if (alive && Array.isArray(r.data) && r.data.length) setLiveServices(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const catalog = liveServices || services || [];
  const exactService = catalog.find(s => s.id === booking.service_id && s.active);
  const defaultService = catalog.find(s => s.service_type === booking.service_type && s.is_default && s.active);
  const savedUnitRate = Number(booking.pricing_snapshot?.unit_price || booking.unit_price || 0);
  const serviceUnitRate = savedUnitRate > 0
    ? savedUnitRate
    : Number(exactService?.base_price || defaultService?.base_price || 0);
  const extraRateEffective = extraRate !== "" ? Number(extraRate) || 0 : serviceUnitRate;
  const isBoarding = booking.service_type === "boarding";
  // Sprint 110an — only show services that are flagged as add-ons AND
  // eligible for this booking's service type. Falls back to the legacy
  // "any non-base service" rule for any service that hasn't been flagged
  // yet (so existing setups keep working). The flagged-only list wins
  // when there are any eligible add-ons configured.
  const flaggedAddons = catalog.filter(
    s => s.active && s.is_addon && (s.addon_for || []).includes(booking.service_type)
  );
  const legacyCandidates = catalog.filter(
    s => s.active && !s.is_addon && s.service_type !== booking.service_type
  );
  // Once the catalog uses the add-on flag AT ALL, the legacy "any other
  // service" fallback is retired — it dumped every base service (Board &
  // Train, duplicate daycare rows, …) into the picker for service types with
  // no eligible flagged add-ons. Pure-legacy catalogs (zero flagged add-ons
  // anywhere) keep the old behavior.
  const catalogUsesAddonFlag = catalog.some(s => s.active && s.is_addon);
  const addOnCandidates = flaggedAddons.length > 0
    ? flaggedAddons
    : (catalogUsesAddonFlag ? [] : legacyCandidates);
  const [cart, setCart] = useState({});

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // A Board & Train stay whose training record has gaps in it. The backend
  // refuses the checkout and hands back the sessions it wants accounted for;
  // this holds that question, and the answers given to it.
  const [btBlock, setBtBlock] = useState(null);
  const [btAnswers, setBtAnswers] = useState({});
  // Merchandise bought while the dog is collected. These are NOT add-on
  // services: they ring through the Register's own sale, so stock, sales tax
  // and retail revenue stay where they already work.
  const [shopItems, setShopItems] = useState([]);
  const [shopCart, setShopCart] = useState({});
  const [shopOpen, setShopOpen] = useState(false);
  // One key per open modal, so a retry replays the sale instead of selling
  // the same bag of food twice.
  const [retailKey] = useState(() => `pickup-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  // Front-desk POS hardware integration — once the checkout itself has
  // already fully committed, this tracks the SEPARATE, purely physical
  // outcome of printing/opening the drawer. A hardware failure here never
  // reopens or retries the checkout itself — only these two actions retry.
  const [hwResult, setHwResult] = useState(null); // null until checkout succeeds and a pos token exists
  const [hwBusy, setHwBusy] = useState(false);
  const [hwInvoiceId, setHwInvoiceId] = useState(null);
  // Reopened checkouts (audit #14): a bill still waiting for another
  // reopened dog has no receipt yet; dogs from two reopened bills checked
  // out together get a receipt for each bill.
  const [hwWaiting, setHwWaiting] = useState(false);
  const [hwExtraIds, setHwExtraIds] = useState([]);
  const [emailBusy, setEmailBusy] = useState(false);
  const [receiptViewOpen, setReceiptViewOpen] = useState(null);

  const runHardware = async (printToken, drawerToken, extraPrintTokens = []) => {
    setHwBusy(true);
    const next = { printToken, drawerToken, print: null, drawer: null, extraFailed: 0 };
    if (drawerToken) next.drawer = await posOpenDrawer(drawerToken);
    if (printToken) next.print = await posPrintReceipt(printToken);
    for (const token of extraPrintTokens) {
      const r = await posPrintReceipt(token);
      if (!r?.ok) next.extraFailed += 1;
    }
    setHwResult(next);
    setHwBusy(false);
  };

  const printExtra = async (id) => {
    try {
      const { data } = await api.post(`/invoices/${id}/pos-tokens`, { actions: ["print_receipt"] });
      const r = await posPrintReceipt(data.print_receipt_token);
      if (r?.ok) toast.success("Receipt printed");
      else toast.error(r?.error || "Receipt printing failed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not print the receipt");
    }
  };

  const emailReceipt = async (id = hwInvoiceId) => {
    if (!id) return;
    setEmailBusy(true);
    try {
      const { data } = await api.post(`/receipts/invoice/${id}/email`, {});
      if (data.ok) toast.success("Receipt emailed");
      else toast.error(data.detail || "Could not email the receipt");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not email the receipt");
    }
    setEmailBusy(false);
  };

  const viewReceipt = async (id = hwInvoiceId) => {
    if (!id) return;
    try {
      const { data } = await api.get(`/receipts/invoice/${id}`);
      setReceiptViewOpen(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the receipt");
    }
  };

  // A hardware-action token is single-use — consumed the moment it's
  // verified, even if the physical action then fails. A genuine retry
  // needs a FRESH token from the server, never the already-spent one.
  const retryHardware = async (action) => {
    if (!hwInvoiceId) return;
    const payload = { actions: [action] };
    if (action === "open_drawer") {
      // Opening the drawer from a reprint needs the employee's register PIN (audit #48).
      const pin = await askRegisterPin(promptDialog);
      if (!pin) return;
      payload.pin = pin;
    }
    setHwBusy(true);
    try {
      const { data } = await api.post(`/invoices/${hwInvoiceId}/pos-tokens`, payload);
      if (action === "open_drawer") {
        const result = await posOpenDrawer(data.open_drawer_token);
        setHwResult(prev => ({ ...prev, drawerToken: data.open_drawer_token, drawer: result }));
      } else {
        const result = await posPrintReceipt(data.print_receipt_token);
        setHwResult(prev => ({ ...prev, printToken: data.print_receipt_token, print: result }));
      }
    } catch (e) {
      const msg = e.response?.data?.detail || "Could not reissue the hardware token";
      setHwResult(prev => ({
        ...prev,
        ...(action === "open_drawer" ? { drawer: { ok: false, error: msg } } : { print: { ok: false, error: msg } }),
      }));
    }
    setHwBusy(false);
  };
  // Sprint 110di-51 — Partial-payment / tab. When the customer hands over
  // LESS than the total, this captures what they paid; the difference goes
  // onto the client's running tab (account_balance). Mode toggle makes the
  // feature DISCOVERABLE (the legacy "optional field" was being missed).
  const [payMode, setPayMode] = useState("full"); // "full" | "partial"
  const [amountPaid, setAmountPaid] = useState("");
  // One-time checkout discount. This changes only the dollar amount due and
  // never changes old credits, credit lots, or the number of credits redeemed.
  const [checkoutDiscount, setCheckoutDiscount] = useState("");
  const [checkoutDiscountReason, setCheckoutDiscountReason] = useState("");
  // Sprint 110 — fetch multi-dog discount preview (only shows if 2nd+ dog of
  // the same client has already been checked out today).
  const [discountPreview, setDiscountPreview] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/bookings/${booking.id}/discount-preview`);
        if (alive) setDiscountPreview(data);
      } catch { /* non-fatal — quietly skip the line item */ }
    })();
    return () => { alive = false; };
  }, [booking.id]);

  const [moneyModifierPreview, setMoneyModifierPreview] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/bookings/${booking.id}/money-modifier-preview`);
        if (alive) setMoneyModifierPreview(data);
      } catch { /* non-fatal — no configured surcharge or preview unavailable */ }
    })();
    return () => { alive = false; };
  }, [booking.id]);

  const addOne = (svc) => setCart(c => ({ ...c, [svc.id]: { service: svc, qty: (c[svc.id]?.qty || 0) + 1 } }));
  const removeOne = (svc) => setCart(c => {
    const next = { ...c };
    const cur = next[svc.id];
    if (!cur) return c;
    if (cur.qty <= 1) delete next[svc.id]; else next[svc.id] = { ...cur, qty: cur.qty - 1 };
    return next;
  });

  const cartItems = Object.values(cart);
  const addOnTotal = cartItems.reduce((s, it) => s + (addOnPriceFor(it.service) * it.qty), 0);
  const addonTotalFor = (row) => (row.add_ons || []).reduce(
    (sum, ao) => sum + (Number(ao.price || 0) * Number(ao.qty || 1)), 0,
  );
  const anchorExistingAddonTotal = addonTotalFor(booking);
  const existingAddonTotal = checkoutBookings.reduce((sum, row) => sum + addonTotalFor(row), 0);
  const anchorPreviewRow = checkoutBookings.find(row => row.id === booking.id) || booking;
  const anchorTicketEstimate = Number(anchorPreviewRow.checkout_preview_total ?? anchorPreviewRow.estimated_price ?? 0);
  const bookingBaseEstimate = Math.max(0, anchorTicketEstimate - anchorExistingAddonTotal);
  // The group preview has already taken this dog's same-day sibling discount
  // off checkout_preview_total, so the discount line below must not take it
  // off a second time.
  const anchorDiscountInPreview = Number(anchorPreviewRow.checkout_preview_discount || 0) > 0;

  // Sprint 110eg — When paying with credits, the `basePrice` input is
  // interpreted as the EXTRA cash to charge today on top of credits
  // (matches the relabelled "Additional cash charge" field). For non-credit
  // checkouts, it's the standard base-price override.
  const extraCashOnCredits = useCredits && basePrice !== "" && !prepaidSession ? Number(basePrice) : 0;
  const baseCreditShortfallUnits = useCredits && !hadCredit && !prepaidSession   // a prepaid session is never charged (audit #38)
    ? Math.max(0, Number(creditUnitsNeeded || 0) - Number(creditsToUseNow || 0))
    : 0;
  const baseCreditShortfallCash = Math.round(baseCreditShortfallUnits * (serviceUnitRate / poolFactor) * 100) / 100;
  // A converted overnight picked up after the boarding checkout time owes
  // the pickup-day daycare fee in cash even when credits cover the nights
  // (checkout charges it the same way) — so it must show as due today.
  const lateDayPickupCash = useCredits && !hadCredit && lateDay?.resolved === "stayed_overnight"
    ? Number(lateDay.late_pickup_cash || 0) : 0;
  // A boarding stay's late-pickup daycare fee is cash even when credits cover the
  // nights (audit #3). A converted late-day stay already shows its own fee above,
  // so it is counted once.
  const boardingLateFeeCash = useCredits && lateDayPickupCash === 0
    ? Number(discountPreview?.late_pickup_fee_cash || 0) : 0;
  const baseCashDueOnCredits = useCredits
    ? baseCreditShortfallCash + Math.max(0, extraCashOnCredits) + lateDayPickupCash + boardingLateFeeCash
    : 0;

  // Early boarding checkout applies when the server quoted one and the operator
  // hasn't flipped back to full-stay pricing. A household leaving together goes at
  // the early price too (each leaving dog at its own early price); a friends &
  // family household is paid on the family's bill, which keeps the booked span.
  const earlyStayActive = !!earlyQuote && !chargeFullStay && !(isGroupCheckout && isFF);
  // The other dogs in a household checkout: at their early prices while the early
  // price is in use for the household, otherwise at their booked prices.
  const groupOtherBaseTotal = checkoutBookings
    .filter(row => row.id !== booking.id)
    .reduce((sum, row) => {
      const total = earlyStayActive && row.early_checkout_total != null
        ? row.early_checkout_total
        : (row.checkout_preview_total ?? row.estimated_price ?? 0);
      return sum + Math.max(0, Number(total) - addonTotalFor(row));
    }, 0);

  // The AUTO price — what the system would charge with no manual override.
  // Kept separate from basePreview so the manual-override notice can compare
  // the typed amount against it (folding the typed value into basePreview
  // made that comparison always equal, hiding the notice).
  let autoBasePreview = 0;
  if (useCredits && hadCredit && creditAmt > 0) {
    autoBasePreview = creditAmt;
  } else if (earlyStayActive && !useCredits) {
    // Early boarding checkout: charge the server-quoted ACTUAL stay
    // (nights through today + pickup-day rule at the current clock), not
    // the full booked span the snapshot/preview endpoints price. Cash path
    // only — credit deductions are computed server-side from the booked span.
    autoBasePreview = Number(earlyQuote.base_price || 0);
  } else {
    const defaultSvc = catalog.find(s => s.is_default && s.service_type === booking.service_type && s.active);
    // Prefer the booking's saved estimate/snapshot. This keeps checkout aligned
    // with grandfathered rates and with pre-applied 50% additional-dog group rows.
    const correctedBoardingPreview = booking.service_type === "boarding"
      ? Number(discountPreview?.preview_base_price || 0)
      : 0;
    autoBasePreview = correctedBoardingPreview > 0
      ? correctedBoardingPreview
      : (bookingBaseEstimate > 0
          ? bookingBaseEstimate
          : (defaultSvc ? Number(defaultSvc.base_price || 0) : Number(booking.actual_price || 0)));
  }
  const basePreview = prepaidSession ? 0 : ((basePrice !== "" && !useCredits) ? (Number(basePrice) || 0) : autoBasePreview);
  const isAdditionalDogRow = booking.pricing_snapshot?.group_dog_index > 0 || !!booking.multi_dog_discount?.pre_applied;
  const extraCreditUnitsPerNight = isGroupCheckout
    ? checkoutBookings.reduce((sum, row) => sum + ((row.pricing_snapshot?.group_dog_index > 0 || row.multi_dog_discount?.pre_applied) ? 0.5 : 1), 0)
    : (isAdditionalDogRow ? 0.5 : 1);
  const extraCreditUnitsNeeded = isBoarding ? Number(extraNights || 0) * extraCreditUnitsPerNight : 0;
  const creditsReservedForBase = useCredits && !hadCredit ? Number(creditsToUseNow || 0) : 0;
  const creditsAvailableForExtra = Math.max(0, Number(available || 0) - creditsReservedForBase);
  const extraCreditsPreview = extraNightsUseCredits
    ? Math.min(extraCreditUnitsNeeded, creditsAvailableForExtra)
    : 0;
  const extraBilledUnits = Math.max(0, extraCreditUnitsNeeded - extraCreditsPreview);
  const extraNightsCharge = isBoarding && extraNights > 0
    ? Math.round(extraBilledUnits * extraRateEffective * 100) / 100
    : 0;
  // An early checkout charged at the early price is surcharged on the nights it
  // stayed: the preview carries that breakdown next to the booked-span one.
  const earlyPriceCharged = earlyStayActive && !useCredits && basePrice === "";
  const modifierPreview = (earlyPriceCharged && moneyModifierPreview?.early) || moneyModifierPreview;
  const modifierBase = (!useCredits && basePrice !== "")
    ? basePreview
    : Number(modifierPreview?.base_before || basePreview || 0);
  const modifierMultiplier = Number(modifierPreview?.seasonal_multiplier || 1);
  const modifierLateFee = Number(modifierPreview?.late_pickup_fee || 0);
  let modifiedBase = (modifierBase * modifierMultiplier) + modifierLateFee;
  if (modifierPreview?.round_to_dollar) modifiedBase = Math.round(modifiedBase);
  const moneyModifierTotal = Math.round((modifiedBase - modifierBase) * 100) / 100;

  // Multi-dog discount preview: recompute against the CURRENT basePreview (so
  // if the operator overrides the base price, the discount updates live).
  let multiDogDiscount = 0;
  const discountableBase = Math.max(0, basePreview + moneyModifierTotal + extraNightsCharge);
  if (discountPreview?.eligible && discountPreview.discount && discountableBase > 0 && !useCredits && !booking.multi_dog_discount?.pre_applied && !anchorDiscountInPreview) {
    const d = discountPreview.discount;
    if (d.mode === "percent") {
      multiDogDiscount = Math.round(discountableBase * (Math.max(0, Math.min(100, d.value)) / 100) * 100) / 100;
    } else {
      multiDogDiscount = Math.min(discountableBase, Math.round(d.value * 100) / 100);
    }
  }
  // What is due before tax. Pre-attached add-ons are locked onto the booking
  // and must be included alongside any new checkout add-ons.
  const preTaxBeforeCheckoutDiscount = Math.max(
    0,
    (useCredits ? baseCashDueOnCredits : (basePreview + groupOtherBaseTotal)) + moneyModifierTotal + existingAddonTotal + addOnTotal + extraNightsCharge - multiDogDiscount,
  );
  // (Never on a friends & family visit — a discount typed before the screen
  // learned the booking became one must not stay behind, unseen, and block it.)
  const checkoutDiscountRequested = isFF ? 0 : Math.max(0, Number(checkoutDiscount || 0));
  const checkoutDiscountApplied = Math.min(preTaxBeforeCheckoutDiscount, checkoutDiscountRequested);
  const preTaxChargedToday = Math.max(0, preTaxBeforeCheckoutDiscount - checkoutDiscountApplied);
  const checkoutDiscountTooHigh = checkoutDiscountRequested > preTaxBeforeCheckoutDiscount + 0.005;
  const checkoutDiscountReasonMissing = checkoutDiscountRequested > 0 && checkoutDiscountReason.trim().length < 3;

  // ── Board & Train sessions with no record ─────────────────────────────
  // Every session the backend is asking about, grouped into the days they
  // belong to so the list reads like a calendar rather than a queue.
  const btSessions = btBlock?.unresolved_sessions || [];
  const btChoices = btBlock?.resolutions || [];
  const btDays = btSessions.reduce((acc, s) => {
    (acc[s.date] = acc[s.date] || []).push(s);
    return acc;
  }, {});
  const btUnanswered = btSessions.filter((s) => !btAnswers[`${s.date}|${s.slot}`]).length;
  const answerAll = (outcome) => setBtAnswers(
    Object.fromEntries(btSessions.map((s) => [`${s.date}|${s.slot}`, outcome])));
  const btCounts = btChoices.map((c) => ({
    ...c, n: btSessions.filter((s) => btAnswers[`${s.date}|${s.slot}`] === c.value).length,
  })).filter((c) => c.n > 0);
  const salesTaxCfg = moneyModifierPreview?.sales_tax || {};
  // The stay is never taxed (services aren't), but merchandise is — so the
  // shop basket needs the configured rate itself, not the booking's answer.
  const salesTaxRateRaw = salesTaxCfg.enabled ? Math.max(0, Number(salesTaxCfg.rate_pct || 0)) : 0;

  // What is in the shop basket, and what it costs. The tax shown here is the
  // same arithmetic the Register does; the server prices it again for real,
  // so this is a preview, never the number that gets charged.
  const shopLines = shopItems
    .map((it) => ({ item: it, qty: shopCart[it.id] || 0 }))
    .filter((l) => l.qty > 0);
  const shopSubtotal = shopLines.reduce((n, l) => n + l.item.effective_price * l.qty, 0);
  const shopTaxable = shopLines.reduce((n, l) => n + (l.item.taxable ? l.item.effective_price * l.qty : 0), 0);
  const shopTax = Math.round(shopTaxable * (salesTaxRateRaw / 100) * 100) / 100;
  const shopTotal = Math.round((shopSubtotal + shopTax) * 100) / 100;
  const setShopQty = (id, qty) => setShopCart((prev) => {
    const next = { ...prev };
    if (qty > 0) next[id] = qty; else delete next[id];
    return next;
  });
  const salesTaxRate = salesTaxCfg.enabled && salesTaxCfg.applies
    ? Math.max(0, Number(salesTaxCfg.rate_pct || 0))
    : 0;
  const salesTaxAmount = Math.round(preTaxChargedToday * (salesTaxRate / 100) * 100) / 100;
  const chargedToday = Math.round((preTaxChargedToday + salesTaxAmount) * 100) / 100;
  // One number at the counter: the stay plus anything bought with it.
  const dueToday = Math.round((chargedToday + shopTotal) * 100) / 100;
  // "Paid with" is asked whenever anything is paid today: the stay, or the
  // shop items when credits cover the stay (audit #24). In that second case
  // the tender is the goods' alone and travels as retail_payment_method.
  const goodsOnlyPayment = useCredits && chargedToday <= 0 && shopTotal > 0 && !isFF;
  const payPickerShown = (!useCredits || chargedToday > 0 || shopTotal > 0) && !isFF;

  useEffect(() => {
    let alive = true;
    api.get("/pos/catalog", { params: booking.client_id ? { client_id: booking.client_id } : {} })
      .then(({ data }) => {
        if (!alive) return;
        // Products only. Credit packs and training programs are services and
        // belong in the Register, not on a pickup.
        setShopItems((data?.items || []).filter((it) => it.kind === "product" && it.in_stock));
      })
      .catch(() => { if (alive) setShopItems([]); });
    return () => { alive = false; };
  }, [booking.client_id]);

  // Asks the server for today's add-on prices (never the app's short-lived
  // copy). When one in the cart changed or is no longer offered, updates the
  // cart, says so and returns true: the operator checks the total again.
  const recheckAddOnPrices = async () => {
    if (cartItems.length === 0) return false;
    const [{ data: now }, fresh] = await Promise.all([api.get("/services", { sharedCache: "refresh" }), loadAddOnRates()]);
    if (!Array.isArray(now) || !now.length) return false;
    const current = (it) => now.find(sv => sv.id === it.service.id && sv.active);
    const priceNow = (sv) => addOnPriceIn(fresh, sv);
    const changed = cartItems.filter(it => !current(it) || Math.abs(priceNow(current(it)) - addOnPriceFor(it.service)) > 0.005);
    if (!changed.length) return false;
    setLiveServices(now);
    setCart(c => Object.fromEntries(Object.values(c).filter(it => current(it)).map(it => [it.service.id, { ...it, service: current(it) }])));
    const svcNow = current(changed[0]);
    setErr(svcNow
      ? `The price of ${svcNow.name} is now $${priceNow(svcNow).toFixed(2)}. Check the total and press Complete again.`
      : `${changed[0].service.name} isn't offered anymore, so it was taken off. Check the total and press Complete again.`);
    return true;
  };

  const submit = async () => {
    setErr("");
    // Never charge an add-on at a guessed price: the family's rates must be in hand first.
    if (cartItems.length > 0 && !addOnRatesLoaded) {
      const loaded = await loadAddOnRates();
      setErr(loaded
        ? "The add-on prices have just loaded. Check the total and press Complete again."
        : "Couldn't load this family's add-on prices. Try again in a moment.");
      return;
    }
    if (checkoutDiscountReasonMissing) {
      setErr("Enter a reason for the checkout discount (at least 3 characters).");
      return;
    }
    if (checkoutDiscountTooHigh) {
      setErr(`The discount cannot exceed the $${preTaxBeforeCheckoutDiscount.toFixed(2)} dollar amount due.`);
      return;
    }
    if (payMethod === "other" && payPickerShown && !otherNote.trim()) {
      setErr("A note is required when the payment method is Other.");
      return;
    }
    setBusy(true);
    try {
      // The early-checkout price depends on the clock (the pickup-time rule):
      // ask again, so what is charged is what the screen shows.
      if (earlyStayActive && basePrice === "" && !useCredits) {
        const { data: fresh } = await api.get(`/bookings/${booking.id}/early-checkout-quote`);
        if (!fresh?.applicable || Math.abs(Number(fresh.base_price) - Number(earlyQuote.base_price)) > 0.005) {
          setEarlyQuote(fresh?.applicable ? fresh : null);
          setErr(fresh?.applicable
            ? `The early-checkout price is now $${Number(fresh.base_price).toFixed(2)} (pickup is now past the checkout time). Check it and press Complete again.`
            : "This stay is no longer an early checkout. Check the price and press Complete again.");
          setBusy(false);
          return;
        }
      }
      // Add-on prices: ask again too, so the price charged is the one shown.
      if (await recheckAddOnPrices()) {
        setBusy(false);
        return;
      }
      const body = {
        use_credits: useCredits,
        ...(payFromDaycare && useCredits ? { late_day_credit_pool: "daycare" } : {}),
        add_ons: cartItems.map(it => ({
          service_id: it.service.id, name: it.service.name,
          price: addOnPriceFor(it.service), qty: it.qty,
        })),
      };
      if (checkoutDiscountRequested > 0) {
        body.checkout_discount_amount = Number(checkoutDiscountRequested.toFixed(2));
        body.checkout_discount_reason = checkoutDiscountReason.trim();
      }
      if (payMethod === "other" && payPickerShown) body.payment_notes = otherNote.trim();   // (only for Other: never stamped on a card payment)
      if (payMethod === "gift_card" && payPickerShown) {
        if (!giftCard) { setErr("Check the gift card's balance first."); setBusy(false); return; }
        body.gift_card_code = giftCode.trim();
      }
      if (shopLines.length) {
        body.retail_lines = shopLines.map((l) => ({ kind: "retail", product_id: l.item.id, qty: l.qty }));
        body.retail_idempotency_key = retailKey;
        // Merchandise always takes real money, whatever the stay is doing.
        if (goodsOnlyPayment) body.retail_payment_method = payMethod;
        else body.payment_method = payMethod;
      }
      if (btSessions.length) {
        body.board_train_resolution = btSessions.map((s) => ({
          date: s.date, slot: s.slot, outcome: btAnswers[`${s.date}|${s.slot}`],
        })).filter((s) => s.outcome);
      }
      if (isBoarding && extraNights > 0) {
        body.extra_nights = Number(extraNights);
        body.extra_nights_use_credits = extraNightsUseCredits;
        if (extraRate !== "") body.extra_nights_rate = Number(extraRate);
      }
      // Credit checkout keeps the service value and any explicit overage
      // separate. This avoids replacing the entire base price with the extra
      // cash amount during mixed credit/cash checkout.
      if (useCredits && basePrice !== "") {
        body.additional_cash_charge = Math.max(0, Number(basePrice) || 0);
      }

      if (!useCredits) {
        body.payment_method = payMethod;
        if (basePrice !== "") {
          body.base_price = Number(basePrice);
          if (priceReason.trim()) body.base_price_reason = priceReason.trim();
        }
        // Early boarding checkout: the backend prices from the booked-span
        // snapshot, so the actual-stay amount must travel as an explicit
        // base_price (manual override above still wins when typed).
        else if (earlyStayActive) body.base_price = Number(earlyQuote.base_price || 0);
        // Sprint 110di-51 — Partial pay / tab. A real bug: this used to send
        // payment_status="paid" unconditionally and only attached amount_paid
        // when the operator typed a non-blank number, so "Partial / on tab"
        // with the amount field left blank (the natural way to mean "collect
        // nothing today") silently reached the backend as a full payment —
        // false completed Payment, no AR, invoice marked PAID. Now: partial/
        // tab mode ALWAYS sends an explicit numeric amount_paid (blank → 0)
        // and asserts payment_status="paid_partial" as an explicit tab-intent
        // signal the backend never lets collapse into "paid" on its own.
        if (payMode === "partial") {
          body.amount_paid = amountPaid === "" ? 0 : Number(amountPaid);
          body.payment_status = "paid_partial";
        } else {
          body.payment_status = "paid";
        }
      } else if (!goodsOnlyPayment && payPickerShown && (extraNightsCharge > 0 || baseCashDueOnCredits > 0 || existingAddonTotal > 0 || addOnTotal > 0)) {
        // (Not when the tender is the goods' alone: it would also become the stay's.)
        body.payment_method = payMethod;
        body.payment_status = "paid";
      }
      // Mixed credits + cash (add-ons, overages, tips, uncovered nights).
      // Send both the tender and exact cash portion so the backend can put
      // that money into the physical drawer without counting credits again.
      if (useCredits && chargedToday > 0) {
        body.payment_method = payMethod;
        body.payment_status = "paid";
        body.amount_paid = Number(chargedToday.toFixed(2));
      }
      // The server refuses the checkout if the booking stopped (or started)
      // being friends & family since this screen read it.
      body.expect_friends_family = isFF;
      if (isFF) {
        // Nothing is paid at a friends & family pickup (the server refuses money
        // offered here): the visit goes on the paying family's account.
        for (const k of ["payment_method", "retail_payment_method", "gift_card_code", "retail_lines", "retail_idempotency_key", "tendered_amount", "additional_cash_charge", "checkout_discount_amount", "checkout_discount_reason", "payment_notes"]) delete body[k];
        body.payment_status = "paid_partial";
        body.amount_paid = 0;
        if (ffNoCredits) {
          body.use_credits = false;
          delete body.late_day_credit_pool;
          if (body.extra_nights) body.extra_nights_use_credits = false;
        }
      }
      // Silent geolocation capture (audit trail)
      try {
        if (navigator.geolocation) {
          const pos = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
            (p) => resolve(p), () => resolve(null),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
          ));
          if (pos) {
            body.lat = pos.coords.latitude;
            body.lng = pos.coords.longitude;
            body.accuracy_m = pos.coords.accuracy;
          }
        }
      } catch { /* silent */ }
      const checkoutPath = isGroupCheckout
        ? `/bookings/${booking.id}/check-out-group`
        : `/bookings/${booking.id}/check-out`;
      const { data } = await api.post(checkoutPath, body);
      // The checkout has ALREADY fully committed by this point — nothing
      // below this line can affect that. Hardware actions are strictly
      // best-effort and post-hoc; failures here never mean the payment failed.
      emitRegisterChanged();
      if (isFF) {
        setBusy(false);
        const done = data?.friends_family ? (data.bookings || []) : [data];
        setFfResult({ bill: data?.invoice || data?.group_bill || null, dogs: done.map(b => b?.dog_name).filter(Boolean) });
        // Goods bought at pickup on this checkout print too. This screen has no
        // hardware status, so a failed print is said in a toast instead.
        const goodsTokens = data?.pos_extra_print_receipt_tokens || [];
        if (goodsTokens.length) {
          (async () => {
            let failed = 0;
            for (const token of goodsTokens) {
              const r = await posPrintReceipt(token);
              if (!r?.ok) failed += 1;
            }
            if (failed) toast.error(`${failed} receipt${failed === 1 ? "" : "s"} didn't print — reprint from Recent Sales.`);
          })();
        }
        return;
      }
      const printToken = data?.pos_print_receipt_token;
      const drawerToken = data?.pos_open_drawer_token;
      setHwInvoiceId(data?.pos_invoice_id || null);
      setHwWaiting(!!data?.pos_receipt_waiting);
      setHwExtraIds(data?.pos_extra_invoice_ids || []);
      setBusy(false);
      // Always show the post-checkout status screen (even with no tokens at
      // all) so staff has a manual View/Print/Email path when auto-print is
      // off and no cash was tendered — turning auto-print off must never
      // leave staff with zero way to produce a receipt on request.
      const extraPrintTokens = data?.pos_extra_print_receipt_tokens || [];
      if (data?.pos_invoice_id || extraPrintTokens.length) {   // goods bought at pickup print even with no visit bill
        await runHardware(printToken, drawerToken, extraPrintTokens);
      } else {
        onClose();
      }
    } catch (e) {
      // The interceptor flattens `detail` to a sentence, so anything that
      // needs to branch on a structured error has to read detail_object.
      const detail = e.response?.data?.detail_object;
      if (detail?.code === "board_train_training_incomplete") {
        setBtBlock(detail);
        setErr("");
      } else if (detail?.code === "late_day_checkout_resolution_required" && onLateDayQuestion) {
        // Checked out a day late and not answered yet: back to the question.
        setBusy(false);
        onLateDayQuestion(detail);
        return;
      } else {
        setErr(e.response?.data?.detail || "Check-out failed");
        if (isFF || e.response?.status === 409) { setGroupReload((n) => n + 1); emitRegisterChanged(); }
        // A price changed between the check and Complete: show it now, so the next press goes through.
        if (e.response?.status === 409) await recheckAddOnPrices().catch(() => false);
      }
      setBusy(false);
    }
  };

  const receiptModal = receiptViewOpen && (
    <div className="fixed inset-0 bg-black/70 z-[60] grid place-items-center p-4" onClick={() => setReceiptViewOpen(null)}>
      <div className="bg-white text-black rounded-lg p-5 max-w-sm w-full text-[13px]" onClick={(e) => e.stopPropagation()} data-testid="checkout-receipt-view-modal">
        {receiptViewOpen.test_receipt && (
          <div className="bg-amber-200 text-amber-900 text-center font-black text-[10px] uppercase tracking-widest py-1 mb-2 rounded">{receiptViewOpen.test_label}</div>
        )}
        <ReceiptLogo imageId={receiptViewOpen.business_logo_image_id} />
        <p className="font-black text-base">{receiptViewOpen.business_name}</p>
        <p className="text-gray-500 mt-1">Receipt #{receiptViewOpen.receipt_number}</p>
        {receiptViewOpen.client_name && <p className="text-gray-500">Client: {receiptViewOpen.client_name}</p>}
        <div className="border-t border-gray-200 my-2" />
        {(receiptViewOpen.line_items || []).map((li, i) => (
          <div key={i} className="flex justify-between gap-2"><span>{li.description}{li.qty > 1 ? ` × ${li.qty}` : ""}</span><span className="font-bold">{li.amount != null ? `$${Number(li.amount).toFixed(2)}` : ""}</span></div>
        ))}
        <div className="border-t border-gray-200 my-2" />
        <div className="flex justify-between font-black text-base"><span>Total</span><span>${Number(receiptViewOpen.total ?? receiptViewOpen.invoice_total ?? receiptViewOpen.payment_amount ?? 0).toFixed(2)}</span></div>
        <button onClick={() => setReceiptViewOpen(null)} className="mt-4 w-full bg-gray-100 text-gray-700 rounded py-2 font-black uppercase text-[12px] tracking-widest">Close</button>
      </div>
    </div>
  );

  // Staff close the group's one bill now (a dog is staying on, or won't come back).
  const closeBillNow = async () => {
    if (ffBusyRef.current) return;
    ffBusyRef.current = true;
    setFfBusy(true); setFfErr("");
    try {
      const { data } = await api.post(`/bookings/group/${anchorRow.group_id}/close-bill`);
      setFfResult((r) => ({ ...r, bill: data }));
      setFfConfirmClose(false);
      emitRegisterChanged();
    } catch (e) {
      setFfErr(e.response?.data?.detail || "Could not make the bill");
    }
    ffBusyRef.current = false;
    setFfBusy(false);
  };

  // A friends & family checkout took no money: say where the visit went.
  if (ffResult) {
    const bill = ffResult.bill;
    const dogs = ffResult.dogs.length ? ffResult.dogs.join(" + ") : booking.dog_name;
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="checkout-ff-result">
        <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-shBlue/20 text-shBlue w-11 h-11 rounded-full flex items-center justify-center text-xl">
              <i className="fas fa-check"/>
            </div>
            <h4 className="text-lg font-black text-white uppercase italic tracking-tight">{dogs} checked out</h4>
          </div>
          {bill ? (
            <p className="text-[14px] text-gray-300" data-testid="checkout-ff-bill">
              One bill for <strong className="text-white">{bill.client_name || payerName}</strong>:{" "}
              <strong className="text-shGreen">${Number(bill.total || 0).toFixed(2)}</strong>
              {(bill.dog_names || []).length > 0 && <> · {bill.dog_names.join(" + ")}</>}.
              {" "}Take the payment on this bill (Pay Invoice at the Front Desk), or the family can pay it online.
            </p>
          ) : (
            <p className="text-[14px] text-gray-300" data-testid="checkout-ff-on-account">
              Nothing was paid now — the visit is on <strong className="text-white">{payerName}</strong>'s account.
              One bill for every dog is made when the last dog leaves.
            </p>
          )}
          {ffConfirmClose && !bill && (
            <p className="mt-3 rounded p-2.5 text-[13px] bg-shOrange/10 text-shOrange border border-shOrange/30" data-testid="checkout-ff-close-warning">
              Dogs still here or still to come won't be on this bill — each gets its own when it leaves. Make the bill now?
            </p>
          )}
          {ffErr && <p className="text-red-400 text-[14px] mt-3" data-testid="checkout-ff-error">{ffErr}</p>}
          <div className="flex flex-wrap gap-2 mt-4">
            {bill && (
              <button onClick={() => viewReceipt(bill.id)} data-testid="checkout-ff-view-bill"
                      className="text-shBlue font-black uppercase text-[12px] tracking-widest border border-shBlue/40 rounded px-3 py-2">
                <i className="fas fa-receipt mr-1"/>View bill
              </button>
            )}
            {!bill && anchorRow.group_id && (
              <button onClick={() => (ffConfirmClose ? closeBillNow() : setFfConfirmClose(true))} disabled={ffBusy}
                      data-testid="checkout-ff-close-bill"
                      className="text-shOrange font-black uppercase text-[12px] tracking-widest border border-shOrange/40 rounded px-3 py-2 disabled:opacity-50">
                <i className="fas fa-file-invoice-dollar mr-1"/>{ffConfirmClose ? "Yes, make the bill now" : "Close the bill now"}
              </button>
            )}
            <button onClick={onClose} data-testid="checkout-ff-done"
                    className="ml-auto bg-shGreen text-bgHeader px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest">
              Done
            </button>
          </div>
        </div>
        {receiptModal}
      </div>
    );
  }

  // Payment already committed by the time this renders — this is a purely
  // physical status screen. Hardware failure here never implies the
  // payment failed; retry buttons only ever retry the hardware action.
  if (hwBusy || hwResult) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="checkout-hw-status">
        <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-shGreen/20 text-shGreen w-11 h-11 rounded-full flex items-center justify-center text-xl">
              <i className="fas fa-check"/>
            </div>
            <div>
              <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Payment recorded successfully</h4>
              <p className="text-[13px] text-gray-400">Checking front-desk hardware…</p>
            </div>
          </div>
          {hwBusy ? (
            <p className="text-[14px] text-gray-400" data-testid="hw-status-busy">Talking to the front-desk printer…</p>
          ) : (
            <div className="space-y-2">
              {hwResult.drawerToken && (
                <div className={`rounded p-2.5 text-[13px] font-black ${hwResult.drawer?.ok ? "bg-shGreen/10 text-shGreen border border-shGreen/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`} data-testid="hw-drawer-status">
                  <i className={`fas ${hwResult.drawer?.ok ? "fa-check" : "fa-triangle-exclamation"} mr-1.5`}/>
                  {hwResult.drawer?.ok ? "Cash drawer opened." : `Cash drawer failed to open: ${hwResult.drawer?.error || "unknown error"}`}
                </div>
              )}
              {hwResult.printToken && (
                <div className={`rounded p-2.5 text-[13px] font-black ${hwResult.print?.ok ? "bg-shGreen/10 text-shGreen border border-shGreen/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`} data-testid="hw-print-status">
                  <i className={`fas ${hwResult.print?.ok ? "fa-check" : "fa-triangle-exclamation"} mr-1.5`}/>
                  {hwResult.print?.ok ? "Receipt printed." : `Receipt printing failed: ${hwResult.print?.error || "unknown error"}`}
                </div>
              )}
              {hwResult.extraFailed > 0 && (
                <div className="rounded p-2.5 text-[13px] font-black bg-red-500/10 text-red-400 border border-red-500/30" data-testid="hw-extra-print-status">
                  <i className="fas fa-triangle-exclamation mr-1.5"/>{hwResult.extraFailed} other receipt{hwResult.extraFailed === 1 ? "" : "s"} failed to print — reprint from the buttons below or Recent Sales.
                </div>
              )}
              {hwWaiting && (
                <div className="rounded p-2.5 text-[13px] font-black bg-shBlue/10 text-shBlue border border-shBlue/30" data-testid="checkout-receipt-waiting">
                  <i className="fas fa-clock mr-1.5"/>Another dog on this bill was reopened. The receipt is ready once that dog is checked out again.
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            {!hwBusy && hwResult?.drawerToken && !hwResult.drawer?.ok && hwInvoiceId && (
              <button onClick={() => retryHardware("open_drawer")} data-testid="hw-retry-drawer"
                      className="text-shOrange font-black uppercase text-[12px] tracking-widest border border-shOrange/40 rounded px-3 py-2">
                <i className="fas fa-rotate mr-1"/>Retry Open Drawer
              </button>
            )}
            {!hwBusy && hwInvoiceId && !hwWaiting && (
              <button onClick={() => retryHardware("print_receipt")} data-testid="hw-reprint"
                      className="text-shBlue font-black uppercase text-[12px] tracking-widest border border-shBlue/40 rounded px-3 py-2">
                <i className="fas fa-print mr-1"/>
                {hwResult?.printToken ? (hwResult.print?.ok ? "Reprint Receipt" : "Retry Print") : "Print Receipt"}
              </button>
            )}
            {!hwBusy && hwInvoiceId && !hwWaiting && (
              <button onClick={() => viewReceipt()} data-testid="checkout-view-receipt"
                      className="text-shBlue font-black uppercase text-[12px] tracking-widest border border-shBlue/40 rounded px-3 py-2">
                <i className="fas fa-receipt mr-1"/>View Receipt
              </button>
            )}
            {!hwBusy && hwInvoiceId && !hwWaiting && (
              <button onClick={() => emailReceipt()} disabled={emailBusy} data-testid="checkout-email-receipt"
                      className="text-shBlue font-black uppercase text-[12px] tracking-widest border border-shBlue/40 rounded px-3 py-2 disabled:opacity-50">
                <i className="fas fa-envelope mr-1"/>{emailBusy ? "Sending…" : "Email Receipt"}
              </button>
            )}
            {!hwBusy && hwExtraIds.map((id, i) => (
              <div key={id} className="w-full flex flex-wrap items-center gap-2" data-testid={`checkout-extra-bill-${i}`}>
                <span className="text-[12px] text-gray-400 font-black uppercase tracking-widest">Other bill #{id.slice(0, 8).toUpperCase()}</span>
                <button onClick={() => printExtra(id)} data-testid={`checkout-extra-print-${i}`}
                        className="text-shBlue font-black uppercase text-[12px] tracking-widest border border-shBlue/40 rounded px-3 py-2">
                  <i className="fas fa-print mr-1"/>Print
                </button>
                <button onClick={() => viewReceipt(id)} data-testid={`checkout-extra-view-${i}`}
                        className="text-shBlue font-black uppercase text-[12px] tracking-widest border border-shBlue/40 rounded px-3 py-2">
                  <i className="fas fa-receipt mr-1"/>View
                </button>
                <button onClick={() => emailReceipt(id)} disabled={emailBusy} data-testid={`checkout-extra-email-${i}`}
                        className="text-shBlue font-black uppercase text-[12px] tracking-widest border border-shBlue/40 rounded px-3 py-2 disabled:opacity-50">
                  <i className="fas fa-envelope mr-1"/>Email
                </button>
              </div>
            ))}
            <button onClick={onClose} disabled={hwBusy} data-testid="hw-done"
                    className="ml-auto bg-shGreen text-bgHeader px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-50">
              Done
            </button>
          </div>
        </div>
        {receiptModal}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="checkout-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-sign-out-alt text-shBlue mr-2"/>{isGroupCheckout ? `${isFF ? "Friends & Family" : "Household"} Check Out · ${groupDogNames.length} Dogs` : `Check Out · ${booking.dog_name}`}
          </h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
        </div>
        <p className="text-[14px] text-gray-400 mb-4">
          {booking.client_name} · {booking.service_type}
          {isFF && (
            <span className="ml-2 inline-block rounded-full border border-shBlue/40 bg-shBlue/10 px-2 py-0.5 text-[12px] font-black text-shBlue"
                  data-testid="checkout-ff-billed-to">
              {isFriendsDog(anchorRow) ? `Billed to ${payerName}` : "Pays for the group"}
            </span>
          )}
        </p>
        {lateDay?.resolved && (
          <div className="mb-4 rounded-lg border border-shOrange/40 bg-shOrange/10 p-3 text-[13px] text-shText" data-testid="checkout-late-day-banner">
            <i className="fas fa-moon text-shOrange mr-1.5"/>
            {lateDay.resolved === "stayed_overnight"
              ? `Stayed the night — charged as boarding from ${fmtBtDay(lateDay.record?.booking_date)} to ${fmtBtDay(lateDay.record?.business_day)}`
                + ` (${Number(lateDay.record?.nights || 1)} night${Number(lateDay.record?.nights || 1) === 1 ? "" : "s"}), picked up now.`
              : "Forgotten checkout — charged as the normal daycare day, no overnight late fee."}
            {lateDay.can_undo && onLateDayUndo && !busy && (
              <button type="button" onClick={onLateDayUndo} data-testid="checkout-late-day-change"
                      className="ml-2 underline font-black text-shOrange">Change answer</button>
            )}
          </div>
        )}
        {isFF && groupBookings.length > 1 && (
          <div className="mb-4 rounded-lg border border-shBlue/40 bg-shBlue/10 p-3" data-testid="checkout-ff-summary">
            <p className="text-[12px] uppercase tracking-widest text-shBlue font-black mb-1"><i className="fas fa-user-group mr-1"/>Friends &amp; family · one bill to {payerName}</p>
            <p className="text-sm text-white font-black">{groupBookings.map(b => `${b.dog_name}${b.client_name ? ` (${b.client_name})` : ""}`).join(" + ")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setLeaveAlone(false)} data-testid="checkout-ff-all"
                      className={`rounded border p-2 text-[13px] font-black ${!leaveAlone ? "border-shGreen bg-shGreen/10 text-white" : "border-bgHover text-gray-400"}`}>
                All {groupBookings.length} leaving now
              </button>
              <button type="button" onClick={() => setLeaveAlone(true)} data-testid="checkout-ff-only-this"
                      className={`rounded border p-2 text-[13px] font-black ${leaveAlone ? "border-shGreen bg-shGreen/10 text-white" : "border-bgHover text-gray-400"}`}>
                Only {booking.dog_name} is leaving
              </button>
            </div>
          </div>
        )}
        {isGroupCheckout && !isFF && (
          <div className="mb-4 rounded-lg border border-shBlue/40 bg-shBlue/10 p-3" data-testid="group-checkout-summary">
            <p className="text-[12px] uppercase tracking-widest text-shBlue font-black mb-1"><i className="fas fa-dog mr-1"/>One checkout for the household</p>
            <p className="text-sm text-white font-black">{groupDogNames.join(" + ")}</p>
            <p className="text-[13px] text-gray-400 mt-1">All {groupDogNames.length} dogs will be checked out together. The additional-dog discount is already included in the combined total below.</p>
          </div>
        )}

        {isFF && (
          <div className="mb-5 rounded-lg border border-shBlue/40 bg-bgBase p-4" data-testid="checkout-ff-billing">
            <p className="text-[13px] uppercase tracking-widest text-shBlue font-black mb-1">Nothing is paid at this pickup</p>
            <p className="text-[14px] text-gray-300">
              The visit goes on <strong className="text-white">{payerName}</strong>'s account.
              One bill for every dog is made when the last dog leaves.
            </p>
          </div>
        )}
        {prepaidSession && (
          <div className="mb-5 border border-shGreen/40 rounded-lg p-4 bg-shGreen/10" data-testid="checkout-prepaid-session">
            <p className="text-sm font-black text-white">Prepaid program session</p>
            <p className="text-[14px] text-gray-300 mt-1" data-testid="checkout-prepaid-note">
              {clientBal && Number(clientBal.training_credits || 0) < 1
                ? "Paid for when the program was sold. No program credit is left, so this is recorded at $0 — nothing is charged."
                : `Paid for when the program was sold — checking out uses one program credit${clientBal ? ` (${fmtCredits(clientBal.training_credits)} left)` : ""}. Nothing is charged.`}
            </p>
          </div>
        )}
        {/* Section 1 — How to pay the base service */}
        {!ffNoCredits && !prepaidSession && (<div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Base service</p>
          {daycarePerNight > 0 && !hadCredit && (
            <div className="mb-3" data-testid="checkout-credit-pool">
              <p className="text-[12px] text-gray-400 mb-1.5">Pay the night{Number(lateDay?.record?.nights || 1) === 1 ? "" : "s"} with:</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "boarding", label: "Boarding credits", bal: clientBal?.boarding_credits, rate: 1 },
                  { key: "daycare", label: "Daycare credits", bal: clientBal?.credits, rate: daycarePerNight },
                ].map((o) => (
                  <button key={o.key} type="button" data-testid={`checkout-credit-pool-${o.key}`}
                          onClick={() => { setCreditPoolChoice(o.key); if (Number(o.bal || 0) > 0) setUseCredits(true); }}
                          className={`text-left rounded-lg border p-2.5 transition ${creditPoolChoice === o.key ? "border-shGreen bg-shGreen/10" : "border-bgHover hover:border-shGreen/50"}`}>
                    <span className="block text-sm font-black text-white">{o.label}</span>
                    <span className="block text-[12px] text-gray-400">{fmtCredits(o.bal || 0)} available · {fmtCredits(o.rate)} per night</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {hadCredit ? (
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${useCredits ? "border-shGreen bg-shGreen/10" : "border-bgHover hover:border-shGreen/50"}`} data-testid="opt-use-credits">
                <input type="radio" checked={useCredits} onChange={()=>setUseCredits(true)} className="mt-1 accent-shGreen" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Use {fmtCredits(creditsDeducted || 1)} {creditPool} credit{Number(creditsDeducted || 1) === 1 ? "" : "s"}</p>
                  <p className="text-[14px] text-gray-400">${creditAmt.toFixed(2)} value · already deducted from their pack at approval</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${!useCredits ? "border-shBlue bg-shBlue/10" : "border-bgHover hover:border-shBlue/50"}`} data-testid="opt-charge">
                <input type="radio" checked={!useCredits} onChange={()=>setUseCredits(false)} className="mt-1 accent-shBlue" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Charge as regular service</p>
                  <p className="text-[14px] text-gray-400">Refund {fmtCredits(creditsDeducted || 1)} credit{Number(creditsDeducted || 1) === 1 ? "" : "s"} back to their pack & take payment today</p>
                </div>
              </label>
            </div>
          ) : canPayWithCredits ? (
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${useCredits ? "border-shGreen bg-shGreen/10" : "border-bgHover hover:border-shGreen/50"}`} data-testid="opt-credit-at-checkout">
                <input type="radio" checked={useCredits} onChange={()=>setUseCredits(true)} className="mt-1 accent-shGreen" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">{available >= creditUnitsNeeded ? "Deduct" : "Use partial"} {fmtCredits(creditsToUseNow)} {payFromDaycare ? "daycare" : booking.service_type} credit{creditsToUseNow === 1 ? "" : "s"} now</p>
                  <p className="text-[14px] text-gray-400">Client has <span className="text-shGreen font-black">{fmtCredits(available)}</span> available{available < creditUnitsNeeded ? ` · ${fmtCredits(creditUnitsNeeded - available)} credit shortfall will be charged` : ""} · FIFO from oldest pack</p>
                  {useCredits && nextLot && (
                    <div
                      data-testid={`checkout-next-lot-${nextLotKind}`}
                      className={`mt-2 flex items-start gap-2 text-[12px] rounded px-2.5 py-2 border ${
                        nextLotKind === "legacy"
                          ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
                          : nextLotKind === "program"
                          ? "border-purple-500/50 bg-purple-500/10 text-purple-200"
                          : "border-shBlue/50 bg-shBlue/10 text-shBlue"
                      }`}>
                      <span className="text-[14px]">
                        {nextLotKind === "legacy" ? "🏷️" : nextLotKind === "program" ? "🎓" : "✓"}
                      </span>
                      <span className="flex-1 leading-snug">
                        <strong className="font-black uppercase tracking-widest">
                          {nextLotKind === "legacy" ? "Legacy pack — needs $ at checkout"
                            : nextLotKind === "program" ? "Training program — already paid"
                            : "Paid at sale — already counted"}
                        </strong>
                        <span className="block text-[11px] text-gray-300 mt-0.5">
                          Next up: <strong>{nextLot.pack_name}</strong> · {fmtCredits(nextLot.qty_remaining)} of {fmtCredits(nextLot.qty_total)} left
                          {Number(nextLot.value_each || 0) > 0 && ` · $${Number(nextLot.value_each).toFixed(2)}/credit`}
                        </span>
                        {nextLotKind === "legacy" && (
                          <span className="block text-[11px] text-amber-300/90 mt-1">
                            Will add to today's income at $<strong>{Number(nextLot.value_each || 0).toFixed(2)}</strong> per credit ({fmtCredits(creditsToUseNow)} credit{creditsToUseNow===1?"":"s"} = ${(Number(nextLot.value_each || 0) * creditsToUseNow).toFixed(2)} on the books).
                          </span>
                        )}
                        {nextLotKind === "paid_at_sale" && (
                          <span className="block text-[11px] text-shBlue/90 mt-1">
                            Revenue was already counted when this pack was sold. $0 to today's drawer.
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${!useCredits ? "border-shBlue bg-shBlue/10" : "border-bgHover hover:border-shBlue/50"}`} data-testid="opt-no-credit-at-checkout">
                <input type="radio" checked={!useCredits} onChange={()=>setUseCredits(false)} className="mt-1 accent-shBlue" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Charge as regular service</p>
                  <p className="text-[14px] text-gray-400">Collect payment today. Credits stay untouched.</p>
                </div>
              </label>
            </div>
          ) : (
            <p className="text-[15px] text-gray-300">
              No credits on file for this booking — collecting payment today.
              {clientBal && available > 0 && available < creditUnitsNeeded && (
                <span className="block mt-1 text-[14px] text-shOrange">
                  Client has {fmtCredits(available)} {booking.service_type} credit{available === 1 ? "" : "s"} but {fmtCredits(creditUnitsNeeded)} {creditUnitsNeeded === 1 ? "is" : "are"} needed.
                </span>
              )}
            </p>
          )}
        </div>)}

        {/* Section 1a½ — Boarding EARLY checkout (leaving before booked end).
            Cash path only: credit deductions stay booked-span (server-side). */}
        {earlyQuote && !(isGroupCheckout && isFF) && !useCredits && (
          <div className="mb-5 border border-shBlue/40 rounded-lg p-4 bg-bgBase" data-testid="checkout-early-panel">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] uppercase tracking-widest text-shBlue font-black"><i className="fas fa-person-walking-arrow-right mr-1.5"/>Checking Out Early</p>
              <span className="text-[12px] text-gray-500">Booked through {earlyQuote.original_end_date}</span>
              {isGroupCheckout && !chargeFullStay && <span className="block text-[12px] text-gray-500 w-full">Each dog leaving early in this household is charged its own early price.</span>}
            </div>
            {chargeFullStay ? (
              <p className="text-[14px] text-gray-300">
                Charging the <span className="font-black text-white">full booked stay</span>.
                <button type="button" data-testid="early-use-actual" onClick={()=>setChargeFullStay(false)}
                        className="block mt-2 min-h-[40px] px-3 rounded bg-shBlue/15 border border-shBlue/40 text-shBlue text-[12px] font-black uppercase tracking-widest">
                  Charge actual stay instead · ${Number(earlyQuote.base_price).toFixed(2)}
                </button>
              </p>
            ) : (
              <p className="text-[14px] text-gray-300">
                Charging the <span className="font-black text-white">actual stay through today</span> — {fmtCredits(earlyQuote.units)} boarding day{Number(earlyQuote.units) === 1 ? "" : "s"} · <span className="font-black text-shGreen">${Number(earlyQuote.base_price).toFixed(2)}</span>
                <button type="button" data-testid="early-use-full" onClick={()=>setChargeFullStay(true)}
                        className="block mt-2 min-h-[40px] px-3 rounded bg-bgPanel border border-bgHover text-gray-300 text-[12px] font-black uppercase tracking-widest">
                  Charge full booked stay instead
                </button>
              </p>
            )}
          </div>
        )}

        {/* Section 1b — Boarding stay extension (extra nights). Not for a
            daycare visit converted to boarding: it already runs to today. */}
        {isBoarding && lateDay?.resolved !== "stayed_overnight" && (
          <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase" data-testid="checkout-extra-nights-panel">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black"><i className="fas fa-moon text-shBlue mr-1.5"/>Stayed Extra Nights?</p>
              {booking.end_date && <span className="text-[12px] text-gray-500">{booking.extra_nights?.in_stay ? "Stay ends" : "Original end"}: {booking.end_date}</span>}
            </div>
            {/* A reopened checkout keeps the nights it added in the stay's
                dates, so they are billed above already (audit #14). */}
            {Number(booking.extra_nights?.in_stay && booking.extra_nights?.count) > 0 && (
              <p className="text-[13px] text-shAccent mb-3" data-testid="checkout-extra-nights-in-stay">
                The {booking.extra_nights.count} extra night{Number(booking.extra_nights.count) === 1 ? "" : "s"} added at the earlier checkout {Number(booking.extra_nights.count) === 1 ? "is" : "are"} already in this stay{booking.end_date ? ` (it now ends ${booking.end_date})` : ""}. Only add nights beyond that.
              </p>
            )}
            <div className="flex items-center gap-2 mb-3">
              <button type="button" onClick={()=>setExtraNights(Math.max(0, Number(extraNights)-1))} data-testid="extra-nights-minus"
                      className="bg-bgPanel w-9 h-9 rounded text-white font-black hover:bg-red-500/30">−</button>
              <input type="number" min="0" max="60" value={extraNights} onChange={(e)=>setExtraNights(Math.max(0, parseInt(e.target.value)||0))} data-testid="extra-nights-input"
                     className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm text-center font-black"/>
              <button type="button" onClick={()=>setExtraNights(Number(extraNights)+1)} data-testid="extra-nights-plus"
                      className="bg-bgPanel w-9 h-9 rounded text-white font-black hover:bg-shGreen/30">+</button>
              <span className="text-[14px] text-gray-400 ml-2">extra night{extraNights === 1 ? "" : "s"}</span>
            </div>
            {extraNights > 0 && (
              <div className="space-y-3 animate-slide-in">
                {!ffNoCredits && (
                  <label className="flex items-center gap-2 text-[15px] text-gray-300">
                    <input type="checkbox" checked={extraUseCredits} onChange={(e)=>setExtraUseCredits(e.target.checked)} data-testid="extra-nights-use-credits"/>
                    Use remaining boarding credits first (any leftover gets billed)
                  </label>
                )}
                {!extraNightsUseCredits && canPrice && (
                  <div>
                    <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Per-night rate <span className="text-gray-600">(blank = settings default)</span></label>
                    <input type="number" step="0.01" value={extraRate} onChange={(e)=>setExtraRate(e.target.value)} data-testid="extra-nights-rate"
                           placeholder={extraRateEffective > 0 ? `$${extraRateEffective.toFixed(2)}` : "$0.00"}
                           className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
                  </div>
                )}
                <div className="text-[14px] bg-bgPanel rounded p-2 text-gray-300">
                  <i className="fas fa-circle-info text-shBlue mr-1"/>
                  {extraNightsUseCredits
                    ? `Needs ${fmtCredits(extraCreditUnitsNeeded)} boarding credit unit${extraCreditUnitsNeeded===1?"":"s"}. ${fmtCredits(extraCreditsPreview)} will be used and ${fmtCredits(extraBilledUnits)} uncovered unit${extraBilledUnits===1?"":"s"} will be billed at $${extraRateEffective.toFixed(2)} = $${extraNightsCharge.toFixed(2)}.`
                    : `Charging ${fmtCredits(extraBilledUnits)} unit${extraBilledUnits===1?"":"s"} × $${extraRateEffective.toFixed(2)} = $${extraNightsCharge.toFixed(2)} for the extension${isAdditionalDogRow ? " (second-dog rate included)" : ""}.`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Section 2 — Add-ons */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Add-on services{isGroupCheckout ? ` for ${booking.dog_name}` : ""} <span className="text-gray-600">(bath, nail trim, etc.)</span></p>
          {/* Sprint 110an — pre-attached add-ons (added at booking or check-in)
              are already on the booking and will auto-bill at checkout. Show
              them so the admin doesn't accidentally re-add them as extras. */}
          {(booking.add_ons || []).length > 0 && (
            <div className="mb-3 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3" data-testid="checkout-pre-attached-addons">
              <p className="text-[11px] uppercase tracking-widest text-amber-400 font-black mb-2">
                <i className="fas fa-lock mr-1"/>Already on this booking
              </p>
              <ul className="space-y-1.5">
                {(booking.add_ons || []).map((ao, i) => (
                  <li key={i} className="flex items-center justify-between text-[13px]">
                    <span className="text-white"><i className={`fas ${ao.icon || "fa-plus"} text-amber-400 mr-1.5`}/>{ao.name} × {ao.qty || 1}</span>
                    <span className="text-shGreen font-black">+${(Number(ao.price || 0) * (ao.qty || 1)).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-400 italic mt-2">Auto-billed at checkout. No need to re-add below.</p>
            </div>
          )}
          {addOnCandidates.length === 0 ? (
            <p className="text-[14px] text-gray-500 italic">No add-on services configured. Add some in Settings → Services & Prices.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {addOnCandidates.map(svc => {
                const inCart = cart[svc.id]?.qty || 0;
                return (
                  <button key={svc.id} onClick={()=>addOne(svc)} data-testid={`addon-${svc.id}`}
                          className={`text-left flex items-center justify-between gap-2 p-2.5 rounded border transition ${inCart > 0 ? "border-purple-400 bg-purple-400/10" : "border-bgHover hover:border-purple-400/60"}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-black text-white truncate"><i className={`fas ${svc.icon || 'fa-tag'} mr-1.5 text-purple-400`}/>{svc.name}</p>
                      <p className="text-[13px] text-gray-400 font-bold" data-testid={`addon-price-${svc.id}`}>${addOnPriceFor(svc).toFixed(2)}
                        {Math.abs(addOnPriceFor(svc) - Number(svc.base_price || 0)) > 0.005 && (
                          <span className="ml-1.5 line-through text-gray-600">${Number(svc.base_price || 0).toFixed(2)}</span>
                        )}
                      </p>
                    </div>
                    {inCart > 0 && (
                      <div className="flex items-center gap-1 shrink-0" onClick={(e)=>e.stopPropagation()}>
                        <button onClick={()=>removeOne(svc)} data-testid={`addon-minus-${svc.id}`} className="bg-bgHover w-6 h-6 rounded text-white font-black hover:bg-red-500/40">−</button>
                        <span className="text-white font-black w-5 text-center text-sm">{inCart}</span>
                        <span className="text-purple-400 text-[13px] font-black">+</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2b — Merchandise. Folded away by default: most pickups
            sell nothing, and an open shelf of products would push the actual
            checkout down the screen every single time. */}
        {isFF && shopItems.length > 0 && (
          <p className="mb-5 text-[13px] text-gray-400" data-testid="checkout-ff-shop-note">
            <i className="fas fa-shopping-basket mr-1.5"/>Selling something? Ring it up at the Register for {payerName}.
          </p>
        )}
        {shopItems.length > 0 && !isFF && (
          <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase" data-testid="checkout-shop">
            <button type="button" onClick={() => setShopOpen((v) => !v)} data-testid="checkout-shop-toggle"
                    className="w-full flex items-center justify-between gap-2 text-left">
              <span className="text-[13px] uppercase tracking-widest text-gray-500 font-black">
                <i className="fas fa-shopping-basket mr-1.5"/>Buying anything?
              </span>
              <span className="text-[13px] font-black text-white/70">
                {shopLines.length > 0 ? `$${shopTotal.toFixed(2)}` : ""}
                <i className={`fas fa-chevron-${shopOpen || shopLines.length > 0 ? "up" : "down"} ml-2 text-gray-500`}/>
              </span>
            </button>

            {(shopOpen || shopLines.length > 0) && (
              <div className="mt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[240px] overflow-y-auto">
                  {shopItems.map((it) => {
                    const qty = shopCart[it.id] || 0;
                    return (
                      <div key={it.id} data-testid={`checkout-product-${it.id}`}
                           className={`flex items-center justify-between gap-2 p-2.5 rounded border transition ${
                             qty > 0 ? "border-shGreen bg-shGreen/10" : "border-bgHover"}`}>
                        <button type="button" onClick={() => setShopQty(it.id, qty + 1)}
                                data-testid={`checkout-product-add-${it.id}`}
                                className="min-w-0 flex-1 text-left">
                          <p className="text-[15px] font-black text-white truncate">{it.name}</p>
                          <p className="text-[13px] text-gray-400 font-bold">
                            ${Number(it.effective_price || 0).toFixed(2)}
                            {!it.taxable && <span className="text-gray-500"> · no tax</span>}
                            {it.track_inventory && <span className="text-gray-500"> · {it.stock_on_hand} left</span>}
                          </p>
                        </button>
                        {qty > 0 && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => setShopQty(it.id, qty - 1)}
                                    data-testid={`checkout-product-minus-${it.id}`}
                                    className="bg-bgHover w-7 h-7 rounded text-white font-black hover:bg-red-500/40">−</button>
                            <span className="text-white font-black w-5 text-center text-sm">{qty}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {shopLines.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-bgHover text-[13px] space-y-1" data-testid="checkout-shop-total">
                    <div className="flex justify-between text-gray-400">
                      <span>Merchandise</span><span>${shopSubtotal.toFixed(2)}</span>
                    </div>
                    {shopTax > 0 && (
                      <div className="flex justify-between text-gray-400" data-testid="checkout-shop-tax">
                        <span>{salesTaxCfg.label || "Sales Tax"} ({salesTaxRateRaw.toFixed(2)}%)</span>
                        <span>${shopTax.toFixed(2)}</span>
                      </div>
                    )}
                    {shopTaxable > 0 && salesTaxRateRaw === 0 && (
                      <p className="text-[12px] text-shOrange font-black" data-testid="checkout-shop-no-tax-notice">
                        No sales tax is being charged on merchandise — switch it on in Settings → Sales Tax.
                      </p>
                    )}
                    <p className="text-[12px] text-gray-500 italic">
                      Rung through the Register, so stock and sales tax are handled there.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section 3 — Payment method + Service value */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">{isFF ? "Price" : "Payment"}</p>
          {/* Audit #24: asked whenever anything is paid today — the stay, or
              merchandise when credits cover the stay (it used to stay hidden
              then, and the goods were recorded as cash whatever was paid). */}
          {goodsOnlyPayment && (
            <p className="text-[13px] text-gray-400 mb-2 normal-case" data-testid="checkout-pay-for-shop-note">
              <i className="fas fa-circle-info text-shGreen mr-1"/>Credits cover the visit. Choose how the shop items were paid for.
            </p>
          )}
          {payPickerShown && (
            <select value={payMethod} onChange={(e)=>setPayMethod(e.target.value)} data-testid="checkout-pay-method"
                    className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mb-3">
              <option value="cash">Cash</option><option value="card">Card</option><option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="check">Check</option><option value="other">Other</option><option value="gift_card">Gift Card</option>
            </select>
          )}
          {payMethod === "other" && payPickerShown && (
            <input value={otherNote} onChange={(e) => setOtherNote(e.target.value)} maxLength={500}
                   placeholder="Note (required, e.g. Zelle)" data-testid="checkout-other-note"
                   className="w-full min-h-[48px] mb-3 bg-bgPanel border border-bgHover rounded px-3 text-white text-sm"/>
          )}
          {payMethod === "gift_card" && payPickerShown && (
            <div className="mb-3" data-testid="checkout-gift-tender">
              <div className="flex gap-2">
                <input value={giftCode} onChange={(e) => setGiftCode(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupGiftCard(); } }}
                       placeholder="Gift card code" data-testid="checkout-gift-code"
                       className="flex-1 min-w-0 min-h-[48px] bg-bgPanel border border-bgHover rounded px-3 text-white text-sm"/>
                <button type="button" onClick={lookupGiftCard} disabled={giftBusy}
                        data-testid="checkout-gift-lookup"
                        className="min-h-[48px] px-4 rounded-xl border border-shGreen/50 text-shGreen text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
                  {giftBusy ? "…" : "Check"}
                </button>
              </div>
              {giftCard && (
                <p className={`text-[13px] mt-1.5 font-black ${
                     Number(giftCard.balance) >= dueToday ? "text-shGreen" : "text-shOrange"}`}
                   data-testid="checkout-gift-balance">
                  {giftCard.code_display} · ${Number(giftCard.balance).toFixed(2)} left
                  {Number(giftCard.balance) < dueToday
                    ? ` — not enough for $${dueToday.toFixed(2)}`
                    : ""}
                </p>
              )}
            </div>
          )}
          {prepaidSession ? null : !canPrice ? (
            <p className="text-[13px] text-gray-500 normal-case" data-testid="checkout-price-locked">
              <i className="fas fa-lock mr-1.5"/>Prices are set automatically. Only staff with the pricing permission can change a price at checkout.
            </p>
          ) : (<div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">
              {useCredits ? "Additional cash adjustment (optional)" : "Base price"}
              <span className="text-gray-600"> {useCredits ? "(blank = use calculated credit shortfall)" : "(blank = use service default)"}</span>
            </label>
            <input type="number" step="0.01" value={basePrice} onChange={(e)=>setBasePrice(e.target.value)} data-testid="checkout-base-price"
                   placeholder={useCredits ? "$0.00" : (basePreview ? `$${basePreview.toFixed(2)}` : "$0.00")}
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
            {/* Manual override in play — make it loud and ask why. The reason
                lands in the booking's manual_price_override audit stamp. */}
            {!useCredits && basePrice !== "" && autoBasePreview > 0 && Number(basePrice) !== autoBasePreview && (
              <div className="mt-2 bg-shOrange/10 border border-shOrange/40 rounded p-2.5" data-testid="checkout-price-override-notice">
                <p className="text-[12px] font-black uppercase tracking-widest text-shOrange">
                  <i className="fas fa-pen mr-1.5"/>Manual price change: ${autoBasePreview.toFixed(2)} → ${(Number(basePrice) || 0).toFixed(2)}
                </p>
                <input value={priceReason} onChange={(e)=>setPriceReason(e.target.value)}
                       data-testid="checkout-price-override-reason"
                       placeholder="Reason (e.g. loyalty discount, service issue) — saved to the audit trail"
                       maxLength={300}
                       className="w-full mt-2 bg-bgPanel border border-bgHover rounded p-2 text-white text-[13px]" />
              </div>
            )}
            {useCredits && (
              <p className="text-[13px] text-gray-500 mt-1.5 normal-case">
                <i className="fas fa-circle-info text-shGreen mr-1"/>
                {baseCreditShortfallCash > 0
                  ? <><strong className="text-shOrange">${baseCreditShortfallCash.toFixed(2)} remains after available credits</strong> and is included in Charged today. Leave this field blank unless you intentionally want to override that cash amount.</>
                  : <>Credits cover the base visit. Only add an amount here for an intentional overage, tip, or other adjustment.</>}
              </p>
            )}
          </div>)}
          {/* Sprint 110di-51 — Partial-payment / tab toggle. Prominent
              two-pill segmented control so the feature is DISCOVERABLE.
              "Full" is the default. Selecting "Partial / on tab" reveals
              an Amount Paid input prefilled with the full total. The
              client's existing tab is surfaced here too so the operator
              knows the running balance going into this checkout. */}
          {!useCredits && !isGroupCheckout && !isFF && (
            <div className="mt-4 pt-3 border-t border-bgHover" data-testid="checkout-pay-mode-section">
              {clientBal && Math.abs(clientBal.account_balance) > 0.005 && (
                <div className={`mb-3 rounded p-2.5 text-[13px] font-black ${clientBal.account_balance > 0 ? "bg-shOrange/15 text-shOrange border border-shOrange/30" : "bg-shGreen/10 text-shGreen border border-shGreen/30"}`}
                     data-testid="checkout-existing-tab">
                  <i className={`fas ${clientBal.account_balance > 0 ? "fa-file-invoice-dollar" : "fa-piggy-bank"} mr-1.5`}/>
                  Current tab:{" "}
                  <span className="text-white">
                    ${Math.abs(clientBal.account_balance).toFixed(2)}
                  </span>{" "}
                  <span className="opacity-80 uppercase tracking-widest text-[11px]">
                    {clientBal.account_balance > 0 ? "owed" : "prepaid credit"}
                  </span>
                </div>
              )}
              <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black block mb-2">
                <i className="fas fa-cash-register mr-1 text-shGreen"/>How much is the client paying today?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button"
                        onClick={()=>{ setPayMode("full"); setAmountPaid(""); }}
                        data-testid="checkout-pay-mode-full"
                        className={`p-3 rounded border-2 text-left transition ${payMode==="full" ? "border-shGreen bg-shGreen/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shGreen/50"}`}>
                  <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check-circle mr-1"/>Paid in full</div>
                  <div className="text-[12px] opacity-80 mt-0.5">Client paid the whole ticket today.</div>
                </button>
                <button type="button"
                        onClick={()=>{ setPayMode("partial"); if (!amountPaid) setAmountPaid(""); }}
                        data-testid="checkout-pay-mode-partial"
                        className={`p-3 rounded border-2 text-left transition ${payMode==="partial" ? "border-shOrange bg-shOrange/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shOrange/50"}`}>
                  <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-file-invoice-dollar mr-1"/>Partial / on tab</div>
                  <div className="text-[12px] opacity-80 mt-0.5">Pay some now, rest on a running tab.</div>
                </button>
              </div>
              {payMode === "partial" && (
                <div className="mt-3 bg-shOrange/5 border-2 border-shOrange/40 rounded-lg p-3"
                     data-testid="checkout-partial-pay-block">
                  {/* Sprint 110di-56 — Make the total VS amount-paid math
                      unmistakable. Previously the input's placeholder showed
                      the total, which users were typing back into the field
                      (treating it like a confirmation), resulting in
                      amount_paid = total → no tab created. */}
                  <div className="grid grid-cols-3 gap-3 items-end">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">Visit total</p>
                      <p className="text-2xl font-black text-white mt-1" data-testid="checkout-visit-total">
                        ${chargedToday.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-shOrange font-black block">
                        <i className="fas fa-cash-register mr-1"/>Paying today
                      </label>
                      <input type="number" step="0.01" min="0" value={amountPaid}
                             onChange={(e)=>setAmountPaid(e.target.value)}
                             data-testid="checkout-amount-paid"
                             autoFocus
                             placeholder="$0.00"
                             className="w-full mt-1 bg-bgPanel border-2 border-shOrange/60 rounded p-2 text-white text-lg font-black focus:border-shOrange focus:outline-none" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">Goes on tab</p>
                      <p className="text-2xl font-black mt-1" data-testid="checkout-tab-delta">
                        <span className={amountPaid === "" ? "text-gray-500" : (Number(amountPaid) < chargedToday ? "text-shOrange" : (Number(amountPaid) > chargedToday ? "text-shGreen" : "text-gray-400"))}>
                          {amountPaid === ""
                            ? `$${chargedToday.toFixed(2)}`
                            : Number(amountPaid) < chargedToday
                              ? `+$${(chargedToday - Number(amountPaid)).toFixed(2)}`
                              : Number(amountPaid) > chargedToday
                                ? `−$${(Number(amountPaid) - chargedToday).toFixed(2)}`
                                : "$0.00"}
                        </span>
                      </p>
                    </div>
                  </div>
                  {amountPaid !== "" && Number(amountPaid) >= 0 && (
                    <div className="mt-3 pt-3 border-t border-shOrange/30 text-[13px] font-black"
                         data-testid="checkout-partial-pay-summary">
                      {Number(amountPaid) < chargedToday ? (
                        <span className="text-shOrange">
                          <i className="fas fa-file-invoice-dollar mr-1.5"/>
                          ${(chargedToday - Number(amountPaid)).toFixed(2)} stays on the tab
                          {clientBal && (
                            <span className="text-gray-400 ml-2 normal-case text-[12px]">
                              · new balance ${(clientBal.account_balance + (chargedToday - Number(amountPaid))).toFixed(2)}
                            </span>
                          )}
                        </span>
                      ) : Number(amountPaid) > chargedToday ? (
                        <span className="text-shGreen">
                          <i className="fas fa-piggy-bank mr-1.5"/>
                          ${(Number(amountPaid) - chargedToday).toFixed(2)} becomes pre-paid credit on file
                        </span>
                      ) : (
                        <span className="text-shGreen">
                          <i className="fas fa-check mr-1.5"/>Exact change — paid in full
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {!useCredits && isGroupCheckout && !isFF && (
            <p className="mt-3 text-[13px] text-gray-400 border-t border-bgHover pt-3" data-testid="group-checkout-full-payment-note">
              <i className="fas fa-receipt text-shGreen mr-1"/>Combined household checkouts are paid in full as one ticket. Use separate checkouts only when putting part of the balance on the client's tab.
            </p>
          )}
        </div>

        {/* One-time checkout discount — applies to dollars due only. */}
        {!isFF && canPrice && (<div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase" data-testid="checkout-discount-panel">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black">
                <i className="fas fa-tag text-shOrange mr-1.5"/>One-time discount
              </p>
              <p className="text-[12px] text-gray-500 mt-1">Reduces only the dollar amount due. Credits and credit lots stay exactly the same.</p>
            </div>
            <span className="text-[11px] uppercase tracking-widest text-gray-500 font-black whitespace-nowrap">
              Max ${preTaxBeforeCheckoutDiscount.toFixed(2)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Discount amount</label>
              <input type="number" min="0" step="0.01" value={checkoutDiscount}
                     onChange={(e)=>setCheckoutDiscount(e.target.value)}
                     data-testid="checkout-discount-amount"
                     placeholder="$0.00"
                     className={`w-full mt-1 bg-bgPanel border rounded p-2 text-white text-sm ${checkoutDiscountTooHigh ? "border-red-500" : "border-bgHover"}`}/>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Reason {checkoutDiscountRequested > 0 && <span className="text-shOrange">· required</span>}</label>
              <input type="text" maxLength={500} value={checkoutDiscountReason}
                     onChange={(e)=>setCheckoutDiscountReason(e.target.value)}
                     data-testid="checkout-discount-reason"
                     placeholder="Example: Courtesy discount for missed pickup update"
                     className={`w-full mt-1 bg-bgPanel border rounded p-2 text-white text-sm ${checkoutDiscountReasonMissing ? "border-red-500" : "border-bgHover"}`}/>
            </div>
          </div>
          {checkoutDiscountTooHigh && (
            <p className="text-[12px] text-red-400 mt-2" data-testid="checkout-discount-too-high">
              Discount exceeds the dollar amount due. Credits cannot be reduced or converted into a cash discount.
            </p>
          )}
          {checkoutDiscountApplied > 0 && !checkoutDiscountTooHigh && (
            <p className="text-[12px] text-shOrange mt-2 font-black" data-testid="checkout-discount-preview">
              <i className="fas fa-arrow-down mr-1"/>Total reduced by ${checkoutDiscountApplied.toFixed(2)} before tax.
            </p>
          )}
        </div>)}

        {/* Total summary */}
        <div className="mb-4 border-t-2 border-shGreen pt-3 flex items-end justify-between">
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Base · ${basePreview.toFixed(2)}</p>
            {booking.preferred_rate_applied && (
              <p className="text-[12px] uppercase tracking-widest text-amber-400 font-black" data-testid="checkout-preferred-rate">
                <i className="fas fa-lock mr-1"/>Preferred client rate applied
              </p>
            )}
            {booking.multi_dog_discount?.pre_applied && (
              <p className="text-[12px] uppercase tracking-widest text-shOrange font-black" data-testid="checkout-preapplied-dog-discount">
                <i className="fas fa-dog mr-1"/>Additional dog discount already included
              </p>
            )}
            {isGroupCheckout && !useCredits && <p className="text-[12px] uppercase tracking-widest text-shBlue font-black" data-testid="checkout-group-service-total">{groupDogNames.length} dogs · ${(basePreview + groupOtherBaseTotal).toFixed(2)} service total</p>}
            {existingAddonTotal > 0 && <p className="text-[12px] uppercase tracking-widest text-amber-400 font-black">Booked add-ons · ${existingAddonTotal.toFixed(2)}</p>}
            {addOnTotal > 0 && <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">New add-ons · ${addOnTotal.toFixed(2)}</p>}
            {useCredits && basePrice === "" && baseCreditShortfallCash > 0 && (
              <p className="text-[12px] uppercase tracking-widest text-shOrange font-black" data-testid="checkout-credit-shortfall-cash">
                Credit shortfall · ${baseCreditShortfallCash.toFixed(2)}
              </p>
            )}
            {extraNightsCharge > 0 && (
              <p className="text-[12px] uppercase tracking-widest text-shBlue font-black" data-testid="checkout-extra-night-charge">
                Extra stay · ${extraNightsCharge.toFixed(2)}
              </p>
            )}
            {Math.abs(moneyModifierTotal) > 0.001 && (
              <p className="text-[12px] uppercase tracking-widest text-purple-300 font-black" data-testid="checkout-money-modifiers">
                {modifierPreview?.seasonal_label || (modifierLateFee > 0 ? "Late pickup / pricing rule" : "Pricing rule")} · {moneyModifierTotal >= 0 ? "+" : "−"}${Math.abs(moneyModifierTotal).toFixed(2)}
              </p>
            )}
            {checkoutDiscountApplied > 0 && !checkoutDiscountTooHigh && (
              <p className="text-[12px] uppercase tracking-widest text-shOrange font-black" data-testid="checkout-manual-discount-line">
                <i className="fas fa-tag mr-1"/>One-time discount · −${checkoutDiscountApplied.toFixed(2)}
              </p>
            )}
            {salesTaxAmount > 0 && (
              <p className="text-[12px] uppercase tracking-widest text-shOrange font-black" data-testid="checkout-sales-tax">
                {salesTaxCfg.label || "Sales Tax"} ({salesTaxRate.toFixed(2)}%) · ${salesTaxAmount.toFixed(2)}
              </p>
            )}
            {multiDogDiscount > 0 && (
              <p className="text-[12px] uppercase tracking-widest text-shOrange font-black" data-testid="checkout-multi-dog-discount">
                <i className="fas fa-dog mr-1"/>
                {discountPreview?.discount?.label || "Multi-dog discount"} · −${multiDogDiscount.toFixed(2)}
                {discountPreview?.discount?.mode === "percent" && (
                  <span className="text-gray-500 normal-case ml-1">({discountPreview.discount.value}% off)</span>
                )}
              </p>
            )}
            {useCredits && extraCashOnCredits > 0 && (
              <p className="text-[12px] uppercase tracking-widest text-shGreen font-black" data-testid="checkout-extra-cash">
                + Extra cash · ${extraCashOnCredits.toFixed(2)}
              </p>
            )}
            {useCredits && hadCredit && <p className="text-[12px] uppercase tracking-widest text-shGreen font-black">−${creditAmt.toFixed(2)} via credits</p>}
          </div>
          <div className="text-right">
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">{isFF ? `On ${payerName}'s account` : (useCredits && hadCredit && addOnTotal === 0 && existingAddonTotal === 0 ? "Total" : "Charged today")}</p>
            {/* One number at the counter. The stay and the merchandise are
                two records underneath, but nobody hands over money twice. */}
            <p className="text-shGreen text-3xl font-black" data-testid="checkout-total">${dueToday.toFixed(2)}</p>
            {shopTotal > 0 && (
              <p className="text-[12px] text-gray-400 font-bold" data-testid="checkout-total-split">
                stay ${chargedToday.toFixed(2)} + shop ${shopTotal.toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {err && <p className="text-red-400 text-[15px] mb-3" data-testid="checkout-error">{err}</p>}
        {anchorGone && (
          <p className="text-shOrange text-[14px] mb-3" data-testid="checkout-anchor-gone">
            {booking.dog_name} has already been checked out. Close this and check out
            {groupBookings.length ? ` ${groupBookings.map(b => b.dog_name).join(" + ")}` : " the other dogs"} from their own row.
          </p>
        )}

        {btBlock && (
          /* The stay cannot just be waved through, but it must not be a dead
             end either — an owner collecting early leaves sessions that were
             never going to happen. So instead of a red sentence, the desk is
             asked what happened to each one. */
          <div className="mb-4 rounded-xl border border-shOrange/60 bg-shOrange/[0.07] p-3.5"
               data-testid="checkout-board-train-block">
            <p className="text-shOrange font-black uppercase tracking-widest text-[12px]">
              Training sessions with no record
            </p>
            <p className="text-white/80 text-[14px] mt-1.5">
              {btBlock.dog_name ? `${btBlock.dog_name}'s stay has ` : "This stay has "}
              {btSessions.length} session{btSessions.length === 1 ? "" : "s"} that were never written up.
              Say what happened to each one and the checkout can go ahead.
            </p>

            {/* The usual case is that the whole tail of the stay has the same
                answer — the owner came early. One control for that beats
                tapping fourteen identical ones. */}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[11px] font-black uppercase tracking-widest text-white/50 shrink-0">Set all</span>
              <select value="" data-testid="checkout-bt-all"
                      onChange={(e) => e.target.value && answerAll(e.target.value)}
                      className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-bgHover bg-bgHeader/60 px-2.5 text-[13px] font-black text-white/60 focus:outline-none focus:border-shOrange">
                <option value="">Same answer for all {btSessions.length}…</option>
                {btChoices.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="mt-3 space-y-2.5 max-h-[300px] overflow-y-auto" data-testid="checkout-bt-sessions">
              {Object.entries(btDays).map(([day, sessions]) => (
                <div key={day}>
                  <p className="text-[11.5px] font-black uppercase tracking-widest text-white/50">{fmtBtDay(day)}</p>
                  {sessions.map((s) => {
                    const key = `${s.date}|${s.slot}`;
                    return (
                      /* One line per session. Three buttons each would be a
                         wall of eighty-odd controls on a fortnight's stay,
                         and would not fit across a phone anyway. */
                      <div key={key} className="flex items-center gap-2 mt-1.5">
                        <span className="w-[34px] text-[13px] font-black text-white/85 shrink-0">{s.slot}</span>
                        <select value={btAnswers[key] || ""}
                                onChange={(e) => setBtAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                                data-testid={`checkout-bt-session-${s.date}-${s.slot}`}
                                className={`flex-1 min-w-0 min-h-[40px] rounded-lg border bg-bgHeader/60 px-2.5 text-[13px] font-black focus:outline-none focus:border-shOrange ${
                                  btAnswers[key] ? "border-shOrange/70 text-white" : "border-bgHover text-white/50"}`}>
                          <option value="">What happened?</option>
                          {btChoices.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {btUnanswered > 0 ? (
              <p className="text-white/55 text-[13px] mt-3" data-testid="checkout-bt-remaining">
                {btUnanswered} still to answer.
              </p>
            ) : (
              <p className="text-white/75 text-[13px] mt-3" data-testid="checkout-bt-summary">
                {btCounts.map((c) => `${c.n} ${c.label.toLowerCase()}`).join(" · ")}.
                {!isFF && canPrice
                  ? " Nothing is adjusted automatically — use the discount above if money should come off."
                  : " Nothing is adjusted automatically."}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          {onRequestCancel ? (
            <button onClick={() => onRequestCancel(booking)} disabled={busy} data-testid="checkout-cancel-booking"
                    className="text-red-400 font-black uppercase text-[14px] tracking-widest hover:text-red-300 disabled:opacity-50">
              <i className="fas fa-times-circle mr-1"/>Cancel booking instead
            </button>
          ) : <span/>}
          <div className="flex gap-3">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Close</button>
            <button onClick={submit} disabled={anchorGone || busy || groupLoading || checkoutDiscountTooHigh || checkoutDiscountReasonMissing || btUnanswered > 0} data-testid="confirm-checkout"
                    className="bg-shBlue text-white px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Checking out…" : (groupLoading ? "Loading household…" : (isFF ? (isGroupCheckout ? `Check Out All ${groupDogNames.length} · one bill` : `Check Out · on ${payerName}'s account`) : (isGroupCheckout ? `Check Out All ${groupDogNames.length} Dogs` : (shopTotal > 0 ? `Complete Check-out · $${dueToday.toFixed(2)}` : "Complete Check-out"))))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * Checking out a daycare dog that is still checked in from an earlier day.
 *
 * The visit could be a forgotten checkout or a dog that really stayed the
 * night — the app never decides that on its own. Before anything is priced,
 * this asks; the answer is saved on the booking (a stay becomes boarding,
 * with an Undo) and the checkout below reloads with the right prices.
 * Server side: domains/bookings/late_day.py, and checkout itself refuses a
 * late visit that hasn't been answered.
 */
export function CheckoutModal(props) {
  useEditLock(true);
  const { booking, onClose } = props;
  const [current, setCurrent] = useState(booking);
  const [rev, setRev] = useState(0);
  // Same-day and non-daycare checkouts never need the question, so they
  // skip the extra request and open exactly as before.
  // An already-answered visit also loads, so the answer shows with its Undo.
  const maybeLate = !booking?.checked_out_at && (!!booking?.late_day_resolution || (
    booking?.service_type === "daycare" && !!booking?.checked_in_at
    && String(booking?.end_date || booking?.date || "").slice(0, 10) < todayISO()));
  const [late, setLate] = useState(maybeLate ? undefined : {});
  const [answering, setAnswering] = useState("");
  const [lateErr, setLateErr] = useState("");

  // `refusal` is the checkout's own 409 question, used when the check can't
  // answer — so a refused checkout always lands on the question, never back
  // on a fresh form that would be refused again.
  const loadLate = useCallback(async (refusal) => {
    try {
      const { data } = await api.get(`/bookings/${booking.id}/late-day-checkout`);
      // Price whatever the server holds now — another screen may already
      // have answered, or the stay may have been re-priced to this pickup.
      if (data?.booking) { setCurrent(data.booking); setRev((r) => r + 1); }
      setLate(refusal && !data?.applies && !data?.resolved ? { ...refusal, applies: true } : (data || {}));
    } catch {
      // If the check itself fails, open the checkout anyway — the server
      // still refuses an unanswered late checkout and we come back here.
      setLate(refusal ? { ...refusal, applies: true } : {});
    }
  }, [booking.id]);
  useEffect(() => { if (maybeLate) loadLate(); }, [maybeLate, loadLate]);

  const answer = async (resolution) => {
    setAnswering(resolution); setLateErr("");
    try {
      const { data } = await api.post(`/bookings/${booking.id}/late-day-checkout`, { resolution });
      if (data?.booking) setCurrent(data.booking);
      setRev((r) => r + 1);
      await loadLate();
    } catch (e) {
      setLateErr(e.response?.data?.detail || "Couldn't save that answer. Please try again.");
    } finally { setAnswering(""); }
  };

  if (late === undefined) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="checkout-late-day-loading">
        <p className="text-gray-300 text-sm"><i className="fas fa-spinner fa-spin mr-2"/>Opening checkout…</p>
      </div>
    );
  }

  if (late.applies) {
    const stayed = late.stayed_overnight || {};
    const nights = Number(late.nights || 1);
    const pickupDayFee = (stayed.rows || []).reduce((sum, r) => sum + Number(r.late_pickup_cash || 0), 0);
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="checkout-late-day">
        <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">
              <i className="fas fa-moon text-shOrange mr-2"/>Checked out a day late
            </h4>
            <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close"><i className="fas fa-times"/></button>
          </div>
          <p className="text-[15px] text-gray-200 leading-snug" data-testid="checkout-late-day-message">{late.message}</p>
          <p className="text-[13px] text-gray-400">Nothing is charged until you choose. You can change your answer before checking out.</p>
          <div className="grid gap-3">
            <button type="button" onClick={() => answer("forgotten")} disabled={!!answering} data-testid="checkout-late-day-forgotten"
                    className="text-left rounded-xl border border-shBlue/50 bg-shBlue/10 hover:bg-shBlue/20 p-4 disabled:opacity-50">
              <p className="text-white font-black"><i className="fas fa-clock-rotate-left text-shBlue mr-2"/>Forgotten checkout</p>
              <p className="text-[13px] text-gray-300 mt-1">They went home that day — charge the normal daycare day, with no overnight late fee.</p>
            </button>
            <button type="button" onClick={() => answer("stayed_overnight")} disabled={!!answering || stayed.available === false}
                    data-testid="checkout-late-day-stayed"
                    className="text-left rounded-xl border border-shOrange/50 bg-shOrange/10 hover:bg-shOrange/20 p-4 disabled:opacity-50">
              <p className="text-white font-black"><i className="fas fa-bed text-shOrange mr-2"/>Stayed the night</p>
              <p className="text-[13px] text-gray-300 mt-1">
                {stayed.available === false
                  ? "Can't be charged as boarding right now."
                  : `Charge it as boarding: ${nights} night${nights === 1 ? "" : "s"}${stayed.total != null ? ` · $${Number(stayed.total).toFixed(2)}` : ""}.`}
                {stayed.available !== false && pickupDayFee > 0 && (
                  <span className="block text-[12px] text-gray-400 mt-0.5" data-testid="checkout-late-day-pickup-fee">
                    Includes ${pickupDayFee.toFixed(2)} for picking up after the boarding checkout time (your late-pickup rule).
                  </span>
                )}
              </p>
            </button>
            {stayed.available === false && stayed.reason && (
              <p className="text-[13px] text-shOrange" data-testid="checkout-late-day-stayed-unavailable">{stayed.reason}</p>
            )}
          </div>
          {lateErr && <p className="text-[14px] text-red-300" data-testid="checkout-late-day-error">{lateErr}</p>}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-[13px] font-black uppercase tracking-widest">Not now</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CheckoutModalBody
      key={`${current.id}:${rev}`}
      {...props}
      booking={current}
      lateDay={late.resolved ? late : null}
      onLateDayQuestion={(refusal) => { setLate(undefined); loadLate(refusal); }}
      onLateDayUndo={() => { if (!answering) answer("undo"); }}
    />
  );
}


// The business doesn't charge for cancellations (owner, 2026-09-26), so the
// "Cancel · charge" option isn't offered. The server still supports it
// (DELETE /bookings/{id}?forfeit=true, fee tiers in Settings → Day-to-Day);
// set this to true to offer it again.
const OFFER_CANCELLATION_CHARGE = false;

export function CancelBookingModal({ booking, onClose }) {
  useEditLock(true);
  // The server's rule (DELETE /bookings/{id}): cancelling needs booking_edit,
  // and adding the cancellation charge also needs take_payments.
  const auth = useAuth();
  const canCharge = OFFER_CANCELLATION_CHARGE && !!(auth?.can?.("booking_edit") && auth?.can?.("take_payments"));
  const credits = Number(booking.credits_deducted || 0);
  const pool = booking.credit_service_type || booking.service_type;
  const cashPrice = Number(booking.actual_price || 0);
  // Best-guess "what would we charge them" for the no-show fee. The backend
  // makes the authoritative snapshot — this is just for the button label.
  const previewFee = cashPrice || Number(booking.credit_value || 0) || 0;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // A dog that is checked in leaves by checkout. Cancelling it is only for a
  // check-in made by mistake, and takes that check-in back (recorded).
  const [onSite, setOnSite] = useState(!!booking.checked_in_at && !booking.checked_out_at);
  const [mistake, setMistake] = useState(false);
  const blocked = onSite && !mistake;

  const submit = async (forfeit) => {
    setBusy(true); setErr("");
    try {
      const params = { forfeit: forfeit ? "true" : "false" };
      if (onSite) params.undo_check_in = "true";
      await api.delete(`/bookings/${booking.id}`, { params });
      onClose();
    } catch (e) {
      // Checked in on another screen since this opened: offer the take-back.
      if (e.response?.data?.block?.action === "undo_check_in") { setOnSite(true); setMistake(false); }
      setErr(e.response?.data?.detail || "Cancel failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60]" data-testid="cancel-modal">
      <div className="bg-bgPanel border border-red-500/40 rounded-2xl w-full max-w-md p-7 shadow-2xl animate-slide-in">
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-red-500/20 text-red-400 w-12 h-12 rounded-full flex items-center justify-center text-xl">
            <i className="fas fa-times"/>
          </div>
          <div>
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">Cancel booking?</h4>
            <p className="text-[14px] text-gray-400">{booking.dog_name} · {booking.client_name}</p>
          </div>
        </div>

        <p className="text-[14px] text-gray-300 leading-relaxed mb-4">
          {canCharge
            ? <>Removes this booking from the roster. Pick <strong>refund</strong> for honest cancels, or <strong>charge</strong> for late-cancels / no-shows where the policy is "we keep the money".</>
            : <>Removes this booking from the roster. Nothing is charged.</>}
        </p>

        {onSite && (
          <div className="bg-shOrange/10 border border-shOrange/40 rounded p-3 mb-3 text-[14px] text-gray-200" data-testid="cancel-on-site">
            <p><i className="fas fa-paw text-shOrange mr-1.5"/><strong>{booking.dog_name || "This dog"} is checked in.</strong> Going home? Close this and use <strong>Check out</strong> instead (check out at $0 if nothing is owed).</p>
            <label className="flex items-start gap-2 mt-2 cursor-pointer">
              <input type="checkbox" checked={mistake} onChange={(e)=>setMistake(e.target.checked)} className="mt-1" data-testid="cancel-undo-check-in"/>
              <span>The check-in was a mistake — take it back and cancel.</span>
            </label>
          </div>
        )}
        {credits > 0 && (
          <div className="bg-bgBase border border-bgHover rounded p-3 mb-2 text-[14px] text-gray-300 flex items-center gap-2">
            <i className="fas fa-coins text-shGreen"/>
            <span><strong className="text-shGreen">{credits} {pool} credit{credits === 1 ? "" : "s"}</strong> were deducted for this booking.</span>
          </div>
        )}
        {cashPrice > 0 && (
          <div className="bg-bgBase border border-bgHover rounded p-3 mb-2 text-[14px] text-gray-300 flex items-center gap-2">
            <i className="fas fa-dollar-sign text-shGreen"/>
            <span><strong className="text-shGreen">${cashPrice.toFixed(2)}</strong> has been charged on this booking.</span>
          </div>
        )}
        {booking.is_prepaid_program_session && credits === 0 && (
          <div className="bg-bgBase border border-bgHover rounded p-3 mb-2 text-[14px] text-gray-300" data-testid="cancel-prepaid-session">
            <i className="fas fa-graduation-cap text-shGreen mr-1.5"/>Part of a prepaid program. Cancelling frees this session — the program credit stays with the family for a make-up lesson.
          </div>
        )}
        {!booking.is_prepaid_program_session && credits === 0 && cashPrice === 0 && (
          <div className="bg-bgBase border border-bgHover rounded p-3 mb-2 text-[14px] text-gray-400">
            <i className="fas fa-info-circle mr-1.5"/>No money or credits attached yet{canCharge ? " — a charge will pull from the service's catalog price." : "."}
          </div>
        )}

        {err && <p className="text-red-400 text-[15px] mt-2 mb-1" data-testid="cancel-error">{err}</p>}

        <div className="grid grid-cols-1 gap-2 mt-4">
          <button onClick={()=>submit(false)} disabled={busy || blocked} data-testid="cancel-refund"
                  className="bg-shGreen text-bgHeader px-4 py-3 rounded font-black uppercase text-[14px] tracking-widest shadow hover:bg-shGreen/90 disabled:opacity-50 flex items-center justify-between">
            <span><i className="fas fa-rotate-left mr-2"/>{booking.is_prepaid_program_session && credits === 0 ? "Cancel session" : `Cancel · refund ${credits > 0 ? `${credits} credit${credits === 1 ? "" : "s"}` : "in full"}`}</span>
            <i className="fas fa-chevron-right text-[14px] opacity-70"/>
          </button>
          {canCharge && (
          <button onClick={()=>submit(true)} disabled={busy || blocked} data-testid="cancel-charge"
                  className="bg-red-500 text-white px-4 py-3 rounded font-black uppercase text-[14px] tracking-widest shadow hover:bg-red-600 disabled:opacity-50 flex items-center justify-between">
            <span>
              <i className="fas fa-ban mr-2"/>Cancel · charge {previewFee > 0 ? `$${previewFee.toFixed(2)}` : (credits > 0 ? `${credits} credit${credits === 1 ? "" : "s"}` : "no-show fee")}
            </span>
            <i className="fas fa-chevron-right text-[14px] opacity-70"/>
          </button>
          )}
          <button onClick={onClose} disabled={busy} data-testid="cancel-keep"
                  className="text-gray-400 hover:text-white font-black uppercase text-[14px] tracking-widest mt-1 py-2 disabled:opacity-50">
            Keep it
          </button>
        </div>
      </div>
    </div>
  );
}
