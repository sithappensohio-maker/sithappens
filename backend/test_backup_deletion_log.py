"""A merge restore does not bring back a row the owner hard-deleted after the backup was taken.

Every hard delete of a booking, a payment or a retail sale writes an entry to deleted_records
(domains/backup/deletion_log.py) before it deletes. A merge restore skips a backed-up row whose
deletion is logged after the backup's exported_at (domains/backup/rules.py: merge_skips_logged_deletion).
A row never deleted, a row deleted before the backup, and a soft delete (deleted_at) keep their
existing merge behaviour. Disposable tag TEST_DELETION_LOG.
"""
import pathlib
import re
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from domains.backup import rules as backup_rules
from _test_loop import run

TAG = "TEST_DELETION_LOG"
BACKUP_AT = "2021-01-01T00:00:00+00:00"
ADMIN = {"id": "deletion-log-admin", "role": "admin", "name": "Deletion Log QA", "email": "deletion-log@test"}
BACKEND = pathlib.Path(__file__).resolve().parent


@pytest.fixture(autouse=True)
def _snapshots_in_tmp(tmp_path, monkeypatch):
    """The endpoint test writes a full safety snapshot first; keep it out of the shared backup folder."""
    monkeypatch.setattr(server, "BACKUP_ROOT", str(tmp_path))


def _id(prefix):
    return f"{TAG}-{prefix}-{uuid.uuid4().hex[:8]}"


def _merge(collections, backup_at=BACKUP_AT):
    summary, _kept = run(server._restore_collections(collections, "merge", backup_at=backup_at))
    return summary


def _log(collection, record_id, deleted_at):
    """A deletion entry as the delete paths write it."""
    run(server.db.deleted_records.insert_one({
        "id": f"{TAG}-log-{uuid.uuid4().hex[:8]}", "collection": collection,
        "record_id": record_id, "deleted_at": deleted_at, "tag": TAG,
    }))


def _row(coll, _id_):
    return run(getattr(server.db, coll).find_one({"id": _id_}, {"_id": 0}))


def _booking(bid):
    return {"id": bid, "dog_id": f"{TAG}-dog", "client_id": f"{TAG}-client", "service_type": "daycare",
            "date": "2020-06-01", "status": "completed", "notes": "from the backup", "tag": TAG}


def _sale(sid):
    return {"id": sid, "date": "2020-06-01", "amount": 12.5, "payment_method": "cash", "tag": TAG,
            "source_kind": "register"}


def teardown_module():
    for coll in ("bookings", "retail_sales", "payments", "clients"):
        run(getattr(server.db, coll).delete_many({"tag": TAG}))
    run(server.db.deleted_records.delete_many({"tag": TAG}))


# ───────────── the merge rule (pure) ─────────────

def test_the_skip_rule_leaves_out_a_row_deleted_after_the_backup_only():
    skip = backup_rules.merge_skips_logged_deletion
    assert skip(["2021-06-01T00:00:00+00:00"], BACKUP_AT) is True, "deleted after the backup"
    assert skip(["2020-06-01T00:00:00+00:00"], BACKUP_AT) is False, "deleted before the backup"
    assert skip(["2021-01-01T00:00:00+00:00"], BACKUP_AT) is True, "same instant: skip, never resurrect"
    assert skip([], BACKUP_AT) is False, "no logged deletion, nothing to skip"


def test_the_skip_rule_skips_every_logged_deletion_when_the_backup_has_no_time_or_the_stamp_is_unreadable():
    skip = backup_rules.merge_skips_logged_deletion
    assert skip(["2019-01-01T00:00:00+00:00"], None) is True
    assert skip(["2019-01-01T00:00:00+00:00"], "not a time") is True
    assert skip(["not a time"], BACKUP_AT) is True
    assert skip([None], BACKUP_AT) is True


def test_the_skip_rule_reads_a_naive_or_z_suffixed_stamp_as_utc():
    skip = backup_rules.merge_skips_logged_deletion
    assert skip(["2021-06-01T00:00:00"], "2021-01-01T00:00:00Z") is True
    assert skip(["2020-06-01T00:00:00Z"], "2021-01-01T00:00:00+00:00") is False


# ───────────── the merge restore ─────────────

def test_a_merge_does_not_restore_a_booking_logged_as_deleted_after_the_backup():
    bid = _id("booking")
    _log("bookings", bid, "2021-06-01T00:00:00+00:00")
    summary = _merge({"bookings": [_booking(bid)]})
    assert _row("bookings", bid) is None, "the owner removed this visit after the backup; a merge must not bring it back"
    assert summary["bookings"]["skipped_deleted"] == 1


def test_a_merge_restores_a_row_that_was_never_deleted():
    bid = _id("booking")
    summary = _merge({"bookings": [_booking(bid)]})
    assert _row("bookings", bid)["notes"] == "from the backup"
    assert summary["bookings"]["upserted"] == 1
    assert "skipped_deleted" not in summary["bookings"]


def test_a_merge_restores_a_row_deleted_before_the_backup_was_taken():
    bid = _id("booking")
    _log("bookings", bid, "2019-03-01T00:00:00+00:00")
    _merge({"bookings": [_booking(bid)]})
    assert _row("bookings", bid) is not None, "the backup was taken after that deletion, so the row belongs in it"


def test_a_merge_with_no_backup_time_skips_every_logged_deletion():
    bid = _id("booking")
    _log("bookings", bid, "2019-03-01T00:00:00+00:00")
    summary = _merge({"bookings": [_booking(bid)]}, backup_at=None)
    assert _row("bookings", bid) is None
    assert summary["bookings"]["skipped_deleted"] == 1


def test_a_hard_delete_through_the_log_is_not_restored_by_a_merge():
    from domains.backup import deletion_log

    bid = _id("booking")
    run(server.db.bookings.insert_one(_booking(bid)))
    assert run(deletion_log.delete_one(server.db, "bookings", {"id": bid})) == 1
    assert _row("bookings", bid) is None
    assert run(server.db.deleted_records.count_documents({"collection": "bookings", "record_id": bid})) == 1
    _merge({"bookings": [_booking(bid)]})
    assert _row("bookings", bid) is None


def test_a_bulk_hard_delete_through_the_log_skips_only_the_removed_sales():
    from domains.backup import deletion_log

    gone_a, gone_b, kept = _id("sale"), _id("sale"), _id("sale")
    run(server.db.retail_sales.insert_many([_sale(gone_a), _sale(gone_b), _sale(kept)]))
    assert run(deletion_log.delete_many(server.db, "retail_sales", {"id": {"$in": [gone_a, gone_b]}})) == 2
    summary = _merge({"retail_sales": [_sale(gone_a), _sale(gone_b), _sale(kept)]})
    assert _row("retail_sales", gone_a) is None and _row("retail_sales", gone_b) is None
    assert _row("retail_sales", kept)["amount"] == 12.5
    assert summary["retail_sales"]["skipped_deleted"] == 2


def test_a_soft_deleted_client_keeps_the_existing_merge_behaviour():
    """Soft deletes (deleted_at) need no log: a backup taken before the archive carries no deleted_at, and
    a merge only writes the fields a backup row carries, so the live archive stays and the content updates."""
    cid = _id("client")
    stamp = "2026-09-01T00:00:00+00:00"
    run(server.db.clients.insert_one({"id": cid, "name": "Archived live", "email": f"{cid}@example.com",
                                      "deleted_at": stamp, "active": False, "tag": TAG}))
    summary = _merge({"clients": [{"id": cid, "name": "Backup name", "email": f"{cid}@example.com", "tag": TAG}]})
    row = _row("clients", cid)
    assert row["deleted_at"] == stamp
    assert row["name"] == "Backup name"
    assert summary["clients"]["upserted"] == 1
    assert "skipped_deleted" not in summary["clients"]
    assert run(server.db.deleted_records.count_documents({"record_id": cid})) == 0


def test_the_restore_endpoint_passes_the_backup_time_to_the_merge():
    bid = _id("booking")
    _log("bookings", bid, "2021-06-01T00:00:00+00:00")
    body = server.BackupRestoreIn(version=server.BACKUP_VERSION, collections={"bookings": [_booking(bid)]},
                                  mode="merge", exported_at=BACKUP_AT)
    result = run(server.backup_restore(body=body, _=ADMIN))
    assert _row("bookings", bid) is None
    assert result["summary"]["bookings"]["skipped_deleted"] == 1


# ───────────── the delete paths ─────────────

def test_no_hard_delete_of_a_booking_payment_or_sale_bypasses_the_deletion_log():
    """Every hard delete of bookings, payments or retail_sales goes through domains/backup/deletion_log.py.
    The one move that is not a deletion (a finished visit moved to bookings_archive, which keeps the row)
    is marked on its line."""
    pattern = re.compile(
        r"""\b_?db(?:\.(?:bookings|payments|retail_sales)|\[\s*["'](?:bookings|payments|retail_sales)["']\s*\])"""
        r"""\.(?:delete_one|delete_many|find_one_and_delete)\b""")
    offenders = []
    for p in BACKEND.rglob("*.py"):
        parts = set(p.parts)
        if parts & {".venv", "venv", ".venv_local_test", ".venv_ci", "tests", "scripts", "__pycache__", "migrations"}:
            continue
        if p.name.startswith("test_") or p.name.startswith("_test") or p.name in ("reset_db.py", "deletion_log.py"):
            continue
        for n, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
            if pattern.search(line) and "deletion-log: moved, not deleted" not in line:
                offenders.append(f"{p.relative_to(BACKEND)}:{n}")
    assert not offenders, f"hard deletes that skip the deletion log: {offenders}"
