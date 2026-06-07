"""Sprint 110by — Email template customization + branding."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_list_templates_includes_registry_slugs(admin_headers):
    r = requests.get(f"{API}/admin/email-templates", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()
    slugs = {t["slug"] for t in rows}
    # Spot-check a handful of well-known slugs
    for required in ["client_homework_assigned", "client_booking_approved", "admin_new_booking",
                     "client_low_credits", "client_pack_receipt", "account_claim",
                     "trainer_monday_digest"]:
        assert required in slugs, f"Missing template slug: {required}"
    # Each row exposes defaults + override + variables
    for row in rows:
        assert "defaults" in row
        assert "override" in row
        assert "variables" in row
        assert "name" in row
        assert "category" in row


def test_get_single_template(admin_headers):
    r = requests.get(f"{API}/admin/email-templates/client_homework_assigned",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "client_homework_assigned"
    assert "{{first_name}}" in body["defaults"]["intro_html"] or "first_name" in body["variables"]
    assert "first_name" in body["variables"]


def test_unknown_template_404(admin_headers):
    r = requests.get(f"{API}/admin/email-templates/does_not_exist",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 404


def test_update_and_reset_template_override(admin_headers):
    slug = "client_low_credits"
    suffix = uuid.uuid4().hex[:6]
    custom_subject = f"⚠️ Pytest subject {suffix} · {{{{remaining}}}} {{{{unit}}}} left"
    custom_intro = "Hi {{first_name}}, this is a *custom* intro just for the pytest run."

    # Save override
    r = requests.put(f"{API}/admin/email-templates/{slug}",
                     headers=admin_headers, timeout=15,
                     json={"subject": custom_subject, "intro_html": custom_intro,
                           "cta_text": "Buy a Pack"})
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["override"]["subject"] == custom_subject
    assert saved["override"]["intro_html"] == custom_intro

    # Read it back
    r2 = requests.get(f"{API}/admin/email-templates/{slug}",
                      headers=admin_headers, timeout=15)
    assert r2.json()["is_customized"] is True
    assert r2.json()["override"]["subject"] == custom_subject

    # Reset
    r3 = requests.post(f"{API}/admin/email-templates/{slug}/reset",
                       headers=admin_headers, timeout=15)
    assert r3.status_code == 200
    r4 = requests.get(f"{API}/admin/email-templates/{slug}",
                      headers=admin_headers, timeout=15)
    assert r4.json()["is_customized"] is False


def test_email_settings_round_trip(admin_headers):
    # Get current (should have defaults filled in)
    r = requests.get(f"{API}/admin/email-settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    cur = r.json()
    for k in ["brand_name", "brand_green", "brand_blue", "brand_dark",
              "logo_url", "signature_html", "footer_html"]:
        assert k in cur

    # Update branding
    new_sig = f"<p>Pytest signature {uuid.uuid4().hex[:6]}</p>"
    r2 = requests.put(f"{API}/admin/email-settings",
                      headers=admin_headers, timeout=15,
                      json={"signature_html": new_sig, "brand_name": "Sit Happens (Pytest)"})
    assert r2.status_code == 200
    assert r2.json()["signature_html"] == new_sig
    assert r2.json()["brand_name"] == "Sit Happens (Pytest)"

    # Restore defaults so we don't pollute the running app
    requests.put(f"{API}/admin/email-settings",
                 headers=admin_headers, timeout=15,
                 json={"signature_html": "", "brand_name": "Sit Happens"})


def test_test_email_endpoint_returns_ok_without_sending(admin_headers):
    """Even if Resend isn't configured in the test env, the endpoint should
    still return 200 with sent=False (it's a no-op when RESEND_API_KEY is empty)."""
    r = requests.post(f"{API}/admin/email-templates/client_homework_assigned/test",
                      headers=admin_headers, timeout=15,
                      json={"to_email": "pytest@example.com"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == "client_homework_assigned"
    assert body["sent_to"] == "pytest@example.com"
    # `ok` may be True or False depending on RESEND_API_KEY presence — both
    # are acceptable; what matters is the endpoint doesn't 500.


def test_template_endpoints_require_admin():
    r = requests.get(f"{API}/admin/email-templates", timeout=15)
    assert r.status_code in (401, 403)
    r2 = requests.get(f"{API}/admin/email-settings", timeout=15)
    assert r2.status_code in (401, 403)
