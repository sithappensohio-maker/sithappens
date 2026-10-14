"""Day-before reminder emails for timed, confirmed appointments.

Before this, `comms.reminder_email_hours_before` was a setting with a
disabled UI field and nothing reading it — the whole "Reminder email —
hours before" control in Settings -> Email Timing did nothing. This is
what actually sends: training/grooming/photography/Meet & Greet bookings
one calendar day out (rounded from the configured hour count, since the
job itself only ticks once a business-day), de-duped by notification_log,
skipped for daycare/boarding (not a single dated appointment) and for an
unapproved or untimed booking.

Same conventions as test_scheduler.py's birthday-job tests: the real
(shared) dev db, `_tag`-marked disposable rows, AsyncMock over
daily_jobs.email_service so no real email ever sends.

Disposable tag TEST_APPT_REMINDER.
"""
import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import _test_env  # noqa: F401 — must run before `import server`
import server
import daily_jobs
from _test_loop import run

TAG = "TEST_APPT_REMINDER"
db = server.db


def _tomorrow():
    return (datetime.now(daily_jobs.BUSINESS_TZ).date() + timedelta(days=1)).isoformat()


def _client(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} Owner", "email": f"{uuid.uuid4().hex[:8]}@example.com",
        "deleted_at": None, "_tag": TAG,
    }
    doc.update(overrides)
    return doc


def _booking(client_id, **overrides):
    doc = {
        "id": str(uuid.uuid4()), "client_id": client_id, "dog_id": str(uuid.uuid4()), "dog_name": f"{TAG} Dog",
        "date": _tomorrow(), "status": "approved", "service_type": "training", "time": "14:00",
        "is_meet_greet": False, "_tag": TAG,
    }
    doc.update(overrides)
    return doc


def _cleanup(client_ids=(), booking_ids=()):
    run(db.clients.delete_many({"id": {"$in": list(client_ids)}}))
    run(db.bookings.delete_many({"id": {"$in": list(booking_ids)}}))
    run(db.notification_log.delete_many({"_tag": TAG}))


class _CommsOverride:
    """Temporarily patches db.settings.comms.<key>, restoring the prior
    value (or removing the key if it was never there) afterward — never
    leaves the shared dev settings doc in a different state than it found it."""
    def __init__(self, **patch):
        self.patch = patch
        self.had_doc = False
        self.prior_comms = None

    def __enter__(self):
        existing = run(db.settings.find_one({"id": "global"}, {"_id": 0, "comms": 1}))
        self.had_doc = existing is not None
        self.prior_comms = dict((existing or {}).get("comms") or {})
        new_comms = dict(self.prior_comms)
        new_comms.update(self.patch)
        run(db.settings.update_one({"id": "global"}, {"$set": {"comms": new_comms}}, upsert=True))
        return self

    def __exit__(self, *exc):
        if self.had_doc:
            run(db.settings.update_one({"id": "global"}, {"$set": {"comms": self.prior_comms}}))
        else:
            run(db.settings.update_one({"id": "global"}, {"$unset": {"comms": ""}}))


def test_a_timed_training_booking_tomorrow_gets_reminded():
    c = _client()
    b = _booking(c["id"], service_type="training", time="14:00")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_one(dict(b)))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            res = run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{b['id']}" in keys
        assert res["sent"] >= 1
    finally:
        _cleanup([c["id"]], [b["id"]])


def test_grooming_and_photography_also_get_reminded():
    c = _client()
    grooming = _booking(c["id"], service_type="grooming", time="09:30")
    photo = _booking(c["id"], service_type="photography", time="11:00")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_many([dict(grooming), dict(photo)]))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{grooming['id']}" in keys
        assert f"appointment_reminder:{photo['id']}" in keys
    finally:
        _cleanup([c["id"]], [grooming["id"], photo["id"]])


def test_a_meet_and_greet_gets_reminded_even_though_its_service_type_is_other():
    c = _client()
    b = _booking(c["id"], service_type="other", is_meet_greet=True, time="10:00")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_one(dict(b)))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{b['id']}" in keys
    finally:
        _cleanup([c["id"]], [b["id"]])


def test_daycare_and_boarding_are_never_reminded():
    c = _client()
    daycare = _booking(c["id"], service_type="daycare", time="09:00")
    boarding = _booking(c["id"], service_type="boarding", time="")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_many([dict(daycare), dict(boarding)]))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{daycare['id']}" not in keys
        assert f"appointment_reminder:{boarding['id']}" not in keys
    finally:
        _cleanup([c["id"]], [daycare["id"], boarding["id"]])


def test_a_booking_with_no_set_time_is_skipped():
    c = _client()
    b = _booking(c["id"], service_type="training", time="")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_one(dict(b)))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{b['id']}" not in keys
    finally:
        _cleanup([c["id"]], [b["id"]])


def test_an_unapproved_booking_is_skipped():
    c = _client()
    pending = _booking(c["id"], service_type="training", status="pending")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_one(dict(pending)))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{pending['id']}" not in keys
    finally:
        _cleanup([c["id"]], [pending["id"]])


def test_an_archived_clients_booking_is_skipped_not_emailed():
    c = _client(deleted_at=server.now_iso())
    b = _booking(c["id"], service_type="training")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_one(dict(b)))
    try:
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            res = run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{b['id']}" not in keys
        assert res["skipped"] >= 1
    finally:
        _cleanup([c["id"]], [b["id"]])


def test_is_idempotent_once_logged():
    c = _client()
    b = _booking(c["id"], service_type="training")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_one(dict(b)))
    try:
        run(db.notification_log.insert_one({"key": f"appointment_reminder:{b['id']}", "sent_at": server.now_iso(), "_tag": TAG}))
        with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_appointment_reminder_job(db))
            keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{b['id']}" not in keys
    finally:
        _cleanup([c["id"]], [b["id"]])


def test_disabled_setting_skips_the_whole_job():
    c = _client()
    b = _booking(c["id"], service_type="training")
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_one(dict(b)))
    try:
        with _CommsOverride(appointment_reminder_enabled=False):
            res = run(daily_jobs.run_appointment_reminder_job(db))
        assert res == {"sent": 0, "skipped": 0, "disabled": True}
    finally:
        _cleanup([c["id"]], [b["id"]])


def test_a_longer_lead_time_targets_a_later_date_not_tomorrow():
    c = _client()
    day_after_tomorrow = (datetime.now(daily_jobs.BUSINESS_TZ).date() + timedelta(days=2)).isoformat()
    too_soon = _booking(c["id"], service_type="training", date=_tomorrow())
    on_target = _booking(c["id"], service_type="training", date=day_after_tomorrow)
    run(db.clients.insert_one(dict(c)))
    run(db.bookings.insert_many([dict(too_soon), dict(on_target)]))
    try:
        with _CommsOverride(reminder_email_hours_before=48):
            with patch.object(daily_jobs.email_service, "notify_client_appointment_reminder", new=AsyncMock(return_value=True)) as m:
                run(daily_jobs.run_appointment_reminder_job(db))
                keys = [call.kwargs.get("delivery_key") for call in m.call_args_list]
        assert f"appointment_reminder:{too_soon['id']}" not in keys
        assert f"appointment_reminder:{on_target['id']}" in keys
    finally:
        _cleanup([c["id"]], [too_soon["id"], on_target["id"]])


def test_notify_function_returns_false_without_a_client_email():
    ok = run(daily_jobs.email_service.notify_client_appointment_reminder(
        {"id": "x", "dog_name": "Fido", "date": _tomorrow(), "time": "14:00", "service_type": "training"},
        {"name": "No Email Owner", "email": ""},
    ))
    assert ok is False


def test_notify_function_includes_the_dog_service_and_time_in_the_rows():
    email_service = daily_jobs.email_service
    captured = {}

    async def capture(*, rows, ctx, **kw):
        captured["rows"] = rows
        captured["ctx"] = ctx
        return True

    orig = email_service._dispatch
    email_service._dispatch = capture
    try:
        run(email_service.notify_client_appointment_reminder(
            {"id": "x", "dog_name": "Fido", "date": "2026-11-03", "time": "14:00",
             "service_type": "grooming", "grooming_type": "bath"},
            {"name": "Jamie Owner", "email": "jamie@example.com"},
        ))
    finally:
        email_service._dispatch = orig
    rows = dict(captured["rows"])
    assert rows["Dog"] == "Fido"
    assert rows["Service"] == "Grooming · Bath"
    assert rows["Date"] == "2026-11-03"
    assert rows["Time"] == "2:00 PM"
    assert captured["ctx"]["dog_name"] == "Fido"


def test_a_boarding_booking_never_shows_a_time_row_even_with_one_set():
    """time is only meaningful for the timed services — a stray time value
    left on a boarding/daycare row must never surface as an appointment
    time (see _appointment_time's own service-type gate)."""
    email_service = daily_jobs.email_service
    captured = {}

    async def capture(*, rows, **kw):
        captured["rows"] = rows
        return True

    orig = email_service._dispatch
    email_service._dispatch = capture
    try:
        run(email_service.notify_client_appointment_reminder(
            {"id": "x", "dog_name": "Fido", "date": "2026-11-03", "time": "14:00", "service_type": "boarding"},
            {"name": "Jamie Owner", "email": "jamie@example.com"},
        ))
    finally:
        email_service._dispatch = orig
    assert "Time" not in dict(captured["rows"])


def test_registry_entry_renders_over_the_python_fallback():
    """The registry (email_templates_registry.py) is what _render actually
    uses — a slug with no registry entry would silently fall back to the
    Python fallback_intro instead, which is what this guards against."""
    _, html = run(daily_jobs.email_service._render(
        slug="client_appointment_reminder",
        ctx={"first_name": "Jamie", "dog_name": "Fido", "service_label": "Training", "date": "2026-11-03", "time": "2:00 PM"},
        rows=[("Dog", "Fido"), ("Service", "Training"), ("Date", "2026-11-03"), ("Time", "2:00 PM")],
        fallback_title="unused", fallback_intro="unused — the registry default wins over this",
        fallback_subject="unused",
    ))
    assert "coming up" in html
    assert "2:00 PM" in html
    assert "unused" not in html


if __name__ == "__main__":
    import sys
    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-v"]))
