import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import PremiumButton from "./premium/PremiumButton";
import { cartGiftKey } from "../lib/shopPolish";
import { readGuestCart, clearGuestCart } from "../lib/shopGuestCart";
import { resolveCartLines, applyResolved } from "../lib/cartRestore";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/* Public no-account storefront — shown once, right after a guest signs in
 * or registers with items still sitting in their local guest cart, BEFORE
 * anything is merged into the real authenticated cart. Every line is
 * resolved fresh against the authenticated /shop/catalog (real pricing,
 * real stock, real eligibility) — no guest-side price is ever shown or
 * compared, since none of it can be trusted to still be current. Stock
 * caps account for whatever the authenticated cart ALREADY holds for that
 * same line, never just the incoming guest quantity in isolation.
 * Dismissing leaves the guest cart in localStorage untouched (it can
 * reappear later); only an explicit confirm clears it, and only after the
 * merge has actually been applied. */
export default function GuestCartMergeReview({ authCart, onApply, onDismiss }) {
  const [guestLines] = useState(() => readGuestCart());
  const [catalogItems, setCatalogItems] = useState(null); // null = loading
  const [err, setErr] = useState("");

  useEffect(() => {
    if (guestLines.length === 0) return;
    api.get("/shop/catalog")
      .then(({ data }) => setCatalogItems(data.items || []))
      .catch(() => setErr("Could not check current pricing and availability — please try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The same resolution the signed-in cart uses when it comes back after a
  // reload (lib/cartRestore): real catalogue, real stock, real eligibility,
  // and stock counted against what the account cart ALREADY holds — never
  // the incoming guest quantity on its own. No guest-side price is shown or
  // compared, because none of it can be trusted to still be current.
  const resolved = useMemo(
    () => (catalogItems ? resolveCartLines(guestLines, { catalog: catalogItems, existing: authCart || [] }) : []),
    [catalogItems, guestLines, authCart],
  );

  if (guestLines.length === 0) return null;

  const anyApplicable = resolved.some((r) => r.actuallyAdded > 0);

  const handleConfirm = () => {
    onApply(applyResolved(authCart || [], resolved));
    clearGuestCart();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4"
         role="dialog" aria-modal="true" aria-label="Review your cart"
         data-testid="guest-cart-merge-review">
      <div className="border border-shBorder rounded-2xl w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto shadow-sh" style={{ background: "var(--sh-card-base)" }}>
        <div>
          <p className="text-shText font-bold uppercase tracking-widest text-sm">Review Your Cart</p>
          <p className="text-shTextMuted text-[12px] mt-1">
            You added items while browsing without an account. Confirm below to add them to your account cart with your real pricing and availability.
          </p>
        </div>

        {catalogItems === null && !err && (
          <p className="text-shTextMuted text-sm py-4 text-center">Checking current pricing and availability…</p>
        )}
        {err && <p className="text-shDanger text-sm py-2">{err}</p>}

        {catalogItems !== null && (
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={`${r.line.kind}:${r.line.ref_id}:${cartGiftKey(r.line.gift)}`} className="border border-shBorder rounded-lg p-3" data-testid={`guest-merge-line-${r.line.kind}-${r.line.ref_id}`}>
                <p className="text-shText font-bold text-sm truncate">{r.item ? r.item.name : "Item"}</p>
                {r.line.gift?.recipient_email && (
                  <p className="text-[11px] text-shSecondary font-bold" data-testid="guest-merge-line-gift">
                    Gift for {r.line.gift.recipient_name || r.line.gift.recipient_email}
                  </p>
                )}
                {r.rejected ? (
                  <p className="text-[12px] text-shDanger mt-1" data-testid="guest-merge-line-rejected">
                    <i className="fas fa-triangle-exclamation mr-1" />{r.rejected}
                  </p>
                ) : (
                  <p className="text-[12px] text-shTextMuted mt-1">
                    {r.item.price != null && <>{money(r.item.price)} each · </>}
                    Requested {r.requested}{r.existingQty > 0 ? ` · Already in cart: ${r.existingQty}` : ""} · Adding {r.actuallyAdded}
                    {r.finalQty !== r.existingQty + r.requested ? ` (capped to ${r.finalQty} available)` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <PremiumButton variant="secondary" onClick={onDismiss} data-testid="guest-merge-dismiss" className="flex-1 justify-center">
            Not Now
          </PremiumButton>
          <PremiumButton variant="primary" onClick={handleConfirm} disabled={catalogItems === null || !anyApplicable} data-testid="guest-merge-confirm" className="flex-1 justify-center">
            Add to Cart
          </PremiumButton>
        </div>
      </div>
    </div>
  );
}
