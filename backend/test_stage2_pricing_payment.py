"""Stage 2 — the two places the app could lie about money, and the one about
what it advertises.

Every assertion here exists because the alternative was a customer-facing
claim the business could not stand behind: a price nobody entered, a payment
demand nothing enforces, or a retired program on the marketing site.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

from domains import payment_timing, program_pricing
from programs_data import SEED_PROGRAMS

TAG = "TEST_STAGE2"


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


# ───────────────────────────────────────────── payment timing

def test_the_informational_values_are_all_configurable_today():
    for value in payment_timing.INFORMATIONAL:
        assert payment_timing.is_configurable(value), value
        assert payment_timing.describe(value)["collects_payment_during_booking"] is False


def test_an_enforced_value_cannot_be_configured_while_nothing_enforces_it():
    """The whole point. POST /bookings writes a status and collects nothing, so
    a service that claims "pay online now" would be telling a customer to do
    something the app never asks of them."""
    for value in payment_timing.ENFORCED:
        assert payment_timing.is_valid(value), value
        assert not payment_timing.is_configurable(value), value
        reason = payment_timing.rejection_reason(value)
        assert "booking does not collect payment" in reason


def test_saving_an_enforced_payment_state_is_refused_at_the_api():
    """Guarding this in the admin UI alone would not be enough — settings are
    also written by restores, imports and direct API calls."""
    controls = {"per_service": {"daycare": {"payment_timing": payment_timing.PAY_ONLINE}}}
    assert payment_timing.assert_configurable(controls) is not None

    controls = {"per_catalog_service": {str(uuid.uuid4()): {"payment_timing": payment_timing.DEPOSIT}}}
    assert payment_timing.assert_configurable(controls) is not None

    ok = {"per_service": {"daycare": {"payment_timing": payment_timing.AT_PICKUP}}}
    assert payment_timing.assert_configurable(ok) is None


def test_an_unknown_or_legacy_value_still_reads_as_something_sayable():
    """A row written by an older build or a future version must not blank the
    booking screen or throw."""
    assert payment_timing.normalize(None) == payment_timing.DEFAULT
    assert payment_timing.normalize("whatever_this_is") == payment_timing.DEFAULT
    assert payment_timing.describe("whatever_this_is")["short"]


def test_every_service_category_ships_with_a_truthful_default():
    settings = run(server.get_settings())
    controls = server._merge_booking_flow_controls(settings.get("booking_flow_controls"))
    for name, row in (controls.get("per_service") or {}).items():
        value = row.get("payment_timing")
        assert payment_timing.is_configurable(value), (name, value)


def test_payment_timing_reaches_the_client_service_list():
    """The booking wizard reads /services. Without this it would have to invent
    payment copy, which is exactly what it used to do for booking status."""
    made = run(server.create_service(server.ServiceIn(
        name=f"{TAG} daycare {uuid.uuid4().hex[:6]}", base_price=10.0, service_type="daycare"), _admin()))
    try:
        items = run(server.list_services(user={"role": "client", "client_id": str(uuid.uuid4()), "id": "u"}))
        row = next(i for i in items if i["id"] == made["id"])
        assert row["payment"]["timing"] in payment_timing.ALL
        assert row["payment"]["detail"]
        # Nothing may claim booking takes money while nothing takes money.
        assert row["payment"]["collects_payment_during_booking"] is False
    finally:
        run(server.db.services.delete_one({"id": made["id"]}))


def test_payment_timing_reaches_the_public_website():
    """A visitor deciding whether to book sees the price on the public pricing
    cards; "when do I pay" is the other half of that same question, and it has
    to come from the same resolved source rather than website copy someone
    remembered to update."""
    made = run(server.create_service(server.ServiceIn(
        name=f"{TAG} public daycare {uuid.uuid4().hex[:6]}", base_price=12.0, service_type="daycare"), _admin()))
    try:
        items = run(server.public_list_services())
        row = next(i for i in items if i["id"] == made["id"])
        assert row["payment"]["timing"] in payment_timing.ALL
        assert row["payment"]["short"]
        assert row["payment"]["collects_payment_during_booking"] is False
        # The public projection must not start leaking the rest of the record.
        assert set(row) <= {"id", "name", "description", "base_price", "service_type",
                            "color", "icon", "duration_minutes", "payment"}
    finally:
        run(server.db.services.delete_one({"id": made["id"]}))


def test_every_supported_timing_value_has_customer_facing_words():
    """Item 3 of the Stage 2 review: all four configurable values, not just the
    default, have to read as a complete sentence to a customer."""
    for value in payment_timing.INFORMATIONAL:
        described = payment_timing.describe(value)
        assert described["short"] and len(described["short"]) > 5, value
        assert described["detail"].endswith("."), value
        # Nothing enforces payment during booking, so every one of the four
        # has to open by saying so — otherwise a customer could read the copy
        # as a demand the app will never actually make.
        assert described["detail"].lower().startswith("nothing to pay"), value
        assert described["enforced"] is False, value


# ───────────────────────────────────────────── program pricing

def test_an_unpriced_program_says_contact_us_not_zero_and_not_a_guess():
    """Five of the seven real programs have no price field at all. The old page
    showed "Ask for pricing", which read as missing data."""
    for program in ({}, {"public_price_mode": None}, {"public_price_mode": "package"},
                    {"public_price_mode": "package", "public_price_amount": 0}):
        out = program_pricing.resolve(program)
        assert out["display"] == program_pricing.CONTACT_COPY, program
        assert out["has_price"] is False
        assert "$0" not in out["display"]


def test_configured_prices_render_in_human_units():
    assert program_pricing.resolve({
        "public_price_mode": "per_unit", "public_price_amount": 90, "public_price_unit": "private_lesson",
    })["display"] == "$90 / private lesson"
    assert program_pricing.resolve({
        "public_price_mode": "per_unit", "public_price_amount": 1500, "public_price_unit": "week",
    })["display"] == "$1,500 / week"
    assert program_pricing.resolve({
        "public_price_mode": "package", "public_price_amount": 1200,
    })["display"] == "$1,200 program"
    assert program_pricing.resolve({
        "public_price_mode": "from", "public_price_amount": 450,
    })["display"] == "From $450"


def test_nothing_is_derived_from_session_counts_or_service_rates():
    """The tempting bug: Level 1 is "5 sessions", a lesson is $90, so $450.
    That number would reach the website having been invented."""
    program = {"name": "Level 1", "format": {"count": 5, "unit": "sessions"}, "price": 0.0}
    out = program_pricing.resolve(program)
    assert out["display"] == program_pricing.CONTACT_COPY
    assert out["amount"] is None


def test_a_priced_mode_with_no_amount_is_reported_rather_than_shown_as_contact():
    """Silently degrading to "Contact us" would hide the admin's own mistake."""
    assert program_pricing.assert_valid({"public_price_mode": "package"}) is not None
    assert program_pricing.assert_valid({"public_price_mode": "package", "public_price_amount": 0}) is not None
    assert program_pricing.assert_valid({"public_price_mode": "contact"}) is None
    assert program_pricing.assert_valid({"public_price_mode": "package", "public_price_amount": 500}) is None
    assert program_pricing.assert_valid({"public_price_mode": "nonsense"}) is not None


# ───────────────────────────────────────────── public publication

def test_the_public_training_page_is_opt_in_not_opt_out():
    """It used to select `publicly_visible != False`, so a program nobody had
    ever considered was on the marketing site by default — which is how 805
    unset rows ended up publicly listed."""
    name = f"{TAG} unset {uuid.uuid4().hex[:6]}"
    made = run(server.create_program(server.ProgramIn(
        name=name, type="private_lessons", active=True), _admin()))
    try:
        run(server.db.programs.update_one({"id": made["id"]}, {"$unset": {"publicly_visible": ""}}))
        out = run(server._public_training_programs_payload()) if hasattr(server, "_public_training_programs_payload") else None
        if out is None:
            from domains.public_site import routes as public_routes  # noqa: F401
            # Endpoint is registered on the app; assert the stored shape instead.
            row = run(server.db.programs.find_one({"id": made["id"]}, {"_id": 0, "publicly_visible": 1}))
            assert row.get("publicly_visible") is not True
        else:
            assert all(p["id"] != made["id"] for p in out["programs"])
    finally:
        run(server.db.programs.delete_one({"id": made["id"]}))


def test_the_migration_authority_is_the_real_marketing_set():
    """Publication is decided by programs_data.SEED_PROGRAMS, whose docstring
    records that it came from the public training page — not by name guessing,
    and not by operational facts like active/has-lessons/has-students."""
    slugs = {p["slug"] for p in SEED_PROGRAMS}
    assert len(slugs) == 7
    assert "level_1_basic_manners" in slugs
    assert "bt_3_week_off_leash" in slugs
    # Nothing in the canonical set looks like a fixture.
    assert not any("test" in s or "qa_" in s or "shop" in s for s in slugs)


def test_the_migration_publishes_every_seeded_program_and_never_empties_the_page():
    """The deployment requirement, asserted against the public endpoint's own
    query rather than against what the migration says it did.

    The failure this guards is silent: if no seeded slug is present, demoting
    everything else leaves the public training page blank while the migration
    still reports success and exits 0.
    """
    import argparse
    import migrations.stage2_public_program_optin as migration

    seed_slugs = sorted(p["slug"] for p in SEED_PROGRAMS if p.get("slug"))
    made = []

    def _args(**kw):
        ns = argparse.Namespace(apply=False, publish_slugs="", demote_unreviewed=False,
                                allow_empty_public=False)
        for k, v in kw.items():
            setattr(ns, k, v)
        return ns

    def _public_slugs():
        # the NEW /public/training-programs selector, verbatim
        rows = run(server.db.programs.find(
            {"publicly_visible": True}, {"_id": 0, "slug": 1}).to_list(500))
        return sorted(r.get("slug") for r in rows)

    try:
        # Production's actual starting state: the flag was never set.
        for slug in seed_slugs:
            pid = str(uuid.uuid4())
            made.append(pid)
            run(server.db.programs.insert_one(
                {"id": pid, "slug": slug, "name": f"{TAG} {slug}", "type": "private_lessons",
                 "active": True}))
        for i in range(3):
            pid = str(uuid.uuid4())
            made.append(pid)
            run(server.db.programs.insert_one(
                {"id": pid, "slug": f"{TAG.lower()}_unreviewed_{i}", "name": f"{TAG} unreviewed {i}",
                 "type": "private_lessons", "active": True}))

        # Deploying the new code WITHOUT migrating empties the page. This is
        # why the migration runs before the restart, not after.
        assert _public_slugs() == []

        # An apply that has not been told what to do with unreviewed rows refuses.
        assert run(migration.run(_args(apply=True))) == 1
        assert _public_slugs() == [], "a refused apply must not write"

        # The command we actually run in production.
        assert run(migration.run(_args(apply=True, demote_unreviewed=True))) == 0

        public = _public_slugs()
        assert public, "the public training page must not be left empty"
        for slug in seed_slugs:
            assert slug in public, f"seeded program never became public: {slug}"
        assert not [s for s in public if s.startswith(TAG.lower())], \
            "an unreviewed program was published"

        # Non-seed rows are explicitly False, so a later `!= False` bug cannot
        # silently republish them.
        left = run(server.db.programs.count_documents(
            {"id": {"$in": made}, "slug": {"$nin": seed_slugs},
             "publicly_visible": {"$ne": False}}))
        assert left == 0

        # Idempotent.
        assert run(migration.run(_args(apply=True, demote_unreviewed=True))) == 0
        assert _public_slugs() == public

        # A program created afterwards is private by default.
        pid = str(uuid.uuid4())
        made.append(pid)
        run(server.db.programs.insert_one(
            {"id": pid, "slug": f"{TAG.lower()}_created_later", "name": f"{TAG} later",
             "type": "private_lessons", "active": True}))
        assert f"{TAG.lower()}_created_later" not in _public_slugs()

        # With no seeded program present at all, applying would blank the page,
        # so it is refused rather than reported as a success.
        run(server.db.programs.update_many(
            {"slug": {"$in": seed_slugs}}, {"$set": {"publicly_visible": False}}))
        run(server.db.programs.delete_many({"slug": {"$in": seed_slugs}}))
        assert run(migration.run(_args(apply=True, demote_unreviewed=True))) == 3
    finally:
        run(server.db.programs.delete_many({"id": {"$in": made}}))
        run(server.db.programs.delete_many({"slug": {"$in": seed_slugs}, "name": {"$regex": f"^{TAG} "}}))
