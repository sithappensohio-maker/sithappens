"""How a new booking's status is decided — the one implementation.

This lives outside server.py so there is exactly one place the precedence is
written down, and so the client-facing projection and the row actually written
to Mongo cannot drift apart.

They did drift. The booking wizard's copy was hardcoded to "Your booking will
be reviewed and approved by Sit Happens", while daycare — `instant_book: True`
in the shipped defaults — was created as ``approved``. The customer was told
their request was going to be reviewed and then shown a booking marked
CONFIRMED, with no way to tell which was true.
"""

from typing import Optional

from . import payment_timing

CONFIRMED = "approved"
REQUESTED = "pending"


def booking_outcome(svc_rules: dict, *, auto_approve: bool = False, is_admin: bool = False) -> str:
    """Resolve the status a new booking of this service will be created with.

    ``svc_rules`` is the per-service row already merged with its category
    default (server._booking_flow_rules_for). Precedence:

      1. staff bookings are approved outright
      2. an explicit ``require_approval`` wins over everything else
      3. ``instant_book`` confirms
      4. otherwise fall back to the global ``auto_approve`` switch

    Note the asymmetry in 2/3 is deliberate and predates this module: a service
    row may carry both flags, and "this one needs a human" is the safer of the
    two to honour.
    """
    if is_admin:
        return CONFIRMED
    rules = svc_rules or {}
    if rules.get("require_approval") is True:
        return REQUESTED
    if rules.get("instant_book") is True:
        return CONFIRMED
    return CONFIRMED if auto_approve else REQUESTED


def books_instantly(svc_rules: dict, *, auto_approve: bool = False) -> bool:
    """True when a client booking this service gets a confirmed slot, not a request."""
    return booking_outcome(svc_rules, auto_approve=auto_approve) == CONFIRMED


def project_service(item: dict, svc_rules: dict, *, auto_approve: bool = False,
                    payment: dict | None = None) -> dict:
    """Attach everything a client surface needs to describe booking this service.

    ``books_as`` is what the booking will actually be created as; ``payment``
    is when the customer is expected to pay. Both are resolved server-side so
    the wizard, the review screen and My Bookings all read one answer instead
    of each inventing copy. Mutates and returns the row.
    """
    item["books_as"] = booking_outcome(svc_rules, auto_approve=auto_approve)
    item["booking_flow"] = {
        "instant_book": bool(svc_rules.get("instant_book")),
        "require_approval": bool(svc_rules.get("require_approval")),
        "client_booking_enabled": svc_rules.get("client_booking_enabled") is not False,
        "same_day": svc_rules.get("same_day"),
        "min_lead_hours": svc_rules.get("min_lead_hours"),
        "max_advance_days": svc_rules.get("max_advance_days"),
    }
    if payment is not None:
        item["payment"] = payment
    return item


def default_controls() -> dict:
    """Booking rules at two levels.

    ``per_service`` keeps the historical category defaults (daycare, boarding,
    training, etc.). ``per_catalog_service`` stores optional overrides keyed by
    the actual service catalog row id. This lets two services in the same
    category — for example a Private Lesson and a Service Dog Evaluation — use
    different booking rules without creating a second booking system.
    """
    return {
        "per_service": {
            # `payment_timing` answers "when am I expected to pay?" —
            # settings.payment_options separately answers "how can I pay?".
            # All start at none_at_booking because that is what booking
            # actually does today. See domains/payment_timing.
            "daycare":     {"require_approval": False, "instant_book": True,  "same_day": True,  "min_lead_hours": None, "max_advance_days": None, "payment_timing": payment_timing.DEFAULT},
            "boarding":    {"require_approval": True,  "instant_book": False, "same_day": False, "min_lead_hours": None, "max_advance_days": None, "payment_timing": payment_timing.DEFAULT},
            "training":    {"require_approval": True,  "instant_book": False, "same_day": False, "min_lead_hours": None, "max_advance_days": None, "payment_timing": payment_timing.DEFAULT},
            "grooming":    {"require_approval": True,  "instant_book": False, "same_day": False, "min_lead_hours": None, "max_advance_days": None, "payment_timing": payment_timing.DEFAULT},
            "photography": {"require_approval": True,  "instant_book": False, "same_day": False, "min_lead_hours": None, "max_advance_days": None, "payment_timing": payment_timing.DEFAULT},
            "other":       {"require_approval": True,  "instant_book": False, "same_day": False, "min_lead_hours": None, "max_advance_days": None, "payment_timing": payment_timing.DEFAULT},
        },
        # Exact service-row overrides. Missing keys inherit from the category.
        # client_booking_enabled=False removes that individual service from the
        # client picker and rejects direct client POSTs server-side.
        "per_catalog_service": {},
        # When a service is at capacity, do we auto-offer the waitlist?
        # Falls through to feature_visibility.waitlist as a master switch.
        "waitlist_on_capacity":   True,
        # When a service is at capacity AND waitlist is off, what to show?
        "capacity_reached_copy":  "We're full for that day — please pick another date.",
        # Sprint 110di-26 — Show clients a live price estimate in the
        # booking wizard before they submit. Uses the existing service
        # catalog (base_price, optional additional_dog_rate) and the
        # client's existing credit balances. Does NOT auto-consume
        # credits or require payment — it's informational only.
        "show_price_estimate":    True,
    }


def merge_controls(saved) -> dict:
    """Deep-merge saved booking controls with safe defaults.

    A shallow ``{**defaults, **saved}`` loses nested category defaults whenever
    an older install has only a partial map. This helper also preserves custom
    service-id rows while filling any missing rule keys at read time.
    """
    base = default_controls()
    if not isinstance(saved, dict):
        return base
    out = {**base, **saved}
    saved_categories = saved.get("per_service") if isinstance(saved.get("per_service"), dict) else {}
    out["per_service"] = {
        key: {**defaults, **(saved_categories.get(key) or {})}
        for key, defaults in base["per_service"].items()
    }
    # Preserve any non-standard categories from restored/older data.
    for key, row in saved_categories.items():
        if key not in out["per_service"] and isinstance(row, dict):
            out["per_service"][key] = dict(row)
    exact = saved.get("per_catalog_service")
    out["per_catalog_service"] = dict(exact) if isinstance(exact, dict) else {}
    return payment_timing.normalize_controls(out)


def rules_for(settings: dict, service_type: str, service_id: Optional[str] = None) -> dict:
    """Resolve effective rules for one booking. Exact service rules override
    category defaults; omitted exact keys inherit from the category row.
    """
    controls = merge_controls((settings or {}).get("booking_flow_controls"))
    category = dict((controls.get("per_service") or {}).get(service_type) or {})
    if service_id:
        exact = (controls.get("per_catalog_service") or {}).get(service_id)
        if isinstance(exact, dict):
            # None means "inherit" for numeric override fields. Booleans must
            # keep False, so filter only null values rather than falsy values.
            category.update({k: v for k, v in exact.items() if v is not None})
            category["_exact_same_day"] = "same_day" in exact and exact.get("same_day") is not None
            category["_exact_min_lead"] = "min_lead_hours" in exact and exact.get("min_lead_hours") is not None
            category["_exact_max_advance"] = "max_advance_days" in exact and exact.get("max_advance_days") is not None
    return category
