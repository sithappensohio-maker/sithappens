#!/usr/bin/env python3
"""Static release gate for persistent/verified in-app backups."""
from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parents[1]
server = (ROOT / "backend/server.py").read_text(encoding="utf-8")
compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
settings = (ROOT / "frontend/src/screens/Settings.jsx").read_text(encoding="utf-8")

checks = {
    "backend host mount": "- ./backups:/app/backups" in compose,
    "persistent root env": 'BACKUP_ROOT: "/app/backups"' in compose,
    "safe path confinement": "def _safe_backup_dir" in server and "os.path.commonpath" in server,
    "shared worker lease": "def _acquire_backup_lease" in server and "DuplicateKeyError" in server,
    "scheduled daily de-duplication": "A verified scheduled backup already completed today" in server,
    "uncapped collection export": ".to_list(50000)" not in server[
        server.index("async def _build_backup_payload"):server.index("def _seconds_until_next_run")
    ],
    "atomic backup publish": "os.replace(temp_path, full_path)" in server,
    "checksum readback": "Backup checksum verification failed after disk write" in server,
    "restore safety snapshot gate": server.count("Restore stopped because the safety snapshot could not be verified") == 2,
    "settings explains host path": "This maps to the host's" in settings,
    "settings exposes verification": "VERIFIED" in settings,
}

ast.parse(server)
failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
if failed:
    raise SystemExit(f"Backup integrity audit failed: {', '.join(failed)}")
print(f"PASS  {len(checks)} backup integrity checks")
