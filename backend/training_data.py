"""TADSAW-derived service-dog command library + helpers for the
training curriculum, sessions, progress and badge system."""
from typing import List, Dict, Tuple

# 4 categories. Order = display order on the portal/admin.
CATEGORIES = [
    {"key": "engagement", "label": "Engagement", "color": "#8cc63f"},
    {"key": "obedience", "label": "Basic Obedience", "color": "#00a9e0"},
    {"key": "public_access", "label": "Public Access", "color": "#a855f7"},
    {"key": "task", "label": "Task-Specific", "color": "#ec4899"},
]

# TADSAW commands. `order` controls UI order within each category.
SEED_COMMANDS: List[Dict] = [
    # Engagement
    {"name": "Good", "category": "engagement", "description": "Lets dog know you are pleased.", "order": 10},
    {"name": "Yes", "category": "engagement", "description": "Marks appropriate action.", "order": 20},
    {"name": "Thank You", "category": "engagement", "description": "Shows willingness to work.", "order": 30},

    # Basic Obedience
    {"name": "Sit", "category": "obedience", "description": "Dog puts his seat on the ground.", "order": 10},
    {"name": "Down", "category": "obedience", "description": "Dog lowers entire body to the ground.", "order": 20},
    {"name": "Stay", "category": "obedience", "description": "Dog must remain in present posture and place.", "order": 30},
    {"name": "Come", "category": "obedience", "description": "Calls dog to you. Never use for correction or hygiene tasks.", "order": 40},
    {"name": "Heel", "category": "obedience", "description": "Dog positions self on the LEFT side of trainer to walk.", "order": 50},
    {"name": "Side", "category": "obedience", "description": "Dog positions self on the RIGHT side of trainer to walk.", "order": 60},
    {"name": "Cover", "category": "obedience", "description": "Dog positions 'heel' BEHIND self while standing in line.", "order": 70},
    {"name": "Front", "category": "obedience", "description": "Dog positions 'heel' IN FRONT of self while standing in line.", "order": 80},
    {"name": "Back", "category": "obedience", "description": "Instructs dog to back up. First teach next to a wall.", "order": 90},
    {"name": "Release", "category": "obedience", "description": "Frees dog from prior command/instruction.", "order": 100},

    # Public Access
    {"name": "Lets Go", "category": "public_access", "description": "A walk beside you on a loose leash.", "order": 10},
    {"name": "Wait", "category": "public_access", "description": "Dog does not cross a designated line.", "order": 20},
    {"name": "Settle", "category": "public_access", "description": "Stop messing around — calm down.", "order": 30},
    {"name": "Careful", "category": "public_access", "description": "Cautious dog prepared for precarious situations (stairs, busy street).", "order": 40},
    {"name": "Go", "category": "public_access", "description": "Tells the dog to move in the direction you're pointing.", "order": 50},
    {"name": "Hurry", "category": "public_access", "description": "'Go hurry' means to go to bathroom on command. Use every time they go.", "order": 60},
    {"name": "Out", "category": "public_access", "description": "Send dog out of the room (e.g., kitchen).", "order": 70},
    {"name": "Dress", "category": "public_access", "description": "Putting on pack, bandanna or vest.", "order": 80},

    # Task-Specific
    {"name": "Kennel", "category": "task", "description": "Go to crate. Reward with treat at first; keep chew/favorite toy in crate for extended stays.", "order": 10},
    {"name": "Leave It", "category": "task", "description": "Dog does not touch / ignores food on the ground, cats, etc. (Replaces 'no'.)", "order": 20},
    {"name": "Roll", "category": "task", "description": "Dog rolls to side so you can check belly.", "order": 30},
    {"name": "Car", "category": "task", "description": "Dog gets into vehicle and waits.", "order": 40},
    {"name": "Touch", "category": "task", "description": "Dog's nose touches an object. Start with treat in hand, sticky-note targets smeared with peanut butter.", "order": 50},
    {"name": "Tug", "category": "task", "description": "Dog takes item in mouth and tugs from you. Start with a rope.", "order": 60},
    {"name": "Cuddle / Visit", "category": "task", "description": "Dog puts head in lap to snuggle.", "order": 70},
    {"name": "Get It", "category": "task", "description": "Pick up a specific object. Progress: wooden dumbbell → rubber → metal → phone → basket handle.", "order": 80},
    {"name": "Hold", "category": "task", "description": "Dog holds an object until instructed to give/drop.", "order": 90},
    {"name": "Bring It", "category": "task", "description": "Dog brings the object in its mouth to you.", "order": 100},
    {"name": "Drop It", "category": "task", "description": "Release things from mouth.", "order": 110},
    {"name": "Fix", "category": "task", "description": "Dog lifts leg to correct leash entanglement.", "order": 120},
    {"name": "Paw", "category": "task", "description": "Give a paw to hold.", "order": 130},
    {"name": "Paws Up", "category": "task", "description": "Dog puts front paws on a designated item (lap, bed, counter to pay a clerk).", "order": 140},
    {"name": "Off", "category": "task", "description": "Get off the object — all four feet on the floor.", "order": 150},
]

# Score scale (used for chips and tooltips in the UI)
SCORE_SCALE = [
    {"value": 0, "label": "Not Started", "color": "#475569", "description": "Not yet introduced"},
    {"value": 1, "label": "Introductory", "color": "#f59e0b", "description": "Heavy prompting / luring required"},
    {"value": 2, "label": "Learning", "color": "#f97316", "description": "Frequent prompts; dog is learning the cue"},
    {"value": 3, "label": "Emerging", "color": "#eab308", "description": "Minimal prompting; lacks duration or distance"},
    {"value": 4, "label": "Proficient", "color": "#84cc16", "description": "Reliable in low-distraction environments"},
    {"value": 5, "label": "Mastered", "color": "#22c55e", "description": "Reliable in high-distraction environments (TADSAW '+')"},
]


# ---- Badge rules ----
# Returns list of badges currently earned. Pure function over a curriculum.
def compute_badges(curriculum: Dict[str, Dict], commands_by_id: Dict[str, Dict], cgc_pass: bool = False) -> List[Dict]:
    """curriculum: dict of {command_id: {level: int, ...}}
       commands_by_id: dict of {command_id: command_def}
       cgc_pass: True if any training session was marked CGC mock pass.
    Returns list of earned badge dicts."""
    by_cat: Dict[str, Tuple[int, int]] = {c["key"]: (0, 0) for c in CATEGORIES}
    for cid, cmd in commands_by_id.items():
        cat = cmd.get("category")
        if cat in by_cat:
            total, mastered = by_cat[cat]
            entry = curriculum.get(cid) or {}
            level = int(entry.get("level") or 0)
            by_cat[cat] = (total + 1, mastered + (1 if level >= 4 else 0))

    def pct(cat_key):
        t, m = by_cat.get(cat_key, (0, 0))
        return 0 if t == 0 else int(round(100 * m / t))

    badges = []
    basics_pct = (pct("engagement") + pct("obedience")) / 2
    task_pct = pct("task")
    overall_pct = (pct("engagement") + pct("obedience") + pct("public_access") + pct("task")) / 4

    if basics_pct >= 50:
        badges.append({"key": "bronze", "tier": "Bronze", "title": "Bronze · Foundations",
                       "description": "50% mastery of engagement & basic obedience.", "color": "#cd7f32"})
    if basics_pct >= 80 and cgc_pass:
        badges.append({"key": "silver", "tier": "Silver", "title": "Silver · CGC Ready",
                       "description": "80% basics mastered + a passing mock CGC session.", "color": "#c0c0c0"})
    if overall_pct >= 95 and task_pct >= 90:
        badges.append({"key": "gold", "tier": "Gold", "title": "Gold · Task Ready",
                       "description": "Full task readiness and public-access mastery.", "color": "#ffd700"})
    # Per-category mini badges
    for c in CATEGORIES:
        if pct(c["key"]) >= 100:
            badges.append({"key": f"category_{c['key']}", "tier": "Category",
                           "title": f"{c['label']} Master",
                           "description": f"Every {c['label'].lower()} command mastered.",
                           "color": c["color"]})
    return badges


def progress_summary(curriculum: Dict[str, Dict], commands_by_id: Dict[str, Dict]) -> Dict:
    """Returns overall + per-category progress percentages."""
    by_cat: Dict[str, Dict] = {}
    for c in CATEGORIES:
        by_cat[c["key"]] = {"label": c["label"], "color": c["color"], "total": 0, "mastered": 0, "in_progress": 0}
    total = 0
    mastered = 0
    in_progress = 0
    for cid, cmd in commands_by_id.items():
        cat = cmd.get("category")
        if cat not in by_cat:
            continue
        entry = curriculum.get(cid) or {}
        level = int(entry.get("level") or 0)
        by_cat[cat]["total"] += 1
        total += 1
        if level >= 4:
            by_cat[cat]["mastered"] += 1
            mastered += 1
        elif level >= 1:
            by_cat[cat]["in_progress"] += 1
            in_progress += 1
    def _pct(m, t):
        return 0 if t == 0 else int(round(100 * m / t))
    return {
        "overall": {"total": total, "mastered": mastered, "in_progress": in_progress,
                    "mastered_pct": _pct(mastered, total)},
        "by_category": [
            {"key": k, **v, "mastered_pct": _pct(v["mastered"], v["total"])}
            for k, v in by_cat.items()
        ],
    }
