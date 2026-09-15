"""Release closure — selling a program to a dog that is already enrolled.

The rule: an active enrollment for this dog+program is the ONE canonical entitlement
(one active School enrollment per dog+program), so a repeat sale can never create a
second one. Charging again and quietly handing back the existing row would take money
for nothing, so the sale is refused up front with a structured answer that names the
enrollment. An operator who really is selling another block of sessions says so
explicitly; even then no second enrollment is created.

A completed enrollment does not block: buying the program again is a retake.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from fastapi import HTTPException

from test_online_school_phase5 import (  # noqa: F401
    TAG, _admin_user, _client_and_dog, _school_program, _OpenRegisterDay, _cleanup_dog_programs_and_lots,
)


def _sell(client_id, program_id, dog_id, admin, **kw):
    return run(server.sell_training_program(
        client_id, server.SellProgramIn(program_id=program_id, dog_id=dog_id, payment_method="cash", **kw), admin))


def _money(client_id, program_id):
    """Everything this sale is supposed to move: credit lots, recognised income, balance."""
    lots = run(server.db.credit_lots.count_documents({"client_id": client_id, "program_id": program_id}))
    income = run(server.db.retail_sales.count_documents({"client_id": client_id, "source_kind": "training_program_sale"}))
    client = run(server.db.clients.find_one({"id": client_id}, {"_id": 0, "training_credits": 1})) or {}
    return {"lots": lots, "income": income, "credits": int(client.get("training_credits") or 0)}


def _active(dog_id, program_id):
    return run(server.db.dog_programs.find(
        {"dog_id": dog_id, "program_id": program_id, "status": "active"}, {"_id": 0, "id": 1}).to_list(10))


def test_first_purchase_charges_once_and_creates_exactly_one_enrollment():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            before = _money(c["id"], prog["id"])
            res = _sell(c["id"], prog["id"], dog["id"], admin)
            after = _money(c["id"], prog["id"])

            assert res["enrollment"] is not None
            assert res.get("already_enrolled") is None
            assert after["lots"] == before["lots"] + 1
            assert after["income"] == before["income"] + 1
            assert after["credits"] > before["credits"]
            assert len(_active(dog["id"], prog["id"])) == 1
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_repeat_purchase_against_an_active_enrollment_is_refused_and_charges_nothing():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            first = _sell(c["id"], prog["id"], dog["id"], admin)
            enr_id = first["enrollment"]["id"]
            before = _money(c["id"], prog["id"])

            with pytest.raises(HTTPException) as e:
                _sell(c["id"], prog["id"], dog["id"], admin)

            # explicit, not swallowed: the answer names the dog, the program and the enrollment
            assert e.value.status_code == 409
            d = e.value.detail
            assert isinstance(d, dict) and d["code"] == "dog_already_enrolled"
            assert d["enrollment_id"] == enr_id
            assert d["dog_id"] == dog["id"] and d["program_id"] == prog["id"]
            assert d["dog_name"] == dog["name"] and d["program_name"] == prog["name"]
            assert "already enrolled" in d["msg"].lower() and "nothing was charged" in d["msg"].lower()
            assert d["resolution"] == "allow_additional_sessions"

            # and nothing moved: no second lot, no second income row, no extra credits
            assert _money(c["id"], prog["id"]) == before
            assert len(_active(dog["id"], prog["id"])) == 1
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_a_confirmed_additional_block_charges_once_more_and_still_creates_no_second_enrollment():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            first = _sell(c["id"], prog["id"], dog["id"], admin)
            enr_id = first["enrollment"]["id"]
            before = _money(c["id"], prog["id"])

            res = _sell(c["id"], prog["id"], dog["id"], admin, allow_additional_sessions=True)

            # the credits are real — the operator asked for them
            after = _money(c["id"], prog["id"])
            assert after["lots"] == before["lots"] + 1
            assert after["income"] == before["income"] + 1
            assert after["credits"] > before["credits"]

            # the training record is not: one enrollment, and the response says so plainly
            assert len(_active(dog["id"], prog["id"])) == 1
            assert res["enrollment"]["id"] == enr_id
            assert res["already_enrolled"]["enrollment_id"] == enr_id
            assert res["already_enrolled"]["sold_additional_sessions"] is True
            assert "no second one was created" in res["enrollment_warning"]
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_a_completed_enrollment_does_not_block_a_retake_purchase():
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            first = _sell(c["id"], prog["id"], dog["id"], admin)
            done_id = first["enrollment"]["id"]
            run(server.db.dog_programs.update_one({"id": done_id}, {"$set": {"status": "completed", "completed_at": server.now_iso()}}))
            run(server.db.school_enrollments.update_many({"enrollment_id": done_id}, {"$set": {"status": "completed"}}))
            before = _money(c["id"], prog["id"])

            res = _sell(c["id"], prog["id"], dog["id"], admin)   # no confirmation needed

            assert res.get("already_enrolled") is None
            assert res["enrollment"] is not None and res["enrollment"]["id"] != done_id
            after = _money(c["id"], prog["id"])
            assert after["lots"] == before["lots"] + 1 and after["income"] == before["income"] + 1
            actives = _active(dog["id"], prog["id"])
            assert len(actives) == 1 and actives[0]["id"] != done_id   # the retake, not the finished one
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_an_online_enrollment_also_blocks_a_repeat_sale_of_the_same_program():
    """The collision this closure item came from: an ONLINE enrollment used to fall past
    the staff-led branch, so the sale charged and then silently returned no enrollment."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            granted = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            online_id = granted["enrollment"]["id"]
            assert run(server.db.dog_programs.find_one({"id": online_id}, {"_id": 0}))["delivery_channel"] == "online_school"
            before = _money(c["id"], prog["id"])

            with pytest.raises(HTTPException) as e:
                _sell(c["id"], prog["id"], dog["id"], admin)
            assert e.value.status_code == 409
            assert e.value.detail["enrollment_id"] == online_id
            assert e.value.detail["delivery_mode"] in ("online", "self_guided")
            assert _money(c["id"], prog["id"]) == before          # the old bug charged here

            # confirming still refuses to build a second ledger for the same program
            res = _sell(c["id"], prog["id"], dog["id"], admin, allow_additional_sessions=True)
            assert res["enrollment"]["id"] == online_id
            assert [r["id"] for r in _active(dog["id"], prog["id"])] == [online_id]
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_a_sale_without_a_dog_is_unaffected():
    """Selling credits to the client with no dog named never looks at enrollments."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            _sell(c["id"], prog["id"], dog["id"], admin)          # dog is now enrolled
            before = _money(c["id"], prog["id"])
            res = run(server.sell_training_program(
                c["id"], server.SellProgramIn(program_id=prog["id"], payment_method="cash"), admin))
            assert res["enrollment"] is None and res.get("already_enrolled") is None
            after = _money(c["id"], prog["id"])
            assert after["lots"] == before["lots"] + 1 and after["income"] == before["income"] + 1
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_the_guard_runs_before_any_financial_write_even_when_the_grant_would_fail():
    """A dog already enrolled AND a program that cannot be granted: the refusal must still
    come from the guard, before the lot, rather than from a half-finished sale."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            _sell(c["id"], prog["id"], dog["id"], admin)
            run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {"modules": []}}))
            before = _money(c["id"], prog["id"])
            with pytest.raises(HTTPException) as e:
                _sell(c["id"], prog["id"], dog["id"], admin)
            assert e.value.status_code == 409 and e.value.detail["code"] == "dog_already_enrolled"
            assert _money(c["id"], prog["id"]) == before
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
