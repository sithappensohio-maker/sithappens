"""Checkout quotes: the boarding base a stay is charged, the late-pickup daycare
fee, the money modifiers and the group-row factor, and the base-service quote.

These are the functions checkout, the previews and the group checkout all price
from, so they live together and read the same rules (step 2 of the checkout
pricing move out of server.py). The canonical math is in domains/pricing; these
are the thin wrappers and the boarding base that adds them up."""
from typing import Any, Dict, Optional

from domains.bookings import friends_family
from domains.pricing import services as pricing_domain_services
from domains.pricing.boarding_units import (
    DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF, _billable_boarding_units, _boarding_full_day_cutoff_from_rules,
)


_server_globals: dict = {}


def configure(*, server_globals: dict) -> None:
    """Called once by server.py with its globals. Server-owned helpers are looked
    up at call time through _g, so a server name rebound later (db, a helper) is seen."""
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


async def _boarding_late_pickup_daycare_fee(
    client_id: Optional[str],
    pickup_time: Optional[str],
    cutoff_time: Optional[str] = DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF,
) -> Dict[str, Any]:
    """Facade; canonical late-pickup daycare fee lives in domains.pricing.

    Pickup after the boarding checkout time bills one full daycare day at the
    default daycare service price (honoring the client's grandfathered rate).
    Callers apply the additional-dog 50% row factor themselves, exactly like
    the boarding base. `amount` is 0.0 when the pickup is on time, when no
    pickup time is stored, or when no daycare service is configured.
    """
    return await pricing_domain_services.late_pickup_daycare_fee(
        client_id=client_id, pickup_time=pickup_time, cutoff_time=cutoff_time,
    )

async def _boarding_auto_base(booking: dict, settings: dict) -> float:
    """This row's auto-computed boarding base: saved unit rate × nights, plus
    the late-pickup daycare fee, times the group-row discount factor. Shared
    by checkout repair, modifier previews, and the manual-override audit
    stamp so they can never disagree. 0.0 for non-boarding/unusable rows."""
    if booking.get("service_type") != "boarding" or not booking.get("end_date"):
        return 0.0
    ps = booking.get("pricing_snapshot") or {}
    unit_rate = float(ps.get("unit_price") or booking.get("unit_price") or 0)
    if unit_rate <= 0:
        return 0.0
    cutoff_time = ps.get("pickup_cutoff_time") or _boarding_full_day_cutoff_from_rules(settings.get("booking_rules") or {})
    pickup_clock = booking.get("pickup_time") or cutoff_time
    units = _billable_boarding_units(
        booking.get("date"), booking.get("end_date"), pickup_clock,
        legacy_minimum=1, cutoff_time=cutoff_time,
    )
    fee = await _boarding_late_pickup_daycare_fee(friends_family.payer_id(booking), pickup_clock, cutoff_time)
    return round((unit_rate * units + float(fee.get("amount") or 0)) * _group_row_price_factor(booking), 2)

def _money_modifier_breakdown(
    booking: Dict[str, Any],
    base_amount: float,
    settings: Dict[str, Any],
    checkout_ts: Optional[str] = None,
) -> Dict[str, Any]:
    """Facade; canonical seasonal/late-pickup modifier math lives in domains.pricing."""
    return pricing_domain_services.money_modifier_breakdown(booking, base_amount, settings, checkout_ts)

def _group_row_price_factor(booking: dict) -> float:
    """Facade; canonical group-row pricing factor lives in domains.pricing."""
    return pricing_domain_services.group_row_price_factor(booking)

async def _quote_base_service_price(
    *,
    client_id: Optional[str],
    service_type: str,
    start_date: str,
    end_date: Optional[str] = None,
    pickup_time: Optional[str] = None,
    pickup_cutoff_time: Optional[str] = DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF,
    service_id: Optional[str] = None,
    legacy_boarding_minimum: int = 0,
    grooming_type: Optional[str] = None,
) -> Dict[str, Any]:
    """Compatibility facade; canonical quote pricing lives in domains.pricing."""
    return await pricing_domain_services.quote_base_service_price(
        client_id=client_id, service_type=service_type, start_date=start_date,
        end_date=end_date, pickup_time=pickup_time, pickup_cutoff_time=pickup_cutoff_time,
        service_id=service_id, legacy_boarding_minimum=legacy_boarding_minimum,
        grooming_type=grooming_type,
    )


async def _compute_multi_dog_discount(booking: dict, *, exclude_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Sprint 110 — return the dollar discount that should apply to the
    booking being checked out, given the multi-dog household setting.

    Sprint 110h — discount config is now PER SERVICE TYPE (daycare/boarding/
    training/grooming/photography all configurable separately). The legacy
    flat fields are read as the fallback so existing installs keep working.

    Rules:
      - Master toggle must be on.
      - Service-specific entry must be enabled with a value > 0.
      - Discount applies ONLY if the same client has at least one other
        booking on the same date that's already been checked out (status
        completed, has checked_out_at) and is NOT this booking.
      - First dog full price → subsequent dogs (in checkout order) discounted.
    """
    settings = await _g("get_settings")()
    service_type = booking.get("service_type") or "daycare"
    cfg = _g("_multi_dog_discount_config_for")(settings, service_type)
    if not cfg:
        return None
    mode = (cfg.get("mode") or "percent").lower()
    if mode not in ("percent", "flat"):
        return None
    value = float(cfg.get("value") or 0)
    if value <= 0:
        return None

    client_id = booking.get("client_id")
    booking_date = booking.get("date")
    if not client_id or not booking_date:
        return None

    # A sibling is another dog of this family on the SAME service that day
    # (a daycare visit is not a second dog for a grooming, and a dog is not
    # its own sibling). Legacy daycare rows with no service_type still count.
    sib_service = booking.get("service_type") or "daycare"
    sibling_q = {
        "client_id": client_id,
        "date": booking_date,
        "service_type": {"$in": [sib_service] + ([None, ""] if sib_service == "daycare" else [])},
        "status": "completed",
        "checked_out_at": {"$exists": True, "$ne": None},
        # Only this family's own dogs — never one another family paid for (a friend's dog on a friends & family group).
        "bill_to_client_id": {"$in": [None, "", client_id]},
        # A sibling discounted at its own checkout doesn't count: a reopened
        # full-price dog must not end up discounted too (audit #14).
        "$or": [{"multi_dog_discount": None}, {"multi_dog_discount.pre_applied": True}],
    }
    if exclude_id:
        sibling_q["id"] = {"$ne": exclude_id}
    if booking.get("dog_id"):
        sibling_q["dog_id"] = {"$ne": booking["dog_id"]}
    sibling_count = await _g("db").bookings.count_documents(sibling_q)
    if sibling_count < 1:
        return None

    # Discount only the service/base portion for the additional dog. Add-ons
    # stay full price so nail trims, baths, etc. do not get accidentally cut.
    gross_price = float(booking.get("actual_price") or 0)
    addon_total = _g("_booking_addon_total_from")(booking)
    base_price = max(0.0, gross_price - addon_total)
    if base_price <= 0:
        return None
    amount = _g("_discount_amount_for_extra_dogs")(base_price, cfg, additional_dogs=1)
    if amount <= 0:
        return None
    label = cfg.get("label") or "Additional dog discount"
    return {
        "amount": amount,
        "mode": mode,
        "value": value,
        "label": label,
        "service_type": service_type,
        "sibling_count": sibling_count,
        "discount_base_price": round(base_price, 2),
    }


async def _is_early_checkout_price(booking_id: str, body: "CheckoutIn", user: dict) -> bool:
    """The price a boarding dog leaving early is sent with is the server's own quote (not an override)."""
    q = await _g("early_checkout_quote")(booking_id, user) if not body.base_price_reason else {}
    return bool(q.get("applicable")) and abs(float(body.base_price) - float(q.get("base_price") or 0)) < 0.005


async def _refresh_booking_price_for_current_override(booking: Dict[str, Any]) -> Dict[str, Any]:
    """Real bug fix — a booking's estimated_price/unit_price/pricing_snapshot
    are captured ONCE, at creation time. Checkout deliberately trusts that
    snapshot afterward (see _check_out_locked's comments) so a later GENERAL
    price increase on the catalog never silently overcharges a booking made
    under an older, lower rate — that protection is correct and untouched
    here.

    But that same snapshot-trust was also swallowing the opposite, much more
    common case: a client-specific price override added or changed AFTER a
    one-off/walk-in booking already existed (the normal order of operations
    for an ad-hoc visit) never applied at checkout — the client kept getting
    billed whatever price existed at booking time, base price included, even
    though staff had since set up their correct rate. Confirmed by direct
    reproduction: booking created at $30 (no override yet) → $25 client
    override added → checkout still showed $30.

    Fix, scoped narrowly to avoid touching the general-price-increase
    protection: only refreshes when the client's CURRENTLY active
    service-price override differs from whatever the snapshot captured
    (added, changed, or replaced) — never when there's simply no override
    either then or now (that's the plain catalog rate, left alone), and
    never a currently-REVOKED override retroactively raising the price back
    up. Returns a new dict; never mutates the caller's or persists anything
    itself — call sites decide whether/how to persist the refreshed values."""
    if booking.get("actual_price"):
        return booking  # already charged — never touch a completed checkout's numbers
    client_id = friends_family.payer_id(booking)  # the payer's rates on a friends & family visit
    ps = booking.get("pricing_snapshot") or {}
    service_id = ps.get("service_id") or booking.get("service_id")
    if not client_id or not service_id:
        return booking
    svc = await _g("db").services.find_one({"id": service_id}, {"_id": 0, "base_price": 1})
    if not svc:
        return booking
    pricing = await _g("resolve_client_price")(client_id, "service", service_id, float(svc.get("base_price") or 0))
    current_override_id = pricing.get("override_id")
    if pricing.get("pricing_source") == "standard":
        # No client-specific pricing active right now (neither an individual
        # override nor a tier price) — never touches a plain-catalog-priced
        # booking, and never retroactively raises the price back up after a
        # revocation. NOTE: keyed off pricing_source, not override_id — tier
        # pricing resolves with override_id=None and previously fell through
        # here, leaving tier clients billed the stale snapshot rate.
        return booking
    old_unit = float(ps.get("unit_price") or booking.get("unit_price") or 0)
    new_unit = round(float(pricing.get("effective_price") or 0), 2)
    if old_unit <= 0 or new_unit == old_unit:
        # Covers BOTH "already reflects the current override" (same id, same
        # price) AND "the override row was edited but happens to land on the
        # same amount" — either way there's nothing to refresh. Comparing
        # the resolved PRICE (not the override id) is what correctly
        # catches an existing override being edited to a new amount after
        # the booking was made, not just a brand-new override appearing.
        return booking
    addons = _g("_booking_addon_total_from")(booking)
    old_base = max(0.0, round(float(booking.get("estimated_price") or 0) - addons, 2))
    units = old_base / old_unit
    new_base = round(new_unit * units, 2)
    refreshed = dict(booking)
    refreshed["unit_price"] = new_unit
    refreshed["estimated_price"] = round(new_base + addons, 2)
    refreshed["price_override_id"] = current_override_id
    refreshed["preferred_rate_applied"] = True
    refreshed["price_source"] = pricing.get("pricing_source")
    refreshed["price_label"] = "Preferred client rate"
    refreshed["pricing_snapshot"] = {
        **ps,
        "unit_price": new_unit,
        "price_override_id": current_override_id,
        "preferred_rate_applied": True,
        "price_source": pricing.get("pricing_source"),
        "price_refreshed_at": _g("now_iso")(),
    }
    return refreshed
