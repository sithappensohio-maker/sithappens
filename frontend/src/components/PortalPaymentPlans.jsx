import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { sanitizeHtml } from "../lib/sanitizeHtml";
import NeonEdge from "./premium/NeonEdge";
import PremiumButton from "./premium/PremiumButton";
import { accentRgb } from "./premium/tokens";

const fmt = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_META = {
  pending_signature: { label: "Awaiting signature", color: "#f59e0b", icon: "fa-pen-clip" },
  active: { label: "Active", color: "#8cc63f", icon: "fa-play" },
  completed: { label: "Paid in full", color: "#00a9e0", icon: "fa-check-circle" },
  cancelled: { label: "Cancelled", color: "#64748b", icon: "fa-ban" },
};

/**
 * Sprint 110ch — Client portal section showing payment plans the client owns.
 * Renders nothing when the client has no plans (keeps the portal clean).
 * Each plan shows status, total paid / remaining, installment grid, and (when
 * the plan is pending_signature) a "Review & Sign" CTA.
 */
export default function PortalPaymentPlans() {
  const [plans, setPlans] = useState(null);
  const [signingPlan, setSigningPlan] = useState(null);

  const load = () => {
    api.get("/portal/payment-plans")
      .then(r => setPlans(r.data || []))
      .catch(() => setPlans([]));
  };
  useEffect(() => { load(); }, []);

  if (plans === null) return null;
  if (plans.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="portal-payment-plans">
      <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">
        <i className="fas fa-file-signature mr-1.5"/>Payment Plans
      </p>
      {plans.map(p => <PlanCard key={p.id} plan={p} onSign={() => setSigningPlan(p)} />)}
      {signingPlan && (
        <SignAgreementModal
          plan={signingPlan}
          onClose={() => setSigningPlan(null)}
          onSigned={() => { setSigningPlan(null); load(); }}
        />
      )}
    </div>
  );
}

function PlanCard({ plan, onSign }) {
  const sm = STATUS_META[plan.status] || STATUS_META.active;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <NeonEdge accentRgb={accentRgb("purple")} intensity="standard" className="p-4"
         data-testid={`plan-card-${plan.id}`}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-shText truncate" title={plan.program_name}>{plan.program_name}</p>
          <p className="text-[12px] text-shTextMuted">
            {fmt(plan.paid_total)} of {fmt(plan.total_amount)} paid
            {plan.overdue_count > 0 && (
              <span className="ml-2 text-shDanger font-black uppercase tracking-widest text-[11px]">
                · {plan.overdue_count} overdue
              </span>
            )}
          </p>
        </div>
        <span className="text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded-full shrink-0"
              style={{ color: sm.color, background: sm.color + "15", border: `1px solid ${sm.color}40` }}>
          <i className={`fas ${sm.icon} mr-1`}/>{sm.label}
        </span>
      </div>
      {plan.status === "pending_signature" && (
        <p className="text-[12px] text-shAccent mb-2" data-testid={`plan-pending-note-${plan.id}`}>
          <i className="fas fa-circle-info mr-1"/>Review and sign your agreement to continue.
        </p>
      )}

      {/* Progress bar */}
      <div className="h-2 rounded-full overflow-hidden border border-shBorder mb-3" style={{ background: "var(--sh-card-base)" }}>
        <div className="h-full transition-all"
             style={{
               width: `${Math.min(100, (plan.paid_total / Math.max(1, plan.total_amount)) * 100)}%`,
               background: sm.color,
             }} />
      </div>

      {/* Installment list */}
      <div className="space-y-1.5">
        {plan.installments.map(i => {
          const overdue = i.status === "due" && i.due_date < today;
          return (
            <div key={i.id}
                 data-testid={`plan-inst-${i.id}`}
                 className={`flex items-center justify-between text-[13px] py-1 px-2 rounded ${i.status === "paid" ? "bg-shPrimary/10" : overdue ? "bg-shDanger/10" : ""}`}
                 style={i.status !== "paid" && !overdue ? { background: "var(--sh-card-base)" } : undefined}>
              <span className={i.status === "paid" ? "text-shTextMuted line-through" : "text-shText"}>
                {i.due_date}
              </span>
              <span className="flex items-center gap-2">
                <span className={`font-black ${i.status === "paid" ? "text-shTextMuted" : overdue ? "text-shDanger" : "text-shText"}`}>
                  {fmt(i.amount)}
                </span>
                {i.status === "paid" && <i className="fas fa-check-circle text-shPrimary text-xs"/>}
                {overdue && <span className="text-[10px] font-black uppercase tracking-widest text-shDanger">overdue</span>}
              </span>
            </div>
          );
        })}
      </div>

      {plan.status === "pending_signature" && (
        <PremiumButton variant="primary" onClick={onSign} data-testid={`plan-sign-btn-${plan.id}`} className="mt-3 w-full justify-center py-2.5">
          <i className="fas fa-pen-clip"/>Review & Sign Agreement
        </PremiumButton>
      )}
    </NeonEdge>
  );
}

function SignAgreementModal({ plan, onClose, onSigned }) {
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);

  const sign = async () => {
    if (!agreed) { setError("Please confirm you agree to the terms above."); return; }
    if (typedName.trim().length < 2) { setError("Please type your full name."); return; }
    setBusy(true);
    setError("");
    try {
      await api.post(`/portal/payment-plans/${plan.id}/sign`, {
        typed_name: typedName.trim(),
      });
      onSigned?.();
    } catch (e) {
      setError(formatErr(e.response?.data?.detail) || "Sign failed");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="border border-shBorder rounded-xl w-full max-w-2xl max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto shadow-sh"
           style={{ background: "var(--sh-card-base)" }}
           onClick={e => e.stopPropagation()}
           data-testid={`sign-modal-${plan.id}`}>
        <div className="sticky top-0 border-b border-shBorder px-6 py-4 flex items-baseline justify-between z-10" style={{ background: "var(--sh-card-base)" }}>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shPrimary mb-0.5">
              <i className="fas fa-file-signature mr-1.5"/>Payment agreement
            </p>
            <h2 className="text-xl font-bold text-shText">{plan.program_name}</h2>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText text-2xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">
          {/* Render the agreement HTML the admin set up */}
          <div className="bg-white rounded-lg p-5 prose prose-sm max-w-none text-gray-900 mb-5"
               data-testid="agreement-body"
               dangerouslySetInnerHTML={{ __html: sanitizeHtml(plan.agreement_snapshot || "") }} />

          <label className="flex items-start gap-2 mb-4 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                   data-testid="agree-checkbox"
                   className="w-4 h-4 accent-shPrimary mt-1 shrink-0" />
            <span className="text-sm text-shTextMuted">
              I have read and agree to the terms above. I understand my typed name below will serve as my legal electronic signature.
            </span>
          </label>

          <label className="block mb-3">
            <span className="text-[11px] font-black uppercase tracking-[0.3em] text-shTextMuted mb-1 block">
              Type your full legal name
            </span>
            <input value={typedName} onChange={e => setTypedName(e.target.value)}
                   data-testid="typed-name-input"
                   placeholder="e.g. Alex Rivera"
                   style={{ background: "var(--sh-card-base)" }}
                   className="w-full border border-shBorder rounded px-3 py-2.5 text-shText text-base font-serif italic focus:outline-none focus:border-shPrimary/60" />
          </label>

          {error && (
            <p className="text-shDanger text-[12px] font-black uppercase tracking-widest mb-3"
               data-testid="sign-error">
              <i className="fas fa-circle-exclamation mr-1"/>{error}
            </p>
          )}

          <div className="flex gap-2 pt-2 border-t border-shBorder">
            <PremiumButton variant="ghost" onClick={onClose} data-testid="sign-cancel" className="flex-1 justify-center py-2.5">
              Not yet
            </PremiumButton>
            <PremiumButton variant="primary" onClick={sign} disabled={busy || !agreed || typedName.trim().length < 2}
                    data-testid="sign-submit" className="flex-1 justify-center py-2.5">
              {busy ? "Signing…" : "Sign & Activate Plan"}
            </PremiumButton>
          </div>
        </div>
      </div>
    </div>
  );
}
