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
