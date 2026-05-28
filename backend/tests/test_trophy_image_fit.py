"""Sprint 110ak — Trophy custom-image upload now supports three fit modes
(circle / contain / freeform). New rows store the choice; PATCH propagates
it to historical awards; share-card PNG keeps rendering successfully for
each mode."""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")

# 1×1 transparent PNG, base64. Enough for the share-card renderer to load
# (and not error out) when we exercise each fit mode end-to-end.
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/Pgi9HgAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_trophy_create_persists_image_fit(admin_headers):
    code = f"test_imgfit_{uuid.uuid4().hex[:8]}"
    body = {
        "code": code,
        "name": "Test Image Fit Trophy",
        "category": "dog",
        "tier": "gold",
        "custom_image": TINY_PNG,
        "image_fit": "freeform",
    }
    r = requests.post(f"{BASE}/api/trophies/catalog", json=body, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["image_fit"] == "freeform"
    try:
        # Catalog GET surfaces the new field
        catalog = requests.get(f"{BASE}/api/trophies/catalog", headers=admin_headers, timeout=15).json()
        ours = next((t for t in catalog["trophies"] if t["code"] == code), None)
        assert ours is not None
        assert ours["image_fit"] == "freeform"

        # PATCH the field — `contain` should win
        r2 = requests.put(
            f"{BASE}/api/trophies/catalog/{code}",
            json={"image_fit": "contain"},
            headers=admin_headers,
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["image_fit"] == "contain"
    finally:
        requests.delete(f"{BASE}/api/trophies/catalog/{code}", headers=admin_headers, timeout=15)


def test_trophy_default_image_fit_is_circle(admin_headers):
    """Trophies created without specifying image_fit default to 'circle' —
    matches the legacy behaviour so no existing trophy changes appearance."""
    code = f"test_default_fit_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE}/api/trophies/catalog",
        json={"code": code, "name": "Default Fit", "category": "dog", "tier": "bronze"},
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    try:
        assert r.json().get("image_fit") == "circle"
    finally:
        requests.delete(f"{BASE}/api/trophies/catalog/{code}", headers=admin_headers, timeout=15)


def test_trophy_invalid_image_fit_rejected(admin_headers):
    """Unknown fit modes are rejected by the Literal validator."""
    code = f"test_bad_fit_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE}/api/trophies/catalog",
        json={"code": code, "name": "Bad Fit", "category": "dog", "image_fit": "potato"},
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 422


def test_share_card_renders_for_every_fit_mode(admin_headers):
    """Generate one of each fit mode, award it, fetch the PNG, ensure the
    bytes are valid PNGs (not the JSON error path)."""
    for fit in ("circle", "contain", "freeform"):
        code = f"test_share_{fit}_{uuid.uuid4().hex[:8]}"
        # Create catalog row
        r = requests.post(
            f"{BASE}/api/trophies/catalog",
            json={
                "code": code, "name": f"Share {fit}", "category": "dog",
                "tier": "silver", "custom_image": TINY_PNG, "image_fit": fit,
            },
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        try:
            # Pick any dog to award
            dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
            dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
            assert dogs, "no dogs in DB to award against"
            dog_id = dogs[0]["id"]
            r2 = requests.post(
                f"{BASE}/api/dogs/{dog_id}/trophies/{code}/award",
                json={"note": f"test {fit}"},
                headers=admin_headers, timeout=15,
            )
            assert r2.status_code == 200, r2.text
            awarded_id = r2.json()["id"]
            # Award snapshotted the fit
            assert r2.json().get("trophy_image_fit") == fit

            # Public share PNG renders without error
            png = requests.get(f"{BASE}/api/trophies/share-card/{awarded_id}.png", timeout=30)
            assert png.status_code == 200, png.text
            assert png.headers.get("content-type", "").startswith("image/png")
            assert png.content[:8] == b"\x89PNG\r\n\x1a\n", "not a valid PNG file"

            # Cleanup the award
            requests.delete(
                f"{BASE}/api/awarded-trophies/{awarded_id}",
                headers=admin_headers, timeout=15,
            )
        finally:
            requests.delete(f"{BASE}/api/trophies/catalog/{code}", headers=admin_headers, timeout=15)


def test_trophy_image_offset_defaults_and_persists(admin_headers):
    """Sprint 110al — image_offset_x / _y default to 50 (centre), accept
    0–100, and round-trip on PATCH so the drag-to-reposition handle survives
    a reload."""
    code = f"test_offset_{uuid.uuid4().hex[:8]}"
    body = {
        "code": code,
        "name": "Offset test",
        "category": "dog",
        "tier": "silver",
        "custom_image": TINY_PNG,
        "image_offset_x": 25,
        "image_offset_y": 75,
    }
    r = requests.post(f"{BASE}/api/trophies/catalog", json=body, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    try:
        created = r.json()
        assert created["image_offset_x"] == 25
        assert created["image_offset_y"] == 75
        # PATCH each axis independently
        r2 = requests.put(
            f"{BASE}/api/trophies/catalog/{code}",
            json={"image_offset_x": 90, "image_offset_y": 10},
            headers=admin_headers,
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["image_offset_x"] == 90
        assert r2.json()["image_offset_y"] == 10
    finally:
        requests.delete(f"{BASE}/api/trophies/catalog/{code}", headers=admin_headers, timeout=15)


def test_trophy_image_offset_clamped(admin_headers):
    """Offsets outside 0-100 must be rejected by the Field validator."""
    code = f"test_offset_oor_{uuid.uuid4().hex[:8]}"
    for bad in (-10, 200):
        r = requests.post(
            f"{BASE}/api/trophies/catalog",
            json={"code": code, "name": "Bad offset", "category": "dog", "image_offset_x": bad},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 422, f"offset {bad} should be rejected · got {r.status_code}: {r.text}"


def test_image_offset_snapshotted_and_propagated(admin_headers):
    """Awards snapshot the offsets at award-time, and editing the catalog row
    propagates the new offsets to historical awards."""
    code = f"test_offset_prop_{uuid.uuid4().hex[:8]}"
    requests.post(
        f"{BASE}/api/trophies/catalog",
        json={
            "code": code, "name": "Offset prop", "category": "dog",
            "tier": "gold", "custom_image": TINY_PNG,
            "image_offset_x": 30, "image_offset_y": 70,
        },
        headers=admin_headers, timeout=15,
    )
    try:
        dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
        dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
        dog_id = dogs[0]["id"]
        award = requests.post(
            f"{BASE}/api/dogs/{dog_id}/trophies/{code}/award",
            json={"note": "prop"},
            headers=admin_headers, timeout=15,
        ).json()
        awarded_id = award["id"]
        assert award["trophy_image_offset_x"] == 30
        assert award["trophy_image_offset_y"] == 70

        # Move it
        requests.put(
            f"{BASE}/api/trophies/catalog/{code}",
            json={"image_offset_x": 80, "image_offset_y": 20},
            headers=admin_headers, timeout=15,
        )

        # Historical award reflects new offset
        dog_awards = requests.get(f"{BASE}/api/dogs/{dog_id}/trophies", headers=admin_headers, timeout=15).json()
        awards = dog_awards if isinstance(dog_awards, list) else dog_awards.get("awarded", []) or dog_awards.get("trophies", [])
        ours = next((a for a in awards if a["id"] == awarded_id), None)
        assert ours is not None
        assert ours["trophy_image_offset_x"] == 80
        assert ours["trophy_image_offset_y"] == 20

        requests.delete(f"{BASE}/api/awarded-trophies/{awarded_id}", headers=admin_headers, timeout=15)
    finally:
        requests.delete(f"{BASE}/api/trophies/catalog/{code}", headers=admin_headers, timeout=15)


def test_image_fit_propagates_to_historical_awards(admin_headers):
    """Editing image_fit on the catalog row must update every previously
    awarded copy, the same way custom_image already does."""
    code = f"test_propagate_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE}/api/trophies/catalog",
        json={
            "code": code, "name": "Propagation test", "category": "dog",
            "tier": "platinum", "custom_image": TINY_PNG, "image_fit": "circle",
        },
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200
    try:
        # Award it
        dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
        dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
        dog_id = dogs[0]["id"]
        award = requests.post(
            f"{BASE}/api/dogs/{dog_id}/trophies/{code}/award",
            json={"note": "propagation"},
            headers=admin_headers, timeout=15,
        ).json()
        awarded_id = award["id"]
        assert award["trophy_image_fit"] == "circle"

        # Flip the catalog row to freeform
        requests.put(
            f"{BASE}/api/trophies/catalog/{code}",
            json={"image_fit": "freeform"},
            headers=admin_headers, timeout=15,
        )

        # Awarded row should reflect the new fit
        dog_awards = requests.get(
            f"{BASE}/api/dogs/{dog_id}/trophies",
            headers=admin_headers, timeout=15,
        ).json()
        awards = dog_awards if isinstance(dog_awards, list) else dog_awards.get("awarded", []) or dog_awards.get("trophies", [])
        ours = next((a for a in awards if a["id"] == awarded_id), None)
        assert ours is not None, f"award {awarded_id} not found in {dog_awards}"
        assert ours["trophy_image_fit"] == "freeform", (
            f"image_fit did not propagate to historical awards · got {ours.get('trophy_image_fit')}"
        )

        # Cleanup
        requests.delete(
            f"{BASE}/api/awarded-trophies/{awarded_id}",
            headers=admin_headers, timeout=15,
        )
    finally:
        requests.delete(f"{BASE}/api/trophies/catalog/{code}", headers=admin_headers, timeout=15)
