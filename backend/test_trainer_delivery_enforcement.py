from types import SimpleNamespace

from trainer_delivery_enforcement import (
    daily_status,
    normalize_bt_label,
    required_training_dates,
    session_completion_gaps,
    slots_from_drafts,
)


class _Server:
    @staticmethod
    def _current_lesson_assessment_gaps(enrollment, draft):
        return list(draft.get("_canonical_gaps") or [])


def _body(**kwargs):
    defaults = {
        "send_recap": True,
        "advancement_action": "remain",
        "advancement_reason": "",
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _complete_required_draft():
    return {
        "plan": [{"id": "skill-1", "title": "Place", "required_curriculum": True}],
        "actuals": {
            "skill-1": {
                "score": 4,
                "outcome": "improving",
                "mastery_decision": "not_yet",
            },
        },
        "what_went_well": "Settled quickly after the first repetition.",
        "needs_work": "Duration with movement nearby.",
        "next_lesson_focus": "Build duration before adding distance.",
        "client_recap_note": "Practice the same short duration at home.",
    }


def test_remain_completion_is_not_a_bypass_anymore():
    draft = _complete_required_draft()
    draft["_canonical_gaps"] = ["Place: record an outcome"]
    gaps = session_completion_gaps(_Server, {}, draft, _body())
    assert "Place: record an outcome" in gaps


def test_required_skill_needs_mastery_decision():
    draft = _complete_required_draft()
    draft["actuals"]["skill-1"].pop("mastery_decision")
    gaps = session_completion_gaps(_Server, {}, draft, _body())
    assert any("Confirm Mastered or Not Yet" in gap for gap in gaps)


def test_skipped_required_skill_needs_reason_but_not_mastery():
    draft = _complete_required_draft()
    draft["actuals"]["skill-1"] = {"outcome": "skipped"}
    gaps = session_completion_gaps(_Server, {}, draft, _body())
    assert any("reason for skipping" in gap for gap in gaps)
    assert not any("Confirm Mastered or Not Yet" in gap for gap in gaps)


def test_structured_recap_is_required_but_normal_remain_reason_is_not():
    draft = _complete_required_draft()
    draft["what_went_well"] = ""
    draft["needs_work"] = ""
    draft["next_lesson_focus"] = ""
    draft["client_recap_note"] = ""
    gaps = session_completion_gaps(_Server, {}, draft, _body(advancement_reason=""))
    assert "Add What Went Well" in gaps
    assert "Add Needs Work" in gaps
    assert "Add Next Session Focus" in gaps
    assert any("client recap" in gap.lower() for gap in gaps)
    assert not any("progression decision" in gap.lower() for gap in gaps)


def test_valid_required_record_can_complete_remain_without_hidden_reason_field():
    gaps = session_completion_gaps(
        _Server,
        {},
        _complete_required_draft(),
        _body(advancement_reason=""),
    )
    assert gaps == []


def test_board_train_required_dates_exclude_pickup_day():
    booking = {"date": "2026-08-01", "end_date": "2026-08-08"}
    days = required_training_dates(booking)
    assert len(days) == 7
    assert days[0] == "2026-08-01"
    assert days[-1] == "2026-08-07"


def test_legacy_blank_label_is_am_and_pm_remains_independent():
    drafts = [
        {
            "draft_id": "legacy-am",
            "session_label": "",
            "state": "completed",
            "completed_at": "2026-08-01T12:00:00Z",
        },
        {
            "draft_id": "pm",
            "session_label": "PM",
            "state": "draft",
            "started_at": "2026-08-01T18:00:00Z",
        },
    ]
    slots = slots_from_drafts(drafts)
    assert slots["AM"]["draft_id"] == "legacy-am"
    assert slots["PM"]["draft_id"] == "pm"
    status = daily_status({}, "2026-08-01", drafts)
    assert status["slots"]["AM"]["status"] == "completed"
    assert status["slots"]["PM"]["status"] == "in_progress"
    assert status["state"] == "pm_due"


def test_daily_closeout_requires_both_sessions_to_still_be_complete():
    booking = {
        "training_daily_closeouts": {
            "2026-08-01": {
                "status": "closed",
                "closed_at": "2026-08-01T20:00:00Z",
            },
        },
    }
    both = [
        {"draft_id": "am", "session_label": "AM", "state": "completed"},
        {"draft_id": "pm", "session_label": "PM", "state": "completed"},
    ]
    assert daily_status(booking, "2026-08-01", both)["state"] == "day_complete"

    reopened = [
        {"draft_id": "am", "session_label": "AM", "state": "completed"},
        {
            "draft_id": "pm",
            "session_label": "PM",
            "state": "draft",
            "started_at": "x",
        },
    ]
    status = daily_status(booking, "2026-08-01", reopened)
    assert status["closeout_complete"] is False
    assert status["state"] == "pm_due"


def test_label_normalization_accepts_explicit_am_pm():
    assert normalize_bt_label("am") == "AM"
    assert normalize_bt_label("P.M.") == "PM"
