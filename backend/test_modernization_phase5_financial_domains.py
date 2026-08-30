"""Source/behavior guards for modernization Phase 5.

These tests intentionally avoid importing the full server module, so the
financial architecture can be checked in lightweight CI without Mongo/Motor or
Stripe installed.  Domain service tests use tiny in-memory async collection
fakes and exercise the pricing precedence that caused the historical Quick
Check-In bug.
"""
from __future__ import annotations

import ast
import asyncio
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from domains.pricing import services as pricing
from domains.pos import services as pos

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server.py"
ARCH = ROOT / "architecture"


class _Cursor:
    def __init__(self, rows):
        self.rows = [dict(r) for r in rows]

    async def to_list(self, _limit):
        return [dict(r) for r in self.rows]


class _Collection:
    def __init__(self, rows=()):
        self.rows = [dict(r) for r in rows]

    def _match(self, row, query):
        for key, want in (query or {}).items():
            got = row.get(key)
            if isinstance(want, dict):
                if "$in" in want and got not in want["$in"]:
                    return False
                if "$ne" in want and got == want["$ne"]:
                    return False
                continue
            if got != want:
                return False
        return True

    async def find_one(self, query, _projection=None, **_kwargs):
        for row in self.rows:
            if self._match(row, query):
                return dict(row)
        return None

    def find(self, query, _projection=None):
        return _Cursor([r for r in self.rows if self._match(r, query)])


class _DB(SimpleNamespace):
    pass


def _run(coro):
    return asyncio.run(coro)


def _literal_server_api_paths():
    tree = ast.parse(SERVER.read_text())
    out = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not (
                isinstance(dec, ast.Call)
                and isinstance(dec.func, ast.Attribute)
                and isinstance(dec.func.value, ast.Name)
                and dec.func.value.id == "api"
                and dec.args
                and isinstance(dec.args[0], ast.Constant)
                and isinstance(dec.args[0].value, str)
            ):
                continue
            out.add((dec.func.attr.upper(), dec.args[0].value, node.name))
    return out


def test_financial_http_routes_are_owned_by_domains_not_server():
    manifest = json.loads((ARCH / "phase5_financial_route_manifest.json").read_text())
    server_routes = _literal_server_api_paths()
    extracted = {(r["method"], r["path"], r["function"]) for r in manifest}
    assert len(extracted) == 91
    assert not (server_routes & extracted)
    assert {r["domain"] for r in manifest} == {"bookings", "pricing", "pos", "register"}

    for domain in ("bookings", "pricing", "pos", "register"):
        text = (ROOT / "domains" / domain / "routes.py").read_text()
        assert f"register_{domain}_routes" in text
        for row in [r for r in manifest if r["domain"] == domain]:
            assert repr(row["path"]) in text
            assert repr(row["function"]) in text


def test_server_financial_helpers_are_facades_and_file_keeps_shrinking():
    text = SERVER.read_text()
    assert len(text.splitlines()) <= 56300
    assert "return await pricing_domain_services.resolve_client_price(" in text
    assert "return await pricing_domain_services.resolve_addon_snapshots(" in text
    assert "return await pricing_domain_services.quote_base_service_price(" in text
    assert "return await pos_domain_services.build_register_catalog(client_id)" in text
    assert "return await pos_domain_services.price_pos_cart(" in text
    assert "return await bookings_domain_services.resolve_base_service_for_booking(body, user)" in text
    assert "await register_domain_services.require_register_day_open(date_value)" in text
    assert "return register_domain_services.effective_register_opening(" in text
    assert "return await bookings_domain_services.create_booking(body, user)" in text
    assert "return await bookings_domain_services.check_out(booking_id, body, user)" in text
    assert "return await pos_domain_services.create_sale(body, user)" in text
    assert "async def _create_booking_impl(" in text
    assert "async def _check_out_endpoint_impl(" in text
    assert "async def _create_pos_sale_impl(" in text


def test_active_client_override_beats_retained_revoked_history():
    db = _DB(
        price_overrides=_Collection([
            {
                "id": "old", "client_id": "c1", "target_kind": "service", "target_code": "daycare",
                "override_price": 20, "status": "revoked", "created_at": "2026-01-01T00:00:00Z",
            },
            {
                "id": "new", "client_id": "c1", "target_kind": "service", "target_code": "daycare",
                "override_price": 25, "status": "active", "updated_at": "2026-08-01T00:00:00Z",
            },
        ]),
        clients=_Collection([{"id": "c1"}]),
        pricing_tiers=_Collection(),
        pricing_tier_prices=_Collection(),
        services=_Collection(),
    )
    pricing.configure(
        db=db,
        business_today=lambda: date(2026, 8, 27),
        billable_boarding_units=lambda *_a, **_k: 1,
        now_iso=lambda: "2026-08-27T00:00:00Z",
        default_boarding_cutoff="17:00",
    )
    result = _run(pricing.resolve_client_price("c1", "service", "daycare", 30.0))
    assert result["effective_price"] == 25.0
    assert result["override_id"] == "new"
    assert result["pricing_source"] == "client_override"


def test_pricing_tier_is_fallback_not_competitor_to_individual_override():
    db = _DB(
        price_overrides=_Collection(),
        clients=_Collection([{"id": "c1", "pricing_tier_id": "vip"}]),
        pricing_tiers=_Collection([{"id": "vip", "active": True, "name": "VIP"}]),
        pricing_tier_prices=_Collection([
            {"tier_id": "vip", "target_kind": "service", "target_code": "daycare", "override_price": 27},
        ]),
        services=_Collection(),
    )
    pricing.configure(
        db=db,
        business_today=lambda: date(2026, 8, 27),
        billable_boarding_units=lambda *_a, **_k: 1,
        now_iso=lambda: "2026-08-27T00:00:00Z",
        default_boarding_cutoff="17:00",
    )
    result = _run(pricing.resolve_client_price("c1", "service", "daycare", 30.0))
    assert result["effective_price"] == 27.0
    assert result["pricing_source"] == "tier"
    assert result["tier_name"] == "VIP"


def test_pos_preview_kernel_uses_same_client_pricing_resolver_and_tax_rules():
    db = _DB(
        pos_products=_Collection([
            {"id": "treat", "name": "Treat", "price": 10, "active": True, "taxable": True,
             "track_inventory": True, "stock_on_hand": 20},
        ]),
        credit_packs=_Collection([
            {"id": "pack", "name": "5 Day Pack", "price": 100, "active": True, "taxable": True},
        ]),
        programs=_Collection(),
    )

    async def resolver(client_id, kind, code, list_price):
        assert client_id == "c1"
        if kind == "pos_product" and code == "treat":
            return {"effective_price": 8.0, "override_id": "retail-ovr", "pricing_source": "client_override"}
        if kind == "credit_pack" and code == "pack":
            return {"effective_price": 90.0, "override_id": "pack-ovr", "pricing_source": "client_override"}
        return {"effective_price": list_price, "override_id": None, "pricing_source": "standard"}

    async def settings():
        return {"sales_tax": {"enabled": True, "rate_pct": 10, "applies_to": {"retail": True}}}

    pos.configure(
        db=db,
        resolve_client_price=resolver,
        get_settings=settings,
        credit_pack_display_fields=lambda *_a, **_k: {},
        free_claim_program_blockers=lambda _p: None,
        logger=SimpleNamespace(warning=lambda *_a, **_k: None),
        create_sale_impl=lambda *_a, **_k: None,
    )
    lines = [
        SimpleNamespace(kind="retail", product_id="treat", pack_id=None, program_id=None, qty=2,
                        description=None, custom_amount=None, custom_reason=None, custom_kind=None),
        SimpleNamespace(kind="credit_pack", product_id=None, pack_id="pack", program_id=None, qty=1,
                        description=None, custom_amount=None, custom_reason=None, custom_kind=None),
    ]
    priced, _ = _run(pos.price_pos_cart(lines, None, can_price=False, client_id="c1"))
    assert priced["subtotal"] == 106.0
    # Only the retail line is taxed; credit packs remain service-tax-exempt even
    # when a stale catalog row says taxable=True.
    assert priced["tax_amount"] == 1.6
    assert priced["total"] == 107.6
    assert priced["line_items"][0]["unit_price"] == 8.0
    assert priced["line_items"][1]["unit_price"] == 90.0
    assert priced["line_items"][1]["taxable"] is False


def test_financial_route_registries_build_real_fastapi_routes():
    from fastapi import APIRouter
    from pydantic import BaseModel
    from domains.bookings.routes import register_bookings_routes, ROUTES as BOOKING_ROUTES
    from domains.pricing.routes import register_pricing_routes, ROUTES as PRICING_ROUTES
    from domains.pos.routes import register_pos_routes, ROUTES as POS_ROUTES
    from domains.register.routes import register_register_routes, ROUTES as REGISTER_ROUTES

    class BookingOut(BaseModel):
        id: str = ""

    async def endpoint():
        return {}

    all_rows = BOOKING_ROUTES + PRICING_ROUTES + POS_ROUTES + REGISTER_ROUTES
    globals_map = {row[2]: endpoint for row in all_rows}
    globals_map["BookingOut"] = BookingOut
    api = APIRouter(prefix="/api")
    register_bookings_routes(api=api, server_globals=globals_map)
    register_pricing_routes(api=api, server_globals=globals_map)
    register_register_routes(api=api, server_globals=globals_map)
    register_pos_routes(api=api, server_globals=globals_map)

    actual = {(next(iter(route.methods)), route.path) for route in api.routes}
    expected = {(method, "/api" + path) for method, path, *_ in all_rows}
    assert actual == expected
    # 94 = 91 phase-5 routes + /policies/stay (client-facing stay policy),
    # /admin/register/no-sale, and /register/pin (PIN-verified drawer opens).
    assert len(actual) == 94
