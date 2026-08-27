"""HTTP route ownership for the Pos domain.

Phase 5 moves route registration out of server.py while intentionally keeping
the proven endpoint callables during the financial-risk extraction. Business
logic is migrated behind domain services separately, without changing paths.
"""
from __future__ import annotations


ROUTES = [
    ('GET', '/pos/receipt-payload', 'get_pos_receipt_payload', None),
    ('POST', '/pos/verify-drawer-token', 'verify_pos_drawer_token', None),
    ('GET', '/pos/catalog', 'get_register_catalog', None),
    ('GET', '/pos/products', 'list_pos_products', None),
    ('POST', '/pos/products', 'create_pos_product', None),
    ('PUT', '/pos/products/{product_id}', 'update_pos_product', None),
    ('POST', '/pos/products/{product_id}/duplicate', 'duplicate_pos_product', None),
    ('DELETE', '/pos/products/{product_id}', 'delete_pos_product', None),
    ('POST', '/pos/products/{product_id}/archive', 'archive_pos_product', None),
    ('POST', '/pos/products/{product_id}/restore', 'restore_pos_product', None),
    ('GET', '/pos/products/categories', 'pos_product_categories', None),
    ('POST', '/pos/products/{product_id}/adjust-stock', 'adjust_pos_product_stock', None),
    ('GET', '/pos/products/{product_id}/movements', 'list_inventory_movements', None),
    ('POST', '/pos/checkout/preview', 'preview_pos_sale', None),
    ('POST', '/pos/sales/preview', 'preview_pos_sale', None),
    ('POST', '/pos/checkout', 'create_pos_sale', None),
    ('POST', '/pos/sales', 'create_pos_sale', None),
    ('GET', '/pos/sales', 'list_pos_sales', None),
    ('GET', '/pos/sales/{sale_id}', 'get_pos_sale', None),
    ('POST', '/pos/sales/{sale_id}/pos-tokens', 'issue_pos_tokens_for_sale', None),
    ('POST', '/pos/sales/{sale_id}/void', 'void_pos_sale', None),
]

def _response_model(server_globals: dict, token):
    if token is None:
        return None
    if token == "BookingOut":
        return server_globals["BookingOut"]
    if token == "List[BookingOut]":
        return list[server_globals["BookingOut"]]
    raise RuntimeError(f"Unsupported extracted response model: {token}")

def register_pos_routes(*, api, server_globals: dict) -> None:
    """Register the original endpoints with unchanged callables/signatures."""
    for method, path, function_name, response_token in ROUTES:
        endpoint = server_globals[function_name]
        kwargs = {}
        response_model = _response_model(server_globals, response_token)
        if response_model is not None:
            kwargs["response_model"] = response_model
        api.add_api_route(path, endpoint, methods=[method], **kwargs)
