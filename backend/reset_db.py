"""Total reset: wipe all business data + settings, keep only the admin user."""
import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

WIPE = ["clients", "dogs", "bookings", "incidents", "homework", "waiver_signatures", "vaccine_dismissals", "settings"]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@sithappens.com").lower()

async def main():
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
    # On next backend startup the seed routine will recreate default settings + admin (idempotent)

asyncio.run(main())
