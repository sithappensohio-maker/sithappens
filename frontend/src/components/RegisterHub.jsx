import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { onRegisterChanged } from "../lib/registerBus";
import { toast } from "sonner";

// ── Step 3: Front Desk register hub ─────────────────────────────────────────
// One card that answers, at a glance: is the register open, what cash does
// the system expect, does today still need to be closed, and what money
// activity happened today. Status comes from the operational
// /admin/register/status endpoint (Step 2 — visible to any cashier); every
// dollar figure comes from the finance-gated /admin/register/day summary and
// is only fetched/rendered for finance_reports users. Expected cash is the
// backend's authoritative Step 1 calculation — this file never re-derives it.

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

// Pure view model — everything the JSX needs, derived from raw fetch state.
// Exported for tests (the whole Jest suite here is pure-function based).
export function buildRegisterView({ status, summary, canFinance }) {
  const loading = status === null;
  const statusError = !!status?.error;
  const kind = loading ? "loading"
    : statusError ? "error"
    : status?.status === "OPEN" ? "open"
    : status?.status === "CLOSED" ? "closed"
    : status?.status === "NOT_OPEN" ? "not_open"
    : "error";

  const headline = {
    loading: "Checking register…",
    error: "Register status unavailable",
    open: "Register open — not yet closed",
    closed: "Register closed for today",
    not_open: "Register not opened today",
  }[kind];

  // Expected cash: finance users only, and ONLY a real backend number.
  // A failed summary is "Unavailable" — never a misleading $0.00.
  let expectedCashText = null;
  if (canFinance && kind !== "loading") {
    if (summary === null) expectedCashText = "…";
    else if (summary?.error) expectedCashText = "Unavailable";
    else expectedCashText = money(summary?.totals?.expected_cash);
  }

  const summaryOk = canFinance && !!summary && !summary.error;
  return {
    kind,
    headline,
    expectedCashText,
    expectedCashIsError: expectedCashText === "Unavailable",
    // Prominent close action: finance user, register genuinely open. Routing
    // only — the button NEVER closes anything itself (see Pos.jsx wiring).
    showCloseButton: canFinance && kind === "open",
    showQuickOpen: canFinance && kind === "not_open",
    showRetry: kind === "error",
    openedCaption: kind === "open" && status?.opened_at
      ? `Cash drawer active since ${new Date(status.opened_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${status.opened_by ? ` · opened by ${status.opened_by}` : ""}`
      : null,
    closedCaption: summaryOk && summary.register_closed && summary.latest_closeout?.cash_counted != null
      ? `Counted ${money(summary.latest_closeout.cash_counted)} · reopen from Register Tools if corrections are needed`
      : null,
    netCollectedText: summaryOk ? money(summary.totals?.net_incoming_total) : null,
    activityRows: summaryOk ? buildActivityRows(summary) : null,
    activityError: canFinance && !!summary?.error,
  };
}

// Today's Register Activity — display feed straight from the authoritative
// day summary (same rows Register Tools shows), plus the opening/closeout
// bookends synthesized from the same payload. NOT a second ledger.
export function buildActivityRows(summary) {
  const labels = summary.method_labels || {};
  const rows = (summary.activity || []).map((a) => ({
    id: `act-${a.id}`,
    label: a.label || "Register entry",
    detail: [a.client_name, a.description].filter(Boolean).join(" · "),
    method: a.payment_method_label || labels[a.payment_method] || a.payment_method || "",
    amount: Number(a.amount || 0),
    at: a.created_at || "",
  }));
  const session = summary.drawer_session;
  if (session?.opened_at) {
    rows.push({
      id: "register-opened",
      label: "Register opened",
      detail: session.opened_by_name ? `by ${session.opened_by_name}` : "",
      method: `Opening cash ${money(summary.totals?.opening_cash)}`,
      amount: null,
      at: session.opened_at,
    });
  }
  const closeout = summary.latest_closeout;
  if (closeout?.created_at) {
    rows.push({
      id: "register-closed",
      label: "Register closed",
      detail: closeout.created_by_name ? `by ${closeout.created_by_name}` : "",
      method: closeout.cash_counted != null ? `Counted ${money(closeout.cash_counted)}` : "",
      amount: null,
      at: closeout.created_at,
    });
  }
  return rows.sort((x, y) => (y.at || "").localeCompare(x.at || ""));
}

export default function RegisterHub({ onOpenCloseout, onStatusChange }) {
  const { can } = useAuth();
  const canFinance = can("finance_reports");
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [openingReason, setOpeningReason] = useState("");
  const [openingNeedsReason, setOpeningNeedsReason] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const statusChangeRef = useRef(onStatusChange);
  statusChangeRef.current = onStatusChange;

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/register/status");
      setStatus(data);
      statusChangeRef.current?.(data);
    } catch {
      const err = { status: "UNKNOWN", error: true };
      setStatus(err);
      statusChangeRef.current?.(err);
    }
    if (canFinance) {
      try {
        const { data } = await api.get("/admin/register/day");
        setSummary(data);
      } catch {
        setSummary({ error: true });
      }
    }
  }, [canFinance]);

  useEffect(() => { refresh(); }, [refresh]);
  // Event-driven invalidation: every register-affecting mutation emits on the
  // bus after its POST succeeds. Focus + a modest interval are only fallbacks.
  useEffect(() => onRegisterChanged(refresh), [refresh]);
  useEffect(() => {
    const timer = setInterval(refresh, 90000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refresh]);

  const doOpenRegister = async () => {
    setOpenBusy(true);
    try {
      await api.post("/admin/register/open-drawer", {
        opening_cash: Number(openingCash || 0),
        opening_override_reason: openingReason.trim(),
      });
      toast.success("Register opened");
      setOpeningCash(""); setOpeningReason(""); setOpeningNeedsReason(false);
      refresh();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Could not open the register";
      if (e?.response?.status === 400 && /rollover/i.test(String(detail))) setOpeningNeedsReason(true);
      toast.error(detail);
    }
    setOpenBusy(false);
  };

  const view = buildRegisterView({ status, summary, canFinance });
  const tone = {
    open: "border-shPrimary/50",
    closed: "border-shBorder",
    not_open: "border-shAccent/40",
    error: "border-shBorder",
    loading: "border-shBorder",
  }[view.kind];
  const dotTone = {
    open: "bg-shPrimary",
    closed: "bg-shTextMuted",
    not_open: "bg-shAccent",
    error: "bg-shTextMuted",
    loading: "bg-shTextMuted",
  }[view.kind];

  return (
    <div className={`bg-[var(--sh-card-base)] border ${tone} rounded-2xl p-4 space-y-3`} data-testid="register-hub">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-shText font-black uppercase tracking-widest text-sm flex items-center gap-2" data-testid="register-hub-status">
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotTone}`} />
            {view.headline}
          </p>
          {view.openedCaption && <p className="text-[12px] text-shTextMuted mt-0.5">{view.openedCaption}</p>}
          {view.closedCaption && <p className="text-[12px] text-shTextMuted mt-0.5">{view.closedCaption}</p>}
          {!canFinance && view.kind === "not_open" && (
            <p className="text-[12px] text-shTextMuted mt-0.5">Ask a manager to open the register before taking cash payments.</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {view.expectedCashText !== null && (
            <div className="text-right" data-testid="register-hub-expected">
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Expected cash</p>
              <p className={`text-2xl font-black leading-tight ${view.expectedCashIsError ? "text-shAccent text-base" : "text-shText"}`}
                 data-testid="register-hub-expected-value">
                {view.expectedCashText}
              </p>
            </div>
          )}
          {view.showCloseButton && (
            <button onClick={() => onOpenCloseout?.()} data-testid="register-hub-close-btn"
                    className="bg-shPrimary text-bgHeader rounded-xl px-4 py-3 font-black uppercase text-[12px] tracking-widest">
              <i className="fas fa-clipboard-check mr-1.5" />Close Register
            </button>
          )}
          {view.showRetry && (
            <button onClick={refresh} data-testid="register-hub-retry"
                    className="bg-[var(--sh-card-base)] border border-shBorder text-shText rounded-xl px-4 py-3 font-black uppercase text-[12px] tracking-widest">
              Retry
            </button>
          )}
        </div>
      </div>

      {view.showQuickOpen && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="register-hub-quick-open">
          <input type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="Opening cash"
                 className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText w-36" />
          {openingNeedsReason && (
            <input value={openingReason} onChange={(e) => setOpeningReason(e.target.value)}
                   placeholder="Reason opening differs from rollover" data-testid="register-hub-override-reason"
                   className="bg-[var(--sh-card-base)] border border-shAccent/40 rounded p-2 text-shText w-64 max-w-full" />
          )}
          <button onClick={doOpenRegister} disabled={openBusy} data-testid="register-hub-open-btn"
                  className="bg-shPrimary text-bgHeader rounded px-4 py-2 font-black uppercase text-[12px] tracking-widest disabled:opacity-50">
            {openBusy ? "Opening…" : "Open Register"}
          </button>
        </div>
      )}

      {canFinance && (
        <div className="border-t border-shBorder/60 pt-2">
          <button onClick={() => setActivityOpen((o) => !o)} data-testid="register-hub-activity-toggle"
                  className="text-shTextMuted hover:text-shText text-[11px] font-black uppercase tracking-widest">
            <i className={`fas fa-chevron-${activityOpen ? "up" : "down"} mr-1.5`} />
            Today's Register Activity
            {view.netCollectedText && <span className="ml-2 text-shTextMuted normal-case font-bold tracking-normal">Net collected {view.netCollectedText}</span>}
          </button>
          {activityOpen && (
            <div className="mt-2 space-y-1 max-h-72 overflow-y-auto" data-testid="register-hub-activity">
              {view.activityError && (
                <p className="text-shAccent text-[12px] font-black">Activity unavailable — retry above.</p>
              )}
              {view.activityRows && view.activityRows.length === 0 && (
                <p className="text-shTextMuted text-sm">No register activity yet today.</p>
              )}
              {(view.activityRows || []).map((r) => (
                <div key={r.id} className="flex items-baseline justify-between gap-3 border-b border-shBorder/50 py-1.5 text-sm">
                  <div className="min-w-0">
                    <span className="text-shText font-bold">{r.label}</span>
                    {r.detail && <span className="text-shTextMuted"> · {r.detail}</span>}
                    <span className="block text-[11px] text-shTextMuted truncate">
                      {r.at ? new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}{r.method ? ` · ${r.method}` : ""}
                    </span>
                  </div>
                  {r.amount !== null && (
                    <span className={`shrink-0 font-black ${r.amount < 0 ? "text-shAccent" : "text-shText"}`}>
                      {r.amount < 0 ? `-${money(Math.abs(r.amount))}` : money(r.amount)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
