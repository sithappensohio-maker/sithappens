"""Tests for the first-time client setup checklist (Sprint 110dh-6)."""
import os
import uuid
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


def _admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_client_and_login(suffix="", with_phone=True, with_email=True):
    ah = _admin_headers()
    sfx = (suffix + "_" if suffix else "") + uuid.uuid4().hex[:8]
    email = f"setup_test_{sfx}@example.com" if with_email else ""
    body = {"name": f"Setup Test {sfx}"}
    if with_phone:
        body["phone"] = "555-0000"
    if with_email:
        body["email"] = email
    cr = requests.post(f"{BASE_URL}/api/clients", json=body, headers=ah, timeout=15)
    assert cr.status_code == 200, cr.text
    cid = cr.json()["id"]
    if not with_email:
        # need to make a portal user with some other email so we can log in
        email = f"setup_acc_{sfx}@example.com"
    pwd = "Test1234!"
    pr = requests.post(f"{BASE_URL}/api/clients/{cid}/portal-account",
                       json={"email": email, "password": pwd}, headers=ah, timeout=15)
    assert pr.status_code == 200, pr.text
    lr = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": pwd}, timeout=15)
    return cid, {"Authorization": f"Bearer {lr.json()['token']}"}, ah


def test_setup_status_new_client_has_all_steps_incomplete():
    cid, ch, _ = _make_client_and_login("new")
    r = requests.get(f"{BASE_URL}/api/portal/setup-status", headers=ch, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total_count"] == 6
    assert d["booking_locked"] is True
    assert d["ready_to_book"] is False
    ids = {s["id"] for s in d["steps"]}
    assert ids == {"client_info", "dog_info", "emergency", "vaccines", "waiver", "intake_forms"}
    # client_info should be complete (we provided name/phone/email)
    info = next(s for s in d["steps"] if s["id"] == "client_info")
    assert info["status"] == "complete"
    # everything else (dogs, emerg, vaccines, waiver) should NOT be complete
    for sid in ("dog_info", "emergency", "vaccines", "waiver"):
        s = next(x for x in d["steps"] if x["id"] == sid)
        assert s["status"] != "complete", f"{sid} should not be complete yet"


def test_setup_status_locks_booking_with_incomplete_info():
    _, ch, _ = _make_client_and_login("locked", with_email=False)
    # client created without email → client_info incomplete
    r = requests.get(f"{BASE_URL}/api/portal/setup-status", headers=ch, timeout=15)
    d = r.json()
    info = next(s for s in d["steps"] if s["id"] == "client_info")
    assert info["status"] != "complete"
    assert d["booking_locked"] is True


def test_setup_status_requires_emergency_contact():
    cid, ch, ah = _make_client_and_login("emerg")
    # No emergency contact → step is not_started
    r = requests.get(f"{BASE_URL}/api/portal/setup-status", headers=ch, timeout=15)
    emerg = next(s for s in r.json()["steps"] if s["id"] == "emergency")
    assert emerg["status"] == "not_started"
    # add an emergency contact
    requests.put(f"{BASE_URL}/api/clients/{cid}",
                 json={"name": "Setup Test emerg", "emerg": "Jane Doe — 555-1234 — sister"},
                 headers=ah, timeout=15)
    r2 = requests.get(f"{BASE_URL}/api/portal/setup-status", headers=ch, timeout=15)
    emerg2 = next(s for s in r2.json()["steps"] if s["id"] == "emergency")
    assert emerg2["status"] == "complete"


def test_setup_status_admin_endpoint_returns_badge():
    cid, _, ah = _make_client_and_login("admin")
    r = requests.get(f"{BASE_URL}/api/admin/clients/{cid}/setup-status", headers=ah, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "badge" in d
    assert d["badge"] in ("Ready to Book", "Pending Vaccine Review", "Setup Incomplete")
    assert d["booking_locked"] in (True, False)


def test_setup_status_admin_endpoint_requires_admin():
    _, ch, _ = _make_client_and_login("admin_gate")
    cid = uuid.uuid4().hex   # any id; should 401 regardless
    r = requests.get(f"{BASE_URL}/api/admin/clients/{cid}/setup-status",
                     headers=ch, timeout=15)
    assert r.status_code in (401, 403)


def test_admin_clients_list_includes_setup_badge():
    ah = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/clients", headers=ah, timeout=30)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    # At least one client should have a badge set
    badged = [c for c in rows if c.get("setup_badge")]
    assert len(badged) > 0, "setup_badge decoration missing"
    for c in badged[:5]:
        assert c["setup_badge"] in ("Ready to Book", "Pending Vaccine Review", "Setup Incomplete")
        assert c["setup_overall"] in ("complete", "pending_review", "in_progress", "not_started")


def test_portal_setup_requires_client_auth():
    # Admin user has no client_id → endpoint should 403
    ah = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/portal/setup-status", headers=ah, timeout=15)
    assert r.status_code == 403
