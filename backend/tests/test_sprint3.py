"""Sit Happens Sprint 3 backend tests.

Covers: settings (admin/public/PUT), change-password, recurring bookings,
reschedule, training service type, capacity from settings, auto-approve,
cancellation cutoff, vaccine alerts via settings, dashboard.training_today.

Note: conftest.py loosens settings to required_vaccines=['rabies'] session-wide.
Tests that need to verify multi-vaccine / capacity / auto-approve / cutoff
behavior explicitly PUT /api/settings then restore.
"""
import os
import uuid
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"


# ------------- Fixtures -------------
@pytest.fixture(scope="module")
def admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def s3_client(admin_h):
    r = requests.post(f"{BASE_URL}/api/clients",
                      json={"name": f"TEST_S3_{uuid.uuid4().hex[:6]}", "email": "s3@x.com", "credits": 200},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def s3_dog(admin_h, s3_client):
    """Dog with all three vaccines valid."""
    fut = (date.today() + timedelta(days=365)).isoformat()
    r = requests.post(f"{BASE_URL}/api/dogs",
                      json={"owner_id": s3_client["id"], "name": "TEST_S3_Dog",
                            "vaccines": {"rabies": fut, "bordetella": fut, "dhpp": fut}},
                      headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def s3_portal(admin_h, s3_client):
    email = f"s3portal_{uuid.uuid4().hex[:6]}@example.com"
    pw = "client123"
    r = requests.post(f"{BASE_URL}/api/clients/{s3_client['id']}/portal-account",
                      json={"email": email, "password": pw}, headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    lr = requests.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": pw}, timeout=15)
    assert lr.status_code == 200
    return {"Authorization": f"Bearer {lr.json()['token']}", "_email": email, "_pw": pw}


def _get_settings(admin_h):
    r = requests.get(f"{BASE_URL}/api/settings", headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _put_settings(admin_h, patch):
    r = requests.put(f"{BASE_URL}/api/settings", json=patch, headers=admin_h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ------------- Settings GET/PUT/public -------------
class TestSettings:
    def test_get_settings_admin(self, admin_h):
        s = _get_settings(admin_h)
        # core keys
        for k in ["business_hours", "service_hours", "daycare_capacity",
                  "boarding_capacity", "kennels", "booking_rules",
                  "required_vaccines", "vaccine_warning_days", "mood_tags"]:
            assert k in s, f"missing key {k}"
        assert isinstance(s["kennels"], list)
        assert isinstance(s["mood_tags"], list)
        assert isinstance(s["booking_rules"], dict)
        for r_key in ["max_advance_days", "cancellation_cutoff_hours", "auto_approve",
                      "daycare_cost", "boarding_cost_per_night", "training_cost"]:
            assert r_key in s["booking_rules"], f"missing rule {r_key}"

    def test_get_settings_requires_admin(self, s3_portal):
        h = {"Authorization": s3_portal["Authorization"]}
        r = requests.get(f"{BASE_URL}/api/settings", headers=h, timeout=15)
        assert r.status_code == 403

    def test_put_settings_partial_persists(self, admin_h):
        before = _get_settings(admin_h)
        orig_cap = before["daycare_capacity"]
        orig_kennels = before["kennels"]
        new_kennels = orig_kennels + ["TEST_S3_KENNEL"]
        _put_settings(admin_h, {"daycare_capacity": 42, "kennels": new_kennels})
        after = _get_settings(admin_h)
        assert after["daycare_capacity"] == 42
        assert "TEST_S3_KENNEL" in after["kennels"]
        # untouched key still present
        assert after["booking_rules"]["cancellation_cutoff_hours"] == before["booking_rules"]["cancellation_cutoff_hours"]
        # restore
        _put_settings(admin_h, {"daycare_capacity": orig_cap, "kennels": orig_kennels})

    def test_put_mood_tags_and_required_vaccines(self, admin_h):
        before = _get_settings(admin_h)
        _put_settings(admin_h, {"mood_tags": ["TEST_Happy", "TEST_Sleepy"],
                                "required_vaccines": ["rabies", "bordetella"]})
        after = _get_settings(admin_h)
        assert after["mood_tags"] == ["TEST_Happy", "TEST_Sleepy"]
        assert after["required_vaccines"] == ["rabies", "bordetella"]
        # restore
        _put_settings(admin_h, {"mood_tags": before["mood_tags"],
                                "required_vaccines": before["required_vaccines"]})

    def test_public_settings_for_client(self, s3_portal):
        h = {"Authorization": s3_portal["Authorization"]}
        r = requests.get(f"{BASE_URL}/api/settings/public", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # public surface
        for k in ["service_hours", "kennels", "booking_rules", "mood_tags", "required_vaccines"]:
            assert k in d
        # admin-only keys NOT in public
        assert "daycare_capacity" not in d
        assert "boarding_capacity" not in d
        assert "vaccine_warning_days" not in d
        assert "business_hours" not in d


# ------------- Change password -------------
class TestChangePassword:
    def test_change_password_flow(self, admin_h, s3_client):
        # create a fresh portal user just for this test
        email = f"pwtest_{uuid.uuid4().hex[:6]}@example.com"
        pw1 = "first123"
        pw2 = "second456"
        r = requests.post(f"{BASE_URL}/api/clients/{s3_client['id']}/portal-account",
                          json={"email": email, "password": pw1}, headers=admin_h, timeout=15)
        assert r.status_code == 200
        lr = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": pw1}, timeout=15)
        assert lr.status_code == 200
        token = lr.json()["token"]
        h = {"Authorization": f"Bearer {token}"}

        # wrong current pw rejected
        bad = requests.post(f"{BASE_URL}/api/auth/change-password",
                            json={"current_password": "WRONG", "new_password": pw2},
                            headers=h, timeout=15)
        assert bad.status_code == 400

        # correct current pw accepted
        ok = requests.post(f"{BASE_URL}/api/auth/change-password",
                           json={"current_password": pw1, "new_password": pw2},
                           headers=h, timeout=15)
        assert ok.status_code == 200, ok.text

        # old pw no longer works
        old = requests.post(f"{BASE_URL}/api/auth/login",
                            json={"email": email, "password": pw1}, timeout=15)
        assert old.status_code == 401
        # new pw works
        new = requests.post(f"{BASE_URL}/api/auth/login",
                            json={"email": email, "password": pw2}, timeout=15)
        assert new.status_code == 200


# ------------- Vaccine enforcement via settings -------------
class TestVaccineRules:
    def test_booking_rejected_when_required_vaccine_missing(self, admin_h, s3_client):
        # add a dog with only rabies
        fut = (date.today() + timedelta(days=365)).isoformat()
        d = requests.post(f"{BASE_URL}/api/dogs",
                          json={"owner_id": s3_client["id"], "name": "TEST_S3_Partial",
                                "vaccines": {"rabies": fut, "bordetella": "", "dhpp": ""}},
                          headers=admin_h, timeout=15).json()
        # tighten settings
        _put_settings(admin_h, {"required_vaccines": ["rabies", "bordetella"]})
        try:
            r = requests.post(f"{BASE_URL}/api/bookings",
                              json={"dog_id": d["id"], "date": date.today().isoformat(), "service_type": "daycare"},
                              headers=admin_h, timeout=15)
            assert r.status_code == 400
            assert "bordetella" in r.text.lower()
        finally:
            _put_settings(admin_h, {"required_vaccines": ["rabies"]})


# ------------- Auto-approve & cancellation cutoff -------------
class TestAutoApproveAndCutoff:
    def test_auto_approve_for_clients(self, admin_h, s3_portal, s3_dog):
        rules_orig = _get_settings(admin_h)["booking_rules"]
        # enable auto-approve and zero cutoff so client can also cancel later
        patch = deepcopy(rules_orig); patch["auto_approve"] = True; patch["cancellation_cutoff_hours"] = 0
        _put_settings(admin_h, {"booking_rules": patch})
        try:
            # use a date >7 days in future to bypass cutoff concerns
            target = (date.today() + timedelta(days=8)).isoformat()
            h = {"Authorization": s3_portal["Authorization"]}
            r = requests.post(f"{BASE_URL}/api/bookings",
                              json={"dog_id": s3_dog["id"], "date": target, "service_type": "daycare"},
                              headers=h, timeout=15)
            assert r.status_code == 200, r.text
            b = r.json()
            assert b["status"] == "approved", f"expected auto-approved, got {b['status']}"
            # cleanup booking
            requests.delete(f"{BASE_URL}/api/bookings/{b['id']}", headers=admin_h, timeout=15)
        finally:
            _put_settings(admin_h, {"booking_rules": rules_orig})

    def test_cancellation_cutoff_for_client(self, admin_h, s3_portal, s3_dog):
        rules_orig = _get_settings(admin_h)["booking_rules"]
        # big cutoff so client cannot cancel a near-term booking
        patch = deepcopy(rules_orig); patch["cancellation_cutoff_hours"] = 240
        _put_settings(admin_h, {"booking_rules": patch})
        try:
            target = (date.today() + timedelta(days=2)).isoformat()
            h = {"Authorization": s3_portal["Authorization"]}
            # admin creates booking (so no insufficient credits / pending issues)
            cr = requests.post(f"{BASE_URL}/api/bookings",
                               json={"dog_id": s3_dog["id"], "date": target, "service_type": "daycare"},
                               headers=admin_h, timeout=15)
            assert cr.status_code == 200, cr.text
            bid = cr.json()["id"]
            # client tries to cancel -> 400
            r = requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=h, timeout=15)
            assert r.status_code == 400
            # admin can always cancel
            r2 = requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_h, timeout=15)
            assert r2.status_code == 200
        finally:
            _put_settings(admin_h, {"booking_rules": rules_orig})


# ------------- Recurring bookings -------------
class TestRecurringBookings:
    def test_create_recurring_admin(self, admin_h, s3_dog):
        # next 21 days, Mon & Wed
        start = date.today() + timedelta(days=1)
        end = start + timedelta(days=20)
        r = requests.post(f"{BASE_URL}/api/bookings/recurring",
                          json={"dog_id": s3_dog["id"],
                                "start_date": start.isoformat(),
                                "end_date": end.isoformat(),
                                "service_type": "daycare",
                                "weekdays": [0, 2]},
                          headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "created" in data and "skipped" in data
        assert isinstance(data["created"], list)
        # weekday filter should yield at least 1 entry, < total span days
        assert 1 <= len(data["created"]) <= 21
        for b in data["created"]:
            d = datetime.fromisoformat(b["date"]).date()
            assert d.weekday() in (0, 2)
            assert b["service_type"] == "daycare"
            # admin -> approved
            assert b["status"] == "approved"
            requests.delete(f"{BASE_URL}/api/bookings/{b['id']}", headers=admin_h, timeout=15)

    def test_recurring_validation(self, admin_h, s3_dog):
        # empty weekdays
        r = requests.post(f"{BASE_URL}/api/bookings/recurring",
                          json={"dog_id": s3_dog["id"],
                                "start_date": date.today().isoformat(),
                                "end_date": (date.today() + timedelta(days=5)).isoformat(),
                                "service_type": "daycare",
                                "weekdays": []},
                          headers=admin_h, timeout=15)
        assert r.status_code == 400
        # end before start
        r2 = requests.post(f"{BASE_URL}/api/bookings/recurring",
                           json={"dog_id": s3_dog["id"],
                                 "start_date": (date.today() + timedelta(days=5)).isoformat(),
                                 "end_date": date.today().isoformat(),
                                 "service_type": "daycare",
                                 "weekdays": [0]},
                           headers=admin_h, timeout=15)
        assert r2.status_code == 400


# ------------- Reschedule -------------
class TestReschedule:
    def test_admin_reschedule(self, admin_h, s3_dog):
        d1 = (date.today() + timedelta(days=3)).isoformat()
        d2 = (date.today() + timedelta(days=7)).isoformat()
        cr = requests.post(f"{BASE_URL}/api/bookings",
                           json={"dog_id": s3_dog["id"], "date": d1, "service_type": "daycare"},
                           headers=admin_h, timeout=15)
        assert cr.status_code == 200, cr.text
        bid = cr.json()["id"]
        r = requests.put(f"{BASE_URL}/api/bookings/{bid}/reschedule",
                        json={"date": d2, "end_date": None}, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["date"] == d2
        # persisted
        lst = requests.get(f"{BASE_URL}/api/bookings", headers=admin_h, timeout=15).json()
        found = next(b for b in lst if b["id"] == bid)
        assert found["date"] == d2
        requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_h, timeout=15)

    def test_reschedule_404(self, admin_h):
        r = requests.put(f"{BASE_URL}/api/bookings/nope/reschedule",
                        json={"date": date.today().isoformat()}, headers=admin_h, timeout=15)
        assert r.status_code == 404

    def test_reschedule_requires_admin(self, s3_portal, admin_h, s3_dog):
        d1 = (date.today() + timedelta(days=4)).isoformat()
        cr = requests.post(f"{BASE_URL}/api/bookings",
                           json={"dog_id": s3_dog["id"], "date": d1, "service_type": "daycare"},
                           headers=admin_h, timeout=15)
        bid = cr.json()["id"]
        h = {"Authorization": s3_portal["Authorization"]}
        r = requests.put(f"{BASE_URL}/api/bookings/{bid}/reschedule",
                        json={"date": (date.today() + timedelta(days=5)).isoformat()},
                        headers=h, timeout=15)
        assert r.status_code == 403
        requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_h, timeout=15)


# ------------- Training service type -------------
class TestTrainingServiceType:
    def test_create_training_booking(self, admin_h, s3_dog):
        target = (date.today() + timedelta(days=2)).isoformat()
        r = requests.post(f"{BASE_URL}/api/bookings",
                          json={"dog_id": s3_dog["id"], "date": target, "service_type": "training"},
                          headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["service_type"] == "training"
        assert b["status"] == "approved"
        requests.delete(f"{BASE_URL}/api/bookings/{b['id']}", headers=admin_h, timeout=15)

    def test_recurring_training(self, admin_h, s3_dog):
        start = date.today() + timedelta(days=1)
        end = start + timedelta(days=14)
        r = requests.post(f"{BASE_URL}/api/bookings/recurring",
                          json={"dog_id": s3_dog["id"],
                                "start_date": start.isoformat(),
                                "end_date": end.isoformat(),
                                "service_type": "training",
                                "weekdays": [4]},
                          headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        for b in r.json()["created"]:
            assert b["service_type"] == "training"
            requests.delete(f"{BASE_URL}/api/bookings/{b['id']}", headers=admin_h, timeout=15)

    def test_dashboard_training_today(self, admin_h, s3_dog):
        today = date.today().isoformat()
        cr = requests.post(f"{BASE_URL}/api/bookings",
                           json={"dog_id": s3_dog["id"], "date": today, "service_type": "training"},
                           headers=admin_h, timeout=15)
        assert cr.status_code == 200, cr.text
        bid = cr.json()["id"]
        stats = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_h, timeout=15).json()
        assert "training_today" in stats
        assert stats["training_today"] >= 1
        assert "daycare_capacity" in stats
        requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_h, timeout=15)


# ------------- Capacity from settings -------------
class TestCapacityFromSettings:
    def test_daycare_capacity_enforced(self, admin_h, s3_client, s3_dog):
        rules_orig = _get_settings(admin_h)
        _put_settings(admin_h, {"daycare_capacity": 1})
        target = (date.today() + timedelta(days=15)).isoformat()
        created_ids = []
        try:
            # first booking succeeds
            r1 = requests.post(f"{BASE_URL}/api/bookings",
                               json={"dog_id": s3_dog["id"], "date": target, "service_type": "daycare"},
                               headers=admin_h, timeout=15)
            assert r1.status_code == 200, r1.text
            created_ids.append(r1.json()["id"])
            # second one for SAME date should hit capacity
            # need a second dog
            fut = (date.today() + timedelta(days=365)).isoformat()
            d2 = requests.post(f"{BASE_URL}/api/dogs",
                               json={"owner_id": s3_client["id"], "name": "TEST_S3_Dog2",
                                     "vaccines": {"rabies": fut, "bordetella": fut, "dhpp": fut}},
                               headers=admin_h, timeout=15).json()
            r2 = requests.post(f"{BASE_URL}/api/bookings",
                               json={"dog_id": d2["id"], "date": target, "service_type": "daycare"},
                               headers=admin_h, timeout=15)
            assert r2.status_code == 400
            assert "fully booked" in r2.text.lower() or "capacity" in r2.text.lower()
        finally:
            for bid in created_ids:
                requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_h, timeout=15)
            _put_settings(admin_h, {"daycare_capacity": rules_orig["daycare_capacity"]})


# ------------- Cleanup -------------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_h):
    yield
    try:
        cl = requests.get(f"{BASE_URL}/api/clients", headers=admin_h, timeout=15).json()
        for c in cl:
            if c["name"].startswith("TEST_S3_"):
                requests.delete(f"{BASE_URL}/api/clients/{c['id']}", headers=admin_h, timeout=15)
    except Exception:
        pass
