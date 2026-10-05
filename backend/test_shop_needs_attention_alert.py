"""A paid Shop order whose line could not be fulfilled sends the owner a second alert
(audit #73: the new-order email was sent at payment time and always said "Needs
attention: No"). One alert per order, however many times it is queued. Disposable tag
TEST_SHOP_ATTN."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import email_service
from _test_loop import run

TAG = "TEST_SHOP_ATTN"


@pytest.fixture()
def order(monkeypatch):
    monkeypatch.setattr(email_service, "ADMIN_NOTIFICATION_EMAIL", "owner@example.com")
    oid = f"{TAG}-{uuid.uuid4().hex[:8]}"
    yield {"id": oid, "lines": [{"name": "Bag of food", "kind": "product", "fulfillment_status": "failed"}]}
    run(server.db.email_outbox.delete_many({"key": f"shop:needs-attention:{oid}"}))


def test_a_failed_line_queues_one_owner_alert(order):
    assert run(email_service.queue_admin_shop_order_needs_attention(order)) is True
    assert run(email_service.queue_admin_shop_order_needs_attention(order)) is True
    rows = run(server.db.email_outbox.count_documents({"key": f"shop:needs-attention:{order['id']}"}))
    assert rows == 1, "one alert per order, however many times it is queued"
