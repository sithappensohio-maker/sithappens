"""Sprint 110di-4 — Announcements (admin CRUD + portal read tracking) +
admin-editable First Visit content.
"""
import os
import uuid
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


def _make_portal_client():
    h = _admin_h()
    cli = requests.post(f"{BASE_URL}/api/clients",
                        json={"name": f"Ann {uuid.uuid4().hex[:6]}"}, headers=h, timeout=15)
    assert cli.status_code == 200, cli.text
    cid = cli.json()["id"]
    email = f"ann_{uuid.uuid4().hex[:6]}@example.com"
    pwd = "test1234"
    pa = requests.post(f"{BASE_URL}/api/clients/{cid}/portal-account",
                       json={"email": email, "password": pwd}, headers=h, timeout=15)
    assert pa.status_code == 200, pa.text
    return {"client_id": cid, "token": _login(email, pwd)}


def test_admin_announcement_crud_and_portal_read_flow():
    h_admin = _admin_h()

    # CREATE
    body = {
        "title": f"Pytest broadcast {uuid.uuid4().hex[:6]}",
        "body": "Multi-line\nbody works here.",
        "pinned": True,
        "expires_on": "",
    }
    r = requests.post(f"{BASE_URL}/api/admin/announcements", json=body, headers=h_admin, timeout=15)
    assert r.status_code == 200, r.text
    created = r.json()
    aid = created["id"]
    assert created["title"] == body["title"]
    assert created["pinned"] is True

    # LIST (admin)
    r = requests.get(f"{BASE_URL}/api/admin/announcements", headers=h_admin, timeout=15)
    assert r.status_code == 200
    assert any(a["id"] == aid for a in r.json()), "newly created announcement missing from admin list"

    # PORTAL — unread for fresh client
    ctx = _make_portal_client()
    h_client = {"Authorization": f"Bearer {ctx['token']}"}
    r = requests.get(f"{BASE_URL}/api/portal/announcements", headers=h_client, timeout=15)
    assert r.status_code == 200
    items = r.json()["items"]
    mine = next((a for a in items if a["id"] == aid), None)
    assert mine, "portal didn't see the announcement"
    assert mine["read"] is False
    assert r.json()["unread"] >= 1

    # MARK READ
    r = requests.post(f"{BASE_URL}/api/portal/announcements/{aid}/read", headers=h_client, timeout=15)
    assert r.status_code == 200, r.text

    r = requests.get(f"{BASE_URL}/api/portal/announcements", headers=h_client, timeout=15)
    mine = next(a for a in r.json()["items"] if a["id"] == aid)
    assert mine["read"] is True

    # UPDATE
    r = requests.put(f"{BASE_URL}/api/admin/announcements/{aid}",
                     json={**body, "title": body["title"] + " (edited)", "pinned": False},
                     headers=h_admin, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["title"].endswith("(edited)")
    assert r.json()["pinned"] is False

    # DELETE
    r = requests.delete(f"{BASE_URL}/api/admin/announcements/{aid}", headers=h_admin, timeout=15)
    assert r.status_code == 200, r.text

    # PORTAL no longer sees it
    r = requests.get(f"{BASE_URL}/api/portal/announcements", headers=h_client, timeout=15)
    assert all(a["id"] != aid for a in r.json()["items"])


def test_announcement_expiry_hides_from_portal():
    h_admin = _admin_h()
    # Create expired announcement
    r = requests.post(f"{BASE_URL}/api/admin/announcements",
                      json={"title": "expired " + uuid.uuid4().hex[:6],
                            "body": "should be hidden",
                            "expires_on": "2020-01-01"},
                      headers=h_admin, timeout=15)
    aid = r.json()["id"]
    try:
        ctx = _make_portal_client()
        h_client = {"Authorization": f"Bearer {ctx['token']}"}
        r = requests.get(f"{BASE_URL}/api/portal/announcements", headers=h_client, timeout=15)
        assert all(a["id"] != aid for a in r.json()["items"]), "expired announcement leaked to portal"
    finally:
        requests.delete(f"{BASE_URL}/api/admin/announcements/{aid}", headers=h_admin, timeout=15)


def test_announcement_unpublished_hidden_but_admin_sees_it():
    h_admin = _admin_h()
    r = requests.post(f"{BASE_URL}/api/admin/announcements",
                      json={"title": "hidden " + uuid.uuid4().hex[:6],
                            "body": "draft", "published": False},
                      headers=h_admin, timeout=15)
    aid = r.json()["id"]
    try:
        # admin still sees it
        admin_list = requests.get(f"{BASE_URL}/api/admin/announcements", headers=h_admin, timeout=15).json()
        assert any(a["id"] == aid for a in admin_list)
        # client does NOT
        ctx = _make_portal_client()
        h_client = {"Authorization": f"Bearer {ctx['token']}"}
        r = requests.get(f"{BASE_URL}/api/portal/announcements", headers=h_client, timeout=15)
        assert all(a["id"] != aid for a in r.json()["items"])
    finally:
        requests.delete(f"{BASE_URL}/api/admin/announcements/{aid}", headers=h_admin, timeout=15)


def test_create_announcement_returns_email_broadcast_summary():
    """Posting a published announcement should return an `email_broadcast`
    summary with a `queued` recipient count so the admin UI can show feedback
    immediately. The actual send happens in a background task (so we don't
    block on Resend)."""
    h_admin = _admin_h()
    r = requests.post(f"{BASE_URL}/api/admin/announcements",
                      json={"title": f"broadcast {uuid.uuid4().hex[:6]}",
                            "body": "auto-broadcast test", "published": True},
                      headers=h_admin, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    aid = body["id"]
    try:
        assert "email_broadcast" in body
        eb = body["email_broadcast"]
        assert isinstance(eb, dict)
        # Published posts always include a `queued` count (could be 0 if no
        # clients have email yet — still expected to be numeric).
        assert "queued" in eb
        assert isinstance(eb["queued"], int)
    finally:
        requests.delete(f"{BASE_URL}/api/admin/announcements/{aid}", headers=h_admin, timeout=15)


def test_draft_announcement_does_not_broadcast():
    h_admin = _admin_h()
    r = requests.post(f"{BASE_URL}/api/admin/announcements",
                      json={"title": f"draft {uuid.uuid4().hex[:6]}",
                            "body": "silent draft", "published": False},
                      headers=h_admin, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    aid = body["id"]
    try:
        # Drafts get an empty broadcast summary — no `queued` key.
        eb = body.get("email_broadcast") or {}
        assert "queued" not in eb, f"draft accidentally queued emails: {eb}"
    finally:
        requests.delete(f"{BASE_URL}/api/admin/announcements/{aid}", headers=h_admin, timeout=15)


def test_edit_announcement_does_not_rebroadcast():
    h_admin = _admin_h()
    create = requests.post(f"{BASE_URL}/api/admin/announcements",
                           json={"title": f"edit-test {uuid.uuid4().hex[:6]}",
                                 "body": "original"},
                           headers=h_admin, timeout=20)
    aid = create.json()["id"]
    try:
        updated = requests.put(f"{BASE_URL}/api/admin/announcements/{aid}",
                               json={"title": "edited title",
                                     "body": "fixed a typo"},
                               headers=h_admin, timeout=15)
        assert updated.status_code == 200
        # PUT response should NOT contain `email_broadcast` (edits stay silent).
        assert "email_broadcast" not in updated.json()
    finally:
        requests.delete(f"{BASE_URL}/api/admin/announcements/{aid}", headers=h_admin, timeout=15)


def test_settings_persists_portal_first_visit_content():
    h_admin = _admin_h()
    # Save custom content
    body = {
        "portal_first_visit": {
            "enabled": True,
            "heading": "Welcome to Pytest Studio",
            "footer": "Bark at us anytime.",
            "bullets": [
                {"title": "Step one", "body": "do the thing."},
                {"title": "Step two", "body": "do the other thing."},
                {"title": "Step three", "body": "celebrate."},
                {"title": "Step four", "body": "go home a champion."},
            ],
        }
    }
    r = requests.put(f"{BASE_URL}/api/settings", json=body, headers=h_admin, timeout=15)
    assert r.status_code == 200, r.text

    # Fetch via /settings/public as a portal client and verify it shows up
    ctx = _make_portal_client()
    h_client = {"Authorization": f"Bearer {ctx['token']}"}
    r = requests.get(f"{BASE_URL}/api/settings/public", headers=h_client, timeout=15)
    assert r.status_code == 200
    fv = r.json().get("portal_first_visit")
    assert fv is not None
    assert fv["heading"] == "Welcome to Pytest Studio"
    assert len(fv["bullets"]) == 4
    assert fv["bullets"][2]["title"] == "Step three"
