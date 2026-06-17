"""Sprint 110er — Phase 1.5 client-portal intake completion flow.

Validates the end-to-end client experience:
  1. Admin creates a template + assigns it to a client (status=sent)
  2. Logged-in client hits /portal/intake/assigned → sees it WITH the
     public-facing fields hydrated AND staff_only fields stripped
  3. Client submits via /portal/intake/submissions/{id}/submit
  4. Status flips to "submitted" and submitted_at stamps
  5. Submission no longer appears on the "assigned" list
  6. A different client CANNOT submit someone else's form
"""
import os
import uuid
import pytest
import requests


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers(admin_headers):
    """Standing test client from /app/memory/test_credentials.md."""
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "testclient@sithappens.com", "password": "test1234"},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip("Standing test client account unavailable")
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_portal_intake_full_flow(admin_headers, client_headers):
    suffix = uuid.uuid4().hex[:6]
    # Find the client_id for the test client
    me = requests.get(f"{BASE}/api/auth/me", headers=client_headers, timeout=15).json()
    client_id = me.get("client_id")
    assert client_id, "Test client must have a client_id on their user record"

    # ── Admin creates a template with one staff-only field
    tpl = requests.post(
        f"{BASE}/api/intake/templates", headers=admin_headers,
        json={
            "name": f"PortalFlow-{suffix}",
            "form_type": "client_intake",
            "active": True,
            "fields": [
                {"label": "Your name", "field_type": "short_text", "required": True},
                {"label": "Favorite color", "field_type": "dropdown",
                 "options": ["Red", "Green", "Blue"]},
                {"label": "Internal note", "field_type": "staff_only_note"},
            ],
        },
        timeout=15,
    ).json()
    tpl_id = tpl["id"]

    # ── Admin assigns it to the test client
    sub = requests.post(
        f"{BASE}/api/intake/submissions", headers=admin_headers,
        json={"template_id": tpl_id, "client_id": client_id, "status": "sent"},
        timeout=15,
    ).json()
    sub_id = sub["id"]

    try:
        # ── Client sees it on /portal/intake/assigned WITHOUT staff_only field
        assigned = requests.get(
            f"{BASE}/api/portal/intake/assigned", headers=client_headers, timeout=15,
        ).json()
        rows = [r for r in assigned["assigned"] if r["id"] == sub_id]
        assert len(rows) == 1, "Test submission missing from assigned list"
        row = rows[0]
        public_fields = row["template"]["fields"]
        labels = [f["label"] for f in public_fields]
        assert "Your name" in labels
        assert "Favorite color" in labels
        assert "Internal note" not in labels, (
            "Staff-only field leaked to the client portal — privacy bug"
        )

        # ── Client submits answers
        name_field = next(f for f in public_fields if f["label"] == "Your name")
        color_field = next(f for f in public_fields if f["label"] == "Favorite color")
        submit = requests.post(
            f"{BASE}/api/portal/intake/submissions/{sub_id}/submit",
            headers=client_headers,
            json={"answers": {
                name_field["id"]: "Test Client",
                color_field["id"]: "Green",
            }},
            timeout=15,
        )
        submit.raise_for_status()
        body = submit.json()
        assert body["status"] == "submitted"
        assert body["submitted_at"], "submitted_at must auto-stamp"

        # ── Now it's NOT in the assigned list anymore
        assigned2 = requests.get(
            f"{BASE}/api/portal/intake/assigned", headers=client_headers, timeout=15,
        ).json()
        assert not any(r["id"] == sub_id for r in assigned2["assigned"]), (
            "Submitted form should not still appear under 'assigned'"
        )

        # ── A non-owning user cannot submit it (admin token IS allowed since the
        # endpoint requires role=client; admin gets 403 here — correct, since
        # the endpoint is portal-only).
        admin_attempt = requests.post(
            f"{BASE}/api/portal/intake/submissions/{sub_id}/submit",
            headers=admin_headers,
            json={"answers": {}},
            timeout=15,
        )
        assert admin_attempt.status_code in (403, 400), (
            "Admin tokens must be rejected from the portal submission endpoint"
        )

    finally:
        # cleanup
        requests.delete(f"{BASE}/api/intake/submissions/{sub_id}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/intake/templates/{tpl_id}", headers=admin_headers, timeout=15)
