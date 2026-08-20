"""Whole-app gap closure — Action Required visibility for money actions.

Regression coverage for a defect found during browser QA of this candidate.

The candidate added two financial item types to Action Required: an open
Stripe dispute (section D) and a Shop refund awaiting entitlement
reconciliation (section F). Both were ranked with _pending_action_urgency,
which was written for BOOKINGS — it ranks by how close a requested
appointment is, and anything with no requested date falls into the bottom
band. With a realistic queue (236 pending actions on the QA database) the
dispute sorted at index 234 of 236 while the panel requests 50, so it was
counted in the badge and never rendered. A dispute has a hard evidence
deadline; missing it forfeits the money automatically.

Two things are asserted here:
  1. money actions are ranked by their own deadline, not by booking logic
  2. list truncation can never make a money category disappear entirely
"""
import contextlib
import datetime
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_GAP_VISIBILITY"


def _owner():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} owner",
            "email": f"{TAG.lower()}@example.invalid"}


def _iso(days_from_now):
    return (datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(days=days_from_now)).isoformat()


@contextlib.contextmanager
def _noise(n):
    """`n` ordinary pending actions that outrank nothing in particular but
    fill the page — the real-world condition that hid the dispute."""
    ids = []
    for i in range(n):
        bid = str(uuid.uuid4())
        run(server.db.bookings.insert_one({
            "id": bid, "gapvis": True, "status": "pending", "is_meet_greet": True,
            "client_id": str(uuid.uuid4()), "client_name": f"{TAG} noise {i}",
            "dog_id": str(uuid.uuid4()), "dog_name": f"{TAG} dog {i}",
            "date": server.business_today().isoformat(), "time": "08:00",
            "service_type": "daycare", "created_at": _iso(-30),
        }))
        ids.append(bid)
    try:
        yield
    finally:
        run(server.db.bookings.delete_many({"id": {"$in": ids}}))


@contextlib.contextmanager
def _dispute(evidence_due_in_days=5, first_seen_days_ago=0):
    did = f"dp_{uuid.uuid4().hex[:12]}"
    run(server.db.stripe_disputes.insert_one({
        "id": did, "gapvis": True, "status": "needs_response", "reason": "product_not_received",
        "amount": 125.0, "currency": "usd", "client_id": str(uuid.uuid4()),
        "charge_id": f"ch_{uuid.uuid4().hex[:12]}",
        "evidence_due_by": _iso(evidence_due_in_days),
        "first_seen_at": _iso(-first_seen_days_ago), "created_at": _iso(-first_seen_days_ago),
        "updated_at": _iso(-first_seen_days_ago),
    }))
    try:
        yield did
    finally:
        run(server.db.stripe_disputes.delete_one({"id": did}))


@contextlib.contextmanager
def _reconciliation():
    oid = str(uuid.uuid4())
    run(server.db.shop_orders.insert_one({
        "id": oid, "gapvis": True, "client_id": str(uuid.uuid4()), "client_name": f"{TAG} client",
        "status": "paid", "lines": [], "total": 45.0, "refunded_amount": 0.0,
        "refund_reconciliation_required": True,
        "refund_reconciliation_reason": "External Stripe refund has no shop line allocation",
        "created_at": _iso(-1), "updated_at": _iso(-1),
    }))
    try:
        yield oid
    finally:
        run(server.db.shop_orders.delete_one({"id": oid}))


def _actions(limit=50):
    return run(server._collect_pending_actions(_owner(), limit=limit))


def _types_in(res):
    return [i["type"] for i in res["items"]]


# ---------------------------------------------------------------------------
# Ranking — money actions use their own deadline
# ---------------------------------------------------------------------------

def test_a_money_action_never_lands_in_the_bottom_band():
    # This is the root cause: no requested date meant rank 3, dead last.
    out = server._financial_action_urgency(_iso(0))
    assert out["urgency_rank"] <= 2, "a money action fell into the bottom band"
    assert out["urgency_label"] == "ACTION REQUIRED — MONEY"


def test_a_dispute_escalates_as_its_evidence_deadline_approaches():
    far = server._financial_action_urgency(_iso(0), _iso(30))
    soon = server._financial_action_urgency(_iso(0), _iso(1))
    passed = server._financial_action_urgency(_iso(-5), _iso(-1))
    assert passed["urgency_rank"] < soon["urgency_rank"] <= far["urgency_rank"], (
        f"escalation is not monotonic: passed={passed['urgency_rank']} "
        f"soon={soon['urgency_rank']} far={far['urgency_rank']}")
    assert passed["urgency_rank"] == 0


def test_money_actions_are_labelled_as_money_not_as_bookings():
    # The booking wording ("REQUESTED FOR TODAY") is meaningless on a dispute.
    passed = server._financial_action_urgency(_iso(-5), _iso(-1))
    soon = server._financial_action_urgency(_iso(0), _iso(1))
    none = server._financial_action_urgency(_iso(0))
    for out in (passed, soon, none):
        assert "REQUESTED" not in out["urgency_label"], out["urgency_label"]
    assert passed["urgency_label"] == "OVERDUE — EVIDENCE DUE"
    assert none["urgency_label"] == "ACTION REQUIRED — MONEY"


def test_a_malformed_evidence_deadline_is_ignored_rather_than_crashing():
    out = server._financial_action_urgency(_iso(0), "not-a-date")
    assert out["urgency_rank"] <= 2


# ---------------------------------------------------------------------------
# Truncation — a money category can never disappear
# ---------------------------------------------------------------------------

def test_a_dispute_stays_visible_behind_a_full_page_of_other_work():
    # The exact failure: the badge counted it, the list never rendered it.
    with _noise(80), _dispute() as did:
        res = _actions(limit=50)
        assert len(res["items"]) == 50, "page size honoured"
        assert res["counts"]["stripe_dispute"] == 1, "counted"
        assert "stripe_dispute" in _types_in(res), "counted but not rendered"
        assert any(i["id"].endswith(did) for i in res["items"])


def test_a_refund_reconciliation_stays_visible_behind_a_full_page():
    with _noise(80), _reconciliation() as oid:
        res = _actions(limit=50)
        assert "shop_refund_reconciliation" in _types_in(res)
        assert any(oid in i["id"] for i in res["items"])


def test_both_money_types_survive_together():
    with _noise(120), _dispute(), _reconciliation():
        res = _actions(limit=50)
        types = _types_in(res)
        assert "stripe_dispute" in types
        assert "shop_refund_reconciliation" in types


def test_guaranteeing_money_items_does_not_break_the_page_size():
    with _noise(80), _dispute(), _reconciliation():
        for limit in (1, 10, 50, 100):
            res = _actions(limit=limit)
            assert len(res["items"]) <= max(1, limit), f"page overflowed at limit={limit}"


def test_the_page_is_still_ordered_by_urgency():
    with _noise(60), _dispute(), _reconciliation():
        res = _actions(limit=50)
        ranks = [i["urgency_rank"] for i in res["items"]]
        assert ranks == sorted(ranks), "the page is no longer in operational order"


def test_counts_still_describe_the_whole_queue_not_the_page():
    with _noise(80), _dispute(), _reconciliation():
        res = _actions(limit=50)
        assert res["counts"]["total"] > len(res["items"]), "counts must cover everything"
        assert res["counts"]["stripe_dispute"] == 1
        assert res["counts"]["shop_refund_reconciliation"] == 1


def test_no_money_item_is_ever_duplicated_into_the_page():
    with _noise(80), _dispute(), _reconciliation():
        res = _actions(limit=50)
        ids = [i["id"] for i in res["items"]]
        assert len(ids) == len(set(ids)), "an item was carried into the page twice"


def test_a_quiet_queue_is_unaffected():
    # With room to spare the behaviour is exactly as before.
    with _dispute(), _reconciliation():
        res = _actions(limit=50)
        types = _types_in(res)
        assert "stripe_dispute" in types and "shop_refund_reconciliation" in types
        ranks = [i["urgency_rank"] for i in res["items"]]
        assert ranks == sorted(ranks)


def test_a_type_filter_still_returns_only_that_type():
    with _noise(20), _dispute(), _reconciliation():
        res = run(server._collect_pending_actions(_owner(), type_filter="stripe_dispute", limit=50))
        assert set(_types_in(res)) == {"stripe_dispute"}


def test_the_always_visible_set_is_money_only():
    # A guarantee this strong must stay narrow: it is not a way to promote
    # ordinary work above everything else.
    assert server._ALWAYS_VISIBLE_ACTION_TYPES == frozenset(
        {"stripe_dispute", "shop_refund_reconciliation"})
