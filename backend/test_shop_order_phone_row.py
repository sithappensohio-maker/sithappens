"""The new-Shop-order alert carries the buyer's phone number, so staff can ring a guest about a
pickup (audit #74). The number was saved on the order and never sent. Disposable tag TEST_SHOP_PHONE."""
import email_service
import _test_env  # noqa: F401 — must run before `import server`
import pytest
from _test_loop import run


@pytest.fixture()
def capture(monkeypatch):
    seen = {}

    async def fake_render(*, slug, ctx, rows, **kw):
        seen["rows"] = list(rows)
        return "subject", "<p>html</p>"

    async def fake_queue(**kw):
        seen["queued"] = kw
        return True
    monkeypatch.setattr(email_service, "ADMIN_NOTIFICATION_EMAIL", "owner@example.com")
    monkeypatch.setattr(email_service, "_render", fake_render)
    monkeypatch.setattr(email_service, "_queue_email", fake_queue)
    return seen


def test_the_new_order_alert_gives_the_buyers_phone(capture):
    order = {"id": "TEST_SHOP_PHONE-order-1", "client_name": "Guest Pat", "client_phone": "614-555-0199",
             "total": 25.0, "lines": [{"kind": "product", "name": "Treat", "quantity": 1}],
             "fulfillment_status": "pending"}
    assert run(email_service.queue_admin_new_shop_order(order)) is True
    assert ("Phone", "614-555-0199") in capture["rows"]


def test_an_order_with_no_phone_says_so(capture):
    order = {"id": "TEST_SHOP_PHONE-order-2", "client_name": "Guest Pat", "total": 25.0,
             "lines": [{"kind": "product", "name": "Treat", "quantity": 1}]}
    run(email_service.queue_admin_new_shop_order(order))
    assert ("Phone", "—") in capture["rows"]
