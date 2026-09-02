"""Trophy engine rework — visits count archived + legacy bookings, Practice
streaks count DAYS PRACTICED in School (section logs / daily submits), the
homework-era catalog copy migrates to School Practice language only where the
admin never touched it, and the admin re-check sweep hands out earned-but-
never-fired awards. Same fixture convention as test_online_school_phase3.py —
self-contained, no shared conftest.
"""
import contextlib
import uuid
from datetime import date, datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
import trophy_service
from _test_loop import run

TAG = "TEST_TROPHY_REWORK"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3}))
    try:
        yield c, {"id": did}
    finally:
        run(server.db.awarded_trophies.delete_many({"client_id": c["id"]}))
        run(server.db.homework.delete_many({"client_id": c["id"]}))
        run(server.db.bookings.delete_many({"client_id": c["id"]}))
        run(server.db.bookings_archive.delete_many({"client_id": c["id"]}))
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


def _booking(client_id, dog_id, **extra):
    row = {
        "id": str(uuid.uuid4()), "client_id": client_id, "dog_id": dog_id, "service_type": "daycare",
        "date": "2025-01-01", "status": "completed", "created_at": server.now_iso(), "_trophy_rework_seed": True,
    }
    row.update(extra)
    return row


def _iso(d):
    return datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc).isoformat()


# ───────────────────────── visits ─────────────────────────


def test_visit_count_includes_archived_and_legacy_rows():
    with _client_and_dog() as (c, dog):
        cid, did = c["id"], dog["id"]
        ts = server.now_iso()
        live = [_booking(cid, did, checked_out_at=ts) for _ in range(3)]
        live.append(_booking(cid, did, status="checked_out"))          # legacy status, no stamp
        live.append(_booking(cid, did, status="cancelled"))            # never a visit
        live.append(_booking(cid, did, status="approved"))             # not happened yet
        run(server.db.bookings.insert_many(live))
        archived = [_booking(cid, did, checked_out_at=ts, archived_at=ts) for _ in range(4)]
        archived.append(_booking(cid, did, status="rejected", archived_at=ts))
        run(server.db.bookings_archive.insert_many(archived))

        assert run(trophy_service._client_visit_count(server.db, cid)) == 3 + 1 + 4


def test_recheck_sweep_awards_visit_tier_hidden_by_archive():
    with _client_and_dog() as (c, dog):
        cid, did = c["id"], dog["id"]
        ts = server.now_iso()
        # 2 recent visits live, 8 older ones already archived → 10 = client_regular
        run(server.db.bookings.insert_many([_booking(cid, did, checked_out_at=ts) for _ in range(2)]))
        run(server.db.bookings_archive.insert_many([_booking(cid, did, checked_out_at=ts, archived_at=ts) for _ in range(8)]))
        before = run(server.db.awarded_trophies.find_one({"client_id": cid, "trophy_code": "client_regular"}))
        assert before is None

        summary = run(server.admin_recheck_trophies(_admin_user()))
        assert summary["clients_checked"] >= 1
        assert summary["by_code"].get("client_regular", 0) >= 1
        row = run(server.db.awarded_trophies.find_one({"client_id": cid, "trophy_code": "client_regular"}, {"_id": 0}))
        assert row is not None and row["meta"]["visit_count_at_award"] == 10
        # Idempotent — a second sweep awards nothing new for this client.
        again = run(trophy_service.check_client_trophies(server.db, cid))
        assert again == []
        marker = run(server.db.system_runs.find_one({"_id": "trophy_recheck"}))
        assert marker and marker.get("date")


# ───────────────────────── practice streaks ─────────────────────────


def test_practice_days_count_client_sessions_not_admin_or_rest():
    with _client_and_dog() as (c, dog):
        cid, did = c["id"], dog["id"]
        today = date.today()
        d = [today - timedelta(days=i) for i in range(6)]
        hw = {
            "id": str(uuid.uuid4()), "client_id": cid, "dog_id": did, "status": "in_progress",
            "school_enrollment_id": str(uuid.uuid4()), "assigned_by": "Online School",
            "section_logs": [
                {"id": "a", "section_id": "practice", "date": d[0].isoformat(), "logged_by_role": "client"},
                {"id": "b", "section_id": "practice", "date": d[1].isoformat(), "logged_by_role": "client"},
                {"id": "c", "section_id": "practice", "date": d[2].isoformat(), "logged_by_role": "client"},
                # trainer bookkeeping on day 3 must NOT bridge the gap
                {"id": "d", "section_id": "practice", "date": d[3].isoformat(), "logged_by_role": "admin"},
                # rest / skipped / draft never count either
                {"id": "e", "section_id": "day-4", "date": d[4].isoformat(), "logged_by_role": "client", "is_rest_day": True},
                {"id": "f", "section_id": "practice", "date": d[5].isoformat(), "logged_by_role": "client", "submission_status": "draft"},
            ],
        }
        run(server.db.homework.insert_one(hw))
        days = run(trophy_service.practice_days(server.db, cid))
        assert days == {d[0], d[1], d[2]}
        assert run(trophy_service._homework_streak_days(server.db, cid)) == 3
        # nothing is "completed" — the count trophy input stays honest
        assert run(trophy_service._count_homework_completed(server.db, cid)) == 0


def test_daily_tracker_only_counts_submitted_days():
    with _client_and_dog() as (c, dog):
        cid, did = c["id"], dog["id"]
        today = date.today()
        hw = {
            "id": str(uuid.uuid4()), "client_id": cid, "dog_id": did, "status": "in_progress", "daily_tracker": True,
            "section_logs": [
                {"id": "1", "day_number": 1, "date": today.isoformat(), "logged_by_role": "client", "submission_status": "submitted"},
                {"id": "2", "day_number": 2, "date": (today - timedelta(days=1)).isoformat(), "logged_by_role": "client", "submission_status": "approved"},
                {"id": "3", "day_number": 3, "date": (today - timedelta(days=2)).isoformat(), "logged_by_role": "client", "submission_status": "in_progress"},
            ],
        }
        run(server.db.homework.insert_one(hw))
        assert run(trophy_service._homework_streak_days(server.db, cid)) == 2


def test_three_day_school_practice_streak_awards_streak_spark():
    with _client_and_dog() as (c, dog):
        cid, did = c["id"], dog["id"]
        today = date.today()
        hw = {
            "id": str(uuid.uuid4()), "client_id": cid, "dog_id": did, "status": "in_progress",
            "school_enrollment_id": str(uuid.uuid4()),
            "section_logs": [
                {"id": str(i), "section_id": "practice", "date": (today - timedelta(days=i)).isoformat(),
                 "logged_by_role": "client", "logged_at": _iso(today - timedelta(days=i))}
                for i in range(3)
            ],
        }
        run(server.db.homework.insert_one(hw))
        # the same hook the section-log / daily-submit endpoints call
        run(server._recheck_client_trophies_after_practice(hw, {"role": "client", "client_id": cid}))
        row = run(server.db.awarded_trophies.find_one({"client_id": cid, "trophy_code": "client_streak_spark"}, {"_id": 0}))
        assert row is not None, "3-day School practice streak must award Streak Sparked"
        assert row["meta"]["streak_at_award"] == 3
        # an admin log never triggers the client's awards
        run(server.db.awarded_trophies.delete_many({"client_id": cid}))
        run(server._recheck_client_trophies_after_practice(hw, {"role": "admin", "id": "x"}))
        assert run(server.db.awarded_trophies.find_one({"client_id": cid})) is None


def test_shared_practice_session_predicate_is_single_sourced():
    assert server._practice_log_counts_as_session({}, {"is_rest_day": True}) is False
    assert server._practice_log_counts_as_session({}, {"submission_status": "draft"}) is False
    assert server._practice_log_counts_as_session({}, {"section_id": "practice"}) is True
    assert server._practice_log_counts_as_session({"daily_tracker": True}, {"submission_status": "submitted"}) is True
    assert server._practice_log_counts_as_session({"daily_tracker": True}, {"section_id": "day-1"}) is False
    for hw, log in [({}, {"is_skipped": True}), ({"daily_tracker": True}, {"submission_status": "approved"})]:
        assert server._practice_log_counts_as_session(hw, log) == trophy_service.practice_log_counts_as_session(hw, log)


# ───────────────────────── catalog copy migration ─────────────────────────


def test_migration_rewrites_only_untouched_seed_copy():
    codes = ["client_homework_hero", "client_dedicated"]
    saved = run(server.db.trophies.find({"code": {"$in": codes}}, {"_id": 0}).to_list(10))
    try:
        run(server.db.trophies.update_one(
            {"code": "client_homework_hero"},
            {"$set": {"name": "Homework Hero", "description": "Completed homework seven days in a row."}}))
        run(server.db.trophies.update_one(
            {"code": "client_dedicated"},
            {"$set": {"description": "My own custom wording the admin typed."}}))
        awarded_id = str(uuid.uuid4())
        run(server.db.awarded_trophies.insert_one({
            "id": awarded_id, "trophy_code": "client_homework_hero", "trophy_name": "Homework Hero",
            "trophy_description": "Completed homework seven days in a row.", "recipient_type": "client",
            "recipient_id": "nobody", "client_id": "nobody", "revoked": False, "awarded_at": server.now_iso(),
        }))
        changed = run(trophy_service.migrate_trophy_copy_for_school(server.db))
        assert changed >= 1
        hero = run(server.db.trophies.find_one({"code": "client_homework_hero"}, {"_id": 0}))
        assert hero["name"] == "Practice Hero"
        assert hero["description"] == "Practiced with your dog seven days in a row."
        custom = run(server.db.trophies.find_one({"code": "client_dedicated"}, {"_id": 0}))
        assert custom["description"] == "My own custom wording the admin typed."
        snap = run(server.db.awarded_trophies.find_one({"id": awarded_id}, {"_id": 0}))
        assert snap["trophy_name"] == "Practice Hero"
        # idempotent
        assert run(trophy_service.migrate_trophy_copy_for_school(server.db)) == 0
    finally:
        run(server.db.awarded_trophies.delete_many({"recipient_id": "nobody"}))
        for row in saved:
            run(server.db.trophies.replace_one({"code": row["code"]}, row))


def test_seed_catalog_speaks_school_practice():
    from trophies_data import SEED_TROPHIES
    by_code = {t["code"]: t for t in SEED_TROPHIES}
    assert by_code["client_homework_hero"]["name"] == "Practice Hero"
    for code in ("client_streak_spark", "client_dedicated", "client_coach_of_year", "client_first_plan"):
        assert "homework" not in by_code[code]["description"].lower()
        assert "practice" in by_code[code]["description"].lower()
