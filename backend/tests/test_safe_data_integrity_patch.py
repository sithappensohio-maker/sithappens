"""Regression coverage for safe-data patches: archive visibility, vaccine review gate,
and backend pricing quote. These tests are intentionally API-level and do not
drop/wipe existing business data."""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_full_backup_includes_bookings_archive(admin_headers):
    r = requests.get(f"{API}/backup/export", headers=admin_headers, timeout=60)
    r.raise_for_status()
    data = r.json()
    assert data["version"] >= 6
    assert "bookings_archive" in data.get("collections", {})


def test_backend_pricing_quote_three_night_boarding(admin_headers):
    # Ensure a default boarding service exists at a known price.
    svcs = requests.get(f"{API}/services", headers=admin_headers, timeout=15).json()
    default = next((s for s in svcs if s.get("service_type") == "boarding" and s.get("is_default")), None)
    if default:
        sid = default["id"]
        payload = {k: v for k, v in default.items() if k not in ("id", "_id", "created_at")}
        payload.update({"base_price": 50.0, "active": True, "is_default": True})
        rr = requests.put(f"{API}/services/{sid}", headers=admin_headers, json=payload, timeout=15)
        rr.raise_for_status()
    else:
        rr = requests.post(f"{API}/services", headers=admin_headers, json={
            "service_type": "boarding", "name": "Boarding", "base_price": 50.0,
            "is_default": True, "active": True,
        }, timeout=15)
        rr.raise_for_status()
    start = date.today() + timedelta(days=20)
    end = start + timedelta(days=3)
    r = requests.post(f"{API}/pricing/quote", headers=admin_headers, json={
        "service_type": "boarding",
        "date": start.isoformat(),
        "end_date": end.isoformat(),
    }, timeout=15)
    r.raise_for_status()
    q = r.json()
    assert q["billable_units"] == 3
    assert q["unit_label"] == "nights"
    assert q["estimated_price"] == 150.0


def test_zero_night_quote_rejected(admin_headers):
    d = date.today() + timedelta(days=21)
    r = requests.post(f"{API}/pricing/quote", headers=admin_headers, json={
        "service_type": "boarding",
        "date": d.isoformat(),
        "end_date": d.isoformat(),
    }, timeout=15)
    assert r.status_code == 400


def test_client_vaccine_upload_does_not_immediately_approve(admin_headers):
    # Create isolated client/dog/user so we do not touch real production records.
    suffix = uuid.uuid4().hex[:8]
    c = requests.post(f"{API}/clients", headers=admin_headers, json={
        "name": f"Vax Gate {suffix}", "email": f"vax-{suffix}@example.com",
    }, timeout=15)
    c.raise_for_status()
    client = c.json()
    d = requests.post(f"{API}/dogs", headers=admin_headers, json={
        "owner_id": client["id"], "name": f"GateDog {suffix}", "breed": "mix",
    }, timeout=15)
    d.raise_for_status()
    dog = d.json()
    password = "TestPass123!"
    u = requests.post(f"{API}/admin/users", headers=admin_headers, json={
        "email": client["email"], "password": password, "role": "client",
        "name": client["name"], "client_id": client["id"], "active": True,
    }, timeout=15)
    assert u.status_code in (200, 201), u.text
    login = requests.post(f"{API}/auth/login", json={"email": client["email"], "password": password}, timeout=15)
    login.raise_for_status()
    ch = {"Authorization": f"Bearer {login.json()['token']}"}
    exp = (date.today() + timedelta(days=365)).isoformat()
    up = requests.post(f"{API}/portal/dogs/{dog['id']}/vaccine-update", headers=ch, json={
        "vaccine": "rabies", "expires_on": exp,
        "photo": "data:image/jpeg;base64," + ("a" * 128),
    }, timeout=15)
    up.raise_for_status()
    assert up.json().get("status") == "pending_review"
    snap = requests.get(f"{API}/dogs/{dog['id']}", headers=admin_headers, timeout=15)
    snap.raise_for_status()
    vaccines = snap.json().get("vaccines") or {}
    cert = (snap.json().get("vaccine_certs") or {}).get("rabies") or {}
    assert vaccines.get("rabies") != exp
    assert cert.get("status") == "pending_review"
    assert cert.get("pending_expires_on") == exp
