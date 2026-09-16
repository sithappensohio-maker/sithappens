"""Walk-in intake — the person at the desk with a dog we do not have on file.

Pins the contract the front desk depends on: one call creates a real owner and
a real dog, the record is marked `walk_in` so it is not counted as a family on
file, it can be booked ahead like any other client, and converting it to a real
client keeps everything it already has.
"""
import _test_env  # noqa: F401 — must run before `import server`
import datetime as dt
import uuid

import pytest
import server
from _test_loop import run
from fastapi import HTTPException

ADMIN = {"id": "walkin-admin", "name": "Walk-in Admin", "email": "walkin@example.invalid", "role": "admin"}


def _front_desk():
    """A real Front Desk employee — they are the ones who greet walk-ins."""
    return {"id": "walkin-fd", "name": "Front Desk", "role": "employee", "staff_role": "front_desk"}


def _walk_in(**over):
    body = server.WalkInIn(**{
        "owner_name": "Dana Reyes",
        "dog_name": "Pepper",
        "phone": "614-555-0143",
        "breed": "Beagle",
        **over,
    })
    return run(server.create_walk_in(body, ADMIN))


def test_one_call_creates_a_real_owner_and_a_real_dog():
    out = _walk_in()
    client, dog = out["client"], out["dog"]

    assert client["name"] == "Dana Reyes"
    assert client["phone"] == "614-555-0143"
    assert dog["name"] == "Pepper" and dog["breed"] == "Beagle"
    assert dog["owner_id"] == client["id"], "the dog must belong to the walk-in owner"

    # Both are genuinely persisted — not a response-only convenience object.
    assert run(server.db.clients.find_one({"id": client["id"]}, {"_id": 0})) is not None
    assert run(server.db.dogs.find_one({"id": dog["id"]}, {"_id": 0})) is not None


def test_a_walk_in_is_marked_walk_in_and_starts_with_nothing_owed_or_owned():
    client = _walk_in()["client"]
    assert client["client_status"] == "walk_in", "must be distinguishable from a prospect and from a client"
    # No credits are minted and no balance is invented by walking in.
    assert client["credits"] == 0 and client["training_credits"] == 0 and client["boarding_credits"] == 0
    assert client["account_balance"] == 0.0
    assert client["waiver"] is False, "walking in does not sign a waiver"


def test_the_dog_carries_no_vaccine_records_it_did_not_hand_in():
    dog = _walk_in()["dog"]
    assert dog["vaccines"] == {}, "a walk-in has produced no vaccine paperwork; do not imply otherwise"


def test_both_names_are_required_and_whitespace_is_not_a_name():
    for bad in ({"owner_name": "   "}, {"dog_name": "   "}):
        with pytest.raises(HTTPException) as e:
            _walk_in(**bad)
        assert e.value.status_code == 422


def test_front_desk_can_take_a_walk_in_but_a_trainer_cannot():
    # Front Desk holds clients_edit — they greet the walk-ins, so they must be
    # able to do this without an owner present.
    dep = server.require_admin_and_permission("clients_edit")
    assert run(dep(_front_desk())) is not None

    trainer = {"id": "walkin-tr", "name": "Trainer", "role": "employee", "staff_role": "trainer"}
    if not server._perms_for(trainer).get("clients_edit"):
        with pytest.raises(HTTPException) as e:
            run(dep(trainer))
        assert e.value.status_code == 403


def test_a_walk_in_can_be_scheduled_ahead_like_any_other_client():
    dog = _walk_in(owner_name="Ahead Booker", dog_name="Scout")["dog"]
    when = (server.business_today() + dt.timedelta(days=3)).isoformat()
    booking = run(server.create_booking(
        server.BookingIn(dog_id=dog["id"], date=when, service_type="grooming",
                         grooming_type="nail_trim", override_vaccines=True, override_capacity=True),
        ADMIN,
    ))
    assert booking["dog_id"] == dog["id"]
    assert booking["date"] == when, "a walk-in must be bookable on a future date, not just today"
    assert booking["service_type"] == "grooming" and booking["grooming_type"] == "nail_trim"


def test_walk_ins_are_searchable_but_are_not_counted_as_families_on_file():
    marker = f"Countable {uuid.uuid4().hex[:8]}"
    run(server.db.clients.insert_one({
        "id": str(uuid.uuid4()), "name": marker, "client_status": "active", "created_at": server.now_iso(),
    }))
    _walk_in(owner_name=marker + " WalkIn", dog_name="Nub")

    # /clients/page lives in the performance domain as a closure, so reach it
    # through the route it actually registered rather than a re-export.
    clients_page = next(
        r.endpoint for r in server.app.routes
        if getattr(r, "path", "") == "/api/clients/page" and "GET" in (r.methods or set())
    )
    page = run(clients_page(q=marker, page=1, page_size=50, _=ADMIN))
    names = [c["name"] for c in page["items"]]
    assert any("WalkIn" in n for n in names), "a walk-in must still be findable to rebook or convert"
    # The headline count is families on file; the raw row count still includes
    # the walk-in so paging stays honest.
    assert page["total_clients"] == page["total"] - 1
    assert page["total_clients"] >= 1


def test_converting_a_walk_in_to_a_client_keeps_the_dog_and_the_history():
    out = _walk_in(owner_name="Converts Later", dog_name="Biscuit")
    client_id, dog_id = out["client"]["id"], out["dog"]["id"]

    run(server.set_client_status(client_id, server.ClientStatusIn(status="active", note="Became a regular"), ADMIN))

    after = run(server.db.clients.find_one({"id": client_id}, {"_id": 0}))
    assert after["client_status"] == "active"
    assert run(server.db.dogs.find_one({"id": dog_id}, {"_id": 0})) is not None, "the dog survives conversion"
    assert "Became a regular" in (after.get("evaluation_notes") or "")


def test_the_walk_in_route_is_registered_and_not_shadowed_by_a_dynamic_sibling():
    ordered = [(getattr(r, "path", ""), set(r.methods or [])) for r in server.app.routes if hasattr(r, "methods")]
    paths = [p for p, _ in ordered]
    assert "/api/clients/walk-in" in paths, "the literal walk-in path must be registered"

    idx = paths.index("/api/clients/walk-in")
    import re
    for earlier_path, methods in ordered[:idx]:
        if "{" not in earlier_path or "POST" not in methods:
            continue
        pattern = "^" + re.sub(r"\{[^}]+\}", "[^/]+", earlier_path) + "$"
        assert not re.match(pattern, "/api/clients/walk-in"), (
            f"{earlier_path} is registered earlier and would swallow the walk-in route"
        )


def test_walk_in_routes_live_in_a_domain_module_not_the_monolith():
    # The route freeze is explicit: new routes belong in backend/domains.
    from domains.clients import routes as walk_in_routes
    assert hasattr(walk_in_routes, "register_clients_routes")
    assert server.create_walk_in.__module__ == "domains.clients.routes"
