"""Only the "pricing" permission may type a different training-program price
(audit: "The front desk can sell a training program at any price it types").
The refusal happens before anything is written. Typing the list price is
still fine. Disposable tag TEST_SELL_PRICE."""
import datetime as dt
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_SELL_PRICE"
TUESDAY = dt.date(2030, 1, 8)
OWNER = {"id": f"{TAG}-owner", "name": f"{TAG} owner", "email": f"{TAG.lower()}-o@example.com", "role": "admin"}


def _desk():
    return {"id": f"{TAG}-desk-{uuid.uuid4().hex[:6]}", "name": f"{TAG} desk", "email": f"{uuid.uuid4().hex[:8]}@example.com",
            "role": "admin", "staff_role": "front_desk"}


@pytest.fixture()
def world(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: TUESDAY)
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "training_credits": 0}))
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                   "vaccines": {"rabies": "2031-01-01", "dhpp": "2031-01-01", "bordetella": "2031-01-01"}}))
    prog = run(server.create_program(server.ProgramIn(
        name=f"{TAG} program {uuid.uuid4().hex[:6]}", type="private_lessons", format={"count": 2, "unit": "sessions"},
        price=100, delivery_mode="trainer_led"), OWNER))
    day = TUESDAY.isoformat()
    run(server.db.cash_drawer_sessions.insert_one({"date": day, "opening_cash": 0.0, "opened_at": server.now_iso(),
                                                   "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}))
    yield {"cid": cid, "did": did, "prog": prog, "day": day}
    run(server.db.cash_drawer_sessions.delete_many({"date": day, "notes": TAG}))
    for coll in ("bookings", "dog_programs", "school_enrollments", "homework"):
        run(server.db[coll].delete_many({"dog_id": did}))
    for coll in ("credit_lots", "retail_sales"):
        run(server.db[coll].delete_many({"client_id": cid}))
    run(server.db.programs.delete_one({"id": prog["id"]}))
    run(server.db.dogs.delete_one({"id": did}))
    run(server.db.clients.delete_one({"id": cid}))


def _sell(w, user, override=None):
    return run(server.sell_training_program(w["cid"], server.SellProgramIn(
        program_id=w["prog"]["id"], payment_method="cash", dog_id=w["did"], schedule_day_of_week=TUESDAY.weekday(),
        schedule_time="10:00", override_price=override), user))


def _nothing_written(w):
    assert run(server.db.credit_lots.count_documents({"client_id": w["cid"]})) == 0
    assert run(server.db.retail_sales.count_documents({"client_id": w["cid"]})) == 0


def test_the_front_desk_cannot_type_a_program_price(world):
    with pytest.raises(server.HTTPException) as err:
        _sell(world, _desk(), override=1.0)
    assert err.value.status_code == 403
    _nothing_written(world)


def test_the_front_desk_cannot_comp_a_program(world):
    with pytest.raises(server.HTTPException) as err:
        _sell(world, _desk(), override=0)
    assert err.value.status_code == 403
    _nothing_written(world)


def test_the_front_desk_may_sell_at_the_list_price(world):
    out = _sell(world, _desk(), override=100)
    assert out is not None
    assert run(server.db.credit_lots.count_documents({"client_id": world["cid"]})) >= 1


def test_the_owner_may_type_a_program_price(world):
    out = _sell(world, OWNER, override=150)
    assert out is not None
