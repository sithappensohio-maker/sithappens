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


def _fake_server_for_install():
    from datetime import date
    from fastapi import Depends, FastAPI
    from types import SimpleNamespace

    app = FastAPI()

    async def today_dep():
        return {"id": "trainer"}

    @app.get("/api/admin/training/today")
    async def training_today(user=Depends(today_dep)):
        return []

    calls = []

    async def original_compute(enrollment, draft, draft_id, body, user):
        calls.append((draft_id, body.advancement_action))
        return {"log_doc": {"id": "log-1"}, "completed_by": user.get("id")}

    async def original_get_draft(enrollment, booking_id, session_label, actor):
        return {"session_label": session_label}

    async def original_worker(draft_id, plan, claim_token):
        return {"ok": True}

    async def original_checkout(booking_id, body=None, user=None, create_invoice=True):
        return {"checked_out": True}

    def permission_factory(name):
        async def dep():
            return {"id": "trainer"}
        return dep

    server = SimpleNamespace(
        app=app,
        _compute_completion_plan=original_compute,
        _get_or_create_session_draft=original_get_draft,
        _run_completion_worker=original_worker,
        _check_out_locked=original_checkout,
        _current_lesson_assessment_gaps=_Server._current_lesson_assessment_gaps,
        require_admin_and_permission=permission_factory,
        business_today=lambda: date(2026, 8, 26),
    )
    return server, calls


class _NoopCollection:
    async def find_one(self, *args, **kwargs):
        return None

    def find(self, *args, **kwargs):
        return self

    async def to_list(self, *args, **kwargs):
        return []


class _NoopDB:
    def __init__(self):
        self.bookings = _NoopCollection()
        self.training_session_drafts = _NoopCollection()
        self.services = _NoopCollection()


def test_install_preserves_existing_today_dependency_graph():
    import trainer_delivery_enforcement as mod

    server, _ = _fake_server_for_install()
    route = next(
        r
        for r in server.app.routes
        if getattr(r, "path", None) == "/api/admin/training/today"
    )
    before = [d.call for d in route.dependant.dependencies]
    mod.install_trainer_delivery_enforcement(server_module=server, db=_NoopDB())
    after = [d.call for d in route.dependant.dependencies]
    assert before == after
    assert getattr(server, "_trainer_delivery_enforcement_installed") is True


import pytest


@pytest.mark.asyncio
async def test_installed_completion_wrapper_blocks_bad_remain_and_marks_good_log():
    import trainer_delivery_enforcement as mod
    from fastapi import HTTPException

    server, calls = _fake_server_for_install()
    mod.install_trainer_delivery_enforcement(server_module=server, db=_NoopDB())

    bad = _complete_required_draft()
    bad["actuals"]["skill-1"].pop("mastery_decision")
    with pytest.raises(HTTPException) as exc:
        await server._compute_completion_plan(
            {},
            bad,
            "draft-bad",
            _body(),
            {"id": "trainer"},
        )
    assert exc.value.status_code == 409
    assert "Confirm Mastered or Not Yet" in exc.value.detail["msg"]
    assert calls == []

    good = await server._compute_completion_plan(
        {},
        _complete_required_draft(),
        "draft-good",
        _body(),
        {"id": "trainer"},
    )
    assert calls == [("draft-good", "remain")]
    assert good["trainer_delivery_rule_version"] == 1
    assert good["log_doc"]["completion_requirements_verified"] is True


@pytest.mark.asyncio
async def test_board_train_overdue_uses_business_day_not_host_utc_date():
    import trainer_delivery_enforcement as mod

    readiness = await mod.board_train_readiness(
        _NoopDB(),
        {"id": "b1", "date": "2026-08-25", "end_date": "2026-08-27"},
        through="2026-08-26",
        business_day="2026-08-26",
    )
    assert [x["date"] for x in readiness["incomplete_days"]] == [
        "2026-08-25",
        "2026-08-26",
    ]
    assert [x["date"] for x in readiness["overdue_days"]] == ["2026-08-25"]
