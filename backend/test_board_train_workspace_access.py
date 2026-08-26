from datetime import date
from types import SimpleNamespace

import pytest

import board_train_workspace_access as mod


class _Bookings:
    def __init__(self, booking):
        self.booking = booking

    async def find_one(self, query, projection=None):
        if query.get("id") == self.booking.get("id"):
            return dict(self.booking)
        return None


class _DB:
    def __init__(self, booking):
        self.bookings = _Bookings(booking)


@pytest.mark.asyncio
async def test_completed_board_train_day_reopens_existing_pm_workspace(monkeypatch):
    calls = []

    async def original_get_draft(enrollment, booking_id, session_label, actor):
        calls.append((booking_id, session_label))
        return {"draft_id": "pm", "session_label": session_label, "state": "completed"}

    server = SimpleNamespace(
        _get_or_create_session_draft=original_get_draft,
        business_today=lambda: date(2026, 8, 26),
    )
    booking = {
        "id": "booking-1",
        "date": "2026-08-25",
        "end_date": "2026-08-28",
    }
    db = _DB(booking)

    async def is_board_train(_db, _booking):
        return True

    async def drafts_for_day(_db, _booking, day, *, enrollment_id=None):
        assert day == "2026-08-26"
        assert enrollment_id == "enrollment-1"
        return [
            {"draft_id": "am", "session_label": "AM", "state": "completed"},
            {"draft_id": "pm", "session_label": "PM", "state": "completed"},
        ]

    monkeypatch.setattr(mod, "is_board_train_booking", is_board_train)
    monkeypatch.setattr(mod, "_booking_drafts_for_day", drafts_for_day)

    mod.install_board_train_workspace_access(server_module=server, db=db)
    result = await server._get_or_create_session_draft(
        {"id": "enrollment-1"},
        "booking-1",
        "",
        {"id": "trainer-1"},
    )

    assert result["draft_id"] == "pm"
    assert calls == [("booking-1", "PM")]


@pytest.mark.asyncio
async def test_unfinished_board_train_day_still_uses_existing_slot_resolver(monkeypatch):
    calls = []

    async def original_get_draft(enrollment, booking_id, session_label, actor):
        calls.append(session_label)
        return {"session_label": session_label}

    server = SimpleNamespace(
        _get_or_create_session_draft=original_get_draft,
        business_today=lambda: date(2026, 8, 26),
    )
    booking = {
        "id": "booking-1",
        "date": "2026-08-25",
        "end_date": "2026-08-28",
    }
    db = _DB(booking)

    async def is_board_train(_db, _booking):
        return True

    async def drafts_for_day(_db, _booking, day, *, enrollment_id=None):
        return [
            {"draft_id": "am", "session_label": "AM", "state": "completed"},
            {"draft_id": "pm", "session_label": "PM", "state": "draft"},
        ]

    monkeypatch.setattr(mod, "is_board_train_booking", is_board_train)
    monkeypatch.setattr(mod, "_booking_drafts_for_day", drafts_for_day)

    mod.install_board_train_workspace_access(server_module=server, db=db)
    await server._get_or_create_session_draft(
        {"id": "enrollment-1"},
        "booking-1",
        "",
        {"id": "trainer-1"},
    )

    # Blank stays blank so Trainer Delivery still chooses the unfinished PM slot.
    assert calls == [""]
