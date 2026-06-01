"""CPA hand-off PDF endpoint."""
import os
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_cpa_pdf_returns_valid_pdf():
    r = requests.get(f"{BASE}/api/admin/quarterly-tax/cpa.pdf",
                     headers=_admin(), timeout=30)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content.startswith(b"%PDF"), "Not a valid PDF"
    assert len(r.content) > 1000, "PDF suspiciously small"
    cd = r.headers.get("content-disposition", "")
    assert "cpa-tax-summary" in cd
    assert ".pdf" in cd


def test_cpa_pdf_year_filename():
    r = requests.get(f"{BASE}/api/admin/quarterly-tax/cpa.pdf?year=2025",
                     headers=_admin(), timeout=30)
    assert r.status_code == 200
    assert "cpa-tax-summary-2025.pdf" in r.headers.get("content-disposition", "")


def test_cpa_pdf_after_logged_payment():
    """PDF generation should still succeed after a payment is logged."""
    h = _admin()
    p = requests.post(f"{BASE}/api/admin/quarterly-tax/payments", headers=h,
                      json={"year": 2026, "quarter": 1, "amount": 250.0,
                            "payment_method": "EFTPS", "memo": "CPA-PDF test"}, timeout=15).json()
    try:
        r = requests.get(f"{BASE}/api/admin/quarterly-tax/cpa.pdf?year=2026",
                         headers=h, timeout=30)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF")
    finally:
        requests.delete(f"{BASE}/api/admin/quarterly-tax/payments/{p['id']}", headers=h, timeout=15)


def test_cpa_pdf_requires_admin():
    r = requests.get(f"{BASE}/api/admin/quarterly-tax/cpa.pdf", timeout=15)
    assert r.status_code in (401, 403)
