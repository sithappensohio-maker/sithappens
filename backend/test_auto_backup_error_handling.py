"""Regression test for a bug caught live on production: a backup run that
fails early (e.g. a PermissionError writing the temp file, as happened on
the Bazzite host) must still record a clean "failed" run row — not crash
the exception handler itself.

`_run_auto_backup_once`'s except block referenced `media_archive_path`,
which is only ever assigned after the main JSON backup has already
gzipped successfully. A failure before that point meant the except block
raised its own UnboundLocalError instead of reporting the real error —
the scheduler log showed "auto-backup run failed" replaced by a confusing
second traceback, and (worse) nightly backups were silently not
happening at all until this was noticed.
"""
from unittest.mock import patch

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run


def test_a_permission_error_writing_the_temp_file_is_reported_cleanly(tmp_path):
    run(server._save_auto_backup_config({"path": str(tmp_path)}))
    real_gzip_open = __import__("gzip").open

    def _boom(path, mode="rb", *a, **kw):
        if mode == "wb":
            raise PermissionError(13, "Permission denied")
        return real_gzip_open(path, mode, *a, **kw)

    with patch("gzip.open", side_effect=_boom):
        result = run(server._run_auto_backup_once(trigger="test"))

    assert result["ok"] is False
    assert result["status"] == "failed"
    assert "PermissionError" in result["error"]
    # The lease is released in a `finally` either way, but confirm a second
    # run isn't blocked behind the first one's failure.
    result2 = run(server._run_auto_backup_once(trigger="test"))
    assert result2["ok"] is True
