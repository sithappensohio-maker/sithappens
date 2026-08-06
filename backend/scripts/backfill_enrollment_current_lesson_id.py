"""Training-school expansion (Phase 9) — OPTIONAL backfill for
dog_programs.current_lesson_id.

NOT REQUIRED. Every training-school phase was built with backward-
compatible defaults specifically so no migration would ever be mandatory:
every read of current_lesson_id already falls back gracefully when the
field is absent —
  * _client_unlocked_modules() (portal Learn/Progress): missing/None
    current_lesson_id just shows every lesson in the current module
    instead of gating within it.
  * complete_training_session()'s advance_lesson/skip_lesson/
    reopen_previous_lesson: falls back to the module's first lesson.
  * admin_training_today() (trainer dashboard): reads it purely for
    display; None just shows no "current lesson" name.
This script exists only as an OPTIONAL enhancement — it makes the pointer
directly queryable/indexable instead of recomputed via fallback on every
read, and gives a concrete example of the dry-run/apply/verify discipline
this app's other backfills already follow. Skipping it entirely changes
nothing about correctness.

What it does: for every dog_programs row where current_lesson_id is
missing or None, sets it to the first lesson (real, or the synthesized
"default-lesson-<module_id>" a legacy module-with-no-lessons already
resolves to at read time — see server.py's _effective_lessons) of that
enrollment's CURRENT module. Never touches current_module_id, goal_progress,
program_snapshot, status, or any other field. Never touches a row that
already has a current_lesson_id set, even if you disagree with its value —
this is a pure fill-the-gap backfill, not a corrector.

Explicitly NOT touched by this or any other part of the training-school
work: program purchases, pricing, sales, credits, completion history,
existing homework/media, or any client URL. No homework is created by this
script — it only sets one pointer field.

BACKUP FIRST: this only ever writes a single new field on dog_programs docs
that don't already have it, but as with any bulk write against live data,
take a mongodump of the dog_programs collection first:
    mongodump --uri="$MONGO_URL" --db=$DB_NAME --collection=dog_programs --out=./backup-$(date +%Y%m%d)

Dry-run by default (prints what it would change, makes no writes).
Pass --apply to write. Idempotent — re-running after --apply finds nothing
left to do (0 affected) since it only ever targets rows missing the field.

Usage:
    python scripts/backfill_enrollment_current_lesson_id.py                        # dry run, all enrollments
    python scripts/backfill_enrollment_current_lesson_id.py --apply                 # writes, all enrollments
    python scripts/backfill_enrollment_current_lesson_id.py --enrollment-id <id> --apply   # one enrollment only
    python scripts/backfill_enrollment_current_lesson_id.py --verify                # report-only: how many still missing it
"""
import asyncio
import os
import sys

sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient


def _load_env():
    env = dict(os.environ)
    for candidate in ("/app/backend/.env", os.path.join(os.path.dirname(__file__), "..", ".env")):
        if os.path.isfile(candidate):
            for line in open(candidate):
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    env.setdefault(k, v.strip('"'))
            break
    return env


def _flag(name):
    return name in sys.argv


def _opt(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


def _first_lesson_id(modules, current_module_id):
    """Mirrors server.py's enroll_dog / _effective_lessons default-lesson
    logic without importing the full server module (this script only needs
    read access to program_snapshot.modules, not the whole app)."""
    modules_sorted = sorted(modules or [], key=lambda m: (m.get("order", 0), m.get("name") or ""))
    if not modules_sorted:
        return None
    module = next((m for m in modules_sorted if m.get("id") == current_module_id), modules_sorted[0])
    lessons = module.get("lessons") or []
    if lessons:
        lessons_sorted = sorted(lessons, key=lambda l: l.get("order", 0))
        return lessons_sorted[0].get("id")
    goals = module.get("goals") or []
    if not goals:
        return None
    return f"default-lesson-{module.get('id', '')}"


async def main():
    apply = _flag("--apply")
    verify_only = _flag("--verify")
    enrollment_id_filter = _opt("--enrollment-id")

    env = _load_env()
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    missing_filter = {"$or": [{"current_lesson_id": {"$exists": False}}, {"current_lesson_id": None}]}

    if verify_only:
        count = await db.dog_programs.count_documents(missing_filter)
        print(f"{count} dog_programs row(s) still missing current_lesson_id in {db_name!r}.")
        sys.exit(0)

    query = {**missing_filter, **({"id": enrollment_id_filter} if enrollment_id_filter else {})}
    enrollments = await db.dog_programs.find(
        query, {"_id": 0, "id": 1, "dog_id": 1, "current_module_id": 1, "program_snapshot": 1},
    ).to_list(100000)
    if enrollment_id_filter and not enrollments:
        print(f"No dog_programs row with id={enrollment_id_filter!r} needs backfilling (already set, or doesn't exist).")
        sys.exit(0)

    updated = 0
    skipped_no_lesson = 0
    examples_shown = 0
    for enr in enrollments:
        modules = (enr.get("program_snapshot") or {}).get("modules") or []
        lesson_id = _first_lesson_id(modules, enr.get("current_module_id"))
        if lesson_id is None:
            skipped_no_lesson += 1
            continue
        if examples_shown < 10:
            print(f"  enrollment {enr['id']} (dog {enr.get('dog_id')}): current_lesson_id  None -> {lesson_id!r}")
            examples_shown += 1
        if apply:
            await db.dog_programs.update_one(
                {"id": enr["id"], **missing_filter},  # re-check the guard at write time — never overwrite a value set since this run started
                {"$set": {"current_lesson_id": lesson_id}},
            )
        updated += 1

    print()
    print(f"Enrollments matched (missing current_lesson_id): {len(enrollments)}")
    print(f"Enrollments {'backfilled' if apply else 'that would be backfilled'}: {updated}")
    if skipped_no_lesson:
        print(f"Skipped (current module has no goals/lessons to point at — nothing valid to set): {skipped_no_lesson}")
    if not apply:
        print("\nDry run only — no writes made. Re-run with --apply to write.")
    else:
        remaining = await db.dog_programs.count_documents(missing_filter)
        print(f"\nVerification: {remaining} row(s) still missing current_lesson_id after this run "
              f"(expected: {skipped_no_lesson}, i.e. only enrollments whose current module has nothing to point at).")


asyncio.run(main())
