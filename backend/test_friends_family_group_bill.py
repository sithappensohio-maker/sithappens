"""Friends & family groups: ONE bill for every dog, however they are picked
up (build step 7; owner request 2026-09-28). The switch is on in these tests
only.

The owner's rules: the payer pays a single bill for all the dogs, and the dogs
may be picked up at different times. Each dog's checkout puts its visit on the
payer's account; when the last dog of the group has left, one bill is made on
the payer covering every dog. All the dogs leaving together is the same, in
one go. A dog that is cancelled, or never comes (its day has passed), stops
holding the bill up; staff can close the bill at any time. The payer pays the
bill at the desk or online; the friend's family never sees it.

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

TAG = "TEST_FF_BILL"
OWNER = {"id": "ffb-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


def _day(off=0):
    return (server.business_today() + timedelta(days=off)).isoformat()


@contextlib.contextmanager
def _group(arrived=("payer", "friend")):
    """The payer ($30 special rate on a $40 daycare) and a friend's family,
    one dog each on a friends & family group today; `arrived` are checked in."""
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    run(server.db.services.insert_one(dict(svc)))
    fams = {}
    for who in ("payer", "friend"):
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": "active", "account_balance": 0.0}))
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
        fams[who] = {"client": cid, "dog": did, "user": {"id": f"u-{cid}", "role": "client", "client_id": cid}}
    payer, friend = fams["payer"], fams["friend"]
    run(server.db.price_overrides.insert_one({"id": str(uuid.uuid4()), "client_id": payer["client"], "target_kind": "service",
                                              "target_code": svc["id"], "override_price": 30.0, "created_at": server.now_iso()}))
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=payer["dog"]), server.BookingGroupDog(dog_id=friend["dog"])],
                                 date=_day(), service_type="daycare", service_id=svc["id"], override_capacity=True,
                                 override_vaccines=True, payer_client_id=payer["client"])
    out = run(server.create_booking_group(body, OWNER))
    rows = {r["dog_id"]: r for r in out["bookings"]}
    earlier = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    for who, f in fams.items():
        f["booking"] = rows[f["dog"]]["id"]
        if who in arrived:
            run(server.check_in(f["booking"], server.CheckInIn(vaccine_ack=True), OWNER))
            run(server.db.bookings.update_one({"id": f["booking"]}, {"$set": {"checked_in_at": earlier}}))
    try:
        yield payer, friend, out["group_id"]
    finally:
        for f in fams.values():
            for coll in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "checkout_groups"):
                run(server.db[coll].delete_many({"client_id": f["client"]}))
            run(server.db.bookings.delete_many({"dog_id": f["dog"]}))
            run(server.db.dogs.delete_one({"id": f["dog"]}))
            run(server.db.clients.delete_one({"id": f["client"]}))
            run(server.db.price_overrides.delete_many({"client_id": f["client"]}))
        run(server.db.services.delete_one({"id": svc["id"]}))


def _out(booking_id, **body):
    return run(server.check_out(booking_id, server.CheckoutIn(use_credits=True, **body), OWNER))


def _bills(payer):
    return run(server.db.invoices.find({"client_id": payer["client"], "status": {"$ne": "VOID"}}, {"_id": 0}).to_list(10))


def _balance(cid):
    return round(float(run(server.db.clients.find_one({"id": cid}))["account_balance"] or 0), 2)


@pytest.mark.parametrize("first", ["friend", "payer"])
def test_dogs_picked_up_at_different_times_get_one_bill_when_the_last_leaves(first):
    with _group() as (payer, friend, _gid):
        dogs = {"friend": friend, "payer": payer}
        second = "payer" if first == "friend" else "friend"
        early = _out(dogs[first]["booking"])
        assert early.get("group_bill") is None and _bills(payer) == [], "no bill while a dog is still here"
        late = _out(dogs[second]["booking"])
        [bill] = _bills(payer)
        assert late["group_bill"]["id"] == bill["id"]
        assert sorted(bill["booking_ids"]) == sorted([payer["booking"], friend["booking"]])
        assert bill["total"] == 45.0 and bill["balance"] == 45.0 and bill["status"] == "OPEN"
        assert _balance(payer["client"]) == 45.0 and _balance(friend["client"]) == 0.0
        assert run(server.db.invoices.count_documents({"client_id": friend["client"]})) == 0


def test_dogs_leaving_together_get_one_bill_in_one_go():
    with _group() as (payer, friend, _gid):
        out = run(server.check_out_group(friend["booking"], server.CheckoutIn(use_credits=True), OWNER))
        [bill] = _bills(payer)
        assert out["invoice"]["id"] == bill["id"] and bill["total"] == 45.0
        for f in (payer, friend):
            assert run(server.db.bookings.find_one({"id": f["booking"]}))["status"] == "completed"


def test_the_checkout_screen_lists_every_dog_of_the_group_whichever_family():
    with _group() as (payer, friend, _gid):
        anchor = run(server.db.bookings.find_one({"id": friend["booking"]}, {"_id": 0}))
        rows = run(server._active_household_checkout_rows(anchor))
        assert sorted(r["id"] for r in rows) == sorted([payer["booking"], friend["booking"]])


def test_a_cancelled_dog_stops_holding_the_bill_up():
    with _group(arrived=("friend",)) as (payer, friend, _gid):
        _out(friend["booking"])
        assert _bills(payer) == [], "the payer's dog is still expected today"
        run(server.cancel_booking(payer["booking"], forfeit=False, user=OWNER))
        [bill] = _bills(payer)
        # The owner's rule: the multi-dog discount needs another dog of the
        # booking to have come — none did, so the friend's dog is billed at the
        # first-dog price ($30, the payer's rate), still to the payer.
        assert bill["booking_ids"] == [friend["booking"]] and bill["total"] == 30.0


def test_a_dog_that_never_came_stops_holding_the_bill_up_once_its_day_has_passed():
    with _group(arrived=("friend",)) as (payer, friend, _gid):
        _out(friend["booking"])
        assert run(friends_family.sweep_group_bills()) == 0 and _bills(payer) == []
        run(server.db.bookings.update_one({"id": payer["booking"]}, {"$set": {"date": _day(-1)}}))   # the day went by
        assert run(friends_family.sweep_group_bills()) >= 1
        [bill] = _bills(payer)
        assert bill["booking_ids"] == [friend["booking"]]


def test_staff_can_close_the_bill_now_while_a_dog_stays_on():
    with _group() as (payer, friend, gid):
        _out(friend["booking"])
        route = next(r for r in server.app.routes if getattr(r, "path", "").endswith("/bookings/group/{group_id}/close-bill"))
        bill = run(route.endpoint(gid, user=OWNER))
        assert bill["booking_ids"] == [friend["booking"]]
        with pytest.raises(HTTPException) as e:
            run(route.endpoint(gid, user=OWNER))
        assert e.value.status_code == 409, "nothing more waiting to be billed"


def test_the_payer_pays_the_one_bill_at_the_desk():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        _out(payer["booking"])
        [bill] = _bills(payer)
        run(server.create_invoice_payment(bill["id"], server.InvoicePaymentIn(
            amount=45.0, method="check", idempotency_key=f"{TAG}-{uuid.uuid4()}"), user=OWNER))
        paid = run(server.db.invoices.find_one({"id": bill["id"]}, {"_id": 0}))
        assert paid["status"] == "PAID" and paid["balance"] == 0.0
        assert _balance(payer["client"]) == 0.0 and _balance(friend["client"]) == 0.0


def test_reopening_a_dog_before_the_bill_is_paid_rebuilds_the_same_bill():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        _out(payer["booking"])
        [bill] = _bills(payer)
        run(server.reopen_booking_checkout(friend["booking"], server.BookingReopenCheckoutIn(reason="wrong price"), OWNER))
        _out(friend["booking"], base_price=10.0, base_price_reason="friend discount")
        [again] = _bills(payer)
        assert again["id"] == bill["id"] and again["total"] == 40.0, "$30 + the corrected $10"
        assert _balance(payer["client"]) == 40.0


def test_only_the_payer_sees_the_bill_in_the_portal():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        _out(payer["booking"])
        assert len(run(server.portal_invoices(user=payer["user"]))["invoices"]) == 1
        assert run(server.portal_invoices(user=friend["user"]))["invoices"] == []


def test_two_paying_families_never_share_one_bill():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        # A visit of a third family, paid by that family itself.
        stranger = f"{TAG}-other-{uuid.uuid4().hex[:8]}"
        run(server.db.bookings.insert_one({"id": stranger, "client_id": f"{TAG}-third-family", "dog_id": f"{TAG}-other-dog",
                                           "dog_name": "Rex", "client_name": "Third", "service_type": "daycare", "date": _day(),
                                           "status": "completed", "checked_out_at": server.now_iso(), "actual_price": 40.0,
                                           "balance_due": 40.0, "amount_paid": 0.0, "payment_status": "paid_partial"}))
        try:
            with pytest.raises(HTTPException) as e:
                run(server._create_invoice_for_bookings([friend["booking"], stranger], user=OWNER, ts=server.now_iso()))
            assert e.value.status_code == 409 and "different families" in e.value.detail
        finally:
            run(server.db.bookings.delete_one({"id": stranger}))


def test_leaving_together_puts_a_manual_price_only_on_the_dog_whose_button_was_clicked():
    with _group() as (payer, friend, _gid):
        run(server.check_out_group(friend["booking"], server.CheckoutIn(
            use_credits=True, base_price=10.0, base_price_reason="friend discount"), OWNER))
        [bill] = _bills(payer)
        assert bill["total"] == 40.0, "the payer's dog keeps its $30; only the friend's dog is $10"


def test_products_at_a_friends_and_family_checkout_are_sent_to_the_register():
    with _group() as (payer, friend, _gid):
        with pytest.raises(HTTPException) as e:
            _out(friend["booking"], retail_lines=[{"product_id": "x", "quantity": 1}])
        assert e.value.status_code == 400 and "Register" in e.value.detail


def test_a_familys_own_checkout_never_sweeps_in_its_dog_on_a_friends_and_family_booking():
    """The friend's family also has a dog of its own here today, which it
    pays for itself: its checkout leaves the covered dog alone."""
    with _group() as (payer, friend, _gid):
        own_dog, own = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": own_dog, "name": f"{TAG} own dog", "owner_id": friend["client"], "breed": "Mix",
                                       "age_y": 3, "vaccines": dict(VAX)}))
        try:
            run(server.db.bookings.insert_one({
                "id": own, "client_id": friend["client"], "client_name": f"{TAG} friend", "dog_id": own_dog,
                "dog_name": f"{TAG} own dog", "service_type": "daycare", "date": _day(), "status": "approved",
                "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat(), "price": 40.0}))
            anchor = run(server.db.bookings.find_one({"id": own}, {"_id": 0}))
            assert [r["id"] for r in run(server._active_household_checkout_rows(anchor))] == [own]
            with pytest.raises(HTTPException) as e:
                run(server.check_out_group(own, server.CheckoutIn(use_credits=True), OWNER))
            assert e.value.status_code == 409
            assert run(server.db.bookings.find_one({"id": friend["booking"]}))["status"] != "completed"
        finally:
            run(server.db.dogs.delete_one({"id": own_dog}))


def test_the_payers_account_takes_no_payment_or_write_off_while_its_dogs_wait_for_their_bill():
    """Money taken off the account now would leave the coming bill wrong:
    it is taken on the bill instead."""
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        assert _balance(payer["client"]) == 15.0
        with pytest.raises(HTTPException) as e:
            run(server.apply_tab_payment(payer["client"], server.TabPaymentIn(amount=15.0, method="check"), user=OWNER))
        assert e.value.status_code == 409 and "one bill" in e.value.detail
        with pytest.raises(HTTPException) as e:
            run(server.apply_tab_adjustment(payer["client"], server.TabAdjustmentIn(amount=-15.0, notes="forgive"), user=OWNER))
        assert e.value.status_code == 409 and "one bill" in e.value.detail
        assert _balance(payer["client"]) == 15.0


def test_a_price_correction_waits_for_the_group_bill():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        with pytest.raises(HTTPException) as e:
            run(server.booking_financial_adjustment(friend["booking"], server.BookingFinancialAdjustmentIn(
                kind="discount", amount=5.0, reason="loyal friend", idempotency_key=f"{TAG}-{uuid.uuid4()}"), OWNER))
        assert e.value.status_code == 409 and "reopen" in e.value.detail
        assert _balance(payer["client"]) == 15.0


def test_a_refused_checkout_leaves_nothing_waiting_for_the_bill():
    """Refused inside the checkout: a daycare dog still here from yesterday
    must be answered for first."""
    with _group() as (payer, friend, _gid):
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {
            "date": _day(-1), "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()}}))
        with pytest.raises(HTTPException):
            _out(friend["booking"])
        assert not run(server.db.bookings.find_one({"id": friend["booking"]})).get("group_bill_pending")


def _long_ago():
    return (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()


def test_a_bill_whose_making_stopped_part_way_is_made_by_a_later_sweep():
    with _group(arrived=("friend",)) as (payer, friend, _gid):
        _out(friend["booking"])
        run(server.db.bookings.update_one({"id": payer["booking"]}, {"$set": {"date": _day(-1)}}))   # never came
        # A bill was being made when the server stopped: the visit is claimed, no bill exists.
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {
            "group_bill_pending": False, "group_bill_claim": "died", "group_bill_claimed_at": server.now_iso()}}))
        run(friends_family.sweep_group_bills())
        assert _bills(payer) == [], "a fresh claim may still be finishing"
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {"group_bill_claimed_at": _long_ago()}}))
        run(friends_family.sweep_group_bills())
        [bill] = _bills(payer)
        assert bill["booking_ids"] == [friend["booking"]]
        row = run(server.db.bookings.find_one({"id": friend["booking"]}))
        assert not row.get("group_bill_pending") and not row.get("group_bill_claim")


def test_a_claim_left_behind_after_its_bill_was_made_is_just_tidied():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        _out(payer["booking"])
        [bill] = _bills(payer)
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {
            "group_bill_claim": "died", "group_bill_claimed_at": _long_ago()}}))
        run(friends_family.sweep_group_bills())
        [after] = _bills(payer)
        assert after["id"] == bill["id"], "never a second bill"
        assert sorted(after["booking_ids"]) == sorted(bill["booking_ids"]) and after["total"] == 45.0
        assert after.get("rebuilt_at") == bill.get("rebuilt_at"), "the bill is left exactly as it was"
        assert not run(server.db.bookings.find_one({"id": friend["booking"]})).get("group_bill_claim")


def test_the_sweep_never_makes_the_bill_while_the_last_dog_is_being_checked_out():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        # Half-way through the payer's dog's checkout: already marked as gone
        # and waiting for the bill, but its checkout hasn't finished.
        run(server.db.bookings.update_one({"id": payer["booking"]}, {"$set": {
            "status": "completed", "checked_out_at": server.now_iso(), "group_bill_pending": True,
            "checkout_in_progress": True, "checkout_started_at": server.now_iso()}}))
        run(friends_family.sweep_group_bills())
        assert _bills(payer) == [], "that checkout makes the bill itself when it finishes"


def test_the_sweep_waits_while_the_payers_money_is_being_worked_on():
    with _group(arrived=("friend",)) as (payer, friend, _gid):
        _out(friend["booking"])
        run(server.db.bookings.update_one({"id": payer["booking"]}, {"$set": {"date": _day(-1)}}))   # never came
        run(server.db.clients.update_one({"id": payer["client"]}, {"$set": {
            "financial_checkout_in_progress": True, "financial_checkout_started_at": server.now_iso()}}))
        run(friends_family.sweep_group_bills())
        assert _bills(payer) == [], "a checkout for the payer is under way"
        run(server.db.clients.update_one({"id": payer["client"]}, {"$set": {"financial_checkout_in_progress": False}}))
        run(friends_family.sweep_group_bills())
        assert len(_bills(payer)) == 1


def test_a_dog_reopened_and_then_cancelled_never_holds_the_payers_account():
    with _group() as (payer, friend, _gid):
        _out(friend["booking"])
        run(server.reopen_booking_checkout(friend["booking"], server.BookingReopenCheckoutIn(reason="checked out by mistake"), OWNER))
        assert not run(server.db.bookings.find_one({"id": friend["booking"]})).get("group_bill_pending")
        run(server.cancel_booking(friend["booking"], forfeit=False, user=OWNER, undo_check_in=True))
        _out(payer["booking"])
        [bill] = _bills(payer)
        assert bill["booking_ids"] == [payer["booking"]]
        assert not run(friends_family.waiting_for_group_bill(payer["client"]))
        # ...even had the mark been left on the cancelled visit.
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {"group_bill_pending": True}}))
        assert not run(friends_family.waiting_for_group_bill(payer["client"]))
        run(server.create_invoice_payment(bill["id"], server.InvoicePaymentIn(
            amount=bill["balance"], method="check", idempotency_key=f"{TAG}-{uuid.uuid4()}"), user=OWNER))
        run(server.apply_tab_payment(payer["client"], server.TabPaymentIn(amount=5.0, method="check"), user=OWNER))
        assert _balance(payer["client"]) == -5.0


def test_a_boarding_dog_whose_stay_was_changed_leaves_on_its_own_day():
    with _group() as (payer, friend, _gid):
        run(server.db.bookings.update_many({"id": {"$in": [payer["booking"], friend["booking"]]}},
                                           {"$set": {"service_type": "boarding", "end_date": _day(1)}}))
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {"end_date": _day(3)}}))   # staying on
        anchor = run(server.db.bookings.find_one({"id": payer["booking"]}, {"_id": 0}))
        assert [r["id"] for r in run(server._active_household_checkout_rows(anchor))] == [payer["booking"]]


def test_a_visit_waiting_for_its_group_bill_is_never_archived():
    with _group(arrived=("friend",)) as (payer, friend, _gid):
        _out(friend["booking"])
        old = (server.business_today() - timedelta(days=200)).isoformat()
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {"date": old}}))
        try:
            run(server._archive_old_bookings_once())
            assert run(server.db.bookings.find_one({"id": friend["booking"]})), "still live, still to be billed"
            assert run(friends_family.close_group_bill(_gid, OWNER, force=True))["booking_ids"] == [friend["booking"]]
        finally:
            run(server.db.bookings_archive.delete_many({"client_id": {"$in": [payer["client"], friend["client"]]}}))


def test_an_account_payment_waits_while_a_checkout_for_that_family_is_under_way():
    with _group() as (payer, friend, _gid):
        run(server.db.clients.update_one({"id": payer["client"]}, {"$set": {
            "financial_checkout_in_progress": True, "financial_checkout_started_at": server.now_iso()}}))
        with pytest.raises(HTTPException) as e:
            run(server.apply_tab_payment(payer["client"], server.TabPaymentIn(amount=5.0, method="check"), user=OWNER))
        assert e.value.status_code == 409
        run(server.db.clients.update_one({"id": payer["client"]}, {"$set": {"financial_checkout_in_progress": False}}))
        run(server.apply_tab_payment(payer["client"], server.TabPaymentIn(amount=5.0, method="check"), user=OWNER))
        assert _balance(payer["client"]) == -5.0
