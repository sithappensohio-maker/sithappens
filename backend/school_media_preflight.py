"""Is the School media directory actually writable?

`/api/health` answers "is the process up and is Mongo reachable". It has never
answered "can this container store a lesson image", and those are different
questions: production ran green for weeks with a media directory the backend
could not write to, and the first person to find out was an owner uploading a
course and getting a generic 500.

So this is the missing check. It is deliberately a *probe*, not an inspection
of permission bits — ownership, mode, SELinux labels, read-only mounts, a full
disk and a missing bind mount all fail differently and all matter equally. The
only honest test is to write a real file and read it back.

Run standalone during deployment:

    docker compose exec -T backend python school_media_preflight.py

Exits 0 when storage is usable and 1 with an explanation when it is not, so a
deploy script can stop rather than hand the problem to whoever uploads next.
"""
import os
import sys
import uuid
from pathlib import Path

# Mirrors server.py's resolution so this stays runnable WITHOUT importing
# server.py — a deploy-time check must not need JWT_SECRET or a live Mongo.
DEFAULT_ROOT = Path(__file__).resolve().parent / "school_media"


def school_media_root() -> Path:
    return Path(os.environ.get("SCHOOL_MEDIA_ROOT", str(DEFAULT_ROOT)))


def check_school_media_writable(root=None):
    """Return (ok, detail). `detail` is for operators and logs, not clients.

    The probe file is uniquely named and always removed, including when the
    read-back fails, so a half-finished check never leaves litter behind for
    the media library to trip over.
    """
    root = Path(root) if root is not None else school_media_root()
    probe = None
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return False, f"cannot create {root}: {e.__class__.__name__}: {e}"
    try:
        probe = root / f".preflight-{uuid.uuid4().hex}.tmp"
        payload = b"school-media-preflight"
        probe.write_bytes(payload)
        # Writing can appear to succeed on a broken mount; only a read-back
        # proves the bytes are really there.
        if probe.read_bytes() != payload:
            return False, f"wrote to {root} but read back different bytes"
    except OSError as e:
        return False, f"cannot write inside {root}: {e.__class__.__name__}: {e}"
    finally:
        try:
            if probe is not None:
                probe.unlink(missing_ok=True)
        except OSError:
            pass
    return True, f"{root} is writable"


def main() -> int:
    ok, detail = check_school_media_writable()
    if ok:
        print(f"School media storage OK — {detail}")
        return 0
    print(f"School media storage NOT WRITABLE — {detail}", file=sys.stderr)
    print("The backend cannot store lesson images, dog photos or course media.",
          file=sys.stderr)
    print("On an SELinux host (Fedora/Bazzite) a bind mount needs the :Z suffix "
          "in docker-compose.yml so the container may write to it.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
