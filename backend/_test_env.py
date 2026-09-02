"""Isolates the ad hoc backend test suite (test_pos_catalog.py,
test_pos_checkout_integrity.py, test_front_desk_checkin.py,
test_shop_manager_polish.py) onto a dedicated, disposable MongoDB database —
never `sit_happens_local_test`, the real local dev database from .env.

Import this BEFORE `import server` in every ad hoc test file:

    import _test_env  # noqa: F401 — must run before `import server`
    import server

`server.py` calls `load_dotenv(ROOT_DIR / '.env')` with python-dotenv's
default `override=False`, so an env var already present in os.environ wins
over whatever `.env` sets. Setting DB_NAME here, before `server` is ever
imported, is what redirects its `db = mongo_client[os.environ["DB_NAME"]]`
connection onto the disposable test database instead of the real one.

The module-level code below runs exactly once per process (Python caches
imports), the first time any ad hoc test file imports this module — it
drops the disposable database clean before any test runs. That gives every
invocation of the ad hoc suite a guaranteed-empty starting state with no
manual steps and no dependency on leftover data or run order, regardless of
how large the real local dev database (`sit_happens_local_test`) has grown
from other work.
"""
import os
from pathlib import Path

# The in-process scheduler must never run against a test database.
os.environ.setdefault("SCHEDULER_ENABLED", "0")

from dotenv import load_dotenv
import pymongo

# A fixed, unmistakable name rather than a per-run random suffix — every ad
# hoc test run drops it clean before tests execute (see reset_test_database
# below), so a stable name also gives RELEASE_CHECKLIST.md and CI logs one
# consistent, greppable identity for "this is disposable test data."
TEST_DB_NAME = os.environ.get("SIT_HAPPENS_TEST_DB_NAME", "sit_happens_test_disposable")

# Real/reserved database names this guard must never treat as disposable,
# even if someone points SIT_HAPPENS_TEST_DB_NAME at one by mistake.
_FORBIDDEN_EXACT = {
    "sit_happens_local_test",  # the real local dev DB — see backend/.env
    "sit_happens", "sithappens", "admin", "local", "config", "test",
}


def assert_safe_test_db_name(name: str) -> None:
    """Refuse to run any destructive operation against anything that isn't
    unmistakably a disposable test database. Any future cleanup utility
    that performs a bulk/destructive operation against this database should
    call this first — the whole point is that a bug or misconfiguration
    here can never reach real data.
    """
    if not name or not isinstance(name, str) or name.strip() != name:
        raise RuntimeError(f"Refusing unsafe test-DB name: {name!r}")
    if name in _FORBIDDEN_EXACT:
        raise RuntimeError(
            f"Refusing to treat {name!r} as a disposable test database — "
            "it matches a real/reserved database name."
        )
    if "test" not in name.lower():
        raise RuntimeError(
            f"Refusing to treat {name!r} as a disposable test database — "
            "its name does not contain 'test'. Destructive test setup/"
            "cleanup only ever runs against a database whose name makes "
            "that unmistakable."
        )


def reset_test_database(mongo_url: str, db_name: str) -> None:
    """Synchronously drop `db_name` so the ad hoc suite always starts from
    an empty database. Plain pymongo (not motor) because this runs at
    module-import time, before _test_loop's asyncio event loop exists.
    """
    assert_safe_test_db_name(db_name)
    client = pymongo.MongoClient(mongo_url)
    try:
        client.drop_database(db_name)
    finally:
        client.close()


assert_safe_test_db_name(TEST_DB_NAME)

# Claim DB_NAME before anything (including our own load_dotenv call below,
# or server.py's later one) can set it from .env — override=False means
# whichever call sets it FIRST wins.
os.environ["DB_NAME"] = TEST_DB_NAME

# Populate MONGO_URL and everything else server.py needs (JWT_SECRET, etc.)
# from the same .env server.py reads, without disturbing the DB_NAME we
# just claimed above.
load_dotenv(Path(__file__).parent / ".env")

def seed_admin_user(mongo_url: str, db_name: str) -> None:
    """Seed the admin account into the just-dropped disposable database,
    exactly the way CI's release-critical job seeds it before app startup.

    _test_loop.py runs `server.startup()` against this database to create
    the unique indexes the idempotency guards depend on. startup()'s
    first-run security guard (Sprint 110di-46) refuses to CREATE a first
    admin when ADMIN_PASSWORD is a default like "admin123" — which is
    exactly what CI exports. CI resolves this for the uvicorn server by
    inserting the admin row itself before startup; this helper is that same
    seed for the ad hoc suite's disposable database, so the guard sees an
    existing admin (not a first run) and the production refusal stays fully
    intact and tested.
    """
    assert_safe_test_db_name(db_name)
    import uuid

    import bcrypt

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@sithappens.com").lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD") or "admin123"
    client = pymongo.MongoClient(mongo_url)
    try:
        client[db_name].users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": bcrypt.hashpw(admin_pw.encode(), bcrypt.gensalt()).decode(),
            "name": "Test Admin",
            "role": "admin",
            "client_id": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "token_version": 0,
            "must_change_password": False,
        })
    finally:
        client.close()


reset_test_database(os.environ["MONGO_URL"], TEST_DB_NAME)
seed_admin_user(os.environ["MONGO_URL"], TEST_DB_NAME)
