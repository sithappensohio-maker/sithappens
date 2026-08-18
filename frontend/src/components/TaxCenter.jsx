// Step 4D-3 — Owner Tax Center: ONE dashboard over FOUR separate
// obligations (Federal / Ohio / School District / Ohio Sales Tax).
// Every status and dollar comes from GET /admin/tax-center, which reuses
// the authoritative engines — this component never computes tax, never
// merges ledgers, and never shows a combined "total taxes owed".
// The legacy planning reserve is a budgeting tool and appears here only
// as an explanatory note under Planning Tools.

import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { fmtDate } from "../lib/format";
import FederalEstimatedTaxCard from "./FederalEstimatedTaxCard";
import OhioEstimatedTaxCard from "./OhioEstimatedTaxCard";
import EstimatedTaxPayments, { RecordPaymentModal } from "./EstimatedTaxPayments";
import TaxProfilePanel from "./TaxProfilePanel";
import { FINANCE_TARGET_KEY } from "./SalesTaxDueTile";

const money = (n) => `${(Number(n) || 0) < 0 ? "-" : ""}$${Math.abs(Number(n) || 0).toFixed(2)}`;

// Status → tone. Presentation only — the STATUS ITSELF is backend-derived;
// React never reverse-engineers financial state from dollar values.
const TONES = {
  OVERDUE: "bg-red-500/10 text-red-400 border-red-500/40",
  PAYMENT_NEEDED: "bg-amber-500/10 text-amber-300 border-amber-500/40",
  FILING_REQUIRED: "bg-amber-500/10 text-amber-300 border-amber-500/40",
  NEEDS_REVIEW: "bg-purple-500/10 text-purple-300 border-purple-500/40",
  CPA_REVIEW_REQUIRED: "bg-purple-500/10 text-purple-300 border-purple-500/40",
  PROFILE_INCOMPLETE: "bg-amber-500/10 text-amber-300 border-amber-500/40",
  ENGINE_UNAVAILABLE: "bg-gray-500/10 text-gray-400 border-gray-500/40",
  UPCOMING: "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder",
  ON_TRACK: "bg-shGreen/10 text-shGreen border-shGreen/40",
  NO_PAYMENT_REQUIRED: "bg-shGreen/10 text-shGreen border-shGreen/40",
  FILED: "bg-shGreen/10 text-shGreen border-shGreen/40",
  PAID: "bg-shGreen/10 text-shGreen border-shGreen/40",
  NOT_APPLICABLE: "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder",
};

const JUR_ICONS = { federal: "fa-flag-usa", ohio: "fa-landmark", ohio_school_district: "fa-school", sales_tax: "fa-receipt" };

export function StatusChip({ status, label, testid }) {
  return (
    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${TONES[status] || TONES.UPCOMING}`}
          data-testid={testid}>{label || status}</span>
  );
}

export default function TaxCenterTab({ onOpenSalesTax }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [payVersion, setPayVersion] = useState(0);
  const [profileVersion, setProfileVersion] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [payJur, setPayJur] = useState(null);

  const bumpPayments = () => setPayVersion((v) => v + 1);
  const refreshKey = `${profileVersion}:${payVersion}`;

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/admin/tax-center?year=${year}`);
      setData(r.data); setErr("");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not load Tax Center");
    }
  }, [year, payVersion, profileVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (err && !data) return <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm" data-testid="taxcenter-error">{err}</div>;
  if (!data) return <div className="text-shTextMuted text-sm p-4" data-testid="taxcenter-loading">Loading Tax Center…</div>;

  const na = data.next_action;
  const attention = data.attention || [];
  const salesEntries = (data.obligations || []).filter((e) => e.jurisdiction === "sales_tax");
  const pr = data.profile_readiness || {};

  const actionButton = (e) => {
    const a = e.action || {};
    if (a.type === "record_payment") {
      return (
        <button onClick={() => setPayJur(a.lock_jurisdiction)} data-testid={`taxcenter-record-${e.key}`}
                className="bg-shPrimary text-bgHeader px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">
          <i className="fas fa-plus mr-1" />Record payment
        </button>
      );
    }
    if (a.type === "open_profile") {
      return (
        <button onClick={() => setProfileOpen(true)} data-testid={`taxcenter-profile-${e.key}`}
                className="bg-shSecondary/20 border border-shSecondary/40 text-shSecondary px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">
          <i className="fas fa-id-card mr-1" />Tax Profile
        </button>
      );
    }
    if (a.type === "open_sales_tax") {
      return (
        <button onClick={() => onOpenSalesTax?.()} data-testid={`taxcenter-sales-${e.key}`}
                className="bg-orange-500/20 border border-orange-500/40 text-orange-300 px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">
          <i className="fas fa-receipt mr-1" />Record Filing / Payment
        </button>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4" data-testid="taxcenter-root">
      {/* ── 1 · Next Tax Action ─────────────────────────────────────────── */}
      <div className={`rounded-xl border p-4 ${na.none ? "border-shGreen/40 bg-shGreen/5" : "border-shAccent/40 bg-shAccent/5"}`}
           data-testid="taxcenter-next-action">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shSecondary mb-1"><i className="fas fa-bullseye mr-2" />Next Tax Action</p>
        <p className={`text-lg font-black ${na.none ? "text-shGreen" : "text-shText"}`} data-testid="taxcenter-next-headline">{na.headline}</p>
        {na.sub && <p className="text-[12px] text-shTextMuted mt-0.5">{na.sub}</p>}
      </div>

      {/* ── 2 · Taxes Needing Attention (separate obligations, no total) ── */}
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4" data-testid="taxcenter-attention">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shSecondary mb-2"><i className="fas fa-triangle-exclamation mr-2" />Taxes Needing Attention</p>
        {attention.length === 0 ? (
          <p className="text-[13px] text-shGreen font-bold" data-testid="taxcenter-attention-empty">Nothing needs attention right now.</p>
        ) : attention.map((e) => (
          <div key={e.key} className="border-t border-shBorder/40 py-2 flex items-center gap-3 flex-wrap" data-testid={`taxcenter-attention-row-${e.key}`}>
            <div className="flex-1 min-w-[180px]">
              <p className="text-[13px] font-black text-shText"><i className={`fas ${JUR_ICONS[e.jurisdiction]} mr-2 text-shSecondary`} />{e.label}</p>
              <p className="text-[11px] text-shTextMuted">{e.period_label}{e.due_date ? ` · due ${fmtDate(e.due_date)}` : ""}</p>
              {e.note && <p className="text-[11px] text-shTextMuted italic">{e.note}</p>}
              {e.catch_up && <p className="text-[11px] text-amber-300">Includes catch-up toward an earlier installment.</p>}
              {(e.future_dated_total || 0) > 0 && (
                <p className="text-[11px] text-amber-300" data-testid={`taxcenter-future-${e.key}`}>
                  Future-dated payments not counted yet: <b>{money(e.future_dated_total)}</b>
                </p>
              )}
            </div>
            <div className="text-right">
              {e.remaining_amount != null && (
                <p className="text-[15px] font-black text-shText" data-testid={`taxcenter-amount-${e.key}`}>{money(e.remaining_amount)}</p>
              )}
              <StatusChip status={e.status} label={e.status_label} testid={`taxcenter-status-${e.key}`} />
            </div>
            {actionButton(e)}
          </div>
        ))}
        <p className="text-[11px] text-shTextMuted italic mt-2" data-testid="taxcenter-recording-note">{data.notes?.recording}</p>
      </div>

      <p className="text-[11px] text-shTextMuted" data-testid="taxcenter-explainer"><i className="fas fa-circle-info mr-1 text-shSecondary" />{data.notes?.explainer}</p>

      {/* ── 3 · Individual obligation cards (authoritative detail) ───────── */}
      <div className="grid grid-cols-1 gap-3" data-testid="taxcenter-cards">
        <FederalEstimatedTaxCard year={year} onOpenProfile={() => setProfileOpen(true)}
                                 onPaymentsChanged={bumpPayments} refreshKey={refreshKey} />
        <OhioEstimatedTaxCard year={year} onOpenProfile={() => setProfileOpen(true)}
                              onPaymentsChanged={bumpPayments} refreshKey={refreshKey} />
        {/* Sales tax stays its own regime — summary here, full 4C tracker on its tab. */}
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4" data-testid="taxcenter-sales-card">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-receipt mr-1" />Ohio Sales Tax</p>
            <button onClick={() => onOpenSalesTax?.()} data-testid="taxcenter-open-sales"
                    className="bg-orange-500/20 border border-orange-500/40 text-orange-300 px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">
              Open Sales Tax tracker
            </button>
          </div>
          {salesEntries.length === 0 ? (
            <p className="text-[12px] text-shTextMuted mt-2">No tracked filing periods.</p>
          ) : salesEntries.map((e) => (
            <div key={e.key} className="flex items-center justify-between gap-2 border-t border-shBorder/40 py-1.5 flex-wrap" data-testid={`taxcenter-sales-row-${e.key}`}>
              <p className="text-[12px] text-shText">{e.period_label}{e.due_date ? <span className="text-shTextMuted"> · due {fmtDate(e.due_date)}</span> : null}</p>
              <div className="flex items-center gap-2">
                {e.remaining_amount != null && <b className="text-[12px] text-shText">{money(e.remaining_amount)}</b>}
                {e.informational?.accrued_liability != null && (
                  <span className="text-[11px] text-shTextMuted">accrued {money(e.informational.accrued_liability)}</span>
                )}
                <StatusChip status={e.status} label={e.status_label} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4 · Upcoming tax dates (authoritative deadline builders) ─────── */}
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4" data-testid="taxcenter-upcoming">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shSecondary mb-2"><i className="fas fa-calendar-days mr-2" />Upcoming Tax Dates</p>
        {(data.upcoming_dates || []).length === 0 ? (
          <p className="text-[12px] text-shTextMuted">No upcoming deadlines in the tracked horizon.</p>
        ) : (data.upcoming_dates || []).map((u, i) => (
          <p key={`${u.date}-${u.jurisdiction}-${i}`} className="text-[12px] text-shTextMuted border-t border-shBorder/40 py-1">
            <b className="text-shText mr-2">{fmtDate(u.date)}</b>
            <i className={`fas ${JUR_ICONS[u.jurisdiction]} mr-1 text-shSecondary`} />{u.label}
          </p>
        ))}
        <p className="text-[11px] text-shTextMuted italic mt-1" data-testid="taxcenter-municipal">{data.notes?.municipal}</p>
      </div>

      {/* ── 5 · Payment history: unified NAVIGATION, separate ledgers ────── */}
      <div data-testid="taxcenter-history">
        <EstimatedTaxPayments year={year} refreshKey={refreshKey} onChanged={bumpPayments} />
        <button onClick={() => onOpenSalesTax?.()} data-testid="taxcenter-sales-history"
                className="mt-2 text-[11px] font-black uppercase tracking-widest text-orange-300 hover:underline">
          <i className="fas fa-receipt mr-1" />Sales-tax filings &amp; payments → Sales Tax tab
        </button>
      </div>

      {/* ── 6 · Tax Profile readiness + Planning Tools + year ────────────── */}
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-2" data-testid="taxcenter-profile-summary">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shSecondary"><i className="fas fa-id-card mr-2" />Tax Profile</p>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">
              Tax year
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="taxcenter-year"
                      style={{ colorScheme: "dark" }}
                      className="ml-2 bg-[var(--sh-card-base)] border border-shBorder rounded p-1 text-shText text-sm">
                {[0, 1, 2].map((off) => {
                  const y = new Date().getFullYear() - off;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
            </label>
            <button onClick={() => setProfileOpen((o) => !o)} data-testid="taxcenter-profile-toggle"
                    className="bg-shPrimary/20 border border-shPrimary/40 text-shPrimary px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">
              {profileOpen ? "Close" : "Open"} Tax Profile
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap text-[11px]" data-testid="taxcenter-readiness">
          <span>Federal: <b className={pr.federal?.cpa_review ? "text-purple-300" : pr.federal?.complete ? "text-shGreen" : "text-amber-300"}>
            {pr.federal?.cpa_review ? "CPA review" : pr.federal?.complete ? "Complete" : `Missing information (${pr.federal?.missing_count ?? "?"})`}</b></span>
          <span>· Ohio: <b className={pr.ohio?.cpa_review ? "text-purple-300" : pr.ohio?.complete ? "text-shGreen" : "text-amber-300"}>
            {pr.ohio?.cpa_review ? "CPA review" : pr.ohio?.complete ? "Complete" : `Missing information (${pr.ohio?.missing_count ?? "?"})`}</b></span>
          <span>· School district: <b className={pr.school_district?.applicable === "unknown" ? "text-amber-300" : "text-shText"}>
            {pr.school_district?.applicable === "yes" ? "Applicable" : pr.school_district?.applicable === "no" ? "Not applicable" : "Unknown"}</b></span>
        </div>
        {profileOpen && <TaxProfilePanel year={year} onChanged={() => setProfileVersion((v) => v + 1)} />}
        <p className="text-[11px] text-shTextMuted italic" data-testid="taxcenter-planning-note">
          <b className="uppercase tracking-widest text-[10px] mr-1">Planning Tools:</b>{data.notes?.planning_reserve} It stays on Administration → Staff → Quarterly Tax.
        </p>
      </div>

      {payJur && (
        <RecordPaymentModal year={year} lockJurisdiction={payJur}
                            onClose={() => setPayJur(null)}
                            onSaved={() => { setPayJur(null); bumpPayments(); }} />
      )}
    </div>
  );
}

// ── Dashboard tile (owner-only; Dashboard gates on can("finance_reports")) ──

export function taxCenterTileLine(na) {
  if (!na) return null;
  if (na.none) return { tone: "ok", text: "No immediate tax action required", sub: "" };
  const tone = na.status === "OVERDUE" ? "overdue"
    : ["PAYMENT_NEEDED", "FILING_REQUIRED", "PROFILE_INCOMPLETE"].includes(na.status) ? "warning"
    : "normal";
  return { tone, text: na.headline, sub: na.sub || "" };
}

const TILE_TONES = {
  overdue: "border-red-500/50",
  warning: "border-amber-500/40",
  ok: "border-shBorder",
  normal: "border-shBorder",
};

export function TaxCenterTile({ onNavigate }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get("/admin/tax-center")
      .then((r) => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed || !data) return null;      // never fabricate a tax number
  const line = taxCenterTileLine(data.next_action);
  if (!line) return null;

  const open = () => {
    try { sessionStorage.setItem(FINANCE_TARGET_KEY, "tax_center"); } catch { /* ignore */ }
    if (onNavigate) onNavigate("income");
    else window.dispatchEvent(new CustomEvent("sh:nav", { detail: "income" }));
  };

  return (
    <button onClick={open} data-testid="tax-center-tile"
            className={`w-full text-left bg-[var(--sh-card-base)] rounded-xl border px-4 py-3 card-pop hover:border-shSecondary transition ${TILE_TONES[line.tone]}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shPrimary"><i className="fas fa-scale-balanced mr-2" />Tax Center</p>
          <p className={`text-sm font-black mt-1 ${line.tone === "overdue" ? "text-red-400" : line.tone === "ok" ? "text-shGreen" : "text-shText"}`}
             data-testid="tax-center-tile-line">{line.text}</p>
          {line.sub && <p className="text-[11px] text-shTextMuted">{line.sub}</p>}
        </div>
        <i className="fas fa-arrow-right text-shSecondary" />
      </div>
    </button>
  );
}
