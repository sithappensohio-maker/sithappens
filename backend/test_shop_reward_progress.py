"""Shop purchases build up toward a free service credit (owner request
2026-10-15: a whole credit per order "gives away too much" — should
accumulate toward a threshold instead, set to $75). Every paid order's
eligible total adds to a running balance on the client; crossing the
threshold grants a credit via the SAME mechanism a referral bonus already
uses, and the remainder carries forward. Gift cards never count (money,
not a purchase — same rule _price_shop_cart already applies for tax).
Guests have no client/credit balance to build progress on.

Fires from the ONE place a Shop order transitions to paid
(_apply_shop_payment's Step A, which already guarantees exactly-once —
covered here by replaying _apply_shop_payment itself, not just unit-
testing the helper in isolation).

Disposable tag TEST_SHOP_REWARD_PROGRESS.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_SHOP_REWARD_PROGRESS"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "reward-progress@test"}


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
        id="cs_test_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/x")
    try:
        yield
    finally:
        server.stripe.Customer.create, server.stripe.checkout.Session.create = orig_c, orig_s


_made = {"clients": [], "products": [], "packs": []}


def setup_module(_module):
    # Exact-dollar math — no sales tax noise.
    run(server.db.settings.update_one(
        {"id": "global"}, {"$set": {"sales_tax.enabled": False, "loyalty.shop_reward_threshold_usd": 75.0,
                                     "loyalty.shop_reward_service": "daycare"}}, upsert=True))


def teardown_module(_module):
    cids = _made["clients"]
    oids = [o["id"] for o in run(server.db.shop_orders.find({"client_id": {"$in": cids}}, {"_id": 0, "id": 1}).to_list(500))]
    run(server.db.retail_sales.delete_many({"shop_order_id": {"$in": oids}}))
    run(server.db.rewards_ledger.delete_many({"client_id": {"$in": cids}}))
    run(server.db.credit_lots.delete_many({"client_id": {"$in": cids}}))
    for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts", "payments"):
        run(server.db[coll].delete_many({"client_id": {"$in": cids}}))
    run(server.db.clients.delete_many({"id": {"$in": cids}}))
    run(server.db.pos_products.delete_many({"id": {"$in": _made["products"]}}))
    run(server.db.credit_packs.delete_many({"id": {"$in": _made["packs"]}}))


def _client():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": f"{TAG} Client", "email": f"{cid[:8]}@example.com",
        "credits": 0, "training_credits": 0, "boarding_credits": 0,
        "shop_reward_progress": 0, "created_at": server.now_iso(),
    }))
    _made["clients"].append(cid)
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": f"{TAG} Client"}


def _product(price):
    p = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Item {uuid.uuid4().hex[:6]}", price=price, show_online=True, active=True, starting_stock=0), ADMIN))
    _made["products"].append(p["id"])
    return p


def _pack(price, qty=10):
    pid = str(uuid.uuid4())
    run(server.db.credit_packs.insert_one({
        "id": pid, "name": f"{TAG} Pack", "price": price, "qty": qty, "active": True,
        "available_online": True, "service_type": "daycare", "category_id": None, "subcategory_id": None,
    }))
    _made["packs"].append(pid)
    return {"id": pid}


def _pay_pack(user, pack, qty=1):
    item = server.ShopCartItemIn(kind="credit_pack", ref_id=pack["id"], quantity=qty)
    with _stripe_mocked():
        out = run(server.create_shop_checkout(server.ShopCheckoutIn(items=[item], idempotency_key=f"{TAG}-{uuid.uuid4().hex}"), user))
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _FakeStripeObj(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                              amount_total=server._stripe_amount_cents(order["total"]),
                              metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    return order["id"], attempt, session


def _pay(user, product, qty=1):
    item = server.ShopCartItemIn(kind="product", ref_id=product["id"], quantity=qty)
    with _stripe_mocked():
        out = run(server.create_shop_checkout(server.ShopCheckoutIn(items=[item], idempotency_key=f"{TAG}-{uuid.uuid4().hex}"), user))
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _FakeStripeObj(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                              amount_total=server._stripe_amount_cents(order["total"]),
                              metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    return order["id"], attempt, session


def _client_doc(cid):
    return run(server.db.clients.find_one({"id": cid}, {"_id": 0}))


def _rewards(cid):
    return run(server.db.rewards_ledger.find({"client_id": cid}, {"_id": 0}).to_list(50))


def test_an_order_below_threshold_builds_progress_without_granting_a_credit():
    user = _client()
    product = _product(40.0)
    _pay(user, product)
    client = _client_doc(user["client_id"])
    assert client["shop_reward_progress"] == 40.0
    assert client["credits"] == 0
    assert _rewards(user["client_id"]) == []


def test_crossing_the_threshold_in_one_order_grants_a_credit_and_carries_the_remainder():
    user = _client()
    product = _product(80.0)
    _pay(user, product)
    client = _client_doc(user["client_id"])
    assert client["shop_reward_progress"] == 5.0  # 80 - 75
    assert client["credits"] == 1
    rewards = _rewards(user["client_id"])
    assert len(rewards) == 1
    assert rewards[0]["source"] == "shop_reward"
    assert rewards[0]["service"] == "daycare"
    assert rewards[0]["amount"] == 1


def test_progress_accumulates_across_separate_orders():
    user = _client()
    product = _product(40.0)
    _pay(user, product)
    assert _client_doc(user["client_id"])["shop_reward_progress"] == 40.0
    _pay(user, product)
    client = _client_doc(user["client_id"])
    assert client["shop_reward_progress"] == 5.0  # 40 + 40 - 75
    assert client["credits"] == 1


def test_a_large_order_can_grant_multiple_credits():
    user = _client()
    product = _product(160.0)
    _pay(user, product)
    client = _client_doc(user["client_id"])
    assert client["shop_reward_progress"] == 10.0  # 160 - 75 - 75
    assert client["credits"] == 2
    assert len(_rewards(user["client_id"])) == 1  # one ledger row for both credits, amount=2
    assert _rewards(user["client_id"])[0]["amount"] == 2


def test_replaying_apply_shop_payment_never_double_counts():
    user = _client()
    product = _product(80.0)
    order_id, attempt, session = _pay(user, product)
    before = _client_doc(user["client_id"])
    # Simulate a webhook replay / a Retry Fulfillment call against an
    # already-paid order — _apply_shop_payment must be safely re-callable.
    run(server._apply_shop_payment(attempt, session))
    after = _client_doc(user["client_id"])
    assert after["shop_reward_progress"] == before["shop_reward_progress"]
    assert after["credits"] == before["credits"]
    assert len(_rewards(user["client_id"])) == 1


def test_rewards_feature_flag_off_disables_accumulation():
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"feature_visibility.rewards": False}}))
    try:
        user = _client()
        product = _product(80.0)
        _pay(user, product)
        client = _client_doc(user["client_id"])
        assert client["shop_reward_progress"] == 0
        assert client["credits"] == 0
    finally:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"feature_visibility.rewards": True}}))


# --------------------------------------------------- direct-call edge cases
# (hand-built order dicts — avoids replicating guest/gift-card checkout
# machinery just to exercise these two branches of _apply_shop_reward_progress)

def test_a_guest_order_is_a_no_op():
    order = {"id": str(uuid.uuid4()), "is_guest_order": True, "client_id": None,
             "lines": [{"kind": "product", "line_total": 200.0}]}
    run(server._apply_shop_reward_progress(order))  # must not raise


def test_gift_card_lines_never_count_toward_progress():
    user = _client()
    order = {
        "id": str(uuid.uuid4()), "is_guest_order": False, "client_id": user["client_id"],
        "lines": [
            {"kind": "product", "line_total": 30.0},
            {"kind": "gift_card", "line_total": 50.0},
        ],
    }
    run(server._apply_shop_reward_progress(order))
    client = _client_doc(user["client_id"])
    assert client["shop_reward_progress"] == 30.0  # the gift card's $50 never counted


def test_credit_pack_and_training_program_lines_never_count_toward_progress():
    # Owner report 2026-10-20: a $220 online daycare-pack purchase crossed
    # the $75 threshold and minted 2 bonus credits on top of the pack's own
    # 10 — "credit purchases get no extra rewards, that's our base of how
    # things operate." Only retail (kind=="product") may build progress,
    # same scope as the 10% retail discount.
    user = _client()
    order = {
        "id": str(uuid.uuid4()), "is_guest_order": False, "client_id": user["client_id"],
        "lines": [
            {"kind": "product", "line_total": 30.0},
            {"kind": "credit_pack", "line_total": 220.0},
            {"kind": "training_program", "line_total": 950.0},
        ],
    }
    run(server._apply_shop_reward_progress(order))
    client = _client_doc(user["client_id"])
    assert client["shop_reward_progress"] == 30.0  # only the $30 retail line counted
    assert client["credits"] == 0
    assert _rewards(user["client_id"]) == []


def test_buying_a_credit_pack_online_grants_exactly_its_own_qty_no_bonus():
    # The real end-to-end shape of the reported bug: one online purchase of
    # a 10-credit pack, well over the $75 threshold on its own, must leave
    # the client with exactly 10 daycare credits — not 12.
    user = _client()
    pack = _pack(220.0, qty=10)
    _pay_pack(user, pack)
    client = _client_doc(user["client_id"])
    assert client["credits"] == 10
    assert client["shop_reward_progress"] == 0
    assert _rewards(user["client_id"]) == []
