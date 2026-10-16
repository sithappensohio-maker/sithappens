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


# ── Shipping rates ───────────────────────────────────────────────────────────

# Shape confirmed against the real connected account (blueprint 6 / provider
# 99, a Gildan 5000 tee): the SAME variant set can carry more than one
# profile for the same country at different costs (alternate tiers), and a
# distinct, smaller variant set can have its own profile+cost entirely.
REAL_SHAPE_RATES = {
    "handling_time": {"value": 10, "unit": "day"},
    "profiles": [
        {"variant_ids": [11812, 11813, 12126], "countries": ["US"], "first_item": {"cost": 399, "currency": "USD"}, "additional_items": {"cost": 209, "currency": "USD"}},
        {"variant_ids": [11812, 11813, 12126], "countries": ["US"], "first_item": {"cost": 495, "currency": "USD"}, "additional_items": {"cost": 240, "currency": "USD"}},
        {"variant_ids": [11812, 11813, 12126], "countries": ["CA"], "first_item": {"cost": 969, "currency": "USD"}, "additional_items": {"cost": 439, "currency": "USD"}},
        {"variant_ids": [11812, 11813, 12126], "countries": ["REST_OF_THE_WORLD"], "first_item": {"cost": 1039, "currency": "USD"}, "additional_items": {"cost": 400, "currency": "USD"}},
        {"variant_ids": [11986, 11987], "countries": ["US"], "first_item": {"cost": 799, "currency": "USD"}, "additional_items": {"cost": 240, "currency": "USD"}},
    ],
}


def test_get_shipping_rates_refuses_when_not_configured():
    with patch.object(printify_client, "PRINTIFY_ENABLED", False):
        with pytest.raises(printify_client.PrintifyNotConfigured):
            _run(printify_client.get_shipping_rates(6, 99))


def test_get_shipping_rates_fetches_the_catalog_endpoint_and_caches_it():
    fake_resp = _FakeResponse(200, json_body=REAL_SHAPE_RATES)
    mock_get = AsyncMock(return_value=fake_resp)
    printify_client._SHIPPING_RATES_CACHE.clear()
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_API_KEY", "test-key"), \
         patch("httpx.AsyncClient.get", mock_get):
        first = _run(printify_client.get_shipping_rates(6, 99))
        second = _run(printify_client.get_shipping_rates(6, 99))
    assert first == REAL_SHAPE_RATES
    assert second == REAL_SHAPE_RATES
    mock_get.assert_called_once()  # second call served from cache, no second request
    assert mock_get.call_args.args == ("/catalog/blueprints/6/print_providers/99/shipping.json",)
    printify_client._SHIPPING_RATES_CACHE.clear()


def test_estimate_shipping_picks_the_cheapest_matching_profile():
    # Two profiles both cover variant 12126 for US at $3.99 and $4.95 —
    # the cheaper one must win, matching create_order's own shipping_method=1.
    result = printify_client.estimate_shipping_cents(REAL_SHAPE_RATES, variant_id=12126, quantity=1, country="US")
    assert result == {"cost_cents": 399, "currency": "USD"}


def test_estimate_shipping_charges_first_item_plus_additional_for_more_than_one():
    result = printify_client.estimate_shipping_cents(REAL_SHAPE_RATES, variant_id=12126, quantity=3, country="US")
    assert result["cost_cents"] == 399 + 2 * 209


def test_estimate_shipping_falls_back_to_rest_of_the_world():
    result = printify_client.estimate_shipping_cents(REAL_SHAPE_RATES, variant_id=12126, quantity=1, country="DE")
    assert result == {"cost_cents": 1039, "currency": "USD"}


def test_estimate_shipping_returns_none_for_an_unknown_variant():
    assert printify_client.estimate_shipping_cents(REAL_SHAPE_RATES, variant_id="not-a-real-variant", quantity=1, country="US") is None


def test_estimate_shipping_uses_the_right_profile_for_a_different_variant_subset():
    # Variant 11986 only appears in the $7.99 profile — must never fall
    # through to the $3.99 one just because it's cheaper elsewhere.
    result = printify_client.estimate_shipping_cents(REAL_SHAPE_RATES, variant_id=11986, quantity=1, country="US")
    assert result == {"cost_cents": 799, "currency": "USD"}


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


# ── Personalization ──────────────────────────────────────────────────────────

REAL_PRINT_AREAS = [{
    "variant_ids": [70870],
    "placeholders": [
        {"position": "front", "images": [
            {"id": "6a3d2f2c", "name": "logo.png", "type": "image/png", "height": 1254, "width": 1254,
             "x": 0.5, "y": 0.536, "scale": 0.588, "angle": 0, "layerType": "image"},
        ], "decoration_method": "dye-sublimation"},
        {"position": "back", "images": [
            {"id": "42782caa", "name": "Name", "type": "text/svg", "width": 714, "x": 0.5, "y": 0.357,
             "font_family": "Open Sans", "font_size": 200, "font_color": "#000000", "input_text": "Name", "layerType": "text"},
            {"id": "da70280b", "name": "Phone", "type": "text/svg", "width": 714, "x": 0.5, "y": 0.5,
             "font_family": "Open Sans", "font_size": 200, "font_color": "#000000", "input_text": "Phone", "layerType": "text"},
        ], "decoration_method": "dye-sublimation"},
    ],
    "background": "#ffffff", "canvas": False,
}]


def test_personalization_field_names_lists_every_text_layer_once_in_order():
    assert printify_client.personalization_field_names(REAL_PRINT_AREAS) == ["Name", "Phone"]


def test_personalization_field_names_empty_for_a_product_with_no_text_layers():
    assert printify_client.personalization_field_names([{"placeholders": [{"images": []}]}]) == []


def test_render_personalization_image_is_a_real_png_with_the_right_canvas_size():
    layers = REAL_PRINT_AREAS[0]["placeholders"][1]["images"]
    png = printify_client.render_personalization_image(layers, {"Name": "Rex", "Phone": "330-555-0101"})
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(png))
    assert im.size == (714, 714)  # the layers' own declared width


def test_render_personalization_image_falls_back_to_the_layers_own_placeholder_text():
    layers = REAL_PRINT_AREAS[0]["placeholders"][1]["images"]
    # No "Phone" key supplied — must still render SOMETHING rather than a blank tag.
    png = printify_client.render_personalization_image(layers, {"Name": "Rex"})
    assert len(png) > 0


def test_personalized_print_areas_replaces_only_the_text_bearing_placeholder():
    uploaded = AsyncMock(return_value={"id": "new-upload-id"})
    with patch.object(printify_client, "upload_image", uploaded):
        result = _run(printify_client._personalized_print_areas(REAL_PRINT_AREAS, {"Name": "Rex", "Phone": "330-555-0101"}))
    front = result[0]["placeholders"][0]
    back = result[0]["placeholders"][1]
    # The fixed front logo is untouched — same image id, never re-uploaded.
    assert front["images"] == REAL_PRINT_AREAS[0]["placeholders"][0]["images"]
    # The back placeholder's text layers are gone, replaced by one uploaded image.
    assert len(back["images"]) == 1
    assert back["images"][0]["id"] == "new-upload-id"
    assert all(img.get("layerType") != "text" for img in back["images"])
    uploaded.assert_called_once()


def test_create_personalized_product_posts_the_flattened_product_and_returns_it():
    uploaded = AsyncMock(return_value={"id": "new-upload-id"})
    created = _FakeResponse(200, json_body={"id": "pf-prod-new", "variants": [{"id": 70870}]})
    mock_post = AsyncMock(return_value=created)
    with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
         patch.object(printify_client, "PRINTIFY_API_KEY", "test-key"), \
         patch.object(printify_client, "PRINTIFY_SHOP_ID", "shop-1"), \
         patch.object(printify_client, "upload_image", uploaded), \
         patch("httpx.AsyncClient.post", mock_post):
        result = _run(printify_client.create_personalized_product(
            title="Pet Tag for Rex", blueprint_id=566, print_provider_id=70,
            variant_id=70870, variant_price_cents=1599,
            print_areas_template=REAL_PRINT_AREAS, personalization={"Name": "Rex", "Phone": "330-555-0101"},
        ))
    assert result == {"id": "pf-prod-new", "variants": [{"id": 70870}]}
    url, kwargs = mock_post.call_args.args, mock_post.call_args.kwargs
    assert url == ("/shops/shop-1/products.json",)
    body = kwargs["json"]
    assert body["blueprint_id"] == 566 and body["print_provider_id"] == 70
    assert body["variants"] == [{"id": 70870, "price": 1599, "is_enabled": True}]


def test_create_personalized_product_refuses_when_not_configured():
    with patch.object(printify_client, "PRINTIFY_ENABLED", False):
        with pytest.raises(printify_client.PrintifyNotConfigured):
            _run(printify_client.create_personalized_product(
                title="x", blueprint_id=1, print_provider_id=1, variant_id=1, variant_price_cents=100,
                print_areas_template=[], personalization={},
            ))


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
