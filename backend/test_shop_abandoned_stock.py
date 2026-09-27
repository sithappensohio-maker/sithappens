"""Shop stock held by a checkout nobody will pay for is let go (audit #57).

Before: a checkout that stopped before reaching Stripe (the second item ran
short) kept what it had already held, forever; a checkout the buyer backed
out of stayed held until Stripe's "expired" webhook arrived — if it ever did.

Now: a checkout that stops early gives everything back (and the same basket
can be tried again), backing out closes the Stripe page and lets go at once,
and a scheduler sweep settles abandoned checkouts and repairs holds the old
code stranded. Stripe stays the authority: stock goes back only when Stripe
says the page expired — never out from under a real payment.

Self-contained fixtures (never import another test module). Stripe is
always faked.
"""
import contextlib
import os
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run

from domains.shop import abandon
from domains.shop import checkout as shop_checkout
from domains.shop import guest_routes

TAG = "TEST_SHOP_ABANDON"


class _Obj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e

    def to_dict(self):
        return dict(self)


class _Req:
    def __init__(self, headers=None):
        ip = f"198.20.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        self.client = type("C", (), {"host": ip})()
        self.headers = headers or {}
        self.url = type("U", (), {"path": "/api/public/shop/x"})()


def _route(name):
    for r in server.app.routes:
        if getattr(r, "name", None) == name:
            return r.endpoint
    raise AssertionError(f"route {name} is not registered")


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


@contextlib.contextmanager
def _stripe(expire=None, retrieve=None, intent=None, create=None):
    """Stripe, faked. `expire`/`retrieve` return the session Stripe would;
    `intent` the PaymentIntent; `create` runs inside Session.create."""
    s = server.stripe
    saved = (s.Customer.create, s.checkout.Session.create, s.checkout.Session.expire,
             s.checkout.Session.retrieve, s.PaymentIntent.retrieve,
             server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY)
    calls = {"expire": [], "retrieve": []}

    def _create(**kw):
        if create:
            create(kw)
        return _Obj(id="cs_fake_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/fake")

    def _expire(sid, *a, **k):
        calls["expire"].append(sid)
        if expire is None:
            raise RuntimeError("session is not open")
        return _Obj({**expire(sid), "id": sid})

    def _retrieve(sid, *a, **k):
        calls["retrieve"].append(sid)
        if retrieve is None:
            raise RuntimeError("Stripe is unreachable")
        return _Obj({**retrieve(sid), "id": sid})

    s.Customer.create = lambda **kw: _Obj(id="cus_fake_" + uuid.uuid4().hex[:8])
    s.checkout.Session.create = _create
    s.checkout.Session.expire = _expire
    s.checkout.Session.retrieve = _retrieve
    s.PaymentIntent.retrieve = lambda pid, *a, **k: _Obj({**(intent or (lambda p: {}))(pid), "id": pid})
    server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY = True, server.STRIPE_SECRET_KEY or "sk_test_fake"
    try:
        yield calls
    finally:
        (s.Customer.create, s.checkout.Session.create, s.checkout.Session.expire,
         s.checkout.Session.retrieve, s.PaymentIntent.retrieve,
         server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY) = saved


EXPIRED = lambda sid: {"status": "expired", "payment_status": "unpaid"}          # noqa: E731
PROCESSING = lambda sid: {"status": "complete", "payment_status": "unpaid"}      # noqa: E731


@contextlib.contextmanager
def _product(stock):
    created = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} {uuid.uuid4().hex[:6]}", price=10.0, show_online=True, active=True,
        track_inventory=True, starting_stock=stock, guest_cart_allowed=True, publicly_visible=True), _admin()))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))
        run(server.db.inventory_movements.delete_many({"source_ref": {"$regex": created["id"]}}))


@contextlib.contextmanager
def _client():
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Buyer", email=f"{uuid.uuid4().hex[:8]}@example.com"),
                                 _admin()))
    user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Buyer"}
    try:
        yield user
    finally:
        orders = [o["id"] for o in run(server.db.shop_orders.find({"client_id": c["id"]}, {"_id": 0, "id": 1}).to_list(100))]
        run(server.db.shop_orders.delete_many({"client_id": c["id"]}))
        run(server.db.shop_payment_attempts.delete_many({"shop_order_id": {"$in": orders}}))
        run(server.db.shop_checkout_claims.delete_many({"client_id": c["id"]}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@pytest.fixture(autouse=True)
def _cleanup_tagged():
    yield
    run(server.db.shop_orders.delete_many({"tag": TAG}))


def _held(p):
    doc = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
    live = [e for e in (doc.get("shop_reservations") or []) if e.get("state") == "reserved"]
    return float(doc.get("stock_reserved") or 0), len(live)


def _item(p, qty=1):
    return server.ShopCartItemIn(kind="product", ref_id=p["id"], quantity=qty)


def _checkout(user, items, key=None):
    return run(server.create_shop_checkout(server.ShopCheckoutIn(items=items, idempotency_key=key or f"k-{uuid.uuid4().hex}"), user))


def _attempt(order_id):
    return run(server.db.shop_payment_attempts.find_one({"shop_order_id": order_id}, {"_id": 0}))


# ─────────────────────────────────────── a checkout that stops early

# The early price check counts the shelf (2 bags of treats) but not what other
# checkouts hold (1 of them), so a basket for the leash + 2 treats passes it,
# holds the leash, and only then finds 1 treat free.

def test_a_checkout_that_stops_on_a_short_item_gives_back_what_it_held():
    with _client() as user, _product(5) as leash, _product(2) as treats, _stripe():
        _stranded_order(treats, minutes_old=5)            # somebody else is paying for one
        key = f"k-{uuid.uuid4().hex}"
        with pytest.raises(HTTPException) as e:
            _checkout(user, [_item(leash), _item(treats, 2)], key)
        assert e.value.status_code == 400 and "in stock" in e.value.detail
        assert _held(leash) == (0.0, 0), "the leash must not stay held by a checkout that never started"
        assert run(server.db.shop_orders.count_documents({"client_id": user["client_id"]})) == 0
        assert run(server.db.shop_checkout_claims.find_one({"idempotency_key": key})) is None
        # Every retry used to strand another one.
        for _ in range(3):
            with pytest.raises(HTTPException):
                _checkout(user, [_item(leash), _item(treats, 2)])
        assert _held(leash) == (0.0, 0)


def test_the_same_basket_goes_through_once_the_stock_is_there():
    with _client() as user, _product(5) as leash, _product(2) as treats, _stripe():
        _stranded_order(treats, minutes_old=5)
        key = f"k-{uuid.uuid4().hex}"
        with pytest.raises(HTTPException):
            _checkout(user, [_item(leash), _item(treats, 2)], key)
        run(server.db.pos_products.update_one({"id": treats["id"]}, {"$inc": {"stock_on_hand": 1}}))
        out = _checkout(user, [_item(leash), _item(treats, 2)], key)   # the very same key
        assert out["url"]
        assert _held(leash) == (1.0, 1) and _held(treats) == (3.0, 2)


# ─────────────────────────────────────── backing out of Stripe

def test_backing_out_of_stripe_gives_the_stock_back_now():
    with _client() as user, _product(1) as leash, _stripe(expire=EXPIRED) as calls:
        out = _checkout(user, [_item(leash)])
        assert _held(leash) == (1.0, 1)
        res = run(_route("cancel_shop_checkout")(out["order_id"], user))
        assert res["status"] == "canceled"
        assert calls["expire"], "the Stripe page is closed so it cannot be paid later"
        assert _held(leash) == (0.0, 0)
        assert _attempt(out["order_id"])["status"] == "expired"
        # Pressing it again is harmless.
        assert run(_route("cancel_shop_checkout")(out["order_id"], user))["status"] == "canceled"


def test_a_guest_backing_out_gives_the_stock_back_now_and_needs_the_token():
    with _product(1) as leash, _stripe(expire=EXPIRED):
        settings = run(server.get_settings())
        before = (settings.get("shop_page") or {}).copy()
        run(server.db.settings.update_one({}, {"$set": {"shop_page": {**before, "public_shop_enabled": True,
            "public_browsing_enabled": True, "show_public_prices": True, "show_public_merch": True}}}, upsert=True))
        try:
            out = run(_route("create_public_shop_checkout")(guest_routes.GuestCheckoutIn(
                items=[_item(leash)], idempotency_key=f"g-{uuid.uuid4().hex}", email="guest@example.com",
                name="Sam Guest"), _Req()))
            cancel = _route("cancel_public_shop_checkout")
            with pytest.raises(HTTPException) as e:
                run(cancel(out["order_id"], _Req({"x-guest-token": "wrong"})))
            assert e.value.status_code == 404 and _held(leash) == (1.0, 1)
            res = run(cancel(out["order_id"], _Req({"x-guest-token": out["guest_token"]})))
            assert res["status"] == "canceled" and _held(leash) == (0.0, 0)
        finally:
            run(server.db.settings.update_one({}, {"$set": {"shop_page": before}}, upsert=True))
            run(server.db.shop_orders.delete_many({"client_email": "guest@example.com"}))


def test_backing_out_never_cancels_a_payment_that_went_through():
    applied = []

    async def _reconcile(attempt):
        applied.append(attempt["id"])
        return attempt

    with _client() as user, _product(1) as leash, \
            _stripe(expire=None, retrieve=lambda sid: {"status": "complete", "payment_status": "paid"}):
        out = _checkout(user, [_item(leash)])
        saved = server._verify_and_reconcile_shop_session
        server._verify_and_reconcile_shop_session = _reconcile
        try:
            run(_route("cancel_shop_checkout")(out["order_id"], user))
        finally:
            server._verify_and_reconcile_shop_session = saved
        assert applied == [_attempt(out["order_id"])["id"]], "a paid page is applied, not cancelled"
        assert _held(leash) == (1.0, 1)


def test_a_bank_payment_still_processing_is_left_alone():
    with _client() as user, _product(1) as leash, _stripe(expire=None, retrieve=PROCESSING):
        out = _checkout(user, [_item(leash)])
        run(_route("cancel_shop_checkout")(out["order_id"], user))
        assert _held(leash) == (1.0, 1)
        assert _attempt(out["order_id"])["status"] == "pending"


def test_only_the_buyer_can_back_out_of_their_checkout():
    with _client() as user, _client() as stranger, _product(1) as leash, _stripe(expire=EXPIRED):
        out = _checkout(user, [_item(leash)])
        with pytest.raises(HTTPException) as e:
            run(_route("cancel_shop_checkout")(out["order_id"], stranger))
        assert e.value.status_code == 404 and _held(leash) == (1.0, 1)


# ─────────────────────────────────────── the sweep

def _age_attempt(order_id, minutes=40):
    past = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    run(server.db.shop_payment_attempts.update_many({"shop_order_id": order_id}, {"$set": {"expires_at": past}}))


def test_the_sweep_lets_go_of_a_checkout_nobody_came_back_to():
    with _client() as user, _product(1) as leash, _stripe(retrieve=EXPIRED):
        out = _checkout(user, [_item(leash)])
        _age_attempt(out["order_id"])
        run(abandon.sweep(stripe_limit=5000))
        assert _held(leash) == (0.0, 0)
        assert run(server.db.shop_orders.find_one({"id": out["order_id"]}))["status"] == "canceled"


def test_the_sweep_never_touches_a_live_checkout():
    with _client() as user, _product(1) as leash, _stripe(retrieve=EXPIRED) as calls:
        out = _checkout(user, [_item(leash)])
        run(abandon.sweep(stripe_limit=5000))
        assert _held(leash) == (1.0, 1) and calls["retrieve"] == []


def test_the_sweep_asks_stripe_about_a_waiting_payment_only_now_and_then():
    with _client() as user, _product(1) as leash, _stripe(retrieve=PROCESSING) as calls:
        out = _checkout(user, [_item(leash)])
        _age_attempt(out["order_id"])
        run(abandon.sweep(stripe_limit=5000))
        run(abandon.sweep(stripe_limit=5000))
        mine = [s for s in calls["retrieve"] if s == _attempt(out["order_id"])["stripe_checkout_session_id"]]
        assert len(mine) == 1 and _held(leash) == (1.0, 1)


def test_the_sweep_survives_stripe_being_down():
    with _client() as user, _product(1) as leash, _stripe(retrieve=None):
        out = _checkout(user, [_item(leash)])
        _age_attempt(out["order_id"])
        res = run(abandon.sweep(stripe_limit=5000))
        assert res["errors"] >= 1 and _held(leash) == (1.0, 1)


def _stranded_order(p, *, status="pending_payment", minutes_old=120, with_order=True, qty=1):
    """A hold the old code left behind: an order that never reached Stripe."""
    oid = str(uuid.uuid4())
    item_id = "li-" + uuid.uuid4().hex[:6]
    created = (datetime.now(timezone.utc) - timedelta(minutes=minutes_old)).isoformat()
    ref = server._shop_inventory_ref(oid, item_id)
    if with_order:
        run(server.db.shop_orders.insert_one({
            "id": oid, "tag": TAG, "status": status, "client_id": None, "created_at": created,
            "lines": [{"item_id": item_id, "kind": "product", "ref_id": p["id"], "quantity": qty,
                       "name": "Stranded", "fulfillment_status": "pending"}]}))
    run(server.db.pos_products.update_one({"id": p["id"]}, {
        "$inc": {"stock_reserved": qty},
        "$push": {"shop_reservations": {"ref": ref, "order_id": oid, "item_id": item_id, "quantity": qty,
                                        "state": "reserved", "created_at": created, "updated_at": created}}}))
    return oid


def test_the_sweep_repairs_holds_the_old_code_stranded():
    with _product(5) as leash, _stripe():
        never_paid = _stranded_order(leash)                                  # never reached Stripe
        gone = _stranded_order(leash, with_order=False)                       # order deleted since
        dead = _stranded_order(leash, status="canceled")                      # cancelled, hold left behind
        paid = _stranded_order(leash, status="paid")                          # awaiting its commit — keep
        recent = _stranded_order(leash, minutes_old=5)                        # still checking out — keep
        assert _held(leash) == (5.0, 5)
        run(abandon.sweep(stripe_limit=5000))
        assert _held(leash) == (2.0, 2)
        assert run(server.db.shop_orders.find_one({"id": never_paid}))["status"] == "canceled"
        doc = run(server.db.pos_products.find_one({"id": leash["id"]}, {"_id": 0}))
        live = {e["order_id"] for e in doc["shop_reservations"] if e["state"] == "reserved"}
        assert live == {paid, recent} and gone not in live and dead not in live


def test_the_sweep_is_a_scheduled_job():
    assert "shop_abandoned_checkouts" in [n for n, _ in server._scheduler_jobs()]



# ─────────────────────────────────────── review follow-ups

def _order_with_hold(p, *, pointer=None, minutes_old=120, qty=1):
    oid = _stranded_order(p, minutes_old=minutes_old, qty=qty)
    if pointer:
        run(server.db.shop_orders.update_one({"id": oid}, {"$set": {"stripe_active_attempt_id": pointer}}))
    return oid


def test_a_rollback_never_takes_holds_from_a_same_key_checkout_already_paying():
    # A double submit: the other request already took this order to Stripe.
    with _product(3) as leash:
        oid = _order_with_hold(leash, pointer="att-live", minutes_old=0)
        key = f"k-dbl-{uuid.uuid4().hex}"
        run(server.db.shop_checkout_claims.insert_one({"id": uuid.uuid4().hex, "idempotency_key": key,
                                                       "shop_order_id": oid, "client_id": None}))
        try:
            run(abandon.rollback_unstarted(oid, key))
            assert _held(leash) == (1.0, 1)
            assert run(server.db.shop_orders.find_one({"id": oid})) is not None
            assert run(server.db.shop_checkout_claims.find_one({"idempotency_key": key})) is not None
        finally:
            run(server.db.shop_checkout_claims.delete_many({"idempotency_key": key}))


def test_the_sweep_never_closes_an_old_order_a_resumed_checkout_just_started_paying():
    with _product(3) as leash, _stripe():
        oid = _order_with_hold(leash, pointer="att-resumed")
        run(abandon.sweep(stripe_limit=5000))
        assert run(server.db.shop_orders.find_one({"id": oid}))["status"] == "pending_payment"
        assert _held(leash) == (1.0, 1)


def test_the_sweep_finishes_an_order_a_crash_left_half_settled():
    with _product(3) as leash, _stripe():
        att = f"att-dead-{uuid.uuid4().hex[:6]}"
        oid = _order_with_hold(leash, pointer=att)
        run(server.db.shop_payment_attempts.insert_one({"id": att, "idempotency_key": att, "shop_order_id": oid, "status": "expired",
                                                        "created_at": "2026-01-01T00:00:00+00:00"}))
        try:
            run(abandon.sweep(stripe_limit=5000))
            assert run(server.db.shop_orders.find_one({"id": oid}))["status"] == "canceled"
            assert _held(leash) == (0.0, 0)
        finally:
            run(server.db.shop_payment_attempts.delete_many({"id": att}))


def test_orders_waiting_on_a_live_payment_never_crowd_out_a_stranded_one():
    with _product(100) as leash, _stripe():
        waiting = []
        tag = uuid.uuid4().hex[:6]
        for i in range(abandon.SWEEP_LIMIT + 5):
            att = f"att-rec-{tag}-{i}"
            oid = _order_with_hold(leash, pointer=att, minutes_old=600 + i)
            run(server.db.shop_payment_attempts.insert_one({"id": att, "idempotency_key": att, "shop_order_id": oid,
                                                            "status": "reconciliation_required",
                                                            "created_at": "2026-01-01T00:00:00+00:00"}))
            waiting.append(oid)
        stranded = _order_with_hold(leash, minutes_old=90)
        try:
            run(abandon.sweep(stripe_limit=5000))
            assert run(server.db.shop_orders.find_one({"id": stranded}))["status"] == "canceled"
            assert all(run(server.db.shop_orders.find_one({"id": o}))["status"] == "pending_payment" for o in waiting)
        finally:
            run(server.db.shop_payment_attempts.delete_many({"id": {"$regex": f"^att-rec-{tag}-"}}))


def test_a_checkout_closed_while_its_stripe_page_was_made_hands_out_no_link():
    import pymongo

    def _swept_meanwhile(kw):
        # The sweep failed this attempt while Stripe was making its page.
        sync = pymongo.MongoClient(os.environ["MONGO_URL"])
        try:
            sync[server.db.name].shop_payment_attempts.update_one(
                {"id": kw["metadata"]["sithappens_attempt_id"]}, {"$set": {"status": "failed"}})
        finally:
            sync.close()

    with _client() as user, _product(2) as leash, _stripe(expire=EXPIRED, create=_swept_meanwhile) as calls:
        with pytest.raises(HTTPException) as e:
            _checkout(user, [_item(leash)])
        assert e.value.status_code == 409
        assert calls["expire"], "the orphaned Stripe page is closed"


def test_a_page_left_from_the_other_stripe_mode_is_let_go():
    class _Missing(Exception):
        code = "resource_missing"

    with _client() as user, _product(1) as leash, _stripe(retrieve=EXPIRED):
        out = _checkout(user, [_item(leash)])
        att = _attempt(out["order_id"])
        run(server.db.shop_payment_attempts.update_one(
            {"id": att["id"]}, {"$set": {"stripe_checkout_session_id": "cs_test_old_" + uuid.uuid4().hex[:6]}}))
        _age_attempt(out["order_id"])
        saved_key, saved_ret = server.STRIPE_SECRET_KEY, server.stripe.checkout.Session.retrieve

        def _gone(sid, *a, **k):
            raise _Missing("No such checkout.session; a similar object exists in test mode")

        server.STRIPE_SECRET_KEY, server.stripe.checkout.Session.retrieve = "sk_live_fake", _gone
        try:
            run(abandon.sweep(stripe_limit=5000))
        finally:
            server.STRIPE_SECRET_KEY, server.stripe.checkout.Session.retrieve = saved_key, saved_ret
        assert _held(leash) == (0.0, 0)


def test_a_bank_payment_that_failed_is_let_go():
    with _client() as user, _product(1) as leash, \
            _stripe(retrieve=lambda sid: {"status": "complete", "payment_status": "unpaid", "payment_intent": "pi_1"},
                    intent=lambda pid: {"status": "requires_payment_method"}):
        out = _checkout(user, [_item(leash)])
        _age_attempt(out["order_id"])
        run(abandon.sweep(stripe_limit=5000))
        assert _held(leash) == (0.0, 0)
        assert run(server.db.shop_orders.find_one({"id": out["order_id"]}))["status"] == "payment_failed"


def test_a_bank_payment_still_processing_stays_held():
    with _client() as user, _product(1) as leash, \
            _stripe(retrieve=lambda sid: {"status": "complete", "payment_status": "unpaid", "payment_intent": "pi_2"},
                    intent=lambda pid: {"status": "processing"}):
        out = _checkout(user, [_item(leash)])
        _age_attempt(out["order_id"])
        run(abandon.sweep(stripe_limit=5000))
        assert _held(leash) == (1.0, 1)


def test_a_live_stripe_page_is_never_let_go_just_because_the_app_holds_a_test_key():
    # A live page can still be paid whatever key this app is running on.
    class _Missing(Exception):
        code = "resource_missing"

    with _client() as user, _product(1) as leash, _stripe(retrieve=EXPIRED):
        out = _checkout(user, [_item(leash)])
        att = _attempt(out["order_id"])
        run(server.db.shop_payment_attempts.update_one(
            {"id": att["id"]}, {"$set": {"stripe_checkout_session_id": "cs_live_" + uuid.uuid4().hex[:6]}}))
        _age_attempt(out["order_id"])
        saved_key, saved_ret = server.STRIPE_SECRET_KEY, server.stripe.checkout.Session.retrieve

        def _gone(sid, *a, **k):
            raise _Missing("No such checkout.session; a similar object exists in live mode")

        server.STRIPE_SECRET_KEY, server.stripe.checkout.Session.retrieve = "sk_test_fake", _gone
        try:
            res = run(abandon.sweep(stripe_limit=5000))
        finally:
            server.STRIPE_SECRET_KEY, server.stripe.checkout.Session.retrieve = saved_key, saved_ret
        assert res["errors"] >= 1
        assert _held(leash) == (1.0, 1) and _attempt(out["order_id"])["status"] == "pending"
