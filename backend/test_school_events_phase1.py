"""Online School — Phase 1 (School Event/Notification spine) backend coverage.

Proves the Phase-1 success scenarios A–G against the real endpoints + spine on
the disposable test DB:

  A  Student question      → 1 event, 1 attention notification, 1 queued email,
                             appears in Needs Attention, deep-links to context.
  B  Checkpoint submitted  → attention notification + queued email + the HQ
                             summary's checkpoints_pending increments.
  C  Could-not-complete    → attention event + notification.
  D  Routine completion    → activity event only, NO attention notification.
  E  Read / resolve        → lifecycle persists; attention count updates.
  F  Idempotency (retry)   → same dedupe_key never double-notifies/emails.
  G  Permissions           → owner 200; unauthorized employee 403; client 403.

Same harness convention as test_online_school_phase1.py: `_test_env` (disposable
DB, dropped clean on import) before `import server`, in-process ASGI for the
permission gate, direct endpoint calls for logic.
"""
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
import _school_client_flow
from _test_loop import run

se = server.school_events
ET = server.SchoolEvent

# Reuse Phase-4's real enroll → submit-checkpoint → grade flow so the checkpoint
# and Trainer-Assist scenarios are driven through the ACTUAL endpoints, not a
# hand-built emit. Importing the module runs its (cached) _test_env/server
# imports once and just gives us the helper functions.
from test_online_school_phase4 import (  # noqa: E402
    _school_program as _p4_program,
    _client_and_dog as _p4_client_and_dog,
    _enroll as _p4_enroll,
    _submit_checkpoint_for_current_lesson as _p4_submit_checkpoint,
    _grade as _p4_grade,
    _client_user as _p4_client_user,
    _cleanup_school as _p4_cleanup,
)

# Force the admin-email path on so the email-outbox queue is exercised (the
# test .env has no ADMIN_NOTIFICATION_EMAIL). The queue write is Mongo-only.
server.email_service.ADMIN_NOTIFICATION_EMAIL = "school-hq@test.invalid"

# Mirror the two unique dedupe indexes startup() creates — they are what make
# retries idempotent (DuplicateKeyError → skip). Without them Scenario F can't
# be enforced.
run(server.db.school_events.create_index(
    "dedupe_key", name=se.EVENT_DEDUPE_INDEX, unique=True,
    partialFilterExpression={"dedupe_key": {"$type": "string"}}))
run(server.db.school_notifications.create_index(
    "dedupe_key", name=se.NOTIF_DEDUPE_INDEX, unique=True,
    partialFilterExpression={"dedupe_key": {"$type": "string"}}))

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


# ── fixtures ────────────────────────────────────────────────────────────────
def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Melissa"}


def _make_school_homework(*, daily_tracker=False):
    """A school practice homework owned by a client.

    source_lesson_id alone no longer marks School ownership (trainer-led
    completion shares that field); the assigned_by "Online School" marker is
    the explicit ownership signal _is_school_homework requires.
    """
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    hwid = str(uuid.uuid4())
    section = {"id": "drill", "title": "Practice log",
               "fields": [{"id": "reps", "kind": "reps", "label": "reps"}]}
    hw = {
        "id": hwid, "dog_id": did, "dog_name": "Bolt",
        "client_id": cid, "client_name": "Melissa",
        "title": "Week 1 Engagement Reps",
        "template_snapshot": {"sections": [section]},
        "section_logs": [], "source_lesson_id": "lesson-1",
        "assigned_by": "Online School",
        "status": "assigned", "daily_tracker": daily_tracker,
        "created_at": server.now_iso(),
    }
    run(server.db.homework.insert_one(dict(hw)))
    return hw, cid, did


def _events_for(hw, event_type=None):
    q = {"homework_id": hw["id"]}
    if event_type:
        q["event_type"] = event_type
    return run(server.db.school_events.find(q, {"_id": 0}).to_list(50))


def _notifs_for(hw):
    return run(server.db.school_notifications.find({"homework_id": hw["id"]}, {"_id": 0}).to_list(50))


# ── Scenario A — student question ───────────────────────────────────────────
def test_scenario_a_student_question_creates_event_notification_email():
    hw, cid, _ = _make_school_homework()
    user = _client_user(cid)
    run(server.ask_section_question(hw["id"], "drill", server.DayQuestionIn(text="How do I get Bolt to focus?"), user))

    events = _events_for(hw, ET.PRACTICE_QUESTION_ASKED)
    assert len(events) == 1, events
    ev = events[0]
    # deep-link identifies client/dog/course-context so the alert isn't a dead end
    assert ev["client_id"] == cid and ev["dog_name"] == "Bolt"
    assert ev["deep_link"].get("screen") == "school_hq"
    assert ev["metadata"].get("question_id")
    assert ev["requires_attention"] is True and ev["priority"] == se.Priority.HIGH
    _assert_deep_link(ev)

    notifs = _notifs_for(hw)
    q_notifs = [n for n in notifs if n["notification_type"] == ET.PRACTICE_QUESTION_ASKED]
    assert len(q_notifs) == 1
    assert q_notifs[0]["resolved_at"] is None and q_notifs[0]["email_status"] == "queued"
    assert q_notifs[0]["metadata"].get("question_id") == ev["metadata"].get("question_id")
    assert q_notifs[0]["deep_link"].get("question_id") == ev["metadata"].get("question_id")

    # email queued through the outbox (idempotent key)
    n_email = run(server.db.email_outbox.count_documents(
        {"key": f"school_notif:{q_notifs[0]['dedupe_key']}"}))
    assert n_email == 1

    # appears in Needs Attention, newest/priority queue
    na = run(server.admin_school_hq_needs_attention(sort="priority"))
    assert any(n["id"] == q_notifs[0]["id"] for n in na["items"])


# ── Scenario C — could not complete ─────────────────────────────────────────
def test_scenario_c_could_not_complete_alerts():
    hw, cid, _ = _make_school_homework()
    user = _client_user(cid)
    body = server.SectionLogIn(section_id="drill", field_values={}, note="",
                               could_not_complete=True,
                               could_not_complete_reason="Bolt wouldn't settle today")
    run(server.log_section(hw["id"], body, user))

    events = _events_for(hw, ET.PRACTICE_COULD_NOT_COMPLETE)
    assert len(events) == 1
    assert events[0]["requires_attention"] is True
    assert "wouldn't settle" in (events[0]["summary"] or "")
    _assert_deep_link(events[0])

    notifs = [n for n in _notifs_for(hw) if n["notification_type"] == ET.PRACTICE_COULD_NOT_COMPLETE]
    assert len(notifs) == 1 and notifs[0]["resolved_at"] is None


# ── Scenario D — routine completion is activity-only ────────────────────────
def test_scenario_d_routine_completion_is_activity_only():
    hw, cid, _ = _make_school_homework()
    user = _client_user(cid)
    body = server.SectionLogIn(section_id="drill", field_values={"reps": 9}, note="Great session")
    run(server.log_section(hw["id"], body, user))

    events = _events_for(hw, ET.PRACTICE_COMPLETED)
    assert len(events) == 1
    assert events[0]["requires_attention"] is False and events[0]["priority"] == se.Priority.INFO
    # NO attention notification for a routine completion
    assert _notifs_for(hw) == []
    # but it IS in the activity feed
    feed = run(server.admin_school_hq_activity())
    assert any(e["id"] == events[0]["id"] for e in feed["items"])


# ── Scenario B — checkpoint (spine + summary count) ─────────────────────────
def test_scenario_b_checkpoint_notification_and_pending_count():
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    sub_id = str(uuid.uuid4())
    # A real pending checkpoint submission — the HQ summary counts these.
    run(server.db.checkpoint_submissions.insert_one({
        "id": sub_id, "school_enrollment_id": str(uuid.uuid4()), "enrollment_id": str(uuid.uuid4()),
        "dog_id": did, "client_id": cid, "lesson_id": "lesson-1", "lesson_name": "Recall",
        "status": "pending", "submitted_at": server.now_iso(),
    }))
    # The exact emission the checkpoint endpoint performs.
    run(se.emit_event(
        ET.CHECKPOINT_SUBMITTED, actor_type="client", actor_id=str(uuid.uuid4()),
        client_id=cid, client_name="Melissa", dog_id=did, dog_name="Bolt",
        checkpoint_id=sub_id, lesson_id="lesson-1", lesson_name="Recall",
        title="Melissa · Bolt submitted a checkpoint",
        summary="Checkpoint for “Recall” is awaiting review.",
        deep_link={"screen": "school_hq", "tab": "checkpoints", "checkpoint_id": sub_id},
        dedupe_key=f"checkpoint_submitted:{sub_id}",
    ))
    notif = run(server.db.school_notifications.find_one(
        {"checkpoint_id": sub_id}, {"_id": 0}))
    assert notif and notif["notification_type"] == ET.CHECKPOINT_SUBMITTED
    assert notif["email_status"] == "queued"
    assert run(server.db.email_outbox.count_documents(
        {"key": f"school_notif:{notif['dedupe_key']}"})) == 1

    summary = run(server.admin_school_hq_summary())
    assert summary["checkpoints_pending"] >= 1


# ── Scenario E — read / resolve lifecycle persists ──────────────────────────
def test_scenario_e_read_resolve_lifecycle():
    hw, cid, _ = _make_school_homework()
    run(server.ask_section_question(hw["id"], "drill", server.DayQuestionIn(text="Question?"), _client_user(cid)))
    notif = _notifs_for(hw)[0]
    before = run(se.attention_count())

    read = run(se.mark_notification_read(notif["id"]))
    assert read["read_at"] is not None
    # reading does NOT resolve — still counts toward attention
    assert run(se.attention_count()) == before

    resolved = run(se.resolve_notification(notif["id"], by="trainer-1"))
    assert resolved["resolved_at"] is not None and resolved["resolved_by"] == "trainer-1"
    assert run(se.attention_count()) == before - 1

    # persists across a fresh read (simulates refresh / relogin)
    fresh = run(server.db.school_notifications.find_one({"id": notif["id"]}, {"_id": 0}))
    assert fresh["resolved_at"] is not None and fresh["read_at"] is not None


# ── Scenario F — idempotency: same dedupe_key never double-fires ────────────
def test_scenario_f_idempotent_retry():
    key = f"idem-test:{uuid.uuid4()}"
    kwargs = dict(
        actor_type="client", client_id=str(uuid.uuid4()), client_name="Melissa",
        dog_name="Bolt", homework_id=str(uuid.uuid4()),
        title="Melissa · Bolt asked a question", summary="dup?",
        deep_link={"screen": "school_hq"}, dedupe_key=key,
    )
    first = run(se.emit_event(ET.PRACTICE_QUESTION_ASKED, **kwargs))
    second = run(se.emit_event(ET.PRACTICE_QUESTION_ASKED, **kwargs))
    assert first is not None and second is not None
    assert first["id"] == second["id"]  # retry reconciles delivery, never creates a second event

    assert run(server.db.school_events.count_documents({"dedupe_key": key})) == 1
    assert run(server.db.school_notifications.count_documents({"dedupe_key": f"{key}:notif"})) == 1
    assert run(server.db.email_outbox.count_documents({"key": f"school_notif:{key}:notif"})) == 1


def test_scenario_f_retry_repairs_partial_notification_delivery():
    key = f"idem-repair:{uuid.uuid4()}"
    kwargs = dict(
        actor_type="client", client_id=str(uuid.uuid4()), client_name="Melissa", dog_name="Bolt",
        homework_id=str(uuid.uuid4()), title="Melissa · Bolt asked a question", summary="repair?",
        deep_link={"screen": "homework", "homework_id": "hw-repair"}, dedupe_key=key,
    )
    first = run(se.emit_event(ET.PRACTICE_QUESTION_ASKED, **kwargs))
    assert first is not None
    # Simulate a crash/failure after the event was durable but before delivery
    # remained durable. Retrying the SAME business request must reconstruct the
    # idempotent notification + email without duplicating the event.
    run(server.db.school_notifications.delete_many({"dedupe_key": f"{key}:notif"}))
    run(server.db.email_outbox.delete_many({"key": f"school_notif:{key}:notif"}))
    again = run(se.emit_event(ET.PRACTICE_QUESTION_ASKED, **kwargs))
    assert again and again["id"] == first["id"]
    assert run(server.db.school_events.count_documents({"dedupe_key": key})) == 1
    assert run(server.db.school_notifications.count_documents({"dedupe_key": f"{key}:notif"})) == 1
    assert run(server.db.email_outbox.count_documents({"key": f"school_notif:{key}:notif"})) == 1


# ── Scenario G — server-side permission enforcement ─────────────────────────
def _token_for(role, staff_role=None):
    uid = str(uuid.uuid4())
    email = f"sce-{role}-{uuid.uuid4().hex[:6]}@example.invalid"
    doc = {"id": uid, "email": email, "name": f"SCE {role}", "role": role,
           "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False}
    if staff_role:
        doc["staff_role"] = staff_role
    if role == "client":
        cid = str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": "SCE client"}))
        doc["client_id"] = cid
    run(server.db.users.insert_one(doc))
    token = server.create_access_token(uid, email, role, 0)
    return {"Authorization": f"Bearer {token}"}


DEEP_LINK_EXPECTED = {
    # event_type: (required top-level id fields, required deep_link keys)
    ET.PRACTICE_QUESTION_ASKED:     (["client_id", "dog_id", "homework_id", "lesson_id"], ["screen", "homework_id"]),
    ET.CHECKPOINT_SUBMITTED:        (["client_id", "dog_id", "checkpoint_id", "lesson_id"], ["screen", "tab", "checkpoint_id"]),
    ET.PRACTICE_COULD_NOT_COMPLETE: (["client_id", "dog_id", "homework_id", "lesson_id"], ["screen", "homework_id"]),
    ET.PRACTICE_VIDEO_SUBMITTED:    (["client_id", "dog_id", "homework_id"], ["screen", "homework_id", "video_media_id"]),
    ET.TRAINER_ASSIST_REQUESTED:    (["client_id", "dog_id", "checkpoint_id", "trainer_assist_id"], ["screen", "tab", "trainer_assist_id"]),
}


def _assert_deep_link(ev):
    """Every attention event must carry enough structured IDs + deep-link keys
    for the UI to open the exact record without guessing (Phase-1 gap #4)."""
    ids, dl_keys = DEEP_LINK_EXPECTED[ev["event_type"]]
    for f in ids:
        assert ev.get(f), f"{ev['event_type']} missing id field {f}: {ev}"
    for k in dl_keys:
        assert ev.get("deep_link", {}).get(k) is not None, f"{ev['event_type']} deep_link missing {k}: {ev['deep_link']}"


# ── Practice video requiring trainer review (real submit_day) ────────────────
def test_scenario_video_submission_requires_review():
    import base64
    admin = {"id": str(uuid.uuid4()), "role": "admin", "name": "SCE admin"}
    c = run(server.create_client(server.ClientIn(
        name=f"SCE Vid {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com"), admin))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": "Rex", "owner_id": c["id"], "breed": "Mix",
                                   "age_y": 2, "vaccines": {"rabies": "2030-01-01"}}))
    hw = run(server.create_daily_tracker(server.DailyTrackerCreateIn(
        dog_id=did, title="Week 1 Focus",
        days=[server.DailyTrackerSectionIn(day_number=1, day_focus="Name game", fields=[])]), admin))
    # Make it school-owned so the spine treats it as Online School practice —
    # source_lesson_id alone is deliberately no longer sufficient.
    run(server.db.homework.update_one({"id": hw["id"]}, {"$set": {"source_lesson_id": "lesson-1", "assigned_by": "Online School"}}))
    hw = run(server.db.homework.find_one({"id": hw["id"]}, {"_id": 0}))

    cu = _client_user(c["id"])
    vid = "data:video/mp4;base64," + base64.b64encode(b"x" * 3000).decode()
    up = run(server.upload_day_video(hw["id"], 1, server.CertificateUploadIn(photo=vid, filename="clip.mp4"), cu))
    media_id = up["media_id"]
    run(server.submit_day(hw["id"], 1, server.DaySubmitIn(field_values={}, video_media_id=media_id), cu))

    ev = run(server.db.school_events.find_one(
        {"event_type": ET.PRACTICE_VIDEO_SUBMITTED, "homework_id": hw["id"]}, {"_id": 0}))
    assert ev and ev["requires_attention"] is True
    assert ev["deep_link"]["video_media_id"] == media_id and ev["deep_link"]["day_number"] == 1
    assert ev["metadata"]["video_media_id"] == media_id
    _assert_deep_link(ev)

    notif = run(server.db.school_notifications.find_one(
        {"homework_id": hw["id"], "notification_type": ET.PRACTICE_VIDEO_SUBMITTED}, {"_id": 0}))
    assert notif and notif["resolved_at"] is None and notif["email_status"] == "queued"
    assert run(server.db.email_outbox.count_documents({"key": f"school_notif:{notif['dedupe_key']}"})) == 1

    # A plain metrics/photo day (no video) must NOT alert.
    hw2 = run(server.create_daily_tracker(server.DailyTrackerCreateIn(
        dog_id=did, title="Week 2 Focus",
        days=[server.DailyTrackerSectionIn(day_number=1, day_focus="Sit", fields=[])]), admin))
    run(server.db.homework.update_one({"id": hw2["id"]}, {"$set": {"source_lesson_id": "lesson-2", "assigned_by": "Online School"}}))
    hw2 = run(server.db.homework.find_one({"id": hw2["id"]}, {"_id": 0}))
    run(server.submit_day(hw2["id"], 1, server.DaySubmitIn(field_values={"reps": 5}), cu))
    assert run(server.db.school_notifications.count_documents({"homework_id": hw2["id"]})) == 0
    assert run(server.db.school_events.count_documents(
        {"homework_id": hw2["id"], "event_type": ET.PRACTICE_COMPLETED})) == 1

    for x in (hw["id"], hw2["id"]):
        run(server.db.homework.delete_one({"id": x}))
    run(server.db.homework_media.delete_one({"id": media_id}))
    run(server.db.dogs.delete_one({"id": did}))
    run(server.db.clients.delete_one({"id": c["id"]}))


# ── Checkpoint via the REAL submit endpoint (upgrades the spine-level B) ──────
def test_scenario_b_checkpoint_real_endpoint():
    with _p4_program() as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            sub_id, _hid, _did, lesson_id, _hw = _p4_submit_checkpoint(se_row, enr, cu)
            ev = run(server.db.school_events.find_one(
                {"event_type": ET.CHECKPOINT_SUBMITTED, "checkpoint_id": sub_id}, {"_id": 0}))
            assert ev and ev["lesson_id"] == lesson_id and ev["enrollment_id"] == enr["id"]
            assert ev["deep_link"]["tab"] == "checkpoints"
            _assert_deep_link(ev)
            notif = run(server.db.school_notifications.find_one(
                {"checkpoint_id": sub_id, "notification_type": ET.CHECKPOINT_SUBMITTED}, {"_id": 0}))
            assert notif and notif["resolved_at"] is None and notif["email_status"] == "queued"
            assert run(server.db.email_outbox.count_documents(
                {"key": f"school_notif:{notif['dedupe_key']}"})) == 1
            assert run(server.admin_school_hq_summary())["checkpoints_pending"] >= 1
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


# ── Trainer Assist request via the REAL grade endpoint ───────────────────────
def test_scenario_trainer_assist_requested_real_grade():
    with _p4_program() as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            sub_id, hid, did, _lesson, _hw = _p4_submit_checkpoint(se_row, enr, cu)
            _p4_grade(sub_id, admin, "trainer_assist_recommended", hid, did)

            ev = run(server.db.school_events.find_one(
                {"event_type": ET.TRAINER_ASSIST_REQUESTED, "checkpoint_id": sub_id}, {"_id": 0}))
            assert ev and ev["requires_attention"] is True
            assert ev["trainer_assist_id"] == sub_id and ev["deep_link"]["tab"] == "trainer_assist"
            _assert_deep_link(ev)
            notif = run(server.db.school_notifications.find_one(
                {"trainer_assist_id": sub_id, "notification_type": ET.TRAINER_ASSIST_REQUESTED}, {"_id": 0}))
            assert notif and notif["resolved_at"] is None and notif["email_status"] == "queued"

            # Idempotent: re-grading (resume) never double-emits.
            _p4_grade(sub_id, admin, "trainer_assist_recommended", hid, did)
            assert run(server.db.school_events.count_documents(
                {"event_type": ET.TRAINER_ASSIST_REQUESTED, "checkpoint_id": sub_id})) == 1
            assert run(server.db.school_notifications.count_documents(
                {"trainer_assist_id": sub_id, "notification_type": ET.TRAINER_ASSIST_REQUESTED})) == 1
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


# ── Inactivity: new post-deploy enrollment can become inactive; legacy can't ─
def test_scenario_inactive_new_vs_legacy_enrollment():
    from datetime import datetime, timezone, timedelta
    base = run(server.admin_school_hq_summary())["inactive_students"]

    def _active_enrollment(cid):
        run(server.db.school_enrollments.insert_one(
            {"id": str(uuid.uuid4()), "client_id": cid, "dog_id": str(uuid.uuid4()),
             "enrollment_id": str(uuid.uuid4()), "status": "active"}))

    def _event(cid, when, etype):
        run(server.db.school_events.insert_one({
            "id": str(uuid.uuid4()), "event_type": etype, "client_id": cid,
            "created_at": when, "requires_attention": False, "priority": "info", "dedupe_key": None}))

    old = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
    now = datetime.now(timezone.utc).isoformat()

    # NEW enrollment that enrolled 20d ago and never trained → INACTIVE (+1)
    new_cid = str(uuid.uuid4()); _active_enrollment(new_cid); _event(new_cid, old, ET.SCHOOL_ENROLLED)
    # LEGACY enrollment, NO events (predates spine) → NOT counted (+0)
    legacy_cid = str(uuid.uuid4()); _active_enrollment(legacy_cid)
    # RECENT student, event today → NOT inactive (+0)
    recent_cid = str(uuid.uuid4()); _active_enrollment(recent_cid); _event(recent_cid, now, ET.LESSON_STARTED)

    after = run(server.admin_school_hq_summary())["inactive_students"]
    assert after - base == 1, f"expected exactly the new-never-started enrollment to become inactive (delta {after - base})"

    for cid in (new_cid, legacy_cid, recent_cid):
        run(server.db.school_enrollments.delete_many({"client_id": cid}))
        run(server.db.school_events.delete_many({"client_id": cid}))


# ── Lesson completion is activity-only (real advance endpoint) ──────────────
def test_scenario_lesson_completed_is_activity_only():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), \
            _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            lesson_id = run(server.db.dog_programs.find_one(
                {"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
            started = run(_school_client_flow.start_practice(se_row["id"], lesson_id, cu))
            run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
            run(server.portal_school_advance(se_row["id"], cu))

            ev = run(server.db.school_events.find_one(
                {"event_type": ET.LESSON_COMPLETED, "lesson_id": lesson_id, "enrollment_id": enr["id"]}, {"_id": 0}))
            assert ev and ev["requires_attention"] is False and ev["priority"] == se.Priority.INFO
            assert run(server.db.school_notifications.count_documents({"event_id": ev["id"]})) == 0
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


# ── Robustness: a malformed/legacy checkpoint row can't 500 the queue ───────
def test_malformed_checkpoint_does_not_break_pending_queue():
    admin = {"id": str(uuid.uuid4()), "role": "admin", "name": "SCE admin"}
    valid_id, malformed_id = str(uuid.uuid4()), str(uuid.uuid4())
    cid, did = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": "Valid Client"}))
    run(server.db.dogs.insert_one({"id": did, "name": "ValidDog"}))
    # A complete, valid pending checkpoint.
    run(server.db.checkpoint_submissions.insert_one({
        "id": valid_id, "school_enrollment_id": str(uuid.uuid4()), "enrollment_id": str(uuid.uuid4()),
        "dog_id": did, "client_id": cid, "lesson_id": "l1", "lesson_name": "Recall",
        "status": "pending", "submitted_at": server.now_iso(),
    }))
    # A malformed/legacy pending checkpoint MISSING school_enrollment_id (the
    # exact field that previously caused the KeyError 500), plus dog_id/client_id.
    # lesson_id is set only so this row doesn't collide with the id-less row on
    # the (school_enrollment_id, lesson_id) partial-unique index — it's the
    # missing school_enrollment_id that reproduces the original crash.
    run(server.db.checkpoint_submissions.insert_one({
        "id": malformed_id, "status": "pending", "submitted_at": server.now_iso(),
        "lesson_id": "sce-mal-lesson",
    }))
    # A row with no id at all — un-actionable, must be skipped (not crash).
    run(server.db.checkpoint_submissions.insert_one({
        "status": "pending", "submitted_at": server.now_iso(),
        "lesson_id": "sce-noid-lesson", "_sce_noid": True,
    }))
    try:
        out = run(server.admin_school_checkpoints_pending(admin))  # must NOT raise
        ids = {x["id"] for x in out}
        assert valid_id in ids, "a valid checkpoint must still render normally"
        # The malformed-but-identifiable row is surfaced with what exists;
        # its missing enrollment id is None (never fabricated).
        mal = next((x for x in out if x["id"] == malformed_id), None)
        assert mal is not None and mal["school_enrollment_id"] is None
        # The id-less row is skipped, and the whole queue survived.
        assert all(x.get("id") for x in out)
    finally:
        run(server.db.checkpoint_submissions.delete_many({"id": {"$in": [valid_id, malformed_id]}}))
        run(server.db.checkpoint_submissions.delete_many({"_sce_noid": True}))
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.dogs.delete_one({"id": did}))


def test_scenario_g_permissions_enforced_server_side():
    owner_h = _token_for("admin")                       # true owner
    fd_h = _token_for("employee", "front_desk")         # no manage_school
    client_h = _token_for("client")

    r_owner = run(_http.get("/api/admin/school/hq/summary", headers=owner_h))
    assert r_owner.status_code == 200, r_owner.text

    r_fd = run(_http.get("/api/admin/school/hq/summary", headers=fd_h))
    assert r_fd.status_code == 403, r_fd.text

    r_client = run(_http.get("/api/admin/school/hq/attention-count", headers=client_h))
    assert r_client.status_code == 403, r_client.text
