"""The register report's alerts (audit #52).

A void or a return is a reversal, not a sale, so it no longer raises "negative
sale is not marked as a refund". The alert list is capped at 100, and it now
keeps danger-severity alerts ahead of warnings, so a flood of warnings cannot
push a danger alert off the report.

Uses a synthetic past date that no other suite writes to. Disposable tag
TEST_REG_ALERTS.
"""
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_REG_ALERTS"
D = "2021-06-15"
D2 = "2021-06-16"


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.bookings.delete_many({"notes": {"$regex": TAG}}))


def test_reversal_rows_are_not_flagged_as_negative_sales():
    rows = [
        {"id": f"{TAG}-r", "date": D, "amount": -10.0, "payment_method": "cash",
         "source_kind": "pos_sale_return", "description": f"{TAG} return"},
        {"id": f"{TAG}-v", "date": D, "amount": -20.0, "payment_method": "void",
         "source_kind": "pos_sale_void", "description": f"{TAG} void"},
        {"id": f"{TAG}-u", "date": D, "amount": -5.0, "payment_method": "cash",
         "description": f"{TAG} untagged"},
    ]
    run(server.db.retail_sales.insert_many([dict(r, tag=TAG) for r in rows]))
    neg = [a["message"] for a in run(server._register_range_summary(D, D))["alerts"] if a["type"] == "negative_sale"]
    assert not any(f"{TAG} return" in m or f"{TAG} void" in m for m in neg)
    assert any(f"{TAG} untagged" in m for m in neg), "an untagged negative is still a warning"


def test_a_danger_alert_survives_a_flood_of_warnings(monkeypatch):
    # 101 sales with no payment method give 101 warnings, more than the 100 the report keeps.
    flood = [{"id": f"{TAG}-w{i}", "date": D2, "amount": 1.0, "payment_method": "",
              "description": f"{TAG} sale {i}", "tag": TAG} for i in range(101)]
    run(server.db.retail_sales.insert_many(flood))
    # A paid booking that still shows a balance is the one danger-severity alert (its balance is stubbed here).
    run(server.db.bookings.insert_one({"id": f"{TAG}-b", "date": D2, "status": "completed", "payment_status": "paid",
                                       "client_name": f"{TAG} Owner", "dog_name": "Rex", "notes": TAG, "tag": TAG}))
    monkeypatch.setattr(server, "_booking_balance_due", lambda b: 50.0)
    alerts = run(server._register_range_summary(D2, D2))["alerts"]
    assert any(a["type"] == "paid_has_balance" for a in alerts), "the danger alert is on the report"
    assert alerts[0]["severity"] == "danger", "danger alerts are listed first"
