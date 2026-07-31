"""GET /bookings?dog_id=X — added after an incident where a cleanup script
assumed this filter already existed. It didn't: FastAPI silently drops
unrecognized query params, so the call returned the endpoint's unfiltered
default window (~3000 rows), and the script bulk-cancelled ~1150 unrelated
bookings by looping over that response. This is the regression guard.
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

from conftest import safe_bulk_cleanup, BulkCleanupAborted

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_client_dog(admin_headers, tag):
    client = requests.post(f"{API}/clients", headers=admin_headers,
                            json={"name": f"DogIdFilter Client {tag}"}, timeout=15).json()
    dog = requests.post(f"{API}/dogs", headers=admin_headers,
                         json={"owner_id": client["id"], "name": f"DogIdFilter Dog {tag}",
                               "vaccines": {"rabies": "2030-01-01"}}, timeout=15).json()
    return client, dog


def _booking_payload(dog_id, day_offset):
    d = (date.today() + timedelta(days=day_offset)).isoformat()
    return {"dog_id": dog_id, "service_type": "daycare", "date": d, "end_date": d,
            "override_capacity": True, "override_vaccines": True}


def test_dog_id_filter_returns_only_that_dogs_bookings(admin_headers):
    tag = uuid.uuid4().hex[:8]
    client_a, dog_a = _make_client_dog(admin_headers, f"{tag}-a")
    client_b, dog_b = _make_client_dog(admin_headers, f"{tag}-b")
    booking_a_ids = []
    booking_b_ids = []
    try:
        for i in range(2):
            r = requests.post(f"{API}/bookings", headers=admin_headers,
                               json=_booking_payload(dog_a["id"], day_offset=10 + i), timeout=15)
            assert r.status_code == 200, r.text
            booking_a_ids.append(r.json()["id"])
        r = requests.post(f"{API}/bookings", headers=admin_headers,
                           json=_booking_payload(dog_b["id"], day_offset=10), timeout=15)
        assert r.status_code == 200, r.text
        booking_b_ids.append(r.json()["id"])

        r = requests.get(f"{API}/bookings", headers=admin_headers,
                          params={"dog_id": dog_a["id"], "include_all": "true"}, timeout=15)
        assert r.status_code == 200, r.text
        results = r.json()
        result_ids = {b["id"] for b in results}

        # Only dog_a's bookings come back — dog_b's must not appear.
        assert set(booking_a_ids).issubset(result_ids)
        assert not (set(booking_b_ids) & result_ids)
        assert all(b["dog_id"] == dog_a["id"] for b in results)

        # This is the exact safety net that would have caught the incident:
        # a cleanup loop scoped to "this dog's bookings" must never see a
        # blast radius of thousands.
        cleanup_ids = safe_bulk_cleanup(result_ids := list(result_ids), expected_count=len(booking_a_ids))
        for bid in cleanup_ids:
            requests.delete(f"{API}/bookings/{bid}", headers=admin_headers, timeout=15)
    finally:
        for bid in booking_b_ids:
            requests.delete(f"{API}/bookings/{bid}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/dogs/{dog_a['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/dogs/{dog_b['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/clients/{client_a['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{API}/clients/{client_b['id']}", headers=admin_headers, timeout=15)


def test_nonexistent_dog_id_returns_empty_not_the_unfiltered_window(admin_headers):
    """The exact failure mode from the incident: a filter that matches
    nothing must return nothing, never silently fall back to "everything"."""
    bogus_dog_id = f"nonexistent-{uuid.uuid4().hex}"
    r = requests.get(f"{API}/bookings", headers=admin_headers,
                      params={"dog_id": bogus_dog_id, "include_all": "true"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_safe_bulk_cleanup_aborts_on_unexpected_count():
    """Guard-rail sanity check on the helper itself: if a caller expects to
    clean up exactly 1 record but the collected ID list has more (the
    signature of a filter that silently matched too much), it must refuse
    rather than proceed."""
    with pytest.raises(BulkCleanupAborted):
        safe_bulk_cleanup(["a", "b", "c"], expected_count=1)


def test_safe_bulk_cleanup_aborts_above_max_allowed():
    huge_id_list = [str(i) for i in range(3000)]
    with pytest.raises(BulkCleanupAborted):
        safe_bulk_cleanup(huge_id_list, max_allowed=20)
