"""
One-off cleanup: wipe all test clients/dogs and their related records,
keeping ONLY freightshaker06@gmail.com (client_id 4b3658d3-9172-4a7a-b3dc-3a49a56ed6d2)
and its linked user login. Admin/staff users, settings, employees, services,
templates, and branding stay intact.

Run from /app/backend:
    python3 cleanup_test_data.py --dry-run     # preview counts only
    python3 cleanup_test_data.py --confirm     # actually delete
"""
import asyncio
import os
import sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

KEEP_CLIENT_ID = "4b3658d3-9172-4a7a-b3dc-3a49a56ed6d2"
KEEP_EMAIL = "freightshaker06@gmail.com"

# Collections keyed by client_id — delete rows where client_id != KEEP_CLIENT_ID
CLIENT_SCOPED = [
    "announcement_reads",
    "awarded_trophies",
    "bookings",
    "claim_tokens",
    "client_communications",
    "client_files",
    "client_message_threads",
    "credit_adjustments",
    "credit_lots",
    "credit_packs",
    "homework",
    "homework_media",
    "incidents",
    "intake_submissions",
    "notification_log",
    "payment_plans",
    "payment_transactions",
    "price_overrides",
    "quote_requests",
    "referrals",
    "retail_sales",
    "step_events",
    "task_dismissals",
    "trivia_attempts",
    "waiver_signatures",
]

# Collections keyed solely by dog_id — since the kept client has no dogs,
# wipe everything in these tables.
DOG_SCOPED_ONLY = [
    "dog_facts",
    "dog_programs",
    "recurring_templates",
    "training_sessions",
    "vaccine_dismissals",
]

# Misc test artifacts — safe to wipe wholesale, they're auto-generated
# during automated test runs and have no operator value.
PURELY_TEST = [
    "trivia_attempts",       # per-client trivia replays
    "review_requests",
    "reschedule_requests",
    "intake_submissions",
    "quote_requests",
]


async def main():
    confirm = "--confirm" in sys.argv
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    keep = await db.clients.find_one({"id": KEEP_CLIENT_ID})
    if not keep:
        print(f"ERROR: Kept client {KEEP_CLIENT_ID} ({KEEP_EMAIL}) not found.")
        return
    print(f"Keeping client: {keep.get('name')} <{keep.get('email')}> id={KEEP_CLIENT_ID}")
    print(f"Mode: {'LIVE DELETE' if confirm else 'DRY RUN'}\n")

    plan = []

    # 1. Clients — keep only the one
    n = await db.clients.count_documents({"id": {"$ne": KEEP_CLIENT_ID}})
    plan.append(("clients", {"id": {"$ne": KEEP_CLIENT_ID}}, n))

    # 2. Dogs — wipe all (kept client has no dogs)
    n = await db.dogs.count_documents({})
    plan.append(("dogs", {}, n))

    # 3. Client-scoped collections
    for col in CLIENT_SCOPED:
        q = {"client_id": {"$ne": KEEP_CLIENT_ID}}
        n = await db[col].count_documents(q)
        plan.append((col, q, n))

    # 4. Dog-only-scoped collections — wipe all
    for col in DOG_SCOPED_ONLY:
        n = await db[col].count_documents({})
        plan.append((col, {}, n))

    # 5. Users — drop only role=client whose client_id != KEEP_CLIENT_ID.
    #    Admin/staff users stay 100% intact.
    q = {"role": "client", "client_id": {"$ne": KEEP_CLIENT_ID}}
    n = await db.users.count_documents(q)
    plan.append(("users (role=client)", q, n))

    # 6. Audit log — drop entries tied to deleted client users.  Keep entries
    #    triggered by admin/staff so the operator's own action history is
    #    preserved.
    # (We only filter rows that explicitly reference a now-deleted user/client.)
    # Simpler heuristic: drop any audit row whose user_role == 'client' and
    # user_id not tied to the kept client's login.
    kept_user = await db.users.find_one({"client_id": KEEP_CLIENT_ID})
    kept_user_id = kept_user.get("id") if kept_user else None
    q = {"user_role": "client", "user_id": {"$ne": kept_user_id}}
    n = await db.audit_log.count_documents(q)
    plan.append(("audit_log (role=client)", q, n))

    # 7. Bookings/communications etc. tied to dogs (no dog_id check needed —
    #    they were filtered in step 3 already by client_id; any orphans by
    #    dog_id only are extremely rare and not worth a second pass).

    # ---- print plan ----
    total = 0
    for col, q, n in plan:
        if n:
            total += n
            print(f"  {col:40s} → delete {n}")
    print(f"\nTotal docs to remove: {total}")

    if not confirm:
        print("\n(dry run — re-run with --confirm to apply)")
        return

    # ---- execute ----
    print("\nExecuting deletes...")
    for col, q, n in plan:
        if not n:
            continue
        # `users (role=client)` and `audit_log (role=client)` are display names.
        actual = col.split(" ")[0]
        res = await db[actual].delete_many(q)
        print(f"  {actual:30s} deleted {res.deleted_count}")
    print("\nDone.")


asyncio.run(main())
