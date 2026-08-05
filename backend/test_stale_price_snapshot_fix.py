"""Client-specific pricing bug fix — a booking's estimated_price/unit_price/
pricing_snapshot are captured ONCE, at creation time. If a client-specific
service-price override is added or changed AFTER a one-off/walk-in booking
already exists but BEFORE it's checked out, checkout used to keep charging
whatever price existed at booking-creation time (often the plain base/list
price), never the client's now-active rate. Reported live: a $30 base-price
daycare service, a client with an active $25 override, booking created
before the override was set up, checkout still showed $30.

_refresh_booking_price_for_current_override() (server.py, just above
checkout_group_preview) fixes this WITHOUT touching the deliberate,
pre-existing protection that keeps a booking's locked-in grandfathered rate
from being bumped up by a later GENERAL catalog price increase — it only
ever refreshes when the client's specific override itself changed.

Same fixture/cleanup convention as test_shop_checkout_eligibility.py (see
test_shop_appearance_settings.py's docstring for the repo-wide ad-hoc-
fixture rationale).
"""
import contextlib
import uuid
from datetime import date, timedelta, datetime, timezone

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_STALE_PRICE"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "display_name": f"{TAG} admin"}


@contextlib.contextmanager
def _client_and_dog():
    cid = str(uuid.uuid4())
    client = {
        "id": cid, "name": f"{TAG} Client {uuid.uuid4().hex[:6]}",
        "email": f"{uuid.uuid4().hex[:8]}@example.com", "created_at": server.now_iso(),
    }
    run(server.db.clients.insert_one(client))
    did = str(uuid.uuid4())
    dog = {
        "id": did, "name": f"{TAG} Dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }
    run(server.db.dogs.insert_one(dog))
    try:
        yield client, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.credit_lots.delete_many({"client_id": cid}))
        run(server.db.price_overrides.delete_many({"client_id": cid}))
        run(server.db.retail_sales.delete_many({"client_id": cid}))
        run(server.db.invoices.delete_many({"client_id": cid}))


@contextlib.contextmanager
def _daycare_service(base_price=30.0):
    admin = _admin_user()
    svc = run(server.create_service(server.ServiceIn(
        name=f"{TAG} Daycare {uuid.uuid4().hex[:6]}", service_type="daycare", base_price=base_price, active=True,
    ), admin))
    run(server.db.services.update_one({"id": svc["id"]}, {"$set": {"is_default": True}}))
    try:
        yield svc
    finally:
        run(server.db.services.delete_one({"id": svc["id"]}))


@contextlib.contextmanager
def _service_override(client_id, service_id, price):
    admin = _admin_user()
    override = run(server.create_client_price_override(
        client_id, server.PriceOverrideIn(target_kind="service", target_code=service_id, override_price=price), admin,
    ))
    try:
        yield override
    finally:
        run(server.db.price_overrides.delete_one({"id": override["id"]}))


@contextlib.contextmanager
def _booking(dog_id, when=None):
    admin = _admin_user()
    body = server.BookingIn(dog_id=dog_id, service_type="daycare", date=when or date.today().isoformat(), override_capacity=True)
    booking = run(server.create_booking(body, admin))
    try:
        yield booking
    finally:
        run(server.db.bookings.delete_one({"id": booking["id"]}))


def _check_in(booking_id, hours_ago=9):
    ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
    run(server.db.bookings.update_one({"id": booking_id}, {"$set": {"checked_in_at": ts, "checked_in_by": "test"}}))


# ---------------------------------------------------------------------------
# The reported bug, fixed
# ---------------------------------------------------------------------------

def test_override_added_after_booking_created_applies_at_checkout_preview():
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0) as svc:
        with _booking(dog["id"]) as booking:
            assert booking["estimated_price"] == 30.0  # no override yet — plain base price
            with _service_override(client["id"], svc["id"], 25.0):
                _check_in(booking["id"])
                admin = _admin_user()
                preview = run(server.checkout_group_preview(booking["id"], admin))
                row = preview["bookings"][0]
                assert row["checkout_preview_total"] == 25.0, (
                    f"Expected the CURRENT $25 client override, got ${row['checkout_preview_total']} "
                    "(stale snapshot bug)."
                )


def test_override_added_after_booking_created_applies_at_actual_checkout():
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0) as svc:
        with _booking(dog["id"]) as booking:
            with _service_override(client["id"], svc["id"], 25.0):
                # Full-day visit (checked in 9h ago) — avoids the unrelated
                # half-day rule so the asserted amount is the plain override price.
                _check_in(booking["id"], hours_ago=9)
                admin = _admin_user()
                run(server._check_out_locked(booking["id"], None, admin))
                final = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
                assert final["actual_price"] == 25.0, (
                    f"Client was charged ${final['actual_price']} instead of their $25 rate."
                )
                assert final["unit_price"] == 25.0
                assert final["price_override_id"] is not None


# ---------------------------------------------------------------------------
# Existing, correct behavior must not regress
# ---------------------------------------------------------------------------

def test_override_already_active_before_booking_still_works():
    """The already-working case (override existed BEFORE the booking) must
    keep working — this fix must be additive, never a regression here."""
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0) as svc:
        with _service_override(client["id"], svc["id"], 25.0):
            with _booking(dog["id"]) as booking:
                assert booking["estimated_price"] == 25.0
                _check_in(booking["id"], hours_ago=9)
                admin = _admin_user()
                run(server._check_out_locked(booking["id"], None, admin))
                final = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
                assert final["actual_price"] == 25.0


def test_no_override_ever_uses_plain_base_price_unaffected():
    """A client who never had any override at all must be completely
    unaffected — the refresh must be a true no-op when there's no override
    now and there wasn't one at booking time either."""
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0):
        with _booking(dog["id"]) as booking:
            assert booking["estimated_price"] == 30.0
            _check_in(booking["id"], hours_ago=9)
            admin = _admin_user()
            run(server._check_out_locked(booking["id"], None, admin))
            final = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
            assert final["actual_price"] == 30.0


def test_revoked_override_does_not_retroactively_raise_price():
    """An override that existed at booking time but was REVOKED before
    checkout must NOT cause the price to jump back up to base — the fix
    only ever refreshes toward a CURRENTLY active override, never away
    from one. (A revoked/expired override is a business decision the
    checkout flow shouldn't second-guess by re-billing a booking that was
    already quoted under it.)"""
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0) as svc:
        with _service_override(client["id"], svc["id"], 25.0) as override:
            with _booking(dog["id"]) as booking:
                assert booking["estimated_price"] == 25.0
                # Revoke the override after the booking was made.
                run(server.db.price_overrides.update_one({"id": override["id"]}, {"$set": {"status": "revoked"}}))
                _check_in(booking["id"], hours_ago=9)
                admin = _admin_user()
                preview = run(server.checkout_group_preview(booking["id"], admin))
                row = preview["bookings"][0]
                assert row["checkout_preview_total"] == 25.0, (
                    "A revoked override must not retroactively raise an already-quoted booking's price."
                )


def test_general_catalog_price_increase_does_not_affect_existing_booking():
    """The pre-existing protection this fix must NOT break: a booking made
    before a general (non-client-specific) catalog price increase keeps its
    original locked-in price at checkout, regardless of today's higher
    catalog rate."""
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0) as svc:
        with _booking(dog["id"]) as booking:
            assert booking["estimated_price"] == 30.0
            # General price increase — NOT a client-specific override.
            run(server.db.services.update_one({"id": svc["id"]}, {"$set": {"base_price": 45.0}}))
            _check_in(booking["id"], hours_ago=9)
            admin = _admin_user()
            preview = run(server.checkout_group_preview(booking["id"], admin))
            row = preview["bookings"][0]
            assert row["checkout_preview_total"] == 30.0, (
                f"A general catalog price increase must not retroactively reprice an existing "
                f"booking — got ${row['checkout_preview_total']}, expected the locked-in $30."
            )


def test_already_charged_booking_is_never_touched():
    """The refresh helper must be a strict no-op once a booking already has
    an actual_price — a completed checkout's numbers are never revisited."""
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0) as svc:
        with _booking(dog["id"]) as booking:
            run(server.db.bookings.update_one({"id": booking["id"]}, {"$set": {"actual_price": 30.0}}))
            with _service_override(client["id"], svc["id"], 25.0):
                charged_booking = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
                refreshed = run(server._refresh_booking_price_for_current_override(charged_booking))
                assert refreshed is charged_booking  # same object — untouched
                assert refreshed["actual_price"] == 30.0


def test_override_changed_to_a_different_price_after_booking_also_refreshes():
    """Not just added-from-nothing — an override whose PRICE changed after
    booking creation (still an active override, just a different amount)
    must also refresh."""
    with _client_and_dog() as (client, dog), _daycare_service(base_price=30.0) as svc:
        with _service_override(client["id"], svc["id"], 25.0) as override:
            with _booking(dog["id"]) as booking:
                assert booking["estimated_price"] == 25.0
                # Admin adjusts this client's rate further after the booking exists.
                run(server.update_price_override(
                    override["id"], server.PriceOverridePatch(override_price=20.0), _admin_user(),
                ))
                _check_in(booking["id"], hours_ago=9)
                admin = _admin_user()
                preview = run(server.checkout_group_preview(booking["id"], admin))
                row = preview["bookings"][0]
                assert row["checkout_preview_total"] == 20.0
