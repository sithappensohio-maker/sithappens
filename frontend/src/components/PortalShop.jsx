import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { toast } from "sonner";

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
  { key: "credit_pack", label: "Credit Packs" },
  { key: "training_program", label: "Training" },
];

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

function ShopImage({ imageId, alt }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!imageId) { setSrc(null); return; }
    let cancelled = false;
    api.get(`/shop/media/${imageId}`)
      .then(({ data }) => { if (!cancelled) setSrc(data.data); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [imageId]);

  if (src) return <img src={src} alt={alt || ""} className="w-full h-32 object-cover rounded-lg" />;
  return (
    <div className="w-full h-32 rounded-lg bg-bgBase border border-bgHover grid place-items-center text-gray-600">
      <i className="fas fa-image text-2xl" />
    </div>
  );
}

function ItemCard({ item, cartQty, onAdd }) {
  const outOfStock = item.kind === "product" && item.track_inventory && !item.in_stock;
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-3 flex flex-col" data-testid={`shop-card-${item.kind}-${item.id}`}>
      <ShopImage imageId={item.image_id} alt={item.name} />
      <p className="text-white font-black text-[14px] mt-3 truncate">{item.name}</p>
      {item.description && <p className="text-gray-400 text-[12px] mt-1 line-clamp-2">{item.description}</p>}

      {item.kind === "product" && (
        <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black mt-1">
          {item.track_inventory
            ? (item.in_stock ? `${item.stock_on_hand} in stock` : "Out of stock")
            : "Available"}
        </p>
      )}
      {item.kind === "credit_pack" && (
        <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black mt-1">
          {item.qty} {item.service_type} credits
        </p>
      )}
      {item.kind === "training_program" && (
        <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black mt-1">
          {item.format_count} {item.format_unit}
        </p>
      )}

      <div className="mt-auto pt-3 space-y-2">
        <p className="text-shGreen font-black text-[18px]">{money(item.price)}</p>
        <button
          onClick={() => onAdd(item)}
          disabled={outOfStock}
          data-testid={`shop-buy-${item.kind}-${item.id}`}
          className={`w-full px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest transition ${
            outOfStock
              ? "bg-bgBase border border-bgHover text-gray-600 cursor-not-allowed"
              : "bg-shGreen text-bgHeader hover:opacity-90"
          }`}
        >
          {outOfStock ? "Out of Stock" : cartQty > 0 ? `In Cart (${cartQty})` : "Add to Cart"}
        </button>
      </div>
    </div>
  );
}

const cartKey = (kind, refId) => `${kind}:${refId}`;

function CartPanel({ cart, items, onQtyChange, onRemove, onCheckout, busy, onClose }) {
  const lines = cart.map((c) => {
    const item = items.find((i) => i.kind === c.kind && i.id === c.ref_id);
    return { ...c, item };
  }).filter((l) => l.item);
  const subtotal = lines.reduce((sum, l) => sum + (l.item.price || 0) * l.quantity, 0);

  // Portaled to document.body — this panel must NEVER be a direct child of
  // a .bg-bgPanel.rounded-2xl/.rounded-xl container (index.css's `> *`
  // dialog-content rule forces position:relative on direct children of
  // those, which would silently break this backdrop's `fixed` positioning
  // since PortalShop's own root wrapper carries those exact classes).
  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" data-testid="shop-cart-panel">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="text-white font-black uppercase tracking-widest text-sm">Your Cart</p>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-xmark" /></button>
        </div>

        {lines.length === 0 && <p className="text-gray-500 text-sm py-6 text-center">Your cart is empty.</p>}

        <div className="space-y-2">
          {lines.map((l) => (
            <div key={cartKey(l.kind, l.ref_id)} className="bg-bgBase border border-bgHover rounded-lg p-3 flex items-center justify-between gap-2"
                 data-testid={`shop-cart-line-${l.kind}-${l.ref_id}`}>
              <div className="min-w-0">
                <p className="text-white font-bold text-sm truncate">{l.item.name}</p>
                <p className="text-[11px] text-gray-500">{money(l.item.price)} each</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => onQtyChange(l.kind, l.ref_id, l.quantity - 1)}
                        className="w-7 h-7 rounded bg-bgPanel border border-bgHover text-gray-300">−</button>
                <span className="text-white font-bold w-5 text-center">{l.quantity}</span>
                <button onClick={() => onQtyChange(l.kind, l.ref_id, l.quantity + 1)}
                        className="w-7 h-7 rounded bg-bgPanel border border-bgHover text-gray-300">+</button>
                <button onClick={() => onRemove(l.kind, l.ref_id)} className="text-gray-500 hover:text-red-400 ml-1">
                  <i className="fas fa-trash-can text-xs" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {lines.length > 0 && (
          <>
            <div className="flex items-center justify-between pt-2 border-t border-bgHover">
              <p className="text-gray-400 text-sm">Subtotal</p>
              <p className="text-white font-black">{money(subtotal)}</p>
            </div>
            <p className="text-[11px] text-gray-500">Tax (if applicable) is calculated on the next step. You&apos;ll be taken to Stripe&apos;s secure checkout — Sit Happens never sees or stores your card details.</p>
            <button onClick={onCheckout} disabled={busy}
                    data-testid="shop-checkout-button"
                    className="w-full bg-shGreen text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
              {busy ? "Redirecting…" : "Checkout"}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function PortalShop({ initialTab = "all", fullScreen = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [cart, setCart] = useState([]); // [{kind, ref_id, quantity}]
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const idemKeyRef = useRef(null);

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const load = () => {
    setLoading(true);
    api.get("/shop/catalog")
      .then(({ data }) => setItems(data.items || []))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load the shop"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    return items.filter((i) => i.kind === tab);
  }, [items, tab]);

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.kind === item.kind && c.ref_id === item.id);
      if (existing) {
        return prev.map((c) => (c === existing ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { kind: item.kind, ref_id: item.id, quantity: 1 }];
    });
    idemKeyRef.current = null; // cart changed — a fresh checkout attempt needs a fresh key
  };

  const changeQty = (kind, refId, qty) => {
    idemKeyRef.current = null;
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => !(c.kind === kind && c.ref_id === refId)));
      return;
    }
    setCart((prev) => prev.map((c) => (c.kind === kind && c.ref_id === refId ? { ...c, quantity: qty } : c)));
  };

  const removeFromCart = (kind, refId) => {
    idemKeyRef.current = null;
    setCart((prev) => prev.filter((c) => !(c.kind === kind && c.ref_id === refId)));
  };

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

  return (
    <div id="portal-shop-anchor" data-testid="portal-shop"
         className={fullScreen ? "w-full max-w-6xl mx-auto" : "bg-bgPanel card-pop p-6 rounded-2xl border border-bgHover shadow-2xl"}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen">
          <i className="fas fa-bag-shopping mr-1" />Shop
        </p>
        <button onClick={() => setCartOpen(true)} data-testid="shop-cart-open"
                className="relative bg-bgBase border border-bgHover text-gray-300 px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest hover:border-shGreen/50">
          <i className="fas fa-cart-shopping mr-1" />Cart
          {cartCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-shGreen text-bgHeader rounded-full w-5 h-5 text-[10px] grid place-items-center font-black" data-testid="shop-cart-count">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {returning && (
        <div className="mb-4 bg-bgBase border border-bgHover rounded-lg p-3 text-sm" data-testid="shop-order-return-status">
          {returning.status === "pending_payment" ? (
            <span className="text-gray-300"><i className="fas fa-circle-notch fa-spin mr-2" />Payment processing…</span>
          ) : returning.status === "paid" && returning.fulfillmentStatus !== "fulfilled" && returning.fulfillmentStatus !== "needs_attention" ? (
            <span className="text-gray-300"><i className="fas fa-circle-notch fa-spin mr-2" />Payment received — order processing…</span>
          ) : returning.status === "paid" && returning.fulfillmentStatus === "fulfilled" ? (
            !returning.hasPhysical ? (
              <span className="text-shGreen font-black"><i className="fas fa-circle-check mr-2" />Order received! Your credits/sessions have been added.</span>
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
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`shop-tab-${t.key}`}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest transition ${
                    tab === t.key ? "bg-shGreen text-bgHeader" : "bg-bgBase border border-bgHover text-gray-400 hover:border-shGreen/50"
                  }`}>
            {t.label}
          </button>
        ))}
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
              <ItemCard key={`${item.kind}-${item.id}`} item={item} cartQty={inCart ? inCart.quantity : 0} onAdd={addToCart} />
            );
          })}
        </div>
      )}

      {cartOpen && (
        <CartPanel
          cart={cart}
          items={items}
          onQtyChange={changeQty}
          onRemove={removeFromCart}
          onCheckout={submitCheckout}
          busy={checkoutBusy}
          onClose={() => setCartOpen(false)}
        />
      )}
    </div>
  );
}
