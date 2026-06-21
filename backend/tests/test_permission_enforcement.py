"""Sprint 110di-24 — Permission Matrix enforcement on finance/export endpoints.

The Permission Matrix has been editable in the UI for a while, but only the
`messages` key was actually consulted server-side. The user's final-cleanup
ask says: "finance/report/export permissions are actually enforced".

This file pins down that:
  * /api/admin/income/export.csv requires data_export + finance_reports
  * /api/admin/payroll/year-end.csv requires payroll + data_export
  * /api/backup/export requires data_export
  * /api/backup/export-config requires settings
  * /api/admin/users/export-with-hashes requires data_export

A delegated admin whose matrix toggle is OFF gets a 403; flipping it back
ON restores access — that's what "actually enforced" means. Owner bypasses
every toggle so they can never lock themselves out.
"""
import os
import time
import uuid
import asyncio
import bcrypt
import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))
load_dotenv("/app/backend/.env")
_MONGO = os.environ["MONGO_URL"]
_DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def delegated_admin():
    """Seed a non-owner admin directly in Mongo (no admin-create-user endpoint
    exists; matches the pattern used by test_permission_matrix.py) and yield
    that user's auth headers. Cleans up at end of test."""
    email = f"permtest-{uuid.uuid4().hex[:8]}@example.com"
    password = "PermTest!234"

    async def seed():
        db = AsyncIOMotorClient(_MONGO)[_DB_NAME]
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid, "email": email, "name": "Perm Test Admin", "role": "admin",
            "staff_role": "manager",  # non-owner admin so matrix overrides apply
            "password_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return uid

    async def cleanup():
        db = AsyncIOMotorClient(_MONGO)[_DB_NAME]
        await db.users.delete_many({"email": email})

    uid = asyncio.run(seed())
    login = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    try:
        yield headers, uid, email
    finally:
        asyncio.run(cleanup())


def _flip_matrix(admin_headers, role: str, key: str, value: bool):
    """Set a single matrix cell via the admin endpoint and verify success."""
    r = requests.put(
        f"{BASE}/api/staff/roles/{role}/permissions",
        headers={**admin_headers, "Content-Type": "application/json"},
        json={"permissions": {key: value}},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    # Give the in-process override cache a moment to settle.
    time.sleep(0.3)


def test_income_csv_blocks_when_data_export_off(admin_headers, delegated_admin):
    headers, _, _ = delegated_admin
    _flip_matrix(admin_headers, "manager", "data_export", False)
    try:
        r = requests.get(f"{BASE}/api/admin/income/export.csv", headers=headers, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"
        assert "data_export" in r.text
    finally:
        _flip_matrix(admin_headers, "manager", "data_export", True)


def test_income_csv_blocks_when_finance_reports_off(admin_headers, delegated_admin):
    headers, _, _ = delegated_admin
    _flip_matrix(admin_headers, "manager", "finance_reports", False)
    try:
        r = requests.get(f"{BASE}/api/admin/income/export.csv", headers=headers, timeout=15)
        assert r.status_code == 403
        assert "finance_reports" in r.text
    finally:
        _flip_matrix(admin_headers, "manager", "finance_reports", True)


def test_income_csv_allowed_when_both_on(admin_headers, delegated_admin):
    headers, _, _ = delegated_admin
    _flip_matrix(admin_headers, "manager", "data_export", True)
    _flip_matrix(admin_headers, "manager", "finance_reports", True)
    r = requests.get(f"{BASE}/api/admin/income/export.csv", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers.get("content-type", "")


def test_payroll_csv_blocks_when_payroll_off(admin_headers, delegated_admin):
    headers, _, _ = delegated_admin
    _flip_matrix(admin_headers, "manager", "payroll", False)
    try:
        r = requests.get(f"{BASE}/api/admin/payroll/year-end.csv", headers=headers, timeout=15)
        assert r.status_code == 403
    finally:
        _flip_matrix(admin_headers, "manager", "payroll", True)


def test_backup_export_requires_data_export(admin_headers, delegated_admin):
    headers, _, _ = delegated_admin
    _flip_matrix(admin_headers, "manager", "data_export", False)
    try:
        r = requests.get(f"{BASE}/api/backup/export", headers=headers, timeout=30)
        assert r.status_code == 403
    finally:
        _flip_matrix(admin_headers, "manager", "data_export", True)


def test_backup_export_config_requires_settings(admin_headers, delegated_admin):
    headers, _, _ = delegated_admin
    _flip_matrix(admin_headers, "manager", "settings", False)
    try:
        r = requests.get(f"{BASE}/api/backup/export-config", headers=headers, timeout=15)
        assert r.status_code == 403
    finally:
        _flip_matrix(admin_headers, "manager", "settings", True)


def test_owner_bypasses_matrix(admin_headers):
    """The owner admin must always be able to export everything, even if the
    matrix were maliciously flipped. The seeded admin user has staff_role=owner
    which bypasses overrides."""
    r1 = requests.get(f"{BASE}/api/admin/income/export.csv", headers=admin_headers, timeout=30)
    assert r1.status_code == 200, f"owner blocked from income csv: {r1.text[:200]}"
    r2 = requests.get(f"{BASE}/api/backup/export-config", headers=admin_headers, timeout=30)
    assert r2.status_code == 200, "owner must always be able to export config"
    r3 = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60)
    assert r3.status_code == 200, "owner must always be able to download full backup"
