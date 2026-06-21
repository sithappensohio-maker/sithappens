"""Shared fixtures for Sit Happens test suites.

Session-scoped settings reset so iteration_1/iteration_2 tests (which only
seed rabies) don't fail under Sprint 3 defaults that require rabies+bordetella+dhpp.
"""
import os
import requests
import pytest

# Sprint 110di-46 — Tests default to localhost (never the prod/staging
# preview) so an accidental `pytest` run can't mutate the live deployment.
# Override with TEST_BACKEND_URL when targeting another host.
BASE_URL = (
    os.environ.get("TEST_BACKEND_URL")
    or os.environ.get("API_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")
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

    # legacy-friendly settings: only rabies required, no auto-approve, generous cutoff,
    # waiver gating disabled so iter1/iter2/iter3 client-booking tests still pass.
    legacy = {
        "required_vaccines": ["rabies"],
        "vaccine_warning_days": 30,
        "daycare_capacity": 30,
        "boarding_capacity": 10,
        "waiver_required_for_booking": False,
        "waiver_version": 1,
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
