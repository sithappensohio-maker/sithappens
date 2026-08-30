import { useEffect, useState } from "react";
import { api } from "../lib/api";

/* Client-facing daycare/boarding policy block.

   Renders the policy lines from GET /policies/stay, which the backend
   GENERATES from the same booking_rules + catalog prices the pricing engine
   charges with — so what the client reads here can never drift from what
   checkout bills. When `pickupTime` is provided for boarding and the picked
   time is past the checkout time (+ grace), a live warning shows the exact
   per-dog charge BEFORE the client confirms the booking. */

const to12h = (hhmm) => {
  if (!/^\d{2}:\d{2}/.test(hhmm || "")) return hhmm || "";
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}:${m} ${suffix}`;
};
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export default function StayPolicyNote({ serviceType, pickupTime = "", compact = false, testid = "stay-policy-note" }) {
  const [policy, setPolicy] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get("/policies/stay")
      .then(r => { if (!cancelled) setPolicy(r.data || null); })
      .catch(() => { if (!cancelled) setPolicy(null); });
    return () => { cancelled = true; };
  }, []);

  if (!policy || !["daycare", "boarding"].includes(serviceType)) return null;
  const block = policy[serviceType];
  if (!block?.lines?.length) return null;

  // Live late-pickup warning for the boarding wizard.
  let lateWarning = null;
  if (serviceType === "boarding" && /^\d{2}:\d{2}/.test(pickupTime || "")) {
    const b = policy.boarding || {};
    const cutoff = /^\d{2}:\d{2}/.test(b.checkout_time || "") ? b.checkout_time : "17:00";
    const grace = Math.max(0, Number(b.grace_minutes) || 0);
    if (b.late_pickup_mode !== "none" && toMin(pickupTime) > toMin(cutoff) + grace) {
      const amount = b.late_pickup_mode === "flat_fee"
        ? Number(b.late_pickup_flat_fee || 0)
        : Number(b.daycare_day_price || 0) * (b.late_pickup_mode === "half_daycare_day" ? 0.5 : 1);
      if (amount > 0) {
        lateWarning = `A ${to12h(pickupTime)} pickup is after the ${to12h(cutoff)} checkout time — this adds $${amount.toFixed(2)} per dog.`;
      }
    }
  }

  return (
    <div className={`rounded-lg border border-shBorder bg-[var(--sh-card-base)]/60 ${compact ? "p-3" : "p-4"}`} data-testid={testid}>
      <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">
        <i className="fas fa-circle-info mr-1.5 text-shSecondary" />
        {serviceType === "boarding" ? "Boarding pickup & pricing policy" : "Daycare pricing policy"}
      </p>
      <ul className={`space-y-1 ${compact ? "text-[12px]" : "text-[13px]"} text-shTextMuted leading-relaxed`}>
        {block.lines.map((line, i) => (
          <li key={i} data-testid={`${testid}-line-${i}`}>
            <i className="fas fa-paw text-[9px] mr-1.5 opacity-50" />{line}
          </li>
        ))}
      </ul>
      {lateWarning && (
        <p className="mt-2 text-[13px] font-bold text-shOrange bg-shOrange/10 border border-shOrange/40 rounded px-3 py-2" data-testid={`${testid}-late-warning`}>
          <i className="fas fa-clock mr-1.5" />{lateWarning}
        </p>
      )}
    </div>
  );
}
