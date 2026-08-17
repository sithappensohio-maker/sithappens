// Step 4D-2B — Federal Estimated Tax card (2026 engine).
//
// Renders GET /admin/federal-estimated-tax by backend-authoritative status:
//   PROFILE_INCOMPLETE   → missing-field list, NO dollar amounts
//   CPA_REVIEW_REQUIRED  → reasons; business projection only, no payment rec
//   READY                → safe-harbor target vs projected tax (kept apart),
//                          credited breakdown, prominent remaining payment
//   ENGINE_UNAVAILABLE   → constants missing for the year
// "Record Federal Payment" only documents an external payment (EFTPS etc.) —
// nothing is ever sent to the IRS from here.

import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { RecordPaymentModal } from "./EstimatedTaxPayments";
import { fmtDate } from "../lib/format";

const money = (n) => `${(Number(n) || 0) < 0 ? "-" : ""}$${Math.abs(Number(n) || 0).toFixed(2)}`;

export default function FederalEstimatedTaxCard({ year, onOpenProfile, onPaymentsChanged, refreshKey = null }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/admin/federal-estimated-tax?year=${year}`);
      setData(r.data); setErr("");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not load federal estimate");
    }
    // refreshKey re-runs the load whenever the tax profile changes upstream.
  }, [year, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (err && !data) return <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm" data-testid="fed-card-error">{err}</div>;
  if (!data) return <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-3 text-shTextMuted text-sm" data-testid="fed-card-loading">Loading federal estimate…</div>;

  const bp = data.business_projection;
  const est = data.estimate;
  const inst = est?.installments;
  const sh = est?.safe_harbor;

  const statusChip = () => {
    if (data.status === "READY" && est.payment_required === false) {
      return ["NO PAYMENT REQUIRED", "text-shGreen bg-shGreen/10"];
    }
    if (data.status === "READY") {
      return inst.remaining_next_payment > 0
        ? ["PAYMENT NEEDED", "text-amber-300 bg-amber-500/10"]
        : ["ON TRACK", "text-shGreen bg-shGreen/10"];
    }
    if (data.status === "CPA_REVIEW_REQUIRED") return ["CPA REVIEW REQUIRED", "text-purple-300 bg-purple-500/10"];
    if (data.status === "ENGINE_UNAVAILABLE") return ["ENGINE UNAVAILABLE", "text-gray-400 bg-gray-500/10"];
    return ["PROFILE INCOMPLETE", "text-amber-300 bg-amber-500/10"];
  };
  const [chipText, chipCls] = statusChip();

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3" data-testid="federal-estimated-tax-card">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-flag-usa mr-1" />Federal Estimated Tax — {data.tax_year}</p>
        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${chipCls}`} data-testid="fed-status-chip">{chipText}</span>
      </div>

      {/* Business projection — always safe to show */}
      <div className="text-[12px] text-shTextMuted" data-testid="fed-business-projection">
        Sit Happens profit: <b className="text-shText">{money(bp.actual_ytd_business_profit)}</b> YTD
        {bp.projected_remaining_business_profit != null ? (
          <> + <b className="text-shText">{money(bp.projected_remaining_business_profit)}</b> expected remaining
            = <b className="text-shPrimary">{money(bp.projected_annual_business_profit)}</b> projected {data.tax_year}</>
        ) : (
          <span className="text-amber-300"> · remaining-year expectation not confirmed</span>
        )}
      </div>

      {data.status === "PROFILE_INCOMPLETE" && (
        <div data-testid="fed-incomplete">
          <p className="text-[13px] text-shTextMuted">
            Federal payment calculation unavailable — tax profile incomplete. No amount is shown
            until every material input is provided or confirmed zero.
          </p>
          <ul className="text-[12px] text-amber-300 list-disc ml-4 mt-1" data-testid="fed-missing-fields">
            {(data.missing_fields || []).slice(0, 8).map((m) => <li key={m}>{m}</li>)}
            {(data.missing_fields || []).length > 8 && <li>…and {(data.missing_fields || []).length - 8} more</li>}
          </ul>
          <button onClick={onOpenProfile} data-testid="fed-open-profile"
                  className="mt-2 text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline">
            <i className="fas fa-id-card mr-1" />Complete Tax Profile
          </button>
        </div>
      )}

      {data.status === "ENGINE_UNAVAILABLE" && (
        <p className="text-[13px] text-shTextMuted" data-testid="fed-engine-unavailable">{data.message}</p>
      )}

      {data.status === "CPA_REVIEW_REQUIRED" && (
        <div className="bg-purple-500/10 border border-purple-500/40 rounded-lg p-3" data-testid="fed-cpa-review">
          <p className="text-[12px] font-black uppercase tracking-widest text-purple-300 mb-1">CPA review recommended — no payment amount shown</p>
          <ul className="text-[12px] text-purple-200 list-disc ml-4">
            {data.cpa_review_reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      {data.status === "READY" && (
        <>
          {est.payment_required ? (
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <p className="text-3xl font-black text-shText" data-testid="fed-remaining-payment">{money(inst.remaining_next_payment)}</p>
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Remaining payment for {fmtDate(inst.next_deadline.due)}</p>
                {inst.remaining_next_payment === 0 && inst.ahead_by > 0 && (
                  <p className="text-[12px] text-shGreen" data-testid="fed-ahead">Ahead of the current safe-harbor target by {money(inst.ahead_by)}</p>
                )}
                {inst.prior_installment_underpaid && (
                  <p className="text-[12px] text-amber-300 mt-1" data-testid="fed-underpaid-note">
                    Includes catch-up toward the current required cumulative payment. {inst.underpayment_note}
                  </p>
                )}
              </div>
              <div className="text-right text-[12px] text-shTextMuted" data-testid="fed-target-breakdown">
                <p>Safe-harbor target through this installment: <b className="text-shText">{money(inst.required_through_next)}</b></p>
                <p>Withholding counted (full-year, even): <b className="text-shText">{money(inst.withholding_counted)}</b></p>
                <p>Prior-year credit + federal payments: <b className="text-shText">{money(inst.credited_total)}</b></p>
                {(data.future_dated_payments_total || 0) > 0 && (
                  <p className="text-amber-300" data-testid="fed-future-payments-note">
                    Future-dated payments not counted yet: <b>{money(data.future_dated_payments_total)}</b>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[14px] font-bold text-shGreen" data-testid="fed-no-payment">
              {est.no_payment_reason?.includes("1,000")
                ? "No federal estimated payment currently required under the general $1,000 test."
                : "No federal estimated payment currently required — withholding is expected to cover the safe-harbor target."}
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]" data-testid="fed-summary-tiles">
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Projected {data.tax_year} federal tax</p>
              <p className="text-shText font-black" data-testid="fed-projected-tax">{money(est.projected_total_tax)}</p>
            </div>
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Safe-harbor annual target</p>
              <p className="text-shText font-black" data-testid="fed-rap">{money(sh.required_annual_payment)}</p>
              <p className="text-shTextMuted text-[10px]" data-testid="fed-sh-path">
                {sh.selected_path === "prior_year"
                  ? (sh.high_income_110_applied ? "110% of prior-year tax" : "100% of prior-year tax")
                  : "90% of current-year projection"}
              </p>
            </div>
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Next deadline</p>
              <p className="text-shText font-black" data-testid="fed-next-deadline">{fmtDate(inst.next_deadline.due)}</p>
              <p className="text-shTextMuted text-[10px]">{inst.next_deadline.period}</p>
            </div>
            <div className="border border-shBorder rounded p-2">
              <p className="text-shTextMuted uppercase font-black text-[10px]">Method</p>
              <p className="text-shText font-black">Regular installment</p>
            </div>
          </div>

          <p className="text-[11px] text-shTextMuted italic" data-testid="fed-seasonal-note">{est.seasonal_note}</p>

          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setDetailsOpen((o) => !o)} data-testid="fed-details-toggle"
                    className="bg-[var(--sh-card-base)] border border-shBorder text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:border-shSecondary">
              <i className="fas fa-list mr-1" />{detailsOpen ? "Hide" : "View"} calculation
            </button>
            <button onClick={() => setPayOpen(true)} data-testid="fed-record-payment"
                    className="bg-shPrimary text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest">
              <i className="fas fa-plus mr-1" />Record Federal Payment
            </button>
          </div>

          {detailsOpen && <WorksheetDetails est={est} year={data.tax_year} />}
        </>
      )}

      {payOpen && (
        <RecordPaymentModal year={year} lockJurisdiction="federal"
                            onClose={() => setPayOpen(false)}
                            onSaved={() => { setPayOpen(false); load(); onPaymentsChanged?.(); }} />
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

function WorksheetDetails({ est, year }) {
  const w = est.worksheet;
  const sh = est.safe_harbor;
  const inst = est.installments;
  return (
    <div className="border-t border-shBorder pt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px]" data-testid="fed-worksheet">
      <div className="space-y-0.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary mb-1">Projected {year} federal tax (1040-ES worksheet)</p>
        <Line label="Business profit (projected annual)" value={w.income_components.business_profit} />
        {w.income_components.other_se_income !== 0 && <Line label="Other SE income" value={w.income_components.other_se_income} />}
        {(w.income_components.w2_wages !== 0 || w.income_components.spouse_wages !== 0) && (
          <Line label="W-2 / spouse wages" value={w.income_components.w2_wages + w.income_components.spouse_wages} />)}
        {w.income_components.other_taxable_income !== 0 && <Line label="Other taxable income" value={w.income_components.other_taxable_income} />}
        <Line label="Adjustments (incl. ½ SE tax)" value={-w.adjustments.total} />
        <Line label="Projected AGI (line 1)" value={w.line_1_agi} bold />
        {w.nonitemizer_charitable?.applicable ? (
          <>
            <Line label="Standard deduction" value={-(w.nonitemizer_charitable.standard_deduction ?? w.line_2a_deduction)} />
            <Line label={`Non-itemizer charitable deduction (cap $${(w.nonitemizer_charitable.statutory_cap ?? 0).toFixed(0)})`}
                  value={-(w.nonitemizer_charitable.allowed ?? 0)} />
          </>
        ) : (
          <Line label={w.deduction_source} value={-w.line_2a_deduction} />
        )}
        <Line label="QBI deduction (line 2b)" value={-w.line_2b_qbi.deduction} />
        <Line label="Schedule 1-A additional deductions (line 2c)" value={-(w.line_2c_schedule_1a ?? 0)} />
        <Line label="Taxable income (line 3)" value={w.line_3_taxable_income} bold />
        <Line label="Income tax (2026 rate schedules)" value={w.line_4_income_tax} />
        {w.line_7_credits !== 0 && <Line label="Credits (owner-entered)" value={-w.line_7_credits} />}
        <Line label="Self-employment tax" value={w.line_9_se_tax.total} />
        {w.line_10_other_taxes.total !== 0 && <Line label="Other taxes (incl. Additional Medicare)" value={w.line_10_other_taxes.total} />}
        {w.line_11_refundable_credits !== 0 && <Line label="Refundable credits" value={-w.line_11_refundable_credits} />}
        <Line label="Projected total federal tax (11c)" value={est.projected_total_tax} bold />
        <p className="text-[10px] text-shTextMuted italic mt-1">Not calculated: {est.not_calculated.join(" · ")}</p>
      </div>
      <div className="space-y-0.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary mb-1">Safe harbor / prepayment target</p>
        <Line label="90% of current-year projection (12a)" value={sh.current_year_target} />
        {sh.prior_year_target != null
          ? <Line label={sh.high_income_110_applied ? "110% of prior-year tax (12b)" : "100% of prior-year tax (12b)"} value={sh.prior_year_target} />
          : <p className="text-shTextMuted italic">Prior-year path unavailable (return did not cover 12 months)</p>}
        <Line label="Required annual payment (12c — smaller)" value={sh.required_annual_payment} bold />
        <Line label="Expected federal withholding (13)" value={-inst.withholding_counted} />
        <Line label="Prior-year overpayment applied" value={-inst.prior_year_overpayment_applied} />
        <Line label="Federal estimated payments recorded" value={-inst.federal_payments_recorded} />
        <Line label="Required through next installment" value={inst.required_through_next} bold />
        <Line label="Remaining next payment" value={inst.remaining_next_payment ?? 0} bold />
        <p className="text-[10px] text-shTextMuted italic mt-1">
          The safe-harbor target is a prepayment floor — it is not the projected final tax.
        </p>
      </div>
    </div>
  );
}
