"""The year-end payroll file counts what staff were paid (audit: "The year-end
payroll file counts unpaid breaks as wages").

It worked each shift out as clock-out minus clock-in, so a daily 30-minute
unpaid lunch became ~125 paid hours a year on a W-2/1099, and it cut the
year on UTC time, so a Dec 31 evening shift landed in next year's file. Now
it counts each shift's paid hours the way weekly payroll and timecards do
(unpaid break out), and the year runs Ohio midnight to Ohio midnight.

Disposable tag TEST_PAYROLL_YE.
"""
import csv
import io
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import _test_env  # noqa: F401 — must run before `import server`
import httpx
import pytest
import server
from _test_loop import run
from domains.staff.routes import shift_hours

TAG = "TEST_PAYROLL_YE"
NY = ZoneInfo("America/New_York")
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _utc(y, mo, d, h, mi=0):
    """An Ohio wall-clock time, stored the way the time clock stores it (UTC ISO)."""
    return datetime(y, mo, d, h, mi, tzinfo=NY).astimezone(timezone.utc).isoformat()


def _staff(name, rate=20.0, **over):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "email": f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com",
         "name": f"{TAG} {name}", "role": "employee", "staff_role": "daycare_staff", "hourly_rate": rate,
         "tax_status": "w2", "active": True, "password_hash": "x", "token_version": 0}
    u.update(over)
    run(server.db.users.insert_one(dict(u)))
    return u


def _shift(u, clock_in, clock_out, break_minutes=0, stored=True):
    e = {"id": f"{TAG}-e-{uuid.uuid4().hex[:8]}", "user_id": u["id"], "user_name": u["name"],
         "clock_in_at": clock_in, "clock_out_at": clock_out, "break_minutes": break_minutes}
    if stored:   # what clock-out, a staff edit or a correction stores
        e["hours"] = shift_hours(clock_in, clock_out, break_minutes)
    run(server.db.time_clock_entries.insert_one(e))
    return e


def _owner():
    u = {"id": f"{TAG}-owner-{uuid.uuid4().hex[:6]}", "email": f"{TAG.lower()}-o-{uuid.uuid4().hex[:6]}@example.com",
         "name": f"{TAG} Owner", "role": "admin", "password_hash": "x", "active": True, "token_version": 0}
    run(server.db.users.insert_one(dict(u)))
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], 'admin', 0)}"}


def _file(year, detail=False):
    res = run(_http.get(f"/api/admin/payroll/year-end.csv?year={year}&detail={str(detail).lower()}", headers=_owner()))
    assert res.status_code == 200, res.text
    return list(csv.reader(io.StringIO(res.text)))


def _summary(rows, u):
    row = next((r for r in rows if r and r[0] == u["name"] and len(r) >= 12), None)
    return None if row is None else {"hours": float(row[9]), "gross": float(row[10]), "entries": int(row[11])}


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.time_clock_entries.delete_many({"id": {"$regex": f"^{TAG}"}}))
    run(server.db.users.delete_many({"id": {"$regex": f"^{TAG}"}}))


def test_an_unpaid_lunch_is_not_counted_as_wages():
    u = _staff("Lunch Taker", rate=20.0)
    for day in (5, 6, 7):   # 8 to 4 with a 30-minute unpaid lunch
        _shift(u, _utc(2031, 3, day, 8), _utc(2031, 3, day, 16), break_minutes=30)
    got = _summary(_file(2031), u)
    assert got == {"hours": 22.5, "gross": 450.0, "entries": 3}, "it counted 24 hours / $480"


def test_a_shift_saved_without_hours_counts_as_weekly_payroll_counts_it():
    """Rows from before punch corrections stored hours (owner chose "going
    forward only") count 0 on weekly payroll, the P&L and the Tax Center until
    re-saved; the year-end file must agree with them, never invent wages."""
    u = _staff("Old Row", rate=10.0)
    _shift(u, _utc(2031, 4, 2, 9), _utc(2031, 4, 2, 13), break_minutes=60, stored=False)
    e = _shift(u, _utc(2031, 4, 3, 9), _utc(2031, 4, 3, 13), break_minutes=0)
    run(server.db.time_clock_entries.update_one({"id": e["id"]}, {"$set": {"hours": None}}))
    assert _summary(_file(2031), u) == {"hours": 0.0, "gross": 0.0, "entries": 2}


def test_stored_hours_win_as_on_weekly_payroll():
    u = _staff("Corrected", rate=10.0)
    e = _shift(u, _utc(2031, 5, 1, 9), _utc(2031, 5, 1, 17), break_minutes=0)
    run(server.db.time_clock_entries.update_one({"id": e["id"]}, {"$set": {"hours": 6.0}}))
    rows = _file(2031, detail=True)
    assert _summary(rows, u)["hours"] == 6.0
    at = next(i for i, r in enumerate(rows) if r and r[0] == "DETAIL — every clocked entry")
    assert [(r[4], r[6]) for r in rows[at + 2:] if r and r[0] == u["name"]] == [("6.00", "60.00")], \
        "the detail row follows the stored hours too, never out minus in"


def test_the_year_is_cut_at_ohio_midnight():
    u = _staff("New Years Eve", rate=10.0)
    _shift(u, _utc(2031, 12, 31, 20), _utc(2031, 12, 31, 23), break_minutes=0)   # 01:00 UTC on Jan 1, 2032
    _shift(u, _utc(2031, 1, 1, 0, 30), _utc(2031, 1, 1, 3, 30), break_minutes=0)   # Jan 1 just after midnight
    _shift(u, _utc(2030, 12, 31, 21), _utc(2030, 12, 31, 23), break_minutes=0)   # last year's NYE shift
    assert _summary(_file(2031), u) == {"hours": 6.0, "gross": 60.0, "entries": 2}
    assert _summary(_file(2032), u) is None, "a Dec 31 evening shift landed in next year's file"
    assert _summary(_file(2030), u) == {"hours": 2.0, "gross": 20.0, "entries": 1}


def test_detail_rows_show_the_break_and_the_paid_hours():
    u = _staff("Detail", rate=20.0)
    _shift(u, _utc(2031, 6, 3, 8), _utc(2031, 6, 3, 16), break_minutes=30)
    rows = _file(2031, detail=True)
    at = next(i for i, r in enumerate(rows) if r and r[0] == "DETAIL — every clocked entry")
    assert rows[at + 1] == ["Employee", "Clock-in", "Clock-out", "Break (min)", "Hours", "Rate", "Gross"]
    mine = [r for r in rows[at + 2:] if r and r[0] == u["name"]]
    assert [(r[3], r[4], r[6]) for r in mine] == [("30", "7.50", "150.00")]


def test_the_owner_is_still_left_out():
    owner_staff = _staff("Owner Clock", rate=30.0, is_owner=True)
    _shift(owner_staff, _utc(2031, 7, 1, 8), _utc(2031, 7, 1, 12), break_minutes=0)
    assert _summary(_file(2031), owner_staff) is None, "a sole-prop owner's pay is a draw, not wages"
