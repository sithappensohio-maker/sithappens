"""Online Shop income is recorded by kind, the way the Register does (audit #29).

A Shop order used to put all its money on one `shop_order` income row, which
Finance files under Retail — so a daycare pack or a training program bought
online showed up as merchandise. Now each pack/program unit gets its own
`credit_pack_sale` / `training_program_sale` row (as at the desk), products
and gift cards stay on the `shop_order` row with all the tax, every total is
unchanged, and past orders are split by a repair that a restore can't undo.

Disposable tag TEST_SHOP_INCOME.
"""
import asyncio
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from domains.shop import income as shop_income

TAG = "TEST_SHOP_INCOME"
RATE = 6.75
ADMIN = {"id": "shop-income-admin", "role": "admin", "name": f"{TAG} admin", "email": "shop-income@test"}


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


_made = {"clients": [], "products": [], "packs": [], "programs": []}


@pytest.fixture(scope="module", autouse=True)
def _tax_index_and_cleanup():
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": {
        "enabled": True, "rate_pct": RATE, "label": "Sales Tax", "applies_to": {}}}}, upsert=True))
    field, opts = shop_income.INCOME_REF_INDEX
    run(server.db.retail_sales.create_index(field, **opts))   # the startup loop makes it in the app
    yield
    run(server.db.settings.update_one({}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))
    cids = _made["clients"]
    oids = [o["id"] for o in run(server.db.shop_orders.find({"client_id": {"$in": cids}}, {"_id": 0, "id": 1}).to_list(500))]
    run(server.db.retail_sales.delete_many({"shop_order_id": {"$in": oids}}))
    run(server.db.retail_sales.delete_many({"reversed_payment_id": {"$regex": "."}, "client_id": {"$in": cids}}))
    run(server.db.credit_lots.delete_many({"client_id": {"$in": cids}}))
    for coll in ("shop_orders", "shop_checkout_claims", "shop_payment_attempts", "payments", "stripe_refund_attempts"):
        run(server.db[coll].delete_many({"client_id": {"$in": cids}}))
    run(server.db.clients.delete_many({"id": {"$in": cids}}))
    run(server.db.pos_products.delete_many({"id": {"$in": _made["products"]}}))
    run(server.db.credit_packs.delete_many({"id": {"$in": _made["packs"]}}))
    run(server.db.programs.delete_many({"id": {"$in": _made["programs"]}}))


def _client():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{cid[:8]}@example.com",
                                      "credits": 0, "training_credits": 0, "created_at": server.now_iso()}))
    _made["clients"].append(cid)
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": cid, "name": f"{TAG} Client"}


def _product(price=20.0):
    p = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Food {uuid.uuid4().hex[:6]}", price=price, show_online=True, active=True, starting_stock=0), ADMIN))
    _made["products"].append(p["id"])
    return p


def _pack(price=99.0):
    p = run(server.create_credit_pack(server.CreditPackIn(
        name=f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=5, price=price, available_online=True, active=True), ADMIN))
    _made["packs"].append(p["id"])
    return p


def _program(price=250.0):
    p = run(server.create_program(server.ProgramIn(
        name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons", available_online=True, active=True,
        price=price, format={"count": 4, "unit": "sessions"}), ADMIN))
    _made["programs"].append(p["id"])
    return p


def _item(kind, ref_id, qty=1):
    return server.ShopCartItemIn(kind=kind, ref_id=ref_id, quantity=qty)


def _pay(user, items):
    """The real path: checkout (Stripe mocked), then _apply_shop_payment with
    the authoritative session the webhook would carry."""
    with _stripe_mocked():
        out = run(server.create_shop_checkout(server.ShopCheckoutIn(items=items, idempotency_key=f"{TAG}-{uuid.uuid4().hex}"), user))
    order = run(server.db.shop_orders.find_one({"id": out["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session = _FakeStripeObj(id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                             amount_total=server._stripe_amount_cents(order["total"]),
                             metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]})
    run(server._apply_shop_payment(attempt, session))
    return run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0})), attempt, session


def _payment(order):
    return run(server.db.payments.find_one({"shop_order_id": order["id"]}, {"_id": 0}))


def _rows(order):
    return run(server.db.retail_sales.find({"shop_order_id": order["id"], "amount": {"$gt": 0}}, {"_id": 0}).to_list(50))


def _kinds(rows):
    return sorted(r["source_kind"] for r in rows)


# ------------------------------------------------------------- new orders

def test_a_mixed_order_records_packs_and_programs_on_their_own_rows():
    user = _client()
    food, pack, prog = _product(20.0), _pack(99.0), _program(250.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"], 2), _item("training_program", prog["id"])])
    pay, rows = _payment(order), _rows(order)
    assert order["tax_amount"] == 1.35 and order["total"] == 469.35
    assert _kinds(rows) == ["credit_pack_sale", "credit_pack_sale", "shop_order", "training_program_sale"]
    anchor = next(r for r in rows if r["source_kind"] == "shop_order")
    assert anchor["payment_id"] == pay["id"] and sum(1 for r in rows if r.get("payment_id")) == 1
    assert (anchor["amount"], anchor["tax_amount"], anchor["pre_tax_amount"]) == (21.35, 1.35, 20.0)
    assert round(sum(r["amount"] for r in rows), 2) == order["total"] == pay["amount"]
    assert round(sum(float(r.get("tax_amount") or 0) for r in rows), 2) == 1.35
    assert {r["payment_method"] for r in rows} == {"stripe_online"} and len({r["date"] for r in rows}) == 1
    assert not any(r.get("pos_sale_id") for r in rows)
    lots = {l["fulfillment_ref"] for l in run(server.db.credit_lots.find({"shop_order_id": order["id"]}, {"_id": 0, "fulfillment_ref": 1}).to_list(20))}
    assert {r["shop_income_ref"] for r in rows if r["source_kind"] != "shop_order"} == lots, "each row ties to its lot"
    prow = next(r for r in rows if r["source_kind"] == "training_program_sale")
    assert prow["description"] == f"Training Program · {prog['name']}" and prow["program_id"] == prog["id"]


def test_finance_files_them_where_the_register_does():
    user = _client()
    food, pack, prog = _product(20.0), _pack(99.0), _program(250.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"]), _item("training_program", prog["id"])])
    cats = sorted(server._finance_income_category(r) for r in _rows(order))
    assert cats == ["credit_packs", "retail", "training_programs"]
    day = run(server._register_day_summary(_rows(order)[0]["date"]))
    ours = [a for a in day["activity"] if a["id"] in {r["id"] for r in _rows(order)}]
    assert sorted(a["kind"] for a in ours) == ["credit_pack_sale", "shop_order", "training_program_sale"]


def test_a_program_only_order_has_no_empty_retail_line():
    user = _client()
    prog = _program(250.0)
    order, _, _ = _pay(user, [_item("training_program", prog["id"])])
    rows = _rows(order)
    assert _kinds(rows) == ["training_program_sale"]
    assert rows[0]["payment_id"] == _payment(order)["id"] and rows[0]["amount"] == 250.0
    assert not run(server.db.retail_sales.find_one({"shop_order_id": order["id"], "amount": 0}, {"_id": 1}))


def test_units_add_up_to_the_cent():
    user = _client()
    pack = _pack(33.33)
    order, _, _ = _pay(user, [_item("credit_pack", pack["id"], 3)])
    rows = _rows(order)
    assert [r["amount"] for r in rows] == [33.33, 33.33, 33.33] and round(sum(r["amount"] for r in rows), 2) == order["total"]


def test_replays_and_concurrent_applies_leave_one_set_of_rows():
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, attempt, session = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"], 2)])
    before = sorted((r["source_kind"], r["amount"], r.get("shop_income_ref") or "") for r in _rows(order))
    for _ in range(2):
        run(server._apply_shop_payment(attempt, session))
    pay = _payment(order)

    async def _both():
        await asyncio.gather(shop_income.record(server.db, order, pay), shop_income.record(server.db, order, pay))
    run(_both())
    assert sorted((r["source_kind"], r["amount"], r.get("shop_income_ref") or "") for r in _rows(order)) == before


def test_a_retry_after_a_crash_part_way_completes_the_rows():
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"], 2)])
    pack_rows = [r for r in _rows(order) if r["source_kind"] == "credit_pack_sale"]
    run(server.db.retail_sales.delete_one({"id": pack_rows[1]["id"]}))     # died before the last unit row
    run(shop_income.record(server.db, order, _payment(order)))
    assert _kinds(_rows(order)) == ["credit_pack_sale", "credit_pack_sale", "shop_order"]
    assert round(sum(r["amount"] for r in _rows(order)), 2) == order["total"]


def test_an_online_school_course_is_a_training_program():
    order = {"id": str(uuid.uuid4()), "client_id": "c", "client_name": "n", "subtotal": 49.0, "tax_amount": 0.0,
             "lines": [{"item_id": "i1", "kind": "training_program", "fulfillment_kind": "online_school", "ref_id": "p1",
                        "name": "Puppy Basics Online", "unit_price": 49.0, "quantity": 1, "line_subtotal": 49.0, "line_total": 49.0}]}
    rows = shop_income.plan_rows(order, {"id": "pay1", "amount": 49.0}, date="2026-09-29", created_at=None)
    assert [(r["source_kind"], r["amount"], r.get("payment_id")) for r in rows] == [("training_program_sale", 49.0, "pay1")]


def test_numbers_that_dont_add_up_are_never_split_on_a_guess():
    order = {"id": str(uuid.uuid4()), "subtotal": 99.0, "tax_amount": 0.0,
             "lines": [{"item_id": "i1", "kind": "credit_pack", "ref_id": "p", "name": "P", "unit_price": 99.0,
                        "quantity": 1, "line_subtotal": 99.0, "line_total": 99.0}]}
    rows = shop_income.plan_rows(order, {"id": "pay1", "amount": 120.0}, date="2026-09-29", created_at=None)
    assert [(r["source_kind"], r["amount"]) for r in rows] == [("shop_order", 120.0)]


# -------------------------------------------- refunds of a split order

def _refund(pay, amount):
    aid = f"{TAG}-att-{uuid.uuid4().hex[:6]}"
    run(server.db.stripe_refund_attempts.insert_one({
        "id": aid, "payment_id": pay["id"], "client_id": pay.get("client_id"), "amount_cents": int(round(amount * 100)),
        "status": "succeeded", "stripe_refund_id": f"re_{aid}", "idempotency_key": aid,
        "reason": f"{TAG} refund", "created_at": server.now_iso()}))
    run(server._finalize_stripe_refund(aid))
    return run(server.db.retail_sales.find_one({"source_kind": "stripe_refund", "reversed_payment_id": pay["id"],
                                                "amount": -round(amount, 2)}, {"_id": 0}, sort=[("created_at", -1)]))


def test_a_dashboard_refund_reverses_the_tax_only_once_the_whole_charge_is_back():
    # The payment's row now holds only the products ($21.35); a $30 refund
    # covers that but not the whole $120.35, so no tax goes back yet.
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    pay = _payment(order)
    first = _refund(pay, 30.00)
    assert float(first["tax_amount"]) == 0.0, "not the whole charge yet"
    last = _refund(pay, round(order["total"] - 30.00, 2))
    assert float(last["tax_amount"]) == -1.35


# ---------------------------------------------------- orders from before

def _make_old(order):
    """Put an order's income back the way the old code wrote it: one
    shop_order row holding the whole payment, paid long enough ago."""
    pay = _payment(order)
    run(server.db.payments.update_one({"id": pay["id"]}, {"$set": {"created_at": "2026-01-02T12:00:00+00:00"}}))
    anchor = run(server.db.retail_sales.find_one({"payment_id": pay["id"]}, {"_id": 0}))
    run(server.db.retail_sales.delete_many({"shop_order_id": order["id"], "id": {"$ne": anchor["id"]}}))
    run(server.db.retail_sales.update_one({"id": anchor["id"]}, {
        "$set": {"source_kind": "shop_order", "amount": order["total"], "tax_amount": order["tax_amount"],
                 "pre_tax_amount": order["subtotal"], "description": f"Online Shop order #{order['id'][:8].upper()}"},
        "$unset": {k: "" for k in ("shop_income_ref", "pack_id", "pack_name", "note", "program_id", "category", "notes")}}))
    return anchor


def test_the_repair_splits_an_old_order_keeping_its_row_date_and_tax():
    user = _client()
    food, pack, prog = _product(20.0), _pack(99.0), _program(250.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"]), _item("training_program", prog["id"])])
    anchor = _make_old(order)
    out = run(shop_income.repair_split(server.db))
    assert out["split"] >= 1
    rows = _rows(order)
    assert _kinds(rows) == ["credit_pack_sale", "shop_order", "training_program_sale"]
    kept = next(r for r in rows if r["source_kind"] == "shop_order")
    assert (kept["id"], kept["date"], kept["tax_amount"], kept["amount"]) == (anchor["id"], anchor["date"], 1.35, 21.35)
    assert round(sum(r["amount"] for r in rows), 2) == order["total"]
    again = sorted((r["id"], r["amount"]) for r in _rows(order))
    run(shop_income.repair_split(server.db))
    assert sorted((r["id"], r["amount"]) for r in _rows(order)) == again, "a second run changes nothing"


def test_the_repair_turns_an_old_program_only_row_into_the_program_row():
    user = _client()
    prog = _program(250.0)
    order, _, _ = _pay(user, [_item("training_program", prog["id"])])
    anchor = _make_old(order)
    run(shop_income.repair_split(server.db))
    rows = _rows(order)
    assert [(r["id"], r["source_kind"], r["amount"]) for r in rows] == [(anchor["id"], "training_program_sale", 250.0)]


def test_a_restore_that_brings_the_old_row_back_beside_the_new_ones_is_put_right():
    # A merge restore rewrites the kept row to its old whole amount while the
    # unit rows stay: pack money counted twice until the repair runs again.
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    pay = _payment(order)
    run(server.db.payments.update_one({"id": pay["id"]}, {"$set": {"created_at": "2026-01-02T12:00:00+00:00"}}))
    anchor = run(server.db.retail_sales.find_one({"payment_id": pay["id"]}, {"_id": 0}))
    run(server.db.retail_sales.update_one({"id": anchor["id"]}, {"$set": {"amount": order["total"], "pre_tax_amount": order["subtotal"]}}))
    assert round(sum(r["amount"] for r in _rows(order)), 2) > order["total"]
    run(shop_income.repair_split(server.db))
    assert round(sum(r["amount"] for r in _rows(order)), 2) == order["total"]


def test_the_repair_leaves_a_hand_edited_or_already_refunded_order_alone():
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    edited, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    a = _make_old(edited)
    run(server.db.retail_sales.update_one({"id": a["id"]}, {"$set": {"amount": 100.0}}))   # changed by hand
    refunded, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    _make_old(refunded)
    run(server.db.retail_sales.insert_one({"id": str(uuid.uuid4()), "source_kind": "stripe_refund", "amount": -10.0,
                                           "reversed_payment_id": _payment(refunded)["id"], "client_id": user["client_id"],
                                           "date": "2026-01-03", "description": f"{TAG} old refund"}))   # an old tax-less refund
    out = run(shop_income.repair_split(server.db))
    assert out["skipped"].get("changed_by_hand", 0) >= 1 and out["skipped"].get("old_refund_row", 0) >= 1
    assert _kinds(_rows(edited)) == ["shop_order"] and _kinds(_rows(refunded)) == ["shop_order"]


def test_the_repair_leaves_an_order_being_paid_right_now_to_its_webhook():
    user = _client()
    pack = _pack(99.0)
    order, _, _ = _pay(user, [_item("credit_pack", pack["id"])])
    _make_old(order)
    run(server.db.payments.update_one({"id": _payment(order)["id"]}, {"$set": {"created_at": server.now_iso()}}))
    out = run(shop_income.repair_split(server.db))
    assert out["skipped"].get("just_paid", 0) >= 1 and _kinds(_rows(order)) == ["shop_order"]


def test_a_retry_of_an_order_paid_before_the_change_splits_it_without_counting_twice():
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, attempt, session = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    _make_old(order)
    run(server._apply_shop_payment(attempt, session))
    rows = _rows(order)
    assert _kinds(rows) == ["credit_pack_sale", "shop_order"] and round(sum(r["amount"] for r in rows), 2) == order["total"]


def test_a_restore_sends_the_repair_round_again():
    run(server.db.system_runs.update_one({"_id": shop_income.REPAIR_JOB}, {"$set": {"date": server.business_today().isoformat()}}, upsert=True))
    src = open(server.__file__.replace("server.py", "domains/backup/routes.py"), encoding="utf-8").read()
    assert '"shop_income_split"' in src and "delete_many(repairs)" in src
    assert "shop_income_split" in [n for n, _ in server._scheduler_jobs()]


def test_a_retry_of_an_old_single_program_order_makes_it_the_program_row():
    user = _client()
    prog = _program(250.0)
    order, attempt, session = _pay(user, [_item("training_program", prog["id"])])
    anchor = _make_old(order)
    run(server._apply_shop_payment(attempt, session))
    assert [(r["id"], r["source_kind"]) for r in _rows(order)] == [(anchor["id"], "training_program_sale")]


def test_the_daily_repair_never_puts_back_a_pack_row_staff_deleted():
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    run(server.db.payments.update_one({"id": _payment(order)["id"]}, {"$set": {"created_at": "2026-01-02T12:00:00+00:00"}}))
    unit = next(r for r in _rows(order) if r["source_kind"] == "credit_pack_sale")
    run(server.db.retail_sales.delete_one({"id": unit["id"]}))       # Income -> Retail Sales -> delete
    out = run(shop_income.repair_split(server.db))
    assert out["skipped"].get("unit_row_missing", 0) >= 1
    assert _kinds(_rows(order)) == ["shop_order"], "the deletion is kept"


def test_a_retry_leaves_an_old_order_with_an_old_taxless_refund_whole():
    # Its refund's tax is rebuilt at read time from the whole row's amount;
    # trimming the row would rebuild tax that was never given back.
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, attempt, session = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    _make_old(order)
    run(server.db.retail_sales.insert_one({"id": str(uuid.uuid4()), "source_kind": "stripe_refund", "amount": -30.0,
                                           "reversed_payment_id": _payment(order)["id"], "client_id": user["client_id"],
                                           "date": "2026-01-03", "description": f"{TAG} old refund"}))
    run(server._apply_shop_payment(attempt, session))
    assert _kinds(_rows(order)) == ["shop_order"] and _rows(order)[0]["amount"] == order["total"]


def test_a_whole_row_restored_beside_its_pack_rows_is_trimmed_even_with_an_old_refund():
    # Leaving it whole would count the pack money twice.
    user = _client()
    food, pack = _product(20.0), _pack(99.0)
    order, _, _ = _pay(user, [_item("product", food["id"]), _item("credit_pack", pack["id"])])
    pay = _payment(order)
    run(server.db.payments.update_one({"id": pay["id"]}, {"$set": {"created_at": "2026-01-02T12:00:00+00:00"}}))
    run(server.db.retail_sales.insert_one({"id": str(uuid.uuid4()), "source_kind": "stripe_refund", "amount": -10.0,
                                           "reversed_payment_id": pay["id"], "client_id": user["client_id"],
                                           "date": "2026-01-03", "description": f"{TAG} old refund"}))
    anchor = run(server.db.retail_sales.find_one({"payment_id": pay["id"]}, {"_id": 0}))
    run(server.db.retail_sales.update_one({"id": anchor["id"]}, {"$set": {"amount": order["total"], "pre_tax_amount": order["subtotal"]}}))
    run(shop_income.repair_split(server.db))
    assert round(sum(r["amount"] for r in _rows(order)), 2) == order["total"]
