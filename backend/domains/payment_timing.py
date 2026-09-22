"""When a customer is expected to pay — the one place that question is answered.

This is NOT how they can pay. `settings.payment_options` already answers that
(Venmo, card, cash…) and stays exactly where it is. The two are deliberately
separate concepts and deliberately separate data:

    payment_options  → "How can I pay?"
    payment_timing   → "When am I expected to pay?"

The distinction that matters most here is between what a customer is TOLD and
what the system actually REQUIRES.

Today no booking path collects money. `POST /bookings` writes a status and
nothing else; invoices are raised later, and Stripe Checkout exists only for
the Shop. So a service cannot honestly be configured to demand payment online
or a deposit at booking time — there is no code that would stop the booking if
the customer didn't pay.

Rather than leave that as a trap an admin can walk into, the enforced values
are declared here and refused at the API until something genuinely enforces
them. Hiding them in the UI would not be enough: the truth has to be protected
at the boundary, because the UI is not the only way settings get written.
"""
from typing import Optional

# ── Values the app can say truthfully today ──────────────────────────────
# None of these make a claim about money changing hands during booking. They
# describe when payment is expected, which is a statement about how the
# business operates, not about what the software enforces.
NONE_AT_BOOKING = "none_at_booking"
AT_DROPOFF = "at_dropoff"
AT_PICKUP = "at_pickup"
INVOICE_SENT = "invoice_sent"

# ── Values that would REQUIRE the booking flow to collect payment ────────
# Configurable only once a booking path actually enforces them. See
# ENFORCEMENT_AVAILABLE below.
PAY_ONLINE = "pay_online"
DEPOSIT = "deposit"

INFORMATIONAL = (NONE_AT_BOOKING, AT_DROPOFF, AT_PICKUP, INVOICE_SENT)
ENFORCED = (PAY_ONLINE, DEPOSIT)
ALL = INFORMATIONAL + ENFORCED

# Flip an entry to True only when the booking flow genuinely refuses to create
# the booking without payment. Until then, allowing it would let the site tell
# a customer they must pay online when nothing would ever ask them to.
ENFORCEMENT_AVAILABLE = {
    PAY_ONLINE: False,
    DEPOSIT: False,
}

DEFAULT = NONE_AT_BOOKING

# Customer-facing sentences. Deliberately about expectation, never about
# obligation the system does not impose.
_COPY = {
    NONE_AT_BOOKING: {
        "short": "No payment needed now",
        "detail": "Nothing to pay to book. We'll sort payment out with you around the visit.",
    },
    AT_DROPOFF: {
        "short": "Pay at drop-off",
        "detail": "Nothing to pay now — payment is taken when you drop your dog off.",
    },
    AT_PICKUP: {
        "short": "Pay at pickup",
        "detail": "Nothing to pay now — payment is taken when you collect your dog.",
    },
    INVOICE_SENT: {
        "short": "Invoice sent separately",
        "detail": "Nothing to pay now — we'll send you an invoice for this separately.",
    },
    PAY_ONLINE: {
        "short": "Pay online now",
        "detail": "Payment is taken online when you book.",
    },
    DEPOSIT: {
        "short": "Deposit required",
        "detail": "A deposit is taken when you book; the balance is due later.",
    },
}


def is_valid(value: Optional[str]) -> bool:
    return value in ALL


def is_enforced_value(value: Optional[str]) -> bool:
    return value in ENFORCED


def is_configurable(value: Optional[str]) -> bool:
    """True when a value may currently be saved.

    Informational values are always configurable. Enforced ones wait for the
    booking flow to grow teeth.
    """
    if value in INFORMATIONAL:
        return True
    if value in ENFORCED:
        return bool(ENFORCEMENT_AVAILABLE.get(value))
    return False


def rejection_reason(value: str) -> str:
    """Why an enforced value cannot be saved — written for the admin."""
    label = _COPY.get(value, {}).get("short", value)
    return (
        f'"{label}" can\'t be switched on yet: booking does not collect payment, '
        "so the site would be telling customers something the app would never "
        "ask them to do. Bookings are payable at the register or by invoice today."
    )


def describe(value: Optional[str]) -> dict:
    """Everything a customer-facing surface needs to talk about payment.

    `enforced` says whether the app itself will require payment during the
    booking flow. Every surface should read this rather than inferring from
    the value, so a future enforced mode changes copy in one place.
    """
    key = value if is_valid(value) else DEFAULT
    copy = _COPY[key]
    return {
        "timing": key,
        "short": copy["short"],
        "detail": copy["detail"],
        "enforced": bool(ENFORCEMENT_AVAILABLE.get(key, False)) if key in ENFORCED else False,
        "collects_payment_during_booking": key in ENFORCED,
    }


def normalize(value: Optional[str]) -> str:
    """Coerce stored/legacy values to something sayable. Never raises — reads
    must survive a row written before this existed, or by a future version."""
    return value if is_valid(value) else DEFAULT


def normalize_controls(controls: dict) -> dict:
    """Coerce every payment_timing inside a booking_flow_controls map.

    A value written by an older build, a restored backup or a future version
    must still read as something the app can say out loud, so reads are
    normalised rather than trusted. Mutates and returns the map.
    """
    for row in (controls.get("per_service") or {}).values():
        if isinstance(row, dict) and "payment_timing" in row:
            row["payment_timing"] = normalize(row.get("payment_timing"))
    for row in (controls.get("per_catalog_service") or {}).values():
        if isinstance(row, dict) and row.get("payment_timing") is not None:
            row["payment_timing"] = normalize(row.get("payment_timing"))
    return controls


def assert_configurable(controls: dict) -> Optional[str]:
    """Return an error message if a controls map sets a value we can't honour.

    Guarding this only in the admin UI would not be enough: settings are also
    written by restores, imports and direct API calls, and every one of those
    could otherwise switch on a claim the booking flow would never make good.
    """
    rows = list((controls.get("per_service") or {}).items())
    rows += list((controls.get("per_catalog_service") or {}).items())
    for key, row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get("payment_timing")
        if value is None:
            continue
        if not is_valid(value):
            return f'"{value}" is not a payment timing this app knows about.'
        if not is_configurable(value):
            return rejection_reason(value)
    return None
