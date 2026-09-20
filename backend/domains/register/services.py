"""Register-domain business rules extracted in modernization Phase 5."""
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional
from fastapi import HTTPException

_active_register_closeout_fn = None
_closeout_rollover_cash_fn = None
_db = None
_verify_password_fn = None
_hash_password_fn = None
_now_iso_fn = None
_business_today_fn = None
_enforce_rate_limit_fn = None
_client_ip_fn = None
_perms_for_fn = None
_issue_pos_token_fn = None
_invalidate_auth_user_cache_fn = None
_normalize_payment_method_fn = None
_require_register_day_open_fn = None


def configure(*, active_register_closeout, closeout_rollover_cash, db=None,
              verify_password=None, hash_password=None, now_iso=None,
              business_today=None, enforce_rate_limit=None, client_ip=None,
              perms_for=None, issue_pos_token=None, invalidate_auth_user_cache=None,
              normalize_payment_method=None, require_register_day_open=None) -> None:
    global _active_register_closeout_fn, _closeout_rollover_cash_fn, _db
    global _verify_password_fn, _hash_password_fn, _now_iso_fn, _business_today_fn
    global _enforce_rate_limit_fn, _client_ip_fn, _perms_for_fn, _issue_pos_token_fn
    global _invalidate_auth_user_cache_fn
    global _normalize_payment_method_fn, _require_register_day_open_fn
    _normalize_payment_method_fn = normalize_payment_method
    _require_register_day_open_fn = require_register_day_open
    _active_register_closeout_fn = active_register_closeout
    _closeout_rollover_cash_fn = closeout_rollover_cash
    _db = db
    _verify_password_fn = verify_password
    _hash_password_fn = hash_password
    _now_iso_fn = now_iso
    _business_today_fn = business_today
    _enforce_rate_limit_fn = enforce_rate_limit
    _client_ip_fn = client_ip
    _perms_for_fn = perms_for
    _issue_pos_token_fn = issue_pos_token
    _invalidate_auth_user_cache_fn = invalidate_auth_user_cache

async def require_register_day_open(date_value: str) -> None:
    closeout = await _active_register_closeout_fn(date_value)
    if closeout:
        raise HTTPException(
            status_code=409,
            detail=(
                f"The register for {date_value} is closed. Reopen the day with a reason "
                "before recording another sale, payment, refund, expense, or till adjustment."
            ),
        )

def effective_register_opening(
    session: Optional[Dict[str, Any]],
    previous_closeout: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Resolve today's opening drawer without trusting stale browser state.

    A saved session may differ from the previous closeout only when it carries
    an explicit, auditable override reason. Legacy/stale rows that silently
    replaced the rollover are recovered to the last confirmed count.
    """
    suggested = _closeout_rollover_cash_fn(previous_closeout)
    session_cash = None
    if session and session.get("opening_cash") is not None:
        try:
            session_cash = round(float(session.get("opening_cash") or 0), 2)
        except (TypeError, ValueError):
            session_cash = None

    override_reason = str((session or {}).get("opening_override_reason") or "").strip()
    override_marked = bool((session or {}).get("opening_was_overridden"))
    valid_override = override_marked and len(override_reason) >= 3

    recovered = False
    recorded_cash = session_cash
    if suggested is not None:
        if session_cash is None:
            opening_cash = suggested
            source = "previous_closeout"
        elif abs(session_cash - suggested) <= 0.005:
            opening_cash = session_cash
            source = "drawer_session"
        elif valid_override:
            opening_cash = session_cash
            source = "drawer_session_override"
        else:
            # Old UI/PWA state could write yesterday's opening amount into the
            # next day without a reason. Never let that silently defeat the
            # confirmed closeout rollover.
            opening_cash = suggested
            source = "previous_closeout_recovered"
            recovered = True
    elif session_cash is not None:
        opening_cash = session_cash
        source = "drawer_session"
    else:
        opening_cash = 0.0
        source = "not_set"

    effective_session = dict(session) if session else None
    if effective_session is not None and recovered:
        effective_session["recorded_opening_cash"] = recorded_cash
        effective_session["opening_cash"] = opening_cash
        effective_session["opening_recovered_from_rollover"] = True

    return {
        "opening_cash": round(float(opening_cash), 2),
        "source": source,
        "suggested_cash": suggested,
        "suggested_from_date": (previous_closeout or {}).get("date"),
        "suggested_from_closeout_id": (previous_closeout or {}).get("id"),
        "valid_override": valid_override,
        "override_reason": override_reason if valid_override else "",
        "recovered": recovered,
        "recorded_cash": recorded_cash,
        "session": effective_session,
    }


# ── No-sale drawer opens (PIN-verified) ─────────────────────────────────────
# Opening the physical drawer outside a sale (making change, swapping bills)
# requires the acting employee's 4-digit register PIN. The PIN identifies the
# HUMAN at a possibly-shared terminal; the event lands in the register
# activity trail with their name. PINs are bcrypt-hashed on the user doc
# (register_pin_hash) and must be unique across active staff.

async def find_user_by_register_pin(pin: str) -> Optional[dict]:
    """Match a typed PIN to the active staff member who owns it.

    bcrypt hashes can't be queried by value, so scan the (small) set of
    active users that have a PIN configured and check each. Uniqueness is
    enforced at set time, so the first match is the only match.
    """
    cursor = _db.users.find(
        {"register_pin_hash": {"$exists": True, "$nin": [None, ""]}, "active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "register_pin_hash": 1},
    )
    async for u in cursor:
        try:
            if _verify_password_fn(pin, u.get("register_pin_hash") or ""):
                return u
        except Exception:
            continue
    return None


async def set_register_pin(*, pin: str, target_user_id: Optional[str], actor: dict, request) -> Dict[str, Any]:
    """Set (or replace) a register PIN. Staff set their own; setting someone
    else's requires the settings permission (owner/manager)."""
    await _enforce_rate_limit_fn(request, "register_pin_set", _client_ip_fn(request), limit=10, window_seconds=300)
    target_id = target_user_id or actor.get("id")
    if target_id != actor.get("id") and not _perms_for_fn(actor).get("settings"):
        raise HTTPException(status_code=403, detail="Missing permission: settings")
    target = await _db.users.find_one({"id": target_id}, {"_id": 0, "id": 1, "role": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    existing_owner = await find_user_by_register_pin(pin)
    if existing_owner and existing_owner.get("id") != target_id:
        raise HTTPException(status_code=400, detail="That PIN is already in use — pick a different one.")
    await _db.users.update_one(
        {"id": target_id},
        {"$set": {
            "register_pin_hash": _hash_password_fn(pin),
            "register_pin_set_at": _now_iso_fn(),
            "register_pin_set_by": actor.get("id"),
        }},
    )
    _invalidate_auth_user_cache_fn(target_id)
    return {"ok": True, "user_id": target_id}


async def record_no_sale(*, pin: str, reason: str, workstation_id: Optional[str], actor: dict, request) -> Dict[str, Any]:
    """Open the cash drawer with NO sale (making change, etc.).

    Requires today's register day to be open and a valid employee PIN. The
    event is recorded in register_no_sales (surfaced in the day's activity
    trail and the activity CSV export) and a single-use open_drawer hardware
    token is returned when a workstation is given.
    """
    d = _business_today_fn().isoformat()
    await require_register_day_open(d)
    # Same physical rule as taking cash: no drawer session, no drawer.
    session = await _db.cash_drawer_sessions.find_one({"date": d}, {"_id": 0, "date": 1})
    if not session:
        raise HTTPException(status_code=400, detail="Open the register before opening the drawer.")
    await _enforce_rate_limit_fn(request, "register_no_sale_pin", _client_ip_fn(request), limit=10, window_seconds=300)
    employee = await find_user_by_register_pin(pin)
    if not employee:
        raise HTTPException(status_code=403, detail="PIN not recognized. Set your register PIN first, or check the digits.")
    doc = {
        "id": str(uuid.uuid4()),
        "date": d,
        "reason": reason.strip(),
        "employee_id": employee.get("id"),
        "employee_name": employee.get("name") or employee.get("email") or "",
        "session_user_id": actor.get("id"),
        "workstation_id": workstation_id,
        "created_at": _now_iso_fn(),
    }
    await _db.register_no_sales.insert_one(doc.copy())
    doc.pop("_id", None)
    # Hardware token is best-effort and workstation binding is optional —
    # same as the checkout paths, which issue drawer tokens with a null
    # workstation when the terminal never identified itself.
    try:
        token = await _issue_pos_token_fn(
            action="open_drawer", workstation_id=workstation_id,
            reason=f"no_sale:{doc['id']}",
        )
    except Exception:
        token = None
    return {"ok": True, "no_sale": doc, "pos_open_drawer_token": token}

async def record_register_refund(body, user: dict) -> dict:
    """A manual money-back correction from the register tools.

    This is the free-form path — a cancellation, an overcharge, something a
    return cannot express. Merchandise coming back over the counter should go
    through a RETURN instead, which knows what was sold and prices the refund
    itself.

    Two things used to be wrong here, and both cost real money:

      * Sales tax was never reversed. Refunding a taxed sale gave the customer
        their tax back out of the drawer while the liability still said it was
        owed to Ohio, so it got remitted on a sale that no longer existed.
      * There was no ceiling of any kind. A slipped decimal refunded far more
        than was ever taken and landed straight in the drawer, the P&L and the
        books with nothing to catch it.

    So a refund now either points at the sale it reverses — in which case the
    tax and the ceiling are worked out from that sale and cannot be wrong — or
    it states its own tax portion explicitly, which for a service refund is
    correctly zero but has to be a decision rather than an oversight.
    """
    d = body.date or _business_today_fn().isoformat()
    await _require_register_day_open_fn(d)

    amount = round(float(body.amount), 2)
    sale = None
    tax_part = round(float(getattr(body, "tax_amount", 0) or 0), 2)

    sale_id = (getattr(body, "sale_id", None) or "").strip()
    if sale_id:
        sale = await _db.pos_sales.find_one({"id": sale_id}, {"_id": 0})
        if not sale:
            raise HTTPException(status_code=404, detail="That sale could not be found.")
        already = await _already_given_back(sale_id)
        remaining = round(float(sale.get("total") or 0) - already, 2)
        if remaining <= 0:
            raise HTTPException(
                status_code=409,
                detail=f"Sale #{sale.get('receipt_number')} has already been fully refunded.")
        if amount > remaining + 0.005:
            raise HTTPException(
                status_code=400,
                detail=f"Only {_fmt(remaining)} is left to refund on sale "
                       f"#{sale.get('receipt_number')} — it was {_fmt(sale.get('total'))}.")
        # The tax comes from the sale, in the same proportion as the refund.
        # Deriving it beats asking, because the operator cannot get it wrong.
        sale_total = round(float(sale.get("total") or 0), 2)
        sale_tax = round(float(sale.get("tax_amount") or 0), 2)
        tax_part = round(sale_tax * (amount / sale_total), 2) if sale_total > 0 else 0.0
    elif tax_part > amount + 0.005:
        raise HTTPException(status_code=400, detail="The tax portion cannot exceed the refund.")

    client_name = ""
    if body.client_id:
        c = await _db.clients.find_one({"id": body.client_id}, {"_id": 0, "name": 1})
        if c:
            client_name = c.get("name") or ""

    doc = {
        "id": str(uuid.uuid4()),
        "date": d,
        "description": f"Refund · {body.reason.strip()}"
                       + (f" · against #{sale.get('receipt_number')}" if sale else ""),
        "amount": -amount,
        "category": "Refund",
        "notes": (body.notes or "").strip(),
        "payment_method": _normalize_payment_method_fn(body.payment_method, store=True),
        "client_id": body.client_id or None,
        "client_name": client_name,
        "source_kind": "refund",
        # Negated, like every other reversal row, so the sales-tax liability
        # falls by exactly what was handed back. Written even when zero, which
        # marks the row as tax-explicit rather than merely tax-less.
        "tax_amount": -tax_part,
        "pre_tax_amount": -round(amount - tax_part, 2),
        "tax_rate_pct": float((sale or {}).get("tax_rate_pct") or 0),
        "pos_sale_id": sale_id or None,
        "created_at": _now_iso_fn(),
        "created_by": user.get("id"),
        "logged_by": user.get("name") or user.get("email") or "admin",
    }
    await _db.retail_sales.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


def _fmt(value) -> str:
    return f"${round(float(value or 0), 2):.2f}"


async def _already_given_back(sale_id: str) -> float:
    """Every dollar already handed back on this sale, however it was done —
    a void, a return, or an earlier manual refund. One sale cannot be
    refunded three ways for three times the money."""
    total = 0.0
    rows = await _db.retail_sales.find(
        {"pos_sale_id": sale_id, "amount": {"$lt": 0}}, {"_id": 0, "amount": 1},
    ).to_list(500)
    for r in rows:
        total += abs(float(r.get("amount") or 0))
    return round(total, 2)


