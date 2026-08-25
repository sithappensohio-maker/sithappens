"""Regression coverage for Board & Train daily client updates.

The closeout is the source of truth. Publishing it must create one durable
Client Hub update and one durable email job, even if the publisher is called
again after a retry/replayed PM completion.
"""
import uuid

import httpx

import _test_env  # noqa: F401 — must run before importing server
import server
import email_service
from _test_loop import run
from board_train_client_updates import (
    _day_numbers,
    _publish_closeout,
    install_board_train_client_updates,
)
from email_templates_registry import get_template

TAG = "TEST_BT_CLIENT_UPDATE"
install_board_train_client_updates(server_module=server, db=server.db)
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def test_day_numbers_use_real_residential_span():
    booking = {"date": "2026-08-20", "end_date": "2026-09-03"}
    assert _day_numbers(booking, "2026-08-20") == (1, 14)
    assert _day_numbers(booking, "2026-08-24") == (5, 14)
    assert _day_numbers(booking, "2026-09-02") == (14, 14)


def test_board_train_email_template_is_registered_for_settings_editor():
    row = get_template("client_board_train_daily_update")
    assert row is not None
    assert row["audience"] == "client"
    assert "day_number" in row["variables"]


def test_closeout_publishes_one_hub_update_and_one_durable_email_job():
    suffix = uuid.uuid4().hex[:8]
    client_id = f"{TAG}-client-{suffix}"
    dog_id = f"{TAG}-dog-{suffix}"
    program_id = f"{TAG}-program-{suffix}"
    service_id = f"{TAG}-service-{suffix}"
    booking_id = f"{TAG}-booking-{suffix}"
    enrollment_id = f"{TAG}-enrollment-{suffix}"
    closeout_id = f"{TAG}-closeout-{suffix}"
    email = f"{suffix}@example.invalid"

    client = {"id": client_id, "name": "Taylor Client", "email": email}
    dog = {"id": dog_id, "name": "Bella", "owner_id": client_id}
    enrollment = {
        "id": enrollment_id, "dog_id": dog_id, "program_id": program_id,
        "program_snapshot": {"id": program_id, "name": "2-Week Essential Obedience", "type": "board_train"},
        "status": "active",
    }
    closeout = {
        "id": closeout_id, "enrollment_id": enrollment_id, "dog_id": dog_id,
        "program_id": program_id, "session_date": "2026-08-24",
        "biggest_win": "Loose leash work stayed calm past another dog.",
        "biggest_challenge": "Place duration faded around food distraction.",
        "tomorrow_focus": "Build place duration and add moderate movement.",
        "client_update": "Bella had a strong day and settled much faster after each training block.",
        "closed_by_name": "Trainer Sarah", "closed_at": "2026-08-24T19:10:00+00:00",
    }
    old_key = email_service.RESEND_API_KEY
    email_service.RESEND_API_KEY = ""  # never make a network call in this test
    try:
        run(server.db.clients.insert_one(client))
        run(server.db.dogs.insert_one(dog))
        run(server.db.programs.insert_one({"id": program_id, "name": "2-Week Essential Obedience", "type": "board_train"}))
        run(server.db.services.insert_one({"id": service_id, "name": "2-Week Board & Train", "service_type": "training", "package_program_id": program_id, "active": True}))
        run(server.db.bookings.insert_one({
            "id": booking_id, "client_id": client_id, "dog_id": dog_id, "service_id": service_id,
            "service_type": "training", "date": "2026-08-20", "end_date": "2026-09-03",
            "status": "approved", "checked_in_at": "2026-08-20T13:00:00+00:00",
        }))
        run(server.db.dog_programs.insert_one(enrollment))

        first = run(_publish_closeout(server.db, enrollment, closeout))
        second = run(_publish_closeout(server.db, enrollment, closeout))
        assert first["day_number"] == 5
        assert first["total_days"] == 14
        assert second["id"] == first["id"]

        updates = run(server.db.trainer_delivery_client_updates.find({"enrollment_id": enrollment_id}).to_list(10))
        assert len(updates) == 1
        assert updates[0]["client_update"] == closeout["client_update"]
        assert updates[0]["email_status"] == "queued"

        key = f"board-train-daily:{enrollment_id}:2026-08-24"
        outbox = run(server.db.email_outbox.find({"key": key}).to_list(10))
        assert len(outbox) == 1
        assert outbox[0]["to_email"] == email
    finally:
        email_service.RESEND_API_KEY = old_key
        run(server.db.trainer_delivery_client_updates.delete_many({"enrollment_id": enrollment_id}))
        run(server.db.email_outbox.delete_many({"key": {"$regex": enrollment_id}}))
        run(server.db.notification_log.delete_many({"key": {"$regex": enrollment_id}}))
        run(server.db.dog_programs.delete_many({"id": enrollment_id}))
        run(server.db.bookings.delete_many({"id": booking_id}))
        run(server.db.services.delete_many({"id": service_id}))
        run(server.db.programs.delete_many({"id": program_id}))
        run(server.db.dogs.delete_many({"id": dog_id}))
        run(server.db.clients.delete_many({"id": client_id}))


def test_client_hub_endpoint_is_scoped_to_authenticated_client():
    suffix = uuid.uuid4().hex[:8]
    client_id = f"{TAG}-portal-client-{suffix}"
    other_id = f"{TAG}-portal-other-{suffix}"
    user_id = f"{TAG}-user-{suffix}"
    email = f"portal-{suffix}@example.invalid"
    mine = {"id": f"mine-{suffix}", "client_id": client_id, "dog_id": "dog-a", "dog_name": "Bella", "session_date": "2026-08-24", "closed_at": "2026-08-24T19:00:00Z"}
    theirs = {"id": f"theirs-{suffix}", "client_id": other_id, "dog_id": "dog-b", "dog_name": "Max", "session_date": "2026-08-24", "closed_at": "2026-08-24T19:00:00Z"}
    try:
        run(server.db.clients.insert_one({"id": client_id, "name": "Portal Client", "email": email}))
        run(server.db.clients.insert_one({"id": other_id, "name": "Other Client", "email": f"other-{suffix}@example.invalid"}))
        run(server.db.users.insert_one({
            "id": user_id, "role": "client", "client_id": client_id, "email": email,
            "name": "Portal Client", "password_hash": "x", "active": True,
            "must_change_password": False, "needs_password": False,
        }))
        run(server.db.trainer_delivery_client_updates.insert_many([mine, theirs]))
        token = server.create_access_token(user_id, email, "client", 0)
        response = run(_http.get("/api/portal/board-train/updates", headers={"Authorization": f"Bearer {token}"}))
        assert response.status_code == 200, response.text
        rows = response.json()
        assert [r["id"] for r in rows] == [mine["id"]]
    finally:
        run(server.db.trainer_delivery_client_updates.delete_many({"id": {"$in": [mine["id"], theirs["id"]}}))
        run(server.db.users.delete_many({"id": user_id}))
        run(server.db.clients.delete_many({"id": {"$in": [client_id, other_id]}}))
