"""Online School — the canonical guided-lesson step sequence.

A lesson is not a menu of eight equally-clickable sections; it is a
progression: learn the material, get ready, train, watch for the common
mistakes, know what success looks like, then practise with the dog, check
your knowledge, and move on.

This module owns that sequence on the SERVER, for one reason: the gate that
keeps Practice locked until the instructional material is done has to be
enforceable. If the browser decided which steps exist, a client could simply
ask for a different answer. The client renders the sequence this module
returns; `portal_school_*` enforces against the very same computation.

It MAPS what a trainer already authored onto the sequence. It does not add
curriculum fields, does not change Program Studio, and never fabricates a
section: a step with nothing authored simply does not appear, and a block
matching no rule still lands in a visible step rather than being dropped.

Two authored shapes exist and both must map:

  * Course Builder ``content_blocks`` — what the real enhanced curriculum
    uses (text, checklist, steps, quiz, trainer_tip, warning, practice, and
    an optional checkpoint).
  * The legacy structured fields (``client_overview``, ``equipment_needed``,
    …) still used by older programs.

The JavaScript in ``lesson/LessonGuide.jsx`` mirrors the same rules for the
cases where the client renders without a server payload; the server copy is
the one that decides access.
"""
from typing import Any, Dict, List, Optional

# The sequence from the design handoff. `kind` is what the progression rules
# key off — `instructional` steps are the ones that must be finished before
# Practice opens.
GUIDE_SECTIONS: tuple = (
    {"key": "learn", "label": "Learn", "icon": "fa-lightbulb",
     "blurb": "Understand the goal", "kind": "instructional"},
    {"key": "get_ready", "label": "Get Ready", "icon": "fa-clipboard-check",
     "blurb": "Set up for success", "kind": "instructional"},
    {"key": "train", "label": "Train", "icon": "fa-shoe-prints",
     "blurb": "Step-by-step instructions", "kind": "instructional"},
    {"key": "watch_for", "label": "Watch For This", "icon": "fa-eye",
     "blurb": "Common mistakes to avoid", "kind": "instructional"},
    {"key": "know_got_it", "label": "Know When You've Got It", "icon": "fa-star",
     "blurb": "Key signs of success", "kind": "instructional"},
    {"key": "practice", "label": "Practice", "icon": "fa-paw",
     "blurb": "Work with your dog", "kind": "practice"},
    {"key": "quick_check", "label": "Quick Check", "icon": "fa-circle-question",
     "blurb": "Check your knowledge", "kind": "quick_check"},
    {"key": "next_step", "label": "Next Step", "icon": "fa-arrow-right",
     "blurb": "What's coming next", "kind": "next_step"},
)

INSTRUCTIONAL_KINDS = frozenset({"instructional"})

# A lesson only presents the guided sequence when it has at least this many
# steps carrying content of their own; below it, the client sees the lesson as
# ordinary flowing content with no per-step Continue action.
#
# The Practice gate uses the SAME threshold, and must: a client can only be
# required to work through a sequence they are actually shown. Gating a lesson
# that renders flat would lock Practice with no control anywhere on screen to
# unlock it. `LessonScreen`'s own `hasGuide` check mirrors this exactly.
GUIDE_MIN_CONTENT_STEPS = 2

# Steps that ride inside Train rather than owning a row of their own.
_ASIDE_KEYS = frozenset({"troubleshooting", "safety"})


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def classify_block(block: Optional[dict], *, seen_steps: bool) -> Optional[str]:
    """Which step a content block belongs to.

    Block *type* decides wherever type is unambiguous. Only plain ``text``
    blocks need a hint, because the curriculum authors several per lesson
    ("what a good repetition looks like", "common mistakes to avoid", "if it
    is not working") and type alone cannot tell them apart. Any text block
    matching nothing falls through to a visible step.
    """
    if not isinstance(block, dict):
        return None
    t = block.get("type")
    if t == "checklist":
        return "get_ready"
    if t == "steps":
        return "train"
    if t == "quiz":
        return "quick_check"
    if t == "practice":
        return "practice"
    if t == "trainer_tip":
        return "train"
    if t == "warning":
        return "safety"
    # The checkpoint block presents something CheckpointPanel already owns end
    # to end; showing it here would state the rules twice.
    if t == "checkpoint":
        return None
    if t in ("video", "image", "download"):
        return "train" if seen_steps else "learn"
    if t in ("timer", "rep_counter"):
        return "train"

    title = _text(block.get("title")).lower()
    if any(w in title for w in ("not working", "troubleshoot", "if it")):
        return "troubleshooting"
    if any(w in title for w in ("mistake", "avoid", "watch")):
        return "watch_for"
    if any(w in title for w in ("good rep", "success", "got it", "looks like", "criteria")):
        return "know_got_it"
    # Text before the first steps block is introductory; after it, it is
    # commentary on the work just described.
    return "watch_for" if seen_steps else "learn"


def group_blocks(blocks: Optional[List[dict]]) -> Dict[str, List[dict]]:
    """Split active content blocks into step buckets, in authored order."""
    buckets: Dict[str, List[dict]] = {}
    seen_steps = False
    active = sorted(
        [b for b in (blocks or []) if isinstance(b, dict) and b.get("active") is not False],
        key=lambda b: b.get("order") or 0,
    )
    for b in active:
        key = classify_block(b, seen_steps=seen_steps)
        if b.get("type") == "steps":
            seen_steps = True
        if not key:
            continue
        buckets.setdefault(key, []).append(b)
    return buckets


def _legacy_bodies(lesson: dict) -> Dict[str, str]:
    """Which legacy authored field feeds each step."""
    l = lesson or {}
    learn = "\n\n".join(x for x in (_text(l.get("client_overview")), _text(l.get("why_it_matters"))) if x)
    return {
        "learn": learn,
        "get_ready": _text(l.get("equipment_needed")),
        "train": _text(l.get("client_instructions")),
        "watch_for": _text(l.get("common_mistakes")),
        "know_got_it": _text(l.get("success_criteria")),
    }


def build_guide(lesson: Optional[dict], *, has_practice: bool = False,
                has_quiz: bool = False) -> List[dict]:
    """The steps this lesson actually has, in sequence order.

    Steps are renumbered so a client reads "Step 2 of 6" with no gap where an
    unauthored section would have been.
    """
    lesson = lesson or {}
    blocks = group_blocks(lesson.get("content_blocks"))
    using_blocks = any(k not in _ASIDE_KEYS for k in blocks)
    bodies = {} if using_blocks else _legacy_bodies(lesson)

    def has(key: str) -> bool:
        return bool(blocks.get(key)) if using_blocks else bool(bodies.get(key))

    out: List[dict] = []
    for s in GUIDE_SECTIONS:
        key = s["key"]
        if key == "practice":
            if has_practice or has("practice"):
                out.append({**s, "has_content": bool(blocks.get("practice"))})
            continue
        if key == "quick_check":
            if has_quiz or has("quick_check"):
                out.append({**s, "has_content": has("quick_check")})
            continue
        if key == "next_step":
            out.append({**s, "has_content": False})
            continue
        if not has(key):
            continue
        out.append({**s, "has_content": True,
                    "body": bodies.get(key, "") if not using_blocks else ""})
    return [{**s, "n": i + 1, "total": len(out)} for i, s in enumerate(out)]


def instructional_step_keys(lesson: Optional[dict], *, has_practice: bool = False,
                            has_quiz: bool = False) -> List[str]:
    """The steps that must be completed before Practice may start.

    Only steps that actually carry authored content count. A lesson whose
    trainer authored nothing instructional gates on nothing — the alternative
    would lock a client out of Practice with no way to satisfy the gate.
    """
    return [s["key"] for s in build_guide(lesson, has_practice=has_practice, has_quiz=has_quiz)
            if s["kind"] in INSTRUCTIONAL_KINDS]


def content_step_count(lesson: Optional[dict], *, has_practice: bool = False,
                       has_quiz: bool = False) -> int:
    """Steps carrying content of their own — i.e. not a pure hand-off to the
    Practice / Quick Check / Next Step machinery that lives elsewhere."""
    return sum(1 for s in build_guide(lesson, has_practice=has_practice, has_quiz=has_quiz)
               if s["kind"] in INSTRUCTIONAL_KINDS or s.get("has_content"))


def guide_is_active(lesson: Optional[dict], *, has_practice: bool = False,
                    has_quiz: bool = False) -> bool:
    """Does this lesson actually present the guided sequence to the client?

    When it does not, there is no per-step Continue action on screen, so
    nothing gates on step completion — see GUIDE_MIN_CONTENT_STEPS.
    """
    return content_step_count(lesson, has_practice=has_practice,
                              has_quiz=has_quiz) >= GUIDE_MIN_CONTENT_STEPS


def is_instructional_step(lesson: Optional[dict], step_key: str, *,
                          has_practice: bool = False, has_quiz: bool = False) -> bool:
    return step_key in instructional_step_keys(lesson, has_practice=has_practice, has_quiz=has_quiz)


def missing_instructional_steps(lesson: Optional[dict], completed: Any, *,
                                has_practice: bool = False, has_quiz: bool = False) -> List[str]:
    """Instructional steps still outstanding, in sequence order."""
    done = set(completed or [])
    return [k for k in instructional_step_keys(lesson, has_practice=has_practice, has_quiz=has_quiz)
            if k not in done]


def step_label(step_key: str) -> str:
    for s in GUIDE_SECTIONS:
        if s["key"] == step_key:
            return s["label"]
    return step_key
