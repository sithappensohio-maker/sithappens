"""Free Online School course claim — backend coverage.

Same self-contained harness convention as test_online_school_phase5.py: the
endpoint functions are called directly, so Depends() gates don't run — every
check here lives in the function body, which is where the free-claim rules
are enforced.

The invariant this suite exists to protect: a free claim grants a REAL
canonical Online School enrollment and moves NO money. Not a $0 sale, not a
$0 order, not a Stripe object — nothing. And it must never become a way to
claim a program that merely happens to sit at $0.
"""
import asyncio
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_FREE_CLAIM"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": f"{TAG} client user"}


@contextlib.contextmanager
def _client_and_dog(n_dogs=1, age_y=3):
    admin = _admin_user()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    dogs = []
    for i in range(n_dogs):
        did = str(uuid.uuid4())
        dog = {
            "id": did, "name": f"{TAG} Dog {i + 1}", "owner_id": c["id"], "breed": "Mix", "age_y": age_y,
            "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
        }
        run(server.db.dogs.insert_one(dog))
        dogs.append(dog)
    try:
        yield c, dogs
    finally:
        for d in dogs:
            run(server.db.dog_programs.delete_many({"dog_id": d["id"]}))
            run(server.db.school_enrollments.delete_many({"dog_id": d["id"]}))
            run(server.db.homework.delete_many({"dog_id": d["id"]}))
            run(server.db.dogs.delete_one({"id": d["id"]}))
        run(server.db.clients.delete_one({"id": c["id"]}))


@contextlib.contextmanager
def _program(**overrides):
    """A real self-guided Online School program with one module and one
    lesson — enough for the canonical enrollment creator to accept it."""
    admin = _admin_user()
    # An explicit slug: update_program below rewrites the doc from the model,
    # and ProgramIn.slug defaults to "" — which would blank the auto-generated
    # slug that prerequisite matching keys on.
    kw = dict(
        name=f"{TAG} Program {uuid.uuid4().hex[:6]}", slug=f"{TAG.lower()}-{uuid.uuid4().hex[:8]}", type="custom",
        format={"count": 1, "unit": "modules"}, price=0.0,
        delivery_mode="self_guided", purchase_fulfillment="online_school",
        available_online=True, publicly_visible=True, free_enrollment_enabled=True,
        modules=[server.ModuleIn(name="Module 1", order=0, goals=[server.GoalIn(name="Skill 1")])],
    )
    kw.update(overrides)
    prog = run(server.create_program(server.ProgramIn(**kw), admin))
    m = prog["modules"][0]
    fixed = dict(kw)
    fixed["modules"] = [server.ModuleIn(
        id=m["id"], name=m["name"], order=m["order"],
        goals=[server.GoalIn(**g) for g in m["goals"]],
        lessons=[server.LessonIn(
            name="Lesson 1", order=0, active=True, skill_ids=[m["goals"][0]["id"]],
            client_overview="overview", why_it_matters="matters", success_criteria="criteria",
        )],
    )]
    prog = run(server.update_program(prog["id"], server.ProgramIn(**fixed), cascade=False, save_as_draft=False, _=admin))
    try:
        yield prog
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def _claim(user, program_id, dog_id):
    return run(server.claim_free_program(
        server.FreeCourseClaimIn(program_id=program_id, dog_id=dog_id), user,
    ))


def _money_snapshot(client_id, dog_id):
    """Every money-shaped collection a claim must leave untouched."""
    counts = {}
    for coll, q in (
        ("shop_orders", {"client_id": client_id}),
        ("shop_payment_attempts", {"client_id": client_id}),
        ("shop_checkout_claims", {"client_id": client_id}),
        ("payments", {"client_id": client_id}),
        ("payment_ledger", {"client_id": client_id}),
        ("invoices", {"client_id": client_id}),
        ("retail_sales", {"client_id": client_id}),
        ("pos_sales", {"client_id": client_id}),
        ("pos_orders", {"client_id": client_id}),
        ("credit_lots", {"client_id": client_id}),
        ("stripe_payment_attempts", {"client_id": client_id}),
        ("booking_financial_events", {"client_id": client_id}),
        ("sales_tax_filings", {}),
        ("stripe_balance_transactions", {}),
        ("stripe_payouts", {}),
        ("till_adjustments", {}),
        ("cash_drawer_sessions", {}),
        ("credit_adjustments", {"client_id": client_id}),
    ):
        if coll in run(server.db.list_collection_names()):
            counts[coll] = run(server.db[coll].count_documents(q))
    return counts


# ---------------------------------------------------------------------------
# 1-5 — what may and may not be claimed
# ---------------------------------------------------------------------------

def test_eligible_free_program_can_be_claimed():
    with _client_and_dog() as (c, dogs), _program() as prog:
        res = _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        assert res["created"] is True
        assert res["school_enrollment_id"]
        assert res["program_id"] == prog["id"]
        assert res["dog_id"] == dogs[0]["id"]


def test_zero_price_program_without_the_explicit_flag_cannot_be_claimed():
    # THE central rule. An imported draft or a not-yet-priced program sits at
    # $0 too; free must be a deliberate configuration, never an inference.
    with _client_and_dog() as (c, dogs), _program(free_enrollment_enabled=False) as prog:
        assert float(prog["price"]) == 0.0
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        assert e.value.status_code == 409
        assert "free course" in str(e.value.detail).lower()
        assert run(server.db.dog_programs.count_documents({"dog_id": dogs[0]["id"]})) == 0


def test_paid_program_cannot_use_the_free_claim_endpoint():
    # Even with the flag mistakenly left on, a price makes it unclaimable.
    with _client_and_dog() as (c, dogs), _program(price=149.0, free_enrollment_enabled=True) as prog:
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        assert e.value.status_code == 409
        assert "isn't free" in str(e.value.detail)


def test_inactive_program_is_rejected():
    with _client_and_dog() as (c, dogs), _program(active=False) as prog:
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        assert e.value.status_code == 409


def test_wrong_fulfillment_or_delivery_mode_is_rejected():
    with _client_and_dog() as (c, dogs):
        with _program(purchase_fulfillment="credits_only") as prog:
            with pytest.raises(server.HTTPException) as e:
                _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
            assert e.value.status_code == 409
            assert "Online School" in str(e.value.detail)
        # delivery_mode=trainer_led is refused by create_program for
        # online_school fulfillment, which is itself the guarantee: the two
        # can never be configured into an inconsistent pair.
        with pytest.raises(server.HTTPException) as e2:
            with _program(delivery_mode="trainer_led"):
                pass
        assert e2.value.status_code == 422


def test_a_program_not_available_online_is_rejected():
    with _client_and_dog() as (c, dogs), _program(available_online=False) as prog:
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        assert e.value.status_code == 409


# ---------------------------------------------------------------------------
# 6-10 — ownership and the preserved eligibility rules
# ---------------------------------------------------------------------------

def test_a_client_can_only_claim_for_their_own_dog():
    with _client_and_dog() as (c1, dogs1), _client_and_dog() as (c2, dogs2), _program() as prog:
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c1["id"]), prog["id"], dogs2[0]["id"])
        assert e.value.status_code == 404
        assert run(server.db.dog_programs.count_documents({"dog_id": dogs2[0]["id"]})) == 0


def test_nonexistent_dog_is_rejected_with_the_same_message():
    # Identical wording for missing and not-yours, so a client cannot probe
    # for other people's dog ids.
    with _client_and_dog() as (c, dogs), _program() as prog:
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c["id"]), prog["id"], str(uuid.uuid4()))
        assert e.value.status_code == 404
        assert "not found on this account" in str(e.value.detail)


def test_a_dog_is_required_and_never_manufactured():
    with _client_and_dog() as (c, dogs), _program() as prog:
        with pytest.raises(server.HTTPException) as e:
            run(server.claim_free_program(
                server.FreeCourseClaimIn(program_id=prog["id"], dog_id=None), _client_user(c["id"]),
            ))
        assert e.value.status_code == 422
        assert e.value.detail["code"] == "free_course_dog_required"
        assert run(server.db.dogs.count_documents({"owner_id": c["id"]})) == 1


def test_prerequisite_rules_are_preserved():
    # The claim path reuses the canonical purchase gate, so a program with an
    # unmet prerequisite stays unclaimable for free exactly as it is unbuyable.
    with _client_and_dog() as (c, dogs), _program() as prereq, _program(prereq_slugs=[]) as prog:
        run(server.db.programs.update_one({"id": prog["id"]}, {"$set": {"prereq_slugs": [prereq["slug"]]}}))
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        assert e.value.status_code == 422
        assert e.value.detail["code"] == "school_prerequisites_incomplete"


def test_approval_requirement_is_preserved():
    with _client_and_dog() as (c, dogs), _program(requires_approval=True) as prog:
        with pytest.raises(server.HTTPException) as e:
            _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        assert e.value.status_code == 422
        assert "approval" in str(e.value.detail).lower()


def test_completed_onboarding_requirement_is_preserved():
    with _client_and_dog() as (c, dogs), _program(requires_completed_onboarding=True) as prog:
        # The gate consults the client's real setup status; whichever way it
        # resolves, the claim must go through the SAME check a purchase does.
        status = run(server._compute_setup_status_for_client(
            run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0}))))
        if status.get("booking_locked"):
            with pytest.raises(server.HTTPException) as e:
                _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
            assert e.value.status_code == 422
        else:
            assert _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])["created"] is True


def test_a_program_hidden_from_the_storefront_section_is_rejected():
    # Section visibility is part of the canonical gate; a free course pulled
    # from the storefront stops being claimable with it.
    with _client_and_dog() as (c, dogs), _program() as prog:
        settings = run(server.get_settings())
        sp = dict(settings.get("shop_page") or {})
        sections = dict(sp.get("sections") or {})
        section = server._PUBLIC_SECTION_FOR_KIND["training_program"]
        original = sections.get(section)
        sections[section] = {**(original or {}), "visible": False}
        sp["sections"] = sections
        run(server.db.settings.update_one({}, {"$set": {"shop_page": sp}}, upsert=True))
        try:
            with pytest.raises(server.HTTPException) as e:
                _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
            assert e.value.status_code == 409
        finally:
            if original is None:
                sections.pop(section, None)
            else:
                sections[section] = original
            sp["sections"] = sections
            run(server.db.settings.update_one({}, {"$set": {"shop_page": sp}}, upsert=True))


# ---------------------------------------------------------------------------
# 11-13 — exactly one canonical enrollment, in the right shape
# ---------------------------------------------------------------------------

def test_claim_creates_exactly_one_canonical_progress_ledger_and_companion():
    with _client_and_dog() as (c, dogs), _program() as prog:
        res = _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        dps = run(server.db.dog_programs.find({"dog_id": dogs[0]["id"], "program_id": prog["id"]}, {"_id": 0}).to_list(10))
        ses = run(server.db.school_enrollments.find({"dog_id": dogs[0]["id"], "program_id": prog["id"]}, {"_id": 0}).to_list(10))
        assert len(dps) == 1, "exactly one progress ledger"
        assert len(ses) == 1, "exactly one School enrollment companion"
        assert ses[0]["id"] == res["school_enrollment_id"]
        assert ses[0]["enrollment_id"] == dps[0]["id"], "companion points at the ledger"


def test_the_enrollment_is_a_normal_online_school_self_guided_one():
    with _client_and_dog() as (c, dogs), _program() as prog:
        _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        dp = run(server.db.dog_programs.find_one({"dog_id": dogs[0]["id"]}, {"_id": 0}))
        se = run(server.db.school_enrollments.find_one({"dog_id": dogs[0]["id"]}, {"_id": 0}))
        assert dp["delivery_channel"] == "online_school"
        assert dp["status"] == "active"
        assert se["delivery_mode"] == "self_guided"
        assert se["status"] == "active"
        assert se["access_state"] == "active"
        # The same structures a paid enrollment gets — not a free-only model.
        assert dp.get("program_snapshot"), "carries the program snapshot"
        assert "goal_progress" in dp
        assert dp.get("current_lesson_id") or dp.get("current_module_id")


def test_the_enrollment_records_its_free_self_service_origin():
    with _client_and_dog() as (c, dogs), _program() as prog:
        _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        dp = run(server.db.dog_programs.find_one({"dog_id": dogs[0]["id"]}, {"_id": 0}))
        assert dp.get("enrollment_source") == "free_claim"
        assert str(dp.get("enrollment_source_ref") or "").startswith("free_claim:client:")


def test_a_free_enrollment_is_shaped_exactly_like_a_manual_one():
    # Free changes how entitlement is obtained, not what School then is.
    with _client_and_dog(n_dogs=2) as (c, dogs), _program() as prog:
        _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        run(server.school_enroll(server.SchoolEnrollIn(
            dog_id=dogs[1]["id"], program_id=prog["id"], delivery_mode="online",
        ), _admin_user()))
        free_dp = run(server.db.dog_programs.find_one({"dog_id": dogs[0]["id"]}, {"_id": 0}))
        manual_dp = run(server.db.dog_programs.find_one({"dog_id": dogs[1]["id"]}, {"_id": 0}))
        ignore = {"id", "dog_id", "created_at", "updated_at", "enrolled_at", "started_at",
                  "enrollment_source", "enrollment_source_ref", "enrolled_by", "dog_name"}
        assert set(free_dp) - ignore == set(manual_dp) - ignore, "identical field shape"


# ---------------------------------------------------------------------------
# 14-15 — idempotency and concurrency
# ---------------------------------------------------------------------------

def test_repeated_claims_converge_on_the_existing_enrollment():
    with _client_and_dog() as (c, dogs), _program() as prog:
        user = _client_user(c["id"])
        first = _claim(user, prog["id"], dogs[0]["id"])
        second = _claim(user, prog["id"], dogs[0]["id"])
        third = _claim(user, prog["id"], dogs[0]["id"])
        assert first["created"] is True
        assert second["created"] is False and third["created"] is False
        assert second["school_enrollment_id"] == first["school_enrollment_id"]
        assert third["school_enrollment_id"] == first["school_enrollment_id"]
        assert run(server.db.dog_programs.count_documents({"dog_id": dogs[0]["id"]})) == 1
        assert run(server.db.school_enrollments.count_documents({"dog_id": dogs[0]["id"]})) == 1


def test_concurrent_claims_cannot_duplicate_the_enrollment():
    # The real enforcement is the dp_online_active_unique partial index inside
    # the canonical creator, so genuine simultaneity converges too.
    with _client_and_dog() as (c, dogs), _program() as prog:
        user = _client_user(c["id"])

        async def _both():
            return await asyncio.gather(
                server.claim_free_program(server.FreeCourseClaimIn(program_id=prog["id"], dog_id=dogs[0]["id"]), user),
                server.claim_free_program(server.FreeCourseClaimIn(program_id=prog["id"], dog_id=dogs[0]["id"]), user),
                return_exceptions=True,
            )

        results = run(_both())
        ok = [r for r in results if isinstance(r, dict)]
        assert ok, f"at least one claim must succeed, got {results}"
        assert run(server.db.dog_programs.count_documents(
            {"dog_id": dogs[0]["id"], "program_id": prog["id"], "status": "active"})) == 1
        assert run(server.db.school_enrollments.count_documents(
            {"dog_id": dogs[0]["id"], "program_id": prog["id"]})) == 1
        ids = {r["school_enrollment_id"] for r in ok}
        assert len(ids) == 1, "both callers converge on the same enrollment"


def test_a_second_dog_gets_its_own_separate_enrollment():
    with _client_and_dog(n_dogs=2) as (c, dogs), _program() as prog:
        user = _client_user(c["id"])
        a = _claim(user, prog["id"], dogs[0]["id"])
        b = _claim(user, prog["id"], dogs[1]["id"])
        assert a["school_enrollment_id"] != b["school_enrollment_id"]
        assert run(server.db.dog_programs.count_documents({"program_id": prog["id"]})) == 2


# ---------------------------------------------------------------------------
# 16-17 — the money invariants and the untouched paid path
# ---------------------------------------------------------------------------

def test_claiming_a_free_course_creates_no_financial_record_of_any_kind():
    with _client_and_dog() as (c, dogs), _program() as prog:
        before = _money_snapshot(c["id"], dogs[0]["id"])
        _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
        after = _money_snapshot(c["id"], dogs[0]["id"])
        assert before == after, f"money systems changed: { {k: (before[k], after[k]) for k in before if before[k] != after[k]} }"


def test_the_claim_path_never_touches_stripe():
    called = []
    orig_session = server.stripe.checkout.Session.create
    orig_intent = getattr(server.stripe.PaymentIntent, "create", None)
    server.stripe.checkout.Session.create = lambda **kw: called.append("session")
    if orig_intent:
        server.stripe.PaymentIntent.create = lambda **kw: called.append("intent")
    try:
        with _client_and_dog() as (c, dogs), _program() as prog:
            _claim(_client_user(c["id"]), prog["id"], dogs[0]["id"])
    finally:
        server.stripe.checkout.Session.create = orig_session
        if orig_intent:
            server.stripe.PaymentIntent.create = orig_intent
    assert called == [], f"Stripe was called: {called}"


def test_the_zero_dollar_cart_guard_is_still_in_place():
    # The free path is a different door, not a hole in the checkout guard.
    src = server.__file__
    with open(src, encoding="utf-8") as fh:
        code = fh.read()
    assert 'detail="Cart total must be greater than zero."' in code
    assert 'if priced["total"] <= 0.005:' in code


def test_a_free_program_is_still_rejected_by_normal_checkout():
    # Because its cart total is $0 — proving the two paths stay separate and
    # the free course never sneaks a $0 order into commerce.
    with _client_and_dog() as (c, dogs), _program() as prog:
        user = _client_user(c["id"])
        with pytest.raises(server.HTTPException) as e:
            run(server.create_shop_checkout(server.ShopCheckoutIn(
                items=[server.ShopCartItemIn(kind="training_program", ref_id=prog["id"], quantity=1, dog_id=dogs[0]["id"])],
                idempotency_key=f"{TAG}-{uuid.uuid4().hex}",
            ), user))
        assert e.value.status_code in (400, 503)
        if e.value.status_code == 400:
            assert "greater than zero" in str(e.value.detail)
        run(server.db.shop_checkout_claims.delete_many({"client_id": c["id"]}))


def test_paid_program_eligibility_is_unchanged_by_the_new_field():
    # A normal paid Online School program still validates exactly as before.
    with _client_and_dog() as (c, dogs), _program(price=199.0, free_enrollment_enabled=False) as prog:
        client = run(server.db.clients.find_one({"id": c["id"]}, {"_id": 0}))
        run(server._validate_shop_item_eligibility(client, "training_program", prog, 1, dog_id=dogs[0]["id"]))
        assert prog.get("free_enrollment_enabled") is False


# ---------------------------------------------------------------------------
# Storefront eligibility is computed, never merely stored
# ---------------------------------------------------------------------------

def test_the_storefront_claim_flag_mirrors_the_server_gate():
    free = {"free_enrollment_enabled": True, "active": True, "price": 0,
            "purchase_fulfillment": "online_school", "delivery_mode": "self_guided"}
    assert server._public_purchase_state("training_program", free)["free_claim_available"] is True
    # a $0 program with no explicit opt-in is NOT claimable
    assert server._public_purchase_state("training_program", {**free, "free_enrollment_enabled": False})["free_claim_available"] is False
    # nor is a priced one, nor a credits-only one
    assert server._public_purchase_state("training_program", {**free, "price": 99})["free_claim_available"] is False
    assert server._public_purchase_state("training_program", {**free, "purchase_fulfillment": "credits_only"})["free_claim_available"] is False
    # and never for a non-program kind
    assert server._public_purchase_state("product", free)["free_claim_available"] is False
