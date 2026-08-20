"""Practice video persistence (section-log path) + the formal Practice
Review system (School HQ → Reviews → Practice).

Covers: the general practice-video upload route, SectionLogIn.video_media_id
validation (never trust a browser media id), the __video_id storage
convention + single PRACTICE_VIDEO_SUBMITTED event, the pending queue and
its manage_school authorization, all three review statuses, review ≠
progression, question-notification independence, and client-notification
idempotency.

Same conventions as test_online_school_checkpoints.py / test_module_quiz.py.
"""
import base64
import contextlib
import uuid

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
import _school_client_flow
from _test_loop import run

TAG = "TEST_PRACTICE_REVIEWS"

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


def _insert_staff(staff_role, role="employee"):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}",
        "role": role, "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, email, role, 0)
    return uid, {"Authorization": f"Bearer {token}"}


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }))
    dog = run(server.db.dogs.find_one({"id": did}, {"_id": 0}))
    try:
        yield c, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@contextlib.contextmanager
def _homework_template():
    admin = _admin_user()
    tpl = run(server.create_homework_template(server.HomeworkTemplateIn(
        name=f"{TAG} Template {uuid.uuid4().hex[:6]}",
        sections=[{"id": "practice", "title": "Practice", "instructions": "", "fields": []}],
    ), admin))
    try:
        yield tpl, admin
    finally:
        run(server.db.homework_templates.delete_one({"id": tpl["id"]}))


@contextlib.contextmanager
def _school_program():
    admin = _admin_user()
    with _homework_template() as (tpl, _):
        modules = [server.ModuleIn(name="Module 1", order=0, goals=[server.GoalIn(name="Skill A")])]
        prog = run(server.create_program(server.ProgramIn(
            name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
            format={"count": 1, "unit": "modules"}, price=0, delivery_mode="self_guided", modules=modules,
        ), admin))
        m = prog["modules"][0]
        fixed = server.ProgramIn(
            name=prog["name"], type="private_lessons", format=prog["format"], price=0,
            delivery_mode="self_guided",
            modules=[server.ModuleIn(
                id=m["id"], name=m["name"], order=0,
                goals=[server.GoalIn(**g) for g in m["goals"]],
                lessons=[server.LessonIn(
                    name="Lesson 1.1", order=0, active=True, skill_ids=[m["goals"][0]["id"]],
                    client_overview="Overview", suggested_homework_template_ids=[tpl["id"]],
                )],
            )],
        )
        prog = run(server.update_program(prog["id"], fixed, cascade=False, save_as_draft=False, _=admin))
        try:
            yield prog, admin
        finally:
            run(server.db.programs.delete_one({"id": prog["id"]}))


def _cleanup_school(school_id, enrollment_id):
    run(server.db.school_quiz_attempts.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_events.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_notifications.delete_many({"school_enrollment_id": school_id}))
    run(server.db.school_enrollments.delete_one({"id": school_id}))
    run(server.db.dog_programs.delete_one({"id": enrollment_id}))
    run(server.db.homework.delete_many({"assigned_by": {"$regex": "^Online School"}}))


@contextlib.contextmanager
def _enrolled_practice():
    """School enrollment with practice started — yields everything a Practice
    Review test needs: (se, enr, client_user, admin, homework_id)."""
    with _school_program() as (prog, admin):
        with _client_and_dog() as (c, dog):
            res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            se, enr = res["school_enrollment"], res["enrollment"]
            cu = _client_user(c["id"])
            lesson_id = prog["modules"][0]["lessons"][0]["id"]
            started = run(_school_client_flow.start_practice(se["id"], lesson_id, cu))
            try:
                yield se, enr, cu, admin, started["homework_id"]
            finally:
                media = run(server.db.homework_media.find({"homework_id": started["homework_id"]}, {"_id": 0}).to_list(50))
                for mrow in media:
                    server._delete_school_media_file(mrow)
                run(server.db.homework_media.delete_many({"homework_id": started["homework_id"]}))
                _cleanup_school(se["id"], enr["id"])


def _tiny_video(raw_bytes=800, mime="video/mp4"):
    return f"data:{mime};base64," + base64.b64encode(b"v" * raw_bytes).decode()


def _upload_video(homework_id, user):
    out = run(server.upload_practice_video(homework_id, server.CertificateUploadIn(photo=_tiny_video(), filename="clip.mp4"), user))
    return out["media_id"]


def _log_with_video(homework_id, user, media_id):
    hw = run(server.log_section(homework_id, server.SectionLogIn(section_id="practice", video_media_id=media_id), user))
    return hw["section_logs"][-1]


# ---------------------------------------------------------------------------
# Video persistence
# ---------------------------------------------------------------------------

def test_practice_video_uploads_and_attaches_to_section_log():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        media_id = _upload_video(hw_id, cu)
        media = run(server.db.homework_media.find_one({"id": media_id}, {"_id": 0}))
        assert media["homework_id"] == hw_id
        assert media["kind"] == "video"
        assert media.get("school_enrollment_id") == se["id"]
        assert media.get("storage_backend") == "filesystem"  # School media boundary

        log = _log_with_video(hw_id, cu, media_id)
        assert log["field_values"]["__video_id"] == media_id

        # Exactly ONE School event for this log, and it's the video event.
        evts = run(server.db.school_events.find({"dedupe_key": f"section_log:{log['id']}"}, {"_id": 0}).to_list(10))
        assert len(evts) == 1
        assert evts[0]["event_type"] == server.SchoolEvent.PRACTICE_VIDEO_SUBMITTED
        # One staff notification exists for it.
        notif = run(server.db.school_notifications.find_one(
            {"dedupe_key": f"section_log:{log['id']}:notif"}, {"_id": 0}))
        assert notif and notif["resolved_at"] is None


def test_arbitrary_or_foreign_media_id_rejected():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        # Nonexistent media id
        try:
            run(server.log_section(hw_id, server.SectionLogIn(section_id="practice", video_media_id="ghost-media"), cu))
            assert False, "expected 400"
        except server.HTTPException as exc:
            assert exc.status_code == 400
        # Media belonging to a DIFFERENT homework
        other_hw_id = str(uuid.uuid4())
        run(server.db.homework.insert_one({
            "id": other_hw_id, "client_id": cu["client_id"], "dog_id": "other-dog",
            "title": f"{TAG} other", "template_snapshot": {"sections": [{"id": "practice"}]},
        }))
        try:
            foreign_media = _upload_video(other_hw_id, cu)
            try:
                run(server.log_section(hw_id, server.SectionLogIn(section_id="practice", video_media_id=foreign_media), cu))
                assert False, "expected 400"
            except server.HTTPException as exc:
                assert exc.status_code == 400
        finally:
            run(server.db.homework_media.delete_many({"homework_id": other_hw_id}))
            run(server.db.homework.delete_one({"id": other_hw_id}))


def test_client_cannot_upload_to_another_clients_homework():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        stranger = _client_user(str(uuid.uuid4()))
        try:
            _upload_video(hw_id, stranger)
            assert False, "expected 403"
        except server.HTTPException as exc:
            assert exc.status_code == 403


# ---------------------------------------------------------------------------
# Review queue + review actions
# ---------------------------------------------------------------------------

def test_pending_queue_targets_exact_log_and_requires_manage_school():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        media_id = _upload_video(hw_id, cu)
        log = _log_with_video(hw_id, cu, media_id)

        rows = run(server.admin_school_practice_reviews_pending(100, admin))
        mine = [r for r in rows if r["log_id"] == log["id"]]
        assert len(mine) == 1
        row = mine[0]
        assert row["homework_id"] == hw_id
        assert row["has_video"] is True and row["video_media_id"] == media_id
        assert row["dog_name"] and row["client_name"]
        assert row["program_name"] and row["module_name"]
        assert "video" in row["reasons"]

        # Server-side permission gate — a staff user WITHOUT manage_school
        # gets 403 even by direct API call.
        _, headers = _insert_staff("front_desk")
        r = run(_http.get("/api/admin/school/practice-reviews/pending", headers=headers))
        assert r.status_code == 403

        # Routine log (no triggers) stays OUT of the pending queue but shows
        # in Recent Practice.
        hw2 = run(server.log_section(hw_id, server.SectionLogIn(section_id="practice"), cu))
        routine = hw2["section_logs"][-1]
        pending_ids = {r["log_id"] for r in run(server.admin_school_practice_reviews_pending(100, admin))}
        assert routine["id"] not in pending_ids
        recent_ids = {r["log_id"] for r in run(server.admin_school_practice_reviews_recent(50, admin))}
        assert routine["id"] in recent_ids


def test_looks_good_persists_resolves_and_notifies_once():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        media_id = _upload_video(hw_id, cu)
        log = _log_with_video(hw_id, cu, media_id)
        pos_before = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_module_id": 1, "current_lesson_id": 1}))

        out = run(server.admin_school_practice_review(
            hw_id, log["id"], server.PracticeReviewIn(status="looks_good", note="Great mechanics."), admin))
        saved = out["log"]
        assert saved["review_status"] == "looks_good"
        assert saved["review_note"] == "Great mechanics."
        assert saved["reviewed_at"] and saved["reviewed_by"]

        # Left the pending queue.
        pending_ids = {r["log_id"] for r in run(server.admin_school_practice_reviews_pending(100, admin))}
        assert log["id"] not in pending_ids
        # The per-log staff notification is resolved.
        notif = run(server.db.school_notifications.find_one({"dedupe_key": f"section_log:{log['id']}:notif"}, {"_id": 0}))
        assert notif and notif["resolved_at"] is not None
        # Course progression untouched.
        pos_after = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_module_id": 1, "current_lesson_id": 1}))
        assert pos_after == pos_before

        # Client notification exists exactly once — and re-reviewing (retry)
        # does not create a second copy.
        run(server.admin_school_practice_review(
            hw_id, log["id"], server.PracticeReviewIn(status="looks_good", note="Great mechanics."), admin))
        n = run(server.db.school_notifications.count_documents({"dedupe_key": f"client_practice_review:{log['id']}"}))
        assert n == 1


def test_keep_practicing_and_trainer_attention_semantics():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        media_id = _upload_video(hw_id, cu)
        log = _log_with_video(hw_id, cu, media_id)
        out = run(server.admin_school_practice_review(
            hw_id, log["id"], server.PracticeReviewIn(status="keep_practicing", note="Reward sooner."), admin))
        assert out["log"]["review_status"] == "keep_practicing"

        # Second log flagged trainer_attention → creates a staff follow-up
        # notification (but never a Trainer Assist case or a booking).
        hw2 = run(server.log_section(hw_id, server.SectionLogIn(
            section_id="practice", difficulty="very_hard"), cu))
        log2 = hw2["section_logs"][-1]
        assists_before = run(server.db.checkpoint_submissions.count_documents({"outcome": "trainer_assist_recommended"}))
        bookings_before = run(server.db.bookings.count_documents({}))
        run(server.admin_school_practice_review(
            hw_id, log2["id"], server.PracticeReviewIn(status="trainer_attention", note="Watch this closely."), admin))
        follow_up = run(server.db.school_notifications.find_one(
            {"dedupe_key": f"practice_attention:{log2['id']}:notif"}, {"_id": 0}))
        assert follow_up and follow_up["resolved_at"] is None
        assert run(server.db.checkpoint_submissions.count_documents({"outcome": "trainer_assist_recommended"})) == assists_before
        assert run(server.db.bookings.count_documents({})) == bookings_before


def test_review_never_resolves_question_notification():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        media_id = _upload_video(hw_id, cu)
        log = _log_with_video(hw_id, cu, media_id)
        # Client asks a question on this homework's practice section (the ask
        # endpoint holds it on a placeholder section log).
        run(server.ask_section_question(hw_id, "practice", server.DayQuestionIn(text="Is his leash too short?"), cu))
        hw = run(server.db.homework.find_one({"id": hw_id}, {"_id": 0}))
        qid = next(q["id"] for l in hw["section_logs"] for q in (l.get("questions") or []))
        qnotif_before = run(server.db.school_notifications.find_one({"dedupe_key": f"question:{qid}:notif"}, {"_id": 0}))
        assert qnotif_before and qnotif_before["resolved_at"] is None

        run(server.admin_school_practice_review(
            hw_id, log["id"], server.PracticeReviewIn(status="looks_good", note="Video looks fine."), admin))
        qnotif_after = run(server.db.school_notifications.find_one({"dedupe_key": f"question:{qid}:notif"}, {"_id": 0}))
        assert qnotif_after["resolved_at"] is None, "watching the video must not resolve the question"


def test_client_sees_review_in_support_payload_and_safe_homework():
    with _enrolled_practice() as (se, enr, cu, admin, hw_id):
        media_id = _upload_video(hw_id, cu)
        log = _log_with_video(hw_id, cu, media_id)
        run(server.admin_school_practice_review(
            hw_id, log["id"], server.PracticeReviewIn(status="keep_practicing", note="Shorter sessions."), admin))

        support = run(server._school_support_payload(se["id"], cu))
        reviews = support.get("practice_reviews") or []
        mine = [r for r in reviews if r["id"] == log["id"]]
        assert len(mine) == 1
        assert mine[0]["review_status"] == "keep_practicing"
        assert mine[0]["review_note"] == "Shorter sessions."
        assert mine[0]["trainer_name"]
        # No internal staff ids leak.
        assert "reviewed_by_id" not in str(mine[0])

        # Client-safe homework carries the review fields for the log.
        hw = run(server.db.homework.find_one({"id": hw_id}, {"_id": 0}))
        safe = server._client_safe_homework(hw)
        safe_log = next(l for l in safe["section_logs"] if l["id"] == log["id"])
        assert safe_log["review_status"] == "keep_practicing"
        assert "reviewed_by_id" not in safe_log

        # HQ summary counts the consolidated reviews number.
        summary = run(server.admin_school_hq_summary(_admin_user()))
        assert "practice_reviews_pending" in summary and "reviews_pending" in summary
        assert summary["reviews_pending"] == summary["practice_reviews_pending"] + summary["checkpoints_pending"]
