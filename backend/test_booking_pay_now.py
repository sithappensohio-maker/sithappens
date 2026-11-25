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


# ---------------------------------------------------------------------------
# Credits already promised to other upcoming bookings (credits_promised.py)
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _visits(c, *rows):
    """Bookings for this test's customer; each row overrides the defaults."""
    ids = []
    for r in rows:
        doc = {"id": str(uuid.uuid4()), "client_id": c["id"], "dog_id": "d-" + TAG, "dog_name": "Rex",
               "service_type": "daycare", "date": "2027-03-08", "end_date": None, "status": "approved",
               "credit_units_required": 1, **r}
        ids.append(doc["id"])
        run(server.db.bookings.insert_one(doc))
    try:
        yield
    finally:
        run(server.db.bookings.delete_many({"id": {"$in": ids}}))


def _quote(c, **kw):
    body = server.PricingQuoteIn(**{"service_type": "daycare", "date": DAY, **kw})
    return run(server.pricing_quote(body, _user(c)))


def test_credits_other_bookings_will_use_are_set_aside():
    # 2 credits, 2 days already booked: the third day is NOT covered.
    with _stripe(), _client(credits=2) as c, _pack(qty=1, price=40.0) as p, \
            _visits(c, {"date": "2027-03-08"}, {"date": "2027-03-09"}):
        out = _options(c)
        assert out["offer"] is True and out["credits_short"] == 1
        assert out["credits_on_account"] == 2 and out["credits_promised"] == 2 and out["credits_available"] == 0
        assert [x["id"] for x in _mine(out, p)] == [p["id"]]
        q = _quote(c)
        assert q["covered_by_credits"] is False and q["credits_available"] == 0
        assert q["credits_on_account"] == 2 and q["credits_promised"] == 2 and q["credit_shortfall"] == 1


def test_a_free_credit_beyond_the_promised_ones_still_covers():
    with _stripe(), _client(credits=3) as c, _pack(qty=1), _visits(c, {"date": "2027-03-08"}, {"date": "2027-03-09"}):
        assert _options(c)["offer"] is False
        q = _quote(c)
        assert q["covered_by_credits"] is True and q["credits_available"] == 1 and q["credits_remaining_after"] == 0


def test_only_visits_that_will_still_use_a_credit_count():
    today = server.business_today().isoformat()
    with _stripe(), _client(credits=1, boarding_credits=5) as c, _pack(qty=1), _visits(
            c,
            {"status": "cancelled"}, {"status": "rejected"}, {"status": "completed"},
            {"checked_out_at": "2027-03-08T22:00:00Z"},                       # already checked out
            {"no_show": True},
            {"date": "2020-01-06"},                                           # long past, never came
            {"service_type": "boarding", "end_date": "2027-03-12", "credit_units_required": 4},  # another pool
            {"service_type": "grooming", "credit_units_required": 0}):
        assert _options(c)["offer"] is False, "none of these will use a daycare credit"
        assert _quote(c)["credits_promised"] == 0
    # A dog that is here right now counts, even if its day has passed; so does a pending request.
    with _stripe(), _client(credits=2) as c, _pack(qty=1), _visits(
            c, {"date": "2020-01-06", "checked_in_at": "2020-01-06T13:00:00Z"}, {"status": "pending", "date": today}):
        out = _options(c)
        assert out["credits_promised"] == 2 and out["credits_short"] == 1


def test_an_extra_dogs_half_credit_and_boarding_nights_count_as_they_are_spent():
    with _stripe(), _client(credits=2) as c, _pack(qty=1), \
            _visits(c, {"credit_units_required": 1}, {"credit_units_required": 0.5}):
        out = _options(c)  # 1.5 promised, 0.5 free, needs 1
        assert out["credits_promised"] == 1.5 and out["credits_short"] == 0.5
    with _stripe(), _client(boarding_credits=4) as c, _pack(service_type="boarding", qty=3), \
            _visits(c, {"service_type": "boarding", "date": "2027-04-01", "end_date": "2027-04-04", "pickup_time": "10:00"}):
        out = _options(c, service_type="boarding", date="2027-03-10", end_date="2027-03-12", pickup_time="10:00")
        assert out["credits_promised"] == 3 and out["credits_needed"] == 2 and out["credits_short"] == 1


def test_staff_quote_still_shows_the_whole_balance():
    with _client(credits=2) as c, _visits(c, {"date": "2027-03-08"}, {"date": "2027-03-09"}):
        body = server.PricingQuoteIn(service_type="daycare", date=DAY, client_id=c["id"])
        q = run(server.pricing_quote(body, {"id": "a", "role": "admin"}))
        assert q["credits_available"] == 2 and q["credits_promised"] == 0


def test_the_pack_that_matches_the_booking_comes_first():
    # Two dogs, one day = 1.5 credits. The owner's screenshot: the "2 dogs 1 day"
    # pack must lead, ahead of bigger packs, and the 1-credit pack (too small) goes last.
    with _stripe(), _client(credits=0) as c, _pack(qty=1, price=25.0) as single, \
            _pack(qty=10, price=220.0) as ten, _pack(qty=15, price=375.0) as fifteen, \
            _pack(qty=1.5, price=37.5) as match:
        offered = _mine(_options(c, dog_count=2), single, ten, fifteen, match)
        assert [p["id"] for p in offered] == [match["id"], ten["id"], fifteen["id"], single["id"]]
        assert offered[0].get("best_match") is True
        assert not any(p.get("best_match") for p in offered[1:])
        assert offered[-1]["covers"] is False


# ---------------------------------------------------------------------------
# Add-ons: dollars paid ahead as money on the account
# ---------------------------------------------------------------------------

from domains.bookings import pay_now as _pay_now


@contextlib.contextmanager
def _addons_switch(on):
    saved = _pay_now.ADDONS_PAY_AHEAD_READY
    _pay_now.ADDONS_PAY_AHEAD_READY = on
    try:
        yield
    finally:
        _pay_now.ADDONS_PAY_AHEAD_READY = saved


def setup_function(fn):
    """The add-on tests below run with the switch ON (it ships OFF until pickup uses the money by itself)."""
    _pay_now.ADDONS_PAY_AHEAD_READY = "addon" in fn.__name__


def teardown_function(fn):
    _pay_now.ADDONS_PAY_AHEAD_READY = False


def test_paying_extras_ahead_is_off_until_pickup_can_use_the_money():
    assert _pay_now.ADDONS_PAY_AHEAD_READY is False, "ships OFF: turn on together with step 3"
    with _addons_switch(False), _stripe(), _client(credits=5) as c, _addon(15.0) as bath:
        assert _options(c, addon_service_ids=[bath["id"]]) == {"offer": False, "packs": []}


@contextlib.contextmanager
def _addon(price=15.0, addon_for=("daycare",), **kw):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} Bath {uuid.uuid4().hex[:4]}", "service_type": "grooming",
           "is_addon": True, "addon_for": list(addon_for), "base_price": price, "active": True, **kw}
    run(server.db.services.insert_one(dict(doc)))
    try:
        yield doc
    finally:
        run(server.db.services.delete_one({"id": doc["id"]}))


def test_addons_can_be_paid_ahead_even_when_credits_cover_the_visit():
    with _stripe(), _client(credits=5) as c, _addon(15.0) as bath:
        out = _options(c, addon_service_ids=[bath["id"]])
        assert out["offer"] is True and out["packs"] == []
        assert out["addons"]["total"] == 15.0 and out["addons"]["ref_id"] == "ac-1500"
        assert out["addons"]["lines"] == [{"name": bath["name"], "count": 1, "amount": 15.0}]
    with _stripe(), _client(credits=5) as c:
        assert _options(c) == {"offer": False, "packs": []}, "no add-ons and covered: still nothing new"


def test_addons_are_counted_per_dog_and_per_day_alongside_the_packs():
    with _stripe(), _client(credits=0) as c, _pack(qty=1.5, price=37.5) as pack, _addon(15.0) as bath, _addon(8.0) as nails:
        out = _options(c, dog_count=2, addon_service_ids=[bath["id"], bath["id"], nails["id"]])
        assert _mine(out, pack)[0]["best_match"] is True
        assert out["addons"]["total"] == 38.0, "two baths and one nail trim"
        out = _options(c, addon_service_ids=[bath["id"]], dates=["2027-03-10", "2027-03-11", "2027-03-12"])
        assert out["addons"]["total"] == 45.0 and out["addons"]["lines"][0]["count"] == 3


def test_addon_money_is_the_customers_own_price_and_goes_through_the_one_checkout():
    with _stripe() as calls, _client(credits=0) as c, _pack(qty=1, price=40.0) as pack, _addon(15.0) as bath:
        real = server.pricing_domain_services.resolve_client_price

        async def _locked(client_id, kind, ref_id, list_price, **kw):
            if ref_id == bath["id"]:
                return {"effective_price": 12.0, "override_id": "ovr-1"}
            return await real(client_id, kind, ref_id, list_price, **kw)
        server.pricing_domain_services.resolve_client_price = _locked
        try:
            out = _options(c, addon_service_ids=[bath["id"]])
        finally:
            server.pricing_domain_services.resolve_client_price = real
        assert out["addons"]["total"] == 12.0
        order = run(server.create_shop_checkout(server.ShopCheckoutIn(
            items=[server.ShopCartItemIn(kind="credit_pack", ref_id=pack["id"], quantity=1),
                   server.ShopCartItemIn(kind="account_credit", ref_id=out["addons"]["ref_id"], quantity=1)],
            idempotency_key=f"book-pay-{uuid.uuid4().hex}"), _user(c)))
        saved = run(server.db.shop_orders.find_one({"id": order["order_id"]}, {"_id": 0}))
        assert saved["total"] == 52.0 and len(calls) == 1, "one card page for the pack and the add-on together"


def test_no_addon_offer_for_a_bad_addon_or_with_card_payments_off():
    with _stripe(), _client(credits=5) as c, _addon(15.0, addon_for=("boarding",)) as wrong:
        assert _options(c, addon_service_ids=[wrong["id"]])["offer"] is False
        assert _options(c, addon_service_ids=["no-such-addon"])["offer"] is False
    with _stripe(enabled=False), _client(credits=5) as c, _addon(15.0) as bath:
        assert _options(c, addon_service_ids=[bath["id"]])["offer"] is False


def test_grooming_with_an_addon_offers_only_the_addon_money():
    with _stripe(), _client(credits=0) as c, _pack(qty=5), _addon(10.0, addon_for=("grooming",)) as extra:
        out = _options(c, service_type="grooming", addon_service_ids=[extra["id"]])
        assert out["offer"] is True and out["packs"] == [] and out["addons"]["total"] == 10.0
