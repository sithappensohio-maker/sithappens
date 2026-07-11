from pathlib import Path

root = Path(__file__).resolve().parents[1]
server = (root / 'backend/server.py').read_text()
dashboard = (root / 'frontend/src/screens/Dashboard.jsx').read_text()
auth = (root / 'frontend/src/lib/auth.js').read_text()
nginx = (root / 'frontend/nginx.conf').read_text()

checks = {
    'auth request single-flight cache': '_AUTH_USER_INFLIGHT' in server and 'await _load_auth_user(payload["sub"])' in server,
    'clients user rows are batch-loaded': 'user_by_client' in server and '{"client_id": {"$in": client_ids}}' in server,
    'dogs reused for setup badges': 'Reuse the dog batch already loaded above' in server,
    'audit writes no longer block response': '_spawn_background_db_write(db.audit_log.insert_one' in server,
    'duplicate audit query removed': server.count('rows = await db.audit_log.find(q, {"_id": 0}).sort("ts", -1)') == 1,
    'auth boot calls run in parallel': 'const [meRes, permRes] = await Promise.all' in auth,
    'dashboard polling reduced': 'intervalMs: 60_000' in dashboard,
    'duplicate pnl polling removed': 'Auto-refresh today\'s P&L every 30s' not in dashboard,
    'local bundle compression enabled': 'gzip on;' in nginx,
    'static public assets cached': 'max-age=2592000' in nginx,
    'slow API timing enabled': 'SLOW API %.1fms' in server,
}
failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(('PASS' if ok else 'FAIL') + ' - ' + name)
if failed:
    raise SystemExit('performance integrity check failed: ' + ', '.join(failed))
print(f'PASS - {len(checks)} performance checks')
