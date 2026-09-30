"""Prepaid program sessions work like any training visit (audit #38).

A program sale books its sessions stamped "paid", and the checkout lock
counted "paid" as closed: the sessions could not be checked in, checked out,
cancelled (jargon) or moved, and since checkout never ran, the program credit
each session is meant to use was never used.

Disposable tag TEST_PREPAID_SESSION.
"""
import contextlib
import uuid
from datetime import timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run
from domains.bookings import prepaid_sessions
from domains.clients import archive

TAG = "TEST_PREPAID_SESSION"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
VACCINES_OK = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}
ADMIN = {"id": f"{TAG}-staff", "role": "admin", "name": "QA Owner"}


def _day(n):
    return (server.business_today() + timedelta(days=n)).isoformat()


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


@contextlib.contextmanager
def _user(role="admin", client_id=None):
    u = {"id": f"{TAG}-u-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": f"{TAG} user",
         "role": role, "password_hash": "x", "active": True, **({"client_id": client_id} if client_id else {})}
    run(server.db.users.insert_one(dict(u)))
    try:
        yield u
    finally:
        run(server.db.users.delete_one({"id": u["id"]}))


@contextlib.contextmanager
def _program_family(credits=3, other_program_credits=0):
    """A family that bought a program (credits on a program lot) and one of
    its weekly sessions, exactly as sell_training_program books it."""
    cid, did, pid = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}", f"{TAG}-p-{uuid.uuid4().hex[:6]}"
    lot = {"id": f"{TAG}-lot-{uuid.uuid4().hex[:6]}", "client_id": cid, "service_type": "training", "pack_kind": "training_program",
           "program_id": pid, "qty_total": credits, "qty_remaining": credits, "value_each": 100.0, "purchased_at": "2026-09-02T10:00:00"}
    lots = [lot]
    if other_program_credits:
        lots.append({**lot, "id": f"{TAG}-lot-other-{uuid.uuid4().hex[:6]}", "program_id": f"{TAG}-p-other",
                     "qty_total": other_program_credits, "qty_remaining": other_program_credits, "value_each": 80.0,
                     "purchased_at": "2026-01-01T10:00:00"})   # older: FIFO would take it first
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Smith", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "training_credits": credits + other_program_credits,
                                      "waiver": True, "created_at": server.now_iso()}))
    run(server.db.dogs.insert_one({"id": did, "name": "Rosie", "owner_id": cid, "breed": "Mix", "vaccines": dict(VACCINES_OK)}))
    for x in lots:
        run(server.db.credit_lots.insert_one(dict(x)))
    try:
        yield {"client_id": cid, "dog_id": did, "program_id": pid, "lot_id": lot["id"]}
    finally:
        run(server.db.bookings.delete_many({"client_id": cid}))
        run(server.db.credit_lots.delete_many({"client_id": cid}))
        run(server.db.reschedule_requests.delete_many({"client_id": cid}))
        run(server.db.training_session_log.delete_many({"notes": TAG}))
        run(server.db.dogs.delete_many({"id": did}))
        run(server.db.clients.delete_many({"id": cid}))


def _session(f, date=None, **extra):
    b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": f["dog_id"], "dog_name": "Rosie", "client_id": f["client_id"],
         "client_name": f"{TAG} Smith", "service_type": "training", "date": date or _day(0), "end_date": None, "time": "10:00",
         "kennel": "", "notes": "Program · Basics · session 1 of 3", "status": "approved", "actual_price": 0.0,
         "payment_status": "paid", "payment_method": "credits", "created_at": server.now_iso(), "created_by": "x",
         "credit_lot_id": f["lot_id"], "program_id": f["program_id"], "program_sale_session_index": 1,
         "program_sale_session_total": 3, "is_prepaid_program_session": True}
    b.update(extra)
    run(server.db.bookings.insert_one(dict(b)))
    return b


def _get(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _credits(cid):
    return run(server.db.clients.find_one({"id": cid}))["training_credits"]


def _check_in_out(b, admin, **checkout):
    r = run(_http.post(f"/api/bookings/{b['id']}/check-in", json={"vaccine_ack": True}, headers=_auth(admin)))
    assert r.status_code == 200, r.text
    r = run(_http.post(f"/api/bookings/{b['id']}/check-out", json=checkout, headers=_auth(admin)))
    assert r.status_code == 200, r.text
    return _get(b["id"])


# ───────────────────────────────────── it happens: check in, check out

def test_a_session_checks_in_and_out_using_one_credit_from_its_own_program_and_charges_nothing():
    with _user() as admin, _program_family(credits=3, other_program_credits=2) as f:
        b = _session(f)
        after = _check_in_out(b, admin)
        assert after["status"] == "completed" and after["checked_out_at"]
        assert after["credits_deducted"] == 1 and after["credit_lot_ids"] == [f["lot_id"]], "its own program's credit, not the older lot"
        assert after["payment_method"] == "credits" and not float(after.get("cash_revenue") or 0)
        assert _credits(f["client_id"]) == 4
        assert run(server.db.credit_lots.find_one({"id": f["lot_id"]}))["qty_remaining"] == 2
        with pytest.raises(HTTPException) as e:
            run(server._cancel_booking_impl(b["id"], False, ADMIN))
        assert e.value.status_code == 409, "checked out: closed again"


def test_with_no_program_credit_left_it_is_recorded_at_zero_never_charged():
    with _user() as admin, _program_family(credits=0) as f:
        b = _session(f)
        after = _check_in_out(b, admin, use_credits=False)   # even with credits switched off
        assert after["status"] == "completed" and float(after["actual_price"]) == 0.0
        assert after["payment_status"] == "paid" and after.get("prepaid_no_credit_left") is True
        assert not float(after.get("cash_revenue") or 0) and not float(after.get("amount_paid") or 0)
        assert _credits(f["client_id"]) == 0


# ─────────────────────────────── it doesn't happen: cancel, move

def test_staff_cancel_a_session_in_plain_words_and_the_credit_stays_with_the_family():
    with _program_family() as f:
        b = _session(f, date=_day(5))
        run(server.db.reschedule_requests.insert_one({"id": f"{TAG}-rr", "booking_id": b["id"], "client_id": f["client_id"], "status": "pending"}))
        run(server._cancel_booking_impl(b["id"], False, ADMIN))
        assert _get(b["id"])["status"] == "cancelled"
        assert _credits(f["client_id"]) == 3, "nothing was used, nothing to give back"
        assert run(server.db.reschedule_requests.find_one({"id": f"{TAG}-rr"}))["status"] == "declined"


def test_a_client_can_cancel_their_own_session_ahead_of_time():
    with _program_family() as f, _user(role="client", client_id=f["client_id"]) as client:
        b = _session(f, date=_day(9))
        r = run(_http.delete(f"/api/bookings/{b['id']}", headers=_auth(client)))
        assert r.status_code == 200, r.text
        assert _get(b["id"])["status"] == "cancelled"


def test_a_lesson_a_trainer_already_recorded_cannot_be_cancelled():
    with _program_family() as f:
        b = _session(f)
        run(server.db.training_session_log.insert_one({"id": f"{TAG}-log", "booking_id": b["id"], "notes": TAG}))
        with pytest.raises(HTTPException) as e:
            run(server._cancel_booking_impl(b["id"], False, ADMIN))
        assert e.value.block["code"] == "lesson_recorded" and "so it happened and can't be cancelled" in e.value.detail
        assert _get(b["id"])["status"] == "approved"


def test_a_clients_reschedule_request_can_be_approved_but_never_for_a_cancelled_session():
    with _program_family() as f:
        b = _session(f, date=_day(6))
        new_day = _day(13)
        req = {"id": f"{TAG}-rr2", "booking_id": b["id"], "client_id": f["client_id"], "dog_id": f["dog_id"], "status": "pending",
               "proposed_slots": [{"date": new_day, "time": "10:00"}], "created_at": server.now_iso()}
        run(server.db.reschedule_requests.insert_one(dict(req)))
        r = run(server.approve_reschedule_request(req["id"], server.RescheduleApproveIn(slot_index=0), ADMIN))
        assert _get(b["id"])["date"] == new_day, r
        gone = _session(f, date=_day(7), status="cancelled", payment_status=None)   # only the status guard stops this move
        run(server.db.reschedule_requests.insert_one({**req, "id": f"{TAG}-rr3", "booking_id": gone["id"]}))
        with pytest.raises(HTTPException) as e:
            run(server.approve_reschedule_request(f"{TAG}-rr3", server.RescheduleApproveIn(slot_index=0), ADMIN))
        assert e.value.status_code == 409 and _get(gone["id"])["date"] == _day(7)


def test_next_week_skips_a_holiday_from_the_real_settings():
    with _program_family() as f:
        b = _session(f, date=_day(3))
        holiday = _day(10)
        run(server.get_settings())
        before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"closed_dates": [holiday]}}))
        try:
            out = run(server.reschedule_prepaid_session(b["id"], ADMIN))
        finally:
            run(server.db.settings.replace_one({"id": "global"}, before))
        assert out["to"] == _day(17), "the holiday a week out is skipped"


# ─────────────────────────── its price stays the program's

def test_its_price_and_payment_cannot_be_changed_or_stripped_from_income():
    with _program_family() as f:
        b = _session(f, date=_day(4))
        with pytest.raises(HTTPException) as e:
            run(server.update_transaction(b["id"], server.TransactionUpdateIn(actual_price=55.0), ADMIN))
        assert "part of a prepaid program" in e.value.detail
        with pytest.raises(HTTPException) as e:
            run(server.delete_transaction(b["id"], ADMIN))
        assert "cancel it instead" in e.value.detail
        assert _get(b["id"])["payment_status"] == "paid" and float(_get(b["id"])["actual_price"]) == 0.0
        assert prepaid_sessions.is_open(_get(b["id"])) and not server._booking_is_financially_locked(_get(b["id"]))


def test_an_archive_offers_cancel_on_a_prepaid_session():
    with _program_family() as f:
        b = _session(f, date=_day(4))
        with pytest.raises(HTTPException) as e:
            run(archive.archive_client(f["client_id"], ADMIN))
        row = e.value.block["upcoming"][0]
        assert row["id"] == b["id"] and row["can_cancel"] is True and row["prepaid"] is True


# ─────────────────────────────────────────── review round (audit #38)

@pytest.fixture
def register_open(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


@contextlib.contextmanager
def _settings(**patch):
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": patch}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


def test_the_screens_payment_body_is_never_taken_as_cash_on_a_session(register_open):
    """With no credit left the old screen showed the lesson price as due and
    sent it; the session must still record no money taken."""
    with _user() as admin, _program_family(credits=0) as f:
        b = _session(f)
        after = _check_in_out(b, admin, use_credits=True, payment_method="cash", payment_status="paid",
                              amount_paid=90, base_price=90, additional_cash_charge=20)
        assert float(after["actual_price"]) == 0.0 and not float(after.get("amount_paid") or 0)
        assert not after.get("cash_payment_method") and server._cash_revenue(after) == 0.0


def test_no_holiday_surcharge_on_a_session():
    today = server.business_today().isoformat()
    with _user() as admin, _program_family() as f, \
            _settings(**{"day_to_day.seasonal.holiday_surcharges": [{"date": today, "multiplier": 1.5, "label": "Holiday"}]}):
        after = _check_in_out(_session(f, date=today), admin)
        assert not float(after.get("amount_paid") or 0) and not after.get("cash_payment_method")
        assert server._cash_revenue(after) == 0.0 and not after.get("money_modifier_breakdown")


def test_add_on_cash_taken_on_a_session_counts_as_income_once(register_open):
    with _user() as admin, _program_family() as f:
        svc = {"id": f"{TAG}-nails", "name": "Nail trim", "service_type": "grooming", "active": True, "base_price": 15.0, "is_addon": True}
        run(server.db.services.replace_one({"id": svc["id"]}, dict(svc), upsert=True))
        try:
            after = _check_in_out(_session(f), admin, add_ons=[{"service_id": svc["id"], "name": "Nail trim", "price": 15.0, "qty": 1}],
                                  payment_method="card", payment_status="paid", amount_paid=15)
        finally:
            run(server.db.services.delete_one({"id": svc["id"]}))
        assert after["credits_deducted"] == 1, "the session itself is the program's credit"
        assert float(after["amount_paid"]) == 15.0 and server._cash_revenue(after) == 15.0, "only the add-on is new money"


def test_a_session_under_way_or_already_taught_is_never_moved():
    with _program_family() as f:
        here = _session(f, date=_day(0), checked_in_at=server.now_iso())
        req = {"id": f"{TAG}-rr4", "booking_id": here["id"], "client_id": f["client_id"], "dog_id": f["dog_id"], "status": "pending",
               "proposed_slots": [{"date": _day(7), "time": "10:00"}], "created_at": server.now_iso()}
        run(server.db.reschedule_requests.insert_one(dict(req)))
        with pytest.raises(HTTPException) as e:
            run(server.approve_reschedule_request(req["id"], server.RescheduleApproveIn(slot_index=0), ADMIN))
        assert e.value.block["code"] == "checked_in" and _get(here["id"])["date"] == _day(0)
        taught = _session(f, date=_day(2))
        run(server.db.training_session_log.insert_one({"id": f"{TAG}-log2", "booking_id": taught["id"], "notes": TAG}))
        with pytest.raises(HTTPException) as e:
            run(server.reschedule_prepaid_session(taught["id"], ADMIN))
        assert e.value.block["code"] == "lesson_recorded" and _get(taught["id"])["date"] == _day(2)


def test_a_client_is_told_plainly_that_a_lesson_already_happened():
    with _program_family() as f, _user(role="client", client_id=f["client_id"]) as client:
        b = _session(f, date=_day(9))
        run(server.db.training_session_log.insert_one({"id": f"{TAG}-log3", "booking_id": b["id"], "notes": TAG}))
        r = run(_http.delete(f"/api/bookings/{b['id']}", headers=_auth(client)))
        assert r.status_code == 409 and r.json()["block"] == {"code": "lesson_recorded", "action": "contact_us"}, r.text
        assert "already happened" in r.json()["detail"] and "Check" not in r.json()["detail"]


def test_income_shows_an_open_sessions_money_as_not_editable():
    with _program_family() as f:
        b = _session(f, date=_day(4))
        rows = run(server.list_transactions(ADMIN, revenue_only=False))
        row = next(r for r in rows if r["id"] == b["id"])
        assert row["financial_locked"] is True


def test_a_session_with_money_on_it_stays_closed():
    with _program_family() as f:
        b = _session(f, date=_day(4), amount_paid=25.0)   # e.g. an add-on already paid
        assert not prepaid_sessions.is_open(_get(b["id"])) and server._booking_is_financially_locked(_get(b["id"]))
        with pytest.raises(HTTPException) as e:
            run(server._cancel_booking_impl(b["id"], False, ADMIN))
        assert e.value.status_code == 409
