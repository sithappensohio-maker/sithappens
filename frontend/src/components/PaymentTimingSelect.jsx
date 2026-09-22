/* When a customer is expected to pay — the admin control.
 *
 * Mirrors backend/domains/payment_timing.py. The two ENFORCED values are
 * listed but disabled, with the reason on screen, because hiding them would
 * leave an operator wondering whether the app can do it at all. The server
 * refuses them too (PUT /settings → 422): the UI is the explanation, not the
 * guard.
 *
 * Deliberately NOT merged with Settings → Payment Options. That answers "how
 * can I pay?" (Venmo, card, cash). This answers "when am I expected to pay?".
 * Same word, different question, different data.
 */

export const PAYMENT_TIMING_OPTIONS = [
  { value: "none_at_booking", label: "Nothing required when booking",
    hint: "Customer sees: nothing to pay to book." },
  { value: "at_dropoff", label: "Pay at drop-off / appointment",
    hint: "Customer sees: payment is taken when you drop your dog off." },
  { value: "at_pickup", label: "Pay at pickup",
    hint: "Customer sees: payment is taken when you collect your dog." },
  { value: "invoice_sent", label: "Invoice sent separately",
    hint: "Customer sees: we'll send you an invoice for this separately." },
];

export const PAYMENT_TIMING_UNSUPPORTED = [
  { value: "pay_online", label: "Pay online now" },
  { value: "deposit", label: "Deposit required" },
];

export const UNSUPPORTED_REASON =
  "Booking doesn't collect payment yet, so the site can't tell customers to pay " +
  "up front. Available once online payment at booking is built.";

export default function PaymentTimingSelect({
  value, onChange, inheritedValue, allowInherit = false, disabled = false, testId,
}) {
  const inheritedLabel = PAYMENT_TIMING_OPTIONS.find(o => o.value === inheritedValue)?.label;
  const current = value ?? (allowInherit ? "" : "none_at_booking");
  const shown = PAYMENT_TIMING_OPTIONS.find(o => o.value === (value || inheritedValue));

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3">
      <p className="text-[10px] text-shTextMuted font-black uppercase tracking-widest">
        When payment is expected
      </p>
      <select
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        data-testid={testId}
        className="w-full mt-1 min-h-[40px] bg-[var(--sh-card-base)] border border-shBorder rounded px-2 text-[13px] text-shText"
      >
        {allowInherit && (
          <option value="">{inheritedLabel ? `Use category default (${inheritedLabel})` : "Use category default"}</option>
        )}
        {PAYMENT_TIMING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {PAYMENT_TIMING_UNSUPPORTED.map(o => (
          <option key={o.value} value={o.value} disabled>{o.label} — not available yet</option>
        ))}
      </select>
      {shown && <p className="text-[10px] text-shTextMuted mt-1 leading-snug">{shown.hint}</p>}
      <p className="text-[10px] text-shTextMuted/80 mt-1 leading-snug" data-testid={testId ? `${testId}-note` : undefined}>
        {UNSUPPORTED_REASON}
      </p>
    </div>
  );
}
