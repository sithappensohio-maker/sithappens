"""Friends & family groups: every money step after checkout stays with the
payer (build step 6; owner request 2026-09-28). The switch is on in these
tests only.

A refund, a reopened checkout and a price correction on the friend's dog
move the PAYER's money and tab — never the friend's family's. End of Day
finds what is owed on the payer's tab and says who is paying; the P&L's top
clients count the money under the family that paid; and a friends & family
dog is never another family's "sibling" for the same-day multi-dog discount.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import pl_report
from _test_loop import run
from domains.bookings import friends_family
from domains.operations import end_of_day

TAG = "TEST_FF_AFTER"
OWNER = {"id": "ffa-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


def _eight_hours_ago():
    return (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()


@contextlib.contextmanager
def _group(friend_dogs=1):
    """The payer ($30 special rate on a $40 daycare) and a friend's family,
    one dog each on a friends & family group, checked in. `friend_dogs=2`
    gives the friend's family a second dog of its own (not on the group)."""
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    run(server.db.services.insert_one(dict(svc)))
    fams = {}
    for who, n in (("payer", 1), ("friend", friend_dogs)):
        cid = str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": "active", "account_balance": 0.0}))
        dogs = []
        for i in range(n):
            did = str(uuid.uuid4())
            run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog {i}", "owner_id": cid, "breed": "Mix",
                                           "age_y": 3, "vaccines": dict(VAX)}))
            dogs.append(did)
        fams[who] = {"client": cid, "dog": dogs[0], "dogs": dogs}
    payer, friend = fams["payer"], fams["friend"]
    run(server.db.price_overrides.insert_one({"id": str(uuid.uuid4()), "client_id": payer["client"], "target_kind": "service",
                                              "target_code": svc["id"], "override_price": 30.0, "created_at": server.now_iso()}))
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=payer["dog"]), server.BookingGroupDog(dog_id=friend["dog"])],
                                 date=server.business_today().isoformat(), service_type="daycare", service_id=svc["id"],
                                 override_capacity=True, override_vaccines=True, payer_client_id=payer["client"])
    rows = {r["dog_id"]: r for r in run(server.create_booking_group(body, OWNER))["bookings"]}
    for f in fams.values():
        f["booking"] = rows[f["dog"]]["id"]
        run(server.check_in(f["booking"], server.CheckInIn(vaccine_ack=True), OWNER))
        run(server.db.bookings.update_one({"id": f["booking"]}, {"$set": {"checked_in_at": _eight_hours_ago()}}))
    try:
        yield payer, friend, svc
    finally:
        for f in fams.values():
            for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "booking_financial_events"):
                run(server.db[coll].delete_many({"client_id": f["client"]}))
            for d in f["dogs"]:
                run(server.db.bookings.delete_many({"dog_id": d}))
                run(server.db.dogs.delete_one({"id": d}))
            run(server.db.clients.delete_one({"id": f["client"]}))
            run(server.db.price_overrides.delete_many({"client_id": f["client"]}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def _checkout(booking_id, **body):
    payload = {"use_credits": False, "payment_method": "check", "payment_status": "paid"}
    payload.update(body)
    return run(server.check_out(booking_id, server.CheckoutIn(**payload), OWNER))


def _balance(cid):
    return round(float(run(server.db.clients.find_one({"id": cid}))["account_balance"] or 0), 2)


def _ledger_clients(booking_id):
    return {r["client_id"] for r in run(server.db.payment_ledger.find({"booking_id": booking_id}).to_list(20))}


def _friend_untouched(friend):
    assert _balance(friend["client"]) == 0.0
    assert run(server.db.payment_ledger.count_documents({"client_id": friend["client"]})) == 0
    assert run(server.db.retail_sales.count_documents({"client_id": friend["client"]})) == 0


def test_refunding_the_friends_dogs_visit_gives_the_money_back_to_the_payer():
    with _group() as (payer, friend, _svc):
        _checkout(friend["booking"])
        run(server.booking_refund(friend["booking"], server.BookingRefundIn(
            amount=15.0, payment_method="check", reason="the dog was sick", idempotency_key=f"{TAG}-{uuid.uuid4()}"), OWNER))
        refund = run(server.db.retail_sales.find_one({"booking_id": friend["booking"], "source_kind": "refund"}, {"_id": 0}))
        assert refund["client_id"] == payer["client"] and refund["client_name"].endswith("payer")
        assert _ledger_clients(friend["booking"]) <= {payer["client"]}
        _friend_untouched(friend)


def test_reopening_the_friends_dogs_checkout_takes_the_charge_off_the_payers_tab():
    with _group() as (payer, friend, _svc):
        _checkout(friend["booking"], payment_status="paid_partial", amount_paid=0.0)
        assert _balance(payer["client"]) == 15.0
        run(server.reopen_booking_checkout(friend["booking"], server.BookingReopenCheckoutIn(reason="wrong price"), OWNER))
        assert _balance(payer["client"]) == 0.0
        assert _ledger_clients(friend["booking"]) == {payer["client"]}
        _friend_untouched(friend)


def test_a_price_correction_on_the_friends_dog_moves_the_payers_tab():
    with _group() as (payer, friend, _svc):
        _checkout(friend["booking"], payment_status="paid_partial", amount_paid=0.0)
        run(server.booking_financial_adjustment(friend["booking"], server.BookingFinancialAdjustmentIn(
            kind="discount", amount=5.0, reason="loyal friend", idempotency_key=f"{TAG}-{uuid.uuid4()}"), OWNER))
        assert _balance(payer["client"]) == 10.0
        _friend_untouched(friend)


def test_end_of_day_finds_the_friends_dog_owed_on_the_payers_tab_and_says_who_pays():
    with _group() as (payer, friend, _svc):
        _checkout(friend["booking"], payment_status="paid_partial", amount_paid=0.0)
        row = run(server.db.bookings.find_one({"id": friend["booking"]}, end_of_day._CHECKOUT_FIELDS))
        [owed] = run(end_of_day.unpaid([row]))
        assert owed["amount"] == 15.0 and owed["billed_to"].endswith("payer")


def test_the_pls_top_clients_count_the_money_under_the_family_that_paid():
    with _group() as (payer, friend, _svc):
        _checkout(friend["booking"])
        day = server.business_today().isoformat()
        tops = {c["client_id"]: c["total"] for c in run(pl_report.build_pl_data(server.db, day, day))["top_clients"]}
        assert tops.get(payer["client"]) == 15.0 and friend["client"] not in tops


def test_a_friends_and_family_dog_is_no_sibling_for_the_same_day_discount():
    """The friend's family's OTHER dog, on its own booking the same day, pays
    full price — the friend's dog on the group is not its household sibling."""
    with _group(friend_dogs=2) as (_payer, friend, svc):
        own = run(server.create_booking(server.BookingIn(dog_id=friend["dogs"][1], date=server.business_today().isoformat(),
                                                         service_type="daycare", service_id=svc["id"], override_capacity=True,
                                                         override_vaccines=True), OWNER))
        run(server.check_in(own["id"], server.CheckInIn(vaccine_ack=True), OWNER))
        run(server.db.bookings.update_one({"id": own["id"]}, {"$set": {"checked_in_at": _eight_hours_ago()}}))
        _checkout(friend["booking"])
        _checkout(own["id"])
        mine = run(server.db.bookings.find_one({"id": own["id"]}))
        assert not (mine.get("multi_dog_discount") or {}).get("amount") and mine["actual_price"] == 40.0
