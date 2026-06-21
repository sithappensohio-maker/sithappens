"""Sprint 110di-33 — Help Requests endpoint contract.

Client posts feedback / problem / suggestion / booking-help / other;
admin lists + transitions status (new → reviewed → resolved). No
attachments, no threads, no notifications — just a tiny inbox.
"""
import os
import pytest
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "freightshaker06@gmail.com", "password": "TestPass123"},
                      timeout=15)
    if r.status_code != 200:
        pytest.skip(f"test client login failed: {r.text[:100]}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_client_submits_help_request(client_headers, admin_headers):
    """End-to-end: client posts, admin sees it in list, admin transitions
    status new → reviewed → resolved."""
    body = {"type": "feedback", "subject": "Pytest help request",
            "message": "From the help-requests contract test."}
    r = requests.post(f"{BASE}/api/portal/help-requests",
                      headers={**client_headers, "Content-Type": "application/json"},
                      json=body, timeout=15)
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["status"] == "new"
    assert req["type"] == "feedback"
    assert req["subject"] == "Pytest help request"
    assert req["client_id"]
    rid = req["id"]

    # Admin sees it.
    lst = requests.get(f"{BASE}/api/admin/help-requests",
                       headers=admin_headers, timeout=15).json()
    assert any(i["id"] == rid for i in lst)

    # new → reviewed → resolved
    for status in ("reviewed", "resolved"):
        rr = requests.put(f"{BASE}/api/admin/help-requests/{rid}",
                          headers={**admin_headers, "Content-Type": "application/json"},
                          json={"status": status}, timeout=15)
        assert rr.status_code == 200
        assert rr.json()["status"] == status


def test_help_request_validation(client_headers):
    """Empty subject/message rejected; invalid type rejected."""
    r = requests.post(f"{BASE}/api/portal/help-requests",
                      headers={**client_headers, "Content-Type": "application/json"},
                      json={"type": "feedback", "subject": "", "message": "hi"},
                      timeout=15)
    assert r.status_code == 400
    r2 = requests.post(f"{BASE}/api/portal/help-requests",
                       headers={**client_headers, "Content-Type": "application/json"},
                       json={"type": "nonsense", "subject": "x", "message": "y"},
                       timeout=15)
    assert r2.status_code == 400


def test_help_request_admin_only(client_headers):
    """The admin list endpoint must reject non-admin tokens."""
    r = requests.get(f"{BASE}/api/admin/help-requests",
                     headers=client_headers, timeout=15)
    assert r.status_code in (401, 403)
