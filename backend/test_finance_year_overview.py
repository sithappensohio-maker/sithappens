"""Finance page "This Year" overview — persistent yearly gross/expenses/net,
best month, best week, and a same-period year-over-year comparison (owner
request 2026-11-02).

Also covers the `year` query param validation added after an adversarial
review flagged that an unvalidated future/zero/out-of-range year either
silently inverted the date range (year_start > year_end, producing a
plausible-looking but wrong zeroed response) or crashed with a raw 500 from
date.fromisoformat deep in _summary_range_data's call stack.

Uses a fixed past year (2024, vs 2023) so the test never depends on what
"today" happens to be when it runs — both years are fully closed calendar
years, so the endpoint's own "year < today.year -> full year" branch and the
prior-year "same period" branch land on a plain Jan 1 - Dec 31 comparison
for both, with no business_today() arithmetic to replicate in the test.

Self-contained fixtures (never import another test module).
"""
import uuid

import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run

TAG = "TEST_FINANCE_YEAR_OVERVIEW"


def _booking(date, price, status="completed", payment_status="paid"):
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": "n/a", "dog_id": "n/a", "service_type": "daycare",
        "date": date, "status": status, "payment_status": payment_status,
        "payment_method": "cash", "actual_price": price, "amount_paid": price,
        "created_at": server.now_iso(),
    }))
    return bid


def _retail(date, amount):
    rid = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": rid, "client_id": "n/a", "amount": amount, "tax_amount": 0.0,
        "gift_card_funded": 0.0, "date": date, "created_at": server.now_iso(),
    }))
    return rid


def _expense(date, amount, category="Supplies"):
    eid = str(uuid.uuid4())
    run(server.db.expenses.insert_one({
        "id": eid, "amount": amount, "date": date, "category": category,
        "created_at": server.now_iso(),
    }))
    return eid


def _cleanup():
    async def go():
        await server.db.bookings.delete_many({"client_id": "n/a"})
        await server.db.retail_sales.delete_many({"client_id": "n/a"})
        await server.db.expenses.delete_many({"category": {"$in": ["Supplies", "Rent"]}, "amount": {"$in": [150.0, 50.0]}})
    run(go())


def test_year_overview_gross_expenses_net_best_month_best_week_and_yoy():
    try:
        # 2024 (the year under test): Jan single sale, June two same-week
        # bookings (the year's biggest week AND biggest month), Aug a smaller sale.
        _retail("2024-01-10", 100.0)
        _booking("2024-06-03", 250.0)   # Monday
        _booking("2024-06-04", 250.0)   # Tuesday, same Mon-Sun week as above
        _retail("2024-08-20", 200.0)
        _expense("2024-03-15", 150.0)

        # 2023 (prior year, full-year comparison baseline): smaller totals.
        _retail("2023-05-05", 300.0)
        _expense("2023-04-01", 50.0)

        data = run(server.year_overview(year=2024, _=None))

        assert data["year"] == 2024
        assert data["start_date"] == "2024-01-01"
        assert data["end_date"] == "2024-12-31", "a fully-closed past year uses its real Dec 31, not business_today()"
        assert data["gross_total"] == 800.0, "100 (Jan) + 500 (June) + 200 (Aug) wasn't carried through to gross"
        assert data["expenses_total"] == 150.0
        assert data["net_total"] == 650.0, "gross 800 - expenses 150 - zero labor"

        assert data["best_month"]["month"] == "2024-06"
        assert data["best_month"]["total"] == 500.0
        assert data["best_month"]["label"] == "June 2024"

        assert data["best_week"]["week_start"] == "2024-06-03", "the Monday that opens the $500 week"
        assert data["best_week"]["week_end"] == "2024-06-09"
        assert data["best_week"]["total"] == 500.0

        py = data["prior_year"]
        assert py["year"] == 2023
        assert py["through"] == "2023-12-31"
        assert py["gross_total"] == 300.0
        assert py["expenses_total"] == 50.0
        assert py["net_total"] == 250.0
        assert py["gross_change_pct"] == round((800.0 - 300.0) / 300.0 * 100, 1)
        assert py["net_change_pct"] == round((650.0 - 250.0) / 250.0 * 100, 1)
    finally:
        _cleanup()


def test_year_overview_with_no_activity_returns_zeros_not_a_crash():
    data = run(server.year_overview(year=2019, _=None))
    assert data["gross_total"] == 0.0
    assert data["expenses_total"] == 0.0
    assert data["net_total"] == 0.0
    assert data["best_month"] is None
    assert data["best_week"] is None
    assert data["prior_year"]["gross_change_pct"] is None, "no prior-year revenue means no percent change to report"


def test_a_future_year_is_rejected_not_silently_inverted():
    future = server.business_today().year + 1
    with pytest.raises(server.HTTPException) as exc:
        run(server.year_overview(year=future, _=None))
    assert exc.value.status_code == 400


def test_year_zero_is_rejected_not_silently_treated_as_no_year_given():
    # `int(year) if year else today.year` used to treat 0 as falsy and
    # silently fall back to the current year instead of rejecting it.
    with pytest.raises(server.HTTPException) as exc:
        run(server.year_overview(year=0, _=None))
    assert exc.value.status_code == 400


def test_an_out_of_range_year_is_rejected_before_any_date_parsing():
    # year=99 used to reach date.fromisoformat("99-12-31") deep inside
    # _summary_range_data and crash with an unhandled ValueError (500).
    with pytest.raises(server.HTTPException) as exc:
        run(server.year_overview(year=99, _=None))
    assert exc.value.status_code == 400


def test_the_current_year_itself_is_still_allowed():
    data = run(server.year_overview(year=server.business_today().year, _=None))
    assert data["year"] == server.business_today().year
