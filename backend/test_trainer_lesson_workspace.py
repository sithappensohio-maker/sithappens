"""Trainer Lesson Workspace — session assessments, mastery, checkpoint gate,
client recap privacy, and Repeat Program attempt isolation.

Everything here runs against the EXISTING canonical spine: training_session_
drafts -> training_session_log, dog_programs.goal_progress, the School
checkpoint state machine, and the Practice/Homework engine. No second session,
progress, or history model is introduced, and these tests assert that.

Two owner decisions are pinned here:
  Decision 1 — a session's 1-5 score is an observation of TODAY. It never
    masters a skill and never revokes an existing mastery; only an explicit
    mastery_decision does either. The legacy per-goal editor (update_goal)
    keeps its original score-drives-status behaviour.
  Decision 2 — a required formal checkpoint is a hard advancement gate
    (409), not a warning, and a session score can never satisfy it.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")

TAG = "TLW"
ADMIN = {"id": "tlw-admin", "name": "TLW Trainer", "email": "tlw-admin@example.com", "role": "admin"}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _auth(user_id, email, role):
    return {"Authorization": f"Bearer {server.create_access_token(user_id, email, role, 0)}"}


def _cp_config():
    return server.CheckpointConfigIn(
        enabled=True, title="Checkpoint", submission_instructions="Film from the side.",
        handler_criteria=[server.CheckpointCriterionIn(name="Cue clarity")],
        dog_criteria=[server.CheckpointCriterionIn(name="Latency")],
        submission_requirements="Good lighting.", pass_readiness_guidance="3+ clean reps.",
    )


def _seed(delivery_mode="in_person", checkpoint_on_lesson1=False, lessons=2):
    """Client + dog + 2-skill program + School enrollment of the given mode."""
    suffix = uuid.uuid4().hex[:8]
    run(server.db.users.update_one(
        {"id": ADMIN["id"]},
        {"$set": {**ADMIN, "password_hash": "x", "active": True, "must_change_password": False,
                  "needs_password": False, "token_version": 0}}, upsert=True))

    prog = run(server.create_program(server.ProgramIn(
        name=f"{TAG} Program {suffix}", type="private_lessons",
        format={"count": 1, "unit": "modules"}, price=0, delivery_mode="both",
        modules=[server.ModuleIn(name="Module 1", order=0,
                                 goals=[server.GoalIn(name="Sit"), server.GoalIn(name="Down")])]),
        ADMIN))
    module = prog["modules"][0]
    gids = [g["id"] for g in module["goals"]]
    lesson_models = []
    for i in range(lessons):
        lesson_models.append(server.LessonIn(
            name=f"Lesson {i + 1}", order=i, active=True, skill_ids=[gids[i % len(gids)]],
            client_overview="overview", why_it_matters="matters.", success_criteria="5 in a row.",
            checkpoint=_cp_config() if (i == 0 and checkpoint_on_lesson1) else None))
    prog = run(server.update_program(
        prog["id"],
        server.ProgramIn(name=prog["name"], type="private_lessons", format=prog["format"], price=0,
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
        "skill_ids": gids,
        "lesson_ids": [l["id"] for l in prog["modules"][0]["lessons"]],
    }


def _client_user(s):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-user-{uid[:8]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} Client User", "role": "client",
        "client_id": s["client"]["id"], "password_hash": "x", "active": True,
        "must_change_password": False, "needs_password": False, "token_version": 0}))
    return {"id": uid, "email": email, "role": "client", "client_id": s["client"]["id"]}


_LABEL_SEQ = {"n": 0}


def _open_draft(s, enrollment_id=None, label=None):
    """Returns the DRAFT itself. The endpoint wraps it in a resolution
    envelope so the UI can render a resolution screen instead of guessing.

    Drafts are keyed on (enrollment_id, occurrence_date, session_label), so
    each simulated visit gets its own label — otherwise a second lesson on
    the same day correctly resumes the first, already-completed draft.
    """
    if label is None:
        _LABEL_SEQ["n"] += 1
        label = f"visit-{_LABEL_SEQ['n']}"
    res = run(server.start_training_session_draft_direct(
        s["dog_id"], enrollment_id or s["enrollment_id"], label, ADMIN))
    assert res.get("resolution") == "ready", res
    _open_draft.last_envelope = res
    return res["draft"]


def _open_session(s, enrollment_id=None, label=None):
    """Draft + the pre-session overview that carries the trainer handoff."""
    draft = _open_draft(s, enrollment_id=enrollment_id, label=label)
    return draft, _open_draft.last_envelope["overview"]


def _ensure_skill_in_plan(draft, skill_id, name="Skill"):
    """_generate_suggested_plan deliberately omits mastered-and-stable skills
    (that filtering is correct product behaviour). A trainer can still work
    one — the plan is a starting point, not a script — so re-add it exactly
    as the workspace's add-activity control does."""
    activities = list((draft.get("plan") or {}).get("activities") or [])
    for a in activities:
        if a.get("skill_id") == skill_id:
            return draft, a["id"]
    activities.append({
        "id": str(uuid.uuid4()), "source": "skill", "skill_id": skill_id,
        "name": name, "order": len(activities),
    })
    updated = run(server.update_training_session_draft(
        draft["id"],
        server.TrainingSessionDraftUpdateIn(
            plan=[server.SessionActivityIn(**a) for a in activities]),
        ADMIN))
    return updated, activities[-1]["id"]


def _record(draft_id, actuals, **summary):
    """Save assessments + structured summary onto the open draft."""
    return run(server.update_training_session_draft(
        draft_id,
        server.TrainingSessionDraftUpdateIn(
            actuals={k: server.SessionActivityActualIn(**v) for k, v in actuals.items()}, **summary),
        ADMIN))


def _complete(draft_id, action="remain", **kw):
    return run(server.complete_training_session(
        draft_id, server.SessionCompletionIn(advancement_action=action, **kw), ADMIN))


def _activity_for_skill(draft, skill_id):
    for a in (draft.get("plan") or {}).get("activities") or []:
        if a.get("skill_id") == skill_id:
            return a["id"]
    raise AssertionError(f"no planned activity for skill {skill_id}")


def _enrollment(s):
    return run(server.db.dog_programs.find_one({"id": s["enrollment_id"]}, {"_id": 0}))


def _pass_live_checkpoint(s, lesson_id):
    """Satisfy the gate the only legitimate way — canonical grading."""
    enr = _enrollment(s)
    rubric = server._find_lesson_in_snapshot(enr, lesson_id)["checkpoint"]
    return run(server.admin_school_live_checkpoint(
        s["se_id"], lesson_id,
        server.CheckpointGradeIn(
            handler_scores={c["id"]: 5 for c in rubric["handler_criteria"]},
            dog_scores={c["id"]: 5 for c in rubric["dog_criteria"]},
            feedback="Clean.", outcome="advance"),
        ADMIN))


@pytest.fixture(autouse=True)
def _clean():
    yield
    ids = [d["id"] for d in run(server.db.dogs.find({"name": {"$regex": TAG}}, {"_id": 0, "id": 1}).to_list(500))]
    se_ids = [s["id"] for s in run(
        server.db.school_enrollments.find({"dog_id": {"$in": ids}}, {"_id": 0, "id": 1}).to_list(500))]
    enr_ids = [e["id"] for e in run(
        server.db.dog_programs.find({"dog_id": {"$in": ids}}, {"_id": 0, "id": 1}).to_list(500))]
    for coll in ("dog_programs", "school_enrollments", "homework", "checkpoint_submissions",
                 "school_events", "training_session_log", "training_session_drafts"):
        run(server.db[coll].delete_many(
            {"$or": [{"dog_id": {"$in": ids}}, {"school_enrollment_id": {"$in": se_ids}},
                     {"enrollment_id": {"$in": enr_ids}}]}))
    run(server.db.programs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.dogs.delete_many({"name": {"$regex": TAG}}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))
    run(server.db.users.delete_many({"name": {"$regex": TAG}}))


# ---------------------------------------------------------------------------
# 1-3 — enrollment resolution + curriculum-driven plan
# ---------------------------------------------------------------------------

def test_in_person_session_resolves_the_correct_school_attempt():
    s = _seed("in_person")
    draft = _open_draft(s)
    assert draft["enrollment_id"] == s["enrollment_id"]
    enr = _enrollment(s)
    assert enr["delivery_channel"] == "in_person_school"


def test_hybrid_session_resolves_the_correct_school_attempt():
    s = _seed("hybrid")
    draft = _open_draft(s)
    assert draft["enrollment_id"] == s["enrollment_id"]
    assert _enrollment(s)["delivery_channel"] == "hybrid_school"


def test_plan_skills_come_from_the_real_curriculum():
    s = _seed("in_person")
    draft = _open_draft(s)
    planned = {a.get("skill_id") for a in (draft.get("plan") or {}).get("activities") or []}
    assert planned and planned.issubset(set(s["skill_ids"])), "skills must come from the program, not a retyped list"


def test_online_enrollment_cannot_start_a_trainer_session():
    """Requirement 20 — online-only behaviour is not converted into an
    in-person session workflow."""
    s = _seed("online")
    with pytest.raises(Exception) as exc:
        _open_draft(s)
    # Either an explicit HTTP refusal or a non-"ready" resolution — never a
    # usable trainer session draft against a self-guided enrollment.
    if isinstance(exc.value, server.HTTPException):
        assert exc.value.status_code in (400, 404, 409, 422)
    assert run(server.db.training_session_drafts.count_documents(
        {"enrollment_id": s["enrollment_id"]})) == 0


# ---------------------------------------------------------------------------
# 4-11 — assessment + structured summary persistence
# ---------------------------------------------------------------------------

def test_assessment_score_status_observation_and_notes_all_persist():
    s = _seed("in_person")
    draft = _open_draft(s)
    aid = _activity_for_skill(draft, s["skill_ids"][0])
    _record(draft["id"], {aid: {
        "score": 4, "outcome": "improving", "notes": "internal: handler timing sloppy",
        "client_observation": "Sit is coming along nicely.",
        "handler_assistance": "verbal only", "distraction_level": "low", "environment": "indoor",
    }}, what_went_well="Great focus.", needs_work="Duration.", next_lesson_focus="Add distance.",
        session_note="STAFF ONLY: owner arrived late", client_recap_note="Lovely work today.")
    res = _complete(draft["id"])
    log = res["session_log"]

    entry = next(d for d in log["goal_updates"] if d["goal_id"] == s["skill_ids"][0])
    assert entry["session_score"] == 4
    assert entry["session_outcome"] == "improving"
    assert entry["client_observation"] == "Sit is coming along nicely."
    assert entry["note"] == "internal: handler timing sloppy"
    assert log["what_went_well"] == "Great focus."
    assert log["needs_work"] == "Duration."
    assert log["next_lesson_focus"] == "Add distance."
    assert log["session_note"] == "STAFF ONLY: owner arrived late"
    assert log["client_recap_note"] == "Lovely work today."


# ---------------------------------------------------------------------------
# Decision 1 — session scores never auto-master
# ---------------------------------------------------------------------------

def test_score_of_five_without_explicit_mastery_does_not_master():
    s = _seed("in_person")
    draft = _open_draft(s)
    skill = s["skill_ids"][0]
    _record(draft["id"], {_activity_for_skill(draft, skill): {"score": 5, "outcome": "reliable"}})
    _complete(draft["id"])

    gp = _enrollment(s)["goal_progress"][skill]
    assert gp["score"] == 5, "the performance IS recorded"
    assert gp["status"] != "mastered", "but 5/5 alone must never master a curriculum skill"


def test_explicit_mastery_decision_does_master():
    s = _seed("in_person")
    draft = _open_draft(s)
    skill = s["skill_ids"][0]
    _record(draft["id"], {_activity_for_skill(draft, skill): {
        "score": 4, "mastery_decision": "mastered"}})
    _complete(draft["id"])
    assert _enrollment(s)["goal_progress"][skill]["status"] == "mastered"


def test_later_low_session_score_does_not_erase_prior_mastery():
    s = _seed("in_person")
    skill = s["skill_ids"][0]
    d1 = _open_draft(s)
    _record(d1["id"], {_activity_for_skill(d1, skill): {"score": 5, "mastery_decision": "mastered"}})
    _complete(d1["id"])
    assert _enrollment(s)["goal_progress"][skill]["status"] == "mastered"

    d2 = _open_draft(s)
    d2, aid2 = _ensure_skill_in_plan(d2, skill)
    _record(d2["id"], {aid2: {"score": 2, "outcome": "needs_more_work"}})
    res2 = _complete(d2["id"])

    gp = _enrollment(s)["goal_progress"][skill]
    assert gp["status"] == "mastered", "a weak rep is not a revocation"
    # …and the weaker result is still preserved in history.
    entry = next(d for d in res2["session_log"]["goal_updates"] if d["goal_id"] == skill)
    assert entry["session_score"] == 2
    assert entry["session_outcome"] == "needs_more_work"


def test_explicit_not_yet_can_revoke_mastery():
    """Revocation stays possible — but only as a deliberate act."""
    s = _seed("in_person")
    skill = s["skill_ids"][0]
    d1 = _open_draft(s)
    _record(d1["id"], {_activity_for_skill(d1, skill): {"mastery_decision": "mastered"}})
    _complete(d1["id"])
    d2 = _open_draft(s)
    d2, aid2 = _ensure_skill_in_plan(d2, skill)
    _record(d2["id"], {aid2: {"score": 2, "mastery_decision": "not_yet"}})
    _complete(d2["id"])
    assert _enrollment(s)["goal_progress"][skill]["status"] == "in_progress"


def test_legacy_update_goal_still_derives_status_from_score():
    """Backward compatibility — the per-goal editor is untouched."""
    s = _seed("in_person")
    skill = s["skill_ids"][0]
    run(server.update_goal(s["dog_id"], s["enrollment_id"], skill, server.GoalUpdate(score=4), ADMIN))
    assert _enrollment(s)["goal_progress"][skill]["status"] == "mastered"
    run(server.update_goal(s["dog_id"], s["enrollment_id"], skill, server.GoalUpdate(score=1), ADMIN))
    assert _enrollment(s)["goal_progress"][skill]["status"] == "in_progress"


# ---------------------------------------------------------------------------
# Decision 2 — required checkpoint is a hard advancement gate
# ---------------------------------------------------------------------------

def test_required_checkpoint_blocks_advancement_with_409():
    s = _seed("in_person", checkpoint_on_lesson1=True)
    draft = _open_draft(s)
    _record(draft["id"], {_activity_for_skill(draft, s["skill_ids"][0]): {"score": 5}})
    with pytest.raises(server.HTTPException) as exc:
        _complete(draft["id"], action="advance_lesson")
    assert exc.value.status_code == 409
    assert exc.value.detail["error_code"] == "checkpoint_required_before_advancement"
    assert "checkpoint" in exc.value.detail["message"].lower()


def test_blocked_advancement_still_leaves_the_session_data_safe():
    s = _seed("in_person", checkpoint_on_lesson1=True)
    draft = _open_draft(s)
    aid = _activity_for_skill(draft, s["skill_ids"][0])
    _record(draft["id"], {aid: {"score": 5, "client_observation": "Great sit."}},
            what_went_well="Focus was excellent.")
    with pytest.raises(server.HTTPException):
        _complete(draft["id"], action="advance_lesson")

    fresh = run(server.db.training_session_drafts.find_one({"id": draft["id"]}, {"_id": 0}))
    assert fresh["status"] == "draft", "still completable once the checkpoint is graded"
    assert fresh["actuals"][aid]["score"] == 5
    assert fresh["what_went_well"] == "Focus was excellent."
    # …and completing WITHOUT advancing is allowed.
    res = _complete(draft["id"], action="remain")
    assert res["session_log"]["what_went_well"] == "Focus was excellent."


def test_passed_live_checkpoint_allows_advancement():
    s = _seed("in_person", checkpoint_on_lesson1=True)
    _pass_live_checkpoint(s, s["lesson_ids"][0])
    draft = _open_draft(s)
    _record(draft["id"], {_activity_for_skill(draft, s["skill_ids"][0]): {"score": 4}})
    res = _complete(draft["id"], action="advance_lesson")
    assert res["session_log"]["advancement_action"] == "advance_lesson"


def test_hybrid_checkpoint_allows_advancement():
    s = _seed("hybrid", checkpoint_on_lesson1=True)
    _pass_live_checkpoint(s, s["lesson_ids"][0])
    draft = _open_draft(s)
    _record(draft["id"], {_activity_for_skill(draft, s["skill_ids"][0]): {"score": 4}})
    res = _complete(draft["id"], action="advance_lesson")
    assert res["session_log"]["advancement_action"] == "advance_lesson"


def test_ordinary_lesson_without_checkpoint_advances_normally():
    s = _seed("in_person", checkpoint_on_lesson1=False)
    draft = _open_draft(s)
    _record(draft["id"], {_activity_for_skill(draft, s["skill_ids"][0]): {"score": 4}})
    res = _complete(draft["id"], action="advance_lesson")
    assert res["session_log"]["advancement_action"] == "advance_lesson"


def test_session_score_alone_cannot_satisfy_a_required_checkpoint():
    s = _seed("in_person", checkpoint_on_lesson1=True)
    d1 = _open_draft(s)
    _record(d1["id"], {_activity_for_skill(d1, s["skill_ids"][0]): {
        "score": 5, "outcome": "reliable", "mastery_decision": "mastered"}})
    _complete(d1["id"], action="remain")
    # A perfect, mastery-granting session still does not create a checkpoint…
    assert run(server.db.checkpoint_submissions.count_documents(
        {"enrollment_id": s["enrollment_id"]})) == 0
    # …and the gate still holds.
    d2 = _open_draft(s)
    with pytest.raises(server.HTTPException) as exc:
        _complete(d2["id"], action="advance_lesson")
    assert exc.value.status_code == 409


def test_gate_does_not_create_or_duplicate_a_checkpoint():
    s = _seed("in_person", checkpoint_on_lesson1=True)
    _pass_live_checkpoint(s, s["lesson_ids"][0])
    before = run(server.db.checkpoint_submissions.count_documents({"enrollment_id": s["enrollment_id"]}))
    draft = _open_draft(s)
    _complete(draft["id"], action="advance_lesson")
    after = run(server.db.checkpoint_submissions.count_documents({"enrollment_id": s["enrollment_id"]}))
    assert before == after == 1, "advancement must never manufacture a checkpoint"


def test_non_school_trainer_led_enrollment_is_not_gated():
    """The gate is scoped to School deliveries — plain trainer-led
    enrollments keep their existing behaviour."""
    s = _seed("in_person", checkpoint_on_lesson1=True)
    run(server.db.dog_programs.update_one(
        {"id": s["enrollment_id"]}, {"$set": {"delivery_channel": "trainer_led"}}))
    draft = _open_draft(s)
    res = _complete(draft["id"], action="advance_lesson")
    assert res["session_log"]["advancement_action"] == "advance_lesson"


# ---------------------------------------------------------------------------
# 12-13 — Practice linkage + canonical progress
# ---------------------------------------------------------------------------

def test_practice_assigned_from_a_lesson_links_to_session_and_attempt():
    s = _seed("in_person")
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        name=f"{TAG} Practice", tier="foundation", description="d",
        sections=[{"name": "Reps", "items": [{"text": "5 reps"}]}]), ADMIN))
    skill = s["skill_ids"][0]
    enr = _enrollment(s)
    snap = enr["program_snapshot"]
    for m in snap["modules"]:
        for g in m["goals"]:
            if g["id"] == skill:
                g["homework_template_ids"] = [tpl["id"]]
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"program_snapshot": snap}}))

    draft = _open_draft(s)
    aid = _activity_for_skill(draft, skill)
    _record(draft["id"], {aid: {"score": 3, "homework_eligible": True}})
    res = _complete(draft["id"])

    hw_ids = res["session_log"]["homework_created"]
    assert hw_ids, "Practice must be created through the existing engine"
    hw = run(server.db.homework.find_one({"id": hw_ids[0]}, {"_id": 0}))
    assert hw["dog_id"] == s["dog_id"]
    assert hw["source_skill_id"] == skill
    assert hw["source_session_log_id"] == res["session_log"]["id"]
    assert hw["school_enrollment_id"] == s["se_id"], "linked to the School attempt"
    assert hw["school_enrollment_record_id"] == s["enrollment_id"]


def test_no_second_progress_ledger_is_created():
    s = _seed("in_person")
    draft = _open_draft(s)
    _record(draft["id"], {_activity_for_skill(draft, s["skill_ids"][0]): {"score": 4}})
    _complete(draft["id"])
    existing = set(run(server.db.list_collection_names()))
    for forbidden in ("session_progress", "skill_assessments", "lesson_recaps",
                      "trainer_assessments", "session_scores"):
        assert forbidden not in existing, f"a second model appeared: {forbidden}"


# ---------------------------------------------------------------------------
# 15-16 — history immutability + Repeat Program isolation
# ---------------------------------------------------------------------------

def test_previous_session_history_is_unchanged_by_a_later_session():
    s = _seed("in_person")
    skill = s["skill_ids"][0]
    d1 = _open_draft(s)
    _record(d1["id"], {_activity_for_skill(d1, skill): {"score": 2, "client_observation": "First try."}},
            what_went_well="Showed up strong.")
    first = _complete(d1["id"])["session_log"]

    d2 = _open_draft(s)
    _record(d2["id"], {_activity_for_skill(d2, skill): {"score": 5, "client_observation": "Much better."}},
            what_went_well="Big improvement.")
    _complete(d2["id"])

    reread = run(server.db.training_session_log.find_one({"id": first["id"]}, {"_id": 0}))
    assert reread["what_went_well"] == "Showed up strong."
    entry = next(d for d in reread["goal_updates"] if d["goal_id"] == skill)
    assert entry["session_score"] == 2 and entry["client_observation"] == "First try."
    assert run(server.db.training_session_log.count_documents({"enrollment_id": s["enrollment_id"]})) == 2


def test_repeat_program_attempts_keep_separate_session_history():
    s = _seed("in_person")
    d1 = _open_draft(s)
    _record(d1["id"], {_activity_for_skill(d1, s["skill_ids"][0]): {"score": 3}},
            client_recap_note="Attempt one recap.")
    _complete(d1["id"])

    # Finish attempt 1 and start a genuine second attempt.
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "completed"}}))
    run(server.db.school_enrollments.update_one({"id": s["se_id"]}, {"$set": {"status": "completed"}}))
    retake = run(server.school_retake_enrollment(
        s["se_id"], server.SchoolRetakeIn(delivery_mode="in_person"), ADMIN))
    second_se = retake["school_enrollment"]["id"]
    second_enr = retake["enrollment"]["id"]
    assert second_enr != s["enrollment_id"]

    d2 = _open_draft(s, enrollment_id=second_enr)
    _record(d2["id"], {_activity_for_skill(d2, s["skill_ids"][0]): {"score": 5}},
            client_recap_note="Attempt two recap.")
    _complete(d2["id"])

    cu = _client_user(s)
    h1 = run(_http.get(f"/api/portal/school/{s['se_id']}/lesson-history",
                       headers=_auth(cu["id"], cu["email"], "client"))).json()
    h2 = run(_http.get(f"/api/portal/school/{second_se}/lesson-history",
                       headers=_auth(cu["id"], cu["email"], "client"))).json()
    assert len(h1["lessons"]) == 1 and len(h2["lessons"]) == 1
    assert h1["lessons"][0]["trainer_feedback"] == "Attempt one recap."
    assert h2["lessons"][0]["trainer_feedback"] == "Attempt two recap."


# ---------------------------------------------------------------------------
# 17-19 — client recap correctness, privacy, access control
# ---------------------------------------------------------------------------

def _completed_session_for_recap(s):
    draft = _open_draft(s)
    aid = _activity_for_skill(draft, s["skill_ids"][0])
    _record(draft["id"], {aid: {
        "score": 4, "outcome": "improving",
        "notes": "PRIVATE-TRAINER-NOTE handler needs correcting",
        "client_observation": "Sit is holding for 10 seconds now.",
    }}, what_went_well="Focus was excellent.", needs_work="Duration under distraction.",
        next_lesson_focus="Add distance.",
        session_note="PRIVATE-SESSION-NOTE owner is difficult",
        client_recap_note="Great session — keep practising daily.")
    return _complete(draft["id"])["session_log"]


def test_client_recap_returns_the_correct_session_content():
    s = _seed("in_person")
    log = _completed_session_for_recap(s)
    cu = _client_user(s)
    r = run(_http.get(f"/api/portal/school/{s['se_id']}/lesson-history",
                      headers=_auth(cu["id"], cu["email"], "client")))
    assert r.status_code == 200, r.text
    body = r.json()
    lesson = body["lessons"][0]
    assert lesson["session_id"] == log["id"]
    assert lesson["date"] and lesson["trainer_name"]
    assert lesson["program_name"] and lesson["lesson_name"]
    assert lesson["what_went_well"] == "Focus was excellent."
    assert lesson["needs_work"] == "Duration under distraction."
    assert lesson["trainer_feedback"] == "Great session — keep practising daily."
    skill = lesson["skills"][0]
    assert skill["name"] and skill["score"] == 4
    assert skill["assessment"] == "improving"
    assert skill["observation"] == "Sit is holding for 10 seconds now."
    assert "mastered_pct" in body["progress"]


def test_client_api_never_exposes_private_trainer_content():
    """Asserted at the API level, not in React."""
    s = _seed("in_person")
    _completed_session_for_recap(s)
    cu = _client_user(s)
    raw = run(_http.get(f"/api/portal/school/{s['se_id']}/lesson-history",
                        headers=_auth(cu["id"], cu["email"], "client"))).text
    assert "PRIVATE-SESSION-NOTE" not in raw
    assert "PRIVATE-TRAINER-NOTE" not in raw
    assert "session_note" not in raw
    # the client-safe content IS present, so this is a real allowlist, not an empty response
    assert "Sit is holding for 10 seconds now." in raw


def test_another_clients_session_cannot_be_accessed():
    a = _seed("in_person")
    b = _seed("in_person")
    _completed_session_for_recap(a)
    intruder = _client_user(b)
    r = run(_http.get(f"/api/portal/school/{a['se_id']}/lesson-history",
                      headers=_auth(intruder["id"], intruder["email"], "client")))
    assert r.status_code in (403, 404), r.text
    assert "Focus was excellent." not in r.text


def test_staff_without_training_permission_cannot_complete_a_session():
    s = _seed("in_person")
    draft = _open_draft(s)
    restricted = {"id": str(uuid.uuid4()), "role": "employee", "name": f"{TAG} Front Desk",
                  "email": f"{TAG.lower()}-fd@example.com", "staff_role": "front_desk"}
    run(server.db.users.insert_one({**restricted, "password_hash": "x", "active": True,
                                    "must_change_password": False, "needs_password": False,
                                    "token_version": 0}))
    r = run(_http.post(f"/api/training-session-drafts/{draft['id']}/complete",
                       headers=_auth(restricted["id"], restricted["email"], "employee"),
                       json={"advancement_action": "remain"}))
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# trainer handoff
# ---------------------------------------------------------------------------

def test_next_lesson_shows_previous_session_handoff():
    s = _seed("in_person")
    strong, weak = s["skill_ids"][0], s["skill_ids"][1]
    d1 = _open_draft(s)
    _record(d1["id"], {
        _activity_for_skill(d1, strong): {"score": 5, "outcome": "reliable"},
        _activity_for_skill(d1, weak): {"score": 2, "outcome": "needs_more_work"},
    }, what_went_well="Recall was sharp.", needs_work="Down needs duration.",
        next_lesson_focus="Duration work on Down.")
    _complete(d1["id"])

    _, overview = _open_session(s)
    last = overview["last_session"]
    assert last["next_lesson_focus"] == "Duration work on Down."
    assert last["what_went_well"] == "Recall was sharp."
    assert last["needs_work"] == "Down needs duration."
    assert last["strongest_skills"] and last["strongest_skills"][0]["score"] == 5
    assert last["needs_work_skills"] and last["needs_work_skills"][0]["score"] == 2


def test_handoff_never_crosses_repeat_program_attempts():
    s = _seed("in_person")
    d1 = _open_draft(s)
    _record(d1["id"], {_activity_for_skill(d1, s["skill_ids"][0]): {"score": 5}},
            next_lesson_focus="ATTEMPT-ONE-FOCUS")
    _complete(d1["id"])

    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "completed"}}))
    run(server.db.school_enrollments.update_one({"id": s["se_id"]}, {"$set": {"status": "completed"}}))
    retake = run(server.school_retake_enrollment(
        s["se_id"], server.SchoolRetakeIn(delivery_mode="in_person"), ADMIN))
    second_enr = retake["enrollment"]["id"]

    _, overview = _open_session(s, enrollment_id=second_enr)
    assert overview["last_session"] is None, "a fresh attempt starts with no inherited handoff"


def test_score_marks_a_skill_worked_but_can_never_reach_mastered():
    """The precise boundary of Decision 1.

    A skill that was just scored plainly isn't "not started" any more, so a
    session score still promotes not_started -> in_progress. What it must
    never do is reach "mastered" — that stays an explicit decision — or move
    a skill backwards.
    """
    s = _seed("in_person")
    skill = s["skill_ids"][0]
    assert (_enrollment(s)["goal_progress"][skill]).get("status") == "not_started"

    d = _open_draft(s)
    _record(d["id"], {_activity_for_skill(d, skill): {"score": 3, "outcome": "improving"}})
    _complete(d["id"])

    gp = _enrollment(s)["goal_progress"][skill]
    assert gp["status"] == "in_progress", "a worked skill leaves not_started"
    assert gp["score"] == 3

    # …and a top score still cannot cross into mastery on its own.
    d2 = _open_draft(s)
    d2, aid2 = _ensure_skill_in_plan(d2, skill)
    _record(d2["id"], {aid2: {"score": 5, "outcome": "reliable"}})
    _complete(d2["id"])
    gp2 = _enrollment(s)["goal_progress"][skill]
    assert gp2["score"] == 5
    assert gp2["status"] == "in_progress", "5/5 is still not a mastery decision"
