"""
Iteration 7 QA - Final pre-go-live regression hunt.
Verifies server-side booking rules, permission matrix, payment options.
"""
import os
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASS = "admin123"
CLIENT_EMAIL = "freightshaker06@gmail.com"
CLIENT_PASS = "TestPass123"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:300]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def client_token():
    return _login(CLIENT_EMAIL, CLIENT_PASS)


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def client_h(client_token):
    return {"Authorization": f"Bearer {client_token}"}


# Sanity: health + settings public + auth/me
class TestHealth:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=20)
        assert r.status_code == 200

    def test_settings_public_requires_auth_or_anonymous(self):
        # Endpoint named "public" — currently requires Bearer per server.py:4643. Verify behaviour.
        r = requests.get(f"{BASE_URL}/api/settings/public", timeout=20)
        # Document actual behavior; allow either 200 (public) or 401 (auth required).
        # If 401, frontend must always send a bearer.
        assert r.status_code in (200, 401), f"unexpected {r.status_code}"

    def test_auth_me_admin(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_h, timeout=20)
        assert r.status_code == 200
        u = r.json()
        assert u.get("email") == ADMIN_EMAIL


# Permission matrix enforcement
class TestPermissionMatrix:
    def test_owner_role_lock(self, admin_h):
        # Owner role's permissions are locked. Schema expects dict-of-bools.
        r = requests.put(
            f"{BASE_URL}/api/staff/roles/owner/permissions",
            headers=admin_h,
            json={"permissions": {"data_export": False}},
            timeout=20,
        )
        assert r.status_code in (400, 403), f"owner role should be locked, got {r.status_code} {r.text[:300]}"

    def test_admin_income_export_admin_can(self, admin_h):
        # Admin (no staff_role -> implicit owner) should always succeed
        r = requests.get(f"{BASE_URL}/api/admin/income/export.csv", headers=admin_h, timeout=30)
        assert r.status_code == 200, f"admin export got {r.status_code}"


# Settings round-trip — settings must persist
class TestSettingsRoundTrip:
    def test_get_settings(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/settings", headers=admin_h, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, dict)

    def test_payment_options_roundtrip(self, admin_h):
        # payment_options is a LIST of {key,label,enabled,link,instructions}
        r = requests.get(f"{BASE_URL}/api/settings", headers=admin_h, timeout=20)
        assert r.status_code == 200
        cur = r.json()
        po_list = cur.get("payment_options") or []
        assert isinstance(po_list, list), f"payment_options expected list, got {type(po_list).__name__}"
        original = [dict(x) for x in po_list]

        # Flip venmo display name to TEST_, ensure enabled
        new_list = []
        found = False
        for p in po_list:
            if p.get("key") == "venmo":
                p2 = dict(p)
                p2["label"] = "TEST_Venmo Display"
                p2["enabled"] = True
                p2["link"] = "https://venmo.com/u/test"
                p2["instructions"] = "Send w/ booking date"
                new_list.append(p2)
                found = True
            else:
                new_list.append(p)
        if not found:
            new_list.append({"key": "venmo", "label": "TEST_Venmo Display", "enabled": True, "link": "https://venmo.com/u/test", "instructions": "Send w/ booking date"})

        rput = requests.put(f"{BASE_URL}/api/settings", headers=admin_h, json={"payment_options": new_list}, timeout=20)
        if rput.status_code in (404, 405):
            rput = requests.patch(f"{BASE_URL}/api/settings", headers=admin_h, json={"payment_options": new_list}, timeout=20)
        assert rput.status_code in (200, 204), f"settings PUT/PATCH got {rput.status_code} {rput.text[:300]}"

        r2 = requests.get(f"{BASE_URL}/api/settings", headers=admin_h, timeout=20)
        po2 = r2.json().get("payment_options") or []
        venmo = next((x for x in po2 if x.get("key") == "venmo"), None)
        assert venmo is not None, "venmo entry missing after save"
        assert venmo.get("label") == "TEST_Venmo Display", f"label not persisted: {venmo}"
        assert venmo.get("enabled") is True

        # Restore
        requests.put(f"{BASE_URL}/api/settings", headers=admin_h, json={"payment_options": original}, timeout=20)


# Booking rules enforced server side
class TestBookingRules:
    def test_zero_night_boarding_rejected(self, client_h):
        # boarding with end_date == start_date must be 400
        today = date.today() + timedelta(days=7)
        payload = {
            "service_type": "boarding",
            "start_date": today.isoformat(),
            "end_date": today.isoformat(),
            "dropoff_time": "09:00",
            "pickup_time": "10:00",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", headers=client_h, json=payload, timeout=20)
        # Expect a 400 zero-night reject (or 422 validation); 200/201 would be a bug.
        assert r.status_code >= 400, f"zero-night should reject, got {r.status_code} {r.text[:300]}"

    def test_invalid_service_type_when_feature_disabled(self, client_h):
        # Even without toggling, an unknown/disabled service_type should not 500
        payload = {
            "service_type": "training",  # may or may not be enabled
            "start_date": (date.today() + timedelta(days=5)).isoformat(),
        }
        r = requests.post(f"{BASE_URL}/api/bookings", headers=client_h, json=payload, timeout=20)
        # Should be either 200/201 (accepted) or a 4xx (rejected), never 5xx
        assert r.status_code < 500, f"booking endpoint 5xx on training: {r.status_code} {r.text[:300]}"


# Expired JWT graceful handling
class TestAuthErrorPaths:
    def test_invalid_token_rejected(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"}, timeout=20)
        assert r.status_code in (401, 403)

    def test_missing_token_rejected(self):
        r = requests.get(f"{BASE_URL}/api/admin/income/export.csv", timeout=20)
        assert r.status_code in (401, 403)
