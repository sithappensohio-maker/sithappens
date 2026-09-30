"""Today's boards and the vaccine review lists never drop anyone (audit #43).

The Run Sheet, Care Board, Kennel Board and the missed-medication alerts read
up to 2,000 visits of any date in no order and then picked today's out of
them; the vaccine review lists read up to 500 dogs with any certificate on
file. With enough history, today's newest dogs (often walk-ins) and new
uploads fell off with no warning. Each now asks only for what it shows.

Disposable tag TEST_BOARD_CAPS.
"""
import json
import uuid
from datetime import timedelta

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from domains.bookings import care as care_domain

TAG = "TEST_BOARD_CAPS"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "board-caps@test"}
TODAY = server.business_today()


@pytest.fixture(scope="module")
def history():
    """More old visits than the old cap, inserted BEFORE today's dogs — booked
    and never come (status "approved", as today's are), so whichever index
    the old read used (status, or date + status) listed them first."""
    old = [{"id": f"{TAG}-old-{i}", "dog_id": f"{TAG}-old-dog", "dog_name": "Old", "client_id": f"{TAG}-old-client",
            "service_type": "daycare", "date": (TODAY - timedelta(days=1 + i % 80)).isoformat(), "status": "approved",
            "created_at": "2026-01-01T00:00:00+00:00"} for i in range(2100)]
    run(server.db.bookings.insert_many(old))
    yield
    run(server.db.bookings.delete_many({"id": {"$regex": f"^{TAG}"}}))
    run(server.db.dogs.delete_many({"id": {"$regex": f"^{TAG}"}}))


def _walk_in(**extra):
    dog = {"id": f"{TAG}-dog-{uuid.uuid4().hex[:6]}", "name": f"Walkin{uuid.uuid4().hex[:4]}", "owner_id": f"{TAG}-client",
           "breed": "Mix", "vaccines": {"rabies": "2030-01-01"},
           "feeding_schedule": [{"time": "12:00", "amount": "1 cup", "food_type": "Kibble"}]}
    run(server.db.dogs.insert_one(dict(dog)))
    b = {"id": f"{TAG}-b-{uuid.uuid4().hex[:6]}", "dog_id": dog["id"], "dog_name": dog["name"], "client_id": f"{TAG}-client",
         "client_name": f"{TAG} Family", "service_type": "daycare", "date": TODAY.isoformat(), "status": "approved",
         "checked_in_at": server.now_iso(), "created_at": server.now_iso(), **extra}
    run(server.db.bookings.insert_one(dict(b)))
    return b


def test_the_run_sheet_shows_todays_newest_dog(history):
    b = _walk_in()
    assert b["id"] in [x["id"] for x in run(server.run_sheet(ADMIN, None))["bookings"]]


def test_the_kennel_board_shows_todays_newest_dog(history):
    b = _walk_in()
    assert b["id"] in json.dumps(run(server.get_kennel_board(ADMIN)))


def test_a_stay_that_started_days_ago_is_on_todays_run_sheet_and_kennel_board(history):
    b = _walk_in(service_type="boarding", date=(TODAY - timedelta(days=3)).isoformat(), end_date=(TODAY + timedelta(days=2)).isoformat(),
                 checked_in_at=None)
    assert b["id"] in [x["id"] for x in run(server.run_sheet(ADMIN, None))["bookings"]]
    assert b["id"] in json.dumps(run(server.get_kennel_board(ADMIN)))
    ahead = (TODAY + timedelta(days=4)).isoformat()
    assert b["id"] not in [x["id"] for x in run(server.run_sheet(ADMIN, ahead))["bookings"]], "gone after it ends"


def test_the_care_board_shows_todays_newest_dogs_feeding(history):
    b = _walk_in()
    board = run(care_domain.care_board_today())
    assert b["id"] in [r.get("booking_id") for r in board["feedings"]]


def test_a_dog_still_checked_in_from_yesterday_stays_on_the_care_board(history):
    b = _walk_in(date=(TODAY - timedelta(days=1)).isoformat())
    board = run(care_domain.care_board_today())
    assert b["id"] in [r.get("booking_id") for r in board["feedings"] + board["earlier"]]


def test_a_missed_medication_alert_is_raised_for_todays_newest_dog(history, monkeypatch):
    b = _walk_in()

    async def overdue(booking, today):
        return [{"id": "med-1", "kind": "medication", "name": "Pill", "time": "08:00", "day": today, "due_minutes_delta": 90}] \
            if booking["id"] == b["id"] else []
    monkeypatch.setattr(server.care_domain, "overdue_items", overdue)
    alerts = run(server._collect_overdue_medication_actions())
    assert b["id"] in json.dumps(alerts)


# ─────────────────────────────────────────── the vaccine review lists

@pytest.fixture(scope="module")
def many_certificates():
    cert = {"photo": "data:image/png;base64,AA", "status": "approved", "reviewed_at": "2026-01-01T00:00:00+00:00", "expires_on": "2030-01-01"}
    run(server.db.dogs.insert_many([{"id": f"{TAG}-cert-{i}", "name": f"Cert{i}", "owner_id": f"{TAG}-client",
                                     "vaccines": {"rabies": "2030-01-01"}, "vaccine_certs": {"rabies": dict(cert)}} for i in range(520)]))
    yield
    run(server.db.dogs.delete_many({"id": {"$regex": f"^{TAG}-cert-"}}))


def test_a_new_upload_is_on_the_approve_list_count_and_tasks_however_many_dogs_have_certificates(many_certificates):
    dog = {"id": f"{TAG}-cert-new", "name": "NewUpload", "owner_id": f"{TAG}-client", "vaccines": {"rabies": "2030-01-01"},
           "vaccine_certs": {"dhpp": {"photo": "data:image/png;base64,AA", "status": "pending_review", "pending_expires_on": "2031-01-01",
                                      "uploaded_at": server.now_iso(), "assigned_to": ADMIN["id"]}}}
    run(server.db.dogs.insert_one(dict(dog)))
    rows = run(server.admin_list_vaccine_uploads(False, ADMIN))
    assert [(r["dog_id"], r["vaccine"]) for r in rows if r["dog_id"].startswith(TAG)] == [(dog["id"], "dhpp")]
    brain = run(server.admin_today_brain(ADMIN))["items"]
    count = next(i for i in brain if i["kind"] == "vaccine_upload_review")
    assert count["title"].startswith(f"{len(rows)} vaccine upload"), "the count matches the list"
    tasks_route = next(r for r in server.app.routes if getattr(r, "path", "") == "/api/employee/my-tasks")
    mine = run(tasks_route.endpoint(ADMIN))["vaccine_reviews"]
    assert [(x["dog_id"], x["vaccine"]) for x in mine] == [(dog["id"], "dhpp")]


def test_the_waiting_rule_matches_the_python_one():
    from domains import vaccines as vaccines_domain
    q = vaccines_domain.waiting_upload_query()
    rows = [{"id": f"{TAG}-w-{k}", "vaccine_certs": certs} for k, certs in enumerate([
        {"rabies": {"reviewed_at": "x"}},                       # decided
        {"rabies": {"reviewed_at": ""}},                         # waiting
        {"rabies": {"status": "pending_review"}},                # waiting
        {"weird_key": {"status": "pending_review"}},             # any key counts
        {"rabies": "not a dict"},                                # ignored
        {},                                                      # nothing
    ])] + [{"id": f"{TAG}-w-none"}, {"id": f"{TAG}-w-null", "vaccine_certs": None}, {"id": f"{TAG}-w-list", "vaccine_certs": ["x"]}]
    run(server.db.dogs.insert_many([dict(r) for r in rows]))
    try:
        found = sorted(d["id"] for d in run(server.db.dogs.find({**q, "id": {"$regex": f"^{TAG}-w-"}}, {"_id": 0, "id": 1}).to_list(None)))
    finally:
        run(server.db.dogs.delete_many({"id": {"$regex": f"^{TAG}-w-"}}))
    assert found == [f"{TAG}-w-1", f"{TAG}-w-2", f"{TAG}-w-3"]
