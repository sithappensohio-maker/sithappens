"""A Shop customer is told when their order is ready for pickup (audit:
"Pickup customers aren't told their order is ready").

Mark Ready only changed the order's status; the customer's page promised
"we'll let you know" and nothing did. Now the one request that makes an
order ready emails the customer once (held, not lost, in Quiet Hours), and
staff are told what happened to the email. Fully refunded orders and orders
with nothing left to collect get no email.

Disposable tag TEST_PICKUP_READY.
"""
import asyncio
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import resend
import server
import email_service
from _test_loop import run
from email_templates_registry import EMAIL_TEMPLATES
from domains.shop import pickup as shop_pickup

TAG = "TEST_PICKUP_READY"
ADMIN = {"id": "pk-admin", "name": "Pickup QA", "email": "pk@test", "role": "admin"}


@contextlib.contextmanager
def _mail(*, working=True, quiet=False, boom=False):
    sent = []
    saved = (email_service.RESEND_API_KEY, resend.Emails.send, email_service._is_in_quiet_hours)

    def _fake_send(params, options=None):
        if boom:
            raise RuntimeError("provider down")
        sent.append({"to": list(params.get("to") or []), "subject": params.get("subject"),
                     "html": params.get("html"), "key": (options or {}).get("idempotency_key")})
        return {"id": "fake-" + uuid.uuid4().hex[:6]}

    async def _quiet():
        return quiet

    email_service.RESEND_API_KEY = "test-key" if working else ""
    resend.Emails.send = _fake_send
    email_service._is_in_quiet_hours = _quiet
    try:
        yield sent
    finally:
        email_service.RESEND_API_KEY, resend.Emails.send, email_service._is_in_quiet_hours = saved


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    ids = [o["id"] for o in run(server.db.shop_orders.find({"tag": TAG}, {"_id": 0, "id": 1}).to_list(None))]
    run(server.db.shop_orders.delete_many({"tag": TAG}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))
    for oid in ids:
        run(server.db.email_outbox.delete_many({"key": shop_pickup.ready_key(oid)}))
        run(server.db.notification_log.delete_many({"key": shop_pickup.ready_key(oid)}))


def _order(*, client=True, lines=None, refund_status=None, pickup="preparing", name=f"{TAG} Dana Doe", email="old@example.com"):
    cid = None
    if client:
        cid = f"{TAG}-c-{uuid.uuid4().hex[:6]}"
        run(server.db.clients.insert_one({"id": cid, "name": name, "email": "dana.now@example.com"}))
    doc = {"id": str(uuid.uuid4()), "tag": TAG, "status": "paid", "client_id": cid, "client_name": name,
           "client_email": email, "total": 42.5, "fulfillment_status": "fulfilled", "pickup_status": pickup,
           "lines": lines or [{"kind": "product", "name": "Rope Leash", "quantity": 2}],
           "created_at": server.now_iso()}
    if refund_status:
        doc["refund_status"] = refund_status
    run(server.db.shop_orders.insert_one(dict(doc)))
    return doc


def _act(order, action="mark_ready"):
    return run(server.update_shop_order_fulfillment(order["id"], server.ShopOrderFulfillmentActionIn(action=action), user=ADMIN))


def _ref(order):
    return order["id"][:8].upper()


def test_mark_ready_emails_the_client_at_their_current_address():
    o = _order()
    with _mail() as sent:
        out = _act(o)
    assert out["pickup_status"] == "ready_for_pickup"
    assert out["ready_email"] == {"state": "sent", "to": "dana.now@example.com"}
    [m] = sent
    assert m["to"] == ["dana.now@example.com"]
    assert "ready for pickup" in m["subject"] and _ref(o) in m["subject"]
    assert "2× Rope Leash" in m["html"] and m["key"] == shop_pickup.ready_key(o["id"])


def test_pressing_mark_ready_again_never_sends_twice():
    o = _order()
    with _mail() as sent:
        _act(o)
        again = _act(o)
    assert len(sent) == 1 and "ready_email" not in again


def test_two_staff_pressing_at_once_send_one_email():
    o = _order()

    async def both():
        call = lambda: server.update_shop_order_fulfillment(o["id"], server.ShopOrderFulfillmentActionIn(action="mark_ready"), user=ADMIN)  # noqa: E731
        return await asyncio.gather(call(), call(), return_exceptions=True)
    with _mail() as sent:
        run(both())
    assert len(sent) == 1


def test_a_guest_is_emailed_at_their_checkout_address_with_the_name_escaped_and_no_portal_link(monkeypatch):
    monkeypatch.setattr(email_service, "APP_PUBLIC_URL", "https://sithappens.example")
    o = _order(client=False, name=f"<img src=x onerror=alert(1)> & Co {TAG}", email="guest@example.com")
    with _mail() as sent:
        out = _act(o)
    assert out["ready_email"]["state"] == "sent"
    [m] = sent
    assert m["to"] == ["guest@example.com"]
    assert "<img src=x" not in m["html"] and "&amp;lt;" not in m["html"]
    assert "https://sithappens.example" not in m["html"], "a guest has no account to open"


def test_quiet_hours_hold_the_email_until_morning_then_send_it_once():
    o = _order()
    with _mail(quiet=True) as sent:
        out = _act(o)
    assert sent == [] and out["ready_email"]["state"] == "queued" and out["ready_email"]["reason"] == "quiet_hours"
    assert run(server.db.email_outbox.count_documents({"key": shop_pickup.ready_key(o["id"]), "status": "pending"})) == 1
    with _mail() as sent:
        run(email_service.process_email_outbox(server.db, limit=5000))
        run(email_service.process_email_outbox(server.db, limit=5000))
    assert len([m for m in sent if m["key"] == shop_pickup.ready_key(o["id"])]) == 1
    assert run(server.db.notification_log.find_one({"key": shop_pickup.ready_key(o["id"])}))


@pytest.mark.parametrize("then", ["picked_up", "refunded", "items_refunded"])
def test_a_held_email_is_dropped_once_the_order_is_collected_or_refunded(then):
    o = _order(lines=[{"kind": "product", "name": "Rope Leash", "quantity": 1},
                      {"kind": "gift_card", "name": "Gift card", "quantity": 1}])
    with _mail(quiet=True):
        _act(o)
    if then == "picked_up":
        _act(o, "mark_picked_up")
    elif then == "refunded":
        run(server.db.shop_orders.update_one({"id": o["id"]}, {"$set": {"refund_status": "full"}}))
    else:   # only the leash refunded: the order is "partly refunded" with nothing to collect
        run(server.db.shop_orders.update_one({"id": o["id"]}, {"$set": {"refund_status": "partial", "lines.0.quantity_refunded": 1}}))
    with _mail() as sent:
        run(email_service.process_email_outbox(server.db, limit=5000))
    assert [m for m in sent if m["key"] == shop_pickup.ready_key(o["id"])] == []


def test_a_fully_refunded_order_is_marked_ready_without_an_email():
    o = _order(refund_status="full")
    with _mail() as sent:
        out = _act(o)
    assert out["pickup_status"] == "ready_for_pickup" and out["ready_email"] == {"state": "skipped", "reason": "refunded"}
    assert sent == []


def test_nothing_left_to_collect_means_no_email():
    o = _order(lines=[{"kind": "product", "name": "Rope Leash", "quantity": 1, "quantity_refunded": 1},
                      {"kind": "gift_card", "name": "Gift card", "quantity": 1}])
    with _mail() as sent:
        out = _act(o)
    assert out["ready_email"] == {"state": "skipped", "reason": "nothing_to_collect"} and sent == []


def test_only_the_items_still_to_collect_are_listed():
    o = _order(lines=[{"kind": "product", "name": "Rope Leash", "quantity": 3, "quantity_refunded": 1},
                      {"kind": "product", "name": "Treat Pouch", "quantity": 1, "quantity_refunded": 1},
                      {"kind": "gift_card", "name": "Gift card", "quantity": 1}])
    with _mail() as sent:
        _act(o)
    html = sent[0]["html"]
    assert "2× Rope Leash" in html and "Treat Pouch" not in html and "Gift card" not in html


def test_no_address_on_file_still_marks_it_ready_and_says_so():
    o = _order(client=False, email="")
    with _mail() as sent:
        out = _act(o)
    assert out["pickup_status"] == "ready_for_pickup" and out["ready_email"] == {"state": "no_email"} and sent == []


def test_a_mail_outage_never_fails_mark_ready():
    o = _order()
    with _mail(boom=True):
        out = _act(o)
    assert out["pickup_status"] == "ready_for_pickup" and out["ready_email"]["state"] in ("queued", "failed")


def test_orders_with_nothing_to_pick_up_and_picked_up_send_nothing():
    gift_only = _order(pickup="not_applicable", lines=[{"kind": "gift_card", "name": "Gift card", "quantity": 1}])
    with _mail() as sent:
        with pytest.raises(server.HTTPException) as e:
            _act(gift_only)
        assert e.value.status_code == 400
        ready = _order(pickup="ready_for_pickup")
        out = _act(ready, "mark_picked_up")
    assert out["pickup_status"] == "picked_up" and "ready_email" not in out and sent == []


def test_the_owner_can_edit_this_email_in_settings():
    entry = next(t for t in EMAIL_TEMPLATES if t["slug"] == "client_shop_order_ready")
    assert entry["audience"] == "client" and "ready for pickup" in entry["default_subject"]
    assert {"first_name", "order_number", "items", "pickup_address"} <= set(entry["variables"])


def test_an_error_building_the_email_never_fails_mark_ready(monkeypatch):
    async def broken(*a, **kw):
        raise RuntimeError("template exploded")
    monkeypatch.setattr(email_service, "send_shop_order_ready", broken)
    o = _order()
    out = _act(o)
    assert out["pickup_status"] == "ready_for_pickup" and out["ready_email"] == {"state": "failed"}
