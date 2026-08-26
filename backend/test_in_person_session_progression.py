from types import SimpleNamespace

import pytest

import in_person_session_progression as mod


@pytest.mark.asyncio
async def test_in_person_ready_bypasses_checkpoint_gate_only():
    calls = []

    async def original_gate(enrollment, action):
        calls.append((enrollment.get("delivery_channel"), action))
        return True

    server = SimpleNamespace(_required_checkpoint_blocks_advancement=original_gate)
    mod.install_in_person_session_progression(server_module=server)

    blocked = await server._required_checkpoint_blocks_advancement(
        {"id": "enr-1", "delivery_channel": "in_person_school"},
        "advance_next",
    )

    assert blocked is False
    assert calls == [], "pure In-Person Ready must not invoke the Online/Hybrid checkpoint gate"


@pytest.mark.asyncio
async def test_hybrid_ready_remains_checkpoint_gated():
    calls = []

    async def original_gate(enrollment, action):
        calls.append((enrollment.get("delivery_channel"), action))
        return True

    server = SimpleNamespace(_required_checkpoint_blocks_advancement=original_gate)
    mod.install_in_person_session_progression(server_module=server)

    blocked = await server._required_checkpoint_blocks_advancement(
        {"id": "enr-2", "delivery_channel": "hybrid_school"},
        "advance_next",
    )

    assert blocked is True
    assert calls == [("hybrid_school", "advance_next")]


@pytest.mark.asyncio
async def test_other_in_person_advancement_actions_keep_existing_gate_behavior():
    calls = []

    async def original_gate(enrollment, action):
        calls.append(action)
        return True

    server = SimpleNamespace(_required_checkpoint_blocks_advancement=original_gate)
    mod.install_in_person_session_progression(server_module=server)

    blocked = await server._required_checkpoint_blocks_advancement(
        {"id": "enr-3", "delivery_channel": "in_person_school"},
        "advance_module",
    )

    assert blocked is True
    assert calls == ["advance_module"]


def test_installer_is_idempotent():
    async def original_gate(enrollment, action):
        return True

    server = SimpleNamespace(_required_checkpoint_blocks_advancement=original_gate)
    mod.install_in_person_session_progression(server_module=server)
    first = server._required_checkpoint_blocks_advancement
    mod.install_in_person_session_progression(server_module=server)

    assert server._required_checkpoint_blocks_advancement is first
