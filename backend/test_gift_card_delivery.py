"""A paid gift card must reach somebody (audit 2026-09-25 #56).

Before: the code was emailed once, right away. If that send failed — Quiet
Hours, the mail service down — it was dropped: nothing retried it, the Shop
still said "emailed", a guest buyer never saw the code, and staff had no way
to send it again.

Now:
  * a send that cannot go out waits in the email queue and is retried until
    it does, and the card is marked emailed only when it really went;
  * the queue checks the card right before each retry — a voided card, or
    one staff have re-addressed, is never sent to the old address;
  * staff can send it again, to a corrected address if it was mistyped;
  * the buyer's paid receipt shows the code and whether the email arrived.

Self-contained fixtures (never import another test module). Disposable tag
TEST_GC_DELIVERY. The mail provider is always faked — nothing leaves.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import email_service
import resend
from fastapi import HTTPException
from _test_loop import run

from domains.gift_cards import online as gift_card_online
from domains.gift_cards import services as gift
from domains.gift_cards import shop as gift_card_shop
from domains.shop import checkout as shop_checkout

TAG = "TEST_GC_DELIVERY"
ADMIN = {"id": "gcd-admin", "name": "GC Delivery QA", "email": "gcd@test", "role": "admin"}


class _Req:
    def __init__(self, headers=None):
        ip = f"198.19.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        self.client = type("C", (), {"host": ip})()
        self.headers = headers or {}
        self.url = type("U", (), {"path": "/api/x"})()


def _route(name):
    for r in server.app.routes:
        if getattr(r, "name", None) == name:
            return r.endpoint
    raise AssertionError(f"route {name} is not registered")


@contextlib.contextmanager
def _mail(*, working=True, quiet=False):
    """The mail provider, faked. `working=False` is no provider at all (the
    send fails and is queued); `quiet=True` is Quiet Hours."""
    sent = []
    saved = (email_service.RESEND_API_KEY, resend.Emails.send, email_service._is_in_quiet_hours)

    def _fake_send(params, options=None):
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
    # The real sender, as bootstrap wires it — another module may have
    # reconfigured the domain for its own fakes.
    gift.configure(db=server.db, now_iso=server.now_iso, business_today=server.business_today,
                   logger=server.logger, email_sender=gift_card_online.email_card)
    prev_email_service = gift_card_online._email_service
    gift_card_online._email_service = email_service
    made = []
    yield made
    gift_card_online._email_service = prev_email_service
    for cid in made:
        run(server.db.gift_cards.delete_many({"id": cid}))
        run(server.db.gift_card_transactions.delete_many({"gift_card_id": cid}))
        run(server.db.email_outbox.delete_many({"key": {"$regex": f"^gift_card_delivered:{cid}"}}))
    run(server.db.shop_orders.delete_many({"tag": TAG}))
    run(server.db.clients.delete_many({"name": {"$regex": TAG}}))


def _card(made, email="dana@example.com", amount=25.0, card_id=None):
    card = run(gift.mint_card(amount=amount, actor=ADMIN, recipient_name="Dana", recipient_email=email,
                              note=TAG, origin="digital", card_id=card_id))
    made.append(card["id"])
    return run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))


def _fresh(card):
    return run(server.db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}))


def _pending(card):
    return run(server.db.email_outbox.find(
        {"key": {"$regex": f"^gift_card_delivered:{card['id']}"}, "status": "pending"}, {"_id": 0}).to_list(20))


def _drain():
    # The queue is shared by the whole run: take every due row, not the
    # default 50 oldest, or this test's own row can be left behind.
    run(email_service.process_email_outbox(server.db, limit=5000))


def _to(sent, address):
    return [s for s in sent if address in s["to"]]


# ─────────────────────────────────────────────── the send waits and is retried

def test_a_card_email_that_cannot_go_now_waits_and_goes_later(_cleanup):
    card = _card(_cleanup)
    with _mail(working=False):
        assert run(gift.send_card_email(card)) is False
    now = _fresh(card)
    assert now.get("code_emailed_at") is None, "never marked emailed when it did not go"
    assert now.get("email_queued_at") and gift.email_state(now) == "queued"
    rows = _pending(card)
    assert len(rows) == 1 and rows[0]["to_email"] == "dana@example.com"

    with _mail() as sent:
        _drain()
    assert len(_to(sent, "dana@example.com")) == 1
    assert gift._display(card["code"]) in _to(sent, "dana@example.com")[0]["html"]
    done = _fresh(card)
    assert gift.email_state(done) == "sent" and done["email_delivered_to"] == "dana@example.com"
    assert done.get("code_emailed_at") and not done.get("email_queued_at")
    assert _pending(card) == []


def test_quiet_hours_hold_the_card_email_until_they_end(_cleanup):
    card = _card(_cleanup)
    with _mail(quiet=True) as sent:
        assert run(gift.send_card_email(card)) is False
        _drain()
    assert sent == [] and gift.email_state(_fresh(card)) == "queued"
    with _mail() as sent:
        _drain()
    assert len(_to(sent, "dana@example.com")) == 1
    assert gift.email_state(_fresh(card)) == "sent"


def test_a_card_that_went_first_time_is_sent_once(_cleanup):
    card = _card(_cleanup)
    with _mail() as sent:
        assert run(gift.send_card_email(card)) is True
        assert run(gift.send_card_email(_fresh(card))) is False
        _drain()
    assert len(_to(sent, "dana@example.com")) == 1
    assert gift.email_state(_fresh(card)) == "sent" and _pending(card) == []


# ─────────────────────────────────────────────── the queue checks the card

def test_a_card_voided_while_its_email_waits_is_never_sent(_cleanup):
    card = _card(_cleanup)
    with _mail(working=False):
        run(gift.send_card_email(card))
    run(gift.void_card(code=card["code"], body=gift.GiftCardVoidIn(reason="refunded"), actor=ADMIN))
    with _mail() as sent:
        _drain()
    assert _to(sent, "dana@example.com") == []
    assert _pending(card) == []


def test_a_waiting_first_email_is_dropped_once_the_card_has_arrived(_cleanup):
    card = _card(_cleanup)
    with _mail(working=False):
        run(gift.send_card_email(card))
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"email_delivered_at": "2026-09-27T00:00:00+00:00"}}))
    with _mail() as sent:
        _drain()
    assert _to(sent, "dana@example.com") == []


# ─────────────────────────────────────────────── staff send it again

def test_staff_fix_a_mistyped_address_and_the_old_one_never_gets_it(_cleanup):
    card = _card(_cleanup, email="dana@exmaple.com")
    with _mail(working=False):
        run(gift.send_card_email(card))
    assert len(_pending(card)) == 1
    with _mail() as sent:
        out = run(gift.resend_card_email(code=card["code"], actor=ADMIN,
                                         body=gift.GiftCardSendEmailIn(recipient_email=" Dana@Example.com ")))
        _drain()
    assert out["sent"] is True and out["queued"] is False
    assert out["card"]["recipient_email"] == "dana@example.com" and out["card"]["email_state"] == "sent"
    assert len(_to(sent, "dana@example.com")) == 1
    assert _to(sent, "dana@exmaple.com") == [], "the mistyped address must never get the code"
    assert _pending(card) == []
    kinds = [t["kind"] for t in run(server.db.gift_card_transactions.find(
        {"gift_card_id": card["id"]}, {"_id": 0, "kind": 1}).to_list(20))]
    assert "edit" in kinds and "email" in kinds


def test_a_resend_that_cannot_go_now_waits_in_place_of_the_old_one(_cleanup):
    card = _card(_cleanup, email="dana@exmaple.com")
    with _mail(working=False):
        run(gift.send_card_email(card))
        out = run(gift.resend_card_email(code=card["code"], actor=ADMIN,
                                         body=gift.GiftCardSendEmailIn(recipient_email="dana@example.com")))
    assert out["sent"] is False and out["queued"] is True and out["card"]["email_state"] == "queued"
    rows = _pending(card)
    assert len(rows) == 1 and rows[0]["to_email"] == "dana@example.com" and ":resend:" in rows[0]["key"]
    with _mail() as sent:
        _drain()
    assert len(_to(sent, "dana@example.com")) == 1 and _to(sent, "dana@exmaple.com") == []
    assert gift.email_state(_fresh(card)) == "sent"


def test_staff_can_resend_a_card_that_already_arrived(_cleanup):
    card = _card(_cleanup)
    with _mail() as sent:
        run(gift.send_card_email(card))
        out = run(gift.resend_card_email(code=card["code"], actor=ADMIN, body=gift.GiftCardSendEmailIn()))
    assert out["sent"] is True
    assert len(_to(sent, "dana@example.com")) == 2
    keys = {s["key"] for s in sent}
    assert len(keys) == 2, "a re-send needs its own key or the provider would swallow it as a duplicate"


def test_resend_refuses_cards_with_nothing_to_send_and_bad_addresses(_cleanup):
    voided = _card(_cleanup)
    run(gift.void_card(code=voided["code"], body=gift.GiftCardVoidIn(reason="lost card"), actor=ADMIN))
    spent = _card(_cleanup)
    run(server.db.gift_cards.update_one({"id": spent["id"]}, {"$set": {"status": "spent", "balance": 0.0}}))
    blank = run(gift.mint_stock(quantity=1, actor=ADMIN, face_value=None))[0]
    _cleanup.append(blank["id"])
    for c in (voided, spent, blank):
        with pytest.raises(HTTPException) as e:
            run(gift.resend_card_email(code=c["code_display"] if "code_display" in c else c["code"],
                                       actor=ADMIN, body=gift.GiftCardSendEmailIn()))
        assert e.value.status_code == 409
    ok = _card(_cleanup)
    for bad in ("not-an-email", "", "a@b"):
        with pytest.raises(HTTPException) as e:
            run(gift.resend_card_email(code=ok["code"], actor=ADMIN, body=gift.GiftCardSendEmailIn(recipient_email=bad)))
        assert e.value.status_code == 400
    assert _fresh(ok)["recipient_email"] == "dana@example.com"


def test_the_staff_route_is_wired(_cleanup):
    card = _card(_cleanup)
    with _mail() as sent:
        out = run(_route("send_gift_card_email")(card["code"], gift.GiftCardSendEmailIn(), _Req(), ADMIN))
    assert out["ok"] is True and out["sent"] is True and len(_to(sent, "dana@example.com")) == 1


# ─────────────────────────────────────────────── the buyer's receipt

def _shop_order(*, client_id=None, status="paid", guest_token=None, email="buyer@example.com"):
    oid = str(uuid.uuid4())
    order = {
        "id": oid, "tag": TAG, "status": status, "client_id": client_id, "client_email": email,
        "client_name": "Buyer", "created_at": server.now_iso(), "total": 25.0, "subtotal": 25.0,
        "tax_amount": 0.0, "is_guest_order": bool(guest_token),
        "guest_token_hash": shop_checkout.hash_guest_token(guest_token) if guest_token else None,
        "lines": [{"item_id": "gl1", "kind": "gift_card", "ref_id": "gc-2500", "name": "Gift card · $25.00",
                   "quantity": 1, "unit_price": 25.0, "line_subtotal": 25.0, "line_total": 25.0,
                   "recipient_email": "nan@example.com", "recipient_name": "Nan",
                   "fulfillment_status": "fulfilled" if status == "paid" else "pending"}],
    }
    run(server.db.shop_orders.insert_one(dict(order)))
    return order


def _fulfil(order, made):
    with _mail(working=False):
        out = run(gift_card_shop.fulfill_line(order, order["lines"][0], mint=gift.mint_card,
                                              email=gift.send_card_email))
    made.extend(gift_card_shop._unit_ids(order, order["lines"][0]))
    return out


def test_a_signed_in_buyer_sees_the_code_and_that_it_has_not_arrived_yet(_cleanup):
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Buyer", email=f"{uuid.uuid4().hex[:8]}@example.com"),
                                 {"id": "x", "role": "admin", "name": "QA"}))
    user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Buyer"}
    order = _shop_order(client_id=c["id"])
    out = _fulfil(order, _cleanup)
    view = run(server.portal_shop_order_status(order["id"], user))
    cards = view["lines"][0]["gift_cards"]
    assert [x["code_display"] for x in cards] == [gift._display(out["codes"][0])]
    assert cards[0]["email_state"] == "queued" and cards[0]["emailed_to"] == "nan@example.com"
    assert cards[0]["amount"] == 25.0


def test_an_unpaid_order_shows_no_code(_cleanup):
    c = run(server.create_client(server.ClientIn(name=f"{TAG} Buyer2", email=f"{uuid.uuid4().hex[:8]}@example.com"),
                                 {"id": "x", "role": "admin", "name": "QA"}))
    user = {"id": str(uuid.uuid4()), "role": "client", "client_id": c["id"], "name": "Buyer"}
    order = _shop_order(client_id=c["id"], status="pending_payment")
    view = run(server.portal_shop_order_status(order["id"], user))
    assert view["lines"][0]["gift_cards"] == []


def test_a_guest_buyer_sees_the_code_on_their_receipt_but_never_a_voided_one(_cleanup):
    token = "tok-" + uuid.uuid4().hex
    order = _shop_order(guest_token=token)
    out = _fulfil(order, _cleanup)
    status_route = _route("public_shop_order_status")
    view = run(status_route(order["id"], _Req({"x-guest-token": token}), ""))
    assert [x["code_display"] for x in view["lines"][0]["gift_cards"]] == [gift._display(out["codes"][0])]
    run(gift.void_card(code=out["codes"][0], body=gift.GiftCardVoidIn(reason="refunded"), actor=ADMIN))
    view = run(status_route(order["id"], _Req({"x-guest-token": token}), ""))
    assert view["lines"][0]["gift_cards"] == []


# ─────────────────────────────────────────────── review follow-ups

def test_a_code_already_delivered_to_a_typo_is_never_sent_to_a_second_address(_cleanup):
    # The typo address got the code; sending the SAME code elsewhere would
    # leave it spendable in two inboxes. Staff are told to void and reissue.
    card = _card(_cleanup, email="dana@exmaple.com")
    with _mail() as sent:
        assert run(gift.send_card_email(card)) is True
        with pytest.raises(HTTPException) as e:
            run(gift.resend_card_email(code=card["code"], actor=ADMIN,
                                       body=gift.GiftCardSendEmailIn(recipient_email="dana@example.com")))
    assert e.value.status_code == 409 and "Void this card" in e.value.detail
    assert _to(sent, "dana@example.com") == [] and len(_to(sent, "dana@exmaple.com")) == 1
    assert _fresh(card)["recipient_email"] == "dana@exmaple.com"


def test_a_card_voided_after_the_caller_read_it_is_never_sent(_cleanup):
    stale = _card(_cleanup)
    run(gift.void_card(code=stale["code"], body=gift.GiftCardVoidIn(reason="refunded"), actor=ADMIN))
    with _mail() as sent:
        assert run(gift.send_card_email(stale)) is False   # the caller's copy still says "active"
        _drain()
    assert _to(sent, "dana@example.com") == []


def test_an_interrupted_send_never_reads_as_emailed_and_can_be_taken_over(_cleanup):
    card = _card(_cleanup)
    old = "2026-01-01T00:00:00+00:00"
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"code_emailed_at": old, "email_sending_at": old}}))
    assert gift.email_state(_fresh(card)) == "not_sent"
    with _mail() as sent:
        assert run(gift.send_card_email(_fresh(card))) is True
    assert len(_to(sent, "dana@example.com")) == 1
    done = _fresh(card)
    assert gift.email_state(done) == "sent" and not done.get("email_sending_at")


def test_a_send_in_flight_just_now_is_not_taken_over(_cleanup):
    card = _card(_cleanup)
    now = server.now_iso()
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"code_emailed_at": now, "email_sending_at": now}}))
    with _mail() as sent:
        assert run(gift.send_card_email(_fresh(card))) is False
    assert sent == []


def test_a_waiting_email_blocks_a_second_parallel_send(_cleanup):
    card = _card(_cleanup)
    with _mail(working=False):
        run(gift.resend_card_email(code=card["code"], actor=ADMIN, body=gift.GiftCardSendEmailIn()))
    with _mail() as sent:
        assert run(gift.send_card_email(_fresh(card))) is False   # e.g. a Shop "Retry Fulfillment"
        _drain()
    assert len(_to(sent, "dana@example.com")) == 1


def test_queued_is_read_from_the_queue_not_a_leftover_flag(_cleanup):
    # A backup restore brings the card back but never the queue.
    card = _card(_cleanup)
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"email_queued_at": server.now_iso()}}))
    detail = run(gift.card_detail(card["code"]))
    assert detail["email_state"] == "not_sent"
    listed = run(gift.list_cards(limit=500))
    assert next(c for c in listed["cards"] if c["id"] == card["id"])["email_state"] == "not_sent"


def test_a_dropped_queue_row_clears_the_cards_waiting_flag(_cleanup):
    card = _card(_cleanup, email="dana@exmaple.com")
    with _mail(working=False):
        run(gift.send_card_email(card))
    assert _fresh(card).get("email_queued_at")
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"recipient_email": "someone@else.com"}}))
    with _mail() as sent:
        _drain()
    assert _to(sent, "dana@exmaple.com") == []
    assert not _fresh(card).get("email_queued_at")


# ─────────────────────────────────────────────── second review

def test_a_delivery_still_being_stamped_also_blocks_re_addressing(_cleanup):
    # The provider accepted it but the card was not stamped yet: that inbox
    # has the code all the same.
    card = _card(_cleanup, email="dana@exmaple.com")
    run(server.db.email_outbox.insert_one({
        "key": gift.first_email_key(card["id"]), "status": "delivered_pending_stamp",
        "on_success": {"type": "gift_card_emailed", "card_id": card["id"], "to": "dana@exmaple.com", "first": True},
        "created_at": server.now_iso()}))
    with _mail() as sent:
        with pytest.raises(HTTPException) as e:
            run(gift.resend_card_email(code=card["code"], actor=ADMIN,
                                       body=gift.GiftCardSendEmailIn(recipient_email="dana@example.com")))
        assert e.value.status_code == 409
        out = run(gift.resend_card_email(code=card["code"], actor=ADMIN, body=gift.GiftCardSendEmailIn()))
    assert out["sent"] is True and _to(sent, "dana@example.com") == []
    assert _fresh(card)["recipient_email"] == "dana@exmaple.com"


def test_editing_a_card_reports_the_real_queue_state(_cleanup):
    card = _card(_cleanup)
    run(server.db.gift_cards.update_one({"id": card["id"]}, {"$set": {"email_queued_at": server.now_iso()}}))
    view = run(gift.edit_details(code=card["code"], actor=ADMIN,
                                 body=gift.GiftCardDetailsIn(recipient_name="Dana R")))
    assert view["email_state"] == "not_sent"


def test_the_card_says_where_its_code_already_went(_cleanup):
    card = _card(_cleanup)
    assert gift.public_view(card)["already_emailed_to"] == ""
    with _mail():
        run(gift.send_card_email(card))
    assert gift.public_view(_fresh(card))["already_emailed_to"] == "dana@example.com"
