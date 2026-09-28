"""Friends & family groups: checking a dog out puts every dollar on the
payer (build step 5; owner request 2026-09-28). The switch is on in these
tests only.

The owner's rules: one family pays ONE bill for every dog in the group, and
the dogs may be picked up at different times. Checking the friend's dog out —
whenever it is picked up — prices it at the payer's rates and puts the whole
visit on the PAYER's account; nothing is paid at that checkout (money offered
there is refused; merchandise is rung at the register). The group's one bill
is made on the payer when the last dog leaves (test_friends_family_group_bill).
The friend's family's account never moves. Prepaid credits are not used on
the friend's dog (first release). A visit someone else paid for earns no
referral reward.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import friends_family

TAG = "TEST_FF_CHECKOUT"
OWNER = {"id": "ffc-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


@contextlib.contextmanager
def _group():
    """The payer ($30 special rate on a $40 daycare) and a friend's family
    that holds prepaid daycare credits, one dog each, checked in 8 hours ago."""
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    run(server.db.services.insert_one(dict(svc)))
    fams = {}
    for who in ("payer", "friend"):
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": "active", "account_balance": 0.0, "credits": 5,
                                          "referral_code": f"R{uuid.uuid4().hex[:6].upper()}"}))
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
        fams[who] = {"client": cid, "dog": did}
    payer, friend = fams["payer"], fams["friend"]
    run(server.db.clients.update_one({"id": friend["client"]}, {"$set": {
        "referred_by_code": run(server.db.clients.find_one({"id": payer["client"]}))["referral_code"]}}))
    run(server.db.price_overrides.insert_one({"id": str(uuid.uuid4()), "client_id": payer["client"], "target_kind": "service",
                                              "target_code": svc["id"], "override_price": 30.0, "created_at": server.now_iso()}))
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=payer["dog"]), server.BookingGroupDog(dog_id=friend["dog"])],
                                 date=server.business_today().isoformat(), service_type="daycare", service_id=svc["id"],
                                 override_capacity=True, override_vaccines=True, payer_client_id=payer["client"])
    rows = {r["dog_id"]: r for r in run(server.create_booking_group(body, OWNER))["bookings"]}
    earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    for f in fams.values():
        f["booking"] = rows[f["dog"]]["id"]
        run(server.check_in(f["booking"], server.CheckInIn(vaccine_ack=True), OWNER))
        run(server.db.bookings.update_one({"id": f["booking"]}, {"$set": {"checked_in_at": earlier}}))
    try:
        yield payer, friend
    finally:
        for f in fams.values():
            for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "pos_sales", "credit_lots",
                         "referrals", "checkout_groups"):
                run(server.db[coll].delete_many({"client_id": f["client"]}))
            run(server.db.bookings.delete_many({"dog_id": f["dog"]}))
            run(server.db.dogs.delete_one({"id": f["dog"]}))
            run(server.db.clients.delete_one({"id": f["client"]}))
            run(server.db.price_overrides.delete_many({"client_id": f["client"]}))
            run(server.db.referrals.delete_many({"referred_id": f["client"]}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def _checkout(booking_id, **body):
    payload = {"use_credits": True}   # a friends & family dog pays nothing at its checkout
    payload.update(body)
    return run(server.check_out(booking_id, server.CheckoutIn(**payload), OWNER))


def _client(cid):
    return run(server.db.clients.find_one({"id": cid}, {"_id": 0}))


def _money_of(cid):
    """Everything that says money moved for this family."""
    return {
        "balance": round(float(_client(cid).get("account_balance") or 0), 2),
        "credits": _client(cid).get("credits"),
        "ledger": run(server.db.payment_ledger.count_documents({"client_id": cid})),
        "bills": run(server.db.invoices.count_documents({"client_id": cid})),
        "payments": run(server.db.payments.count_documents({"client_id": cid})),
        "sales": run(server.db.retail_sales.count_documents({"client_id": cid})),
    }


def test_the_friends_dog_goes_on_the_payers_account_at_the_payers_rate():
    with _group() as (payer, friend):
        friend_before = _money_of(friend["client"])
        _checkout(friend["booking"])
        row = run(server.db.bookings.find_one({"id": friend["booking"]}))
        assert row["actual_price"] == 15.0, "the multi-dog discount off the payer's $30 rate"
        assert row["payment_status"] == "paid_partial" and row["balance_due"] == 15.0
        assert _money_of(payer["client"])["balance"] == 15.0, "on the payer's account"
        assert {r["client_id"] for r in run(server.db.payment_ledger.find({"booking_id": friend["booking"]}).to_list(10))} \
            == {payer["client"]}
        assert run(server.db.invoices.count_documents({"booking_ids": friend["booking"]})) == 0, "no bill until the last dog leaves"
        assert _money_of(friend["client"]) == friend_before, "the friend's family's account never moves"


@pytest.mark.parametrize("offered", [{"payment_method": "check", "payment_status": "paid"}, {"amount_paid": 10.0},
                                     {"payment_method": "cash", "tendered_amount": 20.0}])
def test_money_offered_at_a_friends_dogs_checkout_is_refused_and_nothing_changes(offered):
    with _group() as (payer, friend):
        before = (_money_of(payer["client"]), _money_of(friend["client"]))
        with pytest.raises(HTTPException) as e:
            _checkout(friend["booking"], **offered)
        assert e.value.status_code == 400 and "one bill" in e.value.detail
        assert (_money_of(payer["client"]), _money_of(friend["client"])) == before
        assert run(server.db.bookings.find_one({"id": friend["booking"]}))["status"] != "completed"


def test_neither_familys_prepaid_credits_pay_for_the_friends_dog():
    """(The payer's own dog may use the payer's credits like any visit.)"""
    with _group() as (payer, friend):
        _checkout(friend["booking"], use_credits=True)
        assert _client(friend["client"])["credits"] == 5 and _client(payer["client"])["credits"] == 5
        assert run(server.db.bookings.find_one({"id": friend["booking"]})).get("payment_method") != "credits"


def test_merchandise_at_a_friends_dogs_pickup_is_rung_at_the_register_instead():
    with _group() as (_payer, friend):
        pid = str(uuid.uuid4())
        run(server.db.pos_products.insert_one({
            "id": pid, "name": f"{TAG} treats", "price": 10.0, "active": True, "archived": False, "show_at_register": True,
            "track_inventory": False, "stock_on_hand": 0, "taxable": False, "category": "", "description": "", "sku": "",
            "category_id": None, "subcategory_id": None}))
        try:
            with pytest.raises(HTTPException) as e:
                _checkout(friend["booking"], retail_lines=[{"kind": "retail", "product_id": pid, "qty": 1}],
                          retail_idempotency_key=f"{TAG}-{uuid.uuid4()}")
            assert e.value.status_code == 400
            assert run(server.db.pos_sales.count_documents({"line_items.product_id": pid})) == 0
        finally:
            run(server.db.pos_products.delete_one({"id": pid}))


def test_a_visit_someone_else_paid_for_earns_no_referral_reward():
    with _group() as (payer, friend):
        _checkout(friend["booking"])
        assert run(server.db.referrals.find_one({"referred_id": friend["client"]})) is None
        assert _client(payer["client"])["credits"] == 5, "no free day for the payer"


def test_report_cards_and_visits_stay_with_the_dogs_own_family():
    with _group() as (_payer, friend):
        _checkout(friend["booking"])
        row = run(server.db.bookings.find_one({"id": friend["booking"]}))
        assert row["client_id"] == friend["client"] and row["status"] == "completed"
