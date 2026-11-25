"""Pay while booking (domains/bookings/pay_now.py).

Owner request: a client whose booking isn't covered by their credits is
offered the packs that cover it right in the booking screen, and pays through
the Shop's own checkout. A client with enough credits sees nothing new.

Stripe is monkeypatched, same as test_shop_checkout_eligibility.py.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

TAG = "TEST_BOOKING_PAY_NOW"
DAY = "2027-03-10"


class _Fake(dict):
    __getattr__ = dict.__getitem__


@contextlib.contextmanager
def _stripe(enabled=True):
    calls = []
    saved = (server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY,
             server.stripe.Customer.create, server.stripe.checkout.Session.create)
    server.STRIPE_ONLINE_ENABLED = enabled
    server.STRIPE_SECRET_KEY = "sk_test_fake" if enabled else ""
    server.stripe.Customer.create = lambda **kw: _Fake(id="cus_" + uuid.uuid4().hex[:8])

    def _session(**kw):
        calls.append(kw)
        return _Fake(id="cs_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/fake")
    server.stripe.checkout.Session.create = _session
    try:
        yield calls
    finally:
        (server.STRIPE_ONLINE_ENABLED, server.STRIPE_SECRET_KEY,
         server.stripe.Customer.create, server.stripe.checkout.Session.create) = saved


@contextlib.contextmanager
def _client(**fields):
    cid = str(uuid.uuid4())
    doc = {"id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com",
           "created_at": "2026-01-01T00:00:00Z", **fields}
    run(server.db.clients.insert_one(dict(doc)))
    try:
        yield doc
    finally:
        run(server.db.clients.delete_one({"id": cid}))
        for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts"):
            run(server.db[coll].delete_many({"client_id": cid}))


@contextlib.contextmanager
def _pack(**kw):
    admin = {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}
    defaults = dict(name=f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=5, price=150.0,
                    service_type="daycare", available_online=True, active=True)
    defaults.update(kw)
    created = run(server.create_credit_pack(server.CreditPackIn(**defaults), admin))
    try:
        yield created
    finally:
        run(server.db.credit_packs.delete_one({"id": created["id"]}))


def _user(client):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client["id"], "name": TAG}


def _options(client, **kw):
    body = server.BookingPayOptionsIn(**{"service_type": "daycare", "date": DAY, **kw})
    return run(server.booking_pay_options(body, _user(client)))


def _mine(out, *packs):
    """Only this test's packs — the disposable DB may hold others."""
    ids = {p["id"] for p in packs}
    return [p for p in out["packs"] if p["id"] in ids]


def test_short_on_credits_is_offered_the_matching_packs():
    with _stripe(), _client(credits=0) as c, _pack(qty=1, price=40.0) as one, \
            _pack(qty=5, price=150.0) as five, _pack(service_type="boarding", qty=3) as boarding:
        out = _options(c)
        assert out["offer"] is True
        assert out["credits_needed"] == 1 and out["credits_available"] == 0 and out["credits_short"] == 1
        offered = _mine(out, one, five, boarding)
        assert [p["id"] for p in offered] == [one["id"], five["id"]], "cheapest covering pack first; no boarding pack"
        assert offered[0]["price"] == 40.0 and offered[0]["covers"] is True


def test_enough_credits_shows_nothing_new():
    with _stripe(), _client(credits=1) as c, _pack(qty=5):
        assert _options(c) == {"offer": False, "packs": []}


def test_two_dogs_and_several_days_count_the_real_credits():
    # 2 dogs = 1.5 credits a day; 3 days = 4.5. The client holds 2, so is 2.5 short.
    with _stripe(), _client(credits=2) as c, _pack(qty=2, price=70.0) as small, _pack(qty=5, price=150.0) as big:
        out = _options(c, dog_count=2, dates=["2027-03-10", "2027-03-11", "2027-03-12"])
        assert out["credits_needed"] == 4.5 and out["credits_short"] == 2.5
        offered = _mine(out, small, big)
        assert [(p["id"], p["covers"]) for p in offered] == [(big["id"], True), (small["id"], False)]


def test_boarding_counts_nights_against_boarding_credits():
    with _stripe(), _client(credits=9, boarding_credits=1) as c, _pack(service_type="boarding", qty=3, price=180.0) as b:
        out = _options(c, service_type="boarding", date="2027-03-10", end_date="2027-03-13", pickup_time="10:00")
        assert out["credits_needed"] == 3 and out["credits_short"] == 2
        assert [p["id"] for p in _mine(out, b)] == [b["id"]]


def test_dollars_only_service_gets_no_offer():
    with _stripe(), _client(credits=0) as c, _pack(qty=5):
        assert _options(c, service_type="grooming")["offer"] is False


def test_no_offer_when_online_card_payments_are_off():
    with _stripe(enabled=False), _client(credits=0) as c, _pack(qty=5):
        assert _options(c)["offer"] is False


def test_packs_checkout_would_refuse_are_not_offered():
    with _stripe(), _client(credits=0) as c, _pack(qty=5) as ok, \
            _pack(qty=5, available_online=False) as offline, _pack(qty=5) as needs_ok:
        # The Shop catalogue does not hide this one; only the checkout rule refuses it.
        run(server.db.credit_packs.update_one({"id": needs_ok["id"]}, {"$set": {"requires_approval": True}}))
        assert [p["id"] for p in _mine(_options(c), ok, offline, needs_ok)] == [ok["id"]]


def test_client_sees_their_own_locked_price():
    with _stripe(), _client(credits=0) as c, _pack(qty=5, price=150.0) as p:
        real = server.resolve_client_price

        async def _locked(client_id, kind, ref_id, list_price, **kw):
            if ref_id == p["id"]:
                return {"effective_price": 120.0, "override_id": "ovr-1"}
            return await real(client_id, kind, ref_id, list_price, **kw)
        server.resolve_client_price = _locked
        try:
            assert _mine(_options(c), p)[0]["price"] == 120.0
        finally:
            server.resolve_client_price = real


def test_staff_cannot_use_the_client_endpoint():
    body = server.BookingPayOptionsIn(service_type="daycare", date=DAY)
    try:
        run(server.booking_pay_options(body, {"id": "x", "role": "admin"}))
        assert False, "expected 403"
    except HTTPException as e:
        assert e.status_code == 403


def test_offered_pack_pays_through_the_shop_checkout_once():
    """The offer is paid by the Shop's own checkout: one order, one card page,
    even when the booking screen sends the same request twice."""
    with _stripe() as calls, _client(credits=0) as c, _pack(qty=5, price=150.0) as p:
        pack = _mine(_options(c), p)[0]
        idem = f"book-pay-{uuid.uuid4().hex}"

        def _go():
            return run(server.create_shop_checkout(server.ShopCheckoutIn(
                items=[server.ShopCartItemIn(kind="credit_pack", ref_id=pack["id"], quantity=1)],
                idempotency_key=idem), _user(c)))
        first, again = _go(), _go()
        assert first["order_id"] == again["order_id"] and first["url"] == again["url"]
        assert len(calls) == 1
        order = run(server.db.shop_orders.find_one({"id": first["order_id"]}, {"_id": 0}))
        assert order["total"] == pack["price"], "the price shown in the booking screen is the price charged"
        fresh = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0, "credits": 1}))
        assert fresh["credits"] == 0, "nothing is granted until the card is actually paid"
