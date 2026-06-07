"""Sprint 110aj — backup/restore must capture every catalog + every piece
of per-dog progress so a `git pull` (or full re-deploy) never loses
homework templates, trophies, programs, credits, training sessions, etc."""
import os

import pytest
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


# Every collection that MUST appear in the backup so the user's manual
# customisation + every dog's progress survives a redeploy.
REQUIRED_COLLECTIONS = {
    # Core directory
    "clients", "dogs", "bookings", "incidents",
    "waiver_signatures", "client_files", "claim_tokens",
    # Catalog the admin curates by hand
    "settings", "app_settings", "services", "credit_packs",
    "homework_templates", "recurring_templates", "shift_templates",
    "programs", "trophies", "commands",
    # Per-dog progress / history
    "homework", "homework_media", "step_events",
    "dog_programs", "training_sessions",
    "awarded_trophies", "referrals",
    # Financial state
    "expenses", "retail_sales", "credit_lots", "credit_adjustments",
    "price_overrides", "payment_transactions",
    # Front-desk inbox & admin task state
    "quote_requests", "tasks", "task_dismissals",
    # Staff scheduling & clocked hours (drives payroll)
    "shifts", "time_clock_entries", "time_off_requests",
    # Tax tracker
    "tax_payments", "mileage_log",
    # Dog Trivia + Fact of the Day (Sprint 110bt)
    "trivia_questions", "trivia_attempts", "dog_facts",
    # Sprint 110by — admin email customization (template overrides + branding)
    "email_templates", "email_settings",
    # Sprint 110bx — homework auto-assign audit (per-enrollment notification trail)
    "notification_log",
    # Vaccine reminder dismissals (so restore doesn't re-fire stale alerts)
    "vaccine_dismissals",
}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_backup_export_contains_all_required_collections(admin_headers):
    r = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["version"] >= 3, f"backup version should be ≥3 · got {data['version']}"
    assert "collections" in data
    got = set(data["collections"].keys())
    missing = REQUIRED_COLLECTIONS - got
    assert not missing, f"backup missing required collections: {sorted(missing)}"


def test_backup_excludes_users_and_audit_logs(admin_headers):
    """Users go through a separate hash-aware migration, and audit-trail
    collections aren't needed for disaster-recovery. trivia_daily is also
    excluded — it's a 1-row daily cache that auto-regenerates.

    Sprint 110cd — `vaccine_dismissals` and `notification_log` moved INTO
    the backup (operator wants restore to preserve the audit trail + the
    "I already acked this vaccine alert" state)."""
    r = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60)
    assert r.status_code == 200
    cols = r.json()["collections"]
    for forbidden in (
        "users",
        "system_runs", "auto_backup_runs",
        "trivia_daily",
    ):
        assert forbidden not in cols, f"{forbidden} must not be in standard backup"


def test_backup_v3_app_settings_preserves_string_id(admin_headers):
    """app_settings is keyed by string `_id` (e.g. 'auto_backup',
    'quarterly_tax', 'trivia_rewards'). Backup must preserve those so
    restore can roundtrip them without losing config."""
    r = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60)
    docs = r.json()["collections"].get("app_settings", [])
    assert len(docs) > 0, "app_settings should have at least one row"
    for d in docs:
        assert isinstance(d.get("_id"), str), \
            f"app_settings doc missing string _id: {d}"


def test_backup_v3_contains_today_data(admin_headers):
    """Our session built up trivia questions + dog facts. Backup must include them."""
    r = requests.get(f"{BASE}/api/backup/export", headers=admin_headers, timeout=60)
    cols = r.json()["collections"]
    assert len(cols["trivia_questions"]) >= 21, \
        f"Expected ≥21 trivia questions in backup, got {len(cols['trivia_questions'])}"
    assert len(cols["dog_facts"]) >= 100, \
        f"Expected ≥100 dog facts in backup, got {len(cols['dog_facts'])}"


def test_backup_merge_restores_mileage_row(admin_headers):
    """End-to-end: log mileage → export → delete → restore → row is back."""
    r = requests.post(f"{BASE}/api/admin/mileage", headers=admin_headers,
                      json={"miles": 13.7, "purpose": "PYTEST-backup-roundtrip",
                            "destination": "Backup test"}, timeout=15)
    assert r.status_code == 200
    mid = r.json()["id"]

    payload = requests.get(f"{BASE}/api/backup/export",
                           headers=admin_headers, timeout=30).json()
    assert any(m.get("id") == mid for m in payload["collections"]["mileage_log"])

    requests.delete(f"{BASE}/api/admin/mileage/{mid}",
                    headers=admin_headers, timeout=15)

    restore_body = {
        "version": payload["version"],
        "exported_at": payload["exported_at"],
        "collections": {"mileage_log": payload["collections"]["mileage_log"]},
        "mode": "merge",
    }
    r = requests.post(f"{BASE}/api/backup/restore", headers=admin_headers,
                      json=restore_body, timeout=30)
    assert r.status_code == 200

    listed = requests.get(f"{BASE}/api/admin/mileage",
                          headers=admin_headers, timeout=15).json()["rows"]
    restored = [m for m in listed if m.get("id") == mid]
    assert restored and restored[0]["miles"] == 13.7

    requests.delete(f"{BASE}/api/admin/mileage/{mid}",
                    headers=admin_headers, timeout=15)


def test_restore_accepts_legacy_v1_backup(admin_headers):
    """A v1 snapshot (only 9 collections) must still restore without an
    'Unsupported backup version' 400 — older user backups must keep working."""
    legacy_payload = {
        "version": 1,
        "exported_at": "2026-01-01T00:00:00Z",
        "collections": {
            # Send empty arrays so we don't mutate real data
            "clients": [], "dogs": [], "bookings": [], "incidents": [],
            "homework": [], "waiver_signatures": [], "settings": [],
            "expenses": [], "retail_sales": [],
        },
        "mode": "merge",
    }
    r = requests.post(f"{BASE}/api/backup/restore", json=legacy_payload, headers=admin_headers, timeout=30)
    assert r.status_code == 200, f"legacy v1 backup rejected: {r.text}"
    assert r.json()["ok"] is True


def test_restore_rejects_future_version(admin_headers):
    """A backup from a NEWER server version should be politely rejected."""
    r = requests.post(
        f"{BASE}/api/backup/restore",
        json={"version": 99, "collections": {}, "mode": "merge"},
        headers=admin_headers,
        timeout=15,
    )
    assert r.status_code == 400


# ────────── Sprint 110cd · Email customization survives backup ──────────

def test_backup_roundtrips_email_template_override(admin_headers):
    """Custom subject/intro on an email template must survive an export →
    delete → restore cycle (operator's brand voice can't be lost)."""
    slug = "client_homework_assigned"
    pinned = "PYTEST · this subject must roundtrip"

    requests.put(f"{BASE}/api/admin/email-templates/{slug}",
                 headers=admin_headers,
                 json={"subject": pinned, "intro_html": "<p>pytest body</p>"},
                 timeout=15)

    payload = requests.get(f"{BASE}/api/backup/export",
                           headers=admin_headers, timeout=30).json()
    templates = payload["collections"].get("email_templates") or []
    ours = [t for t in templates if t.get("slug") == slug]
    assert ours and ours[0]["subject"] == pinned, "override missing from backup"

    # Reset, then restore
    requests.post(f"{BASE}/api/admin/email-templates/{slug}/reset",
                  headers=admin_headers, timeout=15)
    restore_body = {
        "version": payload["version"],
        "exported_at": payload["exported_at"],
        "collections": {"email_templates": ours},
        "mode": "merge",
    }
    r = requests.post(f"{BASE}/api/backup/restore",
                      headers=admin_headers, json=restore_body, timeout=30)
    assert r.status_code == 200, r.text

    rows = requests.get(f"{BASE}/api/admin/email-templates",
                        headers=admin_headers, timeout=15).json()
    row = next((t for t in rows if t["slug"] == slug), None)
    assert row and row["override"]["subject"] == pinned, "override didn't survive restore"

    # Cleanup
    requests.post(f"{BASE}/api/admin/email-templates/{slug}/reset",
                  headers=admin_headers, timeout=15)


def test_backup_roundtrips_email_settings_singleton(admin_headers):
    """The email_settings singleton (logo URL, brand colors, signature) must
    backup with its string `_id` intact so restore overwrites the right row
    instead of inserting a duplicate."""
    pinned_brand = "PYTEST Sit Happens"
    requests.put(f"{BASE}/api/admin/email-settings",
                 headers=admin_headers,
                 json={"brand_name": pinned_brand}, timeout=15)

    payload = requests.get(f"{BASE}/api/backup/export",
                           headers=admin_headers, timeout=30).json()
    rows = payload["collections"].get("email_settings") or []
    assert rows, "email_settings missing from backup"
    assert rows[0].get("_id") == "singleton", "singleton _id must be preserved"
    assert rows[0].get("brand_name") == pinned_brand

    # Reset, then restore singleton + verify it's back
    requests.put(f"{BASE}/api/admin/email-settings",
                 headers=admin_headers, json={"brand_name": "Sit Happens"}, timeout=15)

    restore_body = {
        "version": payload["version"],
        "exported_at": payload["exported_at"],
        "collections": {"email_settings": rows},
        "mode": "merge",
    }
    r = requests.post(f"{BASE}/api/backup/restore",
                      headers=admin_headers, json=restore_body, timeout=30)
    assert r.status_code == 200

    cur = requests.get(f"{BASE}/api/admin/email-settings",
                       headers=admin_headers, timeout=15).json()
    assert cur["brand_name"] == pinned_brand

    # Cleanup
    requests.put(f"{BASE}/api/admin/email-settings",
                 headers=admin_headers, json={"brand_name": "Sit Happens"}, timeout=15)
