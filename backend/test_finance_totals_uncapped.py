"""Money totals must never come from a capped result slice.

AR totals were summed from clients.to_list(5000) (two copies), and the
range P&L summed expenses / retail_sales from to_list(5000) — past those
row counts the numbers silently went wrong. AR now sums in Mongo over every
client; the P&L streams every row through the canonical per-row helpers.
These tests push each collection past the old ceiling.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_FIN_CAP"
N = 5300  # > every old to_list ceiling in these paths


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@contextlib.contextmanager
def _cleanup():
    try:
        yield
    finally:
        run(server.db.clients.delete_many({"_tag": TAG}))
        run(server.db.expenses.delete_many({"_tag": TAG}))
        run(server.db.retail_sales.delete_many({"_tag": TAG}))


def test_accounts_receivable_totals_cover_every_client():
    with _cleanup():
        base = run(server._account_balance_totals())
        docs = [{"id": str(uuid.uuid4()), "name": f"{TAG} owes {i}", "email": "", "account_balance": 1.0, "_tag": TAG} for i in range(N)]
        docs += [{"id": str(uuid.uuid4()), "name": f"{TAG} credit {i}", "email": "", "account_balance": -2.0, "_tag": TAG} for i in range(200)]
        docs.append({"id": str(uuid.uuid4()), "name": f"{TAG} legacy string", "email": "", "account_balance": "3.5", "_tag": TAG})
        run(server.db.clients.insert_many(docs))

        out = run(server.get_accounts_receivable(_admin_user()))
        assert out["total_receivable"] == round(base["receivable"] + N * 1.0 + 3.5, 2)
        assert out["total_credit_on_file"] == round(base["credit"] + 400.0, 2)
        assert out["count"] == base["count"] + N + 201
        assert out["net"] == round(out["total_receivable"] - out["total_credit_on_file"], 2)
        # Display list is bounded and says so; totals are not.
        assert len(out["clients"]) == server.AR_LIST_MAX and out["list_truncated"] is True
        assert out["clients"][0]["account_balance"] >= 3.5, "sorted on the numeric value, legacy string balances included"
        assert all(isinstance(c["account_balance"], float) for c in out["clients"][:50])

        wk = run(server.weekly_summary(_admin_user()))
        assert wk["ar_outstanding_total"] == out["total_receivable"]
        assert wk["ar_outstanding_count"] == base["receivable_count"] + N + 1


def test_range_summary_sums_every_expense_and_retail_row():
    start, end = "2001-01-01", "2001-01-03"
    with _cleanup():
        run(server.db.expenses.insert_many([
            {"id": str(uuid.uuid4()), "date": start if i % 2 else end, "amount": 1.0,
             "category": "Supplies" if i % 3 else "Food", "_tag": TAG} for i in range(N)
        ]))
        run(server.db.retail_sales.insert_many([
            {"id": str(uuid.uuid4()), "date": start if i % 2 else end, "amount": 2.0, "tax_amount": 0.0,
             "source_kind": "training_program_sale" if i % 10 == 0 else "", "_tag": TAG} for i in range(N)
        ]))
        out = run(server.summary_range(_admin_user(), start_date=start, end_date=end))
        assert out["expense_count"] == N and out["expenses_total"] == float(N)
        assert sum(c["count"] for c in out["expenses_by_category"]) == N
        training = N // 10
        assert out["training_revenue_count"] == training and out["training_revenue_total"] == training * 2.0
        assert out["retail_count"] == N - training and out["retail_total"] == (N - training) * 2.0
        assert out["net_before_labor"] == round(out["completed_total"] - out["expenses_total"], 2)
        by_day = out["by_day"]
        day_vals = list(by_day.values()) if isinstance(by_day, dict) else [
            float(x.get("total", x.get("amount", x.get("value", 0))) or 0) for x in by_day]
        assert round(sum(day_vals), 2) == N * 2.0
