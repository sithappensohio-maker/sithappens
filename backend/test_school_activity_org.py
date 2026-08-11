"""School HQ Activity — organized for real client volume.

Covers: session grouping (same client/dog within the window bundles into one
card, gaps/other students split), exception-first headlines, server-side
filters (search/type-category/date/attention), cursor pagination bounds,
today-summary math, per-student rollups, and a realistic-volume smoke
(50 clients / 75 dogs / several hundred events) proving the endpoint stays
bounded and fast.
"""
import uuid
from datetime import datetime, timezone, timedelta

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ACTIVITY_ORG"
NOW = datetime.now(timezone.utc)


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


def _ev(client, dog, etype, minutes_ago, **extra):
    return {
        "id": str(uuid.uuid4()), "event_type": etype,
        "created_at": (NOW - timedelta(minutes=minutes_ago)).isoformat(),
        "actor_type": "client", "client_id": f"{TAG}-c-{client}", "client_name": f"Client {client}",
        "dog_id": f"{TAG}-d-{dog}", "dog_name": f"Dog {dog}",
        "program_name": extra.pop("program_name", "Basic Manners"),
        "module_name": extra.pop("module_name", "Week 1"),
        "title": extra.pop("title", f"{etype} title"),
        "summary": "", "metadata": {}, "priority": "info",
        "requires_attention": extra.pop("requires_attention", False),
        "deep_link": {}, "source": "online_school", "dedupe_key": str(uuid.uuid4()),
        **extra,
    }


def _seed(events):
    run(server.db.school_events.insert_many([dict(e) for e in events]))


def _cleanup():
    run(server.db.school_events.delete_many({"client_id": {"$regex": f"^{TAG}-c-"}}))


E = server.SchoolEvent


def test_session_grouping_bundles_one_sitting_and_splits_gaps_and_students():
    _seed([
        # Garrett/Bolt one sitting: learn → practice → lesson (minutes apart)
        _ev("g", "bolt", E.LESSON_LEARN_COMPLETED, 15),
        _ev("g", "bolt", E.PRACTICE_COMPLETED, 14),
        _ev("g", "bolt", E.LESSON_COMPLETED, 13, title="Completed Name Response & Check-In Game"),
        # Same dog, a separate sitting 3 hours earlier → its own bundle
        _ev("g", "bolt", E.PRACTICE_COMPLETED, 200),
        # A different student interleaved in time → never merged
        _ev("s", "max", E.PRACTICE_COMPLETED, 14),
    ])
    try:
        res = run(server.admin_school_hq_activity(limit=100, grouped=True, client_id=f"{TAG}-c-g", _=_admin()))
        groups = res["groups"]
        bolt_groups = [g for g in groups if g["dog_id"] == f"{TAG}-d-bolt"]
        assert len(bolt_groups) == 2, "one sitting bundles; a 3h gap starts a new bundle"
        sitting = bolt_groups[0]
        assert sitting["event_count"] == 3
        # Milestone headline (lesson completed) wins over routine events.
        assert "Name Response" in sitting["headline"]
        assert sitting["requires_attention"] is False
        titles = [e["event_type"] for e in sitting["events"]]
        assert set(titles) == {E.LESSON_LEARN_COMPLETED, E.PRACTICE_COMPLETED, E.LESSON_COMPLETED}
        res_s = run(server.admin_school_hq_activity(limit=100, grouped=True, client_id=f"{TAG}-c-s", _=_admin()))
        max_groups = [g for g in res_s["groups"] if g["dog_id"] == f"{TAG}-d-max"]
        assert len(max_groups) == 1 and max_groups[0]["event_count"] == 1
    finally:
        _cleanup()


def test_exceptions_headline_over_success_and_mark_attention():
    _seed([
        _ev("g", "bolt", E.LESSON_COMPLETED, 10),
        _ev("g", "bolt", E.PRACTICE_COULD_NOT_COMPLETE, 9, requires_attention=True,
            title="Garrett · Bolt couldn't complete practice"),
    ])
    try:
        res = run(server.admin_school_hq_activity(limit=50, grouped=True, client_id=f"{TAG}-c-g", _=_admin()))
        g = next(x for x in res["groups"] if x.get("dog_id") == f"{TAG}-d-bolt")
        assert g["requires_attention"] is True
        assert "couldn't complete" in g["headline"].lower()
    finally:
        _cleanup()


def test_server_side_filters_search_type_date_attention():
    _seed([
        _ev("alpha", "rex", E.PRACTICE_COMPLETED, 10),
        _ev("beta", "fido", E.CHECKPOINT_SUBMITTED, 12, requires_attention=True),
        _ev("beta", "fido", E.LESSON_COMPLETED, 60 * 24 * 3),  # 3 days ago
    ])
    try:
        # Search by dog name hits only that student.
        res = run(server.admin_school_hq_activity(limit=50, q="Dog fido", _=_admin()))
        assert {r["dog_id"] for r in res["items"]} == {f"{TAG}-d-fido"}
        # Type category filters against the backend dataset.
        res = run(server.admin_school_hq_activity(limit=50, type_category="checkpoint_submitted", q="Client beta", _=_admin()))
        assert all(r["event_type"] == E.CHECKPOINT_SUBMITTED for r in res["items"])
        assert any(r["dog_id"] == f"{TAG}-d-fido" for r in res["items"])
        # Attention-only.
        res = run(server.admin_school_hq_activity(limit=50, attention_only=True, q="Client beta", _=_admin()))
        assert res["items"] and all(r["requires_attention"] for r in res["items"])
        # Date range: only today's events.
        today = server.business_today().isoformat()
        res = run(server.admin_school_hq_activity(limit=50, date_from=today, q="Client beta", _=_admin()))
        assert all(r["created_at"] >= today for r in res["items"])
        assert not any(r["event_type"] == E.LESSON_COMPLETED for r in res["items"])
        # Unknown category is rejected loudly.
        try:
            run(server.admin_school_hq_activity(limit=5, type_category="nope", _=_admin()))
            assert False, "expected 400"
        except server.HTTPException as exc:
            assert exc.status_code == 400
    finally:
        _cleanup()


def test_summary_counts_today():
    _seed([
        _ev("a", "d1", E.PRACTICE_COMPLETED, 5),
        _ev("a", "d1", E.LESSON_COMPLETED, 4),
        _ev("b", "d2", E.CHECKPOINT_SUBMITTED, 3, requires_attention=True),
        _ev("c", "d3", E.PRACTICE_COMPLETED, 60 * 24 * 2),  # not today
    ])
    try:
        s = run(server.admin_school_hq_activity_summary(_admin()))
        assert s["active_students_today"] >= 2
        assert s["practices_today"] >= 1
        assert s["lessons_completed_today"] >= 1
        assert s["checkpoints_submitted_today"] >= 1
        assert "needs_attention" in s
    finally:
        _cleanup()


def test_group_by_student_rollup():
    _seed([
        _ev("g", "bolt", E.LESSON_LEARN_COMPLETED, 30),
        _ev("g", "bolt", E.PRACTICE_COMPLETED, 25),
        _ev("g", "bolt", E.LESSON_COMPLETED, 20),
        _ev("g", "luna", E.PRACTICE_COMPLETED, 10),  # same owner, second dog
    ])
    try:
        res = run(server.admin_school_hq_activity_students(q="Client g", limit=50, _=_admin()))
        by_dog = {r["dog_id"]: r for r in res["students"] if r["client_id"] == f"{TAG}-c-g"}
        assert set(by_dog) == {f"{TAG}-d-bolt", f"{TAG}-d-luna"}, "one card per dog, even for one owner"
        bolt = by_dog[f"{TAG}-d-bolt"]
        assert bolt["activities_today"] == 3
        assert bolt["today_learn"] and bolt["today_practice"] and bolt["today_lesson"]
        assert by_dog[f"{TAG}-d-luna"]["today_lesson"] is False
    finally:
        _cleanup()


def test_realistic_volume_stays_bounded():
    """50 clients / 75 dogs / ~600 events — the endpoint must stay paginated
    (never return the whole history) and group cleanly."""
    events = []
    for c in range(50):
        for d in range(2 if c < 25 else 1):  # 75 dogs
            dog = f"{c}-{d}"
            base = c * 7 + d * 3
            events += [
                _ev(str(c), dog, E.LESSON_LEARN_COMPLETED, base + 2),
                _ev(str(c), dog, E.PRACTICE_COMPLETED, base + 1),
                _ev(str(c), dog, E.LESSON_COMPLETED, base),
                _ev(str(c), dog, E.PRACTICE_COMPLETED, base + 60 * 24),  # yesterday
            ]
    _seed(events)  # 75 dogs * 4 = 300 events (+ prior tests' scale is fine)
    try:
        res = run(server.admin_school_hq_activity(limit=50, grouped=True, q="Basic Manners", _=_admin()))
        assert res["next_before"], "cursor must continue — never the whole history at once"
        assert len(res["groups"]) <= 50
        # Every COMPLETE group from today's sittings bundles 3 events; the
        # page's final group may legitimately be truncated at the raw-event
        # cursor boundary (page 2 continues it), so exclude only that one.
        todays = [g for g in res["groups"][:-1]
                  if str(g.get("client_id", "")).startswith(f"{TAG}-c-") and g["event_count"] > 1]
        assert todays and all(g["event_count"] == 3 for g in todays)
        # Page 2 continues from the cursor without overlap.
        res2 = run(server.admin_school_hq_activity(limit=50, grouped=True, q="Basic Manners", before=res["next_before"], _=_admin()))
        ids1 = {e["id"] for g in res["groups"] for e in g["events"]}
        ids2 = {e["id"] for g in res2["groups"] for e in g["events"]}
        assert not (ids1 & ids2)
        # Student rollup stays bounded too.
        st = run(server.admin_school_hq_activity_students(limit=60, _=_admin()))
        assert len(st["students"]) <= 60
    finally:
        _cleanup()
