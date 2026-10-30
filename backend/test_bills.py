"""Recurring bills (domains/finance/bills.py): a list of bills with due dates;
marking one paid logs it as an expense and moves it to its next due date; the
newest payment can be undone; Today lists bills overdue or due within 3 days.

Disposable rows are named/described with TAG and removed after the module.
Payments use synthetic past dates so they never touch a real register day.
"""
import uuid
from datetime import date, timedelta

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.finance.bills import next_due_after

TAG = "TEST_BILLS"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
_closeouts = []


def _fresh():
    run(server.db.bills.delete_many({"name": {"$regex": f"^{TAG}"}}))
    run(server.db.expenses.delete_many({"description": {"$regex": f"^{TAG}"}}))
    run(server.db.task_dismissals.delete_many({"item_id": {"$regex": "^bills-due:"}}))


def teardown_module():
    _fresh()
    run(server.db.users.delete_many({"tag": TAG}))
    run(server.db.daily_closeouts.delete_many({"id": {"$in": _closeouts}}))


def _user(role="admin", **extra):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Bills QA",
         "role": role, "active": True, "password_hash": "x", "token_version": 0, "tag": TAG, **extra}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _add(admin, name, next_due: date, amount=100.0, frequency="monthly", **extra):
    body = {"name": f"{TAG} {name}", "payee": f"{name} Co", "amount": amount, "category": "Utilities",
            "payment_method": "card", "frequency": frequency, "next_due": next_due.isoformat(), **extra}
    res = run(_http.post("/api/admin/bills", headers=_auth(admin), json=body))
    assert res.status_code == 200, res.text
    return res.json()


def _pay(admin, bill, amount, paid_date="2003-03-10", **extra):
    return run(_http.post(f"/api/admin/bills/{bill['id']}/pay", headers=_auth(admin),
                          json={"due_date": bill["next_due"], "amount": amount, "paid_date": paid_date, **extra}))


def _undo(admin, bill, expense_id):
    return run(_http.post(f"/api/admin/bills/{bill['id']}/undo-payment", headers=_auth(admin),
                          json={"expense_id": expense_id}))


def _get(admin, bill_id):
    bills = run(_http.get("/api/admin/bills", headers=_auth(admin))).json()["bills"]
    return next(b for b in bills if b["id"] == bill_id)


def _bill_cards(user):
    out = run(server.admin_today_brain(user))
    return ([i for i in out["items"] if i["kind"] == "bill_due"], [i for i in out["hidden"] if i["kind"] == "bill_due"])


def test_monthly_bills_keep_their_day_of_the_month():
    assert next_due_after(date(2027, 1, 31), "monthly", 31) == date(2027, 2, 28)
    assert next_due_after(date(2027, 2, 28), "monthly", 31) == date(2027, 3, 31)
    assert next_due_after(date(2026, 11, 30), "quarterly", 30) == date(2027, 2, 28)
    assert next_due_after(date(2027, 2, 28), "quarterly", 30) == date(2027, 5, 30)
    assert next_due_after(date(2028, 2, 29), "yearly", 29) == date(2029, 2, 28)
    assert next_due_after(date(2031, 2, 28), "yearly", 29) == date(2032, 2, 29)
    assert next_due_after(date(2026, 12, 28), "weekly", 28) == date(2027, 1, 4)


def test_marking_a_bill_paid_logs_the_expense_and_moves_the_due_date():
    _fresh()
    admin = _user()
    bill = _add(admin, "Electric", date(2026, 11, 15), amount=180.0)
    res = _pay(admin, bill, 187.43, payment_method="transfer", notes="higher this month")
    assert res.status_code == 200, res.text
    expense = run(server.db.expenses.find_one({"id": res.json()["expense"]["id"]}, {"_id": 0}))
    assert expense["date"] == "2003-03-10"
    assert expense["description"] == f"{TAG} Electric"
    assert expense["amount"] == 187.43
    assert expense["vendor"] == "Electric Co" and expense["category"] == "Utilities"
    assert expense["payment_method"] == server._normalize_payment_method("transfer", store=True)
    assert expense["recurring"] is True and expense["recurring_interval"] == "monthly"
    assert expense["from_cash_drawer"] is False
    assert expense["bill_id"] == bill["id"] and expense["bill_due_date"] == "2026-11-15"
    assert expense["notes"] == "Bill due 2026-11-15 — higher this month"

    listed = _get(admin, bill["id"])
    assert listed["next_due"] == "2026-12-15"
    assert listed["last_payment"]["amount"] == 187.43 and listed["can_undo"] is True


def test_paying_the_same_due_date_twice_logs_it_once():
    _fresh()
    admin = _user()
    bill = _add(admin, "Rent", date(2026, 11, 1), amount=1200.0)
    assert _pay(admin, bill, 1200.0).status_code == 200
    again = _pay(admin, bill, 1200.0)   # the stale screen still shows Nov 1
    assert again.status_code == 409
    assert run(server.db.expenses.count_documents({"bill_id": bill["id"]})) == 1
    assert _get(admin, bill["id"])["next_due"] == "2026-12-01"


def test_a_closed_register_day_refuses_the_payment_and_the_bill_stays_due():
    _fresh()
    admin = _user()
    bill = _add(admin, "Insurance", date(2026, 11, 20), amount=310.0, frequency="quarterly")
    closed_day = "2003-04-15"
    cid = str(uuid.uuid4())
    _closeouts.append(cid)
    run(server.db.daily_closeouts.insert_one({"id": cid, "date": closed_day, "created_at": f"{closed_day}T20:00:00",
                                              "cash_counted": 0.0, "rollover_cash": 0.0, "status": "closed"}))
    res = _pay(admin, bill, 310.0, paid_date=closed_day)
    assert res.status_code == 409
    assert "closed" in res.json()["detail"]
    assert _get(admin, bill["id"])["next_due"] == "2026-11-20"
    assert run(server.db.expenses.count_documents({"bill_id": bill["id"]})) == 0


def test_undo_removes_the_expense_and_puts_the_due_date_back():
    _fresh()
    admin = _user()
    bill = _add(admin, "Phone", date(2026, 11, 5), amount=65.0)
    expense_id = _pay(admin, bill, 65.0).json()["expense"]["id"]

    res = _undo(admin, bill, expense_id)
    assert res.status_code == 200, res.text
    assert res.json()["bill"]["next_due"] == "2026-11-05"
    assert run(server.db.expenses.find_one({"id": expense_id})) is None
    assert _undo(admin, bill, expense_id).status_code == 404


def test_undo_is_refused_once_the_due_date_was_edited():
    _fresh()
    admin = _user()
    bill = _add(admin, "Water", date(2026, 11, 8), amount=40.0)
    expense_id = _pay(admin, bill, 40.0).json()["expense"]["id"]
    edit = {"name": bill["name"], "payee": "Water Co", "amount": 40.0, "category": "Utilities",
            "payment_method": "card", "frequency": "monthly", "next_due": "2027-01-10"}
    assert run(_http.put(f"/api/admin/bills/{bill['id']}", headers=_auth(admin), json=edit)).status_code == 200
    assert _get(admin, bill["id"])["can_undo"] is False
    res = _undo(admin, bill, expense_id)
    assert res.status_code == 409
    assert run(server.db.expenses.find_one({"id": expense_id}, {"_id": 0, "id": 1})) is not None


def test_a_stale_or_retried_undo_never_deletes_an_older_payment():
    _fresh()
    admin = _user()
    bill = _add(admin, "Lease", date(2026, 11, 1), amount=1200.0)
    jan = _pay(admin, bill, 1200.0).json()["expense"]["id"]
    bill = _get(admin, bill["id"])
    feb = _pay(admin, bill, 1200.0).json()["expense"]["id"]

    assert _undo(admin, bill, feb).status_code == 200   # the phone undoes the newest payment
    again = _undo(admin, bill, feb)                      # the stale laptop (or a retry) sends the same undo
    assert again.status_code == 409
    assert run(server.db.expenses.find_one({"id": jan}, {"_id": 0, "id": 1})) is not None
    assert _get(admin, bill["id"])["next_due"] == "2026-12-01"


def test_editing_a_bill_on_a_short_month_keeps_its_day_of_the_month():
    _fresh()
    admin = _user()
    bill = _add(admin, "Internet", date(2026, 10, 31), amount=80.0)
    assert _pay(admin, bill, 80.0).status_code == 200            # now due Nov 30 (shortened 31st)
    edit = {"name": bill["name"], "payee": "Internet Co", "amount": 85.0, "category": "Utilities",
            "payment_method": "card", "frequency": "monthly", "next_due": "2026-11-30",
            "expected_next_due": "2026-11-30"}
    assert run(_http.put(f"/api/admin/bills/{bill['id']}", headers=_auth(admin), json=edit)).status_code == 200
    bill = _get(admin, bill["id"])
    assert bill["due_day"] == 31
    assert _pay(admin, bill, 85.0).status_code == 200
    assert _get(admin, bill["id"])["next_due"] == "2026-12-31"


def test_an_edit_form_opened_before_a_payment_cannot_write_the_old_due_date_back():
    _fresh()
    admin = _user()
    bill = _add(admin, "Gas", date(2026, 11, 3), amount=60.0)
    stale_form = {"name": bill["name"], "payee": "Gas Co", "amount": 65.0, "category": "Utilities",
                  "payment_method": "card", "frequency": "monthly", "next_due": "2026-11-03",
                  "expected_next_due": "2026-11-03"}
    assert _pay(admin, bill, 60.0).status_code == 200            # paid while the form sat open
    res = run(_http.put(f"/api/admin/bills/{bill['id']}", headers=_auth(admin), json=stale_form))
    assert res.status_code == 409
    after = _get(admin, bill["id"])
    assert after["next_due"] == "2026-12-03" and after["amount"] == 60.0


def test_cash_taken_from_the_register_drawer_is_marked_so_the_count_stays_right():
    _fresh()
    admin = _user()
    bill = _add(admin, "Window cleaner", date(2026, 11, 6), amount=45.0)
    drawer = _pay(admin, bill, 45.0, payment_method="cash", from_cash_drawer=True).json()["expense"]
    assert run(server.db.expenses.find_one({"id": drawer["id"]}))["from_cash_drawer"] is True
    bill = _get(admin, bill["id"])
    card = _pay(admin, bill, 45.0, payment_method="card", from_cash_drawer=True).json()["expense"]
    assert run(server.db.expenses.find_one({"id": card["id"]}))["from_cash_drawer"] is False


def test_the_30_day_total_counts_a_weekly_bill_every_week():
    _fresh()
    admin = _user()
    today = server.business_today()
    _add(admin, "Linen service", today + timedelta(days=1), amount=25.0, frequency="weekly")   # 5 visits in 30 days
    # An overdue date shows as overdue, but the bill's later dates in the window still count:
    _add(admin, "Overdue phone", today - timedelta(days=3), amount=50.0)                      # next month's date, once
    _add(admin, "Late dog walker", today - timedelta(days=1), amount=100.0, frequency="weekly")  # its next 4 weeks
    body = run(_http.get("/api/admin/bills", headers=_auth(admin))).json()
    assert body["due_next_30"] == 125.0 + 50.0 + 400.0


def test_switching_a_weekly_bill_to_monthly_takes_the_day_shown_not_an_old_one():
    _fresh()
    admin = _user()
    bill = _add(admin, "Pest control", date(2026, 8, 31), amount=40.0, frequency="weekly")   # due_day 31, never used
    edit = {"name": bill["name"], "payee": "Pest Co", "amount": 40.0, "category": "Utilities",
            "payment_method": "card", "frequency": "monthly", "next_due": "2026-11-30",
            "expected_next_due": "2026-08-31"}
    assert run(_http.put(f"/api/admin/bills/{bill['id']}", headers=_auth(admin), json=edit)).status_code == 200
    bill = _get(admin, bill["id"])
    assert bill["due_day"] == 30
    assert _pay(admin, bill, 40.0).status_code == 200
    assert _get(admin, bill["id"])["next_due"] == "2026-12-30"


def test_a_failed_link_to_the_bill_leaves_no_stray_expense_and_the_bill_still_due(monkeypatch):
    from motor.motor_asyncio import AsyncIOMotorCollection
    _fresh()
    admin = _user()
    bill = _add(admin, "Alarm monitoring", date(2026, 11, 9), amount=35.0)
    real = AsyncIOMotorCollection.update_one

    def drop_the_link(self, flt, update, *a, **k):
        if self.name == "expenses" and "bill_id" in (update.get("$set") or {}):
            raise RuntimeError("connection dropped")
        return real(self, flt, update, *a, **k)

    monkeypatch.setattr(AsyncIOMotorCollection, "update_one", drop_the_link)
    body = server.BillPayIn(due_date="2026-11-09", amount=35.0, paid_date="2003-03-10")
    try:
        run(server.admin_pay_bill(bill["id"], body, admin))
        raise AssertionError("the payment should have failed")
    except RuntimeError:
        pass
    monkeypatch.setattr(AsyncIOMotorCollection, "update_one", real)
    assert run(server.db.expenses.count_documents({"description": f"{TAG} Alarm monitoring"})) == 0
    assert _get(admin, bill["id"])["next_due"] == "2026-11-09"
    assert _pay(admin, bill, 35.0).status_code == 200      # paying again logs it exactly once
    assert run(server.db.expenses.count_documents({"description": f"{TAG} Alarm monitoring"})) == 1


def test_a_merge_restore_never_rolls_a_bills_due_date_back():
    from domains.backup import rules
    write = rules.merge_update("bills", {"id": "b1", "name": "Rent", "amount": 1200.0, "next_due": "2026-11-01", "due_day": 1})
    assert write["$set"] == {"id": "b1", "name": "Rent", "amount": 1200.0}
    assert write["$setOnInsert"] == {"next_due": "2026-11-01", "due_day": 1}


def test_today_lists_bills_overdue_or_due_within_three_days():
    _fresh()
    admin = _user()
    today = server.business_today()
    _add(admin, "Internet", today + timedelta(days=2), amount=80.0)
    _add(admin, "Storage unit", today + timedelta(days=10), amount=150.0)   # not soon yet

    shown, _ = _bill_cards(admin)
    assert len(shown) == 1
    card = shown[0]
    assert card["priority"] == "warn"
    assert card["title"] == "1 bill due soon — $80.00"
    assert f"{TAG} Internet $80.00 due" in card["subtitle"] and "Storage" not in card["subtitle"]
    assert card["cta"] == {"type": "open_screen", "screen": "income", "tab": "bills"}

    run(_http.post("/api/admin/today-brain/dismiss", headers=_auth(admin),
                   json={"item_id": card["id"], "signature": card["signature"]}))
    shown, hidden = _bill_cards(admin)
    assert shown == [] and [i["id"] for i in hidden] == [card["id"]]

    # A newly overdue bill is a different set of bills, so the card comes back, urgent.
    _add(admin, "Trash pickup", today - timedelta(days=1), amount=30.0)
    shown, _ = _bill_cards(admin)
    assert len(shown) == 1 and shown[0]["priority"] == "urgent"
    assert shown[0]["title"] == "1 bill overdue, 1 due soon — $110.00"
    assert "overdue since" in shown[0]["subtitle"]


def test_staff_without_finance_access_see_no_bills():
    _fresh()
    admin = _user()
    trainer = _user(staff_role="trainer")
    _add(admin, "Rent", server.business_today(), amount=1200.0)
    assert _bill_cards(trainer) == ([], [])
    assert run(_http.get("/api/admin/bills", headers=_auth(trainer))).status_code == 403


def test_deleting_a_bill_keeps_the_expenses_already_logged():
    _fresh()
    admin = _user()
    bill = _add(admin, "Software", date(2026, 11, 12), amount=29.0)
    expense_id = _pay(admin, bill, 29.0).json()["expense"]["id"]
    assert run(_http.delete(f"/api/admin/bills/{bill['id']}", headers=_auth(admin))).status_code == 200
    assert run(server.db.bills.find_one({"id": bill["id"]})) is None
    assert run(server.db.expenses.find_one({"id": expense_id}, {"_id": 0, "id": 1})) is not None
