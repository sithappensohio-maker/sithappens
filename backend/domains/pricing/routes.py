"""HTTP route ownership for the Pricing domain.

Phase 5 moves route registration out of server.py while intentionally keeping
the proven endpoint callables during the financial-risk extraction. Business
logic is migrated behind domain services separately, without changing paths.
"""
from __future__ import annotations


ROUTES = [
    ('POST', '/pricing/quote', 'pricing_quote', None),
    ('GET', '/policies/stay', 'stay_policies', None),
    ('GET', '/clients/{client_id}/price-overrides', 'list_client_price_overrides', None),
    ('GET', '/clients/{client_id}/credit-pack-prices', 'client_credit_pack_prices', None),
    ('POST', '/clients/{client_id}/price-overrides', 'create_client_price_override', None),
    ('POST', '/clients/{client_id}/price-overrides/bulk-apply', 'bulk_apply_client_price_overrides', None),
    ('PUT', '/price-overrides/{override_id}', 'update_price_override', None),
    ('DELETE', '/price-overrides/{override_id}', 'delete_price_override', None),
    ('GET', '/pricing-tiers', 'list_pricing_tiers', None),
    ('POST', '/pricing-tiers', 'create_pricing_tier', None),
    ('GET', '/pricing-tiers/{tier_id}', 'get_pricing_tier', None),
    ('PUT', '/pricing-tiers/{tier_id}', 'update_pricing_tier', None),
    ('POST', '/pricing-tiers/{tier_id}/clients/{client_id}', 'assign_client_to_pricing_tier', None),
    ('DELETE', '/pricing-tiers/{tier_id}/clients/{client_id}', 'unassign_client_from_pricing_tier', None),
    ('POST', '/pricing-tiers/{tier_id}/prices', 'set_pricing_tier_price', None),
    ('DELETE', '/pricing-tiers/{tier_id}/prices/{price_id}', 'remove_pricing_tier_price', None),
]

def _response_model(server_globals: dict, token):
    if token is None:
        return None
    if token == "BookingOut":
        return server_globals["BookingOut"]
    if token == "List[BookingOut]":
        return list[server_globals["BookingOut"]]
    raise RuntimeError(f"Unsupported extracted response model: {token}")

def register_pricing_routes(*, api, server_globals: dict) -> None:
    """Register the original endpoints with unchanged callables/signatures."""
    for method, path, function_name, response_token in ROUTES:
        endpoint = server_globals[function_name]
        kwargs = {}
        response_model = _response_model(server_globals, response_token)
        if response_model is not None:
            kwargs["response_model"] = response_model
        api.add_api_route(path, endpoint, methods=[method], **kwargs)
