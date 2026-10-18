"""Checking a dog out with the Stripe Terminal card reader (owner,
2026-10-18: "checking out a dog doesnt offer our card reader").

Booking checkout never had a real card-processor integration — "Card" was
always just a manual label, the same as it still is for every OTHER payment
method here. This wires up the real thing: the browser's claim that a
PaymentIntent succeeded, and for how much, is never trusted — every
checkout re-asks Stripe directly (server._verify_and_claim_booking_stripe_
terminal_charge) and consumes the PaymentIntent exactly once via a unique-
indexed claim, the same non-negotiable discipline POS's own stripe_terminal
tender already uses (see test_stripe_terminal_pos.py). Pickup merchandise
bought in the same checkout is a SEPARATE real charge — it rides the
existing POS sale-creation path, which already re-verifies independently.

A refund of a stripe_terminal-paid checkout, when there's exactly one
matching original charge, calls Stripe for a real refund before any local
record is touched; anything messier refuses rather than guessing.

Self-contained fixtures (never import another test module, including
test_stripe_terminal_pos.py) — this file defines its own minimal Stripe
fake. Disposable tag TEST_CHECKOUT_CARD_READER.
"""
import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_CHECKOUT_CARD_READER"
OWNER = {"id": f"{TAG}-owner", "role": "admin", "name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


class _Obj(dict):
    """Same pattern test_stripe_terminal_pos.py uses — a dict subclass with
    attribute access, since the real stripe-python SDK object is NOT
    dict-like and server.py reads `pi.status`/`pi.amount_received`."""
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


class _StripeError(Exception):
    def __init__(self, user_message):
        super().__init__(user_message)
        self.user_message = user_message


class _FakeStripe:
    """PaymentIntent.retrieve answers from `intents` (id -> status/amount_
    received dict, or an Exception to raise). Refund.create is tracked in
    self.refunds and fails if "refund" is in `fail`."""

    def __init__(self, intents=None, fail=None):
        intents = intents or {}
        fail = fail or set()
        self.refunds = []
        outer = self

        class PaymentIntent:
            @staticmethod
            def retrieve(pi_id):
                val = intents.get(pi_id)
                if isinstance(val, Exception):
                    raise val
                return _Obj(val or {"status": "succeeded", "amount_received": 0})

        class Refund:
            @staticmethod
            def create(**kw):
                if "refund" in fail:
                    raise _StripeError("Could not refund the charge.")
                refund = {"id": f"re_{uuid.uuid4().hex[:10]}", **kw}
                outer.refunds.append(refund)
                return _Obj(refund)

        class _ErrorModule:
            StripeError = _StripeError

        self.PaymentIntent = PaymentIntent
        self.Refund = Refund
        self.error = _ErrorModule


def _terminal_enabled():
    return patch.multiple(
        server, STRIPE_TERMINAL_ENABLED=True, STRIPE_TERMINAL_READER_ID="tmr_test123", STRIPE_SECRET_KEY="sk_test_fake",
    )


def _day():
    return server.business_today().isoformat()


def _daycare_service(price=40.0):
    sid = f"{TAG}-daycare-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} Daycare", "service_type": "daycare",
                                       "base_price": price, "active": True, "is_default": True}))
    return sid


def _family():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "account_balance": 0.0, "credits": 0}))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} dog", "owner_id": cid, "breed": "Mix",
                                   "age_y": 3, "vaccines": dict(VAX)}))
    return cid, did


def _visit(svc, dog_id, hours=8):
    from datetime import datetime, timedelta, timezone
    made = run(server.create_booking(server.BookingIn(dog_id=dog_id, date=_day(), service_type="daycare", service_id=svc,
                                                       override_capacity=True, override_vaccines=True), OWNER))
    bid = made["id"]
    run(server.check_in(bid, server.CheckInIn(vaccine_ack=True), OWNER))
    ts = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_in_at": ts}}))
    return bid


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _bill(bid):
    return run(server.db.invoices.find_one({"booking_ids": bid, "status": {"$ne": "VOID"}}, {"_id": 0}))


def _payments(invoice_id):
    return run(server.db.payments.find({"invoice_id": invoice_id}, {"_id": 0}).to_list(20))


def _product(price=20.0, **overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
        "category": "", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
        "taxable": False,
    }
    doc.update(overrides)
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


_made = {"clients": [], "dogs": [], "products": []}


@pytest.fixture(autouse=True)
def _open_register_day():
    """Any paid (non-credit) checkout needs today's register day open —
    same disposable fixture style test_checkout_discount.py uses, made
    self-contained here rather than relying on another test file in this
    session having already opened one."""
    day = server.business_today().isoformat()
    marker = f"{TAG}-register-{uuid.uuid4()}"
    before = run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day}, {"$setOnInsert": {"date": day, "opening_cash": 0.0, "opened_at": server.now_iso(),
                                         "opened_by": marker, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    if before is None:
        run(server.db.cash_drawer_sessions.delete_one({"date": day, "opened_by": marker}))


def setup_function(_fn):
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"sales_tax.enabled": False}}, upsert=True))


def teardown_function(_fn):
    go = _cleanup_all()
    run(go)


async def _cleanup_all():
    cids = _made["clients"]
    dids = _made["dogs"]
    if cids:
        await server.db.bookings.delete_many({"client_id": {"$in": cids}})
        for coll in ("invoices", "payments", "payment_ledger", "credit_lots", "checkout_groups", "retail_sales", "pos_sales"):
            await server.db[coll].delete_many({"client_id": {"$in": cids}})
        await server.db.clients.delete_many({"id": {"$in": cids}})
    if dids:
        await server.db.dogs.delete_many({"id": {"$in": dids}})
    if _made["products"]:
        await server.db.pos_products.delete_many({"id": {"$in": _made["products"]}})
    await server.db.booking_checkout_stripe_terminal_claims.delete_many({"booking_id": {"$exists": True}, "amount": {"$exists": True}})
    _made["clients"] = []
    _made["dogs"] = []
    _made["products"] = []


def _setup_visit(price=40.0):
    svc = _daycare_service(price)
    cid, did = _family()
    _made["clients"].append(cid)
    _made["dogs"].append(did)
    bid = _visit(svc, did)
    return bid, cid


def _reader_checkout(extra=None):
    fields = {"use_credits": False, "payment_method": "stripe_terminal",
              "payment_status": "paid", "payment_provider_ref": "pi_test1"}
    fields.update(extra or {})
    return server.CheckoutIn(**fields)


# ───────────────────────────────────────────────────── stay-only checkout ──

def test_a_matching_succeeded_charge_checks_the_dog_out_and_records_the_real_processor_ref():
    bid, _ = _setup_visit(40.0)
    fake = _FakeStripe({"pi_test1": {"status": "succeeded", "amount_received": 4000}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        run(server.check_out(bid, _reader_checkout(), OWNER))
    row = _row(bid)
    assert row["payment_status"] == "paid"
    assert row["payment_method"] == "stripe_terminal"
    assert row["payment_provider_ref"] == "pi_test1"
    bill = _bill(bid)
    pays = _payments(bill["id"])
    cash_row = next(p for p in pays if p["amount"] > 0)
    assert cash_row["method"] == "stripe_terminal"
    assert cash_row["processor"] == "stripe_terminal"
    assert cash_row["processor_payment_id"] == "pi_test1"


def test_an_amount_mismatch_refuses_and_checks_out_nothing():
    bid, _ = _setup_visit(40.0)
    # The reader actually charged $30, but the stay is $40 — the server must
    # never trust the client's say-so about what matches what.
    fake = _FakeStripe({"pi_test1": {"status": "succeeded", "amount_received": 3000}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        with pytest.raises(HTTPException) as e:
            run(server.check_out(bid, _reader_checkout(), OWNER))
    assert e.value.status_code == 400 and "doesn't match" in e.value.detail
    assert _row(bid)["status"] != "completed"
    assert _bill(bid) is None


def test_an_unsuccessful_payment_intent_is_refused():
    bid, _ = _setup_visit(40.0)
    fake = _FakeStripe({"pi_test1": {"status": "requires_payment_method", "amount_received": 0}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        with pytest.raises(HTTPException) as e:
            run(server.check_out(bid, _reader_checkout(), OWNER))
    assert e.value.status_code == 400 and "has not completed" in e.value.detail


def test_a_missing_provider_ref_is_refused():
    bid, _ = _setup_visit(40.0)
    fake = _FakeStripe({})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        with pytest.raises(HTTPException) as e:
            run(server.check_out(bid, _reader_checkout(extra={"payment_provider_ref": None}), OWNER))
    assert e.value.status_code == 400 and "Missing" in e.value.detail


def test_the_same_payment_intent_cannot_pay_for_two_different_checkouts():
    bid1, _ = _setup_visit(40.0)
    bid2, _ = _setup_visit(40.0)
    fake = _FakeStripe({"pi_test1": {"status": "succeeded", "amount_received": 4000}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        run(server.check_out(bid1, _reader_checkout(), OWNER))
        with pytest.raises(HTTPException) as e:
            run(server.check_out(bid2, _reader_checkout(), OWNER))
    assert e.value.status_code == 400 and "already applied" in e.value.detail
    assert _row(bid2)["status"] != "completed"


def test_feature_gate_off_refuses_even_a_real_looking_charge():
    bid, _ = _setup_visit(40.0)
    fake = _FakeStripe({"pi_test1": {"status": "succeeded", "amount_received": 4000}})
    with patch.multiple(server, STRIPE_TERMINAL_ENABLED=False), patch.object(server, "stripe", fake):
        with pytest.raises(HTTPException) as e:
            run(server.check_out(bid, _reader_checkout(), OWNER))
    assert e.value.status_code == 400 and "not enabled" in e.value.detail


def test_the_reader_cannot_be_split_against_a_partial_tab_payment():
    bid, _ = _setup_visit(40.0)
    fake = _FakeStripe({"pi_test1": {"status": "succeeded", "amount_received": 2000}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        with pytest.raises(HTTPException) as e:
            run(server.check_out(bid, _reader_checkout(extra={
                "payment_status": "paid_partial", "amount_paid": 20.0,
            }), OWNER))
    assert e.value.status_code == 400 and "full amount" in e.value.detail


# ─────────────────────────────────────────── pickup merchandise, own charge ─

def test_merchandise_bought_at_pickup_is_its_own_separately_verified_charge():
    bid, _ = _setup_visit(40.0)
    product = _product(price=20.0)
    _made["products"].append(product["id"])
    fake = _FakeStripe({
        "pi_stay": {"status": "succeeded", "amount_received": 4000},
        "pi_goods": {"status": "succeeded", "amount_received": 2000},
    })
    body = server.CheckoutIn(
        use_credits=False, payment_method="stripe_terminal", payment_status="paid",
        payment_provider_ref="pi_stay",
        retail_payment_method="stripe_terminal", retail_payment_provider_ref="pi_goods",
        retail_lines=[server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1)],
        retail_idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
    )
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        run(server.check_out(bid, body, OWNER))
    row = _row(bid)
    assert row["payment_provider_ref"] == "pi_stay"  # the stay never claims the goods' PaymentIntent
    sale = run(server.db.pos_sales.find_one({}, {"_id": 0}, sort=[("created_at", -1)]))
    assert sale["tenders"][0]["method"] == "stripe_terminal"
    assert sale["tenders"][0]["provider_ref"] == "pi_goods"
    assert sale["tenders"][0]["amount"] == 20.0


def test_the_goods_charge_is_independently_amount_checked_too():
    bid, _ = _setup_visit(40.0)
    product = _product(price=20.0)
    _made["products"].append(product["id"])
    fake = _FakeStripe({
        "pi_stay": {"status": "succeeded", "amount_received": 4000},
        # The reader actually charged $5 for a $20 item — the goods' own
        # verification (inside the ordinary POS sale path) must catch this
        # independently of the stay's own (correct) charge.
        "pi_goods": {"status": "succeeded", "amount_received": 500},
    })
    body = server.CheckoutIn(
        use_credits=False, payment_method="stripe_terminal", payment_status="paid",
        payment_provider_ref="pi_stay",
        retail_payment_method="stripe_terminal", retail_payment_provider_ref="pi_goods",
        retail_lines=[server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1)],
        retail_idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
    )
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        with pytest.raises(HTTPException) as e:
            run(server.check_out(bid, body, OWNER))
    assert e.value.status_code == 400
    # Pickup merchandise is validated BEFORE the stay is touched at all.
    assert _row(bid)["status"] != "completed"


# ──────────────────────────────────────────────────────── refund wiring ──

def test_refunding_a_reader_paid_checkout_calls_stripe_for_real():
    bid, _ = _setup_visit(40.0)
    fake = _FakeStripe({"pi_test1": {"status": "succeeded", "amount_received": 4000}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        run(server.check_out(bid, _reader_checkout(), OWNER))
        run(server.booking_refund(bid, server.BookingRefundIn(
            amount=15.0, payment_method="stripe_terminal", reason="Courtesy partial refund"), OWNER))
    assert len(fake.refunds) == 1
    assert fake.refunds[0]["payment_intent"] == "pi_test1"
    assert fake.refunds[0]["amount"] == 1500
    bill = _bill(bid)
    pays = _payments(bill["id"])
    refund_row = next(p for p in pays if p["amount"] < 0)
    assert refund_row["processor"] == "stripe_terminal"
    assert refund_row["processor_payment_id"] == fake.refunds[0]["id"]


def test_a_failed_stripe_refund_leaves_nothing_recorded():
    bid, _ = _setup_visit(40.0)
    fake = _FakeStripe({"pi_test1": {"status": "succeeded", "amount_received": 4000}}, fail={"refund"})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        run(server.check_out(bid, _reader_checkout(), OWNER))
        before = _row(bid)
        with pytest.raises(HTTPException) as e:
            run(server.booking_refund(bid, server.BookingRefundIn(
                amount=15.0, payment_method="stripe_terminal", reason="Courtesy partial refund"), OWNER))
    assert e.value.status_code == 400 and "try again" in e.value.detail.lower()
    assert _row(bid).get("financial_refund_total") == before.get("financial_refund_total")


def test_refunding_as_stripe_terminal_with_no_matching_original_charge_refuses_rather_than_guesses():
    # Checked out with plain cash — there is no card-reader charge to find.
    bid, _ = _setup_visit(40.0)
    run(server.check_out(bid, server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid"), OWNER))
    with pytest.raises(HTTPException) as e:
        run(server.booking_refund(bid, server.BookingRefundIn(
            amount=10.0, payment_method="stripe_terminal", reason="Trying to auto-refund a cash visit"), OWNER))
    assert e.value.status_code == 400 and "Could not automatically find" in e.value.detail
