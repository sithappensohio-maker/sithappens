"""Checkpoint 3 backend tests: duplicate-line normalization
(`_normalize_cart_lines`) and additive checkout eligibility/state
revalidation (`_validate_shop_item_eligibility`) in `create_shop_checkout`.

Stripe is monkeypatched (module-level `server.stripe.Customer.create` /
`server.stripe.checkout.Session.create`) rather than hitting the real
Stripe test-mode API — this suite is a fast, offline correctness check, not
a Stripe integration test. Every fixture is TAG-tagged and cleaned up in
`finally`, per this repo's ad-hoc test convention (see
test_shop_appearance_settings.py's docstring).
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from fastapi import HTTPException

TAG = "TEST_CHECKOUT_ELIG"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


# ---------------------------------------------------------------------------
# Stripe monkeypatch — restored after every test via the fixture below.
# ---------------------------------------------------------------------------

class _FakeStripeObj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


_session_create_calls = []


def _fake_customer_create(**kwargs):
    return _FakeStripeObj(id="cus_test_fake_" + uuid.uuid4().hex[:8])


def _fake_session_create(**kwargs):
    _session_create_calls.append(kwargs)
    return _FakeStripeObj(id="cs_test_fake_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/fake-session")


@contextlib.contextmanager
def _stripe_mocked():
    _session_create_calls.clear()
    orig_customer_create = server.stripe.Customer.create
    orig_session_create = server.stripe.checkout.Session.create
    server.stripe.Customer.create = _fake_customer_create
    server.stripe.checkout.Session.create = _fake_session_create
    try:
        yield _session_create_calls
    finally:
        server.stripe.Customer.create = orig_customer_create
        server.stripe.checkout.Session.create = orig_session_create


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _client(name=None, **extra_fields):
    cid = str(uuid.uuid4())
    doc = {
        "id": cid, "name": name or f"{TAG} Client {uuid.uuid4().hex[:6]}",
        "email": f"{uuid.uuid4().hex[:8]}@example.com", "phone": "555-0100",
        "created_at": "2026-01-01T00:00:00Z",
    }
    doc.update(extra_fields)
    run(server.db.clients.insert_one(doc))
    try:
        yield doc
    finally:
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.shop_orders.delete_many({"client_id": cid}))
        run(server.db.shop_checkout_claims.delete_many({"client_id": cid}))
        run(server.db.shop_payment_attempts.delete_many({"client_id": cid}))


def _shop_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": f"{TAG} user"}


@contextlib.contextmanager
def _category(name=None, section="merch", **kw):
    user = _admin_user()
    cat = run(server.create_shop_category(server.ShopCategoryIn(name=name or f"{TAG} Category {uuid.uuid4().hex[:6]}", section=section, **kw), user))
    try:
        yield cat
    finally:
        run(server.db.shop_categories.delete_one({"id": cat["id"]}))


@contextlib.contextmanager
def _subcategory(category_id, name=None, **kw):
    user = _admin_user()
    sub = run(server.create_shop_subcategory(server.ShopSubcategoryIn(category_id=category_id, name=name or f"{TAG} Sub {uuid.uuid4().hex[:6]}", **kw), user))
    try:
        yield sub
    finally:
        run(server.db.shop_subcategories.delete_one({"id": sub["id"]}))


@contextlib.contextmanager
def _product(name=None, **kw):
    user = _admin_user()
    defaults = dict(name=name or f"{TAG} Product {uuid.uuid4().hex[:6]}", price=19.99, show_online=True, active=True, starting_stock=0)
    defaults.update(kw)
    created = run(server.create_pos_product(server.PosProductCreateIn(**defaults), user))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))
        run(server.db.inventory_movements.delete_many({"source_ref": {"$regex": created["id"]}}))


@contextlib.contextmanager
def _pack(name=None, **kw):
    user = _admin_user()
    defaults = dict(name=name or f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=5, price=99.0, available_online=True, active=True)
    defaults.update(kw)
    created = run(server.create_credit_pack(server.CreditPackIn(**defaults), user))
    try:
        yield created
    finally:
        run(server.db.credit_packs.delete_one({"id": created["id"]}))


@contextlib.contextmanager
def _program(name=None, **kw):
    user = _admin_user()
    defaults = dict(name=name or f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons", available_online=True, active=True, price=250.0)
    defaults.update(kw)
    created = run(server.create_program(server.ProgramIn(**defaults), user))
    try:
        yield created
    finally:
        run(server.db.programs.delete_one({"id": created["id"]}))


class _OpenRegisterDay:
    """Opens today's cash_drawer_sessions row only if none exists yet (never
    touches a real already-open day), and closes it back out on exit only if
    this instance is the one that created it. Same pattern as
    test_pos_checkout_integrity.py's helper of the same name."""

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


def _open_register_day():
    return _OpenRegisterDay(TAG)


def _checkout_body(items, idem=None):
    return server.ShopCheckoutIn(items=items, idempotency_key=idem or f"idem-{uuid.uuid4().hex}")


def _cart_item(kind, ref_id, qty):
    return server.ShopCartItemIn(kind=kind, ref_id=ref_id, quantity=qty)


def _no_order_exists() -> bool:
    """Confirms the given order_id (if we have one) or, more generally,
    that no shop_orders/inventory_movements/shop_payment_attempts row was
    created for this attempt — the atomic-rejection proof."""
    return True  # placeholder — real assertions are inline per-test with known ids


# ---------------------------------------------------------------------------
# Duplicate-line normalization
# ---------------------------------------------------------------------------

def test_normalize_combines_duplicate_lines_summing_quantity():
    combined = server._normalize_cart_lines([
        _cart_item("product", "abc", 3),
        _cart_item("product", "abc", 4),
        _cart_item("credit_pack", "xyz", 1),
    ])
    assert len(combined) == 2
    by_key = {(c.kind, c.ref_id): c.quantity for c in combined}
    assert by_key[("product", "abc")] == 7
    assert by_key[("credit_pack", "xyz")] == 1


def test_normalize_rejects_malformed_kind():
    bad = server.ShopCartItemIn.model_construct(kind="bogus_kind", ref_id="x", quantity=1)
    try:
        server._normalize_cart_lines([bad])
        assert False, "expected 422 for malformed kind"
    except HTTPException as e:
        assert e.status_code == 422


def test_normalize_rejects_empty_ref_id():
    bad = server.ShopCartItemIn.model_construct(kind="product", ref_id="", quantity=1)
    try:
        server._normalize_cart_lines([bad])
        assert False, "expected 422 for empty ref_id"
    except HTTPException as e:
        assert e.status_code == 422


def test_normalize_rejects_zero_and_negative_and_non_integer_quantity():
    for bad_qty in (0, -1, 2.5, "3"):
        bad = server.ShopCartItemIn.model_construct(kind="product", ref_id="x", quantity=bad_qty)
        try:
            server._normalize_cart_lines([bad])
            assert False, f"expected 422 for quantity={bad_qty!r}"
        except HTTPException as e:
            assert e.status_code == 422, f"quantity={bad_qty!r}"


# ---------------------------------------------------------------------------
# Duplicate lines vs. stock ceiling, end to end through create_shop_checkout
# ---------------------------------------------------------------------------

def test_duplicate_lines_within_stock_produce_one_committed_line():
    with _client() as client, _product(track_inventory=True, starting_stock=10) as p:
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", p["id"], 3), _cart_item("product", p["id"], 4)])
        with _stripe_mocked():
            result = run(server.create_shop_checkout(body, user))
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order is not None
        product_lines = [l for l in order["lines"] if l["ref_id"] == p["id"]]
        assert len(product_lines) == 1, "duplicate lines must combine into exactly one order line"
        assert product_lines[0]["quantity"] == 7
        fresh_product = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        reservations = [r for r in (fresh_product.get("shop_reservations") or []) if r["order_id"] == result["order_id"]]
        assert len(reservations) == 1, "must be exactly one reservation entry, not one per raw duplicate line"
        assert reservations[0]["quantity"] == 7


def test_duplicate_lines_exceeding_stock_rejected_creates_no_order():
    with _client() as client, _product(track_inventory=True, starting_stock=5) as p:
        user = _shop_user(client["id"])
        idem = f"idem-{uuid.uuid4().hex}"
        body = _checkout_body([_cart_item("product", p["id"], 3), _cart_item("product", p["id"], 4)], idem=idem)
        try:
            with _stripe_mocked():
                run(server.create_shop_checkout(body, user))
            assert False, "expected rejection — combined qty 7 exceeds stock of 5"
        except HTTPException as e:
            assert e.status_code in (400, 409)
        claim = run(server.db.shop_checkout_claims.find_one({"idempotency_key": idem}, {"_id": 0}))
        order_id = claim["shop_order_id"] if claim else None
        if order_id:
            assert run(server.db.shop_orders.find_one({"id": order_id})) is None
        assert run(server.db.inventory_movements.count_documents({"source_ref": {"$regex": p["id"]}})) == 0
        fresh_product = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert float(fresh_product.get("stock_reserved") or 0) == 0.0


# ---------------------------------------------------------------------------
# Item deleted / deactivated / hidden section / inactive category-subcategory
# ---------------------------------------------------------------------------

def test_deactivated_item_rejected_creates_no_order():
    with _client() as client, _product(track_inventory=False) as p:
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"active": False}}))
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", p["id"], 1)])
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "expected rejection for deactivated item"
        except HTTPException as e:
            assert e.status_code in (400, 404, 409)
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


def test_item_deleted_after_being_added_rejected_creates_no_order():
    with _client() as client:
        with _product(track_inventory=False) as p:
            product_id = p["id"]
        # product context manager already deleted it on exit — simulate a
        # cart still referencing the now-gone id.
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", product_id, 1)])
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "expected rejection for deleted item"
        except HTTPException as e:
            assert e.status_code in (400, 404)
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


def test_hidden_section_rejects_checkout_even_though_item_itself_is_fine():
    """Proves a gap this phase closes: _price_shop_cart never checked
    shop_page.sections.<x>.visible at all, so a product with show_online/
    active=True but a HIDDEN section would previously have priced and
    checked out successfully. The new eligibility check must now reject it."""
    with _client() as client, _product(track_inventory=False) as p:
        original = run(server.get_settings()).get("shop_page") or {}
        original_merch_visible = ((original.get("sections") or {}).get("merch") or {}).get("visible", True)
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"shop_page.sections.merch.visible": False}}))
        try:
            user = _shop_user(client["id"])
            body = _checkout_body([_cart_item("product", p["id"], 1)])
            try:
                run(server.create_shop_checkout(body, user))
                assert False, "expected rejection — merch section is hidden"
            except HTTPException as e:
                assert e.status_code == 409
            assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0
        finally:
            run(server.db.settings.update_one({"id": "global"}, {"$set": {"shop_page.sections.merch.visible": original_merch_visible}}))


def test_inactive_category_rejects_checkout_even_though_item_itself_is_fine():
    """Another gap this phase closes: _price_shop_cart never checked
    category/subcategory active state either."""
    with _client() as client, _category() as cat:
        with _product(track_inventory=False, category_id=cat["id"]) as p:
            run(server.db.shop_categories.update_one({"id": cat["id"]}, {"$set": {"active": False}}))
            user = _shop_user(client["id"])
            body = _checkout_body([_cart_item("product", p["id"], 1)])
            try:
                run(server.create_shop_checkout(body, user))
                assert False, "expected rejection — category deactivated after cart was formed"
            except HTTPException as e:
                assert e.status_code == 409
            assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


def test_inactive_subcategory_rejects_checkout_even_though_category_active():
    with _client() as client, _category() as cat:
        with _subcategory(cat["id"]) as sub:
            with _product(track_inventory=False, category_id=cat["id"], subcategory_id=sub["id"]) as p:
                run(server.db.shop_subcategories.update_one({"id": sub["id"]}, {"$set": {"active": False}}))
                user = _shop_user(client["id"])
                body = _checkout_body([_cart_item("product", p["id"], 1)])
                try:
                    run(server.create_shop_checkout(body, user))
                    assert False, "expected rejection — subcategory deactivated after cart was formed"
                except HTTPException as e:
                    assert e.status_code == 409
                assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


# ---------------------------------------------------------------------------
# Approval / dog / onboarding hard blocks
# ---------------------------------------------------------------------------

def test_requires_approval_rejected_creates_no_order():
    with _client() as client, _product(track_inventory=False, requires_approval=True) as p:
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", p["id"], 1)])
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "expected 422 — approval required"
        except HTTPException as e:
            assert e.status_code == 422
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


def test_requires_dog_rejected_creates_no_order():
    with _client() as client, _product(track_inventory=False, requires_dog=True) as p:
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", p["id"], 1)])
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "expected 422 — dog selection required"
        except HTTPException as e:
            assert e.status_code == 422
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


def test_incomplete_onboarding_rejected_creates_no_order():
    with _client() as client, _program(requires_completed_onboarding=True) as prog:
        # A bare-bones fresh client (no dogs/vaccines/waiver) is booking_locked
        # by construction — verified empirically before writing this test.
        status = run(server._compute_setup_status_for_client(client))
        assert status["booking_locked"] is True
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("training_program", prog["id"], 1)])
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "expected 422 — onboarding incomplete"
        except HTTPException as e:
            assert e.status_code == 422
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


def test_eligibility_never_reads_publicly_visible():
    """An item that's publicly_visible=False but otherwise fully eligible
    must still check out normally for an authenticated client —
    publicly_visible is a guest/public-facing concept only."""
    with _client() as client, _product(track_inventory=False, publicly_visible=False) as p:
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", p["id"], 1)])
        with _stripe_mocked():
            result = run(server.create_shop_checkout(body, user))
        assert result["order_id"]
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order is not None


# ---------------------------------------------------------------------------
# Mixed eligible/ineligible cart — atomic rejection
# ---------------------------------------------------------------------------

def test_mixed_cart_one_eligible_one_ineligible_rejects_atomically():
    with _client() as client, _product(track_inventory=False) as good, _product(track_inventory=False, requires_approval=True) as bad:
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", good["id"], 1), _cart_item("product", bad["id"], 1)])
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "expected the whole cart rejected"
        except HTTPException as e:
            assert e.status_code == 422
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0
        assert run(server.db.shop_payment_attempts.count_documents({"client_id": client["id"]})) == 0
        assert run(server.db.inventory_movements.count_documents({"source_ref": {"$regex": good["id"]}})) == 0


# ---------------------------------------------------------------------------
# Shopify-external handling unchanged
# ---------------------------------------------------------------------------

def test_shopify_external_item_still_rejected_from_cart_unchanged():
    with _client() as client, _product(
        track_inventory=False, sales_destination="shopify_external",
        shopify_product_url="https://example.myshopify.com/products/z",
    ) as p:
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", p["id"], 1)])
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "Shopify-linked items must never enter the cart/checkout path"
        except HTTPException as e:
            assert e.status_code == 400
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0


# ---------------------------------------------------------------------------
# Fully eligible paths unaffected
# ---------------------------------------------------------------------------

def test_fully_eligible_stripe_checkout_reaches_session_creation_path():
    with _client() as client, _product(track_inventory=True, starting_stock=5, price=15.0) as p:
        user = _shop_user(client["id"])
        body = _checkout_body([_cart_item("product", p["id"], 2)])
        with _stripe_mocked() as calls:
            result = run(server.create_shop_checkout(body, user))
        assert result["url"] == "https://checkout.stripe.com/test/fake-session"
        assert len(calls) == 1
        order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
        assert order["status"] == "pending_payment"
        assert order["total"] == 30.0
        attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": result["order_id"]}, {"_id": 0}))
        assert attempt["stripe_checkout_session_url"] == "https://checkout.stripe.com/test/fake-session"


def test_fully_eligible_cash_manual_checkout_unchanged():
    """Front Desk's cash/manual credit-pack sale is a completely separate
    code path from create_shop_checkout (never touched by Phase 3) — a
    direct regression check that it still works exactly as before."""
    with _client() as client, _pack(available_online=False) as pack, _open_register_day():
        admin = _admin_user()
        body = server.SellCreditPackIn(pack_id=pack["id"], payment_method="cash")
        lot = run(server.sell_credit_pack(client["id"], body, admin))
        assert lot["qty_total"] == pack["qty"]
        assert lot["payment_method"] == "cash"
        fresh_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0}))
        balance_field = server._credit_balance_field(pack["service_type"]) or "credits"
        assert fresh_client.get(balance_field) == pack["qty"]
        run(server.db.credit_lots.delete_many({"pack_id": pack["id"]}))
        run(server.db.retail_sales.delete_many({"client_id": client["id"]}))


def test_idempotent_retry_remains_idempotent():
    with _client() as client, _product(track_inventory=True, starting_stock=5, price=10.0) as p:
        user = _shop_user(client["id"])
        idem = f"idem-{uuid.uuid4().hex}"
        body1 = _checkout_body([_cart_item("product", p["id"], 1)], idem=idem)
        body2 = _checkout_body([_cart_item("product", p["id"], 1)], idem=idem)
        with _stripe_mocked() as calls:
            result1 = run(server.create_shop_checkout(body1, user))
            result2 = run(server.create_shop_checkout(body2, user))
        assert result1["order_id"] == result2["order_id"]
        assert result1["url"] == result2["url"]
        # Stripe's Session.create must only ever have been called once — the
        # second call resumes the cached session, never creates a new one.
        assert len(calls) == 1
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 1


# ---------------------------------------------------------------------------
# Claim-row release/retry semantics — a rejected checkout leaves its
# idempotency claim row (see create_shop_checkout's DuplicateKeyError
# handling), pointing at an order_id for which no shop_orders document was
# ever inserted. This proves that state is NOT a permanent "stuck
# processing" trap: an exact immediate retry (still ineligible) is a
# deterministic repeat rejection, never an ambiguous 409 "different
# request"; and once the underlying condition is fixed, a retry with the
# SAME idempotency key and SAME cart payload successfully completes,
# reusing the pre-claimed order_id — never replaying the stale rejection,
# never requiring a new key.
# ---------------------------------------------------------------------------

def test_rejected_checkout_can_be_retried_with_same_key_once_made_eligible():
    with _client() as client, _product(track_inventory=False, requires_approval=True) as p:
        user = _shop_user(client["id"])
        idem = f"idem-{uuid.uuid4().hex}"
        body = _checkout_body([_cart_item("product", p["id"], 1)], idem=idem)

        # 1) Ineligible cart, first attempt — rejected, no business writes.
        try:
            run(server.create_shop_checkout(body, user))
            assert False, "expected 422 — approval required"
        except HTTPException as e:
            assert e.status_code == 422
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0
        assert run(server.db.shop_payment_attempts.count_documents({"client_id": client["id"]})) == 0
        claim = run(server.db.shop_checkout_claims.find_one({"idempotency_key": idem}, {"_id": 0}))
        assert claim is not None, "the idempotency claim row is expected to survive a rejection"
        claimed_order_id = claim["shop_order_id"]
        assert run(server.db.shop_orders.find_one({"id": claimed_order_id})) is None

        # 2) Exact immediate retry, SAME key, SAME cart, STILL ineligible —
        # must be a deterministic repeat rejection (422 again), never an
        # ambiguous 409 "already used for a different request" conflict,
        # and must still leave no business writes.
        retry_body_still_bad = _checkout_body([_cart_item("product", p["id"], 1)], idem=idem)
        try:
            run(server.create_shop_checkout(retry_body_still_bad, user))
            assert False, "expected the same deterministic 422 on immediate retry"
        except HTTPException as e:
            assert e.status_code == 422, "must repeat the same rejection kind, never a 409 conflict"
        assert run(server.db.shop_orders.count_documents({"client_id": client["id"]})) == 0

        # 3) Fix the underlying condition WITHOUT changing the cart payload.
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"requires_approval": False}}))

        # 4) Retry with the SAME idempotency key and SAME cart.
        retry_body = _checkout_body([_cart_item("product", p["id"], 1)], idem=idem)
        with _stripe_mocked() as calls:
            result = run(server.create_shop_checkout(retry_body, user))

        # 5) Must now succeed — reusing the SAME pre-claimed order_id, never
        # stuck, never silently replaying the earlier rejection.
        assert result["order_id"] == claimed_order_id
        assert len(calls) == 1
        order = run(server.db.shop_orders.find_one({"id": claimed_order_id}, {"_id": 0}))
        assert order is not None
        assert order["status"] == "pending_payment"
        attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": claimed_order_id}, {"_id": 0}))
        assert attempt is not None
        assert attempt["stripe_checkout_session_url"] == result["url"]

        # A further retry with the same key now behaves as an ordinary
        # idempotent resume — same order, no second Stripe session created.
        with _stripe_mocked() as calls2:
            result2 = run(server.create_shop_checkout(retry_body, user))
        assert result2["order_id"] == claimed_order_id
        assert result2["url"] == result["url"]
        assert len(calls2) == 0, "an already-completed attempt must not create a second Stripe session"
