"""Canonical pricing services extracted from server.py in modernization Phase 5.

Every booking, Quick Check-In, register, POS, pack-sale, and client-price path
continues to use one resolver.  Dependencies are wired explicitly at app
composition time; no route mutation or server import cycle is required.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import date
from fastapi import HTTPException

_db = None
_business_today_fn = None
_billable_boarding_units_fn = None
_boarding_pickup_day_units_fn = None
_now_iso_fn = None
_default_boarding_cutoff = None
_UNSET = object()


def configure(*, db, business_today, billable_boarding_units, now_iso, default_boarding_cutoff, boarding_pickup_day_units=None) -> None:
    global _db, _business_today_fn, _billable_boarding_units_fn, _boarding_pickup_day_units_fn, _now_iso_fn, _default_boarding_cutoff
    _db = db
    _business_today_fn = business_today
    _billable_boarding_units_fn = billable_boarding_units
    _boarding_pickup_day_units_fn = boarding_pickup_day_units
    _now_iso_fn = now_iso
    _default_boarding_cutoff = default_boarding_cutoff


def _configured() -> None:
    if _db is None:
        raise RuntimeError("Pricing domain services have not been configured")


def override_is_active(row: dict, today: Optional[date] = None) -> bool:
    """An override is active when it hasn't been explicitly revoked AND
    starts_on is empty OR <= today AND expires_on is empty OR >= today.
    `status`/`starts_on` are missing on every override created before those
    fields existed — treated as "not revoked" / "no start restriction",
    identical to their pre-existing (start-less, revoke-less) behavior."""
    row = row or {}
    if row.get("status") == "revoked":
        return False
    today = today or _business_today_fn()
    starts = row.get("starts_on")
    if starts:
        try:
            if date.fromisoformat(starts) > today:
                return False
        except Exception:
            pass  # malformed date — assume no start restriction rather than silently dropping rate
    exp = row.get("expires_on")
    if not exp:
        return True
    try:
        return date.fromisoformat(exp) >= today
    except Exception:
        return True  # malformed date — assume still active rather than silently dropping rate

def price_override_precedence_key(row: dict) -> tuple:
    """Deterministic winner key for rows sharing one client/item key.

    Revoked rows are filtered by the caller.  Explicit ``status=active`` rows
    outrank legacy rows whose status field predates the lifecycle feature;
    within the same lifecycle state, the newest edit/create wins.  The final
    id tie-breaker makes the result stable even for old rows missing timestamps.
    """
    row = row or {}
    return (
        1 if row.get("status") == "active" else 0,
        str(row.get("updated_at") or ""),
        str(row.get("created_at") or ""),
        str(row.get("id") or ""),
    )

def pick_applicable_price_override(
    rows: List[Dict[str, Any]],
    today: Optional[date] = None,
) -> Optional[Dict[str, Any]]:
    """Pick the currently applicable override from retained price history.

    ``price_overrides`` intentionally keeps revoked rows for audit/history.
    MongoDB natural order is therefore not a lifecycle rule: an unrestricted
    ``find_one`` can return an older revoked row before the newer active row and
    incorrectly make the canonical resolver fall back to standard pricing.
    Examine all rows for the exact key, keep only rows active *today*, and then
    choose deterministically.
    """
    applicable = [row for row in (rows or []) if override_is_active(row, today)]
    if not applicable:
        return None
    return max(applicable, key=price_override_precedence_key)

async def quote_base_service_price(
    *,
    client_id: Optional[str],
    service_type: str,
    start_date: str,
    end_date: Optional[str] = None,
    pickup_time: Optional[str] = None,
    pickup_cutoff_time: Any = _UNSET,
    service_id: Optional[str] = None,
    legacy_boarding_minimum: int = 0,
    grooming_type: Optional[str] = None,
) -> Dict[str, Any]:
    """Single backend source for base booking estimates.

    Returns dollars + unit metadata. This is deliberately small and boring so
    booking creation, checkout fallback, and reporting can agree instead of each
    screen inventing its own boarding math.
    """
    if pickup_cutoff_time is _UNSET:
        pickup_cutoff_time = _default_boarding_cutoff
    q: Dict[str, Any]
    if service_id:
        q = {"id": service_id, "active": True}
    else:
        q = {"service_type": service_type, "is_default": True, "active": True}
    svc = await _db.services.find_one(q, {"_id": 0})
    # Bug fix (found live during a boarding-pricing acceptance pass, 2026-07-31):
    # when service_type=="grooming" and no exact service_id is given, both
    # "Bath" and "Nail Trim" can independently carry is_default=True (they're
    # defaults for their own grooming_type, not competitors), so the query
    # above can match more than one row and silently return whichever Mongo
    # happens to return first — historically always "Bath" regardless of
    # what the client actually booked. Disambiguate using the same
    # slug/name "nail" heuristic AdminBookingModal.jsx already uses when it
    # reverse-maps an exact service back to a grooming_type (line ~634).
    if service_type == "grooming" and not service_id and grooming_type:
        candidates = await _db.services.find(
            {"service_type": "grooming", "active": True, "$or": [{"is_addon": {"$ne": True}}, {"is_addon": {"$exists": False}}]},
            {"_id": 0},
        ).to_list(50)
        wants_nail = grooming_type == "nail_trim"
        matches = [
            c for c in candidates
            if ("nail" in f"{c.get('slug','')} {c.get('name','')}".lower()) == wants_nail
        ]
        defaults = [c for c in matches if c.get("is_default")]
        if len(defaults) == 1:
            svc = defaults[0]
        elif len(matches) == 1:
            svc = matches[0]
        # If still ambiguous (0 or 2+ matches), fall through to the existing
        # svc/fallback logic below rather than guessing further.
    if not svc and not service_id:
        # Fallback: first active service of this type if no explicit default exists.
        svc = await _db.services.find_one(
            {"service_type": service_type, "active": True},
            {"_id": 0},
            sort=[("is_default", -1), ("name", 1)],
        )
    if not svc:
        return {
            "service_id": service_id,
            "service_name": None,
            "unit_price": 0.0,
            "units": 0,
            "unit_label": "units",
            "estimated_price": 0.0,
        }
    list_price = float(svc.get("base_price") or 0)
    unit_price = list_price
    pricing_meta = {
        "effective_price": list_price,
        "list_price": list_price,
        "override_id": None,
        "override_row": None,
    }
    if client_id:
        try:
            pricing_meta = await resolve_client_price(client_id, "service", svc.get("id") or "", list_price)
            unit_price = float(pricing_meta.get("effective_price", list_price) or 0)
        except Exception:
            unit_price = list_price
            pricing_meta = {
                "effective_price": list_price,
                "list_price": list_price,
                "override_id": None,
                "override_row": None,
            }
    preferred_rate_applied = bool(pricing_meta.get("override_id")) and abs(float(unit_price) - float(list_price)) > 0.005
    # Sit Happens business rule: daycare/boarding sibling pricing is
    # calculated as a discount off the SAME base unit price as the first dog.
    # Older service rows may still have `additional_dog_rate` populated; do
    # not stack that custom rate with the 50% multi-dog discount or daycare
    # estimates become too low (ex: $30 + ($25 - 50%) = $42.50 instead of
    # $30 + ($30 - 50%) = $45). For non-core services, preserve the legacy
    # optional additional_dog_rate behavior.
    if service_type in ("daycare", "boarding"):
        additional_dog_unit_price = unit_price
    else:
        additional_dog_unit_price = float(svc.get("additional_dog_rate") if svc.get("additional_dog_rate") is not None else unit_price)
    late_fee = {"applies": False, "amount": 0.0, "unit_price": 0.0, "service_id": None, "service_name": None}
    if service_type == "boarding":
        # Industry-standard boarding: bill overnight nights at the boarding
        # rate; the pickup day is free at/before the checkout time and bills
        # one full DAYCARE day after it (never extra boarding units).
        units = _billable_boarding_units_fn(
            start_date, end_date, pickup_time, legacy_minimum=legacy_boarding_minimum,
            cutoff_time=pickup_cutoff_time,
        )
        unit_label = "nights"
        if units > 0:
            late_fee = await late_pickup_daycare_fee(
                client_id=client_id, pickup_time=pickup_time, cutoff_time=pickup_cutoff_time,
            )
    else:
        units = 1 if service_type else 0
        unit_label = "visits"
    return {
        "service_id": svc.get("id"),
        "service_name": svc.get("name"),
        "unit_price": round(unit_price, 2),
        "list_unit_price": round(list_price, 2),
        "preferred_rate_applied": preferred_rate_applied,
        "price_override_id": pricing_meta.get("override_id"),
        "price_source": "preferred_client_rate" if preferred_rate_applied else "catalog_rate",
        "price_label": "Preferred client rate" if preferred_rate_applied else "Standard rate",
        "additional_dog_unit_price": round(additional_dog_unit_price, 2),
        "units": round(float(units), 2),
        "unit_label": unit_label,
        "late_pickup_daycare_fee": round(float(late_fee.get("amount") or 0), 2),
        "late_pickup_daycare_applies": bool(late_fee.get("applies")),
        "late_pickup_daycare_service_name": late_fee.get("service_name"),
        "estimated_price": round(unit_price * float(units) + float(late_fee.get("amount") or 0), 2),
    }


async def late_pickup_daycare_fee(
    *,
    client_id: Optional[str],
    pickup_time: Optional[str],
    cutoff_time: Any = _UNSET,
) -> Dict[str, Any]:
    """One dog's late-pickup daycare fee at the FULL rate.

    Boarding's pickup-day rule (industry-standard model): pickup at or before
    the boarding checkout time is free; pickup after it bills one full daycare
    day at the default daycare service price, honoring the client's
    grandfathered rate. Callers apply the additional-dog 50% row factor
    themselves, exactly like the boarding base. Returns amount 0.0 when the
    pickup is on time, no pickup time is stored, no daycare service exists, or
    the rule helper isn't wired (minimal test harnesses).
    """
    _configured()
    if cutoff_time is _UNSET:
        cutoff_time = _default_boarding_cutoff
    out = {"applies": False, "amount": 0.0, "unit_price": 0.0, "service_id": None, "service_name": None}
    if _boarding_pickup_day_units_fn is None:
        return out
    if float(_boarding_pickup_day_units_fn(pickup_time, cutoff_time) or 0) <= 0:
        return out
    svc = await _db.services.find_one(
        {"service_type": "daycare", "is_default": True, "active": True}, {"_id": 0}
    )
    if not svc:
        svc = await _db.services.find_one(
            {"service_type": "daycare", "active": True, "$or": [{"is_addon": {"$ne": True}}, {"is_addon": {"$exists": False}}]},
            {"_id": 0}, sort=[("is_default", -1), ("name", 1)],
        )
    if not svc:
        return out
    list_price = float(svc.get("base_price") or 0)
    rate = list_price
    if client_id:
        try:
            pricing = await resolve_client_price(client_id, "service", svc.get("id") or "", list_price)
            rate = float(pricing.get("effective_price", list_price) or 0)
        except Exception:
            rate = list_price
    if rate <= 0:
        return out
    return {
        "applies": True,
        "amount": round(rate, 2),
        "unit_price": round(rate, 2),
        "service_id": svc.get("id"),
        "service_name": svc.get("name") or "Daycare",
    }


async def resolve_client_price(
    client_id: Optional[str],
    target_kind: str,
    target_code: str,
    list_price: float,
) -> dict:
    """Return `{effective_price, list_price, override_id, override_row,
    pricing_source, tier_id, tier_name}` for the given client + catalog item.

    Precedence (highest first), matching the "grandfathered pricing"
    requirement exactly:
      1. An active INDIVIDUAL client override for this exact item.
      2. An active PRICING-TIER override for this exact item, if the client
         is assigned to an active tier (see `clients.pricing_tier_id`) —
         only consulted when no individual override applies.
      3. The standard list price.

    When no active override/tier price exists, effective == list. Used by
    booking-create, credit-pack-sell, and Shop cart pricing so every one of
    these paths shares the exact same source of truth — never a second,
    competing pricing formula."""
    out = {
        "effective_price": float(list_price or 0),
        "list_price": float(list_price or 0),
        "override_id": None,
        "override_row": None,
        "pricing_source": "standard",
        "tier_id": None,
        "tier_name": None,
    }
    if not client_id or not target_code:
        return out
    # A key can legitimately have retained revoked history plus one newer
    # active row. Never let MongoDB natural order decide which lifecycle row
    # wins: inspect the exact-key history and choose the currently applicable
    # row deterministically. This is the canonical path used by Quick Check-In,
    # booking creation, checkout refresh, packs, and the client-price APIs.
    override_rows = await _db.price_overrides.find(
        {"client_id": client_id, "target_kind": target_kind, "target_code": target_code},
        {"_id": 0},
    ).to_list(500)
    row = pick_applicable_price_override(override_rows)
    if row:
        out["effective_price"] = float(row.get("override_price") or 0)
        out["override_id"] = row.get("id")
        out["override_row"] = row
        out["pricing_source"] = "client_override"
        return out
    # No individual override — fall through to the client's pricing tier, if any.
    client = await _db.clients.find_one({"id": client_id}, {"_id": 0, "pricing_tier_id": 1})
    tier_id = (client or {}).get("pricing_tier_id")
    if tier_id:
        tier = await _db.pricing_tiers.find_one({"id": tier_id, "active": True}, {"_id": 0, "name": 1})
        if tier:
            tier_row = await _db.pricing_tier_prices.find_one(
                {"tier_id": tier_id, "target_kind": target_kind, "target_code": target_code},
                {"_id": 0},
            )
            if tier_row:
                out["effective_price"] = float(tier_row.get("override_price") or 0)
                out["pricing_source"] = "tier"
                out["tier_id"] = tier_id
                out["tier_name"] = tier.get("name")
    return out


async def resolve_addon_snapshots(
    client_id: Optional[str],
    addon_service_ids: List[str],
    base_service_type: str,
) -> List[Dict[str, Any]]:
    """Sprint 110an — turn a list of add-on `service_id`s into the snapshot
    dicts we store on `booking.add_ons`. Validates each one:
      • exists and is active,
      • has `is_addon=True`,
      • base_service_type is in its `addon_for` list.
    Resolves the per-client legacy-pricing override per add-on so
    grandfathered customers keep their locked rate. Raises 400 on any
    invalid id so we never silently drop a paid add-on at booking time.
    """
    if not addon_service_ids:
        return []
    addons = await _db.services.find(
        {"id": {"$in": list(addon_service_ids)}, "active": True},
        {"_id": 0},
    ).to_list(100)
    by_id = {a["id"]: a for a in addons}
    snapshots: List[Dict[str, Any]] = []
    for aid in addon_service_ids:
        svc = by_id.get(aid)
        if not svc:
            raise HTTPException(status_code=400, detail=f"Unknown / inactive add-on `{aid}`")
        if not svc.get("is_addon"):
            raise HTTPException(status_code=400, detail=f"Service `{svc.get('name')}` is not flagged as an add-on")
        eligible = svc.get("addon_for") or []
        if eligible and base_service_type not in eligible:
            raise HTTPException(
                status_code=400,
                detail=f"`{svc.get('name')}` isn't eligible as an add-on for {base_service_type} services",
            )
        list_price = float(svc.get("base_price") or 0)
        pricing = await resolve_client_price(client_id, "service", aid, list_price)
        snapshots.append({
            "service_id": aid,
            "name": svc.get("name") or "Add-on",
            "icon": svc.get("icon") or "fa-plus",
            "price": pricing["effective_price"],
            "list_price": list_price,
            "price_override_id": pricing["override_id"],
            "qty": 1,
            "added_at": _now_iso_fn(),
        })
    return snapshots

