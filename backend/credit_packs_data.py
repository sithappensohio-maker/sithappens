"""
Sit Happens — Default credit-pack catalog.

These are placeholders — admin should adjust in Settings → Credit Packs.
"""

def pack_credits(value, default=0):
    """How many credits a pack (or a lot minted from one) holds.

    A pack may hold a half credit — "2 dogs, 1 day" is 1.5 credits, because a
    two-dog daycare day costs 1.5. Every sale path reads the pack's count
    through here so 1.5 is never cut down to 1 on the way to the client's
    balance. Whole counts come back as a plain int so existing packs, lots
    and receipts read exactly as they always have ("10", not "10.0")."""
    try:
        n = round(float(value), 2)
    except (TypeError, ValueError):
        n = 0.0
    if not n:
        n = float(default)
    return int(n) if float(n).is_integer() else n


SEED_CREDIT_PACKS = [
    # Daycare packs
    {"slug": "single_day",      "name": "Single Day Drop-In",     "qty": 1,  "price": 35.0,  "service_type": "daycare",  "icon": "fa-sun"},
    {"slug": "five_pack",       "name": "5-Day Daycare Pack",     "qty": 5,  "price": 160.0, "service_type": "daycare",  "icon": "fa-sun"},
    {"slug": "ten_pack",        "name": "10-Day Daycare Pack",    "qty": 10, "price": 300.0, "service_type": "daycare",  "icon": "fa-sun"},
    {"slug": "twenty_pack",     "name": "20-Day Daycare Pack",    "qty": 20, "price": 550.0, "service_type": "daycare",  "icon": "fa-sun"},
    # Training packs
    {"slug": "training_single", "name": "Single 1-on-1 Lesson",   "qty": 1,  "price": 90.0,  "service_type": "training", "icon": "fa-graduation-cap"},
    {"slug": "training_3pack",  "name": "3-Session Training Pack","qty": 3,  "price": 250.0, "service_type": "training", "icon": "fa-graduation-cap"},
    {"slug": "training_5pack",  "name": "5-Session Training Pack","qty": 5,  "price": 400.0, "service_type": "training", "icon": "fa-graduation-cap"},
    {"slug": "training_10pack", "name": "10-Session Training Pack","qty": 10,"price": 750.0, "service_type": "training", "icon": "fa-graduation-cap"},
    # Boarding packs (1 credit = 1 night)
    {"slug": "boarding_single", "name": "Single Boarding Night",  "qty": 1,  "price": 55.0,  "service_type": "boarding", "icon": "fa-moon"},
    {"slug": "boarding_5pack",  "name": "5-Night Boarding Pack",  "qty": 5,  "price": 250.0, "service_type": "boarding", "icon": "fa-moon"},
    {"slug": "boarding_10pack", "name": "10-Night Boarding Pack", "qty": 10, "price": 475.0, "service_type": "boarding", "icon": "fa-moon"},
]
