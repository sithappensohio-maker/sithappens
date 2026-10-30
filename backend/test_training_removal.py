"""Removing training history (domains/school/removal.py).

Remove Online School takes every Online School and hybrid enrollment with all
of its history, deletes online-only courses and switches the online settings
off on programs also taught in person. Deleting a program with its history
takes the program and every enrollment in it. Money records and client
messages stay; in-person enrollments in other programs are never touched.

Online-School-off gates checked here too: no new course access, clients no
longer see or open online/hybrid courses, the contact form stops offering it.

Disposable rows carry TAG and are removed after the module. The engine is run
on this module's own ids; the all-of-Online-School removal is checked through
its target list and its endpoint guards, so other modules' rows are never removed.
"""
import uuid
from datetime import date, timedelta

import httpx
import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.school import removal

TAG = "TEST_TRAINING_REMOVAL"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
db = server.db

TAGGED = (
    "programs", "dog_programs", "school_enrollments", "checkpoint_submissions", "school_quiz_attempts",
    "school_events", "school_notifications", "school_training_plans", "school_student_notes", "school_requests",
    "school_experience_feedback_history", "homework", "homework_media", "step_events", "training_session_log",
    "training_session_drafts", "client_message_threads", "bookings", "dogs", "clients", "users", "retail_sales",
    "shop_orders", "shop_favorites", "pos_products", "email_outbox", "services", "credit_lots", "payment_plans",
)


def _gid(prefix):
    return f"{TAG}-{prefix}-{uuid.uuid4().hex[:8]}"


def teardown_module():
    for coll in TAGGED:
        run(db[coll].delete_many({"tag": TAG}))
    run(db.school_experience_feedback.delete_many({"tag": TAG}))
    run(db.deleted_records.delete_many({"record_id": {"$regex": f"^{TAG}|school-experience:{TAG}"}}))
    _flag(None)


def _flag(value):
    if value is None:
        run(db.settings.update_one({"id": "global"}, {"$unset": {"feature_visibility.online_school": ""}}))
    else:
        run(db.settings.update_one({"id": "global"}, {"$set": {"feature_visibility.online_school": value}}, upsert=True))


def _program(**extra):
    p = {"id": _gid("prog"), "name": f"{TAG} Program", "slug": _gid("slug").lower(), "active": True, "type": "private_lessons",
         "delivery_mode": "trainer_led", "purchase_fulfillment": "credits_only", "available_online": False,
         "modules": [], "prereq_slugs": [], "recommended_next_program_slugs": [], "tag": TAG, **extra}
    run(db.programs.insert_one(dict(p)))
    return p


def _family():
    cid = _gid("client")
    run(db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "tag": TAG}))
    dog = {"id": _gid("dog"), "name": "Rex", "owner_id": cid, "tag": TAG}
    run(db.dogs.insert_one(dict(dog)))
    return cid, dog


def _enroll(program, channel, *, status="active", se_mode=None, slug=None, family=None):
    """A dog_programs row and its School copy, as the grants write them."""
    cid, dog = family or _family()
    dp = {"id": _gid("dp"), "dog_id": dog["id"], "program_id": program["id"], "delivery_channel": channel,
          "status": status, "program_snapshot": {"name": program["name"], "slug": slug or program.get("slug")},
          "auto_homework_log": [], "tag": TAG}
    if channel is None:
        dp.pop("delivery_channel")
    run(db.dog_programs.insert_one(dict(dp)))
    mode = se_mode or {"online_school": "self_guided", "hybrid_school": "hybrid", "in_person_school": "trainer_led"}.get(channel)
    se = {"id": _gid("se"), "enrollment_id": dp["id"], "client_id": cid, "dog_id": dog["id"],
          "program_id": program["id"], "delivery_mode": mode, "status": status, "tag": TAG}
    run(db.school_enrollments.insert_one(dict(se)))
    run(db.dogs.update_one({"id": dog["id"]}, {"$set": {"active_program_id": dp["id"]}}))
    return dp, se, cid, dog


def _history(dp, se, cid, dog):
    """Everything an enrollment leaves behind, plus money and a conversation that must stay."""
    media_root = server.SCHOOL_MEDIA_ROOT
    video_id, hw_id, auto_hw_id, practice_media_id = _gid("vid"), _gid("hw"), _gid("autohw"), _gid("pm")
    video_path = media_root / f"{video_id}.mp4"
    video_path.write_bytes(b"checkpoint video")
    practice_path = media_root / f"{practice_media_id}.mp4"
    practice_path.write_bytes(b"practice video")
    cp_id = _gid("cp")
    link = {"school_enrollment_id": se["id"], "enrollment_id": dp["id"], "tag": TAG}
    run(db.checkpoint_submissions.insert_one({"id": cp_id, **link, "video_media_id": video_id, "homework_id": hw_id}))
    for coll in removal.ENROLLMENT_CHILDREN[1:]:
        run(db[coll].insert_one({"id": _gid(coll), **link, "dedupe_key": _gid("dk")}))
    notif_key = run(db.school_notifications.find_one({"school_enrollment_id": se["id"]}))["dedupe_key"]
    run(db.email_outbox.insert_one({"key": f"school_notif:{notif_key}", "status": "pending", "tag": TAG}))
    fb = f"school-experience:{TAG}:{dog['id']}:{dp['program_id']}"
    run(db.school_experience_feedback.insert_one({"_id": fb, **link}))
    run(db.school_experience_feedback_history.insert_one({"id": _gid("fbh"), "feedback_id": fb, "tag": TAG}))
    run(db.homework.insert_one({"id": hw_id, "school_enrollment_id": se["id"], "school_enrollment_record_id": dp["id"],
                                "dog_id": dog["id"], "client_id": cid, "tag": TAG}))
    run(db.homework.insert_one({"id": auto_hw_id, "dog_id": dog["id"], "client_id": cid, "tag": TAG}))
    run(db.dog_programs.update_one({"id": dp["id"]}, {"$push": {"auto_homework_log": {"homework_id": auto_hw_id}}}))
    run(db.homework_media.insert_one({"id": video_id, "homework_id": hw_id, "kind": "checkpoint_video",
                                      "storage_path": str(video_path), "tag": TAG}))
    run(db.homework_media.insert_one({"id": practice_media_id, "homework_id": auto_hw_id, "storage_path": str(practice_path), "tag": TAG}))
    run(db.step_events.insert_one({"id": _gid("step"), "homework_id": hw_id, "tag": TAG}))
    run(db.training_session_log.insert_one({"id": _gid("log"), "enrollment_id": dp["id"], "dog_id": dog["id"], "tag": TAG}))
    run(db.training_session_drafts.insert_one({"id": _gid("draft"), "enrollment_id": dp["id"], "tag": TAG}))
    thread = {"id": _gid("thread"), "client_id": cid, "subject": "About lesson 2", "school_enrollment_id": se["id"],
              "school_program_name": "Course", "school_lesson_name": "Sit", "school_enrollment_record_id": dp["id"], "tag": TAG}
    run(db.client_message_threads.insert_one(dict(thread)))
    booking = {"id": _gid("bk"), "dog_id": dog["id"], "date": "2020-01-02", "status": "completed",
               "trainer_assist_case_id": cp_id, "tag": TAG}
    run(db.bookings.insert_one(dict(booking)))
    sale = {"id": _gid("sale"), "source_kind": "training_program_sale", "program_id": dp["program_id"], "amount": 49.0, "tag": TAG}
    run(db.retail_sales.insert_one(dict(sale)))
    order = {"id": _gid("order"), "client_id": cid, "status": "paid", "tag": TAG,
             "lines": [{"item_id": "1", "kind": "training_program", "ref_id": dp["program_id"], "fulfillment_kind": "online_school",
                        "dog_id": dog["id"], "online_school_enrollment_id": dp["id"], "fulfillment_status": "fulfilled"}]}
    run(db.shop_orders.insert_one(dict(order)))
    return {"cp": cp_id, "hw": [hw_id, auto_hw_id], "files": [video_path, practice_path], "thread": thread["id"],
            "outbox": f"school_notif:{notif_key}",
            "booking": booking["id"], "sale": sale["id"], "order": order["id"], "feedback": fb}


def _left(dp, se, h):
    """Rows of this enrollment's history still in the database."""
    link = {"$or": [{"school_enrollment_id": se["id"]}, {"enrollment_id": dp["id"]}]}
    out = {c: run(db[c].count_documents(link)) for c in removal.ENROLLMENT_CHILDREN + removal.SESSION_CHILDREN}
    out["homework"] = run(db.homework.count_documents({"id": {"$in": h["hw"]}}))
    out["homework_media"] = run(db.homework_media.count_documents({"homework_id": {"$in": h["hw"]}}))
    out["step_events"] = run(db.step_events.count_documents({"homework_id": {"$in": h["hw"]}}))
    out["feedback"] = run(db.school_experience_feedback.count_documents({"_id": h["feedback"]}))
    out["feedback_history"] = run(db.school_experience_feedback_history.count_documents({"feedback_id": h["feedback"]}))
    out["school_enrollments"] = run(db.school_enrollments.count_documents({"id": se["id"]}))
    out["dog_programs"] = run(db.dog_programs.count_documents({"id": dp["id"]}))
    return {k: v for k, v in out.items() if v}


def _remove(dp_ids, se_ids, apply=True):
    r = removal._Run(db, apply)
    run(removal.remove_enrollments(r, dp_ids, se_ids, media_path=server._school_media_file_path))
    return r.counts


# ───────────── the remover ─────────────

def test_an_enrollment_goes_with_all_its_history_and_money_and_messages_stay():
    course = _program(delivery_mode="self_guided", purchase_fulfillment="online_school")
    dp, se, cid, dog = _enroll(course, "online_school")
    h = _history(dp, se, cid, dog)
    neighbour, neighbour_se, ncid, ndog = _enroll(course, "in_person_school")
    nh = _history(neighbour, neighbour_se, ncid, ndog)

    preview = _remove([dp["id"]], [se["id"]], apply=False)
    assert preview["files"] == 2 and preview["dog_programs"] == 1 and preview["homework"] == 2
    assert _left(dp, se, h)["dog_programs"] == 1, "a preview changes nothing"

    done = _remove([dp["id"]], [se["id"]])
    assert done == preview, "the preview counts what the removal removes"
    assert _left(dp, se, h) == {}
    assert not any(p.exists() for p in h["files"]), "uploaded videos leave the disk"
    assert run(db.email_outbox.count_documents({"key": h["outbox"]})) == 0, "its unsent School email is dropped"
    assert run(db.email_outbox.count_documents({"key": nh["outbox"]})) == 1
    assert run(db.deleted_records.count_documents({"collection": "dog_programs", "record_id": dp["id"]})) == 1, \
        "logged, so a merge restore does not bring it back"

    thread = run(db.client_message_threads.find_one({"id": h["thread"]}, {"_id": 0}))
    assert thread and thread["subject"] == "About lesson 2"
    assert not any(k.startswith("school_") for k in thread), thread
    booking = run(db.bookings.find_one({"id": h["booking"]}, {"_id": 0}))
    assert booking and "trainer_assist_case_id" not in booking
    assert run(db.retail_sales.count_documents({"id": h["sale"]})) == 1
    assert run(db.shop_orders.count_documents({"id": h["order"]})) == 1
    assert run(db.dogs.find_one({"id": dog["id"]}))["active_program_id"] is None

    assert set(_left(neighbour, neighbour_se, nh)) >= {"dog_programs", "school_enrollments", "homework", "checkpoint_submissions"}, \
        "another dog's enrollment in the same program is untouched"
    assert all(p.exists() for p in nh["files"])
    assert _remove([dp["id"]], [se["id"]]) == {}, "running it again finds nothing left"
    _remove([neighbour["id"]], [neighbour_se["id"]])


def test_remove_online_school_targets_online_and_hybrid_only():
    course = _program(delivery_mode="self_guided", purchase_fulfillment="online_school")
    online, online_se, *_ = _enroll(course, "online_school")
    hybrid, hybrid_se, *_ = _enroll(course, "hybrid_school")
    in_person, in_person_se, *_ = _enroll(course, "in_person_school")
    legacy, legacy_se, *_ = _enroll(course, None, se_mode="trainer_led")
    # A leftover online School copy with no enrollment goes; an "online" copy of an in-person enrollment does not.
    orphan = {"id": _gid("se"), "enrollment_id": _gid("gone"), "delivery_mode": "self_guided", "program_id": course["id"], "tag": TAG}
    run(db.school_enrollments.insert_one(dict(orphan)))
    bare = {"id": _gid("dp"), "dog_id": _gid("dog"), "program_id": course["id"], "delivery_channel": "in_person_school", "tag": TAG}
    run(db.dog_programs.insert_one(dict(bare)))
    mismatch = {"id": _gid("se"), "enrollment_id": bare["id"], "delivery_mode": "self_guided", "tag": TAG}
    run(db.school_enrollments.insert_one(dict(mismatch)))

    t = run(removal.online_school_targets(db))
    assert {online["id"], hybrid["id"]} <= set(t["dp_ids"])
    assert not {in_person["id"], legacy["id"]} & set(t["dp_ids"])
    assert {online_se["id"], hybrid_se["id"], orphan["id"]} <= set(t["se_ids"])
    assert not {in_person_se["id"], legacy_se["id"], mismatch["id"]} & set(t["se_ids"])
    # The course is still taught in person, so it is kept and switched to in-person only.
    assert course["id"] in {p["id"] for p in t["convert"]}
    for dp, se in ((online, online_se), (hybrid, hybrid_se), (in_person, in_person_se), (legacy, legacy_se)):
        _remove([dp["id"]], [se["id"]])
    _remove([bare["id"]], [orphan["id"], mismatch["id"]])


def test_online_courses_are_deleted_or_switched_to_in_person_only():
    only_online = _program(delivery_mode="self_guided", purchase_fulfillment="online_school", available_online=True)
    both = _program(delivery_mode="both", purchase_fulfillment="online_school", available_online=True)
    free = _program(free_enrollment_enabled=True)
    plain = _program()
    dp, se, *_ = _enroll(only_online, "online_school")
    t = run(removal.online_school_targets(db))
    deleting, converting = {p["id"] for p in t["delete"]}, {p["id"] for p in t["convert"]}
    assert only_online["id"] in deleting
    assert {both["id"], free["id"]} <= converting
    assert plain["id"] not in deleting | converting
    assert removal.online_settings_off(both) == {"purchase_fulfillment": "credits_only", "free_enrollment_enabled": False,
                                                 "delivery_mode": "trainer_led", "available_online": False,
                                                 "show_at_register": False}
    assert removal.online_settings_off(free) == {"purchase_fulfillment": "credits_only", "free_enrollment_enabled": False}
    _remove([dp["id"]], [se["id"]])


# ───────────── deleting one program with its history ─────────────

def _admin(**extra):
    u = {"id": _gid("admin"), "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Removal QA", "role": "admin",
         "active": True, "password_hash": "x", "token_version": 0, "tag": TAG, **extra}
    run(db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def test_an_in_person_program_with_students_can_be_deleted_with_its_history():
    admin = _admin()
    program = _program(name=f"{TAG} Puppy Class")
    other = _program(prereq_slugs=[program["slug"]], recommended_next_program_slugs=[program["slug"], "keep-me"],
                     shop_relationships=[{"rel": "related", "kind": "training_program", "ref_id": program["id"]}])
    dp, se, cid, dog = _enroll(program, "in_person_school", status="completed")
    legacy, legacy_se, *_ = _enroll(program, None, se_mode="trainer_led")
    h = _history(dp, se, cid, dog)
    run(db.shop_favorites.insert_one({"client_id": cid, "kind": "training_program", "ref_id": program["id"], "tag": TAG}))

    old = run(_http.delete(f"/api/programs/{program['id']}?hard=true", headers=_auth(admin)))
    assert old.status_code == 409, "the plain delete still refuses a program with history"

    preview = run(_http.get(f"/api/admin/programs/{program['id']}/delete-preview", headers=_auth(admin)))
    assert preview.status_code == 200, preview.text
    p = preview.json()
    assert (p["enrollments"], p["dogs"], p["active"], p["blockers"]) == (2, 2, 1, [])
    assert p["files"] == 2 and p["records"] > 10
    assert run(db.programs.count_documents({"id": program["id"]})) == 1

    no = run(_http.post(f"/api/admin/programs/{program['id']}/delete-with-history", headers=_auth(admin), json={}))
    assert no.status_code == 422
    res = run(_http.post(f"/api/admin/programs/{program['id']}/delete-with-history", headers=_auth(admin), json={"confirm": True}))
    assert res.status_code == 200, res.text
    assert run(db.programs.count_documents({"id": program["id"]})) == 0
    assert _left(dp, se, h) == {}
    assert run(db.dog_programs.count_documents({"id": legacy["id"]})) == 0
    assert run(db.shop_favorites.count_documents({"ref_id": program["id"]})) == 0
    o = run(db.programs.find_one({"id": other["id"]}, {"_id": 0}))
    assert o["prereq_slugs"] == [] and o["recommended_next_program_slugs"] == ["keep-me"]
    assert o["shop_relationships"] == [], "no Shop card points at the deleted program"
    assert run(db.retail_sales.count_documents({"id": h["sale"]})) == 1, "money stays"
    assert run(db.deleted_records.count_documents({"collection": "programs", "record_id": program["id"]})) == 1


def _refused(admin, program, words):
    p = run(_http.get(f"/api/admin/programs/{program['id']}/delete-preview", headers=_auth(admin))).json()
    assert any(words in b for b in p["blockers"]), p["blockers"]
    res = run(_http.post(f"/api/admin/programs/{program['id']}/delete-with-history", headers=_auth(admin), json={"confirm": True}))
    assert res.status_code == 409 and words in res.json()["detail"], res.text
    assert run(db.programs.count_documents({"id": program["id"]})) == 1
    assert run(db.dog_programs.count_documents({"program_id": program["id"]})) >= 1


def test_a_program_session_not_yet_checked_out_blocks_the_delete_even_a_past_one():
    # Its session log is the proof it was taught, and its credit is only used at checkout.
    admin = _admin()
    program = _program()
    dp, *_ = _enroll(program, "in_person_school")
    run(db.bookings.insert_one({"id": _gid("bk"), "program_id": program["id"], "dog_id": dp["dog_id"], "status": "approved",
                                "is_prepaid_program_session": True, "date": (date.today() - timedelta(days=3)).isoformat(), "tag": TAG}))
    _refused(admin, program, "Check out or cancel it on the Schedule")


def test_an_open_board_and_train_stay_blocks_the_delete():
    admin = _admin()
    program = _program()
    dp, *_ = _enroll(program, "in_person_school")
    run(db.bookings.insert_one({"id": _gid("bk"), "package_enrolled_program_id": dp["id"], "status": "approved",
                                "checked_in_at": "2026-10-28T09:00:00+00:00",
                                "date": date.today().isoformat(), "tag": TAG}))
    _refused(admin, program, "Board & Train stay still open")


def test_a_board_and_train_service_or_an_unfinished_order_blocks_the_delete():
    admin = _admin()
    program = _program()
    _enroll(program, "in_person_school")
    run(db.services.insert_one({"id": _gid("svc"), "name": f"{TAG} B&T 2 weeks", "package_program_id": program["id"], "tag": TAG}))
    _refused(admin, program, "uses it as its Board & Train program")
    run(db.services.delete_many({"tag": TAG}))
    run(db.shop_orders.insert_one({"id": _gid("order"), "status": "paid", "tag": TAG, "lines": [
        {"item_id": "1", "kind": "training_program", "ref_id": program["id"], "fulfillment_status": "failed"}]}))
    _refused(admin, program, "Finish or refund them first")


def test_money_that_stays_is_said_up_front():
    admin = _admin()
    program = _program()
    _enroll(program, "in_person_school")
    run(db.credit_lots.insert_one({"id": _gid("lot"), "client_id": "c1", "program_id": program["id"], "qty_remaining": 3, "tag": TAG}))
    run(db.payment_plans.insert_one({"id": _gid("plan"), "program_id": program["id"], "installments": [{"status": "due"}], "tag": TAG}))
    p = run(_http.get(f"/api/admin/programs/{program['id']}/delete-preview", headers=_auth(admin))).json()
    assert p["blockers"] == []
    words = " ".join(p["warnings"])
    assert "3 prepaid sessions bought for it are unused (1 family). They stay on those families' training credits." in words
    assert "1 payment plan for it still has payments due" in words
    res = run(_http.post(f"/api/admin/programs/{program['id']}/delete-with-history", headers=_auth(admin), json={"confirm": True}))
    assert res.status_code == 200
    assert run(db.credit_lots.count_documents({"program_id": program["id"]})) == 1, "the paid sessions are not touched"
    assert run(db.payment_plans.count_documents({"program_id": program["id"]})) == 1


def test_session_practice_lineage_and_the_dogs_pointer_are_handled():
    program = _program()
    other_program = _program()
    dp, se, cid, dog = _enroll(program, "in_person_school")
    log_id = _gid("log")
    run(db.training_session_log.insert_one({"id": log_id, "enrollment_id": dp["id"], "tag": TAG}))
    orphan_hw = _gid("hw")   # made by a session whose finish crashed before it was recorded on the enrollment
    run(db.homework.insert_one({"id": orphan_hw, "source_session_log_id": log_id, "tag": TAG}))
    # The same dog's other in-person course takes over the pointer; a retake elsewhere drops its link.
    other = {"id": _gid("dp"), "dog_id": dog["id"], "program_id": other_program["id"], "delivery_channel": "in_person_school",
             "status": "active", "created_at": "2020-01-01", "retake_of_enrollment_id": dp["id"],
             "legacy_history_enrollment_ids": [dp["id"], "keep"], "tag": TAG}
    run(db.dog_programs.insert_one(dict(other)))
    _remove([dp["id"]], [se["id"]])
    assert run(db.homework.count_documents({"id": orphan_hw})) == 0
    assert run(db.dogs.find_one({"id": dog["id"]}))["active_program_id"] == other["id"]
    kept = run(db.dog_programs.find_one({"id": other["id"]}, {"_id": 0}))
    assert "retake_of_enrollment_id" not in kept and kept["legacy_history_enrollment_ids"] == ["keep"]
    _remove([other["id"]], [])


def test_only_someone_who_may_delete_records_can_remove_history():
    # May edit programs, may not delete records.
    staff = _admin(role="employee", staff_role="manager",
                   permission_overrides={"manage_training_content": True, "delete_records": False})
    assert server._perms_for(staff)["manage_training_content"] and not server._perms_for(staff)["delete_records"]
    program = _program()
    res = run(_http.post(f"/api/admin/programs/{program['id']}/delete-with-history", headers=_auth(staff), json={"confirm": True}))
    assert res.status_code == 403
    assert run(db.programs.count_documents({"id": program["id"]})) == 1


def test_remove_online_school_needs_it_turned_off_first():
    admin = _admin()
    _flag(True)
    try:
        res = run(_http.post("/api/admin/online-school/removal", headers=_auth(admin), json={"confirm": True}))
        assert res.status_code == 409 and "Turn Online School off" in res.json()["detail"]
        preview = run(_http.get("/api/admin/online-school/removal", headers=_auth(admin)))
        assert preview.status_code == 200
        assert {"enrollments", "courses_to_delete", "courses_to_convert", "files", "warnings"} <= set(preview.json())
    finally:
        _flag(None)


# ───────────── Online School off: nothing new, nothing shown ─────────────

def test_with_online_school_off_no_new_course_access_or_hybrid_enrollment_is_given():
    course = _program(delivery_mode="self_guided", purchase_fulfillment="online_school")
    _, dog = _family()
    _flag(False)
    try:
        with pytest.raises(HTTPException) as e:
            run(server._grant_online_school_enrollment(dog, course, enrolled_by=None))
        assert "Online School is turned off" in e.value.detail
        with pytest.raises(HTTPException) as e:
            run(server._grant_staff_school_enrollment(dog, course, delivery_mode="hybrid", enrolled_by=None))
        assert "Assign it as In Person" in e.value.detail
    finally:
        _flag(None)


def _client_user(cid):
    u = {"id": _gid("user"), "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Client QA", "role": "client",
         "client_id": cid, "active": True, "password_hash": "x", "token_version": 0, "tag": TAG}
    run(db.users.insert_one(dict(u)))
    return u


def test_with_online_school_off_clients_no_longer_see_or_open_online_courses():
    course = _program(delivery_mode="both")
    dp, se, cid, dog = _enroll(course, "hybrid_school")
    # The same family's other dog takes the course in person: that one stays.
    other_dog = {"id": _gid("dog"), "name": "Mia", "owner_id": cid, "tag": TAG}
    run(db.dogs.insert_one(dict(other_dog)))
    in_person, in_person_se, *_ = _enroll(course, "in_person_school", family=(cid, other_dog))
    user = _client_user(cid)
    for sid, kind in ((se["id"], "hybrid"), (in_person_se["id"], "in person")):
        run(db.school_notifications.insert_one({"id": _gid("n"), "audience": f"school_client:{cid}", "read_at": None,
                                                "school_enrollment_id": sid, "title": kind, "created_at": "2026-10-01", "tag": TAG}))
    _flag(False)
    try:
        assert [r["school_enrollment_id"] for r in run(server.portal_school_list(user))] == [in_person_se["id"]]
        with pytest.raises(HTTPException) as e:
            run(server._school_enrollment_for_client(se["id"], user))
        assert e.value.status_code == 404
        assert run(server._school_enrollment_for_client(in_person_se["id"], user))[0]["id"] == in_person_se["id"]
        # Every other School page of the course is closed too, and its notices are gone.
        res = run(_http.get(f"/api/portal/school/{se['id']}/requests", headers=_auth(user)))
        assert res.status_code == 404 and "no longer available" in res.json()["detail"]
        assert run(_http.get(f"/api/portal/school/{in_person_se['id']}/requests", headers=_auth(user))).status_code == 200
        notes = run(_http.get("/api/portal/school-notifications", headers=_auth(user))).json()
        assert [n["title"] for n in notes["items"]] == ["in person"] and notes["unread"] == 1
        # Learn and Progress resolve only the in-person course.
        for view in (server.portal_learn, server.portal_progress):
            dogs_shown = {r.get("dog_id") or (r.get("dog") or {}).get("id") for r in run(view(user))}
            assert dog["id"] not in dogs_shown, view.__name__
    finally:
        _flag(None)
    notes = run(_http.get("/api/portal/school-notifications", headers=_auth(user))).json()
    assert notes["unread"] == 2, "with Online School on, both show again"
    with pytest.raises(HTTPException) as e:   # with it on, the course is there again (the roadmap needs real modules)
        run(server._school_enrollment_for_client(_gid("nope"), user))
    assert e.value.status_code == 404
    got, _ = run(server._school_enrollment_for_client(se["id"], user))
    assert got["id"] == se["id"]
    _remove([dp["id"], in_person["id"]], [se["id"], in_person_se["id"]])


def test_selling_an_online_course_at_the_desk_while_it_is_off_charges_nothing():
    admin = _admin()
    course = _program(delivery_mode="self_guided", purchase_fulfillment="online_school", price=49.0,
                      format={"count": 6, "unit": "lessons"})
    cid, dog = _family()
    _flag(False)
    try:
        res = run(_http.post(f"/api/clients/{cid}/sell-program", headers=_auth(admin),
                             json={"program_id": course["id"], "dog_id": dog["id"], "payment_method": "cash"}))
        assert res.status_code == 409 and "Nothing was charged" in res.json()["detail"], res.text
        assert run(db.credit_lots.count_documents({"program_id": course["id"]})) == 0
        assert run(db.retail_sales.count_documents({"program_id": course["id"]})) == 0
        from domains.school import ownership
        with pytest.raises(HTTPException) as e:   # giving back a revoked course is a grant too
            run(ownership.grant_purchase(dog, course, enrolled_by=None, enrollment_source="purchase", source_ref=None))
        assert "Online School is turned off" in e.value.detail
    finally:
        _flag(None)


def test_the_contact_form_stops_offering_online_school_while_it_is_off():
    _flag(False)
    try:
        off = run(_http.get("/api/public/contact-inquiry-options")).json()
    finally:
        _flag(None)
    on = run(_http.get("/api/public/contact-inquiry-options")).json()
    assert "online_school" not in off["interests"] and "in_person_training" in off["interests"]
    assert "online_school" in on["interests"]


def test_a_removed_course_is_plain_history_in_my_orders():
    from domains.shop import orders as shop_orders_view
    line = {"item_id": "1", "kind": "training_program", "ref_id": "p1", "fulfillment_kind": "online_school", "dog_id": "d1"}
    order = {"status": "paid"}
    gone = run(shop_orders_view.line_actions(db=db, order=order, line={**line, "fulfillment_status": "fulfilled"},
                                             item=None, viewer_client_id="c1", enrollment_by_key={}))
    assert not [a for a in gone if a["action"] == "open_course"]
    pending = run(shop_orders_view.line_actions(db=db, order=order, line={**line, "fulfillment_status": "pending"},
                                                item=None, viewer_client_id="c1", enrollment_by_key={}))
    assert [a["reason"] for a in pending if a["action"] == "open_course"] == ["This course is still being set up."]
    owned = {("d1", "p1"): {"id": "se1"}}
    on = run(shop_orders_view.line_actions(db=db, order=order, line={**line, "fulfillment_status": "fulfilled"},
                                           item=None, viewer_client_id="c1", enrollment_by_key=owned))
    assert [a["enabled"] for a in on if a["action"] == "open_course"] == [True]
    off = run(shop_orders_view.line_actions(db=db, order=order, line={**line, "fulfillment_status": "fulfilled"},
                                            item=None, viewer_client_id="c1", enrollment_by_key=owned, online_school_on=False))
    assert not [a for a in off if a["action"] == "open_course"], "a closed course has nothing to open"


# ───────────── Today ─────────────

def test_a_hidden_today_card_has_the_same_signature_in_every_process():
    item = {"kind": "some_new_kind", "title": "3 things", "subtitle": "Rex"}
    import hashlib
    expected = hashlib.sha1("3 things|Rex".encode("utf-8")).hexdigest()[:8]
    assert server._today_brain_signature(item) == f"hash:{expected}", \
        "a salted hash() differs per worker and per restart, so a hidden card came back"


def test_today_has_no_online_school_practice_card():
    import inspect
    assert "school_practice_log" not in inspect.getsource(server.admin_today_brain)


def test_deleting_a_program_leaves_no_dangling_links_and_shows_no_course_file_to_everyone():
    program = _program()
    neighbour = _program(draft={"prereq_slugs": [program["slug"]], "recommended_next_program_slugs": [],
                                "shop_relationships": [{"rel": "related", "kind": "training_program", "ref_id": program["id"]}]})
    only_here = {"id": _gid("res"), "program_ids": [program["id"]], "lesson_ids": [], "tag": TAG}
    shared = {"id": _gid("res"), "program_ids": [program["id"], neighbour["id"]], "lesson_ids": [], "tag": TAG}
    run(db.school_resources.insert_many([dict(only_here), dict(shared)]))
    rating = f"school-experience:{TAG}:dog:{program['id']}"
    run(db.school_experience_feedback.insert_one({"_id": rating, "program_id": program["id"], "school_enrollment_id": "elsewhere", "tag": TAG}))
    r = removal._Run(db, True)
    run(removal.remove_program_row(r, program))
    draft = run(db.programs.find_one({"id": neighbour["id"]}))["draft"]
    assert draft["prereq_slugs"] == [] and draft["shop_relationships"] == [], "publishing the draft would bring the dead link back"
    assert run(db.school_resources.find_one({"id": only_here["id"]}))["program_ids"] == [program["id"]], \
        "a resource with no programs and no lessons is shown to every School student"
    assert run(db.school_resources.find_one({"id": shared["id"]}))["program_ids"] == [neighbour["id"]]
    assert run(db.school_experience_feedback.count_documents({"_id": rating})) == 0, "no storefront rating for a gone program"
    run(db.school_resources.delete_many({"tag": TAG}))


def test_the_plain_delete_of_a_never_used_program_cleans_up_and_is_refused_while_an_order_needs_it():
    admin = _admin()
    program = _program()
    dependent = _program(prereq_slugs=[program["slug"]])
    order = {"id": _gid("order"), "status": "pending_payment", "tag": TAG, "lines": [
        {"item_id": "1", "kind": "training_program", "ref_id": program["id"], "fulfillment_status": "pending"}]}
    run(db.shop_orders.insert_one(dict(order)))
    res = run(_http.delete(f"/api/programs/{program['id']}?hard=true", headers=_auth(admin)))
    assert res.status_code == 409 and "Finish or refund" in res.json()["detail"]
    run(db.shop_orders.delete_one({"id": order["id"]}))
    res = run(_http.delete(f"/api/programs/{program['id']}?hard=true", headers=_auth(admin)))
    assert res.status_code == 200, res.text
    assert run(db.programs.find_one({"id": dependent["id"]}))["prereq_slugs"] == [], \
        "a prerequisite that no longer exists blocks saving and enrolling in the program that lists it"


def test_a_refunded_course_order_does_not_block_and_an_unrefunded_one_does():
    admin = _admin()
    program = _program()
    _enroll(program, "in_person_school")
    order = {"id": _gid("order"), "status": "paid", "tag": TAG, "lines": [
        {"item_id": "1", "kind": "training_program", "ref_id": program["id"], "fulfillment_status": "failed",
         "fulfillment_kind": "online_school", "quantity": 1, "quantity_refunded": 1}]}
    run(db.shop_orders.insert_one(dict(order)))
    p = run(_http.get(f"/api/admin/programs/{program['id']}/delete-preview", headers=_auth(admin))).json()
    assert p["blockers"] == [], "a refund leaves the line 'failed'; it must not block forever"
    run(db.shop_orders.update_one({"id": order["id"]}, {"$set": {"lines.0.quantity_refunded": 0}}))
    _refused(admin, program, "Finish or refund them first")


def test_in_person_sessions_of_a_kept_enrollment_do_not_block_remove_online_school():
    course = _program(delivery_mode="both")
    online, online_se, cid, dog = _enroll(course, "online_school", status="completed")
    hybrid, hybrid_se, *_ = _enroll(course, "hybrid_school", status="completed", family=(cid, dog))
    kept = {"id": _gid("dp"), "dog_id": dog["id"], "program_id": course["id"], "delivery_channel": "in_person_school",
            "status": "active", "tag": TAG}
    run(db.dog_programs.insert_one(dict(kept)))
    run(db.bookings.insert_one({"id": _gid("bk"), "program_id": course["id"], "dog_id": dog["id"], "status": "approved",
                                "is_prepaid_program_session": True, "date": "2030-01-07", "tag": TAG}))
    assert run(removal.removal_blockers(db, [online["id"], hybrid["id"]], [])) == [], \
        "those sessions belong to the kept in-person enrollment"
    run(db.dog_programs.delete_one({"id": kept["id"]}))
    assert run(removal.removal_blockers(db, [online["id"], hybrid["id"]], [])), "with no kept enrollment they are the hybrid's"
    _remove([online["id"], hybrid["id"]], [online_se["id"], hybrid_se["id"]])


def test_a_stay_whose_lessons_were_recorded_under_a_removed_enrollment_blocks_it():
    program = _program()
    dp, se, cid, dog = _enroll(program, "hybrid_school")
    stay = {"id": _gid("bk"), "dog_id": dog["id"], "service_type": "boarding", "status": "approved",
            "checked_in_at": "2026-10-28T09:00:00+00:00", "date": "2026-10-28", "tag": TAG}
    run(db.bookings.insert_one(dict(stay)))
    run(db.training_session_drafts.insert_one({"id": _gid("draft"), "enrollment_id": dp["id"], "booking_id": stay["id"], "tag": TAG}))
    blockers = run(removal.removal_blockers(db, [dp["id"]], []))
    assert blockers and "still booked or not checked out" in blockers[0]
    run(db.bookings.update_one({"id": stay["id"]}, {"$set": {"status": "completed"}}))
    assert run(removal.removal_blockers(db, [dp["id"]], [])) == []
    _remove([dp["id"]], [se["id"]])


def test_a_kept_course_loses_its_online_settings_in_its_draft_too_and_leaves_the_register():
    course = _program(delivery_mode="both", purchase_fulfillment="online_school", available_online=True, show_at_register=True,
                      draft={"delivery_mode": "both", "purchase_fulfillment": "online_school", "free_enrollment_enabled": True})
    draft_only = _program(draft={"delivery_mode": "self_guided"})
    in_person, in_person_se, *_ = _enroll(course, "in_person_school")
    t = run(removal.online_school_targets(db))
    assert {course["id"], draft_only["id"]} <= {p["id"] for p in t["convert"]}, "a draft set for Online School counts"
    patch = removal.online_settings_off(course)
    assert patch["show_at_register"] is False and patch["available_online"] is False, \
        "its course price would otherwise sell cheap training credits usable at any lesson"
    r = removal._Run(db, True)
    for p in t["convert"]:
        if p["id"] in (course["id"], draft_only["id"]):
            upd = {**removal.online_settings_off(p)}
            upd.update({f"draft.{k}": v for k, v in removal.online_settings_off(p.get("draft") or {}).items()})
            run(db.programs.update_one({"id": p["id"]}, {"$set": upd}))
    got = run(db.programs.find_one({"id": course["id"]}))
    assert got["draft"]["delivery_mode"] == "trainer_led" and got["draft"]["purchase_fulfillment"] == "credits_only"
    assert got["draft"]["free_enrollment_enabled"] is False
    assert run(db.programs.find_one({"id": draft_only["id"]}))["draft"]["delivery_mode"] == "trainer_led"
    _remove([in_person["id"]], [in_person_se["id"]])


def test_reminder_and_recap_jobs_use_the_closed_course_filter():
    import inspect
    import daily_jobs
    for job in (daily_jobs.run_homework_practice_reminder_job, daily_jobs.run_homework_weekly_digest_job):
        assert "open_course_practice(db)" in inspect.getsource(job), job.__name__
    course = _program(delivery_mode="self_guided")
    dp, se, *_ = _enroll(course, "online_school")
    _flag(False)
    try:
        flt = run(removal.open_course_practice(db))
        assert dp["id"] in flt["school_enrollment_record_id"]["$nin"] and se["id"] in flt["school_enrollment_id"]["$nin"]
    finally:
        _flag(None)
    assert run(removal.open_course_practice(db)) == {}
    _remove([dp["id"]], [se["id"]])
