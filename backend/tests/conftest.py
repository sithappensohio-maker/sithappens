"""Shared fixtures for Sit Happens test suites.

Session-scoped settings reset so iteration_1/iteration_2 tests (which only
seed rabies) don't fail under Sprint 3 defaults that require rabies+bordetella+dhpp.
"""
import os
import requests
import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Safe bulk-cleanup guard.
#
# Added after an incident: a cleanup script called GET /bookings?dog_id=X
# assuming that filter existed. It doesn't (FastAPI silently drops unknown
# query params), so the call returned the endpoint's default ~3000-row
# window, and the script looped over all of it calling DELETE on each row —
# bulk-cancelling ~1150 unrelated bookings in the shared test database.
#
# Use this for ANY test-cleanup loop that deletes/cancels more than a
# single known-by-ID record. It refuses to proceed unless the caller
# explicitly names how many records they expect to touch, and hard-caps
# accidental blast radius even when the caller's expectation is wrong.
# ─────────────────────────────────────────────────────────────────────────────
class BulkCleanupAborted(Exception):
    pass


def safe_bulk_cleanup(ids, expected_count=None, max_allowed=20, label="records"):
    """Guard rails around a bulk cleanup loop's ID list.

    - `ids` must be an explicit list of IDs the caller already verified
      (e.g. IDs it collected itself while creating fixtures) — never IDs
      pulled from an unfiltered/unverified list endpoint.
    - If `expected_count` is given, the ID list must match EXACTLY (e.g. a
      cleanup that should remove exactly one booking refuses to run against
      3 or 3000).
    - Regardless, aborts if `len(ids) > max_allowed` — a small default so a
      mistaken filter can't silently escalate into a bulk incident.
    - Always prints the count and a sample of IDs before the caller
      proceeds to mutate anything, so a run's console output shows the
      blast radius even when nobody's watching closely.
    """
    n = len(ids)
    sample = ids[:5]
    print(f"[safe_bulk_cleanup] about to touch {n} {label}; sample IDs: {sample}")
    if expected_count is not None and n != expected_count:
        raise BulkCleanupAborted(
            f"Expected exactly {expected_count} {label} to clean up, got {n}. "
            f"Refusing to proceed — this usually means the filter used to "
            f"collect `ids` didn't actually filter. Sample IDs: {sample}"
        )
    if n > max_allowed:
        raise BulkCleanupAborted(
            f"Refusing to bulk-clean {n} {label} (max_allowed={max_allowed}). "
            f"If this is genuinely expected, pass a higher max_allowed explicitly. "
            f"Sample IDs: {sample}"
        )
    return ids

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
