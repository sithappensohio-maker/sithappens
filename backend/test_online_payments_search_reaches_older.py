"""The Online Payments search finds an older payment, past the newest 200 (audit #32).

The search filtered only the 200 newest online payments, so a family's older
Shop order could not be found, and so could not be refunded from the panel.
A search now looks through every online payment. Disposable tag TEST_STRIPE_SEARCH.
"""
import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_STRIPE_SEARCH"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "stripe-search@test"}


def _payment(i, order_id, created):
    return {"id": f"{TAG}-p{i}", "tag": TAG, "method": "stripe_online", "amount": 10.0, "status": "paid",
            "source": {"kind": "shop_order_payment"}, "shop_order_id": order_id, "created_at": created}


def test_a_search_finds_an_older_online_payment_past_the_newest_200():
    orders, payments = [], []
    for i in range(230):
        oid = f"{TAG}-o{i}"
        orders.append({"id": oid, "tag": TAG, "client_name": f"Filler {i}", "lines": []})
        payments.append(_payment(i, oid, f"2031-06-01T00:{i // 60:02d}:{i % 60:02d}+00:00"))
    orders.append({"id": f"{TAG}-old", "tag": TAG, "client_name": "Zedold Customer", "lines": []})
    payments.append(_payment("old", f"{TAG}-old", "2020-01-01T10:00:00+00:00"))
    run(server.db.shop_orders.insert_many(orders))
    run(server.db.payments.insert_many(payments))
    try:
        out = run(server.list_stripe_online_payments(limit=50, q="zedold", _=ADMIN))
        assert [p["shop_order_id"] for p in out["payments"]] == [f"{TAG}-old"]
    finally:
        run(server.db.payments.delete_many({"tag": TAG}))
        run(server.db.shop_orders.delete_many({"tag": TAG}))
