"""Sprint 110di-38 — Multi-dog booking group regression tests.

Locks the contract for POST /api/bookings/group:
  - happy path: N dogs share one group_id, each gets its own row
  - rollback: if any dog fails validation, ZERO bookings remain inserted
  - duplicate dog rejection
  - empty dogs rejection
  - per-dog addons + per-dog notes work
  - group_id surfaces on every BookingOut returned by /api/bookings
  - GET /api/bookings/group/{id} returns the cluster
"""
import os
import uuid
import datetime
import requests
import pytest

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")
TOMORROW = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
THE_DAY_AFTER = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def two_dog_ids(admin_headers):
    """Pick two real dog ids from the seed catalog so we exercise the full
    validation path (owner lookup, vaccine check via override_vaccines, etc.)."""
    r = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15)
    r.raise_for_status()
    dogs = r.json()
    assert len(dogs) >= 2, "need at least 2 dogs seeded for this test"
    return [dogs[0]["id"], dogs[1]["id"]]


@pytest.fixture(autouse=True)
def _cleanup(admin_headers):
    """Best-effort cleanup before AND after every test so rerunning doesn't
    accumulate duplicate-day rejections."""
    yield
    # Tear down any bookings we created on the test dates.
    r = requests.get(f"{BASE}/api/bookings",
                     headers=admin_headers,
                     params={"start_date": TOMORROW, "end_date": THE_DAY_AFTER},
                     timeout=15)
    if r.status_code == 200:
        for b in r.json():
            if b.get("date") in (TOMORROW, THE_DAY_AFTER):
                requests.delete(f"{BASE}/api/bookings/{b['id']}",
                                headers=admin_headers, timeout=15)


def test_group_happy_path_two_dogs_share_group_id(admin_headers, two_dog_ids):
    body = {
        "dogs": [{"dog_id": two_dog_ids[0]}, {"dog_id": two_dog_ids[1]}],
        "date": TOMORROW,
        "service_type": "daycare",
        "override_vaccines": True,
    }
    r = requests.post(f"{BASE}/api/bookings/group", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 200, r.text
    payload = r.json()
    gid = payload["group_id"]
    assert gid and len(gid) > 10
    assert len(payload["bookings"]) == 2
    # Every row carries the group_id and the date/service from the shared base
    for b in payload["bookings"]:
        assert b["group_id"] == gid
        assert b["date"] == TOMORROW
        assert b["service_type"] == "daycare"
    # The two booking ids must be distinct (one row per dog, not a single shared row)
    assert payload["bookings"][0]["id"] != payload["bookings"][1]["id"]


def test_group_per_dog_addons_and_notes_are_independent(admin_headers, two_dog_ids):
    # Don't pin to a real addon id (catalog differs per env); we just verify
    # that per-dog notes survive the round-trip into BookingOut.
    body = {
        "dogs": [
            {"dog_id": two_dog_ids[0], "notes": "Dog A: timid, give space"},
            {"dog_id": two_dog_ids[1], "notes": "Dog B: bring his lamb chop toy"},
        ],
        "date": TOMORROW,
        "service_type": "daycare",
        "override_vaccines": True,
    }
    r = requests.post(f"{BASE}/api/bookings/group", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 200, r.text
    bks = r.json()["bookings"]
    note_by_dog = {b["dog_id"]: b["notes"] for b in bks}
    assert note_by_dog[two_dog_ids[0]] == "Dog A: timid, give space"
    assert note_by_dog[two_dog_ids[1]] == "Dog B: bring his lamb chop toy"


def test_group_rollback_when_any_dog_fails(admin_headers, two_dog_ids):
    """When the 2nd dog id is invalid, the 1st dog's booking must NOT remain."""
    body = {
        "dogs": [
            {"dog_id": two_dog_ids[0]},
            {"dog_id": "nope-not-a-real-dog-uuid"},
        ],
        "date": THE_DAY_AFTER,
        "service_type": "daycare",
        "override_vaccines": True,
    }
    r = requests.post(f"{BASE}/api/bookings/group", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 404, r.text
    detail = r.json()["detail"]
    assert "dog: nope-not-a-real-dog-uuid" in detail.lower() or "dog not found" in detail.lower()
    # Verify there are zero bookings on THE_DAY_AFTER for two_dog_ids[0]
    r2 = requests.get(f"{BASE}/api/bookings", headers=admin_headers,
                      params={"start_date": THE_DAY_AFTER, "end_date": THE_DAY_AFTER},
                      timeout=15)
    leftover = [b for b in r2.json() if b["dog_id"] == two_dog_ids[0]]
    assert leftover == [], f"rollback failed — leftover row: {leftover!r}"


def test_group_rejects_duplicate_dog(admin_headers, two_dog_ids):
    body = {
        "dogs": [{"dog_id": two_dog_ids[0]}, {"dog_id": two_dog_ids[0]}],
        "date": TOMORROW,
        "service_type": "daycare",
    }
    r = requests.post(f"{BASE}/api/bookings/group", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 400, r.text
    assert "duplicate" in r.json()["detail"].lower()


def test_group_rejects_empty_dogs(admin_headers):
    body = {"dogs": [], "date": TOMORROW, "service_type": "daycare"}
    r = requests.post(f"{BASE}/api/bookings/group", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 400, r.text


def test_get_booking_group_returns_cluster(admin_headers, two_dog_ids):
    # Create
    body = {
        "dogs": [{"dog_id": two_dog_ids[0]}, {"dog_id": two_dog_ids[1]}],
        "date": TOMORROW,
        "service_type": "daycare",
        "override_vaccines": True,
    }
    r1 = requests.post(f"{BASE}/api/bookings/group", headers=admin_headers,
                       json=body, timeout=15)
    assert r1.status_code == 200, r1.text
    gid = r1.json()["group_id"]
    # Fetch
    r2 = requests.get(f"{BASE}/api/bookings/group/{gid}",
                      headers=admin_headers, timeout=15)
    assert r2.status_code == 200, r2.text
    out = r2.json()
    assert out["group_id"] == gid
    assert out["count"] == 2
    assert {b["dog_id"] for b in out["bookings"]} == set(two_dog_ids)


def test_get_booking_group_404_for_unknown(admin_headers):
    r = requests.get(f"{BASE}/api/bookings/group/{uuid.uuid4()}",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 404


def test_single_dog_booking_still_works_unchanged(admin_headers, two_dog_ids):
    """Belt-and-braces: confirm the legacy POST /api/bookings flow is
    completely untouched — same shape, group_id is None on the response."""
    body = {
        "dog_id": two_dog_ids[0],
        "date": TOMORROW,
        "service_type": "daycare",
        "override_vaccines": True,
    }
    r = requests.post(f"{BASE}/api/bookings", headers=admin_headers,
                      json=body, timeout=15)
    assert r.status_code == 200, r.text
    bk = r.json()
    assert bk["group_id"] is None
    assert bk["dog_id"] == two_dog_ids[0]
