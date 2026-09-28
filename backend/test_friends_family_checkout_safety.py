"""Friends & family checkout: the edges (build step 5 review findings;
owner request 2026-09-28). The switch is on in these tests only.

  * a checkout of the friend's dog that fails part-way — even an ordinary
    refusal ("Other" with no note) — undoes exactly the family whose money it
    touched (the payer). It used to write the payer's saved balance and
    credits onto the FRIEND's account and leave the payer's tab changed;
  * a boarding dog picked up late pays the late-pickup day at the PAYER's
    rate, so the charge matches the price quoted at booking;
  * a visit someone else paid for earns no referral reward — and does not use
    up the friend's family's first visit: their first self-paid visit still
    earns it.

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

TAG = "TEST_FF_SAFETY"
OWNER = {"id": "ffs-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}
MONEY = ("account_balance", "credits", "boarding_credits", "training_credits")


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


def _day(off=0):
    return (server.business_today() + timedelta(days=off)).isoformat()


@contextlib.contextmanager
def _group(service_type="daycare", end_date=None, pickup_time="", friend_rates=None, start=None, checked_in=True):
    """Default daycare ($40) and boarding ($50) services. The payer has special
    rates ($30 daycare, $45 boarding) and money on file; the friend's family
    has different money on file. One dog each, checked in 8 hours ago."""
    was_default = [s["id"] for s in run(server.db.services.find({"is_default": True}, {"_id": 0, "id": 1}).to_list(200))]
    run(server.db.services.update_many({"id": {"$in": was_default}}, {"$set": {"is_default": False}}))
    day = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True, "is_default": True}
    board = {"id": str(uuid.uuid4()), "name": f"{TAG} Boarding", "service_type": "boarding", "base_price": 50.0, "active": True, "is_default": True}
    run(server.db.services.insert_many([dict(day), dict(board)]))
    fams = {}
    money = {"payer": {"credits": 7, "boarding_credits": 2, "account_balance": 12.5},
             "friend": {"credits": 5, "boarding_credits": 3, "training_credits": 4, "account_balance": 0.0}}
    for who in ("payer", "friend"):
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": "active", "referral_code": f"R{uuid.uuid4().hex[:6].upper()}",
                                          **money[who]}))
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
        fams[who] = {"client": cid, "dog": did}
    payer, friend = fams["payer"], fams["friend"]
    run(server.db.clients.update_one({"id": friend["client"]}, {"$set": {
        "referred_by_code": run(server.db.clients.find_one({"id": payer["client"]}))["referral_code"]}}))
    rates = [(payer["client"], day["id"], 30.0), (payer["client"], board["id"], 45.0)]
    rates += [(friend["client"], {"day": day, "board": board}[k]["id"], v) for k, v in (friend_rates or {}).items()]
    for cid, sid, price in rates:
        run(server.db.price_overrides.insert_one({"id": str(uuid.uuid4()), "client_id": cid, "target_kind": "service",
                                                  "target_code": sid, "override_price": price, "created_at": server.now_iso()}))
    svc = day if service_type == "daycare" else board
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=payer["dog"]), server.BookingGroupDog(dog_id=friend["dog"])],
                                 date=start or (_day(-1) if end_date else _day()), end_date=end_date, service_type=service_type,
                                 service_id=svc["id"], pickup_time=pickup_time, override_capacity=True, override_vaccines=True,
                                 payer_client_id=payer["client"])
    rows = {r["dog_id"]: r for r in run(server.create_booking_group(body, OWNER))["bookings"]}
    earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    for f in fams.values():
        f["booking"] = rows[f["dog"]]["id"]
        if checked_in:
            run(server.check_in(f["booking"], server.CheckInIn(vaccine_ack=True), OWNER))
            run(server.db.bookings.update_one({"id": f["booking"]}, {"$set": {"checked_in_at": earlier}}))
    try:
        yield payer, friend, day
    finally:
        for f in fams.values():
            for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "credit_lots", "referrals"):
                run(server.db[coll].delete_many({"client_id": f["client"]}))
            run(server.db.bookings.delete_many({"dog_id": f["dog"]}))
            run(server.db.referrals.delete_many({"referred_id": f["client"]}))
            run(server.db.dogs.delete_one({"id": f["dog"]}))
            run(server.db.clients.delete_one({"id": f["client"]}))
            run(server.db.price_overrides.delete_many({"client_id": f["client"]}))
        run(server.db.services.delete_many({"id": {"$in": [day["id"], board["id"]]}}))
        run(server.db.services.update_many({"id": {"$in": was_default}}, {"$set": {"is_default": True}}))


def _money(cid):
    c = run(server.db.clients.find_one({"id": cid}, {"_id": 0}))
    return {k: c.get(k, "<absent>") for k in MONEY}


def _checkout(booking_id, **body):
    """A friends & family dog pays nothing at its checkout (its visit goes on
    the payer's account; the group's one bill is paid later) — any other
    visit is paid by check."""
    ff = run(server.db.bookings.find_one({"id": booking_id}, {"_id": 0, "bill_to_client_id": 1})).get("bill_to_client_id")
    payload = {"use_credits": True} if ff else {"use_credits": True, "payment_method": "check", "payment_status": "paid"}
    payload.update(body)
    return run(server.check_out(booking_id, server.CheckoutIn(**payload), OWNER))


def test_a_refused_checkout_of_the_friends_dog_leaves_both_families_exactly_as_they_were():
    """Refused INSIDE the checkout, after the payer was locked and saved: a
    daycare dog still here from yesterday must be answered for first."""
    with _group() as (payer, friend, _day_svc):
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {
            "date": _day(-1), "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()}}))
        before = (_money(payer["client"]), _money(friend["client"]))
        with pytest.raises(HTTPException) as e:
            _checkout(friend["booking"])
        assert e.value.status_code == 409
        assert (_money(payer["client"]), _money(friend["client"])) == before


def test_a_checkout_that_fails_after_the_tab_moved_puts_the_payers_tab_back(monkeypatch):
    with _group() as (payer, friend, _day_svc):
        before = (_money(payer["client"]), _money(friend["client"]))
        real = server._adjust_client_balance

        async def moved_then_failed(client_id, delta):
            await real(client_id, delta)
            raise RuntimeError("database went away")
        monkeypatch.setattr(server, "_adjust_client_balance", moved_then_failed)
        with pytest.raises(HTTPException):
            _checkout(friend["booking"], payment_status="paid_partial", amount_paid=0.0)
        assert (_money(payer["client"]), _money(friend["client"])) == before
        assert run(server.db.payment_ledger.count_documents({"booking_id": friend["booking"]})) == 0


def test_a_boarding_dog_picked_up_late_pays_the_late_day_at_the_payers_rate():
    """One night at the payer's $45 plus the late-pickup day at the payer's
    $30 daycare rate, at the extra-dog half: $37.50 — what was quoted."""
    with _group(service_type="boarding", end_date=_day(), pickup_time="20:00") as (_payer, friend, _day_svc):
        quoted = run(server.db.bookings.find_one({"id": friend["booking"]}))["estimated_price"]
        _checkout(friend["booking"])
        charged = run(server.db.bookings.find_one({"id": friend["booking"]}))["actual_price"]
        assert quoted == 37.5 and charged == quoted


def test_the_friends_familys_first_self_paid_visit_still_earns_the_referral():
    with _group() as (payer, friend, day_svc):
        _checkout(friend["booking"])
        assert run(server.db.referrals.count_documents({"referred_id": friend["client"]})) == 0, "not for the covered visit"
        own = run(server.create_booking(server.BookingIn(dog_id=friend["dog"], date=_day(), service_type="daycare",
                                                         service_id=day_svc["id"], override_capacity=True, override_vaccines=True),
                                        OWNER))
        run(server.db.bookings.update_one({"dog_id": friend["dog"], "id": {"$ne": friend["booking"]}},
                                          {"$set": {"checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()}}))
        _checkout(own["id"])
        assert run(server.db.referrals.count_documents({"referred_id": friend["client"]})) == 1


def test_the_payers_other_dog_that_day_keeps_its_household_discount():
    """The payer's own dog on the group is the payer's household — only a dog
    ANOTHER family paid for is left out of the same-day multi-dog discount."""
    with _group() as (payer, friend, day_svc):
        second = str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": second, "name": f"{TAG} payer second", "owner_id": payer["client"], "breed": "Mix",
                                       "age_y": 2, "vaccines": dict(VAX)}))
        try:
            own = run(server.create_booking(server.BookingIn(dog_id=second, date=_day(), service_type="daycare",
                                                             service_id=day_svc["id"], override_capacity=True,
                                                             override_vaccines=True), OWNER))
            run(server.check_in(own["id"], server.CheckInIn(vaccine_ack=True), OWNER))
            run(server.db.bookings.update_one({"id": own["id"]}, {"$set": {
                "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()}}))
            _checkout(payer["booking"])            # the payer's dog on the group, full price
            _checkout(own["id"])
            mine = run(server.db.bookings.find_one({"id": own["id"]}))
            assert mine["actual_price"] == 15.0 and mine["multi_dog_discount"]["amount"] == 15.0
        finally:
            run(server.db.bookings.delete_many({"dog_id": second}))
            run(server.db.dogs.delete_one({"id": second}))


def test_the_early_checkout_quote_for_a_friends_dog_uses_the_payers_rates():
    with _group(service_type="boarding", start=_day(-2), end_date=_day(2), friend_rates={"board": 60.0}) as (_p, friend, _d):
        quote = run(server.early_checkout_quote(friend["booking"], OWNER))
        assert quote["applicable"] and quote["unit_price"] == 45.0


def test_extras_at_check_in_and_the_checkout_preview_use_the_payers_rates():
    with _group(friend_rates={"day": 36.0}, checked_in=False) as (_payer, friend, day_svc):
        trim = {"id": str(uuid.uuid4()), "name": f"{TAG} Nail trim", "service_type": "grooming", "base_price": 10.0,
                "active": True, "is_addon": True, "addon_for": ["daycare"]}
        run(server.db.services.insert_one(dict(trim)))
        run(server.db.price_overrides.insert_one({"id": str(uuid.uuid4()), "client_id": _payer["client"], "target_kind": "service",
                                                  "target_code": trim["id"], "override_price": 5.0, "created_at": server.now_iso()}))
        try:
            run(server.check_in(friend["booking"], server.CheckInIn(vaccine_ack=True, addon_service_ids=[trim["id"]]), OWNER))
            row = run(server.db.bookings.find_one({"id": friend["booking"]}))
            assert [a["price"] for a in row["add_ons"]] == [5.0]
            run(server.db.bookings.update_one({"id": friend["booking"]}, {"$unset": {"estimated_price": ""}}))
            assert run(server.discount_preview(friend["booking"], OWNER))["preview_base_price"] == 30.0
        finally:
            run(server.db.services.delete_one({"id": trim["id"]}))
