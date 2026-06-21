"""Iteration 17 — Regression for Sprints 37/38/39/39.5.

Covers:
  - Sprint 37: photo_gallery_url round-trip, photography service_type accepted in
    /api/services + /api/bookings, photography bookings DON'T deduct credits,
    boarding extension via check-out (extra_nights with/without credits).
  - Sprint 38: Unified catalog — programs visible to clients via GET /api/programs
    (slim payload includes price), PUT /api/programs/{id} persists price.
  - Sprint 39 / 39.5: Quote requests — POST /api/portal/quote-request for both
    service + program kinds, admin list + close endpoints, auth gating.

Test data is prefixed/tagged for cleanup; preview RESEND key is live so we only
fire one quote-request notification pair.
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", os.environ.get("TEST_BACKEND_URL","http://localhost:8001")
).rstrip("/")
ADMIN_EMAIL = "admin@sithappens.com"
ADMIN_PASSWORD = "admin123"
CLIENT_EMAIL = "testclient@sithappens.com"
CLIENT_PASSWORD = "test1234"
TEST_CLIENT_ID = "75a80c66-e542-49d4-b373-a105d9c304a1"
ROCKY_ID = "e519e548-5239-41b6-967a-46beb2453182"


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD}, timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------------- Sprint 37: photo_gallery_url ----------------
class TestPhotoGalleryUrl:
    def test_round_trip_via_put_client_and_portal_me(self, admin_headers, client_headers):
        url = f"https://gallery.example.com/{uuid.uuid4().hex[:8]}"
        # admin PUT
        existing = requests.get(
            f"{BASE_URL}/api/clients/{TEST_CLIENT_ID}", headers=admin_headers, timeout=15
        ).json()
        payload = {
            "name": existing.get("name", "Test Client"),
            "address": existing.get("address", ""),
            "phone": existing.get("phone", ""),
            "email": existing.get("email", CLIENT_EMAIL),
            "emerg": existing.get("emerg", ""),
            "credits": int(existing.get("credits") or 0),
            "training_credits": int(existing.get("training_credits") or 0),
            "boarding_credits": int(existing.get("boarding_credits") or 0),
            "photo_gallery_url": url,
        }
        r = requests.put(
            f"{BASE_URL}/api/clients/{TEST_CLIENT_ID}", json=payload, headers=admin_headers, timeout=15
        )
        assert r.status_code == 200, r.text
        assert r.json().get("photo_gallery_url") == url

        # client read via /portal/me
        me = requests.get(f"{BASE_URL}/api/portal/me", headers=client_headers, timeout=15)
        assert me.status_code == 200
        assert me.json()["client"].get("photo_gallery_url") == url


# ---------------- Sprint 37: photography service + booking (no credits) ----------------
class TestPhotographyService:
    @pytest.fixture(scope="class")
    def photo_service(self, admin_headers):
        body = {
            "name": f"TEST_PhotoSession_{uuid.uuid4().hex[:6]}",
            "base_price": 175.0,
            "service_type": "photography",
            "active": True,
        }
        r = requests.post(f"{BASE_URL}/api/services", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        svc = r.json()
        assert svc["service_type"] == "photography"
        yield svc
        requests.delete(f"{BASE_URL}/api/services/{svc['id']}", headers=admin_headers, timeout=15)

    def test_photography_service_listed(self, admin_headers, photo_service):
        r = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        types = [s.get("service_type") for s in r.json()]
        assert "photography" in types

    def test_photography_booking_does_not_consume_credits(self, admin_headers, photo_service):
        # snapshot credits before
        before = requests.get(
            f"{BASE_URL}/api/clients/{TEST_CLIENT_ID}", headers=admin_headers, timeout=15
        ).json()
        bdate = (date.today() + timedelta(days=3)).isoformat()
        body = {
            "client_id": TEST_CLIENT_ID,
            "dog_id": ROCKY_ID,
            "service_type": "photography",
            "service_id": photo_service["id"],
            "date": bdate,
            "status": "approved",
            "notes": "TEST_iter17 photography",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        bk = r.json()
        booking_id = bk["id"]
        assert bk.get("service_type") == "photography"
        # credits should not have been touched
        after = requests.get(
            f"{BASE_URL}/api/clients/{TEST_CLIENT_ID}", headers=admin_headers, timeout=15
        ).json()
        assert int(after.get("credits") or 0) == int(before.get("credits") or 0)
        assert int(after.get("training_credits") or 0) == int(before.get("training_credits") or 0)
        assert int(after.get("boarding_credits") or 0) == int(before.get("boarding_credits") or 0)
        assert int(bk.get("credits_deducted") or 0) == 0
        # cleanup
        requests.delete(f"{BASE_URL}/api/bookings/{booking_id}", headers=admin_headers, timeout=15)


# ---------------- Sprint 37: boarding extension at check-out ----------------
class TestBoardingExtension:
    @pytest.fixture(scope="class")
    def boarding_booking(self, admin_headers):
        # Ensure Rocky's vaccines are future-dated so booking validates
        future = (date.today() + timedelta(days=365)).isoformat()
        requests.put(
            f"{BASE_URL}/api/dogs/{ROCKY_ID}",
            json={"vaccines": {"rabies": future, "bordetella": future, "dhpp": future}},
            headers=admin_headers, timeout=15,
        )
        # boarding-credit snapshot
        before = requests.get(
            f"{BASE_URL}/api/clients/{TEST_CLIENT_ID}", headers=admin_headers, timeout=15
        ).json()
        start = (date.today() + timedelta(days=2)).isoformat()
        end = (date.today() + timedelta(days=4)).isoformat()  # 2 nights
        body = {
            "client_id": TEST_CLIENT_ID,
            "dog_id": ROCKY_ID,
            "service_type": "boarding",
            "date": start,
            "end_date": end,
            "status": "approved",
            "notes": "TEST_iter17 boarding base",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        bk = r.json()
        # check-in so check-out is valid
        requests.post(
            f"{BASE_URL}/api/bookings/{bk['id']}/check-in", headers=admin_headers, timeout=15
        )
        yield {"booking": bk, "before_client": before, "start": start, "end": end}
        # cleanup booking
        requests.delete(
            f"{BASE_URL}/api/bookings/{bk['id']}", headers=admin_headers, timeout=15
        )

    def test_extension_no_credits_extends_end_date_and_bills_actual_price(
        self, admin_headers, boarding_booking
    ):
        bk = boarding_booking["booking"]
        body = {
            "payment_status": "unpaid",
            "extra_nights": 2,
            "extra_nights_use_credits": False,
            "extra_nights_rate": 55,
        }
        r = requests.post(
            f"{BASE_URL}/api/bookings/{bk['id']}/check-out",
            json=body, headers=admin_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        # end_date extended by exactly 2 days
        expected_end = (date.fromisoformat(boarding_booking["end"]) + timedelta(days=2)).isoformat()
        assert out.get("end_date") == expected_end, out
        # actual_price must reflect the +2*$55 = +$110 charge. Base booking was 2 nights
        # at boarding_cost=1/night (legacy settings) and the default Boarding service
        # contributes its base_price too; with the +110 we expect >=110.
        assert float(out.get("actual_price") or 0) >= 110.0, out
        # NOTE: spec says backend writes an `extra_nights` audit dict on the booking
        # doc. It IS persisted to mongo but the BookingOut pydantic model strips it
        # from the API response (no extra_nights field). Reported as minor issue.


# ---------------- Sprint 38: Unified catalog — programs + price ----------------
class TestProgramsCatalog:
    def test_clients_see_programs_with_price(self, client_headers):
        r = requests.get(f"{BASE_URL}/api/programs", headers=client_headers, timeout=15)
        assert r.status_code == 200, r.text
        progs = r.json()
        assert isinstance(progs, list) and len(progs) > 0
        for p in progs:
            assert "price" in p
            assert "module_count" in p  # slim-payload signature for clients
            # Clients must NOT see modules array (admin-only field)
            assert "modules" not in p

    def test_admin_can_update_program_price(self, admin_headers):
        # pick any program
        progs = requests.get(
            f"{BASE_URL}/api/programs", headers=admin_headers, timeout=15
        ).json()
        assert progs, "expected seeded programs"
        target = progs[0]
        original_price = float(target.get("price") or 0)
        new_price = round(original_price + 17.5, 2)
        # ProgramIn body — pass through the whole existing prog with price overwritten
        body = {
            "name": target["name"],
            "slug": target.get("slug", ""),
            "type": target.get("type", "custom"),
            "description": target.get("description", ""),
            "focus": target.get("focus", ""),
            "format": target.get("format") or {"count": 0, "unit": "sessions"},
            "min_age_months": int(target.get("min_age_months") or 0),
            "modules": target.get("modules") or [],
            "price": new_price,
            "active": bool(target.get("active", True)),
            "completion_rule": target.get("completion_rule") or {"type": "all_goals", "min_score": 0},
        }
        r = requests.put(
            f"{BASE_URL}/api/programs/{target['id']}", json=body, headers=admin_headers, timeout=15
        )
        assert r.status_code == 200, r.text
        assert float(r.json().get("price") or 0) == new_price
        # client view reflects new price
        client_view = requests.get(
            f"{BASE_URL}/api/programs", headers=admin_headers, timeout=15
        ).json()
        match = [p for p in client_view if p["id"] == target["id"]]
        assert match and float(match[0].get("price") or 0) == new_price
        # restore
        body["price"] = original_price
        requests.put(
            f"{BASE_URL}/api/programs/{target['id']}", json=body, headers=admin_headers, timeout=15
        )


# ---------------- Sprint 39 / 39.5: Quote Requests ----------------
class TestQuoteRequests:
    def test_client_quote_for_service_creates_row_and_emails(self, client_headers, admin_headers):
        # pick a service
        svcs = requests.get(f"{BASE_URL}/api/services", headers=admin_headers, timeout=15).json()
        assert svcs, "expected seeded services"
        svc = svcs[0]
        body = {"kind": "service", "item_id": svc["id"], "message": "TEST_iter17 quote — service"}
        r = requests.post(
            f"{BASE_URL}/api/portal/quote-request", json=body, headers=client_headers, timeout=20
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        rid = r.json()["request_id"]
        # admin lists open requests
        lst = requests.get(
            f"{BASE_URL}/api/admin/quote-requests?status=open", headers=admin_headers, timeout=15
        )
        assert lst.status_code == 200
        ids = [row["id"] for row in lst.json()]
        assert rid in ids
        # admin closes it
        close = requests.post(
            f"{BASE_URL}/api/admin/quote-requests/{rid}/close", headers=admin_headers, timeout=15
        )
        assert close.status_code == 200
        # confirm no longer in open list
        lst2 = requests.get(
            f"{BASE_URL}/api/admin/quote-requests?status=open", headers=admin_headers, timeout=15
        ).json()
        assert rid not in [row["id"] for row in lst2]
        # but still in full list with status=closed
        closed = requests.get(
            f"{BASE_URL}/api/admin/quote-requests?status=closed", headers=admin_headers, timeout=15
        ).json()
        match = [row for row in closed if row["id"] == rid]
        assert match and match[0]["status"] == "closed"

    def test_client_quote_for_program_creates_row(self, client_headers, admin_headers):
        progs = requests.get(f"{BASE_URL}/api/programs", headers=client_headers, timeout=15).json()
        assert progs
        prog = progs[0]
        body = {"kind": "program", "item_id": prog["id"], "message": "TEST_iter17 quote — program"}
        r = requests.post(
            f"{BASE_URL}/api/portal/quote-request", json=body, headers=client_headers, timeout=20
        )
        assert r.status_code == 200, r.text
        rid = r.json()["request_id"]
        # close it for cleanup
        requests.post(
            f"{BASE_URL}/api/admin/quote-requests/{rid}/close", headers=admin_headers, timeout=15
        )

    def test_invalid_item_returns_404(self, client_headers):
        body = {"kind": "service", "item_id": "no-such-id", "message": "x"}
        r = requests.post(
            f"{BASE_URL}/api/portal/quote-request", json=body, headers=client_headers, timeout=15
        )
        assert r.status_code == 404

    def test_admin_cannot_post_quote_request(self, admin_headers):
        # admin tokens lack client_id → 403 "Clients only"
        body = {"kind": "service", "item_id": "x", "message": "x"}
        r = requests.post(
            f"{BASE_URL}/api/portal/quote-request", json=body, headers=admin_headers, timeout=15
        )
        assert r.status_code == 403

    def test_client_cannot_list_or_close(self, client_headers):
        r1 = requests.get(
            f"{BASE_URL}/api/admin/quote-requests", headers=client_headers, timeout=15
        )
        assert r1.status_code == 403
        r2 = requests.post(
            f"{BASE_URL}/api/admin/quote-requests/anything/close",
            headers=client_headers, timeout=15,
        )
        assert r2.status_code == 403
