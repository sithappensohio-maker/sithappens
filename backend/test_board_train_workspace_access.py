from datetime import date
from types import SimpleNamespace

import pytest

import board_train_workspace_access as mod


class _InsertResult:
    pass


class _Drafts:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, projection=None):
        for row in reversed(self.rows):
            ok = True
            for key, expected in query.items():
                actual = row.get(key)
                if isinstance(expected, dict) and "$in" in expected:
                    if actual not in expected["$in"]:
                        ok = False
                        break
                elif actual != expected:
                    ok = False
                    break
            if ok:
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return _InsertResult()


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
        self.training_session_drafts = _Drafts()


def _booking():
    return {"id": "booking-1", "date": "2026-08-25", "end_date": "2026-08-28"}


def _server(calls):
    async def original_get_draft(enrollment, booking_id, session_label, actor):
        calls.append((booking_id, session_label))
        return {"draft_id": "pm", "session_label": session_label, "status": "completed"}

    return SimpleNamespace(
        _get_or_create_session_draft=original_get_draft,
        business_today=lambda: date(2026, 8, 26),
        now_iso=lambda: "2026-08-26T19:00:00+00:00",
        _gid=lambda: "supp-1",
        _generate_suggested_plan=lambda enrollment: [
            {
                "id": "activity-new",
                "lesson_id": enrollment.get("current_lesson_id"),
                "name": "Calm reward taking",
                "required_curriculum": True,
            }
        ],
    )


@pytest.mark.asyncio
async def test_completed_day_same_lesson_reopens_existing_pm(monkeypatch):
    calls = []
    server = _server(calls)
    db = _DB(_booking())

    async def is_board_train(_db, _booking):
        return True

    async def drafts_for_day(_db, _booking, day, *, enrollment_id=None):
        return [
            {"id": "am", "session_label": "AM", "status": "completed", "plan": {"activities": [{"lesson_id": "lesson-1"}]}},
            {"id": "pm", "session_label": "PM", "status": "completed", "plan": {"activities": [{"lesson_id": "lesson-1"}]}},
        ]

    monkeypatch.setattr(mod, "is_board_train_booking", is_board_train)
    monkeypatch.setattr(mod, "_booking_drafts_for_day", drafts_for_day)

    mod.install_board_train_workspace_access(server_module=server, db=db)
    result = await server._get_or_create_session_draft(
        {"id": "enrollment-1", "current_lesson_id": "lesson-1"},
        "booking-1", "", {"id": "trainer-1"},
    )

    assert result["draft_id"] == "pm"
    assert calls == [("booking-1", "PM")]
    assert db.training_session_drafts.rows == []


@pytest.mark.asyncio
async def test_advanced_school_pointer_opens_current_lesson_supplemental(monkeypatch):
    calls = []
    server = _server(calls)
    db = _DB(_booking())

    async def is_board_train(_db, _booking):
        return True

    async def drafts_for_day(_db, _booking, day, *, enrollment_id=None):
        assert day == "2026-08-26"
        assert enrollment_id == "enrollment-1"
        return [
            {"id": "am", "session_label": "AM", "status": "completed", "plan": {"activities": [{"lesson_id": "name-recognition"}]}},
            {"id": "pm", "session_label": "PM", "status": "completed", "plan": {"activities": [{"lesson_id": "name-recognition"}]}},
        ]

    monkeypatch.setattr(mod, "is_board_train_booking", is_board_train)
    monkeypatch.setattr(mod, "_booking_drafts_for_day", drafts_for_day)

    mod.install_board_train_workspace_access(server_module=server, db=db)
    enrollment = {
        "id": "enrollment-1", "dog_id": "dog-1", "program_id": "program-1",
        "current_lesson_id": "calm-reward-taking",
    }
    result = await server._get_or_create_session_draft(
        enrollment, "booking-1", "", {"id": "trainer-1", "name": "Admin"},
    )

    assert calls == []
    assert result["session_label"] == mod.SUPPLEMENTAL_LABEL
    assert result["school_lesson_id"] == "calm-reward-taking"
    assert result["source_completed_draft_id"] == "pm"
    assert result["plan"]["activities"][0]["lesson_id"] == "calm-reward-taking"
    assert result["plan"]["activities"][0]["name"] == "Calm reward taking"
    assert len(db.training_session_drafts.rows) == 1

    again = await server._get_or_create_session_draft(
        enrollment, "booking-1", "", {"id": "trainer-1", "name": "Admin"},
    )
    assert again["id"] == result["id"]
    assert len(db.training_session_drafts.rows) == 1


@pytest.mark.asyncio
async def test_unfinished_day_still_uses_existing_slot_resolver(monkeypatch):
    calls = []
    server = _server(calls)
    db = _DB(_booking())

    async def is_board_train(_db, _booking):
        return True

    async def drafts_for_day(_db, _booking, day, *, enrollment_id=None):
        return [
            {"id": "am", "session_label": "AM", "status": "completed"},
            {"id": "pm", "session_label": "PM", "status": "draft"},
        ]

    monkeypatch.setattr(mod, "is_board_train_booking", is_board_train)
    monkeypatch.setattr(mod, "_booking_drafts_for_day", drafts_for_day)

    mod.install_board_train_workspace_access(server_module=server, db=db)
    await server._get_or_create_session_draft(
        {"id": "enrollment-1", "current_lesson_id": "lesson-2"},
        "booking-1", "", {"id": "trainer-1"},
    )

    assert calls == [("booking-1", "")]
