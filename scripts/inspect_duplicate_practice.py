# -*- coding: utf-8 -*-
"""READ-ONLY forensic report on duplicate practice assignments.

Writes NOTHING. Point it at whichever database holds the Bolt records:
    MONGO_URL=... DB_NAME=... python bolt_inspect.py [--dog Bolt] [--title Engagement]
"""
import sys, io, os, json, argparse, collections
from dotenv import dotenv_values
from pymongo import MongoClient
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ap = argparse.ArgumentParser()
ap.add_argument("--dog", default="Bolt")
ap.add_argument("--title", default="Engagement")
args = ap.parse_args()

ENV = dotenv_values(r"C:\Users\Sit Happens\Documents\GitHub\sithappens\backend\.env")
url = os.environ.get("MONGO_URL") or ENV["MONGO_URL"]
name = os.environ.get("DB_NAME") or ENV["DB_NAME"]
db = MongoClient(url)[name]
print(f"database: {name}\n")

rows = list(db.homework.find(
    {"dog_name": {"$regex": args.dog, "$options": "i"},
     "title": {"$regex": args.title, "$options": "i"}}, {"_id": 0}))
if not rows:
    print(f"No homework matching dog~{args.dog!r} title~{args.title!r} in this database.")
    print("Run against the environment that holds the records shown in the screenshot.")
    raise SystemExit(0)

print(f"{len(rows)} matching assignment(s)\n" + "=" * 72)
for hw in rows:
    logs = hw.get("section_logs") or []
    client_logs = [l for l in logs if isinstance(l, dict) and not l.get("is_rest_day") and l.get("logged_by_role") != "admin"]
    reviewed = [l for l in client_logs if l.get("reviewed_at")]
    videos = [l for l in logs if (l.get("field_values") or {}).get("__video_id")]
    photos = [l for l in logs if (l.get("field_values") or {}).get("__photo")]
    questions = [q for l in logs for q in (l.get("questions") or [])]
    print(f"\nhomework id      : {hw.get('id')}")
    print(f"  dog            : {hw.get('dog_name')} ({hw.get('dog_id')})")
    print(f"  client         : {hw.get('client_name')} ({hw.get('client_id')})")
    print(f"  template id    : {(hw.get('template_snapshot') or {}).get('template_id')}")
    print(f"  created_at     : {hw.get('created_at')}")
    print(f"  due_date       : {hw.get('due_date')}")
    print(f"  status         : {hw.get('status')}")
    print(f"  completed_at   : {hw.get('completed_at')}  note={hw.get('completion_note')!r}")
    print(f"  assigned_by    : {hw.get('assigned_by')!r}")
    print(f"  daily_tracker  : {hw.get('daily_tracker')}  total_days={hw.get('total_days')}")
    print(f"  CLIENT LOGS    : {len(client_logs)}   reviewed: {len(reviewed)}   unreviewed: {len(client_logs)-len(reviewed)}")
    print(f"  videos/photos  : {len(videos)} video, {len(photos)} photo")
    print(f"  questions      : {len(questions)} ({sum(1 for q in questions if not q.get('answer'))} unanswered)")
    print(f"  school linkage : enrollment_id={hw.get('school_enrollment_id')} record_id={hw.get('school_enrollment_record_id')}")
    print(f"                   source_lesson_id={hw.get('source_lesson_id')} source_skill_id={hw.get('source_skill_id')}")
    print(f"                   source_session_log_id={hw.get('source_session_log_id')}")
    if client_logs:
        print("  log detail:")
        for l in client_logs:
            print("    - " + json.dumps({k: l.get(k) for k in
                  ("id", "logged_at", "date", "review_status", "reviewed_at", "note")}, ensure_ascii=False)[:170])

    hid = hw.get("id")
    print("  referenced elsewhere:")
    any_ref = False
    for coll, q in (
        ("school_events", {"homework_id": hid}),
        ("school_notifications", {"homework_id": hid}),
        ("notification_log", {"homework_id": hid}),
        ("homework_media", {"homework_id": hid}),
        ("step_events", {"homework_id": hid}),
        ("section_logs", {"homework_id": hid}),
        ("trophies", {"homework_id": hid}),
        ("awarded_trophies", {"homework_id": hid}),
        ("school_requests", {"homework_id": hid}),
        ("training_session_log", {"homework_created": hid}),
        ("dog_programs", {"auto_assigned_homework.homework_id": hid}),
    ):
        if coll not in db.list_collection_names():
            continue
        n = db[coll].count_documents(q)
        if n:
            any_ref = True
            print(f"    {coll}: {n}")
    if not any_ref:
        print("    (none found)")

print("\n" + "=" * 72)
ids = [r.get("id") for r in rows]
print("SAME id rendered twice?  ", "YES" if len(set(ids)) < len(ids) else "NO — these are distinct records")
tpls = {(r.get('template_snapshot') or {}).get('template_id') for r in rows}
print("same template?           ", "YES" if len(tpls) == 1 else f"NO ({len(tpls)} templates)")
active = [r for r in rows if r.get("status") != "completed"]
withact = [r for r in rows if [l for l in (r.get('section_logs') or []) if isinstance(l, dict) and l.get('logged_by_role') != 'admin' and not l.get('is_rest_day')]]
print(f"active: {len(active)} of {len(rows)}   |   carrying client activity: {len(withact)} of {len(rows)}")
print("\nRECOMMENDATION")
if len(rows) < 2:
    print("  Only one record matched — there is nothing to reconcile here.")
    print("  Widen --dog/--title, or run against the environment holding the duplicates.")
elif len(withact) > 1:
    print("  BOTH records carry client activity — do NOT delete either.")
    print("  A merge/reconciliation plan is needed so no logged practice is lost.")
elif len(withact) == 1:
    print(f"  One record carries the activity ({withact[0]['id']}); the other is empty.")
    print("  The record WITH activity should survive.")
else:
    print("  Neither record carries client activity — the least destructive")
    print("  option is to COMPLETE the redundant one rather than delete it,")
    print("  preserving history and freeing the assignment.")
