"""Shop product reviews (Shop gap-list item 4, owner request 2026-10-15).
A star rating + optional text from a client who actually bought the
product, hidden until an admin approves it. Covers the eligibility rule
(verified purchase, refund-aware), the one-review-per-client upsert that
resets to pending on edit, the aggregate math (published only), the
catalog/public-storefront rating fields, and admin moderation.

Disposable tag TEST_SHOP_REVIEWS.
"""
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from domains.shop import reviews as shop_reviews

TAG = "TEST_SHOP_REVIEWS"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "reviews@test"}

_made = {"clients": [], "products": [], "orders": []}


def teardown_module(_module):
    run(server.db.shop_product_reviews.delete_many({"product_id": {"$in": _made["products"]}}))
    run(server.db.shop_orders.delete_many({"id": {"$in": _made["orders"]}}))
    run(server.db.pos_products.delete_many({"id": {"$in": _made["products"]}}))
    run(server.db.clients.delete_many({"id": {"$in": _made["clients"]}}))


def _client():
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({
        "id": cid, "name": f"{TAG} Client {uuid.uuid4().hex[:4]}", "email": f"{cid[:8]}@example.com",
        "credits": 0, "created_at": server.now_iso(),
    }))
    _made["clients"].append(cid)
    return {"id": cid, "name": run(server.db.clients.find_one({"id": cid}, {"_id": 0, "name": 1}))["name"]}


def _product():
    p = run(server.create_pos_product(server.PosProductCreateIn(
        name=f"{TAG} Item {uuid.uuid4().hex[:6]}", price=25.0, show_online=True, active=True, starting_stock=0), ADMIN))
    _made["products"].append(p["id"])
    return p


def _paid_order(client_id, product_id, *, qty=1, qty_refunded=0):
    oid = str(uuid.uuid4())
    run(server.db.shop_orders.insert_one({
        "id": oid, "status": "paid", "client_id": client_id, "is_guest_order": False,
        "lines": [{"item_id": str(uuid.uuid4()), "kind": "product", "ref_id": product_id,
                   "quantity": qty, "quantity_refunded": qty_refunded, "name": "Item"}],
        "created_at": server.now_iso(),
    }))
    _made["orders"].append(oid)
    return oid


def _user_for(client):
    return {"id": str(uuid.uuid4()), "role": "client", "client_id": client["id"], "name": client["name"]}


# ──────────────────────────────────────────────────── has_purchased ────

def test_has_purchased_is_false_with_no_order():
    client = _client()
    product = _product()
    assert run(shop_reviews.has_purchased(server.db, client["id"], product["id"])) is False


def test_has_purchased_is_true_after_a_paid_order():
    client = _client()
    product = _product()
    _paid_order(client["id"], product["id"])
    assert run(shop_reviews.has_purchased(server.db, client["id"], product["id"])) is True


def test_has_purchased_is_false_once_fully_refunded():
    client = _client()
    product = _product()
    _paid_order(client["id"], product["id"], qty=1, qty_refunded=1)
    assert run(shop_reviews.has_purchased(server.db, client["id"], product["id"])) is False


def test_has_purchased_is_true_with_a_partial_refund():
    client = _client()
    product = _product()
    _paid_order(client["id"], product["id"], qty=2, qty_refunded=1)
    assert run(shop_reviews.has_purchased(server.db, client["id"], product["id"])) is True


# ───────────────────────────────────────────────────── submit_review ──

def test_submitting_without_a_purchase_is_refused():
    client = _client()
    product = _product()
    try:
        run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=5)))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 403


def test_a_first_review_is_created_pending():
    client = _client()
    product = _product()
    _paid_order(client["id"], product["id"])
    doc = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=4, text="Good leash")))
    assert doc["status"] == "pending"
    assert doc["rating"] == 4 and doc["text"] == "Good leash"
    assert doc["client_name"] == client["name"]


def test_a_second_submission_edits_in_place_not_a_duplicate():
    client = _client()
    product = _product()
    _paid_order(client["id"], product["id"])
    first = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=3)))
    second = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=5, text="Actually great")))
    assert second["id"] == first["id"]
    assert second["rating"] == 5 and second["text"] == "Actually great"
    count = run(server.db.shop_product_reviews.count_documents({"product_id": product["id"], "client_id": client["id"]}))
    assert count == 1


def test_editing_a_published_review_sends_it_back_to_pending():
    client = _client()
    product = _product()
    _paid_order(client["id"], product["id"])
    doc = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=5)))
    run(shop_reviews.moderate(server.db, doc["id"], status="published", actor_name="Staff"))
    edited = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=1, text="changed my mind")))
    assert edited["status"] == "pending"
    assert edited["moderated_at"] is None and edited["moderated_by"] is None


# ──────────────────────────────────────────────── aggregate / catalog ──

def test_aggregate_counts_only_published_reviews():
    product = _product()
    reviewers = [_client() for _ in range(3)]
    for i, c in enumerate(reviewers):
        _paid_order(c["id"], product["id"])
        doc = run(shop_reviews.submit_review(server.db, product["id"], c, shop_reviews.ShopReviewIn(rating=5 - i)))
        if i < 2:
            run(shop_reviews.moderate(server.db, doc["id"], status="published", actor_name="Staff"))
        # the third stays pending
    out = run(shop_reviews.published_reviews_and_aggregate(server.db, product["id"]))
    assert out["rating_count"] == 2
    assert out["rating_avg"] == 4.5  # (5 + 4) / 2
    assert len(out["reviews"]) == 2
    assert all("client_id" not in r for r in out["reviews"])  # reviewer identity stays internal


def test_rating_summaries_batches_across_products():
    reviewed = _product()
    unreviewed = _product()
    client = _client()
    _paid_order(client["id"], reviewed["id"])
    doc = run(shop_reviews.submit_review(server.db, reviewed["id"], client, shop_reviews.ShopReviewIn(rating=5)))
    run(shop_reviews.moderate(server.db, doc["id"], status="published", actor_name="Staff"))
    out = run(shop_reviews.rating_summaries(server.db, [reviewed["id"], unreviewed["id"]]))
    assert out[reviewed["id"]] == {"rating_avg": 5.0, "rating_count": 1}
    assert unreviewed["id"] not in out


def test_the_shop_catalog_carries_rating_fields_for_products():
    product = _product()
    client = _client()
    _paid_order(client["id"], product["id"])
    doc = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=4)))
    run(shop_reviews.moderate(server.db, doc["id"], status="published", actor_name="Staff"))
    catalog = run(server._build_shop_catalog(None))
    item = next(i for i in catalog["items"] if i["kind"] == "product" and i["id"] == product["id"])
    assert item["rating_avg"] == 4.0 and item["rating_count"] == 1

    unreviewed = _product()
    catalog2 = run(server._build_shop_catalog(None))
    item2 = next(i for i in catalog2["items"] if i["kind"] == "product" and i["id"] == unreviewed["id"])
    assert item2["rating_avg"] is None and item2["rating_count"] == 0


# ───────────────────────────────────────────────────────── routes ─────

def test_get_reviews_route_reports_eligibility_and_my_review():
    product = _product()
    client = _client()
    user = _user_for(client)
    before = run(server.shop_product_reviews(product["id"], user))
    assert before["can_review"] is False and before["my_review"] is None  # hasn't bought it yet

    _paid_order(client["id"], product["id"])
    after_purchase = run(server.shop_product_reviews(product["id"], user))
    assert after_purchase["can_review"] is True

    run(server.submit_shop_product_review(product["id"], shop_reviews.ShopReviewIn(rating=5), user))
    after_review = run(server.shop_product_reviews(product["id"], user))
    assert after_review["can_review"] is False  # already reviewed
    assert after_review["my_review"]["rating"] == 5


def test_submit_route_refuses_a_non_client():
    product = _product()
    staff = {"id": "s1", "role": "admin", "name": "Staff"}
    try:
        run(server.submit_shop_product_review(product["id"], shop_reviews.ShopReviewIn(rating=5), staff))
        assert False
    except HTTPException as e:
        assert e.status_code == 403


def test_public_route_matches_the_authenticated_published_view():
    product = _product()
    client = _client()
    _paid_order(client["id"], product["id"])
    doc = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=4)))
    run(shop_reviews.moderate(server.db, doc["id"], status="published", actor_name="Staff"))
    out = run(server.public_shop_product_reviews(product["id"]))
    assert out["rating_count"] == 1 and out["rating_avg"] == 4.0
    assert "my_review" not in out


def test_admin_moderation_routes():
    product = _product()
    client = _client()
    _paid_order(client["id"], product["id"])
    doc = run(shop_reviews.submit_review(server.db, product["id"], client, shop_reviews.ShopReviewIn(rating=2, text="meh")))

    pending = run(server.list_shop_reviews(status="pending", _=ADMIN))
    assert any(r["id"] == doc["id"] and r["product_name"] == product["name"] for r in pending["reviews"])

    updated = run(server.moderate_shop_review(doc["id"], shop_reviews.ShopReviewModerateIn(status="rejected"), ADMIN))
    assert updated["status"] == "rejected" and updated["moderated_by"] == ADMIN["name"]

    still_pending = run(server.list_shop_reviews(status="pending", _=ADMIN))
    assert all(r["id"] != doc["id"] for r in still_pending["reviews"])


def test_moderating_a_missing_review_404s():
    try:
        run(shop_reviews.moderate(server.db, "not-a-real-id", status="published", actor_name="Staff"))
        assert False
    except HTTPException as e:
        assert e.status_code == 404
