"""What a training program costs, said only when somebody has actually said it.

The public Training page showed "Ask for pricing" on every program. That was
not a join failing — investigation found no program price has ever been
entered: five of the seven real programs have no `price` field at all and two
sit at 0.0, and the one program↔service link that exists
(`services.package_program_id`) is used by zero services.

The tempting fix is arithmetic: Level 1 is "5 sessions", a private lesson is
$90, therefore $450. That number would appear on the public website having
been invented here. A program package is not the sum of its parts — it can
carry a discount, a go-home session, boarding, follow-up support — so the
multiplication is a guess wearing a price tag.

So pricing is explicit or it is absent. Four modes, no inference:

    contact   — "Contact us for pricing" (the default, and not an error state)
    package   — one price for the whole thing:        "$1,200 program"
    per_unit  — a rate, with the unit spelled out:    "$90 / private lesson"
    from      — a floor, when the total genuinely varies: "From $450"

`contact` is the default on purpose. A program nobody has priced reads as a
deliberate invitation rather than as missing data, which is what "Ask for
pricing" felt like.
"""
from typing import Optional

CONTACT = "contact"
PACKAGE = "package"
PER_UNIT = "per_unit"
FROM = "from"

MODES = (CONTACT, PACKAGE, PER_UNIT, FROM)
DEFAULT_MODE = CONTACT

# Units a rate can be quoted in. Free text would let "/wk", "/week" and
# "/Week" all appear on one page.
UNITS = {
    "session": "session",
    "private_lesson": "private lesson",
    "lesson": "lesson",
    "week": "week",
    "day": "day",
    "night": "night",
    "visit": "visit",
    "month": "month",
}
DEFAULT_UNIT = "session"

CONTACT_COPY = "Contact us for pricing"


def _money(amount: float) -> str:
    """$1,500 — not $1500.0, and not $1,500.00 when it's a round number."""
    value = float(amount)
    if abs(value - round(value)) < 0.005:
        return f"${round(value):,}"
    return f"${value:,.2f}"


def is_valid_mode(mode: Optional[str]) -> bool:
    return mode in MODES


def normalize_unit(unit: Optional[str]) -> str:
    return unit if unit in UNITS else DEFAULT_UNIT


def resolve(program: dict) -> dict:
    """The public pricing line for one program.

    Returns ``{mode, display, amount, unit, has_price}``. ``display`` is the
    whole of what a public surface should print — no formatting decisions are
    left to the frontend, so the Training page, a program card and a share
    preview cannot drift apart.

    Anything incomplete falls back to Contact us rather than showing a half
    price. A mode of `package` with no amount is a misconfiguration, and the
    honest response to a misconfiguration is not $0.
    """
    mode = program.get("public_price_mode")
    if not is_valid_mode(mode):
        mode = DEFAULT_MODE

    amount = program.get("public_price_amount")
    try:
        amount = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        amount = None
    # Zero is not a price. It is the default value of an untouched number
    # field, and it is how "$0" reached the public site in the first place.
    if amount is not None and amount <= 0:
        amount = None

    unit = normalize_unit(program.get("public_price_unit"))

    if mode == CONTACT or amount is None:
        return {"mode": CONTACT, "display": CONTACT_COPY, "amount": None,
                "unit": None, "has_price": False}
    if mode == PACKAGE:
        return {"mode": PACKAGE, "display": f"{_money(amount)} program", "amount": amount,
                "unit": None, "has_price": True}
    if mode == PER_UNIT:
        return {"mode": PER_UNIT, "display": f"{_money(amount)} / {UNITS[unit]}", "amount": amount,
                "unit": unit, "has_price": True}
    return {"mode": FROM, "display": f"From {_money(amount)}", "amount": amount,
            "unit": None, "has_price": True}


def assert_valid(program: dict) -> Optional[str]:
    """Error message if a submitted program's pricing is incoherent.

    Deliberately strict about a priced mode with no amount: silently showing
    "Contact us" for a program the admin believes they have priced is worse
    than telling them the field is empty.
    """
    mode = program.get("public_price_mode")
    if mode is None:
        return None
    if not is_valid_mode(mode):
        return f'"{mode}" is not a pricing mode. Choose one of: {", ".join(MODES)}.'
    if mode == CONTACT:
        return None
    amount = program.get("public_price_amount")
    try:
        amount = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        return "Enter the price as a number."
    if amount is None or amount <= 0:
        return "Enter a price above zero, or choose Contact us for pricing."
    if mode == PER_UNIT and not is_valid_unit(program.get("public_price_unit")):
        return f'Choose a unit for the rate: {", ".join(sorted(UNITS))}.'
    return None


def is_valid_unit(unit: Optional[str]) -> bool:
    return unit in UNITS
