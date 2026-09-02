"""Referral payout guard — structural, not a bigger cap.

The Rewards Center used to build its "already paid" exclusion set from a
newest-first `to_list(200)` slice of `referrals`, so once more than 200
referrals had ever been paid the oldest ones resurfaced as pending/ready.
The exclusion set is now a DB-side `distinct("referred_id")`. The manual
bonus branch of /clients/{id}/credit-referral also gained the same
idempotency guard the 1-credit branch always had.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_REFERRAL_STRUCT"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client(name, **extra):
    row = {"id": str(uuid.uuid4()), "name": f"{TAG} {name} {uuid.uuid4().hex[:5]}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
           "created_at": server.now_iso(), "credits": 0, "_tag": TAG}
    row.update(extra)
    run(server.db.clients.insert_one(row))
    return row


@contextlib.contextmanager
def _cleanup():
    try:
        yield
    finally:
        run(server.db.referrals.delete_many({"_tag": TAG}))
        run(server.db.referrals.delete_many({"referrer_name": {"$regex": f"^{TAG}"}}))
        run(server.db.rewards_ledger.delete_many({"reason": {"$regex": TAG}}))
        run(server.db.clients.delete_many({"_tag": TAG}))


def _paid_row(referred_id, referrer_id, age_days):
    ts = (datetime.now(timezone.utc) - timedelta(days=age_days)).isoformat()
    return {"id": str(uuid.uuid4()), "status": "paid", "referrer_id": referrer_id, "referrer_name": f"{TAG} r",
            "referred_id": referred_id, "referred_name": "x", "reward_service": "daycare", "bonus_credits": 1,
            "created_at": ts, "paid_at": ts, "_tag": TAG}


def test_old_paid_referral_never_resurfaces_past_the_display_limit():
    with _cleanup():
        referrer = _client("Referrer", referral_code=f"{TAG[:4]}{uuid.uuid4().hex[:4]}".upper())
        referred = _client("Referred", referred_by_code=referrer["referral_code"])
        # Paid long ago…
        run(server.db.referrals.insert_one(_paid_row(referred["id"], referrer["id"], age_days=400)))
        # …then 250 newer paid referrals for other people push it past any slice.
        run(server.db.referrals.insert_many([_paid_row(str(uuid.uuid4()), referrer["id"], age_days=i) for i in range(250)]))

        pending, paid, meta = run(server._build_referral_rows(limit=200))
        assert len(paid) == 200, "display list stays capped"
        assert all(r.get("referred_id") != referred["id"] for r in pending), \
            "an already-paid referral must never show as pending/ready again"

        # And the tiny limit used to be the whole bug — still excluded at limit=5.
        pending5, _, _ = run(server._build_referral_rows(limit=5))
        assert all(r.get("referred_id") != referred["id"] for r in pending5)


def test_unpaid_referral_still_shows_as_pending():
    with _cleanup():
        referrer = _client("Referrer", referral_code=f"{TAG[:4]}{uuid.uuid4().hex[:4]}".upper())
        referred = _client("Referred", referred_by_code=referrer["referral_code"])
        pending, _, _ = run(server._build_referral_rows())
        mine = [r for r in pending if r.get("referred_id") == referred["id"]]
        assert len(mine) == 1 and mine[0]["status"] == "pending" and mine[0]["referrer_id"] == referrer["id"]


def test_manual_bonus_credit_is_idempotent():
    with _cleanup():
        admin = _admin_user()
        referrer = _client("Referrer", referral_code=f"{TAG[:4]}{uuid.uuid4().hex[:4]}".upper())
        referred = _client("Referred", referred_by_code=referrer["referral_code"])
        body = {"referred_client_id": referred["id"], "bonus": 3, "note": f"{TAG} bonus"}
        first = run(server.credit_referral(referrer["id"], body, admin))
        second = run(server.credit_referral(referrer["id"], body, admin))
        assert first["id"] == second["id"], "second call must return the existing row, not pay again"
        assert run(server.db.referrals.count_documents({"referred_id": referred["id"]})) == 1
        bal = run(server.db.clients.find_one({"id": referrer["id"]}, {"_id": 0, "credits": 1}))
        assert float(bal.get("credits") or 0) == 3.0, "credited exactly once"
        # the 1-credit path is also blocked once any row exists
        third = run(server.credit_referral(referrer["id"], {"referred_client_id": referred["id"], "bonus": 1}, admin))
        assert third["id"] == first["id"]
        grant = run(server._grant_referral_reward_once(referred_client=referred, referrer=referrer))
        assert grant["id"] == first["id"]


def test_referral_indexes_exist():
    info = run(server.db.referrals.index_information())
    keys = {tuple(v["key"][0]) for v in info.values()}
    assert ("referred_id", 1) in keys and ("referrer_id", 1) in keys
