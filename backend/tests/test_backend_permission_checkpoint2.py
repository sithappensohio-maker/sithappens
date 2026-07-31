"""Final backend-authorization cleanup — remaining admin functional areas.

Extends the earlier permission checkpoint (test_backend_permission_
checkpoint.py) to: bulk email, announcements, email templates,
communications, tasks/shifts (admin side), training curriculum/programs/
homework templates, intake templates, trivia/dog-fact/photography
administration, and Shop media.

Designed to run against a clean, isolated test database (pass
TEST_BACKEND_URL pointed at a backend instance backed by an empty DB with
just the seeded owner account) so results aren't muddied by a long-lived
shared dev database's accumulated test data. Also passes fine against the
regular shared dev DB — it seeds its own throwaway staff accounts and cleans
up after itself either way.
"""
import os
import uuid
import jwt
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]

ROLES = ("manager", "trainer", "daycare_staff", "front_desk")


def _mongo_run(fn):
    return asyncio.run(fn())


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def staff_tokens():
    uids = {}

    async def seed():
        db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
        for role in ROLES:
            uid = str(uuid.uuid4())
            email = f"backend-permtest2-{role}@example.invalid"
            await db.users.delete_many({"email": email})
            await db.users.insert_one({
                "id": uid, "email": email, "name": f"Backend Perm Test2 {role}",
                "role": "admin", "staff_role": role,
                "password_hash": "x", "must_change_password": False,
                "needs_password": False,
            })
            uids[role] = uid

    async def cleanup():
        db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
        await db.users.delete_many({"email": {"$regex": "^backend-permtest2-"}})

    _mongo_run(seed)
    tokens = {
        role: jwt.encode({"sub": uid, "type": "access", "ver": 0}, JWT_SECRET, algorithm="HS256")
        for role, uid in uids.items()
    }
    try:
        yield {role: {"Authorization": f"Bearer {tok}"} for role, tok in tokens.items()}
    finally:
        _mongo_run(cleanup)


# ── 1. Owner retains full intended access ───────────────────────────────────

def test_owner_retains_full_access(admin_headers):
    for path in ("/admin/announcements", "/admin/bulk-email/history", "/admin/email-templates",
                 "/communications", "/admin/tasks", "/admin/shift-templates",
                 "/admin/time-off", "/programs", "/homework-templates", "/commands",
                 "/training-tips", "/intake/templates", "/intake/submissions",
                 "/admin/trivia/questions", "/dog-facts"):
        r = requests.get(f"{API}{path}", headers=admin_headers, timeout=15)
        assert r.status_code == 200, f"owner blocked from {path}: {r.status_code} {r.text[:200]}"
    r2 = requests.get(f"{API}/admin/shifts", headers=admin_headers,
                       params={"start_date": "2026-01-01", "end_date": "2026-01-31"}, timeout=15)
    assert r2.status_code == 200, f"owner blocked from /admin/shifts: {r2.status_code} {r2.text[:200]}"


# ── 2. Manager receives the configured management permissions ──────────────

def test_manager_has_all_new_management_permissions(staff_tokens):
    r = requests.get(f"{API}/me/permissions", headers=staff_tokens["manager"], timeout=15)
    assert r.status_code == 200
    perms = r.json()["permissions"]
    for key in ("manage_communications", "manage_staff_scheduling", "manage_training_content",
                "manage_engagement_content", "manage_shop_media"):
        assert perms[key] is True, f"manager should have {key}"


def test_manager_can_send_bulk_email_flow(staff_tokens):
    r = requests.get(f"{API}/admin/bulk-email/filters", headers=staff_tokens["manager"], timeout=15)
    assert r.status_code == 200, r.text


def test_manager_can_manage_admin_tasks(staff_tokens):
    r = requests.get(f"{API}/admin/tasks", headers=staff_tokens["manager"], timeout=15)
    assert r.status_code == 200, r.text


# ── 3. Front desk cannot send bulk email or edit templates without permission ──

def test_front_desk_cannot_send_bulk_email(staff_tokens):
    r = requests.post(f"{API}/admin/bulk-email/send", headers=staff_tokens["front_desk"],
                       json={"filters": {}, "subject": "x", "body": "x"}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_edit_email_template(staff_tokens):
    r = requests.put(f"{API}/admin/email-templates/welcome", headers=staff_tokens["front_desk"],
                      json={"subject": "hacked", "body": "hacked"}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_create_announcement(staff_tokens):
    r = requests.post(f"{API}/admin/announcements", headers=staff_tokens["front_desk"],
                       json={"title": "x", "body": "x"}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_select_bulk_email_recipients(staff_tokens):
    """Recipient/audience selection is itself a manage_communications action."""
    r = requests.post(f"{API}/admin/bulk-email/recipients", headers=staff_tokens["front_desk"],
                       json={"filters": {}}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_resend_test_email(staff_tokens):
    r = requests.post(f"{API}/admin/email-templates/welcome/test", headers=staff_tokens["front_desk"],
                       json={"to": "test@example.com"}, timeout=15)
    assert r.status_code == 403, r.text


def test_front_desk_cannot_manage_shop_media(staff_tokens):
    r = requests.post(f"{API}/shop/media", headers=staff_tokens["front_desk"],
                       json={"image_base64": "x", "content_type": "image/png"}, timeout=15)
    assert r.status_code == 403, r.text
    r2 = requests.delete(f"{API}/shop/media/fake-id", headers=staff_tokens["front_desk"], timeout=15)
    assert r2.status_code == 403, r2.text


def test_front_desk_cannot_manage_admin_tasks_or_shifts(staff_tokens):
    r = requests.post(f"{API}/admin/tasks", headers=staff_tokens["front_desk"],
                       json={"title": "x"}, timeout=15)
    assert r.status_code == 403, r.text
    r2 = requests.get(f"{API}/admin/shifts", headers=staff_tokens["front_desk"], timeout=15)
    assert r2.status_code == 403, r2.text


# ── 4. Trainer: permitted training workflows, blocked from unrelated admin ──

def test_trainer_can_manage_training_content(staff_tokens):
    for path in ("/programs", "/homework-templates", "/commands", "/training-tips"):
        r = requests.get(f"{API}{path}", headers=staff_tokens["trainer"], timeout=15)
        assert r.status_code != 403, f"trainer wrongly blocked from reading {path}: {r.status_code}"
    r = requests.post(f"{API}/commands", headers=staff_tokens["trainer"],
                       json={"name": f"pytest-cmd-{uuid.uuid4().hex[:6]}", "category": "obedience"}, timeout=15)
    assert r.status_code != 403, f"trainer blocked from creating a command: {r.status_code} {r.text[:200]}"


def test_trainer_cannot_manage_communications_or_scheduling(staff_tokens):
    r = requests.post(f"{API}/admin/announcements", headers=staff_tokens["trainer"],
                       json={"title": "x", "body": "x"}, timeout=15)
    assert r.status_code == 403, r.text
    r2 = requests.get(f"{API}/admin/shifts", headers=staff_tokens["trainer"], timeout=15)
    assert r2.status_code == 403, r2.text
    r3 = requests.post(f"{API}/shop/media", headers=staff_tokens["trainer"],
                        json={"image_base64": "x", "content_type": "image/png"}, timeout=15)
    assert r3.status_code == 403, r3.text


# ── 5. Care staff: permitted task/care workflows, blocked from global scheduling ──

def test_daycare_staff_retains_self_service_task_access(staff_tokens):
    """Own-work self-service endpoints must stay open — distinct from the
    admin-side /admin/tasks and /admin/shifts management endpoints."""
    for path in ("/employee/my-tasks", "/employee/my-shifts", "/employee/time-off"):
        r = requests.get(f"{API}{path}", headers=staff_tokens["daycare_staff"], timeout=15)
        assert r.status_code != 403, f"daycare_staff wrongly blocked from own {path}: {r.status_code}"


def test_daycare_staff_cannot_manage_global_scheduling(staff_tokens):
    r = requests.get(f"{API}/admin/tasks", headers=staff_tokens["daycare_staff"], timeout=15)
    assert r.status_code == 403, r.text
    r2 = requests.get(f"{API}/admin/shifts", headers=staff_tokens["daycare_staff"], timeout=15)
    assert r2.status_code == 403, r2.text
    r3 = requests.put(f"{API}/admin/time-off/fake-id", headers=staff_tokens["daycare_staff"],
                       json={"status": "approved"}, timeout=15)
    assert r3.status_code == 403, r3.text


def test_daycare_staff_cannot_manage_training_or_intake_content(staff_tokens):
    r = requests.post(f"{API}/programs", headers=staff_tokens["daycare_staff"],
                       json={"name": "x"}, timeout=15)
    assert r.status_code == 403, r.text
    r2 = requests.post(f"{API}/intake/templates", headers=staff_tokens["daycare_staff"],
                        json={"name": "x", "form_type": "intake"}, timeout=15)
    assert r2.status_code == 403, r2.text


# ── 6. Restricted staff cannot upload/delete Shop media without permission ──

def test_manager_can_upload_shop_media_permission_gate_passes(staff_tokens):
    """Manager has manage_shop_media — should get past the 403 gate (may
    still fail validation on a fake payload, but never on permission)."""
    r = requests.post(f"{API}/shop/media", headers=staff_tokens["manager"],
                       json={"image_base64": "not-real-but-past-the-gate", "content_type": "image/png"},
                       timeout=15)
    assert r.status_code != 403, r.text


# ── 7. Unauthorized communication actions create no queued email/announcement ──

def test_denied_announcement_creates_no_record(admin_headers, staff_tokens):
    before = requests.get(f"{API}/admin/announcements", headers=admin_headers, timeout=15).json()
    before_count = len(before) if isinstance(before, list) else len(before.get("announcements", before))
    r = requests.post(f"{API}/admin/announcements", headers=staff_tokens["front_desk"],
                       json={"title": "PYTEST SHOULD NOT EXIST", "body": "x"}, timeout=15)
    assert r.status_code == 403
    after = requests.get(f"{API}/admin/announcements", headers=admin_headers, timeout=15).json()
    after_count = len(after) if isinstance(after, list) else len(after.get("announcements", after))
    assert after_count == before_count, "a denied announcement request left a record behind"


def test_denied_bulk_email_creates_no_send_history(admin_headers, staff_tokens):
    before = requests.get(f"{API}/admin/bulk-email/history", headers=admin_headers, timeout=15).json()
    before_count = len(before) if isinstance(before, list) else len(before.get("history", before))
    r = requests.post(f"{API}/admin/bulk-email/send", headers=staff_tokens["front_desk"],
                       json={"filters": {}, "subject": "PYTEST SHOULD NOT SEND", "body": "x"}, timeout=15)
    assert r.status_code == 403
    after = requests.get(f"{API}/admin/bulk-email/history", headers=admin_headers, timeout=15).json()
    after_count = len(after) if isinstance(after, list) else len(after.get("history", after))
    assert after_count == before_count, "a denied bulk-email send left a history record behind"


# ── 8. Unauthorized writes create no database mutation (generalized) ───────

def test_denied_task_write_does_not_mutate(admin_headers, staff_tokens):
    before = requests.get(f"{API}/admin/tasks", headers=admin_headers, timeout=15).json()
    before_count = len(before) if isinstance(before, list) else len(before.get("tasks", before))
    r = requests.post(f"{API}/admin/tasks", headers=staff_tokens["front_desk"],
                       json={"title": "PYTEST SHOULD NOT EXIST"}, timeout=15)
    assert r.status_code == 403
    after = requests.get(f"{API}/admin/tasks", headers=admin_headers, timeout=15).json()
    after_count = len(after) if isinstance(after, list) else len(after.get("tasks", after))
    assert after_count == before_count, "a denied task-create request left a record behind"


def test_denied_command_write_does_not_mutate(admin_headers, staff_tokens):
    before = requests.get(f"{API}/commands", headers=admin_headers, timeout=15).json()
    before_names = {c.get("name") for c in (before if isinstance(before, list) else before.get("commands", []))}
    unique_name = f"pytest-should-not-exist-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/commands", headers=staff_tokens["front_desk"],
                       json={"name": unique_name, "category": "obedience"}, timeout=15)
    assert r.status_code == 403
    after = requests.get(f"{API}/commands", headers=admin_headers, timeout=15).json()
    after_names = {c.get("name") for c in (after if isinstance(after, list) else after.get("commands", []))}
    assert unique_name not in after_names, "a denied command-create request created it anyway"


# ── 9. Normal client and public read paths still work ───────────────────────

def test_public_and_client_reads_unaffected():
    r = requests.get(f"{API}/dog-facts/today", timeout=15)
    assert r.status_code in (200, 401), r.text  # some variants require auth; must never be blocked by these NEW gates specifically
    r2 = requests.get(f"{API}/branding", timeout=15)
    assert r2.status_code == 200, r2.text


def test_client_portal_read_paths_unaffected(admin_headers):
    r = requests.post(f"{API}/auth/register", json={
        "email": f"permcheckpoint2-client-{uuid.uuid4().hex[:8]}@example.com",
        "password": "ClientPass1234", "name": "Perm Checkpoint2 Client",
    }, timeout=15)
    assert r.status_code == 200, r.text
    ch = {"Authorization": f"Bearer {r.json()['token']}"}
    r2 = requests.get(f"{API}/portal/announcements", headers=ch, timeout=15)
    assert r2.status_code == 200, r2.text
    r3 = requests.get(f"{API}/trophies/catalog", headers=ch, timeout=15)
    assert r3.status_code == 200, r3.text


# ── 10. Frontend visibility matches backend enforcement ─────────────────────

def test_me_permissions_exposes_new_keys(staff_tokens):
    r = requests.get(f"{API}/me/permissions", headers=staff_tokens["front_desk"], timeout=15)
    assert r.status_code == 200
    perms = r.json()["permissions"]
    for key in ("manage_communications", "manage_staff_scheduling", "manage_training_content",
                "manage_engagement_content", "manage_shop_media"):
        assert key in perms and perms[key] is False, f"front_desk should not have {key}"


# ── 11. Permission changes apply on the next request ────────────────────────

def test_permission_change_applies_next_request(admin_headers, staff_tokens):
    r1 = requests.get(f"{API}/admin/tasks", headers=staff_tokens["manager"], timeout=15)
    assert r1.status_code == 200

    flip = requests.put(f"{API}/staff/roles/manager/permissions", headers=admin_headers,
                         json={"permissions": {"manage_staff_scheduling": False}}, timeout=15)
    assert flip.status_code == 200, flip.text
    try:
        r2 = requests.get(f"{API}/admin/tasks", headers=staff_tokens["manager"], timeout=15)
        assert r2.status_code == 403, "revoked manage_staff_scheduling still worked on the next request"
    finally:
        restore = requests.put(f"{API}/staff/roles/manager/permissions", headers=admin_headers,
                                json={"permissions": {"manage_staff_scheduling": True}}, timeout=15)
        assert restore.status_code == 200, restore.text


# ── unauthenticated ──────────────────────────────────────────────────────

def test_unauthenticated_rejected_on_new_gates():
    for path in ("/admin/announcements", "/admin/bulk-email/history", "/admin/tasks",
                 "/admin/shifts", "/shop/media"):
        r = requests.get(f"{API}{path}", timeout=15)
        assert r.status_code in (401, 403, 405), f"{path} allowed unauthenticated: {r.status_code}"
