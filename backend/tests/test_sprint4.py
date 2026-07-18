"""Sprint 4 tests for Sit Happens CRM.

Covers:
- Waiver public settings exposure
- /api/waivers/me, /api/waivers/sign, /api/waivers, /api/clients/{id}/waiver
- Waiver gating of client bookings + version-bump re-sign flow
- Incident CRUD + dog_id filter
- Admin booking overrides (override_vaccines, override_capacity, check_in_now)
- Client cannot use admin override flags
"""
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")
).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"

TIMEOUT = 20


# ---------- helpers ----------
def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def s4_client(admin_token):
    """Create a fresh client + dog (with all required vaccines) + portal login."""
    uniq = uuid.uuid4().hex[:8]
    c = requests.post(f"{BASE_URL}/api/clients",
                      json={"name": f"TEST_S4 {uniq}", "email": f"s4_{uniq}@example.com", "credits": 50},
                      headers=_h(admin_token), timeout=TIMEOUT).json()
    future = (date.today() + timedelta(days=365)).isoformat()
    dog = requests.post(f"{BASE_URL}/api/dogs",
                        json={"owner_id": c["id"], "name": f"TEST_S4_Rex_{uniq}", "breed": "Lab",
                              "vaccines": {"rabies": future, "bordetella": future, "dhpp": future}},
                        headers=_h(admin_token), timeout=TIMEOUT).json()
    portal_email = f"s4portal_{uniq}@example.com"
    portal_pw = "client123"
    requests.post(f"{BASE_URL}/api/clients/{c['id']}/portal-account",
                  json={"email": portal_email, "password": portal_pw},
                  headers=_h(admin_token), timeout=TIMEOUT)
    token = _login(portal_email, portal_pw)
    yield {"client": c, "dog": dog, "token": token, "email": portal_email}
    # teardown
    requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)


@pytest.fixture()
def waiver_required_on(admin_token):
    """Force waiver_required_for_booking=True and version=1 for this test, restore after."""
    s = requests.get(f"{BASE_URL}/api/settings", headers=_h(admin_token), timeout=TIMEOUT).json()
    orig = {
        "waiver_required_for_booking": s.get("waiver_required_for_booking", True),
        "waiver_version": s.get("waiver_version", 1),
    }
    requests.put(f"{BASE_URL}/api/settings",
                 json={"waiver_required_for_booking": True, "waiver_version": 1},
                 headers=_h(admin_token), timeout=TIMEOUT)
    yield
    requests.put(f"{BASE_URL}/api/settings", json=orig, headers=_h(admin_token), timeout=TIMEOUT)


# ---------- Waiver: public settings ----------
class TestWaiverSettings:
    def test_public_settings_exposes_waiver_fields(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/settings/public", headers=_h(admin_token), timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "waiver_text" in data and isinstance(data["waiver_text"], str) and len(data["waiver_text"]) > 50
        assert "waiver_version" in data and isinstance(data["waiver_version"], int)
        assert "waiver_required_for_booking" in data and isinstance(data["waiver_required_for_booking"], bool)


# ---------- Waiver: client flow ----------
class TestWaiverFlow:
    def test_me_unsigned_returns_signed_false_with_version(self, s4_client):
        r = requests.get(f"{BASE_URL}/api/waivers/me", headers=_h(s4_client["token"]), timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["signed"] is False
        assert "current_version" in d and isinstance(d["current_version"], int)

    def test_sign_requires_accepted_true(self, s4_client):
        r = requests.post(f"{BASE_URL}/api/waivers/sign",
                          json={"typed_name": "Jane Doe", "accepted": False},
                          headers=_h(s4_client["token"]), timeout=TIMEOUT)
        assert r.status_code == 400

    def test_sign_requires_typed_name_min_length(self, s4_client):
        r = requests.post(f"{BASE_URL}/api/waivers/sign",
                          json={"typed_name": "J", "accepted": True},
                          headers=_h(s4_client["token"]), timeout=TIMEOUT)
        assert r.status_code == 422  # pydantic validation

    def test_sign_succeeds_and_persists(self, s4_client, admin_token):
        r = requests.post(f"{BASE_URL}/api/waivers/sign",
                          json={"typed_name": "Jane Doe", "accepted": True, "dog_names": "Rex"},
                          headers={**_h(s4_client["token"]), "User-Agent": "pytest-sprint4"},
                          timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        sig = r.json()
        assert sig["typed_name"] == "Jane Doe"
        assert sig["client_id"] == s4_client["client"]["id"]
        assert sig["waiver_version"] >= 1
        assert isinstance(sig.get("waiver_text_snapshot", ""), str) and len(sig["waiver_text_snapshot"]) > 50
        assert sig.get("user_agent", "").startswith("pytest")
        assert "signed_at" in sig

        # GET /waivers/me reflects signed=true
        me = requests.get(f"{BASE_URL}/api/waivers/me",
                         headers=_h(s4_client["token"]), timeout=TIMEOUT).json()
        assert me["signed"] is True
        assert me["needs_resign"] is False
        assert me["signature"]["typed_name"] == "Jane Doe"

        # Admin list includes it
        lst = requests.get(f"{BASE_URL}/api/waivers", headers=_h(admin_token), timeout=TIMEOUT).json()
        assert any(s["client_id"] == s4_client["client"]["id"] for s in lst)

        # Admin per-client endpoint returns latest
        per = requests.get(f"{BASE_URL}/api/clients/{s4_client['client']['id']}/waiver",
                           headers=_h(admin_token), timeout=TIMEOUT).json()
        assert per.get("typed_name") == "Jane Doe"

    def test_clients_waiver_unsigned_returns_signed_false(self, admin_token):
        # create a client with no signature
        uniq = uuid.uuid4().hex[:6]
        c = requests.post(f"{BASE_URL}/api/clients",
                          json={"name": f"TEST_S4_unsigned_{uniq}", "credits": 0},
                          headers=_h(admin_token), timeout=TIMEOUT).json()
        try:
            r = requests.get(f"{BASE_URL}/api/clients/{c['id']}/waiver",
                             headers=_h(admin_token), timeout=TIMEOUT)
            assert r.status_code == 200
            assert r.json() == {"signed": False}
        finally:
            requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)


# ---------- Waiver gating + version bump ----------
class TestWaiverGating:
    def test_unsigned_client_blocked_from_booking(self, admin_token, waiver_required_on):
        uniq = uuid.uuid4().hex[:6]
        c = requests.post(f"{BASE_URL}/api/clients",
                          json={"name": f"TEST_S4_gate_{uniq}", "credits": 10},
                          headers=_h(admin_token), timeout=TIMEOUT).json()
        future = (date.today() + timedelta(days=365)).isoformat()
        dog = requests.post(f"{BASE_URL}/api/dogs",
                            json={"owner_id": c["id"], "name": f"TEST_S4_gateDog_{uniq}",
                                  "vaccines": {"rabies": future, "bordetella": future, "dhpp": future}},
                            headers=_h(admin_token), timeout=TIMEOUT).json()
        email = f"s4gate_{uniq}@example.com"
        requests.post(f"{BASE_URL}/api/clients/{c['id']}/portal-account",
                      json={"email": email, "password": "client123"},
                      headers=_h(admin_token), timeout=TIMEOUT)
        ctoken = _login(email, "client123")
        try:
            book_date = (date.today() + timedelta(days=2)).isoformat()
            r = requests.post(f"{BASE_URL}/api/bookings",
                              json={"dog_id": dog["id"], "date": book_date, "service_type": "daycare"},
                              headers=_h(ctoken), timeout=TIMEOUT)
            assert r.status_code == 400
            assert "waiver" in r.json().get("detail", "").lower()

            # Sign waiver and retry
            requests.post(f"{BASE_URL}/api/waivers/sign",
                          json={"typed_name": "Test Gate", "accepted": True},
                          headers=_h(ctoken), timeout=TIMEOUT)
            r2 = requests.post(f"{BASE_URL}/api/bookings",
                               json={"dog_id": dog["id"], "date": book_date, "service_type": "daycare"},
                               headers=_h(ctoken), timeout=TIMEOUT)
            assert r2.status_code == 200, r2.text
        finally:
            requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)

    def test_version_bump_forces_resign(self, admin_token):
        # Setup: gate on, version=1, create signed client
        uniq = uuid.uuid4().hex[:6]
        requests.put(f"{BASE_URL}/api/settings",
                     json={"waiver_required_for_booking": True, "waiver_version": 1},
                     headers=_h(admin_token), timeout=TIMEOUT)
        c = requests.post(f"{BASE_URL}/api/clients",
                          json={"name": f"TEST_S4_ver_{uniq}", "credits": 10},
                          headers=_h(admin_token), timeout=TIMEOUT).json()
        future = (date.today() + timedelta(days=365)).isoformat()
        dog = requests.post(f"{BASE_URL}/api/dogs",
                            json={"owner_id": c["id"], "name": f"TEST_S4_verDog_{uniq}",
                                  "vaccines": {"rabies": future, "bordetella": future, "dhpp": future}},
                            headers=_h(admin_token), timeout=TIMEOUT).json()
        email = f"s4ver_{uniq}@example.com"
        requests.post(f"{BASE_URL}/api/clients/{c['id']}/portal-account",
                      json={"email": email, "password": "client123"},
                      headers=_h(admin_token), timeout=TIMEOUT)
        ctoken = _login(email, "client123")
        try:
            requests.post(f"{BASE_URL}/api/waivers/sign",
                          json={"typed_name": "Ver Tester", "accepted": True},
                          headers=_h(ctoken), timeout=TIMEOUT)
            # bump version
            requests.put(f"{BASE_URL}/api/settings",
                         json={"waiver_version": 2},
                         headers=_h(admin_token), timeout=TIMEOUT)
            me = requests.get(f"{BASE_URL}/api/waivers/me", headers=_h(ctoken), timeout=TIMEOUT).json()
            assert me["signed"] is True
            assert me["needs_resign"] is True
            assert me["current_version"] == 2

            # Booking blocked
            book_date = (date.today() + timedelta(days=2)).isoformat()
            r = requests.post(f"{BASE_URL}/api/bookings",
                              json={"dog_id": dog["id"], "date": book_date, "service_type": "daycare"},
                              headers=_h(ctoken), timeout=TIMEOUT)
            assert r.status_code == 400
            assert "waiver" in r.json().get("detail", "").lower()

            # Re-sign and retry
            requests.post(f"{BASE_URL}/api/waivers/sign",
                          json={"typed_name": "Ver Tester v2", "accepted": True},
                          headers=_h(ctoken), timeout=TIMEOUT)
            r2 = requests.post(f"{BASE_URL}/api/bookings",
                               json={"dog_id": dog["id"], "date": book_date, "service_type": "daycare"},
                               headers=_h(ctoken), timeout=TIMEOUT)
            assert r2.status_code == 200, r2.text
        finally:
            requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)
            requests.put(f"{BASE_URL}/api/settings",
                         json={"waiver_required_for_booking": False, "waiver_version": 1},
                         headers=_h(admin_token), timeout=TIMEOUT)


# ---------- Incidents CRUD ----------
class TestIncidents:
    def test_incident_crud_and_filter(self, admin_token):
        uniq = uuid.uuid4().hex[:6]
        c = requests.post(f"{BASE_URL}/api/clients",
                          json={"name": f"TEST_S4_inc_{uniq}", "credits": 0},
                          headers=_h(admin_token), timeout=TIMEOUT).json()
        future = (date.today() + timedelta(days=365)).isoformat()
        dog1 = requests.post(f"{BASE_URL}/api/dogs",
                             json={"owner_id": c["id"], "name": f"TEST_S4_inc1_{uniq}",
                                   "vaccines": {"rabies": future}},
                             headers=_h(admin_token), timeout=TIMEOUT).json()
        dog2 = requests.post(f"{BASE_URL}/api/dogs",
                             json={"owner_id": c["id"], "name": f"TEST_S4_inc2_{uniq}",
                                   "vaccines": {"rabies": future}},
                             headers=_h(admin_token), timeout=TIMEOUT).json()
        try:
            # POST requires dog_id+description
            r_bad = requests.post(f"{BASE_URL}/api/incidents",
                                  json={"dog_id": dog1["id"], "date": "2026-01-15"},
                                  headers=_h(admin_token), timeout=TIMEOUT)
            assert r_bad.status_code == 422

            # POST success
            r = requests.post(f"{BASE_URL}/api/incidents",
                              json={"dog_id": dog1["id"], "date": "2026-01-15", "time": "14:30",
                                    "type": "bite", "severity": "moderate",
                                    "description": "Test incident A"},
                              headers=_h(admin_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            inc1 = r.json()
            assert inc1["dog_name"] == dog1["name"]
            assert inc1["client_id"] == c["id"]
            assert inc1["reported_by"]
            assert inc1["description"] == "Test incident A"

            # Second incident on dog2
            r2 = requests.post(f"{BASE_URL}/api/incidents",
                               json={"dog_id": dog2["id"], "date": "2026-01-16",
                                     "description": "Test incident B"},
                               headers=_h(admin_token), timeout=TIMEOUT)
            assert r2.status_code == 200
            inc2 = r2.json()

            # LIST all
            lst = requests.get(f"{BASE_URL}/api/incidents",
                               headers=_h(admin_token), timeout=TIMEOUT).json()
            ids = {i["id"] for i in lst}
            assert inc1["id"] in ids and inc2["id"] in ids

            # Filter by dog_id
            f1 = requests.get(f"{BASE_URL}/api/incidents",
                              params={"dog_id": dog1["id"]},
                              headers=_h(admin_token), timeout=TIMEOUT).json()
            assert all(i["dog_id"] == dog1["id"] for i in f1)
            assert any(i["id"] == inc1["id"] for i in f1)

            # PUT update — edit_reason is now required so a quietly
            # downgraded severity can't look identical to a typo fix.
            upd = requests.put(f"{BASE_URL}/api/incidents/{inc1['id']}",
                               json={"dog_id": dog1["id"], "date": "2026-01-15",
                                     "type": "bite", "severity": "severe",
                                     "description": "Updated description",
                                     "vet_required": True,
                                     "edit_reason": "Vet visit confirmed severity"},
                               headers=_h(admin_token), timeout=TIMEOUT)
            assert upd.status_code == 200
            assert upd.json()["severity"] == "severe"
            assert upd.json()["vet_required"] is True
            assert upd.json()["edit_history"][-1]["reason"] == "Vet visit confirmed severity"

            # DELETE
            d = requests.delete(f"{BASE_URL}/api/incidents/{inc1['id']}",
                                headers=_h(admin_token), timeout=TIMEOUT)
            assert d.status_code == 200
            after = requests.get(f"{BASE_URL}/api/incidents",
                                 headers=_h(admin_token), timeout=TIMEOUT).json()
            assert inc1["id"] not in {i["id"] for i in after}
        finally:
            # cleanup remaining incidents and client
            for i in requests.get(f"{BASE_URL}/api/incidents",
                                  headers=_h(admin_token), timeout=TIMEOUT).json():
                if i["client_id"] == c["id"]:
                    requests.delete(f"{BASE_URL}/api/incidents/{i['id']}",
                                    headers=_h(admin_token), timeout=TIMEOUT)
            requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)


# ---------- Admin booking overrides ----------
class TestAdminBookingOverrides:
    def test_override_vaccines_allows_missing_vaccines(self, admin_token):
        # Ensure required_vaccines includes rabies/bordetella/dhpp
        requests.put(f"{BASE_URL}/api/settings",
                     json={"required_vaccines": ["rabies", "bordetella", "dhpp"]},
                     headers=_h(admin_token), timeout=TIMEOUT)
        try:
            uniq = uuid.uuid4().hex[:6]
            c = requests.post(f"{BASE_URL}/api/clients",
                              json={"name": f"TEST_S4_Rocco_{uniq}", "credits": 5},
                              headers=_h(admin_token), timeout=TIMEOUT).json()
            # Rocco — no rabies at all
            dog = requests.post(f"{BASE_URL}/api/dogs",
                                json={"owner_id": c["id"], "name": f"TEST_S4_Rocco_{uniq}",
                                      "vaccines": {"rabies": "", "bordetella": "", "dhpp": ""}},
                                headers=_h(admin_token), timeout=TIMEOUT).json()
            book_date = (date.today() + timedelta(days=3)).isoformat()
            try:
                # Without override → 400
                r1 = requests.post(f"{BASE_URL}/api/bookings",
                                   json={"dog_id": dog["id"], "date": book_date, "service_type": "daycare"},
                                   headers=_h(admin_token), timeout=TIMEOUT)
                assert r1.status_code == 400
                assert "vaccine" in r1.json().get("detail", "").lower()

                # With override → 200
                r2 = requests.post(f"{BASE_URL}/api/bookings",
                                   json={"dog_id": dog["id"], "date": book_date,
                                         "service_type": "daycare", "override_vaccines": True},
                                   headers=_h(admin_token), timeout=TIMEOUT)
                assert r2.status_code == 200, r2.text
                assert r2.json()["status"] == "approved"
            finally:
                requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)
        finally:
            # restore conftest legacy single-vaccine
            requests.put(f"{BASE_URL}/api/settings",
                         json={"required_vaccines": ["rabies"]},
                         headers=_h(admin_token), timeout=TIMEOUT)

    def test_override_capacity_allows_beyond_capacity(self, admin_token):
        # set capacity=1
        requests.put(f"{BASE_URL}/api/settings",
                     json={"daycare_capacity": 1},
                     headers=_h(admin_token), timeout=TIMEOUT)
        try:
            uniq = uuid.uuid4().hex[:6]
            c = requests.post(f"{BASE_URL}/api/clients",
                              json={"name": f"TEST_S4_cap_{uniq}", "credits": 50},
                              headers=_h(admin_token), timeout=TIMEOUT).json()
            future = (date.today() + timedelta(days=365)).isoformat()
            d1 = requests.post(f"{BASE_URL}/api/dogs",
                               json={"owner_id": c["id"], "name": f"TEST_S4_cap1_{uniq}",
                                     "vaccines": {"rabies": future}},
                               headers=_h(admin_token), timeout=TIMEOUT).json()
            d2 = requests.post(f"{BASE_URL}/api/dogs",
                               json={"owner_id": c["id"], "name": f"TEST_S4_cap2_{uniq}",
                                     "vaccines": {"rabies": future}},
                               headers=_h(admin_token), timeout=TIMEOUT).json()
            book_date = (date.today() + timedelta(days=50)).isoformat()
            try:
                # Cleanup any pre-existing daycare bookings on this date to make the cap=1 deterministic
                existing = requests.get(f"{BASE_URL}/api/bookings",
                                         headers=_h(admin_token), timeout=TIMEOUT).json()
                for b in existing:
                    if b.get("date") == book_date and b.get("service_type") == "daycare" \
                            and b.get("status") in ("approved", "pending", "completed"):
                        requests.delete(f"{BASE_URL}/api/bookings/{b['id']}",
                                        headers=_h(admin_token), timeout=TIMEOUT)
                r1 = requests.post(f"{BASE_URL}/api/bookings",
                                   json={"dog_id": d1["id"], "date": book_date, "service_type": "daycare"},
                                   headers=_h(admin_token), timeout=TIMEOUT)
                assert r1.status_code == 200, r1.text
                # 2nd without override → 400
                r2 = requests.post(f"{BASE_URL}/api/bookings",
                                   json={"dog_id": d2["id"], "date": book_date, "service_type": "daycare"},
                                   headers=_h(admin_token), timeout=TIMEOUT)
                assert r2.status_code == 400
                assert "fully booked" in r2.json().get("detail", "").lower()
                # 2nd with override → 200
                r3 = requests.post(f"{BASE_URL}/api/bookings",
                                   json={"dog_id": d2["id"], "date": book_date,
                                         "service_type": "daycare", "override_capacity": True},
                                   headers=_h(admin_token), timeout=TIMEOUT)
                assert r3.status_code == 200, r3.text
            finally:
                requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)
        finally:
            requests.put(f"{BASE_URL}/api/settings",
                         json={"daycare_capacity": 30},
                         headers=_h(admin_token), timeout=TIMEOUT)

    def test_check_in_now_stamps_timestamp(self, admin_token):
        uniq = uuid.uuid4().hex[:6]
        c = requests.post(f"{BASE_URL}/api/clients",
                          json={"name": f"TEST_S4_chk_{uniq}", "credits": 10},
                          headers=_h(admin_token), timeout=TIMEOUT).json()
        future = (date.today() + timedelta(days=365)).isoformat()
        d = requests.post(f"{BASE_URL}/api/dogs",
                          json={"owner_id": c["id"], "name": f"TEST_S4_chkDog_{uniq}",
                                "vaccines": {"rabies": future}},
                          headers=_h(admin_token), timeout=TIMEOUT).json()
        try:
            r = requests.post(f"{BASE_URL}/api/bookings",
                              json={"dog_id": d["id"], "date": date.today().isoformat(),
                                    "service_type": "daycare", "check_in_now": True},
                              headers=_h(admin_token), timeout=TIMEOUT)
            assert r.status_code == 200, r.text
            assert r.json().get("checked_in_at"), "checked_in_at not stamped"
        finally:
            requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)

    def test_client_override_flags_are_ignored(self, admin_token):
        """A client sending override_vaccines=true must still be blocked when vaccines missing."""
        # Require both rabies and bordetella so missing bordetella triggers
        requests.put(f"{BASE_URL}/api/settings",
                     json={"required_vaccines": ["rabies", "bordetella"],
                           "waiver_required_for_booking": False},
                     headers=_h(admin_token), timeout=TIMEOUT)
        try:
            uniq = uuid.uuid4().hex[:6]
            c = requests.post(f"{BASE_URL}/api/clients",
                              json={"name": f"TEST_S4_clio_{uniq}", "credits": 10},
                              headers=_h(admin_token), timeout=TIMEOUT).json()
            future = (date.today() + timedelta(days=365)).isoformat()
            d = requests.post(f"{BASE_URL}/api/dogs",
                              json={"owner_id": c["id"], "name": f"TEST_S4_clioDog_{uniq}",
                                    "vaccines": {"rabies": future, "bordetella": ""}},
                              headers=_h(admin_token), timeout=TIMEOUT).json()
            email = f"s4clio_{uniq}@example.com"
            requests.post(f"{BASE_URL}/api/clients/{c['id']}/portal-account",
                          json={"email": email, "password": "client123"},
                          headers=_h(admin_token), timeout=TIMEOUT)
            ctok = _login(email, "client123")
            try:
                r = requests.post(f"{BASE_URL}/api/bookings",
                                  json={"dog_id": d["id"],
                                        "date": (date.today() + timedelta(days=2)).isoformat(),
                                        "service_type": "daycare",
                                        "override_vaccines": True,
                                        "override_capacity": True,
                                        "check_in_now": True},
                                  headers=_h(ctok), timeout=TIMEOUT)
                assert r.status_code == 400, f"client override should be ignored but got {r.status_code}: {r.text}"
                assert "vaccine" in r.json().get("detail", "").lower()
            finally:
                requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=_h(admin_token), timeout=TIMEOUT)
        finally:
            requests.put(f"{BASE_URL}/api/settings",
                         json={"required_vaccines": ["rabies"]},
                         headers=_h(admin_token), timeout=TIMEOUT)
