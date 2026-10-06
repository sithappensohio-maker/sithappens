"""Selling a self-guided online course at the desk gives course access only.

Audit finding (2026-09-25): "Sell Program" on a client's page gave a
self-guided online course's dog access to the course — and also added
in-person training credits (one per lesson) and, with the schedule box
ticked by default, booked weekly in-person training sessions. The client
walked away with free in-person lessons and the calendar filled with
sessions nobody was coming to.

Now an online-only course (purchase_fulfillment online_school, delivery
self_guided) records the sale and grants access — no credits, no sessions,
and it needs the dog picked. Credits-only and hybrid ("both") programs are
unchanged.
"""
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ONLINE_COURSE_DESK"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


class _OpenRegisterDay:
    def __init__(self, tag):
        self.tag = tag

    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{self.tag}-register-{uuid.uuid4()}"
        self.created = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {"date": self.date, "opening_cash": 0.0, "opened_at": server.now_iso(),
                              "opened_by": self.marker, "opened_by_name": f"{self.tag} fixture"}},
            upsert=True, projection={"_id": 0})) is None
        return self

    def __exit__(self, *exc):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


@contextlib.contextmanager
def _client_and_dog():
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    c = {"id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com", "training_credits": 0}
    run(server.db.clients.insert_one(dict(c)))
    dog = {"id": did, "name": f"{TAG} Dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
           "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}}
    run(server.db.dogs.insert_one(dict(dog)))
    try:
        yield c, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": cid}))


@contextlib.contextmanager
def _school_program(purchase_fulfillment=None, available_online=False, delivery_mode="self_guided"):
    admin = _admin_user()
    kw = dict(name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
              format={"count": 1, "unit": "modules"}, price=100, delivery_mode=delivery_mode,
              available_online=available_online,
              modules=[server.ModuleIn(name="Module 1", order=0, goals=[server.GoalIn(name="Skill 1")])])
    if purchase_fulfillment is not None:
        kw["purchase_fulfillment"] = purchase_fulfillment
    prog = run(server.create_program(server.ProgramIn(**kw), admin))
    m = prog["modules"][0]
    lesson = server.LessonIn(name="Lesson 1", order=0, active=True, skill_ids=[m["goals"][0]["id"]],
                             client_overview="overview", why_it_matters="matters", success_criteria="criteria")
    fixed = dict(kw)
    fixed["modules"] = [server.ModuleIn(id=m["id"], name=m["name"], order=m["order"],
                                        goals=[server.GoalIn(**g) for g in m["goals"]], lessons=[lesson])]
    prog = run(server.update_program(prog["id"], server.ProgramIn(**fixed), cascade=False, save_as_draft=False, _=admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _cleanup_dog_programs_and_lots(dog_id, client_id):
    for coll, key, val in (("dog_programs", "dog_id", dog_id), ("school_enrollments", "dog_id", dog_id),
                           ("credit_lots", "client_id", client_id), ("retail_sales", "client_id", client_id),
                           ("homework", "dog_id", dog_id)):
        run(server.db[coll].delete_many({key: val}))


def _sell(c, prog, admin, **kw):
    body = dict(program_id=prog["id"], payment_method="cash", **kw)
    return run(server.sell_training_program(c["id"], server.SellProgramIn(**body), admin))


def test_an_online_course_sale_gives_access_but_no_credits_or_sessions():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            before = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            out = _sell(c, prog, admin, dog_id=dog["id"], schedule_day_of_week=1, schedule_time="10:00")
            assert out["enrollment"] and out["scheduled_bookings"] == []
            after = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            assert after == before
            lot = run(server.db.credit_lots.find_one({"id": out["lot"]["id"]}, {"_id": 0}))
            assert lot["qty_remaining"] == 0 and lot["online_course"] is True
            assert run(server.db.bookings.count_documents({"dog_id": dog["id"], "is_prepaid_program_session": True})) == 0
            # The money is still on the books.
            assert run(server.db.retail_sales.count_documents({"source_id": lot["id"]})) == 1
        finally:
            run(server.db.bookings.delete_many({"dog_id": dog["id"]}))
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_an_online_course_needs_the_dog_taking_it():
    with _client_and_dog() as (c, _dog), _school_program(purchase_fulfillment="online_school") as (prog, admin), _OpenRegisterDay(TAG):
        with pytest.raises(server.HTTPException) as err:
            _sell(c, prog, admin)
        assert err.value.status_code == 400
        assert run(server.db.credit_lots.count_documents({"client_id": c["id"]})) == 0


# ── Both-delivery Online School courses (decided 2026-10-05): the desk sells
#    them as access only, exactly like the Shop — no credits, no sessions.

def test_a_both_delivery_online_course_sale_gives_access_but_no_credits_or_sessions():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", delivery_mode="both") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            before = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            out = _sell(c, prog, admin, dog_id=dog["id"], schedule_day_of_week=1, schedule_time="10:00")
            # The same access grant the Shop uses: a purchase-sourced Online School enrollment.
            assert out["enrollment"] and out["enrollment"]["status"] == "active"
            row = _enrollment(dog["id"], prog["id"])
            assert row is not None and row["enrollment_source"] == "purchase"
            assert out["scheduled_bookings"] == []
            assert out["client_balance"] == before
            after = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            assert after == before
            lot = run(server.db.credit_lots.find_one({"id": out["lot"]["id"]}, {"_id": 0}))
            assert lot["qty_total"] == 0 and lot["qty_remaining"] == 0 and lot["online_course"] is True
            assert run(server.db.bookings.count_documents({"dog_id": dog["id"], "is_prepaid_program_session": True})) == 0
            assert run(server.db.retail_sales.count_documents({"source_id": lot["id"]})) == 1
        finally:
            run(server.db.bookings.delete_many({"dog_id": dog["id"]}))
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_a_both_delivery_online_course_still_needs_the_dog_taking_it():
    with _client_and_dog() as (c, _dog), _school_program(purchase_fulfillment="online_school", delivery_mode="both") as (prog, admin), _OpenRegisterDay(TAG):
        with pytest.raises(server.HTTPException) as err:
            _sell(c, prog, admin)
        assert err.value.status_code == 400
        assert run(server.db.credit_lots.count_documents({"client_id": c["id"]})) == 0


def test_an_in_person_both_delivery_program_still_gives_its_credits():
    """A both-capable program sold as credits (not Online School fulfillment)
    is an in-person sale and keeps issuing its training credits."""
    with _client_and_dog() as (c, dog), _school_program(delivery_mode="both") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            before = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            out = _sell(c, prog, admin, dog_id=dog["id"])
            after = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            assert after == before + (prog.get("format") or {}).get("count", 1)
            assert out["lot"]["qty_total"] == (prog.get("format") or {}).get("count", 1)
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_selling_the_same_course_again_to_an_enrolled_dog_charges_nothing():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            _sell(c, prog, admin, dog_id=dog["id"])
            lots = run(server.db.credit_lots.count_documents({"client_id": c["id"]}))
            with pytest.raises(server.HTTPException) as err:
                _sell(c, prog, admin, dog_id=dog["id"], allow_additional_sessions=True)
            assert err.value.status_code == 409 and err.value.detail["code"] == "dog_already_owns_course"
            assert run(server.db.credit_lots.count_documents({"client_id": c["id"]})) == lots
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_a_credits_only_program_still_gives_its_credits():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            before = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            _sell(c, prog, admin, dog_id=dog["id"])
            after = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "training_credits": 1})).get("training_credits") or 0
            assert after == before + (prog.get("format") or {}).get("count", 1)
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


# ── Lifetime access (owner, 2026-09-26): owned is never sold again; a refunded
#    course can be bought back.

def _enrollment(dog_id, prog_id):
    return run(server.db.dog_programs.find_one(
        {"dog_id": dog_id, "program_id": prog_id, "delivery_channel": "online_school"}, {"_id": 0}, sort=[("created_at", -1)]))


def test_a_dog_that_finished_the_course_still_owns_it_so_nothing_is_sold():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            _sell(c, prog, admin, dog_id=dog["id"])
            first = _enrollment(dog["id"], prog["id"])
            run(server.db.dog_programs.update_one({"id": first["id"]}, {"$set": {"status": "completed"}}))
            lots = run(server.db.credit_lots.count_documents({"client_id": c["id"]}))
            with pytest.raises(server.HTTPException) as err:
                _sell(c, prog, admin, dog_id=dog["id"])
            assert err.value.status_code == 409 and err.value.detail["code"] == "dog_already_owns_course"
            assert "Retake" in err.value.detail["msg"]
            assert run(server.db.credit_lots.count_documents({"client_id": c["id"]})) == lots
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_a_refunded_course_can_be_bought_back_and_starts_fresh():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            _sell(c, prog, admin, dog_id=dog["id"])
            old = _enrollment(dog["id"], prog["id"])
            # What a refund does: withdrawn, access revoked.
            run(server.db.dog_programs.update_one({"id": old["id"]}, {"$set": {"status": "withdrawn", "access_state": "revoked"}}))
            out = _sell(c, prog, admin, dog_id=dog["id"])
            new = run(server.db.dog_programs.find_one({"id": out["enrollment"]["id"]}, {"_id": 0}))
            assert new["id"] != old["id"] and new["status"] == "active"
            assert new.get("access_state") != "revoked"
            assert new["retake_of_enrollment_id"] == old["id"]
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_access_removed_mid_course_is_handed_back_on_the_same_attempt():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            _sell(c, prog, admin, dog_id=dog["id"])
            row = _enrollment(dog["id"], prog["id"])
            run(server.db.dog_programs.update_one({"id": row["id"]}, {"$set": {"access_state": "revoked"}}))
            out = _sell(c, prog, admin, dog_id=dog["id"])
            assert out["enrollment"]["id"] == row["id"]
            assert run(server.db.dog_programs.find_one({"id": row["id"]}, {"_id": 0}))["access_state"] == "active"
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_the_shop_lets_a_refunded_client_buy_back_but_not_an_owner():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin), _OpenRegisterDay(TAG):
        try:
            _sell(c, prog, admin, dog_id=dog["id"])
            row = _enrollment(dog["id"], prog["id"])
            run(server.db.dog_programs.update_one({"id": row["id"]}, {"$set": {"status": "completed"}}))
            with pytest.raises(server.HTTPException) as err:
                run(server._validate_shop_item_eligibility(c, "training_program", prog, 1, dog_id=dog["id"]))
            assert err.value.status_code == 409 and "for life" in str(err.value.detail)
            run(server.db.dog_programs.update_one({"id": row["id"]}, {"$set": {"access_state": "revoked"}}))
            run(server._validate_shop_item_eligibility(c, "training_program", prog, 1, dog_id=dog["id"]))
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
