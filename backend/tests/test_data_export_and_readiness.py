"""Tests for the Final Ops Polish — Data Export CSV endpoints + Operational Readiness checklist."""
import csv
import io
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


def _admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


EXPECTED_ENTITIES = {
    "clients", "dogs", "bookings", "waitlist",
    "intake_templates", "intake_submissions",
    "incidents", "safety_flags", "vaccines",
    "income", "communications", "timeclock",
}


def test_export_index_lists_all_entities():
    h = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/export-index", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
    # every entity present + integer count
    for ent in EXPECTED_ENTITIES:
        assert ent in data, f"missing entity: {ent}"
        assert isinstance(data[ent], int)
        assert data[ent] >= 0


def test_export_index_requires_admin():
    r = requests.get(f"{BASE_URL}/api/export-index", timeout=15)
    assert r.status_code in (401, 403)


def test_export_clients_returns_csv_with_headers():
    h = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/export/clients", headers=h, timeout=20)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("text/csv")
    cd = r.headers.get("content-disposition", "")
    assert "sithappens-clients-" in cd and ".csv" in cd
    assert "x-row-count" in {k.lower() for k in r.headers.keys()}
    # parseable as CSV with the documented header
    reader = csv.reader(io.StringIO(r.text))
    header = next(reader)
    assert header[:3] == ["id", "name", "email"]


def test_export_each_entity_returns_csv():
    """All 12 entities should return a valid CSV (even when empty)."""
    h = _admin_headers()
    for ent in EXPECTED_ENTITIES:
        r = requests.get(f"{BASE_URL}/api/export/{ent}", headers=h, timeout=20)
        assert r.status_code == 200, f"{ent} failed: {r.status_code} {r.text[:120]}"
        assert r.headers.get("content-type", "").startswith("text/csv"), ent
        reader = csv.reader(io.StringIO(r.text))
        header = next(reader)
        assert header[0] == "id", f"{ent} first column should be 'id'"
        assert len(header) >= 2, f"{ent} header too short"


def test_export_unknown_entity_returns_400():
    h = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/export/not_a_real_thing", headers=h, timeout=15)
    assert r.status_code == 400
    assert "Allowed" in r.json().get("detail", "")


def test_export_requires_auth():
    r = requests.get(f"{BASE_URL}/api/export/clients", timeout=15)
    assert r.status_code in (401, 403)


def test_readiness_checklist_shape():
    h = _admin_headers()
    r = requests.get(f"{BASE_URL}/api/admin/readiness", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "checks" in data and isinstance(data["checks"], list)
    assert data["total"] == len(data["checks"])
    assert 0 <= data["completed"] <= data["total"]
    ids = {c["id"] for c in data["checks"]}
    # the 9 documented setup checks
    for k in ("hours", "services", "vaccines", "waiver", "intake",
              "reviews", "roles", "kennels", "backup"):
        assert k in ids, f"missing readiness check: {k}"
    for c in data["checks"]:
        assert "label" in c and "done" in c and "goto" in c and "fix" in c
        assert isinstance(c["done"], bool)


def test_readiness_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/readiness", timeout=15)
    assert r.status_code in (401, 403)
