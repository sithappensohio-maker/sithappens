"""Trophy engine: idempotent awarding, auto-evaluators that run after the
relevant write hooks, and a Pillow-based share-card PNG renderer."""
from __future__ import annotations

import base64
import io
import logging
import re
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional

from PIL import Image, ImageDraw, ImageFont

from trophies_data import SEED_TROPHIES, TIER_COLORS

logger = logging.getLogger("sithappens.trophies")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def seed_trophies_if_empty(db) -> None:
    """Insert default catalog on first boot. Won't overwrite admin edits — only
    inserts trophy codes that don't already exist."""
    existing_codes = {
        t["code"] for t in await db.trophies.find({}, {"_id": 0, "code": 1}).to_list(500)
    }
    to_insert = []
    now = _now_iso()
    for t in SEED_TROPHIES:
        if t["code"] in existing_codes:
            continue
        doc = {**t, "id": str(uuid.uuid4()), "created_at": now}
        to_insert.append(doc)
    if to_insert:
        await db.trophies.insert_many(to_insert)
        logger.info("Seeded %d default trophies", len(to_insert))


async def _already_awarded(db, recipient_type: str, recipient_id: str, code: str) -> bool:
    return await db.awarded_trophies.find_one(
        {"recipient_type": recipient_type, "recipient_id": recipient_id, "trophy_code": code, "revoked": {"$ne": True}},
        {"_id": 0, "id": 1},
    ) is not None


async def award_trophy(
    db,
    *,
    recipient_type: str,
    recipient_id: str,
    trophy_code: str,
    awarded_by: str = "system",
    note: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Idempotently award a trophy. Returns the awarded row on success, None if
    already held or trophy code is unknown/inactive."""
    if await _already_awarded(db, recipient_type, recipient_id, trophy_code):
        return None
    trophy = await db.trophies.find_one({"code": trophy_code, "active": True}, {"_id": 0})
    if not trophy:
        return None
    # Resolve recipient display name for the audit row.
    recipient_name = ""
    dog_id = None
    client_id = None
    if recipient_type == "dog":
        dog = await db.dogs.find_one({"id": recipient_id}, {"_id": 0, "name": 1, "owner_id": 1})
        if not dog:
            return None
        recipient_name = dog.get("name") or ""
        dog_id = recipient_id
        client_id = dog.get("owner_id")
    elif recipient_type == "client":
        client = await db.clients.find_one({"id": recipient_id}, {"_id": 0, "name": 1})
        if not client:
            return None
        recipient_name = client.get("name") or ""
        client_id = recipient_id
    else:
        return None

    awarded = {
        "id": str(uuid.uuid4()),
        "trophy_code": trophy_code,
        "trophy_name": trophy.get("name", trophy_code),
        "trophy_tier": trophy.get("tier", "bronze"),
        "trophy_icon": trophy.get("icon", "fa-trophy"),
        # Snapshot the custom image at award-time so historical shares keep
        # their visual even if the admin later edits/removes the catalog image.
        "trophy_custom_image": trophy.get("custom_image", "") or "",
        # Sprint 110ak — snapshot the layout mode too so the wall + share-card
        # honour the admin's chosen fit even after the catalog row is edited.
        "trophy_image_fit": trophy.get("image_fit", "circle") or "circle",
        # Sprint 110al — focal point for circle mode (default centred).
        "trophy_image_offset_x": int(trophy.get("image_offset_x", 50) or 50),
        "trophy_image_offset_y": int(trophy.get("image_offset_y", 50) or 50),
        "trophy_description": trophy.get("description", ""),
        "recipient_type": recipient_type,
        "recipient_id": recipient_id,
        "recipient_name": recipient_name,
        "dog_id": dog_id,
        "client_id": client_id,
        "awarded_by": awarded_by,
        "note": note or "",
        "meta": meta or {},
        "awarded_at": _now_iso(),
        "revoked": False,
        "seen_by_client": False,
    }
    await db.awarded_trophies.insert_one(awarded)
    awarded.pop("_id", None)
    return awarded


# ───────────────────────── evaluators ──────────────────────────


async def _eligible_trophies(db, *, category: str, kind: str) -> List[Dict[str, Any]]:
    return await db.trophies.find(
        {
            "category": category,
            "active": True,
            "trigger_type": "auto",
            "trigger_kind": kind,
        },
        {"_id": 0},
    ).sort("threshold", 1).to_list(50)


# The app's mastery rule: a trainer-scored goal is "mastered" at 4 (see the
# goal endpoint's `if body.score >= 4: status = "mastered"`, the legacy→School
# migration stamping score 4, and manual-progress mastery). The skill trophies
# used to demand 5, so dogs the app itself called "mastered" scored 0.
MASTERY_SCORE = 4


def goal_is_mastered(gp: Optional[dict]) -> bool:
    if not isinstance(gp, dict):
        return False
    if str(gp.get("status") or "") == "mastered":
        return True
    try:
        return int(gp.get("score") or 0) >= MASTERY_SCORE
    except Exception:
        return False


def ordered_snapshot_lessons(snapshot: Optional[dict]) -> List[Dict[str, Any]]:
    """Flatten a program snapshot's ACTIVE lessons in curriculum order —
    the same (module.order, name) / (lesson.order, name) rule the roadmap
    and course-progress helpers use, so "lessons passed" agrees everywhere."""
    rows: List[Dict[str, Any]] = []
    modules = sorted((snapshot or {}).get("modules") or [], key=lambda m: (m.get("order", 0), m.get("name") or ""))
    for module in modules:
        lessons = sorted([l for l in (module.get("lessons") or []) if l.get("active", True)],
                         key=lambda l: (l.get("order", 0), l.get("name") or ""))
        for lesson in lessons:
            rows.append({"module": module, "lesson": lesson})
    return rows


def online_skills_demonstrated(enrollment: dict) -> set:
    """Online School's legitimate skill signal.

    Self-guided checkpoint grading deliberately never writes trainer
    goal_progress scores, so online students could never earn the skill
    trophies. A lesson the student has advanced PAST (the pointer only moves
    forward, and a checkpoint lesson can't be passed without the trainer's
    advance) is a demonstrated lesson; its `skill_ids` are the skills the
    student showed. A completed enrollment demonstrates every lesson."""
    if str(enrollment.get("delivery_channel") or "") != "online_school":
        return set()
    rows = ordered_snapshot_lessons(enrollment.get("program_snapshot") or {})
    if not rows:
        return set()
    if enrollment.get("status") == "completed":
        passed = rows
    else:
        cur_module = enrollment.get("current_module_id")
        cur_lesson = enrollment.get("current_lesson_id")
        idx = next((i for i, r in enumerate(rows) if r["lesson"].get("id") == cur_lesson), None)
        if idx is None:
            # Pointer cleared inside a module (module done) or unknown: count
            # every lesson of modules BEFORE the current one, plus the current
            # module when its pointer is cleared.
            mod_ids = []
            for r in rows:
                mid = r["module"].get("id")
                if mid not in mod_ids:
                    mod_ids.append(mid)
            cur_idx = mod_ids.index(cur_module) if cur_module in mod_ids else 0
            done_mods = set(mod_ids[:cur_idx]) | ({cur_module} if cur_lesson is None and cur_module in mod_ids else set())
            passed = [r for r in rows if r["module"].get("id") in done_mods]
        else:
            passed = rows[:idx]
    skills = set()
    for r in passed:
        for sid in (r["lesson"].get("skill_ids") or []):
            if sid:
                skills.add(sid)
    return skills


async def _count_dog_skills_mastered(db, dog_id: str) -> int:
    """Distinct skills this dog has mastered across every enrollment:
    trainer-scored goals at the app's mastery threshold (in-person/hybrid,
    legacy) plus Online School lessons demonstrated (see above)."""
    skills: set = set()
    async for e in db.dog_programs.find(
        {"dog_id": dog_id},
        {"_id": 0, "goal_progress": 1, "delivery_channel": 1, "status": 1,
         "current_module_id": 1, "current_lesson_id": 1, "program_snapshot": 1},
    ):
        for gid, gp in (e.get("goal_progress") or {}).items():
            if gid and goal_is_mastered(gp):
                skills.add(gid)
        skills |= online_skills_demonstrated(e)
    return len(skills)


# Backwards-compatible name (older call sites / tests).
_count_dog_goals_at_5 = _count_dog_skills_mastered


async def _count_dog_programs_completed(db, dog_id: str) -> int:
    return await db.dog_programs.count_documents({"dog_id": dog_id, "status": "completed"})


async def _count_dog_checkpoints_passed(db, dog_id: str) -> int:
    """Online School Phase 3 — mirrors _count_dog_programs_completed's
    shape exactly for a new, small, real milestone: the dog's first
    trainer-graded checkpoint advance."""
    return await db.checkpoint_submissions.count_documents({"dog_id": dog_id, "outcome": "advance"})


async def check_dog_trophies(db, dog_id: str) -> List[Dict[str, Any]]:
    """Re-evaluate auto-trophies for a single dog and award newly-met ones."""
    awarded: List[Dict[str, Any]] = []
    # 1) goal_score_5_count — the trigger_kind key is historical; it now means
    #    "skills mastered" at the app's real threshold, incl. Online School.
    goal5 = await _count_dog_skills_mastered(db, dog_id)
    for t in await _eligible_trophies(db, category="dog", kind="goal_score_5_count"):
        if goal5 >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="dog", recipient_id=dog_id, trophy_code=t["code"],
                meta={"skills_mastered_at_award": goal5, "goal_score_5_count_at_award": goal5},
            )
            if row:
                awarded.append(row)
    # 2) program_completed
    progs = await _count_dog_programs_completed(db, dog_id)
    for t in await _eligible_trophies(db, category="dog", kind="program_completed"):
        if progs >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="dog", recipient_id=dog_id, trophy_code=t["code"],
                meta={"programs_completed_at_award": progs},
            )
            if row:
                awarded.append(row)
    # 3) first_checkpoint_passed (Online School Phase 3)
    checkpoints_passed = await _count_dog_checkpoints_passed(db, dog_id)
    for t in await _eligible_trophies(db, category="dog", kind="first_checkpoint_passed"):
        if checkpoints_passed >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="dog", recipient_id=dog_id, trophy_code=t["code"],
                meta={"checkpoints_passed_at_award": checkpoints_passed},
            )
            if row:
                awarded.append(row)
    return awarded


def practice_log_counts_as_session(hw: Optional[dict], log: Optional[dict]) -> bool:
    """One definition of a REAL Practice session, reused by every School gate
    AND by the trophy engine.

    Question placeholders, half-filled daily drafts, rest days and skipped
    days are bookkeeping — not training. Section-based Practice keeps its
    legacy append-only shape (an ordinary log has no submission_status), while
    daily trackers count only an explicit submitted/approved day. Keeping this
    predicate shared matters: the first-practice gate, checkpoint remediation
    counts, graduation totals and practice-streak awards must never disagree
    about whether training actually happened.
    """
    if not isinstance(log, dict):
        return False
    if log.get("is_rest_day") or log.get("is_skipped"):
        return False
    status = log.get("submission_status")
    if (hw or {}).get("daily_tracker"):
        return status in ("submitted", "approved")
    return status not in ("draft", "in_progress", "rest", "skipped")


async def _count_homework_completed(db, client_id: str) -> int:
    """Practice assignments this client has finished. School Practice lives in
    the same `homework` collection as legacy assignments (each lesson's
    Practice is a homework row owned by the enrollment), so one count covers
    both eras."""
    return await db.homework.count_documents({"client_id": client_id, "status": "completed"})


def _log_day(log: Dict[str, Any]) -> Optional[date]:
    raw = str(log.get("date") or "")[:10]
    try:
        return date.fromisoformat(raw)
    except Exception:
        pass
    try:
        return datetime.fromisoformat(str(log.get("logged_at") or "")).date()
    except Exception:
        return None


async def practice_days(db, client_id: str) -> set:
    """Every calendar day this client trained: a day with at least one real,
    client-logged Practice session on ANY assignment (School lessons log a
    session per day on ONE homework row — a multi-day Practice never flips to
    `completed` day by day), plus the day any assignment was completed."""
    docs = await db.homework.find(
        {"client_id": client_id},
        {"_id": 0, "status": 1, "completed_at": 1, "daily_tracker": 1, "section_logs": 1},
    ).to_list(5000)
    days = set()
    for hw in docs:
        for log in (hw.get("section_logs") or []):
            if not practice_log_counts_as_session(hw, log):
                continue
            if str(log.get("logged_by_role") or "client") == "admin":
                continue  # trainer bookkeeping is not the client's practice
            d = _log_day(log)
            if d:
                days.add(d)
        if hw.get("status") == "completed":
            try:
                days.add(datetime.fromisoformat(hw.get("completed_at") or "").date())
            except Exception:
                pass
    return days


async def _homework_streak_days(db, client_id: str) -> int:
    """Longest current streak of consecutive days ending today (or yesterday)
    on which the client practiced — see `practice_days`."""
    days = await practice_days(db, client_id)
    if not days:
        return 0
    today = date.today()
    # Start anchor: today if hit, else yesterday (so we don't break the streak
    # just because they haven't logged today yet).
    anchor = today if today in days else today - timedelta(days=1)
    streak = 0
    cur = anchor
    while cur in days:
        streak += 1
        cur -= timedelta(days=1)
    return streak


def _visit_filter(client_id: str) -> Dict[str, Any]:
    """A visit is any booking for this client that actually happened: it was
    checked out (current flow), or it carries a terminal completed status from
    the pre-checkout era (`completed` / legacy `checked_out` rows that never
    got a `checked_out_at` stamp). Cancelled / rejected never count."""
    return {
        "client_id": client_id,
        "$or": [
            {"checked_out_at": {"$nin": [None, ""]}},
            {"status": {"$in": ["completed", "checked_out"]}},
        ],
    }


def dog_visit_filter(dog_ids) -> Dict[str, Any]:
    """Same visit definition as `_visit_filter`, scoped to one or more dogs.
    Used by the Portal's per-dog visit badges so they agree with the trophy
    engine (and count archived bookings) instead of a bare status=completed."""
    ids = list(dog_ids) if not isinstance(dog_ids, str) else [dog_ids]
    return {
        "dog_id": {"$in": ids},
        "$or": [
            {"checked_out_at": {"$nin": [None, ""]}},
            {"status": {"$in": ["completed", "checked_out"]}},
        ],
    }


async def _client_visit_count(db, client_id: str) -> int:
    """Total visits across ALL of the client's dogs.

    Completed bookings older than ~90 days are moved out of `bookings` into
    `bookings_archive` by the cold-storage job, so counting the live
    collection alone silently capped every client at roughly one quarter of
    visits and the 50 / 100 visit awards could never fire. Count both."""
    filt = _visit_filter(client_id)
    live = await db.bookings.count_documents(filt)
    try:
        archived = await db.bookings_archive.count_documents(filt)
    except Exception:
        archived = 0
    return int(live or 0) + int(archived or 0)


async def _client_successful_referrals(db, client_id: str) -> int:
    return await db.referrals.count_documents({"referrer_id": client_id})


async def check_client_trophies(db, client_id: str) -> List[Dict[str, Any]]:
    """Re-evaluate auto-trophies for a single client and award newly-met ones."""
    awarded: List[Dict[str, Any]] = []
    # homework_streak_days
    streak = await _homework_streak_days(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="homework_streak_days"):
        if streak >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"streak_at_award": streak},
            )
            if row:
                awarded.append(row)
    # homework_completed
    hw_done = await _count_homework_completed(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="homework_completed"):
        if hw_done >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"homework_completed_at_award": hw_done},
            )
            if row:
                awarded.append(row)
    # visit_count
    visits = await _client_visit_count(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="visit_count"):
        if visits >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"visit_count_at_award": visits},
            )
            if row:
                awarded.append(row)
    # successful_referrals
    refs = await _client_successful_referrals(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="successful_referrals"):
        if refs >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"successful_referrals_at_award": refs},
            )
            if row:
                awarded.append(row)
    return awarded


async def recheck_all_client_trophies(db) -> Dict[str, Any]:
    """Re-run the client auto-award evaluators for every client. Idempotent
    (award_trophy skips anything already held), so it is safe to run after
    an evaluator fix or a catalog change to hand out awards that were earned
    but never fired — e.g. visit tiers that the archive job hid."""
    summary: Dict[str, Any] = {"clients_checked": 0, "awarded": 0, "by_code": {}}
    async for c in db.clients.find({}, {"_id": 0, "id": 1}):
        cid = c.get("id")
        if not cid:
            continue
        summary["clients_checked"] += 1
        try:
            rows = await check_client_trophies(db, cid)
        except Exception as exc:  # one bad client must not stop the sweep
            logger.warning("trophy recheck failed for client %s: %s", cid, exc)
            continue
        for r in rows:
            summary["awarded"] += 1
            code = r.get("trophy_code") or "?"
            summary["by_code"][code] = summary["by_code"].get(code, 0) + 1
    if summary["awarded"]:
        logger.info("Trophy recheck awarded %d trophies across %d clients: %s",
                    summary["awarded"], summary["clients_checked"], summary["by_code"])
    return summary


async def recheck_all_dog_trophies(db) -> Dict[str, Any]:
    """Dog-side twin of recheck_all_client_trophies: graduations that never
    re-evaluated (Pipeline/DogTrainingTab), the mastery-threshold fix and the
    new Online School skill signal all need a sweep to hand out what was
    already earned."""
    summary: Dict[str, Any] = {"dogs_checked": 0, "awarded": 0, "by_code": {}}
    async for d in db.dogs.find({}, {"_id": 0, "id": 1}):
        did = d.get("id")
        if not did:
            continue
        summary["dogs_checked"] += 1
        try:
            rows = await check_dog_trophies(db, did)
        except Exception as exc:
            logger.warning("trophy recheck failed for dog %s: %s", did, exc)
            continue
        for r in rows:
            summary["awarded"] += 1
            code = r.get("trophy_code") or "?"
            summary["by_code"][code] = summary["by_code"].get(code, 0) + 1
    if summary["awarded"]:
        logger.info("Dog trophy recheck awarded %d trophies across %d dogs: %s",
                    summary["awarded"], summary["dogs_checked"], summary["by_code"])
    return summary


async def recheck_all_trophies(db) -> Dict[str, Any]:
    """Clients AND dogs, one summary (what the scheduler + Re-check button run)."""
    clients = await recheck_all_client_trophies(db)
    dogs = await recheck_all_dog_trophies(db)
    by_code = dict(clients.get("by_code") or {})
    for k, v in (dogs.get("by_code") or {}).items():
        by_code[k] = by_code.get(k, 0) + v
    return {
        "clients_checked": clients.get("clients_checked", 0),
        "dogs_checked": dogs.get("dogs_checked", 0),
        "awarded": int(clients.get("awarded", 0)) + int(dogs.get("awarded", 0)),
        "by_code": by_code,
    }


# Homework-era catalog copy → School Practice copy. Only rows whose text is
# STILL the original seed text are rewritten, so anything the admin renamed
# or re-described in Settings → Trophies is left exactly as they wrote it.
SCHOOL_COPY_MIGRATION: Dict[str, Dict[str, tuple]] = {
    "dog_quick_learner": {
        "description": ("First training goal mastered with a perfect 5 rating.",
                        "First training skill mastered."),
    },
    "client_streak_spark": {
        "description": ('Three days in a row of homework — the streak is alive!',
                 'Three days of Practice in a row — the streak is alive!'),
    },
    "client_homework_hero": {
        "name": ('Homework Hero',
                 'Practice Hero'),
        "description": ('Completed homework seven days in a row.',
                 'Practiced with your dog seven days in a row.'),
    },
    "client_streak_two_weeks": {
        "description": ('14 days in a row — habit forming.',
                 '14 days of Practice in a row — habit forming.'),
    },
    "client_streak_month": {
        "description": ("30 days in a row. That's discipline.",
                 "30 days of Practice in a row. That's discipline."),
    },
    "client_streak_iron": {
        "description": ('60 days in a row. Pup parent of the year energy.',
                 '60 days of Practice in a row. Pup parent of the year energy.'),
    },
    "client_streak_centurion": {
        "description": ('100-day streak. Officially unstoppable.',
                 '100-day Practice streak. Officially unstoppable.'),
    },
    "client_first_plan": {
        "description": ('Your first complete training plan. Many more to come!',
                 'Your first School Practice assignment completed. Many more to come!'),
    },
    "client_five_plans": {
        "description": ('5 training plans finished — you and your pup are dialed in.',
                 '5 Practice assignments finished — you and your pup are dialed in.'),
    },
    "client_dedicated": {
        "description": ('Logged 25 completed homework assignments.',
                 '25 School Practice assignments completed.'),
    },
    "client_coach_of_year": {
        "description": ('An incredible 100 completed homework assignments!',
                 'An incredible 100 School Practice assignments completed!'),
    },
}


async def migrate_trophy_copy_for_school(db) -> int:
    """Rewrite untouched homework-era names/descriptions in School terms on
    both the catalog and the awarded snapshots. Returns catalog rows changed."""
    changed = 0
    for code, fields in SCHOOL_COPY_MIGRATION.items():
        for field, (old, new) in fields.items():
            res = await db.trophies.update_many({"code": code, field: old}, {"$set": {field: new}})
            changed += int(res.modified_count or 0)
            await db.awarded_trophies.update_many(
                {"trophy_code": code, f"trophy_{field}": old}, {"$set": {f"trophy_{field}": new}},
            )
    if changed:
        logger.info("Migrated %d trophy catalog rows to School Practice copy", changed)
    return changed


# ─────────────────────── share card PNG ────────────────────────


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Try a few common system fonts before falling back to default."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()


def render_share_card_png(awarded: Dict[str, Any]) -> bytes:
    """1200x630 social share card. Renders trophy ring + title + recipient +
    branding. Returns raw PNG bytes."""
    W, H = 1200, 630
    tier = awarded.get("trophy_tier", "bronze")
    colors = TIER_COLORS.get(tier, TIER_COLORS["bronze"])

    img = Image.new("RGB", (W, H), (16, 22, 30))
    draw = ImageDraw.Draw(img)

    # Soft gradient background
    for y in range(H):
        t = y / H
        r = int(16 + (28 - 16) * t)
        g = int(22 + (38 - 22) * t)
        b = int(30 + (54 - 30) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Trophy circle on the left
    cx, cy, radius = 300, H // 2, 200
    ring_color = tuple(int(colors["ring"].lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    fill_color = tuple(int(colors["fill"].lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    # Outer ring
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=fill_color, outline=ring_color, width=12)
    # Inner highlight ring
    draw.ellipse((cx - radius + 24, cy - radius + 24, cx + radius - 24, cy + radius - 24), outline=ring_color, width=4)

    # Centerpiece: admin-uploaded image (preferred) circular-masked inside the
    # ring, falling back to the universal ★ glyph if no image is on the trophy.
    # Sprint 110ak — `trophy_image_fit` controls how the upload is composed:
    #   "circle"   — cover-crop into the inner circle (legacy)
    #   "contain"  — fit whole design inside circle, keep tier ring
    #   "freeform" — replace the ring with a rounded rectangle of the design
    custom_image = awarded.get("trophy_custom_image") or ""
    image_fit = (awarded.get("trophy_image_fit") or "circle").lower()
    pasted = False
    if custom_image:
        try:
            # Accept both "data:image/...;base64,XXXX" and raw base64 payloads.
            payload = custom_image.split(",", 1)[1] if custom_image.startswith("data:") else custom_image
            payload = re.sub(r"\s+", "", payload)
            raw = base64.b64decode(payload)
            tile = Image.open(io.BytesIO(raw)).convert("RGBA")

            if image_fit == "freeform":
                # Re-paint the left-hand slot as a rounded card carrying the
                # original aspect ratio. We blank out the ring drawn above
                # (so it doesn't leak through), then paste a contained version
                # of the artwork.
                slot = radius * 2 + 24
                card_x0, card_y0 = cx - slot // 2, cy - slot // 2
                # Erase the ring we drew earlier
                draw.rectangle((card_x0 - 8, card_y0 - 8, card_x0 + slot + 8, card_y0 + slot + 8), fill=(16, 22, 30))
                # Contain-fit the artwork inside the slot, preserving ratio
                w, h = tile.size
                scale = min(slot / w, slot / h)
                new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
                tile = tile.resize((new_w, new_h), Image.LANCZOS)
                # Rounded-corner mask so the card has the same soft feel as the badge
                mask = Image.new("L", (slot, slot), 0)
                ImageDraw.Draw(mask).rounded_rectangle((0, 0, slot, slot), radius=36, fill=255)
                bg = Image.new("RGBA", (slot, slot), (0, 0, 0, 0))
                bg.paste(tile, ((slot - new_w) // 2, (slot - new_h) // 2), tile if tile.mode == "RGBA" else None)
                img.paste(bg, (card_x0, card_y0), mask)
                pasted = True
            else:
                inner = radius - 36  # leave room for the inner highlight ring
                size = inner * 2
                if image_fit == "contain":
                    # Contain-fit (no crop) — preserves the design, blank space
                    # around it inside the circle mask. White-ish padding so
                    # the design pops on the dark page.
                    w, h = tile.size
                    scale = min(size / w, size / h)
                    new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
                    fitted = tile.resize((new_w, new_h), Image.LANCZOS)
                    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
                    bg.paste(fitted, ((size - new_w) // 2, (size - new_h) // 2), fitted if fitted.mode == "RGBA" else None)
                    tile = bg
                else:
                    # "circle" — cover-fit (crop to square then scale to size).
                    # Sprint 110al — focal point comes from
                    # `trophy_image_offset_x` / `_y` so admins can drag-pan
                    # the visible area off-centre.
                    off_x = max(0, min(100, int(awarded.get("trophy_image_offset_x", 50) or 50)))
                    off_y = max(0, min(100, int(awarded.get("trophy_image_offset_y", 50) or 50)))
                    w, h = tile.size
                    short = min(w, h)
                    extra_w = max(0, w - short)
                    extra_h = max(0, h - short)
                    left = int(extra_w * off_x / 100)
                    top = int(extra_h * off_y / 100)
                    tile = tile.crop((left, top, left + short, top + short)).resize((size, size), Image.LANCZOS)
                # Circular mask
                mask = Image.new("L", (size, size), 0)
                ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
                img.paste(tile, (cx - inner, cy - inner), mask)
                pasted = True
        except Exception as exc:
            logger.warning("trophy share-card image paste failed (%s); falling back to glyph", exc)

    if not pasted:
        big = _font(200, bold=True)
        glyph = "★"
        try:
            bbox = draw.textbbox((0, 0), glyph, font=big)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        except Exception:
            tw, th = big.getsize(glyph)
        draw.text((cx - tw // 2, cy - th // 2 - 20), glyph, fill=ring_color, font=big)

    # Right side text block
    text_x = 580
    label_font = _font(22, bold=True)
    title_font = _font(56, bold=True)
    sub_font = _font(32)
    meta_font = _font(22)

    draw.text((text_x, 110), tier.upper() + " TROPHY", fill=ring_color, font=label_font)
    title = awarded.get("trophy_name", "Trophy")
    draw.text((text_x, 145), title, fill=(255, 255, 255), font=title_font)

    recipient = awarded.get("recipient_name", "")
    if recipient:
        prefix = "Awarded to" if awarded.get("recipient_type") == "client" else "Awarded to good dog"
        draw.text((text_x, 230), f"{prefix}", fill=(180, 195, 210), font=meta_font)
        draw.text((text_x, 260), recipient, fill=(255, 255, 255), font=sub_font)

    desc = awarded.get("trophy_description", "") or ""
    if desc:
        # Hand-wrap description to ~36 chars per line
        words, lines, cur = desc.split(), [], ""
        for w in words:
            if len(cur) + len(w) + 1 > 36:
                lines.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            lines.append(cur)
        for i, ln in enumerate(lines[:3]):
            draw.text((text_x, 340 + i * 36), ln, fill=(200, 215, 230), font=meta_font)

    # Footer branding
    brand_font = _font(28, bold=True)
    draw.text((text_x, H - 80), "SIT HAPPENS", fill=(140, 198, 63), font=brand_font)
    draw.text((text_x, H - 48), "Dog Training · Daycare · Boarding", fill=(120, 140, 160), font=meta_font)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
