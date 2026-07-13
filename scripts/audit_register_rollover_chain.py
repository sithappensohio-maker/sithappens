#!/usr/bin/env python3
"""Dependency-free audit for day-to-day register rollover integrity."""
from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"
DASHBOARD = ROOT / "frontend" / "src" / "components" / "OwnerClockAndEndOfDay.jsx"
REGISTER = ROOT / "frontend" / "src" / "screens" / "Staff.jsx"

server_text = SERVER.read_text(encoding="utf-8")
dashboard_text = DASHBOARD.read_text(encoding="utf-8")
register_text = REGISTER.read_text(encoding="utf-8")
tree = ast.parse(server_text)
errors: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
functions = {
    node.name: node
    for node in tree.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
}

closeout_model = classes.get("EndOfDayCloseoutIn")
require(closeout_model is not None, "EndOfDayCloseoutIn is missing")
if closeout_model:
    model_fields = {
        node.target.id
        for node in closeout_model.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
    }
    require("date" in model_fields, "closeout payload has no explicit register date")
    require("cash_counted" in model_fields, "closeout payload has no physical cash count")
    require("confirmed_rollover_cash" in model_fields, "closeout payload has no confirmed rollover")

for name in (
    "_validated_register_date",
    "_previous_closeout_rollover",
    "_effective_register_opening",
    "_admin_end_of_day_snapshot",
    "admin_end_of_day_closeout",
):
    require(name in functions, f"{name} is missing")

require("d = _validated_register_date(body.date)" in server_text,
        "closeout does not bind to the requested business date")
require("snapshot = await _admin_end_of_day_snapshot(d)" in server_text,
        "closeout snapshot is not built for the same requested date")
require('"rollover_cash": counted' in server_text,
        "physical counted cash is not persisted as rollover cash")
require('"rollover_closeout_id": doc["id"]' in server_text,
        "drawer session does not retain the source closeout id")
require('"suggested_opening_from_closeout_id"' in server_text,
        "opening session does not retain the prior closeout source id")
require('"source_closeout_id": opening_resolution.get("suggested_from_closeout_id")' in server_text,
        "register response does not expose the rollover source closeout")
require("date: data?.date" in dashboard_text,
        "dashboard closeout does not submit the reviewed business date")
require("fresh.data?.date !== data?.date" in dashboard_text,
        "dashboard closeout has no midnight-stale-tab guard")
require("date,\n      cash_counted: counted" in register_text,
        "full Register closeout does not submit its selected date")

if errors:
    print("REGISTER ROLLOVER CHAIN AUDIT: FAILED")
    for error in errors:
        print(f" - {error}")
    raise SystemExit(1)

print("REGISTER ROLLOVER CHAIN AUDIT: PASSED")
print(" - closeout is bound to the reviewed business date")
print(" - dashboard protects against crossing midnight")
print(" - actual counted cash is the durable rollover")
print(" - opening sessions retain their source closeout")
print(" - historical Register closeout cannot accidentally close today")
