"""Shared asyncio event loop for this backend's ad hoc pytest files.

Each test file calls the async server.py functions directly (no
pytest-asyncio, no HTTP layer). Motor's AsyncIOMotorClient lazily binds to
whatever event loop is "current" the first time it's used, and that binding
sticks for the lifetime of the process — so if two test files each created
their own `asyncio.new_event_loop()`, running them in the same pytest
invocation would have the second file's DB calls fail with "the future
belongs to a different loop." Importing `run` from here instead (module
imports are cached, so the loop below is created exactly once per process)
lets any number of these test files share one pytest invocation safely.
"""
import asyncio

import server  # every test_*.py file already imports this first; re-importing
                # here is a cheap no-op against the cached module

_loop = asyncio.new_event_loop()
asyncio.set_event_loop(_loop)


def run(coro):
    return _loop.run_until_complete(coro)


# Calling server's functions directly (as every ad hoc test does) never
# goes through FastAPI's lifespan, so `@app.on_event("startup")`'s index
# creation never runs — including unique indexes several idempotency guards
# depend on (e.g. pos_sale_claims.idempotency_key, invoices.booking_ids).
# Against the old, long-lived shared dev database that was invisible: real
# `uvicorn` runs against it had already created every index, once, forever.
# Against the disposable database _test_env.py resets before each run (see
# its docstring), skipping this would silently drop that duplicate-
# prevention behavior. Runs exactly once per process (module import cache).
run(server.startup())
