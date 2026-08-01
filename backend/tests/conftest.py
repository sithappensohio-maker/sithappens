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


def _rate_limit_collection():
    """Direct Mongo handle to auth_rate_limits, if this run has DB access.

    Only set up when MONGO_URL/DB_NAME are exported (see
    RELEASE_CHECKLIST.md) — falls back to doing nothing so a plain
    single-file `pytest tests/test_x.py` run without those exported still
    works exactly as before.
    """
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        return None
    import pymongo
    return pymongo.MongoClient(mongo_url)[db_name]["auth_rate_limits"]


@pytest.fixture(scope="module", autouse=True)
def _reset_auth_rate_limits():
    """Every file in this suite runs from the same IP (127.0.0.1) against
    the same long-lived server process. _enforce_rate_limit in server.py
    keys its fixed-window limiter by IP — correct, intentional behavior
    for real distinct users, but across ~150 test files sharing one IP it
    trips well before any single file has done anything wrong, producing
    429s that look like test failures. Clearing the rate-limit ledger
    between files (never touching _enforce_rate_limit's logic, limits, or
    window sizes) removes that single-IP artifact without weakening the
    real limiter at all — a production deployment never has this problem
    because real traffic comes from many distinct IPs.
    """
    coll = _rate_limit_collection()
    if coll is not None:
        coll.delete_many({})
    yield


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


@pytest.fixture(scope="session", autouse=True)
def _seed_legacy_named_fixtures():
    """Two specific hardcoded accounts — testclient@sithappens.com/test1234
    (a portal client, ~20 files log in as it directly: test_dog_trivia.py,
    test_multi_date_bookings.py, test_homework_*.py, test_iter15/16/17_*.py,
    etc.) and alex@sithappens.com (an employee, fetched via GET /admin/
    employees by test_owner_csv_exclusion.py / test_owner_self_pay.py to
    exercise the is_owner toggle) — predate this suite's current
    create-your-own-fixture convention. No test creates them; they were
    always expected to already exist. Seed both here, once per session,
    only if missing, through the real account-creation endpoints so they
    end up in exactly the shape production code would create — and
    complete the real forced-password-change flow for the portal client
    (POST /clients/.../portal-account always sets must_change_password,
    same as employee creation) so its test1234 login actually works
    end-to-end, not just at the login call itself.
    """
    r = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    if r.status_code != 200:
        yield
        return
    admin_headers = {"Authorization": f"Bearer {r.json()['token']}"}

    # alex@sithappens.com — employee, admin-only usage, must_change_password
    # is irrelevant since nothing ever logs in as alex.
    emps = requests.get(f"{BASE_URL}/api/admin/employees", headers=admin_headers, timeout=15).json()
    if not any(e.get("email") == "alex@sithappens.com" for e in emps):
        requests.post(f"{BASE_URL}/api/admin/employees", headers=admin_headers, json={
            "name": "Alex Legacy", "email": "alex@sithappens.com",
            "password": "AlexLegacy123!", "hourly_rate": 20.0,
        }, timeout=15)

    # testclient@sithappens.com / test1234 — portal client, must actually
    # be able to log in with this exact password.
    login = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": "testclient@sithappens.com", "password": "test1234"}, timeout=15)
    if login.status_code != 200:
        client = requests.post(f"{BASE_URL}/api/clients", headers=admin_headers, json={
            "name": "Legacy Test Client", "email": "testclient@sithappens.com",
        }, timeout=15).json()
        created = requests.post(
            f"{BASE_URL}/api/clients/{client['id']}/portal-account", headers=admin_headers,
            json={"email": "testclient@sithappens.com", "password": "test1234"}, timeout=15,
        )
        if created.status_code == 200:
            first_login = requests.post(f"{BASE_URL}/api/auth/login",
                                         json={"email": "testclient@sithappens.com", "password": "test1234"}, timeout=15)
            if first_login.status_code == 200:
                requests.post(
                    f"{BASE_URL}/api/auth/change-password",
                    json={"current_password": "test1234", "new_password": "test1234"},
                    headers={"Authorization": f"Bearer {first_login.json()['token']}"}, timeout=15,
                )
        # If created.status_code == 400 ("Email already used"), a client
        # with this exact email already owns the account under a password
        # we don't know — leave it alone rather than guess; the handful of
        # tests relying on it will surface that separately, same as any
        # other real fixture gap.

    # 21 curated trivia questions — test_dog_trivia.py's admin-generate flow
    # falls back to live LLM generation when the library is thin, which
    # needs EMERGENT_LLM_KEY (unavailable in this test environment) and
    # test_backup_coverage.py separately asserts >=21 trivia_questions
    # exist. seed_curated_trivia.py is this repo's own idempotent seed
    # script for exactly this — only run it here (direct DB access) when
    # this run has MONGO_URL/DB_NAME exported (see RELEASE_CHECKLIST.md).
    if os.environ.get("MONGO_URL") and os.environ.get("DB_NAME"):
        import asyncio
        import sys
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        import seed_curated_trivia
        asyncio.run(seed_curated_trivia.seed())
    yield
