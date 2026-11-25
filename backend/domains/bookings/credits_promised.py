"""Credits a client's other upcoming bookings are going to use.

A credit is not taken when a visit is booked; it is taken when staff check
the dog out. Until then the balance on the account still shows it. So a
client with 2 daycare credits who has already booked Monday and Tuesday was
told, booking Wednesday, "Covered by credits" — and then owed money at the
desk on Wednesday, because Monday and Tuesday had used both.

`promised()` adds up what the client's visits that are still to be checked
out will need, so the booking screen can set those aside first and compare
the new booking against what is really free.

Read-only, and only ever used for what the CLIENT booking screen says and
offers (the price estimate and the "Pay now" offer). It never changes when a
credit is taken or what anyone is charged at pickup: checkout still spends
whatever credits are on the account, oldest first.
"""
from __future__ import annotations

from typing import Any, Callable, Dict

# Still expected to happen. Cancelled, rejected and finished visits need nothing.
OPEN_STATUSES = ("pending", "approved")


def _query(client_id: str, service_type: str, today: str) -> Dict[str, Any]:
    return {
        "client_id": client_id,
        "service_type": service_type,
        "status": {"$in": list(OPEN_STATUSES)},
        "no_show": {"$ne": True},
        "checked_out_at": {"$in": [None, ""]},
        # Today or later — or a dog that is here right now, whatever its dates.
        "$or": [
            {"date": {"$gte": today}},
            {"end_date": {"$gte": today}},
            {"checked_in_at": {"$nin": [None, ""]}},
        ],
    }


async def promised(db, client_id: str, service_type: str, *, today: str,
                   units_for: Callable[[dict], float]) -> float:
    """Credits of this kind the client's open visits will need at checkout.

    `units_for` is the same per-visit rule checkout uses
    (domains.pricing.services.service_base_credit_units_for_booking), so an
    extra dog's half credit and a boarding stay's nights are counted the way
    they will actually be spent.
    """
    if not client_id or not service_type:
        return 0.0
    total = 0.0
    rows = db.bookings.find(_query(client_id, service_type, today), {"_id": 0})
    async for row in rows:
        try:
            total += max(0.0, float(units_for(row) or 0))
        except (TypeError, ValueError):
            continue  # a malformed old row must not break the booking screen
    return round(total, 2)


def free_after(on_account: float, promised_units: float) -> float:
    """What is left for a NEW booking once the open ones are set aside."""
    return round(max(0.0, float(on_account or 0) - float(promised_units or 0)), 2)
