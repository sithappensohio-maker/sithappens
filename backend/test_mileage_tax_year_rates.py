"""Item 56 — per-tax-year IRS business mileage rates.

The mileage deduction used to be priced at ONE stored value (the owner's
quarterly_tax settings doc), so a 2025 deduction got whatever the single
number happened to be, and reads rewrote a stored 0.70 to 0.725.

Contract under test:
  * the rate is a per-year table (2024 0.67, 2025 0.70, 2026 0.725);
  * a tax year's deduction and its reported rate use that year's rate;
  * a stored single `mileage_rate_per_mile` never changes a deduction and
    is never rewritten on read;
  * a year missing from the table gets the latest known rate;
  * the settings endpoint no longer accepts the mileage rate.

Disposable tag TEST_MILEAGE_YR. Harness as in test_tax_profile_foundation.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pytest
import server
from _test_loop import run
from fastapi import HTTPException

TAG = "TEST_MILEAGE_YR"
ADMIN = {"id": "mileage-yr-admin", "name": "Mileage YR QA", "email": "mileageyr@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _mileage_isolation():
    prev = run(server.db.app_settings.find_one({"_id": "quarterly_tax"}))
    yield
    run(server.db.mileage_log.delete_many({"purpose": {"$regex": TAG}}))
    if prev is None:
        run(server.db.app_settings.delete_one({"_id": "quarterly_tax"}))
    else:
        run(server.db.app_settings.replace_one({"_id": "quarterly_tax"}, prev, upsert=True))


def _log(date_iso, miles):
    run(server.db.mileage_log.insert_one({
        "id": str(uuid.uuid4()), "date": date_iso, "miles": miles,
        "purpose": f"{TAG} trip", "created_at": f"{date_iso}T10:00:00",
    }))


def _store_single_rate(rate):
    run(server.db.app_settings.update_one(
        {"_id": "quarterly_tax"}, {"$set": {"mileage_rate_per_mile": rate}}, upsert=True))


def _stored_single_rate():
    return run(server.db.app_settings.find_one({"_id": "quarterly_tax"}))["mileage_rate_per_mile"]


def _expenses(year):
    return run(server.admin_quarterly_tax(_=ADMIN, year=year))["expenses"]


# ── Deduction uses the tax year's own rate ──────────────────────────────────
def test_2025_deduction_uses_2025_rate_despite_stored_value():
    _store_single_rate(0.99)
    _log("2025-06-10", 100.0)
    e = _expenses(2025)
    assert e["mileage_miles"] == 100.0
    assert e["mileage_rate"] == 0.70
    assert e["mileage_deduction"] == 70.0


def test_2026_deduction_uses_2026_rate_despite_stored_value():
    _store_single_rate(0.99)
    _log("2026-03-02", 100.0)
    e = _expenses(2026)
    assert e["mileage_miles"] == 100.0
    assert e["mileage_rate"] == 0.725
    assert e["mileage_deduction"] == 72.5


def test_legacy_stored_070_is_not_rewritten_to_2026_rate_for_2025():
    # Old installs stored the 0.70 placeholder. The read used to rewrite it to
    # 0.725, which priced 2025 miles at the 2026 rate. 2025 must stay 0.70.
    _store_single_rate(0.70)
    _log("2025-09-01", 100.0)
    e = _expenses(2025)
    assert e["mileage_rate"] == 0.70
    assert e["mileage_deduction"] == 70.0


@pytest.mark.parametrize("year, rate", [(2024, 0.67), (2025, 0.70), (2026, 0.725)])
def test_each_table_year_reports_its_rate(year, rate):
    _store_single_rate(0.99)
    assert _expenses(year)["mileage_rate"] == rate


def test_year_outside_table_uses_latest_known_rate():
    # 2027 is past the table; the quarterly payload refuses future years, so
    # check the mileage tile, which prices any year it is asked for.
    _store_single_rate(0.99)
    assert run(server.mileage_summary(year=2027, _=ADMIN))["rate_per_mile"] == 0.725


# ── Stored value is never overwritten by a read ─────────────────────────────
def test_stored_single_rate_untouched_by_reads():
    _store_single_rate(0.70)
    _expenses(2026)
    run(server.mileage_summary(year=2026, _=ADMIN))
    assert _stored_single_rate() == 0.70


# ── Summary tiles use the same per-year rate ────────────────────────────────
def test_mileage_summary_uses_selected_year_rate():
    _store_single_rate(0.99)
    _log("2025-04-15", 40.0)
    s = run(server.mileage_summary(year=2025, _=ADMIN))
    assert s["rate_per_mile"] == 0.70
    assert s["ytd_deduction"] == 28.0


# ── The settings endpoint no longer accepts a mileage rate ──────────────────
def test_settings_endpoint_refuses_mileage_rate():
    with pytest.raises(HTTPException) as exc:
        run(server.admin_quarterly_tax_settings(body={"mileage_rate_per_mile": 0.99}, _=ADMIN))
    assert exc.value.status_code == 400
