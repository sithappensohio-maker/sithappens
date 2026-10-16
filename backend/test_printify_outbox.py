"""Printify POD — Phase 3: the outbox processor that actually submits a
queued (Phase 2) register sale to Printify, with retry/backoff on failure.

Uses the same disposable test DB as test_printify_products.py (via
_test_env + server.db), since Motor's cursor chaining is awkward to fake
convincingly — these are real reads/writes against a throwaway database,
never the shared dev one. The actual Printify HTTP call is always mocked;
this has never run against a live account (see client.py's docstring).

Disposable tag TEST_PRINTIFY_OUTBOX.
"""
import uuid
from unittest.mock import AsyncMock, patch

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pytest
import server
from fastapi import HTTPException
from starlette.requests import Request
from _test_loop import run

from domains.printify import client as printify_client

TAG = "TEST_PRINTIFY_OUTBOX"
ADMIN = {"id": f"{TAG}-admin", "name": f"{TAG} admin", "email": "printify-admin@test", "role": "admin"}
# read_only has neither take_payments nor pricing by default — see
# server.py's PERMISSIONS_BY_STAFF_ROLE.
NO_PERMS = {"id": f"{TAG}-ro", "name": f"{TAG} read-only", "email": "printify-ro@test", "role": "employee", "staff_role": "read_only"}

PICKUP_ENV = {
    "PRINTIFY_PICKUP_FIRST_NAME": "Sit Happens",
    "PRINTIFY_PICKUP_LAST_NAME": "LLC",
    "PRINTIFY_PICKUP_ADDRESS1": "100 Bark St",
    "PRINTIFY_PICKUP_CITY": "Columbus",
    "PRINTIFY_PICKUP_REGION": "OH",
    "PRINTIFY_PICKUP_ZIP": "43215",
}


def _row(**overrides):
    row = {
        "id": str(uuid.uuid4()), "source": "pos_sale", "source_id": f"{TAG}-sale-{uuid.uuid4().hex[:8]}",
        "external_id": "", "status": "pending",
        "fulfillment_method": "pickup", "shipping_address": None,
        "line_items": [{
            "product_id": "p1", "variant_id": "v1",
            "printify_product_id": "pf-prod-1", "printify_variant_id": "pf-var-1",
            "quantity": 1, "name": "Trail Dog Hoodie — Small",
        }],
        "printify_order_id": None, "attempts": 0, "last_error": None,
        "next_attempt_at": server.now_iso(), "created_at": server.now_iso(), "updated_at": server.now_iso(),
    }
    row["external_id"] = row["source_id"]
    row.update(overrides)
    return row


def _insert(row):
    run(server.db.printify_order_outbox.insert_one(row.copy()))
    return row


def _cleanup(ids):
    run(server.db.printify_order_outbox.delete_many({"id": {"$in": ids}}))


def _fetch(row_id):
    return run(server.db.printify_order_outbox.find_one({"id": row_id}, {"_id": 0}))


def test_a_no_op_when_printify_isnt_configured():
    with patch.object(printify_client, "PRINTIFY_ENABLED", False):
        result = run(printify_client.process_outbox(server.db))
    assert result["skipped"] == 1
    assert result["submitted"] == 0


def test_pickup_address_reads_from_env_and_requires_every_field():
    with patch.dict("os.environ", {}, clear=False):
        for key in printify_client.PRINTIFY_PICKUP_ADDRESS_ENV.values():
            import os
            os.environ.pop(key, None)
        assert printify_client.pickup_address() is None
    with patch.dict("os.environ", PICKUP_ENV):
        addr = printify_client.pickup_address()
    assert addr is not None
    assert addr.first_name == "Sit Happens"
    assert addr.city == "Columbus"
    assert addr.country == "US"


def test_pickup_row_holds_when_no_pickup_address_is_configured():
    row = _insert(_row())
    try:
        import os
        cleared = {k: os.environ.pop(k, None) for k in printify_client.PRINTIFY_PICKUP_ADDRESS_ENV.values()}
        try:
            with patch.object(printify_client, "PRINTIFY_ENABLED", True):
                result = run(printify_client.process_outbox(server.db))
        finally:
            for k, v in cleared.items():
                if v is not None:
                    os.environ[k] = v
        assert result["held"] == 1
        fresh = _fetch(row["id"])
        assert fresh["status"] == "pending"
        assert fresh["attempts"] == 1
        assert "Pickup address" in fresh["last_error"]
    finally:
        _cleanup([row["id"]])


def test_pickup_row_submits_once_an_address_is_configured():
    row = _insert(_row())
    try:
        mock_create = AsyncMock(return_value={"id": "pf-order-123"})
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.dict("os.environ", PICKUP_ENV), \
             patch.object(printify_client, "create_order", mock_create):
            result = run(printify_client.process_outbox(server.db))
        assert result["submitted"] == 1
        fresh = _fetch(row["id"])
        assert fresh["status"] == "submitted"
        assert fresh["printify_order_id"] == "pf-order-123"
        # send_shipping_notification must be False for a pickup order — the
        # recipient on the label is the business, not the customer.
        _, kwargs = mock_create.call_args
        assert kwargs["send_shipping_notification"] is False
        assert kwargs["external_id"] == row["source_id"]
    finally:
        _cleanup([row["id"]])


def test_ship_row_submits_with_the_customers_address_and_notification_on():
    address = {
        "first_name": "Jordan", "last_name": "Rivers", "email": "jordan@example.com", "phone": "555-0100",
        "address1": "1 Main St", "address2": "", "city": "Columbus", "region": "OH", "zip": "43215", "country": "US",
    }
    row = _insert(_row(fulfillment_method="ship", shipping_address=address))
    try:
        mock_create = AsyncMock(return_value={"id": "pf-order-456"})
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.object(printify_client, "create_order", mock_create):
            result = run(printify_client.process_outbox(server.db))
        assert result["submitted"] == 1
        fresh = _fetch(row["id"])
        assert fresh["status"] == "submitted"
        assert fresh["printify_order_id"] == "pf-order-456"
        _, kwargs = mock_create.call_args
        assert kwargs["send_shipping_notification"] is True
        assert kwargs["address_to"].email == "jordan@example.com"
    finally:
        _cleanup([row["id"]])


PET_TAG_PRINT_AREAS = [{"placeholders": [{"images": [
    {"name": "Name", "layerType": "text", "width": 714, "x": 0.5, "y": 0.35, "font_size": 200, "input_text": "Name"},
]}]}]


def _personalized_row(**overrides):
    row = _row(**overrides)
    row["line_items"] = [{
        "product_id": "p1", "variant_id": "v1",
        "printify_product_id": "pf-prod-1", "printify_variant_id": "pf-var-1",
        "quantity": 1, "name": "Pet Tag — 1\"",
        "personalization": {"Name": "Rex"},
        "printify_blueprint_id": 566, "printify_print_provider_id": 70,
        "printify_print_areas": PET_TAG_PRINT_AREAS, "unit_price_cents": 1599,
    }]
    return row


def test_a_personalized_row_builds_a_one_off_product_before_ordering():
    row = _insert(_personalized_row())
    try:
        created_product = {"id": "pf-prod-new", "variants": [{"id": "pf-var-new"}]}
        mock_create_personalized = AsyncMock(return_value=created_product)
        mock_create_order = AsyncMock(return_value={"id": "pf-order-789"})
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.dict("os.environ", PICKUP_ENV), \
             patch.object(printify_client, "create_personalized_product", mock_create_personalized), \
             patch.object(printify_client, "create_order", mock_create_order):
            result = run(printify_client.process_outbox(server.db))
        assert result["submitted"] == 1
        # The ORIGINAL template ids were never submitted — the freshly
        # created one-off product's own ids were, in their place.
        _, create_kwargs = mock_create_personalized.call_args
        assert create_kwargs["blueprint_id"] == 566
        assert create_kwargs["print_provider_id"] == 70
        assert create_kwargs["variant_id"] == "pf-var-1"
        assert create_kwargs["variant_price_cents"] == 1599
        assert create_kwargs["personalization"] == {"Name": "Rex"}
        order_line_items = mock_create_order.call_args.kwargs["line_items"]
        assert order_line_items[0].product_id == "pf-prod-new"
        assert order_line_items[0].variant_id == "pf-var-new"
        assert _fetch(row["id"])["status"] == "submitted"
    finally:
        _cleanup([row["id"]])


def test_a_personalized_row_holds_when_building_the_one_off_product_fails():
    row = _insert(_personalized_row())
    try:
        mock_create_personalized = AsyncMock(side_effect=printify_client.PrintifyApiError(400, "Provided images do not exist"))
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.dict("os.environ", PICKUP_ENV), \
             patch.object(printify_client, "create_personalized_product", mock_create_personalized):
            result = run(printify_client.process_outbox(server.db))
        assert result["held"] == 1
        fresh = _fetch(row["id"])
        assert fresh["status"] == "pending"
        assert "do not exist" in fresh["last_error"]
    finally:
        _cleanup([row["id"]])


def test_a_non_personalized_row_never_calls_create_personalized_product():
    row = _insert(_row())  # the plain fixture — no personalization key at all
    try:
        mock_create_personalized = AsyncMock()
        mock_create_order = AsyncMock(return_value={"id": "pf-order-1"})
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.dict("os.environ", PICKUP_ENV), \
             patch.object(printify_client, "create_personalized_product", mock_create_personalized), \
             patch.object(printify_client, "create_order", mock_create_order):
            run(printify_client.process_outbox(server.db))
        mock_create_personalized.assert_not_called()
    finally:
        _cleanup([row["id"]])


def test_a_missing_printify_variant_mapping_holds_without_calling_the_api():
    row = _insert(_row(line_items=[{
        "product_id": "p1", "variant_id": "v1",
        "printify_product_id": "pf-prod-1", "printify_variant_id": None,
        "quantity": 1, "name": "Mismapped Item",
    }]))
    try:
        mock_create = AsyncMock(return_value={"id": "should-not-be-called"})
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.dict("os.environ", PICKUP_ENV), \
             patch.object(printify_client, "create_order", mock_create):
            result = run(printify_client.process_outbox(server.db))
        assert result["held"] == 1
        mock_create.assert_not_called()
        fresh = _fetch(row["id"])
        assert "Mismapped Item" in fresh["last_error"]
    finally:
        _cleanup([row["id"]])


def test_an_api_failure_backs_off_and_eventually_marks_the_row_stuck():
    row = _insert(_row(attempts=printify_client.OUTBOX_MAX_ATTEMPTS - 1))
    try:
        mock_create = AsyncMock(side_effect=printify_client.PrintifyApiError(422, "variant not found"))
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.dict("os.environ", PICKUP_ENV), \
             patch.object(printify_client, "create_order", mock_create):
            result = run(printify_client.process_outbox(server.db))
        assert result["held"] == 1
        fresh = _fetch(row["id"])
        assert fresh["status"] == "stuck"
        assert fresh["attempts"] == printify_client.OUTBOX_MAX_ATTEMPTS
        assert "variant not found" in fresh["last_error"]
    finally:
        _cleanup([row["id"]])


def test_a_row_not_yet_due_is_left_alone():
    future = "2099-01-01T00:00:00+00:00"
    row = _insert(_row(next_attempt_at=future))
    try:
        mock_create = AsyncMock(return_value={"id": "should-not-run"})
        with patch.object(printify_client, "PRINTIFY_ENABLED", True), \
             patch.dict("os.environ", PICKUP_ENV), \
             patch.object(printify_client, "create_order", mock_create):
            result = run(printify_client.process_outbox(server.db))
        assert result["checked"] == 0
        mock_create.assert_not_called()
        assert _fetch(row["id"])["status"] == "pending"
    finally:
        _cleanup([row["id"]])


# ── Admin screen: list + retry (Shop Manager → Printify Orders) ────────────

def test_admin_list_returns_rows_newest_first_and_can_filter_by_status():
    pending = _insert(_row())
    stuck = _insert(_row(status="stuck"))
    try:
        result = run(server.list_printify_outbox(status=None, user=ADMIN))
        ids = [r["id"] for r in result["rows"]]
        assert pending["id"] in ids and stuck["id"] in ids
        only_stuck = run(server.list_printify_outbox(status="stuck", user=ADMIN))
        assert [r["id"] for r in only_stuck["rows"]] == [stuck["id"]]
    finally:
        _cleanup([pending["id"], stuck["id"]])


def test_admin_list_refuses_a_user_without_take_payments():
    with pytest.raises(HTTPException) as exc_info:
        run(server.list_printify_outbox(status=None, user=NO_PERMS))
    assert exc_info.value.status_code == 403


def test_admin_retry_resets_a_stuck_row_to_pending():
    row = _insert(_row(status="stuck", attempts=8, last_error="Printify API error 422: variant not found"))
    try:
        run(server.retry_printify_outbox_row(row["id"], user=ADMIN))
        fresh = _fetch(row["id"])
        assert fresh["status"] == "pending"
        assert fresh["attempts"] == 0
        assert fresh["last_error"] is None
        assert fresh["next_attempt_at"] <= server.now_iso()
    finally:
        _cleanup([row["id"]])


def test_admin_retry_refuses_an_already_submitted_row():
    row = _insert(_row(status="submitted", printify_order_id="pf-order-9"))
    try:
        with pytest.raises(HTTPException) as exc_info:
            run(server.retry_printify_outbox_row(row["id"], user=ADMIN))
        assert exc_info.value.status_code == 400
        assert _fetch(row["id"])["status"] == "submitted"
    finally:
        _cleanup([row["id"]])


def test_admin_retry_404s_on_an_unknown_row():
    with pytest.raises(HTTPException) as exc_info:
        run(server.retry_printify_outbox_row("no-such-row", user=ADMIN))
    assert exc_info.value.status_code == 404


def test_admin_retry_refuses_a_user_without_take_payments():
    row = _insert(_row(status="stuck"))
    try:
        with pytest.raises(HTTPException) as exc_info:
            run(server.retry_printify_outbox_row(row["id"], user=NO_PERMS))
        assert exc_info.value.status_code == 403
    finally:
        _cleanup([row["id"]])


def test_register_webhooks_refuses_without_app_public_url():
    with patch.dict("os.environ", {"APP_PUBLIC_URL": ""}):
        with pytest.raises(HTTPException) as exc_info:
            run(server.register_printify_webhooks(user=ADMIN))
        assert exc_info.value.status_code == 400


def test_register_webhooks_refuses_a_user_without_pricing_permission():
    with pytest.raises(HTTPException) as exc_info:
        run(server.register_printify_webhooks(user=NO_PERMS))
    assert exc_info.value.status_code == 403


# ── Admin screen: "Fetch from Printify" variant picker ──────────────────────

_RAW_PRODUCT = {
    "id": "pf-prod-1", "title": "Trail Dog Hoodie", "blueprint_id": 6, "print_provider_id": 99,
    "images": [{"src": "https://example.com/hoodie-back.jpg"}, {"src": "https://example.com/hoodie-front.jpg", "is_default": True}],
    "variants": [
        {"id": 111, "title": "Black / S", "price": 1999, "is_enabled": True, "is_available": True},
        {"id": 112, "title": "Black / M", "price": 1999, "is_enabled": True, "is_available": True},
        {"id": 113, "title": "Black / XL", "price": 2194, "is_enabled": True, "is_available": False},
        # Most of a real Printify product's variants are disabled — every
        # size/color combination its blueprint supports, not just the ones
        # this listing actually offers. These must never reach the admin.
        {"id": 999, "title": "Tropical Blue / M", "price": 1613, "is_enabled": False, "is_available": True},
    ],
}


def test_fetch_printify_product_returns_only_enabled_variants_in_dollars():
    with patch.object(printify_client, "get_product", AsyncMock(return_value=_RAW_PRODUCT)):
        result = run(server.get_printify_product_variants("pf-prod-1", user=ADMIN))
    assert result["title"] == "Trail Dog Hoodie"
    assert result["image"] == "https://example.com/hoodie-front.jpg"  # is_default wins over list order
    ids = [v["id"] for v in result["variants"]]
    assert ids == ["111", "112", "113"]
    assert "999" not in ids  # disabled — not a real option for this listing
    black_s = next(v for v in result["variants"] if v["id"] == "111")
    assert black_s["price"] == 19.99  # cents -> dollars
    black_xl = next(v for v in result["variants"] if v["id"] == "113")
    assert black_xl["price"] == 21.94
    assert black_xl["is_available"] is False
    assert result["blueprint_id"] == 6
    assert result["print_provider_id"] == 99


def test_fetch_printify_product_refuses_a_user_without_pricing_permission():
    with pytest.raises(HTTPException) as exc_info:
        run(server.get_printify_product_variants("pf-prod-1", user=NO_PERMS))
    assert exc_info.value.status_code == 403


def test_fetch_printify_product_404s_when_printify_doesnt_recognize_the_id():
    not_found = printify_client.PrintifyApiError(404, "not found")
    with patch.object(printify_client, "get_product", AsyncMock(side_effect=not_found)):
        with pytest.raises(HTTPException) as exc_info:
            run(server.get_printify_product_variants("missing", user=ADMIN))
    assert exc_info.value.status_code == 404


def test_fetch_printify_product_400s_when_not_configured():
    not_configured = printify_client.PrintifyNotConfigured("PRINTIFY_API_KEY/PRINTIFY_SHOP_ID are not set.")
    with patch.object(printify_client, "get_product", AsyncMock(side_effect=not_configured)):
        with pytest.raises(HTTPException) as exc_info:
            run(server.get_printify_product_variants("pf-prod-1", user=ADMIN))
    assert exc_info.value.status_code == 400


# ── Webhook event application (domains/printify/client.apply_webhook_event) ─

def _event(topic, printify_order_id, **data):
    return {"id": f"evt-{uuid.uuid4().hex[:8]}", "type": topic, "created_at": server.now_iso(),
            "resource": {"id": printify_order_id, "type": "order", "data": data}}


def test_apply_webhook_event_ignores_an_order_id_it_doesnt_recognize():
    result = run(printify_client.apply_webhook_event(server.db, _event("order:updated", "unknown-order", status="on-hold")))
    assert result is None


def test_apply_webhook_event_ignores_an_unrecognized_topic():
    row = _insert(_row(status="submitted", printify_order_id="pf-order-1"))
    try:
        result = run(printify_client.apply_webhook_event(server.db, _event("some:other:topic", "pf-order-1")))
        assert result is None
        assert "printify_status" not in _fetch(row["id"])
    finally:
        _cleanup([row["id"]])


def test_apply_webhook_event_records_status_updates_without_touching_retry_state():
    row = _insert(_row(status="submitted", printify_order_id="pf-order-2", attempts=0))
    try:
        updated_id = run(printify_client.apply_webhook_event(server.db, _event("order:updated", "pf-order-2", status="in-production")))
        assert updated_id == row["id"]
        fresh = _fetch(row["id"])
        assert fresh["printify_status"] == "in-production"
        # Never touches process_outbox's own state machine.
        assert fresh["status"] == "submitted"
        assert fresh["attempts"] == 0
    finally:
        _cleanup([row["id"]])


def test_apply_webhook_event_records_shipment_tracking():
    row = _insert(_row(status="submitted", printify_order_id="pf-order-3"))
    try:
        carrier = {"code": "usps", "number": "9400111", "url": "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111"}
        run(printify_client.apply_webhook_event(
            server.db, _event("order:shipment:created", "pf-order-3", shipped_at="2026-10-16T12:00:00Z", carrier=carrier),
        ))
        fresh = _fetch(row["id"])
        assert fresh["printify_status"] == "shipped"
        assert fresh["shipped_at"] == "2026-10-16T12:00:00Z"
        assert fresh["tracking"] == carrier
    finally:
        _cleanup([row["id"]])


def test_apply_webhook_event_records_delivery():
    row = _insert(_row(status="submitted", printify_order_id="pf-order-4"))
    try:
        run(printify_client.apply_webhook_event(
            server.db, _event("order:shipment:delivered", "pf-order-4", delivered_at="2026-10-18T09:00:00Z"),
        ))
        fresh = _fetch(row["id"])
        assert fresh["printify_status"] == "delivered"
        assert fresh["delivered_at"] == "2026-10-18T09:00:00Z"
    finally:
        _cleanup([row["id"]])


# ── Webhook route: signature verification, parsing, dedup ──────────────────

def _webhook_request(body: bytes, signature=None):
    headers = [(b"content-type", b"application/json")]
    if signature is not None:
        headers.append((b"x-pfy-signature", signature.encode()))
    scope = {
        "type": "http", "method": "POST", "path": "/api/webhooks/printify",
        "headers": headers, "client": ("127.0.0.1", 12345), "scheme": "http",
        "server": ("test", 80), "query_string": b"",
    }
    sent = {"done": False}

    async def receive():
        if sent["done"]:
            return {"type": "http.disconnect"}
        sent["done"] = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive=receive)


def test_webhook_route_401s_on_a_bad_signature():
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
        req = _webhook_request(b'{"id":"evt-1","type":"order:updated","resource":{"id":"x","data":{}}}', signature="sha256=wrong")
        with pytest.raises(HTTPException) as exc_info:
            run(server.printify_webhook(req))
        assert exc_info.value.status_code == 401


def test_webhook_route_applies_a_correctly_signed_event_end_to_end():
    row = _insert(_row(status="submitted", printify_order_id="pf-order-5"))
    body = f'{{"id":"evt-{uuid.uuid4().hex[:8]}","type":"order:updated","resource":{{"id":"pf-order-5","type":"order","data":{{"status":"in-production"}}}}}}'.encode()
    try:
        with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
            sig = _sign_body("shh", body)
            req = _webhook_request(body, signature=sig)
            result = run(server.printify_webhook(req))
        assert result == {"ok": True}
        assert _fetch(row["id"])["printify_status"] == "in-production"
    finally:
        _cleanup([row["id"]])


def test_webhook_route_malformed_body_400s_even_with_a_valid_signature():
    body = b"not json"
    with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
        sig = _sign_body("shh", body)
        req = _webhook_request(body, signature=sig)
        with pytest.raises(HTTPException) as exc_info:
            run(server.printify_webhook(req))
        assert exc_info.value.status_code == 400


def test_webhook_route_dedups_a_replayed_event_id():
    row = _insert(_row(status="submitted", printify_order_id="pf-order-6"))
    event_id = f"evt-{uuid.uuid4().hex[:8]}"
    body = f'{{"id":"{event_id}","type":"order:updated","resource":{{"id":"pf-order-6","type":"order","data":{{"status":"in-production"}}}}}}'.encode()
    try:
        with patch.object(printify_client, "PRINTIFY_WEBHOOK_SECRET", "shh"):
            sig = _sign_body("shh", body)
            first = run(server.printify_webhook(_webhook_request(body, signature=sig)))
            second = run(server.printify_webhook(_webhook_request(body, signature=sig)))
        assert first == {"ok": True}
        assert second == {"ok": True, "duplicate": True}
    finally:
        _cleanup([row["id"]])
        run(server.db.printify_webhook_events.delete_one({"id": event_id}))


def _sign_body(secret: str, body: bytes) -> str:
    import hashlib
    import hmac
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
