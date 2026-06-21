"""Sprint 110eq — Phase 1 Custom Intake Forms regression.

Covers the full CRUD lifecycle of intake form templates and submissions:
  - Auto-seed of 11 starter templates on first list
  - Create/Update/Duplicate/Toggle-active/Delete templates
  - Soft-archive (vs hard delete) when submissions reference the template
  - Submission status transitions (sent → submitted → reviewed) auto-stamp
    `sent_at`, `submitted_at`, `reviewed_at`, `reviewed_by`
  - Field-type validation (rejects unknown field_type)
"""
import os
import uuid
import pytest
import requests


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_list_templates_seeds_defaults(admin_headers):
    r = requests.get(f"{BASE}/api/intake/templates", headers=admin_headers, timeout=15)
    r.raise_for_status()
    data = r.json()
    assert "templates" in data
    assert "form_types" in data
    assert "field_types" in data
    # at least the 11 starter templates exist (could be more from prior runs)
    assert len(data["templates"]) >= 11
    starter_types = {t["form_type"] for t in data["templates"]}
    for required in (
        "client_intake", "dog_intake", "daycare_temperament", "boarding_intake",
        "feeding_instructions", "medication_instructions", "training_evaluation",
        "service_dog_training", "behavior_history", "bite_aggression_disclosure",
        "emergency_vet_contact",
    ):
        assert required in starter_types, f"Starter template {required} missing"


def test_template_full_lifecycle(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    # ── Create
    create = requests.post(
        f"{BASE}/api/intake/templates", headers=admin_headers,
        json={
            "name": f"Lifecycle-{suffix}",
            "form_type": "client_intake",
            "description": "regression",
            "active": True,
            "fields": [
                {"label": "Name", "field_type": "short_text", "required": True},
                {"label": "Notes", "field_type": "long_text"},
                {"label": "Pets", "field_type": "dropdown",
                 "options": ["Dog", "Cat", "Other"]},
            ],
        },
        timeout=15,
    )
    create.raise_for_status()
    tpl = create.json()
    assert tpl["id"] and tpl["active"] is True and len(tpl["fields"]) == 3
    field_ids = [f["id"] for f in tpl["fields"]]
    assert all(field_ids), "Field IDs must be auto-stamped"

    # ── Bad field_type rejected (400)
    bad = requests.post(
        f"{BASE}/api/intake/templates", headers=admin_headers,
        json={"name": "bad", "form_type": "client_intake",
              "fields": [{"label": "x", "field_type": "rocket"}]},
        timeout=15,
    )
    assert bad.status_code == 400

    # ── Bad form_type rejected
    bad2 = requests.post(
        f"{BASE}/api/intake/templates", headers=admin_headers,
        json={"name": "bad", "form_type": "made_up", "fields": []},
        timeout=15,
    )
    assert bad2.status_code == 400

    # ── Duplicate creates inactive copy
    dup = requests.post(
        f"{BASE}/api/intake/templates/{tpl['id']}/duplicate",
        headers=admin_headers, timeout=15,
    )
    dup.raise_for_status()
    dup_tpl = dup.json()
    assert dup_tpl["id"] != tpl["id"]
    assert dup_tpl["active"] is False, "Duplicate must start inactive"
    assert dup_tpl["name"].endswith("(copy)")
    # field ids must be NEW, not shared with original
    dup_ids = {f["id"] for f in dup_tpl["fields"]}
    assert dup_ids.isdisjoint(set(field_ids)), "Dup must re-stamp field IDs"

    # ── Toggle active off then on
    toggled = requests.post(
        f"{BASE}/api/intake/templates/{tpl['id']}/toggle-active",
        headers=admin_headers, timeout=15,
    ).json()
    assert toggled["active"] is False
    requests.post(
        f"{BASE}/api/intake/templates/{tpl['id']}/toggle-active",
        headers=admin_headers, timeout=15,
    )

    # ── Update (rename + add a field)
    upd = requests.put(
        f"{BASE}/api/intake/templates/{tpl['id']}", headers=admin_headers,
        json={
            "name": f"Lifecycle-{suffix}-renamed",
            "form_type": "client_intake",
            "description": "updated",
            "active": True,
            "fields": tpl["fields"] + [{"label": "Extra", "field_type": "yes_no"}],
        },
        timeout=15,
    )
    upd.raise_for_status()
    assert len(upd.json()["fields"]) == 4

    # ── Create a submission tied to this template
    sub = requests.post(
        f"{BASE}/api/intake/submissions", headers=admin_headers,
        json={"template_id": tpl["id"], "status": "sent"},
        timeout=15,
    )
    sub.raise_for_status()
    s = sub.json()
    assert s["status"] == "sent"
    assert s["sent_at"], "sent_at must auto-stamp on status=sent"

    # ── Submission status: sent → submitted → reviewed (timestamps)
    sub_id = s["id"]
    submitted = requests.put(
        f"{BASE}/api/intake/submissions/{sub_id}", headers=admin_headers,
        json={"status": "submitted", "answers": {"foo": "bar"}},
        timeout=15,
    ).json()
    assert submitted["status"] == "submitted"
    assert submitted["submitted_at"]

    reviewed = requests.put(
        f"{BASE}/api/intake/submissions/{sub_id}", headers=admin_headers,
        json={"status": "reviewed", "review_notes": "All good"},
        timeout=15,
    ).json()
    assert reviewed["status"] == "reviewed"
    assert reviewed["reviewed_at"]
    assert reviewed["reviewed_by"]
    assert reviewed["review_notes"] == "All good"

    # ── List with status filter
    listed = requests.get(
        f"{BASE}/api/intake/submissions?template_id={tpl['id']}&status=reviewed",
        headers=admin_headers, timeout=15,
    ).json()
    assert any(x["id"] == sub_id for x in listed["submissions"])

    # ── Delete template — should soft-archive because of the submission
    del_res = requests.delete(
        f"{BASE}/api/intake/templates/{tpl['id']}", headers=admin_headers, timeout=15,
    ).json()
    assert del_res.get("soft_archived") is True
    # Template still exists but inactive + archived
    still = requests.get(
        f"{BASE}/api/intake/templates/{tpl['id']}", headers=admin_headers, timeout=15,
    ).json()
    assert still.get("archived") is True
    assert still.get("active") is False

    # ── Clean up — delete submission then hard-delete dup
    requests.delete(f"{BASE}/api/intake/submissions/{sub_id}", headers=admin_headers, timeout=15)
    requests.delete(f"{BASE}/api/intake/templates/{dup_tpl['id']}", headers=admin_headers, timeout=15)
    # Now original CAN be hard-deleted since no submissions remain
    final = requests.delete(
        f"{BASE}/api/intake/templates/{tpl['id']}", headers=admin_headers, timeout=15,
    ).json()
    assert final.get("ok") is True
