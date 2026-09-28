"""The Shop takes cards only, and money that arrives after an order was
cancelled is flagged for staff, never ignored (audit #62).

Before: whatever Stripe had switched on was offered, including bank payments
that clear days later; the order-status check cancelled such an order while
the payment was still clearing, and when the money landed the app ignored it
— the customer was charged for a cancelled order whose items went back on
sale.

Owner decision 2026-09-28 (option B): cards only (Apple Pay / Google Pay are
cards), a completed checkout is never written off as abandoned, and a Shop
payment the app can't record shows in Front Desk → Online payments ("Paid
online, not recorded yet") and Action Required with Refund (and Retry where
it can still be recorded).

Self-contained fixtures (never import another test module). Stripe is
always faked.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

from domains.billing import resolve
from domains.shop import abandon

TAG = "TEST_SHOP_CARD_ONLY"
ADMIN = {"id": "cardonly-admin", "role": "admin", "name": f"{TAG} admin", "email": "co@test"}


class _Obj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e

    def to_dict(self):
        return dict(self)


@contextlib.contextmanager
def _stripe(retrieve=None, refund_status="succeeded", refunded_cents=0, disputed=False):
    s = server.stripe
    saved = (s.Customer.create, s.checkout.Session.create, s.checkout.Session.retrieve, s.Refund.create,
             s.PaymentIntent.retrieve, server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY)
    calls = {"create": [], "refund": []}

    def _create(**kw):
        calls["create"].append(kw)
        return _Obj(id="cs_fake_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/fake")

    def _refund(**kw):
        calls["refund"].append(kw)
        return _Obj(id="re_fake_" + uuid.uuid4().hex[:6], status=refund_status)

    s.Customer.create = lambda **kw: _Obj(id="cus_fake_" + uuid.uuid4().hex[:8])
    s.checkout.Session.create = _create
    s.checkout.Session.retrieve = lambda sid, *a, **k: _Obj({**(retrieve or (lambda x: {}))(sid), "id": sid})
    s.Refund.create = _refund
    s.PaymentIntent.retrieve = lambda pid, *a, **k: _Obj(id=pid, status="succeeded", latest_charge={
        "amount_refunded": refunded_cents() if callable(refunded_cents) else refunded_cents, "disputed": disputed})
    server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY = True, server.STRIPE_SECRET_KEY or "sk_test_fake"
    try:
        yield calls
    finally:
        (s.Customer.create, s.checkout.Session.create, s.checkout.Session.retrieve, s.Refund.create,
         s.PaymentIntent.retrieve, server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY) = saved


@contextlib.contextmanager
def _order(status="pending_payment", attempt_status="pending", minutes_past_expiry=5):
    """A Shop order and its Stripe attempt, as the checkout leaves them."""
    oid, aid, sid = str(uuid.uuid4()), str(uuid.uuid4()), "cs_fake_" + uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    run(server.db.shop_orders.insert_one({
        "id": oid, "tag": TAG, "client_id": None, "client_name": f"{TAG} Buyer", "status": status,
        "lines": [], "total": 20.0, "created_at": now.isoformat()}))
    run(server.db.shop_payment_attempts.insert_one({
        "id": aid, "shop_order_id": oid, "status": attempt_status, "amount_cents": 2000,
        "stripe_checkout_session_id": sid, "created_at": now.isoformat(),
        "expires_at": (now - timedelta(minutes=minutes_past_expiry)).isoformat()}))
    try:
        yield {"order_id": oid, "attempt_id": aid, "session_id": sid}
    finally:
        run(server.db.shop_orders.delete_many({"id": oid}))
        run(server.db.shop_payment_attempts.delete_many({"id": aid}))


def _attempt(o):
    return run(server.db.shop_payment_attempts.find_one({"id": o["attempt_id"]}, {"_id": 0}))


def _shop_order(o):
    return run(server.db.shop_orders.find_one({"id": o["order_id"]}, {"_id": 0}))


def _paid_event(o):
    return {"id": o["session_id"], "payment_status": "paid", "payment_intent": "pi_fake_1", "amount_total": 2000}


def _refused(fn):
    with pytest.raises(HTTPException) as exc:
        fn()
    return exc.value


def test_the_shop_card_page_offers_cards_only():
    with _stripe() as calls:
        cid = run(server.create_client(server.ClientIn(name=f"{TAG} Buyer", email=f"{uuid.uuid4().hex[:8]}@example.com"),
                                       ADMIN))["id"]
        product = run(server.create_pos_product(server.PosProductCreateIn(
            name=f"{TAG} {uuid.uuid4().hex[:6]}", price=10.0, show_online=True, active=True,
            track_inventory=True, starting_stock=3), ADMIN))
        user = {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": "Buyer"}
        try:
            run(server.create_shop_checkout(server.ShopCheckoutIn(
                items=[server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
                idempotency_key=f"k-{uuid.uuid4().hex}"), user))
            assert calls["create"] and calls["create"][-1].get("payment_method_types") == ["card"]
        finally:
            orders = [x["id"] for x in run(server.db.shop_orders.find({"client_id": cid}, {"_id": 0, "id": 1}).to_list(10))]
            run(server.db.shop_orders.delete_many({"client_id": cid}))
            run(server.db.shop_payment_attempts.delete_many({"shop_order_id": {"$in": orders}}))
            run(server.db.shop_checkout_claims.delete_many({"client_id": cid}))
            run(server.db.pos_products.delete_many({"id": product["id"]}))
            run(server.db.clients.delete_many({"id": cid}))


def test_a_completed_checkout_still_clearing_is_never_written_off():
    with _order() as o, _stripe(retrieve=lambda sid: {"status": "complete", "payment_status": "unpaid"}):
        run(server._verify_and_reconcile_shop_session(_attempt(o)))
        assert _attempt(o)["status"] == "pending"
        assert _shop_order(o)["status"] == "pending_payment", "not cancelled while the payment clears"


def test_an_expired_checkout_is_still_let_go():
    with _order() as o, _stripe(retrieve=lambda sid: {"status": "expired", "payment_status": "unpaid"}):
        run(server._verify_and_reconcile_shop_session(_attempt(o)))
        assert _attempt(o)["status"] == "expired" and _shop_order(o)["status"] == "canceled"


def test_money_arriving_after_the_order_was_cancelled_is_flagged_not_ignored():
    with _order(status="canceled", attempt_status="expired") as o, _stripe():
        before = run(resolve.pending_action_count())
        run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
        a = _attempt(o)
        assert a["status"] == "reconciliation_required" and a["paid_after_close"] == "expired"
        assert a["stripe_payment_intent_id"] == "pi_fake_1"
        assert _shop_order(o)["status"] == "canceled", "the order is not revived"
        assert _shop_order(o)["paid_after_cancel"]["amount_cents"] == 2000
        row = next(r for r in run(resolve.stuck_payments()) if r["id"] == o["attempt_id"])
        assert row["kind"] == "shop" and row["reason_code"] == "paid_after_cancel"
        assert row["can_refund"] is True and row["can_retry"] is False and row["amount"] == 20.0
        assert run(resolve.pending_action_count()) == before + 1
        item = next(i for i in run(resolve.pending_action_items()) if i["id"] == f"online_payment_stuck:{o['attempt_id']}")
        assert "Shop order #" in item["service_name"]
        # a repeated notification changes nothing and never tries to record it on the cancelled order
        run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
        assert _attempt(o)["status"] == "reconciliation_required"
        assert _refused(lambda: run(resolve.retry_payment(o["attempt_id"]))).status_code == 409


def test_staff_can_refund_it_in_one_step():
    with _order(status="canceled", attempt_status="expired") as o, _stripe() as calls:
        run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
        out = run(resolve.refund_payment(o["attempt_id"], ADMIN))
        assert out["refunded"] is True
        assert calls["refund"][-1]["payment_intent"] == "pi_fake_1"
        assert _attempt(o)["status"] == "refunded"
        assert _shop_order(o)["paid_after_cancel"].get("refunded_at")
        assert all(r["id"] != o["attempt_id"] for r in run(resolve.stuck_payments())), "off the list"
        # a late notification about the refunded payment changes nothing
        run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
        assert _attempt(o)["status"] == "refunded"


def test_a_failed_refund_puts_it_back_in_the_list():
    with _order(status="canceled", attempt_status="expired") as o, _stripe(refund_status="failed"):
        run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
        assert _refused(lambda: run(resolve.refund_payment(o["attempt_id"], ADMIN))).status_code == 502
        assert _attempt(o)["status"] == "reconciliation_required"
        assert any(r["id"] == o["attempt_id"] for r in run(resolve.stuck_payments()))


# ─────────────────────────────── review follow-ups ───────────────────────────────

def test_refunding_a_payment_for_an_order_never_completed_closes_it_and_frees_the_item():
    pid = str(uuid.uuid4())
    with _order() as o, _stripe():
        ref = server._shop_inventory_ref(o["order_id"], "i1")
        run(server.db.pos_products.insert_one({
            "id": pid, "name": f"{TAG} leash", "price": 20.0, "active": True, "track_inventory": True,
            "stock_on_hand": 1, "stock_reserved": 1,
            "shop_reservations": [{"ref": ref, "order_id": o["order_id"], "item_id": "i1", "quantity": 1, "state": "reserved"}]}))
        run(server.db.shop_orders.update_one({"id": o["order_id"]}, {"$set": {
            "stripe_active_attempt_id": o["attempt_id"],
            "lines": [{"kind": "product", "item_id": "i1", "ref_id": pid, "quantity": 1, "name": "leash"}]}}))
        # the payment landed but couldn't be recorded on the order
        run(server.db.shop_payment_attempts.update_one({"id": o["attempt_id"]}, {"$set": {
            "status": "reconciliation_required", "stripe_payment_intent_id": "pi_fake_2"}}))
        try:
            row = next(r for r in run(resolve.stuck_payments()) if r["id"] == o["attempt_id"])
            assert row["reason_code"] == "ready"
            run(resolve.refund_payment(o["attempt_id"], ADMIN))
            assert _shop_order(o)["status"] == "canceled", "not left waiting for payment"
            product = run(server.db.pos_products.find_one({"id": pid}, {"_id": 0}))
            assert float(product["stock_reserved"]) == 0.0, "the item goes back on sale"
        finally:
            run(server.db.pos_products.delete_many({"id": pid}))


def test_a_payment_already_refunded_in_stripe_is_marked_refunded_without_refunding_again():
    with _order(status="canceled", attempt_status="expired") as o, _stripe(refunded_cents=2000) as calls:
        run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
        run(resolve.refund_payment(o["attempt_id"], ADMIN))
        assert calls["refund"] == [], "the money is already back"
        assert _attempt(o)["status"] == "refunded"


def test_a_disputed_payment_waits_for_the_bank_then_can_be_closed():
    with _order(status="canceled", attempt_status="expired") as o, _stripe(disputed=True) as calls:
        run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
        did = str(uuid.uuid4())
        run(server.db.stripe_disputes.insert_one({"id": did, "stripe_payment_intent_id": "pi_fake_1", "status": "needs_response"}))
        try:
            row = next(r for r in run(resolve.stuck_payments()) if r["id"] == o["attempt_id"])
            assert row["reason_code"] == "dispute_open" and not (row["can_refund"] or row["can_retry"] or row["can_close"])
            assert _refused(lambda: run(resolve.refund_payment(o["attempt_id"], ADMIN))).status_code == 409
            assert calls["refund"] == []
            run(server.db.stripe_disputes.update_one({"id": did}, {"$set": {"status": "lost"}}))
            row = next(r for r in run(resolve.stuck_payments()) if r["id"] == o["attempt_id"])
            assert row["reason_code"] == "dispute_lost" and row["can_close"] is True
            run(resolve.close_disputed_payment(o["attempt_id"], ADMIN))
            assert _attempt(o)["status"] == "disputed"
            assert all(r["id"] != o["attempt_id"] for r in run(resolve.stuck_payments()))
        finally:
            run(server.db.stripe_disputes.delete_many({"id": did}))


def test_after_a_failed_refund_the_next_press_is_a_new_refund_not_a_replay():
    with _order(status="canceled", attempt_status="expired") as o:
        with _stripe(refund_status="failed") as calls:
            run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
            _refused(lambda: run(resolve.refund_payment(o["attempt_id"], ADMIN)))
            first_key = calls["refund"][-1]["idempotency_key"]
        with _stripe() as calls:
            run(resolve.refund_payment(o["attempt_id"], ADMIN))
            assert calls["refund"][-1]["idempotency_key"] != first_key
            assert _attempt(o)["status"] == "refunded"


def test_a_dispute_that_ended_our_way_no_longer_blocks_the_refund():
    for status in ("won", "warning_closed"):
        with _order(status="canceled", attempt_status="expired") as o, _stripe(disputed=True) as calls:
            run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))
            did = str(uuid.uuid4())
            run(server.db.stripe_disputes.insert_one({"id": did, "stripe_payment_intent_id": "pi_fake_1", "status": status}))
            try:
                row = next(r for r in run(resolve.stuck_payments()) if r["id"] == o["attempt_id"])
                assert row["reason_code"] == "paid_after_cancel" and row["can_refund"] is True, status
                run(resolve.refund_payment(o["attempt_id"], ADMIN))
                assert _attempt(o)["status"] == "refunded" and calls["refund"], status
            finally:
                run(server.db.stripe_disputes.delete_many({"id": did}))


def test_a_payment_closed_after_a_lost_dispute_stays_closed_when_stripe_resends_the_payment():
    with _order() as o, _stripe(disputed=True):
        run(server.db.shop_payment_attempts.update_one({"id": o["attempt_id"]}, {"$set": {
            "status": "reconciliation_required", "stripe_payment_intent_id": "pi_fake_1"}}))
        did = str(uuid.uuid4())
        run(server.db.stripe_disputes.insert_one({"id": did, "stripe_payment_intent_id": "pi_fake_1", "status": "lost"}))
        try:
            run(resolve.close_disputed_payment(o["attempt_id"], ADMIN))
            assert _attempt(o)["status"] == "disputed"
            run(server._handle_shop_checkout_session_paid_event(_paid_event(o)))   # Stripe resends
            assert _attempt(o)["status"] == "disputed"
            assert all(r["id"] != o["attempt_id"] for r in run(resolve.stuck_payments()))
        finally:
            run(server.db.stripe_disputes.delete_many({"id": did}))
