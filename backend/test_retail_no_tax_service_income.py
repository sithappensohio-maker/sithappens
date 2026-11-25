"""Income from before the app (daycare, boarding, training) is logged as a
back-dated manual sale with NO sales tax: it must land on its own date, carry
no tax slice and add nothing to the sales-tax owed for that month. Without
`apply_tax=False` the same entry is treated as merchandise. Disposable tag
TEST_RETAIL_NOTAX.
"""
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_RETAIL_NOTAX"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "retail-notax@test"}
DAY = "2019-01-31"


@pytest.fixture(autouse=True)
def taxed(monkeypatch):
    async def settings():
        return {"sales_tax": {"enabled": True, "rate_pct": 10.0}}
    monkeypatch.setattr(server, "get_settings", settings)
    yield
    run(server.db.retail_sales.delete_many({"description": TAG}))


def _log(**over):
    body = server.RetailSaleIn(**{"date": DAY, "description": TAG, "amount": 1100.0, "payment_method": "other", **over})
    return run(server.create_retail_sale(body, ADMIN))


def test_service_income_is_logged_on_a_past_day_with_no_sales_tax():
    row = _log(apply_tax=False, category="Pre-app income")
    assert row["date"] == DAY and row["amount"] == 1100.0
    assert "tax_amount" not in row and "pre_tax_amount" not in row
    tax = run(server._sales_tax_window_summary("2019-01-01", "2019-01-31"))
    assert tax["total_tax_collected"] == 0 and tax["retail_count"] == 0


def test_the_same_entry_left_as_merchandise_owes_sales_tax():
    row = _log()
    assert row["tax_amount"] == 100.0 and row["pre_tax_amount"] == 1000.0
    assert run(server._sales_tax_window_summary("2019-01-01", "2019-01-31"))["total_tax_collected"] == 100.0


def test_the_income_counts_in_the_month_it_was_dated():
    _log(apply_tax=False)
    data = run(server._summary_range_data("2019-01-01", "2019-01-31"))
    day = next(d for d in data["by_day"] if d["date"] == DAY)
    assert day["total"] == 1100.0
