"""Seed a disposable database for the client-School Playwright suite.

Usage (from backend/):

    SIT_HAPPENS_TEST_DB_NAME=sit_happens_test_e2e_school \
      python e2e_school_seed.py --clients 12 --out ../frontend/e2e/.seed.json

Builds, on a database whose name MUST contain "test" (``_test_env`` refuses
anything else and drops it clean first):

  * one online program — 2 modules × 2 lessons, ten authored content blocks
    per lesson (the real Course Builder shape, including the lesson's optional
    knowledge check), a Module Quiz at the end of module 1, a trainer
    checkpoint on the last lesson, and the one-time setup questionnaire
    REQUIRED so the setup path is exercised;
  * N identical, independent fresh clients (each with their own dog, login and
    enrollment) so every spec can own one client and never share state.

Everything goes through the same fixtures the backend School suites use, so
the enrollment is the real thing rather than a hand-built imitation.
"""
import argparse
import json
import os
import sys
import uuid
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SIT_HAPPENS_TEST_DB_NAME", "sit_happens_test_e2e_school")

import _test_env  # noqa: E402,F401 — must run before `import server`
import server  # noqa: E402
from _test_loop import run  # noqa: E402
from test_online_school_phase4 import _school_program, _client_and_dog, _enroll, _homework_template  # noqa: E402

PASSWORD = "Password123!"

# The fixtures are generator context managers whose `finally` blocks DELETE
# what they created. They are entered by hand and never exited, and must stay
# referenced until the process exits — a collected generator runs its cleanup.
_KEEP_ALIVE = []

# A self-contained demonstration image so the seeded lessons exercise the
# media-first display rule without any uploaded file.
DEMO_IMAGE_URI = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22640%22%20height%3D%22360%22%3E%3Crect%20width%3D%22640%22%20height%3D%22360%22%20fill%3D%22%230c143e%22/%3E%3Ccircle%20cx%3D%22320%22%20cy%3D%22150%22%20r%3D%2270%22%20fill%3D%22%238cc63f%22/%3E%3Ctext%20x%3D%22320%22%20y%3D%22290%22%20font-family%3D%22Arial%22%20font-size%3D%2240%22%20font-weight%3D%22900%22%20fill%3D%22%23ffffff%22%20text-anchor%3D%22middle%22%3EDEMO%3A%20lure%20at%20nose%20height%3C/text%3E%3C/svg%3E'


def _text(id_, title, body, order):
    return {"id": id_, "type": "text", "title": title, "body": body, "order": order, "active": True}


def blocks_for(prefix, skill, cue):
    return [
        _text(f"{prefix}-intro", f"What you are teaching: {skill}",
              f"{skill} is the foundation for almost everything else in this course. Before your dog can learn to sit politely at the door, walk on a loose leash, or come when called, they need to reliably respond to {cue}. This lesson teaches you how to build that response with clear, simple repetitions.\n\nRead this whole part before you get your dog. It is short, and it will save you from the most common early mistakes.", 1),
        _text(f"{prefix}-why", "Why this matters",
              f"Dogs do not know that {cue} means anything until we teach it. Every time you say it and nothing good follows, the word loses value. Every time you say it once and a treat follows a clean response, the word gains value. Your job in this lesson is to make {cue} the best word your dog knows.", 2),
        {"id": f"{prefix}-ready", "type": "checklist", "title": "Before you begin", "items": [
            "A pouch or pocket with 20 to 30 pea-sized soft treats",
            "A quiet room with the TV off and other pets out of the way",
            "Your dog has been outside to potty in the last hour",
            "A leash clipped on so you can prevent wandering (drop it on the floor)",
            "Your phone nearby so you can start Practice right after this lesson",
        ], "order": 3, "active": True},
        {"id": f"{prefix}-steps", "type": "steps", "title": "Step-by-step lesson", "items": [
            "Stand or sit about two feet from your dog with treats hidden in your hand or pouch.",
            f"Wait for a moment when your dog is not looking at you, then say {cue} one time in a normal, friendly voice.",
            "The instant your dog's eyes come to you, say your marker word (\"Yes!\") and feed one treat right at your dog's nose.",
            "Toss a second treat a foot away so your dog has to move and look away from you again.",
            f"When they finish the tossed treat, repeat: say {cue} once, mark the look, feed.",
            "Do ten repetitions, then stop and give your dog a short break. That is one round.",
            "Do three rounds today with at least a minute of rest between them.",
        ], "order": 4, "active": True},
        # Authored AFTER the steps on purpose: the client view floats demo media
        # to the top of its part, so this must render above the step list.
        {"id": f"{prefix}-demo", "type": "image", "title": "What it looks like", "url": DEMO_IMAGE_URI,
         "config": {"caption": "Treat at the nose, hand still, eyes on you."}, "order": 4, "active": True},
        {"id": f"{prefix}-tip", "type": "trainer_tip", "title": "Trainer tip",
         "body": "Feed the treat at your dog's nose, not up at your face. We want your dog to learn that looking at you pays, not that jumping toward your hand pays.", "order": 5, "active": True},
        {"id": f"{prefix}-warn", "type": "warning", "title": "Safety and welfare",
         "body": "If your dog is stiff, growling, or walking away repeatedly, stop the session and message your trainer. Never grab the collar or pull the head toward you.", "order": 6, "active": True},
        _text(f"{prefix}-good", "What a good repetition looks like",
              f"You say {cue} one time. Within about one second your dog's head turns and their eyes land on your face. You mark with \"Yes!\" while they are still looking, and the treat arrives within a second of the mark. Your dog then goes back to being a dog until the next rep.", 7),
        _text(f"{prefix}-mist", "Common mistakes to avoid",
              f"Saying {cue} two or three times in a row. Marking late, after the dog has already looked away. Reaching for the treat before you mark, so the dog watches your hand instead of your face. Doing thirty reps in one go because it is going well; short and successful beats long and sloppy.", 8),
        _text(f"{prefix}-fix", "If it is not working",
              "Move to a more boring room. Use higher value food such as chicken or cheese. Get closer to your dog. Wait for a quieter moment before you say the cue. If none of that helps after two rounds, stop and ask your trainer.", 9),
        {"id": f"{prefix}-quiz", "type": "quiz", "title": "Quick check", "body": f"How many times should you say {cue} for one repetition?",
         "items": ["Once", "Until the dog looks", "Three times, louder each time"],
         "config": {"correct_answer": "Once", "explanation": "One cue, then wait. Repeating the word teaches your dog that the first one does not count."},
         "order": 10, "active": True},
    ]


LESSONS = [("Name Response", "your dog's name"), ("The Marker Word", "\"Yes!\""), ("Sit", "\"Sit\""), ("Down", "\"Down\"")]


def build_program(require_baseline=True):
    ctx = _school_program(n_modules=2, n_lessons_per_module=2, checkpoint_lesson_idx=3)
    _KEEP_ALIVE.append(ctx)
    prog, admin = ctx.__enter__()  # never exited on purpose: rows must persist
    mods = prog["modules"]
    flat = 0
    for mi, m in enumerate(mods):
        m["name"] = ["Foundations", "Core Positions"][mi]
        m["description"] = ["Attention, the marker word, and how rewards work.", "Sit and Down, taught without pushing or pulling."][mi]
        for l in m["lessons"]:
            skill, cue = LESSONS[flat]
            l["name"] = skill
            l["estimated_minutes"] = 12
            l["client_overview"] = f"Teach {skill.lower()} using a marker word and food, in short rounds."
            l["success_criteria"] = "Seven clean responses out of ten, two days in a row."
            l["content_blocks"] = blocks_for(f"l{flat}", skill, cue)
            flat += 1
    m1_lessons = [l["id"] for l in mods[0]["lessons"]]
    opt = lambda t: {"id": str(uuid.uuid4()), "text": t}  # noqa: E731
    q1 = [opt("Once"), opt("Until the dog looks"), opt("Three times")]
    q2 = [opt("True"), opt("False")]
    mods[0]["module_quiz"] = {
        "enabled": True, "title": "Foundations Review", "instructions": "Two quick questions before Core Positions.",
        "passing_score": 50,
        "questions": [
            {"id": str(uuid.uuid4()), "type": "multiple_choice", "question": "How many times do you say the cue per repetition?",
             "options": q1, "correct_option_id": q1[0]["id"], "explanation": "One cue, then wait.", "review_lesson_id": m1_lessons[0]},
            {"id": str(uuid.uuid4()), "type": "true_false", "question": "You should mark the instant the dog looks at you.",
             "options": q2, "correct_option_id": q2[0]["id"], "explanation": "Timing is everything.", "review_lesson_id": m1_lessons[1]},
        ],
    }
    run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {
        "name": "Puppy Foundations Online", "modules": mods,
        "description": "A guided online course for first-time dog owners.",
        "school_onboarding": {"enabled": True, "require_baseline": bool(require_baseline), "require_equipment_check": False},
        "welcome_outcomes": ["Your dog looks at you when you say their name", "A marker word your dog understands", "A reliable Sit and Down"],
    }}))
    prog = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0}))
    return prog, admin


def general_practice_template(admin):
    """A trainer-prescribed, NOT lesson-linked Practice recipe — the kind of row
    that must keep showing as unfinished after the lesson's practice is done."""
    ctx = _homework_template("General")
    _KEEP_ALIVE.append(ctx)
    tpl, _admin = ctx.__enter__()
    run(server.db.homework_templates.update_one({"id": tpl["id"]}, {"$set": {"name": "Loose-Leash Bonus Reps"}}))
    return tpl


def build_client(prog, admin, index, general_tpl=None):
    ctx = _client_and_dog()
    _KEEP_ALIVE.append(ctx)
    client, dog = ctx.__enter__()  # never exited on purpose
    email = f"e2e.client{index}@example.com"
    dog_name = ["Bella", "Max", "Luna", "Charlie", "Daisy", "Milo", "Ruby", "Cooper", "Sadie", "Rocky", "Molly", "Bear", "Penny", "Duke", "Nala", "Finn"][index % 16]
    run(server.db.clients.update_one({"id": client["id"]}, {"$set": {"name": f"E2E Client {index}", "email": email, "phone": "5555550100"}}))
    run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"name": dog_name, "breed": "Golden Retriever", "age_y": 1}}))
    se, enr = _enroll(prog, dog, admin)
    run(server.db.users.insert_one({
        "id": str(uuid.uuid4()), "email": email, "password_hash": server.hash_password(PASSWORD),
        "name": f"E2E Client {index}", "role": "client", "client_id": client["id"], "created_at": server.now_iso(),
        "token_version": 0, "must_change_password": False, "active": True,
    }))
    run(server.db.waiver_signatures.insert_one({
        "id": str(uuid.uuid4()), "client_id": client["id"], "waiver_version": 1, "signed_at": server.now_iso(),
        "signature": f"E2E Client {index}", "dog_names": [dog_name],
    }))
    general_id = None
    if general_tpl is not None:
        general = run(server.assign_school_practice(
            se["id"], server.SchoolPracticeAssignIn(
                template_id=general_tpl["id"], lesson_id=None,
                trainer_personalized_note="Bonus: five minutes of loose-leash walking in the yard."),
            admin))
        general_id = (general or {}).get("id") or ((general or {}).get("homework") or {}).get("id")
    snap = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "program_snapshot": 1, "current_lesson_id": 1}))
    lessons = [{"id": l["id"], "name": l["name"], "module_id": m["id"], "module_name": m["name"]}
               for m in snap["program_snapshot"]["modules"] for l in m["lessons"]]
    return {
        "index": index, "email": email, "password": PASSWORD, "client_id": client["id"], "dog_name": dog_name,
        "enrollment_id": se["id"], "dog_program_id": enr["id"], "current_lesson_id": snap["current_lesson_id"],
        "lessons": lessons, "module_ids": [m["id"] for m in snap["program_snapshot"]["modules"]],
        "general_practice_id": general_id,
    }


def build_trainer_day(prog, admin, clients):
    """Stage 11 — the trainer's day needs real canonical rows: an in-person
    student with a training lesson booked today (client 5 / Milo), and a
    pending, fully-formed checkpoint submission (client 14 / Nala, lesson 4).
    Nothing here is a queue flag — the queue derives from these records."""
    today = server.business_today().isoformat()
    # Dedicated clients OUTSIDE the spec pool (slots 0..N-1 are owned by the
    # client specs, half per phone project) — never touch a spec's client.
    c5 = build_client(prog, admin, len(clients))
    c14 = build_client(prog, admin, len(clients) + 1)
    run(server.db.school_enrollments.update_one({"id": c5["enrollment_id"]}, {"$set": {"delivery_mode": "in_person", "onboarding_status": "not_required"}}))
    run(server.db.dog_programs.update_one({"id": c5["dog_program_id"]}, {"$set": {"delivery_channel": "in_person_school"}}))
    dog5 = run(server.db.dogs.find_one({"owner_id": c5["client_id"]}, {"_id": 0, "id": 1}))
    booking = run(server.create_booking(server.BookingIn(dog_id=dog5["id"], service_type="training", date=today, time="10:30", override_capacity=True), admin))
    se14 = run(server.db.school_enrollments.find_one({"id": c14["enrollment_id"]}, {"_id": 0}))
    enr14 = run(server.db.dog_programs.find_one({"id": c14["dog_program_id"]}, {"_id": 0}))
    cp_lesson = next(l for m in enr14["program_snapshot"]["modules"] for l in m["lessons"] if (l.get("checkpoint") or {}).get("enabled"))
    cp_module = next(m for m in enr14["program_snapshot"]["modules"] if any(l["id"] == cp_lesson["id"] for l in m["lessons"]))
    run(server.db.dog_programs.update_one({"id": enr14["id"]}, {"$set": {"current_module_id": cp_module["id"], "current_lesson_id": cp_lesson["id"]}}))
    sub = {
        "id": str(uuid.uuid4()), "school_enrollment_id": se14["id"], "enrollment_id": enr14["id"], "dog_id": se14["dog_id"], "client_id": se14["client_id"],
        "lesson_id": cp_lesson["id"], "module_id": cp_module["id"], "lesson_name": cp_lesson["name"], "video_media_id": None, "homework_id": None,
        "client_note": "Filmed in the yard.", "rubric_snapshot": cp_lesson["checkpoint"], "status": "pending", "submitted_at": server.now_iso(), "created_at": server.now_iso(),
    }
    run(server.db.checkpoint_submissions.insert_one(dict(sub)))
    return {"booking_id": booking["id"], "session_dog": c5["dog_name"], "session_client": f"E2E Client {c5['index']}",
            "checkpoint_submission_id": sub["id"], "checkpoint_dog": c14["dog_name"], "checkpoint_lesson": cp_lesson["name"]}


def _staff_user(email, name, staff_role):
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": email, "password_hash": server.hash_password(PASSWORD), "name": name,
        "role": "employee", "staff_role": staff_role, "created_at": server.now_iso(),
        "token_version": 0, "must_change_password": False, "needs_password": False, "active": True,
    }))
    return {"id": uid, "email": email, "password": PASSWORD, "name": name, "role": "employee", "staff_role": staff_role}


def _in_person(c, trainer_id=None):
    run(server.db.school_enrollments.update_one({"id": c["enrollment_id"]}, {"$set": {"delivery_mode": "in_person", "onboarding_status": "not_required"}}))
    upd = {"delivery_channel": "in_person_school"}
    if trainer_id:
        upd["assigned_trainer_id"] = trainer_id
    run(server.db.dog_programs.update_one({"id": c["dog_program_id"]}, {"$set": upd}))
    return run(server.db.dogs.find_one({"owner_id": c["client_id"]}, {"_id": 0, "id": 1}))


def _booked_today(prog, admin, index, trainer, time):
    c = build_client(prog, admin, index)
    dog = _in_person(c, trainer["id"])
    b = run(server.create_booking(server.BookingIn(dog_id=dog["id"], service_type="training", date=server.business_today().isoformat(), time=time, override_capacity=True), admin))
    run(server.assign_training_booking_trainer(b["id"], server.TrainingDayTrainerAssignmentIn(assigned_trainer_id=trainer["id"]), admin))
    return {"booking_id": b["id"], "dog": c["dog_name"], "client": f"E2E Client {c['index']}", "dog_id": dog["id"], "enrollment_id": c["dog_program_id"]}


def _pending_checkpoint(prog, admin, index, trainer):
    c = build_client(prog, admin, index)
    run(server.db.dog_programs.update_one({"id": c["dog_program_id"]}, {"$set": {"assigned_trainer_id": trainer["id"]}}))
    se = run(server.db.school_enrollments.find_one({"id": c["enrollment_id"]}, {"_id": 0}))
    enr = run(server.db.dog_programs.find_one({"id": c["dog_program_id"]}, {"_id": 0}))
    cp_lesson = next(l for m in enr["program_snapshot"]["modules"] for l in m["lessons"] if (l.get("checkpoint") or {}).get("enabled"))
    cp_module = next(m for m in enr["program_snapshot"]["modules"] if any(l["id"] == cp_lesson["id"] for l in m["lessons"]))
    run(server.db.dog_programs.update_one({"id": enr["id"]}, {"$set": {"current_module_id": cp_module["id"], "current_lesson_id": cp_lesson["id"]}}))
    sub = {
        "id": str(uuid.uuid4()), "school_enrollment_id": se["id"], "enrollment_id": enr["id"], "dog_id": se["dog_id"], "client_id": se["client_id"],
        "lesson_id": cp_lesson["id"], "module_id": cp_module["id"], "lesson_name": cp_lesson["name"], "video_media_id": None, "homework_id": None,
        "client_note": "Filmed on the porch.", "rubric_snapshot": cp_lesson["checkpoint"], "status": "pending", "submitted_at": server.now_iso(), "created_at": server.now_iso(),
    }
    run(server.db.checkpoint_submissions.insert_one(dict(sub)))
    return {"submission_id": sub["id"], "dog": c["dog_name"], "lesson": cp_lesson["name"]}


def _practice_to_review(prog, admin, index, trainer):
    c = build_client(prog, admin, index)
    run(server.db.dog_programs.update_one({"id": c["dog_program_id"]}, {"$set": {"assigned_trainer_id": trainer["id"]}}))
    dog = run(server.db.dogs.find_one({"owner_id": c["client_id"]}, {"_id": 0, "id": 1}))
    hw_id = str(uuid.uuid4()); log_id = str(uuid.uuid4())
    run(server.db.homework.insert_one({
        "id": hw_id, "dog_id": dog["id"], "client_id": c["client_id"], "dog_name": c["dog_name"], "client_name": f"E2E Client {c['index']}",
        "title": f"{c['lessons'][0]['name']} practice", "status": "assigned", "source_lesson_id": c["lessons"][0]["id"],
        "school_enrollment_id": c["enrollment_id"], "enrollment_id": c["dog_program_id"], "created_at": server.now_iso(),
        "section_logs": [{"id": log_id, "logged_at": server.now_iso(), "note": "She held it for five seconds!", "field_values": {"__video_id": "e2e-video"}, "review_status": None}],
    }))
    return {"homework_id": hw_id, "log_id": log_id, "dog": c["dog_name"]}


def _daily_to_approve(prog, admin, index, trainer):
    c = build_client(prog, admin, index)
    run(server.db.dog_programs.update_one({"id": c["dog_program_id"]}, {"$set": {"assigned_trainer_id": trainer["id"]}}))
    dog = run(server.db.dogs.find_one({"owner_id": c["client_id"]}, {"_id": 0, "id": 1}))
    tracker = run(server.create_daily_tracker(server.DailyTrackerCreateIn(
        dog_id=dog["id"], title="Two-day sit plan",
        days=[server.DailyTrackerSectionIn(day_number=1, day_focus="Sit on cue", fields=[{"id": "reps", "label": "Reps", "kind": "number"}]),
              server.DailyTrackerSectionIn(day_number=2, day_focus="Sit with distance", fields=[{"id": "reps", "label": "Reps", "kind": "number"}])]), admin))
    hw_id = tracker.get("id") or (tracker.get("homework") or {}).get("id")
    cu = run(server.db.users.find_one({"email": c["email"]}, {"_id": 0}))
    run(server.submit_day(hw_id, 1, server.DaySubmitIn(field_values={"reps": 8}, note="Eight clean sits.", difficulty="good"), cu))
    return {"homework_id": hw_id, "dog": c["dog_name"]}


def _stale_draft(prog, admin, index, trainer):
    c = build_client(prog, admin, index)
    dog = _in_person(c, trainer["id"])
    res = run(server.start_training_session_draft_direct(dog["id"], c["dog_program_id"], "", admin))
    assert res["resolution"] == "ready", res
    yday = (server.business_today() - timedelta(days=1)).isoformat()
    run(server.db.training_session_drafts.update_one({"id": res["draft"]["id"]}, {"$set": {"occurrence_date": yday, "created_by": trainer["id"], "created_by_name": trainer["name"]}}))
    return {"draft_id": res["draft"]["id"], "dog": c["dog_name"], "dog_id": dog["id"], "enrollment_id": c["dog_program_id"]}


def _journey_client(index):
    """Stage 13 — a client + dog + login with NO enrollment: the owner assigns the program
    inside the journey spec itself, through the real API."""
    ctx = _client_and_dog()
    _KEEP_ALIVE.append(ctx)
    client, dog = ctx.__enter__()
    email = f"e2e.journey{index}@example.com"
    run(server.db.clients.update_one({"id": client["id"]}, {"$set": {"name": f"E2E Journey {index}", "email": email, "phone": "5555550199"}}))
    run(server.db.dogs.update_one({"id": dog["id"]}, {"$set": {"name": ["Juniper", "Koda"][index % 2], "breed": "Border Collie", "age_y": 1}}))
    run(server.db.users.insert_one({
        "id": str(uuid.uuid4()), "email": email, "password_hash": server.hash_password(PASSWORD),
        "name": f"E2E Journey {index}", "role": "client", "client_id": client["id"], "created_at": server.now_iso(),
        "token_version": 0, "must_change_password": False, "active": True,
    }))
    run(server.db.waiver_signatures.insert_one({
        "id": str(uuid.uuid4()), "client_id": client["id"], "waiver_version": 1, "signed_at": server.now_iso(),
        "signature": f"E2E Journey {index}", "dog_names": [run(server.db.dogs.find_one({"id": dog["id"]}, {"_id": 0, "name": 1}))["name"]],
    }))
    return {"email": email, "password": PASSWORD, "client_id": client["id"], "dog_id": dog["id"],
            "dog_name": run(server.db.dogs.find_one({"id": dog["id"]}, {"_id": 0, "name": 1}))["name"]}


def build_trainer_employee(prog, admin, first_index):
    """Stage 11.5 — a REAL trainer employee (role employee, staff_role trainer)
    with a day of assigned work, plus a Front Desk employee for the negative
    checks. Each Playwright project (390 / 320) gets its own set so the flows
    that FINISH work (Stay Here, Ready, reviews) never collide across projects."""
    trainer = _staff_user("e2e.trainer@example.com", "E2E Trainer", "trainer")
    front_desk = _staff_user("e2e.frontdesk@example.com", "E2E Front Desk", "front_desk")
    flows = []
    for proj in range(2):
        base = first_index + proj * 6
        flows.append({
            "stay": _booked_today(prog, admin, base, trainer, "09:00" if proj == 0 else "13:00"),
            "ready": _booked_today(prog, admin, base + 1, trainer, "09:45" if proj == 0 else "13:45"),
            "checkpoint": _pending_checkpoint(prog, admin, base + 2, trainer),
            "practice": _practice_to_review(prog, admin, base + 3, trainer),
            "daily": _daily_to_approve(prog, admin, base + 4, trainer),
            "stale_draft": _stale_draft(prog, admin, base + 5, trainer),
        })
    journey = [_journey_client(0), _journey_client(1)]  # one per Playwright project
    return {"trainer": trainer, "front_desk": front_desk, "flows": flows, "journey": journey}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clients", type=int, default=12)
    ap.add_argument("--out", required=True)
    # Slots >= this (within each project's half of the pool) also get one
    # trainer-prescribed general Practice row, for the "unrelated assigned work
    # stays unfinished" scenarios.
    ap.add_argument("--general-practice-from", type=int, default=10)
    args = ap.parse_args()
    prog, admin = build_program()
    general_tpl = general_practice_template(admin)
    half = max(1, args.clients // 2)
    clients = [
        build_client(prog, admin, i, general_tpl if (i % half) >= args.general_practice_from else None)
        for i in range(args.clients)
    ]
    trainer_day = build_trainer_day(prog, admin, clients)
    trainer_employee = build_trainer_employee(prog, admin, len(clients) + 2)
    out = {"db_name": os.environ["DB_NAME"], "program_id": prog["id"], "program_name": prog["name"], "clients": clients,
           "trainer_day": trainer_day, "trainer_employee": trainer_employee}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    sys.stdout.write(f"E2E_SEED_OK clients={len(clients)} db={out['db_name']} out={args.out}\n")
    sys.stdout.flush()
    os._exit(0)  # the in-process fixtures' threads must not delay exit


if __name__ == "__main__":
    main()
