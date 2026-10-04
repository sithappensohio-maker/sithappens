"""The same-day second-dog discount needs another dog of the same family on the
SAME service that day (audit: "Same-day multi-dog discount at checkout doesn't
check the service or the dog"). A daycare visit is not a second dog for a
grooming, and a dog's own earlier visit is not a sibling. Disposable tag
TEST_MD_SERVICE."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_MD_SERVICE"
DAY = "2031-05-12"


def _row(cid, dog_id, service_type, status="completed", **over):
    doc = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "client_id": cid, "dog_id": dog_id, "dog_name": "d",
           "service_type": service_type, "date": DAY, "status": status,
           "checked_out_at": "2031-05-12T20:00:00+00:00", "estimated_price": 40.0, "tag": TAG,
           "created_at": server.now_iso()}
    doc.update(over)
    run(server.db.bookings.insert_one(dict(doc)))
    return doc


@pytest.fixture()
def family():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
    dog_a, dog_b = f"{TAG}-dogA-{uuid.uuid4().hex[:4]}", f"{TAG}-dogB-{uuid.uuid4().hex[:4]}"
    before = run(server.get_settings()) and run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"multi_dog_discount_enabled": True,
                                                                  "multi_dog_discount_mode": "percent",
                                                                  "multi_dog_discount_value": 50}}))
    yield cid, dog_a, dog_b
    run(server.db.settings.replace_one({"id": "global"}, before))
    run(server.db.bookings.delete_many({"tag": TAG}))


def test_a_daycare_sibling_does_not_discount_a_grooming_dog(family):
    cid, dog_a, dog_b = family
    _row(cid, dog_a, "daycare")
    groom = _row(cid, dog_b, "grooming", status="approved", checked_out_at=None, actual_price=40.0)
    assert run(server._compute_multi_dog_discount(groom)) is None, "a daycare visit is not a second dog for a grooming"


def test_a_second_dog_of_the_same_service_is_still_discounted(family):
    cid, dog_a, dog_b = family
    _row(cid, dog_a, "daycare")
    day_b = _row(cid, dog_b, "daycare", status="approved", checked_out_at=None, actual_price=40.0)
    out = run(server._compute_multi_dog_discount(day_b))
    assert out is not None, "the usual case keeps its discount"


def test_the_same_dogs_earlier_visit_is_not_a_sibling(family):
    cid, dog_a, _dog_b = family
    _row(cid, dog_a, "daycare")
    again = _row(cid, dog_a, "daycare", status="approved", checked_out_at=None, actual_price=40.0)
    assert run(server._compute_multi_dog_discount(again)) is None, "a dog is not its own sibling"


def _predicted_discounts(obj, found=None):
    found = [] if found is None else found
    if isinstance(obj, dict):
        if "checkout_preview_discount" in obj:
            found.append(obj["checkout_preview_discount"])
        for v in obj.values():
            _predicted_discounts(v, found)
    elif isinstance(obj, list):
        for v in obj:
            _predicted_discounts(v, found)
    return found


def test_the_household_preview_does_not_count_the_dogs_own_earlier_visit(family):
    """The ticket preview uses the same rule: a dog's own earlier visit that
    day is not a sibling, so its predicted discount is zero."""
    cid, dog_a, _dog_b = family
    _row(cid, dog_a, "daycare")
    anchor = _row(cid, dog_a, "daycare", status="checked_in", checked_out_at=None, actual_price=40.0,
                  checked_in_at="2031-05-12T13:00:00+00:00")
    out = run(server.checkout_group_preview(anchor["id"], {"id": f"{TAG}-admin", "role": "admin"}))
    assert _predicted_discounts(out) and all(d == 0 for d in _predicted_discounts(out)), \
        "a dog's own earlier visit does not discount its own ticket"
