"""Dedicated email-outbox worker + Resend idempotency — targeted tests only.

These tests talk to the local test Mongo DB directly (MONGO_URL/DB_NAME from
.env) and import email_service/email_worker directly, the same deliberate
exception to this repo's black-box-HTTP convention already used by
test_shop_checkout.py's Group I (there is no HTTP endpoint that drains the
outbox or runs the worker loop — it's a process/scheduler-driven worker).

resend.Emails.send is ALWAYS mocked in every test below. No real network call
to Resend is ever made by this file.

This local test DB has an accumulated backlog of unrelated pending
email_outbox rows from earlier test sessions (see test_shop_checkout.py's own
notes on this). Several tests below use a per-recipient scripted mock so
backlog rows always get a harmless scripted success response — never
corrupted, never mistaken for the row under test — while assertions only
ever inspect calls scoped to our own test recipient address.
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, AsyncMock, patch

import pytest
import yaml
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import email_service
import email_worker

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _mongo_run(async_fn):
    async def _wrapped():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = mc[os.environ.get("DB_NAME", "sit_happens")]
            email_service.set_db(db)
            return await async_fn(db)
        finally:
            mc.close()
    return asyncio.run(_wrapped())


def _iso(offset_seconds=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)).isoformat()


async def _insert_row(db, key, to_email, status="pending", attempts=0, next_attempt_offset=-60):
    await db.email_outbox.delete_many({"key": key})
    await db.email_outbox.insert_one({
        "key": key,
        "to_email": to_email,
        "subject": f"Subject for {key}",
        "html": f"<p>Body for {key}</p>",
        "status": status,
        "attempts": attempts,
        "created_at": _iso(-300),
        "next_attempt_at": _iso(next_attempt_offset),
    })


@pytest.fixture
def outbox_key():
    key = f"test:email-worker:{uuid.uuid4().hex}"
    yield key

    async def _cleanup(db):
        await db.email_outbox.delete_many({"key": key})
    _mongo_run(_cleanup)


def _calls_for(mock_send, to_email):
    return [c for c in mock_send.call_args_list if (c.args[0] or {}).get("to") == [to_email]]


def _scripted_resend(responses: dict):
    """responses: {to_email: [outcome, ...]}. An outcome that is an Exception
    instance is raised; anything else is returned. Calls for any recipient
    not in `responses` (i.e. unrelated backlog rows) get a harmless scripted
    success so process_email_outbox can drain them without error."""
    counters = {}

    def _side_effect(params, options=None):
        to = (params.get("to") or [None])[0]
        if to in responses:
            seq = responses[to]
            i = min(counters.get(to, 0), len(seq) - 1)
            counters[to] = counters.get(to, 0) + 1
            outcome = seq[i]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        return {"id": "unrelated-backlog-row-ok"}

    mock = Mock(side_effect=_side_effect)
    return mock


def _patched(mock_send):
    return (
        patch.object(email_service.resend.Emails, "send", mock_send),
        patch.object(email_service, "RESEND_API_KEY", "test-key"),
        patch.object(email_service, "_is_in_quiet_hours", AsyncMock(return_value=False)),
    )


# ---------------------------------------------------------------------------
# A + B — worker calls Resend once per pending row, with the stable outbox
# key as the provider idempotency key.
# ---------------------------------------------------------------------------

def test_a_worker_calls_resend_once_for_pending_row(outbox_key):
    to_email = f"{outbox_key}@example.invalid"
    mock_send = _scripted_resend({to_email: [{"id": "mock-a"}]})

    async def _run(db):
        await _insert_row(db, outbox_key, to_email)
        p1, p2, p3 = _patched(mock_send)
        with p1, p2, p3:
            return await email_service.process_email_outbox(db, limit=5000)

    _mongo_run(_run)
    assert len(_calls_for(mock_send, to_email)) == 1


def test_b_resend_receives_stable_outbox_idempotency_key(outbox_key):
    to_email = f"{outbox_key}@example.invalid"
    mock_send = _scripted_resend({to_email: [{"id": "mock-b"}]})

    async def _run(db):
        await _insert_row(db, outbox_key, to_email)
        p1, p2, p3 = _patched(mock_send)
        with p1, p2, p3:
            return await email_service.process_email_outbox(db, limit=5000)

    _mongo_run(_run)
    matches = _calls_for(mock_send, to_email)
    assert len(matches) == 1
    options = matches[0].args[1]
    assert options == {"idempotency_key": outbox_key}


# ---------------------------------------------------------------------------
# C — retry of the same row (later worker cycle) reuses the identical key.
# ---------------------------------------------------------------------------

def test_c_retry_of_same_row_uses_same_idempotency_key(outbox_key):
    to_email = f"{outbox_key}@example.invalid"
    mock_send = _scripted_resend({to_email: [Exception("simulated transient failure"), {"id": "mock-c"}]})

    async def _run(db):
        await _insert_row(db, outbox_key, to_email)
        p1, p2, p3 = _patched(mock_send)
        with p1, p2, p3:
            await email_service.process_email_outbox(db, limit=5000)
            # Simulate the backoff window having elapsed so the retry is due now.
            await db.email_outbox.update_one({"key": outbox_key}, {"$set": {"next_attempt_at": _iso(-1)}})
            await email_service.process_email_outbox(db, limit=5000)

    _mongo_run(_run)
    matches = _calls_for(mock_send, to_email)
    assert len(matches) == 2
    keys_used = {m.args[1].get("idempotency_key") for m in matches}
    assert keys_used == {outbox_key}


# ---------------------------------------------------------------------------
# D — ambiguous crash: Resend already accepted the send, but the process
# died before any local state transition persisted (row still "pending",
# nothing recorded). The natural next attempt for the same row must reuse
# the identical provider key so Resend's own 24h dedup — not our local
# state, which is exactly what's ambiguous here — prevents a real second
# send. Exercised directly at the _send() boundary, the exact seam where the
# outbox key becomes the provider idempotency key, rather than forcing a
# real mid-write crash inside process_email_outbox's row loop.
# ---------------------------------------------------------------------------

def test_d_ambiguous_crash_before_local_stamp_retries_with_identical_key(outbox_key):
    to_email = f"{outbox_key}@example.invalid"
    mock_send = _scripted_resend({to_email: [{"id": "mock-d-1"}, {"id": "mock-d-2"}]})

    async def _run(db):
        p1, p2, p3 = _patched(mock_send)
        with p1, p2, p3:
            ok1 = await email_service._send(to_email, "subj", "<p>body</p>", outbox_key=outbox_key)
            # No local status transition happens here — this is the crash.
            ok2 = await email_service._send(to_email, "subj", "<p>body</p>", outbox_key=outbox_key)
        return ok1, ok2

    ok1, ok2 = _mongo_run(_run)
    assert ok1 is True and ok2 is True
    matches = _calls_for(mock_send, to_email)
    assert len(matches) == 2
    keys_used = {m.args[1].get("idempotency_key") for m in matches}
    assert keys_used == {outbox_key}


# ---------------------------------------------------------------------------
# E — a normal (non-ambiguous) Resend failure remains pending, retryable,
# with attempts incremented and backoff applied.
# ---------------------------------------------------------------------------

def test_e_normal_resend_failure_remains_pending_with_backoff(outbox_key):
    to_email = f"{outbox_key}@example.invalid"
    mock_send = _scripted_resend({to_email: [Exception("simulated permanent-looking failure")]})

    async def _run(db):
        await _insert_row(db, outbox_key, to_email)
        p1, p2, p3 = _patched(mock_send)
        with p1, p2, p3:
            await email_service.process_email_outbox(db, limit=5000)
        return await db.email_outbox.find_one({"key": outbox_key}, {"_id": 0})

    doc = _mongo_run(_run)
    assert doc is not None
    assert doc["status"] == "pending"
    assert doc["attempts"] == 1
    assert doc["next_attempt_at"] > _iso(0)


# ---------------------------------------------------------------------------
# F — a row already in delivered_pending_stamp (Resend already has it; only
# the local success-stamp write is outstanding) must never call Resend again.
# ---------------------------------------------------------------------------

def test_f_delivered_pending_stamp_never_calls_resend_again(outbox_key):
    to_email = f"{outbox_key}@example.invalid"
    mock_send = Mock(return_value={"id": "should-never-be-called-for-our-row"})

    async def _run(db):
        await _insert_row(db, outbox_key, to_email, status="delivered_pending_stamp")
        p1, p2, p3 = _patched(mock_send)
        with p1, p2, p3:
            await email_service.process_email_outbox(db, limit=5000)
        return await db.email_outbox.find_one({"key": outbox_key}, {"_id": 0})

    doc = _mongo_run(_run)
    assert _calls_for(mock_send, to_email) == []
    assert doc is None  # on_success=None stamps trivially — row is deleted, never resent


# ---------------------------------------------------------------------------
# G — the worker loop invokes ONLY process_email_outbox, never
# maybe_run_daily/automation_loop (both live in daily_jobs.py, out of scope).
# ---------------------------------------------------------------------------

def test_g_worker_loop_invokes_only_process_email_outbox():
    src_path = os.path.abspath(email_worker.__file__)
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    assert "automation_loop(" not in src
    assert "maybe_run_daily(" not in src
    assert "process_email_outbox(" in src

    calls = []

    async def fake_process(db):
        calls.append(db)
        email_worker._shutdown.set()
        return {"sent": 0, "failed": 0}

    email_worker._shutdown.clear()
    try:
        with patch.object(email_service, "process_email_outbox", fake_process):
            asyncio.run(email_worker.run())
    finally:
        email_worker._shutdown.clear()
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# H — docker-compose's email-worker service exposes no port and runs exactly
# one worker command (no replicas/scaling).
# ---------------------------------------------------------------------------

def test_h_docker_compose_email_worker_has_no_port_and_single_command():
    compose_path = os.path.join(REPO_ROOT, "docker-compose.yml")
    with open(compose_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    service = data["services"]["email-worker"]
    assert "ports" not in service
    assert service.get("command") == ["python", "email_worker.py"]
    assert "replicas" not in (service.get("deploy") or {})
