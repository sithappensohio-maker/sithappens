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
import server
from _test_loop import run

from domains.printify import client as printify_client

TAG = "TEST_PRINTIFY_OUTBOX"

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
