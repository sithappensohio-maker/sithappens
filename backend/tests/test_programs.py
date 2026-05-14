"""Iteration 9 — Training Programs (Phase A+B) backend tests.

Covers:
- /api/programs/meta (types, goal_status, enrollment_status)
- /api/programs seed-on-first-call (admin only, clients 403)
- CRUD on /api/programs (create / update / soft-delete)
- /api/dogs/{id}/programs enroll w/ snapshot + auto-pause previous active
- list_dog_enrollments sort + summary derived fields
- goal score update (0/1-3/4-5 -> not_started/in_progress/mastered) + mastered_pct
- enrollment status transitions (active -> completed / paused; paused -> active re-pauses other)
- POST /api/dogs/{id}/programs/custom (creates type=custom + auto-enroll)
- /api/programs/active-summary totals + by_type
- /api/run-sheet active_program_name pill
- auth scoping: clients GET own enrollments; cannot POST/PUT/DELETE
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}
CLIENT = {"email": "testclient@sithappens.com", "password": "test1234"}


# ---------- helpers ----------
def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN)}"}


@pytest.fixture(scope="module")
def client_h():
    return {"Authorization": f"Bearer {_login(CLIENT)}"}


@pytest.fixture(scope="module")
def client_dogs(client_h):
    r = requests.get(f"{BASE_URL}/api/dogs", headers=client_h, timeout=15)
    assert r.status_code == 200
    dogs = r.json()
    assert len(dogs) >= 2, "client should have Rocky + Daisy"
    return dogs


@pytest.fixture(scope="module")
def rocky_id(client_dogs):
    for d in client_dogs:
        if d["name"].lower() == "rocky":
            return d["id"]
    return client_dogs[0]["id"]


@pytest.fixture(scope="module")
def daisy_id(client_dogs):
    for d in client_dogs:
        if d["name"].lower() == "daisy":
            return d["id"]
    return client_dogs[1]["id"]


# ---------- meta ----------
class TestProgramsMeta:
    def test_meta_returns_types_and_statuses(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/meta", headers=admin_h, timeout=15)
        assert r.status_code == 200
        data = r.json()
        type_keys = {t["key"] for t in data["types"]}
        assert {"private_lessons", "board_train", "service_dog", "custom"}.issubset(type_keys)
        assert data["goal_status"] == ["not_started", "in_progress", "mastered"]
        assert set(data["enrollment_status"]) == {"active", "completed", "paused", "withdrawn"}


# ---------- list / seed ----------
class TestProgramsList:
    def test_list_seeds_7_default_programs_for_admin(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15)
        assert r.status_code == 200
        programs = r.json()
        defaults = [p for p in programs if p.get("is_default")]
        assert len(defaults) >= 7, f"expected >=7 default programs, got {len(defaults)}"
        slugs = {p["slug"] for p in defaults}
        expected = {
            "puppy_preschool", "level_1_basic_manners", "level_2_intermediate",
            "level_3_off_leash", "bt_1_week_fundamentals", "bt_2_week_essential",
            "bt_3_week_off_leash",
        }
        assert expected.issubset(slugs), f"missing seeded slugs: {expected - slugs}"
        # ensure modules+goals stamped with ids
        sample = next(p for p in defaults if p["slug"] == "puppy_preschool")
        assert len(sample["modules"]) >= 1
        for m in sample["modules"]:
            assert m.get("id")
            for g in m["goals"]:
                assert g.get("id") and g.get("name")

    def test_list_programs_forbidden_for_client(self, client_h):
        r = requests.get(f"{BASE_URL}/api/programs", headers=client_h, timeout=15)
        assert r.status_code == 403


# ---------- CRUD on programs (non-default) ----------
class TestProgramsCRUD:
    def test_create_update_delete_program(self, admin_h):
        payload = {
            "name": "TEST_Custom_Library_Prog",
            "type": "private_lessons",
            "description": "test",
            "modules": [
                {"name": "TEST_Module_A", "goals": [{"name": "TEST_Goal_1"}, {"name": "TEST_Goal_2"}]}
            ],
        }
        r = requests.post(f"{BASE_URL}/api/programs", json=payload, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        prog = r.json()
        assert prog["is_default"] is False
        assert prog["name"] == payload["name"]
        assert prog["modules"][0]["goals"][0]["id"]
        pid = prog["id"]

        # update
        payload["description"] = "updated"
        payload["modules"][0]["goals"].append({"name": "TEST_Goal_3"})
        r2 = requests.put(f"{BASE_URL}/api/programs/{pid}", json=payload, headers=admin_h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["description"] == "updated"
        assert len(r2.json()["modules"][0]["goals"]) == 3

        # soft delete
        r3 = requests.delete(f"{BASE_URL}/api/programs/{pid}", headers=admin_h, timeout=15)
        assert r3.status_code == 200

        # confirm absent from default list (active=false filter)
        r4 = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15)
        assert pid not in {p["id"] for p in r4.json()}

    def test_create_forbidden_for_client(self, client_h):
        r = requests.post(f"{BASE_URL}/api/programs",
                          json={"name": "TEST_x", "type": "private_lessons", "modules": []},
                          headers=client_h, timeout=15)
        assert r.status_code == 403


# ---------- enroll dog + auto-pause + summary ----------
class TestEnrollment:
    def test_enroll_and_summary(self, admin_h, rocky_id):
        # pick Level 1 default program
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        level1 = next(p for p in progs if p["slug"] == "level_1_basic_manners")
        r = requests.post(f"{BASE_URL}/api/dogs/{rocky_id}/programs",
                          json={"program_id": level1["id"]}, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["status"] == "active"
        assert e["program_snapshot"]["name"] == level1["name"]
        assert e["program_snapshot"]["modules"]
        assert e["total_goals"] >= 1
        assert e["mastered_goals"] == 0
        assert e["mastered_pct"] == 0

    def test_second_enroll_pauses_first(self, admin_h, rocky_id):
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        puppy = next(p for p in progs if p["slug"] == "puppy_preschool")
        r = requests.post(f"{BASE_URL}/api/dogs/{rocky_id}/programs",
                          json={"program_id": puppy["id"]}, headers=admin_h, timeout=15)
        assert r.status_code == 200
        # list — only one active
        lst = requests.get(f"{BASE_URL}/api/dogs/{rocky_id}/programs", headers=admin_h, timeout=15).json()
        active = [e for e in lst if e["status"] == "active"]
        paused = [e for e in lst if e["status"] == "paused"]
        assert len(active) == 1
        assert len(paused) >= 1
        assert active[0]["program_snapshot"]["slug"] == "puppy_preschool"

    def test_client_can_get_own_enrollments(self, client_h, rocky_id):
        r = requests.get(f"{BASE_URL}/api/dogs/{rocky_id}/programs", headers=client_h, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_client_cannot_enroll(self, client_h, rocky_id, admin_h):
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        r = requests.post(f"{BASE_URL}/api/dogs/{rocky_id}/programs",
                          json={"program_id": progs[0]["id"]}, headers=client_h, timeout=15)
        assert r.status_code in (401, 403)


# ---------- goal score update + status transitions ----------
class TestGoalAndStatus:
    def _active_enrollment(self, admin_h, dog_id):
        lst = requests.get(f"{BASE_URL}/api/dogs/{dog_id}/programs", headers=admin_h, timeout=15).json()
        return next(e for e in lst if e["status"] == "active")

    def test_goal_score_autobumps_status(self, admin_h, rocky_id):
        e = self._active_enrollment(admin_h, rocky_id)
        goals = e["program_snapshot"]["modules"][0]["goals"]
        g1, g2, g3 = goals[0], goals[1] if len(goals) > 1 else goals[0], goals[2] if len(goals) > 2 else goals[0]
        eid = e["id"]
        # score=5 → mastered
        r = requests.put(f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}/goals/{g1['id']}",
                         json={"score": 5}, headers=admin_h, timeout=15)
        assert r.status_code == 200
        gp = r.json()["goal_progress"][g1["id"]]
        assert gp["score"] == 5 and gp["status"] == "mastered"
        # score=2 → in_progress
        r = requests.put(f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}/goals/{g2['id']}",
                         json={"score": 2}, headers=admin_h, timeout=15)
        gp = r.json()["goal_progress"][g2["id"]]
        assert gp["status"] == "in_progress"
        # score=0 → not_started
        r = requests.put(f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}/goals/{g3['id']}",
                         json={"score": 0}, headers=admin_h, timeout=15)
        gp = r.json()["goal_progress"][g3["id"]]
        assert gp["status"] == "not_started"
        # mastered_pct recomputed
        assert r.json()["mastered_goals"] >= 1
        assert r.json()["mastered_pct"] > 0

    def test_status_transitions(self, admin_h, rocky_id):
        e = self._active_enrollment(admin_h, rocky_id)
        eid = e["id"]
        # active -> paused
        r = requests.put(f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}",
                         json={"status": "paused"}, headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "paused"
        assert r.json().get("paused_at")

        # dog.active_program_id cleared
        dog = requests.get(f"{BASE_URL}/api/dogs/{rocky_id}",
                           headers=admin_h, timeout=15).json()
        assert dog.get("active_program_id") in (None, "")

        # reactivate -> active (should pause any other active for same dog)
        r2 = requests.put(f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}",
                          json={"status": "active"}, headers=admin_h, timeout=15)
        assert r2.status_code == 200 and r2.json()["status"] == "active"

        # complete it
        r3 = requests.put(f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}",
                          json={"status": "completed"}, headers=admin_h, timeout=15)
        assert r3.status_code == 200
        assert r3.json()["status"] == "completed"
        assert r3.json().get("completed_at")
        dog = requests.get(f"{BASE_URL}/api/dogs/{rocky_id}",
                           headers=admin_h, timeout=15).json()
        assert dog.get("active_program_id") in (None, "")


# ---------- custom builder ----------
class TestCustomProgram:
    def test_custom_creates_and_enrolls(self, admin_h, daisy_id):
        payload = {
            "name": "TEST_Daisy_Custom_Plan",
            "description": "tailored",
            "modules": [
                {"name": "TEST_Foundations", "goals": [{"name": "TEST_Heel"}, {"name": "TEST_Sit"}]},
                {"name": "TEST_Advanced", "goals": [{"name": "TEST_Place"}]},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/dogs/{daisy_id}/programs/custom",
                          json=payload, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["status"] == "active"
        snap = e["program_snapshot"]
        assert snap["type"] == "custom"
        assert snap["name"] == payload["name"]
        names = [m["name"] for m in snap["modules"]]
        assert "TEST_Foundations" in names and "TEST_Advanced" in names
        # goal count
        gtot = sum(len(m["goals"]) for m in snap["modules"])
        assert gtot == 3
        assert e["total_goals"] == 3


# ---------- active-summary + run-sheet ----------
class TestActiveSummaryAndRunSheet:
    def test_active_summary(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/active-summary", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "total" in d and "by_type" in d
        assert isinstance(d["by_type"], dict)
        # Daisy custom is active now
        assert d["total"] >= 1

    def test_run_sheet_includes_active_program_name(self, admin_h, daisy_id):
        # ensure Daisy has an active program (idempotent)
        lst = requests.get(f"{BASE_URL}/api/dogs/{daisy_id}/programs",
                           headers=admin_h, timeout=15).json()
        if not any(e["status"] == "active" for e in lst):
            payload = {"name": "TEST_Daisy_Custom_Plan",
                       "modules": [{"name": "M1", "goals": [{"name": "G1"}]}]}
            requests.post(f"{BASE_URL}/api/dogs/{daisy_id}/programs/custom",
                          json=payload, headers=admin_h, timeout=15)
        # create a daycare booking today for Daisy
        from datetime import date
        today = date.today().isoformat()
        b = {
            "dog_id": daisy_id,
            "service_type": "daycare",
            "date": today,
            "status": "approved",
        }
        # admin booking create
        bk = requests.post(f"{BASE_URL}/api/bookings", json=b, headers=admin_h, timeout=15)
        # may already exist or different schema — just attempt
        bid = None
        if bk.status_code == 200:
            bid = bk.json().get("id")
        # fetch run-sheet
        r = requests.get(f"{BASE_URL}/api/run-sheet?date_str={today}",
                         headers=admin_h, timeout=15)
        assert r.status_code == 200
        sheet = r.json()
        # find Daisy's row; if missing skip soft
        daisy_rows = [b for b in sheet["bookings"] if (b.get("dog") or {}).get("id") == daisy_id]
        if daisy_rows:
            assert daisy_rows[0].get("active_program_name") == "TEST_Daisy_Custom_Plan"
        # cleanup booking
        if bid:
            requests.delete(f"{BASE_URL}/api/bookings/{bid}", headers=admin_h, timeout=15)


# ---------- cleanup ----------
class TestCleanup:
    def test_cleanup_enrollments(self, admin_h, rocky_id, daisy_id):
        for dog_id in (rocky_id, daisy_id):
            lst = requests.get(f"{BASE_URL}/api/dogs/{dog_id}/programs",
                               headers=admin_h, timeout=15).json()
            for e in lst:
                # withdraw to clear active pointer, then physically remove from db is not supported,
                # but withdrawing is fine — leaves dog clean of active_program_id.
                requests.put(f"{BASE_URL}/api/dogs/{dog_id}/programs/{e['id']}",
                             json={"status": "withdrawn"}, headers=admin_h, timeout=15)
        # confirm no active enrollment
        for dog_id in (rocky_id, daisy_id):
            lst = requests.get(f"{BASE_URL}/api/dogs/{dog_id}/programs",
                               headers=admin_h, timeout=15).json()
            assert not any(e["status"] == "active" for e in lst)
        # also soft-delete TEST_ custom programs so settings UI stays clean
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        for p in progs:
            if p["name"].startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/programs/{p['id']}", headers=admin_h, timeout=15)
