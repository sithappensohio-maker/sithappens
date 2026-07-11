#!/usr/bin/env python3
"""Static regression guard for append-only booking financial corrections.

This does not replace live Mongo/API tests. It catches accidental removal of the
server-side locks, correction endpoints, audit collection, and Income UI entry
points that protect completed financial records.
"""
from pathlib import Path
import ast
import re

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"
INCOME = ROOT / "frontend" / "src" / "screens" / "Income.jsx"
MODAL = ROOT / "frontend" / "src" / "components" / "FinancialCorrectionModal.jsx"

server = SERVER.read_text(encoding="utf-8")
income = INCOME.read_text(encoding="utf-8")
modal = MODAL.read_text(encoding="utf-8")
ast.parse(server, filename=str(SERVER))

required_server = {
    "explicit financial lock helper": "def _booking_is_financially_locked",
    "money field guard": "def _assert_booking_financial_edit_allowed",
    "shared correction lock": "def _acquire_booking_financial_correction_guard",
    "append-only audit writer": "def _record_booking_financial_event",
    "adjustment endpoint": '@api.post("/bookings/{booking_id}/financial-adjustment"',
    "refund endpoint": '@api.post("/bookings/{booking_id}/refund"',
    "safe reopen endpoint": '@api.post("/bookings/{booking_id}/reopen-checkout"',
    "locked transaction deletion": "Completed financial records cannot be deleted",
    "charged cancellation lock": 'kind="cancellation_charge"',
    "checkout lock stamp": '"financial_locked": True',
    "audit index": "db.booking_financial_events",
}
required_income = {
    "adjust action": "setCorrectionRow(r)",
    "locked controls": "disabled={!!r.financial_locked}",
    "correction modal": "<FinancialCorrectionModal",
}
required_modal = {
    "refund action": 'action === "refund"',
    "reopen action": 'action === "reopen"',
    "required reason": "Required reason",
    "audit explanation": "original checkout remains in history",
}

failures = []
for label, token in required_server.items():
    if token not in server:
        failures.append(f"server missing {label}: {token}")
for label, token in required_income.items():
    if token not in income:
        failures.append(f"Income screen missing {label}: {token}")
for label, token in required_modal.items():
    if token not in modal:
        failures.append(f"correction modal missing {label}: {token}")

routes = re.findall(r'@(?:api|api_router|router)\.(get|post|put|patch|delete)\(\s*["\']([^"\']+)["\']', server)
seen = set()
for route in routes:
    if route in seen:
        failures.append(f"duplicate route: {route[0].upper()} {route[1]}")
    seen.add(route)

# A paid/completed transaction must not retain an unconditional hard-delete.
delete_block = re.search(
    r'@api\.delete\("/transactions/\{transaction_id\}"\)(.*?)\n\ndef ',
    server,
    flags=re.S,
)
if not delete_block or "_booking_is_financially_locked" not in delete_block.group(1):
    failures.append("transaction delete route is not guarded by the financial lock")

if failures:
    print("FINANCIAL LOCK VALIDATION FAILED")
    for item in failures:
        print(f" - {item}")
    raise SystemExit(1)

print(f"Financial record locking validation passed ({len(routes)} unique API routes checked).")
