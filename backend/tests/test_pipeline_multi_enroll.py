"""Iteration 10 — Pipeline + Multi-Enrollment + manual_only goals + tags backend tests.

Covers the NEW features shipped in this iteration:
- GET /api/programs/pipeline (filters: status / type / search)
- GET /api/programs/meta — 4 program types
- POST /api/programs/seed-standard idempotent
- POST /api/programs with manual_only checkbox goals (mixed scored + manual_only)
- PUT /api/programs/{id} updates name/modules/completion_rule
- DELETE /api/programs/{id} soft delete
- POST /api/dogs/{id}/programs supports multi-enrollment (multiple active at once)
- target_completion_date echoed back
- PUT /api/dogs/{id}/programs/{eid} updates status / target_completion_date / notes
- PUT goal endpoint sets boolean-equivalent (status=mastered) for manual_only goals
- GET /api/programs/active-summary
- PUT /api/dogs/{id}/tags persists tags
"""
import os
import requests
import pytest

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}
CLIENT = {"email": "testclient@sithappens.com", "password": "test1234"}


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
def rocky_id(admin_h):
    r = requests.get(f"{BASE_URL}/api/dogs", headers=admin_h, timeout=15)
    assert r.status_code == 200
    rocky = next((d for d in r.json() if d["name"].lower() == "rocky"), None)
    assert rocky, "Rocky must exist"
    return rocky["id"]


@pytest.fixture(scope="module")
def daisy_id(admin_h):
    r = requests.get(f"{BASE_URL}/api/dogs", headers=admin_h, timeout=15)
    daisy = next((d for d in r.json() if d["name"].lower() == "daisy"), None)
    assert daisy, "Daisy must exist"
    return daisy["id"]


# ---------- meta ----------
class TestMeta:
    def test_meta_has_four_program_types(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/meta", headers=admin_h, timeout=15)
        assert r.status_code == 200
        keys = {t["key"] for t in r.json()["types"]}
        assert {"private_lessons", "board_train", "service_dog", "custom"}.issubset(keys)


# ---------- seed idempotency ----------
class TestSeed:
    def test_seed_standard_idempotent(self, admin_h):
        r1 = requests.post(f"{BASE_URL}/api/programs/seed-standard", headers=admin_h, timeout=15)
        assert r1.status_code == 200
        count1 = r1.json()["default_programs"]
        r2 = requests.post(f"{BASE_URL}/api/programs/seed-standard", headers=admin_h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["default_programs"] == count1, "seed must be idempotent"
        assert count1 >= 1


# ---------- list programs ----------
class TestList:
    def test_list_returns_seeded(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15)
        assert r.status_code == 200
        progs = r.json()
        assert len(progs) >= 1
        assert any(p.get("is_default") for p in progs)


# ---------- CRUD with mixed scored + manual_only goals ----------
class TestProgramCRUDWithManualOnly:
    created_id = None

    def test_create_program_with_manual_only_goal(self, admin_h):
        payload = {
            "name": "TEST_Pipeline_Mixed_Goals",
            "type": "private_lessons",
            "description": "mixed goals",
            "modules": [{
                "name": "TEST_Mixed_Module",
                "goals": [
                    {"name": "TEST_Scored_Goal"},  # scored 0-5
                    {"name": "TEST_Checkbox_Goal", "manual_only": True},
                ],
            }],
        }
        r = requests.post(f"{BASE_URL}/api/programs", json=payload, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        prog = r.json()
        TestProgramCRUDWithManualOnly.created_id = prog["id"]
        goals = prog["modules"][0]["goals"]
        # Verify manual_only is preserved
        scored = next(g for g in goals if g["name"] == "TEST_Scored_Goal")
        manual = next(g for g in goals if g["name"] == "TEST_Checkbox_Goal")
        assert scored["manual_only"] is False
        assert manual["manual_only"] is True

    def test_update_program(self, admin_h):
        pid = TestProgramCRUDWithManualOnly.created_id
        payload = {
            "name": "TEST_Pipeline_Mixed_Goals_v2",
            "type": "private_lessons",
            "modules": [{
                "name": "TEST_Renamed_Module",
                "goals": [{"name": "TEST_New_Goal", "manual_only": True}],
            }],
            "completion_rule": {"kind": "all_mastered"},
        }
        r = requests.put(f"{BASE_URL}/api/programs/{pid}", json=payload, headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "TEST_Pipeline_Mixed_Goals_v2"
        assert d["modules"][0]["name"] == "TEST_Renamed_Module"
        assert d["modules"][0]["goals"][0]["manual_only"] is True

    def test_delete_program(self, admin_h):
        pid = TestProgramCRUDWithManualOnly.created_id
        r = requests.delete(f"{BASE_URL}/api/programs/{pid}", headers=admin_h, timeout=15)
        assert r.status_code == 200
        # verify it's gone from active list
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        assert pid not in {p["id"] for p in progs}


# ---------- Multi-enrollment ----------
class TestMultiEnrollment:
    enrollments = []

    def test_enroll_first_program(self, admin_h, rocky_id):
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        prog = next(p for p in progs if p.get("is_default"))
        r = requests.post(
            f"{BASE_URL}/api/dogs/{rocky_id}/programs",
            json={"program_id": prog["id"], "target_completion_date": "2026-06-01"},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["status"] == "active"
        assert e["target_completion_date"] == "2026-06-01"
        TestMultiEnrollment.enrollments.append(e)

    def test_enroll_second_program_keeps_first_active(self, admin_h, rocky_id):
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        first_pid = TestMultiEnrollment.enrollments[0]["program_id"]
        second = next(p for p in progs if p.get("is_default") and p["id"] != first_pid)
        r = requests.post(
            f"{BASE_URL}/api/dogs/{rocky_id}/programs",
            json={"program_id": second["id"]},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200
        TestMultiEnrollment.enrollments.append(r.json())
        # both should be active
        lst = requests.get(f"{BASE_URL}/api/dogs/{rocky_id}/programs",
                           headers=admin_h, timeout=15).json()
        active = [e for e in lst if e["status"] == "active"]
        assert len(active) >= 2, f"multi-enrollment failed: only {len(active)} active"

    def test_update_target_completion_date(self, admin_h, rocky_id):
        eid = TestMultiEnrollment.enrollments[0]["id"]
        r = requests.put(
            f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}",
            json={"target_completion_date": "2026-12-31", "trainer_notes": "TEST_note"},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["target_completion_date"] == "2026-12-31"
        assert r.json()["trainer_notes"] == "TEST_note"

    def test_update_status_on_hold(self, admin_h, rocky_id):
        eid = TestMultiEnrollment.enrollments[0]["id"]
        r = requests.put(
            f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}",
            json={"status": "on_hold"},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "on_hold"

    def test_goal_manual_only_status_mastered(self, admin_h, rocky_id):
        # use 2nd enrollment (still active)
        e2 = TestMultiEnrollment.enrollments[1]
        eid = e2["id"]
        goals = e2["program_snapshot"]["modules"][0]["goals"]
        g = goals[0]
        # set status=mastered directly (manual_only behavior)
        r = requests.put(
            f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}/goals/{g['id']}",
            json={"status": "mastered"},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["goal_progress"][g["id"]]["status"] == "mastered"
        assert r.json()["mastered_goals"] >= 1

    def test_goal_scored_autobump(self, admin_h, rocky_id):
        e2 = TestMultiEnrollment.enrollments[1]
        eid = e2["id"]
        goals = e2["program_snapshot"]["modules"][0]["goals"]
        if len(goals) < 2:
            pytest.skip("need >=2 goals")
        g = goals[1]
        r = requests.put(
            f"{BASE_URL}/api/dogs/{rocky_id}/programs/{eid}/goals/{g['id']}",
            json={"score": 5},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["goal_progress"][g["id"]]["status"] == "mastered"


# ---------- pipeline ----------
class TestPipeline:
    def test_pipeline_returns_list(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/pipeline", headers=admin_h, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # we created 2 enrollments above for rocky
        assert len(rows) >= 1
        # required fields
        for row in rows:
            assert "dog_id" in row
            assert "dog_name" in row
            assert "status" in row
            assert "mastered_pct" in row

    def test_pipeline_filter_by_status_active(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/pipeline?status=active",
                         headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert all(row["status"] == "active" for row in r.json())

    def test_pipeline_filter_by_type(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/pipeline?type=private_lessons",
                         headers=admin_h, timeout=15)
        assert r.status_code == 200
        for row in r.json():
            assert row["program_snapshot"]["type"] == "private_lessons"

    def test_pipeline_search(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/pipeline?search=rocky",
                         headers=admin_h, timeout=15)
        assert r.status_code == 200
        for row in r.json():
            assert "rocky" in (row.get("dog_name") or "").lower()

    def test_pipeline_forbidden_for_client(self, client_h):
        r = requests.get(f"{BASE_URL}/api/programs/pipeline", headers=client_h, timeout=15)
        assert r.status_code in (401, 403)


# ---------- active summary ----------
class TestActiveSummary:
    def test_active_summary_has_counts(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/programs/active-summary",
                         headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "total" in d and "by_type" in d
        assert d["total"] >= 1


# ---------- tags ----------
class TestTags:
    def test_update_dog_tags(self, admin_h, daisy_id):
        r = requests.put(
            f"{BASE_URL}/api/dogs/{daisy_id}/tags",
            json={"tags": ["TEST_friendly", "TEST_VIP", "  TEST_friendly  "]},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200
        tags = r.json()["tags"]
        # dedupe + trim
        assert "TEST_friendly" in tags
        assert "TEST_VIP" in tags
        assert len(tags) == 2

    def test_tag_persists_on_dog(self, admin_h, daisy_id):
        # KNOWN BUG: GET /api/dogs response_model=List[DogOut] does NOT include 'tags' field
        # because DogIn/DogOut Pydantic models do not declare it. Tag persists in DB but is
        # silently stripped from the response. Frontend Tag editor will appear empty after refresh.
        r = requests.get(f"{BASE_URL}/api/dogs", headers=admin_h, timeout=15)
        assert r.status_code == 200
        daisy = next(d for d in r.json() if d["id"] == daisy_id)
        # This assertion will FAIL until DogOut adds: tags: List[str] = []
        assert "TEST_friendly" in (daisy.get("tags") or []), (
            "BUG: DogOut Pydantic model is missing `tags` field — "
            "PUT /api/dogs/{id}/tags persists to DB but GET /api/dogs strips it. "
            "Fix: add `tags: List[str] = []` to DogIn (line ~184) or DogOut."
        )

    def test_remove_tags(self, admin_h, daisy_id):
        r = requests.put(
            f"{BASE_URL}/api/dogs/{daisy_id}/tags",
            json={"tags": []},
            headers=admin_h, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["tags"] == []


# ---------- cleanup ----------
class TestCleanup:
    def test_cleanup(self, admin_h, rocky_id):
        lst = requests.get(f"{BASE_URL}/api/dogs/{rocky_id}/programs",
                           headers=admin_h, timeout=15).json()
        for e in lst:
            requests.put(
                f"{BASE_URL}/api/dogs/{rocky_id}/programs/{e['id']}",
                json={"status": "withdrawn"},
                headers=admin_h, timeout=15,
            )
        # remove TEST_ programs
        progs = requests.get(f"{BASE_URL}/api/programs", headers=admin_h, timeout=15).json()
        for p in progs:
            if p["name"].startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/programs/{p['id']}",
                                headers=admin_h, timeout=15)
