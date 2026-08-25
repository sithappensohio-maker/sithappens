"""Guard enforced trainer-delivery progress from legacy direct-write shortcuts.

Trainer Delivery makes the canonical session-draft completion path the only
place staff-led training progress may be recorded.  Older UI surfaces still
have a per-goal PUT route that can mutate ``dog_programs.goal_progress``
without a session record.  This middleware closes that server-side bypass for
programs where Trainer Delivery is enabled.

It deliberately does not replace the legacy endpoint.  Self-guided/legacy
programs keep their existing behavior, while enforced staff-led programs get a
clear conflict telling the caller to use the Training Session Workspace.
"""
from __future__ import annotations

import re

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from trainer_delivery import _trainer_policy


_GOAL_WRITE_RE = re.compile(
    r"^/api/dogs/([^/]+)/programs/([^/]+)/goals/([^/]+)$"
)


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


def install_trainer_delivery_guard(*, server_module, db) -> None:
    if getattr(server_module, "_trainer_delivery_guard_installed", False):
        return

    app = server_module.app

    @app.middleware("http")
    async def trainer_delivery_goal_write_guard(request: Request, call_next):
        match = _GOAL_WRITE_RE.match(request.url.path) if request.method == "PUT" else None
        if not match:
            return await call_next(request)

        dog_id, enrollment_id, _goal_id = match.groups()
        enrollment = await db.dog_programs.find_one(
            {"id": enrollment_id, "dog_id": dog_id}, {"_id": 0}
        )
        if not enrollment or not _trainer_policy(enrollment).get("enabled"):
            return await call_next(request)

        # Keep the original route responsible for authentication/authorization
        # unless this is a legitimate staff request.  That avoids changing the
        # security semantics or leaking enrollment existence to unauthenticated
        # callers.
        user = await _current_user(server_module, request)
        if not user:
            return await call_next(request)
        try:
            perms = server_module._perms_for(user)
        except Exception:
            perms = {}
        if not perms.get("manage_training_sessions"):
            return await call_next(request)

        return JSONResponse(
            status_code=409,
            content={
                "detail": {
                    "code": "trainer_delivery_session_required",
                    "msg": (
                        "Progress for this trainer-led program must be recorded "
                        "through the Training Session Workspace so the skill score, "
                        "trainer observations, recap, and audit history stay together."
                    ),
                    "enrollment_id": enrollment_id,
                    "dog_id": dog_id,
                }
            },
        )

    server_module._trainer_delivery_guard_installed = True
