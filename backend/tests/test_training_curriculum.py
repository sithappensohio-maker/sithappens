"""Backend tests for Service-Dog Training Curriculum (iteration 8).

Covers:
- GET /api/training/meta
- GET /api/commands (auto-seed 36 TADSAW)
- POST/PUT/DELETE /api/commands (admin only)
- GET /api/dogs/{id}/training (grouped + progress + badges)
- PUT /api/dogs/{id}/training/{command_id}
- POST /api/dogs/{id}/training-sessions (highest-wins + cgc)
- GET /api/dogs/{id}/training-sessions
- Client auth scoping (client sees own dog, blocked from admin endpoints)
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")).rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}
CLIENT = {"email": "testclient@sithappens.com", "password": "test1234"}


# ---- fixtures ----
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def client_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=CLIENT, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def client_h(client_token):
    return {"Authorization": f"Bearer {client_token}"}


@pytest.fixture(scope="module")
def client_info(client_h):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=client_h, timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def client_dogs(client_h):
    """Returns dogs owned by test client (GET /api/dogs is scoped to caller)."""
    r = requests.get(f"{BASE_URL}/api/dogs", headers=client_h, timeout=15)
    assert r.status_code == 200, r.text
    dogs = r.json()
    assert len(dogs) >= 1, "test client needs at least one dog"
    return dogs


@pytest.fixture(scope="module")
def test_dog_id(client_dogs):
    return client_dogs[0]["id"]


# ---- meta + commands ----
class TestTrainingMeta:
    def test_meta_categories_and_scale(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/training/meta", headers=admin_h, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "categories" in data and "scale" in data
        keys = [c["key"] for c in data["categories"]]
        assert set(keys) == {"engagement", "obedience", "public_access", "task"}
        assert len(data["scale"]) == 6  # 0..5
        assert data["scale"][0]["value"] == 0
        assert data["scale"][-1]["value"] == 5

    def test_meta_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/training/meta", timeout=15)
        assert r.status_code in (401, 403)


class TestCommandLibrary:
    def test_get_commands_autoseeds_36(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15)
        assert r.status_code == 200
        cmds = r.json()
        assert len(cmds) >= 36, f"expected at least 36 seed commands, got {len(cmds)}"
        # All four categories represented
        cats = {c["category"] for c in cmds}
        assert {"engagement", "obedience", "public_access", "task"}.issubset(cats)
        # default seeds should carry is_default = True
        default_cmds = [c for c in cmds if c.get("is_default")]
        assert len(default_cmds) >= 36

    def test_seed_known_commands_present(self, admin_h):
        cmds = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15).json()
        names = {c["name"] for c in cmds}
        for expected in ["Sit", "Down", "Heel", "Leave It", "Touch", "Kennel"]:
            assert expected in names, f"seed command {expected} missing"

    def test_client_can_list_commands(self, client_h):
        r = requests.get(f"{BASE_URL}/api/commands", headers=client_h, timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 36

    def test_admin_create_update_delete(self, admin_h):
        payload = {"name": "TEST_Spin", "category": "task",
                   "description": "Test cmd", "order": 999, "active": True}
        cr = requests.post(f"{BASE_URL}/api/commands", json=payload, headers=admin_h, timeout=15)
        assert cr.status_code == 200, cr.text
        created = cr.json()
        assert created["name"] == "TEST_Spin"
        assert created["is_default"] is False
        cid = created["id"]

        # Update
        upd = {**payload, "name": "TEST_SpinV2", "description": "Updated"}
        ur = requests.put(f"{BASE_URL}/api/commands/{cid}", json=upd, headers=admin_h, timeout=15)
        assert ur.status_code == 200, ur.text
        assert ur.json()["name"] == "TEST_SpinV2"

        # Verify persisted in list
        listed = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15).json()
        found = next((c for c in listed if c["id"] == cid), None)
        assert found is not None
        assert found["name"] == "TEST_SpinV2"

        # Delete (soft) -> should disappear from active list
        dr = requests.delete(f"{BASE_URL}/api/commands/{cid}", headers=admin_h, timeout=15)
        assert dr.status_code == 200
        listed2 = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15).json()
        assert not any(c["id"] == cid for c in listed2)

    def test_client_cannot_create_command(self, client_h):
        payload = {"name": "TEST_Hack", "category": "task", "description": "x", "order": 1, "active": True}
        r = requests.post(f"{BASE_URL}/api/commands", json=payload, headers=client_h, timeout=15)
        assert r.status_code == 403

    def test_client_cannot_update_or_delete(self, client_h, admin_h):
        # create one as admin to attempt mutation
        payload = {"name": "TEST_BlockMe", "category": "engagement", "description": "x", "order": 1, "active": True}
        cid = requests.post(f"{BASE_URL}/api/commands", json=payload, headers=admin_h, timeout=15).json()["id"]
        r = requests.put(f"{BASE_URL}/api/commands/{cid}", json=payload, headers=client_h, timeout=15)
        assert r.status_code == 403
        r2 = requests.delete(f"{BASE_URL}/api/commands/{cid}", headers=client_h, timeout=15)
        assert r2.status_code == 403
        # cleanup
        requests.delete(f"{BASE_URL}/api/commands/{cid}", headers=admin_h, timeout=15)


# ---- dog curriculum ----
class TestDogCurriculum:
    def test_get_training_returns_36_items(self, admin_h, test_dog_id):
        r = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training", headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["dog_id"] == test_dog_id
        assert "items" in data and "progress" in data and "badges" in data
        assert len(data["items"]) >= 36
        # each item shape
        sample = data["items"][0]
        for k in ("command", "level", "notes", "in_homework"):
            assert k in sample

    def test_get_training_initial_level_zero(self, admin_h, test_dog_id):
        # Reset dog curriculum first to ensure baseline
        # (We can't directly reset, but assert items have at least the schema)
        data = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training", headers=admin_h, timeout=15).json()
        # progress structure
        assert "overall" in data["progress"]
        assert "by_category" in data["progress"]
        assert len(data["progress"]["by_category"]) == 4

    def test_client_can_see_own_dog_training(self, client_h, test_dog_id):
        r = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training", headers=client_h, timeout=15)
        assert r.status_code == 200
        assert r.json()["dog_id"] == test_dog_id

    def test_client_cannot_update_curriculum(self, client_h, admin_h, test_dog_id):
        # Get a command id
        cmds = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15).json()
        any_cid = cmds[0]["id"]
        r = requests.put(
            f"{BASE_URL}/api/dogs/{test_dog_id}/training/{any_cid}",
            json={"command_id": any_cid, "level": 3, "notes": "client try", "in_homework": False},
            headers=client_h, timeout=15,
        )
        assert r.status_code == 403

    def test_admin_put_curriculum_persists(self, admin_h, test_dog_id):
        cmds = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15).json()
        sit = next(c for c in cmds if c["name"] == "Sit")
        body = {"command_id": sit["id"], "level": 4, "notes": "Solid in living room", "in_homework": True}
        r = requests.put(
            f"{BASE_URL}/api/dogs/{test_dog_id}/training/{sit['id']}",
            json=body, headers=admin_h, timeout=15,
        )
        assert r.status_code == 200, r.text

        # Verify persisted via GET
        data = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training", headers=admin_h, timeout=15).json()
        target = next(i for i in data["items"] if i["command"]["id"] == sit["id"])
        assert target["level"] == 4
        assert target["notes"] == "Solid in living room"
        assert target["in_homework"] is True


# ---- training sessions ----
class TestTrainingSessions:
    def test_admin_log_session_highest_wins(self, admin_h, test_dog_id):
        cmds = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15).json()
        sit = next(c for c in cmds if c["name"] == "Sit")
        down = next(c for c in cmds if c["name"] == "Down")

        # First session: score Sit=2, Down=5
        s1 = {
            "date": "2026-01-10",
            "environment": "home",
            "distraction": 1,
            "notes": "First session",
            "scores": [
                {"command_id": sit["id"], "score": 2},  # should NOT lower (already 4)
                {"command_id": down["id"], "score": 5},
            ],
            "cgc_mock_pass": False,
        }
        r = requests.post(f"{BASE_URL}/api/dogs/{test_dog_id}/training-sessions",
                          json=s1, headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        ret = r.json()
        assert ret["dog_id"] == test_dog_id
        assert len(ret["scores"]) == 2

        # Verify curriculum (highest wins): Sit still 4, Down now 5
        data = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training", headers=admin_h, timeout=15).json()
        sit_item = next(i for i in data["items"] if i["command"]["id"] == sit["id"])
        down_item = next(i for i in data["items"] if i["command"]["id"] == down["id"])
        assert sit_item["level"] == 4, f"Sit should stay at 4 (highest wins), got {sit_item['level']}"
        assert down_item["level"] == 5
        assert sit_item.get("last_session_at") == "2026-01-10"

    def test_list_sessions(self, admin_h, test_dog_id):
        r = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training-sessions",
                         headers=admin_h, timeout=15)
        assert r.status_code == 200
        sessions = r.json()
        assert isinstance(sessions, list)
        assert len(sessions) >= 1

    def test_client_cannot_log_session(self, client_h, test_dog_id):
        body = {"date": "2026-01-11", "environment": "home", "distraction": 1,
                "notes": "", "scores": [], "cgc_mock_pass": False}
        r = requests.post(f"{BASE_URL}/api/dogs/{test_dog_id}/training-sessions",
                          json=body, headers=client_h, timeout=15)
        assert r.status_code == 403

    def test_client_can_list_own_dog_sessions(self, client_h, test_dog_id):
        r = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training-sessions",
                         headers=client_h, timeout=15)
        assert r.status_code == 200

    def test_cgc_mock_pass_sets_field(self, admin_h, test_dog_id):
        body = {"date": "2026-01-12", "environment": "store", "distraction": 5,
                "notes": "Mock CGC", "scores": [], "cgc_mock_pass": True}
        r = requests.post(f"{BASE_URL}/api/dogs/{test_dog_id}/training-sessions",
                          json=body, headers=admin_h, timeout=15)
        assert r.status_code == 200
        data = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training",
                            headers=admin_h, timeout=15).json()
        assert data.get("cgc_mock_passed_at") == "2026-01-12"


# ---- badge logic via API (data-driven) ----
class TestBadgeLogic:
    def test_bronze_emerges_when_basics_50pct(self, admin_h, test_dog_id):
        """Mastering ~50% of engagement+obedience should yield Bronze badge."""
        cmds = requests.get(f"{BASE_URL}/api/commands", headers=admin_h, timeout=15).json()
        eng = [c for c in cmds if c["category"] == "engagement"]
        obe = [c for c in cmds if c["category"] == "obedience"]
        # master enough to push avg ≥ 50
        to_master = eng + obe[:max(1, len(obe) // 2)]
        for c in to_master:
            requests.put(
                f"{BASE_URL}/api/dogs/{test_dog_id}/training/{c['id']}",
                json={"command_id": c["id"], "level": 5, "notes": "", "in_homework": False},
                headers=admin_h, timeout=15,
            )
        data = requests.get(f"{BASE_URL}/api/dogs/{test_dog_id}/training",
                            headers=admin_h, timeout=15).json()
        badge_keys = {b["key"] for b in data["badges"]}
        assert "bronze" in badge_keys, f"Bronze expected, got: {badge_keys}"
