"""Stage 11.5 — training authorization matrix, over HTTP, with explicit status codes.

Three real account shapes from the app's own permission model:
  * owner        — role admin, no staff_role  (full matrix)
  * trainer      — role employee, staff_role trainer      (manage_training_sessions, manage_school, …)
  * front desk   — role employee, staff_role front_desk   (clients / bookings / payments — no training keys)

Every row below uses the app's real permission names (STAFF_ROLES matrix +
require_admin_and_permission) and proves two things at once: a trainer
employee can do the whole training workflow WITHOUT the admin role, and no
account gained anything it did not have before this stage.
"""
import uuid
from datetime import timedelta

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

from test_training_session_workspace import client, _insert_staff, _http  # noqa: F401


def _patch(url, headers=None, json=None):
    return run(_http.patch(url, headers=headers, json=json))
from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, TAG, _client_user, _ensure_skill_in_plan, _enrollment, _open_draft, _record, _seed,
)
from test_trainer_day import _booking, _pending_checkpoint


def _owner_headers():
    run(server.db.users.update_one({"id": ADMIN["id"]}, {"$set": {**ADMIN, "password_hash": "x", "active": True,
                                   "must_change_password": False, "needs_password": False, "token_version": 0}}, upsert=True))
    return {"Authorization": f"Bearer {server.create_access_token(ADMIN['id'], ADMIN['email'], 'admin', 0)}"}


@pytest.fixture(scope="module")
def world():
    s = _seed("in_person", checkpoint_on_lesson1=True, lessons=2)
    owner = _owner_headers()
    trainer_id, trainer = _insert_staff("trainer")
    other_trainer_id, other_trainer = _insert_staff("trainer")
    fd_id, front_desk = _insert_staff("front_desk")
    booking = _booking(s["dog_id"])
    # the trainer employee is the booking's assigned trainer for today AND the dog's program trainer
    run(server.assign_training_booking_trainer(booking["id"], server.TrainingDayTrainerAssignmentIn(assigned_trainer_id=trainer_id), ADMIN))
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"assigned_trainer_id": trainer_id}}))
    # Practice awaiting review (video logged by the client)
    hw_id = str(uuid.uuid4()); log_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({
        "id": hw_id, "dog_id": s["dog_id"], "client_id": s["client"]["id"], "dog_name": f"{TAG} Dog", "client_name": "C", "title": "Sit Practice",
        "status": "assigned", "source_lesson_id": s["lesson_ids"][0], "school_enrollment_id": s["se_id"], "enrollment_id": s["enrollment_id"],
        "section_logs": [{"id": log_id, "logged_at": server.now_iso(), "note": "", "field_values": {"__video_id": "m1"}, "review_status": None}],
    }))
    # checkpoint awaiting grading
    cp = _pending_checkpoint(s)
    # daily-tracker day submitted by the client, awaiting the trainer's approval
    cu = _client_user(s)
    tracker = run(server.create_daily_tracker(server.DailyTrackerCreateIn(
        dog_id=s["dog_id"], title="Two-day sit plan",
        days=[server.DailyTrackerSectionIn(day_number=1, day_focus="Sit on cue", fields=[{"id": "reps", "label": "Reps", "kind": "number"}]),
              server.DailyTrackerSectionIn(day_number=2, day_focus="Sit with distance", fields=[{"id": "reps", "label": "Reps", "kind": "number"}])]), ADMIN))
    tracker_id = tracker.get("id") or (tracker.get("homework") or {}).get("id")
    run(server.submit_day(tracker_id, 1, server.DaySubmitIn(field_values={"reps": 8}, note="Good day", difficulty="good"), cu))
    yield {
        "s": s, "owner": owner, "trainer": trainer, "trainer_id": trainer_id, "other_trainer": other_trainer, "front_desk": front_desk,
        "booking": booking, "hw_id": hw_id, "log_id": log_id, "cp": cp, "tracker_id": tracker_id, "other_trainer_id": other_trainer_id,
    }
    run(server.db.homework.delete_many({"id": {"$in": [hw_id, tracker_id]}}))
    run(server.db.checkpoint_submissions.delete_one({"id": cp["id"]}))
    run(server.db.bookings.delete_one({"id": booking["id"]}))
    run(server.db.users.delete_many({"id": {"$in": [trainer_id, other_trainer_id, fd_id, cu["id"]]}}))


def _codes(world, method, url, json=None, params=None):
    out = {}
    for who in ("owner", "trainer", "front_desk"):
        h = world[who]
        r = client.post(url, headers=h, json=json) if method == "post" else client.get(url, headers=h, params=params)
        out[who] = r.status_code
    return out


# ---------------------------------------------------------------------------
# reads: the day, the queues, the detail records
# ---------------------------------------------------------------------------

def test_trainer_day_is_owner_and_trainer_only(world):
    assert _codes(world, "get", "/api/admin/training/day") == {"owner": 200, "trainer": 200, "front_desk": 403}
    day = client.get("/api/admin/training/day", headers=world["trainer"]).json()
    assert day["viewer"]["is_admin"] is False and day["omitted"] == []
    keys = {i["key"] for i in day["items"]}
    assert f"session:{world['booking']['id']}" in keys and f"checkpoint:{world['cp']['id']}" in keys
    assert f"practice:{world['hw_id']}:{world['log_id']}" in keys
    assert f"daily:{world['tracker_id']}:1" in keys
    # a trainer's booking is "mine" for the assigned trainer; Stage 12 — another trainer is not handed it at all
    sess = next(i for i in day["items"] if i["key"] == f"session:{world['booking']['id']}")
    assert sess["mine"] is True and day["viewer"]["can_assign"] is False
    other = client.get("/api/admin/training/day", headers=world["other_trainer"]).json()
    assert f"session:{world['booking']['id']}" not in {i["key"] for i in other["items"]}
    assert all(i["mine"] for i in other["items"])


def test_review_queues_are_readable_by_trainer_not_front_desk(world):
    for url in ("/api/admin/school/practice-reviews/pending", "/api/admin/school/checkpoints/pending",
                "/api/admin/homework/pending-reviews", "/api/admin/homework/unreviewed-count"):
        assert _codes(world, "get", url) == {"owner": 200, "trainer": 200, "front_desk": 403}, url


def test_daily_tracker_detail_is_full_for_trainer_client_safe_for_client_denied_for_front_desk(world):
    url = f"/api/homework/{world['tracker_id']}"
    assert _codes(world, "get", url) == {"owner": 200, "trainer": 200, "front_desk": 403}
    full = client.get(url, headers=world["trainer"]).json()
    assert full["section_logs"] and full.get("daily_progress") is not None  # the review tool needs the real record


# ---------------------------------------------------------------------------
# writes: every action the queue offers
# ---------------------------------------------------------------------------

def test_start_session_requires_training_permission_and_assignment(world):
    s = world["s"]
    url = f"/api/dogs/{s['dog_id']}/programs/{s['enrollment_id']}/training-session/draft"
    assert _codes(world, "post", url) == {"owner": 200, "trainer": 200, "front_desk": 403}
    # another trainer who is NOT assigned today gets a resolution screen, never a draft — permission alone is not ownership
    r = client.post(url, headers=world["other_trainer"])
    assert r.status_code == 200 and r.json()["resolution"] == "assigned_to_other_trainer" and "draft" not in r.json(), r.text
    # the assigned trainer's draft is the same draft the owner sees (one canonical record)
    mine = client.post(url, headers=world["trainer"]).json()["draft"]["id"]
    assert client.post(url, headers=world["owner"]).json()["draft"]["id"] == mine


def test_review_practice_matrix(world):
    url = f"/api/admin/school/practice-reviews/{world['hw_id']}/{world['log_id']}"
    body = {"status": "looks_good", "note": "Nice work"}
    assert client.post(url, headers=world["front_desk"], json=body).status_code == 403
    assert client.post(url, headers=world["trainer"], json=body).status_code == 200
    # already reviewed: the owner gets the same canonical answer, never a 500
    assert client.post(url, headers=world["owner"], json=body).status_code in (200, 409)


def test_grade_checkpoint_matrix(world):
    url = f"/api/admin/school/checkpoints/{world['cp']['id']}/grade"
    rubric = world["cp"]["rubric_snapshot"]
    body = {"outcome": "advance", "handler_scores": {c["id"]: 4 for c in rubric["handler_criteria"]},
            "dog_scores": {c["id"]: 4 for c in rubric["dog_criteria"]}, "feedback": "Great"}
    assert client.post(url, headers=world["front_desk"], json=body).status_code == 403
    r = client.post(url, headers=world["trainer"], json=body)
    assert r.status_code == 200, r.text
    assert r.json()["checkpoint"]["status"] == "graded"


def test_daily_review_matrix(world):
    url = f"/api/homework/{world['tracker_id']}/day/1/review"
    body = {"action": "approve", "note": "Approved"}
    assert client.post(url, headers=world["front_desk"], json=body).status_code == 403
    r = client.post(url, headers=world["trainer"], json=body)
    assert r.status_code == 200, r.text
    # reviewed → out of the pending list for everyone
    pending = client.get("/api/admin/homework/pending-reviews", headers=world["owner"]).json()
    assert not any(p.get("homework_id") == world["tracker_id"] and p.get("day_number") == 1 for p in pending)


# ---------------------------------------------------------------------------
# no privilege expansion: owner-only surfaces stay owner-only
# ---------------------------------------------------------------------------

def test_settings_and_finance_stay_owner_only(world):
    assert _codes(world, "get", "/api/settings") == {"owner": 200, "trainer": 403, "front_desk": 403}
    start = (server.business_today() - timedelta(days=30)).isoformat(); end = server.business_today().isoformat()
    assert _codes(world, "get", "/api/reports/pl", params={"start_date": start, "end_date": end}) == {"owner": 200, "trainer": 403, "front_desk": 403}
    assert _codes(world, "get", "/api/staff/roles") == {"owner": 200, "trainer": 403, "front_desk": 403}


def test_the_matrix_matches_the_declared_staff_role_grants():
    """The codes above are not accidents of individual endpoints: they follow the
    STAFF_ROLES matrix. Trainer holds the training keys; Front Desk holds none."""
    tr = server.ROLE_PERMISSIONS["trainer"]; fd = server.ROLE_PERMISSIONS["front_desk"]
    for key in ("manage_training_sessions", "manage_school", "manage_training_content"):
        assert tr.get(key) is True and not fd.get(key), key
    for key in ("settings", "finance_reports"):
        assert not tr.get(key) and not fd.get(key), key


# ---------------------------------------------------------------------------
# Stage 12 — the assignment boundary is a capability, not a role name
# ---------------------------------------------------------------------------

def test_assigning_a_trainer_to_a_booking_needs_assign_training_staff(world):
    url = f"/api/admin/training/today/{world['booking']['id']}/trainer"
    body = {"assigned_trainer_id": world["trainer_id"]}
    r = _patch(url, headers=world["front_desk"], json=body)
    assert r.status_code == 403
    # the assigned trainer cannot hand their own dog to someone else, nor take another's
    r = _patch(url, headers=world["trainer"], json=body)
    assert r.status_code == 403 and "Assign training staff" in r.text
    r = _patch(url, headers=world["other_trainer"], json={"assigned_trainer_id": world["trainer_id"]})
    assert r.status_code == 403
    # the owner assigns and reassigns
    r = _patch(url, headers=world["owner"], json=body)
    assert r.status_code == 200, r.text
    # a manager holds the capability through the matrix (no role-name check)
    assert server.ROLE_PERMISSIONS["manager"]["assign_training_staff"] is True
    assert server.ROLE_PERMISSIONS["trainer"]["assign_training_staff"] is False
    assert server.ROLE_PERMISSIONS["front_desk"]["assign_training_staff"] is False
    assert "assign_training_staff" in server.PERMISSION_KEYS


def test_enrollment_time_assignment_self_only_without_the_capability(world):
    """A trainer may name THEMSELVES when they enroll a dog (the one pre-existing
    self-assignment path, now explicit); naming another trainer needs assign_training_staff."""
    s = world["s"]
    for who, trainer_id, expect in (("trainer", world["trainer_id"], 200), ("trainer", world["other_trainer_id"], 403), ("owner", world["other_trainer_id"], 200)):
        did = str(uuid.uuid4())  # a fresh dog for every attempt so the enrollment is always new
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Dog {did[:6]}", "owner_id": s["client"]["id"], "breed": "Mix", "age_y": 2,
                                       "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"}}))
        r = client.post("/api/school/enroll", headers=world[who], json={"dog_id": did, "program_id": s["program"]["id"], "delivery_mode": "in_person", "assigned_trainer_id": trainer_id})
        assert r.status_code == expect, (who, trainer_id, r.text)
        run(server.db.dogs.delete_one({"id": did}))


def test_front_desk_gains_no_training_management(world):
    fd = world["front_desk"]
    assert client.get("/api/admin/training/day", headers=fd).status_code == 403
    assert _patch(f"/api/admin/training/today/{world['booking']['id']}/trainer", headers=fd, json={"assigned_trainer_id": world["trainer_id"]}).status_code == 403
    assert client.get("/api/programs/pipeline", headers=fd).status_code == 403


def test_trainer_roster_is_only_their_assigned_programs_and_names_the_owner(world):
    """GET /programs/pipeline?trainer=<own id> is the trainer's My students roster: nothing
    another trainer owns, nothing unassigned. The owner's rows say who owns each program."""
    mine = client.get("/api/programs/pipeline", headers=world["trainer"], params={"trainer": world["trainer_id"]}).json()
    assert mine and all(r["assigned_trainer_id"] == world["trainer_id"] for r in mine)
    assert all(r.get("assigned_trainer_name") for r in mine)
    other = client.get("/api/programs/pipeline", headers=world["other_trainer"], params={"trainer": world["other_trainer_id"]}).json()
    assert world["s"]["enrollment_id"] not in {r["id"] for r in other}
    everyone = client.get("/api/programs/pipeline", headers=world["owner"]).json()
    row = next(r for r in everyone if r["id"] == world["s"]["enrollment_id"])
    assert row["assigned_trainer_id"] == world["trainer_id"] and row["assigned_trainer_name"]
    # the owner's name fragment filter finds the same program through its assigned trainer
    by_name = client.get("/api/programs/pipeline", headers=world["owner"], params={"trainer": row["assigned_trainer_name"][:8]}).json()
    assert world["s"]["enrollment_id"] in {r["id"] for r in by_name}
