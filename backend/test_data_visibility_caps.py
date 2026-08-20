"""Result caps must never hide data that exists.

Two confirmed production-shaped failures, locked down:

  * GET /bookings returned a flat 3000-row slice of a +/-90 day window. With
    7954 rows in that window the budget was consumed by older bookings, so
    all 277 upcoming ones were dropped and the admin feed rendered exactly
    what it was sent: "0 upcoming".

  * GET /dogs returned 1000 of 3193 dogs. The roster screen reported the
    page length as the roll total ("1000 PUPS ON FILE"), and `owner_id` was
    accepted but silently discarded, so a caller asking for one client's
    dogs was handed everyone's.

Underneath both sat the same root cause: `.to_list(limit)` on an UNSORTED
cursor truncates in natural order and the sort runs afterwards, so any
caller whose result set outgrew the cap got an arbitrary subset.

These tests drive the real endpoints and the real Mongo queries. The
boundary is made small by lowering the budget rather than by inserting tens
of thousands of rows -- the cap is the thing under test, so shrinking it
exercises exactly the same code path in a fraction of the time. Nothing here
mocks the query away.
"""
import contextlib
import datetime
import uuid

import httpx
import jwt

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_CAPS"


# ---------------------------------------------------------------------------
# Identities
# ---------------------------------------------------------------------------

def _mk_user(role, client_id=None):
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "role": role, "name": f"{TAG} {role}",
        "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
        "password_hash": "x", "active": True, "token_version": 0,
    }
    if client_id:
        doc["client_id"] = client_id
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG,
    )
    return doc


def _http(method, path, user, **kw):
    async def go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await c.request(
                method, path, headers={"Authorization": f"Bearer {user['_token']}"}, **kw)
    return run(go())


def _day(offset):
    return (server.business_today() + datetime.timedelta(days=offset)).isoformat()


def _today():
    return server.business_today().isoformat()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _bookings(past=0, upcoming=0, today=0, client_id=None):
    """Bookings inserted in an order that does NOT match their date order, so
    a natural-order truncation looks visibly different from a date-ordered
    one -- which is precisely what the original defect could not tell apart.
    """
    cid = client_id or str(uuid.uuid4())
    rows = []
    for i in range(past):
        rows.append((f"{TAG}-past-{i}", _day(-(i + 1))))
    for i in range(upcoming):
        rows.append((f"{TAG}-up-{i}", _day(i + 1)))
    for i in range(today):
        rows.append((f"{TAG}-today-{i}", _today()))
    rows = rows[::2] + rows[1::2]  # interleave: insertion order != date order
    ids = []
    for name, when in rows:
        bid = str(uuid.uuid4())
        run(server.db.bookings.insert_one({
            "id": bid, "capstest": True, "status": "approved",
            "client_id": cid, "client_name": name, "dog_id": str(uuid.uuid4()),
            "dog_name": name, "date": when, "time": "09:00",
            "service_type": "daycare", "created_at": server.now_iso(),
        }))
        ids.append(bid)
    try:
        yield cid
    finally:
        run(server.db.bookings.delete_many({"id": {"$in": ids}}))


@contextlib.contextmanager
def _dogs(n, owner_id=None, prefix="Dog"):
    """`n` dogs named so sort order is predictable and the last one sits well
    past any small page boundary."""
    oid = owner_id or str(uuid.uuid4())
    ids = []
    for i in range(n):
        did = str(uuid.uuid4())
        run(server.db.dogs.insert_one({
            "id": did, "capstest": True, "owner_id": oid,
            "name": f"{TAG} {prefix} {i:04d}", "breed": "Testbreed",
            "sex": "Male", "fixed": "No", "created_at": server.now_iso(),
        }))
        ids.append(did)
    try:
        yield oid, ids
    finally:
        run(server.db.dogs.delete_many({"id": {"$in": ids}}))


@contextlib.contextmanager
def _budget(**overrides):
    """Shrink a production budget so its boundary is reachable cheaply. The
    endpoint reads these at call time, so this exercises the real path."""
    saved = {k: getattr(server, k) for k in overrides}
    for k, v in overrides.items():
        setattr(server, k, v)
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(server, k, v)


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


def _list_bookings(user=None, **kw):
    """The endpoint is declared with response_model=List[BookingOut], so a
    direct call hands back models. Normalise to plain dicts so the assertions
    below read the same way the HTTP consumers see the payload."""
    rows = run(server.list_bookings(user=user or _admin(), **kw))
    return [r if isinstance(r, dict) else r.model_dump() for r in rows]


def _upcoming(rows):
    return [r for r in rows if r["date"] >= _today()]


# ---------------------------------------------------------------------------
# Root cause -- truncation must happen on ORDERED rows
# ---------------------------------------------------------------------------

def test_a_truncated_read_returns_the_rows_the_caller_ordered_by():
    # The defect: .to_list(limit) on an unsorted cursor kept whatever the
    # collection scan reached first, and only then sorted. A caller asking
    # for the earliest N was handed an arbitrary N.
    with _bookings(upcoming=12) as cid:
        rows = run(server._booking_rows_anywhere(
            {"client_id": cid}, {"_id": 0}, include_archive=False,
            limit=4, sort_field="date"))
        got = [r["date"] for r in rows]
        every = sorted(r["date"] for r in run(
            server.db.bookings.find({"client_id": cid}, {"_id": 0, "date": 1}).to_list(50)))
        assert got == every[:4], f"truncation ignored the sort: {got} vs {every[:4]}"


def test_a_descending_truncated_read_returns_the_most_recent():
    with _bookings(past=12) as cid:
        rows = run(server._booking_rows_anywhere(
            {"client_id": cid}, {"_id": 0}, include_archive=False,
            limit=3, sort_field="date", sort_desc=True))
        got = [r["date"] for r in rows]
        every = sorted((r["date"] for r in run(
            server.db.bookings.find({"client_id": cid}, {"_id": 0, "date": 1}).to_list(50))),
            reverse=True)
        assert got == every[:3], f"expected the 3 most recent, got {got}"


# ---------------------------------------------------------------------------
# Bookings -- history must never starve the future
# ---------------------------------------------------------------------------

def test_upcoming_survives_a_history_that_exceeds_the_budget():
    # The exact production failure, at a thousandth of the row count.
    with _budget(_BOOKINGS_PAST_MAX=5), _bookings(past=20, upcoming=6) as cid:
        rows = _list_bookings(client_id=cid)
        assert len(_upcoming(rows)) == 6, (
            f"history ate the future: {len(_upcoming(rows))}/6 upcoming "
            f"returned out of {len(rows)} rows")


def test_history_volume_does_not_change_how_much_future_is_returned():
    with _budget(_BOOKINGS_PAST_MAX=5):
        with _bookings(past=2, upcoming=6) as small:
            few = len(_upcoming(_list_bookings(client_id=small)))
        with _bookings(past=60, upcoming=6) as big:
            many = len(_upcoming(_list_bookings(client_id=big)))
    assert few == many == 6, f"the future shrank as history grew: {few} -> {many}"


def test_a_truncated_history_keeps_the_most_recent_days():
    with _budget(_BOOKINGS_PAST_MAX=5), _bookings(past=20) as cid:
        got = sorted(r["date"] for r in _list_bookings(client_id=cid))
        newest = sorted((_day(-(i + 1)) for i in range(20)), reverse=True)[:5]
        assert set(got) == set(newest), (
            "a bounded history should keep the newest days, not the oldest")


def test_todays_bookings_are_returned():
    with _budget(_BOOKINGS_PAST_MAX=2), _bookings(past=20, today=3) as cid:
        rows = [r for r in _list_bookings(client_id=cid) if r["date"] == _today()]
        assert len(rows) == 3, f"today must never be truncated away, got {len(rows)}"


def test_the_summary_counts_the_database_not_the_page():
    with _budget(_BOOKINGS_PAST_MAX=5), _bookings(past=20, upcoming=6, today=2) as cid:
        rows = _list_bookings(client_id=cid)
        summary = run(server.bookings_summary(user=_admin(), client_id=cid))
        assert summary["upcoming"] == 8, summary          # 6 future + 2 today
        assert summary["today"] == 2, summary
        assert summary["past_in_window"] == 20, summary
        assert summary["total_in_window"] == 28, summary
        assert summary["past_in_window"] > len(rows) - 8, (
            "the summary must describe the data, not the returned page")
        assert summary["past_truncated"] is True


def test_summary_and_list_agree_when_nothing_is_truncated():
    with _bookings(past=3, upcoming=4) as cid:
        rows = _list_bookings(client_id=cid)
        summary = run(server.bookings_summary(user=_admin(), client_id=cid))
        assert summary["total_in_window"] == len(rows) == 7
        assert summary["upcoming_truncated"] is False
        assert summary["past_truncated"] is False


def test_an_explicit_range_still_works():
    with _bookings(past=5, upcoming=5) as cid:
        rows = _list_bookings(client_id=cid, start_date=_day(-2), end_date=_day(2))
        assert rows, "an explicit range returned nothing"
        assert all(_day(-2) <= r["date"] <= _day(2) for r in rows), (
            "rows outside the requested range came back")


def test_status_and_dog_filters_still_narrow_the_result():
    with _bookings(upcoming=4) as cid:
        one = _list_bookings(client_id=cid)[0]
        by_dog = _list_bookings(client_id=cid, dog_id=one["dog_id"])
        assert by_dog, "the dog filter lost the row"
        assert all(r["dog_id"] == one["dog_id"] for r in by_dog)
        assert all(r["status"] == "approved"
                   for r in _list_bookings(client_id=cid, status_filter="approved"))
        assert _list_bookings(client_id=cid, status_filter="cancelled") == []


def test_no_duplicate_bookings_across_the_two_budgets():
    with _bookings(past=6, upcoming=6, today=2) as cid:
        ids = [r["id"] for r in _list_bookings(client_id=cid)]
        assert len(ids) == len(set(ids)), "a booking was returned by both budgets"


def test_bookings_stay_date_ordered():
    with _bookings(past=6, upcoming=6, today=1) as cid:
        dates = [r["date"] for r in _list_bookings(client_id=cid)]
        assert dates == sorted(dates), "the merged result is no longer ordered"


def test_an_empty_window_is_empty_not_an_error():
    cid = str(uuid.uuid4())
    assert _list_bookings(client_id=cid) == []
    summary = run(server.bookings_summary(user=_admin(), client_id=cid))
    assert summary["upcoming"] == 0 and summary["total_in_window"] == 0


def test_a_client_only_ever_sees_their_own_bookings():
    with _bookings(upcoming=3) as mine, _bookings(upcoming=3) as theirs:
        me = {"id": str(uuid.uuid4()), "role": "client", "client_id": mine}
        rows = _list_bookings(user=me)
        assert rows, "the client saw none of their own bookings"
        assert {r["client_id"] for r in rows} == {mine}
        # a client_id parameter must not widen that scope
        rows = _list_bookings(user=me, client_id=theirs)
        assert {r["client_id"] for r in rows} == {mine}, "client escaped their scope"


def test_a_client_summary_cannot_count_another_clients_bookings():
    with _bookings(upcoming=3) as mine, _bookings(upcoming=9) as theirs:
        me = {"id": str(uuid.uuid4()), "role": "client", "client_id": mine}
        summary = run(server.bookings_summary(user=me, client_id=theirs))
        assert summary["upcoming"] == 3, "the client counted someone else's bookings"


# ---------------------------------------------------------------------------
# Dogs -- the roster must not stop short or misreport its size
# ---------------------------------------------------------------------------

def test_a_dog_past_the_first_page_is_still_found_by_search():
    with _dogs(30) as (oid, _):
        target = f"{TAG} Dog 0029"
        page = run(server.list_dogs(user=_admin(), owner_id=oid, limit=5))
        assert target not in [d["name"] for d in page], "fixture is not a real boundary"
        found = run(server.list_dogs(user=_admin(), owner_id=oid, search="Dog 0029", limit=5))
        assert [d["name"] for d in found] == [target], (
            f"search could not reach past the first page: {[d['name'] for d in found]}")


def test_the_total_is_the_real_count_not_the_page_length():
    with _dogs(30) as (oid, _):
        page = run(server.list_dogs(user=_admin(), owner_id=oid, limit=5))
        summary = run(server.dogs_summary(user=_admin(), owner_id=oid))
        assert len(page) == 5
        assert summary["total"] == 30, (
            f"total reported {summary['total']} — it is describing the page, "
            "not the roster")


def test_paging_covers_every_dog_exactly_once():
    with _dogs(23) as (oid, ids):
        seen, offset = [], 0
        while True:
            page = run(server.list_dogs(user=_admin(), owner_id=oid, limit=5, offset=offset))
            if not page:
                break
            seen.extend(d["id"] for d in page)
            offset += 5
            assert offset < 100, "pagination did not terminate"
        assert len(seen) == len(set(seen)), "the same dog appeared on two pages"
        assert set(seen) == set(ids), "paging silently skipped dogs"


def test_page_boundaries_are_stable_and_ordered():
    with _dogs(23) as (oid, _):
        first = [d["name"] for d in run(
            server.list_dogs(user=_admin(), owner_id=oid, limit=10))]
        second = [d["name"] for d in run(
            server.list_dogs(user=_admin(), owner_id=oid, limit=10, offset=10))]
        assert first == sorted(first) and second == sorted(second)
        assert first[-1] < second[0], "pages overlap or are out of order"
        again = [d["name"] for d in run(
            server.list_dogs(user=_admin(), owner_id=oid, limit=10))]
        assert again == first, "the same request returned a different page"


def test_a_page_past_the_end_is_empty():
    with _dogs(6) as (oid, _):
        assert run(server.list_dogs(user=_admin(), owner_id=oid, limit=5, offset=50)) == []


def test_a_search_that_matches_nothing_is_empty_not_everything():
    with _dogs(6) as (oid, _):
        assert run(server.list_dogs(user=_admin(), owner_id=oid, search="zzz-no-such-dog")) == []
        assert run(server.dogs_summary(
            user=_admin(), owner_id=oid, search="zzz-no-such-dog"))["total"] == 0


def test_owner_id_actually_filters():
    # It used to be accepted and silently dropped, so this returned everyone.
    with _dogs(5, prefix="Mine") as (mine, _), _dogs(7, prefix="Theirs") as (theirs, _):
        rows = run(server.list_dogs(user=_admin(), owner_id=mine))
        assert rows, "the owner filter returned nothing"
        assert {d["owner_id"] for d in rows} == {mine}, "owner_id did not filter"
        assert run(server.dogs_summary(user=_admin(), owner_id=mine))["total"] == 5


def test_deleted_dogs_stay_excluded():
    with _dogs(4) as (oid, ids):
        run(server.db.dogs.update_one(
            {"id": ids[0]}, {"$set": {"deleted_at": server.now_iso()}}))
        rows = run(server.list_dogs(user=_admin(), owner_id=oid))
        assert ids[0] not in {d["id"] for d in rows}
        assert run(server.dogs_summary(user=_admin(), owner_id=oid))["total"] == 3
        assert run(server.dogs_summary(
            user=_admin(), owner_id=oid, include_deleted=True))["total"] == 4


def test_a_client_only_sees_their_own_dogs_and_owner_id_cannot_widen_it():
    with _dogs(3, prefix="Mine") as (mine, _), _dogs(9, prefix="Theirs") as (theirs, _):
        me = {"id": str(uuid.uuid4()), "role": "client", "client_id": mine}
        rows = run(server.list_dogs(user=me))
        assert {d["owner_id"] for d in rows} == {mine}
        rows = run(server.list_dogs(user=me, owner_id=theirs))
        assert {d["owner_id"] for d in rows} == {mine}, "the client escaped their scope"
        assert run(server.dogs_summary(user=me, owner_id=theirs))["total"] == 3


def test_a_search_cannot_reach_another_clients_dogs():
    with _dogs(3, prefix="Mine") as (mine, _), _dogs(4, prefix="Theirs") as (theirs, _):
        me = {"id": str(uuid.uuid4()), "role": "client", "client_id": mine}
        assert run(server.list_dogs(user=me, search="Theirs")) == []


def test_the_page_size_is_bounded():
    with _dogs(8) as (oid, _):
        rows = run(server.list_dogs(user=_admin(), owner_id=oid, limit=10_000))
        assert len(rows) <= server._DOGS_PAGE_MAX


# ---------------------------------------------------------------------------
# Dispute copy -- presentation only
# ---------------------------------------------------------------------------

def test_the_dispute_note_reads_as_english_not_as_a_machine_record():
    note = server._stripe_dispute_notes(
        {"status": "needs_response", "evidence_due_by": "2026-08-23T16:04:10.916294+00:00"})
    assert "Needs Response" in note
    assert "needs_response" not in note
    assert "T16:04:10" not in note and "+00:00" not in note
    assert "Aug 23, 2026" in note


def test_a_missing_or_unparseable_deadline_degrades_cleanly():
    assert "see Stripe" in server._stripe_dispute_notes({"status": "under_review"})
    assert "see Stripe" in server._stripe_dispute_notes(
        {"status": "under_review", "evidence_due_by": "not-a-date"})


def test_the_raw_stripe_values_are_left_untouched_on_the_record():
    # Presentation changed; the machine-readable state must not.
    did = f"dp_{uuid.uuid4().hex[:10]}"
    run(server.db.stripe_disputes.insert_one({
        "id": did, "capstest": True, "status": "needs_response",
        "reason": "product_not_received", "amount": 10.0,
        "charge_id": f"ch_{uuid.uuid4().hex[:8]}",
        "evidence_due_by": "2026-08-23T16:04:10.916294+00:00",
        "first_seen_at": server.now_iso(), "created_at": server.now_iso(),
    }))
    try:
        res = run(server._collect_pending_actions(_admin(), limit=300))
        item = next(i for i in res["items"] if i["id"].endswith(did))
        assert item["status"] == "needs_response", "the raw Stripe status changed"
        assert "Needs Response" in item["notes"]
        assert "Product Not Received" in item["service_name"]
        row = run(server.db.stripe_disputes.find_one({"id": did}, {"_id": 0}))
        assert row["status"] == "needs_response"
        assert row["evidence_due_by"] == "2026-08-23T16:04:10.916294+00:00"
    finally:
        run(server.db.stripe_disputes.delete_one({"id": did}))


# ---------------------------------------------------------------------------
# Over real HTTP -- the routes must exist and not be shadowed by /{id}
# ---------------------------------------------------------------------------

def test_the_summary_routes_are_reachable_over_http():
    # /bookings/summary and /dogs/summary sit beside /bookings/{id} and
    # /dogs/{id}; declared in the wrong order they parse as an id instead.
    admin = _mk_user("admin")
    try:
        r = _http("GET", "/api/dogs/summary", admin)
        assert r.status_code == 200, r.text[:200]
        assert isinstance(r.json().get("total"), int), r.text[:200]
        r = _http("GET", "/api/bookings/summary", admin)
        assert r.status_code == 200, r.text[:200]
        assert isinstance(r.json().get("upcoming"), int), r.text[:200]
    finally:
        run(server.db.users.delete_one({"id": admin["id"]}))


def test_http_dogs_paging_and_search_round_trip():
    admin = _mk_user("admin")
    try:
        with _dogs(30) as (oid, _):
            r = _http("GET", f"/api/dogs?owner_id={oid}&limit=5", admin)
            assert r.status_code == 200 and len(r.json()) == 5, r.text[:200]
            r = _http("GET", f"/api/dogs/summary?owner_id={oid}", admin)
            assert r.json()["total"] == 30, r.text[:200]
            r = _http("GET", f"/api/dogs?owner_id={oid}&search=Dog+0029", admin)
            assert [d["name"] for d in r.json()] == [f"{TAG} Dog 0029"], r.text[:200]
    finally:
        run(server.db.users.delete_one({"id": admin["id"]}))


def test_an_anonymous_caller_still_cannot_read_either_summary():
    async def go(path):
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await c.get(path)
    for path in ("/api/dogs/summary", "/api/bookings/summary"):
        assert run(go(path)).status_code in (401, 403), path
