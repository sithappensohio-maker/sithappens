"""Stripe Terminal (Phase 4) — the register's own re-verification of a
card-present charge at checkout commit time.

The browser is never trusted here: a stripe_terminal tender's provider_ref
is re-checked live against Stripe (status + amount) before the sale is
allowed to commit, and the same PaymentIntent can pay for exactly one sale
(a unique-indexed claim, not just a status check, is the real guarantee).
A sale that fails for an unrelated reason AFTER the charge was claimed
releases that claim, since the card really was charged and the same
PaymentIntent must still be usable on a retry.

Calls server.create_pos_sale directly (no HTTP layer), against this
environment's real MongoDB, with stripe faked via monkeypatch — the same
style test_bill_checkout_cancel.py and test_pos_checkout_integrity.py
already use. Every row is tagged TEST_STRIPE_TERMINAL_POS and cleaned up
in a finally block.
"""
import uuid
from unittest.mock import patch

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.pos import services as pos_domain_services

TAG = "TEST_STRIPE_TERMINAL_POS"
FAKE_USER = {"id": "test-user", "name": "QA Tester", "email": "qa@test", "role": "admin"}


class _Obj(dict):
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
    """PaymentIntent.retrieve returns whatever `intents` maps a given id to
    (a dict of status/amount_received), or raises _StripeError if the id
    maps to an Exception. error.StripeError is _StripeError so the real
    `except stripe.error.StripeError` in server.py actually catches it.

    PaymentIntent.create/.cancel, terminal.Reader.process_payment_intent/
    .cancel_action, and Refund.create are all tracked (self.created_intents,
    self.canceled_intents, self.reader_pushes, self.reader_cancels,
    self.refunds) and individually failable via the `fail` set of method
    names (e.g. fail={"process_payment_intent"})."""

    def __init__(self, intents=None, fail=None):
        intents = intents or {}
        fail = fail or set()
        self.created_intents = []
        self.canceled_intents = []
        self.reader_pushes = []
        self.reader_cancels = 0
        self.refunds = []

        outer = self

        class PaymentIntent:
            @staticmethod
            def retrieve(pi_id):
                val = intents.get(pi_id)
                if isinstance(val, Exception):
                    raise val
                return _Obj(val or {"status": "succeeded", "amount_received": 0})

            @staticmethod
            def create(**kw):
                if "create" in fail:
                    raise _StripeError("Could not create the charge.")
                pi_id = f"pi_{uuid.uuid4().hex[:10]}"
                outer.created_intents.append({"id": pi_id, **kw})
                intents[pi_id] = {"status": "requires_payment_method", "amount_received": 0}
                return _Obj({"id": pi_id, "status": "requires_payment_method"})

            @staticmethod
            def cancel(pi_id):
                if "cancel" in fail:
                    raise _StripeError("Could not cancel the charge.")
                outer.canceled_intents.append(pi_id)
                return _Obj({"id": pi_id, "status": "canceled"})

        class _Reader:
            @staticmethod
            def process_payment_intent(reader_id, payment_intent):
                if "process_payment_intent" in fail:
                    raise _StripeError("Reader is offline.")
                outer.reader_pushes.append((reader_id, payment_intent))
                return _Obj({"id": reader_id})

            @staticmethod
            def cancel_action(reader_id):
                if "cancel_action" in fail:
                    raise _StripeError("Reader is offline.")
                outer.reader_cancels += 1
                return _Obj({"id": reader_id})

        class terminal:  # noqa: N801 — matches stripe.terminal's own lowercase module name
            Reader = _Reader

        class Refund:
            @staticmethod
            def create(**kw):
                if "refund" in fail:
                    raise _StripeError("Could not refund the charge.")
                outer.refunds.append(kw)
                return _Obj({"id": f"re_{uuid.uuid4().hex[:10]}", **kw})

        class _ErrorModule:
            StripeError = _StripeError

        self.PaymentIntent = PaymentIntent
        self.terminal = terminal
        self.Refund = Refund
        self.error = _ErrorModule


class _OpenRegisterDay:
    """Same disposable-register-day fixture test_pos_checkout_integrity.py
    uses — a real, open cash_drawer_sessions row for today, race-safe and
    cleaned up only if this instance created it."""

    def __init__(self, tag: str):
        self.tag = tag
        self.date = None
        self.marker = None
        self.created = False

    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{self.tag}-register-{uuid.uuid4()}"
        before = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {
                "date": self.date, "opening_cash": 0.0,
                "notes": f"{self.tag} disposable test register day",
                "suggested_opening_cash": None, "suggested_opening_from_date": None,
                "suggested_opening_from_closeout_id": None,
                "opening_override_reason": "", "opening_was_overridden": False,
                "opened_at": server.now_iso(), "opened_by": self.marker,
                "opened_by_name": f"{self.tag} fixture",
            }},
            upsert=True, projection={"_id": 0},
        ))
        self.created = before is None
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


async def _noop(*args, **kwargs):
    return None


def _terminal_enabled():
    """Patches the three module-level flags _require_stripe_terminal_enabled
    checks, so tests exercising the commit-time verification logic aren't
    refused by the feature gate itself before ever reaching it."""
    return patch.multiple(
        server, STRIPE_TERMINAL_ENABLED=True, STRIPE_TERMINAL_READER_ID="tmr_test123", STRIPE_SECRET_KEY="sk_test_fake",
    )


def _product(**overrides):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
        "category": "", "price": 25.0, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
        "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
        "taxable": True,
    }
    doc.update(overrides)
    return doc


def _cleanup(*, products=(), sale_ids=()):
    async def go():
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if sale_ids:
            await server.db.pos_sales.delete_many({"id": {"$in": list(sale_ids)}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": list(sale_ids)}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": list(sale_ids)}})
        await server.db.stripe_terminal_payment_claims.delete_many({"pos_sale_id": {"$in": list(sale_ids)} if sale_ids else {"$exists": False}})
    run(go())


def _sale_body(product, pi_id, amount=25.0, idem=None):
    return server.PosSaleIn(
        client_id=None,
        lines=[server.PosSaleLineIn(kind="retail", product_id=product["id"], qty=1)],
        tenders=[server.PosSaleTenderIn(method="stripe_terminal", amount=amount, provider_ref=pi_id)],
        idempotency_key=idem or f"test-{uuid.uuid4()}",
    )


def test_succeeded_payment_intent_with_matching_amount_commits():
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})
    sale_id = None
    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake), patch.object(server, "_issue_pos_token", new=_noop):
            result = run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
        sale_id = result["pos_sale_id"]
        assert result["sale"]["tenders"][0]["provider_ref"] == pi_id

        claim = run(server.db.stripe_terminal_payment_claims.find_one({"payment_intent_id": pi_id}, {"_id": 0}))
        assert claim is not None and claim["pos_sale_id"] == sale_id
    finally:
        _cleanup(products=[product["id"]], sale_ids=[sale_id] if sale_id else [])


def test_amount_mismatch_is_refused():
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    # The reader actually charged $10, not the $25 this tender claims.
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 1000}})
    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake), patch.object(server, "_issue_pos_token", new=_noop):
            with pytest.raises(server.HTTPException) as exc_info:
                run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
        assert exc_info.value.status_code == 400
        assert "doesn't match" in exc_info.value.detail
        claim = run(server.db.stripe_terminal_payment_claims.find_one({"payment_intent_id": pi_id}))
        assert claim is None
    finally:
        _cleanup(products=[product["id"]])


def test_unsuccessful_payment_intent_is_refused():
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "requires_payment_method", "amount_received": 0}})
    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake), patch.object(server, "_issue_pos_token", new=_noop):
            with pytest.raises(server.HTTPException) as exc_info:
                run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
        assert exc_info.value.status_code == 400
        assert "has not completed" in exc_info.value.detail
    finally:
        _cleanup(products=[product["id"]])


def test_terminal_tender_refused_when_feature_disabled():
    """Confirms the feature gate is checked at commit time too, not just at
    charge-creation time — a location with Terminal switched off must never
    accept an otherwise-real PaymentIntent id as payment."""
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})
    try:
        with _open_register_day(), patch.multiple(server, STRIPE_TERMINAL_ENABLED=False), \
             patch.object(server, "stripe", fake), patch.object(server, "_issue_pos_token", new=_noop):
            with pytest.raises(server.HTTPException) as exc_info:
                run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
        assert exc_info.value.status_code == 400
        assert "not enabled" in exc_info.value.detail
        claim = run(server.db.stripe_terminal_payment_claims.find_one({"payment_intent_id": pi_id}))
        assert claim is None
    finally:
        _cleanup(products=[product["id"]])


def test_same_payment_intent_cannot_pay_for_two_sales():
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})
    sale_id = None
    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake), patch.object(server, "_issue_pos_token", new=_noop):
            first = run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
            sale_id = first["pos_sale_id"]
            # A second, genuinely different sale (different idempotency key)
            # tries to reuse the exact same already-consumed charge.
            with pytest.raises(server.HTTPException) as exc_info:
                run(server.create_pos_sale(_sale_body(product, pi_id, idem=f"test-reuse-{uuid.uuid4()}"), FAKE_USER))
        assert exc_info.value.status_code == 409
        # The first sale's claim is untouched by the second attempt's refusal.
        claim = run(server.db.stripe_terminal_payment_claims.find_one({"payment_intent_id": pi_id}, {"_id": 0}))
        assert claim["pos_sale_id"] == sale_id
    finally:
        _cleanup(products=[product["id"]], sale_ids=[sale_id] if sale_id else [])


def test_a_later_unrelated_failure_releases_the_claim_for_retry():
    """The card really was charged, so a failure elsewhere in the same
    commit (stock, in this test) must not strand that PaymentIntent —
    the claim is released so the identical retry can still use it."""
    product = _product(price=25.0, track_inventory=True, stock_on_hand=5)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})

    async def _boom(*args, **kwargs):
        raise RuntimeError("simulated failure after the charge was claimed")

    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake), \
             patch.object(server, "_mutate_product_stock", new=_boom):
            with pytest.raises(RuntimeError):
                run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
        claim = run(server.db.stripe_terminal_payment_claims.find_one({"payment_intent_id": pi_id}))
        assert claim is None  # released, not stranded
    finally:
        _cleanup(products=[product["id"]])


# ------------------------------------------------------- create/poll/cancel

def test_create_charge_creates_a_payment_intent_and_pushes_it_to_the_reader():
    fake = _FakeStripe()
    with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake):
        result = run(server.create_stripe_terminal_charge(
            server.StripeTerminalChargeIn(amount=25.0, idempotency_key=f"test-{uuid.uuid4()}"), FAKE_USER))
    assert result["payment_intent_id"] == fake.created_intents[0]["id"]
    assert fake.created_intents[0]["amount"] == 2500
    assert fake.reader_pushes == [("tmr_test123", result["payment_intent_id"])]


def test_create_charge_checks_the_register_day_is_open():
    """Confirms the endpoint actually calls the same register-day gate every
    other money-moving endpoint calls — not re-testing that gate's own logic
    (covered elsewhere), which depends on a real daily_closeouts row rather
    than anything this test can cheaply/reliably arrange against a shared dev
    database that may already have today opened from other activity."""
    fake = _FakeStripe()

    async def _closed(date_value):
        raise server.HTTPException(status_code=409, detail=f"The register for {date_value} is closed.")

    with _terminal_enabled(), patch.object(server, "stripe", fake), patch.object(server, "_require_register_day_open", new=_closed):
        with pytest.raises(server.HTTPException) as exc_info:
            run(server.create_stripe_terminal_charge(
                server.StripeTerminalChargeIn(amount=25.0, idempotency_key=f"test-{uuid.uuid4()}"), FAKE_USER))
    assert exc_info.value.status_code == 409
    assert not fake.created_intents  # refused before Stripe is ever called


def test_create_charge_cancels_the_orphaned_intent_when_the_reader_push_fails():
    fake = _FakeStripe(fail={"process_payment_intent"})
    with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake):
        with pytest.raises(server.HTTPException):
            run(server.create_stripe_terminal_charge(
                server.StripeTerminalChargeIn(amount=25.0, idempotency_key=f"test-{uuid.uuid4()}"), FAKE_USER))
    assert fake.created_intents  # the PaymentIntent really was created...
    assert fake.canceled_intents == [fake.created_intents[0]["id"]]  # ...then canceled, not left dangling


def test_poll_status_reflects_the_live_payment_intent():
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"id": pi_id, "status": "succeeded", "amount_received": 2500}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        result = run(server.get_stripe_terminal_charge_status(pi_id, FAKE_USER))
    assert result == {"payment_intent_id": pi_id, "status": "succeeded", "last_payment_error": None}


def test_cancel_charge_clears_the_reader_and_cancels_the_intent():
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "requires_payment_method", "amount_received": 0}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        result = run(server.cancel_stripe_terminal_charge(pi_id, FAKE_USER))
    assert result == {"ok": True}
    assert fake.reader_cancels == 1
    assert fake.canceled_intents == [pi_id]


def test_cancel_charge_does_not_cancel_an_already_succeeded_intent():
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})
    with _terminal_enabled(), patch.object(server, "stripe", fake):
        run(server.cancel_stripe_terminal_charge(pi_id, FAKE_USER))
    assert fake.canceled_intents == []  # nothing to cancel — the charge already went through


# ------------------------------------------------------------- void & return

def test_voiding_a_terminal_sale_refunds_the_actual_stripe_charge():
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})
    sale_id = None
    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake), patch.object(server, "_issue_pos_token", new=_noop):
            sale = run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
            sale_id = sale["pos_sale_id"]
            result = run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
                reason="test void", idempotency_key=f"test-{uuid.uuid4()}"), FAKE_USER))
        assert "stripe_refund_failed" not in result
        assert fake.refunds == [{"payment_intent": pi_id, "amount": 2500, "idempotency_key": f"pos-void-{sale_id}-{pi_id}"}]
    finally:
        _cleanup(products=[product["id"]], sale_ids=[sale_id] if sale_id else [])


def test_voiding_a_terminal_sale_surfaces_a_failed_stripe_refund_instead_of_hiding_it():
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    sale_id = None
    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})), \
             patch.object(server, "_issue_pos_token", new=_noop):
            sale = run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
            sale_id = sale["pos_sale_id"]
            # The refund call specifically fails on this second fake — the void itself must still commit.
            with patch.object(server, "stripe", _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}}, fail={"refund"})):
                result = run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
                    reason="test void", idempotency_key=f"test-{uuid.uuid4()}"), FAKE_USER))
        assert result["stripe_refund_failed"] == [pi_id]
        assert result["sale"]["status"] == "voided"  # the books still reflect the void
    finally:
        _cleanup(products=[product["id"]], sale_ids=[sale_id] if sale_id else [])


def test_partial_return_of_a_terminal_sale_is_refused_not_silently_wrong():
    product = _product(price=25.0)
    run(server.db.pos_products.insert_one(dict(product)))
    pi_id = f"pi_{uuid.uuid4().hex[:10]}"
    fake = _FakeStripe({pi_id: {"status": "succeeded", "amount_received": 2500}})
    sale_id = None
    try:
        with _open_register_day(), _terminal_enabled(), patch.object(server, "stripe", fake), patch.object(server, "_issue_pos_token", new=_noop):
            sale = run(server.create_pos_sale(_sale_body(product, pi_id), FAKE_USER))
            sale_id = sale["pos_sale_id"]
            with pytest.raises(server.HTTPException) as exc_info:
                run(server.return_pos_sale(sale_id, pos_domain_services.PosSaleReturnIn(
                    lines=[pos_domain_services.PosSaleReturnLineIn(line_index=0, qty=1, restock=False)],
                    reason="test return", idempotency_key=f"test-{uuid.uuid4()}"), FAKE_USER))
        assert exc_info.value.status_code == 409
        assert "card reader" in exc_info.value.detail
        assert fake.refunds == []  # refused before any Stripe call, not guessed at
    finally:
        _cleanup(products=[product["id"]], sale_ids=[sale_id] if sale_id else [])


def _open_register_day():
    return _OpenRegisterDay(TAG)
