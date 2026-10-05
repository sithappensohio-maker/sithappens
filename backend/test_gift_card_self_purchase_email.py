"""A gift card a customer buys for themselves is not emailed as a gift from "somebody", and
the Shop's order note is not printed in it (audit #77). A real gift keeps its greeting and the
giver's message. Disposable tag TEST_GC_SELF."""
import domains.gift_cards.online as online
import _test_env  # noqa: F401 — must run before `import server`
import pytest


class _FakeEmail:
    def __init__(self):
        self.sent = []

    async def _dispatch(self, **kw):
        self.sent.append(kw)
        return True


@pytest.fixture()
def fake(monkeypatch):
    f = _FakeEmail()
    monkeypatch.setattr(online, "_email_service", f)
    return f


def _card(**over):
    c = {"id": "TEST_GC_SELF-card", "code": "ABCD-EFGH-JKLM", "initial_amount": 25.0, "balance": 25.0,
         "recipient_email": "pat@example.com", "recipient_name": "Pat"}
    c.update(over)
    return c


async def _email(card):
    return await online.email_card(card)


def test_a_self_purchase_is_not_called_a_gift_and_carries_no_order_note(fake):
    import asyncio
    card = _card(self_purchase=True, note="Bought in the Shop · order #1A2B3C4D")
    asyncio.run(_email(card))
    html = fake.sent[0]["body_html"]
    assert "Somebody bought you" not in html
    assert "Bought in the Shop" not in html
    assert "Here is your gift card" in html


def test_a_gift_keeps_its_greeting_and_the_givers_message(fake):
    import asyncio
    card = _card(note="Happy birthday from Sam")
    asyncio.run(_email(card))
    html = fake.sent[0]["body_html"]
    assert "Somebody bought you a gift card." in html
    assert "Happy birthday from Sam" in html
