"""Source-level architecture guards for modernization Phase 4.

These tests need only Python's stdlib, so the server.py freeze can be checked
in lightweight CI even before Mongo/Stripe integration dependencies load.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server.py"
ARCH = ROOT / "architecture"


def _literal_api_routes(source: str):
    tree = ast.parse(source)
    routes = set()
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
            routes.add((dec.func.attr.upper(), dec.args[0].value, node.name))
    return routes


def test_server_route_set_is_frozen_and_can_only_shrink():
    baseline = {
        (row["method"], row["path"], row["function"])
        for row in json.loads((ARCH / "server_route_freeze.json").read_text())
    }
    current = _literal_api_routes(SERVER.read_text())
    added = current - baseline
    assert not added, f"New routes belong in backend/domains, not server.py: {sorted(added)!r}"


def test_server_does_not_regrow_past_phase4_boundary():
    # Phase-4 server.py ended below this ceiling after extracting Training Today.
    # Future domain extraction should make this number fall, not rise.
    assert len(SERVER.read_text().splitlines()) <= 57200


def test_production_entrypoint_has_no_post_import_installers():
    text = (ROOT / "app_entry.py").read_text()
    assert "install_board_train" not in text
    assert "install_trainer_delivery" not in text
    assert "install_in_person_session" not in text
    assert "install_school_experience" not in text
    assert "app = server.app" in text


def test_training_school_domain_boundaries_are_explicit():
    server = SERVER.read_text()
    bootstrap = (ROOT / "domains" / "bootstrap.py").read_text()
    training_routes = (ROOT / "domains" / "training" / "routes.py").read_text()
    school_routes = (ROOT / "domains" / "school" / "routes.py").read_text()
    curriculum = (ROOT / "school_curriculum_routes.py").read_text()

    assert "register_domains(" in server
    assert "@api.get(\"/admin/training/today\")" not in server
    assert "@api.get(\"/admin/training/today\")" in training_routes
    assert "/training/enrollments/{enrollment_id}/manual-progress" in training_routes
    assert "register_school_routes(" in bootstrap
    assert "patch_delete_routes=False" in school_routes
    assert "route.dependant.call" not in curriculum
    assert "route.endpoint =" not in curriculum


def test_canonical_training_calls_domain_services_directly():
    server = SERVER.read_text()
    required = (
        "training_domain_services.effective_booking_service_type",
        "training_domain_services.trainer_controls_in_person_progression",
        "training_domain_services.enforce_session_completion_record",
        "training_domain_services.prepare_session_draft_request",
        "training_domain_services.after_completion_worker",
        "training_domain_services.ensure_board_train_checkout_ready",
    )
    missing = [needle for needle in required if needle not in server]
    assert not missing, f"Missing direct domain integrations: {missing!r}"

    # Phase 5 moved exact catalog-service selection into the Bookings domain;
    # that service now owns the Training/Board & Train service-rule handoff.
    booking_services = (ROOT / "domains" / "bookings" / "services.py").read_text()
    assert "_apply_booking_service_rules_fn(_db, body, selected)" in booking_services
