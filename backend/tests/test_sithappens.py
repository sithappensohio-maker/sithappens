"""Sit Happens API end-to-end tests."""
import os
import random
import uuid
from datetime import date, timedelta
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"

# Random forward-shift (45-120 days out) so consecutive test runs never collide
# with bookings left over by earlier runs on the same dates. Re-rolled per
# pytest session via the module-level constant.
TEST_DATE_OFFSET = random.randint(20, 40)


def _future_date(extra_days: int = 0) -> str:
    """Return an ISO date string `TEST_DATE_OFFSET + extra_days` from today."""
    return (date.today() + timedelta(days=TEST_DATE_OFFSET + extra_days)).isoformat()


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["role"] == "admin"
    return data["token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def created_client(admin_h):
    payload = {"name": f"TEST_Client_{uuid.uuid4().hex[:6]}", "email": "tc@x.com", "credits": 5}
    r = requests.post(f"{BASE_URL}/api/clients", json=payload, headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def portal_user(admin_h, created_client):
    email = f"portal_{uuid.uuid4().hex[:6]}@example.com"
    pw = "client123"
    r = requests.post(
        f"{BASE_URL}/api/clients/{created_client['id']}/portal-account",
        json={"email": email, "password": pw}, headers=admin_h, timeout=15,
    )
    assert r.status_code == 200, r.text
    # login
    lr = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert lr.status_code == 200, lr.text
    return {"email": email, "password": pw, "token": lr.json()["token"], "user": lr.json()["user"]}


@pytest.fixture(scope="session")
def client_h(portal_user):
    return {"Authorization": f"Bearer {portal_user['token']}"}


# ---------- Auth ----------
class TestAuth:
    def test_admin_login(self, admin_token):
        assert admin_token

    def test_register(self):
        email = f"reg_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "secret123", "name": "Reg User"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["role"] == "client"
        assert d["user"]["email"] == email

    def test_me(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_login_bad(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401


# ---------- Clients ----------
class TestClients:
    def test_list_clients(self, admin_h, created_client):
        r = requests.get(f"{BASE_URL}/api/clients", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert any(c["id"] == created_client["id"] for c in r.json())

    def test_update_client(self, admin_h, created_client):
        upd = {"name": created_client["name"], "address": "1 Test", "phone": "555", "email": "tc@x.com",
               "emerg": "", "credits": 10}
        r = requests.put(f"{BASE_URL}/api/clients/{created_client['id']}", json=upd, headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["credits"] == 10

    def test_portal_account_created(self, portal_user):
        assert portal_user["user"]["role"] == "client"
        assert portal_user["user"]["client_id"]


# ---------- Dogs ----------
@pytest.fixture(scope="session")
def created_dog(admin_h, created_client):
    rabies_future = (date.today() + timedelta(days=365)).isoformat()
    payload = {
        "owner_id": created_client["id"], "name": "TEST_Rex", "breed": "Lab",
        "age_y": 3, "sex": "Male", "fixed": "Yes",
        "vaccines": {"rabies": rabies_future, "bordetella": "", "dhpp": ""},
        "photo": "data:image/png;base64,iVBORw0KGgo=",
    }
    r = requests.post(f"{BASE_URL}/api/dogs", json=payload, headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def expired_dog(admin_h, created_client):
    payload = {
        "owner_id": created_client["id"], "name": "TEST_Expired", "breed": "Mix",
        "vaccines": {"rabies": "2020-01-01"},
    }
    r = requests.post(f"{BASE_URL}/api/dogs", json=payload, headers=admin_h, timeout=15)
    assert r.status_code == 200
    return r.json()


class TestDogs:
    def test_create_dog(self, created_dog):
        assert created_dog["id"]

    def test_list_dogs(self, admin_h, created_dog):
        r = requests.get(f"{BASE_URL}/api/dogs", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert any(d["id"] == created_dog["id"] for d in r.json())

    def test_add_training_log(self, admin_h, created_dog):
        r = requests.post(
            f"{BASE_URL}/api/dogs/{created_dog['id']}/training-logs",
            json={"date": date.today().isoformat(), "note": "good boy", "tags": ["sit"]},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200
        assert len(r.json()["training_logs"]) >= 1


# ---------- Bookings ----------
class TestBookings:
    def test_rabies_expired(self, client_h, expired_dog):
        r = requests.post(f"{BASE_URL}/api/bookings",
                          json={"dog_id": expired_dog["id"], "date": _future_date(2),
                                "service_type": "daycare"}, headers=client_h, timeout=15)
        assert r.status_code == 400
        assert "Rabies" in r.json()["detail"]

    def test_insufficient_credits(self, admin_h, created_client, created_dog, client_h):
        # Per 2026-02 update: credits are pay-on-the-day for daycare; clients can book with 0 credits.
        # Set credits to 0 and assert the booking still succeeds.
        requests.put(f"{BASE_URL}/api/clients/{created_client['id']}",
                     json={"name": created_client["name"], "credits": 0, "email": "tc@x.com"}, headers=admin_h, timeout=15)
        r = requests.post(f"{BASE_URL}/api/bookings",
                          json={"dog_id": created_dog["id"], "date": _future_date(3),
                                "service_type": "daycare"}, headers=client_h, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "pending"
        assert b["cost"] == 1  # daycare still has a cost (charged on day)
        # Boarding & training should be cost 0 (pay-on-the-day, not credit-based)
        rb = requests.post(f"{BASE_URL}/api/bookings",
                           json={"dog_id": created_dog["id"], "date": _future_date(15),
                                 "end_date": _future_date(17),
                                 "service_type": "boarding"}, headers=client_h, timeout=15)
        assert rb.status_code == 200, rb.text
        assert rb.json()["cost"] == 0

    def test_client_create_and_admin_approve(self, admin_h, created_client, created_dog, client_h):
        # set credits=3
        requests.put(f"{BASE_URL}/api/clients/{created_client['id']}",
                     json={"name": created_client["name"], "credits": 3, "email": "tc@x.com"}, headers=admin_h, timeout=15)
        target = _future_date(5)
        r = requests.post(f"{BASE_URL}/api/bookings",
                          json={"dog_id": created_dog["id"], "date": target, "service_type": "daycare"},
                          headers=client_h, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "pending"
        # approve
        ar = requests.post(f"{BASE_URL}/api/bookings/{b['id']}/approve", headers=admin_h, timeout=15)
        assert ar.status_code == 200
        assert ar.json()["status"] == "approved"
        # client credits decreased
        cli = requests.get(f"{BASE_URL}/api/clients", headers=admin_h, timeout=15).json()
        cur = next(c for c in cli if c["id"] == created_client["id"])
        assert cur["credits"] == 2
        # cancel refunds
        cr = requests.delete(f"{BASE_URL}/api/bookings/{b['id']}", headers=admin_h, timeout=15)
        assert cr.status_code == 200
        cli2 = requests.get(f"{BASE_URL}/api/clients", headers=admin_h, timeout=15).json()
        cur2 = next(c for c in cli2 if c["id"] == created_client["id"])
        assert cur2["credits"] == 3

    def test_availability(self, client_h, created_dog):
        target = _future_date(7)
        r = requests.get(f"{BASE_URL}/api/bookings/availability",
                         params={"date_str": target, "dog_id": created_dog["id"]}, headers=client_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["capacity"] == 30
        assert d["vaccine_ok"] is True
        assert "open_slots" in d


# ---------- Dashboard / Events / Portal / Authz ----------
class TestMisc:
    def test_dashboard_stats(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ["daycare_occupancy", "daycare_capacity", "boarding_today", "health_flags", "total_dogs"]:
            assert k in d
        assert d["health_flags"] >= 1  # expired_dog should flag

    def test_events(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/events", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_portal_me_client(self, client_h, created_client):
        r = requests.get(f"{BASE_URL}/api/portal/me", headers=client_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["client"]["id"] == created_client["id"]

    def test_portal_me_admin_403(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/portal/me", headers=admin_h, timeout=15)
        assert r.status_code == 403

    def test_client_cannot_list_clients(self, client_h):
        r = requests.get(f"{BASE_URL}/api/clients", headers=client_h, timeout=15)
        assert r.status_code == 403

    def test_client_cannot_dashboard(self, client_h):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=client_h, timeout=15)
        assert r.status_code == 403


# ---------- Cleanup ----------
@pytest.fixture(scope="session", autouse=True)
def cleanup(admin_h, request):
    yield
    # delete clients with TEST_ prefix and their dogs/users
    try:
        cl = requests.get(f"{BASE_URL}/api/clients", headers=admin_h, timeout=15).json()
        for c in cl:
            if c["name"].startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=admin_h, timeout=15)
    except Exception:
        pass
