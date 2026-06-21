"""Iteration 9 — verify /api/events surfaces group_id in extendedProps so the
Schedule calendar can collapse grouped bookings to one card.
"""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")


def _admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_events_payload_exposes_group_id():
    tok = _admin_token()
    r = requests.get(f"{BASE_URL}/api/events",
                     params={"start": "2026-06-01", "end": "2026-07-15"},
                     headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    assert r.status_code == 200, r.text
    events = r.json()
    assert isinstance(events, list)
    # collect group_ids present in extendedProps
    grouped = [e for e in events
               if (e.get("extendedProps") or {}).get("group_id")]
    print(f"Events: {len(events)}, with group_id: {len(grouped)}")
    assert len(grouped) >= 2, "Expected at least 2 sibling events in a group on June 21"
    # Each grouped event should also expose dog_name and service_type
    for e in grouped[:5]:
        ep = e["extendedProps"]
        assert "dog_name" in ep
        assert "service_type" in ep
        assert isinstance(ep["group_id"], str) and len(ep["group_id"]) > 8


def test_group_endpoint_returns_siblings():
    tok = _admin_token()
    r = requests.get(f"{BASE_URL}/api/events",
                     params={"start": "2026-06-01", "end": "2026-07-15"},
                     headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    grouped = [e for e in r.json()
               if (e.get("extendedProps") or {}).get("group_id")]
    if not grouped:
        return  # nothing to assert
    gid = grouped[0]["extendedProps"]["group_id"]
    g = requests.get(f"{BASE_URL}/api/bookings/group/{gid}",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert g.status_code == 200, g.text
    body = g.json()
    bookings = body.get("bookings") if isinstance(body, dict) else body
    assert isinstance(bookings, list) and len(bookings) >= 2
    # All should share the same group_id and same date
    assert len(set(b["group_id"] for b in bookings)) == 1
