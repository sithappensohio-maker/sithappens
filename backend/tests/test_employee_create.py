"""Regression tests for POST /api/admin/employees.

The frontend modal at Staff → Add Employee used to crash with
"Objects are not valid as a React child" whenever the backend returned a
Pydantic 422 validation error (because the `detail` field is an array of
objects). The frontend axios interceptor now coerces that into a string,
but we still want a backend-side sanity net to lock in the contract:

  - happy path returns 200 with an EmployeeOut shape
  - duplicate email returns 400 (string detail)
  - invalid email returns 422 (Pydantic array detail)
  - short password returns 422 (Pydantic array detail)
"""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}",
            "Content-Type": "application/json"}


def test_employee_create_happy_path(admin_headers):
    email = f"pytest-create-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE}/api/admin/employees", headers=admin_headers,
                      json={"email": email, "name": "Pytest Bot",
                            "password": "pytest1234"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == email
    assert body["role"] == "employee"
    assert body["staff_role"] == "read_only"


def test_employee_create_duplicate_email_returns_string_detail(admin_headers):
    """Existing-email collision must return a string detail (not an array)."""
    email = f"pytest-dup-{uuid.uuid4().hex[:8]}@example.com"
    r1 = requests.post(f"{BASE}/api/admin/employees", headers=admin_headers,
                       json={"email": email, "name": "Dup",
                             "password": "pytest1234"}, timeout=15)
    assert r1.status_code == 200, r1.text
    r2 = requests.post(f"{BASE}/api/admin/employees", headers=admin_headers,
                       json={"email": email, "name": "Dup2",
                             "password": "pytest1234"}, timeout=15)
    assert r2.status_code == 400, r2.text
    detail = r2.json()["detail"]
    assert isinstance(detail, str), f"expected string detail, got {type(detail)}"
    assert "already exists" in detail.lower()


def test_employee_create_invalid_email_returns_422_array_detail(admin_headers):
    """Pydantic returns a list-of-objects detail for invalid email — the
    frontend interceptor in /app/frontend/src/lib/api.js coerces this into
    a string before React renders it. We assert the backend keeps returning
    the array (so the interceptor's contract is real)."""
    r = requests.post(f"{BASE}/api/admin/employees", headers=admin_headers,
                      json={"email": "not-an-email", "name": "Bad",
                            "password": "pytest1234"}, timeout=15)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert isinstance(detail, list), f"expected list detail, got {type(detail)}"
    assert any("email" in (e.get("loc") or []) for e in detail)


def test_employee_create_short_password_returns_422(admin_headers):
    r = requests.post(f"{BASE}/api/admin/employees", headers=admin_headers,
                      json={"email": f"shortpw-{uuid.uuid4().hex[:6]}@example.com",
                            "name": "Short", "password": "abc"}, timeout=15)
    assert r.status_code == 422, r.text
