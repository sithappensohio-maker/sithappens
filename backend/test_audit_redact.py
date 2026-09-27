"""The Audit Log never keeps a PIN or a sign-in code (audit #7).

Before: only a fixed list of exact key names was blanked, and `pin` was not on
it — setting a register PIN or recording a No-Sale stored the staff member's
4-digit PIN in plain text, readable by anyone with Audit Log access. A client's
photo-gallery PIN and reset/recovery codes leaked the same way.

Now one rule (domains.operations.audit_redact) blanks them for new entries,
and a one-time background scrub blanks entries already saved.

Self-contained fixtures (never import another test module).
"""
import asyncio
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run

from domains.operations import audit_redact

TAG = "TEST_AUDIT_REDACT"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def test_the_rule_blanks_pins_and_codes_and_keeps_ordinary_fields():
    body = {
        "pin": "1234", "reason": "Change for the float", "workstation_id": "front",
        "photo_gallery_pin": "9876", "notes": "Loves tennis balls", "pinned": True,
        "mfa_code": "123456", "recovery_code": "ABC123-DEF456", "guest_token": "tok-x",
        "items": [{"name": "Leash", "quantity": 1, "manager_pin": "4321"}],
    }
    out = audit_redact.redact(body, "/api/register/pin")
    for k in ("pin", "photo_gallery_pin", "mfa_code", "recovery_code", "guest_token"):
        assert out[k] == audit_redact.REDACTED, k
    assert out["items"][0]["manager_pin"] == audit_redact.REDACTED
    assert out["reason"] == "Change for the float" and out["notes"] == "Loves tennis balls"
    assert out["pinned"] is True and out["items"][0]["quantity"] == 1


def test_a_bare_code_is_blanked_only_on_the_two_step_routes():
    assert audit_redact.redact({"code": "123456"}, "/api/auth/mfa/enable")["code"] == audit_redact.REDACTED
    assert audit_redact.redact({"code": "SUMMER10"}, "/api/discounts/apply")["code"] == "SUMMER10"


def test_setting_a_register_pin_never_lands_in_the_audit_log():
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "email": f"{TAG.lower()}-{uid[:6]}@example.com", "name": f"{TAG} Owner", "role": "admin",
        "password_hash": server.hash_password("x-password-123"), "token_version": 0}))
    token = server.create_access_token(uid, f"{TAG.lower()}-{uid[:6]}@example.com", "admin", 0)
    pin = f"{uuid.uuid4().int % 9000 + 1000}"
    try:
        res = run(_http.post("/api/register/pin", json={"pin": pin},
                             headers={"Authorization": f"Bearer {token}"}))
        assert res.status_code < 500
        row = None
        for _ in range(50):
            row = run(server.db.audit_log.find_one({"user_id": uid, "path": "/api/register/pin"}, {"_id": 0}))
            if row:
                break
            run(asyncio.sleep(0.05))
        assert row, "the request was audited"
        assert row["payload"]["pin"] == audit_redact.REDACTED
        assert pin not in str(row["payload"])
    finally:
        run(server.db.users.delete_one({"id": uid}))
        run(server.db.audit_log.delete_many({"user_id": uid}))


def test_entries_saved_before_the_rule_are_blanked_once():
    rows = [
        {"id": f"{TAG}-1", "path": "/api/register/pin", "method": "POST", "payload": {"pin": "1234"}},
        {"id": f"{TAG}-2", "path": "/api/admin/register/no-sale", "method": "POST",
         "payload": {"pin": "5678", "reason": "Float"}},
        {"id": f"{TAG}-3", "path": "/api/clients/c1", "method": "PUT",
         "payload": {"name": "Sam", "photo_gallery_pin": "2468"}},
        {"id": f"{TAG}-4", "path": "/api/bookings", "method": "POST", "payload": {"notes": "nothing secret"}},
    ]
    run(server.db.audit_log.insert_many([dict(r) for r in rows]))
    run(server.db.system_runs.delete_one({"_id": audit_redact.SCRUB_MARKER}))
    try:
        assert run(audit_redact.scrub_existing(server.db)) >= 3
        got = {r["id"]: r["payload"] for r in run(server.db.audit_log.find(
            {"id": {"$regex": f"^{TAG}-"}}, {"_id": 0}).to_list(10))}
        assert got[f"{TAG}-1"]["pin"] == audit_redact.REDACTED
        assert got[f"{TAG}-2"] == {"pin": audit_redact.REDACTED, "reason": "Float"}
        assert got[f"{TAG}-3"]["photo_gallery_pin"] == audit_redact.REDACTED and got[f"{TAG}-3"]["name"] == "Sam"
        assert got[f"{TAG}-4"] == {"notes": "nothing secret"}
        assert run(audit_redact.scrub_existing(server.db)) == 0, "runs once"
    finally:
        run(server.db.audit_log.delete_many({"id": {"$regex": f"^{TAG}-"}}))


# ───────────────────────────── review follow-ups

def test_a_failed_reset_attempt_never_leaves_the_live_link_in_the_audit_log():
    token = "live-" + uuid.uuid4().hex          # has a '-', like a real one often does
    res = run(_http.post(f"/api/claim/{token}", json={"password": "short"}))   # refused: too short
    assert res.status_code == 422
    row = None
    for _ in range(50):
        row = run(server.db.audit_log.find_one({"path": "/api/claim/" + audit_redact.REDACTED, "status": 422},
                                               {"_id": 0}, sort=[("ts", -1)]))
        if row:
            break
        run(asyncio.sleep(0.05))
    try:
        assert row, "the attempt was audited"
        assert token not in str(row)
    finally:
        run(server.db.audit_log.delete_many({"path": "/api/claim/" + audit_redact.REDACTED}))


def test_restoring_an_older_backup_never_brings_a_pin_back():
    from domains.backup import rules as backup_rules
    old = {"id": f"{TAG}-r1", "path": "/api/register/pin", "method": "POST", "payload": {"pin": "1234"}}
    link = {"id": f"{TAG}-r2", "path": "/api/claim/abc-def/login", "method": "POST", "action": "post_abc-def",
            "record_id": "abc-def", "payload": None}
    assert backup_rules.restore_row("audit_log", old)["payload"]["pin"] == audit_redact.REDACTED
    cleaned = backup_rules.restore_row("audit_log", link)
    assert "abc-def" not in str(cleaned)
    other = {"id": "b1", "notes": "pin 1234 please"}
    assert backup_rules.restore_row("bookings", other) == other


def test_older_entries_holding_a_reset_link_are_blanked_too():
    run(server.db.audit_log.insert_one({"id": f"{TAG}-c1", "path": "/api/claim/tok-live-1", "method": "POST",
                                        "action": "post_tok-live-1", "record_id": "tok-live-1", "payload": None}))
    run(server.db.system_runs.delete_one({"_id": audit_redact.SCRUB_MARKER}))
    try:
        run(audit_redact.scrub_existing(server.db))
        row = run(server.db.audit_log.find_one({"id": f"{TAG}-c1"}, {"_id": 0}))
        assert "tok-live-1" not in str(row)
    finally:
        run(server.db.audit_log.delete_many({"id": {"$regex": f"^{TAG}-"}}))


def test_the_scrub_runs_as_a_scheduled_job():
    assert "audit_log_secret_scrub" in [n for n, _ in server._scheduler_jobs()]
