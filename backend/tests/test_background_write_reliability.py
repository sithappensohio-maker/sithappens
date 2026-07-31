"""Reliability regression for _spawn_background_db_write.

Root cause: under this environment's Motor 3.3.1 / Python 3.12 combination,
`db.<collection>.insert_one(...)` returns an already-scheduled `asyncio.Future`
instead of a plain coroutine. `asyncio.create_task()` only accepts a
coroutine and raised `TypeError: a coroutine was expected, got <Future ...>`
on every call, silently breaking the audit-log background write on every
authenticated admin/employee request. The fix (see server.py's
`_spawn_background_db_write`) switched to `asyncio.ensure_future()`, which
accepts either shape without double-wrapping.

Same convention as test_email_worker.py: no pytest-asyncio plugin is
installed in this environment, so async server code is driven with a plain
`asyncio.run(...)` wrapper inside ordinary sync test functions. Each test
opens its OWN fresh AsyncIOMotorClient inside that same asyncio.run() call
and closes it before returning — Motor's client binds to the event loop of
its first operation, so reusing one client (or server.py's own module-level
`server.db`) across multiple independent asyncio.run() calls breaks with
"Event loop is closed" once the first loop is torn down.
"""
import asyncio
import gc
import os
import sys
import time
import uuid

import requests
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402  (only for _spawn_background_db_write / _BACKGROUND_DB_TASKS — never for server.db)

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL", "http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"
DB_NAME = os.environ.get("DB_NAME", "sit_happens")


def _admin_headers():
    r = requests.post(f"{API}/auth/login",
                       json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _probe_name():
    return f"_bg_write_probe_{uuid.uuid4().hex[:8]}"


async def _wait_for_drain(timeout_iters=50):
    for _ in range(timeout_iters):
        if not server._BACKGROUND_DB_TASKS:
            return
        await asyncio.sleep(0.05)


# ── 1 & 2. Motor Futures are accepted without TypeError, and the write completes ──

def test_ensure_future_accepts_a_real_motor_future_and_write_lands():
    coll_name = _probe_name()

    async def _run():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            coll = mc[DB_NAME][coll_name]
            awaitable = coll.insert_one({"probe": "future-shape"})
            # This is the exact shape that broke create_task() in production.
            assert asyncio.isfuture(awaitable), "expected this Motor/Python combo to return a Future (see module docstring)"
            server._spawn_background_db_write(awaitable)  # must not raise
            await _wait_for_drain()
            return await coll.count_documents({"probe": "future-shape"})
        finally:
            mc.close()

    count = asyncio.run(_run())
    assert count == 1


def test_ensure_future_accepts_a_plain_coroutine_too():
    """Guard against a future Motor upgrade reverting to plain coroutines —
    the helper must keep working either way, never double-wrapping."""
    async def _run():
        results = []

        async def _noop_coro():
            results.append("ran")

        coro = _noop_coro()
        assert asyncio.iscoroutine(coro)
        server._spawn_background_db_write(coro)
        await _wait_for_drain()
        return results

    results = asyncio.run(_run())
    assert results == ["ran"]


# ── 3. A failed background write is logged, never raised, never reverses anything ──

def test_failed_background_write_is_logged_not_raised(caplog):
    async def _run():
        async def _boom():
            raise RuntimeError("simulated background write failure")

        # Must not raise out of this call — the caller (e.g. the audit
        # middleware) has already returned its response to the client by
        # the time this runs.
        server._spawn_background_db_write(_boom())
        await _wait_for_drain()

    with caplog.at_level("ERROR"):
        asyncio.run(_run())
    assert any("background best-effort DB write failed" in r.message for r in caplog.records)


# ── 8. No unhandled task exceptions appear in logs ──

def test_no_unhandled_task_exception_warnings(caplog):
    """asyncio's default exception handler logs 'Task exception was never
    retrieved' when a Task's exception is never observed (typically at GC
    time). The done-callback in _spawn_background_db_write always calls
    `done.result()`, so that warning must never fire for tasks spawned
    through it."""
    async def _run():
        async def _boom():
            raise RuntimeError("simulated failure for unhandled-exception check")

        server._spawn_background_db_write(_boom())
        await _wait_for_drain()
        gc.collect()
        await asyncio.sleep(0.1)

    with caplog.at_level("WARNING"):
        asyncio.run(_run())
    assert not any("exception was never retrieved" in r.message for r in caplog.records)


# ── 9. Shutdown does not silently drop an in-flight background write ──

def test_shutdown_drain_logic_waits_for_pending_writes():
    """Exercises the SAME asyncio.wait(...) drain the shutdown handler runs."""
    coll_name = _probe_name()

    async def _run():
        mc = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            coll = mc[DB_NAME][coll_name]

            async def _slow_write():
                await asyncio.sleep(0.2)
                await coll.insert_one({"probe": "shutdown-drain"})

            server._spawn_background_db_write(_slow_write())
            assert len(server._BACKGROUND_DB_TASKS) >= 1

            pending = list(server._BACKGROUND_DB_TASKS)
            done, still_pending = await asyncio.wait(pending, timeout=5.0)
            assert not still_pending, "background write should finish well within the 5s shutdown drain window"
            return await coll.count_documents({"probe": "shutdown-drain"})
        finally:
            mc.close()

    count = asyncio.run(_run())
    assert count == 1


# ── end-to-end: a real authenticated mutation still produces an audit row ──

def test_audit_log_write_survives_the_fix():
    """Same correlation approach as test_audit_log.py::test_audit_log_captures_writes
    — a POST /api/clients create has no id in its own URL path, so
    _audit_record_id_from_path can't tag it; the existing convention checks
    for the action name via GET /api/audit-log instead of querying Mongo by
    record_id directly."""
    suffix = uuid.uuid4().hex[:8]
    headers = _admin_headers()
    r = requests.post(f"{API}/clients", headers=headers,
                       json={"name": f"BGW-{suffix}", "email": f"bgw-{suffix}@e.com"}, timeout=15)
    assert r.status_code == 200, r.text

    for _ in range(20):
        log_all = requests.get(f"{API}/audit-log?limit=50", headers=headers, timeout=15).json()
        actions = {e["action"] for e in log_all["entries"]}
        if "client_created" in actions or any("client" in a for a in actions):
            return
        time.sleep(0.25)
    raise AssertionError("expected a client_created audit_log row for the POST /clients mutation")
