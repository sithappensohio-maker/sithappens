"""Friends & family groups: what each family sees (build step 4; owner
request 2026-09-28). The switch is on in these tests only.

The owner's rule: each family sees only its own dog. The friend's family sees
its dog's visit — dates, status, care — but never a price, a discount, the
group, or who is paying ("Covered — nothing to pay"). The payer sees its own
dog as usual. Staff see who pays. The friend's family can't add or remove
extras online (someone else pays), and a group note isn't copied onto the
friend's dog.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import friends_family

TAG = "TEST_FF_PORTAL"
OWNER = {"id": "ffp-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}
MONEY = ("estimated_price", "actual_price", "unit_price", "multi_dog_discount", "pricing_snapshot", "payment_status",
         "amount_paid", "balance_due", "credit_units_required", "cost", "bill_to_client_id", "bill_to_client_name", "group_id",
         "group_kind", "price_source", "price_label", "list_unit_price")


@pytest.fixture(autouse=True)
def _switched_on(monkeypatch):
    monkeypatch.setattr(friends_family, "ENABLED", True)


@contextlib.contextmanager
def _group(note="Both pick up at 5 — Dana is paying"):
    svc = {"id": str(uuid.uuid4()), "name": f"{TAG} Daycare", "service_type": "daycare", "base_price": 40.0, "active": True}
    addon = {"id": str(uuid.uuid4()), "name": f"{TAG} Nail trim", "service_type": "grooming", "base_price": 10.0,
             "active": True, "is_addon": True, "addon_for": ["daycare"]}
    run(server.db.services.insert_many([dict(svc), dict(addon)]))
    fams = {}
    for who in ("payer", "friend"):
        cid, did = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} {who}", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                          "client_status": "active"}))
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} {who} dog", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
        fams[who] = {"client": cid, "dog": did, "user": {"id": f"u-{cid}", "role": "client", "client_id": cid}}
    day = (server.business_today() + server.timedelta(days=3)).isoformat()
    body = server.BookingGroupIn(dogs=[server.BookingGroupDog(dog_id=fams["payer"]["dog"]),
                                       server.BookingGroupDog(dog_id=fams["friend"]["dog"], addon_service_ids=[addon["id"]])],
                                 date=day, service_type="daycare", service_id=svc["id"], notes=note,
                                 override_capacity=True, override_vaccines=True, payer_client_id=fams["payer"]["client"])
    out = run(server.create_booking_group(body, OWNER))
    rows = {r["dog_id"]: r for r in out["bookings"]}
    fams["payer"]["booking"] = rows[fams["payer"]["dog"]]["id"]
    fams["friend"]["booking"] = rows[fams["friend"]["dog"]]["id"]
    try:
        yield fams, out["group_id"], addon["id"]
    finally:
        for f in fams.values():
            run(server.db.bookings.delete_many({"dog_id": f["dog"]}))
            run(server.db.dogs.delete_one({"id": f["dog"]}))
            run(server.db.clients.delete_one({"id": f["client"]}))
        run(server.db.services.delete_many({"id": {"$in": [svc["id"], addon["id"]]}}))


def _listed(user, day_of=None):
    rows = run(server.list_bookings(user=user, include_all=True))
    return [r.model_dump() if hasattr(r, "model_dump") else r for r in rows]


def _no_money(row):
    leaked = {k: row.get(k) for k in MONEY if row.get(k) not in (None, "", 0, 0.0, [], {}, False)}
    assert leaked == {}, leaked


def test_the_friends_family_sees_its_dog_covered_with_no_money_and_no_payer():
    with _group() as (fams, _gid, _addon):
        friend = fams["friend"]
        listed = [r for r in _listed(friend["user"]) if r["id"] == friend["booking"]]
        assert len(listed) == 1 and listed[0]["covered_by_other"] is True
        _no_money(listed[0])
        one = run(server.get_booking(friend["booking"], friend["user"]))
        assert one["covered_by_other"] is True and one["dog_id"] == friend["dog"]
        _no_money(one)
        assert all("price" not in a for a in one.get("add_ons") or []), "the extra's name, never its price"
        assert all(fams["payer"]["dog"] != r["dog_id"] for r in _listed(friend["user"])), "never the other family's dog"


def test_the_group_shows_each_family_only_its_own_dog():
    with _group() as (fams, gid, _addon):
        for who, other in (("friend", "payer"), ("payer", "friend")):
            got = run(server.get_booking_group(gid, fams[who]["user"]))["bookings"]
            assert [b["dog_id"] for b in got] == [fams[who]["dog"]]
        _no_money(run(server.get_booking_group(gid, fams["friend"]["user"]))["bookings"][0])


def test_the_payer_sees_its_own_dog_as_usual_and_never_the_friends_dog():
    with _group() as (fams, _gid, _addon):
        payer = fams["payer"]
        mine = [r for r in _listed(payer["user"]) if r["id"] == payer["booking"]][0]
        assert mine["estimated_price"] == 40.0 and not mine["covered_by_other"]
        assert not mine.get("bill_to_client_id")
        with pytest.raises(HTTPException) as e:
            run(server.get_booking(fams["friend"]["booking"], payer["user"]))
        assert e.value.status_code == 403


def test_staff_see_who_pays():
    with _group() as (fams, _gid, _addon):
        row = [r for r in _listed(OWNER) if r["id"] == fams["friend"]["booking"]][0]
        assert row["bill_to_client_id"] == fams["payer"]["client"] and row["group_kind"] == "friends_family"
        assert row["estimated_price"] == 30.0   # $20 (the multi-dog discount off $40) + the $10 nail trim
        assert not row["covered_by_other"]


def test_the_group_note_is_not_copied_onto_the_friends_dog():
    with _group(note="Dana is paying for both") as (fams, _gid, _addon):
        assert "Dana" not in (run(server.db.bookings.find_one({"id": fams["friend"]["booking"]}))["notes"] or "")
        assert "Dana" in run(server.db.bookings.find_one({"id": fams["payer"]["booking"]}))["notes"]


def test_the_friends_family_cannot_change_extras_online(monkeypatch):
    with _group() as (fams, _gid, addon):
        friend = fams["friend"]
        with pytest.raises(HTTPException) as e:
            run(server.attach_booking_addons(friend["booking"], server.BookingAddonsIn(addon_service_ids=[addon]), friend["user"]))
        assert e.value.status_code == 403 and "Someone else is paying" in e.value.detail
        with pytest.raises(HTTPException) as e:
            run(server.remove_booking_addon(friend["booking"], 0, friend["user"]))
        assert e.value.status_code == 403
        added = run(server.attach_booking_addons(friend["booking"], server.BookingAddonsIn(addon_service_ids=[addon]), OWNER))
        assert [a["price"] for a in added["add_ons"]] == [10.0, 10.0], "staff can — at the payer's rates"


def test_the_friends_family_sees_every_care_log_of_its_dogs_visit():
    """Care is theirs to see — a word filter once hid the meal log ('fee' in
    'feeding'), the crate ('rate') and the play group ('group')."""
    with _group() as (fams, _gid, _addon):
        friend = fams["friend"]
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {
            "feeding_log": [{"note": "ate all", "at": server.now_iso()}], "medication_log": [{"name": "Apoquel"}],
            "bathroom_log": {"pee": 2}, "crate": "C3", "yard_group": "small dogs"}}))
        for row in ([r for r in _listed(friend["user"]) if r["id"] == friend["booking"]][0],
                    run(server.get_booking(friend["booking"], friend["user"]))):
            assert row["feeding_log"] and row["medication_log"] and row["bathroom_log"]
            assert row["crate"] == "C3" and row["yard_group"] == "small dogs"


def test_the_dogs_timeline_shows_the_friends_family_no_price():
    with _group() as (fams, _gid, _addon):
        friend = fams["friend"]
        run(server.db.bookings.update_one({"id": friend["booking"]}, {"$set": {"actual_price": 30.0, "status": "completed"}}))
        events = run(server.dog_timeline(friend["dog"], user=friend["user"]))
        visit = [e for e in (events.get("events") if isinstance(events, dict) else events) if e.get("kind") == "booking"]
        assert visit and all(not e.get("actual_price") for e in visit)
        staff = run(server.dog_timeline(friend["dog"], user=OWNER))
        staff_visit = [e for e in (staff.get("events") if isinstance(staff, dict) else staff) if e.get("kind") == "booking"]
        assert staff_visit[0]["actual_price"] == 30.0
