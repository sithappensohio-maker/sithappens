"""Step 4C — Ohio sales-tax filing-period math and status derivation.

Pure functions only (no I/O, no DB): given the owner's configured filing
schedule and "today" as a business date (America/New_York — callers pass
``business_today()``), produce filing periods, statutory due dates, and
derived display statuses. The tax DOLLARS never come from here — liability
is always the canonical ``_sales_tax_window_summary`` in server.py
(4B-1/4B-9 source of truth). This module only decides period boundaries
and what state each period is in.

Ohio rules encoded (Ohio R.C. 5739.12 / Admin. Code 5703-9-02):
  * Vendors file monthly by default; the Tax Commissioner may authorize
    semiannual (or another) interval — so the frequency is a REQUIRED
    owner setting, never guessed from dollar thresholds.
  * Monthly periods are calendar months; the return/payment is due the
    23rd day of the following month.
  * Semiannual periods are Jan 1–Jun 30 (due Jul 23) and Jul 1–Dec 31
    (due Jan 23 of the NEXT year). Fixed halves — never rolling.
  * Weekend/holiday deadline shifts are NOT computed: no verified Ohio
    business-day calendar exists in this codebase, so the statutory date
    is preserved and an explicit per-period override (settings-driven)
    is surfaced as "adjusted_due_date" instead. We never silently move a
    deadline.
  * Timely-filing vendor discount: R.C. 5739.12 allows 0.75% of the tax
    liability when the return is filed AND paid by the due date. It is a
    FILING adjustment — it never changes net ledger liability. Default
    OFF until the owner enables it in settings.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

FILING_FREQUENCIES = ("monthly", "semiannual", "custom")

# Ohio R.C. 5739.12 — 0.75% of the tax due, for returns filed and paid on
# time. No dollar cap is implemented here; the statute's mechanics beyond
# the flat rate are the owner's/CPA's to confirm, which is why the setting
# defaults OFF.
OHIO_TIMELY_DISCOUNT_RATE_PCT = 0.75

DUE_DAY = 23  # statutory: 23rd of the month following the period's end


# ── Period identity ─────────────────────────────────────────────────────────

def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def period_for_date(frequency: str, d: date) -> Dict[str, Any]:
    """The filing period that contains business date ``d``."""
    if frequency == "monthly":
        start = date(d.year, d.month, 1)
        end = _month_end(d.year, d.month)
        key = f"{d.year:04d}-{d.month:02d}"
        label = f"{start.strftime('%B %Y')}"
    elif frequency == "semiannual":
        if d.month <= 6:
            start, end = date(d.year, 1, 1), date(d.year, 6, 30)
            key, label = f"{d.year:04d}-H1", f"January–June {d.year}"
        else:
            start, end = date(d.year, 7, 1), date(d.year, 12, 31)
            key, label = f"{d.year:04d}-H2", f"July–December {d.year}"
    else:
        raise ValueError(f"period_for_date: unsupported frequency {frequency!r}")
    return {"period_key": key, "label": label,
            "period_start": start.isoformat(), "period_end": end.isoformat()}


def next_period(frequency: str, period: Dict[str, Any]) -> Dict[str, Any]:
    end = date.fromisoformat(period["period_end"])
    return period_for_date(frequency, end + timedelta(days=1))


def statutory_due_date(period_end_iso: str) -> str:
    """23rd of the month following the period end (both monthly and
    semiannual — Jul–Dec correctly lands on Jan 23 of the next year)."""
    end = date.fromisoformat(period_end_iso)
    if end.month == 12:
        return date(end.year + 1, 1, DUE_DAY).isoformat()
    return date(end.year, end.month + 1, DUE_DAY).isoformat()


def iter_periods(frequency: str, tracking_start_iso: str, today: date) -> List[Dict[str, Any]]:
    """Every filing period from the one containing the tracking start
    through the one containing ``today`` (the current accumulating period),
    oldest first. Bounded defensively."""
    start_anchor = date.fromisoformat(tracking_start_iso)
    period = period_for_date(frequency, start_anchor)
    out: List[Dict[str, Any]] = []
    while len(out) < 600:
        out.append(period)
        if date.fromisoformat(period["period_end"]) >= today:
            break
        period = next_period(frequency, period)
    return out


# ── Discount / remit math (filing adjustments — never ledger mutations) ─────

def timely_discount_amount(liability: float, enabled: bool) -> float:
    """0.75% of a POSITIVE liability, as a negative adjustment. Zero when
    disabled, or when liability is zero/negative (no discount on a credit
    period). Returned separately — never folded into liability."""
    if not enabled or liability <= 0:
        return 0.0
    return -round(liability * OHIO_TIMELY_DISCOUNT_RATE_PCT / 100.0, 2)


def amount_to_remit(liability: float, adjustments: List[Dict[str, Any]],
                    discount: float = 0.0) -> float:
    """Estimated amount to remit = net liability + signed filing
    adjustments + timely discount (≤ 0). Liability itself is untouched."""
    adj = sum(float(a.get("amount") or 0) for a in (adjustments or []))
    return round(float(liability or 0) + adj + float(discount or 0), 2)


# ── Status derivation ───────────────────────────────────────────────────────

def derive_period_state(
    period: Dict[str, Any],
    filing: Optional[Dict[str, Any]],
    today: date,
    tracking_start_iso: str,
    due_override: Optional[Dict[str, Any]] = None,
    current_liability: Optional[float] = None,
) -> Dict[str, Any]:
    """Displayable state for one filing period.

    Statuses (derived, not persisted — the persisted facts are the filing
    record and its payment events):
      historical_untracked   period started before the tracking start
      open                   period contains today; still accumulating
      ready_to_file          completed, unfiled, due date not yet passed
      overdue                completed, unfiled, past its due date
      filed_payment_pending  filing recorded, remit not fully paid
      filed_paid             filing recorded and fully paid
      zero_return_filed      recorded $0 return
    Plus ``needs_review`` (bool) when a filed period's CURRENT ledger
    liability no longer matches the snapshot taken at filing time.
    """
    p_start = date.fromisoformat(period["period_start"])
    p_end = date.fromisoformat(period["period_end"])
    stat_due = statutory_due_date(period["period_end"])
    adj_due = (due_override or {}).get("date")
    effective_due = adj_due or stat_due

    state: Dict[str, Any] = {
        **period,
        "statutory_due_date": stat_due,
        "adjusted_due_date": adj_due,
        "due_date_override_reason": (due_override or {}).get("reason"),
        "effective_due_date": effective_due,
        "is_open": p_end >= today,
        "needs_review": False,
        "variance": None,
    }

    if p_start < date.fromisoformat(tracking_start_iso) and not filing:
        state["status"] = "historical_untracked"
        state["effective_due_date"] = None  # never alarm about pre-tracking eras
        return state

    if filing:
        snap = filing.get("snapshot") or {}
        payments = filing.get("payments") or []
        total_paid = round(sum(float(p.get("amount") or 0) for p in payments), 2)
        remit = float(snap.get("amount_to_remit") or 0)
        remaining = round(remit - total_paid, 2)
        state.update({
            "filing_id": filing.get("id"),
            "filed_date": filing.get("filed_date"),
            "is_zero_return": bool(filing.get("is_zero_return")),
            "snapshot": snap,
            "confirmation_ref": filing.get("confirmation_ref"),
            "total_paid": total_paid,
            "remaining_balance": remaining,
            "payment_count": len(payments),
        })
        if filing.get("is_zero_return"):
            state["status"] = "zero_return_filed"
        elif remaining <= 0.005:
            state["status"] = "filed_paid"
        else:
            state["status"] = "filed_payment_pending"
        # Post-filing variance: recompute vs the frozen snapshot. Never
        # rewrite the snapshot — surface the drift for human review.
        if current_liability is not None and "liability" in snap:
            diff = round(float(current_liability) - float(snap["liability"] or 0), 2)
            if abs(diff) >= 0.005:
                state["needs_review"] = True
                state["variance"] = {
                    "filed_liability": round(float(snap["liability"] or 0), 2),
                    "current_liability": round(float(current_liability), 2),
                    "difference": diff,
                    "message": ("A transaction/refund dated in this previously "
                                "filed period changed after the filing was recorded."),
                }
        return state

    # Unfiled
    if p_end >= today:
        state["status"] = "open"
        state["days_until_due"] = (date.fromisoformat(effective_due) - today).days
        return state
    due = date.fromisoformat(effective_due)
    if today > due:
        state["status"] = "overdue"
        state["days_overdue"] = (today - due).days
    else:
        state["status"] = "ready_to_file"
        state["days_until_due"] = (due - today).days
    return state


def pick_primary_period(states: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Owner-card priority: the OLDEST completed tracked period that is not
    fully resolved (unfiled, or filed with a remaining balance); otherwise
    the current open period. Needs-review does not hijack the primary card
    (it's already resolved money) — it is badged separately."""
    unresolved = [s for s in states
                  if s["status"] in ("ready_to_file", "overdue", "filed_payment_pending")]
    if unresolved:
        return sorted(unresolved, key=lambda s: s["period_start"])[0]
    open_now = [s for s in states if s["status"] == "open"]
    return open_now[0] if open_now else (states[-1] if states else None)


def urgency_for(state: Dict[str, Any], today: date) -> str:
    """Display urgency: normal / due_soon (≤14d) / warning (≤7d) /
    urgent (≤3d) / overdue."""
    if state.get("status") == "overdue":
        return "overdue"
    due = state.get("effective_due_date")
    if not due or state.get("status") in ("filed_paid", "zero_return_filed",
                                          "historical_untracked"):
        return "normal"
    days = (date.fromisoformat(due) - today).days
    if days <= 3:
        return "urgent"
    if days <= 7:
        return "warning"
    if days <= 14:
        return "due_soon"
    return "normal"
