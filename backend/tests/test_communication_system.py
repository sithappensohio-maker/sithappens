"""Tests for the communication system update (Sprint 110dh).
Covers: bulk email recipients/templates/send/history + client↔admin messaging."""
import os
import uuid
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


def _admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_client_and_login(suffix=""):
    """Create a client + portal user, return (client_id, headers)."""
    ah = _admin_headers()
    sfx = (suffix + "_" if suffix else "") + uuid.uuid4().hex[:8]
    email = f"comm_test_{sfx}@example.com"
    cr = requests.post(f"{BASE_URL}/api/clients",
                       json={"name": f"Comm Test {sfx}", "email": email, "phone": "555-0000"},
                       headers=ah, timeout=15)
    assert cr.status_code == 200, cr.text
    cid = cr.json()["id"]
    pwd = "Test1234!"
    pr = requests.post(f"{BASE_URL}/api/clients/{cid}/portal-account",
                       json={"email": email, "password": pwd}, headers=ah, timeout=15)
    assert pr.status_code == 200, pr.text
    lr = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": pwd}, timeout=15)
    assert lr.status_code == 200, lr.text
    return cid, {"Authorization": f"Bearer {lr.json()['token']}"}


# ---------- Bulk Email ----------
def test_bulk_email_filters_endpoint():
    h = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/admin/bulk-email/filters", headers=h, timeout=15)
    assert r.status_code == 200
    ids = {f["id"] for f in r.json()["available"]}
    for k in ("active", "daycare", "boarding", "training",
              "upcoming_bookings", "missing_vaccines", "not_switched"):
        assert k in ids


def test_bulk_email_templates_seed_six_system():
    h = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/admin/bulk-email/templates", headers=h, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    sys_slugs = {t["slug"] for t in rows if t["kind"] == "system"}
    # Original 6 + 6 single-client templates added in Sprint 110dh-3
    for slug in ("welcome_new_app", "app_switch_reminder", "vaccine_reminder",
                 "booking_reminder", "policy_update", "general_announcement",
                 "thank_you_visit", "quote_followup", "missed_call_followup",
                 "personal_welcome", "payment_followup", "waiver_followup"):
        assert slug in sys_slugs, f"system template {slug} missing"


def test_bulk_email_recipients_active_filter():
    h = _admin_headers()
    r = requests.post(f"{BASE_URL}/api/admin/bulk-email/recipients",
                      json={"filters": ["active"]}, headers=h, timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert "count" in data and "recipients" in data
    assert data["count"] >= 0
    for rec in data["recipients"][:5]:
        assert rec["email"] and "@" in rec["email"]
        assert "first_name" in rec


def test_bulk_email_recipients_manual_selection():
    h = _admin_headers()
    cid, _ = _make_client_and_login("bulk_manual")
    r = requests.post(f"{BASE_URL}/api/admin/bulk-email/recipients",
                      json={"client_ids": [cid]}, headers=h, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 1
    assert data["recipients"][0]["id"] == cid


def test_bulk_email_template_create_and_delete():
    h = _admin_headers()
    body = {"name": f"Custom Test {uuid.uuid4().hex[:6]}",
            "subject": "Hello {{client_first_name}}", "body": "Test body"}
    r = requests.post(f"{BASE_URL}/api/admin/bulk-email/templates",
                      json=body, headers=h, timeout=15)
    assert r.status_code == 200
    tpl = r.json()
    assert tpl["kind"] == "custom"
    # delete
    rd = requests.delete(f"{BASE_URL}/api/admin/bulk-email/templates/{tpl['id']}", headers=h, timeout=15)
    assert rd.status_code == 200
    # system templates cannot be deleted
    rs = requests.get(f"{BASE_URL}/api/admin/bulk-email/templates", headers=h, timeout=15)
    sys_tpl = next(t for t in rs.json() if t["kind"] == "system")
    r_block = requests.delete(f"{BASE_URL}/api/admin/bulk-email/templates/{sys_tpl['id']}", headers=h, timeout=15)
    assert r_block.status_code == 400


def test_bulk_email_send_logs_to_communications():
    h = _admin_headers()
    cid, _ = _make_client_and_login("bulk_send")
    r = requests.post(f"{BASE_URL}/api/admin/bulk-email/send",
                      json={"subject": "Hello {{client_first_name}}",
                            "body": "Test message body for {{client_first_name}}",
                            "client_ids": [cid], "test_only": False},
                      headers=h, timeout=30)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["recipient_count"] == 1
    assert res["manual_selection"] is True
    # history endpoint should now contain this send
    hr = requests.get(f"{BASE_URL}/api/admin/bulk-email/history", headers=h, timeout=15)
    assert hr.status_code == 200
    found = any(row["id"] == res["id"] for row in hr.json())
    assert found, "send not in history"
    # client communication should have a [Bulk] entry — only if email actually fired.
    # Resend may be unconfigured in tests, in which case success_count == 0.
    # We only assert the comm-log if Resend reported success.
    if res["success_count"] >= 1:
        cr = requests.get(f"{BASE_URL}/api/communications?client_id={cid}", headers=h, timeout=15)
        assert cr.status_code == 200
        entries = cr.json().get("entries", cr.json() if isinstance(cr.json(), list) else [])
        assert any("[Bulk]" in (row.get("summary") or "") for row in entries)


def test_single_client_email_via_manual_selection():
    """Send to a single client using client_ids (Sprint 110dh-2 — Send Email button)."""
    h = _admin_headers()
    cid, _ = _make_client_and_login("single_email")
    r = requests.post(f"{BASE_URL}/api/admin/bulk-email/send",
                      json={"subject": "Hi {{client_first_name}}",
                            "body": "Quick one-off email body.",
                            "client_ids": [cid]},
                      headers=h, timeout=30)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["recipient_count"] == 1
    assert res["manual_selection"] is True
    # also rejects empty client_ids
    bad = requests.post(f"{BASE_URL}/api/admin/bulk-email/send",
                       json={"subject": "x", "body": "y", "client_ids": []},
                       headers=h, timeout=15)
    assert bad.status_code == 400


def test_bulk_email_send_requires_subject_and_body():
    h = _admin_headers()
    r = requests.post(f"{BASE_URL}/api/admin/bulk-email/send",
                      json={"subject": "", "body": "x", "filters": ["active"]},
                      headers=h, timeout=10)
    assert r.status_code == 400


# ---------- Client ↔ Admin Messaging ----------
def test_client_can_create_thread_and_admin_replies():
    ah = _admin_headers()
    cid, ch = _make_client_and_login("msg_basic")
    # client creates a thread
    r = requests.post(f"{BASE_URL}/api/me/messages",
                      json={"category": "booking", "subject": "Drop-off question",
                            "body": "What time do you open Monday?"},
                      headers=ch, timeout=15)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    assert r.json()["status"] == "open"
    assert r.json()["unread_admin"] is True

    # admin sees it in inbox
    al = requests.get(f"{BASE_URL}/api/admin/messages?unread_only=true", headers=ah, timeout=15)
    assert al.status_code == 200
    assert any(t["id"] == tid for t in al.json())

    # admin gets full thread (and resets unread)
    af = requests.get(f"{BASE_URL}/api/admin/messages/{tid}", headers=ah, timeout=15)
    assert af.status_code == 200
    assert len(af.json()["messages"]) == 1

    # admin replies
    ar = requests.post(f"{BASE_URL}/api/admin/messages/{tid}/reply",
                       json={"body": "We open at 7am sharp.", "email_notify": False},
                       headers=ah, timeout=15)
    assert ar.status_code == 200
    assert ar.json()["unread_client"] is True
    assert len(ar.json()["messages"]) == 2

    # client sees the reply
    cs = requests.get(f"{BASE_URL}/api/me/messages/{tid}", headers=ch, timeout=15)
    assert cs.status_code == 200
    msgs = cs.json()["messages"]
    assert len(msgs) == 2
    assert msgs[-1]["sender_role"] in ("admin", "staff")
    # internal_notes hidden from client
    assert "internal_notes" not in cs.json()


def test_internal_notes_only_visible_to_admin():
    ah = _admin_headers()
    _, ch = _make_client_and_login("msg_notes")
    r = requests.post(f"{BASE_URL}/api/me/messages",
                      json={"body": "Test note thread"}, headers=ch, timeout=15)
    tid = r.json()["id"]
    # admin adds note
    nr = requests.post(f"{BASE_URL}/api/admin/messages/{tid}/note",
                       json={"body": "Heads up - this client is new"},
                       headers=ah, timeout=15)
    assert nr.status_code == 200
    # client view should NOT include internal notes
    cs = requests.get(f"{BASE_URL}/api/me/messages/{tid}", headers=ch, timeout=15)
    assert "internal_notes" not in cs.json()
    # admin sees them
    af = requests.get(f"{BASE_URL}/api/admin/messages/{tid}", headers=ah, timeout=15)
    assert len(af.json()["internal_notes"]) == 1


def test_status_transitions_and_reopen_on_client_reply():
    ah = _admin_headers()
    _, ch = _make_client_and_login("msg_status")
    r = requests.post(f"{BASE_URL}/api/me/messages",
                      json={"body": "Initial"}, headers=ch, timeout=30)
    tid = r.json()["id"]
    # mark resolved
    ps = requests.patch(f"{BASE_URL}/api/admin/messages/{tid}",
                       json={"status": "resolved"}, headers=ah, timeout=15)
    assert ps.status_code == 200
    assert ps.json()["status"] == "resolved"
    # client replies — should reopen
    rr = requests.post(f"{BASE_URL}/api/me/messages/{tid}/reply",
                       json={"body": "Actually one more question"}, headers=ch, timeout=30)
    assert rr.status_code == 200
    assert rr.json()["status"] == "open"


def test_client_cannot_see_other_client_threads():
    _, ca = _make_client_and_login("msg_a")
    _, cb = _make_client_and_login("msg_b")
    # client A creates
    r = requests.post(f"{BASE_URL}/api/me/messages",
                      json={"body": "Private to A"}, headers=ca, timeout=15)
    tid = r.json()["id"]
    # client B should not see it
    rl = requests.get(f"{BASE_URL}/api/me/messages", headers=cb, timeout=15)
    assert rl.status_code == 200
    assert all(t["id"] != tid for t in rl.json())
    # and direct GET 404s
    rd = requests.get(f"{BASE_URL}/api/me/messages/{tid}", headers=cb, timeout=15)
    assert rd.status_code == 404


def test_message_unread_counts():
    ah = _admin_headers()
    _, ch = _make_client_and_login("msg_unread")
    # baseline
    before = requests.get(f"{BASE_URL}/api/admin/messages/unread-count", headers=ah, timeout=15).json()
    # client creates
    requests.post(f"{BASE_URL}/api/me/messages", json={"body": "ping"}, headers=ch, timeout=15)
    after = requests.get(f"{BASE_URL}/api/admin/messages/unread-count", headers=ah, timeout=15).json()
    assert after["unread"] >= before["unread"] + 1
    # client unread should be 0 (just created their own)
    cu = requests.get(f"{BASE_URL}/api/me/messages-unread-count", headers=ch, timeout=15).json()
    assert cu["unread"] == 0


def test_messages_permission_required_for_admin_endpoints():
    # Unauthenticated GET → 401/403
    r = requests.get(f"{BASE_URL}/api/admin/messages", timeout=15)
    assert r.status_code in (401, 403)


def test_message_invalid_status_rejected():
    ah = _admin_headers()
    _, ch = _make_client_and_login("msg_invalid_status")
    r = requests.post(f"{BASE_URL}/api/me/messages", json={"body": "x"}, headers=ch, timeout=15)
    tid = r.json()["id"]
    bad = requests.patch(f"{BASE_URL}/api/admin/messages/{tid}",
                        json={"status": "garbage"}, headers=ah, timeout=15)
    assert bad.status_code == 400
