/* Sprint 110di-29 — Client-facing Payment Options.

Renders the enabled rows from settings.payment_options. Each row shows:
  • An icon + label
  • A clickable "Open" button when `link` is set (deep-link to the payer
    app: Venmo, PayPal.me, etc.). External target — opens in a new tab.
  • Free-text instructions
Disabled rows + rows with neither link nor instructions are filtered out
so the card never shows a placeholder row to the client.

Hard rules baked in:
  • Booking is NEVER gated on payment.
  • No payment is processed in this app.
  • Manual Payment Tracking remains the source of truth.
The component just tells the client HOW to pay — same job the operator
used to do verbally at the front desk. */
import { useTheme } from "../lib/theme";

const ICONS = {
  venmo:  "fa-mobile-screen",
  paypal: "fa-paypal",
  clover: "fa-credit-card",
  cash:   "fa-money-bill-wave",
  check:  "fa-money-check-dollar",
};

export default function PaymentOptionsCard({ compact = false }) {
  const { branding } = useTheme();
  const rows = (branding?.payment_options || []).filter(
    (r) => r && r.enabled && (r.link || r.instructions || r.label)
  );
  if (rows.length === 0) return null;

  return (
    <div
      className={`bg-bgPanel card-pop rounded-2xl border border-bgHover shadow-2xl ${compact ? "p-4" : "p-5 sm:p-6"}`}
      data-testid="portal-payment-options"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] sm:text-[14px] font-black text-shGreen uppercase tracking-widest">
          <i className="fas fa-money-bill-wave mr-2"/>How to pay
        </p>
        <span className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Optional</span>
      </div>

      <p className="text-[12px] text-gray-400 leading-snug mb-3">
        Payment is optional and never required to submit a booking.
        Pick whichever method works for you.
      </p>

      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.key}
            className="bg-bgBase border border-bgHover rounded-lg p-3 overflow-hidden"
            data-testid={`portal-pay-${r.key}`}
          >
            {/* Header row: icon + label (label can be long like "@sit-happens"
                so allow it to wrap and break inside words rather than push the
                Open button off the card edge). */}
            <div className="flex items-center gap-2 mb-1.5">
              <i className={`fas ${ICONS[r.key] || "fa-money-bill"} text-shGreen text-lg shrink-0`}/>
              <span className="text-white font-black uppercase tracking-wide text-[13px] leading-tight min-w-0 break-words">
                {r.label || r.key}
              </span>
            </div>
            {r.instructions && (
              <p className="text-[12px] text-gray-400 leading-snug break-words">
                {r.instructions}
              </p>
            )}
            {r.link ? (
              <a
                href={r.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shGreen/90 inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
                data-testid={`portal-pay-${r.key}-open`}
              >
                <i className="fas fa-external-link-alt"/>Open
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
