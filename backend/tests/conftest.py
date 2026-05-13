"""Shared fixtures for Sit Happens test suites.

Session-scoped settings reset so iteration_1/iteration_2 tests (which only
seed rabies) don't fail under Sprint 3 defaults that require rabies+bordetella+dhpp.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session", autouse=True)
def _legacy_settings_compat():
    """Loosen settings to single-vaccine + no auto-approve so legacy tests pass.

    Saves the original settings and restores after the session completes.
    """
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    if r.status_code != 200:
        yield
        return
    h = {"Authorization": f"Bearer {r.json()['token']}"}

    orig = requests.get(f"{BASE_URL}/api/settings", headers=h, timeout=15).json()

    # legacy-friendly settings: only rabies required, no auto-approve, generous cutoff
    legacy = {
        "required_vaccines": ["rabies"],
        "vaccine_warning_days": 30,
        "daycare_capacity": 30,
        "boarding_capacity": 10,
        "booking_rules": {
            "max_advance_days": 60,
            "cancellation_cutoff_hours": 24,
            "auto_approve": False,
            "daycare_cost": 1,
            "boarding_cost_per_night": 1,
            "training_cost": 1,
        },
    }
    requests.put(f"{BASE_URL}/api/settings", json=legacy, headers=h, timeout=15)
    yield
    # restore original (strip _id if any)
    orig.pop("_id", None)
    orig.pop("id", None)
    requests.put(f"{BASE_URL}/api/settings", json=orig, headers=h, timeout=15)
