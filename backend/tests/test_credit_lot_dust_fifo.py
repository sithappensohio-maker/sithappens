"""Regression for the credit-lot FIFO "dust" bug confirmed live for
Stephanie Musial (2026-11-04).

Root cause: _consume_credit_lots walks credit_lots oldest-purchased-first
and decrements the chosen lot via repeated `$inc`. Ordinary binary
floating-point error can leave a fully-spent lot at a tiny nonzero value
(e.g. 5.551115123125783e-17) instead of exactly 0. That dust still matched
the old `qty_remaining: {"$gt": 0}` filter, so it was picked as the oldest
"available" lot, its rounded availability came out to 0, and the whole FIFO
walk `break`-ed instead of moving on — even with a real, newer lot sitting
right behind it with real credits. The Credit Audit report never caught
this because it rounds lot sums before comparing, so it showed a clean
match while live redemption (checkout AND the manual Adjust Credits action)
was silently/loudly broken underneath it.

Same convention as test_grandfathered_legacy_credits.py / test_background_
write_reliability.py: no pytest-asyncio plugin here, so async server code
is driven with a plain asyncio.run(...) wrapper, and each asyncio.run()
opens its own fresh AsyncIOMotorClient (Motor binds to the event loop of
its first operation).
"""
import os
import sys
import uuid
import asyncio

import requests
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402  (only for _migrate_snap_credit_lot_dust_to_zero — never for server.db)

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
DB_NAME = os.environ.get("DB_NAME", "sit_happens")

DUST = 5.551115123125783e-17  # the exact value observed live


ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@sithappens.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


def _admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _seed_client_with_dusty_and_real_lots(name, dust_remaining):
    """One old, fully-spent lot left at `dust_remaining` (not exactly 0),
    purchased BEFORE a second, real lot with 10 genuine remaining credits —
    FIFO order matters: the dusty lot must sort first."""
    client_id = str(uuid.uuid4())
    old_lot_id = str(uuid.uuid4())
    new_lot_id = str(uuid.uuid4())

    async def _run():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[DB_NAME]
            await db.clients.insert_one({
                "id": client_id, "name": name, "email": f"{uuid.uuid4().hex[:8]}@example.com",
                "credits": 10, "training_credits": 0, "boarding_credits": 0,
            })
            await db.credit_lots.insert_many([
                {
                    "id": old_lot_id, "client_id": client_id, "pack_id": None,
                    "pack_name": "Old pack (fully spent)", "service_type": "daycare",
                    "qty_total": 10, "qty_remaining": dust_remaining,
                    "price_paid": 220.0, "list_price": 220.0, "value_each": 22.0,
                    "payment_method": "cash", "note": "", "sold_by": "test-seed",
                    "purchased_at": "2026-09-01T19:54:15.113263+00:00",
                },
                {
                    "id": new_lot_id, "client_id": client_id, "pack_id": None,
                    "pack_name": "10 Days of Daycare", "service_type": "daycare",
                    "qty_total": 10, "qty_remaining": 10,
                    "price_paid": 220.0, "list_price": 265.0, "value_each": 22.0,
                    "payment_method": "card", "note": "", "sold_by": "test-seed",
                    "purchased_at": "2026-10-13T10:06:17.545979+00:00",
                },
            ])
        finally:
            mc.close()

    asyncio.run(_run())
    return client_id, old_lot_id, new_lot_id


def test_manual_credit_removal_skips_dusty_old_lot_and_uses_real_newer_lot():
    """This is exactly the bug the owner hit live: an old, fully-spent lot
    with float-drift dust must not make a client's real, newer credits look
    unusable. Before the fix this 400/409'd with "lots only have 0
    available to remove" even though 10 real credits existed."""
    client_id, old_lot_id, new_lot_id = _seed_client_with_dusty_and_real_lots(
        f"Dust Test {uuid.uuid4().hex[:6]}", DUST,
    )
    headers = _admin_headers()

    r = requests.post(f"{API}/clients/{client_id}/adjust-credits", headers=headers,
                       json={"daycare": -1, "note": "regression test"}, timeout=15)
    assert r.status_code == 200, (
        f"Manual removal failed with the exact live symptom — a dusty old lot "
        f"blocked a real newer one. status={r.status_code} body={r.text}"
    )
    changes = r.json()["changes"]["daycare"]
    assert changes["after"] == 9, f"expected balance to drop to 9, got {changes}"

    async def _check():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[DB_NAME]
            old_lot = await db.credit_lots.find_one({"id": old_lot_id}, {"_id": 0, "qty_remaining": 1})
            new_lot = await db.credit_lots.find_one({"id": new_lot_id}, {"_id": 0, "qty_remaining": 1})
            return old_lot, new_lot
        finally:
            mc.close()

    old_lot, new_lot = asyncio.run(_check())
    # Below the >0.0001 floor, the dusty lot is excluded from the query
    # outright — _consume_credit_lots never touches it at all, so it's left
    # exactly as seeded. Cleaning up PRE-EXISTING sub-floor dust like this is
    # the one-time migration's job (see the other test in this file), not
    # every redemption call's. What must be true here is that the dust
    # didn't block the withdrawal and didn't get drawn from.
    assert old_lot["qty_remaining"] == DUST, (
        f"dusty lot should be left untouched by this call, got {old_lot['qty_remaining']!r}"
    )
    assert new_lot["qty_remaining"] == 9, (
        f"the real credit should come from the newer lot (FIFO, oldest-usable-first), got {new_lot}"
    )


def test_manual_credit_removal_self_heals_a_lot_that_rounds_to_zero_but_clears_the_floor():
    """A residue that clears the >0.0001 query floor but still rounds to
    nothing usable at 2dp (e.g. 0.003) DOES reach _consume_credit_lots'
    take<=0 branch — this exercises the self-heal snap-to-0 added there,
    which the sub-floor case above can't reach (it's filtered out earlier)."""
    near_zero = 0.003
    client_id, old_lot_id, new_lot_id = _seed_client_with_dusty_and_real_lots(
        f"Near-Zero Test {uuid.uuid4().hex[:6]}", near_zero,
    )
    headers = _admin_headers()

    r = requests.post(f"{API}/clients/{client_id}/adjust-credits", headers=headers,
                       json={"daycare": -1, "note": "regression test"}, timeout=15)
    assert r.status_code == 200, f"status={r.status_code} body={r.text}"
    assert r.json()["changes"]["daycare"]["after"] == 9

    async def _check():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[DB_NAME]
            old_lot = await db.credit_lots.find_one({"id": old_lot_id}, {"_id": 0, "qty_remaining": 1})
            new_lot = await db.credit_lots.find_one({"id": new_lot_id}, {"_id": 0, "qty_remaining": 1})
            return old_lot, new_lot
        finally:
            mc.close()

    old_lot, new_lot = asyncio.run(_check())
    assert old_lot["qty_remaining"] == 0, (
        f"a lot that cleared the query floor but rounds to 0 usable should self-heal to exact 0, "
        f"got {old_lot['qty_remaining']!r}"
    )
    assert new_lot["qty_remaining"] == 9, f"got {new_lot}"


def test_dust_migration_snaps_existing_dust_to_exact_zero():
    """The one-time startup backfill (_migrate_snap_credit_lot_dust_to_zero)
    must clean up dust that already exists in the DB from before this fix,
    without touching a lot that has a real, non-dust balance."""
    client_id, dusty_lot_id, real_lot_id = _seed_client_with_dusty_and_real_lots(
        f"Dust Migration Test {uuid.uuid4().hex[:6]}", DUST,
    )

    async def _run():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        original_db = server.db  # restore after — other tests in this
        # process may import `server` and expect its own db handle intact.
        try:
            server.db = mc[DB_NAME]
            await server._migrate_snap_credit_lot_dust_to_zero()
            dusty = await server.db.credit_lots.find_one({"id": dusty_lot_id}, {"_id": 0, "qty_remaining": 1})
            real = await server.db.credit_lots.find_one({"id": real_lot_id}, {"_id": 0, "qty_remaining": 1})
            return dusty, real
        finally:
            server.db = original_db
            mc.close()

    dusty, real = asyncio.run(_run())
    assert dusty["qty_remaining"] == 0, f"dust should be snapped to exact 0, got {dusty}"
    assert real["qty_remaining"] == 10, f"a real 10-credit lot must be untouched, got {real}"
