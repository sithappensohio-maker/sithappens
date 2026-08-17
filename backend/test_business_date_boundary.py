"""Business-date boundary tests — the 8 p.m.–midnight Eastern window.

Two suites used to fail every evening because their fixtures derived
calendar business dates from the UTC clock while production correctly uses
America/New_York (server.BUSINESS_TZ / business_today()). These tests pin
the production semantics at fixed boundary instants so the invariants are
provable at ANY wall-clock hour, in both DST regimes:

  * a UTC timestamp after midnight UTC still belongs to the PREVIOUS
    New York business date until midnight Eastern;
  * a price override expires only when expires_on < business_today
    (valid through the expiry date inclusive), evaluated in Eastern terms.

Tag TEST_BDATE. Read-only against production logic — no clock patching of
live code, no business-rule changes.
"""
from datetime import date, timedelta

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server


# ── Test A — UTC has rolled over, America/New_York has not ──────────────────
def test_a_utc_rollover_still_previous_business_date():
    # 01:30Z on Aug 17 is 9:30 p.m. Aug 16 in New York (EDT, UTC-4).
    assert server._business_date_from_timestamp("2026-08-17T01:30:00Z") == "2026-08-16"
    # …and by 04:30Z (00:30 Eastern) the business date HAS advanced.
    assert server._business_date_from_timestamp("2026-08-17T04:30:00Z") == "2026-08-17"


# ── Test B — override expired: business_today − 1 is expired at any hour ────
def test_b_override_expired_yesterday_business_date():
    yesterday = (server.business_today() - timedelta(days=1)).isoformat()
    assert server._override_is_active({"expires_on": yesterday}) is False
    # Fixed-date variant (no live clock at all): expired the day after.
    assert server._override_is_active({"expires_on": "2026-08-16"}, today=date(2026, 8, 17)) is False


# ── Test C — override expiring TODAY is still active (inclusive) ────────────
def test_c_override_expiring_today_still_active():
    today_iso = server.business_today().isoformat()
    assert server._override_is_active({"expires_on": today_iso}) is True
    assert server._override_is_active({"expires_on": "2026-08-17"}, today=date(2026, 8, 17)) is True


# ── Test D — DST safety: EDT (UTC-4) and EST (UTC-5), not a fixed offset ────
def test_d_dst_aware_not_fixed_offset():
    # Winter (EST, UTC-5): 04:30Z Jan 15 = 11:30 p.m. Jan 14 Eastern.
    assert server._business_date_from_timestamp("2026-01-15T04:30:00Z") == "2026-01-14"
    # The same 04:30Z instant in summer (EDT, UTC-4) is ALREADY the new day —
    # a hard-coded -5 offset would get one of these two wrong.
    assert server._business_date_from_timestamp("2026-08-17T04:30:00Z") == "2026-08-17"
    # Winter boundary crossing at 05:30Z (00:30 EST).
    assert server._business_date_from_timestamp("2026-01-15T05:30:00Z") == "2026-01-15"
