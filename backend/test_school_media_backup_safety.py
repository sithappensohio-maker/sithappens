"""Filesystem School-media disaster-recovery safety guards.

These are deliberately pure helper tests: they validate that the media restore
path cannot escape BACKUP_ROOT and that tar extraction rejects traversal and
link/device members before the owner-only restore endpoint swaps directories.
"""
import io
import os
import tarfile

import pytest

import _test_env  # noqa: F401
import server


def _tar_with(name: str, *, symlink: bool = False):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        info = tarfile.TarInfo(name)
        if symlink:
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            tf.addfile(info)
        else:
            payload = b"school-media"
            info.size = len(payload)
            tf.addfile(info, io.BytesIO(payload))
    buf.seek(0)
    return tarfile.open(fileobj=buf, mode="r:gz"), buf


def test_school_media_tar_accepts_only_school_media_tree():
    tf, buf = _tar_with("school_media/checkpoints/clip.mp4")
    try:
        members = server._validated_school_media_members(tf)
        assert len(members) == 1
        assert members[0].name == "school_media/checkpoints/clip.mp4"
    finally:
        tf.close(); buf.close()


@pytest.mark.parametrize("name", [
    "../escape.txt",
    "school_media/../../escape.txt",
    "/school_media/absolute.txt",
    "some_other_root/file.txt",
])
def test_school_media_tar_rejects_path_escape(name):
    tf, buf = _tar_with(name)
    try:
        with pytest.raises(server.HTTPException) as exc:
            server._validated_school_media_members(tf)
        assert exc.value.status_code == 400
    finally:
        tf.close(); buf.close()


def test_school_media_tar_rejects_symlink():
    tf, buf = _tar_with("school_media/link", symlink=True)
    try:
        with pytest.raises(server.HTTPException) as exc:
            server._validated_school_media_members(tf)
        assert exc.value.status_code == 400
    finally:
        tf.close(); buf.close()


def test_school_media_archive_path_stays_inside_backup_root(tmp_path, monkeypatch):
    root = tmp_path / "backups"
    root.mkdir()
    monkeypatch.setattr(server, "BACKUP_ROOT", os.path.realpath(root))
    good = root / "sit-happens-school-media-test.tar.gz"
    good.write_bytes(b"archive")
    assert server._school_media_archive_path(good.name) == os.path.realpath(good)

    with pytest.raises(server.HTTPException):
        server._school_media_archive_path("../sit-happens-school-media-test.tar.gz")
    with pytest.raises(server.HTTPException):
        server._school_media_archive_path("other.tar.gz")


def test_school_media_file_path_never_serves_outside_media_root(tmp_path, monkeypatch):
    root = tmp_path / "school_media"
    root.mkdir()
    inside = root / "clip.mp4"
    inside.write_bytes(b"video")
    outside = tmp_path / "secret.txt"
    outside.write_text("do-not-serve")
    monkeypatch.setattr(server, "SCHOOL_MEDIA_ROOT", root.resolve())

    assert server._school_media_file_path({"storage_path": str(inside)}) == str(inside.resolve())
    assert server._school_media_file_path({"storage_path": str(outside)}) is None
    assert server._school_media_file_path({"storage_path": str(root)}) is None
    assert server._school_media_file_path({"storage_path": str(root / "missing.mp4")}) is None
