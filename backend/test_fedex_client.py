"""FedEx API client — pure unit tests, no network and no live account.

Covers the plain-env-var "optional integration" convention (unset keys
refuse with a catchable error, never a crash), the OAuth token request/
cache, and the rate-quote request shape. The actual HTTP calls are
mocked; this has never been run against a live FedEx account — see
client.py's (fedex.py's) docstring.
"""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from domains.shop import fedex


class _FakeResponse:
    def __init__(self, status_code, json_body=None, text=""):
        self.status_code = status_code
        self._json_body = json_body or {}
        self.text = text or str(json_body)

    def json(self):
        return self._json_body


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


SHIP_FROM = {
    "FEDEX_SHIP_FROM_STREET": "123 Kennel Rd", "FEDEX_SHIP_FROM_CITY": "Columbus",
    "FEDEX_SHIP_FROM_STATE": "OH", "FEDEX_SHIP_FROM_ZIP": "43215",
}


def test_ship_from_is_none_until_every_field_is_set(monkeypatch):
    for k in fedex.FEDEX_SHIP_FROM_ENV.values():
        monkeypatch.delenv(k, raising=False)
    assert fedex.ship_from() is None
    monkeypatch.setenv("FEDEX_SHIP_FROM_STREET", "123 Kennel Rd")
    assert fedex.ship_from() is None  # still missing city/state/zip
    for k, v in SHIP_FROM.items():
        monkeypatch.setenv(k, v)
    assert fedex.ship_from() == {"street": "123 Kennel Rd", "city": "Columbus", "state": "OH", "zip": "43215"}


def test_quote_refuses_when_not_configured():
    with patch.object(fedex, "FEDEX_ENABLED", False):
        with pytest.raises(fedex.FedexNotConfigured):
            _run(fedex.quote_ground_rate(
                ship_to=fedex.ShipToAddress(street="1 Main St", city="Dayton", state="OH", zip="45402"),
                weight_lbs=3.0,
            ))


def test_token_is_requested_once_and_then_cached():
    token_resp = _FakeResponse(200, json_body={"access_token": "tok-123", "expires_in": 3600})
    rate_resp = _FakeResponse(200, json_body={
        "output": {"rateReplyDetails": [{"ratedShipmentDetails": [{"totalNetCharge": 12.34}]}]}})
    mock_post = AsyncMock(side_effect=[token_resp, rate_resp, rate_resp])
    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "FEDEX_CLIENT_ID", "cid"), \
         patch.object(fedex, "FEDEX_CLIENT_SECRET", "secret"), \
         patch.object(fedex, "FEDEX_ACCOUNT_NUMBER", "acct-1"), \
         patch.object(fedex, "ship_from", lambda: {"street": "123 Kennel Rd", "city": "Columbus", "state": "OH", "zip": "43215"}), \
         patch.object(fedex, "_token_cache", {"value": None, "expires_at": 0.0}), \
         patch("httpx.AsyncClient.post", mock_post):
        first = _run(fedex.quote_ground_rate(
            ship_to=fedex.ShipToAddress(street="1 Main St", city="Dayton", state="OH", zip="45402"),
            weight_lbs=3.0,
        ))
        second = _run(fedex.quote_ground_rate(
            ship_to=fedex.ShipToAddress(street="1 Main St", city="Dayton", state="OH", zip="45402"),
            weight_lbs=5.0,
        ))
    assert first == 12.34 and second == 12.34
    assert mock_post.call_count == 3  # one token request, two rate requests — the token was reused


def test_rate_quote_posts_the_documented_shape_and_parses_the_charge():
    token_resp = _FakeResponse(200, json_body={"access_token": "tok-123", "expires_in": 3600})
    rate_resp = _FakeResponse(200, json_body={
        "output": {"rateReplyDetails": [{"ratedShipmentDetails": [{"totalNetCharge": 9.87}]}]}})
    mock_post = AsyncMock(side_effect=[token_resp, rate_resp])
    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "FEDEX_CLIENT_ID", "cid"), \
         patch.object(fedex, "FEDEX_CLIENT_SECRET", "secret"), \
         patch.object(fedex, "FEDEX_ACCOUNT_NUMBER", "acct-1"), \
         patch.object(fedex, "ship_from", lambda: {"street": "123 Kennel Rd", "city": "Columbus", "state": "OH", "zip": "43215"}), \
         patch.object(fedex, "_token_cache", {"value": None, "expires_at": 0.0}), \
         patch("httpx.AsyncClient.post", mock_post):
        amount = _run(fedex.quote_ground_rate(
            ship_to=fedex.ShipToAddress(street="1 Main St", city="Dayton", state="OH", zip="45402"),
            weight_lbs=4.5,
        ))
    assert amount == 9.87
    rate_call = mock_post.call_args_list[1]
    assert rate_call.args == ("/rate/v1/rates/quotes",)
    body = rate_call.kwargs["json"]
    assert body["accountNumber"] == {"value": "acct-1"}
    shipment = body["requestedShipment"]
    assert shipment["shipper"]["address"]["city"] == "Columbus"
    assert shipment["recipient"]["address"]["city"] == "Dayton"
    assert shipment["requestedPackageLineItems"] == [{"weight": {"units": "LB", "value": 4.5}}]
    assert rate_call.kwargs["headers"]["Authorization"] == "Bearer tok-123"


def test_a_non_2xx_rate_response_raises_fedex_api_error():
    token_resp = _FakeResponse(200, json_body={"access_token": "tok-123", "expires_in": 3600})
    bad_resp = _FakeResponse(422, text="invalid postal code")
    mock_post = AsyncMock(side_effect=[token_resp, bad_resp])
    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "FEDEX_CLIENT_ID", "cid"), \
         patch.object(fedex, "FEDEX_CLIENT_SECRET", "secret"), \
         patch.object(fedex, "FEDEX_ACCOUNT_NUMBER", "acct-1"), \
         patch.object(fedex, "ship_from", lambda: {"street": "123 Kennel Rd", "city": "Columbus", "state": "OH", "zip": "43215"}), \
         patch.object(fedex, "_token_cache", {"value": None, "expires_at": 0.0}), \
         patch("httpx.AsyncClient.post", mock_post):
        with pytest.raises(fedex.FedexApiError):
            _run(fedex.quote_ground_rate(
                ship_to=fedex.ShipToAddress(street="1 Main St", city="Dayton", state="OH", zip="45402"),
                weight_lbs=4.5,
            ))


def test_a_rate_response_with_no_usable_charge_raises_fedex_api_error():
    token_resp = _FakeResponse(200, json_body={"access_token": "tok-123", "expires_in": 3600})
    empty_resp = _FakeResponse(200, json_body={"output": {"rateReplyDetails": []}})
    mock_post = AsyncMock(side_effect=[token_resp, empty_resp])
    with patch.object(fedex, "FEDEX_ENABLED", True), \
         patch.object(fedex, "FEDEX_CLIENT_ID", "cid"), \
         patch.object(fedex, "FEDEX_CLIENT_SECRET", "secret"), \
         patch.object(fedex, "FEDEX_ACCOUNT_NUMBER", "acct-1"), \
         patch.object(fedex, "ship_from", lambda: {"street": "123 Kennel Rd", "city": "Columbus", "state": "OH", "zip": "43215"}), \
         patch.object(fedex, "_token_cache", {"value": None, "expires_at": 0.0}), \
         patch("httpx.AsyncClient.post", mock_post):
        with pytest.raises(fedex.FedexApiError):
            _run(fedex.quote_ground_rate(
                ship_to=fedex.ShipToAddress(street="1 Main St", city="Dayton", state="OH", zip="45402"),
                weight_lbs=4.5,
            ))
