"""Focused regression coverage for the Photography gallery CRUD endpoints
(POST/GET /photography/gallery, GET/PUT/DELETE /photography/gallery/{id},
POST /photography/gallery/{id}/move). These endpoints back the full-screen
client Photography page and the admin Photography settings panel and,
until now, had no dedicated automated test file.
"""
import base64
import os
import uuid

import pytest
import requests

BASE = os.environ.get("TEST_BACKEND_URL", os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE}/api"

# 1x1 transparent PNG
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
_PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(_PNG_BYTES).decode()


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def uploaded_photo(admin_headers):
    r = requests.post(f"{API}/photography/gallery", headers=admin_headers,
                       json={"data": _PNG_DATA_URL, "filename": f"test-{uuid.uuid4().hex[:8]}.png",
                             "title": "Test Photo", "caption": "A test caption"},
                       timeout=15)
    assert r.status_code == 200, r.text
    photo = r.json()
    yield photo
    requests.delete(f"{API}/photography/gallery/{photo['id']}", headers=admin_headers, timeout=15)


def test_upload_returns_metadata_without_raw_data(admin_headers, uploaded_photo):
    assert uploaded_photo["mime"] == "image/png"
    assert uploaded_photo["title"] == "Test Photo"
    assert uploaded_photo["caption"] == "A test caption"
    assert uploaded_photo["active"] is True
    assert uploaded_photo["featured"] is False
    assert "data" not in uploaded_photo


def test_upload_rejects_unsupported_mime(admin_headers):
    bad_url = "data:application/pdf;base64," + base64.b64encode(b"not an image").decode()
    r = requests.post(f"{API}/photography/gallery", headers=admin_headers,
                       json={"data": bad_url, "filename": "bad.pdf"}, timeout=15)
    assert r.status_code == 400
    assert "Unsupported image type" in r.text


def test_upload_rejects_oversized_image(admin_headers):
    # ~6MB of raw bytes, comfortably over the 5MB cap.
    big = base64.b64encode(b"\x00" * (6 * 1024 * 1024)).decode()
    big_url = "data:image/png;base64," + big
    r = requests.post(f"{API}/photography/gallery", headers=admin_headers,
                       json={"data": big_url, "filename": "big.png"}, timeout=15)
    assert r.status_code == 400
    assert "too large" in r.text


def test_upload_rejects_malformed_data_url(admin_headers):
    r = requests.post(f"{API}/photography/gallery", headers=admin_headers,
                       json={"data": "not-a-data-url", "filename": "x.png"}, timeout=15)
    assert r.status_code == 400


def test_upload_requires_admin(uploaded_photo):
    """A non-admin (e.g. unauthenticated) caller cannot upload."""
    r = requests.post(f"{API}/photography/gallery",
                       json={"data": _PNG_DATA_URL, "filename": "x.png"}, timeout=15)
    assert r.status_code in (401, 403)


def test_list_excludes_data_and_defaults_to_active_only(admin_headers, uploaded_photo):
    r = requests.get(f"{API}/photography/gallery", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    ids = {row["id"] for row in rows}
    assert uploaded_photo["id"] in ids
    assert all("data" not in row for row in rows)

    # Deactivate, then confirm it disappears from the default (active-only) list.
    upd = requests.put(f"{API}/photography/gallery/{uploaded_photo['id']}", headers=admin_headers,
                        json={"active": False}, timeout=15)
    assert upd.status_code == 200
    assert upd.json()["active"] is False

    r2 = requests.get(f"{API}/photography/gallery", headers=admin_headers, timeout=15)
    assert uploaded_photo["id"] not in {row["id"] for row in r2.json()}

    # include_inactive=true (admin) brings it back.
    r3 = requests.get(f"{API}/photography/gallery", headers=admin_headers, params={"include_inactive": True}, timeout=15)
    assert uploaded_photo["id"] in {row["id"] for row in r3.json()}

    # Restore active=True so the fixture teardown / other assertions aren't affected.
    requests.put(f"{API}/photography/gallery/{uploaded_photo['id']}", headers=admin_headers,
                 json={"active": True}, timeout=15)


def test_get_single_photo_returns_full_data_url(admin_headers, uploaded_photo):
    r = requests.get(f"{API}/photography/gallery/{uploaded_photo['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["data"] == _PNG_DATA_URL
    assert body["mime"] == "image/png"


def test_get_missing_photo_404s(admin_headers):
    r = requests.get(f"{API}/photography/gallery/{uuid.uuid4()}", headers=admin_headers, timeout=15)
    assert r.status_code == 404


def test_update_title_caption_featured(admin_headers, uploaded_photo):
    r = requests.put(f"{API}/photography/gallery/{uploaded_photo['id']}", headers=admin_headers,
                      json={"title": "Updated Title", "caption": "  ", "featured": True}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Updated Title"
    assert body["caption"] is None  # blank strings normalize to None
    assert body["featured"] is True


def test_update_requires_admin(uploaded_photo):
    r = requests.put(f"{API}/photography/gallery/{uploaded_photo['id']}", json={"title": "Hacked"}, timeout=15)
    assert r.status_code in (401, 403)


def test_move_up_and_down_swaps_sort_order(admin_headers):
    p1 = requests.post(f"{API}/photography/gallery", headers=admin_headers,
                        json={"data": _PNG_DATA_URL, "filename": "p1.png"}, timeout=15).json()
    p2 = requests.post(f"{API}/photography/gallery", headers=admin_headers,
                        json={"data": _PNG_DATA_URL, "filename": "p2.png"}, timeout=15).json()
    try:
        rows_before = {r["id"]: r["sort_order"] for r in
                       requests.get(f"{API}/photography/gallery", headers=admin_headers,
                                    params={"include_inactive": True}, timeout=15).json()}
        assert rows_before[p2["id"]] > rows_before[p1["id"]]

        mv = requests.post(f"{API}/photography/gallery/{p2['id']}/move", headers=admin_headers,
                            json={"direction": "up"}, timeout=15)
        assert mv.status_code == 200
        assert mv.json()["moved"] is True

        rows_after = {r["id"]: r["sort_order"] for r in
                      requests.get(f"{API}/photography/gallery", headers=admin_headers,
                                   params={"include_inactive": True}, timeout=15).json()}
        assert rows_after[p2["id"]] == rows_before[p1["id"]]
        assert rows_after[p1["id"]] == rows_before[p2["id"]]
    finally:
        requests.delete(f"{API}/photography/gallery/{p1['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/photography/gallery/{p2['id']}", headers=admin_headers, timeout=15)


def test_move_at_top_of_list_is_a_no_op(admin_headers, uploaded_photo):
    """Moving the very first item further up has no neighbor to swap with."""
    top = min(
        requests.get(f"{API}/photography/gallery", headers=admin_headers,
                     params={"include_inactive": True}, timeout=15).json(),
        key=lambda r: r["sort_order"],
    )
    mv = requests.post(f"{API}/photography/gallery/{top['id']}/move", headers=admin_headers,
                        json={"direction": "up"}, timeout=15)
    assert mv.status_code == 200
    assert mv.json()["moved"] is False


def test_delete_removes_photo(admin_headers):
    p = requests.post(f"{API}/photography/gallery", headers=admin_headers,
                       json={"data": _PNG_DATA_URL, "filename": "todelete.png"}, timeout=15).json()
    d = requests.delete(f"{API}/photography/gallery/{p['id']}", headers=admin_headers, timeout=15)
    assert d.status_code == 200
    assert d.json()["deleted"] == 1
    r = requests.get(f"{API}/photography/gallery/{p['id']}", headers=admin_headers, timeout=15)
    assert r.status_code == 404


def test_delete_requires_admin(uploaded_photo):
    r = requests.delete(f"{API}/photography/gallery/{uploaded_photo['id']}", timeout=15)
    assert r.status_code in (401, 403)
