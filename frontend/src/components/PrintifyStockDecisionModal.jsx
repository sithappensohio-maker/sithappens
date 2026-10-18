import { useState } from "react";
import { createPortal } from "react-dom";

// Register-only (owner, 2026-10-18): a Printify item that's also stocked
// on the shelf doesn't always have enough on hand to cover what's in the
// cart. Full stock sells off the shelf silently (no production order at
// all); none sells straight to a Printify order, same as always. This
// modal only shows up for the genuinely ambiguous case — SOME stock, not
// enough — where the server refused with a 409 ("printify_stock_decision_
// needed", see _pos_resolve_printify_stock) because it's a real choice,
// not something the register should guess at. Online Shop checkout never
// hits this; it always orders fresh from Printify regardless of stock.
export default function PrintifyStockDecisionModal({ lines, onClose, onConfirm }) {
  const [choices, setChoices] = useState({});

  const keyOf = (l) => `${l.product_id}:${l.variant_id || ""}`;
  const allChosen = lines.every((l) => choices[keyOf(l)] !== undefined);

  const confirm = () => {
    if (!allChosen) return;
    onConfirm(choices);
  };

  return createPortal((
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[120] overflow-y-auto"
         onClick={onClose} data-testid="printify-stock-decision-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-5 w-full max-w-md shadow-2xl my-8"
           onClick={(e) => e.stopPropagation()}>
        <h4 className="text-lg font-black text-shText uppercase italic">Not Quite Enough In Stock</h4>
        <p className="text-[12.5px] text-shTextMuted mt-1 mb-4 leading-relaxed">
          For each item below: ship what's on the shelf and order the rest from Printify, or skip the shelf
          and order the whole thing fresh.
        </p>

        <div className="space-y-3">
          {lines.map((l) => {
            const key = keyOf(l);
            const choice = choices[key];
            const remainder = Math.max(0, l.requested - l.available);
            return (
              <div key={key} className="rounded-lg border border-shBorder p-3" data-testid={`printify-stock-line-${key}`}>
                <p className="text-shText font-bold text-[13px]">
                  {l.name}{l.variant_name ? ` — ${l.variant_name}` : ""}
                </p>
                <p className="text-[11.5px] text-shTextMuted mb-2">
                  {l.available} in stock · {l.requested} requested
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setChoices((c) => ({ ...c, [key]: true }))}
                          data-testid={`printify-stock-use-stock-${key}`}
                          className={`flex-1 rounded-lg px-2 py-2 text-[11px] font-black uppercase tracking-widest ${choice === true ? "bg-shPrimary text-bgHeader" : "bg-black/10 border border-shBorder text-shTextMuted"}`}>
                    Ship {l.available} Now + Order {remainder}
                  </button>
                  <button type="button" onClick={() => setChoices((c) => ({ ...c, [key]: false }))}
                          data-testid={`printify-stock-order-all-${key}`}
                          className={`flex-1 rounded-lg px-2 py-2 text-[11px] font-black uppercase tracking-widest ${choice === false ? "bg-shPrimary text-bgHeader" : "bg-black/10 border border-shBorder text-shTextMuted"}`}>
                    Order All {l.requested} From Printify
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} data-testid="printify-stock-decision-cancel"
                  className="flex-1 min-h-[44px] rounded-lg border border-shBorder text-shTextMuted font-black text-[12px] uppercase tracking-widest hover:text-shText">
            Cancel
          </button>
          <button onClick={confirm} disabled={!allChosen} data-testid="printify-stock-decision-continue"
                  className="flex-[2] min-h-[44px] rounded-lg bg-shPrimary text-bgHeader font-black text-[12px] uppercase tracking-widest disabled:opacity-40">
            Continue
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
