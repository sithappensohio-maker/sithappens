"""Public event preregistration (events_domain.py).

Covers the contract the public page, the door and the owner rely on:
  * the seeded event is public; a guest can preregister with no account and
    gets a confirmation number + contestant numbers, and never sees anyone else;
  * duplicate protection — same idempotency key or same email → the same
    registration, no second record; the honeypot swallows bots;
  * a signed-in client is linked and only their own dogs are kept, with no
    client/dog record created or changed;
  * validation: rules must be acknowledged, sane maximums, closed registration;
  * admin: summary totals, search, check-in + undo, walk-ins (counted at once,
    no dedupe), costume contestants with unique numbers, both CSV exports;
  * permission: read_only staff and clients are refused everywhere admin.
"""
import csv
import io
import uuid

import httpx
import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
import events_domain
from _test_loop import run

TAG = "TEST_EVENTS"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
SLUG = "trunk-or-treat-2026"


def _email():
    return f"{TAG.lower()}-{uuid.uuid4().hex[:8]}@example.com"


def _payload(email, **over):
    body = {
        "primary_contact": f"{TAG} Household", "email": email, "phone": "(330) 555-0142",
        "adults": 2, "children": 1,
        "dogs": [{"name": "Waffles", "costume_entered": True, "costume_theme": "Hot dog", "dog_and_human": True},
                 {"name": "Pickles", "costume_entered": False}],
        "costume_contest": True, "heard_from": "flyer", "rules_acknowledged": True,
        "marketing_consent": False, "idempotency_key": f"k-{uuid.uuid4().hex}",
    }
    body.update(over)
    return body


@pytest.fixture(scope="module", autouse=True)
def _module_setup_and_cleanup():
    run(events_domain.ensure_events_indexes(server.db))
    run(events_domain.seed_default_events(server.db))
    yield
    ev = run(server.db.events.find_one({"slug": SLUG}, {"_id": 0, "id": 1}))
    if ev:
        run(server.db.event_registrations.delete_many({"event_id": ev["id"]}))
        run(server.db.event_counters.delete_many({"_id": {"$regex": f"^{ev['id']}:"}}))
        run(server.db.events.update_one({"id": ev["id"]}, {"$set": {"registration_open": True, "published": True, "capacity": None}}))
    run(server.db.users.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))
    run(server.db.clients.delete_many({"email": {"$regex": f"^{TAG.lower()}"}}))
    run(server.db.dogs.delete_many({"name": {"$regex": f"^{TAG}"}}))
    run(server.db.email_outbox.delete_many({"key": {"$regex": "^event_registration_confirmed:"}}))
    run(server.db.notification_log.delete_many({"key": {"$regex": "^event_registration_confirmed:"}}))


def _clear_rate_limits():
    run(server.db.auth_rate_limits.delete_many({"scope": {"$regex": "^event_register"}}))


@pytest.fixture(autouse=True)
def _fresh_rate_limit_window():
    """Every test here posts from one fake IP; the limiter is exercised on its
    own below rather than tripping the functional tests."""
    _clear_rate_limits()
    yield


def _event():
    return run(server.db.events.find_one({"slug": SLUG}, {"_id": 0}))


def _staff(role="admin", staff_role=None, **over):
    u = {"id": str(uuid.uuid4()), "email": _email(), "name": f"{TAG} {staff_role or role}", "role": role,
         "password_hash": "x", "active": True}
    if staff_role:
        u["staff_role"] = staff_role
    u.update(over)
    run(server.db.users.insert_one(dict(u)))
    return u


def _token(u):
    return server.create_access_token(u["id"], u["email"], u["role"], server._token_version(u))


def _auth(u):
    return {"Authorization": f"Bearer {_token(u)}"}


def _register(email, **over):
    return run(_http.post(f"/api/public/events/{SLUG}/register", json=_payload(email, **over)))


# ---------------------------------------------------------------------------
# public
# ---------------------------------------------------------------------------
def test_seeded_event_is_public_and_exposes_nothing_about_attendees():
    r = run(_http.get(f"/api/public/events/{SLUG}"))
    assert r.status_code == 200, r.text
    ev = r.json()["event"]
    assert ev["name"] == "Sit Happens Doggy Trunk or Treat + Dog Costume Contest"
    assert ev["admission"] == "free" and ev["registration_closed"] is False
    assert ev["start_at"].startswith("2026-10-24T14:00")
    assert "adopt" not in (ev["description"] + " ".join(h["title"] + h.get("body", "") for h in ev["highlights"])).lower()
    for private in ("registrations", "registration_count", "confirmation_prefix", "capacity"):
        assert private not in ev
    assert run(_http.get("/api/public/events/no-such-event")).status_code == 404


def test_guest_preregisters_and_gets_confirmation_and_contestant_numbers():
    email = _email()
    r = _register(email)
    assert r.status_code == 200, r.text
    reg = r.json()["registration"]
    assert reg["confirmation_number"].startswith("SH-TOT-") and len(reg["confirmation_number"]) == len("SH-TOT-0001")
    assert reg["duplicate"] is False and reg["adults"] == 2 and reg["children"] == 1
    assert [d["name"] for d in reg["dogs"]] == ["Waffles", "Pickles"]
    assert reg["dogs"][0]["contestant_number"] and reg["dogs"][1]["contestant_number"] is None
    assert reg["costume_contest"] is True
    # only their own registration comes back — no ids of others, no list
    assert set(reg) <= {"id", "confirmation_number", "primary_contact", "email", "adults", "children", "dogs",
                        "costume_contest", "checked_in", "duplicate", "email_sent"}
    stored = run(server.db.event_registrations.find_one({"email": email}, {"_id": 0}))
    assert stored["source"] == "online" and stored["marketing_consent"] is False and stored["client_id"] is None
    assert stored["rules_acknowledged"] is True and stored["status"] == "registered" and stored["checked_in"] is False
    # no client or dog record was created for a public attendee
    assert run(server.db.clients.find_one({"email": email})) is None
    # a durable confirmation email was queued (email is not configured in tests)
    assert run(server.db.email_outbox.find_one({"key": f"event_registration_confirmed:{stored['id']}"})) is not None


def test_marketing_consent_is_only_ever_what_was_ticked():
    email = _email()
    r = _register(email, marketing_consent=True)
    assert r.status_code == 200
    assert run(server.db.event_registrations.find_one({"email": email}, {"_id": 0}))["marketing_consent"] is True


def test_duplicate_submissions_return_the_same_registration():
    email = _email()
    body = _payload(email)
    first = run(_http.post(f"/api/public/events/{SLUG}/register", json=body)).json()["registration"]
    again = run(_http.post(f"/api/public/events/{SLUG}/register", json=body)).json()["registration"]
    assert again["confirmation_number"] == first["confirmation_number"] and again["duplicate"] is True
    # same email, different browser (new key) → still the same household
    other = _register(email, idempotency_key=f"k-{uuid.uuid4().hex}").json()["registration"]
    assert other["confirmation_number"] == first["confirmation_number"] and other["duplicate"] is True
    assert run(server.db.event_registrations.count_documents({"email": email})) == 1


def test_honeypot_and_validation():
    email = _email()
    r = _register(email, website="http://spam.example")
    assert r.status_code == 200 and r.json()["registration"] is None
    assert run(server.db.event_registrations.find_one({"email": email})) is None
    assert _register(_email(), rules_acknowledged=False).status_code == 422
    assert _register(_email(), adults=0).status_code == 422
    assert _register(_email(), adults=events_domain.MAX_ADULTS + 1).status_code == 422
    assert _register(_email(), dogs=[{"name": f"D{i}"} for i in range(events_domain.MAX_DOGS + 1)]).status_code == 422
    assert _register(_email(), heard_from="tv").status_code == 422
    assert _register(_email(), phone="12").status_code == 422
    assert _register("not-an-email").status_code == 422


def test_closed_registration_is_refused_and_reopens():
    ev = _event()
    run(server.db.events.update_one({"id": ev["id"]}, {"$set": {"registration_open": False}}))
    try:
        assert run(_http.get(f"/api/public/events/{SLUG}")).json()["event"]["registration_closed"] is True
        assert _register(_email()).status_code == 409
    finally:
        run(server.db.events.update_one({"id": ev["id"]}, {"$set": {"registration_open": True}}))
    assert _register(_email()).status_code == 200


def test_signed_in_client_is_linked_and_only_their_own_dogs_are_kept():
    cid = str(uuid.uuid4())
    email = _email()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": email, "phone": "3305550100", "credits": 0}))
    own = {"id": str(uuid.uuid4()), "name": f"{TAG} Biscuit", "owner_id": cid}
    other = {"id": str(uuid.uuid4()), "name": f"{TAG} Stranger", "owner_id": str(uuid.uuid4())}
    run(server.db.dogs.insert_many([dict(own), dict(other)]))
    user = _staff(role="client", client_id=cid, email=email)
    # prefill: their details and dogs, nothing written
    pre = run(_http.get("/api/portal/events/prefill", headers=_auth(user)))
    assert pre.status_code == 200, pre.text
    assert pre.json()["email"] == email and [d["id"] for d in pre.json()["dogs"]] == [own["id"]]
    before_clients = run(server.db.clients.count_documents({}))
    before_dogs = run(server.db.dogs.count_documents({}))
    r = run(_http.post(f"/api/public/events/{SLUG}/register", headers=_auth(user), json=_payload(
        email, dogs=[{"name": "Biscuit", "dog_id": own["id"], "costume_entered": True},
                     {"name": "Stranger", "dog_id": other["id"], "costume_entered": True}])))
    assert r.status_code == 200, r.text
    stored = run(server.db.event_registrations.find_one({"email": email}, {"_id": 0}))
    assert stored["client_id"] == cid
    assert stored["dogs"][0]["dog_id"] == own["id"]
    assert stored["dogs"][1]["dog_id"] is None, "a dog id that isn't theirs is dropped, the name kept"
    assert run(server.db.clients.count_documents({})) == before_clients
    assert run(server.db.dogs.count_documents({})) == before_dogs
    # a bad token is just a guest
    r2 = run(_http.post(f"/api/public/events/{SLUG}/register", headers={"Authorization": "Bearer nope"}, json=_payload(_email())))
    assert r2.status_code == 200
    # prefill is client-only
    assert run(_http.get("/api/portal/events/prefill", headers=_auth(_staff()))).status_code == 403


# ---------------------------------------------------------------------------
# admin / staff
# ---------------------------------------------------------------------------
def test_admin_dashboard_totals_search_check_in_undo_walk_in_costume_and_csv():
    ev = _event()
    admin = _staff()
    front = _staff(role="employee", staff_role="front_desk")
    a, f = _auth(admin), _auth(front)
    e1, e2 = _email(), _email()
    r1 = _register(e1, primary_contact="Zed Zebra", phone="330-555-9999", adults=3, children=2).json()["registration"]
    r2 = _register(e2, primary_contact="Amy Apple", dogs=[{"name": "Solo"}], costume_contest=False, adults=1, children=0).json()["registration"]

    # summary — front desk has the permission by default
    dash = run(_http.get(f"/api/admin/events/{ev['id']}", headers=f))
    assert dash.status_code == 200, dash.text
    s = dash.json()["summary"]
    for k in ("households", "adults", "children", "people", "dogs", "costume_entries", "checked_in", "walk_ins"):
        assert k in s
    assert s["people"] == s["adults"] + s["children"]
    listed = run(_http.get("/api/admin/events", headers=a)).json()["events"]
    assert any(e["slug"] == SLUG and "summary" in e for e in listed)

    # search: name, phone digits, confirmation number, dog name
    def search(q):
        r = run(_http.get(f"/api/admin/events/{ev['id']}/registrations", params={"q": q}, headers=a))
        assert r.status_code == 200, r.text
        return [x["confirmation_number"] for x in r.json()["registrations"]]
    assert search("zebra") == [r1["confirmation_number"]]
    assert search("5559999") == [r1["confirmation_number"]]
    assert search(r2["confirmation_number"]) == [r2["confirmation_number"]]
    assert r2["confirmation_number"] in search("solo")
    assert e2 in [x["email"] for x in run(_http.get(f"/api/admin/events/{ev['id']}/registrations", headers=a)).json()["registrations"]]
    detail = run(_http.get(f"/api/admin/events/{ev['id']}/registrations/{r1['id']}", headers=a)).json()["registration"]
    assert detail["dogs"][0]["costume_theme"] == "Hot dog" and detail["heard_from_label"] == "Flyer / QR code"

    # check in, idempotent, then undo
    before = run(_http.get(f"/api/admin/events/{ev['id']}", headers=a)).json()["summary"]["checked_in"]
    c = run(_http.post(f"/api/admin/events/{ev['id']}/registrations/{r1['id']}/check-in", headers=f))
    assert c.status_code == 200, c.text
    reg = c.json()["registration"]
    assert reg["checked_in"] is True and reg["checked_in_at"] and reg["checked_in_by"]["id"] == front["id"]
    assert c.json()["summary"]["checked_in"] == before + 1
    first_at = reg["checked_in_at"]
    c2 = run(_http.post(f"/api/admin/events/{ev['id']}/registrations/{r1['id']}/check-in", headers=f)).json()
    assert c2["registration"]["checked_in_at"] == first_at and c2["summary"]["checked_in"] == before + 1
    u = run(_http.post(f"/api/admin/events/{ev['id']}/registrations/{r1['id']}/undo-check-in", headers=a)).json()
    assert u["registration"]["checked_in"] is False and u["registration"]["checked_in_by"] is None
    assert u["summary"]["checked_in"] == before

    # walk-in counts immediately, source walk_in, checked in, no dedupe
    base = run(_http.get(f"/api/admin/events/{ev['id']}", headers=a)).json()["summary"]
    w_body = {"primary_contact": "Walk In", "phone": "330-555-0001", "adults": 2, "children": 0,
              "dogs": [{"name": "Rex", "costume_theme": "Pirate"}], "costume_contest": True}
    w = run(_http.post(f"/api/admin/events/{ev['id']}/walk-in", json=w_body, headers=f))
    assert w.status_code == 200, w.text
    wr = w.json()["registration"]
    assert wr["source"] == "walk_in" and wr["checked_in"] is True and wr["confirmation_number"].startswith("SH-TOT-")
    assert wr["dogs"][0]["costume_entered"] is True and wr["dogs"][0]["contestant_number"]
    s2 = w.json()["summary"]
    assert s2["walk_ins"] == base["walk_ins"] + 1 and s2["households"] == base["households"] + 1
    assert s2["adults"] == base["adults"] + 2 and s2["checked_in"] == base["checked_in"] + 1
    w2 = run(_http.post(f"/api/admin/events/{ev['id']}/walk-in", json=w_body, headers=f)).json()["registration"]
    assert w2["confirmation_number"] != wr["confirmation_number"], "staff may add an intentional second registration"
    assert run(_http.post(f"/api/admin/events/{ev['id']}/walk-in", json={"primary_contact": "No Contact", "adults": 1}, headers=f)).status_code == 422

    # costume contest: one number per competing dog, unique across the event
    cc = run(_http.get(f"/api/admin/events/{ev['id']}/costume-contest", headers=a)).json()["contestants"]
    nums = [c["contestant_number"] for c in cc]
    assert len(nums) == len(set(nums)) and all(nums)
    assert all(c["contestant_label"].startswith("#") and len(c["contestant_label"]) == 4 for c in cc)
    assert any(c["dog_name"] == "Rex" and c["costume_theme"] == "Pirate" and c["checked_in"] for c in cc)
    two = _register(_email(), dogs=[{"name": "A", "costume_entered": True}, {"name": "B", "costume_entered": True}]).json()["registration"]
    assert two["dogs"][0]["contestant_number"] != two["dogs"][1]["contestant_number"]
    assert two["dogs"][0]["contestant_number"] not in nums

    # cancelled registrations leave every expected total
    before_cancel = run(_http.get(f"/api/admin/events/{ev['id']}", headers=a)).json()["summary"]
    p = run(_http.patch(f"/api/admin/events/{ev['id']}/registrations/{r2['id']}", json={"status": "cancelled"}, headers=a))
    assert p.status_code == 200 and p.json()["registration"]["status"] == "cancelled"
    after_cancel = run(_http.get(f"/api/admin/events/{ev['id']}", headers=a)).json()["summary"]
    assert after_cancel["households"] == before_cancel["households"] - 1 and after_cancel["dogs"] == before_cancel["dogs"] - 1
    assert run(_http.post(f"/api/admin/events/{ev['id']}/registrations/{r2['id']}/check-in", headers=a)).status_code == 409

    # CSV exports
    x = run(_http.get(f"/api/admin/events/{ev['id']}/export.csv", headers=a))
    assert x.status_code == 200 and x.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(x.text)))
    assert rows[0][:4] == ["Confirmation #", "Primary contact", "Email", "Phone"]
    for col in ("Dog names", "Contestant numbers", "Source", "Marketing consent", "Registered at", "Checked in at", "Status"):
        assert col in rows[0]
    by_conf = {r[0]: r for r in rows[1:]}
    assert by_conf[r1["confirmation_number"]][rows[0].index("Dog names")] == "Waffles; Pickles"
    assert by_conf[wr["confirmation_number"]][rows[0].index("Source")] == "walk_in"
    assert by_conf[r2["confirmation_number"]][rows[0].index("Status")] == "cancelled"
    y = run(_http.get(f"/api/admin/events/{ev['id']}/costume-contest.csv", headers=a))
    assert y.status_code == 200
    crows = list(csv.reader(io.StringIO(y.text)))
    assert crows[0][:3] == ["Contestant #", "Dog name", "Owner"]
    assert any(r[1] == "Rex" for r in crows[1:]) and not any(r[1] == "Solo" for r in crows[1:])

    # event toggles
    t = run(_http.patch(f"/api/admin/events/{ev['id']}", json={"registration_open": False}, headers=a))
    assert t.status_code == 200 and t.json()["event"]["registration_closed"] is True
    run(_http.patch(f"/api/admin/events/{ev['id']}", json={"registration_open": True}, headers=a))


def test_permissions_read_only_staff_and_clients_are_refused():
    ev = _event()
    ro = _staff(role="employee", staff_role="read_only")
    client = _staff(role="client", client_id=str(uuid.uuid4()))
    reg = _register(_email()).json()["registration"]
    paths = [("get", f"/api/admin/events"), ("get", f"/api/admin/events/{ev['id']}"),
             ("get", f"/api/admin/events/{ev['id']}/registrations"),
             ("get", f"/api/admin/events/{ev['id']}/registrations/{reg['id']}"),
             ("post", f"/api/admin/events/{ev['id']}/registrations/{reg['id']}/check-in"),
             ("post", f"/api/admin/events/{ev['id']}/registrations/{reg['id']}/undo-check-in"),
             ("post", f"/api/admin/events/{ev['id']}/walk-in"),
             ("get", f"/api/admin/events/{ev['id']}/costume-contest"),
             ("get", f"/api/admin/events/{ev['id']}/export.csv"),
             ("get", f"/api/admin/events/{ev['id']}/costume-contest.csv"),
             ("patch", f"/api/admin/events/{ev['id']}")]
    for method, path in paths:
        for who, headers in (("read_only", _auth(ro)), ("client", _auth(client)), ("guest", {})):
            r = run(getattr(_http, method)(path, headers=headers, **({"json": {}} if method in ("post", "patch") else {})))
            assert r.status_code in (401, 403), f"{who} {method} {path} -> {r.status_code}"
    assert "manage_events" in server.PERMISSION_KEYS
    assert server.ROLE_PERMISSIONS["read_only"]["manage_events"] is False
    assert server.ROLE_PERMISSIONS["front_desk"]["manage_events"] is True
    assert server.ROLE_PERMISSIONS["owner"]["manage_events"] is True


def test_public_register_is_rate_limited_per_ip():
    _clear_rate_limits()
    codes = [_register(_email()).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
    _clear_rate_limits()


def test_public_event_list_shows_only_published_upcoming_events():
    ev = _event()
    past = {"id": str(uuid.uuid4()), "slug": f"{TAG.lower()}-past", "name": f"{TAG} past", "published": True,
            "start_at": "2020-01-01T14:00:00-05:00", "end_at": "2020-01-01T17:00:00-05:00", "registration_open": True}
    hidden = {"id": str(uuid.uuid4()), "slug": f"{TAG.lower()}-hidden", "name": f"{TAG} hidden", "published": False,
              "start_at": "2030-01-01T14:00:00-05:00", "end_at": "2030-01-01T17:00:00-05:00", "registration_open": True}
    run(server.db.events.insert_many([dict(past), dict(hidden)]))
    try:
        r = run(_http.get("/api/public/events"))
        assert r.status_code == 200
        slugs = [e["slug"] for e in r.json()["events"]]
        assert SLUG in slugs and past["slug"] not in slugs and hidden["slug"] not in slugs
        item = next(e for e in r.json()["events"] if e["slug"] == SLUG)
        assert item["registration_closed"] is False and "confirmation_prefix" not in item and "capacity" not in item
        # unpublishing hides it from the list and the page alike
        run(server.db.events.update_one({"id": ev["id"]}, {"$set": {"published": False}}))
        assert SLUG not in [e["slug"] for e in run(_http.get("/api/public/events")).json()["events"]]
        assert run(_http.get(f"/api/public/events/{SLUG}")).status_code == 404
    finally:
        run(server.db.events.update_one({"id": ev["id"]}, {"$set": {"published": True}}))
        run(server.db.events.delete_many({"slug": {"$in": [past["slug"], hidden["slug"]]}}))


def test_owner_creates_edits_and_deletes_an_event_front_desk_cannot():
    owner = _staff()
    front = _staff(role="employee", staff_role="front_desk")
    manager = _staff(role="employee", staff_role="manager")
    body = {"name": f"{TAG} Spring Fling", "start_at": "2027-04-10T13:00:00-04:00", "end_at": "2027-04-10T15:00:00-04:00",
            "description": "Sniff, play, treats.", "location_name": "Sit Happens", "published": True, "costume_contest": False,
            "confirmation_prefix": "sh-sf", "highlights": [{"title": "Agility try-it", "icon": "fa-paw", "color": "#8cc63f", "body": "Low jumps."}],
            "rules": ["Leashed dogs only.", ""], "slug": ""}
    # front desk runs the door but cannot shape events
    assert run(_http.post("/api/admin/events", json=body, headers=_auth(front))).status_code == 403
    r = run(_http.post("/api/admin/events", json=body, headers=_auth(owner)))
    assert r.status_code == 200, r.text
    ev = r.json()["event"]
    try:
        assert ev["slug"] == f"{TAG.lower().replace('_', '-')}-spring-fling"
        assert ev["confirmation_prefix"] == "SH-SF" and ev["features"] == {"costume_contest": False, "walk_ins": True}
        assert ev["rules"] == ["Leashed dogs only."] and ev["highlights"][0]["title"] == "Agility try-it"
        assert ev["registration_count"] == 0 and r.json()["summary"]["households"] == 0
        # it is public straight away, and a duplicate link name is refused
        assert ev["slug"] in [e["slug"] for e in run(_http.get("/api/public/events")).json()["events"]]
        assert run(_http.post("/api/admin/events", json=body, headers=_auth(owner))).status_code == 409
        # validation
        assert run(_http.post("/api/admin/events", json={**body, "slug": "Bad Slug!"}, headers=_auth(owner))).status_code == 422
        assert run(_http.post("/api/admin/events", json={**body, "slug": "x2", "end_at": "2027-04-10T12:00:00-04:00"}, headers=_auth(owner))).status_code == 422
        assert run(_http.post("/api/admin/events", json={**body, "slug": "x3", "start_at": "not a date"}, headers=_auth(owner))).status_code == 422
        # manager edits everything, including unpublishing; the costume toggle reaches the public form
        edit = {**body, "name": f"{TAG} Spring Fling II", "slug": ev["slug"], "published": False, "costume_contest": True, "registration_open": False}
        u = run(_http.put(f"/api/admin/events/{ev['id']}", json=edit, headers=_auth(manager)))
        assert u.status_code == 200, u.text
        assert u.json()["event"]["name"].endswith("II") and u.json()["event"]["features"]["costume_contest"] is True
        assert u.json()["event"]["registration_closed"] is True
        assert run(_http.get(f"/api/public/events/{ev['slug']}")).status_code == 404, "unpublished = gone from the site"
        assert run(_http.put(f"/api/admin/events/{ev['id']}", json=edit, headers=_auth(front))).status_code == 403
        # renaming the link to one already in use is refused
        assert run(_http.put(f"/api/admin/events/{ev['id']}", json={**edit, "slug": SLUG}, headers=_auth(owner))).status_code == 409
        # a registered-for event cannot be deleted; an empty one can
        assert run(_http.delete(f"/api/admin/events/{_event()['id']}", headers=_auth(owner))).status_code == 409
        assert run(_http.delete(f"/api/admin/events/{ev['id']}", headers=_auth(front))).status_code == 403
        d = run(_http.delete(f"/api/admin/events/{ev['id']}", headers=_auth(owner)))
        assert d.status_code == 200
        assert run(server.db.events.find_one({"id": ev["id"]})) is None
    finally:
        run(server.db.events.delete_many({"name": {"$regex": f"^{TAG} Spring"}}))
    assert server.ROLE_PERMISSIONS["front_desk"]["edit_events"] is False
    assert server.ROLE_PERMISSIONS["manager"]["edit_events"] is True
    assert server.ROLE_PERMISSIONS["owner"]["edit_events"] is True


def test_qr_code_encodes_the_public_event_address():
    ev = _event()
    admin = _staff()
    r = run(_http.get(f"/api/admin/events/{ev['id']}/qr", params={"origin": "https://sithappens.app", "size": 6}, headers=_auth(admin)))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert r.headers["x-event-url"] == f"https://sithappens.app/events/{SLUG}"
    assert f'{SLUG}-qr.png' in r.headers["content-disposition"]
    # a bigger module size makes a bigger picture
    big = run(_http.get(f"/api/admin/events/{ev['id']}/qr", params={"origin": "https://sithappens.app", "size": 12}, headers=_auth(admin)))
    assert len(big.content) > len(r.content)
    # a junk origin is ignored, never encoded
    junk = run(_http.get(f"/api/admin/events/{ev['id']}/qr", params={"origin": "javascript:alert(1)"}, headers=_auth(admin)))
    assert junk.status_code == 200 and "javascript" not in junk.headers["x-event-url"]
    # gated like the rest of the dashboard
    assert run(_http.get(f"/api/admin/events/{ev['id']}/qr")).status_code == 401
    ro = _staff(role="employee", staff_role="read_only")
    assert run(_http.get(f"/api/admin/events/{ev['id']}/qr", headers=_auth(ro))).status_code == 403


def test_banner_background_image_upload_serve_replace_and_remove():
    import base64 as _b64
    ev = _event()
    owner = _staff()
    front = _staff(role="employee", staff_role="front_desk")
    png = _b64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()
    body = {"data": f"data:image/png;base64,{png}", "filename": "pumpkins.png"}
    try:
        # no picture yet: the public page says so and the image route is a 404
        assert run(_http.get(f"/api/public/events/{SLUG}")).json()["event"]["banner_image_version"] is None
        assert run(_http.get(f"/api/public/events/{SLUG}/banner")).status_code == 404
        # only event editors may upload
        assert run(_http.post(f"/api/admin/events/{ev['id']}/banner-image", json=body, headers=_auth(front))).status_code == 403
        r = run(_http.post(f"/api/admin/events/{ev['id']}/banner-image", json=body, headers=_auth(owner)))
        assert r.status_code == 200, r.text
        v1 = r.json()["event"]["banner_image_version"]
        assert v1 and len(v1) == 8
        # served publicly as a real image, cacheable
        img = run(_http.get(f"/api/public/events/{SLUG}/banner", params={"v": v1}))
        assert img.status_code == 200 and img.headers["content-type"] == "image/png"
        assert img.content[:8] == b"\x89PNG\r\n\x1a\n" and "max-age" in img.headers["cache-control"]
        assert run(_http.get(f"/api/public/events/{SLUG}")).json()["event"]["banner_image_version"] == v1
        # validation
        assert run(_http.post(f"/api/admin/events/{ev['id']}/banner-image", json={"data": "data:application/pdf;base64,QUJD"}, headers=_auth(owner))).status_code == 400
        assert run(_http.post(f"/api/admin/events/{ev['id']}/banner-image", json={"data": "not-a-data-url"}, headers=_auth(owner))).status_code == 400
        big = "data:image/jpeg;base64," + ("A" * (7 * 1024 * 1024))
        assert run(_http.post(f"/api/admin/events/{ev['id']}/banner-image", json={"data": big}, headers=_auth(owner))).status_code == 400
        # replacing drops the old picture
        r2 = run(_http.post(f"/api/admin/events/{ev['id']}/banner-image", json=body, headers=_auth(owner)))
        v2 = r2.json()["event"]["banner_image_version"]
        assert v2 != v1 and run(server.db.event_media.count_documents({"event_id": ev["id"]})) == 1
        # removing
        assert run(_http.delete(f"/api/admin/events/{ev['id']}/banner-image", headers=_auth(front))).status_code == 403
        d = run(_http.delete(f"/api/admin/events/{ev['id']}/banner-image", headers=_auth(owner)))
        assert d.status_code == 200 and d.json()["event"]["banner_image_version"] is None
        assert run(_http.get(f"/api/public/events/{SLUG}/banner")).status_code == 404
        assert run(server.db.event_media.count_documents({"event_id": ev["id"]})) == 0
    finally:
        run(server.db.event_media.delete_many({"event_id": ev["id"]}))
        run(server.db.events.update_one({"id": ev["id"]}, {"$set": {"banner_image_id": None}}))
