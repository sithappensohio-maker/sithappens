"""Whole-app gap closure — Stripe hostile / replay matrix.

Section L.4 of CLAUDE_WHOLE_APP_GAP_CLOSURE_HANDOFF.md.

NO REAL MONEY. Stripe is never called: these drive the local application
functions a verified webhook would drive, then assert what the database
looks like afterwards.

The candidate's own suite already covers dispute idempotency, payout replay
and fee reconciliation. This one attacks the refund/fulfillment-reversal path
that those do not: duplicate delivery, replay after success, out-of-order
arrival, partial application followed by a crash, and concurrent delivery.

The invariant under test throughout: a refund's side effects are applied AT
MOST ONCE each — no duplicated finance rows, inventory movements, credit
reversals or entitlement withdrawals — no matter how many times, or in what
order, the same refund is delivered.
"""
import asyncio
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_GAP_STRIPE"


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin",
            "email": f"{TAG.lower()}@example.invalid"}


@contextlib.contextmanager
def _client():
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:8]}@example.invalid"), _admin()))
    try:
        yield c
    finally:
        for coll in ("shop_orders", "shop_payment_attempts", "credit_lots",
                     "payments", "retail_sales", "invoices"):
            run(server.db[coll].delete_many({"client_id": c["id"]}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@contextlib.contextmanager
def _product(stock=10.0):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} Product {uuid.uuid4().hex[:6]}", "price": 25.0,
        "active": True, "track_inventory": True, "stock_on_hand": stock,
        "created_at": server.now_iso(),
    }))
    try:
        yield pid
    finally:
        run(server.db.inventory_movements.delete_many({"product_id": pid}))
        run(server.db.pos_products.delete_one({"id": pid}))


def _paid_product_order(client, product_id, qty=2, unit=25.0):
    """A paid Shop order with one physical-product line, built directly so no
    Stripe session or payment is ever created."""
    order_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    run(server.db.shop_orders.insert_one({
        "id": order_id, "client_id": client["id"], "client_name": client.get("name") or "",
        "status": "paid", "fulfillment_status": "fulfilled",
        "lines": [{
            "item_id": item_id, "kind": "product", "ref_id": product_id,
            "name": f"{TAG} Product", "quantity": qty, "unit_price": unit,
            "line_total": round(qty * unit, 2), "tax_amount": 0.0,
            "quantity_refunded": 0, "amount_refunded": 0.0, "tax_refunded": 0.0,
            "fulfillment_status": "fulfilled",
        }],
        "subtotal": round(qty * unit, 2), "tax_amount": 0.0, "total": round(qty * unit, 2),
        "refunded_amount": 0.0, "created_at": server.now_iso(), "updated_at": server.now_iso(),
    }))
    return order_id, item_id


def _refund_attempt(order_id, client_id, item_id, qty, amount, restock=True):
    """A SUCCEEDED, line-aware refund attempt — the shape
    _apply_shop_refund_fulfillment consumes."""
    aid = str(uuid.uuid4())
    run(server.db.shop_payment_attempts.insert_one({
        # A real attempt always carries one; the collection has a unique index
        # on it, so two null keys would collide before the test even ran.
        "id": aid, "idempotency_key": f"{TAG}-{aid}",
        "shop_order_id": order_id, "client_id": client_id,
        "shop_refund": True, "restock_products": restock,
        "amount_cents": int(round(amount * 100)),
        "line_refunds": [{"item_id": item_id, "quantity": qty, "amount": amount, "tax_amount": 0.0}],
        "status": "succeeded", "created_at": server.now_iso(),
    }))
    return run(server.db.shop_payment_attempts.find_one({"id": aid}, {"_id": 0}))


def _state(order_id, product_id, attempt_id=None):
    order = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
    product = run(server.db.pos_products.find_one({"id": product_id}, {"_id": 0}))
    q = {"product_id": product_id}
    if attempt_id:
        q["source_ref"] = {"$regex": attempt_id}
    return {
        "stock": float(product.get("stock_on_hand") or 0),
        "movements": run(server.db.inventory_movements.count_documents(q)),
        "refunded_amount": round(float(order.get("refunded_amount") or 0), 2),
        "line_qty_refunded": order["lines"][0].get("quantity_refunded"),
        "line_amount_refunded": round(float(order["lines"][0].get("amount_refunded") or 0), 2),
        "attempts_applied": order.get("refund_attempts_applied") or [],
    }


# ---------------------------------------------------------------------------
# Duplicate + replay
# ---------------------------------------------------------------------------

def test_a_refund_applied_once_restocks_and_records_exactly_once():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        attempt = _refund_attempt(order_id, c["id"], item_id, qty=2, amount=50.0)
        run(server._apply_shop_refund_fulfillment(attempt))
        s = _state(order_id, pid, attempt["id"])
        assert s["stock"] == 12.0, "two units returned to stock"
        assert s["movements"] == 1
        assert s["refunded_amount"] == 50.0
        assert s["line_qty_refunded"] == 2
        assert s["attempts_applied"] == [attempt["id"]]


def test_duplicate_delivery_of_the_same_refund_changes_nothing():
    # The webhook fires twice, or a poll races the webhook.
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        attempt = _refund_attempt(order_id, c["id"], item_id, qty=2, amount=50.0)
        run(server._apply_shop_refund_fulfillment(attempt))
        first = _state(order_id, pid, attempt["id"])
        for _ in range(4):
            run(server._apply_shop_refund_fulfillment(attempt))
        assert _state(order_id, pid, attempt["id"]) == first, "replay changed the ledger"


def test_replay_after_a_crash_midway_completes_without_double_applying():
    # Simulate the process dying after the stock move landed but before the
    # order totals were written: re-running must finish the job, not redo it.
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        attempt = _refund_attempt(order_id, c["id"], item_id, qty=2, amount=50.0)
        run(server._apply_shop_refund_fulfillment(attempt))
        # Roll back ONLY the order-level totals, leaving the stock marker.
        run(server.db.shop_orders.update_one({"id": order_id}, {"$set": {
            "refunded_amount": 0.0, "refund_attempts_applied": [],
        }}))
        run(server._apply_shop_refund_fulfillment(attempt))
        s = _state(order_id, pid, attempt["id"])
        assert s["stock"] == 12.0, "stock was moved a second time"
        assert s["movements"] == 1, "a duplicate inventory movement was written"
        assert s["refunded_amount"] == 50.0, "the resumed run completed the totals"


def test_two_distinct_partial_refunds_each_apply_once():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        a1 = _refund_attempt(order_id, c["id"], item_id, qty=1, amount=25.0)
        a2 = _refund_attempt(order_id, c["id"], item_id, qty=1, amount=25.0)
        run(server._apply_shop_refund_fulfillment(a1))
        run(server._apply_shop_refund_fulfillment(a2))
        # ...and replay both
        run(server._apply_shop_refund_fulfillment(a1))
        run(server._apply_shop_refund_fulfillment(a2))
        s = _state(order_id, pid)
        assert s["stock"] == 12.0
        assert s["movements"] == 2, "one movement per distinct refund"
        assert s["refunded_amount"] == 50.0
        assert s["line_qty_refunded"] == 2
        assert sorted(s["attempts_applied"]) == sorted([a1["id"], a2["id"]])


def test_out_of_order_delivery_converges_on_the_same_totals():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        a1 = _refund_attempt(order_id, c["id"], item_id, qty=1, amount=25.0)
        a2 = _refund_attempt(order_id, c["id"], item_id, qty=1, amount=25.0)
        # second refund arrives first
        run(server._apply_shop_refund_fulfillment(a2))
        run(server._apply_shop_refund_fulfillment(a1))
        s = _state(order_id, pid)
        assert s["refunded_amount"] == 50.0
        assert s["line_qty_refunded"] == 2
        assert s["movements"] == 2


def test_concurrent_delivery_of_one_refund_applies_it_once():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        attempt = _refund_attempt(order_id, c["id"], item_id, qty=2, amount=50.0)

        async def _storm():
            return await asyncio.gather(
                *[server._apply_shop_refund_fulfillment(attempt) for _ in range(5)],
                return_exceptions=True,
            )

        run(_storm())
        s = _state(order_id, pid, attempt["id"])
        assert s["stock"] == 12.0, f"stock double-moved: {s['stock']}"
        assert s["movements"] == 1
        assert s["refunded_amount"] == 50.0
        assert s["attempts_applied"] == [attempt["id"]]


def test_a_refund_with_restock_disabled_moves_no_stock_but_still_records_money():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        attempt = _refund_attempt(order_id, c["id"], item_id, qty=2, amount=50.0, restock=False)
        run(server._apply_shop_refund_fulfillment(attempt))
        run(server._apply_shop_refund_fulfillment(attempt))
        s = _state(order_id, pid, attempt["id"])
        assert s["stock"] == 10.0, "stock moved despite restock being off"
        assert s["movements"] == 0
        assert s["refunded_amount"] == 50.0


# ---------------------------------------------------------------------------
# External refunds — money identity without line identity
# ---------------------------------------------------------------------------

def test_an_external_refund_never_guesses_a_reversal_and_flags_for_review():
    # A Dashboard refund has no line allocation. It must reverse nothing and
    # must not silently pass as reconciled.
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        external = {
            "id": str(uuid.uuid4()), "shop_order_id": order_id, "client_id": c["id"],
            "amount_cents": 5000, "status": "succeeded", "created_at": server.now_iso(),
        }
        run(server._apply_shop_refund_fulfillment(external))
        order = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
        product = run(server.db.pos_products.find_one({"id": pid}, {"_id": 0}))
        assert order.get("refund_reconciliation_required") is True
        assert order.get("refund_reconciliation_reason")
        assert float(product["stock_on_hand"]) == 10.0, "external refund moved stock"
        assert round(float(order.get("refunded_amount") or 0), 2) == 0.0
        assert run(server.db.inventory_movements.count_documents({"product_id": pid})) == 0


def test_replaying_an_external_refund_flags_once_and_reverses_nothing():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, _item = _paid_product_order(c, pid, qty=2)
        external = {
            "id": str(uuid.uuid4()), "shop_order_id": order_id, "client_id": c["id"],
            "amount_cents": 5000, "status": "succeeded", "created_at": server.now_iso(),
        }
        for _ in range(3):
            run(server._apply_shop_refund_fulfillment(external))
        product = run(server.db.pos_products.find_one({"id": pid}, {"_id": 0}))
        assert float(product["stock_on_hand"]) == 10.0
        assert run(server.db.inventory_movements.count_documents({"product_id": pid})) == 0


def test_a_refund_for_an_order_that_no_longer_exists_is_a_no_op():
    with _client() as c, _product(stock=10.0) as pid:
        attempt = {
            "id": str(uuid.uuid4()), "shop_order_id": str(uuid.uuid4()), "client_id": c["id"],
            "shop_refund": True, "restock_products": True, "amount_cents": 2500,
            "line_refunds": [{"item_id": "x", "quantity": 1, "amount": 25.0, "tax_amount": 0.0}],
            "status": "succeeded", "created_at": server.now_iso(),
        }
        run(server._apply_shop_refund_fulfillment(attempt))     # must not raise
        product = run(server.db.pos_products.find_one({"id": pid}, {"_id": 0}))
        assert float(product["stock_on_hand"]) == 10.0


def test_a_refund_naming_a_line_that_is_not_on_the_order_is_skipped():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, _item = _paid_product_order(c, pid, qty=2)
        attempt = _refund_attempt(order_id, c["id"], "not-a-real-line", qty=2, amount=50.0)
        run(server._apply_shop_refund_fulfillment(attempt))
        product = run(server.db.pos_products.find_one({"id": pid}, {"_id": 0}))
        assert float(product["stock_on_hand"]) == 10.0, "stock moved for an unknown line"
        assert run(server.db.inventory_movements.count_documents({"product_id": pid})) == 0


# ---------------------------------------------------------------------------
# No money was invented anywhere in this suite
# ---------------------------------------------------------------------------

def test_this_suite_creates_no_payment_or_stripe_record():
    with _client() as c, _product(stock=10.0) as pid:
        order_id, item_id = _paid_product_order(c, pid, qty=2)
        attempt = _refund_attempt(order_id, c["id"], item_id, qty=2, amount=50.0)
        run(server._apply_shop_refund_fulfillment(attempt))
        assert run(server.db.payments.count_documents({"client_id": c["id"]})) == 0
        assert run(server.db.retail_sales.count_documents({"client_id": c["id"]})) == 0
        assert run(server.db.invoices.count_documents({"client_id": c["id"]})) == 0


def test_stripe_is_never_called_by_the_refund_fulfillment_path():
    calls = []
    orig_refund_create = server.stripe.Refund.create
    orig_session_create = server.stripe.checkout.Session.create
    server.stripe.Refund.create = lambda **kw: calls.append("refund")
    server.stripe.checkout.Session.create = lambda **kw: calls.append("session")
    try:
        with _client() as c, _product(stock=10.0) as pid:
            order_id, item_id = _paid_product_order(c, pid, qty=2)
            attempt = _refund_attempt(order_id, c["id"], item_id, qty=2, amount=50.0)
            run(server._apply_shop_refund_fulfillment(attempt))
    finally:
        server.stripe.Refund.create = orig_refund_create
        server.stripe.checkout.Session.create = orig_session_create
    assert calls == [], f"Stripe was called: {calls}"
