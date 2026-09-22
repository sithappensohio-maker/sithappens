"""Stage 1 — one authoritative answer to "will this booking be confirmed?".

The client wizard used to hardcode "Your booking will be reviewed and approved
by Sit Happens" for every service, while daycare — shipped as instant_book —
was written straight to `approved`. The customer was told their request would
be reviewed and then shown a CONFIRMED badge for the same booking.

The fix was not new copy. It was making the wizard read the same resolution the
creation endpoint writes with. These tests pin that they cannot drift.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

from domains import booking_rules

TAG = "TEST_STAGE1_BOOKING"


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


# ─────────────────────────────────────────────── the resolver itself

def test_an_explicit_approval_requirement_outranks_instant_book():
    """Both flags can be set on one row. "A human looks at this" is the safer
    of the two to honour, and that precedence predates the refactor — pinning
    it so a later tidy-up doesn't quietly reverse it."""
    rules = {"require_approval": True, "instant_book": True}
    assert booking_rules.booking_outcome(rules) == booking_rules.REQUESTED


def test_instant_book_confirms_and_plain_defaults_request():
    assert booking_rules.booking_outcome({"instant_book": True}) == booking_rules.CONFIRMED
    assert booking_rules.booking_outcome({}) == booking_rules.REQUESTED
    assert booking_rules.booking_outcome({}, auto_approve=True) == booking_rules.CONFIRMED


def test_staff_bookings_are_never_a_request():
    assert booking_rules.booking_outcome({"require_approval": True}, is_admin=True) == booking_rules.CONFIRMED


# ───────────────────────────────── the projection matches the shipped defaults

def test_the_shipped_defaults_make_daycare_instant_and_the_rest_a_request():
    """This is the configuration the contradiction actually came from: daycare
    confirms on the spot, everything else is reviewed."""
    settings = run(server.get_settings())
    assert server._booking_outcome_for(settings, "daycare") == "approved"
    for service_type in ("boarding", "training", "grooming", "photography", "other"):
        assert server._booking_outcome_for(settings, service_type) == "pending", service_type


def test_a_per_service_override_changes_the_answer_for_that_service_only():
    """per_catalog_service is how two services in one category differ. The
    client-facing projection has to honour it, or a service configured for
    instant booking would still be described as a request."""
    settings = run(server.get_settings())
    controls = server._merge_booking_flow_controls(settings.get("booking_flow_controls"))
    svc_id = str(uuid.uuid4())
    controls.setdefault("per_catalog_service", {})[svc_id] = {"require_approval": True, "instant_book": False}
    patched = {**settings, "booking_flow_controls": controls}

    assert server._booking_outcome_for(patched, "daycare", svc_id) == "pending"
    # …and the category default is untouched for every other daycare service.
    assert server._booking_outcome_for(patched, "daycare", str(uuid.uuid4())) == "approved"


def test_services_tells_the_client_how_a_booking_will_come_out():
    """GET /services is what the wizard reads. Without books_as it had no way
    to know, which is why it guessed — wrongly — for every instant-book row."""
    client_user = {"role": "client", "client_id": str(uuid.uuid4()), "id": str(uuid.uuid4())}
    made = []
    for stype in ("daycare", "boarding"):
        made.append(run(server.create_service(
            server.ServiceIn(name=f"{TAG} {stype} {uuid.uuid4().hex[:6]}",
                             base_price=10.0, service_type=stype), _admin())))
    made_ids = {m["id"] for m in made}
    try:
        items = run(server.list_services(user=client_user))
        mine = {it["service_type"]: it for it in items if it["id"] in made_ids}
        assert len(mine) == 2, "the services we just created are not in the client list"

        # The exact contradiction the audit caught: daycare confirms on the
        # spot, boarding is a request, and the wizard now knows which is which.
        assert mine["daycare"]["books_as"] == "approved"
        assert mine["boarding"]["books_as"] == "pending"
        for it in mine.values():
            assert "client_booking_enabled" in it["booking_flow"]

        # Every row's projection must equal what creation would actually write.
        settings = run(server.get_settings())
        for it in items:
            assert it.get("books_as") in ("approved", "pending"), it.get("name")
            expected = server._booking_outcome_for(settings, it.get("service_type") or "other", it.get("id"))
            assert it["books_as"] == expected, it.get("name")
    finally:
        for m in made:
            run(server.db.services.delete_one({"id": m["id"]}))


def test_the_projection_and_the_creation_path_cannot_disagree():
    """The regression that matters: two code paths answering the same question.
    Both now go through _booking_outcome_for, so this asserts the seam holds
    for every service type the defaults cover."""
    settings = run(server.get_settings())
    for service_type in ("daycare", "boarding", "training", "grooming", "photography", "other"):
        svc_rules = server._booking_flow_rules_for(settings, service_type, None)
        controls = server._merge_booking_flow_controls(settings.get("booking_flow_controls"))
        direct = booking_rules.booking_outcome(
            svc_rules, auto_approve=bool(controls.get("auto_approve", False)))
        assert server._booking_outcome_for(settings, service_type) == direct, service_type
