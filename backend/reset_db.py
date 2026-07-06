"""Emergency-only database reset.

This script is intentionally hard to run because it wipes business data.
It is NOT used by normal GitHub updates or Docker rebuilds.

Required command:
    SIT_HAPPENS_ALLOW_DATA_WIPE=YES_I_HAVE_A_BACKUP python3 reset_db.py --confirm-reset
"""
import asyncio
import os
import sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

WIPE = [
    "clients", "dogs", "bookings", "bookings_archive", "incidents", "homework",
    "waiver_signatures", "vaccine_dismissals", "settings",
]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@sithappens.com").lower()


def _guard() -> None:
    if "--confirm-reset" not in sys.argv:
        raise SystemExit(
            "Refusing to reset data. This script wipes clients/dogs/bookings.\n"
            "Run only after a verified backup with:\n"
            "  SIT_HAPPENS_ALLOW_DATA_WIPE=YES_I_HAVE_A_BACKUP python3 reset_db.py --confirm-reset"
        )
    if os.environ.get("SIT_HAPPENS_ALLOW_DATA_WIPE") != "YES_I_HAVE_A_BACKUP":
        raise SystemExit(
            "Refusing to reset data without SIT_HAPPENS_ALLOW_DATA_WIPE=YES_I_HAVE_A_BACKUP"
        )


async def main():
    _guard()
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    summary = {}
    for c in WIPE:
        r = await db[c].delete_many({})
        summary[c] = r.deleted_count
    # Keep only the admin user; drop any other accounts (test clients, etc.)
    r = await db.users.delete_many({"email": {"$ne": ADMIN_EMAIL}})
    summary["users (non-admin)"] = r.deleted_count
    print("Reset complete:")
    for k, v in summary.items():
        print(f"  {k}: {v} deleted")
    client.close()


asyncio.run(main())
