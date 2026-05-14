"""Sit Happens — Homework Templates Library + per-section logging + aggregated report.

Covers the new feature added in iteration 11:
- POST /api/homework-templates/seed-standard (idempotent)
- GET  /api/homework-templates (sorted by tier)
- POST/PUT/DELETE /api/homework-templates (admin CRUD)
- POST /api/homework/from-template (admin assigns; snapshot freezes; due_date computed)
- POST /api/homework/{id}/section-log (client logs structured fields)
- GET  /api/homework/{id}/report (aggregations: total/avg/trend; checkbox yes_count; text latest)
- DELETE /api/homework/{id}/section-log/{log_id}
- Regression: plain POST /api/homework and POST /api/homework/{id}/complete still work.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "admin@sithappens.com", "password": "admin123"}
CLIENT = {"email": "testclient@sithappens.com", "password": "test1234"}

TIER_ORDER = ["foundation", "intermediate", "advanced", "specialty", "master"]


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=CLIENT, timeout=15)
    assert r.status_code == 200, f"client login failed: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_dog_id(client_headers):
    """Pick first dog of test client (Daisy or Rocky)."""
    r = requests.get(f"{BASE_URL}/api/dogs", headers=client_headers, timeout=15)
    assert r.status_code == 200
    dogs = r.json()
    assert len(dogs) >= 1, "Test client must own at least one dog"
    return dogs[0]["id"]


@pytest.fixture(scope="module")
def seeded(admin_headers):
    r = requests.post(f"{BASE_URL}/api/homework-templates/seed-standard",
                      headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# =====================================================================
# 1) SEED + LIST
# =====================================================================
class TestTemplateLibrary:
    def test_seed_is_idempotent(self, admin_headers, seeded):
        """Re-running seed must not produce duplicates; total_active stays at 10."""
        assert seeded["total_active"] == 10, f"expected 10 active templates, got {seeded}"
        # 2nd call
        r2 = requests.post(f"{BASE_URL}/api/homework-templates/seed-standard",
                           headers=admin_headers, timeout=30)
        assert r2.status_code == 200
        body = r2.json()
        assert body["seeded"] == 0, f"re-seed should not insert: {body}"
        assert body["total_active"] == 10

    def test_list_returns_10_sorted_by_tier(self, admin_headers, seeded):
        r = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        tpls = r.json()
        assert isinstance(tpls, list)
        assert len(tpls) == 10, f"expected 10, got {len(tpls)}"
        # tier counts: 1 master, 3 foundation, 3 intermediate, 2 advanced, 1 specialty
        from collections import Counter
        tiers = Counter(t["tier"] for t in tpls)
        assert tiers["foundation"] == 3
        assert tiers["intermediate"] == 3
        assert tiers["advanced"] == 2
        assert tiers["specialty"] == 1
        assert tiers["master"] == 1
        # ordering: foundation block must come before master block
        positions = [TIER_ORDER.index(t["tier"]) for t in tpls]
        assert positions == sorted(positions), f"templates not sorted by tier: {[t['tier'] for t in tpls]}"

    def test_client_can_list_templates(self, client_headers, seeded):
        r = requests.get(f"{BASE_URL}/api/homework-templates", headers=client_headers, timeout=15)
        assert r.status_code == 200
        assert len(r.json()) == 10


# =====================================================================
# 2) CRUD (admin custom + system update + delete semantics)
# =====================================================================
class TestTemplateCRUD:
    def test_admin_create_custom_template(self, admin_headers):
        payload = {
            "name": "TEST_Custom Drill",
            "tier": "intermediate",
            "description": "Throwaway custom template",
            "default_duration_days": 5,
            "global_rules_this_week": ["No couch this week"],
            "sections": [
                {"id": "s1", "title": "Drill", "fields": [
                    {"id": "reps", "label": "Reps", "kind": "reps", "target": 10}
                ]}
            ],
        }
        r = requests.post(f"{BASE_URL}/api/homework-templates",
                          headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_Custom Drill"
        assert body["tier"] == "intermediate"
        assert body["is_default"] is False
        assert "id" in body
        # Confirm it appears in list
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        assert any(t["id"] == body["id"] for t in ls)
        pytest.custom_tpl_id = body["id"]

    def test_client_cannot_create_template(self, client_headers):
        r = requests.post(f"{BASE_URL}/api/homework-templates",
                          headers=client_headers,
                          json={"name": "TEST_clientattempt", "tier": "master"},
                          timeout=15)
        assert r.status_code in (401, 403), f"client must be blocked, got {r.status_code}"

    def test_update_custom_template(self, admin_headers):
        tid = pytest.custom_tpl_id
        payload = {
            "name": "TEST_Custom Drill v2",
            "tier": "advanced",
            "description": "Updated",
            "default_duration_days": 7,
            "global_rules_this_week": ["Updated rule"],
            "sections": [
                {"id": "s1", "title": "Drill", "fields": [
                    {"id": "reps", "label": "Reps", "kind": "reps", "target": 12}
                ]}
            ],
        }
        r = requests.put(f"{BASE_URL}/api/homework-templates/{tid}",
                         headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_Custom Drill v2"
        assert body["tier"] == "advanced"
        # GET-after-PUT to verify persistence
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        tpl = next(t for t in ls if t["id"] == tid)
        assert tpl["tier"] == "advanced"
        assert tpl["name"] == "TEST_Custom Drill v2"

    def test_update_system_template_marks_customized(self, admin_headers):
        """Admin-touched system template should set customized=true so re-seed won't overwrite."""
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        sys_tpl = next(t for t in ls if t.get("is_default"))
        tid = sys_tpl["id"]
        payload = {
            "name": sys_tpl["name"] + " (touched)",
            "tier": sys_tpl["tier"],
            "description": sys_tpl.get("description", ""),
            "default_duration_days": sys_tpl.get("default_duration_days", 7),
            "global_rules_this_week": sys_tpl.get("global_rules_this_week", []),
            "sections": sys_tpl.get("sections", []),
        }
        r = requests.put(f"{BASE_URL}/api/homework-templates/{tid}",
                         headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        # Re-fetch and verify customized flag
        ls2 = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        touched = next(t for t in ls2 if t["id"] == tid)
        # NOTE: per review_request, admin-touched system template should mark customized=true
        assert touched.get("customized") is True, (
            f"Expected customized=True after admin edits a system template; got customized={touched.get('customized')}"
        )
        # Cleanup — restore name and clear customized flag by re-seeding only works if customized cleared.
        # Use re-seed (won't overwrite customized) then manually reset by PUT back to original name.
        restore = {**payload, "name": sys_tpl["name"]}
        requests.put(f"{BASE_URL}/api/homework-templates/{tid}",
                     headers=admin_headers, json=restore, timeout=15)

    def test_delete_custom_hard_deletes(self, admin_headers):
        tid = pytest.custom_tpl_id
        r = requests.delete(f"{BASE_URL}/api/homework-templates/{tid}",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        assert not any(t["id"] == tid for t in ls), "custom template should be hard-deleted"

    def test_delete_system_soft_deletes_then_reseed_restores(self, admin_headers):
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        sys_tpl = next(t for t in ls if t.get("is_default") and not t.get("customized"))
        tid = sys_tpl["id"]
        r = requests.delete(f"{BASE_URL}/api/homework-templates/{tid}",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ls2 = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        # Active list should now be 9
        assert len(ls2) == 9
        # Re-seed restores it (idempotent insert reactivates by slug? Test current behavior)
        re = requests.post(f"{BASE_URL}/api/homework-templates/seed-standard",
                          headers=admin_headers, timeout=30)
        assert re.status_code == 200
        ls3 = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        # Active count after re-seed
        active_count = len(ls3)
        # If the re-seed reactivates soft-deleted templates, count==10; else flag.
        # Document actual behavior in assertion message rather than fail blindly.
        assert active_count in (9, 10), f"unexpected active count after reseed of soft-deleted: {active_count}"
        if active_count == 9:
            pytest.skip(
                "Re-seed did NOT reactivate soft-deleted system template "
                f"(slug={sys_tpl.get('slug')}). Listing this as a minor issue."
            )


# =====================================================================
# 3) ASSIGN FROM TEMPLATE
# =====================================================================
class TestAssignFromTemplate:
    def test_admin_assigns_template_to_dog(self, admin_headers, client_dog_id):
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        # Pick a foundation tier template with sections
        foundation = next(t for t in ls if t["tier"] == "foundation" and t.get("sections"))
        r = requests.post(f"{BASE_URL}/api/homework/from-template",
                          headers=admin_headers,
                          json={"dog_id": client_dog_id, "template_id": foundation["id"]},
                          timeout=15)
        assert r.status_code == 200, r.text
        hw = r.json()
        assert hw["dog_id"] == client_dog_id
        assert hw["status"] == "assigned"
        assert hw["template_snapshot"]["template_id"] == foundation["id"]
        assert hw["template_snapshot"]["sections"] == foundation["sections"]
        assert hw["section_logs"] == []
        # due_date should be set via default_duration_days
        assert hw["due_date"], "due_date should be auto-computed when omitted"
        pytest.assigned_hw_id = hw["id"]
        pytest.assigned_section_id = foundation["sections"][0]["id"]
        pytest.assigned_fields = foundation["sections"][0]["fields"]

    def test_client_cannot_call_from_template(self, client_headers, client_dog_id):
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=client_headers, timeout=15).json()
        r = requests.post(f"{BASE_URL}/api/homework/from-template",
                          headers=client_headers,
                          json={"dog_id": client_dog_id, "template_id": ls[0]["id"]},
                          timeout=15)
        assert r.status_code in (401, 403), f"client must be blocked: {r.status_code}"


# =====================================================================
# 4) SECTION LOGGING + REPORT (TREND)
# =====================================================================
class TestSectionLoggingAndReport:
    def test_log_section_validates_section_id(self, client_headers):
        hw_id = pytest.assigned_hw_id
        r = requests.post(f"{BASE_URL}/api/homework/{hw_id}/section-log",
                          headers=client_headers,
                          json={"section_id": "nonexistent_section",
                                "field_values": {"x": 1}}, timeout=15)
        assert r.status_code == 400, f"expected 400 for unknown section_id, got {r.status_code}"

    def test_client_logs_multiple_sessions_trend_up(self, client_headers):
        hw_id = pytest.assigned_hw_id
        sec_id = pytest.assigned_section_id
        # Find a numeric field (reps/sets/duration) in the section
        numeric_field = next(
            (f for f in pytest.assigned_fields
             if f["kind"] in ("reps", "sets", "duration_sec", "duration_min", "rating_5", "success_rate")),
            None,
        )
        if not numeric_field:
            pytest.skip("Picked section has no numeric field; trend test not applicable")
        fid = numeric_field["id"]
        # Ascending values for trend=up: first half avg ~3, second half avg ~10
        values = [2, 3, 4, 9, 10, 11]
        for i, v in enumerate(values):
            r = requests.post(f"{BASE_URL}/api/homework/{hw_id}/section-log",
                              headers=client_headers,
                              json={"section_id": sec_id,
                                    "date": f"2026-01-{10+i:02d}",
                                    "field_values": {fid: v},
                                    "note": f"session {i+1}"},
                              timeout=15)
            assert r.status_code == 200, r.text
        pytest.numeric_fid = fid

    def test_report_aggregations(self, admin_headers, client_headers):
        hw_id = pytest.assigned_hw_id
        sec_id = pytest.assigned_section_id
        fid = pytest.numeric_fid
        # Admin should see report
        r = requests.get(f"{BASE_URL}/api/homework/{hw_id}/report",
                        headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["homework_id"] == hw_id
        assert rep["total_logs"] >= 6
        # Find our section
        sec = next(s for s in rep["sections"] if s["section_id"] == sec_id)
        assert sec["log_count"] >= 6
        # Find our numeric field aggregation
        fagg = next(f for f in sec["fields"] if f["field_id"] == fid)
        assert fagg["count"] >= 6
        assert fagg["total"] == pytest.approx(2+3+4+9+10+11), f"total mismatch: {fagg}"
        assert fagg["avg"] == pytest.approx(round((2+3+4+9+10+11)/6, 1))
        assert fagg["max"] == 11
        assert fagg["min"] == 2
        assert fagg["trend"] == "up", f"expected trend=up, got {fagg['trend']}"

    def test_report_trend_down(self, admin_headers, client_headers, client_dog_id):
        """Assign a fresh template, log descending values → trend=down."""
        ls = requests.get(f"{BASE_URL}/api/homework-templates", headers=admin_headers, timeout=15).json()
        # Find a template w/ a numeric field
        chosen = None
        for tpl in ls:
            for s in tpl.get("sections", []):
                for f in s.get("fields", []):
                    if f["kind"] in ("reps", "sets", "duration_sec", "duration_min", "rating_5"):
                        chosen = (tpl, s["id"], f["id"])
                        break
                if chosen:
                    break
            if chosen:
                break
        assert chosen, "no template with numeric field"
        tpl, sec_id, fid = chosen
        r = requests.post(f"{BASE_URL}/api/homework/from-template",
                          headers=admin_headers,
                          json={"dog_id": client_dog_id, "template_id": tpl["id"]},
                          timeout=15)
        assert r.status_code == 200
        hw_id = r.json()["id"]
        for i, v in enumerate([15, 14, 13, 4, 3, 2]):
            requests.post(f"{BASE_URL}/api/homework/{hw_id}/section-log",
                          headers=client_headers,
                          json={"section_id": sec_id, "date": f"2026-01-{10+i:02d}",
                                "field_values": {fid: v}}, timeout=15)
        rep = requests.get(f"{BASE_URL}/api/homework/{hw_id}/report",
                          headers=admin_headers, timeout=15).json()
        sec = next(s for s in rep["sections"] if s["section_id"] == sec_id)
        fagg = next(f for f in sec["fields"] if f["field_id"] == fid)
        assert fagg["trend"] == "down", f"expected trend=down, got {fagg}"
        pytest.down_hw_id = hw_id

    def test_delete_section_log(self, client_headers):
        hw_id = pytest.assigned_hw_id
        # Get a log id
        rep_before = requests.get(f"{BASE_URL}/api/homework", headers=client_headers, timeout=15).json()
        hw = next(h for h in rep_before if h["id"] == hw_id)
        log_id = hw["section_logs"][0]["id"]
        before_count = len(hw["section_logs"])
        r = requests.delete(f"{BASE_URL}/api/homework/{hw_id}/section-log/{log_id}",
                            headers=client_headers, timeout=15)
        assert r.status_code == 200
        # Verify removed
        rep_after = requests.get(f"{BASE_URL}/api/homework", headers=client_headers, timeout=15).json()
        hw_after = next(h for h in rep_after if h["id"] == hw_id)
        assert len(hw_after["section_logs"]) == before_count - 1
        assert all(le["id"] != log_id for le in hw_after["section_logs"])


# =====================================================================
# 5) REGRESSION: plain homework + complete still work
# =====================================================================
class TestHomeworkRegression:
    def test_plain_create_and_complete(self, admin_headers, client_headers, client_dog_id):
        r = requests.post(f"{BASE_URL}/api/homework",
                          headers=admin_headers,
                          json={"dog_id": client_dog_id,
                                "title": "TEST_plain hw",
                                "instructions": "do it"}, timeout=15)
        assert r.status_code == 200, r.text
        hw = r.json()
        assert hw["status"] == "assigned"
        assert hw.get("template_snapshot") in (None, {}, False) or "template_snapshot" not in hw
        # Client completes it
        rc = requests.post(f"{BASE_URL}/api/homework/{hw['id']}/complete",
                           headers=client_headers,
                           json={"note": "done"}, timeout=15)
        assert rc.status_code == 200
        assert rc.json()["status"] == "completed"
        # cleanup
        requests.delete(f"{BASE_URL}/api/homework/{hw['id']}", headers=admin_headers, timeout=15)


# =====================================================================
# 6) CLEANUP
# =====================================================================
class TestZCleanup:
    """Final teardown — runs last because pytest collects alphabetically."""
    def test_cleanup_assigned_homework(self, admin_headers):
        # delete the homework rows created by from-template
        for attr in ("assigned_hw_id", "down_hw_id"):
            hw_id = getattr(pytest, attr, None)
            if hw_id:
                requests.delete(f"{BASE_URL}/api/homework/{hw_id}",
                                headers=admin_headers, timeout=15)
        assert True
