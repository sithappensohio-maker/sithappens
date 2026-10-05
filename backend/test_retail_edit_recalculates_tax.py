"""Editing a retail sale's amount recalculates its sales tax (audit #20).

Create takes the amount as the total and backs out the tax slice. The edit kept
the tax from the old amount, so a corrected $110 sale still showed $5 tax.
Disposable tag TEST_RETAIL_TAX.
"""
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_RETAIL_TAX"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "retail-tax@test"}
DAY = "2021-03-10"


@pytest.fixture()
def taxed(monkeypatch):
    async def register_open(*_a, **_k):
        return None

    async def settings():
        return {"sales_tax": {"enabled": True, "rate_pct": 10.0}}
    monkeypatch.setattr(server, "_require_register_day_open", register_open)
    monkeypatch.setattr(server, "get_settings", settings)
    yield
    run(server.db.retail_sales.delete_many({"tag": TAG}))


def _insert_sale(amount):
    doc = run(server._build_retail_sale_doc(date=DAY, description=TAG, amount=amount, payment_method="cash", created_by="x"))
    run(server.db.retail_sales.insert_one({**doc, "tag": TAG}))
    return doc["id"]


def test_editing_the_amount_recalculates_the_tax_slice(taxed):
    sale_id = _insert_sale(55.0)
    assert run(server.db.retail_sales.find_one({"id": sale_id}))["tax_amount"] == 5.0
    body = server.RetailSaleIn(date=DAY, description=TAG, amount=110.0, payment_method="cash")
    run(server.update_retail_sale(sale_id, body, ADMIN))
    row = run(server.db.retail_sales.find_one({"id": sale_id}, {"_id": 0}))
    assert row["amount"] == 110.0
    assert row["tax_amount"] == 10.0 and row["pre_tax_amount"] == 100.0
