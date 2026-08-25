"""Small contract tests for Trainer Delivery recovery + client messaging."""
import inspect

from trainer_delivery import _trainer_policy, install_trainer_delivery, validate_trainer_session


def _bt_policy():
    return _trainer_policy({
        "delivery_channel": "in_person_school",
        "program_snapshot": {"type": "board_train", "name": "Board & Train"},
    })


def test_am_recovery_uses_documented_skip_reasons_without_fake_scores():
    draft = {
        "status": "draft",
        "session_label": "bt:2026-08-25:am",
        "plan": {"activities": [
            {"id": "sit", "name": "Sit", "skipped": True, "skip_reason": "GI upset — rest and enrichment only"},
            {"id": "heel", "name": "Heel", "skipped": True, "skip_reason": "GI upset — rest and enrichment only"},
        ]},
        "actuals": {},
    }
    result = validate_trainer_session(draft, {"advancement_action": "remain"}, _bt_policy())
    assert result == {"ok": True, "missing": [], "excused": True}


def test_pm_recovery_still_requires_owner_daily_update():
    draft = {
        "status": "draft",
        "session_label": "bt:2026-08-25:pm",
        "plan": {"activities": [
            {"id": "place", "name": "Place", "skipped": True, "skip_reason": "Rest period after veterinary concern"},
        ]},
        "actuals": {},
    }
    blocked = validate_trainer_session(draft, {"advancement_action": "remain"}, _bt_policy())
    assert blocked["ok"] is False
    assert "Write the client recap/update" in blocked["missing"]

    draft["client_recap_note"] = "Bella rested this afternoon. We monitored her closely and will reassess training tomorrow."
    accepted = validate_trainer_session(draft, {"advancement_action": "remain"}, _bt_policy())
    assert accepted == {"ok": True, "missing": [], "excused": True}


def test_board_train_completion_suppresses_legacy_session_recap_email():
    source = inspect.getsource(install_trainer_delivery)
    assert 'completion["send_recap"] = False' in source
    assert "one dedicated DAILY client update" in source
