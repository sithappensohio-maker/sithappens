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

_loop = asyncio.new_event_loop()
asyncio.set_event_loop(_loop)


def run(coro):
    return _loop.run_until_complete(coro)
