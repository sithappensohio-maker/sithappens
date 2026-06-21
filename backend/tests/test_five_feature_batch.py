"""Sprint 110aw — 5-feature batch:
1. Birthday email toggle (default ON, respects setting OFF)
2. 1099/W2 year-end payroll CSV
3. Sales tax (booking checkout + retail + summary endpoint)
4. Meet-n-Greet workflow (client_status + booking gate)
5. Board-and-Train auto-enrollment when service has package_program_id
"""
import os
import uuid
from datetime import date

import pytest
import requests

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001"))


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ───── #1 Birthday email toggle ─────

def test_birthday_email_toggle_default_on(admin_headers):
    """The setting defaults to ON to preserve historical behavior."""
    s = requests.get(f"{BASE}/api/settings", headers=admin_headers, timeout=15).json()
    be = s.get("birthday_email") or {}
    assert be.get("enabled") is True


def test_birthday_email_toggle_off_blocks_job(admin_headers):
    """When toggled OFF, run_birthday_job returns disabled=True without sending."""
    # Flip OFF
    requests.put(
        f"{BASE}/api/settings",
        json={"birthday_email": {"enabled": False}},
        headers=admin_headers, timeout=15,
    )
    try:
        # Trigger daily jobs (resets the lock first)
        r = requests.post(f"{BASE}/api/admin/daily-jobs/run-now",
                          headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        out = r.json().get("result") or {}
        bday = out.get("birthdays") or {}
        assert bday.get("disabled") is True
        assert bday.get("sent", 0) == 0
    finally:
        # Restore default ON
        requests.put(
            f"{BASE}/api/settings",
            json={"birthday_email": {"enabled": True}},
            headers=admin_headers, timeout=15,
        )


# ───── #2 1099/W2 year-end CSV ─────

def test_payroll_year_end_csv(admin_headers):
    r = requests.get(
        f"{BASE}/api/admin/payroll/year-end.csv",
        params={"year": date.today().year},
        headers=admin_headers, timeout=30,
    )
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers.get("content-type", "")
    body = r.text
    # CSV must have the summary header row
    assert "Year-end payroll summary" in body
    assert "Total hours" in body and "Gross wages" in body
    assert "TOTAL" in body


# ───── #3 Sales tax ─────

def _enable_sales_tax(admin_headers, rate=8.875):
    requests.put(
        f"{BASE}/api/settings",
        json={"sales_tax": {
            "enabled": True, "rate_pct": rate, "label": "Sales Tax",
            "applies_to": {"daycare": True, "boarding": False, "training": False,
                           "grooming": True, "photography": True, "retail": True,
                           "credit_packs": False},
        }},
        headers=admin_headers, timeout=15,
    )


def _disable_sales_tax(admin_headers):
    requests.put(
        f"{BASE}/api/settings",
        json={"sales_tax": {"enabled": False, "rate_pct": 0.0,
                            "label": "Sales Tax", "applies_to": {}}},
        headers=admin_headers, timeout=15,
    )


def test_sales_tax_on_checkout_adds_breakdown(admin_headers):
    _enable_sales_tax(admin_headers, rate=10.0)
    try:
        # Find a vaccinated dog
        dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
        dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
        clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
        clients = clients if isinstance(clients, list) else clients.get("items", [])
        valid_ids = {c["id"] for c in clients if c.get("client_status") in (None, "active")}
        dog = next((d for d in dogs if d.get("owner_id") in valid_ids and (d.get("vaccines") or {}).get("rabies")), None)
        assert dog, "need a vaccinated dog of an active client"
        today = date.today().isoformat()
        # Daycare booking (taxable in our test config)
        r = requests.post(
            f"{BASE}/api/bookings",
            json={"dog_id": dog["id"], "date": today, "service_type": "daycare",
                  "override_capacity": True, "override_vaccines": True},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        try:
            requests.post(f"{BASE}/api/bookings/{bid}/approve", headers=admin_headers, timeout=15)
            requests.post(f"{BASE}/api/bookings/{bid}/check-in", headers=admin_headers, timeout=15)
            r = requests.post(
                f"{BASE}/api/bookings/{bid}/check-out",
                json={"base_price": 100.0, "payment_method": "cash", "mark_paid": True},
                headers=admin_headers, timeout=15,
            )
            assert r.status_code == 200, r.text
            out = r.json()
            # $100 + 10% = $110 total; tax_amount=$10
            assert out.get("tax_amount") == 10.0, f"tax_amount expected 10.00, got {out.get('tax_amount')}"
            assert out.get("tax_rate_pct") == 10.0
            # actual_price includes tax
            assert abs(float(out.get("actual_price") or 0) - 110.0) < 0.05
        finally:
            requests.delete(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15)
    finally:
        _disable_sales_tax(admin_headers)


def test_sales_tax_summary_endpoint(admin_headers):
    r = requests.get(
        f"{BASE}/api/admin/sales-tax/summary",
        params={"start_date": "2026-01-01", "end_date": "2026-12-31"},
        headers=admin_headers, timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("bookings_tax_total", "retail_tax_total", "total_tax_collected",
                "booking_count", "retail_count", "by_month"):
        assert key in body, f"missing {key}"


def test_retail_sale_tax_back_calculation(admin_headers):
    _enable_sales_tax(admin_headers, rate=10.0)
    try:
        # $110 retail sale incl. tax → pre_tax=$100, tax=$10
        r = requests.post(
            f"{BASE}/api/retail-sales",
            json={"date": date.today().isoformat(),
                  "description": "Test treat bag", "amount": 110.0,
                  "payment_method": "card"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        sale = r.json()
        assert abs(float(sale.get("tax_amount") or 0) - 10.0) < 0.05
        assert abs(float(sale.get("pre_tax_amount") or 0) - 100.0) < 0.05
        assert sale.get("tax_rate_pct") == 10.0
        # Cleanup
        requests.delete(f"{BASE}/api/retail-sales/{sale['id']}",
                        headers=admin_headers, timeout=15)
    finally:
        _disable_sales_tax(admin_headers)


# ───── #4 Meet-n-Greet workflow ─────

def test_client_status_transition(admin_headers):
    # Create a prospect client directly
    name = f"Prospect Test {uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{BASE}/api/clients",
        json={"name": name, "email": f"{name.replace(' ','.').lower()}@test.com",
              "client_status": "prospect"},
        headers=admin_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    try:
        # Status endpoint should advance and log a note
        r = requests.post(
            f"{BASE}/api/clients/{cid}/status",
            json={"status": "evaluation_scheduled", "note": "Booked for Friday"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["client_status"] == "evaluation_scheduled"
        assert "Friday" in (c.get("evaluation_notes") or "")
        # Mark active
        r = requests.post(
            f"{BASE}/api/clients/{cid}/status",
            json={"status": "active", "note": "Passed eval"},
            headers=admin_headers, timeout=15,
        )
        assert r.json()["client_status"] == "active"
    finally:
        requests.delete(f"{BASE}/api/clients/{cid}", headers=admin_headers, timeout=15)


# ───── #5 Board-and-Train auto-enrollment ─────

def test_board_and_train_auto_enrolls_dog(admin_headers):
    # Find an existing program (any active one) to wire the service to
    programs = requests.get(f"{BASE}/api/programs", headers=admin_headers, timeout=15).json()
    programs = programs if isinstance(programs, list) else programs.get("items", [])
    program = next((p for p in programs if p.get("active", True)), None)
    if not program:
        pytest.skip("no programs available to test board-and-train")
    # Create a boarding service linked to that program
    svc = requests.post(
        f"{BASE}/api/services",
        json={"name": f"Test B&T {uuid.uuid4().hex[:5]}",
              "service_type": "boarding", "base_price": 850.0, "active": True,
              "package_program_id": program["id"]},
        headers=admin_headers, timeout=15,
    )
    if svc.status_code != 200:
        pytest.skip(f"could not create test service: {svc.text}")
    service = svc.json()
    bid = None
    enrollment_id = None
    try:
        # Find a dog whose owner is active and not already enrolled in this program
        dogs = requests.get(f"{BASE}/api/dogs", headers=admin_headers, timeout=15).json()
        dogs = dogs if isinstance(dogs, list) else dogs.get("items", [])
        clients = requests.get(f"{BASE}/api/clients", headers=admin_headers, timeout=15).json()
        clients = clients if isinstance(clients, list) else clients.get("items", [])
        valid_ids = {c["id"] for c in clients if c.get("client_status") in (None, "active")}
        candidate = None
        for d in dogs:
            if d.get("owner_id") not in valid_ids:
                continue
            if not (d.get("vaccines") or {}).get("rabies"):
                continue
            # Skip if already enrolled
            existing = requests.get(f"{BASE}/api/dogs/{d['id']}/programs",
                                    headers=admin_headers, timeout=15).json()
            existing = existing if isinstance(existing, list) else existing.get("items", [])
            already_in = any(e.get("program_id") == program["id"] and e.get("status") == "active" for e in existing)
            if not already_in:
                candidate = d; break
        if not candidate:
            pytest.skip("no eligible dog to test board-and-train enrollment")
        today = date.today().isoformat()
        end = (date.fromisoformat(today)).isoformat()  # one-night stay is enough for the test
        # Book using the package service
        r = requests.post(
            f"{BASE}/api/bookings",
            json={"dog_id": candidate["id"], "date": today, "end_date": end,
                  "service_type": "boarding", "service_id": service["id"],
                  "override_capacity": True, "override_vaccines": True},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        booking = r.json()
        bid = booking["id"]
        # The booking should record the enrolled program id
        assert booking.get("package_enrolled_program_id"), "expected package_enrolled_program_id on the booking"
        enrollment_id = booking["package_enrolled_program_id"]
        # Confirm the enrollment exists and is active
        progs = requests.get(f"{BASE}/api/dogs/{candidate['id']}/programs",
                             headers=admin_headers, timeout=15).json()
        progs = progs if isinstance(progs, list) else progs.get("items", [])
        match = next((e for e in progs if e.get("id") == enrollment_id), None)
        assert match is not None, "enrollment not surfaced via /dogs/{id}/programs"
        assert match.get("status") == "active"
    finally:
        if bid:
            requests.delete(f"{BASE}/api/bookings/{bid}", headers=admin_headers, timeout=15)
        requests.delete(f"{BASE}/api/services/{service['id']}",
                        headers=admin_headers, timeout=15)
