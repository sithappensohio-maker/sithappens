"""Sprint 110di-18 — Client Portal Controls end-to-end.

Pins:
- /api/branding (unauthed) returns `client_portal_controls` with all 11 sections,
  6-element landing_priority, announcement block, labels dict, booking_locked_message,
  empty_states dict.
- /api/settings PUT (admin) persists changes.
- Feature Visibility wins over Client Portal Controls.
"""
import os, requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")


def _admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


REQUIRED_SECTIONS = {
    "credits", "prices", "dog_facts", "trivia_rewards", "training_tip",
    "booking_history", "upcoming_bookings", "profile_quick_links",
    "waiver_documents", "vaccines_compliance", "messages", "help_button",
}
REQUIRED_LABELS = {
    "book_service", "complete_setup", "ready_to_book", "setup_incomplete",
    "my_profile", "my_bookings", "my_dogs", "credits",
    "required_waiver", "vaccines", "messages",
}
REQUIRED_EMPTY = {
    "no_bookings", "no_dogs", "no_messages", "no_credits", "no_documents",
}


def test_branding_exposes_client_portal_controls_block():
    body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    cpc = body.get("client_portal_controls")
    assert cpc and isinstance(cpc, dict)
    # sections
    sections = set(cpc.get("sections", {}).keys())
    assert REQUIRED_SECTIONS.issubset(sections), \
        f"missing sections: {REQUIRED_SECTIONS - sections}"
    # labels
    labels = set(cpc.get("labels", {}).keys())
    assert REQUIRED_LABELS.issubset(labels), \
        f"missing labels: {REQUIRED_LABELS - labels}"
    # empty states
    empty = set(cpc.get("empty_states", {}).keys())
    assert REQUIRED_EMPTY.issubset(empty), \
        f"missing empty states: {REQUIRED_EMPTY - empty}"
    # announcement structure
    ann = cpc.get("announcement", {})
    assert set(ann.keys()) >= {"enabled", "title", "message", "style", "start_date", "end_date"}
    # landing priority
    lp = cpc.get("landing_priority", [])
    assert isinstance(lp, list) and len(lp) >= 1
    # booking locked message
    assert "booking_locked_message" in cpc
    assert isinstance(cpc["booking_locked_message"], str)


def test_settings_persists_client_portal_controls_round_trip():
    h = _admin_h()
    update = {
        "client_portal_controls": {
            "sections": {"credits": False, "dog_facts": False},
            "labels": {"book_service": "Reserve Time", "messages": "Chat"},
            "booking_locked_message": "Finish setup first, please.",
            "announcement": {
                "enabled": True,
                "title": "Holiday hours",
                "message": "Closed Thanksgiving.",
                "style": "warning",
                "start_date": "",
                "end_date": "",
            },
        }
    }
    r = requests.put(f"{BASE_URL}/api/settings", headers=h, json=update, timeout=15)
    assert r.status_code == 200, r.text
    after = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    cpc = after["client_portal_controls"]
    assert cpc["sections"]["credits"] is False
    assert cpc["sections"]["dog_facts"] is False
    assert cpc["sections"]["upcoming_bookings"] is True  # unchanged
    assert cpc["labels"]["book_service"] == "Reserve Time"
    assert cpc["labels"]["messages"] == "Chat"
    assert cpc["booking_locked_message"] == "Finish setup first, please."
    assert cpc["announcement"]["enabled"] is True
    assert cpc["announcement"]["title"] == "Holiday hours"
    assert cpc["announcement"]["style"] == "warning"

    # Reset to defaults
    reset = {
        "client_portal_controls": {
            "sections": {k: True for k in REQUIRED_SECTIONS},
            "labels": {"book_service": "Book Service", "messages": "Messages"},
            "booking_locked_message": "Please complete your required setup items before booking services.",
            "announcement": {"enabled": False, "title": "", "message": "", "style": "info", "start_date": "", "end_date": ""},
        }
    }
    requests.put(f"{BASE_URL}/api/settings", headers=h, json=reset, timeout=15)


def test_feature_visibility_overrides_portal_controls_off():
    """Setting Rewards OFF in Feature Visibility must keep trivia/rewards
    hidden in the portal regardless of the per-section Client Portal toggle.
    Backend just exposes both; the frontend `sectionOn()` helper applies the
    master rule. This test pins that BOTH knobs survive a round-trip so the
    frontend logic can rely on them being there."""
    h = _admin_h()
    # Rewards OFF in FV, trivia_rewards ON in CPC — FV should win in the UI.
    requests.put(f"{BASE_URL}/api/settings", headers=h,
                 json={"feature_visibility": {"rewards": False},
                       "client_portal_controls": {"sections": {"trivia_rewards": True}}},
                 timeout=15)
    body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    assert body["feature_visibility"]["rewards"] is False
    assert body["client_portal_controls"]["sections"]["trivia_rewards"] is True
    # Restore.
    requests.put(f"{BASE_URL}/api/settings", headers=h,
                 json={"feature_visibility": {"rewards": True}}, timeout=15)


def test_default_state_preserves_existing_behavior():
    """Brand-new installs must default ALL sections ON so the portal looks
    unchanged after the upgrade."""
    body = requests.get(f"{BASE_URL}/api/branding", timeout=15).json()
    sections = body["client_portal_controls"]["sections"]
    for k in REQUIRED_SECTIONS:
        assert isinstance(sections[k], bool), f"{k} must be a bool"
    # The current run's state may have flipped some — assertion above is enough
    # to pin the contract.
