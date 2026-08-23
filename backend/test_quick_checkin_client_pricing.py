"""Quick Check-In walked existing clients past their own special pricing.

The workflow: Front Desk -> Quick Check-In / Walk-In, for an EXISTING client
who has Client-Specific Pricing. There is no prepaid booking; staff create and
check the dog in on arrival.

Quick Check-In picks the service for you. It picks the catalogue default for
the service type:

    activeBaseServices.find(s => s.service_type === wantedType && s.is_default)
      || activeBaseServices.find(s => s.service_type === wantedType)

but an individual client price is keyed to ONE exact service:

    price_overrides.target_kind = "service"
    price_overrides.target_code = services.id

So a client whose $20 rate sits on "Daycare A" gets auto-booked onto the
default "Daycare B" and rings at B's full $40. The resolver is not wrong -
there genuinely is no override for B - and checkout's refresh cannot repair
it either, because the booking now legitimately holds B's id. The wrong
service was chosen before pricing ever ran.

The fix is a service-IDENTITY fix, not a pricing formula: when exactly one
active service of the wanted type carries an individual override for this
client, Quick Check-In must select THAT service, and then the existing
resolve_client_price() machinery charges the right amount by itself. Two
matches must never be guessed between.

Fixtures reused from test_stale_price_snapshot_fix.py, which already models
this exact domain.
"""
import contextlib
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

from test_stale_price_snapshot_fix import (  # noqa: E402
    _admin_user, _client_and_dog, _service_override, _check_in,
)

TAG = "TEST_QUICK_CHECKIN_PRICE"


@contextlib.contextmanager
def _service(name, base_price, service_type="daycare", is_default=False):
    admin = _admin_user()
    svc = run(server.create_service(server.ServiceIn(
        name=f"{TAG} {name} {uuid.uuid4().hex[:6]}", service_type=service_type,
        base_price=base_price, active=True,
    ), admin))
    run(server.db.services.update_one({"id": svc["id"]}, {"$set": {"is_default": is_default}}))
    svc["is_default"] = is_default
    try:
        yield run(server.db.services.find_one({"id": svc["id"]}, {"_id": 0}))
    finally:
        run(server.db.services.delete_one({"id": svc["id"]}))


@contextlib.contextmanager
def _walkin(dog_id, service_id, when=None):
    """A Quick Check-In booking: created on arrival for the chosen service."""
    admin = _admin_user()
    booking = run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="daycare", service_id=service_id,
        date=when or date.today().isoformat(), override_capacity=True,
    ), admin))
    try:
        yield booking
    finally:
        run(server.db.bookings.delete_one({"id": booking["id"]}))


def _prices(client_id):
    """What the new endpoint hands Quick Check-In."""
    return run(server.client_service_prices(client_id, _admin_user()))["prices"]


# ---------------------------------------------------------------------------
# The reported production case
# ---------------------------------------------------------------------------

def test_the_walk_in_rings_at_full_price_when_the_default_is_the_wrong_service():
    """The bug, reproduced end to end.

    Daycare A $30 carries the client's $20 rate. Daycare B $40 is the
    catalogue default. Quick Check-In's old rule picks B, and every downstream
    number is then correctly-but-uselessly B's.
    """
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, \
             _service("Daycare B", 40.0, is_default=True) as svc_b:
            with _service_override(client["id"], svc_a["id"], 20.0):
                # what the OLD rule chose: the default for the type
                assert svc_b["is_default"] is True
                with _walkin(dog["id"], svc_b["id"]) as booking:
                    assert booking["service_id"] == svc_b["id"]
                    assert float(booking["estimated_price"]) == 40.0
                    _check_in(booking["id"])
                    preview = run(server.checkout_group_preview(booking["id"], _admin_user()))
                    assert float(preview["bookings"][0]["checkout_preview_total"]) == 40.0
                    # ...and the resolver is not at fault: there is no
                    # override for B, so standard is the correct answer.
                    r = run(server.resolve_client_price(client["id"], "service", svc_b["id"], 40.0))
                    assert r["pricing_source"] == "standard"
                    assert float(r["effective_price"]) == 40.0


def test_quick_check_in_selects_the_service_the_client_price_is_attached_to():
    """Requirement 1 — the fix. Exactly one active daycare service carries an
    individual override, so that is the service Quick Check-In must use."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, \
             _service("Daycare B", 40.0, is_default=True) as svc_b:
            with _service_override(client["id"], svc_a["id"], 20.0):
                prices = _prices(client["id"])
                matches = [sid for sid, p in prices.items()
                           if p["service_type"] == "daycare"
                           and p["pricing_source"] == "client_override"]
                assert matches == [svc_a["id"]], "the override service was not identified"
                assert float(prices[svc_a["id"]]["effective_price"]) == 20.0
                assert float(prices[svc_a["id"]]["list_price"]) == 30.0
                assert prices[svc_b["id"]]["pricing_source"] == "standard"


def test_the_selected_override_service_is_persisted_and_charged():
    """Requirements 5, 6, 7 — identity persists, and both money paths agree."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, \
             _service("Daycare B", 40.0, is_default=True) as svc_b:
            with _service_override(client["id"], svc_a["id"], 20.0):
                with _walkin(dog["id"], svc_a["id"]) as booking:
                    assert booking["service_id"] == svc_a["id"]                    # 5
                    assert (booking.get("pricing_snapshot") or {}).get("service_id") == svc_a["id"]
                    assert float(booking["estimated_price"]) == 20.0
                    _check_in(booking["id"], hours_ago=9)
                    preview = run(server.checkout_group_preview(booking["id"], _admin_user()))
                    assert float(preview["bookings"][0]["checkout_preview_total"]) == 20.0   # 6
                    run(server._check_out_locked(booking["id"], None, _admin_user()))
                    final = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
                    assert float(final["actual_price"]) == 20.0                              # 7
                    assert float(final["unit_price"]) == 20.0
                    assert final["price_override_id"] is not None
                    assert svc_b["id"] != svc_a["id"]


def test_no_override_leaves_the_default_service_alone():
    """Requirement 2 — a client with no special pricing is untouched."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0), _service("Daycare B", 40.0, is_default=True) as svc_b:
            prices = _prices(client["id"])
            assert not [sid for sid, p in prices.items()
                        if p["pricing_source"] == "client_override"]
            with _walkin(dog["id"], svc_b["id"]) as booking:
                assert float(booking["estimated_price"]) == 40.0


def test_an_override_for_a_different_service_type_is_ignored():
    """Requirement 3 — a boarding override must not steer a daycare check-in."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare B", 40.0, is_default=True) as svc_b, \
             _service("Boarding X", 60.0, service_type="boarding") as svc_board:
            with _service_override(client["id"], svc_board["id"], 45.0):
                prices = _prices(client["id"])
                daycare_matches = [sid for sid, p in prices.items()
                                   if p["service_type"] == "daycare"
                                   and p["pricing_source"] == "client_override"]
                assert daycare_matches == [], "a boarding override leaked into daycare"
                assert prices[svc_board["id"]]["pricing_source"] == "client_override"
                assert prices[svc_b["id"]]["pricing_source"] == "standard"


def test_two_matching_overrides_are_both_reported_so_nothing_is_guessed():
    """Requirement 4 — ambiguity is surfaced, never resolved by picking one."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, \
             _service("Daycare C", 35.0) as svc_c, \
             _service("Daycare B", 40.0, is_default=True):
            with _service_override(client["id"], svc_a["id"], 20.0), \
                 _service_override(client["id"], svc_c["id"], 22.0):
                prices = _prices(client["id"])
                matches = sorted(sid for sid, p in prices.items()
                                 if p["service_type"] == "daycare"
                                 and p["pricing_source"] == "client_override")
                assert matches == sorted([svc_a["id"], svc_c["id"]])
                # each carries its own price so the operator can choose on facts
                assert float(prices[svc_a["id"]]["effective_price"]) == 20.0
                assert float(prices[svc_c["id"]]["effective_price"]) == 22.0


def test_an_inactive_service_is_never_offered_as_the_override_match():
    """A revoked-from-the-catalogue service must not be auto-selected."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, _service("Daycare B", 40.0, is_default=True):
            with _service_override(client["id"], svc_a["id"], 20.0):
                run(server.db.services.update_one({"id": svc_a["id"]}, {"$set": {"active": False}}))
                prices = _prices(client["id"])
                assert svc_a["id"] not in prices, "an inactive service was offered for selection"


def test_pricing_tier_pricing_is_reported_but_never_steers_selection():
    """Requirement 10 — tier pricing applies to a service, but it is not an
    INDIVIDUAL override and must not change which service is chosen."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, _service("Daycare B", 40.0, is_default=True):
            tier_id = str(uuid.uuid4())
            run(server.db.pricing_tiers.insert_one(
                {"id": tier_id, "name": f"{TAG} Tier", "active": True}))
            run(server.db.pricing_tier_prices.insert_one(
                {"id": str(uuid.uuid4()), "tier_id": tier_id, "target_kind": "service",
                 "target_code": svc_a["id"], "override_price": 24.0}))
            run(server.db.clients.update_one({"id": client["id"]},
                                             {"$set": {"pricing_tier_id": tier_id}}))
            try:
                prices = _prices(client["id"])
                assert prices[svc_a["id"]]["pricing_source"] == "tier"
                assert float(prices[svc_a["id"]]["effective_price"]) == 24.0
                # tier is NOT an individual override -> no auto-selection
                assert [sid for sid, p in prices.items()
                        if p["pricing_source"] == "client_override"] == []
            finally:
                run(server.db.pricing_tiers.delete_one({"id": tier_id}))
                run(server.db.pricing_tier_prices.delete_many({"tier_id": tier_id}))
                run(server.db.clients.update_one({"id": client["id"]},
                                                 {"$unset": {"pricing_tier_id": ""}}))


def test_the_prices_endpoint_uses_the_canonical_resolver_not_a_second_formula():
    """Server authority — every number it reports must equal
    resolve_client_price()'s own answer for that service."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, _service("Daycare B", 40.0, is_default=True) as svc_b:
            with _service_override(client["id"], svc_a["id"], 20.0):
                prices = _prices(client["id"])
                for svc in (svc_a, svc_b):
                    canonical = run(server.resolve_client_price(
                        client["id"], "service", svc["id"], float(svc["base_price"])))
                    row = prices[svc["id"]]
                    assert float(row["effective_price"]) == float(canonical["effective_price"])
                    assert row["pricing_source"] == canonical["pricing_source"]
                    assert row["override_id"] == canonical["override_id"]


def test_a_revoked_override_stops_steering_selection():
    """Requirement F-shaped guard: an inactive override must not select a
    service, and must not quote its old price."""
    with _client_and_dog() as (client, dog):
        with _service("Daycare A", 30.0) as svc_a, _service("Daycare B", 40.0, is_default=True):
            with _service_override(client["id"], svc_a["id"], 20.0) as ovr:
                run(server.db.price_overrides.update_one(
                    {"id": ovr["id"]}, {"$set": {"status": "revoked",
                                                 "revoked_at": server.now_iso()}}))
                prices = _prices(client["id"])
                assert prices[svc_a["id"]]["pricing_source"] == "standard"
                assert float(prices[svc_a["id"]]["effective_price"]) == 30.0
                assert [sid for sid, p in prices.items()
                        if p["pricing_source"] == "client_override"] == []


def test_recreated_override_after_revoke_wins_over_retained_history_everywhere():
    """Production regression: the admin screen can truthfully show a newer
    ACTIVE $25 service override while the canonical resolver still returns the
    $30 catalog rate if an older REVOKED row is encountered first by find_one.

    Retained history is intentional; every live pricing path must choose the
    currently applicable row rather than MongoDB natural order.
    """
    with _client_and_dog() as (client, dog):
        with _service("Lifecycle Daycare", 30.0, is_default=True) as svc:
            admin = _admin_user()
            old = run(server.create_client_price_override(
                client["id"],
                server.PriceOverrideIn(
                    target_kind="service", target_code=svc["id"], override_price=20.0,
                ),
                admin,
            ))
            run(server.delete_price_override(
                old["id"], server.PriceOverrideRevokeIn(reason="regression setup"), admin,
            ))
            new = run(server.create_client_price_override(
                client["id"],
                server.PriceOverrideIn(
                    target_kind="service", target_code=svc["id"], override_price=25.0,
                ),
                admin,
            ))

            history = run(server.db.price_overrides.find(
                {"client_id": client["id"], "target_kind": "service", "target_code": svc["id"]},
                {"_id": 0},
            ).to_list(20))
            assert len(history) == 2
            assert next(r for r in history if r["id"] == old["id"])["status"] == "revoked"
            assert next(r for r in history if r["id"] == new["id"])["status"] == "active"

            canonical = run(server.resolve_client_price(
                client["id"], "service", svc["id"], 30.0,
            ))
            assert canonical["pricing_source"] == "client_override"
            assert canonical["override_id"] == new["id"]
            assert float(canonical["effective_price"]) == 25.0

            prices = _prices(client["id"])
            assert prices[svc["id"]]["pricing_source"] == "client_override"
            assert prices[svc["id"]]["override_id"] == new["id"]
            assert float(prices[svc["id"]]["effective_price"]) == 25.0

            quote = run(server.pricing_quote(server.PricingQuoteIn(
                service_type="daycare",
                service_id=svc["id"],
                dog_id=dog["id"],
                date=date.today().isoformat(),
            ), admin))
            assert float(quote["unit_price"]) == 25.0
            assert float(quote["list_unit_price"]) == 30.0
            assert quote["preferred_rate_applied"] is True
            assert quote["price_override_id"] == new["id"]

            with _walkin(dog["id"], svc["id"]) as booking:
                assert float(booking["estimated_price"]) == 25.0
                assert booking["price_override_id"] == new["id"]
                _check_in(booking["id"], hours_ago=9)
                preview = run(server.checkout_group_preview(booking["id"], admin))
                assert float(preview["bookings"][0]["checkout_preview_total"]) == 25.0


def test_setting_price_again_edits_live_row_even_when_revoked_history_exists():
    """The write path had the same unrestricted-find_one trap: after revoke
    + recreate, setting the price again could inspect the old revoked row and
    try to insert another active override. It must edit the current live row.
    """
    with _client_and_dog() as (client, dog):
        with _service("Lifecycle Edit Daycare", 30.0) as svc:
            admin = _admin_user()
            old = run(server.create_client_price_override(
                client["id"],
                server.PriceOverrideIn(
                    target_kind="service", target_code=svc["id"], override_price=20.0,
                ),
                admin,
            ))
            run(server.delete_price_override(
                old["id"], server.PriceOverrideRevokeIn(reason="regression setup"), admin,
            ))
            live = run(server.create_client_price_override(
                client["id"],
                server.PriceOverrideIn(
                    target_kind="service", target_code=svc["id"], override_price=25.0,
                ),
                admin,
            ))

            edited = run(server.create_client_price_override(
                client["id"],
                server.PriceOverrideIn(
                    target_kind="service", target_code=svc["id"], override_price=27.0,
                ),
                admin,
            ))
            assert edited["id"] == live["id"]
            assert float(edited["override_price"]) == 27.0

            history = run(server.db.price_overrides.find(
                {"client_id": client["id"], "target_kind": "service", "target_code": svc["id"]},
                {"_id": 0},
            ).to_list(20))
            assert len(history) == 2
            active = [r for r in history if server._override_is_active(r)]
            assert len(active) == 1
            assert active[0]["id"] == live["id"]
            assert float(active[0]["override_price"]) == 27.0
