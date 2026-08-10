// Action Required / Pending Actions — the ONE high-visibility queue of
// everything that still needs a real staff decision (Meet & Greet requests,
// approval-required bookings, reschedule requests). Backed entirely by
// GET /admin/pending-actions, which derives from the authoritative records:
// nothing here is a notification, nothing can be "marked read" — an item
// leaves only when the underlying request is actually handled.
//
// Shared by Dashboard and Front Desk; permission failures (403) render
// nothing rather than a broken panel.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useLiveRefresh } from "../lib/useLiveRefresh";

export const PENDING_ACTION_TARGET_KEY = "sh_pending_action_target";

export function openPendingAction(action) {
  const dl = action?.deep_link || {};
  try { sessionStorage.setItem(PENDING_ACTION_TARGET_KEY, JSON.stringify(dl)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("sh:nav", { detail: dl.screen || "bookings" }));
}

export function announcePendingActionsChanged() {
  window.dispatchEvent(new CustomEvent("sh:pending-actions-changed"));
}

// Escalation → visual emphasis. Rank-0 states (requested time passed / for
// today) and URGENT use the danger style; OVERDUE (≥48h) too; a ≥24h wait
// steps up to amber; a fresh item is the standard accent.
const URGENCY_STYLE = {
  action_required:          { chip: "bg-shAccent/15 text-shAccent border-shAccent/40",  card: "border-shAccent/35" },
  waiting:                  { chip: "bg-amber-500/15 text-amber-300 border-amber-400/40", card: "border-amber-400/40" },
  overdue:                  { chip: "bg-red-500/20 text-red-300 border-red-500/50",     card: "border-red-500/50" },
  urgent:                   { chip: "bg-red-500/20 text-red-300 border-red-500/50",     card: "border-red-500/50" },
  urgent_today:             { chip: "bg-red-500/25 text-red-200 border-red-500/60",     card: "border-red-500/60 ring-1 ring-red-500/30" },
  overdue_requested_passed: { chip: "bg-red-500/25 text-red-200 border-red-500/60",     card: "border-red-500/60 ring-1 ring-red-500/30" },
};

const TYPE_ICON = {
  meet_and_greet_request: "fa-handshake",
  booking_approval: "fa-hourglass-half",
  reschedule_request: "fa-rotate",
};

const REVIEW_LABEL = {
  meet_and_greet_request: "Review Request",
  booking_approval: "Review Booking",
  reschedule_request: "Review Request",
};

function fmtDateTime(dateStr, timeStr) {
  if (!dateStr) return "—";
  let out = dateStr;
  try {
    out = new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch { /* keep raw */ }
  return timeStr ? `${out} · ${timeStr}` : out;
}

function fmtReceived(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return iso.slice(0, 16).replace("T", " · "); }
}

export function PendingActionCard({ action, onOpen, testid }) {
  const style = URGENCY_STYLE[action.urgency] || URGENCY_STYLE.action_required;
  const dateRange = action.requested_end_date && action.requested_end_date !== action.requested_date
    ? `${fmtDateTime(action.requested_date)} → ${fmtDateTime(action.requested_end_date)}`
    : fmtDateTime(action.requested_date, action.requested_time);
  return (
    <div className={`rounded-2xl border bg-[var(--sh-card-base)] p-3.5 ${style.card}`} data-testid={testid}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${style.chip}`}
                  data-testid={testid ? `${testid}-urgency` : undefined}>
              {action.urgency_label}
            </span>
            <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">
              <i className={`fas ${TYPE_ICON[action.type] || "fa-circle-exclamation"} mr-1.5`} />{action.type_label}
            </span>
          </div>
          <p className="text-[14px] font-black text-shText break-words">
            {action.client_name || "Client"}{action.dog_name ? <span className="text-shTextMuted font-bold"> / {action.dog_name}</span> : null}
            <span className="text-shTextMuted font-bold"> · {action.service_name}</span>
          </p>
          <p className="text-[12px] text-shTextMuted mt-1 break-words">
            Requested <span className="text-shText font-bold">{dateRange}</span>
          </p>
          <p className="text-[12px] text-shTextMuted mt-0.5 break-words">
            Received {fmtReceived(action.created_at)} · <span className="font-bold">{action.waiting_label}</span>
          </p>
          {action.notes && <p className="text-[12px] text-shTextMuted italic mt-1 break-words line-clamp-2">“{action.notes}”</p>}
        </div>
        <button type="button" onClick={() => onOpen(action)} data-testid={testid ? `${testid}-review` : undefined}
                className="shrink-0 w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-shPrimary text-bgHeader text-[11px] font-black uppercase tracking-widest hover:bg-shPrimary/90 transition">
          {REVIEW_LABEL[action.type] || "Review"} <i className="fas fa-arrow-right ml-1.5" />
        </button>
      </div>
    </div>
  );
}

export default function PendingActionsPanel({ testid = "pending-actions-panel", limit = 50, compactWhenEmpty = true }) {
  const [data, setData] = useState(null);   // null=loading, false=no access
  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get("/admin/pending-actions", { params: { limit } });
      setData(d);
    } catch (e) {
      if (e.response?.status === 403) setData(false);
      // other errors: keep last known data
    }
  }, [limit]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, { intervalMs: 60_000 });
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener("sh:pending-actions-changed", onChanged);
    return () => window.removeEventListener("sh:pending-actions-changed", onChanged);
  }, [load]);

  if (data === false || data === null) return null;
  const items = data.items || [];
  const total = data.counts?.total || 0;

  if (total === 0) {
    if (!compactWhenEmpty) return null;
    return (
      <div className="rounded-xl border border-shBorder/60 bg-[var(--sh-card-base)] px-4 py-2.5 text-[12px] text-shTextMuted font-bold"
           data-testid={`${testid}-empty`}>
        <i className="fas fa-circle-check mr-2 text-shPrimary" />No pending actions — nothing is waiting on you.
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-shAccent/40 bg-shAccent/[0.04] p-4 sm:p-5" data-testid={testid}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[15px] sm:text-[17px] font-black text-shText uppercase tracking-wide">
          <i className="fas fa-triangle-exclamation text-shAccent mr-2" />Action Required
          <span className="ml-2 inline-block bg-shAccent text-white text-[12px] font-black px-2 py-0.5 rounded-full align-middle"
                data-testid={`${testid}-count`}>{total}</span>
        </h2>
      </div>
      <div className="space-y-2.5">
        {items.map((a, i) => (
          <PendingActionCard key={a.id} action={a} onOpen={openPendingAction} testid={`${testid}-item-${i}`} />
        ))}
      </div>
    </section>
  );
}
