"""Standard Sit Happens training programs — seeded from
https://www.sithappensohiodogtraining.com/training (Feb 2026 snapshot).
Pricing intentionally omitted (operator handles billing externally)."""

PROGRAM_TYPES = [
    {"key": "private_lessons", "label": "Private Lessons", "color": "#00a9e0"},
    {"key": "board_train", "label": "Board & Train", "color": "#8cc63f"},
    {"key": "service_dog", "label": "Service Dog", "color": "#a855f7"},
    {"key": "custom", "label": "Custom", "color": "#ec4899"},
]

GOAL_STATUS = ["not_started", "in_progress", "mastered"]
ENROLLMENT_STATUS = ["active", "completed", "paused", "withdrawn"]


def _g(name, description=""):
    return {"name": name, "description": description}


# Each program: name, slug, type, description, focus, format, min_age, prereqs, modules.
SEED_PROGRAMS = [
    # ----- Private Lessons -----
    {
        "name": "Puppy Preschool (Foundation)",
        "slug": "puppy_preschool",
        "type": "private_lessons",
        "description": "Hands-on private lessons for owners who want to be involved in their puppy's foundation.",
        "focus": "Engagement, socialization, crate training, potty schedule, and 'soft' markers (Yes/No).",
        "format": {"count": 4, "unit": "sessions"},
        "min_age_months": 2,
        "prereq_slugs": [],
        "modules": [
            {"name": "Engagement & Markers", "description": "Build value for your name and 'Yes/No' markers.",
             "goals": [_g("Name recognition", "Puppy looks at you when name is called."),
                       _g("'Yes' marker", "Mark correct behavior; pairs with reward."),
                       _g("'No' marker", "Soft interrupt for unwanted behavior.")]},
            {"name": "Socialization", "description": "Positive exposure to people, surfaces, sounds.",
             "goals": [_g("Handling tolerance", "Allows paws/mouth/ear handling."),
                       _g("Novel surfaces", "Walks on tile, grass, gravel, metal grates calmly."),
                       _g("People & dogs", "Neutral around new people and friendly dogs.")]},
            {"name": "Crate & Potty", "description": "Crate as a safe space + house-train schedule.",
             "goals": [_g("Crate entry on cue", "Walks into crate on 'Kennel'."),
                       _g("Settles in crate", "Quiet for 15+ minutes."),
                       _g("Potty schedule", "Reliable on 2-3 hour outdoor schedule.")]},
            {"name": "Foundation Commands", "description": "First obedience cues.",
             "goals": [_g("Sit"), _g("Down"), _g("Place", "Goes to designated mat/bed.")]},
        ],
    },
    {
        "name": "Level 1: Basic Manners",
        "slug": "level_1_basic_manners",
        "type": "private_lessons",
        "description": "On-leash reliability — the foundation for every dog.",
        "focus": "Loose leash walking, impulse control, and duration (staying put until released).",
        "format": {"count": 5, "unit": "sessions"},
        "min_age_months": 4,
        "prereq_slugs": [],
        "modules": [
            {"name": "Leash Skills", "description": "Calm, focused walking on leash.",
             "goals": [_g("Loose leash walking", "No pulling for 5+ minutes."),
                       _g("Heel position", "Maintains heel for 30+ seconds.")]},
            {"name": "Duration & Stay", "description": "Hold position until released.",
             "goals": [_g("Sit-stay 60s"), _g("Down-stay 2 min"), _g("Place duration 5 min")]},
            {"name": "Impulse Control", "description": "Wait, ignore, defer to handler.",
             "goals": [_g("Wait at door"), _g("Leave-it (food on floor)"), _g("Polite greetings (no jumping)")]},
            {"name": "On-Leash Recall", "description": "Reliable come on leash with distractions.",
             "goals": [_g("Come on long line"), _g("Come away from a mild distraction")]},
        ],
    },
    {
        "name": "Level 2: Intermediate Skills",
        "slug": "level_2_intermediate",
        "type": "private_lessons",
        "description": "Distance, distraction, and introduction to communication tools.",
        "focus": "Higher distractions (other dogs, busy areas). Introduction to e-collar/prong for clear communication.",
        "format": {"count": 5, "unit": "sessions"},
        "min_age_months": 6,
        "prereq_slugs": ["level_1_basic_manners"],
        "modules": [
            {"name": "Tool Conditioning", "description": "Layered prong/e-collar communication.",
             "goals": [_g("E-collar low-level recognition"), _g("Prong leash pressure understanding")]},
            {"name": "Distance Work", "description": "Hold commands at 15-30 ft.",
             "goals": [_g("Sit at 15 ft"), _g("Down at 30 ft"), _g("Place at 20 ft")]},
            {"name": "Distraction Proofing", "description": "Work through real-world distractions.",
             "goals": [_g("Heel past other dogs"), _g("Stay during squirrels/noise"), _g("Recall from busy area")]},
        ],
    },
    {
        "name": "Level 3: Advanced Off-Leash",
        "slug": "level_3_off_leash",
        "type": "private_lessons",
        "description": "Total freedom — 100% off-leash reliability under heavy distraction. The Sit Happens signature level.",
        "focus": "Off-leash recall and 'place' under heavy distraction.",
        "format": {"count": 6, "unit": "sessions"},
        "min_age_months": 24,
        "prereq_slugs": ["level_1_basic_manners"],
        "modules": [
            {"name": "Off-Leash Heel", "description": "Drag-line then no line, in distraction.",
             "goals": [_g("Off-leash heel — quiet area"), _g("Off-leash heel — park/store proximity")]},
            {"name": "Emergency Recall", "description": "Bombproof recall with conditioned cue.",
             "goals": [_g("Emergency recall — yard"), _g("Emergency recall — park/wildlife"), _g("Recall from full play")]},
            {"name": "'Out' / Disengage", "description": "Break off any behavior on cue.",
             "goals": [_g("Out from object"), _g("Out from dog/critter")]},
            {"name": "Public Proofing", "description": "Sessions in real environments.",
             "goals": [_g("Stay in busy parking lot"), _g("Heel through pet-friendly store"), _g("Place at a brewery/patio")]},
        ],
    },

    # ----- Board & Train -----
    {
        "name": "1-Week Fundamentals (Board & Train)",
        "slug": "bt_1_week_fundamentals",
        "type": "board_train",
        "description": "Best for puppies (16 weeks+) or dogs needing a behavior reset.",
        "focus": "Crate training, house manners, name recognition, and leash engagement.",
        "format": {"count": 1, "unit": "weeks"},
        "min_age_months": 4,
        "prereq_slugs": [],
        "modules": [
            {"name": "House Manners", "goals": [_g("Crate trained"), _g("No counter-surfing"), _g("No door bolting")]},
            {"name": "Foundation", "goals": [_g("Name recognition"), _g("Sit"), _g("Down")]},
            {"name": "Leash Engagement", "goals": [_g("Calm on leash"), _g("Loose leash basics")]},
            {"name": "Go-Home Session", "goals": [_g("90-minute owner handover")]},
        ],
    },
    {
        "name": "2-Week Essential Obedience (Board & Train)",
        "slug": "bt_2_week_essential",
        "type": "board_train",
        "description": "Best for dogs needing solid on-leash manners and impulse control.",
        "focus": "No jumping/door bolting, loose leash walking, Sit/Down/Stay with distractions.",
        "format": {"count": 2, "unit": "weeks"},
        "min_age_months": 4,
        "prereq_slugs": [],
        "modules": [
            {"name": "Manners Reset", "goals": [_g("No jumping"), _g("No door bolting"), _g("No counter-surfing")]},
            {"name": "Leash Work", "goals": [_g("Loose leash 10+ min"), _g("Heel position"), _g("Auto-sit at stops")]},
            {"name": "Obedience w/ Distractions", "goals": [_g("Sit-stay 2 min"), _g("Down-stay 5 min"), _g("Place 10 min"), _g("Leave-it solid")]},
            {"name": "Recall", "goals": [_g("Come on long line"), _g("Come from mild distraction")]},
            {"name": "Go-Home Session", "goals": [_g("90-minute owner handover")]},
        ],
    },
    {
        "name": "3-Week Off-Leash Elite (Board & Train)",
        "slug": "bt_3_week_off_leash",
        "type": "board_train",
        "description": "Total freedom and reliable recall in any environment. Includes high-quality e-collar.",
        "focus": "Full off-leash communication, advanced distance commands, e-collar conditioning.",
        "format": {"count": 3, "unit": "weeks"},
        "min_age_months": 24,
        "prereq_slugs": ["bt_1_week_fundamentals", "bt_2_week_essential", "level_1_basic_manners"],  # any of these
        "modules": [
            {"name": "E-Collar Conditioning", "goals": [_g("Low-level recognition"), _g("Layered with known commands"), _g("Emergency recall conditioning")]},
            {"name": "Off-Leash Skills", "goals": [_g("Off-leash heel — facility"), _g("Off-leash heel — public"), _g("Off-leash place in distraction")]},
            {"name": "Advanced Distance", "goals": [_g("Recall from 50+ ft"), _g("Down at distance"), _g("Out / disengage")]},
            {"name": "Public Outings", "goals": [_g("Park/store proofing"), _g("Off-leash with other dogs present")]},
            {"name": "Go-Home Session", "goals": [_g("90-minute owner handover")]},
        ],
    },
]
