"""Buying without an account — Phase 8.

Two things are on trial here.

The first is the RULE: who may buy what without signing in. It lives in one
function (domains.shop.guest) precisely so the storefront and the checkout
cannot disagree about it, and several tests below exist only to prove they
still don't.

The second is what a guest is allowed to SAY. A guest is an unauthenticated
stranger posting JSON at a money endpoint, so every test in the tampering
section takes the position that the browser is hostile: it sends prices,
totals, taxes, titles and stock claims, and the only acceptable outcome is
that the server ignores all of it and charges what the database says.

Stripe is monkeypatched. This is a correctness suite, not an integration
test — no real Checkout Session is ever created, and the completion
tests drive _apply_shop_payment with a synthesized session payload exactly
as the webhook would.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

from domains.shop import checkout as shop_checkout
from domains.shop import guest as shop_guest
from domains.shop import guest_routes

TAG = "TEST_GUEST_SHOP"


# ─────────────────────────────────────────────────────────────── harness

class _FakeStripeObj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


_session_calls = []
_customer_calls = []


def _fake_customer_create(**kwargs):
    _customer_calls.append(kwargs)
    return _FakeStripeObj(id="cus_fake_" + uuid.uuid4().hex[:8])


def _fake_session_create(**kwargs):
    _session_calls.append(kwargs)
    return _FakeStripeObj(id="cs_fake_" + uuid.uuid4().hex[:8],
                          url="https://checkout.stripe.com/test/fake")


@contextlib.contextmanager
def _stripe_mocked():
    _session_calls.clear()
    _customer_calls.clear()
    oc, os_ = server.stripe.Customer.create, server.stripe.checkout.Session.create
    server.stripe.Customer.create = _fake_customer_create
    server.stripe.checkout.Session.create = _fake_session_create
    try:
        yield _session_calls
    finally:
        server.stripe.Customer.create = oc
        server.stripe.checkout.Session.create = os_


class _Req:
    """The bits of a Request the public routes touch.

    A fresh IP per request by default: the rate limiter is real and
    per-address, and a whole suite pretending to be one household would trip
    it. Tests that care about two people being different pass their own.
    """
    def __init__(self, ip=None):
        ip = ip or f"198.18.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        self.client = type("C", (), {"host": ip})()
        self.headers = {}
        self.url = type("U", (), {"path": "/api/public/shop/x"})()


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


@contextlib.contextmanager
def _public_shop_open(**overrides):
    """The public storefront switched on, restored afterwards."""
    settings = run(server.get_settings())
    before = (settings.get("shop_page") or {}).copy()
    sp = before.copy()
    sp.update({"public_shop_enabled": True, "public_browsing_enabled": True,
               "show_public_prices": True, "show_public_merch": True})
    sp.update(overrides)
    run(server.db.settings.update_one({}, {"$set": {"shop_page": sp}}, upsert=True))
    server.get_settings.cache_clear() if hasattr(server.get_settings, "cache_clear") else None
    try:
        yield sp
    finally:
        run(server.db.settings.update_one({}, {"$set": {"shop_page": before}}, upsert=True))


@contextlib.contextmanager
def _product(**kw):
    defaults = dict(name=f"{TAG} Product {uuid.uuid4().hex[:6]}", price=19.99,
                    show_online=True, active=True, starting_stock=0,
                    guest_cart_allowed=True, publicly_visible=True)
    defaults.update(kw)
    created = run(server.create_pos_product(server.PosProductCreateIn(**defaults), _admin()))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))
        run(server.db.inventory_movements.delete_many({"source_ref": {"$regex": created["id"]}}))


@contextlib.contextmanager
def _pack(**kw):
    defaults = dict(name=f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=5, price=99.0,
                    available_online=True, active=True)
    defaults.update(kw)
    created = run(server.create_credit_pack(server.CreditPackIn(**defaults), _admin()))
    try:
        yield created
    finally:
        run(server.db.credit_packs.delete_one({"id": created["id"]}))


@contextlib.contextmanager
def _program(**kw):
    defaults = dict(name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
                    available_online=True, active=True, price=250.0)
    defaults.update(kw)
    created = run(server.create_program(server.ProgramIn(**defaults), _admin()))
    try:
        yield created
    finally:
        run(server.db.programs.delete_one({"id": created["id"]}))


@contextlib.contextmanager
def _guest_orders():
    """Whatever guest orders a test creates, gone afterwards."""
    before = {o["id"] for o in run(server.db.shop_orders.find({}, {"_id": 0, "id": 1}).to_list(5000))}
    try:
        yield
    finally:
        after = run(server.db.shop_orders.find({}, {"_id": 0, "id": 1}).to_list(5000))
        new = [o["id"] for o in after if o["id"] not in before]
        if new:
            run(server.db.shop_orders.delete_many({"id": {"$in": new}}))
            run(server.db.shop_checkout_claims.delete_many({"shop_order_id": {"$in": new}}))
            run(server.db.shop_payment_attempts.delete_many({"shop_order_id": {"$in": new}}))


def _item(kind, ref_id, qty=1, **kw):
    return server.ShopCartItemIn(kind=kind, ref_id=ref_id, quantity=qty, **kw)


def _guest_body(items, idem=None, email="buyer@example.com", name="Sam Guest"):
    return guest_routes.GuestCheckoutIn(
        items=items, idempotency_key=idem or f"g-{uuid.uuid4().hex}",
        email=email, name=name)


def _route(name):
    """One of the registered public routes, by its endpoint function name."""
    for r in server.app.routes:
        if getattr(r, "name", None) == name:
            return r.endpoint
    raise AssertionError(f"route {name} is not registered")


guest_checkout = _route("create_public_shop_checkout")
guest_cart_price = _route("price_public_shop_cart")
guest_order_status = _route("public_shop_order_status")


# ══════════════════════════════════════════════════ 1. the rule itself

def test_a_product_the_owner_opted_in_can_be_bought_by_a_stranger():
    assert shop_guest.guest_purchasable("product", {"guest_cart_allowed": True})


def test_a_product_nobody_opted_in_cannot_be():
    # Off by default. Not having decided is not a yes.
    assert not shop_guest.guest_purchasable("product", {})
    assert not shop_guest.guest_purchasable("product", {"guest_cart_allowed": False})


def test_prepaid_visits_can_never_be_bought_without_an_account():
    # However it is flagged: the credits have nowhere to land.
    for doc in ({}, {"guest_cart_allowed": True}, {"guest_cart_allowed": True, "active": True}):
        assert not shop_guest.guest_purchasable("credit_pack", doc)
    assert "sign in" in shop_guest.guest_block_reason("credit_pack", {}).lower()


def test_a_training_program_can_never_be_bought_without_an_account():
    for doc in ({}, {"guest_cart_allowed": True}):
        assert not shop_guest.guest_purchasable("training_program", doc)


def test_each_account_shaped_requirement_overrides_the_opt_in():
    for flag in ("requires_dog", "requires_approval", "requires_completed_onboarding"):
        doc = {"guest_cart_allowed": True, flag: True}
        assert not shop_guest.guest_purchasable("product", doc), flag


def test_a_price_a_guest_was_never_shown_cannot_be_agreed_to():
    doc = {"guest_cart_allowed": True}
    assert shop_guest.guest_purchasable("product", doc, price_visible=True)
    assert not shop_guest.guest_purchasable("product", doc, price_visible=False)


def test_shopify_merchandise_is_never_a_guest_sale_here():
    # It has never been a sale here at all — Shopify owns its checkout.
    doc = {"guest_cart_allowed": True, "sales_destination": "shopify_external"}
    assert not shop_guest.guest_purchasable("product", doc)
    assert "shopify" in shop_guest.guest_block_reason("product", doc).lower()


def test_an_inactive_product_is_not_a_guest_sale():
    assert not shop_guest.guest_purchasable("product", {"guest_cart_allowed": True, "active": False})


def test_a_gift_card_is_always_a_guest_sale():
    # It is money. There is no account for it to live in, and no stock.
    assert shop_guest.guest_purchasable("gift_card", {})
    assert shop_guest.guest_purchasable("gift_card", {"requires_dog": True})


def test_a_kind_invented_tomorrow_is_refused_until_somebody_says_otherwise():
    # The list is an allowlist, so the failure direction is "ask them to
    # sign in", never "let it through".
    assert not shop_guest.guest_purchasable("subscription", {"guest_cart_allowed": True})


def test_a_missing_item_is_refused_rather_than_treated_as_permissive():
    assert not shop_guest.guest_purchasable("product", None)


# ═════════════════════════════════════ 2. the storefront tells the truth

def test_the_storefront_and_the_checkout_use_the_same_function():
    # The anti-drift test. If _public_purchase_state ever grows its own copy
    # of the rule again, this catches it: a case the shared helper refuses
    # must not be advertised as guest-buyable.
    cases = [
        ("product", {"guest_cart_allowed": True}),
        ("product", {"guest_cart_allowed": False}),
        ("product", {"guest_cart_allowed": True, "requires_dog": True}),
        ("product", {"guest_cart_allowed": True, "sales_destination": "shopify_external"}),
        ("credit_pack", {"guest_cart_allowed": True}),
        ("training_program", {"guest_cart_allowed": True}),
        ("gift_card", {}),
    ]
    for kind, doc in cases:
        shown = server._public_purchase_state(kind, doc)["guest_cart_allowed"]
        real = shop_guest.guest_purchasable(kind, doc, price_visible=True)
        assert shown == real, f"{kind} {doc}: storefront says {shown}, checkout says {real}"


def test_hiding_prices_shop_wide_withdraws_the_guest_offer():
    doc = {"guest_cart_allowed": True}
    assert server._public_purchase_state("product", doc, global_show_public_prices=True)["guest_cart_allowed"]
    assert not server._public_purchase_state("product", doc, global_show_public_prices=False)["guest_cart_allowed"]


def test_a_hidden_price_is_not_the_same_as_needing_an_account():
    # Signing in is exactly what reveals the price, so "account_required"
    # would be the wrong thing to tell somebody here.
    state = server._public_purchase_state("product", {"guest_cart_allowed": True},
                                          global_show_public_prices=False)
    assert state["guest_cart_allowed"] is False
    assert state["account_required"] is False


def test_gift_cards_appear_on_the_public_storefront():
    with _public_shop_open():
        items = run(server._public_visible_shop_items())
    cards = [i for i in items if i["kind"] == "gift_card"]
    assert cards, "a stranger should be able to buy a gift card"
    assert all(c["guest_cart_allowed"] for c in cards)
    assert all(c["price"] > 0 for c in cards)


def test_turning_merch_off_does_not_take_gift_cards_with_it():
    # They are not a department; they are money.
    with _public_shop_open(show_public_merch=False):
        items = run(server._public_visible_shop_items())
    assert [i for i in items if i["kind"] == "gift_card"]
    assert not [i for i in items if i["kind"] == "product"]


# ══════════════════════════════════════════════ 3. the guest happy path

def test_a_stranger_can_buy_a_product_and_no_account_is_invented():
    clients_before = run(server.db.clients.count_documents({}))
    with _public_shop_open(), _guest_orders(), _product(price=25.0) as p:
        with _stripe_mocked() as calls:
            result = run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order["client_id"] is None, "a guest order must not carry a made-up client"
        assert order["is_guest_order"] is True
        assert order["client_email"] == "buyer@example.com"
        assert order["total"] == 25.0
        assert len(calls) == 1
    assert run(server.db.clients.count_documents({})) == clients_before, \
        "guest checkout must not create a client record"


def test_stripe_is_told_the_address_but_no_customer_is_created_for_a_guest():
    with _public_shop_open(), _guest_orders(), _product() as p:
        with _stripe_mocked() as calls:
            run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
        assert _customer_calls == [], "a guest has not asked to become a Stripe Customer"
        assert calls[0]["customer_email"] == "buyer@example.com"
        assert "customer" not in calls[0]
        assert calls[0]["metadata"]["sithappens_guest_order"] == "1"


def test_the_token_comes_back_once_and_is_never_stored_in_the_clear():
    with _public_shop_open(), _guest_orders(), _product() as p:
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
        token = result["guest_token"]
        assert len(token) >= 32
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert token not in str(order), "the raw token must not be in the database"
        assert order["guest_token_hash"] == shop_checkout.hash_guest_token(token)


def test_a_signed_in_client_still_checks_out_exactly_as_before():
    # The refactor moved the sequence; it must not have moved the behaviour.
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} C", "email": "c@example.com"}))
    try:
        with _guest_orders(), _product() as p:
            user = {"id": str(uuid.uuid4()), "role": "client", "client_id": cid}
            with _stripe_mocked() as calls:
                result = run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=[_item("product", p["id"])],
                    idempotency_key=f"c-{uuid.uuid4().hex}"), user))
            order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
            assert order["client_id"] == cid
            assert order["is_guest_order"] is False
            assert "guest_token" not in result
            assert order["guest_token_hash"] is None
            assert calls[0]["customer"], "a signed-in client still gets a Stripe Customer"
            assert "customer_email" not in calls[0]
            assert "/portal?shop_order=" in calls[0]["success_url"]
    finally:
        run(server.db.clients.delete_one({"id": cid}))


# ═══════════════════════════════════════════════════════ 4. tampering

def test_a_guest_cannot_name_their_own_price():
    with _public_shop_open(), _guest_orders(), _product(price=40.0) as p:
        body = _guest_body([_item("product", p["id"], 2)])
        # Everything a hostile browser might bolt on. The model does not
        # define these fields, so they are dropped — and the assertion below
        # proves the charge came from the product row regardless.
        with _stripe_mocked():
            result = run(guest_checkout(body, _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order["lines"][0]["unit_price"] == 40.0
        assert order["total"] == 80.0


def test_trusted_fields_are_not_even_accepted_as_input():
    # Frontend hiding is not security, but neither is a model that quietly
    # keeps what it was sent. These never become part of a cart line.
    line = server.ShopCartItemIn(kind="product", ref_id="x", quantity=1)
    for forbidden in ("unit_price", "price", "subtotal", "total", "tax",
                      "tax_amount", "discount", "name", "stock_on_hand",
                      "fulfillment_status", "line_total"):
        assert not hasattr(line, forbidden), forbidden
    for forbidden in ("subtotal", "total", "tax_amount", "discount", "client_id"):
        assert forbidden not in guest_routes.GuestCheckoutIn.model_fields, forbidden


def test_a_guest_cannot_buy_prepaid_visits():
    with _public_shop_open(), _guest_orders(), _pack() as pk:
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("credit_pack", pk["id"])]), _Req()))
            assert False, "prepaid visits must not be sellable to a guest"
        except HTTPException as e:
            assert e.status_code == 403
        assert run(server.db.shop_orders.count_documents({"is_guest_order": True,
                                                          "lines.ref_id": pk["id"]})) == 0


def test_a_guest_cannot_buy_a_training_program():
    with _public_shop_open(), _guest_orders(), _program() as prog:
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("training_program", prog["id"])]), _Req()))
            assert False, "a program must not be sellable to a guest"
        except HTTPException as e:
            assert e.status_code == 403


def test_a_guest_cannot_buy_a_product_nobody_opted_in():
    # The flag off is the whole test: this product is perfectly fine for a
    # signed-in client and must still be refused here.
    with _public_shop_open(), _guest_orders(), _product(guest_cart_allowed=False) as p:
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
            assert False, "an un-opted-in product must not be sellable to a guest"
        except HTTPException as e:
            assert e.status_code == 403


def test_a_guest_cannot_buy_a_product_whose_price_is_hidden_from_guests():
    # Otherwise checkout is a way to read the number the setting hides.
    with _public_shop_open(), _guest_orders(), _product(show_public_price=False) as p:
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
            assert False, "a price-hidden product must not reach a guest Stripe page"
        except HTTPException as e:
            assert e.status_code == 403


def test_one_bad_line_refuses_the_whole_basket_and_creates_no_order():
    # A mixed cart is not partly checked out — a guest who is told "these
    # two are fine, that one isn't" can fix it; a guest silently charged for
    # two of three cannot.
    with _public_shop_open(), _guest_orders(), _product() as p, _pack() as pk:
        idem = f"g-{uuid.uuid4().hex}"
        try:
            with _stripe_mocked() as calls:
                run(guest_checkout(_guest_body(
                    [_item("product", p["id"]), _item("credit_pack", pk["id"])], idem=idem), _Req()))
            assert False, "expected the whole cart to be refused"
        except HTTPException as e:
            assert e.status_code == 403
        assert calls == [], "Stripe must never be called for a refused cart"
        claim = run(server.db.shop_checkout_claims.find_one({"idempotency_key": idem}, {"_id": 0}))
        if claim:
            assert run(server.db.shop_orders.find_one({"id": claim["shop_order_id"]})) is None
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(fresh.get("stock_reserved") or 0) == 0.0


def test_a_guest_cannot_buy_more_than_exists():
    with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=2) as p:
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("product", p["id"], 5)]), _Req()))
            assert False, "expected the stock ceiling to hold for a guest too"
        except HTTPException as e:
            assert e.status_code in (400, 409)


def test_a_guest_cannot_buy_something_taken_offline():
    with _public_shop_open(), _guest_orders(), _product() as p:
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"show_online": False}}))
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
            assert False, "expected an offline product to be refused"
        except HTTPException as e:
            assert e.status_code in (400, 403, 409)


def test_guest_checkout_is_closed_when_the_public_shop_is():
    settings = run(server.get_settings())
    before = (settings.get("shop_page") or {}).copy()
    sp = before.copy()
    sp["public_shop_enabled"] = False
    run(server.db.settings.update_one({}, {"$set": {"shop_page": sp}}, upsert=True))
    try:
        with _guest_orders(), _product() as p:
            try:
                with _stripe_mocked():
                    run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
                assert False, "expected 404 while the public shop is off"
            except HTTPException as e:
                assert e.status_code == 404
    finally:
        run(server.db.settings.update_one({}, {"$set": {"shop_page": before}}, upsert=True))


# ════════════════════════════════════════════ 5. the cart preview agrees

def test_the_preview_prices_from_the_database_not_the_request():
    with _public_shop_open(), _product(price=12.34) as p:
        out = run(guest_cart_price(guest_routes.GuestCartIn(items=[_item("product", p["id"], 3)]), _Req()))
        assert out["lines"][0]["unit_price"] == 12.34
        assert out["subtotal"] == 37.02
        assert out["total"] >= out["subtotal"]


def test_the_preview_refuses_exactly_what_the_checkout_refuses():
    with _public_shop_open(), _pack() as pk:
        try:
            run(guest_cart_price(guest_routes.GuestCartIn(items=[_item("credit_pack", pk["id"])]), _Req()))
            assert False, "the preview must not price what checkout will refuse"
        except HTTPException as e:
            assert e.status_code == 403
            assert e.detail["blocked"][0]["kind"] == "credit_pack"


def test_the_preview_does_not_leak_a_hidden_price():
    with _public_shop_open(), _product(show_public_price=False, price=999.0) as p:
        try:
            run(guest_cart_price(guest_routes.GuestCartIn(items=[_item("product", p["id"])]), _Req()))
            assert False, "expected the hidden price to stay hidden"
        except HTTPException as e:
            assert e.status_code == 403
            assert "999" not in str(e.detail)


def test_the_preview_reserves_nothing_and_charges_nothing():
    with _public_shop_open(), _product(track_inventory=True, starting_stock=4) as p:
        with _stripe_mocked() as calls:
            run(guest_cart_price(guest_routes.GuestCartIn(items=[_item("product", p["id"], 2)]), _Req()))
        assert calls == []
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(fresh.get("stock_reserved") or 0) == 0.0
        assert run(server.db.shop_orders.count_documents({"lines.ref_id": p["id"]})) == 0


# ═════════════════════════════════════════════════════ 6. who owns it

def test_the_token_reads_the_order_and_nothing_else_does():
    with _public_shop_open(), _guest_orders(), _product() as p:
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
        oid, token = result["order_id"], result["guest_token"]

        ok = run(guest_order_status(oid, _Req(), token=token))
        assert ok["order_id"] == oid

        for bad in ("", "nope", token[:-1] + ("a" if token[-1] != "a" else "b"),
                    shop_checkout.hash_guest_token(token)):
            try:
                run(guest_order_status(oid, _Req(), token=bad))
                assert False, f"token {bad!r} must not open this order"
            except HTTPException as e:
                assert e.status_code == 404


def test_a_made_up_order_id_looks_exactly_like_a_wrong_token():
    # Same 404 either way, so this cannot be used to discover order ids.
    try:
        run(guest_order_status(str(uuid.uuid4()), _Req(), token="anything"))
        assert False
    except HTTPException as e:
        assert e.status_code == 404
        assert e.detail == "Order not found."


def test_a_signed_in_client_cannot_read_a_guest_order_through_the_portal():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} C", "email": "buyer@example.com"}))
    try:
        with _public_shop_open(), _guest_orders(), _product() as p:
            with _stripe_mocked():
                result = run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
            user = {"id": str(uuid.uuid4()), "role": "client", "client_id": cid}
            try:
                run(server.portal_shop_order_status(result["order_id"], user))
                assert False, "the same email is not proof of ownership"
            except HTTPException as e:
                assert e.status_code == 404
    finally:
        run(server.db.clients.delete_one({"id": cid}))


def test_a_client_session_with_no_client_id_cannot_read_guest_orders():
    # Both sides would be None, and None == None is how you read a
    # stranger's order.
    with _public_shop_open(), _guest_orders(), _product() as p:
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
        user = {"id": str(uuid.uuid4()), "role": "client", "client_id": None}
        try:
            run(server.portal_shop_order_status(result["order_id"], user))
            assert False, "a client_id-less session must not match a guest order"
        except HTTPException as e:
            assert e.status_code == 404


def test_signing_up_later_with_the_same_email_claims_nothing():
    with _public_shop_open(), _guest_orders(), _product() as p:
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body([_item("product", p["id"])],
                                                     email="later@example.com"), _Req()))
        cid = str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": "Later", "email": "later@example.com"}))
        try:
            user = {"id": str(uuid.uuid4()), "role": "client", "client_id": cid}
            listed = run(server.portal_shop_orders(user))
            assert result["order_id"] not in [o["order_id"] for o in listed["orders"]]
            order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
            assert order["client_id"] is None, "the order must not have been adopted"
        finally:
            run(server.db.clients.delete_one({"id": cid}))


# ═══════════════════════════════════════════════════ 7. idempotency

def test_the_same_key_and_the_same_basket_resumes_one_order():
    with _public_shop_open(), _guest_orders(), _product() as p:
        idem = f"g-{uuid.uuid4().hex}"
        with _stripe_mocked() as calls:
            a = run(guest_checkout(_guest_body([_item("product", p["id"])], idem=idem), _Req()))
            b = run(guest_checkout(_guest_body([_item("product", p["id"])], idem=idem), _Req()))
        assert a["order_id"] == b["order_id"]
        assert len(calls) == 1, "a retry must not create a second Stripe session"
        assert a["url"] == b["url"]


def test_the_same_key_with_a_different_basket_is_a_conflict():
    with _public_shop_open(), _guest_orders(), _product() as p, _product() as q:
        idem = f"g-{uuid.uuid4().hex}"
        with _stripe_mocked():
            run(guest_checkout(_guest_body([_item("product", p["id"])], idem=idem), _Req()))
            try:
                run(guest_checkout(_guest_body([_item("product", q["id"])], idem=idem), _Req()))
                assert False, "expected a conflict"
            except HTTPException as e:
                assert e.status_code == 409


def test_another_guest_cannot_resume_somebody_elses_key():
    # The hole this closes: for two guests, client_id is None on both sides,
    # so without buyer_key the claim check compares None to None, agrees,
    # and hands over a Stripe URL for a cart that is not theirs.
    with _public_shop_open(), _guest_orders(), _product() as p:
        idem = f"g-{uuid.uuid4().hex}"
        with _stripe_mocked():
            run(guest_checkout(_guest_body([_item("product", p["id"])], idem=idem,
                                            email="first@example.com"), _Req()))
            try:
                run(guest_checkout(_guest_body([_item("product", p["id"])], idem=idem,
                                                email="second@example.com"), _Req("198.51.100.7")))
                assert False, "a second guest must not resume the first guest's claim"
            except HTTPException as e:
                assert e.status_code == 409 and e.detail == "This idempotency key was already used for a different request.", e.detail


def test_a_guest_cannot_resume_a_signed_in_clients_claim():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} C", "email": "mix@example.com"}))
    try:
        with _public_shop_open(), _guest_orders(), _product() as p:
            idem = f"m-{uuid.uuid4().hex}"
            user = {"id": str(uuid.uuid4()), "role": "client", "client_id": cid}
            with _stripe_mocked():
                run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=[_item("product", p["id"])], idempotency_key=idem), user))
                try:
                    run(guest_checkout(_guest_body([_item("product", p["id"])], idem=idem,
                                                    email="mix@example.com"), _Req()))
                    assert False, "a guest must not resume a client's claim"
                except HTTPException as e:
                    assert e.status_code == 409 and e.detail == "This idempotency key was already used for a different request.", e.detail
    finally:
        run(server.db.clients.delete_one({"id": cid}))


# ════════════════════════════════════════════ 8. gift cards, as a guest

def test_a_stranger_can_buy_a_gift_card():
    with _public_shop_open(), _guest_orders():
        amounts = run(server.gift_card_shop.offered_amounts())
        ref = server.gift_card_shop.ref_id_for(amounts[0])
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body([_item("gift_card", ref)]), _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order["total"] == amounts[0]
        assert order["tax_amount"] == 0.0, "a gift card is money, and money is not taxed"
        assert order["client_id"] is None


def test_a_guests_gift_card_is_emailed_to_the_guest():
    minted, emailed = [], []

    async def _mint(**kw):
        card = {"id": kw["card_id"], "code": "GC-" + uuid.uuid4().hex[:8].upper(),
                "recipient_email": kw.get("recipient_email"), "amount": kw["amount"],
                "client_id": kw.get("client_id")}
        minted.append(kw)
        return card

    async def _email(card):
        emailed.append(card)

    with _public_shop_open(), _guest_orders():
        amounts = run(server.gift_card_shop.offered_amounts())
        ref = server.gift_card_shop.ref_id_for(amounts[0])
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body([_item("gift_card", ref)],
                                                     email="gifty@example.com"), _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        out = run(server.gift_card_shop.fulfill_line(order, order["lines"][0], mint=_mint, email=_email))
        assert out["count"] == 1
        assert minted[0]["client_id"] is None, "no account is invented to hold the card"
        assert emailed[0]["recipient_email"] == "gifty@example.com"


def test_a_guest_can_send_a_gift_card_to_somebody_else():
    with _public_shop_open(), _guest_orders():
        amounts = run(server.gift_card_shop.offered_amounts())
        ref = server.gift_card_shop.ref_id_for(amounts[0])
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body(
                [_item("gift_card", ref, recipient_email="nan@example.com",
                       recipient_name="Nan", gift_message="Happy birthday")],
                email="buyer@example.com"), _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        line = order["lines"][0]
        assert line["recipient_email"] == "nan@example.com"
        assert line["recipient_name"] == "Nan"
        assert line["gift_message"] == "Happy birthday"


# ═══════════════════════════════════════════════ 9. stock, under load

def test_two_guests_and_one_last_unit():
    with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=1) as p:
        ok, refused = 0, 0
        with _stripe_mocked():
            for email in ("a@example.com", "b@example.com"):
                try:
                    run(guest_checkout(_guest_body([_item("product", p["id"])], email=email), _Req()))
                    ok += 1
                except HTTPException:
                    refused += 1
        assert (ok, refused) == (1, 1), "exactly one guest gets the last one"
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(fresh.get("stock_reserved") or 0) == 1.0


def test_a_refused_guest_leaves_no_reservation_behind():
    with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=1) as p:
        with _stripe_mocked():
            try:
                run(guest_checkout(_guest_body([_item("product", p["id"], 9)]), _Req()))
            except HTTPException:
                pass
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(fresh.get("stock_reserved") or 0) == 0.0
        assert float(fresh.get("stock_on_hand") or 0) == 1.0


# ══════════════════════════ 10. the checks behind the first line of defence

def _forge_claim(*, idempotency_key, items, attacker_email, target_order_id,
                 buyer_key, client_id=None):
    """A claim row that would pass the fingerprint check for `attacker_email`
    but points at somebody else's order.

    Built by hand on purpose. The fingerprint check already refuses the
    ordinary cross-guest attempt, which means the checks BELOW it never run
    in a normal test and could be deleted without anything going red. This
    puts the system into the state those checks exist for.
    """
    attacker = shop_checkout.guest_buyer(email=attacker_email, name="Mallory")
    fingerprint = server._request_fingerprint(attacker.identity_key, [
        {"kind": i.kind, "ref_id": i.ref_id, "quantity": i.quantity, "dog_id": i.dog_id}
        for i in server._normalize_cart_lines(items)
    ])
    run(server.db.shop_checkout_claims.insert_one({
        "id": str(uuid.uuid4()), "idempotency_key": idempotency_key,
        "request_fingerprint": fingerprint, "client_id": client_id,
        "buyer_key": buyer_key, "shop_order_id": target_order_id,
        "created_at": server.now_iso(), "updated_at": server.now_iso(),
    }))


def test_a_claim_belonging_to_another_buyer_is_refused_even_when_the_cart_matches():
    # Without buyer_key this compares None to None for two guests, agrees,
    # and hands over a Stripe URL for a cart that is not theirs.
    with _public_shop_open(), _guest_orders(), _product() as p:
        items = [_item("product", p["id"])]
        with _stripe_mocked():
            victim = run(guest_checkout(_guest_body(items, email="victim@example.com"), _Req()))
        idem = f"forged-{uuid.uuid4().hex}"
        victim_key = shop_checkout.guest_buyer(email="victim@example.com", name="V").identity_key
        _forge_claim(idempotency_key=idem, items=items, attacker_email="mallory@example.com",
                     target_order_id=victim["order_id"], buyer_key=victim_key)
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body(items, idem=idem, email="mallory@example.com"), _Req()))
            assert False, "a claim owned by somebody else must not be resumable"
        except HTTPException as e:
            # The MESSAGE matters: an order that already has a Stripe attempt
            # in flight raises its own 409, and asserting only the code let
            # this test pass with every ownership guard removed.
            assert e.status_code == 409 and e.detail == "This idempotency key was already used for a different request.", e.detail
        finally:
            run(server.db.shop_checkout_claims.delete_many({"idempotency_key": idem}))


def test_a_resumed_order_is_re_checked_against_the_buyer_itself():
    # The claim row and the order it points at could come apart. This is the
    # check that notices — proven by handing a guest a claim that passes
    # every claim-level test but points at a signed-in client's order.
    cid = str(uuid.uuid4())
    # Deliberately the SAME address the guest will present. Otherwise the
    # email check refuses this on its own and the shape check — the one
    # actually on trial here — is never reached.
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} C", "email": "mallory@example.com"}))
    try:
        with _public_shop_open(), _guest_orders(), _product() as p:
            items = [_item("product", p["id"])]
            user = {"id": str(uuid.uuid4()), "role": "client", "client_id": cid}
            with _stripe_mocked():
                theirs = run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=items, idempotency_key=f"c-{uuid.uuid4().hex}"), user))
            idem = f"forged-{uuid.uuid4().hex}"
            mallory = shop_checkout.guest_buyer(email="mallory@example.com", name="M")
            _forge_claim(idempotency_key=idem, items=items, attacker_email="mallory@example.com",
                         target_order_id=theirs["order_id"], buyer_key=mallory.identity_key)
            try:
                with _stripe_mocked():
                    run(guest_checkout(_guest_body(items, idem=idem, email="mallory@example.com"), _Req()))
                assert False, "a guest must not resume a client's order"
            except HTTPException as e:
                assert e.status_code == 409 and e.detail == "This idempotency key was already used for a different request.", e.detail
            finally:
                run(server.db.shop_checkout_claims.delete_many({"idempotency_key": idem}))
    finally:
        run(server.db.clients.delete_one({"id": cid}))


def test_a_resumed_guest_order_must_match_the_email_in_front_of_us():
    with _public_shop_open(), _guest_orders(), _product() as p:
        items = [_item("product", p["id"])]
        with _stripe_mocked():
            victim = run(guest_checkout(_guest_body(items, email="victim@example.com"), _Req()))
        idem = f"forged-{uuid.uuid4().hex}"
        mallory = shop_checkout.guest_buyer(email="mallory@example.com", name="M")
        _forge_claim(idempotency_key=idem, items=items, attacker_email="mallory@example.com",
                     target_order_id=victim["order_id"], buyer_key=mallory.identity_key)
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body(items, idem=idem, email="mallory@example.com"), _Req()))
            assert False, "one guest must not resume another guest's order"
        except HTTPException as e:
            assert e.status_code == 409 and e.detail == "This idempotency key was already used for a different request.", e.detail
        finally:
            run(server.db.shop_checkout_claims.delete_many({"idempotency_key": idem}))


def test_a_claim_is_refused_on_its_own_terms_before_any_order_exists():
    """The claim-level ownership check, with nothing else standing behind it.

    Every other ownership test here is ultimately caught by the ORDER
    checks, which can only run once an order exists. A claim can outlive
    the attempt that made it — the first request is refused at eligibility
    after the claim row is written, and the claim is left pointing at an
    order that was never created. This is that state, and at this moment
    the claim's own record of who it belongs to is the only thing there is.
    """
    with _public_shop_open(), _guest_orders(), _product() as p:
        items = [_item("product", p["id"])]
        idem = f"orphan-{uuid.uuid4().hex}"
        victim_key = shop_checkout.guest_buyer(email="victim@example.com", name="V").identity_key
        _forge_claim(idempotency_key=idem, items=items, attacker_email="mallory@example.com",
                     target_order_id=str(uuid.uuid4()),  # claimed, never created
                     buyer_key=victim_key)
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body(items, idem=idem, email="mallory@example.com"), _Req()))
            assert False, "somebody else's claim must not be adoptable"
        except HTTPException as e:
            assert e.status_code == 409 and e.detail == "This idempotency key was already used for a different request.", e.detail
        finally:
            run(server.db.shop_checkout_claims.delete_many({"idempotency_key": idem}))


# ═══════════════════════════════════════ 11. stock that was walked away from

def test_a_new_guest_checkout_gives_back_stock_an_abandoned_one_was_holding():
    """A checkout reserves stock before the money arrives. For a signed-in
    client the reservation comes back when they return to look; a guest needs
    no account, so nothing guarantees anyone ever looks again. New guest
    checkouts therefore tidy up a few old ones on the way past.

    Stripe stays the authority — the attempt is only released because Stripe
    says the session is gone, never because a clock ran out.
    """
    with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=1) as p:
        with _stripe_mocked():
            abandoned = run(guest_checkout(_guest_body([_item("product", p["id"])],
                                                        email="gone@example.com"), _Req()))
        held = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(held.get("stock_reserved") or 0) == 1.0, "the abandoned order holds the last one"

        # Nobody ever came back, and Stripe's session has expired.
        run(server.db.shop_payment_attempts.update_many(
            {"shop_order_id": abandoned["order_id"]},
            {"$set": {"expires_at": "2020-01-01T00:00:00+00:00"}}))

        expired_session = {"id": "cs_expired", "payment_status": "unpaid", "status": "expired"}

        class _Retrieved(dict):
            def to_dict(self):
                return expired_session

        orig = server.stripe.checkout.Session.retrieve
        server.stripe.checkout.Session.retrieve = lambda *a, **k: _Retrieved()
        try:
            with _stripe_mocked():
                second = run(guest_checkout(_guest_body([_item("product", p["id"])],
                                                         email="next@example.com"), _Req()))
        finally:
            server.stripe.checkout.Session.retrieve = orig

        assert second["order_id"] != abandoned["order_id"]
        fresh = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(fresh.get("stock_reserved") or 0) == 1.0, \
            "the last one is held by the NEW order, not still by the abandoned one"
        dead = run(server.db.shop_orders.find_one({"id": abandoned["order_id"]}, {"_id": 0}))
        assert dead["status"] == "canceled"


def test_the_sweep_never_takes_a_guest_checkout_down_with_it():
    # Tidying up somebody else's mess is not this customer's problem.
    with _public_shop_open(), _guest_orders(), _product() as first, _product() as second:
        with _stripe_mocked():
            abandoned = run(guest_checkout(_guest_body([_item("product", first["id"])],
                                                        email="gone@example.com"), _Req()))
        run(server.db.shop_payment_attempts.update_many(
            {"shop_order_id": abandoned["order_id"]},
            {"$set": {"expires_at": "2020-01-01T00:00:00+00:00"}}))

        def _boom(*a, **k):
            raise RuntimeError("Stripe is having a bad day")

        orig = server.stripe.checkout.Session.retrieve
        server.stripe.checkout.Session.retrieve = _boom
        try:
            with _stripe_mocked():
                ok = run(guest_checkout(_guest_body([_item("product", second["id"])],
                                                     email="next@example.com"), _Req()))
        finally:
            server.stripe.checkout.Session.retrieve = orig
        assert ok["order_id"], "the sale went through anyway"


# ═══════════════════════════════════════ 12. what a stranger is allowed to say

def test_a_guests_name_is_stored_exactly_as_they_typed_it():
    """This used to strip `<` and `>`, to stop a name reaching the operator's
    notification email as markup. The renderer escapes on output now
    (email_service._h — see test_email_html_escaping.py), so the fix lives
    where the value becomes HTML and the stored value is left alone.

    Which matters: somebody really is called `John <Sam> Smith`, and a shop
    that silently renames its customers is its own kind of bug.
    """
    keep = shop_checkout.clean_guest_name
    assert keep("Siobhán O'Brien-Smith") == "Siobhán O'Brien-Smith"
    assert keep("Ben & Jerry") == "Ben & Jerry"
    assert keep("John <Sam> Smith") == "John <Sam> Smith"
    assert keep('<script>alert(1)</script>') == '<script>alert(1)</script>'
    # What is still cleaned has nothing to do with markup: one line, and a
    # bound on length.
    assert keep("  Sam   \n  Guest  ") == "Sam Guest"
    assert len(keep("x" * 500)) == 120


def test_the_name_on_the_order_is_the_name_they_typed():
    # Stored verbatim. Safety is the renderer's job, at the moment the value
    # becomes HTML — see test_email_html_escaping.py.
    with _public_shop_open(), _guest_orders(), _product() as p:
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body(
                [_item("product", p["id"])], name='John <Sam> Smith'), _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order["client_name"] == "John <Sam> Smith"


def test_a_guest_email_is_stored_lowercased_and_trimmed():
    # Two spellings of one address must not become two buyers with two
    # separate idempotency identities.
    a = shop_checkout.guest_buyer(email="  Sam@Example.COM ", name="Sam")
    b = shop_checkout.guest_buyer(email="sam@example.com", name="Sam")
    assert a.email == "sam@example.com"
    assert a.identity_key == b.identity_key


def test_the_token_is_accepted_as_a_header_as_well_as_a_query_parameter():
    """Stripe returns the customer to a URL, so the query parameter has to
    work — but query strings land in access logs, proxy logs and browser
    history, and this token is read access to somebody's order. Every
    request after that first hop sends a header instead."""
    class _ReqWithToken(_Req):
        def __init__(self, token):
            super().__init__()
            self.headers = {"x-guest-token": token}

    with _public_shop_open(), _guest_orders(), _product() as p:
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body([_item("product", p["id"])]), _Req()))
        oid, token = result["order_id"], result["guest_token"]

        # Header alone, no query parameter at all.
        ok = run(guest_order_status(oid, _ReqWithToken(token), token=""))
        assert ok["order_id"] == oid
        # The header is not a way around the check.
        try:
            run(guest_order_status(oid, _ReqWithToken("nope"), token=""))
            assert False, "a wrong header token must not open the order"
        except HTTPException as e:
            assert e.status_code == 404
        # And the query parameter still works, because Stripe needs it to.
        assert run(guest_order_status(oid, _Req(), token=token))["order_id"] == oid


# ════════════════════════════════════ 13. who is collecting this, exactly

def test_merchandise_a_stranger_will_collect_needs_a_name_on_it():
    # Nothing is posted. Without a name the desk has a paid order and nobody
    # to hand it to.
    with _public_shop_open(), _guest_orders(), _product() as p:
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("product", p["id"])], name="  "), _Req()))
            assert False, "expected a name to be required for a collection order"
        except HTTPException as e:
            assert e.status_code == 422
            assert "name" in str(e.detail).lower()


def test_a_gift_card_on_its_own_needs_no_name_because_nobody_collects_it():
    with _public_shop_open(), _guest_orders():
        amounts = run(server.gift_card_shop.offered_amounts())
        with _stripe_mocked():
            result = run(guest_checkout(_guest_body(
                [_item("gift_card", server.gift_card_shop.ref_id_for(amounts[0]))], name=""), _Req()))
        assert result["order_id"]


def test_a_phone_number_rides_along_but_is_never_required():
    with _public_shop_open(), _guest_orders(), _product() as p:
        body = guest_routes.GuestCheckoutIn(
            items=[_item("product", p["id"])], idempotency_key=f"g-{uuid.uuid4().hex}",
            email="buyer@example.com", name="Sam Guest", phone="555-0100")
        with _stripe_mocked():
            result = run(guest_checkout(body, _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order["client_phone"] == "555-0100"


# ═══════════════════════════════ 14. everything a hostile browser can send

def _smuggle(field_map):
    """A cart line carrying fields the model does not define. model_construct
    keeps whatever it is handed, which is exactly how a smuggled field would
    arrive if one ever slipped past the schema."""
    return server.ShopCartItemIn.model_construct(**field_map)


def test_every_smuggled_field_is_ignored_and_the_real_numbers_win():
    with _public_shop_open(), _guest_orders(), _product(price=30.0) as p:
        hostile = _smuggle({
            "kind": "product", "ref_id": p["id"], "quantity": 1, "dog_id": None,
            "recipient_email": None, "recipient_name": None, "gift_message": None,
            # money
            "unit_price": 0.01, "price": 0.01, "list_unit_price": 0.01,
            "line_total": 0.01, "line_subtotal": 0.01, "subtotal": 0.01,
            "total": 0.01, "tax": 0, "tax_amount": 0, "allocated_tax": 0,
            "discount": 99.0, "discount_amount": 99.0,
            # identity and ownership
            "client_id": "somebody-elses-client-id",
            "price_override_id": "made-up-override",
            "pricing_source": "grandfathered", "has_price_override": True,
            # entitlement and fulfillment
            "fulfillment_kind": "online_school", "fulfillment_status": "fulfilled",
            "purchase_fulfillment": "online_school", "program_id": "x",
            # catalog
            "name": "Free Everything", "taxable": False,
            "track_inventory": False, "stock_on_hand": 99999, "in_stock": True,
            "guest_cart_allowed": True, "publicly_visible": True, "active": True,
        })
        body = guest_routes.GuestCheckoutIn.model_construct(
            items=[hostile], idempotency_key=f"g-{uuid.uuid4().hex}",
            email="buyer@example.com", name="Sam Guest", phone="")
        with _stripe_mocked():
            result = run(guest_checkout(body, _Req()))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        line = order["lines"][0]

        assert order["client_id"] is None, "a smuggled client_id must not become ownership"
        assert order["is_guest_order"] is True
        assert line["unit_price"] == 30.0, "the price came from the product row"
        assert line["name"] == p["name"], "the title came from the product row"
        assert line["taxable"] is True, "taxability is the product's, not the cart's"
        assert line["fulfillment_status"] == "pending", "nothing arrives pre-fulfilled"
        assert line.get("fulfillment_kind") is None, "a product has no fulfillment kind"
        assert line.get("price_override_id") is None
        assert line["pricing_source"] == "standard"
        # The smuggled 99.00 discount changed nothing: the order is the
        # product price, plus whatever tax the shop is actually configured
        # for (none, in this database) and never less.
        assert order["subtotal"] == 30.0
        assert order["total"] >= 30.0, "no smuggled discount was honoured"
        assert order["total"] == round(30.0 + order["tax_amount"], 2)


def test_a_smuggled_dog_id_cannot_manufacture_ownership():
    # dog_id is only ever meaningful for an Online School program, which a
    # guest may not buy at all — so it must die at the kind check, not be
    # quietly carried onto a line.
    cid = str(uuid.uuid4())
    dog_id = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Owner", "email": "own@example.com"}))
    run(server.db.dogs.insert_one({"id": dog_id, "name": f"{TAG} Dog", "owner_id": cid}))
    try:
        with _public_shop_open(), _guest_orders(), _program(purchase_fulfillment="online_school", delivery_mode="self_guided") as prog:
            try:
                with _stripe_mocked():
                    run(guest_checkout(_guest_body(
                        [_item("training_program", prog["id"], dog_id=dog_id)]), _Req()))
                assert False, "a guest must not enrol a dog that is not theirs"
            except HTTPException as e:
                assert e.status_code == 403
            assert run(server.db.dog_programs.count_documents({"dog_id": dog_id})) == 0
    finally:
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.dogs.delete_one({"id": dog_id}))


def test_a_product_that_does_not_exist_is_refused():
    with _public_shop_open(), _guest_orders():
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("product", str(uuid.uuid4()))]), _Req()))
            assert False, "expected a made-up product to be refused"
        except HTTPException as e:
            assert e.status_code in (400, 403, 404)


def test_a_malformed_gift_recipient_is_refused_before_anything_is_charged():
    with _public_shop_open(), _guest_orders():
        amounts = run(server.gift_card_shop.offered_amounts())
        ref = server.gift_card_shop.ref_id_for(amounts[0])
        for bad in ("not-an-email", "@example.com", "nan@"):
            try:
                with _stripe_mocked() as calls:
                    run(guest_checkout(_guest_body(
                        [_item("gift_card", ref, recipient_email=bad)]), _Req()))
                assert False, "expected %r to be refused" % bad
            except HTTPException as e:
                assert e.status_code == 422
            assert calls == []
        # A message with nowhere to send it is a present nobody receives.
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body(
                    [_item("gift_card", ref, gift_message="Happy birthday")]), _Req()))
            assert False, "expected a message with no recipient to be refused"
        except HTTPException as e:
            assert e.status_code == 422


def test_a_made_up_gift_card_amount_is_refused():
    with _public_shop_open(), _guest_orders():
        try:
            with _stripe_mocked():
                run(guest_checkout(_guest_body([_item("gift_card", "gc-1")]), _Req()))
            assert False, "expected an unoffered amount to be refused"
        except HTTPException as e:
            assert e.status_code in (400, 422)


# ══════════════════════════ 15. after the money lands, for a guest order

def _paid_session(order_id, attempt):
    """What Stripe sends back when a guest has actually paid.

    Built to match the attempt exactly, because _verify_shop_stripe_session_
    authoritative independently re-checks every one of these against the
    stored order before a single thing is fulfilled — which is the point of
    driving fulfilment this way rather than calling the fulfil helpers
    directly.
    """
    return {
        "id": attempt["stripe_checkout_session_id"],
        "currency": "usd",
        "payment_status": "paid",
        "amount_total": server._stripe_amount_cents(
            run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))["total"]),
        "metadata": {
            "sithappens_shop_order_id": order_id,
            "sithappens_attempt_id": attempt["id"],
            "sithappens_client_id": "",
            "sithappens_guest_order": "1",
        },
    }


def _pay(order_id):
    attempt = run(server.db.shop_payment_attempts.find_one(
        {"shop_order_id": order_id}, {"_id": 0}))
    return run(server._apply_shop_payment(attempt, _paid_session(order_id, attempt)))


def test_a_paid_guest_order_fulfils_the_whole_way_through():
    minted, emailed = [], []

    async def _mint(**kw):
        card = {"id": kw["card_id"], "code": "GC-" + uuid.uuid4().hex[:8].upper(),
                "recipient_email": kw.get("recipient_email"), "amount": kw["amount"],
                "client_id": kw.get("client_id"), "initial_amount": kw["amount"],
                "balance": kw["amount"]}
        minted.append(kw)
        await server.db.gift_cards.insert_one(dict(card))
        return card

    async def _email(card):
        emailed.append(card)

    orig_mint = server.gift_card_services.mint_card
    orig_email = server.gift_card_services.send_card_email
    server.gift_card_services.mint_card = _mint
    server.gift_card_services.send_card_email = _email
    try:
        with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=4, price=20.0) as p:
            amounts = run(server.gift_card_shop.offered_amounts())
            ref = server.gift_card_shop.ref_id_for(amounts[0])
            with _stripe_mocked():
                result = run(guest_checkout(_guest_body([
                    _item("product", p["id"], 2),
                    # The purchaser and the recipient are deliberately two
                    # different people — confusing them is how a present ends
                    # up back at the buyer.
                    _item("gift_card", ref, recipient_email="nan@example.com",
                          recipient_name="Nan", gift_message="Happy birthday"),
                ], email="buyer@example.com"), _Req()))
            oid = result["order_id"]

            reserved = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
            assert float(reserved.get("stock_reserved") or 0) == 2.0

            order = _pay(oid)

            assert order["status"] == "paid"
            assert order["fulfillment_status"] == "fulfilled"
            assert order["pickup_status"] == "preparing", "there is merchandise to collect"
            assert all(l["fulfillment_status"] == "fulfilled" for l in order["lines"])

            # Stock actually moved, and is no longer merely reserved.
            after = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
            assert float(after["stock_on_hand"]) == 2.0
            assert float(after.get("stock_reserved") or 0) == 0.0

            # The card went to the recipient, not the buyer, and belongs to
            # no account.
            assert len(minted) == 1
            assert minted[0]["client_id"] is None
            assert emailed[0]["recipient_email"] == "nan@example.com"

            # The money landed in the canonical places, with no client.
            payment = run(server.db.payments.find_one({"shop_order_id": oid}, {"_id": 0}))
            assert payment["client_id"] is None
            assert payment["amount"] == order["total"]
            retail = run(server.db.retail_sales.find_one({"shop_order_id": oid}, {"_id": 0}))
            assert retail["client_id"] is None
            assert retail["amount"] == order["total"]
            # Only the merchandise is taxed; a gift card is money.
            assert retail["tax_amount"] == order["tax_amount"]
            assert round(retail["pre_tax_amount"], 2) == round(order["subtotal"], 2)
    finally:
        server.gift_card_services.mint_card = orig_mint
        server.gift_card_services.send_card_email = orig_email


def test_a_webhook_replay_changes_absolutely_nothing():
    """Stripe redelivers. The Front Desk has a Retry Fulfillment button. Both
    re-drive this exact path, so the second run must add no money, no stock
    movement and no second gift card."""
    minted = []

    async def _mint(**kw):
        card = {"id": kw["card_id"], "code": "GC-" + uuid.uuid4().hex[:8].upper(),
                "recipient_email": kw.get("recipient_email"), "amount": kw["amount"],
                "client_id": kw.get("client_id"), "initial_amount": kw["amount"],
                "balance": kw["amount"]}
        minted.append(kw)
        await server.db.gift_cards.insert_one(dict(card))
        return card

    async def _email(card):
        return None

    orig_mint = server.gift_card_services.mint_card
    orig_email = server.gift_card_services.send_card_email
    server.gift_card_services.mint_card = _mint
    server.gift_card_services.send_card_email = _email
    try:
        with _public_shop_open(), _guest_orders(), _product(track_inventory=True, starting_stock=3, price=15.0) as p:
            amounts = run(server.gift_card_shop.offered_amounts())
            ref = server.gift_card_shop.ref_id_for(amounts[0])
            with _stripe_mocked():
                result = run(guest_checkout(_guest_body([
                    _item("product", p["id"], 1),
                    _item("gift_card", ref, recipient_email="nan@example.com"),
                ]), _Req()))
            oid = result["order_id"]

            _pay(oid)
            stock_once = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))["stock_on_hand"]
            payments_once = run(server.db.payments.count_documents({"shop_order_id": oid}))
            retail_once = run(server.db.retail_sales.count_documents({"shop_order_id": oid}))
            cards_once = len(minted)

            _pay(oid)   # the redelivery
            _pay(oid)   # and staff pressing Retry for good measure

            assert run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))["stock_on_hand"] == stock_once
            assert run(server.db.payments.count_documents({"shop_order_id": oid})) == payments_once == 1
            assert run(server.db.retail_sales.count_documents({"shop_order_id": oid})) == retail_once == 1
            assert len(minted) == cards_once == 1, "a replay must not mint a second card"
    finally:
        server.gift_card_services.mint_card = orig_mint
        server.gift_card_services.send_card_email = orig_email


def test_a_paid_gift_card_only_guest_order_needs_no_pickup():
    async def _mint(**kw):
        card = {"id": kw["card_id"], "code": "GC-" + uuid.uuid4().hex[:8].upper(),
                "recipient_email": kw.get("recipient_email"), "amount": kw["amount"],
                "initial_amount": kw["amount"], "balance": kw["amount"]}
        await server.db.gift_cards.insert_one(dict(card))
        return card

    async def _email(card):
        return None

    orig_mint = server.gift_card_services.mint_card
    orig_email = server.gift_card_services.send_card_email
    server.gift_card_services.mint_card = _mint
    server.gift_card_services.send_card_email = _email
    try:
        with _public_shop_open(), _guest_orders():
            amounts = run(server.gift_card_shop.offered_amounts())
            with _stripe_mocked():
                result = run(guest_checkout(_guest_body(
                    [_item("gift_card", server.gift_card_shop.ref_id_for(amounts[0]))],
                    name=""), _Req()))
            order = _pay(result["order_id"])
            assert order["pickup_status"] == "not_applicable"
            assert order["tax_amount"] == 0.0, "money is not taxed"
    finally:
        server.gift_card_services.mint_card = orig_mint
        server.gift_card_services.send_card_email = orig_email


def test_the_guest_can_watch_their_order_become_paid_with_their_token():
    async def _mint(**kw):
        card = {"id": kw["card_id"], "code": "X", "initial_amount": kw["amount"],
                "balance": kw["amount"], "recipient_email": kw.get("recipient_email")}
        await server.db.gift_cards.insert_one(dict(card))
        return card

    async def _email(card):
        return None

    orig_mint = server.gift_card_services.mint_card
    orig_email = server.gift_card_services.send_card_email
    server.gift_card_services.mint_card = _mint
    server.gift_card_services.send_card_email = _email
    try:
        with _public_shop_open(), _guest_orders():
            amounts = run(server.gift_card_shop.offered_amounts())
            with _stripe_mocked():
                result = run(guest_checkout(_guest_body(
                    [_item("gift_card", server.gift_card_shop.ref_id_for(amounts[0]))],
                    name=""), _Req()))
            oid, token = result["order_id"], result["guest_token"]
            before = run(guest_order_status(oid, _Req(), token=token))
            assert before["status"] == "pending_payment"
            _pay(oid)
            after = run(guest_order_status(oid, _Req(), token=token))
            assert after["status"] == "paid"
            assert after["fulfillment_status"] == "fulfilled"
            # The same token, and only that token, still opens it.
            try:
                run(guest_order_status(oid, _Req(), token="nope"))
                assert False
            except HTTPException as e:
                assert e.status_code == 404
    finally:
        server.gift_card_services.mint_card = orig_mint
        server.gift_card_services.send_card_email = orig_email


# ═══════════════════════ 16. the same hostility, but signed in

def _client_user_for(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id,
            "name": f"{TAG} signed-in"}


@contextlib.contextmanager
def _client_with_dogs(n=2):
    """A real client account with real dogs, plus somebody else's dog."""
    cid, other = str(uuid.uuid4()), str(uuid.uuid4())
    dogs = [str(uuid.uuid4()) for _ in range(n)]
    other_dog = str(uuid.uuid4())
    run(server.db.clients.insert_many([
        {"id": cid, "name": f"{TAG} Client", "email": f"{uuid.uuid4().hex[:8]}@example.com"},
        {"id": other, "name": f"{TAG} Other", "email": f"{uuid.uuid4().hex[:8]}@example.com"},
    ]))
    run(server.db.dogs.insert_many(
        [{"id": d, "name": f"Dog{i}", "owner_id": cid, "birthday": "2022-01-01"}
         for i, d in enumerate(dogs)]
        + [{"id": other_dog, "name": "NotYours", "owner_id": other, "birthday": "2022-01-01"}]))
    try:
        yield {"client_id": cid, "dogs": dogs, "other_dog": other_dog, "other_client": other}
    finally:
        run(server.db.clients.delete_many({"id": {"$in": [cid, other]}}))
        run(server.db.dogs.delete_many({"id": {"$in": dogs + [other_dog]}}))
        run(server.db.shop_orders.delete_many({"client_id": cid}))
        run(server.db.shop_checkout_claims.delete_many({"client_id": cid}))
        run(server.db.shop_payment_attempts.delete_many({"client_id": cid}))


def test_a_signed_in_client_cannot_buy_a_course_for_somebody_elses_dog():
    """The guest path refuses this by refusing training outright. The
    SIGNED-IN path has to refuse it on ownership, which is a different
    check and was never pinned from this direction."""
    with _public_shop_open(), _client_with_dogs() as who, \
            _program(purchase_fulfillment="online_school", delivery_mode="self_guided") as prog:
        user = _client_user_for(who["client_id"])
        try:
            with _stripe_mocked() as calls:
                run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=[_item("training_program", prog["id"], dog_id=who["other_dog"])],
                    idempotency_key=f"x-{uuid.uuid4().hex}"), user))
            assert False, "a client must not enrol a dog that is not theirs"
        except HTTPException as e:
            assert e.status_code == 422
            assert "not found on this account" in str(e.detail).lower()
        assert calls == []
        assert run(server.db.dog_programs.count_documents({"dog_id": who["other_dog"]})) == 0


def test_a_made_up_dog_id_is_refused_the_same_way():
    with _public_shop_open(), _client_with_dogs() as who, \
            _program(purchase_fulfillment="online_school", delivery_mode="self_guided") as prog:
        user = _client_user_for(who["client_id"])
        try:
            with _stripe_mocked():
                run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=[_item("training_program", prog["id"], dog_id=str(uuid.uuid4()))],
                    idempotency_key=f"y-{uuid.uuid4().hex}"), user))
            assert False, "a dog that does not exist must not be enrollable"
        except HTTPException as e:
            assert e.status_code == 422


def test_a_course_that_needs_a_dog_cannot_be_bought_without_one():
    with _public_shop_open(), _client_with_dogs() as who, \
            _program(purchase_fulfillment="online_school", delivery_mode="self_guided") as prog:
        user = _client_user_for(who["client_id"])
        try:
            with _stripe_mocked():
                run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=[_item("training_program", prog["id"])],
                    idempotency_key=f"z-{uuid.uuid4().hex}"), user))
            assert False, "expected the missing dog to be refused"
        except HTTPException as e:
            assert e.status_code == 422
            assert "dog" in str(e.detail).lower()


def test_a_signed_in_client_cannot_smuggle_a_price_or_somebody_elses_identity():
    """Everything a hostile signed-in browser might add to a cart line. The
    order must come out priced from the product row and owned by the session,
    not by anything in the payload."""
    with _public_shop_open(), _client_with_dogs() as who, _product(price=30.0) as p:
        user = _client_user_for(who["client_id"])
        hostile = server.ShopCartItemIn.model_construct(
            kind="product", ref_id=p["id"], quantity=1, dog_id=None,
            recipient_email=None, recipient_name=None, gift_message=None,
            unit_price=0.01, price=0.01, effective_price=0.01, list_unit_price=0.01,
            discount=99.0, line_total=0.01, total=0.01, tax_amount=0,
            client_id=who["other_client"], price_override_id="made-up",
            pricing_source="grandfathered", has_price_override=True,
            name="Free Everything", taxable=False, stock_on_hand=99999,
        )
        body = server.ShopCheckoutIn.model_construct(
            items=[hostile], idempotency_key=f"s-{uuid.uuid4().hex}")
        with _stripe_mocked():
            result = run(server.create_shop_checkout(body, user))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        line = order["lines"][0]
        assert order["client_id"] == who["client_id"], "ownership comes from the session"
        assert order["is_guest_order"] is False
        assert line["unit_price"] == 30.0
        assert line["name"] == p["name"]
        assert line["pricing_source"] == "standard"
        assert line.get("price_override_id") is None
        assert line["taxable"] is True
        assert order["subtotal"] == 30.0


def test_a_signed_in_client_cannot_exceed_stock_either():
    with _public_shop_open(), _client_with_dogs() as who, \
            _product(track_inventory=True, starting_stock=2) as p:
        user = _client_user_for(who["client_id"])
        try:
            with _stripe_mocked():
                run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=[_item("product", p["id"], 5)],
                    idempotency_key=f"q-{uuid.uuid4().hex}"), user))
            assert False, "expected the stock ceiling to hold"
        except HTTPException as e:
            assert e.status_code in (400, 409)


def test_a_signed_in_client_cannot_buy_something_deactivated():
    with _public_shop_open(), _client_with_dogs() as who, _product() as p:
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"active": False}}))
        user = _client_user_for(who["client_id"])
        try:
            with _stripe_mocked():
                run(server.create_shop_checkout(server.ShopCheckoutIn(
                    items=[_item("product", p["id"])],
                    idempotency_key=f"i-{uuid.uuid4().hex}"), user))
            assert False, "expected a deactivated product to be refused"
        except HTTPException as e:
            assert e.status_code in (400, 409)


def test_switching_dogs_produces_two_lines_rather_than_overwriting_one():
    """Two dogs, one course. The cart must hold two enrolments, not one
    line whose dog quietly changed — that is how a client pays once and
    wonders why only one dog got the course."""
    with _public_shop_open(), _client_with_dogs() as who, \
            _program(purchase_fulfillment="online_school", delivery_mode="self_guided") as prog:
        lines = server._normalize_cart_lines([
            _item("training_program", prog["id"], dog_id=who["dogs"][0]),
            _item("training_program", prog["id"], dog_id=who["dogs"][1]),
        ])
        assert len(lines) == 2
        assert {l.dog_id for l in lines} == set(who["dogs"])
        assert all(l.quantity == 1 for l in lines)


def test_a_guest_receipt_survives_the_public_storefront_being_switched_off():
    """A closed storefront must not take a guest's own receipt with it.

    Found in the release acceptance pass, not by any earlier test: the
    order-detail rewrite started reading the PUBLIC catalogue to put
    thumbnails on a receipt, and that helper 404s when public browsing is
    disabled. The effect was that an admin closing the public shop would
    turn every guest's order page into "Shop is not available" — for people
    who had already paid.

    Thumbnails are decoration. The receipt is not.
    """
    with _product(guest_cart_allowed=True) as p, _guest_orders():
        with _public_shop_open(), _stripe_mocked():
            out = run(shop_checkout.create_checkout(
                buyer=shop_checkout.guest_buyer(email="closed@example.com", name="Sam", phone=""),
                items=[_item("product", p["id"], 1)],
                idempotency_key=f"closed-{uuid.uuid4().hex}"))
        order_id, token = out["order_id"], out["guest_token"]

        # With the shop open, the receipt carries the picture.
        with _public_shop_open():
            open_view = run(_route("public_shop_order_status")(order_id, _Req(), token))
        assert open_view["order_id"] == order_id

        # Now close the public storefront entirely and ask again. Uses this
        # file's own settings helper rather than a hand-rolled save/restore:
        # get_settings is cached, and the helper is what clears it. A manual
        # restore left the cache saying "closed" and took two unrelated
        # tests down with it.
        with _public_shop_open(public_shop_enabled=False, public_browsing_enabled=False):
            closed_view = run(_route("public_shop_order_status")(order_id, _Req(), token))

        assert closed_view["order_id"] == order_id
        assert closed_view["total"] == open_view["total"]
        assert [l["name"] for l in closed_view["lines"]] == [l["name"] for l in open_view["lines"]]
        # The only thing lost is the decoration.
        assert closed_view["lines"][0].get("image_id") is None

        # And the token is still the whole of the authorization.
        for bad in ("", "not-the-token"):
            try:
                run(_route("public_shop_order_status")(order_id, _Req(), bad))
                raise AssertionError("a closed shop must not loosen the token rule")
            except HTTPException as e:
                assert e.status_code == 404
