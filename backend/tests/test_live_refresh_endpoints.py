"""Sprint 110ao — smoke test that the live-refresh endpoints used by the
admin Dashboard and Bookings screen continue to work and return list-shaped
JSON (the front-end polls these every 30 s). Doesn't test the UI itself."""
import os

import pytest
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.mark.parametrize("path", [
    "/dashboard/stats",
    "/bookings",
    "/admin/quote-requests?status=open",
    "/admin/vaccine-cert-uploads",
    "/admin/today-pnl",
])
def test_live_refresh_endpoints_respond(admin_headers, path):
    r = requests.get(f"{BASE}/api{path}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, f"{path} returned {r.status_code}: {r.text[:200]}"
    # Each endpoint must return JSON (dict or list, never empty 204) since the
    # front-end's toast-detection uses `.map()` / dict-key lookups.
    body = r.json()
    assert body is None or isinstance(body, (list, dict)), f"unexpected payload shape for {path}: {type(body)}"


def test_dashboard_stats_shape_supports_new_arrival_detection(admin_headers):
    """The dashboard live-refresh diffs by booking id, so the response must
    carry an id per booking row in `bookings_today` / `checked_in` /
    `pending_approval`."""
    r = requests.get(f"{BASE}/api/dashboard/stats", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for key in ("bookings_today", "checked_in", "pending_approval"):
        rows = d.get(key) or []
        assert isinstance(rows, list)
        # Every row must have an id so the diff doesn't false-positive on
        # rows that happen to look identical otherwise.
        for row in rows:
            assert row.get("id"), f"row in {key} missing id: {row}"
