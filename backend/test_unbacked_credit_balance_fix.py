"""Manual credit balance bug fix — redemption is entirely FIFO-lot-based
(server.py's _consume_credit_lots): a client's credits/training_credits/
boarding_credits balance could be set directly through the client edit
form (create_client/update_client) with NO backing credit_lots document.
Checkout's "pay with credits" would then silently find nothing to consume
and fall back to a full cash charge — no error, no balance change, no
signal to staff that anything went wrong.

Reported live: a client manually granted 13 daycare credits (bought before
any matching pack existed as a catalog item) checked out twice and their
balance never moved, because credit_lots had zero rows for them.

_mint_manual_credit_lot() (server.py, just above _credit_balance_field)
fixes this: create_client/update_client now mint a real backing lot
whenever a pool is raised, and scripts/backfill_unbacked_client_credits.py
catches up any client already in that state.

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

TAG = "TEST_UNBACKED_CREDIT"


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "display_name": f"{TAG} admin"}


def _lots_remaining(client_id, service_type="daycare"):
    lots = run(server.db.credit_lots.find({"client_id": client_id, "service_type": service_type}, {"_id": 0}).to_list(50))
    return round(sum(float(l.get("qty_remaining") or 0) for l in lots), 2)


@contextlib.contextmanager
def _client_and_dog(**client_fields):
    admin = _admin_user()
    client = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com", **client_fields,
    ), admin))
    did = str(uuid.uuid4())
    dog = {
        "id": did, "name": f"{TAG} Dog", "owner_id": client["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }
    run(server.db.dogs.insert_one(dog))
    try:
        yield client, dog
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.clients.delete_one({"id": client["id"]}))
        run(server.db.credit_lots.delete_many({"client_id": client["id"]}))
        run(server.db.retail_sales.delete_many({"client_id": client["id"]}))
        run(server.db.invoices.delete_many({"client_id": client["id"]}))


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


class _OpenRegisterDay:
    def __init__(self, tag):
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
                "date": self.date, "opening_cash": 0.0, "notes": f"{self.tag} disposable test register day",
                "opened_at": server.now_iso(), "opened_by": self.marker, "opened_by_name": f"{self.tag} fixture",
            }},
            upsert=True, projection={"_id": 0},
        ))
        self.created = before is None
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


def _check_in(booking_id, hours_ago=9):
    ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
    run(server.db.bookings.update_one({"id": booking_id}, {"$set": {"checked_in_at": ts, "checked_in_by": "test"}}))


# ---------------------------------------------------------------------------
# The reported bug, fixed
# ---------------------------------------------------------------------------

def test_manually_setting_credits_at_client_creation_mints_a_backing_lot():
    with _client_and_dog(credits=13) as (client, dog):
        assert client["credits"] == 13
        assert _lots_remaining(client["id"]) == 13.0


def test_manually_raising_credits_via_update_client_mints_a_backing_lot():
    with _client_and_dog() as (client, dog):
        assert _lots_remaining(client["id"]) == 0.0
        admin = _admin_user()
        run(server.update_client(client["id"], server.ClientIn(name=client["name"], email=client["email"], credits=13), admin))
        assert _lots_remaining(client["id"]) == 13.0


def test_manually_granted_credits_are_actually_redeemable_at_checkout():
    """The end-to-end reproduction of the reported bug: a manually-set
    balance must actually deduct at checkout, not silently fall back to a
    full cash charge."""
    with _daycare_service(base_price=30.0), _client_and_dog(credits=13) as (client, dog):
        admin = _admin_user()
        booking = run(server.create_booking(server.BookingIn(
            dog_id=dog["id"], service_type="daycare", date=date.today().isoformat(), override_capacity=True,
        ), admin))
        _check_in(booking["id"], hours_ago=9)
        with _OpenRegisterDay(TAG):
            run(server._check_out_locked(booking["id"], server.CheckoutIn(use_credits=True), admin))
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        final_booking = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
        assert final_client["credits"] == 12.0, (
            f"Expected credits to drop from 13 to 12, got {final_client['credits']} — "
            "manually-granted credits must be genuinely redeemable at checkout."
        )
        assert final_booking["credits_deducted"] == 1.0
        assert final_booking["payment_method"] == "credits"
        run(server.db.bookings.delete_one({"id": booking["id"]}))


# ---------------------------------------------------------------------------
# Must not regress existing behavior
# ---------------------------------------------------------------------------

def test_lowering_credits_does_not_touch_existing_lots():
    """Decreases are deliberately left alone — shrinking lots to match a
    lowered number is a separate operation this fix does not attempt."""
    with _client_and_dog(credits=13) as (client, dog):
        assert _lots_remaining(client["id"]) == 13.0
        admin = _admin_user()
        run(server.update_client(client["id"], server.ClientIn(name=client["name"], email=client["email"], credits=5), admin))
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 5.0
        assert _lots_remaining(client["id"]) == 13.0  # unchanged — no new lot minted, none shrunk


def test_resaving_the_same_credits_value_does_not_mint_a_duplicate_lot():
    with _client_and_dog(credits=13) as (client, dog):
        assert _lots_remaining(client["id"]) == 13.0
        admin = _admin_user()
        run(server.update_client(client["id"], server.ClientIn(name=client["name"], email=client["email"], credits=13), admin))
        assert _lots_remaining(client["id"]) == 13.0  # still just the one lot, no duplicate


def test_client_created_with_zero_credits_mints_no_lot():
    with _client_and_dog() as (client, dog):
        assert client["credits"] == 0
        assert _lots_remaining(client["id"]) == 0.0


def test_pack_purchase_still_mints_exactly_one_lot_not_two():
    """A client buying a real pack must not ALSO get a manual-adjustment
    lot from the balance increment — only sell_credit_pack's own lot."""
    with _daycare_service() as svc, _client_and_dog() as (client, dog):
        admin = _admin_user()
        pack = run(server.create_credit_pack(server.CreditPackIn(
            name=f"{TAG} Pack", qty=5, price=125.0, service_type="daycare", active=True,
        ), admin))
        with _OpenRegisterDay(TAG):
            run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), admin))
        assert _lots_remaining(client["id"]) == 5.0
        lots = run(server.db.credit_lots.find({"client_id": client["id"]}, {"_id": 0}).to_list(10))
        assert len(lots) == 1, "sell_credit_pack must mint exactly one lot — update_client's own $set must not ALSO mint one"
        run(server.db.credit_packs.delete_one({"id": pack["id"]}))


def test_training_and_boarding_pools_also_get_backed():
    with _client_and_dog(training_credits=4, boarding_credits=2) as (client, dog):
        assert _lots_remaining(client["id"], "training") == 4.0
        assert _lots_remaining(client["id"], "boarding") == 2.0
