"""Shared credit-mutation service — the fix for a systemic gap where several
independent code paths (manual "Adjust Credits", referral rewards, trivia
rewards, and the client-profile edit form) could each change a client's
SPENDABLE credit balance field directly, without ever touching the
credit_lots ledger checkout actually redeems from. A balance with no
backing lot silently fails to redeem — checkout finds nothing to consume
and falls back to a full cash charge, with no error and no balance change.
Confirmed live in production for the client-profile-edit path; this fix
generalizes the same real bug's fix to every other credit-granting path.

_mutate_client_credits() (server.py, just after _restore_credit_lots) is
now the ONLY function allowed to write to a client's credits/
training_credits/boarding_credits field outside of a real pack/program
sale (which already mints its own lot at sale time) or checkout redemption
(which spends via _consume_credit_lots). It holds one invariant everywhere:

    client.<credits field> == sum of that client's active
    credit_lots.qty_remaining for the same service_type

adjust_client_credits, _grant_client_reward_credit (covers referral AND
trivia rewards, both funnel through it), update_client, and create_client
all route through it now.

Same fixture/cleanup convention as test_stale_price_snapshot_fix.py /
test_unbacked_credit_balance_fix.py (see test_shop_appearance_settings.py's
docstring for the repo-wide ad-hoc-fixture rationale).
"""
import asyncio
import contextlib
import uuid
from datetime import date, timedelta, datetime, timezone

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from motor.motor_asyncio import AsyncIOMotorCollection

TAG = "TEST_CREDIT_SVC"


@contextlib.contextmanager
def _fail_insert_on_collection(collection_name, message="simulated failure"):
    """Motor hands back a FRESH AsyncIOMotorCollection wrapper on every
    `db.<name>` access (confirmed: `db.foo is db.foo` is False), so
    monkeypatching an instance attribute like `db.credit_adjustments.insert_one`
    silently does nothing — the next access gets an unpatched wrapper. This
    patches the shared CLASS method instead (which every wrapper instance
    resolves to), scoped by `self.name` so only the named collection's
    insert_one actually fails; every other collection's insert_one
    (including retries on OTHER collections during the same test) delegates
    straight through to the real implementation, unaffected."""
    orig = AsyncIOMotorCollection.insert_one

    async def _patched(self, *args, **kwargs):
        if self.name == collection_name:
            raise RuntimeError(message)
        return await orig(self, *args, **kwargs)

    AsyncIOMotorCollection.insert_one = _patched
    try:
        yield
    finally:
        AsyncIOMotorCollection.insert_one = orig


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "display_name": f"{TAG} admin"}


def _lots_remaining(client_id, service_type="daycare"):
    lots = run(server.db.credit_lots.find({"client_id": client_id, "service_type": service_type}, {"_id": 0}).to_list(50))
    return round(sum(float(l.get("qty_remaining") or 0) for l in lots), 2)


def _lot_count(client_id, service_type="daycare"):
    return run(server.db.credit_lots.count_documents({"client_id": client_id, "service_type": service_type}))


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
        run(server.db.credit_adjustments.delete_many({"client_id": client["id"]}))
        run(server.db.rewards_ledger.delete_many({"client_id": client["id"]}))
        run(server.db.retail_sales.delete_many({"client_id": client["id"]}))
        run(server.db.invoices.delete_many({"client_id": client["id"]}))
        run(server.db.bookings.delete_many({"client_id": client["id"]}))


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
def _daycare_pack(qty=5, price=125.0):
    admin = _admin_user()
    pack = run(server.create_credit_pack(server.CreditPackIn(
        name=f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=qty, price=price, service_type="daycare", active=True,
    ), admin))
    try:
        yield pack
    finally:
        run(server.db.credit_packs.delete_one({"id": pack["id"]}))


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


def _book_and_checkout_with_credits(dog_id, booking_client_credits_field="credits"):
    """Creates a daycare booking, checks it in, and checks it out using
    credits. Returns the final booking doc."""
    admin = _admin_user()
    booking = run(server.create_booking(server.BookingIn(
        dog_id=dog_id, service_type="daycare", date=date.today().isoformat(), override_capacity=True,
    ), admin))
    _check_in(booking["id"], hours_ago=9)
    with _OpenRegisterDay(TAG):
        run(server._check_out_locked(booking["id"], server.CheckoutIn(use_credits=True), admin))
    final = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0}))
    run(server.db.bookings.delete_one({"id": booking["id"]}))
    return final


# ---------------------------------------------------------------------------
# 1. Admin adds five credits through Adjust Credits
# ---------------------------------------------------------------------------

def test_adjust_credits_add_five_visible_and_lots_match_then_checkout_deducts_one():
    with _daycare_service(), _client_and_dog() as (client, dog):
        admin = _admin_user()
        result = run(server.adjust_client_credits(client["id"], server.CreditAdjustIn(daycare=5, note="Comp for mistake"), admin))
        assert result["changes"]["daycare"]["after"] == 5.0
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 5.0
        assert _lots_remaining(client["id"]) == 5.0

        booking = _book_and_checkout_with_credits(dog["id"])
        after_checkout = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert after_checkout["credits"] == 4.0
        assert _lots_remaining(client["id"]) == 4.0
        assert booking["credits_deducted"] == 1.0
        assert booking["payment_method"] == "credits"


# ---------------------------------------------------------------------------
# 2. Admin removes credits
# ---------------------------------------------------------------------------

def test_adjust_credits_remove_reduces_lots_too_and_removed_credits_never_reappear():
    with _client_and_dog(credits=13) as (client, dog):
        assert _lots_remaining(client["id"]) == 13.0
        admin = _admin_user()
        result = run(server.adjust_client_credits(client["id"], server.CreditAdjustIn(daycare=-8, note="Correcting a mistake"), admin))
        assert result["changes"]["daycare"]["after"] == 5.0
        mid_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert mid_client["credits"] == 5.0
        assert _lots_remaining(client["id"]) == 5.0  # exactly matches the user's own 13 -> 5 example

        # A later, unrelated adjustment must not resurrect the removed 8.
        run(server.adjust_client_credits(client["id"], server.CreditAdjustIn(daycare=2, note="Separate later adjustment"), admin))
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 7.0
        assert _lots_remaining(client["id"]) == 7.0


def test_adjust_credits_rejects_removal_that_would_go_negative():
    with _client_and_dog(credits=3) as (client, dog):
        admin = _admin_user()
        try:
            run(server.adjust_client_credits(client["id"], server.CreditAdjustIn(daycare=-5), admin))
            assert False, "expected a 400 for a removal that would go negative"
        except server.HTTPException as e:
            assert e.status_code == 400
        # Nothing changed.
        unchanged = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert unchanged["credits"] == 3.0
        assert _lots_remaining(client["id"]) == 3.0


# ---------------------------------------------------------------------------
# 3 & 4. Referral / trivia reward credits create real backing lots
# ---------------------------------------------------------------------------

def test_referral_reward_creates_backing_lot_and_checkout_can_consume_it():
    with _daycare_service(), _client_and_dog() as (client, dog):
        admin = _admin_user()
        reward = run(server._grant_client_reward_credit(
            client, service="daycare", amount=1, reason="Referral bonus — referred Test Client",
            source="referral_manual", source_id="fake-referred-id",
            actor=admin["id"], actor_name=admin["name"],
        ))
        assert reward["amount"] == 1.0
        lots = run(server.db.credit_lots.find({"client_id": client["id"], "service_type": "daycare"}, {"_id": 0}).to_list(10))
        assert len(lots) == 1
        assert lots[0]["source"] == "referral_manual"
        assert lots[0]["qty_remaining"] == 1.0
        after_reward = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert after_reward["credits"] == 1.0

        booking = _book_and_checkout_with_credits(dog["id"])
        assert booking["credits_deducted"] == 1.0
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 0.0
        assert _lots_remaining(client["id"]) == 0.0


def test_trivia_reward_creates_backing_lot_and_checkout_can_consume_it():
    with _daycare_service(), _client_and_dog() as (client, dog):
        admin = _admin_user()
        reward = run(server._grant_client_reward_credit(
            client, service="daycare", amount=1, reason="Trivia reward — 7-day streak",
            source="trivia", source_id=f"{client['id']}:7:2026-01-01",
            actor=admin["id"], actor_name=admin["name"],
        ))
        assert reward["amount"] == 1.0
        lots = run(server.db.credit_lots.find({"client_id": client["id"], "service_type": "daycare"}, {"_id": 0}).to_list(10))
        assert len(lots) == 1
        assert lots[0]["source"] == "trivia"

        booking = _book_and_checkout_with_credits(dog["id"])
        assert booking["credits_deducted"] == 1.0
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 0.0


# ---------------------------------------------------------------------------
# 5 & 6. Edit Client increases / decreases
# ---------------------------------------------------------------------------

def test_edit_client_increase_only_creates_new_credits_purchased_lot_untouched():
    with _daycare_pack(qty=5, price=125.0) as pack, _client_and_dog() as (client, dog):
        admin = _admin_user()
        with _OpenRegisterDay(TAG):
            purchased_lot = run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), admin))
        assert purchased_lot["qty_remaining"] == 5.0
        mid_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert mid_client["credits"] == 5.0

        run(server.update_client(client["id"], server.ClientIn(name=client["name"], email=client["email"], credits=8), admin))
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 8.0
        assert _lots_remaining(client["id"]) == 8.0
        assert _lot_count(client["id"]) == 2  # the original purchased lot + one new manual lot for the +3

        # The ORIGINAL purchased lot itself must be completely untouched — not duplicated, not resized.
        original_lot_now = run(server.db.credit_lots.find_one({"id": purchased_lot["id"]}, {"_id": 0}))
        assert original_lot_now["qty_remaining"] == 5.0
        assert original_lot_now["qty_total"] == 5.0
        assert original_lot_now["price_paid"] == purchased_lot["price_paid"]


def test_edit_client_decrease_reduces_actual_lots_no_hidden_excess():
    with _client_and_dog(credits=13) as (client, dog):
        admin = _admin_user()
        run(server.update_client(client["id"], server.ClientIn(name=client["name"], email=client["email"], credits=5), admin))
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 5.0
        assert _lots_remaining(client["id"]) == 5.0  # never leaves 13 sitting in the lot ledger


# ---------------------------------------------------------------------------
# 7. Existing purchased packs continue working unchanged
# ---------------------------------------------------------------------------

def test_purchased_pack_flow_unchanged():
    with _daycare_pack(qty=10, price=250.0) as pack, _client_and_dog() as (client, dog):
        admin = _admin_user()
        with _OpenRegisterDay(TAG):
            lot = run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), admin))
        assert lot["qty_total"] == 10
        assert lot["qty_remaining"] == 10
        assert lot["price_paid"] == 250.0
        assert lot["recognize_at_sale"] is True
        client_after = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert client_after["credits"] == 10.0


# ---------------------------------------------------------------------------
# 8. Mixed purchased / manual / reward lots deduct in intended (FIFO) order
# ---------------------------------------------------------------------------

def test_mixed_lot_sources_deduct_oldest_first():
    with _daycare_pack(qty=1, price=25.0) as pack, _client_and_dog() as (client, dog):
        admin = _admin_user()
        base = datetime.now(timezone.utc)

        # Oldest: a manual adjustment.
        run(server.adjust_client_credits(client["id"], server.CreditAdjustIn(daycare=1, note="oldest"), admin))
        oldest_lot = run(server.db.credit_lots.find_one({"client_id": client["id"], "source": "manual_adjustment"}, {"_id": 0, "id": 1}))
        run(server.db.credit_lots.update_one({"id": oldest_lot["id"]}, {"$set": {"purchased_at": (base - timedelta(days=2)).isoformat()}}))

        # Middle: a real purchased pack.
        with _OpenRegisterDay(TAG):
            purchased_lot = run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), admin))
        run(server.db.credit_lots.update_one({"id": purchased_lot["id"]}, {"$set": {"purchased_at": (base - timedelta(days=1)).isoformat()}}))

        # Newest: a reward credit.
        reward = run(server._grant_client_reward_credit(
            client, service="daycare", amount=1, reason="reward", source="trivia", actor=admin["id"], actor_name=admin["name"],
        ))
        newest_lot = run(server.db.credit_lots.find_one({"client_id": client["id"], "source": "trivia"}, {"_id": 0, "id": 1}))
        run(server.db.credit_lots.update_one({"id": newest_lot["id"]}, {"$set": {"purchased_at": base.isoformat()}}))

        assert _lots_remaining(client["id"]) == 3.0

        # Redeem one credit at a time and confirm FIFO (oldest purchased_at first).
        _value, redemptions, consumed = run(server._consume_credit_lots(client["id"], 1, "daycare"))
        assert consumed == 1.0
        assert redemptions[0]["lot_id"] == oldest_lot["id"]

        _value, redemptions, consumed = run(server._consume_credit_lots(client["id"], 1, "daycare"))
        assert consumed == 1.0
        assert redemptions[0]["lot_id"] == purchased_lot["id"]

        _value, redemptions, consumed = run(server._consume_credit_lots(client["id"], 1, "daycare"))
        assert consumed == 1.0
        assert redemptions[0]["lot_id"] == newest_lot["id"]


# ---------------------------------------------------------------------------
# 9. A simulated failure during adjustment rolls back all three writes
# ---------------------------------------------------------------------------

def test_failure_during_adjustment_rolls_back_balance_lot_and_audit():
    with _client_and_dog() as (client, dog):
        admin = _admin_user()
        with _fail_insert_on_collection("credit_adjustments", "simulated failure writing the audit row"):
            try:
                run(server._mutate_client_credits(
                    client["id"], "daycare", 5,
                    source="manual_adjustment", reason="should roll back",
                    actor_id=admin["id"], actor_name=admin["name"],
                ))
                assert False, "expected the simulated failure to propagate"
            except RuntimeError:
                pass

        # All three legs must be back to exactly their pre-call state.
        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 0.0
        assert _lot_count(client["id"]) == 0
        adj_count = run(server.db.credit_adjustments.count_documents({"client_id": client["id"]}))
        assert adj_count == 0


def test_failure_during_removal_restores_consumed_lots():
    with _client_and_dog(credits=5) as (client, dog):
        admin = _admin_user()
        with _fail_insert_on_collection("credit_adjustments", "simulated failure writing the audit row"):
            try:
                run(server._mutate_client_credits(
                    client["id"], "daycare", -3,
                    source="manual_adjustment", reason="should roll back",
                    actor_id=admin["id"], actor_name=admin["name"],
                ))
                assert False, "expected the simulated failure to propagate"
            except RuntimeError:
                pass

        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 5.0  # unchanged — the consumed lot qty was restored
        assert _lots_remaining(client["id"]) == 5.0


# ---------------------------------------------------------------------------
# 10. Two simultaneous deductions cannot overspend or go negative
# ---------------------------------------------------------------------------

def test_concurrent_deductions_cannot_overspend():
    with _client_and_dog(credits=5) as (client, dog):
        admin = _admin_user()

        async def _both():
            return await asyncio.gather(
                server._mutate_client_credits(client["id"], "daycare", -5, source="manual_adjustment", reason="A", actor_id=admin["id"], actor_name=admin["name"]),
                server._mutate_client_credits(client["id"], "daycare", -5, source="manual_adjustment", reason="B", actor_id=admin["id"], actor_name=admin["name"]),
                return_exceptions=True,
            )

        results = run(_both())
        successes = [r for r in results if not isinstance(r, Exception)]
        failures = [r for r in results if isinstance(r, Exception)]
        assert len(successes) == 1, "exactly one of the two concurrent removals should succeed"
        assert len(failures) == 1
        assert isinstance(failures[0], server.HTTPException)
        assert failures[0].status_code == 409

        final_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        assert final_client["credits"] == 0.0  # never negative
        assert _lots_remaining(client["id"]) == 0.0


# ---------------------------------------------------------------------------
# 11. Reconciliation reports zero variance, no double counting
# ---------------------------------------------------------------------------

def test_reconciliation_zero_variance_no_double_count_of_migrated_adjustment():
    with _client_and_dog() as (client, dog):
        admin = _admin_user()
        run(server.adjust_client_credits(client["id"], server.CreditAdjustIn(daycare=5, note="test grant"), admin))
        fresh_client = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "credits": 1, "training_credits": 1, "boarding_credits": 1, "deleted": 1, "archived": 1, "client_status": 1}))

        lot_rows = run(server.db.credit_lots.aggregate([
            {"$match": {"client_id": client["id"]}},
            {"$group": {
                "_id": {"client_id": "$client_id", "service_type": "$service_type"},
                "remaining": {"$sum": {"$ifNull": ["$qty_remaining", 0]}},
                "lot_count": {"$sum": 1},
                "negative_count": {"$sum": {"$cond": [{"$lt": [{"$ifNull": ["$qty_remaining", 0]}, 0]}, 1, 0]}},
                "overfilled_count": {"$sum": {"$cond": [{"$gt": [{"$ifNull": ["$qty_remaining", 0]}, {"$ifNull": ["$qty_total", 0]}]}, 1, 0]}},
            }},
        ]).to_list(100))
        lot_totals = {}
        for row in lot_rows:
            pool = row["_id"]["service_type"]
            lot_totals[pool] = {k: v for k, v in row.items() if k != "_id"}

        adj_rows = run(server.db.credit_adjustments.aggregate([
            {"$match": {"client_id": client["id"]}},
            {"$group": {
                "_id": "$client_id",
                "daycare": {"$sum": {"$ifNull": ["$changes.daycare.delta", 0]}},
                "training": {"$sum": {"$ifNull": ["$changes.training.delta", 0]}},
                "boarding": {"$sum": {"$ifNull": ["$changes.boarding.delta", 0]}},
                "count": {"$sum": 1},
            }},
        ]).to_list(100))
        adjustment_totals = adj_rows[0] if adj_rows else {}

        row = server._credit_recon_client_row(fresh_client, lot_totals, adjustment_totals)
        assert row["pools"]["daycare"]["displayed"] == 5.0
        assert row["pools"]["daycare"]["lot_remaining"] == 5.0
        # manual_adjustment_net is nonzero (informational) but must NOT have
        # been added into tracked_total/variance -- that's the double-count bug.
        assert row["pools"]["daycare"]["manual_adjustment_net"] == 5.0
        assert row["pools"]["daycare"]["tracked_total"] == 5.0
        assert row["pools"]["daycare"]["variance"] == 0.0
        assert row["pools"]["daycare"]["status"] == "match"
        assert row["overall_status"] == "match"


# ---------------------------------------------------------------------------
# 12. Backfill dry-run after the fix reports no additional migration needed
# ---------------------------------------------------------------------------

def test_backfill_style_audit_is_a_no_op_for_a_client_created_under_the_new_service():
    """Replicates scripts/backfill_unbacked_client_credits.py's own
    shortfall calculation inline (displayed vs. sum of active lots) against
    a client created entirely through the now-fixed paths. Must find
    exactly zero shortfall — proving a dry-run of the real backfill script
    would be a genuine no-op here, not just "not crash"."""
    with _client_and_dog(credits=13) as (client, dog):
        admin = _admin_user()
        run(server.update_client(client["id"], server.ClientIn(name=client["name"], email=client["email"], credits=9), admin))
        run(server.adjust_client_credits(client["id"], server.CreditAdjustIn(daycare=2), admin))
        run(server._grant_client_reward_credit(
            client, service="daycare", amount=1, reason="reward", source="trivia", actor=admin["id"], actor_name=admin["name"],
        ))

        fresh = run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0, "credits": 1}))
        displayed = round(float(fresh.get("credits") or 0), 2)
        backed = _lots_remaining(client["id"])
        shortfall = round(displayed - backed, 2)
        assert shortfall == 0.0, f"backfill would still find a {shortfall} shortfall — the invariant isn't holding"
