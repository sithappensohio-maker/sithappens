"""The trivia leaderboards leave staff out and name each family's dogs (audit #62).

Staff practice scores are stored under a "staff:" client id. The admin board
already left them out, but the family board listed them as "Player". Dogs are
stored with an owner_id, not a client_id, so neither board ever found a family's
dog names. Both boards now look dogs up by owner.

Disposable tag TEST_TRIVIA_BOARD. Calls the board functions directly.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_TRIVIA_BOARD"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "trivia-board@test"}


def _seed_family():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    today = server.business_today().isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": "Pat Lee", "email": f"{cid}@example.com", "tag": TAG}))
    # Stored the way create_dog writes it: owner_id, no client_id.
    run(server.db.dogs.insert_one({"id": f"{TAG}-dog-{uuid.uuid4().hex[:6]}", "name": "Rex", "owner_id": cid, "tag": TAG}))
    run(server.db.trivia_attempts.insert_one({"id": f"{TAG}-a-{uuid.uuid4().hex[:6]}", "client_id": cid, "date": today,
                                              "correct": True, "tag": TAG}))
    staff = f"staff:{uuid.uuid4().hex[:6]}"
    run(server.db.trivia_attempts.insert_one({"id": f"{TAG}-s-{uuid.uuid4().hex[:6]}", "client_id": staff, "date": today,
                                              "correct": True, "tag": TAG}))
    return cid, staff


def teardown_module():
    run(server.db.clients.delete_many({"tag": TAG}))
    run(server.db.dogs.delete_many({"tag": TAG}))
    run(server.db.trivia_attempts.delete_many({"tag": TAG}))


def test_the_family_board_leaves_out_staff_and_names_the_dogs():
    cid, staff = _seed_family()
    out = run(server.portal_trivia_leaderboard(user={"id": f"{TAG}-u", "role": "client", "client_id": cid}))
    assert not any(str(r["client_id"]).startswith("staff:") for r in out["top"])
    assert "Player" not in [r["display_name"] for r in out["top"]]
    assert out["me"]["dogs"] == ["Rex"]


def test_the_admin_board_names_the_dogs_and_leaves_out_staff():
    cid, staff = _seed_family()
    rows = {r["client_id"]: r for r in run(server.admin_trivia_leaderboard(ADMIN))["players"]}
    assert staff not in rows
    assert rows[cid]["dogs"] == ["Rex"]
