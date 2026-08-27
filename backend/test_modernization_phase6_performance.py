"""Regression guards for Modernization Phase 6 performance work."""
from pathlib import Path

from fastapi import APIRouter

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SERVER = ROOT / "server.py"
PERF_ROUTES = ROOT / "domains" / "performance" / "routes.py"
PERF_SERVICES = ROOT / "domains" / "performance" / "services.py"
PERF_MIDDLEWARE = ROOT / "domains" / "performance" / "middleware.py"
FRONTEND = REPO / "frontend" / "src"


def test_phase6_performance_routes_are_domain_owned_and_additive():
    text = PERF_ROUTES.read_text()
    for path in (
        "/clients/page", "/clients/options", "/clients/balances", "/dogs/options",
        "/homework/counts", "/admin/live-summary",
    ):
        assert f'@api.get("{path}")' in text
        assert f'@api.get("{path}")' not in SERVER.read_text()


def test_phase6_route_registry_builds_real_fastapi_routes():
    from domains.performance.routes import register_performance_routes

    async def current_user():
        return {"role": "admin"}

    async def clients_view():
        return {"role": "admin"}

    api = APIRouter()
    register_performance_routes(
        api=api, db=object(), server_globals={}, get_current_user=current_user,
        require_clients_view=clients_view, perms_for=lambda user: {},
        business_today=lambda: None,
    )
    actual = {route.path for route in api.routes}
    expected = {
        "/clients/page", "/clients/options", "/clients/balances", "/dogs/options",
        "/homework/counts", "/admin/live-summary",
    }
    assert expected <= actual


def test_paginated_client_directory_is_safe_and_page_scoped():
    text = PERF_ROUTES.read_text()
    assert '.skip((page_num - 1) * size).limit(size)' in text
    assert '"client_id": {"$in": client_ids}' in text
    assert '"owner_id": {"$in": client_ids}' in text
    assert 'client_model = server_globals["ClientOut"]' in text
    assert 'model_validate(row).model_dump()' in text
    assert 'stripe_customer_id' not in text


def test_legacy_server_stays_frozen_and_practice_query_moved_to_service():
    server = SERVER.read_text()
    assert len(server.splitlines()) <= 56300
    assert "performance_domain_services.list_homework" in server
    services = PERF_SERVICES.read_text()
    assert 'active_q["status"] = {"$ne": "completed"}' in services
    assert "active_total = await db.homework.count_documents(active_q)" in services
    assert ".skip(completed_skip).limit(lim)" in services


def test_global_search_batches_upcoming_dog_bookings_and_pending_counts_parallelize():
    server = SERVER.read_text()
    assert '"dog_id": {"$in": dog_ids}' in server
    assert "upcoming_by_dog" in server
    assert "Phase 6 — batch the upcoming-booking lookup" in server
    assert "mg, pending_bookings, resched, disputes, shop_recon, overdue_rows = await asyncio.gather(" in server


def test_frontend_uses_lightweight_client_resources_instead_of_rich_full_list():
    # There should be no production component left that downloads the full rich
    # GET /clients directory just to populate a picker/search field.
    offenders = []
    for path in FRONTEND.rglob("*"):
        if path.suffix not in {".js", ".jsx"} or ".test." in path.name:
            continue
        if 'api.get("/clients")' in path.read_text(errors="replace"):
            offenders.append(str(path.relative_to(REPO)))
    assert offenders == []

    clients = (FRONTEND / "screens" / "Clients.jsx").read_text()
    assert 'api.get("/clients/page"' in clients
    assert 'data-testid="client-directory-search"' in clients
    assert 'data-testid="client-pagination"' in clients
    assert 'client_ids: ids.join(",")' in clients

    booking = (FRONTEND / "components" / "AdminBookingModal.jsx").read_text()
    assert 'api.get("/clients/options")' in booking
    assert 'api.get("/dogs/options")' in booking
    assert 'api.get("/clients")' not in booking


def test_shell_polling_is_one_live_summary_request():
    shared = (FRONTEND / "lib" / "sharedData.js").read_text()
    assert 'api.get("/admin/live-summary"' in shared
    for old in (
        'api.get("/admin/messages/unread-count"',
        'api.get("/admin/shop-orders/unseen-count"',
        'api.get("/admin/school/hq/attention-count"',
        'api.get("/admin/pending-actions/count"',
    ):
        assert old not in shared

    today = (FRONTEND / "screens" / "Today.jsx").read_text()
    app = (FRONTEND / "App.js").read_text()
    assert 'messagesUnread = 0' in today
    assert 'messagesUnread={messagesUnread}' in app
    assert 'api.get("/admin/live-summary")' not in today


def test_practice_workspace_is_active_first_and_loads_history_on_demand():
    src = (FRONTEND / "screens" / "Homework.jsx").read_text()
    assert 'active_first: true' in src
    assert 'api.get("/homework/counts")' in src
    assert 'listLimit' in src
    assert 'data-testid="homework-load-older"' in src
    assert 'api.get("/dogs/options")' in src


def test_slow_request_profiling_and_hot_indexes_are_present():
    middleware = PERF_MIDDLEWARE.read_text()
    assert 'SLOW_REQUEST_MS' in middleware
    assert 'Server-Timing' in middleware
    assert 'slow_api method=%s path=%s' in middleware

    server = SERVER.read_text()
    for index_name in (
        "bookings_dog_upcoming", "homework_client_status_created", "homework_dog_status_created",
        "waiver_client_latest", "intake_client_status", "shop_orders_unseen",
        "message_threads_unread_admin", "message_threads_status",
    ):
        assert index_name in server
