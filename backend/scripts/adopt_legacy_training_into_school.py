"""Adopt legacy trainer-led dog_programs rows into the unified School.

This is an OPTIONAL, backup-first migration for deployments that already have
in-person training history from before School became the single training UI.
It does NOT rebuild progress, rewrite curriculum, create Practice, fabricate
School events, or touch payments/credits/bookings.  It only:

  1. creates the missing companion school_enrollments identity; and
  2. marks the existing canonical dog_programs row delivery_channel as
     in_person_school.

The existing dog_programs row remains the progress ledger.  Existing Homework
is intentionally NOT auto-attached because older one-off assignments cannot be
safely attributed to a particular program without guessing.

BACKUP FIRST:
    mongodump --uri="$MONGO_URL" --db=$DB_NAME \
      --collection=dog_programs --out=./backup-$(date +%Y%m%d)
    mongodump --uri="$MONGO_URL" --db=$DB_NAME \
      --collection=school_enrollments --out=./backup-$(date +%Y%m%d)

Dry-run by default.  --apply writes.  Idempotent: rows already adopted are
recognized by either their School channel or existing companion enrollment.

Usage:
    python scripts/adopt_legacy_training_into_school.py
    python scripts/adopt_legacy_training_into_school.py --apply
    python scripts/adopt_legacy_training_into_school.py --verify
    python scripts/adopt_legacy_training_into_school.py --enrollment-id <id> --apply
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

SCHOOL_CHANNELS = ("online_school", "in_person_school", "hybrid_school")


def _load_env():
    env = dict(os.environ)
    for candidate in ("/app/backend/.env", os.path.join(os.path.dirname(__file__), "..", ".env")):
        if os.path.isfile(candidate):
            with open(candidate, encoding="utf-8") as fh:
                for line in fh:
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


def _now():
    return datetime.now(timezone.utc).isoformat()


def _legacy_query(enrollment_id=None):
    q = {
        "$or": [
            {"delivery_channel": {"$exists": False}},
            {"delivery_channel": None},
            {"delivery_channel": ""},
        ],
        "dog_id": {"$nin": [None, ""]},
        "program_id": {"$nin": [None, ""]},
    }
    if enrollment_id:
        q["id"] = enrollment_id
    return q


async def _candidate_state(db, dp):
    existing = await db.school_enrollments.find_one({"enrollment_id": dp["id"]}, {"_id": 0})
    dog = await db.dogs.find_one({"id": dp.get("dog_id")}, {"_id": 0, "id": 1, "owner_id": 1})
    if not dog:
        return "skip_missing_dog", None, None
    if not dog.get("owner_id"):
        return "skip_missing_owner", dog, existing
    if existing:
        return "repair_channel_only", dog, existing
    return "adopt", dog, None


async def main():
    apply = _flag("--apply")
    verify = _flag("--verify")
    enrollment_id = _opt("--enrollment-id")
    env = _load_env()
    mongo_url = env.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = env.get("DB_NAME", "sit_happens")
    db = AsyncIOMotorClient(mongo_url)[db_name]

    candidates = await db.dog_programs.find(
        _legacy_query(enrollment_id),
        {"_id": 0, "id": 1, "dog_id": 1, "program_id": 1, "status": 1,
         "started_at": 1, "created_at": 1, "assigned_trainer_id": 1,
         "access_state": 1, "support_checkpoint_allowance": 1,
         "support_assist_allowance": 1},
    ).to_list(100000)

    counts = {"adopt": 0, "repair_channel_only": 0, "skip_missing_dog": 0, "skip_missing_owner": 0}
    preview = 0
    for dp in candidates:
        state, dog, existing = await _candidate_state(db, dp)
        counts[state] += 1
        if preview < 20:
            print(f"  {dp['id']} dog={dp.get('dog_id')} program={dp.get('program_id')} status={dp.get('status') or 'active'} -> {state}")
            preview += 1
        if verify or not apply or state.startswith("skip_"):
            continue

        if state == "adopt":
            now = _now()
            companion = {
                "id": str(uuid.uuid4()),
                "client_id": dog["owner_id"],
                "dog_id": dp["dog_id"],
                "program_id": dp["program_id"],
                "enrollment_id": dp["id"],
                "delivery_mode": "trainer_led",
                "status": dp.get("status") or "active",
                "access_state": dp.get("access_state") or "active",
                "enrolled_at": dp.get("started_at") or dp.get("created_at") or now,
                "enrolled_by": "migration:legacy_in_person",
                "created_at": now,
                "assigned_trainer_id": dp.get("assigned_trainer_id"),
                "support_checkpoint_allowance": dp.get("support_checkpoint_allowance"),
                "support_assist_allowance": dp.get("support_assist_allowance"),
                "onboarding_status": "not_required",
                "adopted_legacy": True,
                "adopted_legacy_at": now,
            }
            try:
                await db.school_enrollments.insert_one(companion)
            except DuplicateKeyError:
                # A concurrent/repeated run won the insert.  Converge on its
                # companion and continue with the idempotent channel repair.
                existing = await db.school_enrollments.find_one({"enrollment_id": dp["id"]}, {"_id": 0})
                if not existing:
                    raise

        # dog_programs is the canonical ledger.  Only add School ownership;
        # never touch status/progress/snapshot/session counts/history.
        await db.dog_programs.update_one(
            {"id": dp["id"], "$or": [
                {"delivery_channel": {"$exists": False}},
                {"delivery_channel": None},
                {"delivery_channel": ""},
            ]},
            {"$set": {"delivery_channel": "in_person_school", "legacy_school_adopted_at": _now()}},
        )

    print()
    print(f"Database: {db_name}")
    print(f"Legacy trainer-led rows matched: {len(candidates)}")
    print(f"Would create School companion: {counts['adopt']}")
    print(f"Companion already exists; channel repair only: {counts['repair_channel_only']}")
    print(f"Skipped — missing dog: {counts['skip_missing_dog']}")
    print(f"Skipped — dog has no owner: {counts['skip_missing_owner']}")

    if verify:
        unresolved = 0
        async for dp in db.dog_programs.find(_legacy_query(enrollment_id), {"_id": 0, "id": 1, "dog_id": 1}):
            state, _, _ = await _candidate_state(db, dp)
            if not state.startswith("skip_"):
                unresolved += 1
        print(f"Verification: {unresolved} adoptable legacy row(s) still outside School.")
    elif not apply:
        print("\nDry run only — no writes made. Re-run with --apply after a verified mongodump.")
    else:
        remaining = await db.dog_programs.count_documents(_legacy_query(enrollment_id))
        print(f"\nApply complete. {remaining} legacy row(s) still lack a School channel (includes intentionally skipped bad/orphan data).")
        print("Existing legacy Homework was NOT attached automatically; it remains general Practice by design.")


asyncio.run(main())
