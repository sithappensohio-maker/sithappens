"""Explicit domain composition for the monolith-modernization bridge."""
from __future__ import annotations

import logging

from domains.bookings.routes import register_bookings_routes
from domains.pos.routes import register_pos_routes
from domains.pricing.routes import register_pricing_routes
from domains.register.routes import register_register_routes
from domains.pricing import services as pricing_services
from domains.pos import services as pos_services
from domains.bookings import services as booking_services
from domains.register import services as register_services
from domains.school.routes import register_school_routes
from domains.training.routes import register_training_routes
from domains.training.services import repair_open_residential_spans
from domains.performance.routes import register_performance_routes
from domains.performance.middleware import install_request_timing
from domains.performance import services as performance_services

logger = logging.getLogger("sithappens")


class _LiveDbProxy:
    """Resolve the server module's CURRENT ``db`` global on every access.

    ``register_domains`` runs once at import time, but the legacy release-
    critical suite (see tests/test_shop_management.py::_call_server) drives
    server.py's financial facades in-process by temporarily rebinding
    ``server.db`` to a client created inside each test's own event loop.
    Snapshotting the import-time handle into the extracted domains broke
    that documented contract ("Event loop is closed" on every domain-backed
    call), so the domains get this proxy instead: attribute/item access is
    forwarded to whatever ``server.db`` is *right now*.  In production the
    global never changes, making this byte-for-byte equivalent to the
    direct handle.
    """

    def __init__(self, server_globals: dict):
        self._server_globals = server_globals

    def _current(self):
        return self._server_globals["db"]

    def __getattr__(self, name):
        return getattr(self._current(), name)

    def __getitem__(self, name):
        return self._current()[name]


def register_domains(
    *, app, api, db, server_globals: dict,
    get_current_user, require_admin_and_permission, perms_for,
    school_events, persist_school_media, school_media_data_url,
    school_media_file_path, require_school_access, checkpoint_overall_scores,
    program_model, create_program, update_program, now_iso,
    homework_template_model, create_homework_template,
    business_today, gid,
    staff_school_delivery_channels, school_delivery_channels,
    check_enrollment_module_readiness, enrollment_summary, effective_lessons,
    recommended_focus, booking_training_assignment_for_day,
):
    """Register extracted domains and startup work once."""
    # Every domain reads the database through the live proxy so that
    # rebinding server.db (the legacy in-process test convention) reaches
    # the domains too — see _LiveDbProxy's docstring.
    db = _LiveDbProxy(server_globals)
    # Phase 5 financial kernel. The compatibility functions in server.py now
    # delegate to these services, so booking quotes, Quick Check-In, POS preview,
    # and POS checkout all share the same canonical pricing code.
    booking_services.configure(
        db=db, apply_booking_service_rules=server_globals["training_domain_services"].apply_booking_service_rules,
        create_booking_impl=server_globals["_create_booking_impl"],
        check_out_impl=server_globals["_check_out_endpoint_impl"],
    )
    register_services.configure(
        active_register_closeout=server_globals["_active_register_closeout"],
        closeout_rollover_cash=server_globals["_closeout_rollover_cash"],
    )
    pricing_services.configure(
        db=db,
        business_today=business_today,
        billable_boarding_units=server_globals["_billable_boarding_units"],
        now_iso=now_iso,
        default_boarding_cutoff=server_globals["DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF"],
    )
    pos_services.configure(
        db=db,
        resolve_client_price=pricing_services.resolve_client_price,
        get_settings=server_globals["get_settings"],
        credit_pack_display_fields=server_globals["_credit_pack_display_fields"],
        free_claim_program_blockers=server_globals["_free_claim_program_blockers"],
        logger=logger,
        create_sale_impl=server_globals["_create_pos_sale_impl"],
    )

    performance_services.configure(
        db=db,
        compute_daily_progress=server_globals["_compute_daily_progress"],
        streak_count=server_globals["_streak_count"],
        client_safe_homework=server_globals["_client_safe_homework"],
        is_school_homework=server_globals["_is_school_homework"],
    )

    # HTTP ownership moves out of server.py without changing the proven endpoint
    # callables or dependency signatures. Registration order mirrors the legacy
    # route order within each domain.
    register_bookings_routes(api=api, server_globals=server_globals)
    register_pricing_routes(api=api, server_globals=server_globals)
    register_register_routes(api=api, server_globals=server_globals)
    register_pos_routes(api=api, server_globals=server_globals)
    register_performance_routes(
        api=api, db=db, server_globals=server_globals,
        get_current_user=get_current_user,
        require_clients_view=require_admin_and_permission("clients_view"),
        perms_for=perms_for, business_today=business_today,
    )
    register_school_routes(
        api=api, db=db, server_globals=server_globals,
        get_current_user=get_current_user,
        manage_school_dep=require_admin_and_permission("manage_school"),
        manage_training_content_dep=require_admin_and_permission("manage_training_content"),
        perms_for=perms_for, school_events=school_events,
        persist_school_media=persist_school_media,
        school_media_data_url=school_media_data_url,
        school_media_file_path=school_media_file_path,
        require_school_access=require_school_access,
        checkpoint_overall_scores=checkpoint_overall_scores,
        program_model=program_model, create_program=create_program,
        update_program=update_program, now_iso=now_iso,
        homework_template_model=homework_template_model,
        create_homework_template=create_homework_template,
    )
    register_training_routes(
        api=api, db=db, get_current_user=get_current_user, perms_for=perms_for,
        manage_sessions_dep=require_admin_and_permission("manage_training_sessions"),
        business_today=business_today, gid=gid, now_iso=now_iso,
        staff_school_delivery_channels=staff_school_delivery_channels,
        school_delivery_channels=school_delivery_channels,
        check_enrollment_module_readiness=check_enrollment_module_readiness,
        enrollment_summary=enrollment_summary, effective_lessons=effective_lessons,
        recommended_focus=recommended_focus,
        booking_training_assignment_for_day=booking_training_assignment_for_day,
    )

    async def _repair_board_train_spans() -> None:
        try:
            repaired = await repair_open_residential_spans(db)
            if repaired:
                logger.info("Board & Train scheduling migration: repaired %d open booking span(s)", repaired)
        except Exception as exc:
            logger.warning("Board & Train scheduling migration skipped (non-fatal): %s", exc)

    install_request_timing(app)
    app.add_event_handler("startup", _repair_board_train_spans)
