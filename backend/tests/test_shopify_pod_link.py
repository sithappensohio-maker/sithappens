"""Shopify apparel/merch link-out setting.

Small, targeted test: the client Shop's "Shop Apparel" section is driven
entirely by `settings.client_portal_links.shopify_store_url` (blank = hidden),
the same admin-configurable, publicly-exposed convention already used for
`website_url`/`photo_gallery_url`. No Printify/direct-integration code is
involved — this only proves the setting round-trips and is exposed on the
public settings endpoint that the client Shop reads.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def restore_shopify_url(admin_headers):
    """Save/restore client_portal_links so this test never leaves a stray
    Shopify URL configured for other tests or for real portal traffic."""
    before = requests.get(f"{API}/settings", headers=admin_headers, timeout=15).json()
    original_links = dict(before.get("client_portal_links") or {})
    yield
    requests.put(f"{API}/settings", headers=admin_headers,
                 json={"client_portal_links": original_links}, timeout=15)


def test_configured_shopify_url_persists_and_is_public(admin_headers, restore_shopify_url):
    """A. Setting shopify_store_url via PUT /settings round-trips through
    both the admin GET /settings and the unauthenticated GET /settings/public
    endpoint the client Shop actually reads."""
    url = "https://sit-happens-merch.myshopify.com"
    r = requests.put(f"{API}/settings", headers=admin_headers,
                      json={"client_portal_links": {"shopify_store_url": url}}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["client_portal_links"]["shopify_store_url"] == url

    admin_view = requests.get(f"{API}/settings", headers=admin_headers, timeout=15).json()
    assert admin_view["client_portal_links"]["shopify_store_url"] == url

    public_view = requests.get(f"{API}/settings/public", timeout=15).json()
    assert public_view["client_portal_links"]["shopify_store_url"] == url


def test_blank_shopify_url_is_absent_from_public_settings(admin_headers, restore_shopify_url):
    """B. Clearing shopify_store_url (blank) is what the client Shop treats
    as "hide the section" — confirm the public endpoint reflects the blank
    value rather than some stale/cached URL."""
    requests.put(f"{API}/settings", headers=admin_headers,
                 json={"client_portal_links": {"shopify_store_url": "https://temp.myshopify.com"}}, timeout=15)
    r = requests.put(f"{API}/settings", headers=admin_headers,
                      json={"client_portal_links": {"shopify_store_url": ""}}, timeout=15)
    assert r.status_code == 200, r.text

    public_view = requests.get(f"{API}/settings/public", timeout=15).json()
    assert public_view["client_portal_links"]["shopify_store_url"] == ""


def test_shopify_setting_does_not_touch_sibling_portal_links(admin_headers, restore_shopify_url):
    """C. Setting shopify_store_url alongside the pre-existing website_url/
    photo_gallery_url keys doesn't clobber them — same dict, additive field."""
    r = requests.put(f"{API}/settings", headers=admin_headers, json={"client_portal_links": {
        "website_url": "https://example-kennel.com",
        "photo_gallery_url": "https://photos.example-kennel.com",
        "shopify_store_url": "https://sit-happens-merch.myshopify.com",
    }}, timeout=15)
    assert r.status_code == 200, r.text
    links = r.json()["client_portal_links"]
    assert links["website_url"] == "https://example-kennel.com"
    assert links["photo_gallery_url"] == "https://photos.example-kennel.com"
    assert links["shopify_store_url"] == "https://sit-happens-merch.myshopify.com"
