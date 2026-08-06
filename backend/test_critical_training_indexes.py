"""Release-gate follow-up — mandatory verification for the three MongoDB
indexes that actually enforce training-session draft/completion
correctness (training_session_drafts' unique partial draft-occurrence
index + its unique id index, and training_session_log's unique id index).

Unlike the best-effort perf_indexes loop in startup() (log a warning, keep
starting — fine for pure query-speed indexes), these three each back a real
invariant application code depends on being true — see
CriticalIndexError's docstring in server.py. A missing or misconfigured
one must fail startup outright, not silently continue.

Tests 1-7 below exercise _ensure_critical_training_indexes /
_critical_index_matches directly against disposable scratch databases (a
second, throwaway AsyncIOMotorClient database, never the shared test
database _test_env.py manages) so each scenario (missing index, wrong
keys, wrong uniqueness, wrong partial filter, a create_index that throws)
can be constructed precisely without disturbing anything else in the
suite. server.db is temporarily monkeypatched to point at the scratch
database for the duration of each call and restored in `finally` — the
same pattern already used elsewhere in this suite for scoped monkeypatches.

Tests 8-9 don't add new coverage of already-well-tested behavior; they
re-run and cite the EXISTING tests that already prove "two concurrent
initial draft starts still produce one draft"
(test_training_session_workspace.py::test_two_concurrent_starts_never_create_two_drafts)
and "completed/reopened session behavior is unchanged"
(test_session_completion_hardening.py::test_reopen_completed_session_is_audited_and_allows_recompletion
and friends) — this change touches only startup-time index verification,
never _get_or_create_session_draft or reopen_training_session themselves,
so duplicating that coverage here would be redundant. Both are re-run as
part of this file's own verification pass and cited by name in the
release-gate report instead.
"""
import uuid

import motor.motor_asyncio as _motor_asyncio
import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

SCRATCH_DB_PREFIX = "sit_happens_test_critical_index_scratch_"


def _scratch_db():
    """A brand-new, disposable database (name includes 'test' so it would
    also pass _test_env.py's own safety assertion if ever reused there,
    though this file manages its own lifecycle independently)."""
    scratch_client = _motor_asyncio.AsyncIOMotorClient("mongodb://127.0.0.1:27017")
    name = f"{SCRATCH_DB_PREFIX}{uuid.uuid4().hex[:10]}"
    return scratch_client, scratch_client[name]


def _swap_db(scratch):
    orig = server.db
    server.db = scratch
    return orig


async def _drop(scratch_client, name):
    await scratch_client.drop_database(name)
    scratch_client.close()


# ---------------------------------------------------------------------------
# 1. Startup succeeds when all critical indexes exist correctly.
# ---------------------------------------------------------------------------

def test_startup_succeeds_when_critical_indexes_already_correct():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        # Pre-create all three, correctly, under the SAME explicit names
        # the app itself uses — the straightforward "already set up right"
        # case.
        run(scratch.training_session_drafts.create_index(
            [("enrollment_id", 1), ("occurrence_date", 1), ("session_label", 1)],
            unique=True, partialFilterExpression={"status": "draft"},
            name=server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME,
        ))
        run(scratch.training_session_drafts.create_index([("id", 1)], unique=True, name=server.TSD_ID_UNIQUE_INDEX_NAME))
        run(scratch.training_session_log.create_index([("id", 1)], unique=True, name=server.TSL_ID_UNIQUE_INDEX_NAME))

        run(server._ensure_critical_training_indexes())  # must not raise
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


def test_startup_succeeds_when_correct_index_exists_under_an_older_auto_generated_name():
    """The real-world case this whole design exists for: an index created
    before this pass (or by any code that didn't pass an explicit name)
    under Mongo's own default name still satisfies verification — renaming
    it is neither required nor attempted."""
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        run(scratch.training_session_drafts.create_index(
            [("enrollment_id", 1), ("occurrence_date", 1), ("session_label", 1)],
            unique=True, partialFilterExpression={"status": "draft"},
        ))  # no explicit name -> Mongo auto-generates one
        run(scratch.training_session_drafts.create_index([("id", 1)], unique=True))
        run(scratch.training_session_log.create_index([("id", 1)], unique=True))

        run(server._ensure_critical_training_indexes())  # must not raise

        after = run(scratch.training_session_drafts.index_information())
        assert server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME not in after  # never renamed
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


# ---------------------------------------------------------------------------
# 2. Startup creates a missing critical index.
# ---------------------------------------------------------------------------

def test_startup_creates_missing_critical_indexes():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        before = run(scratch.training_session_drafts.index_information())
        assert server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME not in before

        run(server._ensure_critical_training_indexes())  # must not raise, must create

        after_drafts = run(scratch.training_session_drafts.index_information())
        after_log = run(scratch.training_session_log.index_information())
        assert after_drafts[server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME]["unique"] is True
        assert after_drafts[server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME]["partialFilterExpression"] == {"status": "draft"}
        assert after_drafts[server.TSD_ID_UNIQUE_INDEX_NAME]["unique"] is True
        assert after_log[server.TSL_ID_UNIQUE_INDEX_NAME]["unique"] is True
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


# ---------------------------------------------------------------------------
# 3. Startup fails when critical index creation throws an error (and no
#    equivalent index exists under any name to fall back on).
# ---------------------------------------------------------------------------

def test_startup_fails_when_index_creation_throws_and_nothing_else_covers_it():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    orig_create_index = _motor_asyncio.AsyncIOMotorCollection.create_index

    async def _always_raise(self, *args, **kwargs):
        if self.name == "training_session_drafts" and kwargs.get("name") == server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME:
            raise RuntimeError("simulated create_index failure")
        return await orig_create_index(self, *args, **kwargs)

    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        _motor_asyncio.AsyncIOMotorCollection.create_index = _always_raise
        with pytest.raises(server.CriticalIndexError):
            run(server._ensure_critical_training_indexes())
    finally:
        _motor_asyncio.AsyncIOMotorCollection.create_index = orig_create_index
        server.db = orig
        run(_drop(scratch_client, scratch.name))


# ---------------------------------------------------------------------------
# 4. Startup fails when an index with the expected name has the wrong keys.
# ---------------------------------------------------------------------------

def test_startup_fails_when_expected_name_has_wrong_keys():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        # Wrong key entirely (just dog_id) under the exact expected name.
        run(scratch.training_session_drafts.create_index(
            [("dog_id", 1)], unique=True, partialFilterExpression={"status": "draft"},
            name=server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME,
        ))
        with pytest.raises(server.CriticalIndexError):
            run(server._ensure_critical_training_indexes())
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


def test_startup_fails_when_expected_name_has_wrong_key_order():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        # Right fields, wrong order.
        run(scratch.training_session_drafts.create_index(
            [("occurrence_date", 1), ("enrollment_id", 1), ("session_label", 1)],
            unique=True, partialFilterExpression={"status": "draft"},
            name=server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME,
        ))
        with pytest.raises(server.CriticalIndexError):
            run(server._ensure_critical_training_indexes())
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


# ---------------------------------------------------------------------------
# 5. Startup fails when `unique` is missing.
# ---------------------------------------------------------------------------

def test_startup_fails_when_unique_is_missing():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        run(scratch.training_session_drafts.create_index(
            [("enrollment_id", 1), ("occurrence_date", 1), ("session_label", 1)],
            partialFilterExpression={"status": "draft"},  # no unique=True
            name=server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME,
        ))
        with pytest.raises(server.CriticalIndexError):
            run(server._ensure_critical_training_indexes())
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


# ---------------------------------------------------------------------------
# 6. Startup fails when the partial filter is incorrect.
# ---------------------------------------------------------------------------

def test_startup_fails_when_partial_filter_is_wrong():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        run(scratch.training_session_drafts.create_index(
            [("enrollment_id", 1), ("occurrence_date", 1), ("session_label", 1)],
            unique=True, partialFilterExpression={"status": "completed"},  # wrong value
            name=server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME,
        ))
        with pytest.raises(server.CriticalIndexError):
            run(server._ensure_critical_training_indexes())
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


def test_startup_fails_when_partial_filter_is_missing_entirely():
    scratch_client, scratch = _scratch_db()
    orig = _swap_db(scratch)
    try:
        run(scratch.training_session_drafts.insert_one({"id": "seed"}))
        run(scratch.training_session_log.insert_one({"id": "seed"}))
        run(scratch.training_session_drafts.create_index(
            [("enrollment_id", 1), ("occurrence_date", 1), ("session_label", 1)],
            unique=True,  # fully unique, no partial filter at all
            name=server.TSD_DRAFT_OCCURRENCE_UNIQUE_INDEX_NAME,
        ))
        with pytest.raises(server.CriticalIndexError):
            run(server._ensure_critical_training_indexes())
    finally:
        server.db = orig
        run(_drop(scratch_client, scratch.name))


# ---------------------------------------------------------------------------
# 7. An optional performance-index failure remains warning-only — proven
#    against the app's REAL startup() sequence, not a re-implementation of
#    its try/except.
# ---------------------------------------------------------------------------

def test_optional_performance_index_failure_is_warning_only_in_real_startup():
    """startup() already ran once at process import (_test_loop.py) — every
    create_index call in it is idempotent, so calling it again here is
    safe. One specific OPTIONAL index's create_index is monkeypatched to
    always throw; startup() must still complete without raising, and the
    three CRITICAL training indexes must still verify correctly afterward
    (proving the one injected failure was contained to its own index, not
    silently masking a real critical-index problem)."""
    orig_create_index = _motor_asyncio.AsyncIOMotorCollection.create_index

    async def _fail_one_optional_index(self, *args, **kwargs):
        if self.name == "photography_gallery" and args and args[0] == "sort_order":
            raise RuntimeError("simulated optional index failure")
        return await orig_create_index(self, *args, **kwargs)

    try:
        _motor_asyncio.AsyncIOMotorCollection.create_index = _fail_one_optional_index
        run(server.startup())  # must not raise
    finally:
        _motor_asyncio.AsyncIOMotorCollection.create_index = orig_create_index

    # The three critical indexes must still be genuinely correct against
    # the REAL shared test database afterward.
    run(server._ensure_critical_training_indexes())  # must not raise


# Requirements 8 ("two concurrent initial draft starts still produce one
# draft") and 9 ("completed and reopened session behavior remains
# unchanged") are deliberately NOT duplicated here — see this file's module
# docstring. They are proven by re-running, unchanged:
#   test_training_session_workspace.py::test_two_concurrent_starts_never_create_two_drafts
#   test_session_completion_hardening.py::test_reopen_completed_session_is_audited_and_allows_recompletion
#   test_session_completion_hardening.py::test_reopen_requires_a_reason_and_is_rejected_for_a_non_completed_draft
#   test_session_completion_hardening.py::test_only_admin_and_permitted_staff_can_reopen_front_desk_cannot
# as part of this change's full-suite verification pass, cited by name in
# the release-gate report.
