"""Every booking refusal must tell the client WHAT is stopping them and HOW
to fix it: a readable `detail` sentence plus a `block` {code, action} the
portal turns into a fix-it button. Also pins the bugs found in the audit:
the max-boarding-nights limit that never fired, recurring's stricter vaccine
preflight, the multi-date waitlist escape, and internal dog ids in group
errors."""
import contextlib
import json
import uuid
from datetime import date, timedelta

import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run
from domains.bookings.blocks import BookingBlocked, pretty_date, pretty_time
from test_stale_price_snapshot_fix import _admin_user, _daycare_service

TAG = "TEST_BOOKING_BLOCKS"
VACCINES_OK = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


def _future_weekday(min_days=5):
    d = date.today() + timedelta(days=min_days)
    while d.weekday() != 2:  # a Wednesday: open for daycare, not a weekend
        d += timedelta(days=1)
    return d.isoformat()


def _client_user(client):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client["id"], "name": client["name"], "email": client["email"]}


@contextlib.contextmanager
def _household(*, dogs=1, status="active", waiver=True, balance=0.0, vaccines=None):
    cid = str(uuid.uuid4())
    client = {
        "id": cid, "name": f"{TAG} Client {uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
        "client_status": status, "account_balance": balance, "created_at": server.now_iso(),
    }
    run(server.db.clients.insert_one(client))
    rows = []
    for i in range(dogs):
        rows.append({
            "id": str(uuid.uuid4()), "name": f"Pup{i}{uuid.uuid4().hex[:4]}", "owner_id": cid, "breed": "Mix",
            "vaccines": dict(vaccines if vaccines is not None else VACCINES_OK),
        })
    run(server.db.dogs.insert_many([dict(r) for r in rows]))
    if waiver:
        settings = run(server.get_settings())
        run(server.db.waiver_signatures.insert_one({
            "id": str(uuid.uuid4()), "client_id": cid, "waiver_version": int(settings.get("waiver_version", 1)), "signed_at": server.now_iso(),
        }))
    try:
        yield client, rows
    finally:
        run(server.db.bookings.delete_many({"client_id": cid}))
        run(server.db.waitlist.delete_many({"client_id": cid}))
        run(server.db.dogs.delete_many({"owner_id": cid}))
        run(server.db.waiver_signatures.delete_many({"client_id": cid}))
        run(server.db.clients.delete_one({"id": cid}))


@contextlib.contextmanager
def _settings(**patch):
    """Temporarily $set dotted settings keys, restoring the original doc."""
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {k.replace("__", "."): v for k, v in patch.items()}}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


def _refusal(coro):
    with pytest.raises(server.HTTPException) as exc:
        run(coro)
    return exc.value


def _book(user, dog, svc, day, **extra):
    return server.create_booking(server.BookingIn(dog_id=dog["id"], date=day, service_type="daycare", service_id=svc["id"], **extra), user)


# ---- the transport: detail stays a sentence, block rides alongside ----

def test_handler_returns_readable_detail_and_block():
    assert server.app.exception_handlers.get(BookingBlocked) is server._booking_blocked_handler
    exc = BookingBlocked(400, "Please sign our waiver.", code="waiver_unsigned", action="sign_waiver", dog_id=None)
    resp = run(server._booking_blocked_handler(None, exc))
    body = json.loads(resp.body)
    assert resp.status_code == 400
    assert body == {"detail": "Please sign our waiver.", "block": {"code": "waiver_unsigned", "action": "sign_waiver"}}


def test_pretty_helpers_are_portable():
    assert pretty_time("07:00") == "7:00 AM" and pretty_time("19:30") == "7:30 PM" and pretty_time("12:05") == "12:05 PM"
    assert pretty_date("2026-03-04") == "Wed, Mar 4, 2026"
    assert pretty_date("nonsense") == "nonsense"


# ---- vaccines ----

def test_missing_and_expired_vaccines_name_the_dog_and_offer_upload():
    with _daycare_service() as svc, _household(vaccines={"dhpp": "2030-01-01", "bordetella": "2030-01-01"}) as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, _future_weekday()))
        assert e.block["code"] == "vaccine_missing" and e.block["action"] == "upload_vaccines"
        assert e.block["dog_id"] == dogs[0]["id"] and e.block["vaccine"] == "rabies"
        assert dogs[0]["name"] in e.detail and "Upload" in e.detail
    with _daycare_service() as svc, _household(vaccines={**VACCINES_OK, "rabies": "2020-05-01"}) as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, _future_weekday()))
        assert e.block["code"] == "vaccine_expired"
        assert "expired on Fri, May 1, 2020" in e.detail


def test_pending_renewal_blocks_only_when_the_approved_record_is_not_enough():
    pending = {"status": "pending_review", "pending_expires_on": "2031-01-01"}
    # Old approved record still valid: booking goes through while the renewal is reviewed.
    with _daycare_service() as svc, _household() as (client, dogs):
        run(server.db.dogs.update_one({"id": dogs[0]["id"]}, {"$set": {"vaccine_certs": {"rabies": pending}}}))
        bk = run(_book(_client_user(client), dogs[0], svc, _future_weekday()))
        assert bk["id"]
    # Old record expired: tell them we're reviewing — don't ask for another upload.
    with _daycare_service() as svc, _household(vaccines={**VACCINES_OK, "rabies": "2020-01-01"}) as (client, dogs):
        run(server.db.dogs.update_one({"id": dogs[0]["id"]}, {"$set": {"vaccine_certs": {"rabies": pending}}}))
        e = _refusal(_book(_client_user(client), dogs[0], svc, _future_weekday()))
        assert e.block["code"] == "vaccine_pending" and e.block["action"] == "wait"
        assert "no need to upload it again" in e.detail


def test_availability_precheck_matches_booking_on_the_expiry_day():
    today = server.business_today().isoformat()
    with _household(vaccines={**VACCINES_OK, "rabies": today}) as (client, dogs):
        av = run(server.availability(_future_weekday(), dogs[0]["id"], _client_user(client)))
        assert av["vaccine_ok"] is False
        assert av["missing_vaccines"] == ["rabies"]
        assert av["vaccine_problem"]["block"]["code"] == "vaccine_expired"
        assert "expires today" in av["vaccine_problem"]["message"]


# ---- paperwork / account ----

def test_waiver_balance_and_evaluation_blocks_have_fix_actions():
    day = _future_weekday()
    with _daycare_service() as svc, _household(waiver=False) as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, day))
        assert (e.block["code"], e.block["action"]) == ("waiver_unsigned", "sign_waiver")
    with _settings(day_to_day__money__auto_decline_if_balance_over=50), _daycare_service() as svc, _household(balance=80.0) as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, day))
        assert (e.status_code, e.block["action"], e.block["balance"]) == (409, "pay_balance", 80.0)
        assert "$80.00" in e.detail
    with _daycare_service() as svc, _household(status="prospect") as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, day))
        assert (e.block["code"], e.block["action"]) == ("evaluation_required", "request_evaluation")
        assert "This client" not in e.detail
    with _daycare_service() as svc, _household(status="evaluation_scheduled") as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, day))
        assert e.block["code"] == "evaluation_scheduled" and "already scheduled" in e.detail
    with _daycare_service() as svc, _household(status="rejected") as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, day))
        assert e.block["action"] == "contact_us" and "rejected" not in e.detail
        # Staff keep the operator wording.
        e = _refusal(_book(_admin_user(), dogs[0], svc, day))
        assert "marked rejected" in e.detail


def test_non_numeric_balance_threshold_is_ignored_not_a_500():
    with _settings(day_to_day__money__auto_decline_if_balance_over="lots"), _daycare_service() as svc, _household(balance=80.0) as (client, dogs):
        assert run(_book(_client_user(client), dogs[0], svc, _future_weekday()))["id"]


# ---- dates / duplicates / limits ----

def test_malformed_dates_are_a_clear_400_not_a_500():
    with _daycare_service() as svc, _household() as (client, dogs):
        e = _refusal(_book(_client_user(client), dogs[0], svc, _future_weekday() + "junk"))
        assert (e.status_code, e.block["code"], e.block["action"]) == (400, "invalid_date", "pick_date")


def test_duplicate_booking_reads_plainly():
    day = _future_weekday()
    with _daycare_service() as svc, _household() as (client, dogs):
        user = _client_user(client)
        run(_book(user, dogs[0], svc, day))
        e = _refusal(_book(user, dogs[0], svc, day))
        assert e.status_code == 409 and e.block["code"] == "duplicate_booking"
        assert "status:" not in e.detail and pretty_date(day) in e.detail and "My Bookings" in e.detail


def test_max_consecutive_boarding_nights_is_enforced():
    """Regression: the raise sat inside `except Exception: pass`."""
    with _settings(day_to_day__guardrails__max_consecutive_boarding_nights=3), _household() as (client, dogs):
        start = _future_weekday()
        end = (date.fromisoformat(start) + timedelta(days=5)).isoformat()
        e = _refusal(server.create_booking(server.BookingIn(dog_id=dogs[0]["id"], date=start, end_date=end, service_type="boarding"), _admin_user()))
        assert e.block["code"] == "stay_too_long" and "3 nights" in e.detail


def test_not_your_dog_is_explained():
    with _daycare_service() as svc, _household() as (client, dogs), _household() as (other, _):
        e = _refusal(_book(_client_user(other), dogs[0], svc, _future_weekday()))
        assert e.status_code == 403 and e.block["code"] == "not_your_dog"


# ---- group / multi-date / recurring ----

def test_group_failure_names_the_dog_never_its_id():
    with _daycare_service() as svc, _household(dogs=2) as (client, dogs):
        run(server.db.dogs.update_one({"id": dogs[1]["id"]}, {"$set": {"vaccines.rabies": ""}}))
        body = server.BookingGroupIn(
            dogs=[server.BookingGroupDog(dog_id=d["id"]) for d in dogs], date=_future_weekday(),
            service_type="daycare", service_id=svc["id"],
        )
        e = _refusal(server.create_booking_group(body, _client_user(client)))
        assert dogs[1]["id"] not in e.detail and "(dog:" not in e.detail
        assert dogs[1]["name"] in e.detail and "Nothing was booked" in e.detail
        assert e.block["code"] == "vaccine_missing" and e.block["dog_id"] == dogs[1]["id"]
        assert run(server.db.bookings.count_documents({"client_id": client["id"]})) == 0


def test_multi_dates_waitlist_refusal_stays_a_skipped_day():
    """Regression: add_to_waitlist raising inside the except escaped the loop
    after earlier days were already booked."""
    day1 = _future_weekday()
    day2 = (date.fromisoformat(day1) + timedelta(days=7)).isoformat()
    with _settings(daycare_capacity=0, feature_visibility__waitlist=False), _daycare_service() as svc, _household() as (client, dogs):
        res = run(server.create_multi_date_bookings(server.MultiDateBookingIn(
            dog_id=dogs[0]["id"], dates=[day1, day2], service_type="daycare", service_id=svc["id"], waitlist_on_capacity=True,
        ), _client_user(client)))
        assert res["created"] == [] and len(res["skipped"]) == 2
        assert all(not s.get("waitlisted") for s in res["skipped"])


def test_multi_dates_skips_carry_the_fix_it_block():
    with _daycare_service() as svc, _household(waiver=False) as (client, dogs):
        res = run(server.create_multi_date_bookings(server.MultiDateBookingIn(
            dog_id=dogs[0]["id"], dates=[_future_weekday()], service_type="daycare", service_id=svc["id"],
        ), _client_user(client)))
        (skip,) = res["skipped"]
        assert skip["block"]["action"] == "sign_waiver" and "waiver" in skip["reason"]


def test_recurring_uses_the_live_vaccine_policy():
    """Regression: recurring checked the global list with strict defaults and
    ignored the block-if-expired switch."""
    start = _future_weekday()
    end = (date.fromisoformat(start) + timedelta(days=1)).isoformat()
    with _settings(day_to_day__guardrails__block_bookings_if_vaccines_expired=False), _daycare_service() as svc, \
            _household(vaccines={}) as (client, dogs):
        res = run(server.create_recurring(server.RecurringBookingIn(
            dog_id=dogs[0]["id"], start_date=start, end_date=end, weekdays=[2], service_id=svc["id"],
        ), _client_user(client)))
        assert len(res["created"]) == 1
    with _daycare_service() as svc, _household(vaccines={}) as (client, dogs):
        e = _refusal(server.create_recurring(server.RecurringBookingIn(
            dog_id=dogs[0]["id"], start_date=start, end_date=end, weekdays=[2], service_id=svc["id"],
        ), _client_user(client)))
        assert e.block["action"] == "upload_vaccines"
        e = _refusal(server.create_recurring(server.RecurringBookingIn(
            dog_id=dogs[0]["id"], start_date="not-a-date", end_date=end, weekdays=[2], service_id=svc["id"],
        ), _admin_user()))
        assert e.status_code == 400 and e.block["code"] == "invalid_date"


# ---- capacity copy ----

def test_slot_level_capacity_keeps_its_own_message():
    body = server.BookingIn(dog_id="x", date="2026-10-07", service_type="grooming", time="10:00")
    settings = {"booking_flow_controls": {"capacity_reached_copy": "We're full for that day."}}
    slot = server._capacity_error(settings, body, "10:00 AM is already taken. Please pick another time.", resource="time_slot").detail
    day = server._capacity_error(settings, body, "Daycare is full.", resource="daycare").detail
    assert slot["display_message"].startswith("10:00 AM is already taken") and slot["action"] == "pick_time"
    assert day["display_message"] == "We're full for that day." and day["action"] == "pick_date"
