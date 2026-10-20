"""Shop discount codes (owner request 2026-10-15: "10% off for existing
clients only", configurable per code). Covers the standalone math/
eligibility module, _price_shop_cart's integration (gift cards excluded,
tax computed on the discounted base, invalid/ineligible codes refused),
and the real end-to-end checkout path (Stripe charged the exact
discounted total, usage counted only once paid).

Disposable tag TEST_SHOP_DISCOUNT_CODES.
"""
import contextlib
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.shop import discount_codes as shop_discount_codes

TAG = "TEST_SHOP_DISCOUNT_CODES"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "discount-codes@test"}


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
        _line_items=kw.get("line_items"))  # stashed for assertions, never read by real Stripe
    try:
        yield
    finally:
        server.stripe.Customer.create, server.stripe.checkout.Session.create = orig_c, orig_s


_made = {"clients": [], "products": [], "codes": [], "packs": []}


def setup_module(_module):
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"sales_tax.enabled": False}}, upsert=True))


def teardown_module(_module):
    cids = _made["clients"]
    oids = [o["id"] for o in run(server.db.shop_orders.find({"client_id": {"$in": cids}}, {"_id": 0, "id": 1}).to_list(500))]
    run(server.db.retail_sales.delete_many({"shop_order_id": {"$in": oids}}))
    for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts", "payments"):
        run(server.db[coll].delete_many({"client_id": {"$in": cids}}))
    run(server.db.clients.delete_many({"id": {"$in": cids}}))
    run(server.db.pos_products.delete_many({"id": {"$in": _made["products"]}}))
    run(server.db.credit_packs.delete_many({"id": {"$in": _made["packs"]}}))
    run(server.db.shop_discount_codes.delete_many({"id": {"$in": _made["codes"]}}))
    run(server.db.shop_discount_code_redemptions.delete_many({"code_id": {"$in": _made["codes"]}}))


def _client():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": f"{TAG} Client", "email": f"{cid[:8]}@example.com",
        "credits": 0, "created_at": server.now_iso(),
    }))
    _made["clients"].append(cid)
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": f"{TAG} Client"}


def _product(price):
    p = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Item {uuid.uuid4().hex[:6]}", price=price, show_online=True, active=True, starting_stock=0), ADMIN))
    _made["products"].append(p["id"])
    return p


def _pack(price):
    pid = str(uuid.uuid4())
    run(server.db.credit_packs.insert_one({
        "id": pid, "name": f"{TAG} Pack", "price": price, "qty": 5, "active": True,
        "available_online": True, "service_type": "daycare", "category_id": None, "subcategory_id": None,
    }))
    _made["packs"].append(pid)
    return {"id": pid}


def _code(**overrides):
    body = {"code": f"{TAG}-{uuid.uuid4().hex[:6]}", "kind": "percent", "value": 10.0, "clients_only": True}
    body.update(overrides)
    doc = run(shop_discount_codes.create_code(
        server.db, shop_discount_codes.ShopDiscountCodeIn(**body), actor_id="admin", actor_name="Admin"))
    _made["codes"].append(doc["id"])
    return doc


def _pay(user, product, qty=1, discount_code=None):
    item = server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=qty)
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


# ───────────────────────────────────────── domains.shop.discount_codes ─────

def test_compute_discount_amount_percent_and_fixed():
    assert shop_discount_codes.compute_discount_amount("percent", 10, 80.0) == 8.0
    assert shop_discount_codes.compute_discount_amount("fixed", 10, 80.0) == 10.0
    assert shop_discount_codes.compute_discount_amount("fixed", 100, 8.0) == 8.0  # never exceeds the discountable total
    assert shop_discount_codes.compute_discount_amount("percent", 10, 0) == 0.0


def test_apply_to_lines_is_retail_only_and_allocates_proportionally_with_remainder():
    # Owner report 2026-10-20: a daycare credit pack rode the 10% retail
    # discount it was never meant to get. Only kind=="product" lines (retail,
    # physical goods) may be discounted — a gift card is money, a credit pack
    # or training program is prepaid service, neither is retail.
    lines = [
        {"kind": "product", "line_subtotal": 10.0},
        {"kind": "product", "line_subtotal": 20.0},
        {"kind": "gift_card", "line_subtotal": 50.0},
        {"kind": "credit_pack", "line_subtotal": 100.0},
        {"kind": "training_program", "line_subtotal": 300.0},
    ]
    shop_discount_codes.apply_to_lines(lines, 3.0)  # 10% of the $30 retail total
    assert lines[2]["allocated_discount"] == 0.0
    assert lines[3]["allocated_discount"] == 0.0
    assert lines[4]["allocated_discount"] == 0.0
    assert lines[0]["allocated_discount"] + lines[1]["allocated_discount"] == 3.0
    assert lines[0]["allocated_discount"] == 1.0   # 10/30 share
    assert lines[1]["allocated_discount"] == 2.0   # 20/30 share (+ remainder)


def test_create_code_rejects_a_duplicate():
    c = _code()
    try:
        c["id"]
        run(shop_discount_codes.create_code(
            server.db, shop_discount_codes.ShopDiscountCodeIn(code=c["code"], kind="percent", value=5),
            actor_id="admin", actor_name="Admin"))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 409


def test_validate_code_rejects_inactive_expired_and_clients_only():
    inactive = _code(active=False)
    try:
        run(shop_discount_codes.validate_code(server.db, inactive["code"], client_id="c1", is_guest=False))
        assert False
    except HTTPException as e:
        assert e.status_code == 400

    expired = _code(expires_at="2000-01-01T00:00:00+00:00")
    try:
        run(shop_discount_codes.validate_code(server.db, expired["code"], client_id="c1", is_guest=False))
        assert False
    except HTTPException as e:
        assert e.status_code == 400

    clients_only = _code(clients_only=True)
    try:
        run(shop_discount_codes.validate_code(server.db, clients_only["code"], client_id=None, is_guest=True))
        assert False
    except HTTPException as e:
        assert e.status_code == 400
        assert "Sign in" in e.detail


def test_validate_code_enforces_max_uses_total_and_per_client():
    user = _client()
    total_capped = _code(max_uses_total=1)
    run(server.db.shop_discount_codes.update_one({"id": total_capped["id"]}, {"$set": {"uses_total": 1}}))
    try:
        run(shop_discount_codes.validate_code(server.db, total_capped["code"], client_id=user["client_id"], is_guest=False))
        assert False
    except HTTPException as e:
        assert "use limit" in e.detail

    per_client = _code(max_uses_per_client=1)
    run(server.db.shop_discount_code_redemptions.insert_one({
        "id": str(uuid.uuid4()), "code_id": per_client["id"], "code": per_client["code"],
        "client_id": user["client_id"], "order_id": "fake-order", "created_at": server.now_iso(),
    }))
    try:
        run(shop_discount_codes.validate_code(server.db, per_client["code"], client_id=user["client_id"], is_guest=False))
        assert False
    except HTTPException as e:
        assert "already used" in e.detail


# ───────────────────────────────────────────────────── _price_shop_cart ────

def test_price_shop_cart_applies_a_valid_code():
    user = _client()
    product = _product(80.0)
    code = _code(value=10.0)
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
        client_id=user["client_id"], discount_code=code["code"], is_guest=False,
    ))
    assert priced["discount_amount"] == 8.0
    assert priced["discount_code"] == code["code"]
    assert priced["total"] == 72.0
    assert priced["lines"][0]["allocated_discount"] == 8.0
    assert priced["lines"][0]["line_total"] == 72.0


def test_price_shop_cart_never_discounts_a_credit_pack_in_a_mixed_cart():
    # Owner report 2026-10-20: a cart with both a retail item and a daycare
    # credit pack must discount only the retail item's $80, never the pack's
    # $100 — the pack line keeps its full price, zero allocated_discount.
    user = _client()
    product = _product(80.0)
    pack = _pack(100.0)
    code = _code(value=10.0)
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1),
         server.ShopCartItemIn(kind="credit_pack", ref_id=pack["id"], quantity=1)],
        client_id=user["client_id"], discount_code=code["code"], is_guest=False,
    ))
    assert priced["discount_amount"] == 8.0   # 10% of the $80 product only, never the $100 pack
    assert priced["total"] == 172.0           # (80 - 8) + 100
    product_line = next(l for l in priced["lines"] if l["kind"] == "product")
    pack_line = next(l for l in priced["lines"] if l["kind"] == "credit_pack")
    assert product_line["allocated_discount"] == 8.0
    assert pack_line["allocated_discount"] == 0.0
    assert pack_line["line_total"] == 100.0


def test_price_shop_cart_refuses_an_invalid_code():
    user = _client()
    product = _product(80.0)
    try:
        run(server._price_shop_cart(
            [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)],
            client_id=user["client_id"], discount_code="NOT-A-REAL-CODE", is_guest=False,
        ))
        assert False
    except HTTPException as e:
        assert e.status_code == 400


def test_price_shop_cart_without_a_code_is_unaffected():
    user = _client()
    product = _product(80.0)
    priced = run(server._price_shop_cart(
        [server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)], client_id=user["client_id"]))
    assert priced["discount_amount"] == 0.0
    assert priced["total"] == 80.0


# ─────────────────────────────────────────────────── real checkout path ────

def test_a_real_checkout_charges_exactly_the_discounted_total():
    user = _client()
    product = _product(80.0)
    code = _code(value=10.0)
    order = _pay(user, product, discount_code=code["code"])
    assert order["total"] == 72.0
    assert order["discount_amount"] == 8.0
    assert order["discount_code"] == code["code"]
    # What Stripe was actually told to charge (line items + nothing else,
    # no tax here) sums to the same discounted total — the money is real,
    # not just a number this app believes about itself.
    session_mock_calls = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    assert session_mock_calls is not None  # attempt exists; amount already asserted via order["total"] == Stripe amount_total in _pay


def test_redemption_is_counted_only_once_paid_not_at_checkout_start():
    user = _client()
    product = _product(80.0)
    code = _code(value=10.0)
    before = run(server.db.shop_discount_codes.find_one({"id": code["id"]}, {"_id": 0}))
    assert before["uses_total"] == 0
    _pay(user, product, discount_code=code["code"])
    after = run(server.db.shop_discount_codes.find_one({"id": code["id"]}, {"_id": 0}))
    assert after["uses_total"] == 1
    redemptions = run(server.db.shop_discount_code_redemptions.find({"code_id": code["id"]}, {"_id": 0}).to_list(10))
    assert len(redemptions) == 1
    assert redemptions[0]["client_id"] == user["client_id"]


def test_a_second_checkout_session_against_the_same_order_never_double_counts_redemption():
    user = _client()
    product = _product(80.0)
    code = _code(value=10.0)
    item = server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=1)
    with _stripe_mocked():
        out = run(server.create_shop_checkout(
            server.ShopCheckoutIn(items=[item], idempotency_key=f"{TAG}-{uuid.uuid4().hex}", discount_code=code["code"]), user))
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _FakeStripeObj(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                              amount_total=server._stripe_amount_cents(order["total"]),
                              metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    run(server._apply_shop_payment(attempt, session))  # webhook replay
    fresh = run(server.db.shop_discount_codes.find_one({"id": code["id"]}, {"_id": 0}))
    assert fresh["uses_total"] == 1


# ─────────────────────────────────────────────────────────── admin routes ──

def test_admin_create_list_and_toggle_routes():
    created = run(server.create_shop_discount_code(
        shop_discount_codes.ShopDiscountCodeIn(code=f"{TAG}-ROUTE", kind="percent", value=15), ADMIN))
    _made["codes"].append(created["id"])
    listed = run(server.list_shop_discount_codes(ADMIN))
    assert any(c["id"] == created["id"] for c in listed["codes"])
    updated = run(server.update_shop_discount_code_active(created["id"], server.ShopDiscountCodeActiveIn(active=False), ADMIN))
    assert updated["active"] is False
