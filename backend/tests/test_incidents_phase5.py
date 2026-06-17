"""Sprint 110ev — Phase 5: Incident upgrade + safety-flag auto-suggest."""
import os
import uuid
import pytest
import requests
from datetime import date


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


def _make_dog(admin_headers, suffix):
    client = requests.post(
        f"{BASE}/api/clients", headers=admin_headers,
        json={"name": f"Inc-{suffix}", "email": f"inc-{suffix}@e.com"},
        timeout=15,
    ).json()
    dog = requests.post(
        f"{BASE}/api/dogs", headers=admin_headers,
        json={"name": f"IncPup-{suffix}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
              "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}},
        timeout=15,
    ).json()
    return client, dog


def test_incident_new_severity_and_type(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    client, dog = _make_dog(admin_headers, suffix)
    try:
        # New granular type + tier
        inc = requests.post(
            f"{BASE}/api/incidents", headers=admin_headers,
            json={
                "dog_id": dog["id"], "date": date.today().isoformat(), "time": "10:00",
                "type": "human_directed_aggression",
                "severity": "critical",
                "description": "Sample description over 3 chars",
                "staff_involved": ["Alex", "Jamie"],
                "manager_reviewed": True,
                "client_notified": False,
                "internal_notes": "do not place in group settings until B-mod plan in place",
                "vet_required": True,
                "follow_up_required": True,
            },
            timeout=15,
        )
        inc.raise_for_status()
        body = inc.json()
        assert body["type"] == "human_directed_aggression"
        assert body["severity"] == "critical"
        assert body["staff_involved"] == ["Alex", "Jamie"]
        assert body["manager_reviewed"] is True
        assert body["internal_notes"].startswith("do not place")

        # Bad type rejected
        bad = requests.post(
            f"{BASE}/api/incidents", headers=admin_headers,
            json={"dog_id": dog["id"], "date": date.today().isoformat(),
                  "type": "rocket", "severity": "low", "description": "xxx"},
            timeout=15,
        )
        assert bad.status_code == 400

        # Bad severity rejected
        bad2 = requests.post(
            f"{BASE}/api/incidents", headers=admin_headers,
            json={"dog_id": dog["id"], "date": date.today().isoformat(),
                  "type": "bite", "severity": "spicy", "description": "xxx"},
            timeout=15,
        )
        assert bad2.status_code == 400

        # cleanup incidents
        for x in requests.get(f"{BASE}/api/incidents?dog_id={dog['id']}", headers=admin_headers, timeout=15).json():
            requests.delete(f"{BASE}/api/incidents/{x['id']}", headers=admin_headers, timeout=15)
    finally:
        requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_safety_flag_suggestions_from_incident(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    client, dog = _make_dog(admin_headers, suffix)
    try:
        # Baseline: no signals, no suggestions
        sug = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/safety-flag-suggestions",
            headers=admin_headers, timeout=15,
        ).json()
        assert sug["incident_count"] == 0
        assert sug["suggestions"] == []
        assert "Muzzle required" in sug["library"]

        # Log a bite — should produce muzzle / staff-only / human-reactive suggestions
        inc = requests.post(
            f"{BASE}/api/incidents", headers=admin_headers,
            json={"dog_id": dog["id"], "date": date.today().isoformat(),
                  "type": "bite", "severity": "high", "description": "test bite"},
            timeout=15,
        ).json()

        sug2 = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/safety-flag-suggestions",
            headers=admin_headers, timeout=15,
        ).json()
        labels = [s["flag"] for s in sug2["suggestions"]]
        assert "Muzzle required" in labels
        assert "Staff only" in labels
        assert sug2["incident_count"] >= 1

        # Apply muzzle — it should disappear from suggestions next call
        requests.put(
            f"{BASE}/api/dogs/{dog['id']}/safety-flags", headers=admin_headers,
            json={"flags": ["Muzzle required"]}, timeout=15,
        )
        sug3 = requests.get(
            f"{BASE}/api/dogs/{dog['id']}/safety-flag-suggestions",
            headers=admin_headers, timeout=15,
        ).json()
        new_labels = [s["flag"] for s in sug3["suggestions"]]
        assert "Muzzle required" not in new_labels, "Already-set flag must not be re-suggested"
        assert "Muzzle required" in sug3["current_flags"]

        # cleanup
        requests.delete(f"{BASE}/api/incidents/{inc['id']}", headers=admin_headers, timeout=15)
    finally:
        requests.delete(f"{BASE}/api/dogs/{dog['id']}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)
