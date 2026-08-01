"""Resets the release-critical test database to a byte-fresh state.

Run before EVERY file in the release-critical gate (see RELEASE_CHECKLIST.md
section "Release-critical backend gate"), not just once at the start of the
whole run — several release-critical files assume a truly clean starting
point and will show false failures if run back-to-back against
accumulated state from a prior file.

Drops `sit_happens_test_release_critical` (never the real local dev
database), seeds the one admin account the legacy suite's tests all
hardcode (admin@sithappens.com / admin123), then calls server.startup()
so the fresh database gets the exact same indexes — including the unique
`idempotency_key` indexes several checkout/payment idempotency tests
depend on — that a real running app creates via its FastAPI lifespan.
Skipping this step is what caused a batch of false idempotency-test
failures during this gate's original construction: dropping the database
destroys those indexes, and calling the HTTP-based legacy suite's server
process never recreates them on its own after that (it only runs its
lifespan once, at process startup).

Usage:
    MONGO_URL=... DB_NAME=sit_happens_test_release_critical JWT_SECRET=... \\
    ADMIN_EMAIL=admin@sithappens.com ADMIN_PASSWORD=admin123 \\
    BACKUP_ROOT=... python release_critical_reset.py
(run from backend/, with backend/ on sys.path — see RELEASE_CHECKLIST.md
for the full env-var list this needs, same as the legacy suite itself.)
"""
import asyncio
import os
import sys
import uuid

import pymongo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server
from server import hash_password

DB_NAME = os.environ.get("DB_NAME", "sit_happens_test_release_critical")


def _assert_safe(name: str) -> None:
    if not name or "test" not in name.lower() or name == "sit_happens_local_test":
        raise RuntimeError(
            f"Refusing to drop {name!r} — release_critical_reset.py only ever "
            "runs against a database whose name unmistakably marks it disposable."
        )


def main() -> None:
    _assert_safe(DB_NAME)
    client = pymongo.MongoClient(os.environ["MONGO_URL"])
    client.drop_database(DB_NAME)
    db = client[DB_NAME]
    db.users.insert_one({
        "id": str(uuid.uuid4()), "email": "admin@sithappens.com",
        "password_hash": hash_password("admin123"), "name": "Admin", "role": "admin",
        "client_id": None, "created_at": "2026-08-01T00:00:00Z", "token_version": 0,
        "must_change_password": False,
    })
    client.close()
    asyncio.run(server.startup())


if __name__ == "__main__":
    main()
