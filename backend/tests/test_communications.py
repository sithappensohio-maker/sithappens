"""Sprint 110ey — Phase 8: Client communication log regression."""
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


def test_full_communication_lifecycle(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    client = requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"CL-{suffix}", "email": f"cl-{suffix}@e.com"},
        timeout=15,
    ).json()
    try:
        # ── Create
        r = requests.post(
            f"{BASE}/api/communications", headers=admin_headers,
            json={"client_id": client["id"], "type": "complaint",
                  "summary": "owner upset about late pickup time",
                  "follow_up_required": True, "follow_up_date": "2026-06-25"},
            timeout=15,
        )
        r.raise_for_status()
        entry = r.json()
        assert entry["type"] == "complaint"
        assert entry["follow_up_required"] is True
        assert entry["created_by_name"]      # actor stamped
        assert entry["occurred_at"]          # auto-defaulted to now
        eid = entry["id"]

        # ── Bad type rejected
        bad = requests.post(
            f"{BASE}/api/communications", headers=admin_headers,
            json={"client_id": client["id"], "type": "telegraph", "summary": "x"},
            timeout=15,
        )
        assert bad.status_code == 400

        # ── List by client_id + filter open_followups
        listed = requests.get(
            f"{BASE}/api/communications?client_id={client['id']}&follow_up_open=true",
            headers=admin_headers, timeout=15,
        ).json()
        assert any(e["id"] == eid for e in listed["entries"])
        assert "complaint" in listed["types"] and "phone_call" in listed["types"]

        # ── Edit summary
        upd = requests.put(
            f"{BASE}/api/communications/{eid}", headers=admin_headers,
            json={"summary": "owner upset · escalated to owner"}, timeout=15,
        ).json()
        assert upd["summary"] == "owner upset · escalated to owner"

        # ── Resolve follow-up
        resolved = requests.post(
            f"{BASE}/api/communications/{eid}/resolve",
            headers=admin_headers, timeout=15,
        ).json()
        assert resolved["follow_up_required"] is False
        assert resolved["follow_up_resolved_at"]

        # ── Now NOT in open_followups
        open_listed = requests.get(
            f"{BASE}/api/communications?client_id={client['id']}&follow_up_open=true",
            headers=admin_headers, timeout=15,
        ).json()
        assert not any(e["id"] == eid for e in open_listed["entries"])

        # ── Filter by type
        type_listed = requests.get(
            f"{BASE}/api/communications?client_id={client['id']}&type=complaint",
            headers=admin_headers, timeout=15,
        ).json()
        assert all(e["type"] == "complaint" for e in type_listed["entries"])

        # ── Delete
        d = requests.delete(f"{BASE}/api/communications/{eid}", headers=admin_headers, timeout=15)
        d.raise_for_status()
        gone = requests.get(f"{BASE}/api/communications/{eid}", headers=admin_headers, timeout=15)
        assert gone.status_code == 404
    finally:
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_comm_dog_must_belong_to_client(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    c1 = requests.post(f"{BASE}/api/clients", headers=admin_headers,
                       json={"name": f"A-{suffix}", "email": f"a-{suffix}@e.com"}, timeout=15).json()
    c2 = requests.post(f"{BASE}/api/clients", headers=admin_headers,
                       json={"name": f"B-{suffix}", "email": f"b-{suffix}@e.com"}, timeout=15).json()
    d1 = requests.post(f"{BASE}/api/dogs", headers=admin_headers,
                       json={"name": f"DogA-{suffix}", "owner_id": c1["id"], "breed": "Mix", "age_y": 3,
                             "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}},
                       timeout=15).json()
    try:
        # Trying to log a comm against c2 with d1 (owned by c1) → 400
        r = requests.post(
            f"{BASE}/api/communications", headers=admin_headers,
            json={"client_id": c2["id"], "dog_id": d1["id"], "type": "general", "summary": "x"},
            timeout=15,
        )
        assert r.status_code == 400, r.text
    finally:
        requests.delete(f"{BASE}/api/dogs/{d1['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{c1['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{c2['id']}", headers=admin_headers, timeout=15)
