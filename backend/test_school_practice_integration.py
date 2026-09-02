"""School Practice feeds every engagement surface that used to read only
legacy homework state: the Portal streak tile, reminder + digest emails,
the trainer's Monday digest, the dog timeline, per-channel progress on
enrollment summaries / lesson history, and the Client Portal Preview.
"""
import contextlib
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import _test_env  # noqa: F401 — must run before `import server`
import server
import daily_jobs
from _test_loop import run

TAG = "TEST_SCHOOL_PRACTICE_INT"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _client_and_dog(**client_extra):
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com"), admin))
    if client_extra:
        run(server.db.clients.update_one({"id": c["id"]}, {"$set": client_extra}))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3}))
    try:
        yield c, {"id": did, "name": f"{TAG} Dog"}
    finally:
        run(server.db.homework.delete_many({"client_id": c["id"]}))
        run(server.db.dog_programs.delete_many({"dog_id": did}))
        run(server.db.notification_log.delete_many({"client_id": c["id"]}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _today():
    return datetime.now(daily_jobs.BUSINESS_TZ).date()


def _school_hw(c, dog, days_back, **extra):
    """One School Practice row with a real client session on each of `days_back` days ago."""
    today = _today()
    logs = [{"id": str(uuid.uuid4()), "section_id": "practice", "date": (today - timedelta(days=i)).isoformat(),
             "logged_by_role": "client", "logged_at": f"{(today - timedelta(days=i)).isoformat()}T18:00:00+00:00",
             "field_values": {}, "note": "", "questions": []} for i in days_back]
    hw = {"id": str(uuid.uuid4()), "client_id": c["id"], "client_name": c["name"], "dog_id": dog["id"], "dog_name": dog["name"],
          "title": f"{TAG} Sit practice", "status": "assigned", "school_enrollment_id": str(uuid.uuid4()),
          "assigned_by": "Online School", "created_at": server.now_iso(), "section_logs": logs}
    hw.update(extra)
    run(server.db.homework.insert_one(hw))
    return hw


def test_portal_streak_tile_counts_school_practice_days():
    with _client_and_dog() as (c, dog):
        _school_hw(c, dog, [0, 1, 2])
        out = run(server.portal_homework_streak({"id": "u", "role": "client", "client_id": c["id"]}))
        assert out["current_streak"] == 3 and out["longest_streak"] == 3 and out["completed_today"] is True


def test_reminder_job_nudges_school_students_not_already_practiced_today():
    dow = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][_today().weekday()]
    with _client_and_dog(homework_reminder_enabled=True, homework_reminder_days=[dow]) as (c, dog):
        hw = _school_hw(c, dog, [1, 2])  # practiced yesterday, not today
        with patch.object(daily_jobs.email_service, "notify_client_homework_reminder", new=AsyncMock(return_value=True)) as m:
            res = run(daily_jobs.run_homework_practice_reminder_job(server.db))
        mine = [call for call in m.call_args_list if call.args[0].get("id") == c["id"]]
        assert mine, f"School student must get the practice nudge: {res}"
        plans = mine[0].args[1]
        assert plans[0]["school"] is True and plans[0]["day_number"] == 3 and plans[0]["total_days"] == 0
        # Practiced today → no nudge.
        run(server.db.notification_log.delete_many({"client_id": c["id"]}))
        run(server.db.homework.update_one({"id": hw["id"]}, {"$push": {"section_logs": {
            "id": "t", "section_id": "practice", "date": _today().isoformat(), "logged_by_role": "client", "logged_at": server.now_iso()}}}))
        with patch.object(daily_jobs.email_service, "notify_client_homework_reminder", new=AsyncMock(return_value=True)) as m2:
            run(daily_jobs.run_homework_practice_reminder_job(server.db))
        assert not [call for call in m2.call_args_list if call.args[0].get("id") == c["id"]]


def test_weekly_digest_includes_school_rows_with_session_counts():
    with _client_and_dog() as (c, dog):
        today = _today()
        _school_hw(c, dog, [0, 1, 2])
        with patch.object(daily_jobs.email_service, "notify_client_weekly_homework_digest", new=AsyncMock(return_value=True)) as m:
            run(daily_jobs.run_homework_weekly_digest_job(server.db, as_of=today))
        mine = [call for call in m.call_args_list if call.args[0].get("id") == c["id"]]
        assert mine, "School student must receive the weekly digest"
        items = mine[0].args[1]
        it = items[0]
        assert it["school"] is True and it["approved_total"] == 3 and it["total_days"] == 0
        monday = today - timedelta(days=today.weekday())
        expected_week = sum(1 for i in (0, 1, 2) if monday <= today - timedelta(days=i) <= monday + timedelta(days=6))
        assert it["approved_this_week"] == expected_week
        assert it["streak"] == 3


def test_monday_digest_counts_school_streak_leaders_and_pending_reviews():
    with _client_and_dog() as (c, dog):
        hw = _school_hw(c, dog, [0, 1, 2, 3])
        run(server.db.homework.update_one({"id": hw["id"], "section_logs.date": _today().isoformat()},
                                          {"$set": {"section_logs.$.field_values": {"__difficulty": "very_hard"}}}))
        captured = {}

        async def fake_digest(data, **kwargs):
            captured["data"] = data
            return True

        run(server.db.notification_log.delete_many({"key": {"$regex": "^trainer_monday_digest:"}}))
        with patch.object(daily_jobs.email_service, "notify_trainer_monday_digest", new=fake_digest):
            res = run(daily_jobs.run_trainer_monday_digest_job(server.db))
        data = captured.get("data") or {}
        leaders = [x for x in (data.get("streak_leaders") or []) if x.get("dog") == dog["name"]]
        assert leaders and leaders[0]["streak"] == 4, f"School streak leader missing: {res} / {list(data.keys())}"
        pending = [x for x in (data.get("pending_reviews") or []) if x.get("dog") == dog["name"]]
        assert pending, "a very_hard School session awaiting review must be in the trainer's queue"
        run(server.db.notification_log.delete_many({"key": {"$regex": "^trainer_monday_digest:"}}))


def test_dog_timeline_has_a_practice_session_event_per_real_session():
    with _client_and_dog() as (c, dog):
        hw = _school_hw(c, dog, [0, 1])
        run(server.db.homework.update_one({"id": hw["id"]}, {"$push": {"section_logs": {"$each": [
            {"id": "rest", "section_id": "practice", "date": _today().isoformat(), "logged_by_role": "client", "is_rest_day": True},
            {"id": "admin", "section_id": "practice", "date": _today().isoformat(), "logged_by_role": "admin"},
        ]}}}))
        events = run(server.dog_timeline(dog["id"], 80, _admin_user()))
        practice = [e for e in events if e["kind"] == "practice_session"]
        assert len(practice) == 2, [e["kind"] for e in events]


def test_enrollment_summary_and_portal_preview_expose_course_progress_for_online():
    with _client_and_dog() as (c, dog):
        snap = {"name": "P", "modules": [{"id": "M1", "name": "M1", "order": 0, "goals": [{"id": "g1"}, {"id": "g2"}],
                                          "lessons": [{"id": "L1", "name": "L1", "order": 0, "active": True, "skill_ids": ["g1"]},
                                                      {"id": "L2", "name": "L2", "order": 1, "active": True, "skill_ids": ["g2"]}]}]}
        online = {"id": str(uuid.uuid4()), "dog_id": dog["id"], "program_id": "p", "status": "active", "delivery_channel": "online_school",
                  "goal_progress": {}, "program_snapshot": snap, "current_module_id": "M1", "current_lesson_id": "L2", "started_at": "2026-01-01",
                  "created_at": server.now_iso()}
        run(server.db.dog_programs.insert_one(online))
        summ = server._enrollment_summary(online)
        assert summ["mastered_pct"] == 0 and summ["progress_kind"] == "lessons"
        assert summ["lessons_completed"] == 1 and summ["lessons_total"] == 2 and summ["progress_pct"] == 50
        in_person = server._enrollment_summary({**online, "delivery_channel": "in_person_school", "goal_progress": {"g1": {"score": 4}}})
        assert in_person["progress_kind"] == "skills" and in_person["progress_pct"] == 50
        snap_out = run(server.admin_client_portal_snapshot(c["id"], _admin_user()))
        rows = snap_out["enrollments_by_dog"].get(dog["id"]) or []
        assert rows and rows[0]["id"] == online["id"] and rows[0]["progress_pct"] == 50, "portal preview must read dog_programs"
