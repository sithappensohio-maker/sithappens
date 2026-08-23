"""Regression coverage for residential Board & Train scheduling."""
import contextlib
import uuid
from datetime import date, timedelta

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run
from board_train_scheduling import (
    legacy_service_duration_days,
    program_residential_duration_days,
    repair_open_board_train_booking_spans,
)
from test_stale_price_snapshot_fix import _admin_user, _client_and_dog

TAG = "TEST_BOARD_TRAIN_SPAN"


@contextlib.contextmanager
def _program(weeks: int):
    row = {
        "id": str(uuid.uuid4()),
        "name": f"{TAG} {weeks}-Week {uuid.uuid4().hex[:6]}",
        "slug": f"bt_{weeks}_{uuid.uuid4().hex[:6]}",
        "type": "board_train",
        "format": {"count": weeks, "unit": "weeks"},
        "modules": [],
        "active": True,
        "created_at": server.now_iso(),
    }
    run(server.db.programs.insert_one(row))
    try:
        yield row
    finally:
        run(server.db.dog_programs.delete_many({"program_id": row["id"]}))
        run(server.db.programs.delete_one({"id": row["id"]}))


@contextlib.contextmanager
def _service(program_id=None, *, name=None, slug="", price=1200.0):
    svc = run(server.create_service(server.ServiceIn(
        name=name or f"{TAG} Package {uuid.uuid4().hex[:6]}",
        slug=slug,
        service_type="training",
        base_price=price,
        active=True,
        package_program_id=program_id,
        duration_minutes=60,
    ), _admin_user()))
    try:
        yield svc
    finally:
        run(server.db.bookings.delete_many({"service_id": svc["id"]}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def test_duration_helpers_only_recognize_board_train():
    assert program_residential_duration_days({"type": "board_train", "format": {"count": 1, "unit": "weeks"}}) == 7
    assert program_residential_duration_days({"type": "board_train", "format": {"count": 2, "unit": "weeks"}}) == 14
    assert program_residential_duration_days({"type": "board_train", "format": {"count": 3, "unit": "weeks"}}) == 21
    assert program_residential_duration_days({"type": "private_lessons", "format": {"count": 3, "unit": "weeks"}}) is None
    assert legacy_service_duration_days({"name": "Board & Train (per week)", "slug": "board_train_week"}) == 7
    assert legacy_service_duration_days({"name": "2-Week Board & Train"}) == 14
    assert legacy_service_duration_days({"name": "3 wk Board and Train"}) == 21
    assert legacy_service_duration_days({"name": "Three Week Board & Train"}) == 21
    assert legacy_service_duration_days({"name": "Private Training 2 weeks"}) is None


def test_runtime_hook_is_installed_on_canonical_resolver():
    assert getattr(server, "_board_train_scheduling_installed", False) is True
    assert getattr(server._resolve_base_service_for_booking, "_board_train_residential_wrapper", False) is True


def test_one_two_three_week_packages_schedule_full_stay_and_charge_package_once():
    start = date.today()
    with _client_and_dog() as (_client, dog):
        for weeks in (1, 2, 3):
            with _program(weeks) as program, _service(program["id"], price=1200.0) as svc:
                booking = run(server.create_booking(server.BookingIn(
                    dog_id=dog["id"], service_type="training", service_id=svc["id"],
                    date=start.isoformat(), time="10:00",
                    override_capacity=True, override_vaccines=True,
                ), _admin_user()))
                assert booking["service_type"] == "training"
                assert booking["end_date"] == (start + timedelta(days=weeks * 7)).isoformat()
                assert booking["time"] == ""
                # The price is for the package, not package-price × calendar days.
                assert float(booking["estimated_price"]) == 1200.0


def test_stock_legacy_per_week_service_gets_seven_day_span_without_manual_recreation():
    start = date.today()
    with _client_and_dog() as (_client, dog), _service(
        None, name=f"{TAG} Board & Train (per week)", slug="board_train_week", price=900.0
    ) as svc:
        booking = run(server.create_booking(server.BookingIn(
            dog_id=dog["id"], service_type="training", service_id=svc["id"],
            date=start.isoformat(), time="11:00",
            override_capacity=True, override_vaccines=True,
        ), _admin_user()))
        assert booking["end_date"] == (start + timedelta(days=7)).isoformat()
        assert booking["time"] == ""
        assert float(booking["estimated_price"]) == 900.0


def test_startup_repair_fixes_open_bad_row_but_not_checked_out_history():
    start = date.today()
    with _client_and_dog() as (client, dog), _program(1) as program, _service(program["id"]) as svc:
        open_id = str(uuid.uuid4())
        old_id = str(uuid.uuid4())
        common = {
            "dog_id": dog["id"], "dog_name": dog["name"],
            "client_id": client["id"], "client_name": client["name"],
            "date": start.isoformat(), "end_date": None,
            "service_type": "training", "service_id": svc["id"],
            "status": "approved", "time": "10:00", "created_at": server.now_iso(),
        }
        run(server.db.bookings.insert_many([
            {**common, "id": open_id, "checked_in_at": server.now_iso(), "checked_out_at": None},
            {**common, "id": old_id, "checked_in_at": server.now_iso(), "checked_out_at": server.now_iso()},
        ]))
        repaired = run(repair_open_board_train_booking_spans(server.db))
        assert repaired >= 1
        live = run(server.db.bookings.find_one({"id": open_id}, {"_id": 0}))
        history = run(server.db.bookings.find_one({"id": old_id}, {"_id": 0}))
        assert live["end_date"] == (start + timedelta(days=7)).isoformat()
        assert live["time"] == ""
        assert history.get("end_date") is None
        # Idempotent: a second run has nothing left to repair.
        assert run(repair_open_board_train_booking_spans(server.db)) == 0
