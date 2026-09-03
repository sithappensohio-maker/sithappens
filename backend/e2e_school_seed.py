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
    out = {"db_name": os.environ["DB_NAME"], "program_id": prog["id"], "program_name": prog["name"], "clients": clients}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    sys.stdout.write(f"E2E_SEED_OK clients={len(clients)} db={out['db_name']} out={args.out}\n")
    sys.stdout.flush()
    os._exit(0)  # the in-process fixtures' threads must not delay exit


if __name__ == "__main__":
    main()
