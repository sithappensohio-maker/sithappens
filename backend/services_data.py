"""
Sit Happens — Default service catalog seeded on first run.

These price points are placeholders — admin should adjust them in
Settings → Services to match real pricing.
"""

SEED_SERVICES = [
    {"slug": "daycare_day",      "name": "Daycare (per day)",       "base_price": 35.0, "service_type": "daycare",  "color": "#00a9e0", "icon": "fa-sun"},
    {"slug": "boarding_night",   "name": "Boarding (per night)",    "base_price": 55.0, "service_type": "boarding", "color": "#8cc63f", "icon": "fa-moon"},
    {"slug": "private_lesson",   "name": "1-on-1 Private Lesson",   "base_price": 90.0, "service_type": "training", "color": "#a855f7", "icon": "fa-user"},
    {"slug": "board_train_week", "name": "Board & Train (per week)","base_price": 1500.0,"service_type": "training", "color": "#a855f7", "icon": "fa-graduation-cap"},
    {"slug": "service_dog_eval", "name": "Service Dog Evaluation",  "base_price": 150.0, "service_type": "training", "color": "#ec4899", "icon": "fa-clipboard-check"},
    {"slug": "bath",             "name": "Bath",                     "base_price": 45.0, "service_type": "grooming", "color": "#06b6d4", "icon": "fa-soap"},
    {"slug": "nail_trim",        "name": "Nail Trim",                "base_price": 20.0, "service_type": "grooming", "color": "#06b6d4", "icon": "fa-scissors"},
]
