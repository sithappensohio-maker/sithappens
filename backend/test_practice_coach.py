"""Client Practice Coach upgrade — backend coverage.

Covers what 05_ACCEPTANCE_TESTS.md's "Data / backward compatibility",
"Authoring", and "Client guided practice" sections ask for on the backend
side (frontend-only items — token rendering, the guided-practice reducer,
generality across templates — are covered in practiceCoachPolish.test.js
and the entry-points test instead):

  * A legacy template with no practice_coach stays fully valid and
    unaffected by every new code path.
  * practice_coach is a typed, additive field on the existing homework-
    template model — validated only when enabled=True, video/media never
    required.
  * Both places a homework instance is created from a template
    (/homework/from-template and the internal auto-assign trigger) snapshot
    practice_coach exactly like every other template field, so a later
    template edit never rewrites an already-active assignment.
  * Stable ids are backfilled for any array item missing one.
  * The client-safe serializer (_client_safe_homework) is a real allowlist,
    not "the frontend just doesn't render it" — proven by constructing a
    document with a field that should never reach the client and asserting
    it's absent from the filtered result.
  * section-log now accepts difficulty/could_not_complete/photo (mirroring
    DaySubmitIn's __-prefixed field_values convention exactly) and a
    section-scoped ask/answer question flow reusing the SAME question
    shape/semantics as the daily-tracker one.

Same fixture/cleanup convention as test_homework_personalization_phase5.py.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_PRACTICE_COACH"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    dog = {
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }
    run(server.db.dogs.insert_one(dog))
    try:
        yield c, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@contextlib.contextmanager
def _template(practice_coach=None, **extra):
    admin = _admin_user()
    body = server.HomeworkTemplateIn(name=f"{TAG} {uuid.uuid4().hex[:6]}", practice_coach=practice_coach, **extra)
    tpl = run(server.create_homework_template(body, admin))
    try:
        yield tpl, admin
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


MERLIN_RECIPE = {
    "enabled": True,
    "allow_quick_practice": True,
    "goal": "Get {{dog_name}} to look at you when you say the name once.",
    "success_today": "{{dog_name}} looks at you within 2 seconds on 7 out of 10 tries.",
    "encouragement": "Short, happy sessions build fast results.",
    "schedule": {"minutes_per_round": 3, "rounds_per_day": 3, "reps_per_round": 10, "rest_after_reps": 5, "target_response_seconds": 2},
    "setup_items": [{"id": "quiet-room", "icon_key": "home", "title": "Quiet room", "description": "Minimal noise.", "required": True}],
    "pro_tip": "Remove toys, turn off the TV.",
    "steps": [{"id": "get-ready", "title": "Get ready", "instruction": "Have {{dog_name}} nearby."}],
    "good_rep": {"sequence": ["Say the name once", "Dog looks", "Mark YES", "Reward"], "explanation": "Clean cue."},
    "not_this": {"sequence": ["Repeat the name", "Repeat again"], "explanation": "Teaches the cue doesn't matter."},
    "troubleshooting": [{"id": "no-look", "trigger": "Dog does not look", "title": "Didn't look?", "actions": ["Wait one second."], "stop_round": False}],
    "stop_rules": [{"id": "three-misses", "condition": "3 misses in a row", "message": "Stop and take a break."}],
    "guided_practice": {"enabled": True, "ready_instruction": "Wait.", "cue_prompt": "Say the name ONCE.",
                         "success_button_label": "HE LOOKED", "miss_button_label": "HE DIDN'T",
                         "success_message": "Say YES!", "miss_message": "Don't repeat the name.", "count_successes": True},
    "difficulty_feedback": {"easy": "Great.", "good": "Nice.", "okay": "Stay here.", "hard": "Make it easier.", "very_hard": "Stop for today."},
    "end_questions": [{"id": "focus", "type": "choice", "label": "How focused?", "options": ["Low", "High"], "required": False}],
}


# ---------------------------------------------------------------------------
# Backward compatibility
# ---------------------------------------------------------------------------

def test_legacy_template_with_no_practice_coach_is_unaffected():
    with _template(practice_coach=None) as (tpl, admin):
        assert tpl["practice_coach"] is None
        assert tpl["practice_coach_readiness"] == {"errors": [], "warnings": []}


def test_disabled_practice_coach_never_blocks_save():
    with _template(practice_coach={"enabled": False}) as (tpl, admin):
        assert tpl["practice_coach"]["enabled"] is False


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_enabling_coach_mode_without_goal_is_rejected():
    admin = _admin_user()
    body = server.HomeworkTemplateIn(name=f"{TAG} bad", practice_coach={
        "enabled": True, "success_today": "x", "steps": [{"title": "a", "instruction": "b"}],
        "schedule": {"rounds_per_day": 3, "reps_per_round": 10},
    })
    try:
        run(server.create_homework_template(body, admin))
        assert False, "expected 422"
    except server.HTTPException as exc:
        assert exc.status_code == 422
        assert "Goal" in exc.detail


def test_enabling_coach_mode_without_steps_is_rejected():
    admin = _admin_user()
    body = server.HomeworkTemplateIn(name=f"{TAG} bad", practice_coach={
        "enabled": True, "goal": "x", "success_today": "y", "steps": [],
        "schedule": {"rounds_per_day": 3, "reps_per_round": 10},
    })
    try:
        run(server.create_homework_template(body, admin))
        assert False, "expected 422"
    except server.HTTPException as exc:
        assert exc.status_code == 422
        assert "step" in exc.detail.lower()


def test_video_missing_is_a_warning_never_a_blocking_error():
    with _template(practice_coach=MERLIN_RECIPE) as (tpl, admin):
        assert tpl["practice_coach_readiness"]["errors"] == []
        assert any("demo media" in w.lower() for w in tpl["practice_coach_readiness"]["warnings"])


def test_full_merlin_recipe_saves_with_zero_errors():
    with _template(practice_coach=MERLIN_RECIPE) as (tpl, admin):
        assert tpl["practice_coach_readiness"]["errors"] == []
        assert tpl["practice_coach"]["goal"] == MERLIN_RECIPE["goal"]
        assert tpl["practice_coach"]["guided_practice"]["success_button_label"] == "HE LOOKED"


# ---------------------------------------------------------------------------
# Stable ids
# ---------------------------------------------------------------------------

def test_missing_ids_are_backfilled_on_create():
    admin = _admin_user()
    body = server.HomeworkTemplateIn(name=f"{TAG} noids", practice_coach={
        "enabled": True, "goal": "g", "success_today": "s",
        "schedule": {"rounds_per_day": 1, "reps_per_round": 5},
        "steps": [{"title": "Step one", "instruction": "Do it"}],  # no id
        "setup_items": [{"title": "Quiet room"}],  # no id
    })
    tpl = run(server.create_homework_template(body, admin))
    try:
        assert tpl["practice_coach"]["steps"][0]["id"]
        assert tpl["practice_coach"]["setup_items"][0]["id"]
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


def test_existing_ids_are_preserved_not_replaced():
    with _template(practice_coach=MERLIN_RECIPE) as (tpl, admin):
        assert tpl["practice_coach"]["steps"][0]["id"] == "get-ready"
        assert tpl["practice_coach"]["setup_items"][0]["id"] == "quiet-room"


# ---------------------------------------------------------------------------
# Snapshot semantics — both creation paths
# ---------------------------------------------------------------------------

def test_from_template_snapshot_includes_practice_coach_and_survives_later_edit():
    with _client_and_dog() as (c, dog):
        with _template(practice_coach=MERLIN_RECIPE) as (tpl, admin):
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                assert hw["template_snapshot"]["practice_coach"]["goal"] == MERLIN_RECIPE["goal"]
                # Edit the template after assignment — the snapshot must not change.
                run(server.update_homework_template(tpl["id"], server.HomeworkTemplateIn(
                    name=tpl["name"], practice_coach={**MERLIN_RECIPE, "goal": "Completely different goal"},
                ), admin))
                refreshed = run(server.db.homework.find_one({"id": hw["id"]}, {"_id": 0}))
                assert refreshed["template_snapshot"]["practice_coach"]["goal"] == MERLIN_RECIPE["goal"]
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


def test_internal_auto_assign_snapshot_includes_practice_coach():
    with _client_and_dog() as (c, dog):
        with _template(practice_coach=MERLIN_RECIPE) as (tpl, admin):
            hw = run(server._create_homework_from_template_internal(dog, c, tpl["id"]))
            try:
                assert hw["template_snapshot"]["practice_coach"]["goal"] == MERLIN_RECIPE["goal"]
                assert hw["template_snapshot"]["practice_coach"]["guided_practice"]["miss_button_label"] == "HE DIDN'T"
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


def test_startup_never_mutates_a_live_assignment():
    """No migration/backfill runs at startup for this feature — a live
    assignment's template_snapshot is set once, at creation, and never
    touched again outside of an explicit admin edit to the ASSIGNMENT
    itself (which this feature doesn't add)."""
    with _client_and_dog() as (c, dog):
        with _template(practice_coach=MERLIN_RECIPE) as (tpl, admin):
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                before = run(server.db.homework.find_one({"id": hw["id"]}, {"_id": 0}))
                run(server.startup())
                after = run(server.db.homework.find_one({"id": hw["id"]}, {"_id": 0}))
                assert before["template_snapshot"] == after["template_snapshot"]
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


# ---------------------------------------------------------------------------
# Client-safe serialization
# ---------------------------------------------------------------------------

def test_client_safe_homework_strips_unlisted_fields():
    raw = {
        "id": "x", "dog_id": "d", "title": "T", "status": "assigned",
        "some_future_trainer_grading_field": "SECRET — must never reach the client",
        "template_snapshot": {"practice_coach": {"enabled": True, "goal": "g"}, "unlisted_internal_key": "also secret"},
        "section_logs": [{"id": "l1", "note": "hi", "some_internal_admin_flag": "secret"}],
    }
    safe = server._client_safe_homework(raw)
    assert "some_future_trainer_grading_field" not in safe
    assert safe["template_snapshot"]["practice_coach"]["goal"] == "g"
    assert "unlisted_internal_key" not in safe["template_snapshot"]
    assert "some_internal_admin_flag" not in safe["section_logs"][0]
    assert safe["section_logs"][0]["note"] == "hi"


def test_list_homework_and_get_detail_apply_client_safe_filter_for_clients_not_admins():
    with _client_and_dog() as (c, dog):
        with _template(practice_coach=MERLIN_RECIPE) as (tpl, admin):
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                run(server.db.homework.update_one({"id": hw["id"]}, {"$set": {"auto_assigned": True, "source_skill_id": "internal-trace-id"}}))
                client_user = _client_user(c["id"])
                detail = run(server.get_homework_detail(hw["id"], client_user))
                assert "auto_assigned" not in detail
                assert "source_skill_id" not in detail
                assert detail["template_snapshot"]["practice_coach"]["goal"] == MERLIN_RECIPE["goal"]

                listed = run(server.list_homework(client_user, None))
                assert "auto_assigned" not in listed[0]

                admin_detail = run(server.get_homework_detail(hw["id"], admin))
                assert admin_detail["auto_assigned"] is True
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


# ---------------------------------------------------------------------------
# section-log — difficulty / could_not_complete / photo
# ---------------------------------------------------------------------------

def test_section_log_now_accepts_difficulty_could_not_complete_and_photo():
    with _client_and_dog() as (c, dog):
        with _template(practice_coach=MERLIN_RECIPE, sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}]) as (tpl, admin):
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                client_user = _client_user(c["id"])
                result = run(server.log_section(hw["id"], server.SectionLogIn(
                    section_id="practice", difficulty="hard", could_not_complete=True,
                    could_not_complete_reason="Too many distractions", photo="data:image/png;base64,xyz",
                ), client_user))
                log = result["section_logs"][-1]
                assert log["field_values"]["__difficulty"] == "hard"
                assert log["field_values"]["__could_not_complete"] is True
                assert log["field_values"]["__could_not_complete_reason"] == "Too many distractions"
                assert log["field_values"]["__photo"] == "data:image/png;base64,xyz"
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


def test_section_log_omits_difficulty_keys_when_not_provided_backward_compat():
    with _client_and_dog() as (c, dog):
        with _template(sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}]) as (tpl, admin):
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                client_user = _client_user(c["id"])
                result = run(server.log_section(hw["id"], server.SectionLogIn(section_id="practice", note="just a note"), client_user))
                log = result["section_logs"][-1]
                assert "__difficulty" not in log["field_values"]
                assert "__could_not_complete" not in log["field_values"]
                assert "__photo" not in log["field_values"]
                assert log["note"] == "just a note"
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


# ---------------------------------------------------------------------------
# Section-scoped ask/answer — same question shape as daily-tracker
# ---------------------------------------------------------------------------

def test_section_scoped_ask_creates_a_placeholder_log_with_the_shared_question_shape():
    with _client_and_dog() as (c, dog):
        with _template(sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}]) as (tpl, admin):
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                client_user = _client_user(c["id"])
                result = run(server.ask_section_question(hw["id"], "practice", server.DayQuestionIn(text="What if he barks?"), client_user))
                log = result["section_logs"][-1]
                q = log["questions"][0]
                assert set(q.keys()) == {"id", "text", "asked_at", "asked_by", "asked_by_role", "answer", "answered_at", "answered_by"}
                assert q["text"] == "What if he barks?"
                assert q["answer"] == ""
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


def test_section_scoped_answer_matches_day_tracker_semantics():
    with _client_and_dog() as (c, dog):
        with _template(sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}]) as (tpl, admin):
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                client_user = _client_user(c["id"])
                asked = run(server.ask_section_question(hw["id"], "practice", server.DayQuestionIn(text="Help?"), client_user))
                log_id = asked["section_logs"][-1]["id"]
                question_id = asked["section_logs"][-1]["questions"][0]["id"]
                answered = run(server.answer_section_question(hw["id"], log_id, question_id, server.DayAnswerIn(text="Try a quieter room."), admin))
                log = next(lg for lg in answered["section_logs"] if lg["id"] == log_id)
                q = log["questions"][0]
                assert q["answer"] == "Try a quieter room."
                assert q["answered_by"] == admin["name"]
                assert q["answered_at"] is not None
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))


def test_section_scoped_ask_enforces_ownership_like_day_tracker():
    with _client_and_dog() as (c, dog):
        with _client_and_dog() as (other_client, other_dog):
            with _template(sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}]) as (tpl, admin):
                hw = run(server.create_homework_from_template(
                    server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
                ))
                try:
                    intruder = _client_user(other_client["id"])
                    try:
                        run(server.ask_section_question(hw["id"], "practice", server.DayQuestionIn(text="hi"), intruder))
                        assert False, "expected 403"
                    except server.HTTPException as exc:
                        assert exc.status_code == 403
                finally:
                    run(server.db.homework.delete_one({"id": hw["id"]}))


def test_section_scoped_ask_rejects_daily_tracker_homework():
    with _client_and_dog() as (c, dog):
        with _template(sections=[{"id": "day-1", "day_number": 1, "title": "Day 1", "instructions": "", "fields": []}]) as (tpl, admin):
            # HomeworkTemplateIn has no daily_tracker field (only the ad hoc
            # /homework/daily-tracker "save as template" path sets it) — set
            # it directly to exercise this specific rejection branch.
            run(server.db.homework_templates.update_one({"id": tpl["id"]}, {"$set": {"daily_tracker": True}}))
            hw = run(server.create_homework_from_template(
                server.HomeworkFromTemplateIn(dog_id=dog["id"], template_id=tpl["id"]), admin,
            ))
            try:
                client_user = _client_user(c["id"])
                try:
                    run(server.ask_section_question(hw["id"], "day-1", server.DayQuestionIn(text="hi"), client_user))
                    assert False, "expected 400"
                except server.HTTPException as exc:
                    assert exc.status_code == 400
            finally:
                run(server.db.homework.delete_one({"id": hw["id"]}))
