#!/usr/bin/env python3
"""Static regression checks for the non-destructive security hardening pass."""
from pathlib import Path
import ast
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
server = (ROOT / "backend/server.py").read_text()

checks = {
    "shared auth rate-limit collection": "db.auth_rate_limits.find_one_and_update" in server,
    "rate-limit TTL index": '(db.auth_rate_limits, "expires_at", {"expireAfterSeconds": 0})' in server,
    "token version in JWT": '"ver": int(token_version or 0)' in server,
    "token version checked": 'Session expired. Please sign in again.' in server,
    "temporary-password API gate": 'Temporary password must be changed before continuing.' in server,
    "password changes invalidate sessions": '"$inc": {"token_version": 1}' in server,
    "safe CORS helper": "def _cors_origins()" in server and 'allow_origins=_cors' in server,
    "no wildcard CORS default": 'CORS_ORIGINS:-*' not in (ROOT / "docker-compose.yml").read_text(),
    "first-run default admin refused": "Refusing to create the first admin with a default password" in server,
    "existing admin fallback": 'existing = await db.users.find_one({"role": "admin"})' in server,
    "security response headers": "security_headers_middleware" in server,
    "pre-update backup gate": "Creating required pre-update backup" in (ROOT / "update.sh").read_text(),
}

# Parse every backend file.
for f in (ROOT / "backend").rglob("*.py"):
    ast.parse(f.read_text(), filename=str(f))

# No duplicate API methods/routes.
routes = {}
for method, path in re.findall(r'@(?:api|app)\.(get|post|put|patch|delete)\("([^"]+)"', server):
    key = (method.upper(), path)
    if key in routes:
        raise AssertionError(f"duplicate route: {key}")
    routes[key] = True

# Every executable HTML renderer must pass through the sanitizer.
unsafe = []
for f in (ROOT / "frontend/src").rglob("*.jsx"):
    text = f.read_text()
    for line_no, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith(("//", "*")):
            continue
        if "dangerouslySetInnerHTML" in line and "sanitizeHtml" not in line:
            # Multiline object is allowed only when the following lines call sanitizeHtml.
            nearby = "\n".join(text.splitlines()[line_no-1:line_no+4])
            if "sanitizeHtml" not in nearby:
                unsafe.append(f"{f.relative_to(ROOT)}:{line_no}")
checks["HTML renderers sanitized"] = not unsafe
checks["rich text paste sanitized"] = 'onPaste={(e) =>' in (ROOT / "frontend/src/components/RichTextEditor.jsx").read_text()
checks["forced password UI present"] = (ROOT / "frontend/src/components/ForcedPasswordChange.jsx").exists()

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL"), name)
print(f"PASS parsed backend files; PASS {len(routes)} unique API routes")
if unsafe:
    print("Unsafe HTML locations:", *unsafe, sep="\n  ")
if failed:
    print("FAILED:", ", ".join(failed), file=sys.stderr)
    sys.exit(1)
