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
            className="bg-bgBase border border-bgHover rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
            data-testid={`portal-pay-${r.key}`}
          >
            <div className="flex items-center gap-2 sm:min-w-[140px]">
              <i className={`fas ${ICONS[r.key] || "fa-money-bill"} text-shGreen text-lg`}/>
              <span className="text-white font-black uppercase tracking-widest text-[13px]">
                {r.label || r.key}
              </span>
            </div>
            <div className="flex-1 text-[12px] text-gray-400 leading-snug">
              {r.instructions}
            </div>
            {r.link ? (
              <a
                href={r.link}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shGreen/90 shrink-0 text-center"
                data-testid={`portal-pay-${r.key}-open`}
              >
                <i className="fas fa-external-link-alt mr-1.5"/>Open
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
