"""HTTP route ownership for the Bookings domain.

Phase 5 moves route registration out of server.py while intentionally keeping
the proven endpoint callables during the financial-risk extraction. Business
logic is migrated behind domain services separately, without changing paths.
"""
from __future__ import annotations


ROUTES = [
    ('GET', '/bookings', 'list_bookings', 'List[BookingOut]'),
    ('POST', '/bookings', 'create_booking', 'BookingOut'),
    ('POST', '/bookings/recurring', 'create_recurring', None),
    ('POST', '/bookings/group', 'create_booking_group', None),
    ('GET', '/bookings/group/{group_id}', 'get_booking_group', None),
    ('PUT', '/bookings/{booking_id}/reschedule', 'reschedule_booking', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/approve', 'approve_booking', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/reject', 'reject_booking', 'BookingOut'),
    ('DELETE', '/bookings/{booking_id}', 'cancel_booking', None),
    ('GET', '/bookings/availability', 'availability', None),
    ('GET', '/bookings/time-slots', 'list_time_slots', None),
    ('GET', '/bookings/conflicts', 'booking_conflicts', None),
    ('GET', '/bookings/summary', 'bookings_summary', None),
    ('GET', '/bookings/{booking_id}', 'get_booking', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/check-in', 'check_in', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/add-ons', 'attach_booking_addons', 'BookingOut'),
    ('DELETE', '/bookings/{booking_id}/add-ons/{addon_index}', 'remove_booking_addon', 'BookingOut'),
    ('GET', '/bookings/{booking_id}/discount-preview', 'discount_preview', None),
    ('GET', '/bookings/{booking_id}/early-checkout-quote', 'early_checkout_quote', None),
    ('GET', '/bookings/{booking_id}/money-modifier-preview', 'money_modifier_preview', None),
    ('POST', '/bookings/{booking_id}/checkout-partial', 'checkout_partial', 'BookingOut'),
    ('GET', '/bookings/{booking_id}/checkout-group-preview', 'checkout_group_preview', None),
    ('POST', '/bookings/{booking_id}/check-out-group', 'check_out_group', None),
    ('POST', '/bookings/{booking_id}/check-out', 'check_out', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/report-card', 'save_report_card', 'BookingOut'),
    ('GET', '/bookings/{booking_id}/report-card-email/preview', 'preview_report_card_email', None),
    ('POST', '/bookings/{booking_id}/resend-report-card', 'resend_report_card_email', None),
    ('POST', '/bookings/{booking_id}/financial-adjustment', 'booking_financial_adjustment', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/refund', 'booking_refund', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/reopen-checkout', 'reopen_booking_checkout', 'BookingOut'),
    ('PATCH', '/bookings/{booking_id}', 'patch_booking', 'BookingOut'),
    ('POST', '/bookings/{booking_id}/training-session/draft', 'start_training_session_draft_for_booking', None),
    ('GET', '/bookings/{booking_id}/training-context', 'get_training_context_for_booking', None),
    ('GET', '/bookings/{booking_id}/history', 'booking_history', None),
    ('GET', '/bookings/{booking_id}/invoice', 'get_booking_invoice', None),
    ('POST', '/bookings/{booking_id}/reschedule-next-week', 'reschedule_prepaid_session', None),
    ('POST', '/bookings/multi-dates', 'create_multi_date_bookings', None),
    ('GET', '/bookings/{booking_id}/care', 'get_booking_care', None),
    ('PUT', '/bookings/{booking_id}/care', 'set_booking_care', None),
    ('POST', '/bookings/{booking_id}/care/{item_id}/complete', 'complete_care_item', None),
    ('POST', '/bookings/{booking_id}/care/{item_id}/skip', 'skip_care_item', None),
    ('POST', '/bookings/{booking_id}/care/{item_id}/reset', 'reset_care_item', None),
]

def _response_model(server_globals: dict, token):
    if token is None:
        return None
    if token == "BookingOut":
        return server_globals["BookingOut"]
    if token == "List[BookingOut]":
        return list[server_globals["BookingOut"]]
    raise RuntimeError(f"Unsupported extracted response model: {token}")

def register_bookings_routes(*, api, server_globals: dict) -> None:
    """Register the original endpoints with unchanged callables/signatures."""
    for method, path, function_name, response_token in ROUTES:
        endpoint = server_globals[function_name]
        kwargs = {}
        response_model = _response_model(server_globals, response_token)
        if response_model is not None:
            kwargs["response_model"] = response_model
        api.add_api_route(path, endpoint, methods=[method], **kwargs)
