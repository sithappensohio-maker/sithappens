"""Printify API client — pure unit tests, no network and no live server.

Covers the plain-env-var "optional integration" convention (unset keys
refuse with a catchable error, never a crash) and the request shape for
create_order/get_order. The actual HTTP call is mocked; this has never
been run against a live Printify account — see client.py's docstring.
"""
import asyncio
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
