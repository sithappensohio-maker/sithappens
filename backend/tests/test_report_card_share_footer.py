"""Sprint 110cq — Validate that the Day-in-Pictures email body contains
the referral code + Facebook/X share buttons + (when configured) Google
review CTA. Uses the new admin preview endpoint to render the HTML
without sending."""
import os
import uuid
import pytest
import requests
from datetime import date

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


def _make_visit(admin_headers, with_content=True):
    """Boarding/grooming visit with report card."""
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(f"{API}/clients", headers=admin_headers,
                           json={"name": f"Refer Owner {suffix}",
                                 "email": f"refer-owner-{suffix}@sithappens.com"},
                           timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                        json={"name": f"ReferDog {suffix}", "owner_id": client["id"],
                              "breed": "Mix", "age_y": 4,
                              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}},
                        timeout=15).json()
    booking = None
    for st in ("boarding", "grooming"):
        body = {"dog_id": dog["id"], "service_type": st,
                "date": date.today().isoformat(), "status": "approved"}
        if st == "grooming":
            body["grooming_type"] = "bath"
        resp = requests.post(f"{API}/bookings", headers=admin_headers, json=body, timeout=15)
        if resp.status_code == 200:
            booking = resp.json()
            break
    if booking is None:
        pytest.skip("Preview DB has no capacity left for today")
    if with_content:
        requests.post(f"{API}/bookings/{booking['id']}/report-card", headers=admin_headers,
                      json={"photos": [], "mood_tags": ["Happy"], "note": "Best day ever!"},
                      timeout=15).raise_for_status()
    return {"client": client, "dog": dog, "booking_id": booking["id"]}


def test_preview_contains_referral_code_and_share_buttons(admin_headers):
    """The rendered email body must include the client's referral code
    (auto-minted if missing), Facebook share URL, X share URL, and the
    "Loved..." footer copy."""
    # Configure a Google review URL so we can assert that block.
    requests.put(f"{API}/admin/email-settings", headers=admin_headers,
                 json={"google_review_url": "https://g.page/r/test/review"},
                 timeout=15).raise_for_status()

    v = _make_visit(admin_headers, with_content=True)
    preview = requests.get(
        f"{API}/bookings/{v['booking_id']}/report-card-email/preview",
        headers=admin_headers, timeout=15,
    ).json()
    body = preview["body_html"]
    ref = preview["referral_code"]

    assert ref, "Preview must mint+return a referral code"
    assert ref in body, f"Referral code {ref} should appear in the email body"
    assert "facebook.com/sharer" in body, "Facebook share URL should be in the email body"
    assert "twitter.com/intent/tweet" in body, "X (Twitter) share URL should be in the email body"
    assert "g.page/r/test/review" in body, "Configured Google review URL should be in the email body"
    assert "Loved" in body, "Footer's 'Loved your day?' CTA should be present"
    assert "Your referral code" in body or "referral code" in body.lower()


def test_review_button_hidden_when_url_blank(admin_headers):
    """No Google review URL → no review button, but share buttons remain."""
    requests.put(f"{API}/admin/email-settings", headers=admin_headers,
                 json={"google_review_url": ""}, timeout=15).raise_for_status()

    v = _make_visit(admin_headers, with_content=True)
    preview = requests.get(
        f"{API}/bookings/{v['booking_id']}/report-card-email/preview",
        headers=admin_headers, timeout=15,
    ).json()
    body = preview["body_html"]
    assert "Leave a Google review" not in body
    # But share + referral block are still there.
    assert "facebook.com/sharer" in body
    assert preview["referral_code"] in body


def test_share_text_uses_custom_message(admin_headers):
    """`report_card_share_message` setting overrides the default tweet text."""
    requests.put(f"{API}/admin/email-settings", headers=admin_headers,
                 json={"report_card_share_message": "TEST_CUSTOM_SHARE_TEXT_XYZ"},
                 timeout=15).raise_for_status()

    v = _make_visit(admin_headers, with_content=True)
    preview = requests.get(
        f"{API}/bookings/{v['booking_id']}/report-card-email/preview",
        headers=admin_headers, timeout=15,
    ).json()
    body = preview["body_html"]
    # URL-encoded in the X share intent.
    assert "TEST_CUSTOM_SHARE_TEXT_XYZ" in body or "TEST_CUSTOM_SHARE_TEXT_XYZ".replace(" ", "+") in body

    # Reset for other tests.
    requests.put(f"{API}/admin/email-settings", headers=admin_headers,
                 json={"report_card_share_message": ""}, timeout=15).raise_for_status()


def test_preview_requires_admin(admin_headers):
    """The preview endpoint must reject non-admin requests."""
    suffix = uuid.uuid4().hex[:6]
    email = f"share-emp-{suffix}@sithappens.com"
    pw = "ShareEmp123!"
    requests.post(f"{API}/admin/employees", headers=admin_headers,
                  json={"name": f"Share Emp {suffix}", "email": email, "password": pw,
                        "hourly_rate": 18.0}, timeout=15).raise_for_status()
    login = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15).json()
    staff_headers = {"Authorization": f"Bearer {login['token']}"}
    v = _make_visit(admin_headers, with_content=True)
    r = requests.get(f"{API}/bookings/{v['booking_id']}/report-card-email/preview",
                     headers=staff_headers, timeout=15)
    assert r.status_code in (401, 403)
