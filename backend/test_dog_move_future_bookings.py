"""Moving a dog to another family moves its coming bookings; its past visits stay with
the family they were booked under (audit #26: "Moving a dog to another family leaves its
visits, bills... with the old family"). Far-future business date so the split is clean.
Disposable tag TEST_DOG_MOVE."""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_DOG_MOVE"
DAY = date(2031, 3, 5)
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner@test"}


@pytest.fixture()
def family(monkeypatch):
    monkeypatch.setattr(server, "business_today", lambda: DAY)
    a, b, dog = (f"{TAG}-{x}-{uuid.uuid4().hex[:6]}" for x in ("a", "b", "dog"))
    run(server.db.clients.insert_many([
        {"id": a, "name": "Old family", "email": f"{a}@example.com", "tag": TAG},
        {"id": b, "name": "New family", "email": f"{b}@example.com", "tag": TAG}]))
    run(server.db.dogs.insert_one({"id": dog, "owner_id": a, "name": f"{TAG} dog", "tag": TAG}))
    past, future = f"{TAG}-past-{uuid.uuid4().hex[:6]}", f"{TAG}-future-{uuid.uuid4().hex[:6]}"
    run(server.db.bookings.insert_many([
        {"id": past, "dog_id": dog, "client_id": a, "date": "2031-03-01", "status": "completed", "tag": TAG},
        {"id": future, "dog_id": dog, "client_id": a, "date": "2031-03-10", "status": "approved", "tag": TAG}]))
    yield {"a": a, "b": b, "dog": dog, "past": past, "future": future}
    run(server.db.bookings.delete_many({"tag": TAG}))
    run(server.db.dogs.delete_many({"tag": TAG}))
    run(server.db.clients.delete_many({"tag": TAG}))


def test_coming_visits_move_and_past_visits_stay(family):
    run(server.update_dog(family["dog"], server.DogIn(owner_id=family["b"], name=f"{TAG} dog"), ADMIN))
    assert run(server.db.bookings.find_one({"id": family["future"]}))["client_id"] == family["b"]
    assert run(server.db.bookings.find_one({"id": family["past"]}))["client_id"] == family["a"]
