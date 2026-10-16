"""Printify API client — pure unit tests, no network and no live server.

Covers the plain-env-var "optional integration" convention (unset keys
refuse with a catchable error, never a crash) and the request shape for
create_order/get_order. The actual HTTP call is mocked; this has never
been run against a live Printify account — see client.py's docstring.
"""
import asyncio
import hashlib
import hmac
from unittest.mock import AsyncMock, patch

import pytest

from domains.printify import client as printify_client


class _FakeResponse:
    def __init__(self, status_code, json_body=None, text=""):
        self.status_code = status_code
        self._json_body = json_body or {}
        self.text = text or str(json_body)

    def json(self):
        return self._json_body


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_create_order_refuses_when_not_configured():
    with patch.object(printify_client, "PRINTIFY_ENABLED", False):
        with pytest.raises(printify_client.PrintifyNotConfigured):
            _run(printify_client.create_order(
                external_id="order-1",
                line_items=[printify_client.PrintifyLineItem("p1", "v1", 1)],
                address_to=printify_client.PrintifyAddress(
                    first_name="A", last_name="B", email="a@b.com", phone="555",
                    country="US", region="OH", address1="1 Main St", city="Columbus", zip="43215",
                ),
            ))


def test_get_order_refuses_when_not_configured():
    with patch.object(printify_client, "PRINTIFY_ENABLED", False):
        with pytest.raises(printify_client.PrintifyNotConfigured):
            _run(printify_client.get_order("pf-order-1"))


def test_get_product_refuses_when_not_configured():
    with patch.object(printify_client, "PRINTIFY_ENABLED", False):
        with pytest.raises(printify_client.PrintifyNotConfigured):
            _run(printify_client.get_product("pf-prod-1"))


def test_get_product_fetches_by_id_and_returns_the_parsed_body():
    fake_resp = _FakeResponse(200, json_body={"id": "pf-prod-1", "title": "Trail Dog Hoodie", "variants": []})
    mock_get = AsyncMock(return_value=fake_resp)
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_API_KEY", "test-key"), \
         patch.object(printify_client, "PRINTIFY_SHOP_ID", "shop-1"), \
         patch("httpx.AsyncClient.get", mock_get):
        result = _run(printify_client.get_product("pf-prod-1"))
    assert result == {"id": "pf-prod-1", "title": "Trail Dog Hoodie", "variants": []}
    assert mock_get.call_args.args == ("/shops/shop-1/products/pf-prod-1.json",)


def test_get_product_raises_on_a_non_2xx_response():
    fake_resp = _FakeResponse(404, text="not found")
    mock_get = AsyncMock(return_value=fake_resp)
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_API_KEY", "test-key"), \
         patch.object(printify_client, "PRINTIFY_SHOP_ID", "shop-1"), \
         patch("httpx.AsyncClient.get", mock_get):
        with pytest.raises(printify_client.PrintifyApiError) as exc_info:
            _run(printify_client.get_product("missing"))
    assert exc_info.value.status_code == 404


def test_create_order_posts_the_documented_shape_and_returns_the_parsed_body():
    fake_resp = _FakeResponse(200, json_body={"id": "pf-order-123"})
    mock_post = AsyncMock(return_value=fake_resp)
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_API_KEY", "test-key"), \
         patch.object(printify_client, "PRINTIFY_SHOP_ID", "shop-1"), \
         patch("httpx.AsyncClient.post", mock_post):
        result = _run(printify_client.create_order(
            external_id="order-1",
            line_items=[printify_client.PrintifyLineItem("p1", "v1", 2)],
            address_to=printify_client.PrintifyAddress(
                first_name="A", last_name="B", email="a@b.com", phone="555",
                country="US", region="OH", address1="1 Main St", city="Columbus", zip="43215",
            ),
            send_shipping_notification=False,
        ))
    assert result == {"id": "pf-order-123"}
    url, kwargs = mock_post.call_args.args, mock_post.call_args.kwargs
    assert url == ("/shops/shop-1/orders.json",)
    body = kwargs["json"]
    assert body["external_id"] == "order-1"
    assert body["line_items"] == [{"product_id": "p1", "variant_id": "v1", "quantity": 2}]
    assert body["send_shipping_notification"] is False
    assert body["address_to"]["city"] == "Columbus"
    assert kwargs["headers"]["Authorization"] == "Bearer test-key"


def test_create_order_raises_on_a_non_2xx_response():
    fake_resp = _FakeResponse(422, text="variant not found")
    mock_post = AsyncMock(return_value=fake_resp)
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_API_KEY", "test-key"), \
         patch.object(printify_client, "PRINTIFY_SHOP_ID", "shop-1"), \
         patch("httpx.AsyncClient.post", mock_post):
        with pytest.raises(printify_client.PrintifyApiError) as exc_info:
            _run(printify_client.create_order(
                external_id="order-1",
                line_items=[printify_client.PrintifyLineItem("p1", "v1", 1)],
                address_to=printify_client.PrintifyAddress(
                    first_name="A", last_name="B", email="a@b.com", phone="555",
                    country="US", region="OH", address1="1 Main St", city="Columbus", zip="43215",
                ),
            ))
    assert exc_info.value.status_code == 422


# ── Webhook signature verification ──────────────────────────────────────────

def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_webhook_signature_accepts_a_correctly_signed_body():
    body = b'{"id":"evt-1","type":"order:updated"}'
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
        assert printify_client.verify_webhook_signature(body, _sign("shh", body)) is True


def test_webhook_signature_rejects_a_tampered_body():
    body = b'{"id":"evt-1","type":"order:updated"}'
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
        sig = _sign("shh", body)
        assert printify_client.verify_webhook_signature(body + b"x", sig) is False


def test_webhook_signature_rejects_the_wrong_secret():
    body = b'{"id":"evt-1","type":"order:updated"}'
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
        assert printify_client.verify_webhook_signature(body, _sign("wrong-secret", body)) is False


def test_webhook_signature_rejects_a_missing_header():
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
        assert printify_client.verify_webhook_signature(b"{}", None) is False


def test_webhook_signature_rejects_a_bad_prefix():
    body = b"{}"
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
        digest = hmac.new(b"shh", body, hashlib.sha256).hexdigest()
        assert printify_client.verify_webhook_signature(body, digest) is False  # missing "sha256=" prefix


def test_webhook_signature_fails_closed_when_no_secret_is_configured():
    body = b"{}"
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", ""):
        # Even a signature that WOULD be valid under some secret must not pass —
        # an unconfigured secret must never be treated as "anything goes".
        assert printify_client.verify_webhook_signature(body, _sign("whatever", body)) is False


# ── Webhook subscription management ─────────────────────────────────────────

def test_ensure_webhooks_registered_refuses_without_a_secret():
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", ""):
        with pytest.raises(printify_client.PrintifyNotConfigured):
            _run(printify_client.ensure_webhooks_registered("https://example.com/api/webhooks/printify"))


def test_ensure_webhooks_registered_creates_only_whats_missing():
    url = "https://example.com/api/webhooks/printify"
    # Already subscribed to one topic at this exact URL; the rest are new.
    existing = _FakeResponse(200, json_body=[{"topic": "order:created", "url": url}])
    created_resp = _FakeResponse(200, json_body={"id": "wh-1"})
    mock_get = AsyncMock(return_value=existing)
    mock_post = AsyncMock(return_value=created_resp)
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_API_KEY", "test-key"), \
         patch.object(printify_client, "PRINTIFY_SHOP_ID", "shop-1"), \
         patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"), \
         patch("httpx.AsyncClient.get", mock_get), \
         patch("httpx.AsyncClient.post", mock_post):
        result = _run(printify_client.ensure_webhooks_registered(url))
    assert result["already_registered"] == ["order:created"]
    assert set(result["created"]) == set(printify_client.WEBHOOK_TOPICS) - {"order:created"}
    assert mock_post.call_count == len(printify_client.WEBHOOK_TOPICS) - 1
    first_call_body = mock_post.call_args_list[0].kwargs["json"]
    assert first_call_body["secret"] == "shh"
    assert first_call_body["url"] == url
