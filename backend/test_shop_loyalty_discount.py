"""Automatic Shop loyalty discount (owner request 2026-10-15: "regular
clients with at least 10 visits auto get the 10 percent in the shop ...
make it visible to them"). Covers the standalone eligibility module,
_price_shop_cart's "whichever discount is larger, never stacked" rule
against a manual code, the real end-to-end checkout path, and the
GET /shop/loyalty-discount visibility route.

Disposable tag TEST_SHOP_LOYALTY_DISCOUNT.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.shop import discount_codes as shop_discount_codes
from domains.shop import loyalty_discount as shop_loyalty_discount

TAG = "TEST_SHOP_LOYALTY_DISCOUNT"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "loyalty-discount@test"}
THRESHOLD = 10
PCT = 10.0


class _FakeStripeObj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


@contextlib.contextmanager
def _stripe_mocked():
    orig_c, orig_s = server.stripe.Customer.create, server.stripe.checkout.Session.create
    server.stripe.Customer.create = lambda **kw: _FakeStripeObj(id="cus_test_" + uuid.uuid4().hex[:8])
    server.stripe.checkout.Session.create = lambda **kw: _FakeStripeObj(
        id="cs_test_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/x",
        _line_items=kw.get("line_items"))
    try:
        yield
    finally:
        server.stripe.Customer.create, server.stripe.checkout.Session.create = orig_c, orig_s


_made = {"clients": [], "products": [], "codes": []}


def setup_module(_module):
    run(server.db.settings.update_one({"id": "global"}, {"$set": {
        "sales_tax.enabled": False,
        "loyalty.loyalty_tier_bronze_visits": THRESHOLD,
        "loyalty.loyalty_tier_bronze_shop_discount_pct": PCT,
    }}, upsert=True))


def teardown_module(_module):
    cids = _made["clients"]
    oids = [o["id"] for o in run(server.db.shop_orders.find({"client_id": {"$in": cids}}, {"_id": 0, "id": 1}).to_list(500))]
    run(server.db.retail_sales.delete_many({"shop_order_id": {"$in": oids}}))
    for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts", "payments", "bookings"):
        run(server.db[coll].delete_many({"client_id": {"$in": cids}}))
    run(server.db.clients.delete_many({"id": {"$in": cids}}))
    run(server.db.pos_products.delete_many({"id": {"$in": _made["products"]}}))
    run(server.db.shop_discount_codes.delete_many({"id": {"$in": _made["codes"]}}))
    run(server.db.shop_discount_code_redemptions.delete_many({"code_id": {"$in": _made["codes"]}}))


def _client(visits=0):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": f"{TAG} Client", "email": f"{cid[:8]}@example.com",
        "credits": 0, "created_at": server.now_iso(),
    }))
    _made["clients"].append(cid)
    if visits:
        # _client_visit_count only COUNTS matching documents — it doesn't
        # care that every one of them happened on the same day.
        run(server.db.bookings.insert_many([
            {"id": str(uuid.uuid4()), "client_id": cid, "client_name": f"{TAG} Client",
             "date": "2026-01-01", "service_type": "daycare",
             "status": "completed", "checked_out_at": "2026-01-01T17:00:00+00:00"}
            for _ in range(visits)
        ]))
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": f"{TAG} Client"}


def _product(price):
    p = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Item {uuid.uuid4().hex[:6]}", price=price, show_online=True, active=True, starting_stock=0), ADMIN))
    _made["products"].append(p["id"])
    return p


def _code(**overrides):
    body = {"code": f"{TAG}-{uuid.uuid4().hex[:6]}", "kind": "percent", "value": 5.0, "clients_only": True}
    body.update(overrides)
    doc = run(shop_discount_codes.create_code(
        server.db, shop_discount_codes.ShopDiscountCodeIn(**body), actor_id="admin", actor_name="Admin"))
    _made["codes"].append(doc["id"])
    return doc


def _pay(user, product, discount_code=None):
    item = server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)
    with _stripe_mocked():
        out = run(server.create_shop_checkout(
            server.ShopCheckoutIn(items=[item], idempotency_key=f"{TAG}-{uuid.uuid4().hex}", discount_code=discount_code), user))
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _FakeStripeObj(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                              amount_total=server._stripe_amount_cents(order["total"]),
                              metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    return run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))


# ──────────────────────────────────────────────── domains.shop.loyalty_discount ─

def test_eligible_discount_none_below_threshold():
    settings = {"loyalty": {"loyalty_tier_bronze_visits": THRESHOLD, "loyalty_tier_bronze_shop_discount_pct": PCT}}
    user = _client(visits=THRESHOLD - 1)
    out = run(shop_loyalty_discount.eligible_discount(server.db, user["client_id"], settings=settings))
    assert out is None


def test_eligible_discount_true_at_threshold():
    settings = {"loyalty": {"loyalty_tier_bronze_visits": THRESHOLD, "loyalty_tier_bronze_shop_discount_pct": PCT}}
    user = _client(visits=THRESHOLD)
    out = run(shop_loyalty_discount.eligible_discount(server.db, user["client_id"], settings=settings))
    assert out == {"pct": PCT, "min_visits": THRESHOLD, "visits": THRESHOLD}


def test_eligible_discount_none_with_no_client():
    settings = {"loyalty": {"loyalty_tier_bronze_visits": THRESHOLD, "loyalty_tier_bronze_shop_discount_pct": PCT}}
    assert run(shop_loyalty_discount.eligible_discount(server.db, None, settings=settings)) is None


def test_eligible_discount_off_when_percent_is_zero():
    settings = {"loyalty": {"loyalty_tier_bronze_visits": THRESHOLD, "loyalty_tier_bronze_shop_discount_pct": 0}}
    user = _client(visits=THRESHOLD + 5)
    assert run(shop_loyalty_discount.eligible_discount(server.db, user["client_id"], settings=settings)) is None


# ───────────────────────────────────────────────────── _price_shop_cart ────

def test_price_shop_cart_auto_applies_loyalty_discount_with_no_code():
    user = _client(visits=THRESHOLD)
    product = _product(80.0)
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
        client_id=user["client_id"],
    ))
    assert priced["discount_amount"] == 8.0
    assert priced["discount_source"] == "loyalty"
    assert priced["loyalty_discount_pct"] == PCT
    assert priced["discount_code"] is None
    assert priced["total"] == 72.0


def test_price_shop_cart_a_client_below_threshold_gets_no_auto_discount():
    user = _client(visits=THRESHOLD - 1)
    product = _product(80.0)
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
        client_id=user["client_id"],
    ))
    assert priced["discount_amount"] == 0.0
    assert priced["discount_source"] is None
    assert priced["total"] == 80.0


def test_loyalty_beats_a_weaker_code_and_the_code_is_not_the_one_applied():
    user = _client(visits=THRESHOLD)  # 10% loyalty
    product = _product(80.0)
    weaker_code = _code(value=5.0)    # 5% — loses
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
        client_id=user["client_id"], discount_code=weaker_code["code"],
    ))
    assert priced["discount_source"] == "loyalty"
    assert priced["discount_amount"] == 8.0        # 10% of $80, not 5%
    assert priced["discount_code"] is None          # the code is not what got applied
    assert priced["discount_code_id"] is None


def test_a_stronger_code_beats_loyalty():
    user = _client(visits=THRESHOLD)  # 10% loyalty
    product = _product(80.0)
    stronger_code = _code(value=20.0)  # 20% — wins
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
        client_id=user["client_id"], discount_code=stronger_code["code"],
    ))
    assert priced["discount_source"] == "code"
    assert priced["discount_amount"] == 16.0
    assert priced["discount_code"] == stronger_code["code"]
    assert priced["loyalty_discount_pct"] is None


def test_an_exact_tie_favors_loyalty_over_the_code():
    user = _client(visits=THRESHOLD)       # 10% loyalty
    product = _product(80.0)
    tied_code = _code(value=10.0)          # also 10% — exact tie
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
        client_id=user["client_id"], discount_code=tied_code["code"],
    ))
    assert priced["discount_source"] == "loyalty"
    assert priced["discount_code"] is None


def test_guest_checkout_never_gets_the_loyalty_discount():
    product = _product(80.0)
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
        client_id=None, is_guest=True,
    ))
    assert priced["discount_amount"] == 0.0
    assert priced["discount_source"] is None


# ─────────────────────────────────────────────────── real checkout path ────

def test_a_loyalty_checkout_charges_the_discounted_total():
    user = _client(visits=THRESHOLD)
    product = _product(80.0)
    order = _pay(user, product)
    assert order["total"] == 72.0
    assert order["discount_source"] == "loyalty"
    assert order["loyalty_discount_pct"] == PCT
    assert order["discount_code_id"] is None


def test_a_losing_code_is_never_counted_as_used_when_loyalty_wins():
    user = _client(visits=THRESHOLD)
    product = _product(80.0)
    weaker_code = _code(value=5.0)
    order = _pay(user, product, discount_code=weaker_code["code"])
    assert order["total"] == 72.0  # the bigger, loyalty discount — not the code's 76.0
    assert order["discount_source"] == "loyalty"
    fresh_code = run(server.db.shop_discount_codes.find_one({"id": weaker_code["id"]}, {"_id": 0}))
    assert fresh_code["uses_total"] == 0
    redemptions = run(server.db.shop_discount_code_redemptions.find({"code_id": weaker_code["id"]}, {"_id": 0}).to_list(10))
    assert redemptions == []


def test_a_winning_code_is_counted_as_used_and_loyalty_is_not_recorded():
    user = _client(visits=THRESHOLD)
    product = _product(80.0)
    stronger_code = _code(value=20.0)
    order = _pay(user, product, discount_code=stronger_code["code"])
    assert order["total"] == 64.0
    assert order["discount_source"] == "code"
    fresh_code = run(server.db.shop_discount_codes.find_one({"id": stronger_code["id"]}, {"_id": 0}))
    assert fresh_code["uses_total"] == 1


# ──────────────────────────────────────────────────────────── visibility ──

def test_get_shop_loyalty_discount_route():
    eligible_user = _client(visits=THRESHOLD)
    out = run(server.get_shop_loyalty_discount(eligible_user))
    assert out == {"eligible": True, "pct": PCT, "min_visits": THRESHOLD, "visits": THRESHOLD}

    new_user = _client(visits=0)
    assert run(server.get_shop_loyalty_discount(new_user)) == {"eligible": False}

    staff = {"id": "staff-1", "role": "admin", "name": "Staff"}
    assert run(server.get_shop_loyalty_discount(staff)) == {"eligible": False}
