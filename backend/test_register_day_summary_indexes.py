"""Performance pass, 2026-10-19 — _register_day_summary (Register Hub's
day summary, polled every 90s by every open Register screen) runs a
payment_ledger query filtering type + a created_at range, and a bookings
query filtering/sorting by paid_at, with no supporting index for either
field. Fine at today's volume; a query with no usable index running every
90 seconds on every open Register screen is real cost at 10x the booking
volume. These two indexes are added to the startup() perf_indexes loop —
best-effort (a missing one logs a warning, never fails startup), so this
just confirms they actually land, not that startup fails without them.

Disposable tag TEST_REGISTER_DAY_SUMMARY_INDEXES (nothing is written —
this only reads index_information() off the shared test database that
_test_loop.py's module-level `run(server.startup())` already populated).
"""
import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run


def _index_key_sets(info: dict) -> set:
    return {tuple(spec["key"]) for spec in info.values()}


def test_bookings_has_a_paid_at_index():
    info = run(server.db.bookings.index_information())
    assert (("paid_at", 1),) in _index_key_sets(info), \
        f"expected a paid_at index on bookings, found: {list(info.keys())}"


def test_payment_ledger_has_a_type_created_at_index():
    info = run(server.db.payment_ledger.index_information())
    assert (("type", 1), ("created_at", 1)) in _index_key_sets(info), \
        f"expected a (type, created_at) index on payment_ledger, found: {list(info.keys())}"
