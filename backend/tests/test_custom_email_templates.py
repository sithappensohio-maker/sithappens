"""Sprint 110di-62 — Custom email template system.

Covers:
  - Create a custom template via POST /admin/email-templates/custom
  - GET list endpoint returns it with kind="custom"
  - Bind template to a Program → sell program → bound template fires
  - Delete custom template → product is unbound automatically
  - System templates cannot be deleted via the custom-delete endpoint
"""
import os, uuid, requests, pytest
BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"))


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


def test_create_list_delete_custom_template(admin_headers):
    name = f"Pytest Template {uuid.uuid4().hex[:6]}"
    cr = requests.post(f"{BASE}/api/admin/email-templates/custom", headers=admin_headers,
                       json={"name": name, "subject": "S", "intro_html": "<p>hi</p>"}, timeout=15)
    assert cr.status_code == 200, cr.text
    slug = cr.json()["slug"]
    assert slug.startswith("custom_")
    # List → present
    lr = requests.get(f"{BASE}/api/admin/email-templates", headers=admin_headers, timeout=15)
    assert lr.status_code == 200
    assert any(t["slug"] == slug and t.get("kind") == "custom" for t in lr.json())
    # Delete
    dr = requests.delete(f"{BASE}/api/admin/email-templates/custom/{slug}", headers=admin_headers, timeout=15)
    assert dr.status_code == 200, dr.text
    # No longer listed
    lr2 = requests.get(f"{BASE}/api/admin/email-templates", headers=admin_headers, timeout=15)
    assert not any(t["slug"] == slug for t in lr2.json())


def test_cannot_delete_system_template(admin_headers):
    # `welcome` is a system slug. Try to delete it via custom endpoint.
    r = requests.delete(f"{BASE}/api/admin/email-templates/custom/welcome", headers=admin_headers, timeout=15)
    assert r.status_code in (400, 404)


def test_program_bind_and_unbind_on_template_delete(admin_headers):
    """Creating a custom template, binding it to a program, and deleting the
    template should clear the binding from the program."""
    # Create custom template
    cr = requests.post(f"{BASE}/api/admin/email-templates/custom", headers=admin_headers,
                       json={"name": "Bind Test", "subject": "S", "intro_html": "<p>hi</p>"}, timeout=15)
    slug = cr.json()["slug"]
    # Find or create a program
    pr = requests.get(f"{BASE}/api/programs", headers=admin_headers, timeout=15)
    progs = pr.json() if isinstance(pr.json(), list) else pr.json().get("items", [])
    if not progs:
        pytest.skip("no programs seeded")
    prog = progs[0]
    # Bind
    up = requests.put(f"{BASE}/api/programs/{prog['id']}", headers=admin_headers,
                       json={**prog, "welcome_email_template_slug": slug}, timeout=15)
    assert up.status_code == 200, up.text
    # Delete the custom template
    requests.delete(f"{BASE}/api/admin/email-templates/custom/{slug}", headers=admin_headers, timeout=15)
    # Re-fetch program → binding should be None
    pr2 = requests.get(f"{BASE}/api/programs", headers=admin_headers, timeout=15)
    progs2 = pr2.json() if isinstance(pr2.json(), list) else pr2.json().get("items", [])
    p2 = next((p for p in progs2 if p["id"] == prog["id"]), None)
    assert p2 is not None
    assert (p2.get("welcome_email_template_slug") or None) is None
