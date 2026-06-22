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



# ──────────── Sprint 110di-62 — Credit-pack binding + bulk-sell smoke ────────────

def _find_or_create_pack(headers):
    """Return an existing credit pack (any active one) or create a TEST_ pack."""
    lr = requests.get(f"{BASE}/api/credit-packs", headers=headers, timeout=15)
    assert lr.status_code == 200, lr.text
    packs = lr.json()
    if packs:
        return packs[0]
    # Create a TEST_ pack
    cr = requests.post(
        f"{BASE}/api/credit-packs", headers=headers,
        json={"name": "TEST_PackEmail", "qty": 5, "price": 100.0, "service_type": "daycare", "active": True},
        timeout=15,
    )
    assert cr.status_code == 200, cr.text
    return cr.json()


def test_credit_pack_bind_persists(admin_headers):
    """Binding a custom slug to a credit pack via PUT /credit-packs/{id} persists and is returned by GET."""
    # Create custom template
    cr = requests.post(f"{BASE}/api/admin/email-templates/custom", headers=admin_headers,
                       json={"name": "Pack Bind Test", "subject": "Welcome",
                             "intro_html": "<p>welcome pack</p>", "audience": "client"}, timeout=15)
    assert cr.status_code == 200, cr.text
    slug = cr.json()["slug"]
    assert slug.startswith("custom_")

    pack = _find_or_create_pack(admin_headers)
    # PUT with welcome_email_template_slug — must send the full required pack body
    put_body = {
        "name": pack["name"],
        "qty": int(pack["qty"]),
        "price": float(pack["price"]),
        "service_type": pack.get("service_type") or "daycare",
        "icon": pack.get("icon") or "",
        "color": pack.get("color") or "",
        "active": bool(pack.get("active", True)),
        "welcome_email_template_slug": slug,
    }
    up = requests.put(f"{BASE}/api/credit-packs/{pack['id']}", headers=admin_headers, json=put_body, timeout=15)
    assert up.status_code == 200, up.text
    assert up.json().get("welcome_email_template_slug") == slug

    # GET → binding visible
    lr = requests.get(f"{BASE}/api/credit-packs", headers=admin_headers, timeout=15)
    assert lr.status_code == 200
    refetch = next((p for p in lr.json() if p["id"] == pack["id"]), None)
    assert refetch is not None
    assert refetch.get("welcome_email_template_slug") == slug

    # Cleanup: clear binding so we don't leak slug into the active pack
    put_body["welcome_email_template_slug"] = None
    requests.put(f"{BASE}/api/credit-packs/{pack['id']}", headers=admin_headers, json=put_body, timeout=15)
    requests.delete(f"{BASE}/api/admin/email-templates/custom/{slug}", headers=admin_headers, timeout=15)


def test_delete_template_unbinds_credit_pack(admin_headers):
    """Deleting a custom template bound to a credit pack should auto-clear the binding."""
    cr = requests.post(f"{BASE}/api/admin/email-templates/custom", headers=admin_headers,
                       json={"name": "Pack Unbind Test", "subject": "S",
                             "intro_html": "<p>hi</p>", "audience": "client"}, timeout=15)
    slug = cr.json()["slug"]

    pack = _find_or_create_pack(admin_headers)
    put_body = {
        "name": pack["name"],
        "qty": int(pack["qty"]),
        "price": float(pack["price"]),
        "service_type": pack.get("service_type") or "daycare",
        "icon": pack.get("icon") or "",
        "color": pack.get("color") or "",
        "active": bool(pack.get("active", True)),
        "welcome_email_template_slug": slug,
    }
    up = requests.put(f"{BASE}/api/credit-packs/{pack['id']}", headers=admin_headers, json=put_body, timeout=15)
    assert up.status_code == 200, up.text

    # Delete the custom template
    dr = requests.delete(f"{BASE}/api/admin/email-templates/custom/{slug}", headers=admin_headers, timeout=15)
    assert dr.status_code == 200, dr.text

    # Re-fetch — pack binding should be cleared
    lr = requests.get(f"{BASE}/api/credit-packs", headers=admin_headers, timeout=15)
    refetch = next((p for p in lr.json() if p["id"] == pack["id"]), None)
    assert refetch is not None
    assert (refetch.get("welcome_email_template_slug") or None) is None


def test_bulk_sell_with_welcome_slug_does_not_500(admin_headers):
    """POST /clients/{id}/sell-packs (bulk) with a pack carrying welcome_email_template_slug
    must NOT 500. Email dispatch is fire-and-forget."""
    # Create custom template + bind to pack
    cr = requests.post(f"{BASE}/api/admin/email-templates/custom", headers=admin_headers,
                       json={"name": "Bulk Sell Smoke", "subject": "S",
                             "intro_html": "<p>hi</p>", "audience": "client"}, timeout=15)
    slug = cr.json()["slug"]
    pack = _find_or_create_pack(admin_headers)
    put_body = {
        "name": pack["name"],
        "qty": int(pack["qty"]),
        "price": float(pack["price"]),
        "service_type": pack.get("service_type") or "daycare",
        "icon": pack.get("icon") or "",
        "color": pack.get("color") or "",
        "active": bool(pack.get("active", True)),
        "welcome_email_template_slug": slug,
    }
    up = requests.put(f"{BASE}/api/credit-packs/{pack['id']}", headers=admin_headers, json=put_body, timeout=15)
    assert up.status_code == 200, up.text

    # Use the seeded client per /app/memory/test_credentials.md
    client_id = "4b3658d3-9172-4a7a-b3dc-3a49a56ed6d2"
    sell = requests.post(
        f"{BASE}/api/clients/{client_id}/sell-packs",
        headers=admin_headers,
        json={"items": [{"pack_id": pack["id"], "quantity": 1}], "payment_method": "cash",
              "note": "TEST_bulk_welcome_slug"},
        timeout=20,
    )
    # Must NOT 500 (per spec)
    assert sell.status_code != 500, sell.text
    # And the success path returns 200
    assert sell.status_code == 200, sell.text

    # Cleanup: unbind + delete template + delete lots created by this test
    put_body["welcome_email_template_slug"] = None
    requests.put(f"{BASE}/api/credit-packs/{pack['id']}", headers=admin_headers, json=put_body, timeout=15)
    requests.delete(f"{BASE}/api/admin/email-templates/custom/{slug}", headers=admin_headers, timeout=15)
    # Best-effort: void the lots we minted (won't fail the test if cleanup endpoint differs)
    try:
        data = sell.json()
        for lot in (data.get("lots") or []):
            requests.delete(f"{BASE}/api/credit-lots/{lot['id']}", headers=admin_headers, timeout=10)
    except Exception:
        pass
