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
