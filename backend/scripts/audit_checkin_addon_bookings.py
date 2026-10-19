"""READ-ONLY: lists bookings that have add-ons added after the stay was booked
(audit #77). Checkout charged those extras off the visit's price before the fix.
Nothing is written. Run it against the database you want to review:

    MONGO_URL=mongodb://... DB_NAME=... python list_checkin_addon_bookings.py

A booking-time add-on is stamped at booking creation, so an add-on stamped more
than GRACE_MINUTES after the booking's created_at was added later. Each line
shows the add-on, the time it was added and the booking's amounts, so you can
decide what to do before any money changes.
"""
import os
from datetime import datetime, timedelta

from pymongo import MongoClient

GRACE_MINUTES = 5
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
DB_NAME = os.environ["DB_NAME"]


def _when(iso):
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:
        return None


def main():
    db = MongoClient(MONGO_URL)[DB_NAME]
    rows = 0
    query = {"add_ons.0": {"$exists": True}}
    for b in db.bookings.find(query, {"_id": 0, "id": 1, "created_at": 1, "date": 1, "status": 1, "client_name": 1,
                                       "dog_name": 1, "service_type": 1, "estimated_price": 1, "actual_price": 1,
                                       "add_ons": 1}):
        created = _when(b.get("created_at"))
        if not created:
            continue
        for ao in b.get("add_ons") or []:
            if ao.get("added_after_booking"):
                continue   # already fixed: marked when added
            added = _when(ao.get("added_at"))
            if added and added - created > timedelta(minutes=GRACE_MINUTES):
                rows += 1
                print(f"{b.get('id')}\t{b.get('date')}\t{b.get('status')}\t{b.get('dog_name')}\t{b.get('service_type')}\t"
                      f"{ao.get('name')}\t{ao.get('price')}\tadded {added.isoformat()}\t"
                      f"estimate {b.get('estimated_price')}\tactual {b.get('actual_price')}")
    print(f"# {rows} add-on line(s) added after booking")


if __name__ == "__main__":
    main()
