"""Checking out a Board & Train stay that has gaps in it.

Finishing the training is still the only ordinary way through checkout. What
these tests pin is the way out when it was not finished — because an owner who
collects their dog two days early leaves sessions that were never going to
happen, and before this the stay simply could not be checked out at all.

The rules that matter here:
  * nothing is waived silently — every missing session needs an answer;
  * the three answers stay distinct, because "you cut the stay short", "we did
    not deliver it" and "we did it but nobody wrote it up" are different
    conversations and only one of them is our fault;
  * an answer is never a training record. Saying a session happened does not
    invent a score, an outcome or a lesson advance for a dog.
"""
import datetime as dt

import pytest
from fastapi import HTTPException
from _test_loop import run

from domains.training import services as training


ACTOR = {"id": "u-front-desk", "name": "Dana at the desk"}


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, _limit):
        return [dict(r) for r in self._rows]


class _Drafts:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None):
        days = (query.get("occurrence_date") or {})
        wanted = days.get("$in") if isinstance(days, dict) else None
        out = []
        for row in self.rows:
            if query.get("booking_id") and row.get("booking_id") != query["booking_id"]:
                continue
            if wanted is not None and row.get("occurrence_date") not in wanted:
                continue
            if isinstance(days, str) and row.get("occurrence_date") != days:
                continue
            out.append(row)
        return _Cursor(out)


class _Bookings:
    def __init__(self, booking):
        self.doc = booking
        self.updates = []

    async def find_one(self, query, projection=None):
        return dict(self.doc) if query.get("id") == self.doc["id"] else None

    async def update_one(self, query, update):
        # Honour the {"$exists": False} guard the closeout writer relies on.
        for key, cond in query.items():
            if isinstance(cond, dict) and cond.get("$exists") is False:
                cur = self.doc
                for part in key.split("."):
                    cur = (cur or {}).get(part) if isinstance(cur, dict) else None
                if cur is not None:
                    return type("R", (), {"modified_count": 0})()
        self.updates.append(update)
        for path, value in (update.get("$set") or {}).items():
            cur = self.doc
            parts = path.split(".")
            for part in parts[:-1]:
                cur = cur.setdefault(part, {})
            cur[parts[-1]] = value
        for path, value in (update.get("$push") or {}).items():
            self.doc.setdefault(path, []).append(value)
        return type("R", (), {"modified_count": 1})()


class _Simple:
    def __init__(self, rows):
        self.rows = rows

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                return dict(row)
        return None


class _DB:
    def __init__(self, booking, drafts):
        self.bookings = _Bookings(booking)
        self.training_session_drafts = _Drafts(drafts)
        self.services = _Simple([{"id": "svc-bt", "name": "Two Week Board & Train",
                                  "package_program_id": "prog-bt"}])
        self.programs = _Simple([{"id": "prog-bt", "name": "Two Week Board & Train",
                                  "type": "board_train", "estimated_weeks": 1}])


def _draft(day, slot, state="completed"):
    return {"draft_id": f"{day}-{slot}", "booking_id": "bk-1", "occurrence_date": day,
            "session_label": slot, "state": state}


def _setup(*, days=3, drafts=None, closeouts=None):
    start = dt.date(2026, 9, 10)
    booking = {
        "id": "bk-1", "service_type": "training", "service_id": "svc-bt",
        "dog_name": "Luna", "date": start.isoformat(),
        "end_date": (start + dt.timedelta(days=days)).isoformat(),
        "training_daily_closeouts": dict(closeouts or {}),
    }
    return _DB(booking, list(drafts or []))


def _ready(db, **over):
    return run(training.ensure_board_train_checkout_ready(
        db=db, booking=db.bookings.doc, business_day="2026-09-13", **over))


# ------------------------------------------------------------------ blocking

def test_a_stay_with_missing_sessions_still_cannot_be_checked_out_silently():
    db = _setup()
    with pytest.raises(HTTPException) as e:
        _ready(db)
    assert e.value.status_code == 409
    detail = e.value.detail
    assert detail["code"] == "board_train_training_incomplete"
    # three days, two sessions each, none recorded
    assert len(detail["unresolved_sessions"]) == 6
    assert db.bookings.updates == [], "a blocked checkout must not write anything"


def test_the_block_says_which_sessions_and_what_can_be_said_about_them():
    db = _setup()
    with pytest.raises(HTTPException) as e:
        _ready(db)
    detail = e.value.detail
    first = detail["unresolved_sessions"][0]
    assert set(first) == {"date", "slot", "status"}
    assert first["date"] == "2026-09-10" and first["slot"] == "AM"
    offered = {r["value"] for r in detail["resolutions"]}
    assert offered == {"ended_early", "not_delivered", "recorded_late"}
    # the screen never has to invent the wording
    assert all(r["label"] for r in detail["resolutions"])


def test_answering_some_but_not_all_asks_only_for_what_is_left():
    db = _setup(days=2)
    with pytest.raises(HTTPException) as e:
        _ready(db, resolutions=[{"date": "2026-09-10", "slot": "AM", "outcome": "not_delivered"}],
               actor=ACTOR)
    left = e.value.detail["unresolved_sessions"]
    assert {(s["date"], s["slot"]) for s in left} == {
        ("2026-09-10", "PM"), ("2026-09-11", "AM"), ("2026-09-11", "PM")}
    assert "still need an answer" in e.value.detail["message"]


def test_an_invented_answer_is_refused():
    db = _setup(days=1)
    for bad in ("waived", "", "COMPLETED"):
        with pytest.raises(HTTPException) as e:
            _ready(db, resolutions=[{"date": "2026-09-10", "slot": "AM", "outcome": bad}])
        assert e.value.status_code == 400


# ----------------------------------------------------------------- resolving

def _answer_everything(db, outcome, days=("2026-09-10",)):
    return _ready(db, actor=ACTOR, resolutions=[
        {"date": d, "slot": s, "outcome": outcome} for d in days for s in ("AM", "PM")
    ])


def test_an_early_pickup_can_be_checked_out_once_it_is_accounted_for():
    db = _setup(days=1)
    record = _answer_everything(db, "ended_early")
    assert record["counts"]["ended_early"] == 2
    assert record["by_name"] == "Dana at the desk"
    assert record["days_closed"] == ["2026-09-10"]
    # A second attempt — a retry after the card declined, say — must not ask
    # the same questions again, and must not overwrite who answered them.
    again = _ready(db)
    assert again["id"] == record["id"] and again["by_name"] == "Dana at the desk"
    assert len(db.bookings.doc["board_train_checkout_resolution_history"]) == 1


def test_the_three_answers_are_recorded_apart_from_each_other():
    db = _setup(days=2)
    record = _ready(db, actor=ACTOR, resolutions=[
        {"date": "2026-09-10", "slot": "AM", "outcome": "recorded_late"},
        {"date": "2026-09-10", "slot": "PM", "outcome": "not_delivered"},
        {"date": "2026-09-11", "slot": "AM", "outcome": "ended_early"},
        {"date": "2026-09-11", "slot": "PM", "outcome": "ended_early"},
    ])
    assert record["counts"] == {"ended_early": 2, "not_delivered": 1, "recorded_late": 1}
    outcomes = {(s["date"], s["slot"]): s["outcome"] for s in record["sessions"]}
    assert outcomes[("2026-09-10", "AM")] == "recorded_late"
    assert outcomes[("2026-09-10", "PM")] == "not_delivered"


def test_the_answer_is_written_on_the_booking_with_who_and_when():
    db = _setup(days=1)
    _answer_everything(db, "not_delivered")
    stamp = db.bookings.doc["board_train_checkout_resolution"]
    assert stamp["by"] == "u-front-desk" and stamp["by_name"] == "Dana at the desk"
    assert stamp["at"] and stamp["id"]
    assert db.bookings.doc["board_train_checkout_resolution_history"][-1]["id"] == stamp["id"]


def test_a_resolved_day_is_closed_out_as_a_counter_decision_not_as_trainer_work():
    # Nothing downstream may mistake this for a day the trainer finished.
    db = _setup(days=1)
    _answer_everything(db, "recorded_late")
    closeout = db.bookings.doc["training_daily_closeouts"]["2026-09-10"]
    assert closeout["status"] == "closed"
    assert closeout["mode"] == "checkout_resolution"
    assert closeout["mode"] != "automatic_after_required_sessions"
    assert closeout["session_outcomes"] == {"AM": "recorded_late", "PM": "recorded_late"}
    assert closeout["closed_by_name"] == "Dana at the desk"


def test_saying_a_session_happened_never_invents_a_training_record():
    # This is the line the feature must not cross: "done, not written up" is a
    # statement about paperwork. It must not produce a score, an outcome, a
    # mastery decision or any lesson movement for the dog.
    db = _setup(days=1)
    _answer_everything(db, "recorded_late")
    closeout = db.bookings.doc["training_daily_closeouts"]["2026-09-10"]
    forbidden = {"score", "outcome", "outcomes", "mastery_decision", "actuals",
                 "skills", "lesson_id", "advancement_action"}
    assert not (forbidden & set(closeout)), "a closeout must not carry assessment data"
    assert db.training_session_drafts.rows == [], "no session draft may be fabricated"


# -------------------------------------------------------- unaffected paths

def test_a_finished_stay_is_never_asked_anything():
    days = ["2026-09-10", "2026-09-11"]
    drafts = [_draft(d, s) for d in days for s in ("AM", "PM")]
    closeouts = {d: {"status": "closed", "mode": "automatic_after_required_sessions"} for d in days}
    db = _setup(days=2, drafts=drafts, closeouts=closeouts)
    assert _ready(db) is None
    assert db.bookings.updates == []


def test_a_day_that_was_worked_but_never_closed_out_is_not_a_question():
    # Both sessions are genuinely complete and only the closeout row is
    # missing. Asking "did this happen?" about work that demonstrably happened
    # would be nonsense, so the day is simply closed.
    drafts = [_draft("2026-09-10", s) for s in ("AM", "PM")]
    db = _setup(days=1, drafts=drafts)
    record = _ready(db, actor=ACTOR)
    assert record["sessions"] == [] and record["counts"]["not_delivered"] == 0
    closeout = db.bookings.doc["training_daily_closeouts"]["2026-09-10"]
    assert closeout["status"] == "closed"


def test_a_stay_that_is_not_board_and_train_is_left_completely_alone():
    db = _setup(days=3)
    db.bookings.doc["service_type"] = "boarding"
    assert _ready(db, resolutions=[{"date": "x", "slot": "AM", "outcome": "nonsense"}]) is None


def test_a_half_finished_day_only_asks_about_the_session_that_is_missing():
    db = _setup(days=1, drafts=[_draft("2026-09-10", "AM")])
    with pytest.raises(HTTPException) as e:
        _ready(db)
    left = e.value.detail["unresolved_sessions"]
    assert [(s["date"], s["slot"]) for s in left] == [("2026-09-10", "PM")]
    record = _ready(db, actor=ACTOR,
                    resolutions=[{"date": "2026-09-10", "slot": "PM", "outcome": "not_delivered"}])
    assert record["counts"]["not_delivered"] == 1
    assert record["sessions"] == [{"date": "2026-09-10", "slot": "PM", "outcome": "not_delivered"}]


def test_a_lowercase_slot_from_a_client_is_understood():
    db = _setup(days=1)
    record = _ready(db, actor=ACTOR, resolutions=[
        {"date": "2026-09-10", "slot": "am", "outcome": "ended_early"},
        {"date": "2026-09-10", "slot": "pm", "outcome": "ended_early"},
    ])
    assert record["counts"]["ended_early"] == 2


def test_the_checkout_body_carries_the_answers_and_validates_them():
    import _test_env  # noqa: F401
    import server
    body = server.CheckoutIn(board_train_resolution=[
        {"date": "2026-09-10", "slot": "AM", "outcome": "not_delivered"}])
    assert body.board_train_resolution[0].outcome == "not_delivered"
    assert server.CheckoutIn().board_train_resolution == [], "existing callers are unaffected"
