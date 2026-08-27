"""Make normal In-Person trainer completion authoritative for progression.

The canonical session-completion route already validates trainer assignment,
required lesson assessments, recap fields, idempotency, and completion state.
Its checkpoint helper is the final curriculum gate before the completion plan
is claimed. Online/Hybrid checkpoint rules still need that gate, but pure
In-Person School is trainer-led: when an authorized trainer finishes the
lesson and explicitly chooses ``advance_next``, the trainer's assessment is
the progression decision.

Phase 4 calls the same policy directly from the canonical checkpoint helper.
The installer below remains for isolated compatibility tests only; production no
longer replaces the checkpoint helper after ``server`` has loaded.
"""
from __future__ import annotations

import inspect
from typing import Any


async def _await_if_needed(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def install_in_person_session_progression(*, server_module: Any) -> None:
    """Allow pure In-Person ``advance_next`` to bypass only checkpoint gates.

    Everything that runs before this helper in ``complete_training_session``
    remains authoritative, including required lesson assessment checks and
    trainer/assignment permissions. Hybrid and Online behavior is delegated to
    the original checkpoint resolver unchanged.
    """
    if getattr(server_module, "_in_person_session_progression_installed", False):
        return

    original_gate = getattr(server_module, "_required_checkpoint_blocks_advancement", None)
    if not callable(original_gate):
        raise RuntimeError("In-Person session progression could not find checkpoint gate helper")

    async def checkpoint_gate_with_in_person_trainer_authority(enrollment: dict, action: str) -> bool:
        if (
            (enrollment or {}).get("delivery_channel") == "in_person_school"
            and str(action or "").strip() == "advance_next"
        ):
            # Canonical completion has already checked assignment/permission
            # and required lesson assessments before it reaches this helper.
            # For a pure trainer-led School enrollment, Ready means advance.
            return False
        return bool(await _await_if_needed(original_gate(enrollment, action)))

    server_module._required_checkpoint_blocks_advancement = checkpoint_gate_with_in_person_trainer_authority
    server_module._in_person_session_progression_installed = True
