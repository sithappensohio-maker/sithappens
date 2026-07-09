#!/usr/bin/env python3
"""Dependency-free regression audit for guarded register closeout/rollover.

This intentionally uses Python's AST and source checks so it can run on the
self-hosted box before Docker dependencies are installed.
"""
from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"
EOD_UI = ROOT / "frontend" / "src" / "components" / "OwnerClockAndEndOfDay.jsx"
REGISTER_UI = ROOT / "frontend" / "src" / "screens" / "Staff.jsx"

server_text = SERVER.read_text(encoding="utf-8")
eod_text = EOD_UI.read_text(encoding="utf-8")
register_text = REGISTER_UI.read_text(encoding="utf-8")
tree = ast.parse(server_text)

errors: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


classes = {n.name: n for n in tree.body if isinstance(n, ast.ClassDef)}
closeout_model = classes.get("EndOfDayCloseoutIn")
require(closeout_model is not None, "EndOfDayCloseoutIn model is missing")
if closeout_model:
    annotations = {
        n.target.id: n.annotation
        for n in closeout_model.body
        if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)
    }
    require("cash_counted" in annotations, "cash_counted is missing from closeout model")
    if "cash_counted" in annotations:
        require(
            not (isinstance(annotations["cash_counted"], ast.Subscript)
                 and getattr(annotations["cash_counted"].value, "id", "") == "Optional"),
            "cash_counted must be required, not Optional",
        )
    require("rollover_confirmed" in annotations, "rollover_confirmed is missing")
    require("confirmed_rollover_cash" in annotations, "confirmed_rollover_cash is missing")

functions = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
for name in (
    "_active_register_closeout",
    "_require_register_day_open",
    "_previous_closeout_rollover",
    "admin_reopen_register_day",
    "admin_end_of_day_closeout",
):
    require(name in functions, f"{name} is missing")

# Every direct register mutation must call the closed-day guard.
for name in (
    "admin_open_cash_drawer",
    "admin_register_till_adjustment",
    "admin_register_refund",
    "admin_register_cash_payout",
    "create_expense",
    "create_retail_sale",
    "apply_tab_payment",
    "sell_training_program",
    "sell_credit_pack",
    "sell_credit_packs_bulk",
    "mark_installment_paid",
):
    fn = functions.get(name)
    require(fn is not None, f"{name} is missing")
    if fn:
        calls = {
            node.func.id
            for node in ast.walk(fn)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        require("_require_register_day_open" in calls, f"{name} does not enforce closed-day lock")

require("Confirm the exact cash amount that will carry forward" in server_text,
        "backend rollover confirmation validation is missing")
require("opening_override_reason" in server_text,
        "opening override reason is not persisted")
require("reopened_reason" in server_text and "reopened_by_name" in server_text,
        "reopen audit trail fields are missing")
require('"register_closed": bool(closeout)' in server_text,
        "register summary does not expose closed state")
require('"opening_rollover"' in server_text,
        "register summary does not expose rollover information")

for ui_name, text in (("dashboard closeout", eod_text), ("register closeout", register_text)):
    require("Use expected" in text, f"{ui_name} is missing Use expected action")
    require("rollover_confirmed: true" in text, f"{ui_name} does not send rollover confirmation")
    require("confirmed_rollover_cash" in text, f"{ui_name} does not send confirmed rollover cash")
    require("Reopen Day" in text, f"{ui_name} is missing Reopen Day workflow")
    require("opening_override_reason" in text or "openingOverrideReason" in text,
            f"{ui_name} is missing opening override reason")

require("Not entered" in register_text,
        "closeout history still renders blank values as $0.00")

if errors:
    print("REGISTER CLOSEOUT GUARD AUDIT: FAILED")
    for error in errors:
        print(f" - {error}")
    raise SystemExit(1)

print("REGISTER CLOSEOUT GUARD AUDIT: PASSED")
print(" - required physical cash count")
print(" - exact rollover confirmation")
print(" - reason-required opening override")
print(" - closed-day mutation lock")
print(" - explicit reopen audit trail")
print(" - corrected blank-history display")
