import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { shopImageProps } from "../../lib/shopImage";

/**
 * What happened after the money moved.
 *
 * A receipt is a thing people come back to, usually to answer one of three
 * questions: did it go through, when is it ready, and can I get another one.
 * So the list answers the first two at a glance and the detail answers the
 * third with a button.
 *
 * Everything priced here is HISTORY — what they paid, on the day they paid
 * it. Nothing on this screen recalculates, and nothing re-prices: a shelf
 * price that moved must never rewrite an old receipt. The only thing read
 * live is the picture and whether the item can be bought again, both of
 * which the server resolves against today's catalogue.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * A line's picture, or the space where one would be.
 *
 * shopImageProps returns null for an id it cannot build a URL for, and
 * spreading null onto an <img> produces an element with no src — a broken-
 * image icon in the middle of somebody's receipt. So the fallback is chosen
 * here rather than assumed away.
 *
 * Always the `thumb` derivative and always lazy: a ten-order list is thirty
 * of these, and the originals would be megabytes for a 36px square.
 */
function LineThumb({ imageId, size = "w-9 h-9", icon = "text-[11px]" }) {
  const props = imageId ? shopImageProps(imageId, "thumb") : null;
  return (
    <div className={`${size} rounded-lg border border-shBorder overflow-hidden bg-shBg/40 grid place-items-center shrink-0`}>
      {props
        ? <img {...props} alt="" className="w-full h-full object-cover" />
        : <i className={`fas fa-box text-shTextMuted ${icon}`} aria-hidden="true" />}
    </div>
  );
}

const dateOf = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined,
      { year: "numeric", month: "short", day: "numeric" });
  } catch { return "—"; }
};

/**
 * The one sentence that matters, as words.
 *
 * Status is never carried by colour alone — the colour is a second signal on
 * top of the text, so the row reads the same to someone who cannot
 * distinguish them, and the same in a screenshot printed in grey.
 */
export function orderState(order) {
  if (order.status === "refunded" || order.refund_status === "full") {
    return { label: "Refunded", tone: "text-shTextMuted", icon: "fa-rotate-left" };
  }
  if (order.status !== "paid") {
    return { label: "Not completed", tone: "text-shDanger", icon: "fa-circle-exclamation" };
  }
  if (order.refund_status === "partial") {
    return { label: "Partly refunded", tone: "text-shOrange", icon: "fa-rotate-left" };
  }
  if (order.pickup_status === "picked_up") {
    return { label: "Picked up", tone: "text-shGreen", icon: "fa-circle-check" };
  }
  if (order.pickup_status === "ready") {
    return { label: "Ready for pickup", tone: "text-shGreen", icon: "fa-box-open" };
  }
  if (order.fulfillment_status === "fulfilled") {
    return { label: "Completed", tone: "text-shGreen", icon: "fa-circle-check" };
  }
  if (order.fulfillment_status === "failed") {
    return { label: "Needs attention", tone: "text-shOrange", icon: "fa-triangle-exclamation" };
  }
  return { label: "Being prepared", tone: "text-shOrange", icon: "fa-clock" };
}

function StatusChip({ order, testId }) {
  const s = orderState(order);
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest ${s.tone}`}
          data-testid={testId}>
      <i className={`fas ${s.icon}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

/** A small stack of thumbnails, so a row is recognisable before it is read.
 *  Below the fold and decorative, so they load lazily and at thumb size —
 *  never the original, which on a ten-order list would be megabytes. */
function LineThumbs({ lines, max = 3 }) {
  const shown = (lines || []).slice(0, max);
  const more = (lines || []).length - shown.length;
  return (
    <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
      {shown.map((l, i) => <LineThumb key={`${l.ref_id}-${i}`} imageId={l.image_id} />)}
      {more > 0 && <span className="text-[11px] text-shTextMuted font-bold">+{more}</span>}
    </div>
  );
}

/**
 * The list.
 *
 * Every row is a button, because every row opens something. Making it a
 * <div> with an onClick is the version of this that a keyboard cannot use.
 */
export function OrderList({ orders, onOpen, onRefresh, busy }) {
  const list = orders || [];
  if (list.length === 0) {
    return (
      <div className="text-center py-10 px-4" data-testid="shop-orders-empty">
        <div className="w-14 h-14 rounded-2xl mx-auto grid place-items-center border border-shBorder">
          <i className="fas fa-receipt text-shTextMuted text-[20px]" aria-hidden="true" />
        </div>
        <h3 className="text-[15px] font-black text-shText mt-4">No orders yet</h3>
        <p className="text-[13px] text-shTextMuted mt-1.5">
          Anything you buy here will show up in this list.
        </p>
      </div>
    );
  }
  return (
    <div data-testid="shop-orders-list">
      {onRefresh && (
        <div className="flex justify-end mb-2">
          <button onClick={onRefresh} disabled={busy} data-testid="shop-orders-refresh"
                  className="text-[11px] uppercase tracking-widest font-black text-shTextMuted
                             hover:text-shPrimary disabled:opacity-50 focus-visible:outline-none
                             focus-visible:ring-2 focus-visible:ring-shPrimary rounded px-2 py-2 -my-1">
            <i className="fas fa-rotate-right mr-1" aria-hidden="true" />Refresh
          </button>
        </div>
      )}
      <ul className="space-y-2 list-none p-0 m-0">
        {list.map((o) => (
          <li key={o.order_id}>
            <button
              onClick={() => onOpen?.(o.order_id)}
              data-testid={`shop-order-${o.order_id}`}
              className="w-full text-left border border-shBorder rounded-xl p-3 hover:border-shPrimary/50
                         transition focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-shPrimary focus-visible:ring-offset-2
                         focus-visible:ring-offset-[var(--sh-card-base)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-shText font-black text-[14px]">Order #{o.reference}</span>
                    <StatusChip order={o} testId={`shop-order-status-${o.order_id}`} />
                  </div>
                  <p className="text-shTextMuted text-[12px] mt-0.5">
                    {dateOf(o.created_at)} · {money(o.total)} · {o.item_count} item{o.item_count === 1 ? "" : "s"}
                  </p>
                  <p className="text-[12px] text-shTextMuted mt-1 line-clamp-1">
                    {(o.lines || []).map((l) => `${l.quantity}× ${l.name}`).join(", ")}
                  </p>
                </div>
                <LineThumbs lines={o.lines} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value, strong }) {
  if (value == null) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <span className={strong ? "text-shText font-black" : "text-shTextMuted"}>{label}</span>
      <span className={strong ? "text-shText font-black" : "text-shText"}>{value}</span>
    </div>
  );
}

/** The buttons under a line, built from what the SERVER decided is possible.
 *  A disabled one still says why, because a greyed-out button with no
 *  explanation is just a dead end. */
function LineActions({ actions, onBuyAgain, onOpenItem, onOpenCourse, onOpenCredits, busyRef }) {
  const list = actions || [];
  if (list.length === 0) return null;
  const btn = "text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary " +
    "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sh-card-base)]";
  return (
    <div className="flex items-center gap-2 flex-wrap mt-2">
      {list.map((a) => {
        if (a.action === "buy_again" && a.enabled) {
          return (
            <button key="buy_again" onClick={() => onBuyAgain?.(a)} disabled={busyRef === a.ref_id}
                    data-testid={`order-line-buy-again-${a.ref_id}`}
                    className={`${btn} border-shPrimary/50 bg-shPrimary/10 text-shPrimary hover:bg-shPrimary/20 disabled:opacity-60`}>
              <i className="fas fa-rotate-right mr-1.5" aria-hidden="true" />Buy again
            </button>
          );
        }
        if (a.action === "buy_again") {
          return (
            <span key="buy_again_off" data-testid="order-line-buy-again-blocked"
                  className="text-[11px] font-bold text-shTextMuted inline-flex items-center gap-1.5">
              <i className="fas fa-circle-info" aria-hidden="true" />{a.reason}
            </span>
          );
        }
        if (a.action === "open_course" && a.enabled) {
          return (
            <button key="open_course" onClick={() => onOpenCourse?.(a)}
                    data-testid={`order-line-open-course-${a.enrollment_id}`}
                    className={`${btn} border-shPrimary/50 bg-shPrimary/10 text-shPrimary hover:bg-shPrimary/20`}>
              <i className="fas fa-graduation-cap mr-1.5" aria-hidden="true" />Open course
            </button>
          );
        }
        if (a.action === "open_course") {
          return (
            <span key="open_course_off" className="text-[11px] font-bold text-shTextMuted">{a.reason}</span>
          );
        }
        if (a.action === "view_item") {
          return (
            <button key="view_item" onClick={() => onOpenItem?.(a)}
                    data-testid={`order-line-view-item-${a.ref_id}`}
                    className={`${btn} border-shBorder text-shTextMuted hover:text-shText hover:border-shText/40`}>
              View item
            </button>
          );
        }
        if (a.action === "view_credits") {
          return (
            <button key="view_credits" onClick={() => onOpenCredits?.()}
                    data-testid="order-line-view-credits"
                    className={`${btn} border-shBorder text-shTextMuted hover:text-shText hover:border-shText/40`}>
              View balance
            </button>
          );
        }
        return null;
      })}
    </div>
  );
}

/**
 * One order, in full.
 *
 * The heading hierarchy is real: the order number is the page's h2 and each
 * block below it is an h3, so the whole thing can be navigated by heading
 * rather than by scrolling and guessing.
 */
export function OrderDetail({ order, onBack, onBuyAgain, onOpenItem, onOpenCourse, onOpenCredits, busyRef }) {
  if (!order) return null;
  const lines = order.lines || [];
  return (
    <div data-testid="shop-order-detail">
      <button onClick={onBack} data-testid="shop-order-detail-back"
              className="text-[11px] font-black uppercase tracking-widest text-shTextMuted
                         hover:text-shText mb-2 focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-shPrimary rounded px-2 py-2 -ml-2">
        <i className="fas fa-arrow-left mr-1.5" aria-hidden="true" />All orders
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[18px] sm:text-[20px] font-black text-shText" data-testid="shop-order-detail-reference">
            Order #{order.reference}
          </h2>
          <p className="text-[12px] text-shTextMuted mt-0.5">{dateOf(order.created_at)}</p>
        </div>
        <StatusChip order={order} testId="shop-order-detail-status" />
      </div>

      <h3 className="sr-only">Items</h3>
      <ul className="mt-4 space-y-3 list-none p-0 m-0">
        {lines.map((l) => (
          <li key={l.item_id} className="border border-shBorder rounded-xl p-3"
              data-testid={`order-line-${l.item_id}`}>
            <div className="flex items-start gap-3">
              <LineThumb imageId={l.image_id} size="w-14 h-14" icon="text-[13px]" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-shText leading-snug break-words">{l.name}</p>
                <p className="text-[12px] text-shTextMuted mt-0.5">
                  {l.quantity} × {money(l.unit_price)} · {money(l.line_total)}
                </p>
                {l.dog_name && (
                  <p className="text-[12px] text-shSecondary font-bold mt-0.5"
                     data-testid={`order-line-dog-${l.item_id}`}>
                    For {l.dog_name}
                  </p>
                )}
                {l.kind === "gift_card" && l.recipient_email && (
                  <div className="mt-1" data-testid={`order-line-gift-${l.item_id}`}>
                    <p className="text-[12px] text-shSecondary font-bold">
                      Gift for {l.recipient_name || l.recipient_email}
                    </p>
                    <p className="text-[11px] text-shTextMuted break-words">{l.recipient_email}</p>
                    {l.gift_message && (
                      <p className="text-[11px] text-shTextMuted italic mt-0.5 break-words">“{l.gift_message}”</p>
                    )}
                    <p className="text-[11px] text-shTextMuted mt-1">
                      {l.fulfillment_status === "fulfilled"
                        ? "The card and its code were emailed to them."
                        : "The card will be emailed once payment clears."}
                    </p>
                  </div>
                )}
                {l.quantity_refunded > 0 && (
                  <p className="text-[11px] text-shOrange font-bold mt-1">
                    {l.quantity_refunded} refunded · {money(l.amount_refunded)}
                  </p>
                )}
                <LineActions actions={l.actions} onBuyAgain={onBuyAgain} onOpenItem={onOpenItem}
                             onOpenCourse={onOpenCourse} onOpenCredits={onOpenCredits} busyRef={busyRef} />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="sr-only">Totals</h3>
      <div className="mt-4 border-t border-shBorder pt-3 space-y-1.5">
        <Row label="Subtotal" value={money(order.subtotal)} />
        {order.tax_amount > 0 && <Row label="Sales tax" value={money(order.tax_amount)} />}
        <Row label="Total" value={money(order.total)} strong />
        {order.refunded_amount > 0 && (
          <Row label="Refunded" value={`−${money(order.refunded_amount)}`} />
        )}
      </div>

      {order.pickup_status && order.pickup_status !== "picked_up" && (
        <p className="mt-4 text-[12px] text-shTextMuted border border-shBorder rounded-lg p-3"
           data-testid="shop-order-pickup-note">
          <i className="fas fa-store mr-1.5" aria-hidden="true" />
          {order.pickup_status === "ready"
            ? "Ready to collect at Sit Happens — bring this order number."
            : "We'll let you know as soon as this is ready to collect."}
        </p>
      )}
    </div>
  );
}

/**
 * The whole My Orders surface: a list that becomes a detail view.
 *
 * The detail is fetched when it is opened rather than up front — a list of
 * twenty orders should not be twenty detail requests, and nineteen of them
 * would never be read.
 */
export function MyOrders({ orders, onRefresh, onBuyAgain, onOpenItem, onOpenCourse, onOpenCredits, busyRef }) {
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!openId) { setDetail(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    api.get(`/portal/shop-orders/${openId}`)
      .then(({ data }) => { if (!cancelled) setDetail(data); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [openId]);

  if (openId) {
    if (loading && !detail) {
      return <p className="text-shTextMuted text-sm py-6 text-center">Loading order…</p>;
    }
    if (!detail) {
      return (
        <div className="py-6 text-center">
          <p className="text-shTextMuted text-sm">That order could not be opened.</p>
          <button onClick={() => setOpenId(null)} className="mt-2 text-[11px] font-black uppercase tracking-widest text-shPrimary">
            All orders
          </button>
        </div>
      );
    }
    return (
      <OrderDetail order={detail} onBack={() => setOpenId(null)} onBuyAgain={onBuyAgain}
                   onOpenItem={onOpenItem} onOpenCourse={onOpenCourse}
                   onOpenCredits={onOpenCredits} busyRef={busyRef} />
    );
  }
  return <OrderList orders={orders} onOpen={setOpenId} onRefresh={onRefresh} />;
}
