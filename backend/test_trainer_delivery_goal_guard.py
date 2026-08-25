"""Regression tests for Trainer Delivery legacy-write guards."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import httpx
from fastapi import FastAPI, Request
from fastapi.security import HTTPAuthorizationCredentials

import _test_env  # noqa: F401
import server
from _test_loop import run
from trainer_delivery_guard import install_trainer_delivery_guard

TAG = "TEST_TRAINER_DELIVERY_GOAL_GUARD"


def _id(prefix):
    return f"{TAG}-{prefix}-{uuid.uuid4().hex[:8]}"


def _fake_server(app):
    async def get_current_user(credentials):
        return {
            "id": "trainer", "name": "Trainer Test", "email": "trainer@example.invalid",
            "role": "employee", "staff_role": "trainer",
        }

    def perms_for(_user):
        return {"manage_training_sessions": True}

    return SimpleNamespace(
        app=app,
        HTTPAuthorizationCredentials=HTTPAuthorizationCredentials,
        get_current_user=get_current_user,
        _perms_for=perms_for,
        _trainer_delivery_guard_installed=False,
    )


def _headers():
    return {"Authorization": "Bearer trainer"}


def _app():
    app = FastAPI()
    fake = _fake_server(app)

    @app.put("/api/dogs/{dog_id}/programs/{enrollment_id}/goals/{goal_id}")
    async def legacy_goal_write(dog_id: str, enrollment_id: str, goal_id: str, request: Request):
        body = await request.json()
        await server.db.dog_programs.update_one(
            {"id": enrollment_id, "dog_id": dog_id},
            {"$set": {f"goal_progress.{goal_id}": body}},
        )
        return {"ok": True}

    @app.put("/api/dogs/{dog_id}/programs/{enrollment_id}/current-module")
    async def legacy_current_module(dog_id: str, enrollment_id: str, request: Request):
        body = await request.json()
        await server.db.dog_programs.update_one(
            {"id": enrollment_id, "dog_id": dog_id},
            {"$set": {"current_module_id": body.get("module_id")}},
        )
        return {"ok": True}

    @app.put("/api/dogs/{dog_id}/programs/{enrollment_id}")
    async def legacy_enrollment_write(dog_id: str, enrollment_id: str, request: Request):
        body = await request.json()
        update = {k: v for k, v in body.items() if k in {"status", "trainer_notes", "target_completion_date"}}
        if update:
            await server.db.dog_programs.update_one(
                {"id": enrollment_id, "dog_id": dog_id}, {"$set": update}
            )
        return {"ok": True}

    install_trainer_delivery_guard(server_module=fake, db=server.db)
    return app


def _insert_enforced(enrollment_id, dog_id):
    run(server.db.dog_programs.insert_one({
        "id": enrollment_id,
        "dog_id": dog_id,
        "status": "active",
        "delivery_channel": "in_person_school",
        "program_snapshot": {"name": "Private Lessons", "type": "private_lessons"},
        "goal_progress": {},
        "current_module_id": "module-1",
        "trainer_notes": "before",
    }))


def test_staff_led_direct_goal_write_is_blocked_before_progress_mutates():
    enrollment_id, dog_id = _id("enr"), _id("dog")
    _insert_enforced(enrollment_id, dog_id)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://test")
    try:
        response = run(client.put(
            f"/api/dogs/{dog_id}/programs/{enrollment_id}/goals/sit",
            headers=_headers(), json={"score": 5, "status": "mastered"},
        ))
        assert response.status_code == 409, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "trainer_delivery_session_required"
        assert detail["action"] == "goal_progress"
        stored = run(server.db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0}))
        assert (stored.get("goal_progress") or {}).get("sit") is None
    finally:
        run(client.aclose())
        run(server.db.dog_programs.delete_one({"id": enrollment_id}))


def test_staff_led_direct_current_module_move_is_blocked():
    enrollment_id, dog_id = _id("module-enr"), _id("module-dog")
    _insert_enforced(enrollment_id, dog_id)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://test")
    try:
        response = run(client.put(
            f"/api/dogs/{dog_id}/programs/{enrollment_id}/current-module",
            headers=_headers(), json={"module_id": "module-2"},
        ))
        assert response.status_code == 409, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "trainer_delivery_session_required"
        assert detail["action"] == "current_module"
        stored = run(server.db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0}))
        assert stored["current_module_id"] == "module-1"
    finally:
        run(client.aclose())
        run(server.db.dog_programs.delete_one({"id": enrollment_id}))


def test_staff_led_direct_complete_is_blocked_but_notes_and_hold_resume_controls_remain():
    enrollment_id, dog_id = _id("status-enr"), _id("status-dog")
    _insert_enforced(enrollment_id, dog_id)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://test")
    try:
        blocked = run(client.put(
            f"/api/dogs/{dog_id}/programs/{enrollment_id}",
            headers=_headers(), json={"status": "completed"},
        ))
        assert blocked.status_code == 409, blocked.text
        detail = blocked.json()["detail"]
        assert detail["code"] == "trainer_delivery_session_required"
        assert detail["action"] == "complete_enrollment"
        stored = run(server.db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0}))
        assert stored["status"] == "active"

        notes = run(client.put(
            f"/api/dogs/{dog_id}/programs/{enrollment_id}",
            headers=_headers(), json={"trainer_notes": "updated through normal metadata control"},
        ))
        assert notes.status_code == 200, notes.text
        hold = run(client.put(
            f"/api/dogs/{dog_id}/programs/{enrollment_id}",
            headers=_headers(), json={"status": "on_hold"},
        ))
        assert hold.status_code == 200, hold.text
        stored = run(server.db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0}))
        assert stored["trainer_notes"].startswith("updated")
        assert stored["status"] == "on_hold"
    finally:
        run(client.aclose())
        run(server.db.dog_programs.delete_one({"id": enrollment_id}))


def test_unenforced_legacy_program_keeps_existing_direct_write_behavior():
    enrollment_id, dog_id = _id("legacy-enr"), _id("legacy-dog")
    run(server.db.dog_programs.insert_one({
        "id": enrollment_id,
        "dog_id": dog_id,
        "status": "active",
        "delivery_channel": "legacy",
        "program_snapshot": {"name": "Legacy Plan", "type": "custom", "school_support": {"trainer_delivery": {"enabled": False}}},
        "goal_progress": {},
    }))
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://test")
    try:
        response = run(client.put(
            f"/api/dogs/{dog_id}/programs/{enrollment_id}/goals/sit",
            headers=_headers(), json={"score": 3, "status": "in_progress"},
        ))
        assert response.status_code == 200, response.text
        stored = run(server.db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0}))
        assert stored["goal_progress"]["sit"]["score"] == 3
    finally:
        run(client.aclose())
        run(server.db.dog_programs.delete_one({"id": enrollment_id}))
