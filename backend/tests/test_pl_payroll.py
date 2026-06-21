"""Sprint 110ai — P&L PDF must reflect actual payroll cost from
clocked-in staff (time_clock_entries × hourly_rate + employer burden),
not just an estimated-hours figure."""
import io
import os

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


def _range():
    from datetime import date, timedelta
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=30)).isoformat()
    return start, end


def test_pl_json_exposes_payroll_block(admin_headers):
    """JSON snapshot now carries a `payroll` block + `net_before_payroll`."""
    start, end = _range()
    r = requests.get(
        f"{BASE}/api/reports/pl",
        params={"start_date": start, "end_date": end},
        headers=admin_headers,
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "payroll" in data, "P&L JSON missing payroll block"
    p = data["payroll"]
    for k in ("total_hours", "gross", "employer_burden", "total_cost", "per_employee", "entry_count"):
        assert k in p, f"payroll block missing {k}"
    assert isinstance(p["per_employee"], list)
    # Net must subtract payroll
    assert "net_before_payroll" in data
    assert round(data["net_before_payroll"] - p["total_cost"], 2) == round(data["net"], 2), (
        "net must equal net_before_payroll minus payroll total_cost"
    )
    # YTD also carries payroll
    assert "payroll" in data["ytd"]
    assert round(
        data["ytd"]["income"] - data["ytd"]["expenses"] - data["ytd"]["payroll"], 2
    ) == round(data["ytd"]["net"], 2)


def test_pl_pdf_contains_payroll_section(admin_headers):
    """PDF must include a Payroll Cost section + YTD payroll line."""
    start, end = _range()
    r = requests.get(
        f"{BASE}/api/reports/pl/pdf",
        params={"start_date": start, "end_date": end},
        headers=admin_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"
    # Extract text and check for our new sections
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(r.content))
    all_text = "\n".join(p.extract_text() or "" for p in reader.pages)
    assert "PAYROLL COST" in all_text, "KPI tile missing"
    assert "Payroll Cost" in all_text, "Section header missing"
    assert "Employer burden" in all_text, "Burden breakdown missing"
    assert "YTD payroll cost" in all_text, "YTD payroll line missing"
