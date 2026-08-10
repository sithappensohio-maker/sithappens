"""Action Required / Pending Actions — the missed-Meet-&-Greet production
incident, recreated and locked down.

The core regression (Phase O): a Meet & Greet submitted Monday for Thursday
must be visible to staff the moment it is SUBMITTED — never gated on the
requested appointment date — must survive notification read/dismiss, and
must disappear only when the request is actually handled. Plus: booking
approvals (Phase P), durable email failure handling (Phase Q), escalation,
permissions, deep links, historical records (Phase R/N).

Same in-process conventions as test_module_quiz.py; public endpoints (the
landing-page Meet & Greet form, permission gates) go through real ASGI
dispatch since Depends/rate-limits only run there.
"""
import contextlib
import uuid
from datetime import date, timedelta

import httpx
import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
import email_service
from _test_loop import run

TAG = "TEST_PENDING_ACTIONS"


@pytest.fixture(scope="module", autouse=True)
def _module_cleanup():
    """Leave nothing behind for later files in the same run — the seeded
    catalog service and booking-flow overrides would otherwise leak into
    unrelated pricing suites."""
    yield
    run(server.db.services.delete_many({"name": {"$regex": f"^{TAG}"}}))
    run(server.db.settings.update_one(
        {"id": "global"},
        {"$unset": {"booking_flow_controls.per_catalog_service": 1}},
    ))

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


def _client_user(client_id):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client_id, "name": "Client"}


def _insert_staff(staff_role, role="employee"):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}",
        "role": role, "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, email, role, 0)
    return uid, {"Authorization": f"Bearer {token}"}


def _future(days):
    return (date.today() + timedelta(days=days)).isoformat()


def _seed_meet_greet_settings():
    """Every day open 09:00-17:00, no lead time — so any near-future slot the
    tests pick is genuinely available."""
    hours = {d: {"closed": False, "open": "09:00", "close": "17:00"} for d in server.DEFAULT_DAYS}
    run(server.db.settings.update_one(
        {"id": "global"},
        {"$set": {"meet_greet": {"enabled": True, "slot_minutes": 30, "min_lead_hours": 0,
                                 "max_advance_days": 60, "hours": hours},
                  "auto_approve": False}},
        upsert=True,
    ))


@contextlib.contextmanager
def _email_success():
    """Simulate a healthy mail provider: fake API key + captured sends, quiet
    hours forced off. Restores everything afterwards."""
    sent = []
    orig_key = email_service.RESEND_API_KEY
    orig_admin = email_service.ADMIN_NOTIFICATION_EMAIL
    orig_send = email_service.resend.Emails.send
    orig_quiet = email_service._is_in_quiet_hours

    def fake_send(params, options=None):
        sent.append({"params": params, "options": options})
        return {"id": f"fake-{len(sent)}"}

    async def no_quiet():
        return False

    email_service.RESEND_API_KEY = "test-key"
    email_service.ADMIN_NOTIFICATION_EMAIL = "owner@example.com"
    email_service.resend.Emails.send = fake_send
    email_service._is_in_quiet_hours = no_quiet
    try:
        yield sent
    finally:
        email_service.RESEND_API_KEY = orig_key
        email_service.ADMIN_NOTIFICATION_EMAIL = orig_admin
        email_service.resend.Emails.send = orig_send
        email_service._is_in_quiet_hours = orig_quiet


@contextlib.contextmanager
def _email_broken():
    """Simulate provider failure: admin address configured but no API key —
    the durable path must queue the alert with the real failure reason."""
    orig_key = email_service.RESEND_API_KEY
    orig_admin = email_service.ADMIN_NOTIFICATION_EMAIL
    orig_quiet = email_service._is_in_quiet_hours

    async def no_quiet():
        return False

    email_service.RESEND_API_KEY = None
    email_service.ADMIN_NOTIFICATION_EMAIL = "owner@example.com"
    email_service._is_in_quiet_hours = no_quiet
    try:
        yield
    finally:
        email_service.RESEND_API_KEY = orig_key
        email_service.ADMIN_NOTIFICATION_EMAIL = orig_admin
        email_service._is_in_quiet_hours = orig_quiet


def _cleanup(client_ids=(), booking_ids=(), emails=()):
    if booking_ids:
        run(server.db.bookings.delete_many({"id": {"$in": list(booking_ids)}}))
    if client_ids:
        run(server.db.bookings.delete_many({"client_id": {"$in": list(client_ids)}}))
        run(server.db.clients.delete_many({"id": {"$in": list(client_ids)}}))
        run(server.db.dogs.delete_many({"owner_id": {"$in": list(client_ids)}}))
        run(server.db.claim_tokens.delete_many({"client_id": {"$in": list(client_ids)}}))
        run(server.db.reschedule_requests.delete_many({"client_id": {"$in": list(client_ids)}}))
        run(server.db.waiver_signatures.delete_many({"client_id": {"$in": list(client_ids)}}))
    if emails:
        run(server.db.clients.delete_many({"email": {"$in": list(emails)}}))
    run(server.db.email_outbox.delete_many({"key": {"$regex": "^admin_(meet_greet_request|booking_approval):"}}))
    run(server.db.notification_log.delete_many({"key": {"$regex": "^admin_(meet_greet_request|booking_approval):"}}))
    run(server.db.task_dismissals.delete_many({}))


def _submit_meet_greet(email, days_out=3, time="10:00", dog="Waffles"):
    r = run(_http.post("/api/public/meet-greet-request", json={
        "owner_name": f"{TAG} Owner", "email": email, "phone": "555-0101",
        "dog_name": dog, "date": _future(days_out), "time": time,
    }))
    assert r.status_code == 200, r.text
    row = run(server.db.bookings.find_one({"is_meet_greet": True, "client_name": f"{TAG} Owner",
                                           "dog_name": dog, "status": "pending"}, {"_id": 0}))
    assert row, "Meet & Greet booking record must exist"
    return row


def _actions(user=None, **kw):
    return run(server._collect_pending_actions(user or _admin_user(), **kw))


def _ensure_daycare_service():
    """Client bookings must resolve to a real active catalog service."""
    existing = run(server.db.services.find_one({"service_type": "daycare", "active": True}, {"_id": 0, "id": 1}))
    if existing:
        return existing["id"]
    sid = str(uuid.uuid4())
    run(server.db.services.insert_one({
        "id": sid, "name": f"{TAG} Daycare", "service_type": "daycare", "active": True,
        "is_default": True, "price": 30.0,
    }))
    return sid


@contextlib.contextmanager
def _client_with_dog():
    admin = _admin_user()
    _ensure_daycare_service()
    c = run(server.create_client(server.ClientIn(
        name=f"{TAG} Client {uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:8]}@example.com",
    ), admin))
    run(server.db.clients.update_one({"id": c["id"]}, {"$set": {"waiver": True}}))
    run(server.db.waiver_signatures.insert_one({
        "id": str(uuid.uuid4()), "client_id": c["id"], "waiver_version": 999,
        "signed_at": server.now_iso(), "signed_name": c["name"],
    }))
    did = str(uuid.uuid4())
    run(server.db.dogs.insert_one({
        "id": did, "name": f"{TAG} Dog", "owner_id": c["id"], "breed": "Mix", "age_y": 3,
        "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"},
    }))
    try:
        yield c, did
    finally:
        _cleanup(client_ids=[c["id"]])


# ---------------------------------------------------------------------------
# PHASE O — the production failure, recreated end to end
# ---------------------------------------------------------------------------

def test_meet_greet_request_is_actionable_the_moment_it_is_submitted():
    _seed_meet_greet_settings()
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    with _email_success() as sent:
        before = _actions()["counts"]["total"]
        mg = _submit_meet_greet(email, days_out=3)   # "Monday submits for Thursday"
        try:
            # 1. The request exists as the authoritative pending record.
            assert mg["status"] == "pending" and mg["is_meet_greet"] is True

            # 2. Action Required returns it IMMEDIATELY — the requested date
            #    is 3 days away and must not matter for visibility.
            res = _actions()
            mine = [a for a in res["items"] if a["deep_link"].get("booking_id") == mg["id"]]
            assert len(mine) == 1
            a = mine[0]
            assert a["type"] == "meet_and_greet_request"
            assert a["type_label"] == "Meet & Greet Request"
            assert a["requested_date"] == mg["date"]
            assert a["created_at"] == mg["created_at"]
            assert a["urgency"] in ("action_required", "urgent")  # fresh; 3d out is not urgent
            assert res["counts"]["total"] == before + 1
            assert res["counts"]["meet_and_greet_request"] >= 1

            # 3. Badge/count endpoints agree.
            counts = run(server.admin_pending_actions_count(_admin_user()))
            assert counts["total"] == res["counts"]["total"]
            assert counts["meet_and_greet_requests"] >= 1

            # 4. The admin email was ATTEMPTED immediately and its delivery
            #    result was logged (notification_log stamp on success).
            assert any("Meet & Greet Request" in s["params"]["subject"] for s in sent), \
                "admin alert email must be attempted at submission time"
            mg_mail = next(s for s in sent if "Meet & Greet Request" in s["params"]["subject"])
            assert mg["dog_name"] in mg_mail["params"]["subject"]
            logged = run(server.db.notification_log.find_one({"key": f"admin_meet_greet_request:{mg['id']}"}, {"_id": 0}))
            assert logged, "successful delivery must be recorded in notification_log"

            # 5. "Next day it remains visible" — age the record; still there,
            #    now escalated instead of hidden.
            run(server.db.bookings.update_one(
                {"id": mg["id"]},
                {"$set": {"created_at": (server.datetime.now(server.timezone.utc) - timedelta(hours=25)).isoformat()}}))
            aged = [x for x in _actions()["items"] if x["deep_link"].get("booking_id") == mg["id"]][0]
            assert aged["waiting_minutes"] >= 24 * 60
            assert aged["urgency"] in ("waiting", "urgent", "overdue")

            # 6. Reading/dismissing the app notification must NOT resolve it.
            brain = run(server.admin_today_brain(_admin_user()))
            pend_items = [it for it in brain["items"] if it["kind"] == "booking_pending"]
            if pend_items:
                run(server.admin_today_brain_dismiss(server.TodayBrainDismissIn(
                    item_id=pend_items[0]["id"], signature=pend_items[0]["signature"]), _admin_user()))
            still = [x for x in _actions()["items"] if x["deep_link"].get("booking_id") == mg["id"]]
            assert len(still) == 1, "notification read/dismiss must never resolve a Pending Action"

            # 7. Actually handling the request resolves it.
            run(server.approve_booking(mg["id"], _admin_user()))
            gone = [x for x in _actions()["items"] if x["deep_link"].get("booking_id") == mg["id"]]
            assert gone == []
            counts_after = run(server.admin_pending_actions_count(_admin_user()))
            assert counts_after["total"] == res["counts"]["total"] - 1
        finally:
            _cleanup(client_ids=[mg["client_id"]], emails=[email])


def test_far_future_request_and_dashboard_counts():
    _seed_meet_greet_settings()
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    with _email_success():
        mg = _submit_meet_greet(email, days_out=30, dog="FutureDog")
        try:
            item = [a for a in _actions()["items"] if a["deep_link"].get("booking_id") == mg["id"]]
            assert len(item) == 1, "a request 30 days out is visible the moment it is created"
            assert item[0]["urgency"] == "action_required"
            stats = run(server.dashboard_stats(_admin_user()))
            assert stats["pending_actions"] >= 1
            assert stats["pending_meet_and_greets"] >= 1
            assert "pending_booking_approvals" in stats and "pending_reschedule_requests" in stats
        finally:
            _cleanup(client_ids=[mg["client_id"]], emails=[email])


def test_historical_unresolved_records_surface_without_migration():
    """Rows that existed BEFORE this feature deployed must appear — the queue
    derives from the authoritative records, no backfill required."""
    old_iso = (server.datetime.now(server.timezone.utc) - timedelta(days=3)).isoformat()
    bid, rid = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "dog_id": "", "dog_name": "Legacy Pup", "client_id": f"{TAG}-legacy-client",
        "client_name": "Legacy Client", "date": _future(2), "time": "11:00",
        "service_type": "other", "status": "pending", "created_at": old_iso, "is_meet_greet": True,
    }))
    run(server.db.reschedule_requests.insert_one({
        "id": rid, "booking_id": "x", "client_id": f"{TAG}-legacy-client", "client_name": "Legacy Client",
        "dog_id": "", "dog_name": "Legacy Pup", "current_date": _future(5), "current_time": "10:00",
        "proposed_slots": [], "client_note": "", "status": "pending", "created_at": old_iso,
    }))
    try:
        res = _actions()
        ids = {a["id"] for a in res["items"]}
        assert f"meet_and_greet_request:{bid}" in ids
        assert f"reschedule_request:{rid}" in ids
        aged = next(a for a in res["items"] if a["id"] == f"meet_and_greet_request:{bid}")
        assert aged["urgency"] == "overdue" and aged["waiting_minutes"] >= 48 * 60
        assert res["counts"]["total"] == len(res["items"])
    finally:
        run(server.db.bookings.delete_one({"id": bid}))
        run(server.db.reschedule_requests.delete_one({"id": rid}))


# ---------------------------------------------------------------------------
# PHASE P — approval-required bookings
# ---------------------------------------------------------------------------

def test_booking_approval_lifecycle():
    _seed_meet_greet_settings()
    with _client_with_dog() as (c, dog_id):
        # Phase P: configure THIS catalog service as approval-required.
        sid = _ensure_daycare_service()
        run(server.db.settings.update_one({"id": "global"}, {"$set": {
            "booking_flow_controls.per_catalog_service." + sid: {
                "require_approval": True, "instant_book": False},
        }}))
        with _email_success() as sent:
            cu = _client_user(c["id"])
            booking = run(server.create_booking(server.BookingIn(
                dog_id=dog_id, date=_future(10), service_type="daycare"), cu))
            assert booking["status"] == "pending", "approval-required service must create a PENDING booking"

            res = _actions()
            mine = [a for a in res["items"] if a["deep_link"].get("booking_id") == booking["id"]]
            assert len(mine) == 1
            a = mine[0]
            assert a["type"] == "booking_approval" and a["type_label"] == "Booking Needs Approval"
            assert a["deep_link"]["booking_id"] == booking["id"]

            # Email attempted at submission time, subject per spec, logged.
            appr_mail = [s for s in sent if "Booking Needs Approval" in s["params"]["subject"]]
            assert appr_mail, "approval email must be attempted immediately"
            assert run(server.db.notification_log.find_one(
                {"key": f"admin_booking_approval:{booking['id']}"}, {"_id": 0}))

            # Approve → approved + gone from Action Required.
            run(server.approve_booking(booking["id"], _admin_user()))
            fresh = run(server.db.bookings.find_one({"id": booking["id"]}, {"_id": 0, "status": 1}))
            assert fresh["status"] == "approved"
            assert not [x for x in _actions()["items"] if x["deep_link"].get("booking_id") == booking["id"]]


def test_auto_approved_and_confirmed_bookings_never_appear():
    with _client_with_dog() as (c, dog_id):
        # Daycare's category default is instant_book=True — clear any exact
        # per-service override left by other tests so the default applies.
        run(server.db.settings.update_one({"id": "global"}, {"$unset": {"booking_flow_controls.per_catalog_service": 1}}))
        cu = _client_user(c["id"])
        booking = run(server.create_booking(server.BookingIn(
            dog_id=dog_id, date=_future(9), service_type="daycare"), cu))
        assert booking["status"] == "approved", "instant-book path auto-approves"
        assert not [x for x in _actions()["items"] if x["deep_link"].get("booking_id") == booking["id"]]


# ---------------------------------------------------------------------------
# PHASE Q — email failure must not be silent, and must not lose the request
# ---------------------------------------------------------------------------

def test_email_failure_keeps_request_and_logs_failure():
    _seed_meet_greet_settings()
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    with _email_broken():
        mg = _submit_meet_greet(email, days_out=4, dog="NoMailDog")
        try:
            # Request survived and is actionable.
            assert [x for x in _actions()["items"] if x["deep_link"].get("booking_id") == mg["id"]]
            # Failure recorded durably with a real reason, queued for retry.
            outbox = run(server.db.email_outbox.find_one(
                {"key": f"admin_meet_greet_request:{mg['id']}"}, {"_id": 0}))
            assert outbox and outbox["status"] == "pending"
            assert "RESEND_API_KEY" in (outbox.get("last_error") or "")
            # No false "sent" stamp.
            assert not run(server.db.notification_log.find_one(
                {"key": f"admin_meet_greet_request:{mg['id']}"}, {"_id": 0}))
        finally:
            _cleanup(client_ids=[mg["client_id"]], emails=[email])


# ---------------------------------------------------------------------------
# PHASE R — escalation, permissions, deep links, counts
# ---------------------------------------------------------------------------

def test_urgency_escalation_rules():
    now = server.datetime.now(server.timezone.utc)
    iso = lambda **kw: (now - timedelta(**kw)).isoformat()  # noqa: E731
    today = server.business_today().isoformat()
    tomorrow = (server.business_today() + timedelta(days=1)).isoformat()
    yesterday = (server.business_today() - timedelta(days=1)).isoformat()

    fresh_far = server._pending_action_urgency(iso(minutes=5), _future(5), "10:00")
    assert fresh_far["urgency"] == "action_required" and fresh_far["urgency_rank"] == 3

    day_old = server._pending_action_urgency(iso(hours=25), _future(5), "10:00")
    assert day_old["urgency"] == "waiting" and "day" in day_old["urgency_label"].lower()

    two_days = server._pending_action_urgency(iso(hours=49), _future(5), "10:00")
    assert two_days["urgency"] == "overdue" and two_days["urgency_rank"] == 2

    within_24 = server._pending_action_urgency(iso(minutes=10), tomorrow, "09:00")
    assert within_24["urgency"] == "urgent" and within_24["urgency_rank"] == 1

    today_future_time = server._pending_action_urgency(iso(minutes=10), today, "23:59")
    assert today_future_time["urgency"] == "urgent_today" and today_future_time["urgency_rank"] == 0

    passed = server._pending_action_urgency(iso(minutes=10), yesterday, "10:00")
    assert passed["urgency"] == "overdue_requested_passed" and passed["urgency_rank"] == 0
    assert "PASSED" in passed["urgency_label"]


def test_sort_order_puts_requested_passed_first_then_oldest():
    now = server.datetime.now(server.timezone.utc)
    mk = lambda i, created_h, req_days: {  # noqa: E731
        "id": f"{TAG}-sort-{i}", "dog_id": "", "dog_name": f"S{i}", "client_id": f"{TAG}-sort",
        "client_name": "Sorter", "date": (server.business_today() + timedelta(days=req_days)).isoformat(),
        "time": "10:00", "service_type": "other", "status": "pending",
        "created_at": (now - timedelta(hours=created_h)).isoformat(), "is_meet_greet": True,
    }
    rows = [mk(1, 1, 5), mk(2, 60, 5), mk(3, 1, -1), mk(4, 30, 5)]
    run(server.db.bookings.insert_many([dict(r) for r in rows]))
    try:
        items = [a for a in _actions()["items"] if a["client_id"] == f"{TAG}-sort"]
        order = [a["id"].split("-")[-1] for a in items]
        assert order[0] == "3", "requested-time-passed sorts first"
        assert order[1] == "2", "then OVERDUE (≥48h)"
        assert order[2] == "4", "then oldest unresolved"
        assert order[3] == "1"
    finally:
        run(server.db.bookings.delete_many({"client_id": f"{TAG}-sort"}))


def test_permissions_enforced_server_side():
    # read_only staff → 403 on the queue and on approve.
    _, ro_headers = _insert_staff("read_only", role="admin")
    r = run(_http.get("/api/admin/pending-actions", headers=ro_headers))
    assert r.status_code == 403

    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "dog_id": "", "dog_name": "PermDog", "client_id": f"{TAG}-perm",
        "client_name": "Perm", "date": _future(2), "time": "10:00", "service_type": "other",
        "status": "pending", "created_at": server.now_iso(), "is_meet_greet": True,
    }))
    try:
        r = run(_http.post(f"/api/bookings/{bid}/approve", headers=ro_headers))
        assert r.status_code == 403, "approval by direct API without booking_edit must 403"

        # front_desk (has booking_edit) → sees the queue.
        _, fd_headers = _insert_staff("front_desk", role="admin")
        r = run(_http.get("/api/admin/pending-actions", headers=fd_headers))
        assert r.status_code == 200
        assert any(a["deep_link"].get("booking_id") == bid for a in r.json()["items"])

        # Count endpoint returns zeros (not an error) for unauthorized roles.
        r = run(_http.get("/api/admin/pending-actions/count", headers=ro_headers))
        assert r.status_code == 200 and r.json()["total"] == 0
    finally:
        run(server.db.bookings.delete_one({"id": bid}))


def test_type_filter_and_counts_agree():
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "dog_id": "d", "dog_name": "CountDog", "client_id": f"{TAG}-count",
        "client_name": "Counter", "date": _future(3), "service_type": "daycare",
        "status": "pending", "created_at": server.now_iso(),
    }))
    try:
        res = _actions()
        assert res["counts"]["total"] == len(res["items"]) if len(res["items"]) <= 300 else True
        only_bookings = _actions(type_filter="booking_approval")
        assert all(a["type"] == "booking_approval" for a in only_bookings["items"])
        assert any(a["deep_link"].get("booking_id") == bid for a in only_bookings["items"])
    finally:
        run(server.db.bookings.delete_one({"id": bid}))
