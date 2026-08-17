// Step 4C — compact "Sales Tax due" dashboard chip. Self-fetching (mirrors
// MileageDashTile); rendered by Dashboard.jsx only when
// widgetOn("sales_tax") && can("finance_reports"), so restricted staff
// never mount it and never fire the request. A failed or unconfigured
// fetch renders setup/no-data states — never a fake "$0.00 due".

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

export const FINANCE_TARGET_KEY = "sh_finance_target";

export function openFinanceSalesTax(onNavigate) {
  try { sessionStorage.setItem(FINANCE_TARGET_KEY, "sales_tax"); } catch { /* ignore */ }
  if (onNavigate) onNavigate("income");
  else window.dispatchEvent(new CustomEvent("sh:nav", { detail: "income" }));
}

function money(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

export function salesTaxTileLine(primary) {
  // Exported pure helper so the wording is unit-testable without a mount.
  if (!primary) return null;
  const amt = primary.filing_id
    ? (primary.remaining_balance > 0.005 ? primary.remaining_balance : 0)
    : (primary.projected_amount_to_remit ?? primary.liability);
  if (primary.status === "overdue") {
    return { tone: "overdue", text: `Sales Tax: OVERDUE — ${money(amt)}`, sub: `${primary.label} · was due ${fmtDate(primary.effective_due_date)}` };
  }
  if (primary.status === "filed_payment_pending") {
    return { tone: "warning", text: `Sales Tax: ${money(amt)} payment remaining`, sub: `${primary.label} · filed, not fully paid` };
  }
  if (primary.status === "filed_paid" || primary.status === "zero_return_filed") {
    return { tone: "ok", text: "Sales Tax: current period accruing", sub: primary.label };
  }
  const days = primary.days_until_due;
  const urgent = primary.urgency === "urgent" || primary.urgency === "warning";
  if (primary.status === "open") {
    return { tone: "normal", text: `Sales Tax: ${money(amt)} accrued`, sub: `${primary.label} · due ${fmtDate(primary.effective_due_date)} after period closes` };
  }
  return {
    tone: urgent ? "warning" : "normal",
    text: days != null && days <= 14
      ? `Sales Tax: Due in ${days} day${days === 1 ? "" : "s"} — ${money(amt)}`
      : `Sales Tax: ${money(amt)} due ${fmtDate(primary.effective_due_date)}`,
    sub: primary.label,
  };
}

const TONE_CLS = {
  overdue: "border-red-500/50 text-red-400",
  warning: "border-amber-500/40 text-amber-300",
  ok: "border-shBorder text-shText",
  normal: "border-shBorder text-shText",
};

export function SalesTaxDueTile({ onNavigate }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get("/admin/sales-tax/tracker")
      .then((r) => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return null;           // never render fabricated tax numbers
  if (!data) return null;            // still loading — no placeholder zeros

  if (data.setup_required) {
    return (
      <button onClick={() => openFinanceSalesTax(onNavigate)} data-testid="sales-tax-tile-setup"
              className="w-full text-left bg-[var(--sh-card-base)] rounded-xl border border-shBorder px-4 py-3 card-pop hover:border-shSecondary transition">
        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shPrimary"><i className="fas fa-landmark mr-2" />Ohio Sales Tax</p>
        <p className="text-sm text-shText mt-1">Filing schedule needs setup<i className="fas fa-arrow-right ml-2 text-shSecondary" /></p>
      </button>
    );
  }

  const line = salesTaxTileLine(data.primary);
  if (!line) return null;
  const needsReview = (data.needs_review_periods || []).length > 0;
  return (
    <button onClick={() => openFinanceSalesTax(onNavigate)} data-testid="sales-tax-tile"
            className={`w-full text-left bg-[var(--sh-card-base)] rounded-xl border px-4 py-3 card-pop hover:border-shSecondary transition ${TONE_CLS[line.tone]}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shPrimary"><i className="fas fa-landmark mr-2" />Ohio Sales Tax</p>
          <p className={`text-sm font-black mt-1 ${line.tone === "overdue" ? "text-red-400" : ""}`} data-testid="sales-tax-tile-line">{line.text}</p>
          <p className="text-[11px] text-shTextMuted">{line.sub}</p>
        </div>
        <div className="flex items-center gap-2">
          {needsReview && (
            <span className="bg-purple-500/10 border border-purple-500/40 text-purple-300 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest" data-testid="sales-tax-tile-review">
              Needs review
            </span>
          )}
          <i className="fas fa-arrow-right text-shSecondary" />
        </div>
      </div>
    </button>
  );
}
