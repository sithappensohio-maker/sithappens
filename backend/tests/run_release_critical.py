"""The release-critical backend gate — see RELEASE_CHECKLIST.md.

Runs the curated set of legacy tests/*.py files that are verified to pass
100% clean from a byte-fresh, isolated database (never sit_happens_local_test),
resetting the database (including rebuilding indexes — see
release_critical_reset.py's docstring for why that matters) before EVERY
file, not just once, since some files' fixtures leave state that would
otherwise mask or cause failures in whichever file runs next.

This is a curated SUBSET, not the full backend/tests/ suite — see
RELEASE_CHECKLIST.md's "Release-critical backend gate" section for exactly
which functional areas this covers, which ones are deliberately excluded
because they depend on long-lived pre-seeded dev-database state a clean
test database doesn't have, and why that's a separate, explicitly tracked
gap rather than something silently skipped or hidden.

Usage (from backend/, with a release-critical test server already running —
see RELEASE_CHECKLIST.md for the exact server-startup command):
    TEST_BACKEND_URL=http://127.0.0.1:8011 MONGO_URL=... DB_NAME=... \\
    JWT_SECRET=... BACKUP_ROOT=... python tests/run_release_critical.py
"""
import os
import subprocess
import sys

RELEASE_CRITICAL_FILES = [
    # Authentication and permissions
    "test_permission_enforcement.py",
    "test_backend_permission_checkpoint2.py",
    # Client and dog records
    "test_dogs_endpoint_coercion.py",
    # Credits and credit lots
    "test_lot_recognition_flip.py",
    "test_grandfathered_legacy_credits.py",
    "test_credit_pack_recognize_at_sale.py",
    # Cash register enforcement
    "test_pos_register.py",
    "test_register_cash_sales.py",
    "test_till_adjustments.py",
    # Shop catalog and checkout, online-order fulfillment
    "test_shop_checkout.py",
    "test_shop_management.py",
    "test_client_shop_catalog.py",
    # Inventory reservations
    "test_pos_inventory.py",
    # Backups and restore validation
    "test_config_backup.py",
    "test_sprint_110di_25.py",
    # Data export
    "test_data_export_and_readiness.py",
]


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(here)
    python = sys.executable
    reset_script = os.path.join(here, "release_critical_reset.py")

    total_failed_files = []
    summary_lines = []
    for fname in RELEASE_CRITICAL_FILES:
        subprocess.run([python, reset_script], cwd=backend_dir, check=True)
        result = subprocess.run(
            [python, "-m", "pytest", os.path.join("tests", fname), "-q"],
            cwd=backend_dir, capture_output=True, text=True,
        )
        last_line = next(
            (l for l in reversed(result.stdout.strip().splitlines()) if l.strip()),
            "(no output)",
        )
        summary_lines.append(f"{fname}: {last_line}")
        if result.returncode != 0:
            total_failed_files.append(fname)
            print(result.stdout)
            print(result.stderr)

    print("\n=== Release-critical gate summary ===")
    for line in summary_lines:
        print(line)

    if total_failed_files:
        print(f"\nFAILED files ({len(total_failed_files)}): {', '.join(total_failed_files)}")
        return 1
    print(f"\nAll {len(RELEASE_CRITICAL_FILES)} release-critical files passed clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
