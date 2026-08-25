"""Guard enforced Trainer Delivery from legacy direct-write shortcuts.

The canonical Training Session Workspace is the only place staff-led training
progress should change. Older surfaces still expose three historical writes:

* direct per-goal score/status edits;
* directly moving the current module/week pointer; and
* directly marking an enrollment completed.

For programs with Trainer Delivery enabled these writes would let a trainer
skip the required session record. This middleware blocks them server-side.
Non-training metadata changes (notes, target dates, hold/resume/withdraw) keep
their existing behavior, and unenforced legacy/self-guided programs are not
changed.
"""
from __future__ import annotations

import json
import re

from fastapi import Request
from fastapi.responses import JSONResponse

from trainer_delivery import _trainer_policy


_GOAL_WRITE_RE = re.compile(r"^/api/dogs/([^/]+)/programs/([^/]+)/goals/([^/]+)$")
_ENROLLMENT_WRITE_RE = re.compile(r"^/api/dogs/([^/]+)/programs/([^/]+)$")
_CURRENT_MODULE_RE = re.compile(r"^/api/dogs/([^/]+)/programs/([^/]+)/current-module$")


def _clean(value) -> str:
    return str(value or "").strip()


async def _current_user(server_module, request: Request):
    raw = _clean(request.headers.get("authorization"))
    if not raw.lower().startswith("bearer "):
        return None
    token = raw.split(None, 1)[1]
    try:
        credentials = server_module.HTTPAuthorizationCredentials(
            scheme="Bearer", credentials=token
        )
        return await server_module.get_current_user(credentials)
    except Exception:
        return None


async def _staff_enforced_context(server_module, db, request: Request, dog_id: str, enrollment_id: str):
    enrollment = await db.dog_programs.find_one(
        {"id": enrollment_id, "dog_id": dog_id}, {"_id": 0}
    )
    if not enrollment or not _trainer_policy(enrollment).get("enabled"):
        return None, None

    # Preserve the canonical route's normal auth/permission behavior for
    # unauthenticated or non-training callers. The guard only short-circuits a
    # legitimate training-operations user who would otherwise be allowed to
    # mutate progress directly.
    user = await _current_user(server_module, request)
    if not user:
        return None, None
    try:
        perms = server_module._perms_for(user)
    except Exception:
        perms = {}
    if not perms.get("manage_training_sessions"):
        return None, None
    return enrollment, user


def _blocked(enrollment_id: str, dog_id: str, action: str, message: str):
    return JSONResponse(
        status_code=409,
        content={
            "detail": {
                "code": "trainer_delivery_session_required",
                "action": action,
                "msg": message,
                "enrollment_id": enrollment_id,
                "dog_id": dog_id,
            }
        },
    )


def install_trainer_delivery_guard(*, server_module, db) -> None:
    if getattr(server_module, "_trainer_delivery_guard_installed", False):
        return

    app = server_module.app

    @app.middleware("http")
    async def trainer_delivery_write_guard(request: Request, call_next):
        if request.method != "PUT":
            return await call_next(request)

        goal_match = _GOAL_WRITE_RE.match(request.url.path)
        if goal_match:
            dog_id, enrollment_id, _goal_id = goal_match.groups()
            enrollment, _user = await _staff_enforced_context(
                server_module, db, request, dog_id, enrollment_id
            )
            if enrollment:
                return _blocked(
                    enrollment_id,
                    dog_id,
                    "goal_progress",
                    "Progress for this trainer-led program must be recorded through the Training Session Workspace so the skill score, trainer observations, recap, and audit history stay together.",
                )
            return await call_next(request)

        module_match = _CURRENT_MODULE_RE.match(request.url.path)
        if module_match:
            dog_id, enrollment_id = module_match.groups()
            enrollment, _user = await _staff_enforced_context(
                server_module, db, request, dog_id, enrollment_id
            )
            if enrollment:
                return _blocked(
                    enrollment_id,
                    dog_id,
                    "current_module",
                    "The current lesson/module for this trainer-led program is advanced from a documented Training Session. Open the Training Session Workspace and choose the appropriate advancement decision instead of moving the curriculum pointer directly.",
                )
            return await call_next(request)

        enrollment_match = _ENROLLMENT_WRITE_RE.match(request.url.path)
        if enrollment_match:
            dog_id, enrollment_id = enrollment_match.groups()
            raw = await request.body()
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                body = {}
            # Only completion is a training-progress bypass here. Hold/resume,
            # withdraw, notes, target dates, etc. remain normal operational
            # enrollment controls.
            if _clean(body.get("status")) == "completed":
                enrollment, _user = await _staff_enforced_context(
                    server_module, db, request, dog_id, enrollment_id
                )
                if enrollment:
                    return _blocked(
                        enrollment_id,
                        dog_id,
                        "complete_enrollment",
                        "This trainer-led program must be completed from the Training Session Workspace so the final training record and explicit completion decision are preserved.",
                    )
            # request.body() caches the bytes on Starlette Request, so the
            # canonical endpoint can still consume the same body normally.
            return await call_next(request)

        return await call_next(request)

    server_module._trainer_delivery_guard_installed = True
