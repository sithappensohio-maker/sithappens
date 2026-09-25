"""A daycare dog checked out on a later day: the app asks, never assumes.

Forgotten checkout → the normal daycare day, and the per-15-minute late fee
never runs overnight. Stayed the night → a boarding stay priced like any
other. Unanswered → checkout is refused and nothing changes.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run
from domains.bookings import late_day
from domains.pricing import services as pricing

TAG = "TEST_LATE_DAY"
ADMIN = {"id": "late-day-admin", "name": "Late Day QA", "display_name": "Late Day QA", "email": "ld@test", "role": "admin"}


def _et(day_iso, hhmm):
    """Business-local wall clock → stored UTC ISO timestamp."""
    return (datetime.fromisoformat(f"{day_iso}T{hhmm}:00")
            .replace(tzinfo=server.BUSINESS_TZ).astimezone(timezone.utc).isoformat())


def _today():
    return server.business_today().isoformat()


def _days_ago(n):
    return (server.business_today() - timedelta(days=n)).isoformat()


@contextlib.contextmanager
def _settings(**patch):
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {k.replace("__", "."): v for k, v in patch.items()}}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


@contextlib.contextmanager
def _services(boarding_price=60.0, daycare_price=40.0, boarding=True):
    """Exactly one default daycare and (optionally) one default boarding
    service, with any other test's services parked for the duration."""
    parked = run(server.db.services.find(
        {"service_type": {"$in": ["daycare", "boarding"]}}, {"_id": 0, "id": 1, "active": 1, "is_default": 1}).to_list(500))
    run(server.db.services.update_many({"id": {"$in": [p["id"] for p in parked]}}, {"$set": {"active": False, "is_default": False}}))
    made = []
    try:
        specs = [("daycare", daycare_price)] + ([("boarding", boarding_price)] if boarding else [])
        for stype, price in specs:
            svc = run(server.create_service(server.ServiceIn(
                name=f"{TAG} {stype} {uuid.uuid4().hex[:5]}", service_type=stype, base_price=price, active=True), ADMIN))
            run(server.db.services.update_one({"id": svc["id"]}, {"$set": {"is_default": True}}))
            made.append(svc)
        yield {s["service_type"]: s for s in made}
    finally:
        run(server.db.services.delete_many({"id": {"$in": [m["id"] for m in made]}}))
        for p in parked:
            run(server.db.services.update_one({"id": p["id"]}, {"$set": {"active": p.get("active", True), "is_default": p.get("is_default", False)}}))


@contextlib.contextmanager
def _household(days_ago=1, dogs=1, checked_in_days_ago=None, price=40.0, **over):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    day = _days_ago(days_ago)
    in_day = _days_ago(days_ago if checked_in_days_ago is None else checked_in_days_ago)
    group_id = str(uuid.uuid4()) if dogs > 1 else None
    rows = []
    for i in range(dogs):
        did, bid = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"Pup{i}", "vaccines": {"rabies": "2099-01-01"}}))
        ps = {"unit_price": price}
        doc = {"id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": f"Pup{i}",
               "service_type": "daycare", "date": day, "end_date": day, "status": "approved",
               "dropoff_time": "08:00", "pickup_time": "17:00", "time": "",
               "estimated_price": price, "unit_price": price, "pricing_snapshot": ps,
               "credit_units_required": 1, "checked_in_at": _et(in_day, "08:00"), "checked_in_by": "test",
               "checked_out_at": None, "created_at": server.now_iso(), "group_id": group_id}
        if i > 0:
            doc["pricing_snapshot"] = {**ps, "group_dog_index": i, "group_dog_count": dogs}
            doc["multi_dog_discount"] = {"pre_applied": True, "amount": price / 2, "mode": "percent", "value": 50,
                                         "service_type": "daycare", "based_on_price": price}
            doc["estimated_price"] = price / 2
        doc.update(over)
        run(server.db.bookings.insert_one(dict(doc)))
        rows.append(doc)
    try:
        yield rows
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "credit_lots", "checkout_groups"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _checkout(bid, **body):
    return run(server.check_out(bid, server.CheckoutIn(**body), user=ADMIN))


def _route(method):
    for r in server.app.routes:
        if getattr(r, "path", "").endswith("/bookings/{booking_id}/late-day-checkout") and method in r.methods:
            return r.endpoint
    raise AssertionError("late-day route not registered")


def _ask(bid):
    return run(_route("GET")(bid, ADMIN))


def _answer(bid, resolution):
    return run(_route("POST")(bid, late_day.LateDayAnswerIn(resolution=resolution), ADMIN))


# ── the gate ──────────────────────────────────────────────────────────────

def test_an_unanswered_late_checkout_is_refused_and_changes_nothing():
    with _services(), _household() as (b,):
        with pytest.raises(server.HTTPException) as e:
            _checkout(b["id"])
        assert e.value.status_code == 409
        d = e.value.detail
        assert d["code"] == late_day.QUESTION_CODE
        assert [r["value"] for r in d["resolutions"]] == ["forgotten", "stayed_overnight"]
        assert "Pup0" in d["message"]
        s = _row(b["id"])
        assert s["status"] == "approved" and not s.get("checked_out_at") and not s.get("actual_price")
        assert s["service_type"] == "daycare" and not s.get("late_day_resolution") and not s.get("checkout_in_progress")


@pytest.mark.parametrize("case", ["same_day", "boarding", "checked_in_today"])
def test_the_question_is_only_asked_for_a_real_overnight(case):
    over = {}
    kwargs = {}
    if case == "same_day":
        kwargs = {"days_ago": 0}
    elif case == "boarding":
        over = {"service_type": "boarding", "end_date": _today(), "pricing_snapshot": {"unit_price": 60.0}}
    elif case == "checked_in_today":
        kwargs = {"checked_in_days_ago": 0}
    with _services(), _household(**kwargs, **over) as (b,):
        asked = _ask(b["id"])
        assert asked["applies"] is False and "resolved" not in asked
        _checkout(b["id"])  # completes with no answer
        assert _row(b["id"])["status"] == "completed"


# ── forgotten checkout ────────────────────────────────────────────────────

def test_forgotten_checkout_charges_the_normal_day_and_no_overnight_late_fee():
    with _settings(day_to_day__money__late_pickup_fee_per_15min=5.0), _services(), _household() as (b,):
        _checkout(b["id"], late_day_resolution="forgotten")
        s = _row(b["id"])
        assert s["service_type"] == "daycare"
        assert float(s["actual_price"]) == 40.0
        assert float((s.get("money_modifier_breakdown") or {}).get("late_pickup_fee") or 0) == 0.0
        assert s["late_day_resolution"] == "forgotten"
        assert s["late_day_checkout"]["booking_date"] == b["date"] and s["late_day_checkout"]["by"] == ADMIN["id"]


def test_the_late_fee_clock_never_runs_overnight_but_still_runs_same_day():
    settings = {"day_to_day": {"money": {"late_pickup_fee_per_15min": 5.0, "late_pickup_grace_min": 0}}}
    yesterday = {"service_type": "daycare", "date": _days_ago(1), "pickup_time": "17:00"}
    next_morning = _et(_today(), "09:00")
    assert pricing.money_modifier_breakdown(yesterday, 40.0, settings, next_morning)["late_pickup_fee"] == 0.0
    same_day = {**yesterday, "date": _today()}
    thirty_late = _et(_today(), "17:30")
    assert pricing.money_modifier_breakdown(same_day, 40.0, settings, thirty_late)["late_pickup_fee"] == 10.0


# ── stayed the night ──────────────────────────────────────────────────────

def test_stayed_the_night_becomes_a_boarding_stay_priced_as_boarding():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(boarding_price=60.0) as svcs, \
            _household(days_ago=2) as (b,):
        _checkout(b["id"], late_day_resolution="stayed_overnight")
        s = _row(b["id"])
        assert s["service_type"] == "boarding" and s["service_id"] == svcs["boarding"]["id"]
        assert s["date"] == b["date"] and s["end_date"] == _today()
        assert float(s["actual_price"]) == 120.0  # 2 nights × $60
        rec = s["late_day_checkout"]
        assert rec["resolution"] == "stayed_overnight" and rec["nights"] == 2.0
        assert rec["original"]["service_type"] == "daycare" and rec["original"]["estimated_price"] == 40.0


def test_answering_first_then_undo_restores_the_daycare_visit_exactly():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(), _household() as (b,):
        asked = _ask(b["id"])
        assert asked["applies"] is True and asked["stayed_overnight"]["available"] is True
        assert asked["stayed_overnight"]["total"] == 60.0
        out = _answer(b["id"], "stayed_overnight")
        assert out["booking"]["service_type"] == "boarding"
        again = _ask(b["id"])
        assert again["resolved"] == "stayed_overnight" and again["can_undo"] is True
        _answer(b["id"], "undo")
        s = _row(b["id"])
        for k in ("service_type", "end_date", "pickup_time", "estimated_price", "unit_price", "pricing_snapshot"):
            assert s.get(k) == b.get(k), k
        assert "late_day_resolution" not in s and "late_day_checkout" not in s
        assert _ask(b["id"])["applies"] is True


def test_a_household_is_converted_together_with_the_sibling_discount_rebased():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(boarding_price=60.0), \
            _household(dogs=2) as (first, second):
        asked = _ask(first["id"])
        assert asked["dog_names"] == ["Pup0", "Pup1"]
        assert asked["stayed_overnight"]["total"] == 90.0  # $60 + $60 at 50%
        _answer(first["id"], "stayed_overnight")
        a, b2 = _row(first["id"]), _row(second["id"])
        assert a["service_type"] == b2["service_type"] == "boarding"
        assert a["estimated_price"] == 60.0 and b2["estimated_price"] == 30.0
        assert b2["multi_dog_discount"]["service_type"] == "boarding" and b2["multi_dog_discount"]["based_on_price"] == 60.0
        assert b2["credit_units_required"] == 0.5


def test_a_checkout_that_fails_after_the_answer_rolls_the_conversion_back():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(), _household() as (b,):
        with pytest.raises(server.HTTPException):
            # Merchandise with no payment method is refused right after the gate.
            _checkout(b["id"], late_day_resolution="stayed_overnight",
                      retail_lines=[{"kind": "retail", "product_id": "nope", "qty": 1}])
        s = _row(b["id"])
        assert s["service_type"] == "daycare" and not s.get("late_day_resolution") and not s.get("checked_out_at")


def test_with_no_boarding_price_forgotten_still_works_and_the_reason_is_given():
    with _services(boarding=False), _household() as (b,):
        asked = _ask(b["id"])
        assert asked["applies"] is True and asked["stayed_overnight"]["available"] is False
        assert "Boarding service" in asked["stayed_overnight"]["reason"]
        with pytest.raises(server.HTTPException) as e:
            _answer(b["id"], "stayed_overnight")
        assert e.value.status_code == 409 and _row(b["id"])["service_type"] == "daycare"
        _answer(b["id"], "forgotten")
        _checkout(b["id"])
        assert _row(b["id"])["status"] == "completed"


def test_an_already_paid_visit_is_not_converted():
    with _services(), _household(credit_value=40.0, credits_deducted=1) as (b,):
        with pytest.raises(server.HTTPException) as e:
            _answer(b["id"], "stayed_overnight")
        assert e.value.block["code"] == "late_day_convert_locked"
        assert _row(b["id"])["service_type"] == "daycare"


# ── review follow-ups ─────────────────────────────────────────────────────

def _early_answer(bid, **stored):
    """Simulate an answer saved earlier: pretend the stay was recorded with an
    earlier pickup time / end date than the real pickup."""
    run(server.db.bookings.update_one({"id": bid}, {"$set": stored}))


def test_an_early_answer_is_repriced_to_the_real_pickup_time():
    """Answered in the morning, collected after the boarding checkout time:
    the pickup-day charge must still apply (it was frozen at answer time)."""
    rules = dict(booking_rules__boarding_late_pickup_mode="flat_fee", booking_rules__boarding_late_pickup_flat_fee=25,
                 booking_rules__boarding_full_day_pickup_cutoff="00:01")
    with _settings(**rules), _services(boarding_price=60.0), _household() as (b,):
        _answer(b["id"], "stayed_overnight")
        _early_answer(b["id"], pickup_time="00:00")  # "answered before the cutoff"
        _checkout(b["id"])
        s = _row(b["id"])
        assert float(s["actual_price"]) == 85.0  # 1 night + the $25 pickup-day charge
        assert s["pickup_time"] != "00:00"


def test_a_dog_that_stays_another_night_is_charged_for_it():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(boarding_price=60.0), \
            _household(days_ago=2) as (b,):
        _answer(b["id"], "stayed_overnight")
        _early_answer(b["id"], end_date=_days_ago(1))  # answered yesterday
        _checkout(b["id"])
        s = _row(b["id"])
        assert s["end_date"] == _today() and float(s["actual_price"]) == 120.0
        assert s["late_day_checkout"]["original"]["service_type"] == "daycare"  # undo record survives re-pricing


def test_a_later_daycare_visit_blocks_stayed_the_night():
    with _services(), _household(days_ago=2) as (b,):
        run(server.db.bookings.insert_one({
            "id": str(uuid.uuid4()), "client_id": b["client_id"], "dog_id": b["dog_id"], "dog_name": b["dog_name"],
            "service_type": "daycare", "date": _days_ago(1), "status": "completed",
            "checked_in_at": _et(_days_ago(1), "08:00"), "checked_out_at": _et(_days_ago(1), "17:00")}))
        asked = _ask(b["id"])
        assert asked["stayed_overnight"]["available"] is False and "daycare visit" in asked["stayed_overnight"]["reason"]
        with pytest.raises(server.HTTPException):
            _answer(b["id"], "stayed_overnight")
        assert _row(b["id"])["service_type"] == "daycare"


def test_change_answer_is_refused_while_a_checkout_is_running():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(), _household() as (b,):
        _answer(b["id"], "stayed_overnight")
        run(server.db.bookings.update_one({"id": b["id"]}, {"$set": {
            "checkout_in_progress": True, "checkout_started_at": server.now_iso()}}))
        with pytest.raises(server.HTTPException) as e:
            _answer(b["id"], "undo")
        assert e.value.status_code == 409
        assert _row(b["id"])["service_type"] == "boarding"


def test_two_people_answering_at_once_cannot_mix_answers():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(), _household() as (b,):
        stale = _row(b["id"])
        _answer(b["id"], "stayed_overnight")
        with pytest.raises(server.HTTPException) as e:
            run(late_day.resolve(stale, "forgotten", ADMIN, standalone=True))
        assert e.value.status_code == 409
        s = _row(b["id"])
        assert s["late_day_resolution"] == "stayed_overnight" and s["late_day_checkout"]["original"]


def test_a_household_checkout_asks_before_touching_any_dog():
    with _services(), _household(dogs=2) as (first, second):
        with pytest.raises(server.HTTPException) as e:
            run(server.check_out_group(first["id"], server.CheckoutIn(), ADMIN))
        assert e.value.status_code == 409 and e.value.detail["code"] == late_day.QUESTION_CODE
        assert len(e.value.detail["booking_ids"]) == 2
        for row in (_row(first["id"]), _row(second["id"])):
            assert not row.get("checkout_in_progress") and not row.get("checked_out_at")


def test_a_sibling_still_needing_an_answer_is_asked_even_if_the_opened_dog_was_answered():
    with _services(), _household(dogs=2) as (first, second):
        run(late_day.resolve(_row(first["id"]), "forgotten", ADMIN, standalone=True))
        asked = _ask(first["id"])
        assert asked["applies"] is True and asked["booking_ids"] == [second["id"]]


def test_a_reopened_checkout_is_never_asked():
    with _services(), _household(financial_reopened_at=server.now_iso()) as (b,):
        assert _ask(b["id"])["applies"] is False
        _checkout(b["id"])
        assert _row(b["id"])["status"] == "completed"


def test_the_check_returns_the_current_booking_so_a_stale_screen_reprices():
    with _settings(booking_rules__boarding_late_pickup_mode="none"), _services(), _household() as (b,):
        _answer(b["id"], "stayed_overnight")
        again = _ask(b["id"])
        assert again["booking"]["service_type"] == "boarding" and again["resolved"] == "stayed_overnight"
        assert "late_pickup_cash" in again
