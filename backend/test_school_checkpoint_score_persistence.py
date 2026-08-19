"""Persisted Handler/Dog overall checkpoint scores.

The derived overall pair used to be recomputed on every read and never
stored, so a trainer's assessment summary vanished from School checkpoint
history. These tests pin the durable behaviour: the grade state machine
persists the overalls on the canonical checkpoint_submissions row for BOTH
submission sources (client video and trainer_live) and for EVERY outcome,
history reads expose the persisted values, and rows graded before the fields
existed still load safely via read-time derivation.

There is deliberately no second score model and no second history
collection — everything below reads the one canonical row.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run

# The School-suite history endpoints live inside register_school_suite's
# closure rather than as server.* attributes, so they are exercised over the
# real ASGI app — which also proves the wiring, not just the helper.
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")

ADMIN = {"id": "cp-score-admin", "name": "Score Admin", "email": "cp-score@example.com", "role": "admin"}
TAG = "CPSCORE"

# Smallest thing that satisfies the checkpoint video data-URL field.
VIDEO_DATA_URL = ("data:video/mp4;base64,"
                  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQ==")


def _cp_config():
    return server.CheckpointConfigIn(
        enabled=True, title="Checkpoint", submission_instructions="Film from the side.",
        handler_criteria=[server.CheckpointCriterionIn(name="Cue clarity"),
                          server.CheckpointCriterionIn(name="Timing")],
        dog_criteria=[server.CheckpointCriterionIn(name="Latency")],
        submission_requirements="Good lighting.", pass_readiness_guidance="3+ clean reps.",
    )


def _seed(delivery_mode="in_person", lessons=2):
    """One client + dog + checkpointed program + School enrollment."""
    suffix = uuid.uuid4().hex[:8]
    run(server.db.users.update_one(
        {"id": ADMIN["id"]},
        {"$set": {**ADMIN, "password_hash": "x", "active": True, "must_change_password": False,
                  "needs_password": False, "token_version": 0}},
        upsert=True))

    prog = run(server.create_program(server.ProgramIn(
        name=f"{TAG} Program {suffix}", type="private_lessons",
        format={"count": 1, "unit": "modules"}, price=0, delivery_mode="both",
        modules=[server.ModuleIn(name="Module 1", order=0,
                                 goals=[server.GoalIn(name="Sit"), server.GoalIn(name="Down")])]),
        ADMIN))
    module = prog["modules"][0]
    goal_ids = [g["id"] for g in module["goals"]]
    lesson_models = [
        server.LessonIn(name=f"Lesson {i + 1}", order=i, active=True,
                        skill_ids=[goal_ids[i % len(goal_ids)]],
                        client_overview="overview", why_it_matters="matters.",
                        success_criteria="5 in a row.", checkpoint=_cp_config())
        for i in range(lessons)
    ]
    prog = run(server.update_program(
        prog["id"],
        server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=0,
            delivery_mode="both",
            modules=[server.ModuleIn(id=module["id"], name=module["name"], order=module["order"],
                                     goals=[server.GoalIn(**g) for g in module["goals"]],
                                     lessons=lesson_models)]),
        cascade=False, save_as_draft=False, _=ADMIN))

    client = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {suffix}", email=f"{TAG.lower()}-{suffix}@example.com"), ADMIN))
    dog_id = str(uuid.uuid4())
    run(server.db.dogs.insert_one({
        "id": dog_id, "name": f"{TAG} Dog {suffix}", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2099-01-01", "dhpp": "2099-01-01", "bordetella": "2099-01-01"}}))
    res = run(server.school_enroll(server.SchoolEnrollIn(
        dog_id=dog_id, program_id=prog["id"], delivery_mode=delivery_mode), ADMIN))
    return {
        "program": prog, "client": client, "dog_id": dog_id,
        "se_id": res["school_enrollment"]["id"], "enrollment_id": res["enrollment"]["id"],
        "lesson_ids": [l["id"] for l in prog["modules"][0]["lessons"]],
    }


def _rubric_for(se_id, lesson_id):
    se = run(server.db.school_enrollments.find_one({"id": se_id}, {"_id": 0}))
    enrollment = run(server.db.dog_programs.find_one({"id": se["enrollment_id"]}, {"_id": 0}))
    return server._find_lesson_in_snapshot(enrollment, lesson_id)["checkpoint"]


def _grade_body(outcome, rubric, handler=(5, 5), dog=(4,)):
    """Scores keyed by the enrollment's own criterion ids."""
    h_ids = [c["id"] for c in rubric["handler_criteria"]]
    d_ids = [c["id"] for c in rubric["dog_criteria"]]
    kwargs = {
        "handler_scores": {cid: v for cid, v in zip(h_ids, handler)},
        "dog_scores": {cid: v for cid, v in zip(d_ids, dog)},
        "feedback": "Clean work, keep the cue crisp.",
        "outcome": outcome,
    }
    if outcome == "prescribe_practice":
        kwargs["prescription"] = server.CheckpointPrescriptionIn(action="repeat_current_recipe")
    return server.CheckpointGradeIn(**kwargs)


def _live(s, lesson_id, outcome="advance", handler=(5, 4), dog=(4,)):
    rubric = _rubric_for(s["se_id"], lesson_id)
    return run(server.admin_school_live_checkpoint(
        s["se_id"], lesson_id, _grade_body(outcome, rubric, handler, dog), ADMIN))


def _stored(submission_id):
    return run(server.db.checkpoint_submissions.find_one({"id": submission_id}, {"_id": 0}))


def _auth(user_id, email, role):
    token = server.create_access_token(user_id, email, role, 0)
    return {"Authorization": f"Bearer {token}"}


def _detail(se_id):
    r = run(_http.get(f"/api/admin/school/students/{se_id}",
                      headers=_auth(ADMIN["id"], ADMIN["email"], "admin")))
    assert r.status_code == 200, r.text
    return r.json()


def _client_record(se_id, client_user):
    r = run(_http.get(f"/api/portal/school/{se_id}/record",
                      headers=_auth(client_user["id"], client_user["email"], "client")))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _clean():
    yield
    ids = [d["id"] for d in run(
        server.db.dogs.find({"name": {"$regex": TAG}}, {"_id": 0, "id": 1}).to_list(500))]
    se_ids = [s["id"] for s in run(
        server.db.school_enrollments.find({"dog_id": {"$in": ids}}, {"_id": 0, "id": 1}).to_list(500))]
    for coll in ("dog_programs", "school_enrollments", "homework", "checkpoint_submissions", "school_events"):
        run(server.db[coll].delete_many(
            {"$or": [{"dog_id": {"$in": ids}}, {"school_enrollment_id": {"$in": se_ids}}]}))
    run(server.db.programs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.dogs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))
    run(server.db.users.delete_many({"name": {"$regex": TAG}}))


# ---------------------------------------------------------------------------
# 1 — trainer live checkpoint
# ---------------------------------------------------------------------------

def test_live_trainer_checkpoint_persists_handler_and_dog_overall():
    s = _seed("in_person")
    result = _live(s, s["lesson_ids"][0], handler=(5, 4), dog=(4,))

    # (5+4)/2 = 4.5 handler, 4.0 dog — persisted, not merely returned.
    row = _stored(result["checkpoint"]["id"])
    assert row["handler_overall"] == 4.5
    assert row["dog_overall"] == 4.0
    assert row["submission_source"] == "trainer_live"
    # everything that must be preserved alongside the new fields
    assert row["handler_scores"] and row["dog_scores"]
    assert row["outcome"] == "advance"
    assert row["trainer_feedback"] == "Clean work, keep the cue crisp."
    assert row["graded_by"] == ADMIN["id"]
    assert row["graded_at"]


def test_live_checkpoint_scores_survive_a_later_history_fetch():
    s = _seed("in_person")
    _live(s, s["lesson_ids"][0], handler=(5, 4), dog=(4,))

    cps = _detail(s["se_id"])["checkpoints"]
    assert len(cps) == 1
    assert cps[0]["handler_overall"] == 4.5
    assert cps[0]["dog_overall"] == 4.0
    assert cps[0]["submission_source"] == "trainer_live"


# ---------------------------------------------------------------------------
# 2 — client / video checkpoint
# ---------------------------------------------------------------------------

def _client_user(s):
    """A persisted client login bound to the seeded client."""
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-user-{uid[:8]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} Client User", "role": "client",
        "client_id": s["client"]["id"], "password_hash": "x", "active": True,
        "must_change_password": False, "needs_password": False, "token_version": 0}))
    return {"id": uid, "email": email, "role": "client", "client_id": s["client"]["id"],
            "name": f"{TAG} Client User"}


def _client_submit(s, lesson_id):
    """A real client video submission through the portal endpoint."""
    client_user = _client_user(s)
    # The portal gates submission on real logged Practice for THIS lesson
    # (_lesson_is_practiced: a section log, or a completed assignment), scoped
    # to School ownership via school_enrollment_record_id.
    run(server.db.homework.insert_one({
        "id": str(uuid.uuid4()), "dog_id": s["dog_id"], "client_id": s["client"]["id"],
        "school_enrollment_id": s["se_id"], "source_lesson_id": lesson_id,
        "school_enrollment_record_id": s["enrollment_id"], "status": "active",
        "title": "Practice", "assigned_by": "Online School · Lesson",
        "section_logs": [{"at": server.now_iso(), "section": "Reps", "note": "5 clean reps"}],
        "created_at": server.now_iso()}))
    return run(server.portal_school_submit_checkpoint(
        s["se_id"], lesson_id,
        server.CheckpointSubmissionIn(video=VIDEO_DATA_URL, client_note="Here you go"),
        client_user))


def test_video_checkpoint_persists_the_same_overall_scores():
    s = _seed("online")
    lesson_id = s["lesson_ids"][0]
    submitted = _client_submit(s, lesson_id)
    sub_id = (submitted.get("checkpoint") or submitted)["id"]

    rubric = _rubric_for(s["se_id"], lesson_id)
    run(server.admin_school_checkpoint_grade(
        sub_id, _grade_body("advance", rubric, handler=(3, 4), dog=(2,)), ADMIN))

    row = _stored(sub_id)
    assert row["handler_overall"] == 3.5
    assert row["dog_overall"] == 2.0
    assert row.get("submission_source") != "trainer_live"

    graded = [c for c in _detail(s["se_id"])["checkpoints"] if c["id"] == sub_id][0]
    assert graded["handler_overall"] == 3.5
    assert graded["dog_overall"] == 2.0


# ---------------------------------------------------------------------------
# 3 — More Practice (prescribe_practice)
# ---------------------------------------------------------------------------

def test_more_practice_persists_scores_and_does_not_advance():
    s = _seed("in_person")
    first, second = s["lesson_ids"][0], s["lesson_ids"][1]

    before = run(server.db.dog_programs.find_one(
        {"id": s["enrollment_id"]}, {"_id": 0, "current_lesson_id": 1}))
    result = _live(s, first, outcome="prescribe_practice", handler=(2, 2), dog=(1,))

    row = _stored(result["checkpoint"]["id"])
    assert row["handler_overall"] == 2.0
    assert row["dog_overall"] == 1.0
    assert row["outcome"] == "prescribe_practice"

    after = run(server.db.dog_programs.find_one(
        {"id": s["enrollment_id"]}, {"_id": 0, "current_lesson_id": 1}))
    assert after["current_lesson_id"] == before["current_lesson_id"], "More Practice must not advance"
    assert after["current_lesson_id"] != second


# ---------------------------------------------------------------------------
# 4 — Trainer Assist
# ---------------------------------------------------------------------------

def test_trainer_assist_persists_scores_and_keeps_its_outcome():
    s = _seed("hybrid")
    result = _live(s, s["lesson_ids"][0], outcome="trainer_assist_recommended", handler=(1, 2), dog=(3,))

    row = _stored(result["checkpoint"]["id"])
    assert row["handler_overall"] == 1.5
    assert row["dog_overall"] == 3.0
    assert row["outcome"] == "trainer_assist_recommended"
    assert row["trainer_assist_hold_active"] is True
    assert row["trainer_assist_status"] == "needs_attention"

    graded = [c for c in _detail(s["se_id"])["checkpoints"] if c["id"] == row["id"]][0]
    assert graded["handler_overall"] == 1.5
    assert graded["outcome"] == "trainer_assist_recommended"


# ---------------------------------------------------------------------------
# 5 — legacy rows without the persisted fields
# ---------------------------------------------------------------------------

def test_legacy_rows_without_persisted_overalls_load_safely():
    """Rows graded before the fields existed must not 500, and must still show
    a score when their own rubric detail supports deriving one."""
    s = _seed("in_person")
    result = _live(s, s["lesson_ids"][0], handler=(5, 4), dog=(4,))
    sub_id = result["checkpoint"]["id"]

    # Simulate a pre-existing historical row: drop ONLY the new fields.
    run(server.db.checkpoint_submissions.update_one(
        {"id": sub_id}, {"$unset": {"handler_overall": 1, "dog_overall": 1}}))
    assert "handler_overall" not in _stored(sub_id)

    legacy = [c for c in _detail(s["se_id"])["checkpoints"] if c["id"] == sub_id][0]
    assert legacy["handler_overall"] == 4.5, "derived read-time from its own criterion scores"
    assert legacy["dog_overall"] == 4.0
    # …and the derivation is READ-ONLY — no silent backfill of stored data.
    assert "handler_overall" not in _stored(sub_id)


def test_legacy_row_with_insufficient_rubric_detail_is_not_given_a_fake_score():
    s = _seed("in_person")
    result = _live(s, s["lesson_ids"][0], handler=(5, 4), dog=(4,))
    sub_id = result["checkpoint"]["id"]

    # No overalls AND no per-criterion scores — nothing to honestly derive.
    run(server.db.checkpoint_submissions.update_one(
        {"id": sub_id},
        {"$unset": {"handler_overall": 1, "dog_overall": 1},
         "$set": {"handler_scores": {}, "dog_scores": {}}}))

    legacy = [c for c in _detail(s["se_id"])["checkpoints"] if c["id"] == sub_id][0]
    assert legacy["handler_overall"] is None
    assert legacy["dog_overall"] is None


def test_client_facing_record_exposes_scores_and_tolerates_legacy_rows():
    """The canonical client-facing history must carry the scores forward for
    the next phase — including for rows that predate persistence."""
    s = _seed("in_person")
    result = _live(s, s["lesson_ids"][0], handler=(5, 4), dog=(4,))
    sub_id = result["checkpoint"]["id"]
    client_user = _client_user(s)

    record = _client_record(s["se_id"], client_user)
    row = [c for c in record["checkpoints"] if c["id"] == sub_id][0]
    assert row["handler_overall"] == 4.5
    assert row["dog_overall"] == 4.0

    run(server.db.checkpoint_submissions.update_one(
        {"id": sub_id}, {"$unset": {"handler_overall": 1, "dog_overall": 1}}))
    record = _client_record(s["se_id"], client_user)
    row = [c for c in record["checkpoints"] if c["id"] == sub_id][0]
    assert row["handler_overall"] == 4.5, "legacy row still resolves, no 500"


# ---------------------------------------------------------------------------
# 6 — still ONE checkpoint model / one history
# ---------------------------------------------------------------------------

def test_no_second_checkpoint_model_or_duplicate_history_record():
    s = _seed("in_person")
    lesson_id = s["lesson_ids"][0]
    _live(s, lesson_id, handler=(5, 4), dog=(4,))

    rows = run(server.db.checkpoint_submissions.find(
        {"school_enrollment_id": s["se_id"], "lesson_id": lesson_id}, {"_id": 0, "id": 1}).to_list(10))
    assert len(rows) == 1, "one canonical row per enrollment+lesson"
    assert len(_detail(s["se_id"])["checkpoints"]) == 1, "one history entry"

    existing = set(run(server.db.list_collection_names()))
    for forbidden in ("checkpoint_scores", "checkpoint_history", "school_checkpoint_history",
                      "checkpoint_overalls", "trainer_assessments"):
        assert forbidden not in existing, f"a second checkpoint store appeared: {forbidden}"


def test_persisted_scores_use_the_canonical_calculation():
    """The stored pair must equal what the one calculation produces — no
    second scoring rule quietly diverging from the rubric average."""
    s = _seed("in_person")
    result = _live(s, s["lesson_ids"][0], handler=(5, 4), dog=(4,))

    row = _stored(result["checkpoint"]["id"])
    canonical = server._checkpoint_overall_scores(row["handler_scores"], row["dog_scores"])
    assert row["handler_overall"] == canonical["handler"]
    assert row["dog_overall"] == canonical["dog"]
    # and the resolver hands back the persisted value verbatim
    assert server._resolved_checkpoint_overall_scores(row) == {
        "handler": row["handler_overall"], "dog": row["dog_overall"]}
