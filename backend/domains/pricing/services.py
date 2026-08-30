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
_get_settings_fn = None
_clock_minutes_fn = None
_boarding_cutoff_from_rules_fn = None
_business_tz = None
_now_iso_fn = None
_default_boarding_cutoff = None
_UNSET = object()


def configure(*, db, business_today, billable_boarding_units, now_iso, default_boarding_cutoff, boarding_pickup_day_units=None, get_settings=None, clock_minutes=None, boarding_cutoff_from_rules=None, business_tz=None) -> None:
    global _db, _business_today_fn, _billable_boarding_units_fn, _boarding_pickup_day_units_fn, _get_settings_fn, _clock_minutes_fn, _boarding_cutoff_from_rules_fn, _business_tz, _now_iso_fn, _default_boarding_cutoff
    _db = db
    _business_today_fn = business_today
    _billable_boarding_units_fn = billable_boarding_units
    _boarding_pickup_day_units_fn = boarding_pickup_day_units
    _get_settings_fn = get_settings
    _clock_minutes_fn = clock_minutes
    _boarding_cutoff_from_rules_fn = boarding_cutoff_from_rules
    _business_tz = business_tz
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


def multi_dog_discount_config_for(settings: dict, service_type: str) -> Optional[Dict[str, Any]]:
    """Return the active multi-dog discount config for a service type.

    Daycare/boarding read the NEW `multi_dog_discount_core` settings block
    (per-service {enabled, mode, value, label}), defaulting to the historical
    Sit Happens rule of 50% off the same base service rate as the first dog.
    Legacy `multi_dog_discount_by_service` / `additional_dog_rate` values
    (e.g. old flat $12.50 configs) are still deliberately IGNORED for these
    two services — only the owner explicitly saving the new block changes
    their discount, so stale junk can never underquote.

    For non-core services, preserve the older configurable behavior.
    """
    service_type = service_type or "daycare"

    if service_type in ("daycare", "boarding"):
        # The master switch turns off every multi-dog discount, core included.
        if (settings or {}).get("multi_dog_discount_enabled") is False:
            return None
        core = ((settings or {}).get("multi_dog_discount_core") or {}).get(service_type) or {}
        if core.get("enabled") is False:
            return None
        mode = core.get("mode") if core.get("mode") in ("percent", "flat") else "percent"
        try:
            value = float(core.get("value")) if core.get("value") is not None else 50.0
        except Exception:
            value = 50.0
        if mode == "percent":
            value = max(0.0, min(100.0, value))
        else:
            value = max(0.0, value)
        if value <= 0:
            return None
        return {
            "enabled": True,
            "mode": mode,
            "value": value,
            "label": core.get("label") or "Additional dog discount",
            "source": "settings_core" if core else "core_default_50",
        }

    # Other service types can still be enabled manually through settings, but
    # they do not receive the Sit Happens default sibling discount.
    per_service = (settings or {}).get("multi_dog_discount_by_service") or {}
    cfg = per_service.get(service_type)
    if cfg:
        if not cfg.get("enabled"):
            return None
        return {
            "enabled": True,
            "mode": cfg.get("mode") or "percent",
            "value": float(cfg.get("value") or 0),
            "label": cfg.get("label") or "Additional dog discount",
            "source": "settings",
        }
    # No per-service entry for this service type — fall back to the older,
    # single flat config (multi_dog_discount_enabled/mode/value/label) so
    # installs that never migrated to the granular per-service schema keep
    # working for non-core services, exactly as documented above.
    if not (settings or {}).get("multi_dog_discount_enabled"):
        return None
    legacy_value = float((settings or {}).get("multi_dog_discount_value") or 0)
    if legacy_value <= 0:
        return None
    return {
        "enabled": True,
        "mode": (settings or {}).get("multi_dog_discount_mode") or "percent",
        "value": legacy_value,
        "label": (settings or {}).get("multi_dog_discount_label") or "Additional dog discount",
        "source": "settings_legacy",
    }


def discount_amount_for_extra_dogs(raw_additional_dog_base: float, cfg: Optional[Dict[str, Any]], additional_dogs: int = 1) -> float:
    if not cfg or raw_additional_dog_base <= 0 or additional_dogs <= 0:
        return 0.0
    mode = (cfg.get("mode") or "percent").lower()
    value = float(cfg.get("value") or 0)
    if value <= 0:
        return 0.0
    if mode == "percent":
        pct = max(0.0, min(100.0, value))
        return round(raw_additional_dog_base * pct / 100.0, 2)
    if mode == "flat":
        return round(min(raw_additional_dog_base, value * max(1, additional_dogs)), 2)
    return 0.0


def group_row_price_factor(booking: dict) -> float:
    """Dollar multiplier for a booking row inside a multi-dog group.

    First-dog rows are 1.0. Additional-dog rows apply the sibling discount
    that was pre-applied at booking time (stored on booking.multi_dog_discount,
    driven by the configurable multi_dog_discount_core settings). Percent mode
    converts directly to a factor; unusable/legacy/flat-mode values fall back
    to the historical 0.5. Credits do NOT use this — the 0.5-credit-per-extra-
    dog rule is deliberately separate from dollar discounts.
    """
    ps = booking.get("pricing_snapshot") or {}
    md = booking.get("multi_dog_discount") or {}
    is_extra = ps.get("group_dog_index") not in (None, 0) or bool(md.get("pre_applied"))
    if not is_extra:
        return 1.0
    if (md.get("mode") or "percent") == "percent":
        try:
            value = float(md.get("value"))
            if 0 < value <= 100:
                return round(1.0 - value / 100.0, 4)
        except Exception:
            pass
    return 0.5


def clock_12h(hhmm: Optional[str]) -> str:
    """'17:00' → '5:00 PM' for client-facing policy text."""
    m = _clock_minutes_fn(hhmm) if _clock_minutes_fn else None
    if m is None:
        return str(hhmm or "")
    hours, minutes = divmod(m, 60)
    suffix = "AM" if hours < 12 else "PM"
    display_h = hours % 12 or 12
    return f"{display_h}:{minutes:02d} {suffix}"


async def stay_policy_payload() -> Dict[str, Any]:
    """Client-facing daycare/boarding policy, GENERATED from the live pricing
    settings so the posted policy can never drift from what checkout charges.
    Served publicly via GET /policies/stay and reused by confirmation emails.
    Every number here comes from the same settings + catalog the pricing
    engine reads."""
    _configured()
    s = await _get_settings_fn()
    rules = s.get("booking_rules") or {}
    cutoff = _boarding_cutoff_from_rules_fn(rules) if _boarding_cutoff_from_rules_fn else "17:00"
    cutoff_12 = clock_12h(cutoff)
    policy = late_pickup_rules(s)

    async def _default_price(service_type: str) -> Optional[float]:
        svc = await _db.services.find_one(
            {"service_type": service_type, "is_default": True, "active": True}, {"_id": 0, "base_price": 1}
        ) or await _db.services.find_one(
            {"service_type": service_type, "active": True, "$or": [{"is_addon": {"$ne": True}}, {"is_addon": {"$exists": False}}]},
            {"_id": 0, "base_price": 1}, sort=[("is_default", -1), ("name", 1)],
        )
        return float(svc.get("base_price") or 0) if svc else None

    boarding_price = await _default_price("boarding")
    daycare_price = await _default_price("daycare")
    md_boarding = multi_dog_discount_config_for(s, "boarding")
    md_daycare = multi_dog_discount_config_for(s, "daycare")

    def _md_line(cfg) -> Optional[str]:
        if not cfg:
            return None
        if (cfg.get("mode") or "percent") == "percent":
            return f"Additional dogs from the same household are {cfg['value']:g}% off."
        return f"Additional dogs from the same household get ${cfg['value']:.2f} off."

    boarding_lines = []
    if boarding_price:
        boarding_lines.append(f"Boarding is billed per night (${boarding_price:.2f}/night).")
    grace = policy["grace_minutes"]
    grace_note = f" (with a {grace}-minute grace window)" if grace else ""
    boarding_lines.append(f"Checkout time is {cutoff_12} — pickups at or before {cutoff_12}{grace_note} are free.")
    if policy["mode"] == "full_daycare_day" and daycare_price:
        boarding_lines.append(f"Pickups after {cutoff_12} add one full daycare day (${daycare_price:.2f} per dog).")
    elif policy["mode"] == "half_daycare_day" and daycare_price:
        boarding_lines.append(f"Pickups after {cutoff_12} add a half daycare day (${daycare_price * 0.5:.2f} per dog).")
    elif policy["mode"] == "flat_fee" and policy["flat_fee"] > 0:
        boarding_lines.append(f"Pickups after {cutoff_12} add a ${policy['flat_fee']:.2f} late-pickup fee per dog.")
    else:
        boarding_lines.append(f"No extra charge for pickups after {cutoff_12}.")
    md_b = _md_line(md_boarding)
    if md_b:
        boarding_lines.append(md_b)
    boarding_note = str(rules.get("boarding_policy_note") or "").strip()
    if boarding_note:
        boarding_lines.append(boarding_note)

    daycare_lines = []
    if daycare_price:
        daycare_lines.append(f"Daycare is ${daycare_price:.2f} per day.")
    if rules.get("stay_pricing_enabled", True):
        try:
            half_hours = float(rules.get("daycare_half_day_max_hours", 5))
            half_pct = float(rules.get("half_day_pct", 50))
            daycare_lines.append(
                f"Stays of {half_hours:g} hours or less bill as a half day ({half_pct:g}% of the full-day price)."
            )
        except Exception:
            pass
    md_d = _md_line(md_daycare)
    if md_d:
        daycare_lines.append(md_d)
    daycare_note = str(rules.get("daycare_policy_note") or "").strip()
    if daycare_note:
        daycare_lines.append(daycare_note)

    return {
        "boarding": {
            "checkout_time": cutoff,
            "checkout_time_display": cutoff_12,
            "grace_minutes": grace,
            "late_pickup_mode": policy["mode"],
            "late_pickup_flat_fee": policy["flat_fee"],
            "daycare_day_price": daycare_price,
            "nightly_price": boarding_price,
            "lines": boarding_lines,
        },
        "daycare": {
            "day_price": daycare_price,
            "lines": daycare_lines,
        },
    }


LATE_PICKUP_MODES = ("full_daycare_day", "half_daycare_day", "flat_fee", "none")


def late_pickup_rules(settings: Optional[dict]) -> Dict[str, Any]:
    """Normalize the admin-configured boarding late-pickup policy.

    booking_rules keys (all optional; defaults preserve the shipped
    industry-standard behavior):
      • boarding_late_pickup_mode: full_daycare_day (default) |
        half_daycare_day | flat_fee | none
      • boarding_late_pickup_flat_fee: dollars per dog when mode=flat_fee
      • boarding_late_pickup_grace_minutes: minutes past the checkout time
        before the charge triggers (default 0)
    """
    rules = (settings or {}).get("booking_rules") or {}
    mode = str(rules.get("boarding_late_pickup_mode") or "full_daycare_day")
    if mode not in LATE_PICKUP_MODES:
        mode = "full_daycare_day"
    try:
        flat_fee = max(0.0, float(rules.get("boarding_late_pickup_flat_fee") or 0))
    except Exception:
        flat_fee = 0.0
    try:
        grace = max(0, int(rules.get("boarding_late_pickup_grace_minutes") or 0))
    except Exception:
        grace = 0
    return {"mode": mode, "flat_fee": flat_fee, "grace_minutes": grace}


async def late_pickup_daycare_fee(
    *,
    client_id: Optional[str],
    pickup_time: Optional[str],
    cutoff_time: Any = _UNSET,
) -> Dict[str, Any]:
    """One dog's late-pickup charge at the FULL (first-dog) rate.

    Boarding's pickup-day rule (industry-standard model): pickup at or before
    the boarding checkout time (plus the configured grace window) is free;
    pickup after it bills per the admin-configured charge mode — a full or
    half daycare day at the default daycare service price (honoring the
    client's grandfathered rate), a flat fee, or nothing. Callers apply the
    additional-dog discount row factor themselves, exactly like the boarding
    base. Returns amount 0.0 when the pickup is on time, no pickup time is
    stored, the mode is none, no daycare service exists, or the rule helper
    isn't wired (minimal test harnesses).
    """
    _configured()
    if cutoff_time is _UNSET:
        cutoff_time = _default_boarding_cutoff
    out = {"applies": False, "amount": 0.0, "unit_price": 0.0, "service_id": None, "service_name": None, "mode": "none"}
    if _boarding_pickup_day_units_fn is None:
        return out
    settings = None
    if _get_settings_fn is not None:
        try:
            settings = await _get_settings_fn()
        except Exception:
            settings = None
    policy = late_pickup_rules(settings)
    if policy["mode"] == "none":
        return out
    if float(_boarding_pickup_day_units_fn(pickup_time, cutoff_time, policy["grace_minutes"]) or 0) <= 0:
        return out
    if policy["mode"] == "flat_fee":
        if policy["flat_fee"] <= 0:
            return out
        return {
            "applies": True,
            "amount": round(policy["flat_fee"], 2),
            "unit_price": round(policy["flat_fee"], 2),
            "service_id": None,
            "service_name": "Late pickup fee",
            "mode": "flat_fee",
        }
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
    day_factor = 0.5 if policy["mode"] == "half_daycare_day" else 1.0
    return {
        "applies": True,
        "amount": round(rate * day_factor, 2),
        "unit_price": round(rate, 2),
        "service_id": svc.get("id"),
        "service_name": svc.get("name") or "Daycare",
        "mode": policy["mode"],
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



def money_modifier_breakdown(
    booking: Dict[str, Any],
    base_amount: float,
    settings: Dict[str, Any],
    checkout_ts: Optional[str] = None,
) -> Dict[str, Any]:
    """Return one transparent seasonal/late-pickup pricing breakdown.

    Shared by checkout and the checkout preview endpoint so the operator sees
    the same number the backend will save. (The per-15-minute late fee here is
    the "client shows up after their DECLARED pickup time" charge, distinct
    from the boarding late-pickup daycare day.)
    """
    from datetime import datetime, timezone

    base = round(max(0.0, float(base_amount or 0)), 2)
    amount = base
    money = ((settings.get("day_to_day") or {}).get("money") or {})
    seasonal = ((settings.get("day_to_day") or {}).get("seasonal") or {})
    multiplier = 1.0
    seasonal_label = None
    bdate = booking.get("date") or ""
    try:
        for h in (seasonal.get("holiday_surcharges") or []):
            if h.get("date") == bdate:
                multiplier = float(h.get("multiplier", 1) or 1)
                seasonal_label = h.get("label") or "Holiday surcharge"
                break
        else:
            for row in (seasonal.get("peak_season_ranges") or []):
                if (row.get("start") or "") <= bdate <= (row.get("end") or "9999"):
                    multiplier = float(row.get("multiplier", 1) or 1)
                    seasonal_label = row.get("label") or "Peak-season surcharge"
                    break
    except Exception:
        multiplier = 1.0
        seasonal_label = None
    amount = round(amount * multiplier, 2)
    seasonal_amount = round(amount - base, 2)

    late_fee = 0.0
    try:
        ps = booking.get("pricing_snapshot") or {}
        extra_group_dog = ps.get("group_dog_index") not in (None, 0) or bool(
            (booking.get("multi_dog_discount") or {}).get("pre_applied")
        )
        per_15 = float(money.get("late_pickup_fee_per_15min", 0) or 0)
        if per_15 > 0 and not extra_group_dog:
            grace = int(money.get("late_pickup_grace_min", 10) or 0)
            pickup_time = (booking.get("pickup_time") or "").strip()
            pickup_date = booking.get("end_date") if booking.get("service_type") == "boarding" else booking.get("date")
            if pickup_time and pickup_date:
                declared = datetime.fromisoformat(f"{pickup_date}T{pickup_time}:00").replace(tzinfo=_business_tz)
                checkout_raw = checkout_ts or _now_iso_fn()
                checked = datetime.fromisoformat(checkout_raw.replace("Z", "+00:00"))
                if checked.tzinfo is None:
                    checked = checked.replace(tzinfo=timezone.utc)
                minutes_late = max(0.0, (checked.astimezone(_business_tz) - declared).total_seconds() / 60.0 - grace)
                if minutes_late > 0:
                    blocks = int(minutes_late // 15) + (1 if minutes_late % 15 else 0)
                    late_fee = round(blocks * per_15, 2)
                    amount = round(amount + late_fee, 2)
    except Exception:
        late_fee = 0.0

    before_rounding = amount
    if money.get("round_to_dollar"):
        amount = float(round(amount))
    rounding_adjustment = round(amount - before_rounding, 2)
    return {
        "base_before": base,
        "seasonal_multiplier": multiplier,
        "seasonal_label": seasonal_label,
        "seasonal_amount": seasonal_amount,
        "late_pickup_fee": late_fee,
        "round_to_dollar": bool(money.get("round_to_dollar")),
        "rounding_adjustment": rounding_adjustment,
        "total_after": round(amount, 2),
        "modifier_total": round(amount - base, 2),
    }


def credit_units_required(service_type: str, start: str, end: Optional[str], dog_count: int = 1, pickup_time: Optional[str] = None, pickup_cutoff_time: Any = _UNSET) -> float:
    """Credit units are intentionally separate from dollars.

    Sit Happens rule for daycare/boarding credits mirrors cash pricing:
      • first dog = 1.0 credit per billable unit
      • each additional dog = 0.5 credit per billable unit

    Packs are still SOLD as whole credits, but balances may spend down in .5
    increments for multi-dog households. Existing whole-number balances remain
    valid because Mongo stores numeric fields without a migration.
    """
    if pickup_cutoff_time is _UNSET:
        pickup_cutoff_time = _default_boarding_cutoff
    dogs = max(1, int(dog_count or 1))
    if service_type == "boarding":
        units = _billable_boarding_units_fn(start, end, pickup_time, legacy_minimum=1, cutoff_time=pickup_cutoff_time)
        dog_weight = 1.0 + (0.5 * max(0, dogs - 1))
        return round(float(units) * dog_weight, 2)
    if service_type == "daycare":
        dog_weight = 1.0 + (0.5 * max(0, dogs - 1))
        return round(dog_weight, 2)
    if service_type == "training":
        return float(dogs)
    return 0.0


def service_base_credit_units_for_booking(booking: dict) -> float:
    """Return service credit units using the same rule as cash pricing.

    Boarding credits cover overnight nights only; the late-pickup daycare fee
    is billed as cash, never credits. Recalculated from the stored dates so
    legacy snapshots saved under the old pickup-day-care rule cannot
    over-deduct credits.
    """
    if booking.get("service_type") == "boarding" and booking.get("end_date"):
        ps = booking.get("pricing_snapshot") or {}
        is_extra_group_dog = ps.get("group_dog_index") not in (None, 0) or bool((booking.get("multi_dog_discount") or {}).get("pre_applied"))
        cutoff_time = ps.get("pickup_cutoff_time") or _default_boarding_cutoff
        units = _billable_boarding_units_fn(
            booking.get("date"), booking.get("end_date"),
            booking.get("pickup_time") or cutoff_time,
            legacy_minimum=1,
            cutoff_time=cutoff_time,
        )
        return round(units * (0.5 if is_extra_group_dog else 1.0), 2)
    try:
        snap = float(booking.get("credit_units_required") or 0)
        if snap > 0:
            return round(snap, 2)
    except Exception:
        pass
    return credit_units_required(
        booking.get("service_type") or "daycare",
        booking.get("date"),
        booking.get("end_date"),
        dog_count=1,
        pickup_time=booking.get("pickup_time"),
    )
