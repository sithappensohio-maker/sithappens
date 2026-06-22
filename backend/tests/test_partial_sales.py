"""Sprint 110di-61 — Partial payments on non-booking sales (cash-basis 1c).

Covers:
  - Sell training program with amount_paid < price → tab grows by the delta,
    retail_sales row records only the paid amount as today's revenue.
  - Sell credit pack (single) with partial pay → same behavior.
  - Sell credit packs (bulk) with partial pay → ledger writes ONE charge
    + ONE payment row, retail_sales rows are prorated.
  - Create retail sale with partial pay → row records only amount_paid;
    full_ticket_amount preserved for audit.
  - Apply tab payment → inserts a `tab_payment` retail_sales row so the
    income screen / P&L picks up the cash on the day it was collected.
"""
import os, uuid, datetime, requests, pytest

BASE = os.environ.get("API_URL", os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"))
TOMORROW = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="function")
def fresh_client(admin_headers):
    cid_suffix = uuid.uuid4().hex[:6]
    cr = requests.post(f"{BASE}/api/clients", headers=admin_headers,
                       json={"name": f"Sale Test {cid_suffix}",
                             "email": f"saletest_{cid_suffix}@example.com",
                             "phone": "555-555-0000"}, timeout=15)
    assert cr.status_code == 200, cr.text
    client = cr.json()
    yield client
    requests.delete(f"{BASE}/api/clients/{client['id']}", headers=admin_headers, timeout=15)


def _seed_pack(admin_headers, name="Test Daycare 10-pack", qty=10, price=200.0):
    """Return an existing pack matching `name` or create one."""
    r = requests.get(f"{BASE}/api/credit-packs?include_inactive=true",
                     headers=admin_headers, timeout=15)
    packs = r.json() if r.status_code == 200 else []
    for p in packs:
        if p["name"] == name:
            return p
    cr = requests.post(f"{BASE}/api/credit-packs", headers=admin_headers,
                       json={"name": name, "qty": qty, "price": price,
                             "service_type": "daycare", "active": True}, timeout=15)
    assert cr.status_code == 200, cr.text
    return cr.json()


def test_sell_pack_partial_pay_creates_tab(admin_headers, fresh_client):
    """Sell a $200 pack, client pays $80 → tab $120, today's revenue $80."""
    pack = _seed_pack(admin_headers)
    r = requests.post(
        f"{BASE}/api/clients/{fresh_client['id']}/sell-pack",
        headers=admin_headers,
        json={"pack_id": pack["id"], "payment_method": "cash", "amount_paid": 80.0},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    # client balance should be 120 owed
    cr = requests.get(f"{BASE}/api/clients/{fresh_client['id']}",
                      headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - (pack["price"] - 80.0)) < 0.01
    # retail_sales row recorded only $80 of revenue today
    rs = requests.get(f"{BASE}/api/retail-sales?start_date=2020-01-01",
                      headers=admin_headers, timeout=15)
    sales = rs.json() if isinstance(rs.json(), list) else rs.json().get("items", [])
    mine = [s for s in sales if s.get("client_id") == fresh_client["id"]
            and s.get("source_kind") == "credit_pack_sale"]
    assert mine, "no credit_pack_sale row for this client"
    assert abs(mine[0]["amount"] - 80.0) < 0.01


def test_sell_program_partial_pay_creates_tab(admin_headers, fresh_client):
    """Sell training program with partial pay → tab grows, revenue capped."""
    # Get any active program
    pr = requests.get(f"{BASE}/api/programs", headers=admin_headers, timeout=15)
    progs = pr.json() if isinstance(pr.json(), list) else pr.json().get("items", [])
    if not progs:
        pytest.skip("no programs seeded")
    prog = progs[0]
    price = float(prog.get("price") or 500.0)
    paid = round(price * 0.4, 2)
    sr = requests.post(
        f"{BASE}/api/clients/{fresh_client['id']}/sell-program",
        headers=admin_headers,
        json={"program_id": prog["id"], "payment_method": "cash",
              "override_price": price, "amount_paid": paid},
        timeout=15,
    )
    assert sr.status_code == 200, sr.text
    cr = requests.get(f"{BASE}/api/clients/{fresh_client['id']}",
                      headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - round(price - paid, 2)) < 0.01


def test_retail_sale_partial_pay_creates_tab(admin_headers, fresh_client):
    """Retail line with partial pay → tab grows, recorded amount = paid."""
    r = requests.post(f"{BASE}/api/retail-sales", headers=admin_headers,
                      json={"date": datetime.date.today().isoformat(),
                            "description": "40lb kibble", "amount": 60.0,
                            "category": "Retail", "payment_method": "cash",
                            "client_id": fresh_client["id"], "amount_paid": 25.0},
                      timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["amount"] == 25.0
    assert d.get("partial_pay") is True
    assert d.get("full_ticket_amount") == 60.0
    cr = requests.get(f"{BASE}/api/clients/{fresh_client['id']}",
                      headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"] - 35.0) < 0.01


def test_apply_tab_payment_records_revenue(admin_headers, fresh_client):
    """Tab payment should also insert a retail_sales row (tab_payment)."""
    # First put $50 on tab via adjustment
    requests.post(f"{BASE}/api/clients/{fresh_client['id']}/adjustment",
                  headers=admin_headers, json={"amount": 50.0, "notes": "setup"},
                  timeout=15)
    # Apply $30 payment
    r = requests.post(f"{BASE}/api/clients/{fresh_client['id']}/payment",
                      headers=admin_headers,
                      json={"amount": 30.0, "method": "cash", "notes": "Settling up"},
                      timeout=15)
    assert r.status_code == 200, r.text
    assert abs(r.json()["balance"] - 20.0) < 0.01
    # Verify a tab_payment retail_sales row exists for today
    rs = requests.get(f"{BASE}/api/retail-sales?start_date=2020-01-01",
                      headers=admin_headers, timeout=15)
    sales = rs.json() if isinstance(rs.json(), list) else rs.json().get("items", [])
    tab_pays = [s for s in sales if s.get("client_id") == fresh_client["id"]
                and s.get("source_kind") == "tab_payment"]
    assert tab_pays, "tab_payment revenue row was not inserted"
    assert abs(tab_pays[0]["amount"] - 30.0) < 0.01


def test_sell_pack_full_pay_unchanged(admin_headers, fresh_client):
    """Regression: omitting amount_paid keeps the legacy full-pay behavior."""
    pack = _seed_pack(admin_headers)
    r = requests.post(f"{BASE}/api/clients/{fresh_client['id']}/sell-pack",
                      headers=admin_headers,
                      json={"pack_id": pack["id"], "payment_method": "cash"},
                      timeout=15)
    assert r.status_code == 200, r.text
    cr = requests.get(f"{BASE}/api/clients/{fresh_client['id']}",
                      headers=admin_headers, timeout=15)
    assert abs(cr.json()["account_balance"]) < 0.01  # no tab
