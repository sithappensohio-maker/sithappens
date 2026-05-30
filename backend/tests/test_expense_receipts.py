"""Sprint 110ap — Expenses now carry an optional `receipt_image` (base64
data URL) + `receipt_filename` for IRS-grade audit trail. Image or PDF."""
import os
import uuid
from datetime import date

import pytest
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")

# 1×1 transparent PNG, base64 — enough to round-trip the upload flow.
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/Pgi9HgAAAABJRU5ErkJggg=="
)
TINY_PDF = "data:application/pdf;base64,JVBERi0xLjQKJYCAgIAKMSAwIG9iag=="


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_expense(headers, **overrides):
    body = {
        "date": date.today().isoformat(),
        "description": f"Test expense {uuid.uuid4().hex[:6]}",
        "amount": 25.0,
        "category": "Supplies",
        "payment_method": "card",
        **overrides,
    }
    r = requests.post(f"{BASE}/api/expenses", json=body, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_expense_create_without_receipt(admin_headers):
    e = _make_expense(admin_headers)
    try:
        # No receipt key should be set when not provided
        assert not e.get("receipt_image")
        assert not e.get("receipt_filename")
    finally:
        requests.delete(f"{BASE}/api/expenses/{e['id']}", headers=admin_headers, timeout=15)


def test_expense_create_with_image_receipt(admin_headers):
    e = _make_expense(admin_headers, receipt_image=TINY_PNG, receipt_filename="walmart.png")
    try:
        assert e["receipt_image"].startswith("data:image/")
        assert e["receipt_filename"] == "walmart.png"
        # Round-trip via list endpoint
        listing = requests.get(f"{BASE}/api/expenses", headers=admin_headers, timeout=15).json()
        ours = next((x for x in listing if x["id"] == e["id"]), None)
        assert ours is not None
        assert ours["receipt_image"] == TINY_PNG
    finally:
        requests.delete(f"{BASE}/api/expenses/{e['id']}", headers=admin_headers, timeout=15)


def test_expense_create_with_pdf_receipt(admin_headers):
    e = _make_expense(admin_headers, receipt_image=TINY_PDF, receipt_filename="invoice.pdf")
    try:
        assert e["receipt_image"].startswith("data:application/pdf")
        assert e["receipt_filename"] == "invoice.pdf"
    finally:
        requests.delete(f"{BASE}/api/expenses/{e['id']}", headers=admin_headers, timeout=15)


def test_expense_edit_attaches_receipt(admin_headers):
    """An existing receipt-less expense can have one attached later."""
    e = _make_expense(admin_headers)
    try:
        body = {
            "date": e["date"],
            "description": e["description"],
            "amount": e["amount"],
            "category": e.get("category", ""),
            "notes": e.get("notes", ""),
            "payment_method": e["payment_method"],
            "receipt_image": TINY_PNG,
            "receipt_filename": "added-later.png",
        }
        r = requests.put(f"{BASE}/api/expenses/{e['id']}", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["receipt_image"] == TINY_PNG
        assert r.json()["receipt_filename"] == "added-later.png"
    finally:
        requests.delete(f"{BASE}/api/expenses/{e['id']}", headers=admin_headers, timeout=15)


def test_expense_edit_removes_receipt(admin_headers):
    """Posting empty string for receipt_image unsets the field on the doc."""
    e = _make_expense(admin_headers, receipt_image=TINY_PNG, receipt_filename="r.png")
    try:
        body = {
            "date": e["date"],
            "description": e["description"],
            "amount": e["amount"],
            "category": e.get("category", ""),
            "notes": e.get("notes", ""),
            "payment_method": e["payment_method"],
            "receipt_image": "",
            "receipt_filename": "",
        }
        r = requests.put(f"{BASE}/api/expenses/{e['id']}", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # List endpoint should show no receipt_image key (or null)
        listing = requests.get(f"{BASE}/api/expenses", headers=admin_headers, timeout=15).json()
        ours = next((x for x in listing if x["id"] == e["id"]), None)
        assert ours is not None
        assert not ours.get("receipt_image"), f"receipt_image should be cleared · got {ours.get('receipt_image')!r}"
        assert not ours.get("receipt_filename")
    finally:
        requests.delete(f"{BASE}/api/expenses/{e['id']}", headers=admin_headers, timeout=15)


def test_expense_backup_includes_receipts(admin_headers):
    """Receipts ride along with the backup since `expenses` is one of the
    backed-up collections — important for tax-time disaster recovery."""
    e = _make_expense(admin_headers, receipt_image=TINY_PNG, receipt_filename="bk.png")
    try:
        backup = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60).json()
        expenses_in_backup = backup["collections"].get("expenses") or []
        ours = next((x for x in expenses_in_backup if x["id"] == e["id"]), None)
        assert ours is not None, "newly-created expense missing from backup"
        assert ours.get("receipt_image") == TINY_PNG, "receipt didn't make it into the backup"
    finally:
        requests.delete(f"{BASE}/api/expenses/{e['id']}", headers=admin_headers, timeout=15)
