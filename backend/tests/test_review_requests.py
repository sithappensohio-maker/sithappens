"""Sprint 110ez — Phase 9: Review request system regression."""
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


def test_review_links_get_and_put(admin_headers):
    base = requests.get(f"{BASE}/api/settings/review-links", headers=admin_headers, timeout=15).json()
    for k in ("google_url", "facebook_url", "yelp_url", "default_message"):
        assert k in base

    saved = requests.put(
        f"{BASE}/api/settings/review-links", headers=admin_headers,
        json={"google_url": "https://example.com/google", "facebook_url": "https://example.com/fb"},
        timeout=15,
    ).json()
    assert saved["google_url"] == "https://example.com/google"
    assert saved["facebook_url"] == "https://example.com/fb"
    # Partial update preserves yelp_url
    again = requests.put(
        f"{BASE}/api/settings/review-links", headers=admin_headers,
        json={"yelp_url": "https://example.com/yelp"},
        timeout=15,
    ).json()
    assert again["yelp_url"] == "https://example.com/yelp"
    assert again["google_url"] == "https://example.com/google", "Partial update must not wipe other keys"


def test_review_request_logged_in_both_collections(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"Rev-{suffix}", "email": f"rev-{suffix}@e.com"},
        timeout=15,
    ).json()
    try:
        rr = requests.post(
            f"{BASE}/api/review-requests", headers=admin_headers,
            json={"client_id": client["id"], "method": "google", "source": "graduation",
                  "notes": "asked at training graduation"},
            timeout=15,
        )
        rr.raise_for_status()
        entry = rr.json()
        assert entry["method"] == "google"
        assert entry["source"] == "graduation"
        assert entry["requested_by_name"]
        rid = entry["id"]

        # Cross-logged in communication log
        comm = requests.get(
            f"{BASE}/api/communications?client_id={client['id']}&limit=20",
            headers=admin_headers, timeout=15,
        ).json()
        backlinks = [c for c in comm["entries"] if c.get("review_request_id") == rid]
        assert backlinks, "Review request must auto-log a communication entry with back-link"
        assert "Review requested" in backlinks[0]["summary"]

        # Bad method rejected
        bad = requests.post(
            f"{BASE}/api/review-requests", headers=admin_headers,
            json={"client_id": client["id"], "method": "snail_mail", "source": "manual"},
            timeout=15,
        )
        assert bad.status_code == 400

        # by_method counts
        listed = requests.get(
            f"{BASE}/api/review-requests?client_id={client['id']}",
            headers=admin_headers, timeout=15,
        ).json()
        assert listed["by_method"]["google"] >= 1
        assert "facebook" in listed["methods"]

        # Delete review request
        d = requests.delete(f"{BASE}/api/review-requests/{rid}", headers=admin_headers, timeout=15)
        d.raise_for_status()
    finally:
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
