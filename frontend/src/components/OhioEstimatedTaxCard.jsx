// Step 4D-2C — Ohio + School-District Estimated Tax card (2026 engine).
// Mirrors the federal card's status contract. State and SDIT are shown
// SEPARATELY (the BID can zero state business tax while SDIT stays
// positive); combined liability drives the $500 threshold and safe
// harbor. Record buttons only document external payments (IT 1040ES /
// SD 100ES OUPC) — nothing is paid from here. Municipal tax is excluded.

import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { RecordPaymentModal } from "./EstimatedTaxPayments";
import { fmtDate } from "../lib/format";

const money = (n) => `${(Number(n) || 0) < 0 ? "-" : ""}$${Math.abs(Number(n) || 0).toFixed(2)}`;

export default function OhioEstimatedTaxCard({ year, onOpenProfile, onPaymentsChanged, refreshKey = null }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [payJur, setPayJur] = useState(null); // "ohio" | "ohio_school_district"

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/admin/ohio-estimated-tax?year=${year}`);
      setData(r.data); setErr("");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not load Ohio estimate");
    }
  }, [year, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (err && !data) return <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm" data-testid="oh-card-error">{err}</div>;
  if (!data) return <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-3 text-shTextMuted text-sm" data-testid="oh-card-loading">Loading Ohio estimate…</div>;

  const est = data.estimate;
  const inst = est?.installments;
  const sh = est?.safe_harbor;

  const chip = () => {
    if (data.status === "READY" && est.threshold.payment_required === false) return ["NO PAYMENT REQUIRED", "text-shGreen bg-shGreen/10"];
    if (data.status === "READY") return inst.remaining_next_payment > 0
      ? ["PAYMENT NEEDED", "text-amber-300 bg-amber-500/10"] : ["ON TRACK", "text-shGreen bg-shGreen/10"];
    if (data.status === "CPA_REVIEW_REQUIRED") return ["CPA REVIEW REQUIRED", "text-purple-300 bg-purple-500/10"];
    if (data.status === "ENGINE_UNAVAILABLE") return ["ENGINE UNAVAILABLE", "text-gray-400 bg-gray-500/10"];
    return ["PROFILE INCOMPLETE", "text-amber-300 bg-amber-500/10"];
  };
  const [chipText, chipCls] = chip();

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3" data-testid="ohio-estimated-tax-card">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-landmark mr-1" />Ohio Estimated Tax — {data.tax_year}</p>
        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${chipCls}`} data-testid="oh-status-chip">{chipText}</span>
      </div>

      {data.status === "PROFILE_INCOMPLETE" && (
        <div data-testid="oh-incomplete">
          <p className="text-[13px] text-shTextMuted">Ohio payment calculation unavailable — tax profile incomplete. No amount is shown until every material input is provided or confirmed zero (including school-district applicability).</p>
          <ul className="text-[12px] text-amber-300 list-disc ml-4 mt-1" data-testid="oh-missing-fields">
            {(data.missing_fields || []).slice(0, 8).map((m) => <li key={m}>{m}</li>)}
            {(data.missing_fields || []).length > 8 && <li>…and {(data.missing_fields || []).length - 8} more</li>}
          </ul>
          <button onClick={onOpenProfile} data-testid="oh-open-profile"
                  className="mt-2 text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline">
            <i className="fas fa-id-card mr-1" />Complete Tax Profile
          </button>
        </div>
      )}

      {data.status === "ENGINE_UNAVAILABLE" && (
        <p className="text-[13px] text-shTextMuted" data-testid="oh-engine-unavailable">{data.message}</p>
      )}

      {data.status === "CPA_REVIEW_REQUIRED" && (
        <div className="bg-purple-500/10 border border-purple-500/40 rounded-lg p-3" data-testid="oh-cpa-review">
          <p className="text-[12px] font-black uppercase tracking-widest text-purple-300 mb-1">CPA review recommended — no payment amount shown</p>
          <ul className="text-[12px] text-purple-200 list-disc ml-4">
            {data.cpa_review_reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      {data.status === "READY" && (
        <>
          <div className="grid grid-cols-3 gap-2 text-[12px]" data-testid="oh-liability-split">
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Projected Ohio state tax</p>
              <p className="text-shText font-black" data-testid="oh-state-tax">{money(est.state.state_tax)}</p>
            </div>
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Projected school-district tax</p>
              <p className="text-shText font-black" data-testid="oh-sd-tax">{money(est.school_district.tax)}</p>
            </div>
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Combined liability</p>
              <p className="text-shText font-black" data-testid="oh-combined">{money(est.combined_liability)}</p>
            </div>
          </div>

          {est.threshold.payment_required ? (
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <p className="text-3xl font-black text-shText" data-testid="oh-remaining-payment">{money(inst.remaining_next_payment)}</p>
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Remaining payment for {fmtDate(inst.next_deadline.due)}</p>
                <p className="text-[11px] text-shTextMuted" data-testid="oh-allocation">
                  Paid separately — Ohio state: <b>{money(inst.allocation_hint.ohio_state_share)}</b> · School district: <b>{money(inst.allocation_hint.school_district_share)}</b>
                </p>
                {inst.remaining_next_payment === 0 && inst.ahead_by > 0 && (
                  <p className="text-[12px] text-shGreen" data-testid="oh-ahead">Ahead of the current Ohio target by {money(inst.ahead_by)}</p>
                )}
                {inst.prior_installment_underpaid && (
                  <p className="text-[12px] text-amber-300 mt-1" data-testid="oh-underpaid-note">{inst.underpayment_note}</p>
                )}
              </div>
              <div className="text-right text-[12px] text-shTextMuted" data-testid="oh-target-breakdown">
                <p>Required through this installment: <b className="text-shText">{money(inst.required_through_next)}</b></p>
                <p>Ohio/SD withholding counted: <b className="text-shText">{money(inst.withholding_counted_through_next)}</b></p>
                <p>Overpayments + payments credited: <b className="text-shText">{money(inst.prior_year_overpayments_applied + inst.payments_recorded)}</b></p>
                {(data.future_dated_payments_total || 0) > 0 && (
                  <p className="text-amber-300" data-testid="oh-future-payments-note">
                    Future-dated payments not counted yet: <b>{money(data.future_dated_payments_total)}</b>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[14px] font-bold text-shGreen" data-testid="oh-no-payment">
              No Ohio estimated payment currently required under the general $500 threshold.
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[12px]" data-testid="oh-summary-tiles">
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Safe-harbor target</p>
              <p className="text-shText font-black" data-testid="oh-sh-target">
                {money(sh.selected_path === "prior_year" ? sh.prior_year_target : sh.current_year_target)}
              </p>
              <p className="text-shTextMuted text-[10px]" data-testid="oh-sh-path">
                {sh.selected_path === "prior_year" ? "100% of prior-year Ohio+SD tax" : "90% of current-year projection"}
              </p>
            </div>
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Next deadline</p>
              <p className="text-shText font-black" data-testid="oh-next-deadline">{fmtDate(inst.next_deadline.due)}</p>
            </div>
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Method</p>
              <p className="text-shText font-black">Regular (cumulative)</p>
            </div>
          </div>

          <p className="text-[11px] text-shTextMuted italic" data-testid="oh-annualized-note">{est.annualized_note}</p>
          <p className="text-[11px] text-shTextMuted italic" data-testid="oh-municipal-note">{data.municipal_note}</p>

          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setDetailsOpen((o) => !o)} data-testid="oh-details-toggle"
                    className="bg-[var(--sh-card-base)] border border-shBorder text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:border-shSecondary">
              <i className="fas fa-list mr-1" />{detailsOpen ? "Hide" : "View"} calculation
            </button>
            <button onClick={() => setPayJur("ohio")} data-testid="oh-record-payment"
                    className="bg-shPrimary text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest">
              <i className="fas fa-plus mr-1" />Record Ohio Payment
            </button>
            {est.school_district.applicable && (
              <button onClick={() => setPayJur("ohio_school_district")} data-testid="oh-record-sd-payment"
                      className="bg-shSecondary text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest">
                <i className="fas fa-plus mr-1" />Record School-District Payment
              </button>
            )}
          </div>

          {detailsOpen && <OhioDetails est={est} agi={data.federal_agi_starting_point} />}
        </>
      )}

      {payJur && (
        <RecordPaymentModal year={year} lockJurisdiction={payJur}
                            onClose={() => setPayJur(null)}
                            onSaved={() => { setPayJur(null); load(); onPaymentsChanged?.(); }} />
      )}
    </div>
  );
}

function Line({ label, value, bold }) {
  return (
    <p className={`flex justify-between ${bold ? "font-black text-shText" : "text-shTextMuted"}`}>
      <span>{label}</span><span>{money(value)}</span>
    </p>
  );
}

function OhioDetails({ est, agi }) {
  const s = est.state;
  const sd = est.school_district;
  const inst = est.installments;
  const sh = est.safe_harbor;
  return (
    <div className="border-t border-shBorder pt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px]" data-testid="oh-worksheet">
      <div className="space-y-0.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary mb-1">Ohio state calculation</p>
        <Line label="Federal AGI (starting point)" value={agi} />
        {s.ohio_adjustments !== 0 && <Line label="Ohio adjustments (owner-entered)" value={s.ohio_adjustments} />}
        <Line label="Ohio AGI" value={s.oagi} bold />
        <Line label="Ohio business income" value={s.business_income} />
        <Line label={`Business Income Deduction (max ${money(s.bid_cap)})`} value={-s.bid_used} />
        <Line label="Taxable business income" value={s.taxable_business_income} bold />
        <Line label="Business-income tax (3%)" value={s.business_tax} />
        <Line label={`Exemptions (${s.exemption_count} × ${money(s.per_exemption)})`} value={-s.exemptions_total} />
        <Line label="Taxable nonbusiness income" value={s.taxable_nonbusiness_income} bold />
        <Line label="Nonbusiness tax ($332 + 2.75% over $26,050)" value={s.nonbusiness_tax} />
        {s.exemption_credit > 0 && <Line label="$20 exemption credit" value={-s.exemption_credit} />}
        {s.other_ohio_credits > 0 && <Line label="Other Ohio credits (owner-entered)" value={-s.other_ohio_credits} />}
        <Line label="Projected Ohio state liability" value={s.state_tax} bold />
        <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary mt-2 mb-1">School district</p>
        {sd.applicable ? (
          <>
            <Line label={`Taxable base (${sd.base_type})`} value={sd.taxable_base} />
            <Line label={`SDIT @ ${sd.rate_pct}%`} value={sd.tax} bold />
            <p className="text-[10px] text-shTextMuted italic">{sd.note}</p>
          </>
        ) : (
          <p className="text-shTextMuted italic">{sd.note}</p>
        )}
      </div>
      <div className="space-y-0.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary mb-1">Combined estimated-tax calculation</p>
        <Line label="Combined Ohio + SD liability" value={est.combined_liability} bold />
        <Line label={`$500 threshold test (after withholding: ${money(est.threshold.after_withholding)})`} value={est.threshold.amount} />
        <Line label="90% current-year path" value={sh.current_year_target} />
        {sh.prior_year_target != null
          ? <Line label="100% prior-year path (no 110% rule in Ohio)" value={sh.prior_year_target} />
          : <p className="text-shTextMuted italic">Prior-year path unavailable (return did not cover 12 months)</p>}
        <Line label="Required through next installment (lesser schedule)" value={inst.required_through_next} bold />
        <Line label="Ohio + SD withholding counted (even allocation)" value={-inst.withholding_counted_through_next} />
        <Line label="Prior-year overpayments applied" value={-inst.prior_year_overpayments_applied} />
        <Line label="Ohio payments recorded" value={-inst.ohio_payments_recorded} />
        <Line label="School-district payments recorded" value={-inst.sd_payments_recorded} />
        <Line label="Remaining next payment" value={inst.remaining_next_payment ?? 0} bold />
        <p className="text-[10px] text-shTextMuted italic mt-1">Not calculated: {est.not_calculated.join(" · ")}</p>
      </div>
    </div>
  );
}
