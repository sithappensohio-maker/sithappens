"""HTTP route ownership for the Register domain.

Phase 5 moves route registration out of server.py while intentionally keeping
the proven endpoint callables during the financial-risk extraction. Business
logic is migrated behind domain services separately, without changing paths.
"""
from __future__ import annotations


ROUTES = [
    ('GET', '/admin/register/range', 'admin_register_range', None),
    ('GET', '/admin/register/closeouts', 'admin_register_closeouts', None),
    ('GET', '/admin/register/export.csv', 'admin_register_export_csv', None),
    ('GET', '/admin/register/tax-packet.zip', 'admin_register_tax_packet_zip', None),
    ('GET', '/admin/register/day', 'admin_register_day', None),
    ('POST', '/admin/register/open-drawer', 'admin_open_cash_drawer', None),
    ('POST', '/admin/register/reopen-day', 'admin_reopen_register_day', None),
    ('POST', '/admin/register/till-adjustment', 'admin_register_till_adjustment', None),
    ('DELETE', '/admin/register/till-adjustment/{adjustment_id}', 'delete_till_adjustment', None),
    ('POST', '/admin/register/no-sale', 'admin_register_no_sale', None),
    ('POST', '/register/pin', 'set_register_pin', None),
    ('POST', '/admin/register/refund', 'admin_register_refund', None),
    ('POST', '/admin/register/cash-payout', 'admin_register_cash_payout', None),
    ('GET', '/admin/register/session', 'get_register_session', None),
    ('GET', '/admin/register/status', 'get_register_status', None),
]

def _response_model(server_globals: dict, token):
    if token is None:
        return None
    if token == "BookingOut":
        return server_globals["BookingOut"]
    if token == "List[BookingOut]":
        return list[server_globals["BookingOut"]]
    raise RuntimeError(f"Unsupported extracted response model: {token}")

def register_register_routes(*, api, server_globals: dict) -> None:
    """Register the original endpoints with unchanged callables/signatures."""
    for method, path, function_name, response_token in ROUTES:
        endpoint = server_globals[function_name]
        kwargs = {}
        response_model = _response_model(server_globals, response_token)
        if response_model is not None:
            kwargs["response_model"] = response_model
        api.add_api_route(path, endpoint, methods=[method], **kwargs)
