import { useEffect, useState } from "react";
import { api } from "../lib/api";

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
export function CheckoutModal({ booking, services, onClose, onRequestCancel }) {
  // Pre-deducted credit info — if non-zero, the owner already has a pending charge
  // on their pack that we'll either consume (default) or refund.
  const hadCredit = !!booking.credit_value && !booking.actual_price;
  const creditAmt = Number(booking.credit_value || 0);
  const creditPool = booking.credit_service_type || booking.service_type || "daycare";
  const creditsDeducted = booking.credits_deducted || 0;

  // For boarding: how many nights this booking covers (1 if no end_date).
  const nightsNeeded = (() => {
    if (booking.service_type !== "boarding") return 1;
    try {
      const s = new Date(booking.date), e = new Date(booking.end_date || booking.date);
      const n = Math.round((e - s) / (1000 * 60 * 60 * 24)) || 1;
      return Math.max(1, n);
    } catch { return 1; }
  })();
  // Fetch client balance so we can offer "pay with credits" at checkout when
  // the booking was made without any pre-deduction (e.g. client had no credits
  // at booking time, then bought a pack later).
  const [clientBal, setClientBal] = useState(null); // { credits, training_credits, boarding_credits }
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/clients/${booking.client_id}`);
        if (alive) setClientBal({
          credits: data.credits || 0,
          training_credits: data.training_credits || 0,
          boarding_credits: data.boarding_credits || 0,
        });
      } catch (e) { console.warn("client balance fetch failed", e); }
    })();
    return () => { alive = false; };
  }, [booking.client_id]);

  const balField = booking.service_type === "training" ? "training_credits"
                  : booking.service_type === "boarding" ? "boarding_credits"
                  : "credits";
  const available = clientBal ? (clientBal[balField] || 0) : 0;
  const canPayWithCredits = !hadCredit && !booking.actual_price && available >= nightsNeeded;

  const [useCredits, setUseCredits] = useState(hadCredit);
  const [defaultedFromBal, setDefaultedFromBal] = useState(false);
  useEffect(() => {
    if (clientBal && !defaultedFromBal && !hadCredit && available >= nightsNeeded && nightsNeeded > 0 && !booking.actual_price) {
      setUseCredits(true);
      setDefaultedFromBal(true);
    }
  }, [clientBal, available, nightsNeeded, hadCredit, defaultedFromBal, booking.actual_price]);
  const [payMethod, setPayMethod] = useState("cash");
  const [basePrice, setBasePrice] = useState("");
  const [extraNights, setExtraNights] = useState(0);
  const [extraUseCredits, setExtraUseCredits] = useState(true);
  const [extraRate, setExtraRate] = useState("");
  const boardingRate = (services || []).find(s => s.service_type === "boarding" && s.is_default && s.active)?.base_price || 0;
  const extraRateEffective = extraRate !== "" ? Number(extraRate) || 0 : Number(boardingRate || 0);
  const isBoarding = booking.service_type === "boarding";
  // Sprint 110an — only show services that are flagged as add-ons AND
  // eligible for this booking's service type. Falls back to the legacy
  // "any non-base service" rule for any service that hasn't been flagged
  // yet (so existing setups keep working). The flagged-only list wins
  // when there are any eligible add-ons configured.
  const flaggedAddons = (services || []).filter(
    s => s.active && s.is_addon && (s.addon_for || []).includes(booking.service_type)
  );
  const legacyCandidates = (services || []).filter(
    s => s.active && !s.is_addon && s.service_type !== booking.service_type
  );
  const addOnCandidates = flaggedAddons.length > 0 ? flaggedAddons : legacyCandidates;
  const [cart, setCart] = useState({});

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
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

  const addOne = (svc) => setCart(c => ({ ...c, [svc.id]: { service: svc, qty: (c[svc.id]?.qty || 0) + 1 } }));
  const removeOne = (svc) => setCart(c => {
    const next = { ...c };
    const cur = next[svc.id];
    if (!cur) return c;
    if (cur.qty <= 1) delete next[svc.id]; else next[svc.id] = { ...cur, qty: cur.qty - 1 };
    return next;
  });

  const cartItems = Object.values(cart);
  const addOnTotal = cartItems.reduce((s, it) => s + (Number(it.service.base_price || 0) * it.qty), 0);

  let basePreview = 0;
  if (basePrice !== "") {
    basePreview = Number(basePrice) || 0;
  } else if (useCredits && hadCredit && creditAmt > 0) {
    basePreview = creditAmt;
  } else {
    const defaultSvc = (services || []).find(s => s.is_default && s.service_type === booking.service_type && s.active);
    basePreview = defaultSvc ? Number(defaultSvc.base_price || 0) : Number(booking.actual_price || 0);
  }
  const extraNightsCharge = isBoarding && extraNights > 0 && !extraUseCredits
    ? Math.round(extraNights * extraRateEffective * 100) / 100
    : 0;
  // Multi-dog discount preview: recompute against the CURRENT basePreview (so
  // if the operator overrides the base price, the discount updates live).
  let multiDogDiscount = 0;
  if (discountPreview?.eligible && discountPreview.discount && basePreview > 0 && !useCredits) {
    const d = discountPreview.discount;
    if (d.mode === "percent") {
      multiDogDiscount = Math.round(basePreview * (Math.max(0, Math.min(100, d.value)) / 100) * 100) / 100;
    } else {
      multiDogDiscount = Math.min(basePreview, Math.round(d.value * 100) / 100);
    }
  }
  const chargedToday = Math.max(0, (useCredits ? 0 : basePreview) + addOnTotal + extraNightsCharge - multiDogDiscount);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const body = {
        use_credits: useCredits,
        add_ons: cartItems.map(it => ({
          service_id: it.service.id, name: it.service.name,
          price: Number(it.service.base_price || 0), qty: it.qty,
        })),
      };
      if (isBoarding && extraNights > 0) {
        body.extra_nights = Number(extraNights);
        body.extra_nights_use_credits = extraUseCredits;
        if (extraRate !== "") body.extra_nights_rate = Number(extraRate);
      }
      if (!useCredits) {
        body.payment_method = payMethod;
        body.payment_status = "paid";
        if (basePrice !== "") body.base_price = Number(basePrice);
      } else if (!hadCredit) {
        if (basePrice !== "") body.base_price = Number(basePrice);
      } else if (extraNightsCharge > 0) {
        body.payment_method = payMethod;
        body.payment_status = "paid";
        if (basePrice !== "") body.base_price = Number(basePrice);
      } else {
        if (basePrice !== "") body.base_price = Number(basePrice);
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
      await api.post(`/bookings/${booking.id}/check-out`, body);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.detail || "Check-out failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="checkout-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-sign-out-alt text-shBlue mr-2"/>Check Out · {booking.dog_name}
          </h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
        </div>
        <p className="text-[14px] text-gray-400 mb-4">{booking.client_name} · {booking.service_type}</p>

        {/* Section 1 — How to pay the base service */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Base service</p>
          {hadCredit ? (
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${useCredits ? "border-shGreen bg-shGreen/10" : "border-bgHover hover:border-shGreen/50"}`} data-testid="opt-use-credits">
                <input type="radio" checked={useCredits} onChange={()=>setUseCredits(true)} className="mt-1 accent-shGreen" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Use {creditsDeducted || 1} {creditPool} credit{(creditsDeducted || 1) === 1 ? "" : "s"}</p>
                  <p className="text-[14px] text-gray-400">${creditAmt.toFixed(2)} value · already deducted from their pack at approval</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${!useCredits ? "border-shBlue bg-shBlue/10" : "border-bgHover hover:border-shBlue/50"}`} data-testid="opt-charge">
                <input type="radio" checked={!useCredits} onChange={()=>setUseCredits(false)} className="mt-1 accent-shBlue" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Charge as regular service</p>
                  <p className="text-[14px] text-gray-400">Refund {creditsDeducted || 1} credit{(creditsDeducted || 1) === 1 ? "" : "s"} back to their pack & take payment today</p>
                </div>
              </label>
            </div>
          ) : canPayWithCredits ? (
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${useCredits ? "border-shGreen bg-shGreen/10" : "border-bgHover hover:border-shGreen/50"}`} data-testid="opt-credit-at-checkout">
                <input type="radio" checked={useCredits} onChange={()=>setUseCredits(true)} className="mt-1 accent-shGreen" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Deduct {nightsNeeded} {booking.service_type} credit{nightsNeeded === 1 ? "" : "s"} now</p>
                  <p className="text-[14px] text-gray-400">Client has <span className="text-shGreen font-black">{available}</span> available · FIFO from oldest pack</p>
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
              {clientBal && available > 0 && available < nightsNeeded && (
                <span className="block mt-1 text-[14px] text-shOrange">
                  Client has {available} {booking.service_type} credit{available === 1 ? "" : "s"} but {nightsNeeded} {nightsNeeded === 1 ? "is" : "are"} needed.
                </span>
              )}
            </p>
          )}
        </div>

        {/* Section 1b — Boarding stay extension (extra nights) */}
        {isBoarding && (
          <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase" data-testid="checkout-extra-nights-panel">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black"><i className="fas fa-moon text-shBlue mr-1.5"/>Stayed Extra Nights?</p>
              {booking.end_date && <span className="text-[12px] text-gray-500">Original end: {booking.end_date}</span>}
            </div>
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
                <label className="flex items-center gap-2 text-[15px] text-gray-300">
                  <input type="checkbox" checked={extraUseCredits} onChange={(e)=>setExtraUseCredits(e.target.checked)} data-testid="extra-nights-use-credits"/>
                  Use remaining boarding credits first (any leftover gets billed)
                </label>
                {!extraUseCredits && (
                  <div>
                    <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Per-night rate <span className="text-gray-600">(blank = settings default)</span></label>
                    <input type="number" step="0.01" value={extraRate} onChange={(e)=>setExtraRate(e.target.value)} data-testid="extra-nights-rate"
                           placeholder={boardingRate ? `$${Number(boardingRate).toFixed(2)}` : "$0.00"}
                           className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
                  </div>
                )}
                <div className="text-[14px] bg-bgPanel rounded p-2 text-gray-300">
                  <i className="fas fa-circle-info text-shBlue mr-1"/>
                  {extraUseCredits
                    ? `Will draw up to ${extraNights} credit${extraNights===1?"":"s"} from boarding pack; any uncovered nights will be billed at $${extraRateEffective.toFixed(2)}/night.`
                    : `Charging ${extraNights} × $${extraRateEffective.toFixed(2)} = $${(extraNights * extraRateEffective).toFixed(2)} for the extension.`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Section 2 — Add-ons */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Add-on services <span className="text-gray-600">(bath, nail trim, etc.)</span></p>
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
                    <span className="text-white"><i className={`fas ${ao.icon || "fa-plus"} text-amber-400 mr-1.5"`}/>{ao.name} × {ao.qty || 1}</span>
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
                      <p className="text-[13px] text-gray-400 font-bold">${Number(svc.base_price || 0).toFixed(2)}</p>
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

        {/* Section 3 — Payment method + Service value */}
        <div className="mb-5 border border-bgHover rounded-lg p-4 bg-bgBase">
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-black mb-3">Payment</p>
          {(!useCredits || addOnTotal > 0) && (
            <select value={payMethod} onChange={(e)=>setPayMethod(e.target.value)} data-testid="checkout-pay-method"
                    className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mb-3">
              <option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Transfer</option><option value="check">Check</option><option value="other">Other</option>
            </select>
          )}
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">
              {useCredits ? "Service value (for income tracking)" : "Base price"}
              <span className="text-gray-600"> (blank = use service default)</span>
            </label>
            <input type="number" step="0.01" value={basePrice} onChange={(e)=>setBasePrice(e.target.value)} data-testid="checkout-base-price"
                   placeholder={basePreview ? `$${basePreview.toFixed(2)}` : "$0.00"}
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
            {useCredits && (
              <p className="text-[13px] text-gray-500 mt-1.5 normal-case">
                <i className="fas fa-circle-info text-shGreen mr-1"/>
                Credit is still consumed from the client's pack. This dollar amount is recorded as today's income so the daily/weekly totals stay accurate.
              </p>
            )}
          </div>
        </div>

        {/* Total summary */}
        <div className="mb-4 border-t-2 border-shGreen pt-3 flex items-end justify-between">
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Base · ${basePreview.toFixed(2)}</p>
            {addOnTotal > 0 && <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Add-ons · ${addOnTotal.toFixed(2)}</p>}
            {multiDogDiscount > 0 && (
              <p className="text-[12px] uppercase tracking-widest text-shOrange font-black" data-testid="checkout-multi-dog-discount">
                <i className="fas fa-dog mr-1"/>
                {discountPreview?.discount?.label || "Multi-dog discount"} · −${multiDogDiscount.toFixed(2)}
                {discountPreview?.discount?.mode === "percent" && (
                  <span className="text-gray-500 normal-case ml-1">({discountPreview.discount.value}% off)</span>
                )}
              </p>
            )}
            {useCredits && hadCredit && <p className="text-[12px] uppercase tracking-widest text-shGreen font-black">−${creditAmt.toFixed(2)} via credits</p>}
          </div>
          <div className="text-right">
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">{useCredits && hadCredit && addOnTotal === 0 ? "Total" : "Charged today"}</p>
            <p className="text-shGreen text-3xl font-black" data-testid="checkout-total">${chargedToday.toFixed(2)}</p>
          </div>
        </div>

        {err && <p className="text-red-400 text-[15px] mb-3">{err}</p>}

        <div className="flex items-center justify-between gap-3">
          {onRequestCancel ? (
            <button onClick={() => onRequestCancel(booking)} disabled={busy} data-testid="checkout-cancel-booking"
                    className="text-red-400 font-black uppercase text-[14px] tracking-widest hover:text-red-300 disabled:opacity-50">
              <i className="fas fa-times-circle mr-1"/>Cancel booking instead
            </button>
          ) : <span/>}
          <div className="flex gap-3">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Close</button>
            <button onClick={submit} disabled={busy} data-testid="confirm-checkout"
                    className="bg-shBlue text-white px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Checking out…" : "Complete Check-out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


export function CancelBookingModal({ booking, onClose }) {
  const credits = Number(booking.credits_deducted || 0);
  const pool = booking.credit_service_type || booking.service_type;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const confirm = async () => {
    setBusy(true); setErr("");
    try { await api.delete(`/bookings/${booking.id}`); onClose(); }
    catch (e) {
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
          This will remove the booking from today's list. Use it if the dog was checked in by mistake or the client changed their mind.
        </p>

        {credits > 0 ? (
          <div className="bg-shGreen/10 border border-shGreen/40 rounded p-3 mb-4 flex items-center gap-2">
            <i className="fas fa-coins text-shGreen text-lg"/>
            <p className="text-[15px] text-white">
              <span className="text-shGreen font-black">{credits} {pool} credit{credits === 1 ? "" : "s"}</span> will be refunded to <strong>{booking.client_name}</strong>.
            </p>
          </div>
        ) : (
          <div className="bg-bgBase border border-bgHover rounded p-3 mb-4 text-[15px] text-gray-400">
            <i className="fas fa-info-circle mr-1.5"/>No credits to refund on this booking.
          </div>
        )}

        {err && <p className="text-red-400 text-[15px] mb-3">{err}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} data-testid="cancel-keep" className="text-gray-400 font-black uppercase text-[14px] tracking-widest hover:text-white disabled:opacity-50">
            Keep it
          </button>
          <button onClick={confirm} disabled={busy} data-testid="cancel-confirm"
                  className="bg-red-500 text-white px-7 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg hover:bg-red-600 disabled:opacity-50">
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>
        </div>
      </div>
    </div>
  );
}
