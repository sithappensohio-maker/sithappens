"""
Sit Happens — Default credit-pack catalog.

These are placeholders — admin should adjust in Settings → Credit Packs.
"""

SEED_CREDIT_PACKS = [
    # Daycare packs
    {"slug": "single_day",      "name": "Single Day Drop-In",     "qty": 1,  "price": 35.0,  "service_type": "daycare"},
    {"slug": "five_pack",       "name": "5-Day Daycare Pack",     "qty": 5,  "price": 160.0, "service_type": "daycare"},
    {"slug": "ten_pack",        "name": "10-Day Daycare Pack",    "qty": 10, "price": 300.0, "service_type": "daycare"},
    {"slug": "twenty_pack",     "name": "20-Day Daycare Pack",    "qty": 20, "price": 550.0, "service_type": "daycare"},
    # Training packs
    {"slug": "training_single", "name": "Single 1-on-1 Lesson",   "qty": 1,  "price": 90.0,  "service_type": "training"},
    {"slug": "training_3pack",  "name": "3-Session Training Pack","qty": 3,  "price": 250.0, "service_type": "training"},
    {"slug": "training_5pack",  "name": "5-Session Training Pack","qty": 5,  "price": 400.0, "service_type": "training"},
    {"slug": "training_10pack", "name": "10-Session Training Pack","qty": 10,"price": 750.0, "service_type": "training"},
]
