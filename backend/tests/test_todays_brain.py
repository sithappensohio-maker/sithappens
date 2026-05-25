"""Sprint 102 — Today's Brain unified action queue.

Verifies that GET /api/admin/today-brain returns a structured list of
prioritized items, and that the major kinds (vaccines, pending bookings,
low credits, monday digest) surface correctly.
"""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_today_brain_shape(admin_headers):
    """Endpoint returns {items[], counts{urgent,warn,info,total}, generated_at}."""
    r = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict)
    assert "items" in body and isinstance(body["items"], list)
    assert "counts" in body and isinstance(body["counts"], dict)
    for k in ["urgent", "warn", "info", "total"]:
        assert k in body["counts"], f"missing count key: {k}"
    assert "generated_at" in body
    # Counts add up
    assert body["counts"]["urgent"] + body["counts"]["warn"] + body["counts"]["info"] == body["counts"]["total"]


def test_today_brain_items_have_required_fields(admin_headers):
    """Every item has id/kind/priority/title/cta — used by the frontend."""
    r = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15)
    body = r.json()
    for it in body["items"]:
        assert "id" in it and it["id"]
        assert "kind" in it and it["kind"]
        assert "priority" in it and it["priority"] in ("urgent", "warn", "info")
        assert "title" in it and it["title"]
        assert "cta" in it and isinstance(it["cta"], dict)
        # cta.type is required so the frontend knows what to do
        assert it["cta"].get("type"), f"item {it['id']} has no cta.type"


def test_today_brain_sorted_by_priority(admin_headers):
    """Items must be sorted urgent → warn → info so the user sees urgent first."""
    r = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15)
    items = r.json()["items"]
    if len(items) < 2:
        pytest.skip("need at least 2 items to verify sort")
    order = {"urgent": 0, "warn": 1, "info": 2}
    prios = [order[it["priority"]] for it in items]
    assert prios == sorted(prios), f"items not priority-sorted: {prios}"


def test_today_brain_admin_only():
    """Endpoint must reject unauthenticated callers."""
    r = requests.get(f"{BASE}/api/admin/today-brain", timeout=15)
    assert r.status_code in (401, 403)


def test_today_brain_employee_blocked():
    """Employees should NOT see this — it includes financial data (low credits) and
    surfaces business decisions only the admin should make."""
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "alex@sithappens.com", "password": "emp1234"}, timeout=15)
    if r.status_code != 200:
        pytest.skip("employee login unavailable")
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    r = requests.get(f"{BASE}/api/admin/today-brain", headers=h, timeout=15)
    assert r.status_code in (401, 403)


def test_today_brain_pending_booking_surfaces(admin_headers):
    """When there's a pending booking, a booking_pending item should appear."""
    r = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15)
    body = r.json()
    pending_total = requests.get(f"{BASE}/api/bookings", headers=admin_headers, timeout=15).json()
    has_pending = any(b.get("status") == "pending" for b in pending_total)
    if has_pending:
        kinds = [it["kind"] for it in body["items"]]
        assert "booking_pending" in kinds, f"expected booking_pending in items · kinds={kinds}"


def test_today_brain_vaccine_alerts_surface(admin_headers):
    """If there's at least one vaccine alert via the dedicated endpoint, the
    brain should also include at least one vaccine_* item."""
    vax = requests.get(f"{BASE}/api/vaccine-alerts", headers=admin_headers, timeout=15).json()
    if not vax:
        pytest.skip("no vaccine alerts to compare against")
    body = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15).json()
    kinds = [it["kind"] for it in body["items"]]
    assert any(k.startswith("vaccine_") for k in kinds), f"vaccine items missing · kinds={kinds}"
