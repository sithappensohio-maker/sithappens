"""Enforced Trainer Delivery — regression coverage.

These tests deliberately do not install the extension on ``server.app`` during
collection, because the legacy training suites import that shared app directly
and intentionally exercise pre-enforcement helper behavior.  Middleware tests
use a fresh FastAPI app while sharing the disposable test Mongo database.
"""
from __future__ import annotations

import contextlib
import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, Request
from fastapi.security import HTTPAuthorizationCredentials

import _test_env  # noqa: F401 — configure disposable test DB before server import
import server
from _test_loop import run
from trainer_delivery import (
    _board_train_label,
    _board_train_rows,
    _maybe_auto_close_board_train_day,
    _trainer_policy,
    install_trainer_delivery,
    validate_trainer_session,
)

TAG = "TEST_TRAINER_DELIVERY"


def _id(prefix: str) -> str:
    return f"{TAG}-{prefix}-{uuid.uuid4().hex[:8]}"


def _policy_enrollment(*, board_train=False):
    return {
        "id": _id("enrollment"),
        "dog_id": _id("dog"),
        "program_id": _id("program"),
        "status": "active",
        "delivery_channel": "in_person_school",
        "program_snapshot": {
            "id": _id("snapshot"),
            "name": "Board & Train" if board_train else "Private Lessons",
            "type": "board_train" if board_train else "private_lessons",
            "modules": [],
        },
    }


def _complete_draft(*, board_train=False, label=""):
    return {
        "id": _id("draft"),
        "status": "draft",
        "session_label": label,
        "plan": {"activities": [{"id": "sit", "name": "Sit", "skill_id": "skill-sit"}]},
        "actuals": {
            "sit": {
                "score": 4,
                "outcome": "improving",
                "client_observation": "Sit is becoming much more reliable.",
            }
        },
        "what_went_well": "Good engagement and clean repetitions.",
        "needs_work": "Build more duration around distractions.",
        "next_lesson_focus": "Add distance and moderate distractions.",
        "client_recap_note": "Great progress today. We are adding duration next.",
    }


def test_policy_defaults_are_strict_for_in_person_and_two_sessions_for_board_train():
    private = _trainer_policy(_policy_enrollment(board_train=False))
    assert private["enabled"] is True
    assert private["require_score"] is True
    assert private["require_outcome"] is True
    assert private["require_client_observation"] is True
    assert private["require_session_summary"] is True
    assert private["require_client_recap"] is True
    assert private["require_explicit_advancement"] is True

    bt = _trainer_policy(_policy_enrollment(board_train=True))
    assert bt["enabled"] is True
    assert bt["is_board_train"] is True
    assert bt["required_sessions_per_day"] == 2
    assert bt["required_slots"] == ["am", "pm"]
    assert bt["daily_closeout_required"] is True


def test_validator_blocks_empty_record_and_accepts_complete_in_person_record():
    enrollment = _policy_enrollment(board_train=False)
    policy = _trainer_policy(enrollment)
    draft = {
        "id": "d1", "status": "draft",
        "plan": {"activities": [{"id": "sit", "name": "Sit", "skill_id": "skill-sit"}]},
        "actuals": {},
    }
    blocked = validate_trainer_session(draft, {"advancement_action": "remain"}, policy)
    assert blocked["ok"] is False
    joined = " | ".join(blocked["missing"])
    assert "Record Sit" in joined
    assert "What Went Well" in joined
    assert "Needs Work" in joined
    assert "Next Focus" in joined
    assert "client recap" in joined.lower()

    good = _complete_draft()
    accepted = validate_trainer_session(good, {"advancement_action": "remain"}, policy)
    assert accepted == {"ok": True, "missing": [], "excused": False}


def test_validator_allows_real_recovery_session_without_fake_scores():
    enrollment = _policy_enrollment(board_train=True)
    policy = _trainer_policy(enrollment)
    draft = {
        "id": "d-recovery", "status": "draft",
        "session_label": "bt:2026-08-25:am",
        "plan": {"activities": [
            {"id": "sit", "name": "Sit", "skill_id": "skill-sit", "skipped": True, "skip_reason": "GI upset — rest only"},
            {"id": "heel", "name": "Heel", "skill_id": "skill-heel", "skipped": True, "skip_reason": "GI upset — rest only"},
        ]},
        "actuals": {},
    }
    result = validate_trainer_session(
        draft,
        {"advancement_action": "remain", "advancement_reason": "GI upset — recovery period and enrichment only."},
        policy,
    )
    assert result["ok"] is True
    assert result["excused"] is True
    assert result["missing"] == []


def _fake_server(app: FastAPI):
    calls = []

    async def get_current_user(credentials):
        token = getattr(credentials, "credentials", "")
        if token == "frontdesk":
            return {"id": "fd", "name": "Front Desk", "email": "fd@example.invalid", "role": "employee", "staff_role": "front_desk"}
        return {"id": "trainer", "name": "Trainer Test", "email": "trainer@example.invalid", "role": "employee", "staff_role": "trainer"}

    def perms_for(user):
        return {"manage_training_sessions": user.get("staff_role") == "trainer"}

    async def start_for_booking(booking_id, enrollment_id, label, user):
        calls.append((booking_id, enrollment_id, label, user.get("id")))
        return {"resolution": "ready", "draft": {"id": _id("synthetic"), "session_label": label, "booking_id": booking_id}}

    return SimpleNamespace(
        app=app,
        HTTPAuthorizationCredentials=HTTPAuthorizationCredentials,
        get_current_user=get_current_user,
        _perms_for=perms_for,
        start_training_session_draft_for_booking=start_for_booking,
        _trainer_delivery_installed=False,
        calls=calls,
    )


@contextlib.contextmanager
def _fresh_extension_app():
    app = FastAPI()
    fake = _fake_server(app)

    @app.post("/api/training-session-drafts/{draft_id}/complete")
    async def canonical_complete(draft_id: str, request: Request):
        body = await request.json()
        await server.db.training_session_drafts.update_one(
            {"id": draft_id}, {"$set": {"status": "completed", "completion_body_for_test": body}}
        )
        return {"ok": True, "draft_id": draft_id, "body": body}

    @app.get("/api/admin/training/today")
    async def canonical_today():
        return []

    install_trainer_delivery(server_module=fake, db=server.db)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    try:
        yield fake, client
    finally:
        run(client.aclose())


def _headers(token="trainer"):
    return {"Authorization": f"Bearer {token}"}


def test_http_completion_is_server_enforced_and_writes_one_audit_row():
    enrollment = _policy_enrollment(board_train=False)
    draft_id = _id("http-draft")
    enrollment["id"] = _id("http-enrollment")
    enrollment["dog_id"] = _id("http-dog")
    run(server.db.dog_programs.insert_one(enrollment))
    run(server.db.training_session_drafts.insert_one({
        "id": draft_id,
        "enrollment_id": enrollment["id"],
        "dog_id": enrollment["dog_id"],
        "occurrence_date": "2026-08-25",
        "status": "draft",
        "plan": {"activities": [{"id": "sit", "name": "Sit", "skill_id": "skill-sit"}]},
        "actuals": {},
    }))
    try:
        with _fresh_extension_app() as (fake, client):
            blocked = run(client.post(
                f"/api/training-session-drafts/{draft_id}/complete",
                headers=_headers(), json={"advancement_action": "remain"},
            ))
            assert blocked.status_code == 422, blocked.text
            detail = blocked.json()["detail"]
            assert detail["code"] == "trainer_delivery_incomplete"
            assert any("Record Sit" in x for x in detail["missing"])
            assert run(server.db.training_session_drafts.find_one({"id": draft_id}))["status"] == "draft"

            good = _complete_draft()
            run(server.db.training_session_drafts.update_one(
                {"id": draft_id}, {"$set": {
                    "actuals": good["actuals"],
                    "what_went_well": good["what_went_well"],
                    "needs_work": good["needs_work"],
                    "next_lesson_focus": good["next_lesson_focus"],
                    "client_recap_note": good["client_recap_note"],
                }}
            ))
            accepted = run(client.post(
                f"/api/training-session-drafts/{draft_id}/complete",
                headers=_headers(), json={"advancement_action": "remain"},
            ))
            assert accepted.status_code == 200, accepted.text
            audit = run(server.db.trainer_delivery_audit.find_one({"draft_id": draft_id}, {"_id": 0}))
            assert audit is not None
            assert audit["trainer_id"] == "trainer"
            assert audit["excused"] is False

            retry = run(client.post(
                f"/api/training-session-drafts/{draft_id}/complete",
                headers=_headers(), json={"advancement_action": "remain"},
            ))
            assert retry.status_code == 200
            assert run(server.db.trainer_delivery_audit.count_documents({"draft_id": draft_id})) == 1
    finally:
        run(server.db.trainer_delivery_audit.delete_many({"draft_id": draft_id}))
        run(server.db.training_session_drafts.delete_one({"id": draft_id}))
        run(server.db.dog_programs.delete_one({"id": enrollment["id"]}))


def test_board_train_resident_becomes_two_daily_training_rows_and_uses_real_booking():
    today_clock = datetime.now(ZoneInfo("America/New_York")).replace(hour=10, minute=0, second=0, microsecond=0)
    program_id = _id("bt-program")
    service_id = _id("bt-service")
    booking_id = _id("bt-booking")
    enrollment_id = _id("bt-enrollment")
    school_id = _id("bt-school")
    dog_id = _id("bt-dog")
    client_id = _id("bt-client")
    module_id = _id("module")
    lesson_id = _id("lesson")
    start = (today_clock.date() - timedelta(days=1)).isoformat()
    end = (today_clock.date() + timedelta(days=5)).isoformat()
    snapshot = {
        "id": program_id, "name": "2-Week Essential Obedience (Board & Train)", "type": "board_train",
        "modules": [{
            "id": module_id, "name": "Leash Work", "order": 0,
            "goals": [{"id": "g-heel", "name": "Loose Leash Walking"}, {"id": "g-place", "name": "Place"}],
            "lessons": [{"id": lesson_id, "name": "Leash Foundation", "order": 0, "active": True}],
        }],
    }
    run(server.db.programs.insert_one({"id": program_id, "name": snapshot["name"], "type": "board_train"}))
    run(server.db.services.insert_one({"id": service_id, "name": "2-Week Board & Train", "service_type": "training", "package_program_id": program_id}))
    run(server.db.clients.insert_one({"id": client_id, "name": f"{TAG} Client"}))
    run(server.db.dogs.insert_one({"id": dog_id, "name": f"{TAG} Dog", "owner_id": client_id}))
    run(server.db.dog_programs.insert_one({
        "id": enrollment_id, "dog_id": dog_id, "program_id": program_id, "status": "active",
        "delivery_channel": "in_person_school", "program_snapshot": snapshot,
        "current_module_id": module_id, "current_lesson_id": lesson_id,
        "goal_progress": {"g-heel": {"status": "in_progress"}, "g-place": {"status": "not_started"}},
    }))
    run(server.db.school_enrollments.insert_one({"id": school_id, "enrollment_id": enrollment_id, "dog_id": dog_id, "client_id": client_id, "program_id": program_id}))
    run(server.db.bookings.insert_one({
        "id": booking_id, "dog_id": dog_id, "service_id": service_id, "service_type": "training", "status": "approved",
        "date": start, "end_date": end, "checked_in_at": _id("checkin") + "T10:00:00Z",
    }))
    try:
        rows, real_ids = run(_board_train_rows(server.db, today_clock))
        mine = [r for r in rows if r.get("real_booking_id") == booking_id]
        assert real_ids.count(booking_id) == 1
        assert len(mine) == 2
        assert {r["trainer_delivery_slot"] for r in mine} == {"am", "pm"}
        assert all(r["trainer_delivery_day"] == 2 for r in mine)
        assert all(r["trainer_delivery_total_days"] == 6 for r in mine)
        assert all(r["booking_id"].startswith(booking_id + "~bt~") for r in mine)
        assert any("AM Training" in r["program_name"] for r in mine)
        assert any("PM Training + Daily Closeout" in r["program_name"] for r in mine)
        assert any("Loose Leash Walking" in r["recommended_focus"] for r in mine)

        with _fresh_extension_app() as (fake, client):
            opened = run(client.post(f"/api/bookings/{booking_id}~bt~am/training-session/draft", headers=_headers()))
            assert opened.status_code == 200, opened.text
            assert len(fake.calls) == 1
            real_booking, real_enrollment, label, trainer_id = fake.calls[0]
            assert real_booking == booking_id
            assert real_enrollment == enrollment_id
            assert label == _board_train_label(today_clock.date().isoformat(), "am")
            assert trainer_id == "trainer"

            denied = run(client.post(f"/api/bookings/{booking_id}~bt~pm/training-session/draft", headers=_headers("frontdesk")))
            assert denied.status_code == 403
    finally:
        for coll, query in [
            (server.db.training_session_drafts, {"enrollment_id": enrollment_id}),
            (server.db.trainer_delivery_excuses, {"enrollment_id": enrollment_id}),
            (server.db.trainer_delivery_day_closeouts, {"enrollment_id": enrollment_id}),
            (server.db.trainer_delivery_audit, {"enrollment_id": enrollment_id}),
            (server.db.bookings, {"id": booking_id}),
            (server.db.school_enrollments, {"id": school_id}),
            (server.db.dog_programs, {"id": enrollment_id}),
            (server.db.dogs, {"id": dog_id}),
            (server.db.clients, {"id": client_id}),
            (server.db.services, {"id": service_id}),
            (server.db.programs, {"id": program_id}),
        ]:
            run(coll.delete_many(query))


def test_board_train_day_closeout_is_idempotent_and_uses_pm_client_update():
    enrollment = _policy_enrollment(board_train=True)
    enrollment["id"] = _id("close-enrollment")
    enrollment["dog_id"] = _id("close-dog")
    session_date = "2026-08-25"
    user = {"id": "trainer", "name": "Trainer Test"}
    policy = _trainer_policy(enrollment)
    am = {
        **_complete_draft(board_train=True, label=_board_train_label(session_date, "am")),
        "id": _id("am"), "enrollment_id": enrollment["id"], "dog_id": enrollment["dog_id"], "status": "completed",
        "client_recap_note": "AM internal note",
    }
    pm = {
        **_complete_draft(board_train=True, label=_board_train_label(session_date, "pm")),
        "id": _id("pm"), "enrollment_id": enrollment["id"], "dog_id": enrollment["dog_id"], "status": "completed",
        "client_recap_note": "Polished daily client update from the PM training session.",
        "what_went_well": "Great leash engagement.", "needs_work": "Place duration.", "next_lesson_focus": "Add dog distraction.",
    }
    run(server.db.training_session_drafts.insert_many([am, pm]))
    try:
        run(_maybe_auto_close_board_train_day(server.db, enrollment, pm, user, policy))
        run(_maybe_auto_close_board_train_day(server.db, enrollment, pm, user, policy))
        rows = run(server.db.trainer_delivery_day_closeouts.find({"enrollment_id": enrollment["id"], "session_date": session_date}, {"_id": 0}).to_list(10))
        assert len(rows) == 1
        assert rows[0]["client_update"] == pm["client_recap_note"]
        assert rows[0]["biggest_win"] == "Great leash engagement."
        assert rows[0]["tomorrow_focus"] == "Add dog distraction."
    finally:
        run(server.db.training_session_drafts.delete_many({"enrollment_id": enrollment["id"]}))
        run(server.db.trainer_delivery_day_closeouts.delete_many({"enrollment_id": enrollment["id"]}))
        run(server.db.trainer_delivery_excuses.delete_many({"enrollment_id": enrollment["id"]}))
