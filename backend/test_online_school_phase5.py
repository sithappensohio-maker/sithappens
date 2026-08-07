"""Sit Happens Online School — Phase 5 (commerce & automatic enrollment)
backend coverage.

Same self-contained ASGI-transport-free harness convention as
test_online_school_phase1.py (calls endpoint functions directly — Depends()
permission gates don't run this way, which is fine since every check this
suite cares about lives in the function body).
"""
import contextlib
import hashlib
import hmac
import json
import time
import uuid
from unittest.mock import patch

import httpx

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ONLINE_SCHOOL_P5"


# ---------------------------------------------------------------------------
# Shop checkout harness — same Stripe-monkeypatch convention as
# test_shop_checkout_eligibility.py's docstring (fast offline correctness
# check, never hits real Stripe).
# ---------------------------------------------------------------------------

class _FakeStripeObj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e


def _fake_customer_create(**kwargs):
    return _FakeStripeObj(id="cus_test_fake_" + uuid.uuid4().hex[:8])


def _fake_session_create(**kwargs):
    return _FakeStripeObj(id="cs_test_fake_" + uuid.uuid4().hex[:8], url="https://checkout.stripe.com/test/fake-session")


@contextlib.contextmanager
def _stripe_mocked():
    orig_customer_create = server.stripe.Customer.create
    orig_session_create = server.stripe.checkout.Session.create
    server.stripe.Customer.create = _fake_customer_create
    server.stripe.checkout.Session.create = _fake_session_create
    try:
        yield
    finally:
        server.stripe.Customer.create = orig_customer_create
        server.stripe.checkout.Session.create = orig_session_create


def _shop_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": f"{TAG} shop user"}


def _checkout_and_pay(user, items):
    """Drives create_shop_checkout (Stripe mocked) through to a real "paid"
    order + full fulfillment by building the exact authoritative session_obj
    _verify_shop_stripe_session_authoritative requires, then calling
    _apply_shop_payment directly — the same function the real webhook/poll
    endpoints call, so this exercises the real fulfillment path, not a
    test-only shortcut."""
    with _stripe_mocked():
        result = run(server.create_shop_checkout(
            server.ShopCheckoutIn(items=items, idempotency_key=f"{TAG}-{uuid.uuid4().hex}"), user,
        ))
    order = run(server.db.shop_orders.find_one({"id": result["order_id"]}, {"_id": 0}))
    attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
    session_obj = _FakeStripeObj(
        id=attempt["stripe_checkout_session_id"],
        payment_status="paid", currency="usd",
        amount_total=server._stripe_amount_cents(order["total"]),
        metadata={"sithappens_shop_order_id": order["id"], "sithappens_attempt_id": attempt["id"]},
    )
    run(server._apply_shop_payment(attempt, session_obj))
    return run(server.db.shop_orders.find_one({"id": order["id"]}, {"_id": 0}))


def _cleanup_shop_order_traces(client_id):
    run(server.db.shop_orders.delete_many({"client_id": client_id}))
    run(server.db.shop_checkout_claims.delete_many({"client_id": client_id}))
    run(server.db.shop_payment_attempts.delete_many({"client_id": client_id}))
    run(server.db.payments.delete_many({"client_id": client_id}))


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


class _OpenRegisterDay:
    """Same pattern as test_credit_pack_display_fields.py's helper of the
    same name — opens today's cash_drawer_sessions row only if none exists
    yet, closes it back out on exit only if this instance created it."""

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


@contextlib.contextmanager
def _client_and_dog():
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    did = str(uuid.uuid4())
    dog = {
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }
    run(server.db.dogs.insert_one(dog))
    try:
        yield c, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@contextlib.contextmanager
def _school_program(n_modules=1, n_lessons_per_module=1, purchase_fulfillment=None, available_online=False):
    """A minimal self_guided program, real enough for school_enroll (needs
    at least one module with at least one lesson to pass
    _grant_online_school_enrollment's validation). available_online=True
    also makes it eligible for the client Shop checkout path."""
    admin = _admin_user()
    modules = [server.ModuleIn(
        name="Module 1", order=0,
        goals=[server.GoalIn(name="Skill 1")],
    )]
    kw = dict(
        name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
        format={"count": n_modules, "unit": "modules"}, price=100,
        delivery_mode="self_guided", modules=modules, available_online=available_online,
    )
    if purchase_fulfillment is not None:
        kw["purchase_fulfillment"] = purchase_fulfillment
    prog = run(server.create_program(server.ProgramIn(**kw), admin))
    # Second pass to attach a real lesson (needs the goal id from creation).
    m = prog["modules"][0]
    goal_id = m["goals"][0]["id"]
    lesson = server.LessonIn(
        name="Lesson 1", order=0, active=True, skill_ids=[goal_id],
        client_overview="overview", why_it_matters="matters", success_criteria="criteria",
    )
    fixed_kw = dict(kw)
    fixed_kw["modules"] = [server.ModuleIn(
        id=m["id"], name=m["name"], order=m["order"],
        goals=[server.GoalIn(**g) for g in m["goals"]], lessons=[lesson],
    )]
    prog = run(server.update_program(prog["id"], server.ProgramIn(**fixed_kw), cascade=False, save_as_draft=False, _=admin))
    try:
        yield prog, admin
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _cleanup_dog_programs_and_lots(dog_id, client_id):
    run(server.db.dog_programs.delete_many({"dog_id": dog_id}))
    run(server.db.school_enrollments.delete_many({"dog_id": dog_id}))
    run(server.db.credit_lots.delete_many({"client_id": client_id}))
    run(server.db.retail_sales.delete_many({"client_id": client_id}))
    run(server.db.homework.delete_many({"dog_id": dog_id}))


# ---------------------------------------------------------------------------
# 5.2 — sell_training_program delivery_channel collision fix
# ---------------------------------------------------------------------------

def test_sell_program_does_not_collide_with_existing_online_school_enrollment():
    """A dog with an active Online School enrollment for a program, then
    sold that SAME program via the trainer-led sell-program tool, must get
    a genuinely separate trainer-led dog_programs row — not have the sale
    silently no-op onto the online-school row as if it were "already
    enrolled". This is the exact collision the Phase 1 audit deferred."""
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin), _OpenRegisterDay(TAG):
        try:
            school_result = run(server.school_enroll(
                server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin,
            ))
            online_enrollment_id = school_result["enrollment"]["id"]
            online_raw = run(server.db.dog_programs.find_one({"id": online_enrollment_id}))
            assert online_raw["delivery_channel"] == "online_school"

            sale_result = run(server.sell_training_program(
                c["id"], server.SellProgramIn(program_id=prog["id"], dog_id=dog["id"], payment_method="cash"), admin,
            ))
            assert sale_result["enrollment"] is not None
            new_enrollment_id = sale_result["enrollment"]["id"]

            # Must be a brand new row, not the online-school one.
            assert new_enrollment_id != online_enrollment_id
            new_raw = run(server.db.dog_programs.find_one({"id": new_enrollment_id}))
            assert "delivery_channel" not in new_raw  # trainer-led rows never set this key

            # Both stay active and distinct.
            active_rows = run(server.db.dog_programs.find(
                {"dog_id": dog["id"], "program_id": prog["id"], "status": "active"}, {"_id": 0},
            ).to_list(10))
            assert len(active_rows) == 2
            ids = {r["id"] for r in active_rows}
            assert ids == {online_enrollment_id, new_enrollment_id}

            # Selling again (now two active rows exist: one online, one
            # trainer-led) must still match onto the trainer-led one, not
            # error and not create a third row.
            sale_result_2 = run(server.sell_training_program(
                c["id"], server.SellProgramIn(program_id=prog["id"], dog_id=dog["id"], payment_method="cash"), admin,
            ))
            assert sale_result_2["enrollment"]["id"] == new_enrollment_id
            active_rows_2 = run(server.db.dog_programs.find(
                {"dog_id": dog["id"], "program_id": prog["id"], "status": "active"}, {"_id": 0},
            ).to_list(10))
            assert len(active_rows_2) == 2
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_sell_program_with_purchase_fulfillment_online_school_grants_real_enrollment():
    """When the program is explicitly configured purchase_fulfillment=
    "online_school", sell_training_program must call the SAME canonical
    helper school_enroll uses (never a parallel trainer-led row), and be
    idempotent on retry."""
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin), _OpenRegisterDay(TAG):
        try:
            assert prog.get("purchase_fulfillment") == "online_school"
            result = run(server.sell_training_program(
                c["id"], server.SellProgramIn(program_id=prog["id"], dog_id=dog["id"], payment_method="cash"), admin,
            ))
            enr_id = result["enrollment"]["id"]
            raw = run(server.db.dog_programs.find_one({"id": enr_id}))
            assert raw["delivery_channel"] == "online_school"
            assert raw["enrollment_source"] == "purchase"
            se = run(server.db.school_enrollments.find_one({"enrollment_id": enr_id}, {"_id": 0}))
            assert se is not None and se["status"] == "active"

            # Retry (e.g. staff double-clicks) must converge onto the same
            # enrollment, not error and not create a duplicate.
            result_2 = run(server.sell_training_program(
                c["id"], server.SellProgramIn(program_id=prog["id"], dog_id=dog["id"], payment_method="cash"), admin,
            ))
            assert result_2["enrollment"]["id"] == enr_id
            active_rows = run(server.db.dog_programs.find(
                {"dog_id": dog["id"], "program_id": prog["id"], "status": "active"}, {"_id": 0},
            ).to_list(10))
            assert len(active_rows) == 1
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


# ---------------------------------------------------------------------------
# 5.4/5.5 — client Shop checkout dog-targeting + online_school fulfillment
# ---------------------------------------------------------------------------

def test_shop_checkout_online_school_program_requires_dog_id():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            try:
                with _stripe_mocked():
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(
                            items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1)],
                            idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                        ),
                        user,
                    ))
                assert False, "expected HTTPException for missing dog_id"
            except server.HTTPException as exc:
                assert exc.status_code == 422
                assert "dog" in str(exc.detail).lower()
        finally:
            _cleanup_shop_order_traces(c["id"])


def test_shop_checkout_online_school_program_rejects_other_clients_dog():
    with _client_and_dog() as (c, dog), _client_and_dog() as (other_c, other_dog), \
         _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            try:
                with _stripe_mocked():
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(
                            items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=other_dog["id"])],
                            idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                        ),
                        user,
                    ))
                assert False, "expected HTTPException for cross-client dog_id"
            except server.HTTPException as exc:
                assert exc.status_code == 422
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup_shop_order_traces(other_c["id"])


def test_shop_checkout_online_school_program_grants_real_enrollment():
    """The full purchase → pay → fulfill path grants the SAME dog_programs/
    school_enrollments structures a manual school_enroll would — never a
    parallel commerce enrollment — and records the enrollment id back onto
    the order line."""
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"]),
            ])
            assert order["status"] == "paid"
            assert order["fulfillment_status"] == "fulfilled"
            line = order["lines"][0]
            assert line["fulfillment_status"] == "fulfilled"
            assert line["fulfillment_kind"] == "online_school"
            enr_id = line["online_school_enrollment_id"]
            assert enr_id

            raw = run(server.db.dog_programs.find_one({"id": enr_id}))
            assert raw["delivery_channel"] == "online_school"
            assert raw["enrollment_source"] == "purchase"
            assert raw["enrollment_source_ref"] == f"shop_order:{order['id']}:line:{line['item_id']}"
            se = run(server.db.school_enrollments.find_one({"enrollment_id": enr_id}, {"_id": 0}))
            assert se is not None and se["status"] == "active" and se["client_id"] == c["id"]

            # Webhook replay / Retry Fulfillment must converge, not duplicate.
            attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order["id"]}, {"_id": 0}))
            run(server._apply_shop_payment(attempt))
            active_rows = run(server.db.dog_programs.find(
                {"dog_id": dog["id"], "program_id": prog["id"], "status": "active"}, {"_id": 0},
            ).to_list(10))
            assert len(active_rows) == 1
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
            _cleanup_shop_order_traces(c["id"])


def test_shop_checkout_two_dogs_same_program_creates_two_lines_and_enrollments():
    """A cart with the SAME online_school program for two different dogs
    must not collapse into one summed-quantity line (_normalize_cart_lines'
    dog_id-aware aggregation key) and must grant two independent
    enrollments, one per dog."""
    with _client_and_dog() as (c, dog_a), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        admin2 = _admin_user()
        dog_b_id = str(uuid.uuid4())
        run(server.db.dogs.insert_one({
            "id": dog_b_id, "name": f"{TAG} Dog B", "owner_id": c["id"], "breed": "Mix", "age_y": 2,
            "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
        }))
        user = _shop_user(c["id"])
        try:
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog_a["id"]),
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog_b_id),
            ])
            assert len(order["lines"]) == 2
            assert order["fulfillment_status"] == "fulfilled"
            enr_ids = {l["online_school_enrollment_id"] for l in order["lines"]}
            assert len(enr_ids) == 2

            dog_a_active = run(server.db.dog_programs.count_documents(
                {"dog_id": dog_a["id"], "program_id": prog["id"], "status": "active"},
            ))
            dog_b_active = run(server.db.dog_programs.count_documents(
                {"dog_id": dog_b_id, "program_id": prog["id"], "status": "active"},
            ))
            assert dog_a_active == 1
            assert dog_b_active == 1
        finally:
            _cleanup_dog_programs_and_lots(dog_a["id"], c["id"])
            _cleanup_dog_programs_and_lots(dog_b_id, c["id"])
            run(server.db.dogs.delete_one({"id": dog_b_id}))
            _cleanup_shop_order_traces(c["id"])


def test_shop_checkout_credits_only_program_unaffected_by_online_school_changes():
    """A normal (purchase_fulfillment default "credits_only") program sold
    through the Shop must behave byte-identically to before Phase 5: no
    dog_id required, grants training_credits via the pre-existing
    _fulfill_shop_training_program_line path, never touches dog_programs."""
    with _client_and_dog() as (c, dog), _school_program(available_online=True) as (prog, admin):
        assert prog.get("purchase_fulfillment") == "credits_only"
        user = _shop_user(c["id"])
        try:
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1),
            ])
            assert order["status"] == "paid"
            line = order["lines"][0]
            assert line["fulfillment_status"] == "fulfilled"
            assert line["fulfillment_kind"] == "credits_only"
            assert "online_school_enrollment_id" not in line
            client_after = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0}))
            assert client_after["training_credits"] == 1  # format.count defaults to n_modules=1
            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"]})) == 0
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
            _cleanup_shop_order_traces(c["id"])


# ---------------------------------------------------------------------------
# 5.6 — POS Program sale online_school decision (blocked, not guessed)
# ---------------------------------------------------------------------------

def test_pos_sale_rejects_online_school_fulfillment_program():
    """The Front Desk register has no dog-selector for training_program
    lines — per the Phase 5 decision, selling an online_school-fulfillment
    program at the register is explicitly blocked (not silently guessed at
    or silently downgraded to credits) until a register dog-selector
    exists. Credits-only programs are completely unaffected."""
    staff = {"id": "test-pos-staff", "name": "QA Tester", "email": "qa@test", "role": "admin"}
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin):
        body = server.PosSalePreviewIn(
            lines=[server.PosSaleLineIn(kind="training_program", program_id=prog["id"], qty=1)],
            client_id=c["id"],
        )
        try:
            run(server.preview_pos_sale(body, staff))
            assert False, "expected HTTPException for online_school POS sale"
        except server.HTTPException as exc:
            assert exc.status_code == 400
            assert "sell program" in str(exc.detail).lower() or "shop" in str(exc.detail).lower()


def test_pos_sale_credits_only_program_unaffected_by_online_school_block():
    staff = {"id": "test-pos-staff", "name": "QA Tester", "email": "qa@test", "role": "admin"}
    with _client_and_dog() as (c, dog), _school_program() as (prog, admin):
        assert prog.get("purchase_fulfillment") == "credits_only"
        body = server.PosSalePreviewIn(
            lines=[server.PosSaleLineIn(kind="training_program", program_id=prog["id"], qty=1)],
            client_id=c["id"],
        )
        priced = run(server.preview_pos_sale(body, staff))
        assert priced["line_items"][0]["kind"] == "training_program"


# ---------------------------------------------------------------------------
# 5.8 — refund/void safety: training history must survive every existing
# refund/void path, unchanged. Audit found no code path that can reach an
# online_school dog_programs/school_enrollments row from a refund or void:
#   - Shop-order Stripe payments have no refund endpoint yet (see the
#     comment at the payments-list query "refunds against a shop_order_
#     payment row are NOT available yet").
#   - POS is now blocked from ever selling an online_school program (5.6),
#     so void_pos_sale's credit_lot clawback can never have one to touch.
#   - void_payment is hard-scoped to source.kind=="manual_topup" (account
#     top-ups), unrelated to program sales entirely.
#   - booking_refund reverses a booking, never dog_programs/school_enrollments
#     (already proven for the Trainer Assist-linked case in the Phase 4
#     cancellation-lifecycle hardening).
# So the "refunds cannot corrupt training history" requirement is satisfied
# structurally today — there is no reachable path, not just an untested
# one. This test proves it for the one path that DOES touch a client with
# an online_school enrollment: voiding an unrelated POS sale for the same
# client must leave the enrollment completely untouched.
# ---------------------------------------------------------------------------

def _noop(*a, **kw):
    return None


def test_voiding_unrelated_pos_sale_never_touches_online_school_enrollment():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school") as (prog, admin):
        staff = {"id": "test-pos-staff", "name": "QA Tester", "email": "qa@test", "role": "admin"}
        product_id = str(uuid.uuid4())
        run(server.db.pos_products.insert_one({
            "id": product_id, "name": f"{TAG} Product", "price": 25.0, "sku": f"{TAG}-{uuid.uuid4().hex[:6]}",
            "category": "retail", "track_inventory": False, "active": True, "show_online": False,
        }))
        sale_id = None
        try:
            school_result = run(server.school_enroll(
                server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin,
            ))
            enr_id = school_result["enrollment"]["id"]

            body = server.PosSaleIn(
                client_id=c["id"],
                lines=[server.PosSaleLineIn(kind="retail", product_id=product_id, qty=1)],
                tenders=[server.PosSaleTenderIn(method="cash", amount=25.0, tendered_amount=25.0)],
                idempotency_key=f"{TAG}-{uuid.uuid4()}",
            )
            with _OpenRegisterDay(TAG), patch.object(server, "_issue_pos_token", new=_noop):
                sale_result = run(server.create_pos_sale(body, staff))
            sale_id = sale_result["pos_sale_id"]

            with _OpenRegisterDay(TAG):
                run(server.void_pos_sale(
                    sale_id, server.PosSaleVoidIn(reason="test void", idempotency_key=f"{TAG}-void-{uuid.uuid4()}"), staff,
                ))

            raw = run(server.db.dog_programs.find_one({"id": enr_id}))
            assert raw["status"] == "active"
            assert raw["delivery_channel"] == "online_school"
            se = run(server.db.school_enrollments.find_one({"enrollment_id": enr_id}, {"_id": 0}))
            assert se is not None and se["status"] == "active"
        finally:
            run(server.db.pos_products.delete_one({"id": product_id}))
            if sale_id:
                run(server.db.pos_sales.delete_one({"id": sale_id}))
                run(server.db.retail_sales.delete_many({"pos_sale_id": sale_id}))
                run(server.db.pos_sale_void_claims.delete_many({"pos_sale_id": sale_id}))
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


# ---------------------------------------------------------------------------
# purchase_fulfillment must be visible on the actual client-facing catalog
# read paths (GET /shop/catalog, GET /shop/item/...) — not just present on
# the program document. Caught a real bug: _build_shop_catalog (the client
# Shop's real catalog builder) and _build_register_catalog (POS/Front Desk,
# a completely separate function) each have their OWN training_program
# item-building block; the field must be added to _build_shop_catalog's,
# which is what the client Shop item detail page actually reads through
# GET /shop/item/{kind}/{id} (see get_shop_item_detail's docstring — it
# reuses _build_shop_catalog specifically so this never drifts).
# ---------------------------------------------------------------------------

def test_shop_catalog_and_item_detail_expose_purchase_fulfillment():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            catalog = run(server.get_shop_catalog(user))
            item_in_catalog = next(i for i in catalog["items"] if i["kind"] == "training_program" and i["id"] == prog["id"])
            assert item_in_catalog["purchase_fulfillment"] == "online_school"

            detail = run(server.get_shop_item_detail("training_program", prog["id"], user))
            assert detail["purchase_fulfillment"] == "online_school"
        finally:
            pass


# ---------------------------------------------------------------------------
# Hardening pass — item 2: quantity must be exactly 1 per dog for an
# online_school line, enforced at cart normalization (before pricing), not
# only by hiding the UI stepper.
# ---------------------------------------------------------------------------

def test_normalize_cart_lines_rejects_dog_scoped_line_with_quantity_2():
    dog_id = str(uuid.uuid4())
    items = [server.ShopCartItemIn(kind="training_program", ref_id="prog-1", quantity=2, dog_id=dog_id)]
    try:
        server._normalize_cart_lines(items)
        assert False, "expected HTTPException for quantity=2 on a dog-scoped line"
    except server.HTTPException as exc:
        assert exc.status_code == 422


def test_normalize_cart_lines_rejects_duplicate_same_dog_lines_combining_to_2():
    """Two separate qty=1 cart entries for the SAME dog+course must not
    silently combine into a quantity=2 line and a double charge."""
    dog_id = str(uuid.uuid4())
    items = [
        server.ShopCartItemIn(kind="training_program", ref_id="prog-1", quantity=1, dog_id=dog_id),
        server.ShopCartItemIn(kind="training_program", ref_id="prog-1", quantity=1, dog_id=dog_id),
    ]
    try:
        server._normalize_cart_lines(items)
        assert False, "expected HTTPException for duplicate same-dog lines"
    except server.HTTPException as exc:
        assert exc.status_code == 422


def test_normalize_cart_lines_keeps_two_different_dogs_as_two_valid_lines():
    dog_a, dog_b = str(uuid.uuid4()), str(uuid.uuid4())
    items = [
        server.ShopCartItemIn(kind="training_program", ref_id="prog-1", quantity=1, dog_id=dog_a),
        server.ShopCartItemIn(kind="training_program", ref_id="prog-1", quantity=1, dog_id=dog_b),
    ]
    normalized = server._normalize_cart_lines(items)
    assert len(normalized) == 2
    assert {n.dog_id for n in normalized} == {dog_a, dog_b}
    assert all(n.quantity == 1 for n in normalized)


def test_checkout_rejects_quantity_2_online_school_line_before_any_order_or_attempt_exists():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            with _stripe_mocked():
                try:
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(
                            items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=2, dog_id=dog["id"])],
                            idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                        ),
                        user,
                    ))
                    assert False, "expected HTTPException for quantity=2"
                except server.HTTPException as exc:
                    assert exc.status_code == 422
            # Rejected before pricing/order/attempt creation — no trace except the nothing.
            assert run(server.db.shop_orders.count_documents({"client_id": c["id"]})) == 0
            assert run(server.db.shop_payment_attempts.count_documents({"client_id": c["id"]})) == 0
        finally:
            _cleanup_shop_order_traces(c["id"])


# ---------------------------------------------------------------------------
# Hardening pass — item 3: ownership enforced BEFORE Stripe session
# creation, not merely by fulfillment convergence after the fact.
# ---------------------------------------------------------------------------

def test_checkout_rejects_purchase_when_dog_already_actively_enrolled():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            with _stripe_mocked():
                try:
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(
                            items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"])],
                            idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                        ),
                        user,
                    ))
                    assert False, "expected HTTPException — dog already actively enrolled"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
            # No order, no payment attempt — Stripe was never touched.
            assert run(server.db.shop_orders.count_documents({"client_id": c["id"]})) == 0
            assert run(server.db.shop_payment_attempts.count_documents({"client_id": c["id"]})) == 0
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_checkout_rejects_repurchase_of_completed_course_no_retake_policy():
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            result = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))
            enr_id = result["enrollment"]["id"]
            run(server.db.dog_programs.update_one({"id": enr_id}, {"$set": {"status": "completed"}}))
            run(server.db.school_enrollments.update_one({"enrollment_id": enr_id}, {"$set": {"status": "completed"}}))

            with _stripe_mocked():
                try:
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(
                            items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"])],
                            idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                        ),
                        user,
                    ))
                    assert False, "expected HTTPException — no-retake policy"
                except server.HTTPException as exc:
                    assert exc.status_code == 409
            assert run(server.db.shop_orders.count_documents({"client_id": c["id"]})) == 0
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_race_enrollment_created_via_other_path_after_add_to_cart_before_checkout():
    """Exact race the spec describes: (1) course added while available,
    (2) enrollment created through a DIFFERENT path (staff/admin
    school_enroll) before checkout, (3) checkout is attempted, (4) no new
    charge/payment session for that course is allowed — the money boundary
    (_validate_shop_item_eligibility, which runs before any order/attempt
    row exists) re-checks ownership fresh on every checkout attempt, so a
    stale cart line can never ride past a same-session ownership check that
    already ran once."""
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            # (1) "Added to cart" is client-side state — nothing server-side
            # happens yet, matching the real Shop UI's addToCart().
            cart_items = [server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"])]

            # (2) Enrollment created through a completely different path —
            # staff enrolling the dog directly — before the client checks out.
            run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"]), admin))

            # (3) Checkout is attempted with the now-stale cart line.
            with _stripe_mocked():
                try:
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(items=cart_items, idempotency_key=f"{TAG}-{uuid.uuid4().hex}"),
                        user,
                    ))
                    assert False, "expected HTTPException — stale cart line, dog already enrolled"
                except server.HTTPException as exc:
                    assert exc.status_code == 409

            # (4) No charge/session — no order, no payment attempt at all.
            assert run(server.db.shop_orders.count_documents({"client_id": c["id"]})) == 0
            assert run(server.db.shop_payment_attempts.count_documents({"client_id": c["id"]})) == 0
            # And the dog still has exactly the one (staff-granted) enrollment —
            # the rejected checkout attempt created nothing.
            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
        finally:
            _cleanup_shop_order_traces(c["id"])
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


# ---------------------------------------------------------------------------
# Security confirmation — a client cannot tamper with dog_id, program_id,
# fulfillment type, or price once the server has established the purchase
# context (priced + frozen onto an order line).
# ---------------------------------------------------------------------------

def test_shop_cart_item_model_has_no_client_controlled_price_or_fulfillment_field():
    """Structural proof, not just behavioral: the client-facing cart model
    has no price/fulfillment-type field for a client to even attempt to
    set — both are ALWAYS resolved server-side from the real program doc
    looked up by ref_id (see _price_shop_cart)."""
    fields = set(server.ShopCartItemIn.model_fields.keys())
    assert fields == {"kind", "ref_id", "quantity", "dog_id"}
    assert "price" not in fields
    assert "unit_price" not in fields
    assert "fulfillment_kind" not in fields
    assert "purchase_fulfillment" not in fields


def test_price_shop_cart_ignores_smuggled_price_and_fulfillment_fields():
    """Even a line built via model_construct (bypassing Pydantic validation
    entirely — the one way _normalize_cart_lines itself builds lines) with
    extra smuggled attributes must have zero effect: _price_shop_cart only
    ever reads kind/ref_id/quantity/dog_id off the model and resolves
    unit_price/fulfillment_kind itself from the real DB program doc."""
    with _client_and_dog() as (c, dog), _school_program(available_online=True) as (prog, admin):  # credits_only (default)
        try:
            smuggled = server.ShopCartItemIn.model_construct(
                kind="training_program", ref_id=prog["id"], quantity=1, dog_id=None,
            )
            # Smuggle attributes a hand-crafted request body could never
            # even reach ShopCartItemIn with (no such fields exist on the
            # model — see the structural test above) but that a determined
            # attacker might still try to inject via a raw dict payload.
            object.__setattr__(smuggled, "price", 0.01)
            object.__setattr__(smuggled, "unit_price", 0.01)
            object.__setattr__(smuggled, "fulfillment_kind", "online_school")

            priced = run(server._price_shop_cart([smuggled], client_id=c["id"]))
            line = priced["lines"][0]
            assert line["unit_price"] == round(float(prog["price"]), 2)
            assert line["fulfillment_kind"] == "credits_only"  # server-derived from the real program doc, not the smuggled value
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])


def test_checkout_retry_with_different_dog_id_under_same_idempotency_key_is_rejected():
    """Once a purchase context (order) is established under an idempotency
    key, a client cannot swap the dog on a retry — the fingerprint check
    (client_id + full normalized cart, including dog_id) rejects a replay
    whose content doesn't byte-for-byte match what the key first claimed,
    and the original order's frozen line is provably unchanged."""
    with _client_and_dog() as (c, dog_a), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        dog_b_id = str(uuid.uuid4())
        run(server.db.dogs.insert_one({
            "id": dog_b_id, "name": f"{TAG} Dog B", "owner_id": c["id"], "breed": "Mix", "age_y": 2,
            "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
        }))
        user = _shop_user(c["id"])
        idem_key = f"{TAG}-{uuid.uuid4().hex}"
        try:
            with _stripe_mocked():
                first = run(server.create_shop_checkout(
                    server.ShopCheckoutIn(
                        items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog_a["id"])],
                        idempotency_key=idem_key,
                    ),
                    user,
                ))
                order_id = first["order_id"]
                original_order = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
                assert original_order["lines"][0]["dog_id"] == dog_a["id"]

                # Attacker/stale-client retries the SAME idempotency key but
                # swaps in a different dog — must be rejected, not silently
                # retarget the already-created order.
                try:
                    run(server.create_shop_checkout(
                        server.ShopCheckoutIn(
                            items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog_b_id)],
                            idempotency_key=idem_key,
                        ),
                        user,
                    ))
                    assert False, "expected HTTPException for a tampered retry under the same idempotency key"
                except server.HTTPException as exc:
                    assert exc.status_code == 409

            # The original order's frozen line is untouched.
            unchanged = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
            assert unchanged["lines"][0]["dog_id"] == dog_a["id"]
            # No second order was created for dog_b.
            assert run(server.db.shop_orders.count_documents({"client_id": c["id"]})) == 1
        finally:
            run(server.db.dogs.delete_one({"id": dog_b_id}))
            _cleanup_shop_order_traces(c["id"])
            _cleanup_dog_programs_and_lots(dog_a["id"], c["id"])


def test_fulfillment_reads_only_the_frozen_order_line_never_a_client_body():
    """_apply_shop_payment (and the online_school fulfillment it dispatches
    to) takes no client-supplied dog_id/program_id at all — its only
    inputs are the already-persisted `attempt` and the Stripe-authoritative
    `session_obj`. Prove the granted enrollment matches the dog frozen on
    the order at CHECKOUT time, confirming there is no later point where a
    client request could redirect which dog/program gets fulfilled."""
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"]),
            ])
            line = order["lines"][0]
            assert line["dog_id"] == dog["id"]
            enr_id = line["online_school_enrollment_id"]
            raw = run(server.db.dog_programs.find_one({"id": enr_id}))
            assert raw["dog_id"] == dog["id"]
            assert raw["program_id"] == prog["id"]
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
            _cleanup_shop_order_traces(c["id"])


# ---------------------------------------------------------------------------
# Item 4 — paid-but-unfulfilled recovery, proven operationally through the
# EXISTING reconciliation action (POST /admin/shop-orders/{id}/fulfillment,
# action="retry_fulfillment" → update_shop_order_fulfillment →
# _apply_shop_payment(attempt) with no session_obj). For an order already
# marked "paid", Step A (the only place Stripe is ever contacted) is
# skipped entirely — proven below by making a real Stripe call raise if
# attempted during retry. No new architecture was added for this — the
# ONE new line of defense is _self_heal_missing_school_enrollment (see
# _grant_online_school_enrollment), which closes a genuine gap: the
# existing convergence path used to report success without ever creating
# the school_enrollments companion, so GET /portal/school would silently
# never show a course the client was actually charged for.
# ---------------------------------------------------------------------------

_ADMIN_STAFF = {"id": "test-staff", "name": "QA Staff", "email": "staff@test", "role": "admin"}


@contextlib.contextmanager
def _stripe_retrieve_forbidden():
    """Proves a retry never re-contacts Stripe — not "probably doesn't",
    but a hard failure if it tries."""
    orig = server.stripe.checkout.Session.retrieve
    def _forbidden(*a, **kw):
        raise AssertionError("retry_fulfillment must never call Stripe — the order is already paid")
    server.stripe.checkout.Session.retrieve = _forbidden
    try:
        yield
    finally:
        server.stripe.checkout.Session.retrieve = orig


def test_recovery_point_a_failure_before_any_enrollment_row_exists():
    """Interruption point 1: fulfillment fails before dog_programs is even
    created (simulated realistically — the program lookup inside
    _fulfill_shop_online_school_program_line fails, exactly as it would on
    a transient error). Prove: the paid-but-unfulfilled state is durable
    and discoverable (order.fulfillment_status == "needs_attention", line
    "failed"), then the EXISTING retry action converges to exactly one
    enrollment without ever touching Stripe again."""
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            with _stripe_mocked():
                result = run(server.create_shop_checkout(
                    server.ShopCheckoutIn(
                        items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"])],
                        idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                    ),
                    user,
                ))
            order_id = result["order_id"]
            order = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
            attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order_id}, {"_id": 0}))
            session_obj = _FakeStripeObj(
                id=attempt["stripe_checkout_session_id"], payment_status="paid", currency="usd",
                amount_total=server._stripe_amount_cents(order["total"]),
                metadata={"sithappens_shop_order_id": order_id, "sithappens_attempt_id": attempt["id"]},
            )

            # Simulate a transient failure DURING fulfillment (before any
            # dog_programs row is created) by temporarily hiding the
            # program the line's fulfillment needs to look up.
            saved_program = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0}))
            run(server.db.programs.delete_one({"id": prog["id"]}))
            run(server._apply_shop_payment(attempt, session_obj))
            run(server.db.programs.insert_one(saved_program))  # restore before retry

            paid_order = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
            assert paid_order["status"] == "paid"  # payment IS authoritative and succeeded
            assert paid_order["fulfillment_status"] == "needs_attention"  # durable, discoverable state
            assert paid_order["lines"][0]["fulfillment_status"] == "failed"
            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 0

            # Discoverable via the existing Front Desk "Online Orders" surface.
            needing_attention = run(server.list_shop_orders(fulfillment_status="needs_attention", user=_ADMIN_STAFF))
            assert order_id in {o["id"] for o in needing_attention["orders"]}

            # Staff clicks "Retry Fulfillment" — the existing reconciliation
            # action. Must not re-contact Stripe.
            with _stripe_retrieve_forbidden():
                recovered = run(server.update_shop_order_fulfillment(
                    order_id, server.ShopOrderFulfillmentActionIn(action="retry_fulfillment"), _ADMIN_STAFF,
                ))
            assert recovered["fulfillment_status"] == "fulfilled"
            assert recovered["lines"][0]["fulfillment_status"] == "fulfilled"
            assert recovered["lines"][0]["online_school_enrollment_id"]

            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
            assert run(server.db.school_enrollments.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
            # And the payment itself was recorded exactly once — retry never re-charges.
            assert run(server.db.payments.count_documents({"shop_order_id": order_id})) == 1
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
            _cleanup_shop_order_traces(c["id"])


def test_recovery_point_b_dog_programs_exists_but_companion_missing():
    """Interruption point 2: the exact residual-risk window the Phase 1
    audit disclosed (a crash between the two _grant_online_school_enrollment
    inserts) — dog_programs exists, school_enrollments does not. Prove the
    retry SELF-HEALS the missing companion (the _self_heal fix), converges
    to exactly one of each, never re-charges, and the course becomes
    visible to the client immediately after."""
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"]),
            ])
            order_id = order["id"]
            enr_id = order["lines"][0]["online_school_enrollment_id"]
            assert run(server.db.school_enrollments.count_documents({"enrollment_id": enr_id})) == 1

            # Simulate the crash: companion vanishes, and (realistically)
            # the line never got marked fulfilled either.
            run(server.db.school_enrollments.delete_many({"enrollment_id": enr_id}))
            run(server.db.shop_orders.update_one(
                {"id": order_id, "lines.item_id": order["lines"][0]["item_id"]},
                {"$set": {"lines.$.fulfillment_status": "failed", "lines.$.online_school_enrollment_id": None,
                          "fulfillment_status": "needs_attention"}},
            ))
            client_view_before = run(server.portal_school_list(_client_user(c["id"])))
            assert client_view_before == []  # not visible — companion missing

            with _stripe_retrieve_forbidden():
                recovered = run(server.update_shop_order_fulfillment(
                    order_id, server.ShopOrderFulfillmentActionIn(action="retry_fulfillment"), _ADMIN_STAFF,
                ))
            assert recovered["fulfillment_status"] == "fulfilled"
            assert recovered["lines"][0]["online_school_enrollment_id"] == enr_id  # same dog_programs row, not a new one

            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
            assert run(server.db.school_enrollments.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
            assert run(server.db.payments.count_documents({"shop_order_id": order_id})) == 1

            # portal_school_list is client_id-scoped via user["client_id"];
            # our _client_user helper mints a fresh unrelated client_id, so
            # rebuild it pointed at the real purchaser to check visibility.
            real_client_user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Client"}
            client_view_after = run(server.portal_school_list(real_client_user))
            assert len(client_view_after) == 1  # course is now visible — the healed gap
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
            _cleanup_shop_order_traces(c["id"])


def test_recovery_point_c_full_enrollment_exists_but_line_not_marked_fulfilled():
    """Interruption point 3: enrollment fully succeeded (both rows exist,
    correct and complete) but the shop order line's own fulfillment_status
    update never landed (crash after the enrollment call returned, before
    the final $set). This is the case the existing OnlineSchoolAlreadyEnrolledError
    convergence already handled correctly BEFORE this hardening pass —
    proven here with a test rather than new code, per the instruction not
    to add architecture where none is needed."""
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            order = _checkout_and_pay(user, [
                server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"]),
            ])
            order_id = order["id"]
            enr_id = order["lines"][0]["online_school_enrollment_id"]

            # Both rows are fully intact — only the order line's own status
            # regresses, simulating a crash after enrollment succeeded.
            run(server.db.shop_orders.update_one(
                {"id": order_id, "lines.item_id": order["lines"][0]["item_id"]},
                {"$set": {"lines.$.fulfillment_status": "failed", "lines.$.online_school_enrollment_id": None,
                          "fulfillment_status": "needs_attention"}},
            ))

            with _stripe_retrieve_forbidden():
                recovered = run(server.update_shop_order_fulfillment(
                    order_id, server.ShopOrderFulfillmentActionIn(action="retry_fulfillment"), _ADMIN_STAFF,
                ))
            assert recovered["fulfillment_status"] == "fulfilled"
            assert recovered["lines"][0]["online_school_enrollment_id"] == enr_id

            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
            assert run(server.db.school_enrollments.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
            assert run(server.db.payments.count_documents({"shop_order_id": order_id})) == 1
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
            _cleanup_shop_order_traces(c["id"])


# ---------------------------------------------------------------------------
# Item 1 — real payment→enrollment boundary, exercised through the ACTUAL
# production entry point (POST /webhooks/stripe) with a genuinely
# HMAC-signed event (signed with the real STRIPE_WEBHOOK_SECRET, exactly as
# stripe.Webhook.construct_event verifies it) — not a direct internal call.
# This is the automated regression companion to the one-time manual proof
# performed live against real Stripe test mode (see the Phase 5H report):
#   real client checkout → real Stripe Checkout Session (sk_test_...) →
#   real hosted-UI payment with card 4242 4242 4242 4242 → Stripe API
#   confirmed payment_status="paid" → a genuinely HMAC-signed
#   checkout.session.completed event POSTed to this exact endpoint →
#   _verify_shop_stripe_session_authoritative → _apply_shop_payment →
#   exactly one dog_programs + one school_enrollments row →
#   GET /portal/school showed the course immediately. Browser verification
#   covered everything through "Stripe confirms payment_status=paid";
#   from the signed webhook call onward is API/integration verification
#   (this test), since Stripe cannot reach a non-public local test server.
# ---------------------------------------------------------------------------

def _sign_stripe_webhook_body(body: bytes, secret: str) -> str:
    timestamp = str(int(time.time()))
    signed_payload = f"{timestamp}.{body.decode('utf-8')}"
    signature = hmac.new(secret.encode("utf-8"), signed_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={signature}"


def test_real_signed_stripe_webhook_completes_online_school_purchase():
    assert server.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET must be configured for this test to mean anything"
    with _client_and_dog() as (c, dog), _school_program(purchase_fulfillment="online_school", available_online=True) as (prog, admin):
        user = _shop_user(c["id"])
        try:
            with _stripe_mocked():
                result = run(server.create_shop_checkout(
                    server.ShopCheckoutIn(
                        items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dog["id"])],
                        idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
                    ),
                    user,
                ))
            order_id = result["order_id"]
            order = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
            attempt = run(server.db.shop_payment_attempts.find_one({"shop_order_id": order_id}, {"_id": 0}))

            # A session object shaped exactly like what stripe.Webhook.construct_event
            # would hand the app after verifying a REAL Stripe signature —
            # the webhook endpoint never calls Session.retrieve() itself, it
            # trusts the event body once the signature is verified, so this
            # is the authoritative boundary this test actually exercises.
            session_obj = {
                "id": attempt["stripe_checkout_session_id"], "object": "checkout.session",
                "payment_status": "paid", "currency": "usd",
                "amount_total": server._stripe_amount_cents(order["total"]),
                "payment_intent": f"pi_test_{uuid.uuid4().hex[:16]}",
                "metadata": {"sithappens_shop_order_id": order_id, "sithappens_attempt_id": attempt["id"]},
            }
            event_payload = {
                "id": f"evt_test_{uuid.uuid4().hex[:16]}", "object": "event",
                "type": "checkout.session.completed", "api_version": "2023-10-16",
                "created": int(time.time()), "data": {"object": session_obj}, "livemode": False,
            }
            body = json.dumps(event_payload).encode("utf-8")
            sig_header = _sign_stripe_webhook_body(body, server.STRIPE_WEBHOOK_SECRET)

            async def _post_webhook():
                transport = httpx.ASGITransport(app=server.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
                    return await http.post("/api/webhooks/stripe", content=body, headers={
                        "Content-Type": "application/json", "Stripe-Signature": sig_header,
                    })
            resp = run(_post_webhook())
            assert resp.status_code == 200, resp.text
            assert resp.json() == {"ok": True}

            paid_order = run(server.db.shop_orders.find_one({"id": order_id}, {"_id": 0}))
            assert paid_order["status"] == "paid"
            assert paid_order["fulfillment_status"] == "fulfilled"
            enr_id = paid_order["lines"][0]["online_school_enrollment_id"]
            assert enr_id

            assert run(server.db.dog_programs.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1
            assert run(server.db.school_enrollments.count_documents({"dog_id": dog["id"], "program_id": prog["id"]})) == 1

            visible = run(server.portal_school_list({"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Client"}))
            assert len(visible) == 1
            assert visible[0]["dog_id"] == dog["id"]
            assert visible[0]["status"] == "active"

            # A signature computed with the WRONG secret must be rejected —
            # proves the endpoint is actually verifying, not just trusting.
            bad_sig = _sign_stripe_webhook_body(body, "whsec_wrong_secret_entirely")

            async def _post_bad_webhook():
                transport = httpx.ASGITransport(app=server.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
                    return await http.post("/api/webhooks/stripe", content=body, headers={
                        "Content-Type": "application/json", "Stripe-Signature": bad_sig,
                    })
            bad_resp = run(_post_bad_webhook())
            assert bad_resp.status_code == 400
        finally:
            _cleanup_dog_programs_and_lots(dog["id"], c["id"])
            _cleanup_shop_order_traces(c["id"])
