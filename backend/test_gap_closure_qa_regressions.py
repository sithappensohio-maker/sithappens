"""QA regressions for defects found while reviewing the whole-app gap-closure
candidate.

Each test here corresponds to a confirmed defect in the delivered candidate,
pinned so it cannot silently return. These are deliberately separate from
test_whole_app_gap_closure.py (the candidate's own suite) so the QA findings
stay distinguishable from what was shipped.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "GAPQA"


def _id(prefix):
    return f"{TAG}-{prefix}-{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
def _clean():
    yield
    for coll in ("stripe_disputes", "payments", "retail_sales", "expenses",
                 "stripe_balance_transactions", "stripe_payouts"):
        run(server.db[coll].delete_many({"$or": [
            {"id": {"$regex": TAG}},
            {"stripe_dispute_id": {"$regex": TAG}},
            {"payment_id": {"$regex": TAG}},
        ]}))


# ---------------------------------------------------------------------------
# Defect 1 — the FIRST event for any dispute crashed before it was recorded
# ---------------------------------------------------------------------------

def test_first_dispute_event_inserts_without_update_path_conflict():
    """created_at/first_seen_at were written by BOTH $set and $setOnInsert.

    Mongo rejects that with "Updating the path 'created_at' would create a
    conflict at 'created_at'", so the very first webhook for every dispute
    raised and nothing was persisted — the dispute feature could never record
    a single case. This pins the insert path on its own, rather than only
    catching it downstream of a loss/win sequence.
    """
    did, intent = _id("dp"), _id("pi")
    created = {"id": did, "amount": 5000, "currency": "usd", "status": "warning_needs_response",
               "reason": "fraudulent", "payment_intent": intent}

    run(server._handle_stripe_dispute_event(created))  # must not raise

    row = run(server.db.stripe_disputes.find_one({"id": did}, {"_id": 0}))
    assert row is not None, "the first dispute event must actually persist the dispute"
    assert row["created_at"] and row["first_seen_at"]
    assert row["status"] == "warning_needs_response"
    # …and nothing financial happens while the dispute is merely open.
    assert run(server.db.retail_sales.count_documents({"stripe_dispute_id": did})) == 0


def test_dispute_created_at_is_stamped_once_and_never_rewritten():
    """$setOnInsert must own the timestamp: a later event updates status but
    must not move created_at, or dispute age/reporting would drift."""
    did, intent = _id("dp"), _id("pi")
    run(server._handle_stripe_dispute_event(
        {"id": did, "amount": 5000, "currency": "usd", "status": "warning_needs_response",
         "reason": "fraudulent", "payment_intent": intent}))
    first = run(server.db.stripe_disputes.find_one({"id": did}, {"_id": 0}))

    run(server._handle_stripe_dispute_event(
        {"id": did, "amount": 5000, "currency": "usd", "status": "under_review",
         "reason": "fraudulent", "payment_intent": intent}))
    later = run(server.db.stripe_disputes.find_one({"id": did}, {"_id": 0}))

    assert later["created_at"] == first["created_at"], "created_at must be immutable"
    assert later["first_seen_at"] == first["first_seen_at"]
    assert later["status"] == "under_review", "but status still advances"
    assert run(server.db.stripe_disputes.count_documents({"id": did})) == 1, "no duplicate row"


def test_full_dispute_lifecycle_out_of_order_never_double_counts():
    """created -> updated -> lost, with replays interleaved, and a late
    duplicate of an earlier state arriving after the close."""
    pid, intent, did = _id("payment"), _id("pi"), _id("dp")
    run(server.db.payments.insert_one({
        "id": pid, "amount": 80.0, "method": "stripe_online", "status": "succeeded",
        "processor": "stripe", "processor_payment_id": intent, "client_id": _id("client")}))

    base = {"id": did, "amount": 8000, "currency": "usd", "reason": "fraudulent", "payment_intent": intent}
    for status in ("warning_needs_response", "warning_needs_response", "under_review", "lost", "lost", "lost"):
        run(server._handle_stripe_dispute_event({**base, "status": status}))
    # a stale earlier event replayed AFTER the close must not resurrect or re-charge
    run(server._handle_stripe_dispute_event({**base, "status": "under_review"}))

    rows = run(server.db.retail_sales.find({"stripe_dispute_id": did}, {"_id": 0}).to_list(10))
    assert len(rows) == 1 and rows[0]["amount"] == -80.0, "exactly one negative finance row"
    payment = run(server.db.payments.find_one({"id": pid}, {"_id": 0}))
    assert payment["amount"] == 80.0 and payment["status"] == "succeeded", "original payment untouched"


# ---------------------------------------------------------------------------
# Defect 2 — Online School program checkout raised NameError on every purchase
# ---------------------------------------------------------------------------
#
# The agreement gate added to _validate_shop_item_eligibility referenced
# `client_id`, a name that does not exist in that function's scope (it
# receives the client DOCUMENT as `client`). Every Online School program
# checkout therefore raised NameError before reaching Stripe.
#
# Regression coverage for this one deliberately lives in the EXISTING suites
# rather than being duplicated here: test_online_school_phase5.py,
# test_online_school_phase6.py and test_school_prerequisites_and_snapshot.py
# exercise the real checkout end-to-end and all 12 of their failures were
# caused by exactly this bug. They are far better guards than a synthetic
# item-shape fixture would be, and they already gate every future change to
# this path.
