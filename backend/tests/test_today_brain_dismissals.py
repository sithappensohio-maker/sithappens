"""Sprint 109b — Today's Tasks dismissals.

Covers:
  - POST /admin/today-brain/dismiss hides a single item until its signature changes
  - POST /admin/today-brain/clear-all hides every currently-visible item
  - POST /admin/today-brain/restore brings one back
  - Admin-only on all three endpoints
  - Signature-mismatch reappearance (the whole point of having a signature)
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
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def fresh_dismissals(admin_headers):
    """Restore every currently-dismissed item before AND after the test, so
    tests are isolated and the admin's real UI state isn't affected."""
    snapshot = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15).json()
    # Best-effort cleanup of any leftover dismissals from a previous failed run.
    for it in snapshot.get("items", []):
        requests.post(f"{BASE}/api/admin/today-brain/restore", headers=admin_headers,
                      json={"item_id": it["id"]}, timeout=15)
    yield
    # Tear-down: undo any dismissals THIS test created.
    after = requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15).json()
    after_ids = {it["id"] for it in after.get("items", [])}
    before_ids = {it["id"] for it in snapshot.get("items", [])}
    for hidden in before_ids - after_ids:
        requests.post(f"{BASE}/api/admin/today-brain/restore", headers=admin_headers,
                      json={"item_id": hidden}, timeout=15)


def _items(admin_headers):
    return requests.get(f"{BASE}/api/admin/today-brain", headers=admin_headers, timeout=15).json()


def test_signature_present_on_every_item(admin_headers):
    """Every today-brain item must expose a `signature` field so the
    frontend can echo it back on dismiss."""
    d = _items(admin_headers)
    if not d.get("items"):
        pytest.skip("today-brain is empty in this env; nothing to fingerprint")
    for it in d["items"]:
        assert "signature" in it and it["signature"], f"item missing signature: {it}"


def test_dismiss_single_item_hides_it(admin_headers, fresh_dismissals):
    before = _items(admin_headers)
    if not before["items"]:
        pytest.skip("nothing on the queue to dismiss")
    target = before["items"][0]
    r = requests.post(f"{BASE}/api/admin/today-brain/dismiss", headers=admin_headers,
                      json={"item_id": target["id"], "signature": target["signature"]}, timeout=15)
    assert r.status_code == 200, r.text
    after = _items(admin_headers)
    after_ids = {it["id"] for it in after["items"]}
    assert target["id"] not in after_ids, f"item {target['id']} still visible after dismiss"
    assert after["counts"]["total"] == before["counts"]["total"] - 1


def test_dismiss_with_stale_signature_still_shows_item(admin_headers, fresh_dismissals):
    """Dismissing with the WRONG signature should NOT hide the item — that's
    the whole point of the signature gate."""
    before = _items(admin_headers)
    if not before["items"]:
        pytest.skip("nothing on the queue to dismiss")
    target = before["items"][0]
    requests.post(f"{BASE}/api/admin/today-brain/dismiss", headers=admin_headers,
                  json={"item_id": target["id"], "signature": "totally-stale-signature-12345"}, timeout=15)
    after = _items(admin_headers)
    after_ids = {it["id"] for it in after["items"]}
    assert target["id"] in after_ids, "item disappeared despite stale dismissal signature"


def test_restore_brings_item_back(admin_headers, fresh_dismissals):
    before = _items(admin_headers)
    if not before["items"]:
        pytest.skip("nothing on the queue to dismiss")
    target = before["items"][0]
    requests.post(f"{BASE}/api/admin/today-brain/dismiss", headers=admin_headers,
                  json={"item_id": target["id"], "signature": target["signature"]}, timeout=15)
    assert target["id"] not in {it["id"] for it in _items(admin_headers)["items"]}
    r = requests.post(f"{BASE}/api/admin/today-brain/restore", headers=admin_headers,
                      json={"item_id": target["id"]}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["removed"] >= 1
    assert target["id"] in {it["id"] for it in _items(admin_headers)["items"]}


def test_clear_all_dismisses_everything_then_recompute_is_empty(admin_headers, fresh_dismissals):
    before = _items(admin_headers)
    if not before["items"]:
        pytest.skip("nothing on the queue to clear")
    initial_total = before["counts"]["total"]
    r = requests.post(f"{BASE}/api/admin/today-brain/clear-all", headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["dismissed"] == initial_total
    after = _items(admin_headers)
    assert after["counts"]["total"] == 0


def test_dismiss_endpoints_admin_only():
    """All three dismissal endpoints must reject non-admins."""
    paths = [
        ("POST", "/api/admin/today-brain/dismiss", {"item_id": "x", "signature": "y"}),
        ("POST", "/api/admin/today-brain/clear-all", None),
        ("POST", "/api/admin/today-brain/restore", {"item_id": "x"}),
    ]
    for method, path, body in paths:
        r = requests.request(method, f"{BASE}{path}", json=body, timeout=10)
        assert r.status_code in (401, 403), f"{method} {path} got {r.status_code}, expected 401/403"
